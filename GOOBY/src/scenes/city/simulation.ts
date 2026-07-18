import type { DriveControls } from "../../core/contracts/input";
import {
  BOOST_PICKUP_RADIUS,
  CITY_BOOST_PADS,
  CITY_BUILDINGS,
  CITY_COINS,
  CITY_TOPOLOGY,
  CITY_TRAFFIC_LOOPS,
  CITY_WORLD_BOUNDS,
  COIN_PICKUP_RADIUS,
  isPointInWorld,
  isPointOnRoad,
  isValidCarPosition,
  nearestRouteSample,
  pointAlongRoute,
  routeLength,
  type CityPoint,
  type CityTrafficLoop,
} from "../../data/city";

export const CITY_CAR_RADIUS = 1.15;
export const CITY_CRUISE_SPEED = 8;
export const CITY_BOOST_SPEED = 12.5;
export const CITY_REVERSE_SPEED = -3.2;
export const CITY_RECOVERY_REVERSE_SECONDS = 0.9;
export const CITY_RECOVERY_REAIM_SECONDS = 0.7;
export const CITY_RELOCATION_ATTEMPTS = 3;

/** Deterministic physics rate; render frames interpolate between steps. */
export const CITY_FIXED_STEP_SECONDS = 1 / 60;
/** Cruise multiplier while all four wheels are off the paved road. */
export const CITY_OFF_ROAD_SPEED_FACTOR = 0.85;
/** Speed retained when the car bumps up or down a curb. */
export const CITY_CURB_SCRUB_FACTOR = 0.82;
export const CITY_TRAFFIC_CAR_RADIUS = 1.3;
export const CITY_PARKING_BONUS_MAX_SPEED = 5;
export const CITY_PARKING_BONUS_MAX_HEADING_ERROR = 0.85;
/** Coins granted for easing into the bay slowly while pointing down it. */
export const CITY_PARKING_BONUS_COINS = 2;
export const CITY_WRONG_WAY_SECONDS = 1.1;

export type RecoveryMode = "none" | "reverse" | "re-aim" | "relocated";

export interface CityCarSnapshot {
  readonly position: CityPoint;
  readonly headingRadians: number;
  readonly speed: number;
  readonly boostSeconds: number;
  readonly braking: boolean;
  readonly recoveryMode: RecoveryMode;
  readonly recoveryAttempts: number;
  readonly noProgressSeconds: number;
  readonly collectedCoinIds: readonly string[];
  readonly wrongWay: boolean;
  readonly offRoad: boolean;
  readonly steeringValue: number;
}

export interface DriveStepResult {
  readonly snapshot: CityCarSnapshot;
  readonly collectedCoinIds: readonly string[];
  readonly activatedBoostPadIds: readonly string[];
  readonly collided: boolean;
  readonly relocated: boolean;
}

export interface RecoveryPose {
  readonly position: CityPoint;
  readonly headingRadians: number;
}

export interface CityRenderPose {
  readonly position: CityPoint;
  readonly headingRadians: number;
}

interface MutablePosition {
  x: number;
  z: number;
}

interface CollisionResult {
  readonly position: CityPoint;
  readonly collided: boolean;
}

interface MutablePickupResult {
  readonly coinIds: string[];
  readonly boostPadIds: string[];
}

const EMPTY_CONTROLS: DriveControls = {
  steering: 0,
  braking: false,
  steeringHeld: false,
  brakeHeld: false,
};
const EMPTY_COOLDOWNS: ReadonlyMap<string, number> = new Map();

function moveToward(value: number, target: number, amount: number): number {
  if (value < target) return Math.min(target, value + amount);
  return Math.max(target, value - amount);
}

function normalizeAngle(angle: number): number {
  let normalized = angle;
  while (normalized > Math.PI) normalized -= Math.PI * 2;
  while (normalized < -Math.PI) normalized += Math.PI * 2;
  return normalized;
}

function shortestAngle(from: number, to: number): number {
  return normalizeAngle(to - from);
}

