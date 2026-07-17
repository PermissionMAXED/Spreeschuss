import type { ShopId } from "../../core/contracts/scenes";

export type CityPoint = readonly [x: number, z: number];

export interface CityRoad {
  readonly id: string;
  readonly from: CityPoint;
  readonly to: CityPoint;
  readonly width: number;
  readonly district: CityDistrictId;
}

export type CityDistrictId = "suburb" | "park" | "downtown" | "old-town" | "promenade";

export interface CityDistrict {
  readonly id: CityDistrictId;
  readonly label: string;
  readonly center: CityPoint;
  readonly size: CityPoint;
  readonly groundColor: number;
}

export interface CityBuildingLot {
  readonly id: string;
  readonly center: CityPoint;
  readonly halfSize: CityPoint;
  readonly height: number;
  readonly color: number;
  readonly district: CityDistrictId;
  readonly shop: ShopId | null;
}

export interface CityDestination {
  readonly id: ShopId;
  readonly label: string;
  readonly districtLabel: string;
  readonly markerPosition: readonly [number, number, number];
  readonly route: readonly CityPoint[];
  readonly buildingLotId: string;
}

export interface CityPickup {
  readonly id: string;
  readonly position: CityPoint;
}

export interface CityTrafficLoop {
  readonly id: string;
  readonly points: readonly CityPoint[];
  readonly speed: number;
  readonly phase: number;
}

export const CITY_WORLD_BOUNDS = {
  minX: -58,
  maxX: 58,
  minZ: -82,
  maxZ: 64,
} as const;

export const CITY_GARAGE_POSITION: CityPoint = [0, 52];
export const CITY_GARAGE_HEADING = Math.PI;
export const PARKING_TRIGGER_RADIUS = 3.6;
export const GARAGE_TRIGGER_RADIUS = 4.2;
export const COIN_PICKUP_RADIUS = 1.35;
export const BOOST_PICKUP_RADIUS = 2;

export const CITY_DISTRICTS: readonly CityDistrict[] = [
  { id: "suburb", label: "Maple Suburb", center: [25, 38], size: [54, 38], groundColor: 0xbdd39d },
  { id: "park", label: "Bunbury Park", center: [-28, 5], size: [45, 46], groundColor: 0x9fc986 },
  { id: "downtown", label: "Grocery / Downtown", center: [-30, -48], size: [48, 46], groundColor: 0xd9c2a3 },
  { id: "old-town", label: "Furniture / Old Town", center: [34, -29], size: [46, 35], groundColor: 0xd7b58d },
  { id: "promenade", label: "Boutique / Promenade", center: [27, -68], size: [51, 20], groundColor: 0xe7c2b1 },
] as const;

export const CITY_ROADS: readonly CityRoad[] = [
  { id: "main-avenue", from: [0, 59], to: [0, -74], width: 11, district: "suburb" },
  { id: "market-street", from: [3, -44], to: [-24, -44], width: 11, district: "downtown" },
  { id: "promenade-way", from: [-3, -68], to: [31, -68], width: 11, district: "promenade" },
  { id: "old-town-lane", from: [-3, -31], to: [47, -31], width: 11, district: "old-town" },
  { id: "park-loop-north", from: [-39, 22], to: [39, 22], width: 8, district: "park" },
  { id: "park-loop-west", from: [-39, 22], to: [-39, -16], width: 8, district: "park" },
  { id: "park-loop-east", from: [39, 22], to: [39, -16], width: 8, district: "old-town" },
  { id: "park-loop-south", from: [-39, -16], to: [39, -16], width: 8, district: "park" },
] as const;

export const CITY_DESTINATIONS: Readonly<Record<ShopId, CityDestination>> = {
  "carrot-market": {
    id: "carrot-market",
    label: "Carrot Market",
    districtLabel: "Grocery / Downtown",
    markerPosition: [-18, 0.2, -44],
    route: [CITY_GARAGE_POSITION, [0, -44], [-18, -44]],
    buildingLotId: "carrot-market",
  },
  "cloud-boutique": {
    id: "cloud-boutique",
    label: "Cloud Boutique",
    districtLabel: "Boutique / Promenade",
    markerPosition: [26, 0.2, -68],
    route: [CITY_GARAGE_POSITION, [0, -68], [26, -68]],
    buildingLotId: "cloud-boutique",
  },
  "fluff-salon": {
    id: "fluff-salon",
    label: "Fluff Salon",
    districtLabel: "Furniture / Old Town",
    markerPosition: [42, 0.2, -31],
    route: [CITY_GARAGE_POSITION, [0, -31], [42, -31]],
    buildingLotId: "fluff-salon",
  },
} as const;

