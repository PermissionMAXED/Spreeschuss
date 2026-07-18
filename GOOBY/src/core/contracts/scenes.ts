import type { DriveControls } from "./input";

export const HOME_ZONE_IDS = ["living-room", "kitchen", "bathroom", "bedroom", "garden"] as const;
export type HomeZoneId = (typeof HOME_ZONE_IDS)[number];

export const SHOP_IDS = ["carrot-market", "cloud-boutique", "fluff-salon"] as const;
export type ShopId = (typeof SHOP_IDS)[number];

/**
 * Frozen launch roster (first twelve) plus the CP1 expansion roster (last
 * twelve). IDs are append-only: never rename or reorder existing entries.
 */
export const MINIGAME_IDS = [
  "carrot-catch",
  "bunny-hop",
  "pancake-peak",
  "bubble-bath-blast",
  "veggie-sort",
  "gooby-says",
  "garden-moles",
  "carrot-cannon",
  "delivery-dash",
  "memory-meadow",
  "pond-fishing",
  "rhythm-hop",
  "cake-atelier",
  "shopping-surf",
  "picnic-packer",
  "firefly-lantern",
  "puddle-hopper",
  "market-scales",
  "burrow-dig",
  "cloud-bounce",
  "snail-mail",
  "topiary-trim",
  "honey-drizzle",
  "library-stack",
] as const;
export type MinigameId = (typeof MINIGAME_IDS)[number];

/** The first twelve launch minigames owned by their original specialists. */
export const LAUNCH_MINIGAME_IDS = MINIGAME_IDS.slice(0, 12);
/** The twelve CP1 expansion minigames introduced as playable checkpoint stubs. */
export const EXPANSION_MINIGAME_IDS = MINIGAME_IDS.slice(12);

export type SceneId =
  | `home:${HomeZoneId}`
  | "city:drive"
  | `shop:${ShopId}`
  | `minigame:${MinigameId}`;

export interface SceneContext {
  readonly viewport: { readonly width: number; readonly height: number; readonly pixelRatio: number };
}

export interface GameScene {
  readonly id: SceneId;
  enter(context: SceneContext): void | Promise<void>;
  update(deltaSeconds: number): void;
  resize(context: SceneContext): void;
  exit(): void | Promise<void>;
  dispose(): void;
}

export interface DestinationMarker {
  readonly destination: ShopId;
  readonly worldPosition: readonly [number, number, number];
  readonly label: string;
  readonly visible: true;
}

/** Shops intentionally cannot be represented as direct home-navigation targets. */
export type NormalUiDestination =
  | { readonly kind: "home"; readonly zone: HomeZoneId }
  | { readonly kind: "city-board" }
  | { readonly kind: "minigame-menu" };

export type CityDriveState =
  | { readonly phase: "destination-board"; readonly car: "parked"; readonly selected: ShopId | null }
  | { readonly phase: "depart-ready"; readonly car: "parked"; readonly selected: ShopId }
  | {
      readonly phase: "driving-outbound";
      readonly car: "auto-throttle";
      readonly selected: ShopId;
      readonly controls: DriveControls;
      readonly marker: DestinationMarker;
    }
  | { readonly phase: "arrived"; readonly car: "parked"; readonly selected: ShopId; readonly canEnter: true }
  | { readonly phase: "return-board"; readonly car: "parked"; readonly visited: ShopId; readonly returnRequired: boolean }
  | {
      readonly phase: "driving-home";
      readonly car: "auto-throttle";
      readonly visited: ShopId;
      readonly controls: DriveControls;
    };

export interface PhysicalRecoveryApi {
  /** Re-pins the car to a valid route sample after physics drift or a stall. */
  recoverCar(reason: "off-route" | "stalled" | "invalid-pose"): {
    readonly position: readonly [number, number, number];
    readonly headingRadians: number;
  };
}

export interface CityRouteController extends PhysicalRecoveryApi {
  readonly state: CityDriveState;
  selectDestination(shop: ShopId): void;
  confirmDeparture(): void;
  updateControls(controls: DriveControls): void;
  arrive(shop: ShopId): void;
  openReturnBoard(): void;
  confirmReturnDeparture(): void;
}

export interface RouteRegistryEntry {
  readonly id: SceneId;
  readonly title: string;
  readonly owner: "foundation" | "home" | "city" | "shops" | "minigames";
}

export const ROUTE_REGISTRY: readonly RouteRegistryEntry[] = [
  ...HOME_ZONE_IDS.map((zone) => ({ id: `home:${zone}` as const, title: zone, owner: "home" as const })),
  { id: "city:drive", title: "Gooby City", owner: "city" },
  ...SHOP_IDS.map((shop) => ({ id: `shop:${shop}` as const, title: shop, owner: "shops" as const })),
  ...MINIGAME_IDS.map((game) => ({ id: `minigame:${game}` as const, title: game, owner: "minigames" as const })),
] as const;
