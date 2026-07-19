import { describe, expect, it } from "vitest";
import type { RandomSource } from "../../core/contracts/rng";
import {
  PANCAKE_WORLD_WIDTH,
  PancakePeakSimulation,
  SYRUP_BONUS,
  SYRUP_PERIOD_SECONDS,
  SYRUP_WINDOW_SECONDS,
  TALL_TOWER_BEST_GATE,
  TALL_TOWER_LAYER_BONUS,
  TALL_TOWER_SPEED_CAP,
  TALL_TOWER_STACK,
  WOBBLE_FREQUENCY,
  WOBBLE_MAX_PX,
  centerOfMassOffset,
  isSyrupWindow,
  isTipped,
  pancakeDifficulty,
  pancakeLayerScore,
  secondsUntilSyrup,
  stackCenterOfMassX,
  wobbleOffsetPx,
  type PancakeLayer,
  type PancakePeakEvent,
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

function layer(id: number, x: number, width: number, y = 56 + id * 24): PancakeLayer {
  return { id, x, y, width, perfect: false, butter: false };
}

function setPrivate(game: PancakePeakSimulation, patch: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(patch)) {
    Reflect.set(game as object, key, value);
  }
}

describe("Pancake Peak syrup timing", () => {
  it("opens a pure fixed-clock window at the end of every period", () => {
    expect(isSyrupWindow(0)).toBe(false);
    expect(isSyrupWindow(SYRUP_PERIOD_SECONDS - SYRUP_WINDOW_SECONDS - 0.01)).toBe(false);
    expect(isSyrupWindow(SYRUP_PERIOD_SECONDS - SYRUP_WINDOW_SECONDS)).toBe(true);
    expect(isSyrupWindow(SYRUP_PERIOD_SECONDS - 0.01)).toBe(true);
    expect(isSyrupWindow(SYRUP_PERIOD_SECONDS)).toBe(false);
    expect(isSyrupWindow(SYRUP_PERIOD_SECONDS * 4 - 0.2)).toBe(true);
    expect(isSyrupWindow(Number.NaN)).toBe(false);
    expect(isSyrupWindow(-1)).toBe(false);

    expect(secondsUntilSyrup(0)).toBeCloseTo(SYRUP_PERIOD_SECONDS - SYRUP_WINDOW_SECONDS, 12);
    expect(secondsUntilSyrup(SYRUP_PERIOD_SECONDS - SYRUP_WINDOW_SECONDS - 0.5)).toBeCloseTo(0.5, 12);
    expect(secondsUntilSyrup(SYRUP_PERIOD_SECONDS - 0.3)).toBe(0);
  });

  it("drizzles the bonus onto drops inside the window only", () => {
    const inside = new PancakePeakSimulation(new FixedRng());
    inside.update(SYRUP_PERIOD_SECONDS - SYRUP_WINDOW_SECONDS / 2);
    inside.drop();
    const insideEvents = inside.drainEvents();
    const syrup = insideEvents.find(
      (event): event is Extract<PancakePeakEvent, { type: "syrup" }> => event.type === "syrup",
    );
    expect(syrup?.bonus).toBe(SYRUP_BONUS);
    const placed = insideEvents.find(
      (event): event is Extract<PancakePeakEvent, { type: "place" }> => event.type === "place",
    );
    expect(placed).toBeDefined();
    if (!placed) throw new Error("Expected a placed layer");
    const combo = inside.snapshot().combo;
    const base = pancakeLayerScore(placed.layer.width, placed.layer.perfect, combo, placed.layer.butter);
    expect(placed.points).toBe(base + SYRUP_BONUS);

    const outside = new PancakePeakSimulation(new FixedRng());
    outside.update(1);
    outside.drop();
    expect(outside.drainEvents().some((event) => event.type === "syrup")).toBe(false);
  });

  it("counts down to the window in snapshots", () => {
    const game = new PancakePeakSimulation(new FixedRng());
    game.update(1);
    const early = game.snapshot();
    expect(early.syrupWindow).toBe(false);
    expect(early.syrupIn).toBeCloseTo(SYRUP_PERIOD_SECONDS - SYRUP_WINDOW_SECONDS - 1, 10);
    game.update(SYRUP_PERIOD_SECONDS - SYRUP_WINDOW_SECONDS - 1 + 0.1);
    const open = game.snapshot();
    expect(open.syrupWindow).toBe(true);
    expect(open.syrupIn).toBe(0);
  });
});

