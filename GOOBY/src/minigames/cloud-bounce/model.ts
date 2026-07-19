/**
 * Cloud Bounce — pure, deterministic fixed-step simulation.
 *
 * A portrait sky-hopper: Gooby auto-bounces off clouds and only steers
 * horizontally (held drag or arrow keys set a drift target). Clouds come in
 * four kinds — static, moving (deterministic sine sweep), fading (one bounce,
 * then they dissolve) and spring (extra-high launch). Stars float above some
 * clouds for bonus points, and fixed wind bands push the player sideways at
 * known altitudes. The run ends only by falling below the camera.
 *
 * The whole session lives here with zero DOM/three dependencies so the node
 * `--experimental-strip-types` specialist runner can execute it directly.
 * Cloud and star slots are fixed-capacity pools recycled in place, which the
 * Stage3D scene mirrors with instanced meshes: steady frames allocate
 * nothing on either side.
 *
 * Determinism: all randomness flows through one embedded mulberry32 PRNG
 * seeded once at state creation; the simulation only mutates inside
 * {@link stepCloud} (fixed dt) and the explicit input calls, so equal seeds
 * and identical input scripts produce bit-identical states.
 */
import type { RandomSource } from "../../core/contracts/rng";

export const CLOUD_STEP_SECONDS = 1 / 60;

/** Field width is 1; portrait view shows about 1.6 units of height. */
export const CLOUD_GRAVITY = 3.4;
export const CLOUD_BOUNCE_VELOCITY = 1.85;
export const CLOUD_SPRING_VELOCITY = 2.95;
export const CLOUD_PLAYER_RADIUS = 0.035;

export const CLOUD_DRIFT_SPEED = 0.85;
export const CLOUD_DRIFT_ACCEL = 7;

export const CLOUD_POOL_CAPACITY = 26;
export const STAR_POOL_CAPACITY = 8;
export const CLOUD_GEN_AHEAD = 2;
export const CLOUD_CULL_BELOW = 1.3;
/** Matches the portrait views: the run ends right at the bottom edge. */
export const CLOUD_FALL_DROP = 0.92;

export const CLOUD_FADE_SECONDS = 0.8;
export const STAR_COLLECT_RADIUS = 0.07;

export const CLOUD_HEIGHT_SCORE = 20;
export const CLOUD_STAR_SCORE = 25;
export const CLOUD_METERS_PER_UNIT = 10;
export const CLOUD_MILESTONE_METERS = 25;

/** Wind bands: band k spans [first + k·interval, … + height], alternating. */
export const CLOUD_WIND_FIRST = 3.2;
export const CLOUD_WIND_INTERVAL = 2.4;
export const CLOUD_WIND_HEIGHT = 0.7;
export const CLOUD_WIND_BASE_STRENGTH = 0.22;
export const CLOUD_WIND_MAX_STRENGTH = 0.5;

export const CLOUD_EVENT_CAP = 32;
const EDGE_MARGIN = CLOUD_PLAYER_RADIUS;
const BASE_HALF_WIDTH = 0.2;
const STAR_ABOVE_CLOUD = 0.17;

export type CloudPhase = "ready" | "running" | "finished";

export type CloudKind = "static" | "moving" | "fading" | "spring";

export type CloudEventKind =
  | "bounce"
  | "spring"
  | "fade"
  | "star"
  | "wind"
  | "milestone"
  | "fall"
  | "finished";

export interface CloudEvent {
  kind: CloudEventKind;
  value: number;
}

export interface CloudSlot {
  active: boolean;
  kind: CloudKind;
  /** Current center; moving clouds rewrite this every step. */
  x: number;
  anchorX: number;
  y: number;
  halfWidth: number;
  amplitude: number;
  speed: number;
  cloudPhase: number;
  /** 1 solid; fading clouds shrink toward 0 after their single bounce. */
  fade: number;
  bounced: boolean;
}

export interface CloudStarSlot {
  active: boolean;
  x: number;
  y: number;
  /** Deterministic twinkle phase for the views. */
  twinkle: number;
}

export interface CloudStats {
  bounces: number;
  springs: number;
  fades: number;
  stars: number;
  meters: number;
}

