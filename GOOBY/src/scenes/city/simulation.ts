import type { DriveControls } from "../../core/contracts/input";
import {
  BOOST_PICKUP_RADIUS,
  CITY_BOOST_PADS,
  CITY_BUILDINGS,
  CITY_COINS,
  CITY_WORLD_BOUNDS,
  COIN_PICKUP_RADIUS,
  distance2d,
  isPointInWorld,
  isValidCarPosition,
  nearestRouteSample,
  pointAlongRoute,
  routeLength,
  type CityPoint,
} from "../../data/city";

export const CITY_CAR_RADIUS = 1.15;
export const CITY_CRUISE_SPEED = 8;
export const CITY_BOOST_SPEED = 12.5;
export const CITY_REVERSE_SPEED = -3.2;
export const CITY_RECOVERY_REVERSE_SECONDS = 0.9;
export const CITY_RECOVERY_REAIM_SECONDS = 0.7;
export const CITY_RELOCATION_ATTEMPTS = 3;

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

interface MutablePosition {
  x: number;
  z: number;
}

interface CollisionResult {
  readonly position: CityPoint;
  readonly collided: boolean;
}

const EMPTY_CONTROLS: DriveControls = {
  steering: 0,
  braking: false,
  steeringHeld: false,
  brakeHeld: false,
};

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
  boostPadCooldowns: ReadonlyMap<string, number> = new Map(),
): {
  readonly coinIds: readonly string[];
  readonly boostPadIds: readonly string[];
} {
  const coinIds = CITY_COINS
    .filter((coin) => !collectedCoinIds.has(coin.id) && distance2d(position, coin.position) <= COIN_PICKUP_RADIUS)
    .map((coin) => coin.id);
  const boostPadIds = CITY_BOOST_PADS
    .filter((pad) => (boostPadCooldowns.get(pad.id) ?? 0) <= 0
      && distance2d(position, pad.position) <= BOOST_PICKUP_RADIUS)
    .map((pad) => pad.id);
  return { coinIds, boostPadIds };
}

export class CityDrivePhysics {
  private position: MutablePosition;
  private headingRadians: number;
  private speed = 0;
  private boostSeconds = 0;
  private braking = false;
  private recoveryMode: RecoveryMode = "none";
  private recoveryModeSeconds = 0;
  private recoveryAttempts = 0;
  private noProgressSeconds = 0;
  private progressResetSeconds = 0;
  private route: readonly CityPoint[];
  private previousRemaining: number;
  private readonly collectedCoinIds = new Set<string>();
  private readonly boostPadCooldowns = new Map<string, number>();
  private lastSafePose: RecoveryPose;

