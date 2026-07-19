import type { MinigamePayout } from "../../core/contracts/minigame";
import type { RandomSource } from "../../core/contracts/rng";

export const HONEY_GRID_WIDTH = 64;
export const HONEY_GRID_HEIGHT = 44;
export const HONEY_TOAST_COUNT = 3;
export const HONEY_REQUIRED_COVERAGE = 0.72;
export const HONEY_GAP_RADIUS = 0.075;

export interface HoneyPoint {
  readonly x: number;
  readonly y: number;
}

export interface DrizzleResult {
  readonly speed: number;
  readonly covered: number;
  readonly spill: number;
  readonly flood: number;
}

export interface ToastResult {
  readonly coverage: number;
  readonly spillRatio: number;
  readonly floodRatio: number;
  readonly elapsed: number;
  readonly score: number;
}

export interface HoneySnapshot {
  readonly toastIndex: number;
  readonly coverage: number;
  readonly spillRatio: number;
  readonly floodRatio: number;
  readonly elapsed: number;
  readonly gap: HoneyPoint;
  readonly beeWarning: boolean;
  readonly score: number;
  readonly finished: boolean;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function corridorCenter(toastIndex: number, x: number): number {
  if (toastIndex === 0) return 0.5 + Math.sin(x * Math.PI * 2) * 0.13;
  if (toastIndex === 1) {
    const tooth = Math.abs(((x * 3.5) % 2) - 1);
    return 0.34 + tooth * 0.3;
  }
  return 0.5 + Math.sin(x * Math.PI * 4 + 0.6) * 0.11 + Math.sin(x * Math.PI * 2) * 0.08;
}

export function createToastCorridor(toastIndex: number): Uint8Array {
  const corridor = new Uint8Array(HONEY_GRID_WIDTH * HONEY_GRID_HEIGHT);
  const halfWidth = toastIndex === 2 ? 0.075 : 0.085;
  for (let row = 0; row < HONEY_GRID_HEIGHT; row += 1) {
    for (let column = 0; column < HONEY_GRID_WIDTH; column += 1) {
      const x = (column + 0.5) / HONEY_GRID_WIDTH;
      const y = (row + 0.5) / HONEY_GRID_HEIGHT;
      if (x >= 0.07 && x <= 0.93 && Math.abs(y - corridorCenter(toastIndex, x)) <= halfWidth) {
        corridor[row * HONEY_GRID_WIDTH + column] = 1;
      }
    }
  }
  return corridor;
}

export function honeyCoverage(corridor: ArrayLike<number>, deposits: ArrayLike<number>): number {
  if (corridor.length !== deposits.length || corridor.length === 0) {
    throw new RangeError("Honey coverage grids must be non-empty and equal");
  }
  let target = 0;
  let covered = 0;
  for (let index = 0; index < corridor.length; index += 1) {
    if ((corridor[index] ?? 0) <= 0) continue;
    target += 1;
    if ((deposits[index] ?? 0) >= 0.34) covered += 1;
  }
  return target === 0 ? 1 : covered / target;
}

export function honeyFloodRatio(corridor: ArrayLike<number>, deposits: ArrayLike<number>): number {
  if (corridor.length !== deposits.length || corridor.length === 0) {
    throw new RangeError("Honey flood grids must be non-empty and equal");
  }
  let target = 0;
  let flood = 0;
  for (let index = 0; index < corridor.length; index += 1) {
    if ((corridor[index] ?? 0) <= 0) continue;
    target += 1;
    flood += Math.max(0, (deposits[index] ?? 0) - 1);
  }
  return target === 0 ? 0 : flood / target;
}

function targetCells(corridor: ArrayLike<number>): number {
  let count = 0;
  for (let index = 0; index < corridor.length; index += 1) {
    if ((corridor[index] ?? 0) > 0) count += 1;
  }
  return count;
}

export class HoneyDrizzleRound {
  readonly order: readonly number[];
  readonly results: ToastResult[] = [];
  corridor: Uint8Array;
  deposits: Float32Array;

  private index = 0;
  private toastElapsed = 0;
  private totalSpill = 0;
  private totalScore = 0;
  private gapSeed: number;
  private ended = false;

  constructor(rng: RandomSource) {
    const offset = rng.int(0, HONEY_TOAST_COUNT);
    this.order = Array.from({ length: HONEY_TOAST_COUNT }, (_, index) => (index + offset) % HONEY_TOAST_COUNT);
    this.gapSeed = rng.next() * Math.PI * 2;
    this.corridor = createToastCorridor(this.order[0] ?? 0);
    this.deposits = new Float32Array(this.corridor.length);
  }

  get toastIndex(): number {
    return this.index;
  }

  get coverage(): number {
    return honeyCoverage(this.corridor, this.deposits);
  }

  get spillRatio(): number {
    return this.totalSpill / Math.max(1, targetCells(this.corridor));
  }

  get floodRatio(): number {
    return honeyFloodRatio(this.corridor, this.deposits);
  }

  get elapsed(): number {
    return this.toastElapsed;
  }

  get score(): number {
    return this.totalScore;
  }

  get finished(): boolean {
    return this.ended;
  }

