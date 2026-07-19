import { describe, expect, it } from "vitest";
import type { RandomSource } from "../../core/contracts/rng";
import {
  BunnyHopSimulation,
  COYOTE_EXTRA_MARGIN_PX,
  COYOTE_WINDOW_SECONDS,
  FEATHER_MAX_CHARGES,
  HOP_VELOCITY,
  LANDING_MARGIN_PX,
  resolveCrossing,
  type BunnyHopEvent,
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

function grantFeathers(game: BunnyHopSimulation, charges: number): void {
  (game as unknown as { featherCharges: number }).featherCharges = charges;
}

function placeBunny(
  game: BunnyHopSimulation,
  x: number,
  y: number,
  velocityY: number,
): void {
  const mutable = game as unknown as { bunnyX: number; bunnyY: number; velocityY: number };
  mutable.bunnyX = x;
  mutable.bunnyY = y;
  mutable.velocityY = velocityY;
}

function stepUntil(
  game: BunnyHopSimulation,
  maxSeconds: number,
  done: (events: readonly BunnyHopEvent[]) => boolean,
): readonly BunnyHopEvent[] {
  const collected: BunnyHopEvent[] = [];
  for (let step = 0; step < Math.ceil(maxSeconds * 120); step += 1) {
    game.update(1 / 120);
    collected.push(...game.drainEvents());
    if (done(collected)) break;
  }
  return collected;
}

describe("Bunny Hop coyote fairness", () => {
  it("partitions crossings into land, coyote, and miss by wrapped distance", () => {
    const width = 100;
    expect(resolveCrossing(180, 180, width)).toBe("land");
    expect(resolveCrossing(180 + width / 2 + LANDING_MARGIN_PX, 180, width)).toBe("land");
    expect(resolveCrossing(180 + width / 2 + LANDING_MARGIN_PX + 0.1, 180, width)).toBe("coyote");
    expect(
      resolveCrossing(180 + width / 2 + LANDING_MARGIN_PX + COYOTE_EXTRA_MARGIN_PX, 180, width),
    ).toBe("coyote");
    expect(
      resolveCrossing(180 + width / 2 + LANDING_MARGIN_PX + COYOTE_EXTRA_MARGIN_PX + 0.1, 180, width),
    ).toBe("miss");
    // Wrapped edges are as forgiving as the middle of the world.
    expect(resolveCrossing(2, 358, width)).toBe("land");
  });

  it("still lands a near-missed edge when steering back inside the window", () => {
    const game = new BunnyHopSimulation(new FixedRng());
    // First generated platform sits at x=180, y=66, width 113 with FixedRng.
    placeBunny(game, 255, 66 + 18 + 30, -200);
    stepUntil(game, 0.4, () => game.snapshot().coyoteRemaining > 0);
    expect(game.snapshot().coyoteRemaining).toBeGreaterThan(0);
    expect(game.snapshot().coyoteRemaining).toBeLessThanOrEqual(COYOTE_WINDOW_SECONDS);
    game.steerAxis(-1);
    const events = stepUntil(game, 0.2, (all) => all.some((event) => event.type === "land"));
    const landing = events.find((event) => event.type === "land");
    expect(landing).toMatchObject({ type: "land", coyote: true });
    const snapshot = game.snapshot();
    expect(snapshot.bunnyY).toBeGreaterThanOrEqual(66 + 18);
    expect(snapshot.velocityY).toBe(HOP_VELOCITY);
    expect(snapshot.combo).toBeGreaterThanOrEqual(1);
  });

  it("expires the coyote window when nobody steers back", () => {
    const game = new BunnyHopSimulation(new FixedRng());
    placeBunny(game, 255, 66 + 18 + 30, -200);
    stepUntil(game, 0.4, () => game.snapshot().coyoteRemaining > 0);
    const events = stepUntil(game, COYOTE_WINDOW_SECONDS + 0.1, () => false);
    // The near-missed platform (y=66) is never rescued; the bunny may still
    // land squarely on the wide base platform (y=0) further down, which is
    // a regular landing and not a coyote save.
    expect(events.some((event) => event.type === "land" && event.coyote)).toBe(false);
    expect(events.some((event) => event.type === "land" && event.y === 66)).toBe(false);
    expect(game.snapshot().coyoteRemaining).toBe(0);
  });
});

describe("Bunny Hop feather double jump", () => {
  function fallingGame(): BunnyHopSimulation {
    const game = new BunnyHopSimulation(new FixedRng());
    stepUntil(game, 2, () => game.snapshot().velocityY < -50);
    return game;
  }

  it("does nothing without a stored charge", () => {
    const game = fallingGame();
    const before = game.snapshot();
    game.jump();
    game.update(1 / 120);
    const after = game.snapshot();
    expect(after.doubleJumps).toBe(0);
    expect(after.velocityY).toBeLessThan(before.velocityY);
  });

  it("consumes one charge to relaunch mid-air while falling", () => {
    const game = fallingGame();
    grantFeathers(game, FEATHER_MAX_CHARGES);
    game.jump();
    const snapshot = game.snapshot();
    expect(snapshot).toMatchObject({
      doubleJumps: 1,
      featherCharges: FEATHER_MAX_CHARGES - 1,
      velocityY: HOP_VELOCITY,
    });
    const events = game.drainEvents();
    expect(events).toContainEqual(
      expect.objectContaining({ type: "double-jump", remainingCharges: FEATHER_MAX_CHARGES - 1 }),
    );
  });

  it("buffers a jump pressed just before the apex and fires it on descent", () => {
    const game = new BunnyHopSimulation(new FixedRng());
    stepUntil(game, 2, () => {
      const snapshot = game.snapshot();
      return snapshot.velocityY > 0 && snapshot.velocityY < 55;
    });
    grantFeathers(game, 1);
    game.jump();
    expect(game.snapshot().doubleJumps).toBe(0);
    stepUntil(game, 0.12, (all) => all.some((event) => event.type === "double-jump"));
    expect(game.snapshot()).toMatchObject({ doubleJumps: 1, featherCharges: 0 });
  });

  it("lets an early buffered press expire without wasting the feather", () => {
    const game = new BunnyHopSimulation(new FixedRng());
    stepUntil(game, 2, () => game.snapshot().velocityY > 300);
    grantFeathers(game, 1);
    game.jump();
    stepUntil(game, 0.15, () => false);
    const snapshot = game.snapshot();
    expect(snapshot.doubleJumps).toBe(0);
    expect(snapshot.featherCharges).toBe(1);
  });
});

describe("Bunny Hop night variant", () => {
  it("defaults to day and carries an explicit night variant in snapshots", () => {
    expect(new BunnyHopSimulation(new FixedRng()).snapshot().variant).toBe("day");
    expect(new BunnyHopSimulation(new FixedRng(), "night").snapshot().variant).toBe("night");
  });
});

describe("Bunny Hop frame partitions with the new mechanics live", () => {
  function partitionedFeatherFlight(fps: 30 | 60 | 120): {
    readonly snapshot: ReturnType<BunnyHopSimulation["snapshot"]>;
    readonly eventTypes: readonly string[];
  } {
    const game = new BunnyHopSimulation(new FixedRng(), "night");
    const eventTypes: string[] = [];
    const frames = fps * 8;
    for (let frame = 0; frame < frames; frame += 1) {
      // Aligned wall-clock inputs: feather jumps requested at 2s and 5s.
      if (frame === fps * 2 || frame === fps * 5) {
        grantFeathers(game, 1);
        game.jump();
      }
      game.update(1 / fps);
      eventTypes.push(...game.drainEvents().map((event) => event.type));
    }
    return { snapshot: game.snapshot(), eventTypes };
  }

  it("matches state and ordered events across 30, 60, and 120 fps", () => {
    const at30 = partitionedFeatherFlight(30);
    const at60 = partitionedFeatherFlight(60);
    const at120 = partitionedFeatherFlight(120);
    expect(at30).toEqual(at60);
    expect(at60).toEqual(at120);
    expect(at120.eventTypes).toContain("double-jump");
    expect(at120.snapshot.doubleJumps).toBeGreaterThanOrEqual(1);
  });
});