export interface CloudState {
  phase: CloudPhase;
  time: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Held drift target in [-1, 1] (drag offset or arrow keys). */
  drift: number;
  /** Camera floor: rises with the best altitude, never descends. */
  cameraY: number;
  bestY: number;
  score: number;
  starCount: number;
  /** Wind band index the player is currently inside, or -1. */
  windIndex: number;
  nextSpawnY: number;
  spawnCount: number;
  lastMilestone: number;
  endReason: "fall" | null;
  readonly clouds: CloudSlot[];
  readonly starSlots: CloudStarSlot[];
  stats: CloudStats;
  readonly events: CloudEvent[];
  eventCount: number;
  seed: number;
  rngState: number;
}

function mulberry32Next(state: CloudState): number {
  let value = (state.rngState = (state.rngState + 0x6d2b79f5) >>> 0);
  value = Math.imul(value ^ (value >>> 15), value | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
}

function pushEvent(state: CloudState, kind: CloudEventKind, value: number): void {
  if (state.eventCount >= CLOUD_EVENT_CAP) return;
  const slot = state.events[state.eventCount];
  if (slot) {
    slot.kind = kind;
    slot.value = value;
  } else {
    state.events.push({ kind, value });
  }
  state.eventCount += 1;
}

/** Drains buffered events in order; the buffer is recycled in place. */
export function drainCloudEvents(
  state: CloudState,
  callback: (kind: CloudEventKind, value: number) => void,
): void {
  for (let index = 0; index < state.eventCount; index += 1) {
    const event = state.events[index];
    if (event) callback(event.kind, event.value);
  }
  state.eventCount = 0;
}

/* ------------------------------------------------------------------ */
/* Wind bands (pure altitude functions shared with the views)          */
/* ------------------------------------------------------------------ */

/** The wind band covering altitude `y`, or -1 when the air is calm. */
export function cloudWindBandAt(y: number): number {
  if (y < CLOUD_WIND_FIRST) return -1;
  const offset = y - CLOUD_WIND_FIRST;
  const index = Math.floor(offset / CLOUD_WIND_INTERVAL);
  const within = offset - index * CLOUD_WIND_INTERVAL;
  return within <= CLOUD_WIND_HEIGHT ? index : -1;
}

/** Wind bands blow east on even indices, west on odd ones. */
export function cloudWindDirection(index: number): -1 | 1 {
  return index % 2 === 0 ? 1 : -1;
}

/** Wind speed (units/s) ramps gently with altitude, capped. */
export function cloudWindStrength(index: number): number {
  return Math.min(CLOUD_WIND_MAX_STRENGTH, CLOUD_WIND_BASE_STRENGTH + index * 0.04);
}

/** Bottom altitude of wind band `index` (bands are WIND_HEIGHT tall). */
export function cloudWindBandBottom(index: number): number {
  return CLOUD_WIND_FIRST + index * CLOUD_WIND_INTERVAL;
}

/* ------------------------------------------------------------------ */
/* State creation and generation                                       */
/* ------------------------------------------------------------------ */

function blankCloud(): CloudSlot {
  return {
    active: false,
    kind: "static",
    x: 0.5,
    anchorX: 0.5,
    y: 0,
    halfWidth: 0.1,
    amplitude: 0,
    speed: 0,
    cloudPhase: 0,
    fade: 1,
    bounced: false,
  };
}

export function createCloudState(rng: RandomSource): CloudState {
  const seed = Math.floor(rng.next() * 4_294_967_296) >>> 0;
  const clouds: CloudSlot[] = [];
  for (let index = 0; index < CLOUD_POOL_CAPACITY; index += 1) clouds.push(blankCloud());
  const starSlots: CloudStarSlot[] = [];
  for (let index = 0; index < STAR_POOL_CAPACITY; index += 1) {
    starSlots.push({ active: false, x: 0.5, y: 0, twinkle: 0 });
  }
  const state: CloudState = {
    phase: "ready",
    time: 0,
    x: 0.5,
    y: 0,
    vx: 0,
    vy: 0,
    drift: 0,
    cameraY: 0,
    bestY: 0,
    score: 0,
    starCount: 0,
    windIndex: -1,
    nextSpawnY: 0.32,
    spawnCount: 0,
    lastMilestone: 0,
    endReason: null,
    clouds,
    starSlots,
    stats: { bounces: 0, springs: 0, fades: 0, stars: 0, meters: 0 },
    events: [],
    eventCount: 0,
    seed,
    rngState: seed,
  };

  // The launch pad: a wide static cloud right under the spawn point.
  const base = state.clouds[0];
  if (base) {
    base.active = true;
    base.kind = "static";
    base.x = 0.5;
    base.anchorX = 0.5;
    base.y = 0;
    base.halfWidth = BASE_HALF_WIDTH;
    base.amplitude = 0;
    base.speed = 0;
    base.cloudPhase = 0;
    base.fade = 1;
    base.bounced = false;
  }
  fillClouds(state);
  return state;
}

/** Difficulty ramp in [0, 1] over the first 12 altitude units. */
export function cloudDifficulty(y: number): number {
  return Math.max(0, Math.min(1, y / 12));
}

function takeCloudSlot(state: CloudState): CloudSlot | null {
  const cullLine = state.cameraY - CLOUD_CULL_BELOW;
  for (const slot of state.clouds) {
    if (!slot.active || slot.y < cullLine) return slot;
  }
  return null;
}

function takeStarSlot(state: CloudState): CloudStarSlot | null {
  const cullLine = state.cameraY - CLOUD_CULL_BELOW;
  for (const slot of state.starSlots) {
    if (!slot.active || slot.y < cullLine) return slot;
  }
  return null;
}

function spawnCloud(state: CloudState): boolean {
  const slot = takeCloudSlot(state);
  if (!slot) return false;
  const y = state.nextSpawnY;
  const t = cloudDifficulty(y);

  const kindRoll = mulberry32Next(state);
  const springChance = 0.08;
  const movingChance = 0.1 + 0.25 * t;
  const fadingChance = 0.06 + 0.2 * t;
  let kind: CloudKind = "static";
  if (kindRoll < springChance) kind = "spring";
  else if (kindRoll < springChance + movingChance) kind = "moving";
  else if (kindRoll < springChance + movingChance + fadingChance) kind = "fading";

  const halfWidth = Math.max(0.08, 0.13 - 0.03 * t - mulberry32Next(state) * 0.02);
  const amplitude = kind === "moving"
    ? 0.06 + mulberry32Next(state) * 0.1
    : 0;
  const margin = halfWidth + amplitude + 0.02;
  const anchorX = margin + mulberry32Next(state) * Math.max(0.01, 1 - margin * 2);

  slot.active = true;
  slot.kind = kind;
  slot.anchorX = anchorX;
  slot.x = anchorX;
  slot.y = y;
  slot.halfWidth = halfWidth;
  slot.amplitude = amplitude;
  slot.speed = kind === "moving" ? 0.8 + mulberry32Next(state) * 0.9 : 0;
  slot.cloudPhase = kind === "moving" ? mulberry32Next(state) * Math.PI * 2 : 0;
  slot.fade = 1;
  slot.bounced = false;
  state.spawnCount += 1;

  if (mulberry32Next(state) < 0.2) {
    const star = takeStarSlot(state);
    if (star) {
      star.active = true;
      star.x = anchorX;
      star.y = y + STAR_ABOVE_CLOUD;
      star.twinkle = mulberry32Next(state) * Math.PI * 2;
    }
  }

  const gap = 0.24 + 0.1 * t + mulberry32Next(state) * 0.08;
  state.nextSpawnY = y + gap;
  return true;
}

function fillClouds(state: CloudState): void {
  while (state.nextSpawnY < state.cameraY + CLOUD_GEN_AHEAD) {
    if (!spawnCloud(state)) break;
  }
}

/* ------------------------------------------------------------------ */
/* Input                                                               */
/* ------------------------------------------------------------------ */

/** Launches off the base cloud; ignored unless the state is still ready. */
export function beginCloudRun(state: CloudState): void {
  if (state.phase !== "ready") return;
  state.phase = "running";
  state.vy = CLOUD_BOUNCE_VELOCITY;
  state.stats.bounces += 1;
  pushEvent(state, "bounce", 0);
}

/** Sets the held drift target in [-1, 1]; 0 releases the steer. */
export function setCloudDrift(state: CloudState, drift: number): void {
  state.drift = Math.max(-1, Math.min(1, Number.isFinite(drift) ? drift : 0));
}

/* ------------------------------------------------------------------ */
/* Simulation                                                          */
/* ------------------------------------------------------------------ */

/** True while the cloud can still carry a bounce. */
export function cloudIsSolid(cloud: CloudSlot): boolean {
  return cloud.active && !(cloud.kind === "fading" && cloud.bounced);
}

function bounceOff(state: CloudState, cloud: CloudSlot): void {
  state.y = cloud.y;
  if (cloud.kind === "spring") {
    state.vy = CLOUD_SPRING_VELOCITY;
    state.stats.springs += 1;
    pushEvent(state, "spring", Math.floor(cloud.y * CLOUD_METERS_PER_UNIT));
  } else {
    state.vy = CLOUD_BOUNCE_VELOCITY;
  }
  state.stats.bounces += 1;
  pushEvent(state, "bounce", Math.floor(cloud.y * CLOUD_METERS_PER_UNIT));
  if (cloud.kind === "fading" && !cloud.bounced) {
    cloud.bounced = true;
    state.stats.fades += 1;
    pushEvent(state, "fade", 0);
  }
}

function collectStars(state: CloudState): void {
  for (const star of state.starSlots) {
    if (!star.active) continue;
    const dx = star.x - state.x;
    const dy = star.y - state.y;
    if (dx * dx + dy * dy > STAR_COLLECT_RADIUS * STAR_COLLECT_RADIUS) continue;
    star.active = false;
    state.starCount += 1;
    state.stats.stars += 1;
    pushEvent(state, "star", state.starCount);
  }
}

/** Advances one fixed step; call only with `CLOUD_STEP_SECONDS`. */
export function stepCloud(state: CloudState, dt: number): void {
  if (state.phase !== "running") return;
  state.time += dt;

  // Moving clouds sweep on a pure sine of simulation time.
  for (const cloud of state.clouds) {
    if (!cloud.active) continue;
    if (cloud.kind === "moving") {
      cloud.x = cloud.anchorX
        + Math.sin(state.time * cloud.speed + cloud.cloudPhase) * cloud.amplitude;
    }
    if (cloud.kind === "fading" && cloud.bounced) {
      cloud.fade -= dt / CLOUD_FADE_SECONDS;
      if (cloud.fade <= 0) {
        cloud.fade = 0;
        cloud.active = false;
      }
    }
  }

  // Horizontal drift: velocity chases the held target, wind pushes on top.
  const targetVx = state.drift * CLOUD_DRIFT_SPEED;
  const deltaVx = targetVx - state.vx;
  const maxStep = CLOUD_DRIFT_ACCEL * dt;
  state.vx += Math.abs(deltaVx) <= maxStep ? deltaVx : Math.sign(deltaVx) * maxStep;

  const windIndex = cloudWindBandAt(state.y);
  if (windIndex !== state.windIndex) {
    state.windIndex = windIndex;
    if (windIndex >= 0) pushEvent(state, "wind", cloudWindDirection(windIndex));
  }
  const windVx = windIndex >= 0
    ? cloudWindDirection(windIndex) * cloudWindStrength(windIndex)
    : 0;

  state.x += (state.vx + windVx) * dt;
  if (state.x < EDGE_MARGIN) {
    state.x = EDGE_MARGIN;
    if (state.vx < 0) state.vx = 0;
  } else if (state.x > 1 - EDGE_MARGIN) {
    state.x = 1 - EDGE_MARGIN;
    if (state.vx > 0) state.vx = 0;
  }

  // Vertical: gravity, then a swept bounce test while falling.
  const previousY = state.y;
  state.vy -= CLOUD_GRAVITY * dt;
  state.y += state.vy * dt;

  if (state.vy < 0) {
    let landed: CloudSlot | null = null;
    for (const cloud of state.clouds) {
      if (!cloudIsSolid(cloud)) continue;
      if (previousY < cloud.y || state.y > cloud.y) continue;
      if (Math.abs(state.x - cloud.x) > cloud.halfWidth + CLOUD_PLAYER_RADIUS) continue;
      if (!landed || cloud.y > landed.y) landed = cloud;
    }
    if (landed) bounceOff(state, landed);
  }

  collectStars(state);

  if (state.y > state.bestY) {
    state.bestY = state.y;
    state.cameraY = state.bestY;
    fillClouds(state);
    const meters = Math.floor(state.bestY * CLOUD_METERS_PER_UNIT);
    state.stats.meters = meters;
    if (meters >= state.lastMilestone + CLOUD_MILESTONE_METERS) {
      state.lastMilestone = Math.floor(meters / CLOUD_MILESTONE_METERS) * CLOUD_MILESTONE_METERS;
      pushEvent(state, "milestone", meters);
    }
  }
  state.score = Math.floor(state.bestY * CLOUD_HEIGHT_SCORE)
    + state.starCount * CLOUD_STAR_SCORE;

  // The one and only ending: falling out of the camera's view.
  if (state.y < state.cameraY - CLOUD_FALL_DROP) {
    state.phase = "finished";
    state.endReason = "fall";
    pushEvent(state, "fall", state.stats.meters);
    pushEvent(state, "finished", state.score);
  }
}
