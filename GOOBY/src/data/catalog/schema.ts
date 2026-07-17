import { z } from "zod";
import { HOME_ZONE_IDS } from "../../core/contracts/scenes";

export const ITEM_RARITIES = ["everyday", "special", "treasured"] as const;
export type ItemRarity = (typeof ITEM_RARITIES)[number];

export const COSMETIC_SLOTS = ["head", "ears", "neck", "back"] as const;
export type CosmeticSlot = (typeof COSMETIC_SLOTS)[number];

export const DISPLAY_FIXTURES = ["shelf", "pedestal", "rack"] as const;
export type DisplayFixture = (typeof DISPLAY_FIXTURES)[number];

const CatalogBaseSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u),
    name: z.string().trim().min(2).max(40),
    description: z.string().trim().min(8).max(140),
    price: z.number().int().min(1).max(120),
    rarity: z.enum(ITEM_RARITIES),
    levelRequired: z.number().int().min(1).max(4),
    availability: z.literal("always"),
    display: z
      .object({
        fixture: z.enum(DISPLAY_FIXTURES),
        color: z.number().int().min(0).max(0xffffff),
      })
      .strict(),
  })
  .strict();

export const FoodCatalogItemSchema = CatalogBaseSchema.extend({
  kind: z.literal("food"),
  hunger: z.number().int().min(4).max(35),
  xp: z.number().int().min(1).max(18),
  stackable: z.literal(true),
}).strict();

export const FurnitureCatalogItemSchema = CatalogBaseSchema.extend({
  kind: z.literal("furniture"),
  zones: z.array(z.enum(HOME_ZONE_IDS)).min(1),
  footprint: z.enum(["tiny", "small", "medium", "large"]),
  stackable: z.literal(false),
}).strict();

export const CosmeticCatalogItemSchema = CatalogBaseSchema.extend({
  kind: z.literal("cosmetic"),
  slot: z.enum(COSMETIC_SLOTS),
  stackable: z.literal(false),
}).strict();

export const CatalogItemSchema = z.discriminatedUnion("kind", [
  FoodCatalogItemSchema,
  FurnitureCatalogItemSchema,
  CosmeticCatalogItemSchema,
]);

export type FoodCatalogItem = z.infer<typeof FoodCatalogItemSchema>;
export type FurnitureCatalogItem = z.infer<typeof FurnitureCatalogItemSchema>;
export type CosmeticCatalogItem = z.infer<typeof CosmeticCatalogItemSchema>;
export type CatalogItem = z.infer<typeof CatalogItemSchema>;

export function validateCatalog(items: readonly unknown[]): readonly CatalogItem[] {
  const parsed = z.array(CatalogItemSchema).min(1).parse(items);
  const ids = new Set<string>();
  for (const item of parsed) {
    if (ids.has(item.id)) throw new Error(`Catalog item IDs must be unique: ${item.id}`);
    ids.add(item.id);
  }
  return Object.freeze(parsed);
}