function segmentsIntersect(
  aFromX: number, aFromZ: number, aToX: number, aToZ: number,
  bFromX: number, bFromZ: number, bToX: number, bToZ: number,
): boolean {
  const d1x = aToX - aFromX;
  const d1z = aToZ - aFromZ;
  const d2x = bToX - bFromX;
  const d2z = bToZ - bFromZ;
  const denominator = d1x * d2z - d1z * d2x;
  if (Math.abs(denominator) < 1e-9) return false;
  const t = ((bFromX - aFromX) * d2z - (bFromZ - aFromZ) * d2x) / denominator;
  const u = ((bFromX - aFromX) * d1z - (bFromZ - aFromZ) * d1x) / denominator;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

/**
 * Resolves the swept building/world-bounds contact for a proposed position.
 * The position is pushed to the nearest free spot which lets glancing motion
 * slide along the obstacle on subsequent steps.
 */
function resolveBuilding(position: MutablePosition, radius: number): boolean {
  let collided = false;
  for (const building of CITY_BUILDINGS) {
    const minX = building.center[0] - building.halfSize[0] - radius;
    const maxX = building.center[0] + building.halfSize[0] + radius;
    const minZ = building.center[1] - building.halfSize[1] - radius;
    const maxZ = building.center[1] + building.halfSize[1] + radius;
    if (position.x <= minX || position.x >= maxX || position.z <= minZ || position.z >= maxZ) continue;

    collided = true;
    const candidates = [
      { axis: "x" as const, value: minX - 0.02, distance: position.x - minX },
      { axis: "x" as const, value: maxX + 0.02, distance: maxX - position.x },
      { axis: "z" as const, value: minZ - 0.02, distance: position.z - minZ },
      { axis: "z" as const, value: maxZ + 0.02, distance: maxZ - position.z },
    ];
    const nearest = candidates.reduce((best, candidate) =>
      candidate.distance < best.distance ? candidate : best);
    position[nearest.axis] = nearest.value;
  }
  return collided;
}

export function resolveCityCollision(position: CityPoint, radius = CITY_CAR_RADIUS): CollisionResult {
  const resolved: MutablePosition = { x: position[0], z: position[1] };
  const before: CityPoint = [resolved.x, resolved.z];
  resolved.x = Math.max(
    CITY_WORLD_BOUNDS.minX + radius,
    Math.min(CITY_WORLD_BOUNDS.maxX - radius, resolved.x),
  );
  resolved.z = Math.max(
    CITY_WORLD_BOUNDS.minZ + radius,
    Math.min(CITY_WORLD_BOUNDS.maxZ - radius, resolved.z),
  );
  const boundaryCollision = before[0] !== resolved.x || before[1] !== resolved.z;
  const buildingCollision = resolveBuilding(resolved, radius);
  return {
    position: [resolved.x, resolved.z],
    collided: boundaryCollision || buildingCollision,
  };
}

/** True when the swept movement segment crosses a raised curb line. */
export function sweptCurbCrossing(from: CityPoint, to: CityPoint): boolean {
  if (Math.abs(from[0] - to[0]) < 1e-9 && Math.abs(from[1] - to[1]) < 1e-9) return false;
  for (const curb of CITY_TOPOLOGY.curbs) {
    if (segmentsIntersect(
      from[0], from[1], to[0], to[1],
      curb.from[0], curb.from[1], curb.to[0], curb.to[1],
    )) {
      return true;
    }
  }
  return false;
}

export function computeBoundedRecoveryPose(position: CityPoint, route: readonly CityPoint[]): RecoveryPose {
  const nearest = nearestRouteSample(position, route);
  if (isValidCarPosition(nearest.point, CITY_CAR_RADIUS)) {
    return { position: nearest.point, headingRadians: nearest.headingRadians };
  }

  const total = routeLength(route);
  for (let offset = 2; offset <= total; offset += 2) {
    for (const candidateDistance of [
      nearest.distanceAlongRoute - offset,
      nearest.distanceAlongRoute + offset,
    ]) {
      const candidate = pointAlongRoute(route, Math.max(0, Math.min(total, candidateDistance)));
      if (isValidCarPosition(candidate.point, CITY_CAR_RADIUS)) {
        return { position: candidate.point, headingRadians: candidate.headingRadians };
      }
    }
  }

  const fallback = pointAlongRoute(route, 0);
  return { position: fallback.point, headingRadians: fallback.headingRadians };
}

export function detectCityPickups(
  position: CityPoint,
  collectedCoinIds: ReadonlySet<string>,
  boostPadCooldowns: ReadonlyMap<string, number> = EMPTY_COOLDOWNS,
  target?: MutablePickupResult,
): {
  readonly coinIds: readonly string[];
  readonly boostPadIds: readonly string[];
} {
  const coinIds = target?.coinIds ?? [];
  const boostPadIds = target?.boostPadIds ?? [];
  coinIds.length = 0;
  boostPadIds.length = 0;
  const coinRadiusSquared = COIN_PICKUP_RADIUS * COIN_PICKUP_RADIUS;
  for (const coin of CITY_COINS) {
    const dx = position[0] - coin.position[0];
    const dz = position[1] - coin.position[1];
    if (!collectedCoinIds.has(coin.id) && dx * dx + dz * dz <= coinRadiusSquared) {
      coinIds.push(coin.id);
    }
  }
  const boostRadiusSquared = BOOST_PICKUP_RADIUS * BOOST_PICKUP_RADIUS;
  for (const pad of CITY_BOOST_PADS) {
    const dx = position[0] - pad.position[0];
    const dz = position[1] - pad.position[1];
    if ((boostPadCooldowns.get(pad.id) ?? 0) <= 0 && dx * dx + dz * dz <= boostRadiusSquared) {
      boostPadIds.push(pad.id);
    }
  }
  return target ?? { coinIds, boostPadIds };
}

export interface ParkingArrivalQuality {
  readonly bonus: boolean;
  readonly speed: number;
  readonly headingErrorRadians: number;
}

/**
 * Grades how the car rolled into a parking bay: an easy-going arrival at low
 * speed while pointing down the bay earns the "perfect parking" bonus.
 */
export function evaluateParkingArrival(
  car: Pick<CityCarSnapshot, "speed" | "headingRadians">,
  route: readonly CityPoint[],
): ParkingArrivalQuality {
  const arrival = pointAlongRoute(route, routeLength(route));
  const headingErrorRadians = Math.abs(shortestAngle(car.headingRadians, arrival.headingRadians));
  return {
    bonus: Math.abs(car.speed) <= CITY_PARKING_BONUS_MAX_SPEED
      && headingErrorRadians <= CITY_PARKING_BONUS_MAX_HEADING_ERROR,
    speed: car.speed,
    headingErrorRadians,
  };
}

export type CityTrafficCarKind = "curated-a" | "curated-b" | "compact";

export interface CityTrafficCarState {
  readonly id: string;
  readonly loopId: string;
  readonly kind: CityTrafficCarKind;
  readonly position: CityPoint;
  readonly headingRadians: number;
  readonly speed: number;
  readonly yielding: boolean;
}

interface TrafficAgent {
  readonly id: string;
  readonly loopIndex: number;
  readonly kind: CityTrafficCarKind;
  distanceAlong: number;
  speed: number;
  yielding: boolean;
  x: number;
  z: number;
  headingRadians: number;
}

interface PreparedLoop {
  readonly loop: CityTrafficLoop;
  readonly segmentLengths: readonly number[];
  readonly totalLength: number;
}

function prepareLoop(loop: CityTrafficLoop): PreparedLoop {
  const segmentLengths: number[] = [];
  let totalLength = 0;
  for (let index = 0; index < loop.points.length; index += 1) {
    const from = loop.points[index];
    const to = loop.points[(index + 1) % loop.points.length];
    if (!from || !to) continue;
    const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
    segmentLengths.push(length);
    totalLength += length;
  }
  return { loop, segmentLengths, totalLength };
}

function sampleLoop(prepared: PreparedLoop, distance: number, agent: TrafficAgent): void {
  let remaining = ((distance % prepared.totalLength) + prepared.totalLength) % prepared.totalLength;
  const points = prepared.loop.points;
  for (let index = 0; index < points.length; index += 1) {
    const from = points[index];
    const to = points[(index + 1) % points.length];
    const length = prepared.segmentLengths[index];
    if (!from || !to || length === undefined) continue;
    if (remaining <= length || index === points.length - 1) {
      const ratio = length === 0 ? 0 : Math.min(1, remaining / length);
      agent.x = from[0] + (to[0] - from[0]) * ratio;
      agent.z = from[1] + (to[1] - from[1]) * ratio;
      agent.headingRadians = Math.atan2(to[0] - from[0], to[1] - from[1]);
      return;
    }
    remaining -= length;
  }
}

const TRAFFIC_KINDS: readonly CityTrafficCarKind[] = ["curated-a", "compact", "curated-b", "compact"];

/**
 * Deterministic lane traffic. Agents follow their right-hand lane loops at a
 * fixed 60Hz step, keep spacing to the car ahead, and yield to the player
 * whenever the player blocks the lane ahead of them — including while the
 * player is parked at a bay.
 */
export class CityTrafficSim {
  private readonly preparedLoops: readonly PreparedLoop[];
  private readonly agents: readonly TrafficAgent[];
  private accumulator = 0;
  private readonly carStates: CityTrafficCarState[] = [];

  constructor(loops: readonly CityTrafficLoop[] = CITY_TRAFFIC_LOOPS) {
    this.preparedLoops = loops.map(prepareLoop);
    const agents: TrafficAgent[] = [];
    const perLoop = [2, 1, 1];
    let carIndex = 0;
    for (const [loopIndex, prepared] of this.preparedLoops.entries()) {
      const count = perLoop[loopIndex] ?? 1;
      for (let slot = 0; slot < count; slot += 1) {
        const agent: TrafficAgent = {
          id: `traffic-${carIndex}`,
          loopIndex,
          kind: TRAFFIC_KINDS[carIndex % TRAFFIC_KINDS.length] ?? "compact",
          distanceAlong: prepared.totalLength * ((prepared.loop.phase + slot / count) % 1),
          speed: prepared.loop.speed,
          yielding: false,
          x: 0,
          z: 0,
          headingRadians: 0,
        };
        sampleLoop(prepared, agent.distanceAlong, agent);
        agents.push(agent);
        carIndex += 1;
      }
    }
    this.agents = agents;
  }

  get cars(): readonly CityTrafficCarState[] {
    this.carStates.length = 0;
    for (const agent of this.agents) {
      this.carStates.push({
        id: agent.id,
        loopId: this.preparedLoops[agent.loopIndex]?.loop.id ?? "loop",
        kind: agent.kind,
        position: [agent.x, agent.z],
        headingRadians: agent.headingRadians,
        speed: agent.speed,
        yielding: agent.yielding,
      });
    }
    return this.carStates;
  }

  /** Accumulating entry point for scene frames outside the driving phases. */
  step(deltaSeconds: number, playerPosition: CityPoint): void {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) {
      throw new RangeError("Traffic delta must be finite and non-negative");
    }
    this.accumulator += Math.min(deltaSeconds, 0.5);
    while (this.accumulator >= CITY_FIXED_STEP_SECONDS) {
      this.stepFixed(playerPosition);
      this.accumulator -= CITY_FIXED_STEP_SECONDS;
    }
  }

  stepFixed(playerPosition: CityPoint): void {
    for (const agent of this.agents) {
      const prepared = this.preparedLoops[agent.loopIndex];
      if (!prepared) continue;
      let targetSpeed = prepared.loop.speed;
      let yielding = false;

      const forwardX = Math.sin(agent.headingRadians);
      const forwardZ = Math.cos(agent.headingRadians);
      const toPlayerX = playerPosition[0] - agent.x;
      const toPlayerZ = playerPosition[1] - agent.z;
      const ahead = toPlayerX * forwardX + toPlayerZ * forwardZ;
      const lateral = Math.abs(toPlayerX * forwardZ - toPlayerZ * forwardX);
      if (ahead > 0 && ahead < 11 && lateral < 2.4) {
        yielding = true;
        targetSpeed = Math.min(targetSpeed, Math.max(0, (ahead - 4) * 0.9));
      }

      for (const other of this.agents) {
        if (other === agent || other.loopIndex !== agent.loopIndex) continue;
        const gap = ((other.distanceAlong - agent.distanceAlong) % prepared.totalLength
          + prepared.totalLength) % prepared.totalLength;
        if (gap > 0 && gap < 7) {
          yielding = true;
          targetSpeed = Math.min(targetSpeed, other.speed * (gap / 7));
        }
      }

      agent.yielding = yielding;
      const rate = targetSpeed > agent.speed ? 5.5 : 11;
      agent.speed = moveToward(agent.speed, targetSpeed, rate * CITY_FIXED_STEP_SECONDS);
      agent.distanceAlong = (agent.distanceAlong + agent.speed * CITY_FIXED_STEP_SECONDS)
        % prepared.totalLength;
      sampleLoop(prepared, agent.distanceAlong, agent);
    }
  }
}

