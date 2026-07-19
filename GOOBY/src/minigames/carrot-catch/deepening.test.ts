import { describe, expect, it } from "vitest";
import type { RandomSource } from "../../core/contracts/rng";
import {
  BASKET_HALF_WIDTH,
  CARROT_CATCH_DURATION_SECONDS,
  CarrotCatchSimulation,
  GOLDEN_FRENZY_MULTIPLIER,
  UMBRELLA_BASKET_HALF_WIDTH,
  UMBRELLA_SECONDS,
  WIND_GUST_PERIOD_SECONDS,
  WIND_START_SECONDS,
  carrotCatchWind,
  scoreCaughtItem,
  windGustCycle,
  type CatchEvent,
} from "./logic";

class FixedRng implements RandomSource {
  public next(): number {
    return 0.5;
  }

  public int(minInclusive: number, maxExclusive: number): number {
    return Math.floor((minInclusive + maxExclusive - 1) / 2);
  }

  public pick<T>(items: readonly T[]): T {
    const item = items[Math.floor(items.length / 2)];
    if (item === undefined) throw new RangeError("Expected a non-empty list");
    return item;
  }
}

/** Cycles a fixed value list; four calls per spawn keeps kinds scriptable. */
class SequenceRng implements RandomSource {
  private index = 0;

  public constructor(private readonly values: readonly number[]) {}

  public next(): number {
    const value = this.values[this.index % this.values.length];
    this.index += 1;
    return value ?? 0.5;
  }

  public int(minInclusive: number, maxExclusive: number): number {
    return minInclusive + Math.floor(this.next() * (maxExclusive - minInclusive));
  }

  public pick<T>(items: readonly T[]): T {
    const item = items[this.int(0, items.length)];
    if (item === undefined) throw new RangeError("Expected a non-empty list");
    return item;
  }
}

/** Spawn call order is kind-roll, velocity jitter, x, spin. */
const UMBRELLA_EVERY_SPAWN = [0.08, 0.5, 0.5, 0.5] as const;

describe("Carrot Catch wind gusts", () => {
  it("stays calm before the higher level, then alternates bounded gusts", () => {
    expect(carrotCatchWind(0)).toBe(0);
    expect(carrotCatchWind(WIND_START_SECONDS - 0.01)).toBe(0);
    expect(windGustCycle(WIND_START_SECONDS - 0.01)).toBeNull();
    expect(windGustCycle(WIND_START_SECONDS)).toBe(0);
    const firstGustPeak = carrotCatchWind(WIND_START_SECONDS + WIND_GUST_PERIOD_SECONDS / 2);
    const secondGustPeak = carrotCatchWind(WIND_START_SECONDS + WIND_GUST_PERIOD_SECONDS * 1.5);
    expect(firstGustPeak).toBeGreaterThan(0);
    expect(secondGustPeak).toBeLessThan(0);
    expect(Math.abs(secondGustPeak)).toBeGreaterThan(Math.abs(firstGustPeak) * 0.9);
    for (let t = 0; t <= CARROT_CATCH_DURATION_SECONDS; t += 0.25) {
      expect(Math.abs(carrotCatchWind(t))).toBeLessThanOrEqual(0.14);
      expect(carrotCatchWind(t)).toBe(carrotCatchWind(t));
    }
  });

  it("announces each gust cycle and drifts airborne items with the wind", () => {
    const game = new CarrotCatchSimulation(new FixedRng());
    game.moveBasket(0.12);
    game.update(WIND_START_SECONDS + 0.5);
    const gusts = game.drainEvents().filter((event) => event.type === "gust");
    expect(gusts).toEqual([{ type: "gust", direction: 1 }]);

    const before = new Map(game.snapshot().items.map((item) => [item.id, item.x]));
    game.update(0.4);
    const after = game.snapshot().items;
    const survivors = after.filter((item) => before.has(item.id) && item.y < 0.7);
    expect(survivors.length).toBeGreaterThan(0);
    for (const item of survivors) {
      expect(item.x).toBeGreaterThan(before.get(item.id) ?? Number.POSITIVE_INFINITY);
    }

    game.update(WIND_GUST_PERIOD_SECONDS);
    const laterGusts = game.drainEvents().filter((event) => event.type === "gust");
    expect(laterGusts[0]).toEqual({ type: "gust", direction: -1 });
  });
});

