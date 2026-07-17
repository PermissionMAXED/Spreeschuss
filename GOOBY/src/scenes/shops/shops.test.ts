import { Box3, PerspectiveCamera, Scene, Vector3, type Object3D } from "three";
import { describe, expect, it, vi } from "vitest";
import type { SavePort, SaveRecord } from "../../core/contracts/platform";
import { createDefaultSave, SaveStateSchema, type SaveState } from "../../core/contracts/save";
import { COSMETIC_ATTACHMENTS } from "../../gooby/attachments";
import type { ProceduralGooby } from "../../gooby";
import type { GameRenderer } from "../../render/renderer";
import {
  ALL_CATALOG_ITEMS,
  CATALOG_BALANCE,
  COSMETIC_CATALOG,
  COSMETIC_SLOTS,
  FOOD_CATALOG,
  FURNITURE_CATALOG,
  getCatalogOwnershipMetadata,
  SHOP_CATALOGS,
  validateCatalog,
} from "../../data/catalog";
import {
  consumeFood,
  purchaseCatalogItem,
  PurchaseRequestIdSource,
  PurchaseRequestSchema,
  ShopPurchaseService,
  visibleInventory,
} from "./economy";
import { SHOP_REGISTRY } from "./index";
import {
  consumeCityShopArrival,
  issueCityShopArrival,
  ShopVisitHistory,
  type CityShopArrival,
} from "./routes";
import { SHOP_CONTROL_LAYOUT, WalkableShopScene } from "./scene";
import { CosmeticTryOnSession, type EquippedCosmetics } from "./try-on";

const PORTRAIT_VIEWPORT = { width: 390, height: 844 } as const;

interface SalonSceneInternals {
  readonly gooby: ProceduralGooby;
  buildInterior(): void;
  renderTryOn(equipped: EquippedCosmetics): void;
}

function salonScene(): {
  readonly scene: WalkableShopScene;
  readonly renderer: GameRenderer;
  readonly internals: SalonSceneInternals;
} {
  const camera = new PerspectiveCamera(36, PORTRAIT_VIEWPORT.width / PORTRAIT_VIEWPORT.height, 0.1, 120);
  const domElement = {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    getBoundingClientRect: () => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: PORTRAIT_VIEWPORT.width,
      bottom: PORTRAIT_VIEWPORT.height,
      width: PORTRAIT_VIEWPORT.width,
      height: PORTRAIT_VIEWPORT.height,
      toJSON: () => ({}),
    }),
  };
  const renderer = {
    scene: new Scene(),
    camera,
    renderer: { domElement },
    resize: vi.fn(),
  } as unknown as GameRenderer;
  const arrival = issueCityShopArrival({
    phase: "arrived",
    car: "parked",
    selected: "fluff-salon",
    canEnter: true,
  });
  const scene = new WalkableShopScene("fluff-salon", arrival, {
    renderer,
    mount: {} as HTMLElement,
    getState: () => createDefaultSave(100),
    setState: () => undefined,
    visitHistory: new ShopVisitHistory(),
    onTownExit: () => undefined,
  });
  const internals = scene as unknown as SalonSceneInternals;
  internals.buildInterior();
  scene.resize({ viewport: { ...PORTRAIT_VIEWPORT, pixelRatio: 1 } });
  return { scene, renderer, internals };
}

function modelResources(root: Object3D): Set<{ addEventListener(type: "dispose", listener: () => void): void }> {
  const resources = new Set<{ addEventListener(type: "dispose", listener: () => void): void }>();
  root.traverse((object) => {
    const renderable = object as Object3D & {
      geometry?: { addEventListener(type: "dispose", listener: () => void): void };
      material?: { addEventListener(type: "dispose", listener: () => void): void };
    };
    if (renderable.geometry) resources.add(renderable.geometry);
    if (renderable.material) resources.add(renderable.material);
  });
  return resources;
}