export class CityDrivePhysics {
  private position: MutablePosition;
  private headingRadians: number;
  private previousRenderPosition: MutablePosition;
  private previousRenderHeading: number;
  private speed = 0;
  private steeringValue = 0;
  private boostSeconds = 0;
  private braking = false;
  private recoveryMode: RecoveryMode = "none";
  private recoveryModeSeconds = 0;
  private recoveryAttempts = 0;
  private noProgressSeconds = 0;
  private progressResetSeconds = 0;
  private wrongWaySeconds = 0;
  private offRoad = false;
  private accumulator = 0;
  private route: readonly CityPoint[];
  private previousRemaining: number;
  private traffic: CityTrafficSim | null = null;
  private readonly collectedCoinIds = new Set<string>();
  private readonly boostPadCooldowns = new Map<string, number>();
  private readonly pickupResult: MutablePickupResult = { coinIds: [], boostPadIds: [] };
  private lastSafePose: RecoveryPose;

  constructor(
    route: readonly CityPoint[],
    initialPose?: {
      readonly position: CityPoint;
      readonly headingRadians: number;
      readonly collectedCoinIds?: readonly string[];
    },
  ) {
    if (route.length < 2) throw new RangeError("Drive physics requires a reachable route");
    this.route = route;
    const routeStart = pointAlongRoute(route, 0);
    const initial = initialPose ?? {
      position: routeStart.point,
      headingRadians: routeStart.headingRadians,
    };
    this.position = { x: initial.position[0], z: initial.position[1] };
    this.headingRadians = initial.headingRadians;
    this.previousRenderPosition = { x: initial.position[0], z: initial.position[1] };
    this.previousRenderHeading = initial.headingRadians;
    this.previousRemaining = nearestRouteSample(initial.position, route).remainingDistance;
    this.lastSafePose = { position: initial.position, headingRadians: initial.headingRadians };
    for (const id of initialPose?.collectedCoinIds ?? []) this.collectedCoinIds.add(id);
  }

