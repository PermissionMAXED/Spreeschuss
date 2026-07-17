import { describe, expect, it } from "vitest";
import { ASSET_KEYS } from "../src/core/contracts/assets";
import {
  HOME_ZONE_IDS,
  MINIGAME_IDS,
  ROUTE_REGISTRY,
  SHOP_IDS,
} from "../src/core/contracts/scenes";
import { MINIGAME_REGISTRY } from "../src/minigames/registry";
import { CityRouteMachine } from "../src/scenes/city";
import { HOME_ZONE_STUBS } from "../src/scenes/home";
import { SHOP_REGISTRY } from "../src/scenes/shops";

describe("frozen registries", () => {
  it("contains every unique route and specialist module", () => {
    const expectedRouteCount = HOME_ZONE_IDS.length + SHOP_IDS.length + MINIGAME_IDS.length + 1;
    expect(new Set(ASSET_KEYS).size).toBe(ASSET_KEYS.length);
    expect(new Set(ROUTE_REGISTRY.map(({ id }) => id)).size).toBe(expectedRouteCount);
    expect(MINIGAME_REGISTRY.size).toBe(MINIGAME_IDS.length);
    expect(Object.keys(HOME_ZONE_STUBS)).toHaveLength(HOME_ZONE_IDS.length);
    expect(Object.keys(SHOP_REGISTRY)).toHaveLength(SHOP_IDS.length);
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
});
