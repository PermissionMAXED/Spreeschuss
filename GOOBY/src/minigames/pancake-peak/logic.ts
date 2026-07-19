import type { MinigamePayout } from "../../core/contracts/minigame";
import type { RandomSource } from "../../core/contracts/rng";

export const PANCAKE_WORLD_WIDTH = 360;
export const PERFECT_TOLERANCE_PX = 4;
export const MAX_PANCAKE_WIDTH = 272;
export const PANCAKE_MAX_STEP_SECONDS = 0.25;

/** A syrup window opens at the end of every period; drops inside it pay extra. */
export const SYRUP_PERIOD_SECONDS = 6;
export const SYRUP_WINDOW_SECONDS = 0.9;
export const SYRUP_BONUS = 40;

/** Endless tall-tower tier: unlocked by a persisted best of 300 or more. */
export const TALL_TOWER_BEST_GATE = 300;
export const TALL_TOWER_STACK = 25;
export const TALL_TOWER_LAYER_BONUS = 15;
export const TALL_TOWER_SPEED_CAP = 430;

/** Center-of-mass wobble rendering and tipping fail-safe. */
export const WOBBLE_FREQUENCY = 2.4;
export const WOBBLE_MAX_PX = 12;

export interface PancakeLayer {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly perfect: boolean;
  readonly butter: boolean;
}

export interface PlacementResult {
  readonly width: number;
  readonly x: number;
  readonly overhang: number;
  readonly trimX: number;
  readonly perfect: boolean;
  readonly failed: boolean;
}

export type PancakeCollapseReason = "support" | "tipped";

export type PancakePeakEvent =
  | { readonly type: "place"; readonly layer: PancakeLayer; readonly points: number }
  | { readonly type: "perfect"; readonly combo: number; readonly x: number; readonly y: number }
  | { readonly type: "trim"; readonly width: number; readonly x: number; readonly y: number }
  | { readonly type: "butter"; readonly x: number; readonly y: number }
  | { readonly type: "syrup"; readonly x: number; readonly y: number; readonly bonus: number }
  | { readonly type: "collapsed"; readonly reason?: PancakeCollapseReason };

export interface PancakePeakSnapshot {
  readonly elapsed: number;
  readonly score: number;
  readonly combo: number;
  readonly bestCombo: number;
  readonly stackCount: number;
  readonly cameraBottom: number;
  readonly layers: readonly PancakeLayer[];
  readonly moving: { readonly x: number; readonly y: number; readonly width: number; readonly direction: number };
  readonly difficulty: ReturnType<typeof pancakeDifficulty>;
  readonly syrupWindow: boolean;
  readonly syrupIn: number;
  readonly comOffset: number;
  readonly wobblePx: number;
  readonly endlessTier: boolean;
  readonly tallTower: boolean;
  readonly ended: boolean;
  readonly disposed: boolean;
}

export function pancakeDifficulty(stackCount: number, tallTower = false): {
  readonly speed: number;
  readonly swingInset: number;
} {
  return {
    speed: Math.min(tallTower ? TALL_TOWER_SPEED_CAP : 340, 112 + Math.max(0, stackCount) * 10),
    swingInset: Math.min(34, Math.max(0, stackCount) * 0.75),
  };
}

/** Fixed-clock syrup schedule: pure so every frame partition agrees. */
export function isSyrupWindow(elapsedSeconds: number): boolean {
  if (!Number.isFinite(elapsedSeconds) || elapsedSeconds < 0) return false;
  return elapsedSeconds % SYRUP_PERIOD_SECONDS >= SYRUP_PERIOD_SECONDS - SYRUP_WINDOW_SECONDS;
}

/** Seconds until the next syrup window opens (zero while it is open). */
export function secondsUntilSyrup(elapsedSeconds: number): number {
  if (isSyrupWindow(elapsedSeconds)) return 0;
  const phase = elapsedSeconds % SYRUP_PERIOD_SECONDS;
  return SYRUP_PERIOD_SECONDS - SYRUP_WINDOW_SECONDS - phase;
}

/** Width-weighted center of mass of the whole stack. */
export function stackCenterOfMassX(layers: readonly PancakeLayer[]): number {
  let weighted = 0;
  let total = 0;
  for (const layer of layers) {
    weighted += layer.x * layer.width;
    total += layer.width;
  }
  return total > 0 ? weighted / total : PANCAKE_WORLD_WIDTH / 2;
}

