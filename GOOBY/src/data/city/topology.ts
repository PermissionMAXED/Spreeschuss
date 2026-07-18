import type { ShopId } from "../../core/contracts/scenes";
import type { CityPoint, CityRoad } from "./index";

/**
 * Topology-driven road network. Every road in `CITY_ROADS` is an axis-aligned
 * centerline segment; this module derives the shared junction graph from the
 * raw segments: nodes (junctions, corners, dead ends), edges between them,
 * drivable lanes, tile placements (straight / corner / T / 4-way with
 * continuous junction fills), gap-free curb segments, sidewalk strips, and
 * parking bays. The same data drives rendering, colliders, traffic and the
 * shortest-path routing used to validate the frozen shop routes.
 */

export const CITY_ROAD_WIDTH = 10;
export const CITY_ROAD_HALF_WIDTH = CITY_ROAD_WIDTH / 2;
export const CITY_TILE_SIZE = CITY_ROAD_WIDTH;
export const CITY_LANE_OFFSET = 2.5;
export const CITY_SIDEWALK_WIDTH = 1.6;
export const CITY_CURB_HEIGHT = 0.09;

/** Direction indices: 0 → +z, 1 → +x, 2 → −z, 3 → −x. */
export type CityDirectionIndex = 0 | 1 | 2 | 3;

export const CITY_DIRECTION_VECTORS: readonly (readonly [number, number])[] = [
  [0, 1],
  [1, 0],
  [0, -1],
  [-1, 0],
] as const;

export type CityNodeKind = "end" | "straight" | "corner" | "tee" | "cross";
export type CityTileKind = "straight" | "corner" | "t" | "cross";

export interface CityGraphArm {
  readonly direction: CityDirectionIndex;
  readonly edgeId: string;
}

export interface CityGraphNode {
  readonly id: string;
  readonly point: CityPoint;
  readonly kind: CityNodeKind;
  readonly arms: readonly CityGraphArm[];
}

export interface CityGraphEdge {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly axis: "x" | "z";
  readonly length: number;
  readonly roadId: string;
}

export interface CityRoadTile {
  readonly kind: CityTileKind;
  readonly center: CityPoint;
  /** Yaw applied to a canonical tile (atan2(dx, dz) convention). */
  readonly rotationRadians: number;
  /** Size along the tile's local z axis after rotation. */
  readonly length: number;
  readonly width: number;
}

export interface CityCurbSegment {
  readonly from: CityPoint;
  readonly to: CityPoint;
}

export interface CitySidewalkStrip {
  readonly center: CityPoint;
  readonly halfSize: CityPoint;
}

export interface CityParkingBay {
  readonly id: ShopId | "garage";
  readonly center: CityPoint;
  /** Travel heading a car should hold while rolling into the bay. */
  readonly headingRadians: number;
  readonly halfLength: number;
  readonly halfWidth: number;
}

export interface CityLanePolyline {
  readonly id: string;
  readonly points: readonly CityPoint[];
  readonly closed: boolean;
}

export interface CityRoadTopology {
  readonly nodes: readonly CityGraphNode[];
  readonly edges: readonly CityGraphEdge[];
  readonly tiles: readonly CityRoadTile[];
  readonly curbs: readonly CityCurbSegment[];
  readonly sidewalks: readonly CitySidewalkStrip[];
}

const EPSILON = 1e-6;

function pointKey(point: CityPoint): string {
  return `${point[0].toFixed(3)},${point[1].toFixed(3)}`;
}

function directionBetween(from: CityPoint, to: CityPoint): CityDirectionIndex {
  const dx = to[0] - from[0];
  const dz = to[1] - from[1];
  if (Math.abs(dx) > Math.abs(dz)) return dx > 0 ? 1 : 3;
  return dz > 0 ? 0 : 2;
}

function directionHeading(direction: CityDirectionIndex): number {
  const vector = CITY_DIRECTION_VECTORS[direction] ?? [0, 1];
  return Math.atan2(vector[0], vector[1]);
}

interface RawSegment {
  readonly roadId: string;
  readonly axis: "x" | "z";
  /** Fixed coordinate (z for axis "x" roads, x for axis "z" roads). */
  readonly fixed: number;
  readonly min: number;
  readonly max: number;
}

