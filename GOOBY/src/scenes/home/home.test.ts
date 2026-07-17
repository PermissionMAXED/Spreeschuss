import { PerspectiveCamera, Scene, type Object3D } from "three";
import { describe, expect, it } from "vitest";
import { FakeClock } from "../../core/contracts/clock";
import { createDefaultSave, SaveStateSchema, type SaveState } from "../../core/contracts/save";
import { HOME_ZONE_IDS } from "../../core/contracts/scenes";
import { ResourceTracker, type GameRenderer } from "../../render/renderer";
import {
  Bathroom,
  HOME_PLACES,
  HOME_ZONE_STUBS,
  Kitchen,
  LivingRoom,
  createHomeZone,
  projectObjectToScreen,
} from ".";
import {
  DAILY_CARROT_LIMIT,
  applyScrubProgress,
  feedFromInventory,
  findAvailableDecorPlacement,
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

const VIEWPORTS = [
  { width: 375, height: 667 },
  { width: 390, height: 844 },
  { width: 820, height: 1180 },
] as const;

interface TestViewport {
  readonly width: number;
  readonly height: number;
}

function fakeRenderer(viewport: TestViewport = VIEWPORTS[0]): GameRenderer {
  const camera = new PerspectiveCamera(36, viewport.width / viewport.height, 0.1, 120);
  const domElement = {
    getBoundingClientRect: () => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: viewport.width,
      bottom: viewport.height,
      width: viewport.width,
      height: viewport.height,
      toJSON: () => ({}),
    }),
  };
  return {
    scene: new Scene(),
    camera,
    renderer: { domElement, toneMappingExposure: 1.05 },
  } as unknown as GameRenderer;
}

function centerOf(object: Object3D, renderer: GameRenderer, viewport: TestViewport): {
  readonly x: number;
  readonly y: number;
} {
  const projection = projectObjectToScreen(object, renderer.camera, viewport);
  return { x: projection.centerX, y: projection.centerY };
}

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

  it("exposes selected place, move, rotate, remove APIs and respects owned copies", () => {
    const renderer = fakeRenderer();
    const tracker = new ResourceTracker();
    let save: SaveState = {
      ...createDefaultSave(1_000),
      inventory: { carrot: 3, "apricot-floor-cushion": 1 },
    };
    const room = new LivingRoom(renderer, tracker, {
      readSave: () => save,
      writeSave: (next) => {
        save = next;
      },
    });

    expect(room.selectDecor("apricot-floor-cushion")).toBe(true);
    expect(room.placeSelectedDecor({ x: -3, z: 1.25, slotId: "left-nook" }).valid).toBe(true);
    expect(room.placeCatalogItem("apricot-floor-cushion")).toBe(false);
    expect(room.moveSelectedDecor({ x: 3, z: 1.25, slotId: "right-nook" })).toMatchObject({
      valid: true,
      placement: { gridX: 6, gridZ: 3 },
    });
    expect(room.rotateSelectedDecor()).toMatchObject({
      valid: true,
      placement: { quarterTurns: 1 },
    });
    expect(SaveStateSchema.safeParse(save).success).toBe(true);

    const restored = new LivingRoom(fakeRenderer(), new ResourceTracker(), { readSave: () => save });
    expect(restored.getDecorPlacements()).toEqual(room.getDecorPlacements());
    expect(room.removeSelectedDecor()).toBe(true);
    expect(room.getDecorPlacements()).toEqual([]);
    expect(Object.keys(save.inventory).some((key) => key.startsWith("__home.catalog.v1|"))).toBe(false);
    restored.dispose();
    room.dispose();
  });

  it("enforces catalog inventory while validating every restored collision", () => {
    const save: SaveState = {
      ...createDefaultSave(1_000),
      inventory: { carrot: 3, "apricot-floor-cushion": 1 },
    };
    const first = findAvailableDecorPlacement(
      [],
      "apricot-floor-cushion",
      "living-room",
      "cushion-1",
      save.inventory,
    );
    expect(first.valid).toBe(true);
    if (!first.valid) throw new Error("Expected a first placement");
    const placed = upsertDecorPlacement([], {
      ...first.placement,
      x: first.placement.gridX * 0.5,
      z: first.placement.gridZ * 0.5,
    }, save.inventory);
    const extra = upsertDecorPlacement(placed.placements, {
      instanceId: "cushion-2",
      decorId: "apricot-floor-cushion",
      zone: "living-room",
      x: 3,
      z: 1.5,
    }, save.inventory);
    expect(extra.validation).toEqual({ valid: false, reason: "inventory-exhausted" });

    const persisted = persistDecorPlacements(save, [
      ...placed.placements,
      {
        ...first.placement,
        instanceId: "cushion-2",
        gridX: 6,
        gridZ: 3,
      },
    ]);
    expect(restoreDecorPlacements(persisted)).toHaveLength(1);
  });
});

