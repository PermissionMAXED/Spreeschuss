import type {
  CityDriveState,
  CityRouteController,
  DestinationMarker,
  ShopId,
} from "../../core/contracts/scenes";
import type { DriveControls } from "../../core/contracts/input";
import {
  CITY_DESTINATIONS,
  CITY_GARAGE_HEADING,
  CITY_GARAGE_POSITION,
  PARKING_TRIGGER_RADIUS,
  didReachCityTrigger,
  distance2d,
  type CityPoint,
} from "../../data/city";
import {
  createSafeBoardTravelSnapshot,
  parseCityTravelSnapshot,
  type CitySafeCarPose,
  type CityTravelSnapshot,
} from "./travel-snapshot";

const PARKED_CONTROLS: DriveControls = {
  steering: 0,
  braking: false,
  steeringHeld: false,
  brakeHeld: false,
};

export const CITY_DESTINATION_MARKERS: Readonly<Record<ShopId, DestinationMarker>> = {
  "carrot-market": {
    destination: "carrot-market",
    label: "Carrot Market",
    worldPosition: CITY_DESTINATIONS["carrot-market"].markerPosition,
    visible: true,
  },
  "cloud-boutique": {
    destination: "cloud-boutique",
    label: "Cloud Boutique",
    worldPosition: CITY_DESTINATIONS["cloud-boutique"].markerPosition,
    visible: true,
  },
  "fluff-salon": {
    destination: "fluff-salon",
    label: "Fluff Salon",
    worldPosition: CITY_DESTINATIONS["fluff-salon"].markerPosition,
    visible: true,
  },
} as const;

export class CityRouteMachine implements CityRouteController {
  private current: CityDriveState = { phase: "destination-board", car: "parked", selected: null };
  private readonly visited: Set<ShopId>;
  private latestSnapshot: CityTravelSnapshot | null;
  private tripReturnRequired = false;
  private lastSafePose: {
    position: readonly [number, number, number];
    headingRadians: number;
  } = {
    position: [CITY_GARAGE_POSITION[0], 0.35, CITY_GARAGE_POSITION[1]],
    headingRadians: CITY_GARAGE_HEADING,
  };

  constructor(visited: Iterable<ShopId> = [], persistedSnapshot?: unknown) {
    this.visited = new Set(visited);
    this.latestSnapshot = persistedSnapshot === undefined
      ? null
      : parseCityTravelSnapshot(persistedSnapshot, this.visited);
    if (this.latestSnapshot) this.restore(this.latestSnapshot);
  }

  get state(): CityDriveState {
    return this.current;
  }

  get visibleParkingTrigger(): DestinationMarker | null {
    return this.current.phase === "driving-outbound"
      ? CITY_DESTINATION_MARKERS[this.current.selected]
      : null;
  }

  get restoredTravelSnapshot(): CityTravelSnapshot | null {
    return this.latestSnapshot;
  }

  hasVisited(shop: ShopId): boolean {
    return this.visited.has(shop);
  }

  visitedShops(): readonly ShopId[] {
    return [...this.visited];
  }

  createTravelSnapshot(
    safeCarPose: CitySafeCarPose,
    collectedCoinIds: readonly string[],
  ): CityTravelSnapshot {
    const state = this.current;
    const candidate: CityTravelSnapshot = {
      phase: state.phase,
      destination: state.phase === "depart-ready"
        || state.phase === "driving-outbound"
        || state.phase === "arrived"
        ? state.selected
        : null,
      visitedShop: state.phase === "return-board" || state.phase === "driving-home"
        ? state.visited
        : null,
      returnRequired: state.phase === "destination-board" ? false : this.tripReturnRequired,
      safeCarPose: state.phase === "destination-board" || state.phase === "depart-ready"
        ? {
            position: [CITY_GARAGE_POSITION[0], CITY_GARAGE_POSITION[1]],
            headingRadians: CITY_GARAGE_HEADING,
          }
        : safeCarPose,
      collectedRouteState: { coinIds: [...collectedCoinIds] },
    };
    this.latestSnapshot = parseCityTravelSnapshot(candidate, this.visited)
      ?? createSafeBoardTravelSnapshot();
    return this.latestSnapshot;
  }

  selectDestination(shop: ShopId): void {
    if (this.current.phase !== "destination-board" && this.current.phase !== "depart-ready") {
      throw new Error("Destinations can only be selected while the car is parked at the destination board");
    }
    this.tripReturnRequired = !this.visited.has(shop);
    this.current = { phase: "depart-ready", car: "parked", selected: shop };
  }

  confirmDeparture(): void {
    if (this.current.phase !== "depart-ready") throw new Error("Select a destination before departing");
    this.current = {
      phase: "driving-outbound",
      car: "auto-throttle",
      selected: this.current.selected,
      controls: PARKED_CONTROLS,
      marker: CITY_DESTINATION_MARKERS[this.current.selected],
    };
  }

  updateControls(controls: DriveControls): void {
    if (this.current.phase === "driving-outbound") this.current = { ...this.current, controls };
    else if (this.current.phase === "driving-home") this.current = { ...this.current, controls };
  }

