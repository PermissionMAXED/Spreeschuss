/**
 * Firefly Lantern — pure, deterministic fixed-step simulation.
 *
 * The whole five-round session lives here with zero DOM/canvas dependencies
 * so the node `--experimental-strip-types` specialist runner can execute it
 * directly. The player paints glowing light paths across a dusk meadow;
 * fireflies wander deterministically, latch onto nearby path points, follow
 * the stroke toward its head, and bank into the lantern. Brambles deflect
 * both drawing and flight, ink drains per painted length and regenerates
 * over time, and quick back-to-back banks build a convoy chain bonus.
 *
 * Determinism: all randomness flows through one embedded mulberry32 PRNG
 * seeded once at state creation, and the simulation only mutates inside
 * {@link stepFirefly} (with a fixed dt) and the explicit input calls, so
 * equal seeds and identical input scripts produce bit-identical states
 * across any frame partition.
 */
import type { RandomSource } from "../../core/contracts/rng";

export const FIREFLY_STEP_SECONDS = 1 / 60;
export const FIREFLY_ROUND_COUNT = 5;
export const FIREFLY_ROUND_SECONDS = 40;
export const FIREFLY_INTRO_SECONDS = 1.6;
export const FIREFLY_CLEAR_SECONDS = 1.8;

export const FIREFLY_INK_MAX = 1;
/** Ink drained per unit of painted path length (field widths). */
export const FIREFLY_INK_COST_PER_LENGTH = 1.5;
export const FIREFLY_INK_REGEN_PER_SECOND = 0.11;
/** Minimum ink required to begin a fresh stroke. */
export const FIREFLY_INK_START_MIN = 0.06;
export const FIREFLY_INK_START_COST = 0.02;

export const FIREFLY_PATH_POINT_SPACING = 0.014;
export const FIREFLY_PATH_POINT_LIFETIME = 7;
export const FIREFLY_STROKE_POINT_CAP = 240;
export const FIREFLY_LIVE_STROKE_CAP = 6;

export const FIREFLY_ATTRACT_RADIUS = 0.09;
export const FIREFLY_FOLLOW_SPEED = 0.17;
export const FIREFLY_WANDER_SPEED = 0.045;
export const FIREFLY_POINT_REACHED = 0.02;
export const FIREFLY_BODY_MARGIN = 0.012;

export const LANTERN_ATTRACT_RADIUS = 0.16;
export const LANTERN_BANK_RADIUS = 0.055;

export const FIREFLY_CONVOY_WINDOW_SECONDS = 2.5;
export const FIREFLY_CONVOY_CHAIN_CAP = 5;
export const FIREFLY_BANK_SCORE = 10;
export const FIREFLY_CONVOY_STEP_SCORE = 5;
export const FIREFLY_CLEAR_SECONDS_SCORE = 2;

export const FIREFLY_EVENT_CAP = 32;
const DEFLECT_EVENT_COOLDOWN = 0.6;
const EDGE_MIN = 0.02;
const EDGE_MAX = 0.98;

export type FireflyPhase = "ready" | "intro" | "playing" | "clear" | "finished";

export type FireflyMode = "wander" | "follow" | "lantern" | "banked" | "lost";

export type FireflyEventKind =
  | "round-start"
  | "bank"
  | "convoy"
  | "deflect"
  | "ink-empty"
  | "path-blocked"
  | "round-clear"
  | "round-timeout"
  | "finished";

export interface FireflyEvent {
  kind: FireflyEventKind;
  value: number;
}

export interface FireflyObstacle {
  x: number;
  y: number;
  radius: number;
}

export interface FireflyPathPoint {
  x: number;
  y: number;
  age: number;
}

export interface FireflyStroke {
  id: number;
  /** Points older than the lifetime expire from the front. */
  firstAlive: number;
  pointCount: number;
  readonly points: FireflyPathPoint[];
}