describe("essential home target projection", () => {
  it.each(VIEWPORTS)("keeps doors, food, toothbrush, carrots, and signs visible and tappable at $width×$height", (viewport) => {
    const save: SaveState = {
      ...createDefaultSave(1_000),
      inventory: { carrot: 3, apple: 1, pancake: 1 },
    };
    for (const zone of HOME_ZONE_IDS) {
      const renderer = fakeRenderer(viewport);
      const scene = createHomeZone(zone, renderer, new ResourceTracker(), { readSave: () => save });
      scene.resize({ viewport: { ...viewport, pixelRatio: 1 } });
      if (scene instanceof Kitchen) scene.openFridge();
      renderer.scene.updateMatrixWorld(true);
      const targets = scene.getEssentialInteractionTargets();
      expect(targets.length, zone).toBeGreaterThan(0);
      for (const target of targets) {
        const visual = projectObjectToScreen(target.visual, renderer.camera, viewport);
        const hit = projectObjectToScreen(target.hitTarget, renderer.camera, viewport);
        expect(visual.inFront, `${zone}/${target.id} visual depth`).toBe(true);
        expect(visual.centerX, `${zone}/${target.id} visual x`).toBeGreaterThanOrEqual(0);
        expect(visual.centerX, `${zone}/${target.id} visual x`).toBeLessThanOrEqual(viewport.width);
        expect(visual.centerY, `${zone}/${target.id} visual y`).toBeGreaterThanOrEqual(0);
        expect(visual.centerY, `${zone}/${target.id} visual y`).toBeLessThanOrEqual(viewport.height);
        expect(visual.width, `${zone}/${target.id} visual width`).toBeGreaterThan(
          target.id.startsWith("door:") ? 18 : 2,
        );
        expect(visual.height, `${zone}/${target.id} visual height`).toBeGreaterThan(2);
        expect(hit.fullyVisible, `${zone}/${target.id} hit bounds`).toBe(true);
        expect(hit.width, `${zone}/${target.id} tap width`).toBeGreaterThanOrEqual(44);
        expect(hit.height, `${zone}/${target.id} tap height`).toBeGreaterThanOrEqual(44);
      }
      scene.dispose();
    }
  });
});

describe("home dynamic resource ownership", () => {
  it("disposes and untracks each cosmetic replacement through twenty equips", () => {
    const room = new LivingRoom(fakeRenderer(), new ResourceTracker());
    const itemIds = ["sunny-bucket-hat", "berry-beret"] as const;
    room.equipCatalogCosmetics({ head: itemIds[0] });
    const stableResources = room.dynamicResourceCount;

    for (let index = 1; index < 20; index += 1) {
      const previous = room.gooby.getCosmeticSocket("head").children[0];
      if (!previous) throw new Error("Equipped home cosmetic is missing");
      const resources = new Set<{ addEventListener(type: "dispose", listener: () => void): void }>();
      previous.traverse((object) => {
        const renderable = object as Object3D & {
          geometry?: { addEventListener(type: "dispose", listener: () => void): void };
          material?: { addEventListener(type: "dispose", listener: () => void): void };
        };
        if (renderable.geometry) resources.add(renderable.geometry);
        if (renderable.material) resources.add(renderable.material);
      });
      let disposals = 0;
      for (const resource of resources) resource.addEventListener("dispose", () => disposals += 1);

      room.equipCatalogCosmetics({ head: itemIds[index % itemIds.length]! });
      expect(disposals).toBe(resources.size);
      expect(room.dynamicResourceCount).toBe(stableResources);
      expect(room.gooby.getCosmeticSocket("head").children).toHaveLength(1);
    }
    room.dispose();
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

  it("persists a monotonic harvest-day high-water mark across clock replay", () => {
    const day = 24 * 60 * 60 * 1_000;
    const clock = new FakeClock(day * 42 + 500);
    let save = createDefaultSave(clock.now());
    for (let index = 0; index < DAILY_CARROT_LIMIT; index += 1) {
      save = harvestCarrot(save, clock).save;
    }
    expect(save.dailyHarvest).toEqual({ day: 42, count: 3 });

    clock.set(day * 4);
    const replay = harvestCarrot(save, clock);
    expect(replay.harvested).toBe(false);
    expect(replay.remainingToday).toBe(0);
    expect(replay.save.dailyHarvest).toEqual({ day: 42, count: 3 });

    clock.set(day * 43);
    const advanced = harvestCarrot(save, clock);
    expect(advanced.harvested).toBe(true);
    expect(advanced.save.dailyHarvest).toEqual({ day: 43, count: 1 });
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

  it("lets bathroom scrubbing consume a Gooby drag before generic tickle", () => {
    const viewport = VIEWPORTS[1];
    const renderer = fakeRenderer(viewport);
    const clock = new FakeClock(5_000);
    let save: SaveState = {
      ...createDefaultSave(clock.now()),
      simulation: {
        ...createDefaultSave(clock.now()).simulation,
        needs: { hunger: 40, energy: 60, hygiene: 30, fun: 20 },
      },
    };
    const bathroom = new Bathroom(renderer, new ResourceTracker(), {
      clock,
      readSave: () => save,
      writeSave: (next) => {
        save = next;
      },
    });
    bathroom.resize({ viewport: { ...viewport, pixelRatio: 1 } });
    renderer.scene.updateMatrixWorld(true);
    const soap = renderer.scene.getObjectByName("bathroom:soap");
    if (!soap) throw new Error("Bathroom soap is missing");
    const soapPoint = centerOf(soap, renderer, viewport);
    const goobyPoint = centerOf(bathroom.gooby.interactionTarget, renderer, viewport);

    expect(bathroom.handleGesture({ type: "press-start", ...soapPoint })).toBe(true);
    for (let index = 0; index < 5; index += 1) {
      expect(bathroom.handleGesture({
        type: "press-move",
        ...goobyPoint,
        dx: 100,
        dy: 0,
      })).toBe(true);
    }
    expect(save.simulation.needs.hygiene).toBe(58);
    expect(save.simulation.needs.fun).toBe(20);
    bathroom.dispose();
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