export const CITY_BUILDINGS: readonly CityBuildingLot[] = [
  {
    id: "carrot-market",
    center: [-18, -52.5],
    halfSize: [5.2, 3.7],
    height: 6.8,
    color: 0xf0a04e,
    district: "downtown",
    shop: "carrot-market",
  },
  {
    id: "cloud-boutique",
    center: [26, -76],
    halfSize: [6.2, 3.6],
    height: 7.6,
    color: 0xbca8df,
    district: "promenade",
    shop: "cloud-boutique",
  },
  {
    id: "fluff-salon",
    center: [42, -39],
    halfSize: [5.4, 3.7],
    height: 6.2,
    color: 0xe8a8b8,
    district: "old-town",
    shop: "fluff-salon",
  },
  { id: "grocery-row-a", center: [-35, -38], halfSize: [7, 4], height: 8, color: 0xe3b36f, district: "downtown", shop: null },
  { id: "grocery-row-b", center: [-34, -58], halfSize: [8, 5], height: 10, color: 0xc98d6b, district: "downtown", shop: null },
  { id: "downtown-corner", center: [-12, -58], halfSize: [4.7, 4.2], height: 11, color: 0xe0c18b, district: "downtown", shop: null },
  { id: "old-clock-house", center: [16, -40], halfSize: [5.2, 3.7], height: 7.8, color: 0xbe8d6a, district: "old-town", shop: null },
  { id: "furniture-row", center: [29, -22], halfSize: [7, 3.5], height: 6.4, color: 0xcd9f72, district: "old-town", shop: null },
  { id: "promenade-cafe", center: [12, -77], halfSize: [4.4, 3.2], height: 5.7, color: 0xe7aa8f, district: "promenade", shop: null },
  { id: "promenade-gallery", center: [43, -69], halfSize: [5.2, 4.4], height: 8.2, color: 0xc99bc0, district: "promenade", shop: null },
  { id: "suburb-home-a", center: [15, 42], halfSize: [5, 4], height: 5.4, color: 0xe9bc82, district: "suburb", shop: null },
  { id: "suburb-home-b", center: [34, 42], halfSize: [5.5, 4], height: 5.8, color: 0xc7a7d8, district: "suburb", shop: null },
  { id: "suburb-home-c", center: [22, 29], halfSize: [5, 3.8], height: 5.2, color: 0x91bfd2, district: "suburb", shop: null },
  { id: "suburb-home-d", center: [-18, 43], halfSize: [5.5, 4], height: 5.8, color: 0xdfaa8c, district: "suburb", shop: null },
] as const;

export const CITY_COINS: readonly CityPickup[] = [
  { id: "coin-garage", position: [0, 41] },
  { id: "coin-maple", position: [0, 27] },
  { id: "coin-park", position: [0, 10] },
  { id: "coin-avenue", position: [0, -7] },
  { id: "coin-old-town-turn", position: [0, -27] },
  { id: "coin-market-turn", position: [-2, -44] },
  { id: "coin-market", position: [-11, -44] },
  { id: "coin-salon", position: [25, -31] },
  { id: "coin-promenade-turn", position: [2, -68] },
  { id: "coin-promenade", position: [16, -68] },
] as const;

export const CITY_BOOST_PADS: readonly CityPickup[] = [
  { id: "boost-maple", position: [0, 33] },
  { id: "boost-avenue", position: [0, -17] },
  { id: "boost-market", position: [-8, -44] },
  { id: "boost-old-town", position: [15, -31] },
  { id: "boost-promenade", position: [10, -68] },
] as const;

export const CITY_TRAFFIC_LOOPS: readonly CityTrafficLoop[] = [
  {
    id: "parkwise",
    points: [[-35, 22], [35, 22], [35, -16], [-35, -16]],
    speed: 7.2,
    phase: 0.08,
  },
  {
    id: "clockwise",
    points: [[35, -16], [35, 22], [-35, 22], [-35, -16]],
    speed: 6.4,
    phase: 0.53,
  },
  {
    id: "main-local",
    points: [[3.2, 48], [3.2, -61], [-3.2, -61], [-3.2, 48]],
    speed: 8,
    phase: 0.27,
  },
] as const;

export const CITY_TREE_POSITIONS: readonly CityPoint[] = [
  [-49, 48], [-42, 39], [-48, 28], [-28, 34], [-51, 12], [-45, 1], [-48, -10],
  [-31, 14], [-23, 17], [-31, 2], [-22, -8], [-31, -12], [48, 51], [42, 39],
  [51, 27], [23, 53], [48, 8], [50, -7], [18, 15], [27, 12], [19, 2], [29, -7],
] as const;

export const CITY_LAMP_POSITIONS: readonly CityPoint[] = [
  [-6.5, 49], [6.5, 40], [-6.5, 31], [6.5, 21], [-6.5, 10], [6.5, 0],
  [-6.5, -10], [6.5, -21], [-6.5, -34], [6.5, -47], [-6.5, -59],
  [-12, -38], [-21, -50], [13, -25], [27, -37], [15, -62], [28, -73],
] as const;

export function distance2d(a: CityPoint, b: CityPoint): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

export function cityRoute(shop: ShopId, direction: "outbound" | "home" = "outbound"): readonly CityPoint[] {
  const route = CITY_DESTINATIONS[shop].route;
  return direction === "outbound" ? route : [...route].reverse();
}