export interface Firefly {
  x: number;
  y: number;
  mode: FireflyMode;
  strokeId: number;
  targetIndex: number;
  phaseA: number;
  phaseB: number;
  deflectCooldown: number;
}

export interface FireflyStats {
  strokes: number;
  paintedLength: number;
  banked: number;
  lost: number;
  deflections: number;
}

export interface FireflyState {
  phase: FireflyPhase;
  /** Zero-based finished-round cursor; `round + 1` is the display round. */
  round: number;
  phaseTimer: number;
  time: number;
  timeLeft: number;
  ink: number;
  score: number;
  convoyChain: number;
  bestConvoy: number;
  /** Seconds since the last bank, for the convoy window. */
  sinceBank: number;
  lanternX: number;
  lanternY: number;
  bankedThisRound: number;
  fireflies: Firefly[];
  obstacles: FireflyObstacle[];
  strokes: FireflyStroke[];
  activeStrokeId: number;
  nextStrokeId: number;
  stats: FireflyStats;
  readonly events: FireflyEvent[];
  eventCount: number;
  seed: number;
  rngState: number;
}

function mulberry32Next(state: FireflyState): number {
  let value = (state.rngState = (state.rngState + 0x6d2b79f5) >>> 0);
  value = Math.imul(value ^ (value >>> 15), value | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
}

function pushEvent(state: FireflyState, kind: FireflyEventKind, value: number): void {
  if (state.eventCount >= FIREFLY_EVENT_CAP) return;
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
export function drainFireflyEvents(
  state: FireflyState,
  callback: (kind: FireflyEventKind, value: number) => void,
): void {
  for (let index = 0; index < state.eventCount; index += 1) {
    const event = state.events[index];
    if (event) callback(event.kind, event.value);
  }
  state.eventCount = 0;
}

export function fireflyCountForRound(round: number): number {
  return 3 + Math.max(0, Math.min(FIREFLY_ROUND_COUNT - 1, round));
}

export function obstacleCountForRound(round: number): number {
  return 2 + Math.max(0, Math.min(FIREFLY_ROUND_COUNT - 1, round));
}

export function createFireflyState(rng: RandomSource): FireflyState {
  const seed = Math.floor(rng.next() * 4_294_967_296) >>> 0;
  const state: FireflyState = {
    phase: "ready",
    round: 0,
    phaseTimer: 0,
    time: 0,
    timeLeft: FIREFLY_ROUND_SECONDS,
    ink: FIREFLY_INK_MAX,
    score: 0,
    convoyChain: 0,
    bestConvoy: 0,
    sinceBank: Number.POSITIVE_INFINITY,
    lanternX: 0.5,
    lanternY: 0.12,
    bankedThisRound: 0,
    fireflies: [],
    obstacles: [],
    strokes: [],
    activeStrokeId: -1,
    nextStrokeId: 1,
    stats: { strokes: 0, paintedLength: 0, banked: 0, lost: 0, deflections: 0 },
    events: [],
    eventCount: 0,
    seed,
    rngState: seed,
  };
  return state;
}

function layoutRound(state: FireflyState, round: number): void {
  state.lanternX = 0.25 + mulberry32Next(state) * 0.5;
  state.lanternY = 0.11 + mulberry32Next(state) * 0.05;

  state.obstacles.length = 0;
  const obstacleCount = obstacleCountForRound(round);
  for (let index = 0; index < obstacleCount; index += 1) {
    let x = 0.5;
    let y = 0.45;
    let radius = 0.06;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      x = 0.12 + mulberry32Next(state) * 0.76;
      y = 0.28 + mulberry32Next(state) * 0.36;
      radius = 0.05 + mulberry32Next(state) * 0.035;
      const lanternDx = x - state.lanternX;
      const lanternDy = y - state.lanternY;
      if (Math.hypot(lanternDx, lanternDy) < radius + LANTERN_BANK_RADIUS + 0.1) continue;
      let clear = true;
      for (const other of state.obstacles) {
        if (Math.hypot(x - other.x, y - other.y) < radius + other.radius + 0.045) {
          clear = false;
          break;
        }
      }
      if (clear) break;
    }
    state.obstacles.push({ x, y, radius });
  }

  state.fireflies.length = 0;
  const fireflyCount = fireflyCountForRound(round);
  for (let index = 0; index < fireflyCount; index += 1) {
    state.fireflies.push({
      x: 0.14 + mulberry32Next(state) * 0.72,
      y: 0.76 + mulberry32Next(state) * 0.16,
      mode: "wander",
      strokeId: -1,
      targetIndex: 0,
      phaseA: mulberry32Next(state) * Math.PI * 2,
      phaseB: mulberry32Next(state) * Math.PI * 2,
      deflectCooldown: 0,
    });
  }

  state.strokes.length = 0;
  state.activeStrokeId = -1;
  state.ink = FIREFLY_INK_MAX;
  state.timeLeft = FIREFLY_ROUND_SECONDS;
  state.bankedThisRound = 0;
  state.convoyChain = 0;
  state.sinceBank = Number.POSITIVE_INFINITY;
}

/** Starts round one; ignored unless the state is still `ready`. */
export function beginFireflyRun(state: FireflyState): void {
  if (state.phase !== "ready") return;
  state.round = 0;
  layoutRound(state, 0);
  state.phase = "intro";
  state.phaseTimer = FIREFLY_INTRO_SECONDS;
  pushEvent(state, "round-start", 1);
}

function insideObstacle(state: FireflyState, x: number, y: number, margin: number): boolean {
  for (const obstacle of state.obstacles) {
    if (Math.hypot(x - obstacle.x, y - obstacle.y) < obstacle.radius + margin) return true;
  }
  return false;
}

function clampCoord(value: number): number {
  return Math.min(EDGE_MAX, Math.max(EDGE_MIN, value));
}

function liveStroke(state: FireflyState, id: number): FireflyStroke | null {
  for (const stroke of state.strokes) {
    if (stroke.id === id) return stroke;
  }
  return null;
}

export type FireflyStrokeResult = "added" | "skipped" | "blocked" | "no-ink" | "idle";

/**
 * Begins a pointer stroke at normalized field coordinates. Returns false
 * when the round is not active, ink is too low, or the point sits inside an
 * obstacle.
 */
export function beginFireflyStroke(state: FireflyState, x: number, y: number): boolean {
  if (state.phase !== "playing") return false;
  const px = clampCoord(x);
  const py = clampCoord(y);
  if (state.ink < FIREFLY_INK_START_MIN) {
    pushEvent(state, "ink-empty", state.ink);
    return false;
  }
  if (insideObstacle(state, px, py, 0)) {
    pushEvent(state, "path-blocked", 0);
    return false;
  }
  while (state.strokes.length >= FIREFLY_LIVE_STROKE_CAP) state.strokes.shift();
  const stroke: FireflyStroke = {
    id: state.nextStrokeId,
    firstAlive: 0,
    pointCount: 1,
    points: [{ x: px, y: py, age: 0 }],
  };
  state.nextStrokeId += 1;
  state.strokes.push(stroke);
  state.activeStrokeId = stroke.id;
  state.ink = Math.max(0, state.ink - FIREFLY_INK_START_COST);
  state.stats.strokes += 1;
  return true;
}

/**
 * Extends the active stroke toward the pointer, inserting evenly spaced
 * points along the segment. Painting stops (and the stroke ends) when ink
 * runs out or the segment would enter an obstacle.
 */
export function extendFireflyStroke(state: FireflyState, x: number, y: number): FireflyStrokeResult {
  if (state.phase !== "playing" || state.activeStrokeId < 0) return "idle";
  const stroke = liveStroke(state, state.activeStrokeId);
  if (!stroke || stroke.pointCount === 0) {
    state.activeStrokeId = -1;
    return "idle";
  }
  const tail = stroke.points[stroke.pointCount - 1];
  if (!tail) return "idle";
  const targetX = clampCoord(x);
  const targetY = clampCoord(y);
  let lastX = tail.x;
  let lastY = tail.y;
  const distance = Math.hypot(targetX - lastX, targetY - lastY);
  if (distance < FIREFLY_PATH_POINT_SPACING) return "skipped";
  const stepX = ((targetX - lastX) / distance) * FIREFLY_PATH_POINT_SPACING;
  const stepY = ((targetY - lastY) / distance) * FIREFLY_PATH_POINT_SPACING;
  const steps = Math.floor(distance / FIREFLY_PATH_POINT_SPACING);
  let added = 0;
  for (let index = 0; index < steps; index += 1) {
    const nextX = lastX + stepX;
    const nextY = lastY + stepY;
    if (insideObstacle(state, nextX, nextY, 0)) {
      state.activeStrokeId = -1;
      pushEvent(state, "path-blocked", 1);
      return added > 0 ? "added" : "blocked";
    }
    const cost = FIREFLY_PATH_POINT_SPACING * FIREFLY_INK_COST_PER_LENGTH;
    if (state.ink < cost) {
      state.activeStrokeId = -1;
      pushEvent(state, "ink-empty", 0);
      return added > 0 ? "added" : "no-ink";
    }
    if (stroke.pointCount >= FIREFLY_STROKE_POINT_CAP) {
      state.activeStrokeId = -1;
      return added > 0 ? "added" : "skipped";
    }
    state.ink -= cost;
    state.stats.paintedLength += FIREFLY_PATH_POINT_SPACING;
    const slot = stroke.points[stroke.pointCount];
    if (slot) {
      slot.x = nextX;
      slot.y = nextY;
      slot.age = 0;
    } else {
      stroke.points.push({ x: nextX, y: nextY, age: 0 });
    }
    stroke.pointCount += 1;
    lastX = nextX;
    lastY = nextY;
    added += 1;
  }
  return added > 0 ? "added" : "skipped";
}

export function endFireflyStroke(state: FireflyState): void {
  state.activeStrokeId = -1;
}

function agePaths(state: FireflyState, dt: number): void {
  for (let strokeIndex = state.strokes.length - 1; strokeIndex >= 0; strokeIndex -= 1) {
    const stroke = state.strokes[strokeIndex];
    if (!stroke) continue;
    for (let index = stroke.firstAlive; index < stroke.pointCount; index += 1) {
      const point = stroke.points[index];
      if (point) point.age += dt;
    }
    while (stroke.firstAlive < stroke.pointCount) {
      const point = stroke.points[stroke.firstAlive];
      if (!point || point.age < FIREFLY_PATH_POINT_LIFETIME) break;
      stroke.firstAlive += 1;
    }
    if (stroke.firstAlive >= stroke.pointCount && stroke.id !== state.activeStrokeId) {
      state.strokes.splice(strokeIndex, 1);
    }
  }
}

/**
 * Deflects a position out of any obstacle it entered, sliding it to the
 * circle boundary along the radial direction. Returns true when deflected.
 */
function deflect(state: FireflyState, firefly: Firefly): boolean {
  let deflected = false;
  for (const obstacle of state.obstacles) {
    const limit = obstacle.radius + FIREFLY_BODY_MARGIN;
    const dx = firefly.x - obstacle.x;
    const dy = firefly.y - obstacle.y;
    const dist = Math.hypot(dx, dy);
    if (dist >= limit) continue;
    if (dist < 1e-6) {
      firefly.x = obstacle.x + limit;
      firefly.y = obstacle.y;
    } else {
      const scale = limit / dist;
      firefly.x = obstacle.x + dx * scale;
      firefly.y = obstacle.y + dy * scale;
    }
    deflected = true;
  }
  return deflected;
}

function senseStroke(state: FireflyState, firefly: Firefly): boolean {
  let bestDistance = FIREFLY_ATTRACT_RADIUS;
  let bestStroke = -1;
  let bestIndex = 0;
  for (const stroke of state.strokes) {
    for (let index = stroke.firstAlive; index < stroke.pointCount; index += 1) {
      const point = stroke.points[index];
      if (!point) continue;
      const distance = Math.hypot(point.x - firefly.x, point.y - firefly.y);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestStroke = stroke.id;
        bestIndex = index;
      }
    }
  }
  if (bestStroke < 0) return false;
  firefly.mode = "follow";
  firefly.strokeId = bestStroke;
  firefly.targetIndex = bestIndex;
  return true;
}