  canTriggerArrival(
    shop: ShopId,
    position: CityPoint | readonly [number, number, number],
  ): boolean {
    if (this.current.phase !== "driving-outbound" || this.current.selected !== shop) return false;
    const point: CityPoint = position.length === 3
      ? [position[0], position[2] ?? position[1]]
      : [position[0], position[1]];
    const destination = CITY_DESTINATIONS[shop].markerPosition;
    return distance2d(point, [destination[0], destination[2]]) <= PARKING_TRIGGER_RADIUS;
  }

  tryArriveAt(position: CityPoint | readonly [number, number, number]): ShopId | null {
    if (this.current.phase !== "driving-outbound") return null;
    const selected = this.current.selected;
    if (!this.canTriggerArrival(selected, position)) return null;
    this.arrive(selected);
    return selected;
  }

  tryArriveAlong(from: CityPoint, to: CityPoint): ShopId | null {
    if (this.current.phase !== "driving-outbound") return null;
    const selected = this.current.selected;
    const marker = CITY_DESTINATIONS[selected].markerPosition;
    if (!didReachCityTrigger(from, to, [marker[0], marker[2]], PARKING_TRIGGER_RADIUS)) {
      return null;
    }
    this.arrive(selected);
    return selected;
  }

  arrive(shop: ShopId): void {
    if (this.current.phase !== "driving-outbound" || this.current.selected !== shop) {
      throw new Error("Only the selected shop may trigger arrival");
    }
    this.current = { phase: "arrived", car: "parked", selected: shop, canEnter: true };
  }

  openReturnBoard(): void {
    if (this.current.phase !== "arrived") throw new Error("Return board is available after a shop visit");
    this.visited.add(this.current.selected);
    this.current = {
      phase: "return-board",
      car: "parked",
      visited: this.current.selected,
      returnRequired: this.tripReturnRequired,
    };
  }

  confirmReturnDeparture(): void {
    if (this.current.phase !== "return-board") throw new Error("Return departure requires the parked return board");
    this.current = {
      phase: "driving-home",
      car: "auto-throttle",
      visited: this.current.visited,
      controls: PARKED_CONTROLS,
    };
  }

  useQuickReturn(): void {
    if (this.current.phase !== "return-board") throw new Error("Quick return is only available from the return board");
    if (this.current.returnRequired) throw new Error("The first visit requires the return drive");
    this.current = { phase: "destination-board", car: "parked", selected: null };
    this.tripReturnRequired = false;
    this.resetSafePoseToGarage();
  }

  arriveHome(): void {
    if (this.current.phase !== "driving-home") throw new Error("Home arrival requires an active return drive");
    this.current = { phase: "destination-board", car: "parked", selected: null };
    this.tripReturnRequired = false;
    this.resetSafePoseToGarage();
  }

  recoverCar(reason: "off-route" | "stalled" | "invalid-pose"): {
    readonly position: readonly [number, number, number];
    readonly headingRadians: number;
  } {
    void reason;
    return this.lastSafePose;
  }

  pinSafePose(position: readonly [number, number, number], headingRadians: number): void {
    if (!position.every(Number.isFinite) || !Number.isFinite(headingRadians)) {
      throw new RangeError("A safe city pose must contain finite values");
    }
    this.lastSafePose = { position, headingRadians };
  }

  private restore(snapshot: CityTravelSnapshot): void {
    this.tripReturnRequired = snapshot.returnRequired;
    this.lastSafePose = {
      position: [
        snapshot.safeCarPose.position[0],
        0.35,
        snapshot.safeCarPose.position[1],
      ],
      headingRadians: snapshot.safeCarPose.headingRadians,
    };
    switch (snapshot.phase) {
      case "destination-board":
        this.current = { phase: "destination-board", car: "parked", selected: null };
        return;
      case "depart-ready":
        this.current = {
          phase: "depart-ready",
          car: "parked",
          selected: snapshot.destination as ShopId,
        };
        return;
      case "driving-outbound": {
        const selected = snapshot.destination as ShopId;
        this.current = {
          phase: "driving-outbound",
          car: "auto-throttle",
          selected,
          controls: PARKED_CONTROLS,
          marker: CITY_DESTINATION_MARKERS[selected],
        };
        return;
      }
      case "arrived":
        this.current = {
          phase: "arrived",
          car: "parked",
          selected: snapshot.destination as ShopId,
          canEnter: true,
        };
        return;
      case "return-board": {
        const visited = snapshot.visitedShop as ShopId;
        this.visited.add(visited);
        this.current = {
          phase: "return-board",
          car: "parked",
          visited,
          returnRequired: snapshot.returnRequired,
        };
        return;
      }
      case "driving-home": {
        const visited = snapshot.visitedShop as ShopId;
        this.visited.add(visited);
        this.current = {
          phase: "driving-home",
          car: "auto-throttle",
          visited,
          controls: PARKED_CONTROLS,
        };
      }
    }
  }

  private resetSafePoseToGarage(): void {
    this.lastSafePose = {
      position: [CITY_GARAGE_POSITION[0], 0.35, CITY_GARAGE_POSITION[1]],
      headingRadians: CITY_GARAGE_HEADING,
    };
  }
}

export const CITY_DRIVE_STUB = {
  title: "Gooby City",
  controls: "Hold A/D or left/right arrows to steer; hold Space, S, down arrow, or the brake button to slow auto-throttle.",
  destinationMarkers: CITY_DESTINATION_MARKERS,
} as const;
