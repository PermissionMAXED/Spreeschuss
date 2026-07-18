import { describe, expect, it } from "vitest";
import type { DriveControls } from "../../core/contracts/input";
import {
  CITY_CAR_RADIUS,
  CITY_CRUISE_SPEED,
  CITY_FIXED_STEP_SECONDS,
  CITY_OFF_ROAD_SPEED_FACTOR,
  CITY_PARKING_BONUS_MAX_HEADING_ERROR,
  CITY_PARKING_BONUS_MAX_SPEED,
  CITY_TRAFFIC_CAR_RADIUS,
  CityDrivePhysics,
  CityTrafficSim,
  cityRoute,
  distance2d,
  evaluateParkingArrival,
  pointAlongRoute,
  routeLength,
  sweptCurbCrossing,
  type CityPoint,
  type CityCarSnapshot,
  type CityTrafficLoop,
} from ".";

const DRIVE: DriveControls = { steering: 0, braking: false, steeringHeld: false, brakeHeld: false };
const BRAKE: DriveControls = { steering: 0, braking: true, steeringHeld: false, brakeHeld: true };
const STEER_LEFT: DriveControls = { steering: 1, braking: false, steeringHeld: true, brakeHeld: false };
const STEER_RIGHT_HALF: DriveControls = { steering: -0.5, braking: false, steeringHeld: true, brakeHeld: false };

/**
 * Scripted control timeline quantized to 1/30s buckets so 30, 60 and 120fps
 * replays sample identical controls for every fixed physics step.
 */
function scriptedControls(simTimeSeconds: number): DriveControls {
  const bucket = Math.floor(simTimeSeconds * 30 + 1e-9);
  if (bucket < 45) return DRIVE;
  if (bucket < 60) return STEER_LEFT;
  if (bucket < 84) return DRIVE;
  if (bucket < 99) return STEER_RIGHT_HALF;
  if (bucket < 111) return BRAKE;
  return DRIVE;
}

function replayAt(framesPerSecond: number, totalSeconds: number): CityCarSnapshot {
  const physics = new CityDrivePhysics(cityRoute("carrot-market"));
  const frameSeconds = 1 / framesPerSecond;
  const frames = Math.round(totalSeconds * framesPerSecond);
  for (let frame = 0; frame < frames; frame += 1) {
    physics.step(frameSeconds, scriptedControls(frame * frameSeconds));
  }
  return physics.snapshot;
}

function stepSeconds(
  physics: CityDrivePhysics,
  seconds: number,
  controls: DriveControls,
): { collided: boolean; snapshots: CityCarSnapshot[] } {
  const steps = Math.round(seconds / CITY_FIXED_STEP_SECONDS);
  const snapshots: CityCarSnapshot[] = [];
  let collided = false;
  for (let step = 0; step < steps; step += 1) {
    const result = physics.step(CITY_FIXED_STEP_SECONDS, controls);
    collided ||= result.collided;
    snapshots.push(result.snapshot);
  }
  return { collided, snapshots };
}

describe("replay determinism", () => {
  it("produces identical trajectories at 30, 60, and 120 fps", () => {
    const seconds = 5;
    const at30 = replayAt(30, seconds);
    const at60 = replayAt(60, seconds);
    const at120 = replayAt(120, seconds);

    for (const other of [at60, at120]) {
      expect(other.position[0]).toBeCloseTo(at30.position[0], 10);
      expect(other.position[1]).toBeCloseTo(at30.position[1], 10);
      expect(other.headingRadians).toBeCloseTo(at30.headingRadians, 10);
      expect(other.speed).toBeCloseTo(at30.speed, 10);
      expect(other.collectedCoinIds).toEqual(at30.collectedCoinIds);
      expect(other.recoveryMode).toBe(at30.recoveryMode);
    }
  });

  it("keeps traffic deterministic across mixed frame rates", () => {
    const player: CityPoint = [30, 50];
    const coarse = new CityTrafficSim();
    const fine = new CityTrafficSim();
    const seconds = 6;
    for (let frame = 0; frame < seconds * 30; frame += 1) coarse.step(1 / 30, player);
    for (let frame = 0; frame < seconds * 120; frame += 1) fine.step(1 / 120, player);

    const coarseCars = coarse.cars.map((car) => ({ ...car }));
    for (const [index, car] of fine.cars.entries()) {
      const other = coarseCars[index];
      if (!other) throw new Error("Traffic car count diverged between replays");
      expect(car.position[0]).toBeCloseTo(other.position[0], 10);
      expect(car.position[1]).toBeCloseTo(other.position[1], 10);
      expect(car.speed).toBeCloseTo(other.speed, 10);
    }
  });

  it("interpolates the render pose between fixed steps", () => {
    const physics = new CityDrivePhysics(cityRoute("carrot-market"));
    stepSeconds(physics, 1, DRIVE);
    const before = physics.snapshot.position;
    physics.step(CITY_FIXED_STEP_SECONDS, DRIVE);
    const after = physics.snapshot.position;
    expect(distance2d(before, after)).toBeGreaterThan(0.01);

    // A half-step frame accumulates time without running a fixed step, so the
    // render pose sits halfway between the last two simulated positions.
    physics.step(CITY_FIXED_STEP_SECONDS / 2, DRIVE);
    expect(physics.snapshot.position).toEqual(after);
    const pose = physics.renderPose();
    expect(pose.position[0]).toBeCloseTo((before[0] + after[0]) / 2, 6);
    expect(pose.position[1]).toBeCloseTo((before[1] + after[1]) / 2, 6);
  });
});