  get snapshot(): CityCarSnapshot {
    return {
      position: [this.position.x, this.position.z],
      headingRadians: this.headingRadians,
      speed: this.speed,
      boostSeconds: this.boostSeconds,
      braking: this.braking,
      recoveryMode: this.recoveryMode,
      recoveryAttempts: this.recoveryAttempts,
      noProgressSeconds: this.noProgressSeconds,
      collectedCoinIds: [...this.collectedCoinIds],
      wrongWay: this.wrongWaySeconds >= CITY_WRONG_WAY_SECONDS,
      offRoad: this.offRoad,
      steeringValue: this.steeringValue,
    };
  }

  get safePose(): RecoveryPose {
    return this.lastSafePose;
  }

  /**
   * Pose interpolated between the two most recent fixed steps so rendering
   * stays smooth at any display rate without perturbing the simulation.
   */
  renderPose(): CityRenderPose {
    const alpha = Math.max(0, Math.min(1, this.accumulator / CITY_FIXED_STEP_SECONDS));
    return {
      position: [
        this.previousRenderPosition.x + (this.position.x - this.previousRenderPosition.x) * alpha,
        this.previousRenderPosition.z + (this.position.z - this.previousRenderPosition.z) * alpha,
      ],
      headingRadians: this.previousRenderHeading
        + shortestAngle(this.previousRenderHeading, this.headingRadians) * alpha,
    };
  }

