import { SHOP_IDS, type ShopId } from "../../core/contracts/scenes";
import { SHOP_CATALOGS } from "../../data/catalog";
import { WalkableShopScene, type ShopSceneDependencies } from "./scene";
import type { CityShopArrival } from "./routes";

export interface ShopStub {
  readonly id: ShopId;
  readonly title: string;
  readonly specialty: "food" | "furniture-decor" | "cosmetics";
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
    specialty: "furniture-decor",
    routePolicy: "city-arrival-only",
  },
  "fluff-salon": {
    id: "fluff-salon",
    title: "Fluff Salon",
    specialty: "cosmetics",
    routePolicy: "city-arrival-only",
  },
};

if (Object.keys(SHOP_REGISTRY).length !== SHOP_IDS.length) {
  throw new Error("Every shop requires a frozen registry entry");
}

export interface ShopExperience {
  readonly id: ShopId;
  readonly experience: "grocery" | "furniture-decor" | "boutique";
  readonly displayFixture: "shelf" | "pedestal" | "rack";
  readonly itemCount: number;
  readonly walkable: true;
  readonly portraitFriendly: true;
}

export const SHOP_EXPERIENCES: Readonly<Record<ShopId, ShopExperience>> = {
  "carrot-market": {
    id: "carrot-market",
    experience: "grocery",
    displayFixture: "shelf",
    itemCount: SHOP_CATALOGS["carrot-market"].length,
    walkable: true,
    portraitFriendly: true,
  },
  "cloud-boutique": {
    id: "cloud-boutique",
    experience: "furniture-decor",
    displayFixture: "pedestal",
    itemCount: SHOP_CATALOGS["cloud-boutique"].length,
    walkable: true,
    portraitFriendly: true,
  },
  "fluff-salon": {
    id: "fluff-salon",
    experience: "boutique",
    displayFixture: "rack",
    itemCount: SHOP_CATALOGS["fluff-salon"].length,
    walkable: true,
    portraitFriendly: true,
  },
};

export function createShopScene(
  shopId: ShopId,
  arrival: CityShopArrival,
  dependencies: ShopSceneDependencies,
): WalkableShopScene {
  return new WalkableShopScene(shopId, arrival, dependencies);
}

export {
  consumeFood,
  isPurchaseReceiptKey,
  purchaseCatalogItem,
  PurchaseRequestIdSource,
  PurchaseRequestSchema,
  ShopPurchaseService,
  visibleInventory,
} from "./economy";
export type {
  CommittedPurchaseResult,
  ConsumeFoodResult,
  PurchaseRequest,
  PurchaseResult,
  PurchaseStatus,
} from "./economy";
export {
  consumeCityShopArrival,
  issueCityShopArrival,
  ShopVisitHistory,
} from "./routes";
export type {
  CityShopArrival,
  TownExitHandoff,
} from "./routes";
export { SHOP_CONTROL_LAYOUT, SHOP_PAGE_SIZE, WalkableShopScene } from "./scene";
export type { ShopSceneDependencies } from "./scene";
export { CosmeticTryOnSession } from "./try-on";
export type { EquippedCosmetics, TryOnResult } from "./try-on";
export {
  createCatalogItemModel,
  createCosmeticModel,
  createDisplayFixture,
  hydrateCuratedCatalogModel,
  ProceduralShopkeeper,
} from "./visuals";