describe("swept collisions and sliding", () => {
  it("soft-bounces off a head-on building impact without penetrating", () => {
    // Drive due south into the Carrot Market's north face.
    const physics = new CityDrivePhysics(cityRoute("carrot-market"), {
      position: [-18, -45],
      headingRadians: Math.PI,
    });
    const run = stepSeconds(physics, 3, DRIVE);
    expect(run.collided).toBe(true);
    let bounced = false;
    for (const snapshot of run.snapshots) {
      // North face sits at z=-49.3; the car circle may only touch it.
      expect(snapshot.position[1]).toBeGreaterThan(-49.3 - CITY_CAR_RADIUS - 0.1);
      bounced ||= snapshot.speed < 0;
    }
    expect(bounced).toBe(true);
  });

  it("slides along a wall on glancing contact instead of sticking", () => {
    // Head almost due east along the fluff-salon route while pressing gently
    // south into the old-clock-house north face (z=-36.3): the car should
    // scrape along the wall and keep making progress instead of parking.
    const physics = new CityDrivePhysics(cityRoute("fluff-salon"), {
      position: [9, -34.8],
      headingRadians: Math.PI / 2 + 0.12,
    });
    const run = stepSeconds(physics, 2, DRIVE);
    expect(run.collided).toBe(true);
    for (const snapshot of run.snapshots) {
      expect(snapshot.position[1]).toBeGreaterThan(-36.3 + CITY_CAR_RADIUS - 0.1);
    }
    const final = physics.snapshot;
    expect(final.position[0]).toBeGreaterThan(14);
    expect(final.speed).toBeGreaterThan(1.5);
  });

  it("detects swept curb crossings and scrubs speed over them", () => {
    // Main avenue spans x in [-5, 5]; z=36 is mid-block, away from junctions.
    expect(sweptCurbCrossing([0, 36], [7, 36])).toBe(true);
    expect(sweptCurbCrossing([0, 32], [0, 40])).toBe(false);
    expect(sweptCurbCrossing([0, 36], [0, 36])).toBe(false);

    // Driving east off the avenue must cross the curb line and lose pace.
    const physics = new CityDrivePhysics(cityRoute("carrot-market"), {
      position: [0, 36],
      headingRadians: Math.PI / 2,
    });
    let previousSpeed = 0;
    let scrubbed = false;
    for (let step = 0; step < 120; step += 1) {
      const before = physics.snapshot.position[0];
      const result = physics.step(CITY_FIXED_STEP_SECONDS, DRIVE);
      if (before < 5 && result.snapshot.position[0] >= 5) {
        scrubbed = result.snapshot.speed < previousSpeed - 0.2;
      }
      previousSpeed = result.snapshot.speed;
    }
    expect(scrubbed).toBe(true);
  });

  it("caps cruise speed while off the paved road", () => {
    const onRoad = new CityDrivePhysics(cityRoute("carrot-market"));
    stepSeconds(onRoad, 2, DRIVE);
    expect(onRoad.snapshot.offRoad).toBe(false);
    expect(onRoad.snapshot.speed).toBeGreaterThan(CITY_CRUISE_SPEED - 0.5);

    const offRoad = new CityDrivePhysics(cityRoute("carrot-market"), {
      position: [-8, 28],
      headingRadians: 0,
    });
    stepSeconds(offRoad, 2, DRIVE);
    expect(offRoad.snapshot.offRoad).toBe(true);
    expect(offRoad.snapshot.speed).toBeLessThanOrEqual(
      CITY_CRUISE_SPEED * CITY_OFF_ROAD_SPEED_FACTOR + 0.01,
    );
  });

  it("flags sustained wrong-way driving and clears it when realigned", () => {
    const route = cityRoute("carrot-market");
    const start = pointAlongRoute(route, 30);
    const physics = new CityDrivePhysics(route, {
      position: start.point,
      headingRadians: start.headingRadians + Math.PI,
    });
    expect(physics.snapshot.wrongWay).toBe(false);
    stepSeconds(physics, 2, DRIVE);
    expect(physics.snapshot.wrongWay).toBe(true);

    const forward = new CityDrivePhysics(route);
    stepSeconds(forward, 2, DRIVE);
    expect(forward.snapshot.wrongWay).toBe(false);
  });
});