  attachTraffic(traffic: CityTrafficSim | null): void {
    this.traffic = traffic;
  }

  setRoute(
    route: readonly CityPoint[],
    startPose?: { readonly position: CityPoint; readonly headingRadians: number },
  ): void {
    if (route.length < 2) throw new RangeError("Drive physics requires a reachable route");
    const routeStart = pointAlongRoute(route, 0);
    const start = startPose ?? {
      position: routeStart.point,
      headingRadians: routeStart.headingRadians,
    };
    this.route = route;
    this.position = { x: start.position[0], z: start.position[1] };
    this.headingRadians = start.headingRadians;
    this.previousRenderPosition = { x: start.position[0], z: start.position[1] };
    this.previousRenderHeading = start.headingRadians;
    this.speed = 0;
    this.steeringValue = 0;
    this.boostSeconds = 0;
    this.braking = false;
    this.recoveryMode = "none";
    this.recoveryModeSeconds = 0;
    this.noProgressSeconds = 0;
    this.wrongWaySeconds = 0;
    this.recoveryAttempts = 0;
    this.accumulator = 0;
    this.previousRemaining = nearestRouteSample(start.position, route).remainingDistance;
    this.lastSafePose = start;
  }

  park(brakeLights = true): void {
    this.speed = 0;
    this.steeringValue = 0;
    this.boostSeconds = 0;
    this.braking = brakeLights;
    this.recoveryMode = "none";
    this.recoveryModeSeconds = 0;
    this.noProgressSeconds = 0;
    this.wrongWaySeconds = 0;
    this.previousRenderPosition = { x: this.position.x, z: this.position.z };
    this.previousRenderHeading = this.headingRadians;
  }