describe("Carrot Catch umbrella basket", () => {
  it("scores umbrellas without touching the combo streak", () => {
    expect(scoreCaughtItem("umbrella", 0)).toEqual({ points: 25, nextCombo: 0 });
    expect(scoreCaughtItem("umbrella", 7)).toEqual({ points: 25, nextCombo: 7 });
  });

  it("widens the basket for a bounded window after a caught umbrella", () => {
    const game = new CarrotCatchSimulation(new SequenceRng(UMBRELLA_EVERY_SPAWN));
    game.moveBasket(0.5);
    expect(game.snapshot().basketHalfWidth).toBe(BASKET_HALF_WIDTH);
    game.update(3.2);
    const events = game.drainEvents();
    const caughtUmbrella = events.find(
      (event): event is Extract<CatchEvent, { type: "caught" }> =>
        event.type === "caught" && event.kind === "umbrella",
    );
    expect(caughtUmbrella?.points).toBe(25);
    const snapshot = game.snapshot();
    expect(snapshot.umbrellaSeconds).toBeGreaterThan(0);
    expect(snapshot.umbrellaSeconds).toBeLessThanOrEqual(UMBRELLA_SECONDS);
    expect(snapshot.basketHalfWidth).toBe(UMBRELLA_BASKET_HALF_WIDTH);
    game.moveBasket(0.12);
    game.update(UMBRELLA_SECONDS + 4);
    const calmed = game.snapshot();
    expect(calmed.umbrellaSeconds).toBe(0);
    expect(calmed.basketHalfWidth).toBe(BASKET_HALF_WIDTH);
  });
});

describe("Carrot Catch golden frenzy", () => {
  it("doubles positive catch points only while the frenzy runs", () => {
    const game = new CarrotCatchSimulation(new FixedRng());
    game.moveBasket(0.5);
    game.update(25);
    const events = game.drainEvents();
    const waveAt = events.findIndex((event) => event.type === "bonus-wave");
    expect(waveAt).toBeGreaterThan(-1);
    const caughtPoints = (event: CatchEvent): number | null =>
      event.type === "caught" && event.kind === "carrot" ? event.points : null;
    const beforeWave = events.slice(0, waveAt).map(caughtPoints).filter((points) => points !== null);
    const afterWave = events.slice(waveAt + 1).map(caughtPoints).filter((points) => points !== null);
    // Combo caps the base points at 50; before the frenzy nothing is doubled.
    expect(Math.max(...beforeWave)).toBeLessThanOrEqual(50);
    expect(beforeWave).not.toContain(50 * GOLDEN_FRENZY_MULTIPLIER);
    expect(afterWave).toContain(50 * GOLDEN_FRENZY_MULTIPLIER);
  });
});

describe("Carrot Catch frame partitions with the new mechanics live", () => {
  function partitionedUmbrellaRun(fps: 30 | 60 | 120): {
    readonly snapshot: ReturnType<CarrotCatchSimulation["snapshot"]>;
    readonly eventTypes: readonly string[];
  } {
    const game = new CarrotCatchSimulation(new SequenceRng([0.08, 0.5, 0.31, 0.5, 0.5, 0.62, 0.14, 0.9]));
    game.moveBasket(0.5);
    for (let frame = 0; frame < CARROT_CATCH_DURATION_SECONDS * fps; frame += 1) {
      game.update(1 / fps);
    }
    return {
      snapshot: game.snapshot(),
      eventTypes: game.drainEvents().map((event) => event.type),
    };
  }

  it("matches state and event order across 30, 60, and 120 fps", () => {
    const at30 = partitionedUmbrellaRun(30);
    const at60 = partitionedUmbrellaRun(60);
    const at120 = partitionedUmbrellaRun(120);
    expect(at30).toEqual(at60);
    expect(at60).toEqual(at120);
    expect(at120.eventTypes).toContain("gust");
    expect(at120.eventTypes.at(-1)).toBe("finished");
    expect(at120.snapshot.finished).toBe(true);
  });
});
