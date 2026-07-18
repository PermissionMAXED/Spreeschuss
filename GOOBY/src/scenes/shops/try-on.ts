import {
  CATALOG_BY_ID,
  COSMETIC_EQUIP_SLOTS,
  type CosmeticEquipSlot,
  type WardrobeCosmeticCatalogItem,
} from "../../data/catalog";

export type EquippedCosmetics = Readonly<Partial<Record<CosmeticEquipSlot, string>>>;

export type TryOnResult =
  | { readonly status: "previewing"; readonly item: WardrobeCosmeticCatalogItem; readonly equipped: EquippedCosmetics }
  | { readonly status: "unknown-item" | "not-cosmetic"; readonly equipped: EquippedCosmetics };

function copyLoadout(loadout: EquippedCosmetics): EquippedCosmetics {
  return Object.freeze(
    Object.fromEntries(
      COSMETIC_EQUIP_SLOTS.flatMap((slot) => {
        const value = loadout[slot];
        return value ? [[slot, value] as const] : [];
      }),
    ),
  );
}

/**
 * Try-on is intentionally reversible and never writes save data. Disposing an
 * unfinished shop visit restores the exact loadout present on entry.
 */
export class CosmeticTryOnSession {
  private baseline: EquippedCosmetics;
  private current: EquippedCosmetics;
  private disposed = false;

  constructor(
    initial: EquippedCosmetics = {},
    private readonly apply: (equipped: EquippedCosmetics) => void = () => undefined,
  ) {
    this.baseline = copyLoadout(initial);
    this.current = this.baseline;
  }

  get equipped(): EquippedCosmetics {
    return this.current;
  }

  tryOn(itemId: string): TryOnResult {
    this.assertActive();
    const item = CATALOG_BY_ID.get(itemId);
    if (!item) return { status: "unknown-item", equipped: this.current };
    if (item.kind !== "cosmetic") return { status: "not-cosmetic", equipped: this.current };
    this.current = copyLoadout({ ...this.current, [item.slot]: item.id });
    this.apply(this.current);
    return { status: "previewing", item, equipped: this.current };
  }

  revert(): EquippedCosmetics {
    this.assertActive();
    this.current = copyLoadout(this.baseline);
    this.apply(this.current);
    return this.current;
  }

  acceptOwnedLook(ownedItemIds: ReadonlySet<string>): EquippedCosmetics {
    this.assertActive();
    const accepted = Object.fromEntries(
      Object.entries(this.current).filter(([, itemId]) => itemId !== undefined && ownedItemIds.has(itemId)),
    ) as Partial<Record<CosmeticEquipSlot, string>>;
    this.baseline = copyLoadout(accepted);
    this.current = this.baseline;
    this.apply(this.current);
    return this.current;
  }

  dispose(): void {
    if (this.disposed) return;
    this.current = copyLoadout(this.baseline);
    this.apply(this.current);
    this.disposed = true;
  }

  private assertActive(): void {
    if (this.disposed) throw new Error("Try-on session is disposed");
  }
}