  get gap(): HoneyPoint {
    const phase = this.toastElapsed * 0.72 + this.gapSeed + this.index * 0.9;
    const x = 0.18 + (Math.sin(phase) * 0.5 + 0.5) * 0.64;
    return { x, y: corridorCenter(this.order[this.index] ?? 0, x) };
  }

  get beeWarning(): boolean {
    const phase = this.toastElapsed * 0.72 + this.gapSeed + this.index * 0.9;
    return Math.cos(phase) > 0.65;
  }

  update(deltaSeconds: number): void {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) {
      throw new RangeError("Honey Drizzle delta must be finite and non-negative");
    }
    if (!this.ended) this.toastElapsed += deltaSeconds;
  }

  drizzle(from: HoneyPoint, to: HoneyPoint, durationSeconds: number): DrizzleResult {
    if (this.ended) return { speed: 0, covered: 0, spill: 0, flood: 0 };
    const duration = clamp(
      Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : 1 / 60,
      1 / 120,
      1.5,
    );
    const distance = Math.hypot(to.x - from.x, to.y - from.y);
    const speed = distance / duration;
    const sampleDensity = speed > 1.8 ? 20 : speed > 1.1 ? 42 : 72;
    const sampleCount = Math.max(1, Math.ceil(distance * sampleDensity));
    const dwell = distance < 0.008;
    const deposit = dwell
      ? 0.24 + duration * 5.2
      : clamp(0.55 / Math.max(0.28, speed), 0.12, 1.15);
    const gap = this.gap;
    let covered = 0;
    let spill = 0;
    let flood = 0;
    const touched = new Set<number>();

    for (let sample = 0; sample <= sampleCount; sample += 1) {
      const progress = sampleCount === 0 ? 0 : sample / sampleCount;
      const x = clamp(from.x + (to.x - from.x) * progress, 0, 1);
      const y = clamp(from.y + (to.y - from.y) * progress, 0, 1);
      const centerX = Math.floor(x * HONEY_GRID_WIDTH);
      const centerY = Math.floor(y * HONEY_GRID_HEIGHT);
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const column = centerX + dx;
          const row = centerY + dy;
          if (column < 0 || row < 0 || column >= HONEY_GRID_WIDTH || row >= HONEY_GRID_HEIGHT) continue;
          const index = row * HONEY_GRID_WIDTH + column;
          if (touched.has(index)) continue;
          touched.add(index);
          const cellX = (column + 0.5) / HONEY_GRID_WIDTH;
          const cellY = (row + 0.5) / HONEY_GRID_HEIGHT;
          const inMovingGap = Math.hypot(cellX - gap.x, cellY - gap.y) <= HONEY_GAP_RADIUS;
          if ((this.corridor[index] ?? 0) === 0 || inMovingGap) {
            spill += deposit * (inMovingGap ? 1.3 : 1);
            continue;
          }
          const before = this.deposits[index] ?? 0;
          const after = before + deposit;
          this.deposits[index] = after;
          if (before < 0.34 && after >= 0.34) covered += 1;
          flood += Math.max(0, after - 1) - Math.max(0, before - 1);
        }
      }
    }
    this.totalSpill += spill;
    return { speed, covered, spill, flood };
  }

  finishToast(): ToastResult | null {
    if (this.ended || this.coverage < HONEY_REQUIRED_COVERAGE) return null;
    const coverage = this.coverage;
    const spillRatio = this.spillRatio;
    const floodRatio = this.floodRatio;
    const pace = clamp(1 - Math.max(0, this.toastElapsed - 18) / 30, 0, 1);
    // Reaching the serve threshold always earns a small breakfast reward;
    // evenness, pace, and tidy edges determine everything above that floor.
    const score = Math.max(
      60,
      Math.round(coverage * 520 + pace * 180 - spillRatio * 240 - floodRatio * 280),
    );
    const result = { coverage, spillRatio, floodRatio, elapsed: this.toastElapsed, score };
    this.results.push(result);
    this.totalScore += score;
    this.index += 1;
    if (this.index >= HONEY_TOAST_COUNT) {
      this.ended = true;
      return result;
    }
    this.toastElapsed = 0;
    this.totalSpill = 0;
    this.gapSeed += 1.7;
    this.corridor = createToastCorridor(this.order[this.index] ?? 0);
    this.deposits = new Float32Array(this.corridor.length);
    return result;
  }

  payout(): MinigamePayout {
    const score = Math.max(0, Math.floor(this.totalScore));
    if (score === 0) return { score: 0, coins: 0, xp: 0 };
    const cozy = this.results.reduce(
      (sum, result) => sum + Math.max(0, result.coverage - result.spillRatio - result.floodRatio),
      0,
    );
    return {
      score,
      coins: Math.min(52, Math.floor(score / 75) + this.results.length),
      xp: Math.min(115, Math.floor(score / 40) + Math.round(cozy * 8)),
    };
  }

  snapshot(): HoneySnapshot {
    return {
      toastIndex: this.index,
      coverage: this.coverage,
      spillRatio: this.spillRatio,
      floodRatio: this.floodRatio,
      elapsed: this.toastElapsed,
      gap: this.gap,
      beeWarning: this.beeWarning,
      score: this.totalScore,
      finished: this.ended,
    };
  }
}
