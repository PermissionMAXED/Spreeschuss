import type { MinigamePayout } from "../../core/contracts/minigame";
import type { RandomSource } from "../../core/contracts/rng";

export const CARROT_CATCH_DURATION_SECONDS = 75;
export const CARROT_CATCH_FIXED_STEP_SECONDS = 1 / 120;

/** Every 20 clean catches opens a golden frenzy that doubles positive points. */
export const GOLDEN_FRENZY_SECONDS = 4;
export const GOLDEN_FRENZY_MULTIPLIER = 2;

/** Catching an umbrella widens the basket for a few forgiving seconds. */
export const UMBRELLA_SECONDS = 6;
export const BASKET_HALF_WIDTH = 0.18;
export const UMBRELLA_BASKET_HALF_WIDTH = 0.27;
const UMBRELLA_CHANCE = 0.022;

/** Wind gusts only start blowing once the run reaches its higher level. */
export const WIND_START_SECONDS = 30;
export const WIND_GUST_PERIOD_SECONDS = 8;

export type CatchItemKind = "carrot" | "golden" | "rotten" | "umbrella";

export interface CatchItem {
  readonly id: number;
  readonly kind: CatchItemKind;
  readonly x: number;
  readonly y: number;
  readonly velocity: number;
  readonly spin: number;
}

export type CatchEvent =
  | { readonly type: "caught"; readonly kind: CatchItemKind; readonly x: number; readonly y: number; readonly points: number }
  | { readonly type: "missed"; readonly kind: CatchItemKind; readonly x: number }
  | { readonly type: "bonus-wave" }
  | { readonly type: "gust"; readonly direction: 1 | -1 }
  | { readonly type: "finished" };

export interface CarrotCatchSnapshot {
  readonly elapsed: number;
  readonly timeLeft: number;
  readonly score: number;
  readonly combo: number;
  readonly bestCombo: number;
  readonly catches: number;
  readonly basketX: number;
  readonly basketHalfWidth: number;
  readonly bonusWaveSeconds: number;
  readonly umbrellaSeconds: number;
  readonly windX: number;
  readonly difficulty: ReturnType<typeof carrotCatchDifficulty>;
  readonly items: readonly CatchItem[];
  readonly finished: boolean;
  readonly disposed: boolean;
}

/**
 * Deterministic wind schedule: calm until `WIND_START_SECONDS`, then gust
 * cycles that alternate direction each period and swell toward the finale.
 * A pure function of the fixed-step clock so every frame partition agrees.
 */
export function carrotCatchWind(elapsedSeconds: number): number {
  if (elapsedSeconds < WIND_START_SECONDS) return 0;
  const blowing = elapsedSeconds - WIND_START_SECONDS;
  const progress = Math.min(
    1,
    blowing / (CARROT_CATCH_DURATION_SECONDS - WIND_START_SECONDS),
  );
  const strength = 0.05 + progress * 0.09;
  const cycle = Math.floor(blowing / WIND_GUST_PERIOD_SECONDS);
  const phase = (blowing % WIND_GUST_PERIOD_SECONDS) / WIND_GUST_PERIOD_SECONDS;
  const direction = cycle % 2 === 0 ? 1 : -1;
  return direction * strength * Math.sin(phase * Math.PI);
}

/** Zero-based gust cycle index, or null while the air is still calm. */
export function windGustCycle(elapsedSeconds: number): number | null {
  if (elapsedSeconds < WIND_START_SECONDS) return null;
  return Math.floor((elapsedSeconds - WIND_START_SECONDS) / WIND_GUST_PERIOD_SECONDS);
}

export function carrotCatchDifficulty(elapsedSeconds: number): {
  readonly spawnInterval: number;
  readonly fallSpeed: number;
  readonly rottenChance: number;
} {
  const progress = Math.min(1, Math.max(0, elapsedSeconds / CARROT_CATCH_DURATION_SECONDS));
  return {
    spawnInterval: 0.78 - progress * 0.5,
    fallSpeed: 0.36 + progress * 0.34,
    rottenChance: 0.1 + progress * 0.1,
  };
}