function toRawSegment(road: CityRoad): RawSegment {
  const [fromX, fromZ] = road.from;
  const [toX, toZ] = road.to;
  if (Math.abs(fromX - toX) < EPSILON) {
    return {
      roadId: road.id,
      axis: "z",
      fixed: fromX,
      min: Math.min(fromZ, toZ),
      max: Math.max(fromZ, toZ),
    };
  }
  if (Math.abs(fromZ - toZ) < EPSILON) {
    return {
      roadId: road.id,
      axis: "x",
      fixed: fromZ,
      min: Math.min(fromX, toX),
      max: Math.max(fromX, toX),
    };
  }
  throw new RangeError(`City roads must be axis aligned: ${road.id}`);
}

function segmentPoint(segment: RawSegment, along: number): CityPoint {
  return segment.axis === "z" ? [segment.fixed, along] : [along, segment.fixed];
}

/**
 * Builds the shared junction graph from raw road centerlines. Segments are
 * split at every centerline crossing; stubs that end inside another node's
 * junction square are absorbed into that junction.
 */
export function buildCityTopology(roads: readonly CityRoad[]): CityRoadTopology {
  const segments = roads.map(toRawSegment);

  const nodePoints = new Map<string, CityPoint>();
  const registerNode = (point: CityPoint): string => {
    const key = pointKey(point);
    if (!nodePoints.has(key)) nodePoints.set(key, point);
    return key;
  };

  const cutsBySegment: number[][] = segments.map((segment) => [segment.min, segment.max]);
  for (const [indexA, a] of segments.entries()) {
    for (const [indexB, b] of segments.entries()) {
      if (indexA >= indexB || a.axis === b.axis) continue;
      const crossing: CityPoint = a.axis === "z" ? [a.fixed, b.fixed] : [b.fixed, a.fixed];
      const alongA = a.axis === "z" ? crossing[1] : crossing[0];
      const alongB = b.axis === "z" ? crossing[1] : crossing[0];
      const withinA = alongA >= a.min - CITY_ROAD_HALF_WIDTH && alongA <= a.max + CITY_ROAD_HALF_WIDTH;
      const withinB = alongB >= b.min - CITY_ROAD_HALF_WIDTH && alongB <= b.max + CITY_ROAD_HALF_WIDTH;
      if (!withinA || !withinB) continue;
      const cutsA = cutsBySegment[indexA];
      const cutsB = cutsBySegment[indexB];
      if (cutsA && alongA > a.min - EPSILON && alongA < a.max + EPSILON) cutsA.push(alongA);
      if (cutsB && alongB > b.min - EPSILON && alongB < b.max + EPSILON) cutsB.push(alongB);
      registerNode(crossing);
    }
  }

  interface PendingEdge {
    readonly roadId: string;
    readonly axis: "x" | "z";
    readonly fromPoint: CityPoint;
    readonly toPoint: CityPoint;
  }
  const pendingEdges: PendingEdge[] = [];
  for (const [index, segment] of segments.entries()) {
    const cuts = [...new Set((cutsBySegment[index] ?? []).map((cut) => Number(cut.toFixed(3))))]
      .sort((left, right) => left - right);
    for (let cutIndex = 1; cutIndex < cuts.length; cutIndex += 1) {
      const from = cuts[cutIndex - 1];
      const to = cuts[cutIndex];
      if (from === undefined || to === undefined) continue;
      if (to - from <= CITY_ROAD_HALF_WIDTH + EPSILON) {
        // A stub shorter than the junction square is absorbed by the junction.
        const insideJunction = nodePoints.has(pointKey(segmentPoint(segment, from)))
          || nodePoints.has(pointKey(segmentPoint(segment, to)));
        if (insideJunction) continue;
      }
      pendingEdges.push({
        roadId: segment.roadId,
        axis: segment.axis,
        fromPoint: segmentPoint(segment, from),
        toPoint: segmentPoint(segment, to),
      });
      registerNode(segmentPoint(segment, from));
      registerNode(segmentPoint(segment, to));
    }
  }

  const armsByNode = new Map<string, CityGraphArm[]>();
  const edges: CityGraphEdge[] = [];
  for (const [index, pending] of pendingEdges.entries()) {
    const fromKey = registerNode(pending.fromPoint);
    const toKey = registerNode(pending.toPoint);
    const id = `edge-${pending.roadId}-${index}`;
    edges.push({
      id,
      from: fromKey,
      to: toKey,
      axis: pending.axis,
      length: Math.hypot(
        pending.toPoint[0] - pending.fromPoint[0],
        pending.toPoint[1] - pending.fromPoint[1],
      ),
      roadId: pending.roadId,
    });
    const fromArms = armsByNode.get(fromKey) ?? [];
    fromArms.push({ direction: directionBetween(pending.fromPoint, pending.toPoint), edgeId: id });
    armsByNode.set(fromKey, fromArms);
    const toArms = armsByNode.get(toKey) ?? [];
    toArms.push({ direction: directionBetween(pending.toPoint, pending.fromPoint), edgeId: id });
    armsByNode.set(toKey, toArms);
  }

  const nodes: CityGraphNode[] = [...nodePoints.entries()].map(([id, point]) => {
    const arms = [...(armsByNode.get(id) ?? [])].sort((a, b) => a.direction - b.direction);
    let kind: CityNodeKind;
    if (arms.length <= 1) kind = "end";
    else if (arms.length === 2) {
      const [a, b] = arms as [CityGraphArm, CityGraphArm];
      kind = (a.direction + 2) % 4 === b.direction ? "straight" : "corner";
    } else if (arms.length === 3) kind = "tee";
    else kind = "cross";
    return { id, point, kind, arms };
  });

  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const tiles = deriveTiles(nodes, edges, nodeById);
  const curbs = deriveCurbs(nodes, edges, nodeById);
  const sidewalks = deriveSidewalks(nodes, edges, nodeById, segments);

  return { nodes, edges, tiles, curbs, sidewalks };
}

