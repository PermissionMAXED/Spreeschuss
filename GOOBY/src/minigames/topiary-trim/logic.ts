import type { MinigamePayout } from "../../core/contracts/minigame";
import type { RandomSource } from "../../core/contracts/rng";

export const TOPIARY_RASTER_SIZE = 64;
export const TOPIARY_REQUIRED_IOU = 0.78;
export const TOPIARY_PREVIEW_SECONDS = 2.25;
export const TOPIARY_BLOWER_USES = 2;
export const TOPIARY_SHAPES = ["moon-bunny", "garden-snail", "tea-bird"] as const;

export type TopiaryShape = (typeof TOPIARY_SHAPES)[number];

export interface RasterPoint {
  readonly x: number;
  readonly y: number;
}

export interface TrimResult {
  readonly removed: number;
  readonly targetDamage: number;
  readonly iou: number;
}

export interface BushResult {
  readonly shape: TopiaryShape;
  readonly iou: number;
  readonly targetDamage: number;
  readonly score: number;
}

export interface TopiaryState {
  readonly bushIndex: number;
  readonly shape: TopiaryShape;
  readonly iou: number;
  readonly previewsLeft: number;
  readonly previewRemaining: number;
  readonly score: number;
  readonly finished: boolean;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function ellipse(x: number, y: number, cx: number, cy: number, rx: number, ry: number): boolean {
  const dx = (x - cx) / rx;
  const dy = (y - cy) / ry;
  return dx * dx + dy * dy <= 1;
}

function distanceToSegment(point: RasterPoint, from: RasterPoint, to: RasterPoint): number {
  const vx = to.x - from.x;
  const vy = to.y - from.y;
  const lengthSquared = vx * vx + vy * vy;
  if (lengthSquared <= 1e-9) return Math.hypot(point.x - from.x, point.y - from.y);
  const projection = clamp(
    ((point.x - from.x) * vx + (point.y - from.y) * vy) / lengthSquared,
    0,
    1,
  );
  return Math.hypot(point.x - (from.x + vx * projection), point.y - (from.y + vy * projection));
}

function insideShape(shape: TopiaryShape, x: number, y: number): boolean {
  if (shape === "moon-bunny") {
    const body = ellipse(x, y, 0.5, 0.59, 0.27, 0.28);
    const head = ellipse(x, y, 0.64, 0.36, 0.18, 0.17);
    const tail = ellipse(x, y, 0.23, 0.51, 0.1, 0.1);
    const earA = ellipse(x, y, 0.58, 0.16, 0.065, 0.19);
    const earB = ellipse(x, y, 0.72, 0.17, 0.06, 0.18);
    const foot = ellipse(x, y, 0.65, 0.82, 0.2, 0.075);
    return body || head || tail || earA || earB || foot;
  }
  if (shape === "garden-snail") {
    const shell = ellipse(x, y, 0.42, 0.5, 0.25, 0.25);
    const body = ellipse(x, y, 0.55, 0.7, 0.37, 0.105);
    const head = ellipse(x, y, 0.76, 0.57, 0.13, 0.16);
    const feelerA = distanceToSegment({ x, y }, { x: 0.75, y: 0.47 }, { x: 0.69, y: 0.25 }) < 0.026;
    const feelerB = distanceToSegment({ x, y }, { x: 0.82, y: 0.47 }, { x: 0.87, y: 0.26 }) < 0.026;
    return shell || body || head || feelerA || feelerB;
  }
  const body = ellipse(x, y, 0.49, 0.53, 0.25, 0.2);
  const head = ellipse(x, y, 0.69, 0.37, 0.13, 0.13);
  const wing = ellipse(x, y, 0.43, 0.5, 0.16, 0.11);
  const tailA = distanceToSegment({ x, y }, { x: 0.29, y: 0.55 }, { x: 0.13, y: 0.39 }) < 0.07;
  const tailB = distanceToSegment({ x, y }, { x: 0.29, y: 0.59 }, { x: 0.1, y: 0.63 }) < 0.065;
  const beak = x > 0.78 && x < 0.94 && Math.abs(y - 0.38) < (0.94 - x) * 0.35;
  const leg = x > 0.47 && x < 0.53 && y > 0.68 && y < 0.86;
  return body || head || wing || tailA || tailB || beak || leg;
}

export function rasterizeTopiary(
  shape: TopiaryShape,
  size = TOPIARY_RASTER_SIZE,
): Uint8Array {
  if (!Number.isInteger(size) || size < 8) throw new RangeError("Topiary raster size must be an integer of at least 8");
  const mask = new Uint8Array(size * size);
  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column < size; column += 1) {
      const x = (column + 0.5) / size;
      const y = (row + 0.5) / size;
      if (insideShape(shape, x, y)) mask[row * size + column] = 1;
    }
  }
  return mask;
}

export function rasterIoU(first: ArrayLike<number>, second: ArrayLike<number>): number {
  if (first.length !== second.length || first.length === 0) {
    throw new RangeError("IoU masks must be non-empty and equal in size");
  }
  let intersection = 0;
  let union = 0;
  for (let index = 0; index < first.length; index += 1) {
    const a = (first[index] ?? 0) > 0;
    const b = (second[index] ?? 0) > 0;
    if (a && b) intersection += 1;
    if (a || b) union += 1;
  }
  return union === 0 ? 1 : intersection / union;
}