export function scoreCaughtItem(kind: CatchItemKind, comboBefore: number): {
  readonly points: number;
  readonly nextCombo: number;
} {
  if (kind === "rotten") return { points: -30, nextCombo: 0 };
  if (kind === "umbrella") return { points: 25, nextCombo: comboBefore };
  const nextCombo = comboBefore + 1;
  const multiplier = Math.min(5, 1 + Math.floor(nextCombo / 5));
  return {
    points: (kind === "golden" ? 50 : 10) * multiplier,
    nextCombo,
  };
}

export function carrotCatchPayout(score: number, bestCombo: number): MinigamePayout {
  const safeScore = Math.max(0, Math.floor(score));
  return {
    score: safeScore,
    coins: Math.min(100, Math.floor(safeScore / 35) + Math.floor(bestCombo / 20) * 3),
    xp: Math.min(220, 12 + Math.floor(safeScore / 16) + Math.floor(bestCombo / 5)),
  };
}

export class CarrotCatchSimulation {
  private accumulator = 0;
  private ticks = 0;
  private elapsed = 0;
  private score = 0;
  private combo = 0;
  private bestCombo = 0;
  private catches = 0;
  private basketX = 0.5;
  private bonusWaveSeconds = 0;
  private umbrellaSeconds = 0;
  private lastGustCycle: number | null = null;
  private spawnIn = 0.15;
  private nextId = 1;
  private items: CatchItem[] = [];
  private events: CatchEvent[] = [];
  private finished = false;
  private disposed = false;

  private readonly rng: RandomSource;

  public constructor(rng: RandomSource) {
    this.rng = rng;
  }

  public moveBasket(normalizedX: number): void {
    if (this.disposed) return;
    this.basketX = Math.min(0.88, Math.max(0.12, normalizedX));
  }

  /** Relative nudge used by held keyboard input; clamps like `moveBasket`. */
  public moveBasketBy(deltaNormalized: number): void {
    if (this.disposed || !Number.isFinite(deltaNormalized)) return;
    this.moveBasket(this.basketX + deltaNormalized);
  }