describe("Pancake Peak center-of-mass wobble", () => {
  it("computes the width-weighted center of mass relative to the base", () => {
    expect(stackCenterOfMassX([])).toBe(PANCAKE_WORLD_WIDTH / 2);
    expect(stackCenterOfMassX([layer(0, 100, 200)])).toBe(100);
    // A wide base outweighs a narrow shifted top: (100·300 + 200·100) / 400.
    expect(stackCenterOfMassX([layer(0, 100, 300), layer(1, 200, 100)])).toBeCloseTo(125, 12);
    expect(centerOfMassOffset([layer(0, 100, 300), layer(1, 200, 100)])).toBeCloseTo(25, 12);
    expect(centerOfMassOffset([])).toBe(0);
  });

  it("tips the tower once the center of mass leaves the base footprint", () => {
    expect(isTipped([layer(0, 180, 100)])).toBe(false);
    expect(isTipped([layer(0, 180, 100), layer(1, 229, 100)])).toBe(false);
    expect(isTipped([layer(0, 180, 100), layer(1, 281, 100)])).toBe(true);
    expect(isTipped([])).toBe(false);
  });

  it("sways deterministically, bounded, and only when off balance", () => {
    expect(wobbleOffsetPx(3.7, 0)).toBe(0);
    expect(wobbleOffsetPx(3.7, 18)).toBe(wobbleOffsetPx(3.7, 18));
    const peakPhase = Math.PI / 2 / WOBBLE_FREQUENCY;
    expect(Math.abs(wobbleOffsetPx(peakPhase, 10))).toBeGreaterThan(
      Math.abs(wobbleOffsetPx(peakPhase, 2)),
    );
    for (let t = 0; t < 20; t += 0.37) {
      expect(Math.abs(wobbleOffsetPx(t, 300))).toBeLessThanOrEqual(WOBBLE_MAX_PX * 1.4 + 1e-9);
    }
    // The lean component keeps the sway biased toward the heavy side.
    expect(Math.sign(wobbleOffsetPx(0, 30))).toBe(1);
    expect(Math.sign(wobbleOffsetPx(0, -30))).toBe(-1);
  });

  it("collapses a stack whose next drop pushes the balance past the base", () => {
    const game = new PancakePeakSimulation(new FixedRng());
    setPrivate(game, {
      layers: [layer(0, 180, 60), layer(1, 205, 60), layer(2, 230, 60)],
      stackCount: 3,
      moving: { x: 255, y: 160, width: 60, direction: 1 },
    });
    game.drop();
    const events = game.drainEvents();
    expect(events.some((event) => event.type === "place")).toBe(true);
    expect(events.at(-1)).toEqual({ type: "collapsed", reason: "tipped" });
    const snapshot = game.snapshot();
    expect(snapshot.ended).toBe(true);
    expect(Math.abs(snapshot.comOffset)).toBeGreaterThan(30);
  });
});

describe("Pancake Peak tall-tower endless tier", () => {
  it("stays a regular run without the persisted-best gate", () => {
    expect(TALL_TOWER_BEST_GATE).toBe(300);
    const game = new PancakePeakSimulation(new FixedRng());
    setPrivate(game, { stackCount: TALL_TOWER_STACK + 5 });
    const snapshot = game.snapshot();
    expect(snapshot.endlessTier).toBe(false);
    expect(snapshot.tallTower).toBe(false);
    expect(snapshot.difficulty.speed).toBeLessThanOrEqual(340);
  });

  it("activates past the stack threshold with faster swings and layer bonuses", () => {
    const game = new PancakePeakSimulation(new FixedRng(), { endlessTier: true });
    expect(game.snapshot()).toMatchObject({ endlessTier: true, tallTower: false });
    setPrivate(game, { stackCount: TALL_TOWER_STACK });
    expect(game.snapshot().tallTower).toBe(true);
    expect(pancakeDifficulty(100, true).speed).toBe(TALL_TOWER_SPEED_CAP);
    expect(pancakeDifficulty(100, false).speed).toBe(340);

    const control = new PancakePeakSimulation(new FixedRng());
    control.drop();
    game.drop();
    const controlPlace = control.drainEvents().find(
      (event): event is Extract<PancakePeakEvent, { type: "place" }> => event.type === "place",
    );
    const towerPlace = game.drainEvents().find(
      (event): event is Extract<PancakePeakEvent, { type: "place" }> => event.type === "place",
    );
    expect(controlPlace).toBeDefined();
    expect(towerPlace).toBeDefined();
    expect((towerPlace?.points ?? 0) - (controlPlace?.points ?? 0)).toBe(TALL_TOWER_LAYER_BONUS);
  });
});

describe("Pancake Peak frame partitions with the new mechanics live", () => {
  function partitionedTowerRun(fps: 30 | 60 | 120): {
    readonly eventTypes: readonly string[];
    readonly score: number;
    readonly stackCount: number;
    readonly movingX: number;
    readonly comOffset: number;
  } {
    const game = new PancakePeakSimulation(new FixedRng(), { endlessTier: true });
    const eventTypes: string[] = [];
    // Aligned wall-clock drops; the 5.5s one lands inside a syrup window.
    const dropFrames = new Set([fps * 1, fps * 5.5, fps * 8.2].map(Math.round));
    for (let frame = 1; frame <= fps * 10; frame += 1) {
      game.update(1 / fps);
      if (dropFrames.has(frame)) game.drop();
      eventTypes.push(...game.drainEvents().map((event) => event.type));
    }
    const snapshot = game.snapshot();
    return {
      eventTypes,
      score: snapshot.score,
      stackCount: snapshot.stackCount,
      movingX: snapshot.moving.x,
      comOffset: snapshot.comOffset,
    };
  }

  it("matches scores and ordered events across 30, 60, and 120 fps", () => {
    const at30 = partitionedTowerRun(30);
    const at60 = partitionedTowerRun(60);
    const at120 = partitionedTowerRun(120);
    expect(at30.eventTypes).toEqual(at60.eventTypes);
    expect(at60.eventTypes).toEqual(at120.eventTypes);
    expect(at30.score).toBe(at60.score);
    expect(at60.score).toBe(at120.score);
    expect(at30.stackCount).toBe(3);
    expect(at60.movingX).toBeCloseTo(at30.movingX, 6);
    expect(at120.movingX).toBeCloseTo(at30.movingX, 6);
    expect(at60.comOffset).toBeCloseTo(at30.comOffset, 6);
    expect(at30.eventTypes).toContain("syrup");
  });
});