export function routeLength(route: readonly CityPoint[]): number {
  let total = 0;
  for (let index = 1; index < route.length; index += 1) {
    const from = route[index - 1];
    const to = route[index];
    if (from && to) total += distance2d(from, to);
  }
  return total;
}

export function pointAlongRoute(route: readonly CityPoint[], distanceAlong: number): {
  readonly point: CityPoint;
  readonly headingRadians: number;
} {
  if (route.length < 2) throw new RangeError("A city route requires at least two points");
  let remaining = Math.max(0, distanceAlong);
  for (let index = 1; index < route.length; index += 1) {
    const from = route[index - 1];
    const to = route[index];
    if (!from || !to) continue;
    const segmentLength = distance2d(from, to);
    if (remaining <= segmentLength || index === route.length - 1) {
      const ratio = segmentLength === 0 ? 0 : Math.min(1, remaining / segmentLength);
      return {
        point: [
          from[0] + (to[0] - from[0]) * ratio,
          from[1] + (to[1] - from[1]) * ratio,
        ],
        headingRadians: Math.atan2(to[0] - from[0], to[1] - from[1]),
      };
    }
    remaining -= segmentLength;
  }
  const last = route.at(-1);
  const previous = route.at(-2);
  if (!last || !previous) throw new RangeError("A city route requires at least two points");
  return {
    point: last,
    headingRadians: Math.atan2(last[0] - previous[0], last[1] - previous[1]),
  };
}

export function nearestRouteSample(position: CityPoint, route: readonly CityPoint[]): {
  readonly point: CityPoint;
  readonly headingRadians: number;
  readonly distanceFromRoute: number;
  readonly distanceAlongRoute: number;
  readonly remainingDistance: number;
} {
  if (route.length < 2) throw new RangeError("A city route requires at least two points");
  let bestDistance = Number.POSITIVE_INFINITY;
  let bestPoint: CityPoint = route[0] ?? [0, 0];
  let bestHeading = 0;
  let bestAlong = 0;
  let traversed = 0;
  const total = routeLength(route);

  for (let index = 1; index < route.length; index += 1) {
    const from = route[index - 1];
    const to = route[index];
    if (!from || !to) continue;
    const dx = to[0] - from[0];
    const dz = to[1] - from[1];
    const squaredLength = dx * dx + dz * dz;
    const projection = squaredLength === 0
      ? 0
      : Math.max(0, Math.min(1, ((position[0] - from[0]) * dx + (position[1] - from[1]) * dz) / squaredLength));
    const point: CityPoint = [from[0] + dx * projection, from[1] + dz * projection];
    const candidateDistance = distance2d(position, point);
    const segmentLength = Math.sqrt(squaredLength);
    if (candidateDistance < bestDistance) {
      bestDistance = candidateDistance;
      bestPoint = point;
      bestHeading = Math.atan2(dx, dz);
      bestAlong = traversed + segmentLength * projection;
    }
    traversed += segmentLength;
  }

  return {
    point: bestPoint,
    headingRadians: bestHeading,
    distanceFromRoute: bestDistance,
    distanceAlongRoute: bestAlong,
    remainingDistance: Math.max(0, total - bestAlong) + bestDistance,
  };
}

export function isPointInWorld(position: CityPoint, margin = 0): boolean {
  return position[0] >= CITY_WORLD_BOUNDS.minX + margin
    && position[0] <= CITY_WORLD_BOUNDS.maxX - margin
    && position[1] >= CITY_WORLD_BOUNDS.minZ + margin
    && position[1] <= CITY_WORLD_BOUNDS.maxZ - margin;
}

export function circleIntersectsBuilding(position: CityPoint, radius: number, building: CityBuildingLot): boolean {
  const closestX = Math.max(
    building.center[0] - building.halfSize[0],
    Math.min(position[0], building.center[0] + building.halfSize[0]),
  );
  const closestZ = Math.max(
    building.center[1] - building.halfSize[1],
    Math.min(position[1], building.center[1] + building.halfSize[1]),
  );
  return Math.hypot(position[0] - closestX, position[1] - closestZ) < radius;
}

export function distanceToRoad(position: CityPoint, road: CityRoad): number {
  const nearest = nearestRouteSample(position, [road.from, road.to]);
  return nearest.distanceFromRoute;
}

export function isPointOnRoad(position: CityPoint, margin = 0): boolean {
  return CITY_ROADS.some((road) => distanceToRoad(position, road) <= road.width / 2 - margin);
}

export function isValidCarPosition(position: CityPoint, radius: number): boolean {
  return isPointInWorld(position, radius)
    && !CITY_BUILDINGS.some((building) => circleIntersectsBuilding(position, radius, building));
}

export function districtAt(position: CityPoint): CityDistrict {
  return CITY_DISTRICTS.reduce((closest, district) =>
    distance2d(position, district.center) < distance2d(position, closest.center) ? district : closest);
}
