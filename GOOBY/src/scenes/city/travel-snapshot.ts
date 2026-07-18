import { SHOP_IDS, type ShopId } from "../../core/contracts/scenes";
import {
  CITY_COINS,
  CITY_GARAGE_HEADING,
  CITY_GARAGE_POSITION,
  PARKING_TRIGGER_RADIUS,
  cityRoute,
  distance2d,
  isValidCarPosition,
  nearestRouteSample,
  type CityPoint,
} from "../../data/city";
import { CITY_CAR_RADIUS } from "./simulation";

export const CITY_TRAVEL_PHASES = [
  "destination-board",
  "depart-ready",
  "driving-outbound",
  "arrived",
  "return-board",
  "driving-home",
] as const;

export type CityTravelPhase = (typeof CITY_TRAVEL_PHASES)[number];

export interface CitySafeCarPose {
  readonly position: CityPoint;
  readonly headingRadians: number;
}

export interface CityCollectedRouteState {
  readonly coinIds: readonly string[];
}

/**
 * JSON-safe city-owned portion of the save contract. `destination` is populated
 * on the outbound leg; `visitedShop` is populated only after entering a shop.
 */
export interface CityTravelSnapshot {
  readonly phase: CityTravelPhase;
  readonly destination: ShopId | null;
  readonly visitedShop: ShopId | null;
  readonly returnRequired: boolean;
  readonly safeCarPose: CitySafeCarPose;
  readonly collectedRouteState: CityCollectedRouteState;
}

export const CITY_TRAVEL_SNAPSHOT_INTERVAL_SECONDS = 0.5;
export const CITY_MAX_UNSAVED_SAFE_DISTANCE_METERS = 2;

const SHOP_ID_SET: ReadonlySet<string> = new Set(SHOP_IDS);
const PHASE_SET: ReadonlySet<string> = new Set(CITY_TRAVEL_PHASES);
const COIN_ID_SET: ReadonlySet<string> = new Set(CITY_COINS.map(({ id }) => id));
const SNAPSHOT_KEYS = [
  "phase",
  "destination",
  "visitedShop",
  "returnRequired",
  "safeCarPose",
  "collectedRouteState",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

function asShopId(value: unknown): ShopId | null | undefined {
  if (value === null) return null;
  return typeof value === "string" && SHOP_ID_SET.has(value) ? value as ShopId : undefined;
}

function parsePose(value: unknown): CitySafeCarPose | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ["position", "headingRadians"])) return null;
  const position = value.position;
  const headingRadians = value.headingRadians;
  if (
    !Array.isArray(position)
    || position.length !== 2
    || !position.every((coordinate) => typeof coordinate === "number" && Number.isFinite(coordinate))
    || typeof headingRadians !== "number"
    || !Number.isFinite(headingRadians)
    || Math.abs(headingRadians) > Math.PI * 2
  ) {
    return null;
  }
  const point: CityPoint = [position[0] as number, position[1] as number];
  return isValidCarPosition(point, CITY_CAR_RADIUS)
    ? { position: point, headingRadians }
    : null;
}

function parseCollectedRouteState(value: unknown): CityCollectedRouteState | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ["coinIds"]) || !Array.isArray(value.coinIds)) return null;
  const coinIds: string[] = [];
  for (const id of value.coinIds as unknown[]) {
    if (typeof id !== "string" || !COIN_ID_SET.has(id) || coinIds.includes(id)) return null;
    coinIds.push(id);
  }
  if (coinIds.length > CITY_COINS.length) return null;
  return { coinIds };
}

function poseMatchesPhase(
  phase: CityTravelPhase,
  destination: ShopId | null,
  visitedShop: ShopId | null,
  position: CityPoint,
): boolean {
  if (phase === "destination-board" || phase === "depart-ready") {
    return distance2d(position, CITY_GARAGE_POSITION) < 0.01;
  }

  const shop = destination ?? visitedShop;
  if (!shop) return false;
  const route = cityRoute(
    shop,
    phase === "return-board" || phase === "driving-home" ? "home" : "outbound",
  );
  const sample = nearestRouteSample(position, route);
  if (sample.distanceFromRoute > 5.5) return false;
  if (phase === "arrived" || phase === "return-board") {
    const parking = route[phase === "return-board" ? 0 : route.length - 1];
    return parking !== undefined && distance2d(position, parking) <= PARKING_TRIGGER_RADIUS + 0.5;
  }
  return true;
}

/**
 * Bounds unsaved progress by physical distance as well as wall-clock cadence.
 * The scene calls this after each complete physics update, so any route-safe
 * movement that reaches the distance limit is published in the same JS task,
 * independent of frame partition or current car speed.
 */
export function shouldEmitCityTravelSnapshot(
  elapsedSeconds: number,
  lastEmittedSafePosition: CityPoint | null,
  currentSafePosition: CityPoint,
): boolean {
  return lastEmittedSafePosition === null
    || elapsedSeconds >= CITY_TRAVEL_SNAPSHOT_INTERVAL_SECONDS
    || distance2d(lastEmittedSafePosition, currentSafePosition)
      >= CITY_MAX_UNSAVED_SAFE_DISTANCE_METERS;
}

export function createSafeBoardTravelSnapshot(): CityTravelSnapshot {
  return {
    phase: "destination-board",
    destination: null,
    visitedShop: null,
    returnRequired: false,
    safeCarPose: {
      position: [CITY_GARAGE_POSITION[0], CITY_GARAGE_POSITION[1]],
      headingRadians: CITY_GARAGE_HEADING,
    },
    collectedRouteState: { coinIds: [] },
  };
}

/**
 * Validates an unknown persisted value without throwing. Inconsistent
 * `returnRequired: false` data is upgraded to a required drive unless the shop
 * was already visited, so corruption can never unlock a free first return.
 */
export function parseCityTravelSnapshot(
  input: unknown,
  visitedShops: Iterable<ShopId> = [],
): CityTravelSnapshot | null {
  if (!isRecord(input) || !hasOnlyKeys(input, SNAPSHOT_KEYS)) return null;
  if (typeof input.phase !== "string" || !PHASE_SET.has(input.phase)) return null;
  const phase = input.phase as CityTravelPhase;
  const destination = asShopId(input.destination);
  const visitedShop = asShopId(input.visitedShop);
  if (destination === undefined || visitedShop === undefined || typeof input.returnRequired !== "boolean") return null;
  const pose = parsePose(input.safeCarPose);
  const collectedRouteState = parseCollectedRouteState(input.collectedRouteState);
  if (!pose || !collectedRouteState) return null;

  const outbound = phase === "depart-ready" || phase === "driving-outbound" || phase === "arrived";
  const returning = phase === "return-board" || phase === "driving-home";
  if (
    (phase === "destination-board" && (destination !== null || visitedShop !== null))
    || (outbound && (destination === null || visitedShop !== null))
    || (returning && (destination !== null || visitedShop === null))
    || !poseMatchesPhase(phase, destination, visitedShop, pose.position)
  ) {
    return null;
  }

  const visited = new Set(visitedShops);
  const tripShop = destination ?? visitedShop;
  const returnRequired = tripShop && !visited.has(tripShop)
    ? true
    : input.returnRequired;
  return {
    phase,
    destination,
    visitedShop,
    returnRequired: phase === "destination-board" ? false : returnRequired,
    safeCarPose: {
      position: [pose.position[0], pose.position[1]],
      headingRadians: pose.headingRadians,
    },
    collectedRouteState,
  };
}
