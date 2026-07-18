import { describe, expect, it } from "vitest";
import { ALL_CATALOG_ITEMS } from "../src/data/catalog";
import {
  CatalogItemSchema,
  COSMETIC_EQUIP_SLOTS,
  COSMETIC_SLOTS,
  WardrobeCosmeticCatalogItemSchema,
  validateCatalog,
} from "../src/data/catalog/schema";

function baseItem(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "test-berry-snack",
    name: "Berry snack",
    description: "A juicy little test berry snack.",
    price: 5,
    rarity: "everyday",
    levelRequired: 1,
    availability: "always",
    display: { fixture: "shelf", color: 0xff8866 },
    kind: "food",
    hunger: 8,
    xp: 2,
    stackable: true,
    ...overrides,
  };
}

describe("extended catalog schema", () => {
  it("accepts prices up to 400 and levels up to 8", () => {
    expect(CatalogItemSchema.safeParse(baseItem({ price: 400 })).success).toBe(true);
    expect(CatalogItemSchema.safeParse(baseItem({ price: 401 })).success).toBe(false);
    expect(CatalogItemSchema.safeParse(baseItem({ price: 0 })).success).toBe(false);
    expect(CatalogItemSchema.safeParse(baseItem({ levelRequired: 8 })).success).toBe(true);
    expect(CatalogItemSchema.safeParse(baseItem({ levelRequired: 9 })).success).toBe(false);
  });

  it("defines the frozen four render slots inside the six-slot wardrobe contract", () => {
    expect(COSMETIC_SLOTS).toEqual(["head", "ears", "neck", "back"]);
    expect(COSMETIC_EQUIP_SLOTS).toEqual(["head", "ears", "neck", "back", "face", "paws"]);
    for (const slot of COSMETIC_SLOTS) {
      expect(COSMETIC_EQUIP_SLOTS).toContain(slot);
    }
  });

  it("validates upcoming face and paws cosmetics through the wardrobe schema", () => {
    const cosmetic = baseItem({
      kind: "cosmetic",
      slot: "face",
      stackable: false,
      hunger: undefined,
      xp: undefined,
    });
    delete cosmetic.hunger;
    delete cosmetic.xp;
    expect(WardrobeCosmeticCatalogItemSchema.safeParse(cosmetic).success).toBe(true);
    expect(WardrobeCosmeticCatalogItemSchema.safeParse({ ...cosmetic, slot: "paws" }).success)
      .toBe(true);
    expect(WardrobeCosmeticCatalogItemSchema.safeParse({ ...cosmetic, slot: "tail" }).success)
      .toBe(false);
    // The shipped catalog union stays constrained to render-attached slots.
    expect(CatalogItemSchema.safeParse(cosmetic).success).toBe(false);
    expect(CatalogItemSchema.safeParse({ ...cosmetic, slot: "head" }).success).toBe(true);
  });

  it("keeps the shipped catalog valid under the extended bounds", () => {
    expect(() => validateCatalog([...ALL_CATALOG_ITEMS])).not.toThrow();
    for (const item of ALL_CATALOG_ITEMS) {
      expect(item.price).toBeLessThanOrEqual(400);
      expect(item.levelRequired).toBeLessThanOrEqual(8);
    }
  });
});