/** Signed center-of-mass offset from the supporting bottom layer. */
export function centerOfMassOffset(layers: readonly PancakeLayer[]): number {
  const base = layers[0];
  if (!base) return 0;
  return stackCenterOfMassX(layers) - base.x;
}

/** The tower tips over once its center of mass leaves the base footprint. */
export function isTipped(layers: readonly PancakeLayer[]): boolean {
  const base = layers[0];
  if (!base || base.width <= 0) return false;
  return Math.abs(centerOfMassOffset(layers)) > base.width / 2;
}

/**
 * Deterministic cosmetic sway: amplitude grows with the center-of-mass
 * offset and the phase is a pure function of the simulation clock.
 */
export function wobbleOffsetPx(elapsedSeconds: number, comOffset: number): number {
  if (comOffset === 0) return 0;
  const amplitude = Math.min(WOBBLE_MAX_PX, Math.abs(comOffset) * 0.35);
  const lean = Math.sign(comOffset) * amplitude * 0.4;
  return lean + amplitude * Math.sin(elapsedSeconds * WOBBLE_FREQUENCY);
}

export function calculatePlacement(
  baseX: number,
  baseWidth: number,
  fallingX: number,
  fallingWidth: number,
): PlacementResult {
  const offset = Math.abs(fallingX - baseX);
  const perfect = offset <= PERFECT_TOLERANCE_PX;
  if (perfect) {
    return {
      width: Math.min(MAX_PANCAKE_WIDTH, Math.max(baseWidth, fallingWidth) + 6),
      x: baseX,
      overhang: 0,
      trimX: baseX,
      perfect: true,
      failed: false,
    };
  }
  const left = Math.max(baseX - baseWidth / 2, fallingX - fallingWidth / 2);
  const right = Math.min(baseX + baseWidth / 2, fallingX + fallingWidth / 2);
  const width = Math.max(0, right - left);
  const fallingLeft = fallingX - fallingWidth / 2;
  const fallingRight = fallingX + fallingWidth / 2;
  const trimLeft = fallingLeft < left;
  return {
    width,
    x: width > 0 ? (left + right) / 2 : fallingX,
    overhang: Math.max(0, fallingWidth - width),
    trimX: trimLeft ? (fallingLeft + left) / 2 : (right + fallingRight) / 2,
    perfect: false,
    failed: width <= 0,
  };
}

export function pancakeLayerScore(width: number, perfect: boolean, combo: number, butter: boolean): number {
  const placement = perfect ? 130 + combo * 30 : 35 + Math.floor(width * 0.45);
  return placement + (butter ? 300 : 0);
}

export function isButterLayer(stackCount: number): boolean {
  return stackCount > 0 && stackCount % 10 === 0;
}

export function pancakePeakPayout(score: number, stackCount: number, bestCombo: number): MinigamePayout {
  const safeScore = Math.max(0, Math.floor(score));
  return {
    score: safeScore,
    coins: Math.min(130, Math.floor(safeScore / 110) + Math.floor(stackCount / 10) * 3),
    xp: Math.min(260, 10 + stackCount * 3 + Math.floor(bestCombo * 1.5)),
  };
}

export class PancakePeakSimulation {
  private elapsed = 0;
  private score = 0;
  private combo = 0;
  private bestCombo = 0;
  private stackCount = 0;
  private cameraBottom = 0;
  private layers: PancakeLayer[] = [{
    id: 0,
    x: PANCAKE_WORLD_WIDTH / 2,
    y: 56,
    width: 250,
    perfect: false,
    butter: false,
  }];
  private moving = {
    x: PANCAKE_WORLD_WIDTH / 2,
    y: 184,
    width: 250,
    direction: 1,
  };
  private events: PancakePeakEvent[] = [];
  private readonly endlessTier: boolean;
  private ended = false;
  private disposed = false;

  private readonly rng: RandomSource;

  public constructor(rng: RandomSource, options?: { readonly endlessTier?: boolean }) {
    this.rng = rng;
    this.endlessTier = options?.endlessTier === true;
  }

