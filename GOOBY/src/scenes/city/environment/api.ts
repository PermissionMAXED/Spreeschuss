import type { ShopId } from "../../../core/contracts/scenes";
import {
  CITY_BOOST_PADS,
  CITY_BUILDINGS,
  CITY_COINS,
  CITY_DESTINATIONS,
  CITY_DISTRICTS,
  CITY_GARAGE_HEADING,
  CITY_GARAGE_POSITION,
  CITY_LANE_OFFSET,
  CITY_PARKING_BAYS,
  CITY_ROAD_WIDTH,
  CITY_ROADS,
  CITY_SIDEWALK_WIDTH,
  CITY_TOPOLOGY,
  CITY_WORLD_BOUNDS,
  cityLaneRoute,
  cityRoute,
  isPointInWorld,
  isPointOnRoad,
  isValidCarPosition,
  laneLoopPolyline,
  laneRoutePolyline,
  nearestRouteSample,
  pointAlongRoute,
  routeLength,
  shortestCityPath,
  type CityBuildingLot,
  type CityDestination,
  type CityDistrict,
  type CityParkingBay,
  type CityPickup,
  type CityPoint,
  type CityRoad,
  type CityRoadTopology,
} from "../../../data/city";
import { CITY_CURATED_KEYS, type CityCuratedKey } from "./procedural";

/**
 * FROZEN CONTRACT — Shared city environment surface for Shopping Surf.
 *
 * This file exports the immutable, read-only view of the Gooby City
 * environment: the topology-driven road graph (nodes/edges/tiles/curbs/
 * sidewalks), lane and routing helpers, parking bays, world bounds, and the
 * curated asset keys the environment is rendered with. Downstream features
 * (Shopping Surf) must consume the city exclusively through this API; the
 * shapes below must not change without a coordinated contract review.
 */

export interface CityEnvironmentGeometry {
  readonly roadWidth: number;
  readonly laneOffset: number;
  readonly sidewalkWidth: number;
  readonly worldBounds: typeof CITY_WORLD_BOUNDS;
}

export interface CityEnvironmentPlaces {
  readonly districts: readonly CityDistrict[];
  readonly roads: readonly CityRoad[];
  readonly buildings: readonly CityBuildingLot[];
  readonly destinations: Readonly<Record<ShopId, CityDestination>>;
  readonly parkingBays: readonly CityParkingBay[];
  readonly coins: readonly CityPickup[];
  readonly boostPads: readonly CityPickup[];
  readonly garage: {
    readonly position: CityPoint;
    readonly headingRadians: number;
  };
}

export interface CityEnvironmentRouting {
  route(shop: ShopId, direction?: "outbound" | "home"): readonly CityPoint[];
  laneRoute(shop: ShopId, direction?: "outbound" | "home"): readonly CityPoint[];
  shortestPath(from: CityPoint, to: CityPoint): readonly CityPoint[];
  lanePolyline(route: readonly CityPoint[], laneOffset?: number): readonly CityPoint[];
  laneLoop(loop: readonly CityPoint[], laneOffset?: number): readonly CityPoint[];
  routeLength(route: readonly CityPoint[]): number;
  pointAlongRoute(route: readonly CityPoint[], distanceAlong: number): {
    readonly point: CityPoint;
    readonly headingRadians: number;
  };
  nearestRouteSample(position: CityPoint, route: readonly CityPoint[]): {
    readonly point: CityPoint;
    readonly headingRadians: number;
    readonly distanceFromRoute: number;
    readonly distanceAlongRoute: number;
    readonly remainingDistance: number;
  };
}

export interface CityEnvironmentColliders {
  isPointOnRoad(position: CityPoint, margin?: number): boolean;
  isPointInWorld(position: CityPoint, margin?: number): boolean;
  isValidCarPosition(position: CityPoint, radius: number): boolean;
}

export interface CityEnvironmentApi {
  readonly version: 1;
  readonly topology: CityRoadTopology;
  readonly geometry: CityEnvironmentGeometry;
  readonly places: CityEnvironmentPlaces;
  readonly routing: CityEnvironmentRouting;
  readonly colliders: CityEnvironmentColliders;
  readonly curatedAssetKeys: readonly CityCuratedKey[];
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return Object.freeze(value);
}

export const CITY_ENVIRONMENT_API: CityEnvironmentApi = deepFreeze<CityEnvironmentApi>({
  version: 1,
  topology: CITY_TOPOLOGY,
  geometry: {
    roadWidth: CITY_ROAD_WIDTH,
    laneOffset: CITY_LANE_OFFSET,
    sidewalkWidth: CITY_SIDEWALK_WIDTH,
    worldBounds: CITY_WORLD_BOUNDS,
  },
  places: {
    districts: CITY_DISTRICTS,
    roads: CITY_ROADS,
    buildings: CITY_BUILDINGS,
    destinations: CITY_DESTINATIONS,
    parkingBays: CITY_PARKING_BAYS,
    coins: CITY_COINS,
    boostPads: CITY_BOOST_PADS,
    garage: {
      position: CITY_GARAGE_POSITION,
      headingRadians: CITY_GARAGE_HEADING,
    },
  },
  routing: {
    route: (shop, direction = "outbound") => cityRoute(shop, direction),
    laneRoute: (shop, direction = "outbound") => cityLaneRoute(shop, direction),
    shortestPath: (from, to) => shortestCityPath(CITY_TOPOLOGY, from, to),
    lanePolyline: (route, laneOffset) => laneRoutePolyline(route, laneOffset),
    laneLoop: (loop, laneOffset) => laneLoopPolyline(loop, laneOffset),
    routeLength: (route) => routeLength(route),
    pointAlongRoute: (route, distanceAlong) => pointAlongRoute(route, distanceAlong),
    nearestRouteSample: (position, route) => nearestRouteSample(position, route),
  },
  colliders: {
    isPointOnRoad: (position, margin) => isPointOnRoad(position, margin),
    isPointInWorld: (position, margin) => isPointInWorld(position, margin),
    isValidCarPosition: (position, radius) => isValidCarPosition(position, radius),
  },
  curatedAssetKeys: CITY_CURATED_KEYS,
});

export function getCityEnvironment(): CityEnvironmentApi {
  return CITY_ENVIRONMENT_API;
}

export type { CityCuratedKey } from "./procedural";
export type {
  CityBuildingLot,
  CityDestination,
  CityDistrict,
  CityParkingBay,
  CityPickup,
  CityPoint,
  CityRoad,
  CityRoadTopology,
} from "../../../data/city";
