import { describe, expect, it } from "vitest";
import { FakeClock } from "../../core/contracts/clock";
import { createDefaultSave, SaveStateSchema } from "../../core/contracts/save";
import { HOME_ZONE_IDS } from "../../core/contracts/scenes";
import { HOME_PLACES, HOME_ZONE_STUBS } from ".";
import {
  DAILY_CARROT_LIMIT,
  applyScrubProgress,
  feedFromInventory,
  harvestCarrot,
  persistDecorPlacements,
  petGooby,
  removeDecorPlacement,
  restoreDecorPlacements,
  rotateDecorPlacement,
  upsertDecorPlacement,
  validateDecorPlacement,
  type DecorPlacement,
} from "./state";

describe("home decor placement", () => {
  it("snaps to the grid and rejects static or decor collisions", () => {
    const placed = upsertDecorPlacement([], {
      instanceId: "reading-chair",
      decorId: "armchair",
      zone: "living-room",
      x: 2.83,
      z: 1.19,
    });
    expect(placed.validation).toMatchObject({
      valid: true,
      placement: { gridX: 6, gridZ: 2 },
    });

    const occupied = validateDecorPlacement(
      {
        instanceId: "second-chair",
        decorId: "armchair",
        zone: "living-room",
        x: 3,
        z: 1,
      },
      placed.placements,
    );
    expect(occupied).toEqual({ valid: false, reason: "occupied" });

    const blocked = validateDecorPlacement(
      {
        instanceId: "sofa-overlap",
        decorId: "armchair",
        zone: "living-room",
        x: -2.8,
        z: -2.4,
      },
      placed.placements,
    );
    expect(blocked).toEqual({ valid: false, reason: "blocked" });
  });

  it("validates rotation and round-trips through the frozen save schema", () => {
    const initial = upsertDecorPlacement([], {
      instanceId: "story-shelf",
      decorId: "bookshelf",
      zone: "living-room",
      x: -3,
      z: 1.25,
      slotId: "left-nook",
    });
    expect(initial.validation.valid).toBe(true);
    const rotated = rotateDecorPlacement(initial.placements, "story-shelf");
    expect(rotated.validation).toMatchObject({
      valid: true,
      placement: { quarterTurns: 1, slotId: "left-nook" },
    });

    const saved = persistDecorPlacements(createDefaultSave(1_000), rotated.placements);
    expect(SaveStateSchema.safeParse(saved).success).toBe(true);
    expect(restoreDecorPlacements(saved)).toEqual(rotated.placements);
    expect(removeDecorPlacement(rotated.placements, "story-shelf")).toEqual([]);
  });
});

describe("garden harvest", () => {
  it("caps harvests at three per injected-clock day and regrows tomorrow", () => {
    const day = 24 * 60 * 60 * 1_000;
    const clock = new FakeClock(day * 20 + 1_000);
    let save = createDefaultSave(clock.now());
    const results: boolean[] = [];
    for (let index = 0; index < DAILY_CARROT_LIMIT + 1; index += 1) {
      const result = harvestCarrot(save, clock);
      save = result.save;
      results.push(result.harvested);
    }
    expect(results).toEqual([true, true, true, false]);
    expect(save.inventory.carrot).toBe(6);

    clock.advance(day);
    const tomorrow = harvestCarrot(save, clock);
    expect(tomorrow.harvested).toBe(true);
    expect(tomorrow.remainingToday).toBe(2);
    expect(tomorrow.save.inventory.carrot).toBe(7);
  });
});

describe("home routes and care mutations", () => {
  it("provides a ready normal Places destination for every frozen home route", () => {
    expect(HOME_PLACES.map(({ zone }) => zone)).toEqual(HOME_ZONE_IDS);
    expect(HOME_PLACES.map(({ id }) => id)).toEqual(HOME_ZONE_IDS.map((zone) => `home:${zone}`));
    expect(HOME_PLACES.every(({ destination }) => destination.kind === "home")).toBe(true);
    expect(Object.values(HOME_ZONE_STUBS).every(({ ready }) => ready)).toBe(true);
  });

  it("changes hunger, hygiene, and fun through home interactions", () => {
    const clock = new FakeClock(5_000);
    const initial = {
      ...createDefaultSave(clock.now()),
      simulation: {
        ...createDefaultSave(clock.now()).simulation,
        needs: { hunger: 40, energy: 60, hygiene: 30, fun: 20 },
      },
    };

    const fed = feedFromInventory(initial, "carrot", clock);
    expect(fed.consumed).toBe(true);
    expect(fed.save.simulation.needs.hunger).toBe(62);
    expect(fed.save.inventory.carrot).toBe(2);

    const partial = applyScrubProgress(fed.save, 0, 0.55, clock);
    expect(partial.cleaned).toBe(false);
    expect(partial.save.simulation.needs.hygiene).toBe(30);
    const clean = applyScrubProgress(partial.save, partial.progress, 0.45, clock);
    expect(clean.cleaned).toBe(true);
    expect(clean.save.simulation.needs.hygiene).toBe(58);

    const tickled = petGooby(clean.save, "tickle", clock);
    expect(tickled.simulation.needs.fun).toBe(22);
  });

  it("ignores malformed persisted decor records", () => {
    const malformed = {
      ...createDefaultSave(0),
      inventory: {
        carrot: 3,
        "__home.decor.v1|living-room|bad id|armchair|0|0|0|-": 1,
      },
    };
    expect(restoreDecorPlacements(malformed)).toEqual([] as DecorPlacement[]);
  });
});