  recoverNow(reason: "off-route" | "stalled" | "invalid-pose"): RecoveryPose {
    void reason;
    const recovered = computeBoundedRecoveryPose([this.position.x, this.position.z], this.route);
    this.position = { x: recovered.position[0], z: recovered.position[1] };
    this.headingRadians = recovered.headingRadians;
    this.previousRenderPosition = { x: recovered.position[0], z: recovered.position[1] };
    this.previousRenderHeading = recovered.headingRadians;
    this.speed = 0;
    this.steeringValue = 0;
    this.recoveryMode = "relocated";
    this.recoveryModeSeconds = 0.25;
    this.noProgressSeconds = 0;
    this.wrongWaySeconds = 0;
    this.recoveryAttempts = 0;
    this.previousRemaining = nearestRouteSample(recovered.position, this.route).remainingDistance;
    this.lastSafePose = recovered;
    return recovered;
  }

  /**
   * Advances the deterministic 60Hz simulation. Frame deltas accumulate and
   * only whole fixed steps run, so identical control timelines produce
   * identical trajectories at 30, 60, or 120 frames per second.
   */
  step(deltaSeconds: number, controls: DriveControls = EMPTY_CONTROLS): DriveStepResult {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) {
      throw new RangeError("Drive delta must be finite and non-negative");
    }
    const collected: string[] = [];
    const boosted: string[] = [];
    let collided = false;
    let relocated = false;
    let fixedSteps = 0;
    this.accumulator += Math.min(deltaSeconds, 0.5);

    while (this.accumulator >= CITY_FIXED_STEP_SECONDS) {
      this.previousRenderPosition.x = this.position.x;
      this.previousRenderPosition.z = this.position.z;
      this.previousRenderHeading = this.headingRadians;
      const result = this.stepFixed(controls);
      collected.push(...result.collectedCoinIds);
      boosted.push(...result.activatedBoostPadIds);
      collided ||= result.collided;
      relocated ||= result.relocated;
      this.accumulator -= CITY_FIXED_STEP_SECONDS;
      fixedSteps += 1;
    }

    // A frame shorter than one fixed step must still notice pickups under the
    // car (e.g. spawning on a coin). Position is unchanged between fixed steps
    // so this stays deterministic across frame rates: coins are idempotent and
    // pads already triggered by the last fixed step sit on cooldown.
    if (fixedSteps === 0) {
      const pickups = this.applyPickups();
      collected.push(...pickups.coinIds);
      boosted.push(...pickups.boostPadIds);
    }