  constructor(
    route: readonly CityPoint[],
    initialPose?: { readonly position: CityPoint; readonly headingRadians: number },
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
    this.previousRemaining = nearestRouteSample(initial.position, route).remainingDistance;
    this.lastSafePose = { position: initial.position, headingRadians: initial.headingRadians };
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
    };
  }

  get safePose(): RecoveryPose {
    return this.lastSafePose;
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
    this.speed = 0;
    this.boostSeconds = 0;
    this.braking = false;
    this.recoveryMode = "none";
    this.recoveryModeSeconds = 0;
    this.noProgressSeconds = 0;
    this.recoveryAttempts = 0;
    this.previousRemaining = nearestRouteSample(start.position, route).remainingDistance;
    this.lastSafePose = start;
  }

  park(brakeLights = true): void {
    this.speed = 0;
    this.boostSeconds = 0;
    this.braking = brakeLights;
    this.recoveryMode = "none";
    this.recoveryModeSeconds = 0;
    this.noProgressSeconds = 0;
  }

  recoverNow(reason: "off-route" | "stalled" | "invalid-pose"): RecoveryPose {
    void reason;
    const recovered = computeBoundedRecoveryPose([this.position.x, this.position.z], this.route);
    this.position = { x: recovered.position[0], z: recovered.position[1] };
    this.headingRadians = recovered.headingRadians;
    this.speed = 0;
    this.recoveryMode = "relocated";
    this.recoveryModeSeconds = 0.25;
    this.noProgressSeconds = 0;
    this.recoveryAttempts = 0;
    this.previousRemaining = nearestRouteSample(recovered.position, this.route).remainingDistance;
    this.lastSafePose = recovered;
    return recovered;
  }

  step(deltaSeconds: number, controls: DriveControls = EMPTY_CONTROLS): DriveStepResult {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) {
      throw new RangeError("Drive delta must be finite and non-negative");
    }
    const collected: string[] = [];
    const boosted: string[] = [];
    let collided = false;
    let relocated = false;
    let remaining = Math.min(deltaSeconds, 0.5);

    while (remaining > 0) {
      const stepSeconds = Math.min(remaining, 1 / 30);
      const result = this.stepFixed(stepSeconds, controls);
      collected.push(...result.collectedCoinIds);
      boosted.push(...result.activatedBoostPadIds);
      collided ||= result.collided;
      relocated ||= result.relocated;
      remaining -= stepSeconds;
    }

    return {
      snapshot: this.snapshot,
      collectedCoinIds: collected,
      activatedBoostPadIds: boosted,
      collided,
      relocated,
    };
  }

  private stepFixed(deltaSeconds: number, controls: DriveControls): Omit<DriveStepResult, "snapshot"> {
    for (const [id, cooldown] of this.boostPadCooldowns) {
      const next = cooldown - deltaSeconds;
      if (next <= 0) this.boostPadCooldowns.delete(id);
      else this.boostPadCooldowns.set(id, next);
    }
    this.boostSeconds = Math.max(0, this.boostSeconds - deltaSeconds);
    this.braking = controls.braking || controls.brakeHeld;

    let relocated = false;
    if (this.recoveryMode === "relocated") {
      this.recoveryModeSeconds -= deltaSeconds;
      if (this.recoveryModeSeconds <= 0) this.recoveryMode = "none";
    } else if (this.recoveryMode === "reverse") {
      this.speed = moveToward(this.speed, CITY_REVERSE_SPEED, 9 * deltaSeconds);
      if (controls.steeringHeld) {
        this.headingRadians = normalizeAngle(this.headingRadians + controls.steering * 0.7 * deltaSeconds);
      }
      this.recoveryModeSeconds -= deltaSeconds;
      if (this.recoveryModeSeconds <= 0) {
        this.recoveryMode = "re-aim";
        this.recoveryModeSeconds = CITY_RECOVERY_REAIM_SECONDS;
      }
    } else if (this.recoveryMode === "re-aim") {
      this.speed = moveToward(this.speed, 1.2, 8 * deltaSeconds);
      const nearest = nearestRouteSample([this.position.x, this.position.z], this.route);
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
      const targetSpeed = this.braking ? 0 : this.boostSeconds > 0 ? CITY_BOOST_SPEED : CITY_CRUISE_SPEED;
      const acceleration = targetSpeed > this.speed ? 4.4 : 9.5;
      this.speed = moveToward(this.speed, targetSpeed, acceleration * deltaSeconds);
      if (controls.steeringHeld && Math.abs(this.speed) > 0.25) {
        const speedFactor = Math.max(0.4, Math.min(1, Math.abs(this.speed) / CITY_CRUISE_SPEED));
        this.headingRadians = normalizeAngle(
          this.headingRadians + controls.steering * (1.55 - speedFactor * 0.38) * deltaSeconds,
        );
      }
    }

    const proposed: CityPoint = [
      this.position.x + Math.sin(this.headingRadians) * this.speed * deltaSeconds,
      this.position.z + Math.cos(this.headingRadians) * this.speed * deltaSeconds,
    ];
    const collision = resolveCityCollision(proposed);
    this.position = { x: collision.position[0], z: collision.position[1] };
    if (collision.collided) {
      this.speed = -Math.sign(this.speed || 1) * Math.min(2.3, Math.max(0.8, Math.abs(this.speed) * 0.24));
      this.noProgressSeconds += deltaSeconds * 2.8;
    }

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

    if (progress.distanceFromRoute > 14) this.noProgressSeconds += deltaSeconds * 1.2;
    if (this.noProgressSeconds >= 2.2 && this.recoveryMode === "none") {
      this.recoveryMode = "reverse";
      this.recoveryModeSeconds = CITY_RECOVERY_REVERSE_SECONDS;
      this.speed = Math.min(this.speed, 1);
    }

    if (
      !collision.collided
      && progress.distanceFromRoute <= 5.25
      && isPointInWorld(currentPosition, CITY_CAR_RADIUS)
      && isValidCarPosition(currentPosition, CITY_CAR_RADIUS)
    ) {
      this.lastSafePose = { position: currentPosition, headingRadians: this.headingRadians };
    }

    const pickups = detectCityPickups(currentPosition, this.collectedCoinIds, this.boostPadCooldowns);
    for (const id of pickups.coinIds) this.collectedCoinIds.add(id);
    for (const id of pickups.boostPadIds) {
      this.boostPadCooldowns.set(id, 4);
      this.boostSeconds = Math.max(this.boostSeconds, 2.2);
      this.speed = Math.max(this.speed, CITY_CRUISE_SPEED + 2.4);
    }

    return {
      collectedCoinIds: pickups.coinIds,
      activatedBoostPadIds: pickups.boostPadIds,
      collided: collision.collided,
      relocated,
    };
  }
}