export function createOvergrownMask(
  target: Uint8Array,
  size = TOPIARY_RASTER_SIZE,
): Uint8Array {
  if (target.length !== size * size) throw new RangeError("Target mask does not match raster size");
  const canopy = new Uint8Array(target);
  const radius = 5;
  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column < size; column += 1) {
      if ((target[row * size + column] ?? 0) === 0) continue;
      for (let dy = -radius; dy <= radius; dy += 1) {
        for (let dx = -radius; dx <= radius; dx += 1) {
          if (dx * dx + dy * dy > radius * radius) continue;
          const nextX = column + dx;
          const nextY = row + dy;
          if (nextX >= 0 && nextY >= 0 && nextX < size && nextY < size) {
            canopy[nextY * size + nextX] = 1;
          }
        }
      }
    }
  }
  return canopy;
}

export function trimRasterSegment(
  current: Uint8Array,
  target: Uint8Array,
  from: RasterPoint,
  to: RasterPoint,
  radius = 0.025,
  size = TOPIARY_RASTER_SIZE,
): TrimResult {
  if (current.length !== target.length || current.length !== size * size) {
    throw new RangeError("Trim masks must match the raster size");
  }
  let removed = 0;
  let targetDamage = 0;
  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column < size; column += 1) {
      const index = row * size + column;
      if ((current[index] ?? 0) === 0) continue;
      const point = { x: (column + 0.5) / size, y: (row + 0.5) / size };
      if (distanceToSegment(point, from, to) <= radius) {
        current[index] = 0;
        removed += 1;
        if ((target[index] ?? 0) > 0) targetDamage += 1;
      }
    }
  }
  return { removed, targetDamage, iou: rasterIoU(current, target) };
}

export class TopiaryRound {
  readonly order: readonly TopiaryShape[];
  readonly results: BushResult[] = [];
  target: Uint8Array;
  current: Uint8Array;

  private index = 0;
  private previewSeconds = 0;
  private blowerUses = TOPIARY_BLOWER_USES;
  private totalScore = 0;
  private ended = false;

  constructor(rng: RandomSource) {
    const offset = rng.int(0, TOPIARY_SHAPES.length);
    this.order = TOPIARY_SHAPES.map(
      (_, index) => TOPIARY_SHAPES[(index + offset) % TOPIARY_SHAPES.length] as TopiaryShape,
    );
    this.target = rasterizeTopiary(this.order[0] as TopiaryShape);
    this.current = createOvergrownMask(this.target);
  }

  get bushIndex(): number {
    return this.index;
  }

  get shape(): TopiaryShape {
    return this.order[this.index] ?? this.order[this.order.length - 1] as TopiaryShape;
  }

  get iou(): number {
    return rasterIoU(this.current, this.target);
  }

  get previewsLeft(): number {
    return this.blowerUses;
  }

  get previewRemaining(): number {
    return this.previewSeconds;
  }

  get score(): number {
    return this.totalScore;
  }

  get finished(): boolean {
    return this.ended;
  }

  update(deltaSeconds: number): void {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) {
      throw new RangeError("Topiary delta must be finite and non-negative");
    }
    this.previewSeconds = Math.max(0, this.previewSeconds - deltaSeconds);
  }

  useLeafBlower(): boolean {
    if (this.ended || this.blowerUses <= 0 || this.previewSeconds > 0) return false;
    this.blowerUses -= 1;
    this.previewSeconds = TOPIARY_PREVIEW_SECONDS;
    return true;
  }

  trim(from: RasterPoint, to: RasterPoint, radius = 0.025): TrimResult {
    if (this.ended) return { removed: 0, targetDamage: 0, iou: this.iou };
    return trimRasterSegment(this.current, this.target, from, to, radius);
  }

  finishBush(): BushResult | null {
    if (this.ended || this.iou < TOPIARY_REQUIRED_IOU) return null;
    const iou = this.iou;
    const targetCells = this.target.reduce((sum, cell) => sum + cell, 0);
    let remainingTarget = 0;
    for (let index = 0; index < this.target.length; index += 1) {
      if ((this.target[index] ?? 0) > 0 && (this.current[index] ?? 0) > 0) remainingTarget += 1;
    }
    const damage = Math.max(0, targetCells - remainingTarget);
    const preservation = targetCells === 0 ? 1 : remainingTarget / targetCells;
    const score = Math.round(300 * iou + 200 * preservation + Math.max(0, 100 - damage));
    const result = { shape: this.shape, iou, targetDamage: damage, score };
    this.results.push(result);
    this.totalScore += score;
    this.index += 1;
    this.previewSeconds = 0;
    if (this.index >= this.order.length) {
      this.ended = true;
      return result;
    }
    this.target = rasterizeTopiary(this.shape);
    this.current = createOvergrownMask(this.target);
    return result;
  }

  payout(): MinigamePayout {
    const score = Math.max(0, Math.floor(this.totalScore));
    if (score === 0) return { score: 0, coins: 0, xp: 0 };
    const averageIoU = this.results.length === 0
      ? 0
      : this.results.reduce((sum, result) => sum + result.iou, 0) / this.results.length;
    return {
      score,
      coins: Math.min(50, Math.floor(score / 80) + this.results.length * 2),
      xp: Math.min(110, Math.floor(score / 42) + Math.round(averageIoU * 15)),
    };
  }

  snapshot(): TopiaryState {
    return {
      bushIndex: this.index,
      shape: this.shape,
      iou: this.iou,
      previewsLeft: this.blowerUses,
      previewRemaining: this.previewSeconds,
      score: this.totalScore,
      finished: this.ended,
    };
  }
}
