import type { ShopId } from "../../core/contracts/scenes";
import { getActiveLanguage, type AppLanguage } from "../../i18n";
import { COSMETIC_CATALOG, COSMETIC_LOCALIZED_COPY } from "./cosmetics";
import { FOOD_CATALOG, FOOD_LOCALIZED_COPY } from "./foods";
import { FURNITURE_CATALOG, FURNITURE_LOCALIZED_COPY } from "./furniture";
import {
  COSMETIC_SLOTS,
  validateCatalog,
  type CatalogItem,
  type CosmeticCatalogItem,
  type FoodCatalogItem,
  type FurnitureCatalogItem,
  type WardrobeCosmeticCatalogItem,
} from "./schema";

export {
  CatalogItemSchema,
  CosmeticCatalogItemSchema,
  COSMETIC_EQUIP_SLOTS,
  COSMETIC_SLOTS,
  CosmeticEquipSlotSchema,
  DISPLAY_FIXTURES,
  FoodCatalogItemSchema,
  FurnitureCatalogItemSchema,
  ITEM_RARITIES,
  WardrobeCosmeticCatalogItemSchema,
  validateCatalog,
} from "./schema";
export type {
  CatalogItem,
  CosmeticCatalogItem,
  CosmeticEquipSlot,
  CosmeticSlot,
  DisplayFixture,
  FoodCatalogItem,
  FurnitureCatalogItem,
  ItemRarity,
  WardrobeCosmeticCatalogItem,
} from "./schema";
export { COSMETIC_CATALOG } from "./cosmetics";
export { FOOD_CATALOG } from "./foods";
export { FURNITURE_CATALOG } from "./furniture";

/**
 * The foundation minigame stub awards roughly 30 coins for 60 seconds of play
 * (10 score/second and one coin per 20 score). Prices intentionally make:
 * - 4–34 coin foods stay close to one typical game;
 * - 14–84 coin everyday/special keepsakes cover one to three games;
 * - 48–180 coin treasures remain clear long-term goals.
 *
 * Gooby starts with 40 coins, over half the catalog is level 1, and every gate
 * is permanent at level 8 or lower. Every item is always available: no timers,
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
    food: Object.freeze({ min: 4, max: 34, typicalGames: "about one or less" }),
    everydayKeepsake: Object.freeze({ min: 14, max: 42, typicalGames: "about one" }),
    treasuredKeepsake: Object.freeze({ min: 48, max: 180, typicalGames: "two to six" }),
  }),
  maximumLevelGate: 8,
  availabilityPolicy: "Everything stays available; progress never depends on urgency or scarcity.",
} as const);

/**
 * The foundation union still covers the four actor-owned sockets. Keep this
 * view schema-valid for older consumers while CP2 exposes the full six-slot
 * shop catalog through `ALL_SHOP_CATALOG_ITEMS`.
 */
const attachedCosmetics = COSMETIC_CATALOG.filter(
  (item): item is CosmeticCatalogItem =>
    (COSMETIC_SLOTS as readonly string[]).includes(item.slot),
);

export const ALL_CATALOG_ITEMS: readonly CatalogItem[] = validateCatalog([
  ...FOOD_CATALOG,
  ...FURNITURE_CATALOG,
  ...attachedCosmetics,
]);

export type ShopCatalogItem =
  | FoodCatalogItem
  | FurnitureCatalogItem
  | WardrobeCosmeticCatalogItem;

export const ALL_SHOP_CATALOG_ITEMS: readonly ShopCatalogItem[] = Object.freeze([
  ...FOOD_CATALOG,
  ...FURNITURE_CATALOG,
  ...COSMETIC_CATALOG,
]);

const allShopIds = new Set<string>();
for (const item of ALL_SHOP_CATALOG_ITEMS) {
  if (allShopIds.has(item.id)) throw new Error(`Catalog item IDs must be unique: ${item.id}`);
  allShopIds.add(item.id);
}

export const CATALOG_BY_ID: ReadonlyMap<string, ShopCatalogItem> = new Map(
  ALL_SHOP_CATALOG_ITEMS.map((item) => [item.id, item]),
);