describe("deterministic lane traffic", () => {
  const shuttleLoop: CityTrafficLoop = {
    id: "test-shuttle",
    points: [[-2.5, 44], [-2.5, -58], [2.5, -58], [2.5, 44]],
    speed: 8,
    phase: 0,
  };

  it("yields to a player parked in the lane ahead", () => {
    const traffic = new CityTrafficSim([shuttleLoop]);
    const player: CityPoint = [-2.5, 38];
    let sawYield = false;
    for (let step = 0; step < 240; step += 1) {
      traffic.stepFixed(player);
      for (const car of traffic.cars) {
        sawYield ||= car.yielding;
        expect(distance2d(car.position, player)).toBeGreaterThan(3);
      }
    }
    expect(sawYield).toBe(true);
    const blocked = traffic.cars.find((car) => car.position[1] > 38);
    expect(blocked).toBeDefined();
    expect(Math.abs(blocked?.speed ?? 99)).toBeLessThan(0.5);
  });

  it("keeps following distance behind a stopped leader", () => {
    const traffic = new CityTrafficSim([shuttleLoop]);
    const player: CityPoint = [-2.5, 38];
    // 30 simulated seconds: the trailing car laps around and stacks up behind
    // the leader that is stopped for the player.
    for (let step = 0; step < 30 * 60; step += 1) {
      traffic.stepFixed(player);
      const [first, second] = traffic.cars;
      if (!first || !second) throw new Error("Expected two shuttle cars");
      expect(distance2d(first.position, second.position)).toBeGreaterThan(2);
    }
    const [first, second] = traffic.cars;
    if (!first || !second) throw new Error("Expected two shuttle cars");
    expect(Math.abs(first.speed)).toBeLessThan(0.5);
    expect(Math.abs(second.speed)).toBeLessThan(1.5);
  });

  it("resolves player overlap with a traffic car by pushing out and scrubbing", () => {
    const traffic = new CityTrafficSim([shuttleLoop]);
    const spawn = traffic.cars[0];
    if (!spawn) throw new Error("Expected a traffic car");
    const physics = new CityDrivePhysics(cityRoute("carrot-market"), {
      position: spawn.position,
      headingRadians: 0,
    });
    physics.attachTraffic(traffic);
    const result = physics.step(CITY_FIXED_STEP_SECONDS, DRIVE);
    expect(result.collided).toBe(true);
    const contactRadius = CITY_CAR_RADIUS + CITY_TRAFFIC_CAR_RADIUS;
    for (const car of traffic.cars) {
      expect(distance2d(physics.snapshot.position, car.position)).toBeGreaterThanOrEqual(
        contactRadius - 1e-6,
      );
    }
  });
});

describe("parking arrival validation", () => {
  it("awards the bonus only for a slow, aligned arrival", () => {
    const route = cityRoute("carrot-market");
    const arrival = pointAlongRoute(route, routeLength(route));

    const perfect = evaluateParkingArrival(
      { speed: CITY_PARKING_BONUS_MAX_SPEED - 1, headingRadians: arrival.headingRadians },
      route,
    );
    expect(perfect.bonus).toBe(true);

    const tooFast = evaluateParkingArrival(
      { speed: CITY_PARKING_BONUS_MAX_SPEED + 2, headingRadians: arrival.headingRadians },
      route,
    );
    expect(tooFast.bonus).toBe(false);

    const sideways = evaluateParkingArrival(
      {
        speed: 1,
        headingRadians: arrival.headingRadians + CITY_PARKING_BONUS_MAX_HEADING_ERROR + 0.4,
      },
      route,
    );
    expect(sideways.bonus).toBe(false);
    expect(sideways.headingErrorRadians).toBeGreaterThan(CITY_PARKING_BONUS_MAX_HEADING_ERROR);
  });

  it("grades every shop route arrival consistently", () => {
    for (const shop of ["carrot-market", "cloud-boutique", "fluff-salon"] as const) {
      const route = cityRoute(shop);
      const arrival = pointAlongRoute(route, routeLength(route));
      const quality = evaluateParkingArrival(
        { speed: 0.5, headingRadians: arrival.headingRadians },
        route,
      );
      expect(quality.bonus).toBe(true);
      expect(quality.headingErrorRadians).toBeCloseTo(0, 6);
    }
  });
});
