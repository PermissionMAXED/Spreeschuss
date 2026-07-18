import { describe, expect, it } from "vitest";
import type { ShopId } from "../../core/contracts/scenes";
import {
  CITY_BUILDINGS,
  CITY_DESTINATIONS,
  CITY_GARAGE_POSITION,
  CITY_PARKING_BAYS,
  CITY_ROADS,
  CITY_TOPOLOGY,
  CITY_TRAFFIC_LOOPS,
  CITY_WORLD_BOUNDS,
  PARKING_TRIGGER_RADIUS,
  cityLaneRoute,
  cityRoute,
  distance2d,
  pointAlongRoute,
  routeLength,
  type CityPoint,
} from ".";
import {
  CITY_ROAD_HALF_WIDTH,
  CITY_TILE_SIZE,
  buildCityTopology,
  laneLoopPolyline,
  shortestCityPath,
  type CityRoadTile,
} from "./topology";

const SHOP_IDS: readonly ShopId[] = ["carrot-market", "cloud-boutique", "fluff-salon"];

function tileContains(tile: CityRoadTile, point: CityPoint, margin = 0): boolean {
  const quarter = Math.round(tile.rotationRadians / (Math.PI / 2)) % 2;
  const halfX = quarter === 0 ? tile.width / 2 : tile.length / 2;
  const halfZ = quarter === 0 ? tile.length / 2 : tile.width / 2;
  return Math.abs(point[0] - tile.center[0]) <= halfX + margin
    && Math.abs(point[1] - tile.center[1]) <= halfZ + margin;
}

function onTiles(point: CityPoint, margin = 0): boolean {
  return CITY_TOPOLOGY.tiles.some((tile) => tileContains(tile, point, margin));
}

function distanceToSegment(point: CityPoint, from: CityPoint, to: CityPoint): number {
  const dx = to[0] - from[0];
  const dz = to[1] - from[1];
  const lengthSquared = dx * dx + dz * dz;
  const t = lengthSquared === 0
    ? 0
    : Math.max(0, Math.min(1, ((point[0] - from[0]) * dx + (point[1] - from[1]) * dz) / lengthSquared));
  return Math.hypot(point[0] - (from[0] + dx * t), point[1] - (from[1] + dz * t));
}

function distanceToNearestCurb(point: CityPoint): number {
  let best = Number.POSITIVE_INFINITY;
  for (const curb of CITY_TOPOLOGY.curbs) {
    best = Math.min(best, distanceToSegment(point, curb.from, curb.to));
  }
  return best;
}