function projectedBounds(object: Object3D, camera: PerspectiveCamera): {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
  readonly centerX: number;
  readonly centerY: number;
} {
  object.updateWorldMatrix(true, true);
  camera.updateWorldMatrix(true, false);
  const bounds = new Box3().setFromObject(object);
  const points = [
    new Vector3(bounds.min.x, bounds.min.y, bounds.min.z),
    new Vector3(bounds.min.x, bounds.min.y, bounds.max.z),
    new Vector3(bounds.min.x, bounds.max.y, bounds.min.z),
    new Vector3(bounds.min.x, bounds.max.y, bounds.max.z),
    new Vector3(bounds.max.x, bounds.min.y, bounds.min.z),
    new Vector3(bounds.max.x, bounds.min.y, bounds.max.z),
    new Vector3(bounds.max.x, bounds.max.y, bounds.min.z),
    new Vector3(bounds.max.x, bounds.max.y, bounds.max.z),
  ].map((point) => point.project(camera));
  const xs = points.map(({ x }) => (x + 1) * PORTRAIT_VIEWPORT.width / 2);
  const ys = points.map(({ y }) => (1 - y) * PORTRAIT_VIEWPORT.height / 2);
  const left = Math.min(...xs);
  const right = Math.max(...xs);
  const top = Math.min(...ys);
  const bottom = Math.max(...ys);
  return {
    left,
    right,
    top,
    bottom,
    centerX: (left + right) / 2,
    centerY: (top + bottom) / 2,
  };
}

function saveWithEconomy(coins: number, level: number): SaveState {
  const state = createDefaultSave(100);
  return SaveStateSchema.parse({
    ...state,
    economy: { ...state.economy, coins, level },
  });
}

describe("shop catalogs", () => {
  it("validates unique schemas and supplies more than fifty balanced items", () => {
    expect(validateCatalog(ALL_CATALOG_ITEMS)).toHaveLength(56);
    expect(FOOD_CATALOG.length).toBeGreaterThanOrEqual(14);
    expect(FURNITURE_CATALOG.length).toBeGreaterThanOrEqual(20);
    expect(COSMETIC_CATALOG.length).toBeGreaterThanOrEqual(16);
    expect(new Set(ALL_CATALOG_ITEMS.map(({ id }) => id)).size).toBe(ALL_CATALOG_ITEMS.length);
    expect(ALL_CATALOG_ITEMS.every(({ availability }) => availability === "always")).toBe(true);
    expect(Math.max(...ALL_CATALOG_ITEMS.map(({ levelRequired }) => levelRequired))).toBe(
      CATALOG_BALANCE.maximumLevelGate,
    );
  });

  it("includes food benefits, zone-tagged decor, and every cosmetic slot", () => {
    expect(FOOD_CATALOG.every(({ hunger, xp, price, rarity }) => hunger > 0 && xp > 0 && price > 0 && !!rarity))
      .toBe(true);
    expect(FURNITURE_CATALOG.every(({ zones }) => zones.length > 0)).toBe(true);
    expect(new Set(COSMETIC_CATALOG.map(({ slot }) => slot))).toEqual(new Set(COSMETIC_SLOTS));
    expect(Object.values(SHOP_CATALOGS).flat()).toHaveLength(ALL_CATALOG_ITEMS.length);
    expect(CATALOG_BALANCE.referenceMinigame.expectedCoins).toBe(30);
  });

  it("reports accessible ownership, quantity, and stackability for every item", () => {
    for (const item of ALL_CATALOG_ITEMS) {
      const quantity = item.stackable ? 3 : 1;
      const metadata = getCatalogOwnershipMetadata(item, { [item.id]: quantity });
      expect(metadata).toMatchObject({
        owned: true,
        quantity,
        stackable: item.stackable,
      });
      expect(metadata.accessibilityLabel).toContain(`quantity ${quantity}`);
      expect(metadata.accessibilityLabel).toContain(item.stackable ? "Stackable" : "Single ownership");
    }
  });

  it("keeps shop names and specialties aligned with their actual catalogs", () => {
    expect(SHOP_REGISTRY).toMatchObject({
      "carrot-market": { title: "Carrot Market", specialty: "food" },
      "cloud-boutique": { title: "Cloud Boutique", specialty: "furniture-decor" },
      "fluff-salon": { title: "Fluff Salon", specialty: "cosmetics" },
    });
  });
});

