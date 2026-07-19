/**
 * Shopping Surf — pure, deterministic fixed-step simulation.
 *
 * The whole run (course chunks, cart physics, collisions, pickups, combos,
 * shields, payout) lives here with zero DOM/three dependencies so the node
 * `--experimental-strip-types` specialist runner can execute it directly.
 * Every array is allocated once at state creation and recycled in place:
 * advancing the simulation never allocates, which is what keeps the render
 * layer's instanced pools stable too.
 *
 * Determinism: all randomness flows through one embedded mulberry32 PRNG
 * seeded at state creation, and the simulation only mutates inside
 * {@link stepSurf} with a fixed dt, so equal seeds and step counts produce
 * bit-identical states across any frame partition.
 */
import type { RandomSource } from "../../core/contracts/rng";

export const SURF_LANE_COUNT = 3;
export const SURF_LANE_SPACING = 2.4;
export const SURF_STEP_SECONDS = 1 / 120;

export const SURF_BASE_SPEED = 9.5;
export const SURF_MAX_SPEED = 20.5;
export const SURF_SPEED_RAMP_SECONDS = 70;
export const SURF_COURSE_LENGTH = 940;

export const SURF_LATERAL_SPEED = 9.5;
export const SURF_GRAVITY = 27;
export const SURF_JUMP_VELOCITY = 8.8;
export const SURF_RAMP_VELOCITY = 10.6;
export const SURF_FAST_FALL_GRAVITY = 34;
export const SURF_JUMP_BUFFER_SECONDS = 0.14;

export const SURF_CART_HALF_WIDTH = 0.86;
export const SURF_CART_CLEAR_HEIGHT = 1.02;
export const SURF_BANNER_DUCK_HEIGHT = 0.62;
export const SURF_OBSTACLE_HALF_DEPTH = 0.62;
export const SURF_PICKUP_RADIUS = 1.35;
export const SURF_NEAR_MISS_RADIUS = 1.55;

export const SURF_SHIELD_COUNT = 3;
export const SURF_INVULNERABLE_SECONDS = 1.25;
export const SURF_GENTLE_END_SECONDS = 1.5;
export const SURF_COMBO_WINDOW_SECONDS = 5;
export const SURF_MAX_MULTIPLIER = 5;

export const SURF_CHUNK_LENGTH = 26;
export const SURF_ACTIVE_CHUNKS = 6;
export const SURF_CHUNK_ENTITY_CAP = 18;
export const SURF_EVENT_CAP = 32;

export const SURF_GROCERY_LIST_SIZE = 6;
/** Course-z spacing between consecutive shopping-list groceries. */
export const SURF_GROCERY_INTERVAL = 132;
export const SURF_FIRST_GROCERY_Z = 96;

/** Minimum forward gap after an action obstacle before the next same-lane obstacle. */
export const SURF_SAME_LANE_OBSTACLE_GAP = 17;
/**
 * After a ramp the same lane stays free of bump obstacles this far: worst-case
 * flight (~16.1m at max speed) plus reaction distance after landing.
 */
export const SURF_RAMP_LANDING_GAP = 26;
/** Every window of this length must keep at least one obstacle-free lane. */
export const SURF_CLEAR_LANE_WINDOW = 8;

export const SURF_SCORE_PER_METER = 2;
export const SURF_COIN_SCORE = 25;
export const SURF_NEAR_MISS_SCORE = 40;
export const SURF_TRICK_SCORE = 150;
export const SURF_GROCERY_SCORE = 200;
export const SURF_LIST_BONUS = 600;
export const SURF_FINISH_BONUS = 400;
export const SURF_SHIELD_BONUS = 150;

export type SurfPhase = "ready" | "running" | "ending" | "finished";
export type SurfEndReason = "finish" | "bumps";

export type SurfEntityKind =
  | "none"
  | "crate"
  | "banner"
  | "ramp"
  | "coin"
  | "grocery";

export interface SurfEntity {
  kind: SurfEntityKind;
  lane: number;
  /** Absolute course z of the entity center. */
  z: number;
  resolved: boolean;
  nearMissed: boolean;
  groceryIndex: number;
}

export interface SurfChunk {
  index: number;
  startZ: number;
  patternId: number;
  entityCount: number;
  readonly entities: SurfEntity[];
}