function nodeSquareBoundary(node: CityGraphNode, direction: CityDirectionIndex): CityPoint {
  const vector = CITY_DIRECTION_VECTORS[direction] ?? [0, 1];
  return [
    node.point[0] + vector[0] * CITY_ROAD_HALF_WIDTH,
    node.point[1] + vector[1] * CITY_ROAD_HALF_WIDTH,
  ];
}

function nodeTile(node: CityGraphNode): CityRoadTile {
  const directions = node.arms.map(({ direction }) => direction);
  const has = (direction: number): boolean => directions.includes(((direction % 4) + 4) % 4 as CityDirectionIndex);
  let kind: CityTileKind = "straight";
  let rotationRadians = 0;
  if (node.kind === "cross") {
    kind = "cross";
  } else if (node.kind === "tee") {
    kind = "t";
    // Canonical T is open toward +z/−z/+x with the flat edge on the −x side.
    for (let quarterTurns = 0; quarterTurns < 4; quarterTurns += 1) {
      if (!has(3 + quarterTurns)) {
        rotationRadians = quarterTurns * (Math.PI / 2);
        break;
      }
    }
  } else if (node.kind === "corner") {
    kind = "corner";
    // Canonical corner connects the +x and −z arms.
    for (let quarterTurns = 0; quarterTurns < 4; quarterTurns += 1) {
      if (has(1 + quarterTurns) && has(2 + quarterTurns)) {
        rotationRadians = quarterTurns * (Math.PI / 2);
        break;
      }
    }
  } else {
    // Dead ends and pass-through nodes reuse the straight tile.
    const arm = node.arms[0];
    const axisDirection = arm ? arm.direction : 0;
    rotationRadians = axisDirection === 1 || axisDirection === 3 ? Math.PI / 2 : 0;
  }
  return {
    kind,
    center: node.point,
    rotationRadians,
    length: CITY_TILE_SIZE,
    width: CITY_TILE_SIZE,
  };
}