describe("shop purchases", () => {
  it("creates unique valid fallback IDs across scene sources and module reloads", async () => {
    vi.stubGlobal("crypto", undefined);
    const random = vi.spyOn(Math, "random").mockReturnValue(0.25);
    try {
      const firstSource = new PurchaseRequestIdSource();
      const firstIds = [
        firstSource.next("carrot-market"),
        new PurchaseRequestIdSource().next("carrot-market"),
      ];
      vi.resetModules();
      const reloaded = await import("./economy");
      const reloadedId = new reloaded.PurchaseRequestIdSource().next("carrot-market");
      const ids = [...firstIds, reloadedId];

      expect(new Set(ids).size).toBe(ids.length);
      expect(ids.every((requestId) =>
        PurchaseRequestSchema.safeParse({ itemId: "crisp-carrot", requestId }).success)).toBe(true);
    } finally {
      random.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it("charges and inventories a validated request exactly once", () => {
    const initial = saveWithEconomy(40, 1);
    const request = { itemId: "crisp-carrot", requestId: "purchase-0001" };
    const first = purchaseCatalogItem(initial, request);
    expect(first.status).toBe("purchased");
    expect(first.state.economy.coins).toBe(36);
    expect(first.state.inventory["crisp-carrot"]).toBe(1);

    const retry = purchaseCatalogItem(first.state, request);
    expect(retry.status).toBe("duplicate");
    expect(retry.state.economy.coins).toBe(36);
    expect(retry.state.inventory["crisp-carrot"]).toBe(1);
    expect(visibleInventory(retry.state.inventory)).toEqual({
      carrot: 3,
      "crisp-carrot": 1,
    });
  });

  it("serializes concurrent save retries into one committed charge", async () => {
    let record: SaveRecord = { revision: 0, payload: saveWithEconomy(40, 1) };
    const save: SavePort = {
      load: () => Promise.resolve(structuredClone(record)),
      commit: (expectedRevision, payload) => {
        expect(expectedRevision).toBe(record.revision);
        record = { revision: expectedRevision + 1, payload };
        return Promise.resolve(structuredClone(record));
      },
      clear: () => Promise.resolve(),
    };
    const service = new ShopPurchaseService(save, { now: () => 100 });
    const request = { itemId: "crisp-carrot", requestId: "purchase-concurrent" };
    const results = await Promise.all([service.purchase(request), service.purchase(request)]);
    expect(results.map(({ status }) => status)).toEqual(["purchased", "duplicate"]);
    expect(results[1]?.state.economy.coins).toBe(36);
    expect(record.revision).toBe(1);
  });

  it("retries compare-and-commit conflicts across service instances atomically", async () => {
    let record: SaveRecord = { revision: 0, payload: saveWithEconomy(40, 1) };
    const save: SavePort = {
      load: () => Promise.resolve(structuredClone(record)),
      commit: (expectedRevision, payload) => {
        if (expectedRevision !== record.revision) return Promise.reject(new Error("revision conflict"));
        record = { revision: expectedRevision + 1, payload };
        return Promise.resolve(structuredClone(record));
      },
      clear: () => Promise.resolve(),
    };
    const firstService = new ShopPurchaseService(save, { now: () => 100 });
    const secondService = new ShopPurchaseService(save, { now: () => 100 });
    const [first, second] = await Promise.all([
      firstService.purchase({ itemId: "crisp-carrot", requestId: "parallel-distinct-0001" }),
      secondService.purchase({ itemId: "apple-smile-slices", requestId: "parallel-distinct-0002" }),
    ]);

    expect([first.status, second.status]).toEqual(["purchased", "purchased"]);
    expect(SaveStateSchema.parse(record.payload)).toMatchObject({
      economy: { coins: 31 },
      inventory: {
        "crisp-carrot": 1,
        "apple-smile-slices": 1,
      },
    });
    expect(record.revision).toBe(2);
  });

  it("deduplicates one request racing through separate service instances", async () => {
    let record: SaveRecord = { revision: 0, payload: saveWithEconomy(40, 1) };
    const save: SavePort = {
      load: () => Promise.resolve(structuredClone(record)),
      commit: (expectedRevision, payload) => {
        if (expectedRevision !== record.revision) return Promise.reject(new Error("revision conflict"));
        record = { revision: expectedRevision + 1, payload };
        return Promise.resolve(structuredClone(record));
      },
      clear: () => Promise.resolve(),
    };
    const request = { itemId: "crisp-carrot", requestId: "parallel-retry-0001" };
    const results = await Promise.all([
      new ShopPurchaseService(save, { now: () => 100 }).purchase(request),
      new ShopPurchaseService(save, { now: () => 100 }).purchase(request),
    ]);

    expect(results.map(({ status }) => status).sort()).toEqual(["duplicate", "purchased"]);
    expect(SaveStateSchema.parse(record.payload)).toMatchObject({
      economy: { coins: 36 },
      inventory: { "crisp-carrot": 1 },
    });
    expect(record.revision).toBe(1);
  });

  it("leaves the save untouched when funds are short", () => {
    const initial = saveWithEconomy(2, 4);
    const result = purchaseCatalogItem(initial, {
      itemId: "starlight-canopy-bed",
      requestId: "purchase-0002",
    });
    expect(result.status).toBe("insufficient-funds");
    expect(result.state).toEqual(initial);
    expect(result.message).toMatch(/No hurry/u);
  });

  it("keeps friendly level gates without spending coins", () => {
    const initial = saveWithEconomy(100, 1);
    const result = purchaseCatalogItem(initial, {
      itemId: "starlight-crown",
      requestId: "purchase-0003",
    });
    expect(result.status).toBe("level-locked");
    expect(result.state.economy.coins).toBe(100);
    expect(result.message).toMatch(/stay right here/u);
  });

  it("rejects malformed and unknown purchase requests without state changes", () => {
    const initial = saveWithEconomy(100, 4);
    const malformed = purchaseCatalogItem(initial, {
      itemId: "Not A Catalog ID",
      requestId: "invalid-request-0001",
    });
    const unknown = purchaseCatalogItem(initial, {
      itemId: "missing-shelf-item",
      requestId: "unknown-request-0001",
    });

    expect(malformed).toMatchObject({ status: "invalid-request", state: initial });
    expect(unknown).toMatchObject({ status: "unknown-item", state: initial });
  });
});

describe("food consumption", () => {
  it("consumes every declared food benefit and decrements its owned quantity", () => {
    for (const food of FOOD_CATALOG) {
      const initial = saveWithEconomy(40, 1);
      const stocked = SaveStateSchema.parse({
        ...initial,
        simulation: {
          ...initial.simulation,
          needs: { ...initial.simulation.needs, hunger: 0 },
        },
        inventory: { ...initial.inventory, [food.id]: 2 },
      });
      const result = consumeFood(stocked, food.id);

      expect(result.status, food.id).toBe("consumed");
      expect(result.item, food.id).toEqual(food);
      expect(result.quantityBefore, food.id).toBe(2);
      expect(result.quantityAfter, food.id).toBe(1);
      expect(result.state.inventory[food.id], food.id).toBe(1);
      expect(result.state.simulation.needs.hunger, food.id).toBe(food.hunger);
      expect(result.state.economy.xp, food.id).toBe(stocked.economy.xp + food.xp);
    }
  });

  it("tracks the final serving and leaves invalid consumption requests untouched", () => {
    const initial = saveWithEconomy(40, 1);
    const stocked = SaveStateSchema.parse({
      ...initial,
      inventory: { ...initial.inventory, "crisp-carrot": 1 },
    });
    const consumed = consumeFood(stocked, "crisp-carrot");
    const empty = consumeFood(consumed.state, "crisp-carrot");
    const notFood = consumeFood(consumed.state, "sunny-bucket-hat");
    const unknown = consumeFood(consumed.state, "not-in-catalog");

    expect(consumed).toMatchObject({ status: "consumed", quantityBefore: 1, quantityAfter: 0 });
    expect(empty).toMatchObject({ status: "not-owned", quantityBefore: 0, quantityAfter: 0 });
    expect(notFood).toMatchObject({ status: "not-food", state: consumed.state });
    expect(unknown).toMatchObject({ status: "unknown-item", state: consumed.state });
  });
});

describe("cosmetic preview and city handoff", () => {
  it("reverts a live try-on to the exact entry loadout", () => {
    const applied: unknown[] = [];
    const session = new CosmeticTryOnSession(
      { head: "sunny-bucket-hat", neck: "gingham-neck-scarf" },
      (loadout) => applied.push(loadout),
    );
    const preview = session.tryOn("berry-beret");
    expect(preview).toMatchObject({ status: "previewing", equipped: { head: "berry-beret" } });
    expect(session.revert()).toEqual({
      head: "sunny-bucket-hat",
      neck: "gingham-neck-scarf",
    });
    expect(applied).toHaveLength(2);
  });

  it("attaches all eighteen salon cosmetics to the same authoritative animated sockets as home", () => {
    vi.stubGlobal("window", {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      devicePixelRatio: 1,
    });
    const { scene, internals } = salonScene();
    try {
      expect(COSMETIC_CATALOG).toHaveLength(18);
      expect(new Set(COSMETIC_CATALOG.map(({ slot }) => slot))).toEqual(new Set(COSMETIC_SLOTS));
      for (const item of COSMETIC_CATALOG) {
        internals.renderTryOn({ [item.slot]: item.id });
        for (const slot of COSMETIC_SLOTS) {
          const anchor = internals.gooby.getCosmeticSocket(slot);
          expect(anchor.children, `${item.id}/${slot}`).toHaveLength(slot === item.slot ? 1 : 0);
        }
        const anchor = internals.gooby.getCosmeticSocket(item.slot);
        const model = anchor.children[0];
        const descriptor = COSMETIC_ATTACHMENTS[item.slot];
        expect(model?.name).toBe(`try-on:${item.slot}:${item.id}`);
        expect(model?.parent).toBe(anchor);
        expect(model?.userData.cosmeticSocket).toBe(item.slot);
        expect(model?.position.toArray()).toEqual([...descriptor.modelPosition]);
        expect(model?.rotation.toArray().slice(0, 3)).toEqual([...descriptor.modelRotation]);
        expect(model?.scale.toArray()).toEqual([
          descriptor.modelScale,
          descriptor.modelScale,
          descriptor.modelScale,
        ]);
      }

      internals.renderTryOn({ head: "sunny-bucket-hat" });
      const headAnchor = internals.gooby.getCosmeticSocket("head");
      const hat = headAnchor.children[0];
      headAnchor.updateWorldMatrix(true, true);
      const anchorBefore = headAnchor.matrixWorld.clone();
      const hatBefore = hat?.matrixWorld.clone();
      internals.gooby.react("tickle");
      internals.gooby.update(0.18, 0.18);
      headAnchor.updateWorldMatrix(true, true);
      expect(headAnchor.matrixWorld.equals(anchorBefore)).toBe(false);
      expect(hat?.matrixWorld.equals(hatBefore!)).toBe(false);
      expect(hat?.parent).toBe(headAnchor);
      expect(hat?.matrixWorld.equals(headAnchor.matrixWorld.clone().multiply(hat.matrix))).toBe(true);
    } finally {
      scene.dispose();
      vi.unstubAllGlobals();
    }
  });

  it("disposes every replaced try-on model without growing active resources", () => {
    vi.stubGlobal("window", {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      devicePixelRatio: 1,
    });
    const { scene, internals } = salonScene();
    try {
      let stableResourceCount: number | null = null;
      for (let index = 0; index < COSMETIC_CATALOG.length * 2; index += 1) {
        const item = COSMETIC_CATALOG[index % COSMETIC_CATALOG.length]!;
        const previous = COSMETIC_SLOTS.flatMap((slot) =>
          internals.gooby.getCosmeticSocket(slot).children)[0];
        const previousResources: ReturnType<typeof modelResources> = previous
          ? modelResources(previous)
          : new Set();
        let disposals = 0;
        for (const resource of previousResources) {
          resource.addEventListener("dispose", () => disposals += 1);
        }

        internals.renderTryOn({ [item.slot]: item.id });

        expect(disposals, item.id).toBe(previousResources.size);
        const active = COSMETIC_SLOTS.flatMap((slot) =>
          internals.gooby.getCosmeticSocket(slot).children);
        expect(active, item.id).toHaveLength(1);
        const activeResourceCount = modelResources(active[0]!).size;
        stableResourceCount ??= activeResourceCount;
        expect(activeResourceCount, item.id).toBe(stableResourceCount);
      }

      const final = COSMETIC_SLOTS.flatMap((slot) =>
        internals.gooby.getCosmeticSocket(slot).children)[0]!;
      const finalResources = modelResources(final);
      let finalDisposals = 0;
      for (const resource of finalResources) {
        resource.addEventListener("dispose", () => finalDisposals += 1);
      }
      scene.dispose();
      expect(finalDisposals).toBe(finalResources.size);
      for (const slot of COSMETIC_SLOTS) {
        expect(internals.gooby.getCosmeticSocket(slot).children).toHaveLength(0);
      }
      internals.renderTryOn({ head: "sunny-bucket-hat" });
      expect(internals.gooby.getCosmeticSocket("head").children).toHaveLength(0);
      scene.dispose();
      expect(finalDisposals).toBe(finalResources.size);
    } finally {
      scene.dispose();
      vi.unstubAllGlobals();
    }
  });

  it("keeps head, ear, neck, and back try-ons aligned and visible at 390×844", () => {
    vi.stubGlobal("window", {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      devicePixelRatio: 1,
    });
    const { scene, renderer, internals } = salonScene();
    try {
      internals.renderTryOn({
        head: "sunny-bucket-hat",
        ears: "clover-ear-clips",
        neck: "gingham-neck-scarf",
        back: "picnic-mini-backpack",
      });
      renderer.scene.updateMatrixWorld(true);
      const cosmetics = Object.fromEntries(COSMETIC_SLOTS.map((slot) => {
        const model = internals.gooby.getCosmeticSocket(slot).children[0];
        if (!model) throw new Error(`Missing ${slot} portrait try-on`);
        return [slot, projectedBounds(model, renderer.camera)];
      })) as Record<(typeof COSMETIC_SLOTS)[number], ReturnType<typeof projectedBounds>>;
      const belly = internals.gooby.root.getObjectByName("Gooby.belly");
      if (!belly) throw new Error("Salon mannequin belly is missing");
      const torso = projectedBounds(belly, renderer.camera);

      for (const [slot, bounds] of Object.entries(cosmetics)) {
        expect(bounds.left, `${slot} left`).toBeGreaterThanOrEqual(0);
        expect(bounds.right, `${slot} right`).toBeLessThanOrEqual(PORTRAIT_VIEWPORT.width);
        expect(bounds.top, `${slot} top`).toBeGreaterThanOrEqual(0);
        expect(bounds.bottom, `${slot} bottom`).toBeLessThanOrEqual(PORTRAIT_VIEWPORT.height);
        expect(bounds.right - bounds.left, `${slot} width`).toBeGreaterThan(8);
        expect(bounds.bottom - bounds.top, `${slot} height`).toBeGreaterThan(8);
      }
      expect(cosmetics.head.centerY).toBeLessThan(torso.centerY - 45);
      expect(cosmetics.ears.centerY).toBeLessThan(torso.centerY - 45);
      expect(Math.abs(cosmetics.head.centerX - torso.centerX)).toBeLessThan(20);
      expect(Math.abs(cosmetics.neck.centerX - torso.centerX)).toBeLessThan(20);
      expect(Math.abs(cosmetics.back.centerX - torso.centerX)).toBeLessThan(20);
      expect(cosmetics.neck.centerY).toBeLessThan(torso.centerY);
      expect(cosmetics.back.centerY).toBeGreaterThan(torso.top);
      expect(cosmetics.back.centerY).toBeLessThan(torso.bottom);
    } finally {
      scene.dispose();
      vi.unstubAllGlobals();
    }
  });

  it("requires a city arrival and returns to matching parking", () => {
    const forged: CityShopArrival = {
      source: "city",
      shopId: "carrot-market",
      parking: "carrot-market",
    };
    expect(() => consumeCityShopArrival(forged, "carrot-market")).toThrow(/valid matching city arrival/u);

    const arrival = issueCityShopArrival({
      phase: "arrived",
      car: "parked",
      selected: "cloud-boutique",
      canEnter: true,
    });
    expect(() => consumeCityShopArrival(arrival, "cloud-boutique")).not.toThrow();

    const visits = new ShopVisitHistory();
    const first = visits.leaveForTown("cloud-boutique");
    expect(first).toMatchObject({
      routeId: "city:drive",
      phase: "return-board",
      parking: "cloud-boutique",
      firstVisit: true,
      offers: ["drive-home"],
    });
    expect(visits.leaveForTown("cloud-boutique").offers).toEqual(["drive-home", "choose-destination"]);
  });

  it("positions Town away from the Places HUD control", () => {
    expect(SHOP_CONTROL_LAYOUT.town.insetBlockEnd).toBe("auto");
    expect(SHOP_CONTROL_LAYOUT.town.avoidsHudControl).toBe("Places");
  });
});