export type SurfEventKind =
  | "coin"
  | "grocery"
  | "near-miss"
  | "trick"
  | "combo"
  | "bump"
  | "list-complete"
  | "jump"
  | "duck"
  | "lane-change"
  | "run-ended";

export interface SurfEvent {
  kind: SurfEventKind;
  value: number;
}

export interface SurfStats {
  jumps: number;
  ducks: number;
  laneChanges: number;
  nearMisses: number;
  tricks: number;
  coins: number;
}

export interface SurfState {
  phase: SurfPhase;
  /** Practice courses stay obstacle- and pickup-free for the input drills. */
  readonly practiceCourse: boolean;
  endReason: SurfEndReason | null;
  time: number;
  distance: number;
  speed: number;
  finishZ: number;
  lane: number;
  x: number;
  y: number;
  vy: number;
  airborne: boolean;
  rampLaunched: boolean;
  trickPending: boolean;
  ducking: boolean;
  duckHeld: boolean;
  jumpBuffer: number;
  invulnerable: number;
  shields: number;
  bumps: number;
  combo: number;
  comboTimer: number;
  multiplier: number;
  score: number;
  groceryCount: number;
  readonly groceries: boolean[];
  listComplete: boolean;
  endTimer: number;
  eventCount: number;
  readonly events: SurfEvent[];
  nextChunkIndex: number;
  readonly chunks: SurfChunk[];
  rngState: number;
  readonly stats: SurfStats;
}

export interface SurfPayout {
  readonly score: number;
  readonly coins: number;
  readonly xp: number;
}

/** One placement inside a chunk pattern: fractional z along the chunk. */
interface PatternEntity {
  readonly kind: Exclude<SurfEntityKind, "none">;
  readonly lane: number;
  readonly zFrac: number;
}

interface ChunkPattern {
  readonly id: number;
  readonly entities: readonly PatternEntity[];
}

function coinRow(lane: number, from: number, count: number, step: number): PatternEntity[] {
  const row: PatternEntity[] = [];
  for (let index = 0; index < count; index += 1) {
    row.push({ kind: "coin", lane, zFrac: from + index * step });
  }
  return row;
}

/**
 * Handcrafted chunk patterns. Invariants (verified by property tests):
 * - every {@link SURF_CLEAR_LANE_WINDOW} window keeps ≥1 obstacle-free lane
 *   reachable with at most one lane change between consecutive rows;
 * - no same-lane crate/banner pair closer than {@link SURF_SAME_LANE_OBSTACLE_GAP};
 * - pickups never overlap obstacles in the same lane window;
 * - entity count per chunk stays under {@link SURF_CHUNK_ENTITY_CAP}.
 */
const CHUNK_PATTERNS: readonly ChunkPattern[] = [
  { id: 0, entities: [...coinRow(1, 0.2, 4, 0.14)] },
  {
    id: 1,
    entities: [
      { kind: "crate", lane: 0, zFrac: 0.3 },
      { kind: "crate", lane: 1, zFrac: 0.3 },
      ...coinRow(2, 0.24, 3, 0.12),
      { kind: "banner", lane: 2, zFrac: 0.82 },
      ...coinRow(0, 0.76, 3, 0.1),
    ],
  },
  {
    id: 2,
    entities: [
      { kind: "banner", lane: 1, zFrac: 0.28 },
      { kind: "banner", lane: 2, zFrac: 0.28 },
      ...coinRow(0, 0.2, 4, 0.12),
      { kind: "crate", lane: 0, zFrac: 0.86 },
      ...coinRow(1, 0.8, 3, 0.1),
    ],
  },
  {
    id: 3,
    entities: [
      { kind: "ramp", lane: 1, zFrac: 0.34 },
      ...coinRow(1, 0.5, 4, 0.11),
      { kind: "crate", lane: 0, zFrac: 0.62 },
      { kind: "crate", lane: 2, zFrac: 0.62 },
    ],
  },
  {
    id: 4,
    entities: [
      { kind: "crate", lane: 2, zFrac: 0.26 },
      ...coinRow(1, 0.2, 3, 0.12),
      { kind: "crate", lane: 0, zFrac: 0.55 },
      { kind: "banner", lane: 2, zFrac: 0.9 },
      ...coinRow(2, 0.62, 2, 0.1),
    ],
  },
  {
    id: 5,
    entities: [
      { kind: "banner", lane: 0, zFrac: 0.3 },
      { kind: "crate", lane: 1, zFrac: 0.3 },
      ...coinRow(2, 0.24, 4, 0.12),
      { kind: "ramp", lane: 0, zFrac: 0.78 },
      ...coinRow(0, 0.88, 2, 0.08),
    ],
  },
  {
    id: 6,
    entities: [
      { kind: "ramp", lane: 2, zFrac: 0.3 },
      ...coinRow(2, 0.46, 4, 0.1),
      { kind: "banner", lane: 0, zFrac: 0.6 },
      { kind: "banner", lane: 1, zFrac: 0.6 },
    ],
  },
  {
    id: 7,
    entities: [
      { kind: "crate", lane: 1, zFrac: 0.24 },
      ...coinRow(0, 0.18, 3, 0.12),
      { kind: "crate", lane: 2, zFrac: 0.58 },
      ...coinRow(1, 0.52, 3, 0.11),
      { kind: "crate", lane: 0, zFrac: 0.92 },
    ],
  },
];