function deriveTiles(
  nodes: readonly CityGraphNode[],
  edges: readonly CityGraphEdge[],
  nodeById: ReadonlyMap<string, CityGraphNode>,
): readonly CityRoadTile[] {
  const tiles: CityRoadTile[] = [];
  for (const node of nodes) {
    if (node.kind !== "end") {
      tiles.push(nodeTile(node));
      continue;
    }
    // Dead-end squares are clipped so overlapping neighbour junction fills
    // do not z-fight; the rounded overhang past the endpoint stays covered.
    const arm = node.arms[0];
    if (!arm) {
      tiles.push(nodeTile(node));
      continue;
    }
    const edge = edges.find(({ id }) => id === arm.edgeId);
    const vector = CITY_DIRECTION_VECTORS[arm.direction] ?? [0, 1];
    const outer: CityPoint = [
      node.point[0] - vector[0] * CITY_ROAD_HALF_WIDTH,
      node.point[1] - vector[1] * CITY_ROAD_HALF_WIDTH,
    ];
    // Measured from the rounded overhang behind the endpoint, the tile may
    // extend at most to the neighbouring junction square (edge.length away).
    const innerDistance = edge
      ? Math.min(CITY_TILE_SIZE, edge.length)
      : CITY_TILE_SIZE;
    tiles.push({
      kind: "straight",
      center: [
        outer[0] + vector[0] * (innerDistance / 2),
        outer[1] + vector[1] * (innerDistance / 2),
      ],
      rotationRadians: arm.direction === 1 || arm.direction === 3 ? Math.PI / 2 : 0,
      length: innerDistance,
      width: CITY_TILE_SIZE,
    });
  }

  for (const edge of edges) {
    const from = nodeById.get(edge.from);
    const to = nodeById.get(edge.to);
    if (!from || !to) continue;
    const direction = directionBetween(from.point, to.point);
    const vector = CITY_DIRECTION_VECTORS[direction] ?? [0, 1];
    const gap = edge.length - CITY_TILE_SIZE;
    if (gap <= 0.01) continue;
    const count = Math.max(1, Math.round(gap / CITY_TILE_SIZE));
    const tileLength = gap / count;
    const start = nodeSquareBoundary(from, direction);
    for (let index = 0; index < count; index += 1) {
      const along = tileLength * (index + 0.5);
      tiles.push({
        kind: "straight",
        center: [start[0] + vector[0] * along, start[1] + vector[1] * along],
        rotationRadians: edge.axis === "x" ? Math.PI / 2 : 0,
        length: tileLength,
        width: CITY_TILE_SIZE,
      });
    }
  }
  return tiles;
}

function squareCorner(node: CityGraphNode, xSign: number, zSign: number): CityPoint {
  return [
    node.point[0] + xSign * CITY_ROAD_HALF_WIDTH,
    node.point[1] + zSign * CITY_ROAD_HALF_WIDTH,
  ];
}

function deriveCurbs(
  nodes: readonly CityGraphNode[],
  edges: readonly CityGraphEdge[],
  nodeById: ReadonlyMap<string, CityGraphNode>,
): readonly CityCurbSegment[] {
  const curbs: CityCurbSegment[] = [];

  for (const edge of edges) {
    const from = nodeById.get(edge.from);
    const to = nodeById.get(edge.to);
    if (!from || !to) continue;
    const direction = directionBetween(from.point, to.point);
    const vector = CITY_DIRECTION_VECTORS[direction] ?? [0, 1];
    const gap = edge.length - CITY_TILE_SIZE;
    if (gap <= 0.01) continue;
    const start = nodeSquareBoundary(from, direction);
    const end: CityPoint = [start[0] + vector[0] * gap, start[1] + vector[1] * gap];
    const right: CityPoint = [vector[1], -vector[0]];
    for (const side of [-1, 1]) {
      curbs.push({
        from: [
          start[0] + right[0] * side * CITY_ROAD_HALF_WIDTH,
          start[1] + right[1] * side * CITY_ROAD_HALF_WIDTH,
        ],
        to: [
          end[0] + right[0] * side * CITY_ROAD_HALF_WIDTH,
          end[1] + right[1] * side * CITY_ROAD_HALF_WIDTH,
        ],
      });
    }
  }

  const sideCorners: Readonly<Record<CityDirectionIndex, readonly [CityPoint, CityPoint]>> = {
    0: [[-1, 1], [1, 1]],
    1: [[1, -1], [1, 1]],
    2: [[-1, -1], [1, -1]],
    3: [[-1, -1], [-1, 1]],
  } as unknown as Readonly<Record<CityDirectionIndex, readonly [CityPoint, CityPoint]>>;

  for (const node of nodes) {
    if (node.kind === "end") {
      // Dead ends follow their (possibly clipped) cap tile so curbs never
      // cross a neighbouring junction fill.
      const arm = node.arms[0];
      if (!arm) continue;
      const edge = edges.find(({ id }) => id === arm.edgeId);
      const vector = CITY_DIRECTION_VECTORS[arm.direction] ?? [0, 1];
      const right: CityPoint = [vector[1], -vector[0]];
      const outer: CityPoint = [
        node.point[0] - vector[0] * CITY_ROAD_HALF_WIDTH,
        node.point[1] - vector[1] * CITY_ROAD_HALF_WIDTH,
      ];
      const inner = edge ? Math.min(CITY_TILE_SIZE, edge.length) : CITY_TILE_SIZE;
      const innerPoint: CityPoint = [
        outer[0] + vector[0] * inner,
        outer[1] + vector[1] * inner,
      ];
      for (const side of [-1, 1]) {
        curbs.push({
          from: [
            outer[0] + right[0] * side * CITY_ROAD_HALF_WIDTH,
            outer[1] + right[1] * side * CITY_ROAD_HALF_WIDTH,
          ],
          to: [
            innerPoint[0] + right[0] * side * CITY_ROAD_HALF_WIDTH,
            innerPoint[1] + right[1] * side * CITY_ROAD_HALF_WIDTH,
          ],
        });
      }
      curbs.push({
        from: [
          outer[0] - right[0] * CITY_ROAD_HALF_WIDTH,
          outer[1] - right[1] * CITY_ROAD_HALF_WIDTH,
        ],
        to: [
          outer[0] + right[0] * CITY_ROAD_HALF_WIDTH,
          outer[1] + right[1] * CITY_ROAD_HALF_WIDTH,
        ],
      });
      continue;
    }
    const openDirections = new Set(node.arms.map(({ direction }) => direction));
    for (const side of [0, 1, 2, 3] as const) {
      if (openDirections.has(side)) continue;
      const corners = sideCorners[side];
      const [a, b] = corners;
      curbs.push({
        from: squareCorner(node, a[0], a[1]),
        to: squareCorner(node, b[0], b[1]),
      });
    }
  }
  return curbs;
}

