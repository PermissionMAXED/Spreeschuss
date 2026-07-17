import type { ShopId } from "../../core/contracts/scenes";
import { COSMETIC_CATALOG } from "./cosmetics";
import { FOOD_CATALOG } from "./foods";
import { FURNITURE_CATALOG } from "./furniture";
import { validateCatalog, type CatalogItem } from "./schema";

export {
  CatalogItemSchema,
  CosmeticCatalogItemSchema,
  COSMETIC_SLOTS,
  DISPLAY_FIXTURES,
  FoodCatalogItemSchema,
  FurnitureCatalogItemSchema,
  ITEM_RARITIES,
  validateCatalog,
} from "./schema";
export type {
  CatalogItem,
  CosmeticCatalogItem,
  CosmeticSlot,
  DisplayFixture,
  FoodCatalogItem,
  FurnitureCatalogItem,
  ItemRarity,
} from "./schema";
export { COSMETIC_CATALOG } from "./cosmetics";
export { FOOD_CATALOG } from "./foods";
export { FURNITURE_CATALOG } from "./furniture";

/**
 * The foundation minigame stub awards roughly 30 coins for 60 seconds of play
 * (10 score/second and one coin per 20 score). Prices intentionally make:
 * - 4–18 coin foods cost much less than one typical game;
 * - 20–40 coin everyday decor/cosmetics cost about one game;
 * - 44–88 coin keepsakes cost two or three games at most.
 *
 * Gooby starts with 40 coins, over half the catalog is level 1, and every gate
 * is permanent at level 4 or lower. Every item is always available: no timers,
 * rotating stock, loot boxes, price anchoring, or scarcity messaging.
 */
export const CATALOG_BALANCE = Object.freeze({
  referenceMinigame: Object.freeze({
    durationSeconds: 60,
    scorePerSecond: 10,
    coinsPerScore: 1 / 20,
    expectedCoins: 30,
  }),
  startingCoins: 40,
  priceBands: Object.freeze({
    food: Object.freeze({ min: 4, max: 18, typicalGames: "less than one" }),
    everydayKeepsake: Object.freeze({ min: 14, max: 40, typicalGames: "about one" }),
    treasuredKeepsake: Object.freeze({ min: 48, max: 88, typicalGames: "two or three" }),
  }),
  maximumLevelGate: 4,
  availabilityPolicy: "Everything stays available; progress never depends on urgency or scarcity.",
} as const);

export const ALL_CATALOG_ITEMS: readonly CatalogItem[] = validateCatalog([
  ...FOOD_CATALOG,
  ...FURNITURE_CATALOG,
  ...COSMETIC_CATALOG,
]);

export const CATALOG_BY_ID: ReadonlyMap<string, CatalogItem> = new Map(
  ALL_CATALOG_ITEMS.map((item) => [item.id, item]),
);

export const SHOP_CATALOGS: Readonly<Record<ShopId, readonly CatalogItem[]>> = Object.freeze({
  "carrot-market": FOOD_CATALOG,
  "cloud-boutique": FURNITURE_CATALOG,
  "fluff-salon": COSMETIC_CATALOG,
});

if (ALL_CATALOG_ITEMS.length < 50) {
  throw new Error("The complete shop catalog must contain at least 50 items");
}
