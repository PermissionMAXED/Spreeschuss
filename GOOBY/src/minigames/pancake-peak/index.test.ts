import { describe, expect, it } from "vitest";
import type { RandomSource } from "../../core/contracts/rng";
import {
  MAX_PANCAKE_WIDTH,
  PERFECT_TOLERANCE_PX,
  PancakePeakSimulation,
  calculatePlacement,
  isButterLayer,
  pancakeDifficulty,
  pancakeLayerScore,
  pancakePeakPayout,
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

describe("Pancake Peak simulation", () => {
  it("regrows and combos drops within four pixels", () => {
    const exact = calculatePlacement(180, 250, 180 + PERFECT_TOLERANCE_PX, 250);
    expect(exact).toMatchObject({ perfect: true, failed: false, x: 180, width: 256, overhang: 0 });
    expect(exact.width).toBeLessThanOrEqual(MAX_PANCAKE_WIDTH);
    expect(pancakeLayerScore(exact.width, true, 3, false)).toBe(220);
  });

  it("trims overhang and detects a width-zero miss", () => {
    const trimmed = calculatePlacement(180, 250, 185, 250);
    expect(trimmed).toMatchObject({ perfect: false, failed: false, width: 245, x: 182.5, overhang: 5 });
    expect(calculatePlacement(100, 80, 250, 80)).toMatchObject({ width: 0, failed: true });
  });

  it("ramps swing speed and awards butter every ten layers", () => {
    expect(pancakeDifficulty(20).speed).toBeGreaterThan(pancakeDifficulty(0).speed);
    expect(pancakeDifficulty(100).speed).toBe(340);
    expect([9, 10, 20, 21].map(isButterLayer)).toEqual([false, true, true, false]);
    expect(pancakeLayerScore(200, true, 3, true)).toBe(520);
  });

  it("builds a perfect combo, then reaches the width-zero end condition", () => {
    const game = new PancakePeakSimulation(new FixedRng());
    game.drop();
    expect(game.snapshot()).toMatchObject({ combo: 1, stackCount: 1, ended: false });
    const events = game.drainEvents();
    expect(events.some((event) => event.type === "perfect")).toBe(true);
    for (let index = 0; index < 12 && !game.snapshot().ended; index += 1) game.drop();
    expect(game.snapshot().ended).toBe(true);
    expect(game.drainEvents().at(-1)?.type).toBe("collapsed");
  });

  it("balances rewards and fully disposes stack state", () => {
    expect(pancakePeakPayout(11_000, 30, 10)).toEqual({ score: 11_000, coins: 109, xp: 115 });
    expect(pancakePeakPayout(1_000_000, 500, 500)).toEqual({ score: 1_000_000, coins: 130, xp: 260 });
    const game = new PancakePeakSimulation(new FixedRng());
    game.drop();
    game.dispose();
    const disposed = game.snapshot();
    expect(disposed).toMatchObject({ disposed: true, ended: true });
    expect(disposed.layers).toHaveLength(0);
    expect(game.drainEvents()).toHaveLength(0);
    game.update(1);
    game.drop();
    expect(game.snapshot()).toEqual(disposed);
  });
});