function moveToward(firefly: Firefly, x: number, y: number, speed: number, dt: number): void {
  const dx = x - firefly.x;
  const dy = y - firefly.y;
  const distance = Math.hypot(dx, dy);
  if (distance < 1e-6) return;
  const step = Math.min(distance, speed * dt);
  firefly.x += (dx / distance) * step;
  firefly.y += (dy / distance) * step;
}

function bankFirefly(state: FireflyState, firefly: Firefly): void {
  firefly.mode = "banked";
  state.bankedThisRound += 1;
  state.stats.banked += 1;
  const chained = state.sinceBank <= FIREFLY_CONVOY_WINDOW_SECONDS;
  state.convoyChain = chained ? state.convoyChain + 1 : 1;
  state.bestConvoy = Math.max(state.bestConvoy, state.convoyChain);
  state.sinceBank = 0;
  const chain = Math.min(FIREFLY_CONVOY_CHAIN_CAP, state.convoyChain);
  state.score += FIREFLY_BANK_SCORE + FIREFLY_CONVOY_STEP_SCORE * (chain - 1);
  pushEvent(state, "bank", state.convoyChain);
  if (state.convoyChain >= 2) pushEvent(state, "convoy", state.convoyChain);
}

function stepFireflyBody(state: FireflyState, firefly: Firefly, dt: number): void {
  if (firefly.mode === "banked" || firefly.mode === "lost") return;
  firefly.deflectCooldown = Math.max(0, firefly.deflectCooldown - dt);

  const lanternDistance = Math.hypot(firefly.x - state.lanternX, firefly.y - state.lanternY);
  if (firefly.mode !== "lantern" && lanternDistance < LANTERN_ATTRACT_RADIUS) {
    firefly.mode = "lantern";
    firefly.strokeId = -1;
  }

  if (firefly.mode === "wander") {
    senseStroke(state, firefly);
  }

  if (firefly.mode === "follow") {
    const stroke = liveStroke(state, firefly.strokeId);
    if (!stroke || stroke.firstAlive >= stroke.pointCount) {
      firefly.mode = lanternDistance < LANTERN_ATTRACT_RADIUS ? "lantern" : "wander";
      firefly.strokeId = -1;
    } else {
      if (firefly.targetIndex < stroke.firstAlive) firefly.targetIndex = stroke.firstAlive;
      let target = stroke.points[firefly.targetIndex];
      while (
        target &&
        Math.hypot(target.x - firefly.x, target.y - firefly.y) < FIREFLY_POINT_REACHED &&
        firefly.targetIndex < stroke.pointCount - 1
      ) {
        firefly.targetIndex += 1;
        target = stroke.points[firefly.targetIndex];
      }
      if (
        target &&
        firefly.targetIndex >= stroke.pointCount - 1 &&
        Math.hypot(target.x - firefly.x, target.y - firefly.y) < FIREFLY_POINT_REACHED
      ) {
        firefly.mode = lanternDistance < LANTERN_ATTRACT_RADIUS ? "lantern" : "wander";
        firefly.strokeId = -1;
      } else if (target) {
        moveToward(firefly, target.x, target.y, FIREFLY_FOLLOW_SPEED, dt);
      }
    }
  }

  if (firefly.mode === "lantern") {
    moveToward(firefly, state.lanternX, state.lanternY, FIREFLY_FOLLOW_SPEED, dt);
    if (Math.hypot(firefly.x - state.lanternX, firefly.y - state.lanternY) < LANTERN_BANK_RADIUS) {
      bankFirefly(state, firefly);
      return;
    }
  }

  if (firefly.mode === "wander") {
    const t = state.time;
    let dirX = Math.sin(t * 0.7 + firefly.phaseA);
    let dirY = Math.cos(t * 0.9 + firefly.phaseB) * 0.6;
    // Gentle deterministic pull back toward the meadow center at the edges.
    if (firefly.x < 0.12) dirX += 0.8;
    if (firefly.x > 0.88) dirX -= 0.8;
    if (firefly.y < 0.3) dirY += 0.8;
    if (firefly.y > 0.92) dirY -= 0.8;
    firefly.x += dirX * FIREFLY_WANDER_SPEED * dt;
    firefly.y += dirY * FIREFLY_WANDER_SPEED * dt;
  }

  firefly.x = clampCoord(firefly.x);
  firefly.y = clampCoord(firefly.y);
  if (deflect(state, firefly) && firefly.deflectCooldown <= 0) {
    firefly.deflectCooldown = DEFLECT_EVENT_COOLDOWN;
    state.stats.deflections += 1;
    pushEvent(state, "deflect", 0);
  }
}

