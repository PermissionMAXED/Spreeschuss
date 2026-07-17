import type { CityDriveState, CityRouteController, DestinationMarker, ShopId } from "../../core/contracts/scenes";
import type { DriveControls } from "../../core/contracts/input";

const PARKED_CONTROLS: DriveControls = {
  steering: 0,
  braking: false,
  steeringHeld: false,
  brakeHeld: false,
};

const MARKERS: Readonly<Record<ShopId, DestinationMarker>> = {
  "carrot-market": { destination: "carrot-market", label: "Carrot Market", worldPosition: [-18, 0.2, -44], visible: true },
  "cloud-boutique": { destination: "cloud-boutique", label: "Cloud Boutique", worldPosition: [26, 0.2, -68], visible: true },
  "fluff-salon": { destination: "fluff-salon", label: "Fluff Salon", worldPosition: [42, 0.2, -31], visible: true },
};

export class CityRouteMachine implements CityRouteController {
  private current: CityDriveState = { phase: "destination-board", car: "parked", selected: null };
  private readonly visited = new Set<ShopId>();
  private lastSafePose: {
    position: readonly [number, number, number];
    headingRadians: number;
  } = { position: [0, 0.35, 0], headingRadians: 0 };

  get state(): CityDriveState {
    return this.current;
  }

  selectDestination(shop: ShopId): void {
    if (this.current.phase !== "destination-board" && this.current.phase !== "depart-ready") {
      throw new Error("Destinations can only be selected while the car is parked at the destination board");
    }
    this.current = { phase: "depart-ready", car: "parked", selected: shop };
  }

  confirmDeparture(): void {
    if (this.current.phase !== "depart-ready") throw new Error("Select a destination before departing");
    this.current = {
      phase: "driving-outbound",
      car: "auto-throttle",
      selected: this.current.selected,
      controls: PARKED_CONTROLS,
      marker: MARKERS[this.current.selected],
    };
  }

  updateControls(controls: DriveControls): void {
    if (this.current.phase === "driving-outbound") this.current = { ...this.current, controls };
    else if (this.current.phase === "driving-home") this.current = { ...this.current, controls };
  }

  arrive(shop: ShopId): void {
    if (this.current.phase !== "driving-outbound" || this.current.selected !== shop) {
      throw new Error("Only the selected shop may trigger arrival");
    }
    this.current = { phase: "arrived", car: "parked", selected: shop, canEnter: true };
  }

  openReturnBoard(): void {
    if (this.current.phase !== "arrived") throw new Error("Return board is available after a shop visit");
    const firstVisit = !this.visited.has(this.current.selected);
    this.visited.add(this.current.selected);
    this.current = {
      phase: "return-board",
      car: "parked",
      visited: this.current.selected,
      returnRequired: firstVisit,
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

  recoverCar(): {
    readonly position: readonly [number, number, number];
    readonly headingRadians: number;
  } {
    return this.lastSafePose;
  }

  pinSafePose(position: readonly [number, number, number], headingRadians: number): void {
    this.lastSafePose = { position, headingRadians };
  }
}

export const CITY_DRIVE_STUB = {
  title: "Gooby City",
  controls: "Press and hold left/right steering; press and hold brake to slow auto-throttle.",
  destinationMarkers: MARKERS,
} as const;
