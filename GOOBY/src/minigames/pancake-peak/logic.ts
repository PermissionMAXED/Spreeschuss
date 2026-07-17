import type { MinigamePayout } from "../../core/contracts/minigame";
import type { RandomSource } from "../../core/contracts/rng";

export const PANCAKE_WORLD_WIDTH = 360;
export const PERFECT_TOLERANCE_PX = 4;
export const MAX_PANCAKE_WIDTH = 272;

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

export type PancakePeakEvent =
  | { readonly type: "place"; readonly layer: PancakeLayer; readonly points: number }
  | { readonly type: "perfect"; readonly combo: number; readonly x: number; readonly y: number }
  | { readonly type: "trim"; readonly width: number; readonly x: number; readonly y: number }
  | { readonly type: "butter"; readonly x: number; readonly y: number }
  | { readonly type: "collapsed" };

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
  readonly ended: boolean;
  readonly disposed: boolean;
}

export function pancakeDifficulty(stackCount: number): {
  readonly speed: number;
  readonly swingInset: number;
} {
  return {
    speed: Math.min(340, 112 + Math.max(0, stackCount) * 10),
    swingInset: Math.min(34, Math.max(0, stackCount) * 0.75),
  };
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
  private ended = false;
  private disposed = false;

  public constructor(private readonly rng: RandomSource) {}

  public update(deltaSeconds: number): void {
    if (this.ended || this.disposed || !Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return;
    const delta = Math.min(deltaSeconds, 0.25);
    this.elapsed += delta;
    const difficulty = pancakeDifficulty(this.stackCount);
    const halfWidth = this.moving.width / 2;
    const leftLimit = halfWidth + difficulty.swingInset;
    const rightLimit = PANCAKE_WORLD_WIDTH - halfWidth - difficulty.swingInset;
    let x = this.moving.x + this.moving.direction * difficulty.speed * delta;
    let direction = this.moving.direction;
    while (x < leftLimit || x > rightLimit) {
      if (x > rightLimit) {
        x = rightLimit - (x - rightLimit);
        direction = -1;
      } else if (x < leftLimit) {
        x = leftLimit + (leftLimit - x);
        direction = 1;
      }
    }
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
    const layer: PancakeLayer = {
      id: this.stackCount,
      x: placement.x,
      y: base.y + 24,
      width: placement.width,
      perfect: placement.perfect,
      butter,
    };
    const points = pancakeLayerScore(layer.width, layer.perfect, this.combo, butter);
    this.score += points;
    this.layers.push(layer);
    this.events.push({ type: "place", layer, points });
    if (placement.overhang > 0.5) {
      this.events.push({ type: "trim", width: placement.overhang, x: placement.trimX, y: layer.y });
    }
    if (placement.perfect) this.events.push({ type: "perfect", combo: this.combo, x: layer.x, y: layer.y });
    if (butter) this.events.push({ type: "butter", x: layer.x, y: layer.y + 20 });

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

  private endCollapsed(): void {
    this.ended = true;
    this.combo = 0;
    this.events.push({ type: "collapsed" });
  }

  public drainEvents(): readonly PancakePeakEvent[] {
    const events = this.events;
    this.events = [];
    return events;
  }

  public snapshot(): PancakePeakSnapshot {
    return {
      elapsed: this.elapsed,
      score: this.score,
      combo: this.combo,
      bestCombo: this.bestCombo,
      stackCount: this.stackCount,
      cameraBottom: this.cameraBottom,
      layers: this.layers,
      moving: this.moving,
      difficulty: pancakeDifficulty(this.stackCount),
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