function deriveSidewalks(
  nodes: readonly CityGraphNode[],
  edges: readonly CityGraphEdge[],
  nodeById: ReadonlyMap<string, CityGraphNode>,
  segments: readonly RawSegment[],
): readonly CitySidewalkStrip[] {
  const onRoad = (point: CityPoint): boolean => segments.some((segment) => {
    const along = segment.axis === "z" ? point[1] : point[0];
    const lateral = segment.axis === "z" ? point[0] - segment.fixed : point[1] - segment.fixed;
    const clamped = Math.max(segment.min, Math.min(segment.max, along));
    const alongDelta = along - clamped;
    return Math.hypot(alongDelta, lateral) <= CITY_ROAD_HALF_WIDTH - EPSILON;
  });

  const strips: CitySidewalkStrip[] = [];
  const walkOffset = CITY_ROAD_HALF_WIDTH + CITY_SIDEWALK_WIDTH / 2;
  for (const edge of edges) {
    const from = nodeById.get(edge.from);
    const to = nodeById.get(edge.to);
    if (!from || !to) continue;
    const direction = directionBetween(from.point, to.point);
    const vector = CITY_DIRECTION_VECTORS[direction] ?? [0, 1];
    const gap = edge.length - CITY_TILE_SIZE;
    if (gap <= 0.01) continue;
    const start = nodeSquareBoundary(from, direction);
    const middle: CityPoint = [
      start[0] + vector[0] * (gap / 2),
      start[1] + vector[1] * (gap / 2),
    ];
    const right: CityPoint = [vector[1], -vector[0]];
    for (const side of [-1, 1]) {
      const center: CityPoint = [
        middle[0] + right[0] * side * walkOffset,
        middle[1] + right[1] * side * walkOffset,
      ];
      strips.push({
        center,
        halfSize: edge.axis === "z"
          ? [CITY_SIDEWALK_WIDTH / 2, gap / 2]
          : [gap / 2, CITY_SIDEWALK_WIDTH / 2],
      });
    }
  }

  for (const node of nodes) {
    for (const xSign of [-1, 1]) {
      for (const zSign of [-1, 1]) {
        const center: CityPoint = [
          node.point[0] + xSign * walkOffset,
          node.point[1] + zSign * walkOffset,
        ];
        if (onRoad(center)) continue;
        strips.push({
          center,
          halfSize: [CITY_SIDEWALK_WIDTH / 2, CITY_SIDEWALK_WIDTH / 2],
        });
      }
    }
  }
  return strips;
}