  public update(deltaSeconds: number): void {
    if (this.finished || this.disposed || !Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return;
    this.accumulator += deltaSeconds;
    let steps = Math.floor((this.accumulator + 1e-10) / CARROT_CATCH_FIXED_STEP_SECONDS);
    this.accumulator = Math.max(
      0,
      this.accumulator - steps * CARROT_CATCH_FIXED_STEP_SECONDS,
    );
    while (steps > 0 && !this.finished) {
      this.step(CARROT_CATCH_FIXED_STEP_SECONDS);
      steps -= 1;
    }
  }

  private step(deltaSeconds: number): void {
    this.ticks += 1;
    this.elapsed = Math.min(
      CARROT_CATCH_DURATION_SECONDS,
      this.ticks * CARROT_CATCH_FIXED_STEP_SECONDS,
    );
    this.bonusWaveSeconds = Math.max(0, this.bonusWaveSeconds - deltaSeconds);
    this.umbrellaSeconds = Math.max(0, this.umbrellaSeconds - deltaSeconds);
    this.spawnIn -= deltaSeconds;

    const gustCycle = windGustCycle(this.elapsed);
    if (gustCycle !== null && gustCycle !== this.lastGustCycle) {
      this.lastGustCycle = gustCycle;
      this.events.push({ type: "gust", direction: gustCycle % 2 === 0 ? 1 : -1 });
    }

    if (this.spawnIn <= 0) {
      this.spawnItem();
      const difficulty = carrotCatchDifficulty(this.elapsed);
      this.spawnIn += this.bonusWaveSeconds > 0 ? Math.min(0.18, difficulty.spawnInterval * 0.48) : difficulty.spawnInterval;
    }

    const wind = carrotCatchWind(this.elapsed);
    const basketHalfWidth = this.basketHalfWidth();
    const nextItems: CatchItem[] = [];
    for (const item of this.items) {
      const nextY = item.y + item.velocity * deltaSeconds;
      const nextX = Math.min(0.96, Math.max(0.04, item.x + wind * deltaSeconds));
      const moved = {
        ...item,
        x: nextX,
        y: nextY,
        spin: item.spin + deltaSeconds * (item.kind === "golden" ? 250 : 150),
      };
      const inBasket = item.y < 0.88 && nextY >= 0.88 && Math.abs(item.x - this.basketX) <= basketHalfWidth;
      if (inBasket) {
        this.catchItem(moved);
      } else if (nextY > 1.08) {
        if (item.kind === "carrot" || item.kind === "golden") this.combo = 0;
        this.events.push({ type: "missed", kind: item.kind, x: item.x });
      } else {
        nextItems.push(moved);
      }
    }
    this.items = nextItems;

    if (this.elapsed >= CARROT_CATCH_DURATION_SECONDS) {
      this.finished = true;
      this.events.push({ type: "finished" });
    }
  }

  private basketHalfWidth(): number {
    return this.umbrellaSeconds > 0 ? UMBRELLA_BASKET_HALF_WIDTH : BASKET_HALF_WIDTH;
  }

  private spawnItem(): void {
    const difficulty = carrotCatchDifficulty(this.elapsed);
    const roll = this.rng.next();
    const kind: CatchItemKind = this.bonusWaveSeconds > 0 && roll < 0.34
      ? "golden"
      : roll < 0.07
        ? "golden"
        : roll < 0.07 + UMBRELLA_CHANCE
          ? "umbrella"
          : roll < 0.07 + UMBRELLA_CHANCE + difficulty.rottenChance
            ? "rotten"
            : "carrot";
    const velocityJitter = 0.88 + this.rng.next() * 0.24;
    this.items.push({
      id: this.nextId,
      kind,
      x: 0.08 + this.rng.next() * 0.84,
      y: -0.08,
      velocity: difficulty.fallSpeed * velocityJitter,
      spin: this.rng.next() * 360,
    });
    this.nextId += 1;
  }

  private catchItem(item: CatchItem): void {
    const result = scoreCaughtItem(item.kind, this.combo);
    const frenzied = this.bonusWaveSeconds > 0 && result.points > 0;
    const points = result.points * (frenzied ? GOLDEN_FRENZY_MULTIPLIER : 1);
    this.score = Math.max(0, this.score + points);
    this.combo = result.nextCombo;
    this.bestCombo = Math.max(this.bestCombo, this.combo);
    if (item.kind === "umbrella") this.umbrellaSeconds = UMBRELLA_SECONDS;
    if (item.kind === "carrot" || item.kind === "golden") {
      this.catches += 1;
      if (this.catches % 20 === 0) {
        this.bonusWaveSeconds = GOLDEN_FRENZY_SECONDS;
        this.events.push({ type: "bonus-wave" });
      }
    }
    this.events.push({ type: "caught", kind: item.kind, x: item.x, y: item.y, points });
  }

  public drainEvents(): readonly CatchEvent[] {
    const events = this.events;
    this.events = [];
    if (!events.some((event) => event.type === "finished")) return events;
    return [
      ...events.filter((event) => event.type !== "finished"),
      { type: "finished" } as const,
    ];
  }

  public snapshot(): CarrotCatchSnapshot {
    return {
      elapsed: this.elapsed,
      timeLeft: Math.max(0, CARROT_CATCH_DURATION_SECONDS - this.elapsed),
      score: this.score,
      combo: this.combo,
      bestCombo: this.bestCombo,
      catches: this.catches,
      basketX: this.basketX,
      basketHalfWidth: this.basketHalfWidth(),
      bonusWaveSeconds: this.bonusWaveSeconds,
      umbrellaSeconds: this.umbrellaSeconds,
      windX: carrotCatchWind(this.elapsed),
      difficulty: carrotCatchDifficulty(this.elapsed),
      items: this.items,
      finished: this.finished,
      disposed: this.disposed,
    };
  }

  public dispose(): void {
    this.accumulator = 0;
    this.ticks = 0;
    this.items = [];
    this.events = [];
    this.finished = true;
    this.disposed = true;
  }
}
