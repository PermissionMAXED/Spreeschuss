import type { CityDriveState, ShopId } from "../../core/contracts/scenes";

export interface CityShopArrival {
  readonly source: "city";
  readonly shopId: ShopId;
  readonly parking: ShopId;
}

const issuedArrivals = new WeakSet<object>();

export function issueCityShopArrival(state: CityDriveState): CityShopArrival {
  if (state.phase !== "arrived" || state.car !== "parked" || !state.canEnter) {
    throw new Error("Shops can only be entered after the city car arrives and parks");
  }
  const ticket: CityShopArrival = Object.freeze({
    source: "city",
    shopId: state.selected,
    parking: state.selected,
  });
  issuedArrivals.add(ticket);
  return ticket;
}

export function consumeCityShopArrival(arrival: CityShopArrival, expectedShop: ShopId): void {
  if (
    !issuedArrivals.has(arrival) ||
    arrival.source !== "city" ||
    arrival.shopId !== expectedShop ||
    arrival.parking !== expectedShop
  ) {
    throw new Error("A valid matching city arrival is required to enter this shop");
  }
  issuedArrivals.delete(arrival);
}

export interface TownExitHandoff {
  readonly routeId: "city:drive";
  readonly phase: "return-board";
  readonly parking: ShopId;
  readonly visited: ShopId;
  readonly firstVisit: boolean;
  readonly offers: readonly ["drive-home"] | readonly ["drive-home", "choose-destination"];
}

/**
 * Shared visit history should be owned by the city/shop orchestrator for the
 * active save session. The first Town return intentionally has one clear path.
 */
export class ShopVisitHistory {
  private readonly visited = new Set<ShopId>();

  leaveForTown(shopId: ShopId): TownExitHandoff {
    const firstVisit = !this.visited.has(shopId);
    this.visited.add(shopId);
    return Object.freeze({
      routeId: "city:drive",
      phase: "return-board",
      parking: shopId,
      visited: shopId,
      firstVisit,
      offers: firstVisit ? (["drive-home"] as const) : (["drive-home", "choose-destination"] as const),
    });
  }

  hasVisited(shopId: ShopId): boolean {
    return this.visited.has(shopId);
  }
}