/**
 * Shortest centerline path between two points via Dijkstra over the junction
 * graph. Both endpoints are projected onto their nearest edge; the returned
 * polyline collapses collinear runs so it can be compared with the frozen
 * `CITY_DESTINATIONS` routes.
 */
export function shortestCityPath(
  topology: CityRoadTopology,
  from: CityPoint,
  to: CityPoint,
): readonly CityPoint[] {
  interface Projection {
    readonly edge: CityGraphEdge;
    readonly point: CityPoint;
    readonly distanceFromEdge: number;
    readonly alongFromStart: number;
  }
  const nodeById = new Map(topology.nodes.map((node) => [node.id, node]));
  const project = (point: CityPoint): Projection => {
    let best: Projection | null = null;
    for (const edge of topology.edges) {
      const a = nodeById.get(edge.from)?.point;
      const b = nodeById.get(edge.to)?.point;
      if (!a || !b) continue;
      const dx = b[0] - a[0];
      const dz = b[1] - a[1];
      const lengthSquared = dx * dx + dz * dz;
      const t = lengthSquared === 0
        ? 0
        : Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dz) / lengthSquared));
      const projected: CityPoint = [a[0] + dx * t, a[1] + dz * t];
      const distance = Math.hypot(point[0] - projected[0], point[1] - projected[1]);
      if (!best || distance < best.distanceFromEdge) {
        best = {
          edge,
          point: projected,
          distanceFromEdge: distance,
          alongFromStart: Math.sqrt(lengthSquared) * t,
        };
      }
    }
    if (!best) throw new RangeError("The city road network has no edges to route on");
    return best;
  };

  const source = project(from);
  const target = project(to);

  if (source.edge.id === target.edge.id) {
    return collapseCollinear([from, source.point, target.point, to]);
  }

  const distances = new Map<string, number>();
  const previous = new Map<string, string>();
  const seed = (nodeId: string, cost: number): void => {
    if (cost < (distances.get(nodeId) ?? Number.POSITIVE_INFINITY)) {
      distances.set(nodeId, cost);
    }
  };
  seed(source.edge.from, source.alongFromStart);
  seed(source.edge.to, source.edge.length - source.alongFromStart);

  const visited = new Set<string>();
  while (visited.size < topology.nodes.length) {
    let currentId: string | null = null;
    let currentDistance = Number.POSITIVE_INFINITY;
    for (const [nodeId, distance] of distances) {
      if (!visited.has(nodeId) && distance < currentDistance) {
        currentId = nodeId;
        currentDistance = distance;
      }
    }
    if (!currentId) break;
    visited.add(currentId);
    for (const edge of topology.edges) {
      if (edge.from !== currentId && edge.to !== currentId) continue;
      const neighborId = edge.from === currentId ? edge.to : edge.from;
      const candidate = currentDistance + edge.length;
      if (candidate < (distances.get(neighborId) ?? Number.POSITIVE_INFINITY)) {
        distances.set(neighborId, candidate);
        previous.set(neighborId, currentId);
      }
    }
  }

  const viaFrom = (distances.get(target.edge.from) ?? Number.POSITIVE_INFINITY) + target.alongFromStart;
  const viaTo = (distances.get(target.edge.to) ?? Number.POSITIVE_INFINITY)
    + (target.edge.length - target.alongFromStart);
  const entryNodeId = viaFrom <= viaTo ? target.edge.from : target.edge.to;

  const chain: CityPoint[] = [];
  let cursor: string | undefined = entryNodeId;
  while (cursor) {
    const node = nodeById.get(cursor);
    if (node) chain.unshift(node.point);
    cursor = previous.get(cursor);
  }
  return collapseCollinear([from, source.point, ...chain, target.point, to]);
}

function collapseCollinear(points: readonly CityPoint[]): readonly CityPoint[] {
  const result: CityPoint[] = [];
  for (const point of points) {
    const last = result.at(-1);
    if (last && Math.hypot(point[0] - last[0], point[1] - last[1]) < 0.01) continue;
    result.push(point);
  }
  for (let index = result.length - 2; index >= 1; index -= 1) {
    const previousPoint = result[index - 1];
    const point = result[index];
    const nextPoint = result[index + 1];
    if (!previousPoint || !point || !nextPoint) continue;
    const cross = (point[0] - previousPoint[0]) * (nextPoint[1] - point[1])
      - (point[1] - previousPoint[1]) * (nextPoint[0] - point[0]);
    if (Math.abs(cross) < 0.01) result.splice(index, 1);
  }
  return result;
}

