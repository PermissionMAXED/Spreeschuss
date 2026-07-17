import { describe, expect, it } from "vitest";
import type { RandomSource } from "../../core/contracts/rng";
import {
  BUNNY_WORLD_WIDTH,
  BunnyHopSimulation,
  bunnyHopDifficulty,
  bunnyHopPayout,
  heightBand,
  isFatalFall,
  wrapHorizontal,
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

function partitionedHop(fps: 30 | 60 | 120): ReturnType<BunnyHopSimulation["snapshot"]> {
  const game = new BunnyHopSimulation(new FixedRng());
  game.setSteering(0.5);
  for (let frame = 0; frame < fps * 8; frame += 1) game.update(1 / fps);
  return game.snapshot();
}

describe("Bunny Hop simulation", () => {
  it("ramps narrower, wider-spaced, faster, more hazardous platforms", () => {
    const meadow = bunnyHopDifficulty(0);
    const space = bunnyHopDifficulty(3_200);
    expect(space.platformWidth).toBeLessThan(meadow.platformWidth);
    expect(space.gap).toBeGreaterThan(meadow.gap);
    expect(space.movingChance).toBeGreaterThan(meadow.movingChance);
    expect(space.crumbleChance).toBeGreaterThan(meadow.crumbleChance);
    expect(space.horizontalSpeed).toBeGreaterThan(meadow.horizontalSpeed);
  });

  it("defines all height bands and wraps steering seamlessly", () => {
    expect([heightBand(0), heightBand(900), heightBand(1_800), heightBand(2_800)])
      .toEqual(["meadow", "sunset", "clouds", "space"]);
    expect(wrapHorizontal(-5)).toBe(BUNNY_WORLD_WIDTH - 5);
    expect(wrapHorizontal(BUNNY_WORLD_WIDTH + 12)).toBe(12);
  });

  it("auto-bounces up deterministic centered platforms and builds a hop combo", () => {
    const game = new BunnyHopSimulation(new FixedRng());
    for (let index = 0; index < 2_400 && !game.snapshot().ended; index += 1) game.update(1 / 120);
    const snapshot = game.snapshot();
    expect(snapshot.maxHeight).toBeGreaterThan(150);
    expect(snapshot.combo).toBeGreaterThanOrEqual(2);
    expect(snapshot.score).toBeGreaterThan(0);
    expect(snapshot.platforms.length).toBeGreaterThan(0);
  });

  it("ends below the scrolling camera and caps an endless run's payout", () => {
    expect(isFatalFall(104, 200)).toBe(true);
    expect(isFatalFall(106, 200)).toBe(false);
    expect(bunnyHopPayout(10_000, 3_200, 10)).toEqual({ score: 10_000, coins: 114, xp: 99 });
    expect(bunnyHopPayout(1_000_000, 100_000, 1_000)).toEqual({ score: 1_000_000, coins: 120, xp: 250 });
  });

  it("fully disposes platforms, pickups, events, and further simulation", () => {
    const game = new BunnyHopSimulation(new FixedRng());
    game.update(1);
    expect(game.snapshot().platforms.length).toBeGreaterThan(0);
    game.dispose();
    const disposed = game.snapshot();
    expect(disposed).toMatchObject({ disposed: true, ended: true });
    expect(disposed.platforms).toHaveLength(0);
    expect(disposed.pickupItems).toHaveLength(0);
    expect(game.drainEvents()).toHaveLength(0);
    game.update(1);
    expect(game.snapshot()).toEqual(disposed);
  });

  it("keeps deterministic simulation state across 30, 60, and 120 fps partitions", () => {
    const at30 = partitionedHop(30);
    const at60 = partitionedHop(60);
    const at120 = partitionedHop(120);
    expect(at30).toEqual(at60);
    expect(at60).toEqual(at120);
  });
});
