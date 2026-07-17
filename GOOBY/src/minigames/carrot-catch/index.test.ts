import { describe, expect, it } from "vitest";
import type { RandomSource } from "../../core/contracts/rng";
import {
  CARROT_CATCH_DURATION_SECONDS,
  CarrotCatchSimulation,
  carrotCatchDifficulty,
  carrotCatchPayout,
  scoreCaughtItem,
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

describe("Carrot Catch simulation", () => {
  it("scores catches, multipliers, golden carrots, and rotten resets", () => {
    expect(scoreCaughtItem("carrot", 0)).toEqual({ points: 10, nextCombo: 1 });
    expect(scoreCaughtItem("carrot", 4)).toEqual({ points: 20, nextCombo: 5 });
    expect(scoreCaughtItem("golden", 9)).toEqual({ points: 150, nextCombo: 10 });
    expect(scoreCaughtItem("rotten", 17)).toEqual({ points: -30, nextCombo: 0 });
  });

  it("ramps spawn frequency, fall speed, and rotten chance across 75 seconds", () => {
    const opening = carrotCatchDifficulty(0);
    const finale = carrotCatchDifficulty(CARROT_CATCH_DURATION_SECONDS);
    expect(finale.spawnInterval).toBeLessThan(opening.spawnInterval);
    expect(finale.fallSpeed).toBeGreaterThan(opening.fallSpeed);
    expect(finale.rottenChance).toBeGreaterThan(opening.rottenChance);
  });

  it("launches a bonus wave every 20 clean catches and ends at 75 seconds", () => {
    const game = new CarrotCatchSimulation(new FixedRng());
    game.moveBasket(0.5);
    game.update(CARROT_CATCH_DURATION_SECONDS);
    const events = game.drainEvents();
    const snapshot = game.snapshot();
    expect(snapshot.catches).toBeGreaterThanOrEqual(20);
    expect(events.some((event) => event.type === "bonus-wave")).toBe(true);
    expect(events.at(-1)?.type).toBe("finished");
    expect(snapshot.finished).toBe(true);
    expect(snapshot.timeLeft).toBe(0);
  });

  it("keeps rewards bounded and fully disposes live entities and events", () => {
    expect(carrotCatchPayout(3_000, 60)).toEqual({ score: 3_000, coins: 94, xp: 211 });
    expect(carrotCatchPayout(100_000, 500)).toEqual({ score: 100_000, coins: 100, xp: 220 });
    const game = new CarrotCatchSimulation(new FixedRng());
    game.update(2);
    expect(game.snapshot().items.length).toBeGreaterThan(0);
    game.dispose();
    const disposed = game.snapshot();
    expect(disposed).toMatchObject({ disposed: true, finished: true });
    expect(disposed.items).toHaveLength(0);
    expect(game.drainEvents()).toHaveLength(0);
    game.update(10);
    expect(game.snapshot()).toEqual(disposed);
  });
});
