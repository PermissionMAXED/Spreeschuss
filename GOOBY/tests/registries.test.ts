import { describe, expect, it } from "vitest";
import { ASSET_KEYS } from "../src/core/contracts/assets";
import {
  HOME_ZONE_IDS,
  MINIGAME_IDS,
  ROUTE_REGISTRY,
  SHOP_IDS,
} from "../src/core/contracts/scenes";
import {
  MINIGAME_DEFINITIONS,
  MINIGAME_REGISTRY,
} from "../src/minigames/registry";
import {
  CITY_DESTINATIONS,
  CITY_CAR_RADIUS,
  CityDrivePhysics,
  CityRouteMachine,
  isValidCarPosition,
} from "../src/scenes/city";
import { HOME_PLACES, HOME_ZONE_STUBS } from "../src/scenes/home";
import { SHOP_EXPERIENCES, SHOP_REGISTRY } from "../src/scenes/shops";

describe("frozen registries", () => {
  it("contains every unique route and specialist module", () => {
    const expectedRouteCount = HOME_ZONE_IDS.length + SHOP_IDS.length + MINIGAME_IDS.length + 1;
    expect(new Set(ASSET_KEYS).size).toBe(ASSET_KEYS.length);
    expect(new Set(ROUTE_REGISTRY.map(({ id }) => id)).size).toBe(expectedRouteCount);
    expect(MINIGAME_REGISTRY.size).toBe(MINIGAME_IDS.length);
    expect(Object.keys(HOME_ZONE_STUBS)).toHaveLength(HOME_ZONE_IDS.length);
    expect(Object.keys(SHOP_REGISTRY)).toHaveLength(SHOP_IDS.length);
  });

  it("constructs all twelve modules with the complete minigame contract shape", () => {
    expect(MINIGAME_DEFINITIONS.map(({ id }) => id)).toEqual(MINIGAME_IDS);
    expect(new Set(MINIGAME_DEFINITIONS.map(({ id }) => id)).size).toBe(12);

    for (const id of MINIGAME_IDS) {
      const factory = MINIGAME_REGISTRY.get(id);
      expect(factory, `missing factory for ${id}`).toBeTypeOf("function");
      const module = factory?.();
      expect(module).toMatchObject({ id });
      expect(module?.title.trim().length).toBeGreaterThan(0);
      expect(module?.instructions.trim().length).toBeGreaterThan(0);
      for (const method of ["mount", "start", "pause", "resume", "update", "payout", "dispose"] as const) {
        expect(module?.[method], `${id}.${method}`).toBeTypeOf("function");
      }
    }
  });

  it("enumerates every home and city-only shop route exactly once", () => {
    const expectedRoutes = [
      ...HOME_ZONE_IDS.map((zone) => `home:${zone}` as const),
      "city:drive" as const,
      ...SHOP_IDS.map((shop) => `shop:${shop}` as const),
      ...MINIGAME_IDS.map((game) => `minigame:${game}` as const),
    ];
    expect(ROUTE_REGISTRY.map(({ id }) => id)).toEqual(expectedRoutes);
    expect(HOME_PLACES.map(({ zone }) => zone)).toEqual(HOME_ZONE_IDS);
    expect(HOME_PLACES.every(({ destination }, index) =>
      destination.kind === "home" && destination.zone === HOME_ZONE_IDS[index])).toBe(true);
    expect(Object.values(SHOP_REGISTRY).map(({ id }) => id)).toEqual(SHOP_IDS);
    expect(Object.values(SHOP_REGISTRY).every(({ routePolicy }) =>
      routePolicy === "city-arrival-only")).toBe(true);
    expect(Object.values(SHOP_EXPERIENCES).every(({ itemCount, walkable, portraitFriendly }) =>
      itemCount > 0 && walkable && portraitFriendly)).toBe(true);
  });

  it("keeps the car parked until an explicit departure", () => {
    const city = new CityRouteMachine();
    city.selectDestination("fluff-salon");
    expect(city.state).toMatchObject({ phase: "depart-ready", car: "parked" });
    city.confirmDeparture();
    expect(city.state).toMatchObject({
      phase: "driving-outbound",
      car: "auto-throttle",
      selected: "fluff-salon",
      marker: { visible: true },
    });
  });

  it("rejects arrival at a shop that was not selected", () => {
    const city = new CityRouteMachine();
    city.selectDestination("carrot-market");
    city.confirmDeparture();
    expect(() => city.arrive("cloud-boutique")).toThrow(/selected shop/u);
    city.arrive("carrot-market");
    city.openReturnBoard();
    expect(city.state).toMatchObject({ phase: "return-board", car: "parked", returnRequired: true });
  });

  it("exposes only the selected parking trigger and restores a pinned safe pose", () => {
    const city = new CityRouteMachine();
    city.selectDestination("cloud-boutique");
    city.confirmDeparture();
    expect(city.visibleParkingTrigger?.destination).toBe("cloud-boutique");
    expect(city.canTriggerArrival(
      "carrot-market",
      CITY_DESTINATIONS["carrot-market"].markerPosition,
    )).toBe(false);
    expect(city.canTriggerArrival(
      "cloud-boutique",
      CITY_DESTINATIONS["cloud-boutique"].markerPosition,
    )).toBe(true);

    city.pinSafePose([7, 0.35, -11], 0.75);
    expect(city.recoverCar("off-route")).toEqual({
      position: [7, 0.35, -11],
      headingRadians: 0.75,
    });
  });

  it("relocates an invalid physical pose onto a valid route sample", () => {
    const route = CITY_DESTINATIONS["carrot-market"].route;
    const physics = new CityDrivePhysics(route, {
      position: [9_999, -9_999],
      headingRadians: 2,
    });
    const recovered = physics.recoverNow("invalid-pose");
    expect(isValidCarPosition(recovered.position, CITY_CAR_RADIUS)).toBe(true);
    expect(physics.snapshot).toMatchObject({
      position: recovered.position,
      headingRadians: recovered.headingRadians,
      speed: 0,
      recoveryMode: "relocated",
    });
  });
});