function closeRound(state: FireflyState, cleared: boolean): void {
  endFireflyStroke(state);
  if (cleared) {
    const bonus = Math.max(0, Math.round(state.timeLeft)) * FIREFLY_CLEAR_SECONDS_SCORE;
    state.score += bonus;
    pushEvent(state, "round-clear", bonus);
  } else {
    let lost = 0;
    for (const firefly of state.fireflies) {
      if (firefly.mode !== "banked") {
        firefly.mode = "lost";
        lost += 1;
      }
    }
    state.stats.lost += lost;
    pushEvent(state, "round-timeout", lost);
  }
  state.phase = "clear";
  state.phaseTimer = FIREFLY_CLEAR_SECONDS;
}

/** Advances one fixed step; call only with `FIREFLY_STEP_SECONDS`. */
export function stepFirefly(state: FireflyState, dt: number): void {
  if (state.phase === "ready" || state.phase === "finished") return;
  state.time += dt;

  if (state.phase === "intro") {
    state.phaseTimer -= dt;
    if (state.phaseTimer <= 0) {
      state.phase = "playing";
      state.phaseTimer = 0;
    }
    return;
  }

  if (state.phase === "clear") {
    state.phaseTimer -= dt;
    if (state.phaseTimer <= 0) {
      if (state.round + 1 >= FIREFLY_ROUND_COUNT) {
        state.phase = "finished";
        pushEvent(state, "finished", state.score);
      } else {
        state.round += 1;
        layoutRound(state, state.round);
        state.phase = "intro";
        state.phaseTimer = FIREFLY_INTRO_SECONDS;
        pushEvent(state, "round-start", state.round + 1);
      }
    }
    return;
  }

  // Playing.
  state.timeLeft = Math.max(0, state.timeLeft - dt);
  state.ink = Math.min(FIREFLY_INK_MAX, state.ink + FIREFLY_INK_REGEN_PER_SECOND * dt);
  state.sinceBank += dt;
  if (state.sinceBank > FIREFLY_CONVOY_WINDOW_SECONDS && state.convoyChain > 0) {
    state.convoyChain = 0;
  }
  agePaths(state, dt);
  for (const firefly of state.fireflies) stepFireflyBody(state, firefly, dt);

  if (state.bankedThisRound >= state.fireflies.length && state.fireflies.length > 0) {
    closeRound(state, true);
    return;
  }
  if (state.timeLeft <= 0) {
    closeRound(state, false);
  }
}