    return {
      snapshot: this.snapshot,
      collectedCoinIds: collected,
      activatedBoostPadIds: boosted,
      collided,
      relocated,
    };
  }

  private stepFixed(controls: DriveControls): Omit<DriveStepResult, "snapshot"> {
    const deltaSeconds = CITY_FIXED_STEP_SECONDS;
    for (const [id, cooldown] of this.boostPadCooldowns) {
      const next = cooldown - deltaSeconds;
      if (next <= 0) this.boostPadCooldowns.delete(id);
      else this.boostPadCooldowns.set(id, next);
    }
    this.boostSeconds = Math.max(0, this.boostSeconds - deltaSeconds);
    this.braking = controls.braking || controls.brakeHeld;

    // Steering is smoothed toward the (possibly analog) input so the wheel
    // has weight: quick to engage, slightly quicker to recenter.
    const steeringTarget = controls.steeringHeld
      ? Math.max(-1, Math.min(1, controls.steering))
      : 0;
    const steeringRate = steeringTarget === 0 ? 9.5 : 7;
    this.steeringValue = moveToward(this.steeringValue, steeringTarget, steeringRate * deltaSeconds);

    const previousPosition: CityPoint = [this.position.x, this.position.z];
    this.offRoad = !isPointOnRoad(previousPosition);

    let relocated = false;
    if (this.recoveryMode === "relocated") {
      this.recoveryModeSeconds -= deltaSeconds;
      if (this.recoveryModeSeconds <= 0) this.recoveryMode = "none";
    } else if (this.recoveryMode === "reverse") {
      this.speed = moveToward(this.speed, CITY_REVERSE_SPEED, 9 * deltaSeconds);
      if (controls.steeringHeld) {
        this.headingRadians = normalizeAngle(this.headingRadians + this.steeringValue * 0.7 * deltaSeconds);
      }
      this.recoveryModeSeconds -= deltaSeconds;
      if (this.recoveryModeSeconds <= 0) {
        this.recoveryMode = "re-aim";
        this.recoveryModeSeconds = CITY_RECOVERY_REAIM_SECONDS;
      }
    } else if (this.recoveryMode === "re-aim") {
      this.speed = moveToward(this.speed, 1.2, 8 * deltaSeconds);
      const nearest = nearestRouteSample(previousPosition, this.route);
      const lookAhead = pointAlongRoute(
        this.route,
        Math.min(routeLength(this.route), nearest.distanceAlongRoute + 7),
      );
      const targetHeading = Math.atan2(
        lookAhead.point[0] - this.position.x,
        lookAhead.point[1] - this.position.z,
      );
      this.headingRadians = normalizeAngle(
        this.headingRadians + Math.max(-2.8 * deltaSeconds, Math.min(2.8 * deltaSeconds, shortestAngle(this.headingRadians, targetHeading))),
      );
      this.recoveryModeSeconds -= deltaSeconds;
      if (this.recoveryModeSeconds <= 0) {
        this.recoveryAttempts += 1;
        this.noProgressSeconds = 0;
        if (this.recoveryAttempts >= CITY_RELOCATION_ATTEMPTS) {
          this.recoverNow("stalled");
          relocated = true;
        } else {
          this.recoveryMode = "none";
        }
      }
    } else {
      const surfaceFactor = this.offRoad ? CITY_OFF_ROAD_SPEED_FACTOR : 1;
      const targetSpeed = this.braking
        ? 0
        : (this.boostSeconds > 0 ? CITY_BOOST_SPEED : CITY_CRUISE_SPEED) * surfaceFactor;
      const acceleration = targetSpeed > this.speed
        ? 4.4
        : this.braking ? 10.5 : 7.5;
      this.speed = moveToward(this.speed, targetSpeed, acceleration * deltaSeconds);
      if (Math.abs(this.speed) > 0.25 && this.steeringValue !== 0) {
        const speedFactor = Math.max(0.4, Math.min(1, Math.abs(this.speed) / CITY_CRUISE_SPEED));
        const yawRate = this.steeringValue * (1.62 - speedFactor * 0.45);
        this.headingRadians = normalizeAngle(this.headingRadians + yawRate * deltaSeconds);
        // Cornering weight: hard steering at speed scrubs a little pace.
        this.speed -= Math.abs(yawRate) * this.speed * 0.035 * deltaSeconds;
      }
    }

    const proposed: CityPoint = [
      this.position.x + Math.sin(this.headingRadians) * this.speed * deltaSeconds,
      this.position.z + Math.cos(this.headingRadians) * this.speed * deltaSeconds,
    ];
    const collision = resolveCityCollision(proposed);
    let resolvedX = collision.position[0];
    let resolvedZ = collision.position[1];
    let collidedThisStep = collision.collided;

    if (collidedThisStep) {
      // Slide along glancing contacts; a near head-on hit soft-bounces so the
      // car never stays pinned against a wall.
      const pushX = resolvedX - proposed[0];
      const pushZ = resolvedZ - proposed[1];
      const pushMagnitude = Math.hypot(pushX, pushZ);
      const forwardX = Math.sin(this.headingRadians);
      const forwardZ = Math.cos(this.headingRadians);
      const headOn = pushMagnitude > 1e-6
        && (-(pushX * forwardX + pushZ * forwardZ) / pushMagnitude) > 0.72;
      if (headOn || pushMagnitude <= 1e-6) {
        this.speed = -Math.sign(this.speed || 1) * Math.min(2.3, Math.max(0.8, Math.abs(this.speed) * 0.24));
        this.noProgressSeconds += deltaSeconds * 2.8;
      } else {
        // Light per-step scrape friction (~60%/s at 60Hz) so glancing contact
        // slides along the wall instead of parking the car against it.
        this.speed *= 0.985;
        this.noProgressSeconds += deltaSeconds * 1.1;
      }
    }

    // Swept traffic contact: the player is nudged out of the traffic car's
    // circle and loses pace; glancing hits keep most momentum.
    if (this.traffic) {
      this.traffic.stepFixed([this.position.x, this.position.z]);
      const contactRadius = CITY_CAR_RADIUS + CITY_TRAFFIC_CAR_RADIUS;
      for (const car of this.traffic.cars) {
        const dx = resolvedX - car.position[0];
        const dz = resolvedZ - car.position[1];
        const distance = Math.hypot(dx, dz);
        if (distance >= contactRadius) continue;
        collidedThisStep = true;
        const normalX = distance > 1e-6 ? dx / distance : 1;
        const normalZ = distance > 1e-6 ? dz / distance : 0;
        resolvedX = car.position[0] + normalX * (contactRadius + 0.02);
        resolvedZ = car.position[1] + normalZ * (contactRadius + 0.02);
        const forwardX = Math.sin(this.headingRadians);
        const forwardZ = Math.cos(this.headingRadians);
        const approach = -(normalX * forwardX + normalZ * forwardZ);
        this.speed *= approach > 0.72 ? 0.3 : 0.72;
        this.noProgressSeconds += deltaSeconds * 1.6;
      }
    }

    if (sweptCurbCrossing(previousPosition, [resolvedX, resolvedZ])) {
      this.speed *= CITY_CURB_SCRUB_FACTOR;
    }

    this.position = { x: resolvedX, z: resolvedZ };

    const currentPosition: CityPoint = [this.position.x, this.position.z];
    const progress = nearestRouteSample(currentPosition, this.route);
    const meaningfulProgress = progress.remainingDistance < this.previousRemaining - 0.035;
    if (meaningfulProgress) {
      this.noProgressSeconds = Math.max(0, this.noProgressSeconds - deltaSeconds * 2.5);
      this.progressResetSeconds += deltaSeconds;
      if (this.progressResetSeconds > 1.2) this.recoveryAttempts = 0;
    } else if (!this.braking && this.recoveryMode === "none" && Math.abs(this.speed) > 0.45) {
      this.noProgressSeconds += deltaSeconds;
      this.progressResetSeconds = 0;
    }
    this.previousRemaining = progress.remainingDistance;

    // Sustained travel against the route direction flags the wrong-way hint.
    if (this.recoveryMode === "none" && this.speed > 2.5) {
      const headingError = Math.abs(shortestAngle(this.headingRadians, progress.headingRadians));
      if (headingError > Math.PI * 0.62) this.wrongWaySeconds += deltaSeconds;
      else this.wrongWaySeconds = Math.max(0, this.wrongWaySeconds - deltaSeconds * 2);
    } else {
      this.wrongWaySeconds = Math.max(0, this.wrongWaySeconds - deltaSeconds * 2);
    }

    if (progress.distanceFromRoute > 14) this.noProgressSeconds += deltaSeconds * 1.2;
    if (this.noProgressSeconds >= 2.2 && this.recoveryMode === "none") {
      this.recoveryMode = "reverse";
      this.recoveryModeSeconds = CITY_RECOVERY_REVERSE_SECONDS;
      this.speed = Math.min(this.speed, 1);
    }

    if (
      !collidedThisStep
      && progress.distanceFromRoute <= 5.25
      && isPointInWorld(currentPosition, CITY_CAR_RADIUS)
      && isValidCarPosition(currentPosition, CITY_CAR_RADIUS)
    ) {
      this.lastSafePose = { position: currentPosition, headingRadians: this.headingRadians };
    }

    const pickups = this.applyPickups();

    return {
      collectedCoinIds: pickups.coinIds,
      activatedBoostPadIds: pickups.boostPadIds,
      collided: collidedThisStep,
      relocated,
    };
  }

  private applyPickups(): { coinIds: readonly string[]; boostPadIds: readonly string[] } {
    const pickups = detectCityPickups(
      [this.position.x, this.position.z],
      this.collectedCoinIds,
      this.boostPadCooldowns,
      this.pickupResult,
    );
    for (const id of pickups.coinIds) this.collectedCoinIds.add(id);
    for (const id of pickups.boostPadIds) {
      this.boostPadCooldowns.set(id, 4);
      this.boostSeconds = Math.max(this.boostSeconds, 2.2);
      this.speed = Math.max(this.speed, CITY_CRUISE_SPEED + 2.4);
    }
    return pickups;
  }
}