export function surfChunkPatternCount(): number {
  return CHUNK_PATTERNS.length;
}

/** mulberry32 — small, fast, deterministic PRNG embedded for purity. */
function nextRandom(state: SurfState): number {
  state.rngState = (state.rngState + 0x6d2b79f5) | 0;
  let t = state.rngState;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function surfLaneX(lane: number): number {
  return (lane - (SURF_LANE_COUNT - 1) / 2) * SURF_LANE_SPACING;
}

function createEntity(): SurfEntity {
  return { kind: "none", lane: 0, z: 0, resolved: false, nearMissed: false, groceryIndex: -1 };
}

function createChunk(): SurfChunk {
  const entities: SurfEntity[] = [];
  for (let index = 0; index < SURF_CHUNK_ENTITY_CAP; index += 1) entities.push(createEntity());
  return { index: -1, startZ: 0, patternId: 0, entityCount: 0, entities };
}

/** The first two chunks of every course are obstacle-free warm-up stretches. */
const WARMUP_CHUNKS = 2;

function isObstacle(kind: SurfEntityKind): boolean {
  return kind === "crate" || kind === "banner" || kind === "ramp";
}

function fillChunk(
  state: SurfState,
  chunk: SurfChunk,
  chunkIndex: number,
  previous: SurfChunk | null,
): void {
  chunk.index = chunkIndex;
  chunk.startZ = chunkIndex * SURF_CHUNK_LENGTH;
  chunk.entityCount = 0;
  for (const entity of chunk.entities) {
    entity.kind = "none";
    entity.resolved = false;
    entity.nearMissed = false;
    entity.groceryIndex = -1;
  }
  if (state.practiceCourse) {
    chunk.patternId = 0;
    return;
  }
  const nearFinish = chunk.startZ + SURF_CHUNK_LENGTH > state.finishZ - SURF_CHUNK_LENGTH;
  if (chunkIndex < WARMUP_CHUNKS || nearFinish) {
    chunk.patternId = 0;
    if (chunkIndex >= WARMUP_CHUNKS) appendPattern(chunk, CHUNK_PATTERNS[0]);
    appendGrocery(state, chunk, previous);
    return;
  }
  const pattern = CHUNK_PATTERNS[
    1 + Math.floor(nextRandom(state) * (CHUNK_PATTERNS.length - 1))
  ];
  chunk.patternId = pattern?.id ?? 0;
  if (pattern) appendPattern(chunk, pattern);
  sanitizeChunk(chunk, previous);
  appendGrocery(state, chunk, previous);
}

function appendPattern(chunk: SurfChunk, pattern: ChunkPattern | undefined): void {
  if (!pattern) return;
  for (const placed of pattern.entities) {
    const entity = chunk.entities[chunk.entityCount];
    if (!entity) break;
    entity.kind = placed.kind;
    entity.lane = placed.lane;
    entity.z = chunk.startZ + placed.zFrac * SURF_CHUNK_LENGTH;
    entity.resolved = false;
    entity.nearMissed = false;
    entity.groceryIndex = -1;
    chunk.entityCount += 1;
  }
}

/** Gap the given earlier obstacle imposes on later same-lane obstacles. */
function requiredGapAfter(kind: SurfEntityKind): number {
  return kind === "ramp" ? SURF_RAMP_LANDING_GAP : SURF_SAME_LANE_OBSTACLE_GAP;
}

/**
 * Fairness pass. Random pattern adjacency can produce same-lane obstacle
 * pairs that straddle a chunk boundary too tightly (no time to act after
 * the previous jump/duck/ramp flight), so any crate/banner that lands
 * within the required gap after an earlier same-lane obstacle — in this
 * chunk or the previous one — is downgraded in place to a coin.
 * Candidates are processed in ascending z so earlier downgrades free
 * later placements. No allocation: entities mutate in place.
 */
function sanitizeChunk(chunk: SurfChunk, previous: SurfChunk | null): void {
  for (let pass = 0; pass < chunk.entityCount; pass += 1) {
    // Find the next unvisited crate/banner with the smallest z (n<=18, so
    // the quadratic selection stays trivial and allocation-free).
    let candidate: SurfEntity | null = null;
    for (let index = 0; index < chunk.entityCount; index += 1) {
      const entity = chunk.entities[index];
      if (!entity || entity.nearMissed) continue; // nearMissed = visited marker during fill
      if (entity.kind !== "crate" && entity.kind !== "banner") continue;
      if (!candidate || entity.z < candidate.z) candidate = entity;
    }
    if (!candidate) break;
    candidate.nearMissed = true;
    if (hasBlockingObstacleBefore(chunk, previous, candidate)) candidate.kind = "coin";
  }
  // Reset the visited markers so collision near-miss tracking starts clean.
  for (let index = 0; index < chunk.entityCount; index += 1) {
    const entity = chunk.entities[index];
    if (entity) entity.nearMissed = false;
  }
}

function hasBlockingObstacleBefore(
  chunk: SurfChunk,
  previous: SurfChunk | null,
  candidate: SurfEntity,
): boolean {
  for (let scan = 0; scan < 2; scan += 1) {
    const source = scan === 0 ? previous : chunk;
    if (!source) continue;
    for (let index = 0; index < source.entityCount; index += 1) {
      const entity = source.entities[index];
      if (!entity || entity === candidate || entity.lane !== candidate.lane) continue;
      if (!isObstacle(entity.kind)) continue;
      const gap = candidate.z - entity.z;
      if (gap > 0 && gap < requiredGapAfter(entity.kind)) return true;
    }
  }
  return false;
}

/** Candidate z nudges tried in order until the grocery has a clear lane. */
const GROCERY_Z_OFFSETS = [0, 4, -4, 8, -8, 12, -12] as const;

/** Groceries spawn on a fixed z cadence inside whichever chunk covers them. */
function appendGrocery(state: SurfState, chunk: SurfChunk, previous: SurfChunk | null): void {
  for (let item = 0; item < SURF_GROCERY_LIST_SIZE; item += 1) {
    const groceryZ = SURF_FIRST_GROCERY_Z + item * SURF_GROCERY_INTERVAL;
    if (groceryZ < chunk.startZ || groceryZ >= chunk.startZ + SURF_CHUNK_LENGTH) continue;
    const entity = chunk.entities[chunk.entityCount];
    if (!entity) return;
    const preferred = Math.floor(nextRandom(state) * SURF_LANE_COUNT);
    // The cadence z can fall inside a fully blocked row (e.g. a ramp flanked
    // by crates); nudge along the chunk until some lane is reliably clear.
    let lane = -1;
    let z = groceryZ;
    for (const offset of GROCERY_Z_OFFSETS) {
      const candidate = groceryZ + offset;
      if (candidate < chunk.startZ + 1 || candidate > chunk.startZ + SURF_CHUNK_LENGTH - 1) continue;
      const clear = clearLaneNear(chunk, previous, candidate, preferred);
      if (clear >= 0) {
        lane = clear;
        z = candidate;
        break;
      }
    }
    entity.kind = "grocery";
    entity.lane = lane >= 0 ? lane : preferred;
    entity.z = z;
    entity.resolved = false;
    entity.nearMissed = false;
    entity.groceryIndex = item;
    chunk.entityCount += 1;
  }
}

/**
 * Picks a lane where the grocery is reliably collectible: no obstacle inside
 * the clear-lane window around z and no ramp launch whose flight could carry
 * the cart over the pickup. Returns -1 when every lane is blocked at this z.
 */
function clearLaneNear(
  chunk: SurfChunk,
  previous: SurfChunk | null,
  z: number,
  preferred: number,
): number {
  for (let offset = 0; offset < SURF_LANE_COUNT; offset += 1) {
    const lane = (preferred + offset) % SURF_LANE_COUNT;
    let blocked = false;
    for (let scan = 0; scan < 2 && !blocked; scan += 1) {
      const source = scan === 0 ? previous : chunk;
      if (!source) continue;
      for (let index = 0; index < source.entityCount; index += 1) {
        const entity = source.entities[index];
        if (!entity || entity.lane !== lane || !isObstacle(entity.kind)) continue;
        if (Math.abs(entity.z - z) < SURF_CLEAR_LANE_WINDOW / 2) {
          blocked = true;
          break;
        }
        if (entity.kind === "ramp" && z > entity.z && z - entity.z < SURF_RAMP_LANDING_GAP) {
          blocked = true;
          break;
        }
      }
    }
    if (!blocked) return lane;
  }
  return -1;
}

export interface SurfStateOptions {
  /** Course length override for tests; defaults to {@link SURF_COURSE_LENGTH}. */
  readonly courseLength?: number;
  /** Obstacle-free drill course used by the tutorial practice gates. */
  readonly practice?: boolean;
}

export function createSurfState(rng: RandomSource, options: SurfStateOptions = {}): SurfState {
  const events: SurfEvent[] = [];
  for (let index = 0; index < SURF_EVENT_CAP; index += 1) events.push({ kind: "coin", value: 0 });
  const chunks: SurfChunk[] = [];
  for (let index = 0; index < SURF_ACTIVE_CHUNKS; index += 1) chunks.push(createChunk());
  const groceries: boolean[] = [];
  for (let index = 0; index < SURF_GROCERY_LIST_SIZE; index += 1) groceries.push(false);
  const state: SurfState = {
    phase: "ready",
    practiceCourse: options.practice === true,
    endReason: null,
    time: 0,
    distance: 0,
    speed: SURF_BASE_SPEED,
    finishZ: options.courseLength ?? SURF_COURSE_LENGTH,
    lane: 1,
    x: 0,
    y: 0,
    vy: 0,
    airborne: false,
    rampLaunched: false,
    trickPending: false,
    ducking: false,
    duckHeld: false,
    jumpBuffer: 0,
    invulnerable: 0,
    shields: SURF_SHIELD_COUNT,
    bumps: 0,
    combo: 0,
    comboTimer: 0,
    multiplier: 1,
    score: 0,
    groceryCount: 0,
    groceries,
    listComplete: false,
    endTimer: 0,
    eventCount: 0,
    events,
    nextChunkIndex: 0,
    chunks,
    rngState: (Math.floor(rng.next() * 0xffffffff) ^ 0x9e3779b9) | 0,
    stats: { jumps: 0, ducks: 0, laneChanges: 0, nearMisses: 0, tricks: 0, coins: 0 },
  };
  for (let index = 0; index < SURF_ACTIVE_CHUNKS; index += 1) {
    const chunk = state.chunks[index];
    if (chunk) fillChunk(state, chunk, index, index > 0 ? state.chunks[index - 1] ?? null : null);
  }
  state.nextChunkIndex = SURF_ACTIVE_CHUNKS;
  return state;
}

export function beginSurfRun(state: SurfState): void {
  if (state.phase === "ready") state.phase = "running";
}

function pushEvent(state: SurfState, kind: SurfEventKind, value: number): void {
  const event = state.events[state.eventCount];
  if (!event) return;
  event.kind = kind;
  event.value = value;
  state.eventCount += 1;
}

/** Drains pending events into the callback and resets the ring. */
export function drainSurfEvents(
  state: SurfState,
  handle: (kind: SurfEventKind, value: number) => void,
): void {
  for (let index = 0; index < state.eventCount; index += 1) {
    const event = state.events[index];
    if (event) handle(event.kind, event.value);
  }
  state.eventCount = 0;
}

export function queueSurfJump(state: SurfState): void {
  if (state.phase !== "running") return;
  state.jumpBuffer = SURF_JUMP_BUFFER_SECONDS;
}

export function setSurfDuck(state: SurfState, held: boolean): void {
  state.duckHeld = held;
}

export function setSurfTargetLane(state: SurfState, lane: number): void {
  if (state.phase !== "running") return;
  const clamped = Math.min(SURF_LANE_COUNT - 1, Math.max(0, Math.round(lane)));
  if (clamped !== state.lane) {
    state.lane = clamped;
    state.stats.laneChanges += 1;
    pushEvent(state, "lane-change", clamped);
  }
}

export function stepSurfLane(state: SurfState, direction: -1 | 1): void {
  setSurfTargetLane(state, state.lane + direction);
}

function rampSpeed(state: SurfState): number {
  const progress = Math.min(1, Math.max(0, state.time / SURF_SPEED_RAMP_SECONDS));
  return SURF_BASE_SPEED + (SURF_MAX_SPEED - SURF_BASE_SPEED) * progress;
}

function bumpCart(state: SurfState): void {
  state.bumps += 1;
  state.shields = Math.max(0, SURF_SHIELD_COUNT - state.bumps);
  state.combo = 0;
  state.comboTimer = 0;
  state.multiplier = 1;
  state.invulnerable = SURF_INVULNERABLE_SECONDS;
  pushEvent(state, "bump", state.shields);
  if (state.bumps >= SURF_SHIELD_COUNT) {
    state.phase = "ending";
    state.endReason = "bumps";
    state.endTimer = 0;
  }
}

function raiseCombo(state: SurfState, kind: SurfEventKind, score: number): void {
  state.combo += 1;
  state.comboTimer = SURF_COMBO_WINDOW_SECONDS;
  const nextMultiplier = Math.min(SURF_MAX_MULTIPLIER, 1 + Math.floor(state.combo / 3));
  if (nextMultiplier > state.multiplier) {
    state.multiplier = nextMultiplier;
    pushEvent(state, "combo", nextMultiplier);
  }
  state.score += score * state.multiplier;
  pushEvent(state, kind, score * state.multiplier);
}

function collectGrocery(state: SurfState, entity: SurfEntity): void {
  entity.resolved = true;
  if (entity.groceryIndex >= 0 && entity.groceryIndex < state.groceries.length) {
    if (!state.groceries[entity.groceryIndex]) {
      state.groceries[entity.groceryIndex] = true;
      state.groceryCount += 1;
    }
  }
  state.score += SURF_GROCERY_SCORE * state.multiplier;
  pushEvent(state, "grocery", entity.groceryIndex);
  if (!state.listComplete && state.groceryCount >= SURF_GROCERY_LIST_SIZE) {
    state.listComplete = true;
    state.score += SURF_LIST_BONUS;
    pushEvent(state, "list-complete", SURF_LIST_BONUS);
  }
}

function resolveEntity(state: SurfState, entity: SurfEntity): void {
  if (entity.resolved || entity.kind === "none") return;
  const dz = entity.z - state.distance;
  const laneX = surfLaneX(entity.lane);
  const dx = Math.abs(state.x - laneX);

  if (entity.kind === "coin" || entity.kind === "grocery") {
    if (Math.abs(dz) < SURF_PICKUP_RADIUS && dx < SURF_PICKUP_RADIUS && state.y < 1.9) {
      if (entity.kind === "coin") {
        entity.resolved = true;
        state.stats.coins += 1;
        raiseCombo(state, "coin", SURF_COIN_SCORE);
      } else {
        collectGrocery(state, entity);
      }
    }
    return;
  }

  if (entity.kind === "ramp") {
    if (
      Math.abs(dz) < SURF_OBSTACLE_HALF_DEPTH
      && dx < SURF_CART_HALF_WIDTH + 0.35
      && !state.airborne
    ) {
      entity.resolved = true;
      state.airborne = true;
      state.rampLaunched = true;
      state.vy = SURF_RAMP_VELOCITY;
      state.ducking = false;
    }
    return;
  }

  // Crates and banners: overlap check with action-based clearance.
  if (Math.abs(dz) < SURF_OBSTACLE_HALF_DEPTH && dx < SURF_CART_HALF_WIDTH + 0.55) {
    const cleared = entity.kind === "crate"
      ? state.y >= SURF_CART_CLEAR_HEIGHT
      : state.ducking && !state.airborne;
    if (!cleared) {
      entity.resolved = true;
      if (state.invulnerable <= 0) bumpCart(state);
      return;
    }
  }

  // Near-miss: a crate/banner passes behind the cart plane unresolved after
  // being cleared at close range (jumped over / ducked under / shaved past).
  if (dz < -SURF_OBSTACLE_HALF_DEPTH && !entity.nearMissed) {
    entity.nearMissed = true;
    entity.resolved = true;
    if (dx < SURF_NEAR_MISS_RADIUS) {
      state.stats.nearMisses += 1;
      raiseCombo(state, "near-miss", SURF_NEAR_MISS_SCORE);
    }
  }
}

function recycleChunks(state: SurfState): void {
  for (const chunk of state.chunks) {
    if (chunk.startZ + SURF_CHUNK_LENGTH < state.distance - SURF_CHUNK_LENGTH) {
      let previous: SurfChunk | null = null;
      for (const other of state.chunks) {
        if (other.index === state.nextChunkIndex - 1) previous = other;
      }
      fillChunk(state, chunk, state.nextChunkIndex, previous);
      state.nextChunkIndex += 1;
    }
  }
}

/**
 * Advances the simulation by one fixed step. The caller drains events after
 * stepping. dt must be {@link SURF_STEP_SECONDS} for canonical runs; smaller
 * test steps are allowed.
 */
export function stepSurf(state: SurfState, dt: number): void {
  if (!Number.isFinite(dt) || dt < 0) throw new RangeError("Surf step delta must be finite and non-negative");
  if (state.phase === "ready" || state.phase === "finished") return;

  state.time += dt;

  if (state.phase === "ending") {
    state.endTimer += dt;
    const ease = Math.max(0, 1 - state.endTimer / SURF_GENTLE_END_SECONDS);
    state.speed = rampSpeed(state) * ease * ease;
    state.distance += state.speed * dt;
    settleVertical(state, dt);
    if (state.endTimer >= SURF_GENTLE_END_SECONDS) {
      state.phase = "finished";
      state.speed = 0;
      if (state.endReason === "finish") {
        state.score += SURF_FINISH_BONUS + state.shields * SURF_SHIELD_BONUS;
      }
      pushEvent(state, "run-ended", state.endReason === "finish" ? 1 : 0);
    }
    return;
  }

  // --- Running ---
  state.speed = rampSpeed(state);
  const previousDistance = state.distance;
  state.distance += state.speed * dt;
  state.score += (state.distance - previousDistance) * SURF_SCORE_PER_METER;

  // Lateral steering toward the target lane.
  const targetX = surfLaneX(state.lane);
  const deltaX = targetX - state.x;
  const maxMove = SURF_LATERAL_SPEED * dt;
  state.x += Math.abs(deltaX) <= maxMove ? deltaX : Math.sign(deltaX) * maxMove;

  // Jump buffering, duck, and vertical physics.
  state.jumpBuffer = Math.max(0, state.jumpBuffer - dt);
  if (state.jumpBuffer > 0 && !state.airborne) {
    state.jumpBuffer = 0;
    state.airborne = true;
    state.rampLaunched = false;
    state.vy = SURF_JUMP_VELOCITY;
    state.ducking = false;
    state.stats.jumps += 1;
    pushEvent(state, "jump", 0);
  } else if (state.jumpBuffer > 0 && state.airborne && state.rampLaunched && !state.trickPending) {
    state.jumpBuffer = 0;
    state.trickPending = true;
  }
  const wasDucking = state.ducking;
  state.ducking = state.duckHeld && !state.airborne;
  if (state.ducking && !wasDucking) {
    state.stats.ducks += 1;
    pushEvent(state, "duck", 0);
  }
  settleVertical(state, dt);

  // Combo decay.
  if (state.comboTimer > 0) {
    state.comboTimer = Math.max(0, state.comboTimer - dt);
    if (state.comboTimer === 0) {
      state.combo = 0;
      state.multiplier = 1;
    }
  }
  state.invulnerable = Math.max(0, state.invulnerable - dt);

  // Entities in active chunks.
  for (const chunk of state.chunks) {
    if (chunk.startZ > state.distance + SURF_CHUNK_LENGTH) continue;
    if (chunk.startZ + SURF_CHUNK_LENGTH < state.distance - SURF_CHUNK_LENGTH) continue;
    for (let index = 0; index < chunk.entityCount; index += 1) {
      const entity = chunk.entities[index];
      if (entity) resolveEntity(state, entity);
      if (state.phase !== "running") return;
    }
  }

  recycleChunks(state);

  if (state.distance >= state.finishZ) {
    state.phase = "ending";
    state.endReason = "finish";
    state.endTimer = 0;
  }
}

function settleVertical(state: SurfState, dt: number): void {
  if (!state.airborne) return;
  const gravity = state.duckHeld ? SURF_FAST_FALL_GRAVITY : SURF_GRAVITY;
  state.vy -= gravity * dt;
  state.y += state.vy * dt;
  if (state.y <= 0) {
    state.y = 0;
    state.vy = 0;
    state.airborne = false;
    const landedTrick = state.trickPending && state.rampLaunched;
    state.rampLaunched = false;
    state.trickPending = false;
    if (landedTrick && state.phase === "running") {
      state.stats.tricks += 1;
      raiseCombo(state, "trick", SURF_TRICK_SCORE);
    }
  }
}

export function surfPayout(state: SurfState): SurfPayout {
  const score = Math.max(0, Math.floor(state.score));
  if (score === 0) return { score: 0, coins: 0, xp: 0 };
  return {
    score,
    coins: Math.min(60, Math.floor(score / 150) + state.groceryCount * 2),
    xp: Math.min(140, Math.floor(score / 70) + state.shields * 5 + state.groceryCount * 4),
  };
}

// ---------------------------------------------------------------------------
// Practice gates — real-input onboarding drills before the scored run.
// ---------------------------------------------------------------------------

export type SurfPracticeStep = "left" | "right" | "jump" | "duck";

export const SURF_PRACTICE_STEPS: readonly SurfPracticeStep[] = [
  "left",
  "right",
  "jump",
  "duck",
];

export interface SurfPracticeState {
  index: number;
  complete: boolean;
}

export function createSurfPractice(): SurfPracticeState {
  return { index: 0, complete: false };
}

export function surfPracticeCurrent(practice: SurfPracticeState): SurfPracticeStep | null {
  if (practice.complete) return null;
  return SURF_PRACTICE_STEPS[practice.index] ?? null;
}

/** Advances the gate only when the performed action matches the prompt. */
export function surfPracticePerform(
  practice: SurfPracticeState,
  action: SurfPracticeStep,
): boolean {
  if (practice.complete) return false;
  if (SURF_PRACTICE_STEPS[practice.index] !== action) return false;
  practice.index += 1;
  if (practice.index >= SURF_PRACTICE_STEPS.length) practice.complete = true;
  return true;
}

// ---------------------------------------------------------------------------
// Course audit helpers used by the property tests.
// ---------------------------------------------------------------------------

export interface SurfCourseRow {
  readonly z: number;
  readonly kinds: readonly SurfEntityKind[];
}

/**
 * Deterministically materializes the obstacle layout of a full course for a
 * seed without running the physics, by generating chunks exactly the way the
 * live state does (same PRNG consumption order).
 */
export function auditSurfCourse(
  rng: RandomSource,
  courseLength: number,
): { readonly entities: readonly Readonly<SurfEntity>[]; readonly state: SurfState } {
  const state = createSurfState(rng, { courseLength });
  const collected: SurfEntity[] = [];
  const totalChunks = Math.ceil(courseLength / SURF_CHUNK_LENGTH) + 1;
  // Two alternating scratch chunks keep the "previous chunk" visible to the
  // sanitizer exactly the way the live ring buffer does.
  const scratchA = createChunk();
  const scratchB = createChunk();
  let previous: SurfChunk | null = null;
  for (let index = 0; index < totalChunks; index += 1) {
    const live = state.chunks.find((chunk) => chunk.index === index);
    let chunk: SurfChunk;
    if (live) {
      chunk = live;
    } else {
      chunk = previous === scratchA ? scratchB : scratchA;
      fillChunk(state, chunk, index, previous);
    }
    for (let entityIndex = 0; entityIndex < chunk.entityCount; entityIndex += 1) {
      const entity = chunk.entities[entityIndex];
      if (!entity || entity.kind === "none") continue;
      collected.push({ ...entity });
    }
    previous = chunk;
  }
  return { entities: collected, state };
}
