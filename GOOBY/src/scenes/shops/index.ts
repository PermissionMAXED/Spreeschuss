import { SHOP_IDS, type ShopId } from "../../core/contracts/scenes";

export interface ShopStub {
  readonly id: ShopId;
  readonly title: string;
  readonly specialty: "food" | "clothes" | "grooming";
  readonly routePolicy: "city-arrival-only";
}

export const SHOP_REGISTRY: Readonly<Record<ShopId, ShopStub>> = {
  "carrot-market": {
    id: "carrot-market",
    title: "Carrot Market",
    specialty: "food",
    routePolicy: "city-arrival-only",
  },
  "cloud-boutique": {
    id: "cloud-boutique",
    title: "Cloud Boutique",
    specialty: "clothes",
    routePolicy: "city-arrival-only",
  },
  "fluff-salon": {
    id: "fluff-salon",
    title: "Fluff Salon",
    specialty: "grooming",
    routePolicy: "city-arrival-only",
  },
};

if (Object.keys(SHOP_REGISTRY).length !== SHOP_IDS.length) {
  throw new Error("Every shop requires a frozen registry entry");
}
