import { describe, expect, it } from "vitest";
import type { SavePort, SaveRecord } from "../../core/contracts/platform";
import { createDefaultSave, SaveStateSchema, type SaveState } from "../../core/contracts/save";
import {
  ALL_CATALOG_ITEMS,
  CATALOG_BALANCE,
  COSMETIC_CATALOG,
  COSMETIC_SLOTS,
  FOOD_CATALOG,
  FURNITURE_CATALOG,
  SHOP_CATALOGS,
  validateCatalog,
} from "../../data/catalog";
import { purchaseCatalogItem, ShopPurchaseService, visibleInventory } from "./economy";
import {
  consumeCityShopArrival,
  issueCityShopArrival,
  ShopVisitHistory,
  type CityShopArrival,
} from "./routes";
import { SHOP_CONTROL_LAYOUT } from "./scene";
import { CosmeticTryOnSession } from "./try-on";

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
});

describe("shop purchases", () => {
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