describe("city road topology graph", () => {
  it("derives the expected junction graph from the raw road segments", () => {
    const kinds = new Map<string, number>();
    for (const node of CITY_TOPOLOGY.nodes) {
      kinds.set(node.kind, (kinds.get(node.kind) ?? 0) + 1);
    }
    expect(kinds.get("cross")).toBe(2);
    expect(kinds.get("tee")).toBe(3);
    expect(kinds.get("corner")).toBe(4);
    expect(kinds.get("end")).toBe(5);
    expect(kinds.get("straight") ?? 0).toBe(0);
    expect(CITY_TOPOLOGY.edges.length).toBe(15);
  });

  it("keeps the whole network connected from the garage", () => {
    const adjacency = new Map<string, string[]>();
    for (const edge of CITY_TOPOLOGY.edges) {
      adjacency.set(edge.from, [...(adjacency.get(edge.from) ?? []), edge.to]);
      adjacency.set(edge.to, [...(adjacency.get(edge.to) ?? []), edge.from]);
    }
    const start = CITY_TOPOLOGY.nodes.find(({ point }) =>
      distance2d(point, [0, 59]) < 0.01);
    expect(start).toBeDefined();
    const seen = new Set<string>([start?.id ?? ""]);
    const queue = [start?.id ?? ""];
    while (queue.length > 0) {
      const current = queue.pop();
      if (!current) break;
      for (const next of adjacency.get(current) ?? []) {
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    expect(seen.size).toBe(CITY_TOPOLOGY.nodes.length);
  });

  it("rebuilds deterministically from the same road data", () => {
    const rebuilt = buildCityTopology(CITY_ROADS);
    expect(rebuilt.nodes.map(({ id, kind }) => ({ id, kind })))
      .toEqual(CITY_TOPOLOGY.nodes.map(({ id, kind }) => ({ id, kind })));
    expect(rebuilt.tiles).toEqual(CITY_TOPOLOGY.tiles);
    expect(rebuilt.curbs).toEqual(CITY_TOPOLOGY.curbs);
  });
});

describe("derived road tiles", () => {
  it("uses exactly one junction fill per cross, tee and corner node", () => {
    const counts = new Map<string, number>();
    for (const tile of CITY_TOPOLOGY.tiles) {
      counts.set(tile.kind, (counts.get(tile.kind) ?? 0) + 1);
    }
    expect(counts.get("cross")).toBe(2);
    expect(counts.get("t")).toBe(3);
    expect(counts.get("corner")).toBe(4);
    expect(counts.get("straight") ?? 0).toBeGreaterThan(10);
  });

  it("covers every frozen route continuously across both lanes", () => {
    for (const shop of SHOP_IDS) {
      const route = cityRoute(shop);
      const total = routeLength(route);
      for (let distance = 0; distance <= total; distance += 0.5) {
        const sample = pointAlongRoute(route, distance);
        const headingRadians = sample.headingRadians;
        const rightX = Math.cos(headingRadians);
        const rightZ = -Math.sin(headingRadians);
        for (const lateral of [-2.4, 0, 2.4]) {
          const point: CityPoint = [
            sample.point[0] + rightX * lateral,
            sample.point[1] + rightZ * lateral,
          ];
          expect(onTiles(point, 0.01), `${shop}: tile gap at ${distance}m offset ${lateral}`).toBe(true);
        }
      }
    }
  });

  it("keeps tiles inside the world bounds and never overlapping junction fills", () => {
    for (const tile of CITY_TOPOLOGY.tiles) {
      expect(tile.length).toBeGreaterThan(0.5);
      expect(tile.length).toBeLessThanOrEqual(CITY_TILE_SIZE * 1.5 + 0.01);
      expect(tile.center[0]).toBeGreaterThan(CITY_WORLD_BOUNDS.minX);
      expect(tile.center[0]).toBeLessThan(CITY_WORLD_BOUNDS.maxX);
    }
    const junctionTiles = CITY_TOPOLOGY.tiles.filter(({ kind }) => kind !== "straight");
    for (const [indexA, a] of junctionTiles.entries()) {
      for (const [indexB, b] of junctionTiles.entries()) {
        if (indexA >= indexB) continue;
        const overlapX = Math.abs(a.center[0] - b.center[0]) < CITY_TILE_SIZE - 0.01;
        const overlapZ = Math.abs(a.center[1] - b.center[1]) < CITY_TILE_SIZE - 0.01;
        expect(overlapX && overlapZ, "junction fills overlap").toBe(false);
      }
    }
  });
});

describe("gap-free curbs", () => {
  it("lines every boundary of the tiled road surface with a curb", () => {
    const step = 0.5;
    for (let x = CITY_WORLD_BOUNDS.minX; x <= CITY_WORLD_BOUNDS.maxX; x += step) {
      for (let z = CITY_WORLD_BOUNDS.minZ; z <= CITY_WORLD_BOUNDS.maxZ; z += step) {
        const point: CityPoint = [x, z];
        if (!onTiles(point)) continue;
        const nearEdge = !onTiles([x - step, z]) || !onTiles([x + step, z])
          || !onTiles([x, z - step]) || !onTiles([x, z + step]);
        if (!nearEdge) continue;
        expect(
          distanceToNearestCurb(point),
          `curb gap near ${x.toFixed(1)}, ${z.toFixed(1)}`,
        ).toBeLessThanOrEqual(0.75);
      }
    }
  });

  it("never places a curb across the drivable road interior", () => {
    for (const curb of CITY_TOPOLOGY.curbs) {
      const length = distance2d(curb.from, curb.to);
      expect(length).toBeGreaterThan(0.5);
      const dx = (curb.to[0] - curb.from[0]) / length;
      const dz = (curb.to[1] - curb.from[1]) / length;
      const normalX = dz;
      const normalZ = -dx;
      for (let along = 0.25; along < length; along += 0.5) {
        const px = curb.from[0] + dx * along;
        const pz = curb.from[1] + dz * along;
        const sideA = onTiles([px + normalX * 0.6, pz + normalZ * 0.6]);
        const sideB = onTiles([px - normalX * 0.6, pz - normalZ * 0.6]);
        expect(
          sideA !== sideB,
          `curb crosses road interior or open ground near ${px.toFixed(1)}, ${pz.toFixed(1)}`,
        ).toBe(true);
      }
    }
  });
});

describe("shortest paths and lanes", () => {
  it("derives each frozen shop route as the shortest path from the garage", () => {
    for (const shop of SHOP_IDS) {
      const marker = CITY_DESTINATIONS[shop].markerPosition;
      const derived = shortestCityPath(
        CITY_TOPOLOGY,
        CITY_GARAGE_POSITION,
        [marker[0], marker[2]],
      );
      const frozen = cityRoute(shop);
      expect(derived.length, `${shop} waypoint count`).toBe(frozen.length);
      for (const [index, point] of derived.entries()) {
        const expected = frozen[index];
        expect(expected).toBeDefined();
        if (expected) {
          expect(distance2d(point, expected), `${shop} waypoint ${index}`).toBeLessThan(0.01);
        }
      }
    }
  });

  it("keeps lane centerlines on the road surface with curb clearance", () => {
    for (const shop of SHOP_IDS) {
      for (const direction of ["outbound", "home"] as const) {
        const lane = cityLaneRoute(shop, direction);
        expect(lane.length).toBeGreaterThan(10);
        for (const point of lane) {
          expect(onTiles(point, 0.01), `${shop} ${direction} lane leaves the road`).toBe(true);
          expect(
            distanceToNearestCurb(point),
            `${shop} ${direction} lane hugs a curb`,
          ).toBeGreaterThan(1.2);
        }
      }
    }
  });

  it("keeps every traffic lane loop on the road and clear of buildings", () => {
    for (const loop of CITY_TRAFFIC_LOOPS) {
      expect(loop.points.length).toBeGreaterThanOrEqual(4);
      for (const [index, point] of loop.points.entries()) {
        const next = loop.points[(index + 1) % loop.points.length];
        if (!next) continue;
        const segmentLength = distance2d(point, next);
        for (let along = 0; along <= segmentLength; along += 1) {
          const ratio = segmentLength === 0 ? 0 : along / segmentLength;
          const sample: CityPoint = [
            point[0] + (next[0] - point[0]) * ratio,
            point[1] + (next[1] - point[1]) * ratio,
          ];
          expect(onTiles(sample, 0.35), `traffic loop ${loop.id} leaves the road`).toBe(true);
          for (const building of CITY_BUILDINGS) {
            const inside = Math.abs(sample[0] - building.center[0]) < building.halfSize[0] + 1.2
              && Math.abs(sample[1] - building.center[1]) < building.halfSize[1] + 1.2;
            expect(inside, `traffic loop ${loop.id} clips ${building.id}`).toBe(false);
          }
        }
      }
    }
  });

  it("offsets closed loops onto the right-hand side of travel", () => {
    const clockwise = laneLoopPolyline([[-10, 10], [10, 10], [10, -10], [-10, -10]], 2);
    const first = clockwise[0];
    expect(first).toBeDefined();
    if (first) {
      expect(first[1]).toBeLessThan(10);
      expect(first[0]).toBeGreaterThan(-10);
    }
  });
});

describe("parking bays and collider clearance", () => {
  it("places a validated bay at every shop marker and the garage", () => {
    expect(CITY_PARKING_BAYS.map(({ id }) => id))
      .toEqual(["carrot-market", "cloud-boutique", "fluff-salon", "garage"]);
    for (const bay of CITY_PARKING_BAYS) {
      expect(onTiles(bay.center, 0.01), `${bay.id} bay is off the road`).toBe(true);
      if (bay.id === "garage") {
        expect(distance2d(bay.center, CITY_GARAGE_POSITION)).toBeLessThan(0.01);
        continue;
      }
      const marker = CITY_DESTINATIONS[bay.id].markerPosition;
      expect(distance2d(bay.center, [marker[0], marker[2]])).toBeLessThan(0.01);
      const route = cityRoute(bay.id);
      const arrival = pointAlongRoute(route, routeLength(route));
      expect(Math.abs(bay.headingRadians - arrival.headingRadians)).toBeLessThan(0.01);
      expect(distance2d(bay.center, [marker[0], marker[2]])).toBeLessThan(PARKING_TRIGGER_RADIUS);
    }
  });

  it("keeps every building lot clear of the tiled road surface", () => {
    for (const building of CITY_BUILDINGS) {
      for (const tile of CITY_TOPOLOGY.tiles) {
        const quarter = Math.round(tile.rotationRadians / (Math.PI / 2)) % 2;
        const halfX = quarter === 0 ? tile.width / 2 : tile.length / 2;
        const halfZ = quarter === 0 ? tile.length / 2 : tile.width / 2;
        const overlapX = Math.abs(building.center[0] - tile.center[0])
          < building.halfSize[0] + halfX - 0.05;
        const overlapZ = Math.abs(building.center[1] - tile.center[1])
          < building.halfSize[1] + halfZ - 0.05;
        expect(
          overlapX && overlapZ,
          `${building.id} intrudes into a ${tile.kind} tile at ${tile.center.join(", ")}`,
        ).toBe(false);
      }
    }
  });

  it("keeps sidewalks beside the road instead of on it", () => {
    expect(CITY_TOPOLOGY.sidewalks.length).toBeGreaterThan(20);
    for (const strip of CITY_TOPOLOGY.sidewalks) {
      expect(onTiles(strip.center), "sidewalk strip sits on the road").toBe(false);
      expect(
        distanceToNearestCurb(strip.center),
        "sidewalk strip strays from its curb",
      ).toBeLessThan(CITY_ROAD_HALF_WIDTH);
    }
  });
});