  public update(deltaSeconds: number): void {
    if (this.ended || this.disposed || !Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return;
    let remaining = deltaSeconds;
    while (remaining > 0) {
      const step = Math.min(PANCAKE_MAX_STEP_SECONDS, remaining);
      this.advanceSwing(step);
      this.elapsed += step;
      remaining -= step;
    }
  }

  private tallTowerActive(): boolean {
    return this.endlessTier && this.stackCount >= TALL_TOWER_STACK;
  }

  private advanceSwing(deltaSeconds: number): void {
    const difficulty = pancakeDifficulty(this.stackCount, this.tallTowerActive());
    const halfWidth = this.moving.width / 2;
    const leftLimit = halfWidth + difficulty.swingInset;
    const rightLimit = PANCAKE_WORLD_WIDTH - halfWidth - difficulty.swingInset;
    const span = rightLimit - leftLimit;
    if (span <= 0) return;
    const cycle = span * 2;
    const offset = this.moving.x - leftLimit;
    const phase = this.moving.direction > 0 ? offset : cycle - offset;
    const nextPhase = ((phase + difficulty.speed * deltaSeconds) % cycle + cycle) % cycle;
    const movingRight = nextPhase < span;
    const x = movingRight
      ? leftLimit + nextPhase
      : rightLimit - (nextPhase - span);
    const direction = movingRight ? 1 : -1;
    this.moving = { ...this.moving, x, direction };
  }

  public drop(): void {
    if (this.ended || this.disposed) return;
    const base = this.layers.at(-1);
    if (!base) {
      this.endCollapsed();
      return;
    }
    const placement = calculatePlacement(base.x, base.width, this.moving.x, this.moving.width);
    if (placement.failed) {
      this.endCollapsed();
      return;
    }
    this.stackCount += 1;
    this.combo = placement.perfect ? this.combo + 1 : 0;
    this.bestCombo = Math.max(this.bestCombo, this.combo);
    const butter = isButterLayer(this.stackCount);
    const syrup = isSyrupWindow(this.elapsed);
    const layer: PancakeLayer = {
      id: this.stackCount,
      x: placement.x,
      y: base.y + 24,
      width: placement.width,
      perfect: placement.perfect,
      butter,
    };
    const points = pancakeLayerScore(layer.width, layer.perfect, this.combo, butter)
      + (syrup ? SYRUP_BONUS : 0)
      + (this.tallTowerActive() ? TALL_TOWER_LAYER_BONUS : 0);
    this.score += points;
    this.layers.push(layer);
    this.events.push({ type: "place", layer, points });
    if (placement.overhang > 0.5) {
      this.events.push({ type: "trim", width: placement.overhang, x: placement.trimX, y: layer.y });
    }
    if (placement.perfect) this.events.push({ type: "perfect", combo: this.combo, x: layer.x, y: layer.y });
    if (butter) this.events.push({ type: "butter", x: layer.x, y: layer.y + 20 });
    if (syrup) this.events.push({ type: "syrup", x: layer.x, y: layer.y + 14, bonus: SYRUP_BONUS });
    if (isTipped(this.layers)) {
      this.endCollapsed("tipped");
      return;
    }

    this.cameraBottom = Math.max(0, layer.y - 390);
    const startLeft = this.rng.next() < 0.5;
    const halfWidth = layer.width / 2;
    const nextX = startLeft ? halfWidth : PANCAKE_WORLD_WIDTH - halfWidth;
    this.moving = {
      x: nextX,
      y: layer.y + 128,
      width: layer.width,
      direction: startLeft ? 1 : -1,
    };
  }

  private endCollapsed(reason: PancakeCollapseReason = "support"): void {
    this.ended = true;
    this.combo = 0;
    this.events.push({ type: "collapsed", reason });
  }

  public drainEvents(): readonly PancakePeakEvent[] {
    const events = this.events;
    this.events = [];
    return events;
  }

  public snapshot(): PancakePeakSnapshot {
    const comOffset = centerOfMassOffset(this.layers);
    return {
      elapsed: this.elapsed,
      score: this.score,
      combo: this.combo,
      bestCombo: this.bestCombo,
      stackCount: this.stackCount,
      cameraBottom: this.cameraBottom,
      layers: this.layers,
      moving: this.moving,
      difficulty: pancakeDifficulty(this.stackCount, this.tallTowerActive()),
      syrupWindow: isSyrupWindow(this.elapsed),
      syrupIn: secondsUntilSyrup(this.elapsed),
      comOffset,
      wobblePx: wobbleOffsetPx(this.elapsed, comOffset),
      endlessTier: this.endlessTier,
      tallTower: this.tallTowerActive(),
      ended: this.ended,
      disposed: this.disposed,
    };
  }

  public dispose(): void {
    this.layers = [];
    this.events = [];
    this.ended = true;
    this.disposed = true;
  }
}