export interface LocalizedCatalogCopy {
  readonly name: string;
  readonly description: string;
}

const CATALOG_LOCALIZED_COPY: Readonly<
  Record<string, Readonly<Record<AppLanguage, LocalizedCatalogCopy>>>
> = Object.freeze({
  ...FOOD_LOCALIZED_COPY,
  ...FURNITURE_LOCALIZED_COPY,
  ...COSMETIC_LOCALIZED_COPY,
});

/** Resolves item copy through CP1's active-language accessor by default. */
export function getCatalogItemCopy(
  itemOrId: ShopCatalogItem | string,
  language: AppLanguage = getActiveLanguage(),
): LocalizedCatalogCopy {
  const id = typeof itemOrId === "string" ? itemOrId : itemOrId.id;
  const copy = CATALOG_LOCALIZED_COPY[id]?.[language];
  if (copy) return copy;
  const item = typeof itemOrId === "string" ? CATALOG_BY_ID.get(itemOrId) : itemOrId;
  if (!item) throw new Error(`Unknown catalog item: ${id}`);
  return Object.freeze({ name: item.name, description: item.description });
}

export function localizeCatalogItem(
  item: ShopCatalogItem,
  language: AppLanguage = getActiveLanguage(),
): ShopCatalogItem {
  return Object.freeze({ ...item, ...getCatalogItemCopy(item, language) });
}

export interface CatalogOwnershipMetadata {
  readonly owned: boolean;
  readonly quantity: number;
  readonly stackable: boolean;
  readonly accessibilityLabel: string;
}

export function getCatalogOwnershipMetadata(
  item: ShopCatalogItem,
  inventory: Readonly<Record<string, number>>,
): CatalogOwnershipMetadata {
  const quantity = inventory[item.id] ?? 0;
  const ownershipLabel = quantity > 0
    ? `Owned, quantity ${quantity}`
    : "Not owned, quantity 0";
  const stackabilityLabel = item.stackable ? "Stackable" : "Single ownership";
  return Object.freeze({
    owned: quantity > 0,
    quantity,
    stackable: item.stackable,
    accessibilityLabel: `${getCatalogItemCopy(item).name}. ${ownershipLabel}. ${stackabilityLabel}.`,
  });
}

const salonTryOnIds: ReadonlySet<string> = new Set([
  "sunny-bucket-hat",
  "berry-beret",
  "garden-straw-hat",
  "starlight-crown",
  "clover-ear-clips",
  "peach-bow-pair",
  "moonbeam-ear-cuffs",
  "firefly-ear-lights",
  "gingham-neck-scarf",
  "carrot-charm-collar",
  "pearl-dewdrop-necklace",
  "cozy-cloud-cowl",
  "picnic-mini-backpack",
  "ladybug-shell-pack",
  "butterfly-garden-wings",
  "moth-moon-wings",
  "round-meadow-glasses",
  "daisy-nose-sticker",
  "moonbeam-monocle",
  "crystal-dewdrop-mask",
  "striped-paw-warmers",
  "garden-work-gloves",
  "puddle-rain-boots",
  "starlight-paw-rings",
] as const);

export const FLUFF_SALON_CATALOG: readonly WardrobeCosmeticCatalogItem[] = Object.freeze(
  COSMETIC_CATALOG.filter((item) => salonTryOnIds.has(item.id)),
);

if (FLUFF_SALON_CATALOG.length !== 24) {
  throw new Error("Fluff Salon must carry four try-on looks for each of six slots");
}

export const SHOP_CATALOGS: Readonly<Record<ShopId, readonly ShopCatalogItem[]>> = Object.freeze({
  "carrot-market": FOOD_CATALOG,
  "cloud-boutique": Object.freeze([...FURNITURE_CATALOG, ...COSMETIC_CATALOG]),
  "fluff-salon": FLUFF_SALON_CATALOG,
});

if (SHOP_CATALOGS["cloud-boutique"].length < 44) {
  throw new Error("Cloud Boutique must present at least 44 accessible catalog targets");
}