/**
 * Samples a lane centerline that follows `route` offset to the right-hand
 * side. Corners are rounded by smoothing the tangent over a short window and
 * the offset tapers to zero at both endpoints so departures leave the bay
 * center and arrivals converge on the parking marker.
 */
export function laneRoutePolyline(
  route: readonly CityPoint[],
  laneOffset = CITY_LANE_OFFSET,
  sampleSpacing = 2.5,
): readonly CityPoint[] {
  if (route.length < 2) throw new RangeError("A lane polyline requires at least two route points");
  let total = 0;
  const cumulative: number[] = [0];
  for (let index = 1; index < route.length; index += 1) {
    const a = route[index - 1];
    const b = route[index];
    if (!a || !b) continue;
    total += Math.hypot(b[0] - a[0], b[1] - a[1]);
    cumulative.push(total);
  }
  const pointAt = (distance: number): CityPoint => {
    const clamped = Math.max(0, Math.min(total, distance));
    for (let index = 1; index < route.length; index += 1) {
      const start = cumulative[index - 1] ?? 0;
      const end = cumulative[index] ?? 0;
      const a = route[index - 1];
      const b = route[index];
      if (!a || !b) continue;
      if (clamped <= end || index === route.length - 1) {
        const ratio = end - start === 0 ? 0 : (clamped - start) / (end - start);
        return [a[0] + (b[0] - a[0]) * ratio, a[1] + (b[1] - a[1]) * ratio];
      }
    }
    return route.at(-1) ?? [0, 0];
  };

  const smoothingWindow = 3.2;
  const points: CityPoint[] = [];
  const count = Math.max(2, Math.ceil(total / sampleSpacing));
  for (let index = 0; index <= count; index += 1) {
    const along = (total * index) / count;
    const behind = pointAt(Math.max(0, along - smoothingWindow));
    const ahead = pointAt(Math.min(total, along + smoothingWindow));
    const dx = ahead[0] - behind[0];
    const dz = ahead[1] - behind[1];
    const magnitude = Math.hypot(dx, dz) || 1;
    const rightX = dz / magnitude;
    const rightZ = -dx / magnitude;
    const endTaper = Math.min(1, Math.min(along, total - along) / 7);
    const offset = laneOffset * endTaper;
    const base = pointAt(along);
    points.push([base[0] + rightX * offset, base[1] + rightZ * offset]);
  }
  return points;
}

/** Offsets a closed rectangular loop to its right-hand driving lane. */
export function laneLoopPolyline(
  loop: readonly CityPoint[],
  laneOffset = CITY_LANE_OFFSET,
): readonly CityPoint[] {
  if (loop.length < 3) throw new RangeError("A lane loop requires at least three points");
  const result: CityPoint[] = [];
  for (const [index, point] of loop.entries()) {
    const next = loop[(index + 1) % loop.length];
    const previousPoint = loop[(index - 1 + loop.length) % loop.length];
    if (!next || !previousPoint) continue;
    const inDx = point[0] - previousPoint[0];
    const inDz = point[1] - previousPoint[1];
    const inMagnitude = Math.hypot(inDx, inDz) || 1;
    const outDx = next[0] - point[0];
    const outDz = next[1] - point[1];
    const outMagnitude = Math.hypot(outDx, outDz) || 1;
    const rightX = (inDz / inMagnitude + outDz / outMagnitude) / 2;
    const rightZ = -(inDx / inMagnitude + outDx / outMagnitude) / 2;
    const magnitude = Math.hypot(rightX, rightZ) || 1;
    result.push([
      point[0] + (rightX / magnitude) * laneOffset,
      point[1] + (rightZ / magnitude) * laneOffset,
    ]);
  }
  return result;
}

export function parkingBayForRoute(
  id: ShopId | "garage",
  route: readonly CityPoint[],
): CityParkingBay {
  const end = route.at(-1);
  const beforeEnd = route.at(-2);
  if (!end || !beforeEnd) throw new RangeError("A parking bay requires a route with two points");
  return {
    id,
    center: end,
    headingRadians: Math.atan2(end[0] - beforeEnd[0], end[1] - beforeEnd[1]),
    halfLength: 2.7,
    halfWidth: 1.7,
  };
}

export { directionHeading as cityDirectionHeading };
