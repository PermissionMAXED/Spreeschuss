import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import { FallbackAssetLoader } from "../../render/proc";
import {
  CITY_BOOST_PADS,
  CITY_BUILDINGS,
  CITY_COINS,
  CITY_DESTINATIONS,
  CITY_GARAGE_POSITION,
  CITY_HUD_RESERVED_REGIONS,
  CITY_MARKER_VISUALS,
  CITY_RENDER_BUDGET,
  CITY_CONTROL_HIT_REGIONS,
  GARAGE_TRIGGER_RADIUS,
  PARKING_TRIGGER_RADIUS,
  CityAssetDepot,
  CityDrivePhysics,
  CityRouteMachine,
  DriveControlState,
  cityRoute,
  computeCityCameraPose,
  computeBoundedRecoveryPose,
  computeEdgePointer,
  createSafeBoardTravelSnapshot,
  detectCityPickups,
  didReachCityTrigger,
  distance2d,
  hitRegionsOverlap,
  isPointInWorld,
  isPointOnRoad,
  isValidCarPosition,
  nearestRouteSample,
  parseCityTravelSnapshot,
  pointAlongRoute,
  routeLength,
  type CityPoint,
} from ".";
import type { ShopId } from "../../core/contracts/scenes";

const SHOP_IDS: readonly ShopId[] = ["carrot-market", "cloud-boutique", "fluff-salon"];
const RELEASED = { steering: 0, braking: false, steeringHeld: false, brakeHeld: false } as const;

function angleDelta(from: number, to: number): number {
  let delta = to - from;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}

function simulatePointerSteering(
  physics: CityDrivePhysics,
  target: CityPoint,
  radius: number,
  maxSteps = 1_200,
): number {
  for (let step = 0; step < maxSteps; step += 1) {
    const { position, headingRadians } = physics.snapshot;
    if (distance2d(position, target) <= radius) return step;
    const desired = Math.atan2(target[0] - position[0], target[1] - position[1]);
    const error = angleDelta(headingRadians, desired);
    const controls = Math.abs(error) < 0.11
      ? RELEASED
      : {
          steering: error > 0 ? 1 : -1,
          braking: false,
          steeringHeld: true,
          brakeHeld: false,
        };
    physics.step(1 / 30, controls);
  }
  return maxSteps;
}

describe("city route reachability", () => {
  it("keeps every complete route centered on connected roads and clear of buildings", () => {
    for (const shop of SHOP_IDS) {
      const route = cityRoute(shop);
      const total = routeLength(route);
      expect(total).toBeGreaterThan(80);
      for (let distance = 0; distance <= total; distance += 0.5) {
        const sample = pointAlongRoute(route, distance);
        expect(isPointOnRoad(sample.point), `${shop} road gap near ${distance}m`).toBe(true);
        expect(isValidCarPosition(sample.point, 1.15), `${shop} obstruction near ${distance}m`).toBe(true);
      }
      const destination = CITY_DESTINATIONS[shop];
      const end = route.at(-1);
      expect(end).toEqual([destination.markerPosition[0], destination.markerPosition[2]]);
    }
  });

  it("preserves the frozen destination coordinates and useful spatial radii", () => {
    expect(CITY_DESTINATIONS["carrot-market"].markerPosition).toEqual([-18, 0.2, -44]);
    expect(CITY_DESTINATIONS["cloud-boutique"].markerPosition).toEqual([26, 0.2, -68]);
    expect(CITY_DESTINATIONS["fluff-salon"].markerPosition).toEqual([42, 0.2, -31]);
    expect(PARKING_TRIGGER_RADIUS).toBeGreaterThan(3);
    expect(PARKING_TRIGGER_RADIUS).toBeLessThan(4);
  });
});

describe("parked route phases and destination gating", () => {
  it("does not move out of the garage until the explicit departure action", () => {
    const city = new CityRouteMachine();
    expect(city.state).toEqual({ phase: "destination-board", car: "parked", selected: null });
    city.selectDestination("fluff-salon");
    expect(city.state).toMatchObject({ phase: "depart-ready", car: "parked", selected: "fluff-salon" });
    expect(city.visibleParkingTrigger).toBeNull();
    city.confirmDeparture();
    expect(city.state).toMatchObject({
      phase: "driving-outbound",
      car: "auto-throttle",
      selected: "fluff-salon",
    });
    expect(city.visibleParkingTrigger?.destination).toBe("fluff-salon");
  });

  it("lets only the selected visible parking trigger fire, and only inside its exact radius", () => {
    const city = new CityRouteMachine();
    city.selectDestination("carrot-market");
    city.confirmDeparture();
    const selected = CITY_DESTINATIONS["carrot-market"].markerPosition;
    const unselected = CITY_DESTINATIONS["cloud-boutique"].markerPosition;
    expect(city.canTriggerArrival("cloud-boutique", unselected)).toBe(false);
    expect(city.tryArriveAt([unselected[0], unselected[2]])).toBeNull();
    expect(city.canTriggerArrival("carrot-market", [selected[0] + PARKING_TRIGGER_RADIUS + 0.01, selected[2]])).toBe(false);
    expect(city.canTriggerArrival("carrot-market", [selected[0] + PARKING_TRIGGER_RADIUS - 0.01, selected[2]])).toBe(true);
    expect(city.tryArriveAt([selected[0], selected[2]])).toBe("carrot-market");
    expect(city.state).toMatchObject({ phase: "arrived", car: "parked", selected: "carrot-market" });
  });

  it("detects a selected destination crossed between coarse frame samples", () => {
    const city = new CityRouteMachine();
    city.selectDestination("carrot-market");
    city.confirmDeparture();
    expect(city.tryArriveAlong([-11, -44], [-25, -44])).toBe("carrot-market");
    expect(city.state).toMatchObject({ phase: "arrived", selected: "carrot-market" });
  });

  it("requires the first return drive and unlocks an optional later quick trip", () => {
    const city = new CityRouteMachine();
    city.selectDestination("cloud-boutique");
    city.confirmDeparture();
    city.arrive("cloud-boutique");
    city.openReturnBoard();
    expect(city.state).toMatchObject({ phase: "return-board", returnRequired: true });
    expect(() => city.useQuickReturn()).toThrow(/first visit/u);
    city.confirmReturnDeparture();
    city.arriveHome();

    city.selectDestination("cloud-boutique");
    city.confirmDeparture();
    city.arrive("cloud-boutique");
    city.openReturnBoard();
    expect(city.state).toMatchObject({ phase: "return-board", returnRequired: false });
    city.useQuickReturn();
    expect(city.state).toEqual({ phase: "destination-board", car: "parked", selected: null });
  });
});

describe("real hold controls and drive responses", () => {
  it("tracks independent pointer press, hold, release, and brake state", () => {
    const controls = new DriveControlState();
    expect(controls.controls).toEqual(RELEASED);
    expect(controls.press(1, "steer-left")).toMatchObject({ steering: 1, steeringHeld: true });
    expect(controls.press(2, "brake")).toMatchObject({ steering: 1, braking: true, brakeHeld: true });
    expect(controls.release(1)).toMatchObject({ steering: 0, braking: true, steeringHeld: false });
    expect(controls.press(3, "steer-right")).toMatchObject({ steering: -1, braking: true });
    expect(controls.release(2)).toMatchObject({ steering: -1, braking: false });
    expect(controls.releaseAll()).toEqual(RELEASED);
  });

  it("composes held keyboard and pointer controls and clears every source together", () => {
    const controls = new DriveControlState();
    expect(controls.pressKey("KeyA")).toMatchObject({ steering: 1, steeringHeld: true });
    expect(controls.press(8, "brake")).toMatchObject({ steering: 1, braking: true });
    expect(controls.pressKey("ArrowRight")).toMatchObject({ steering: 0, steeringHeld: true });
    expect(controls.releaseKey("KeyA")).toMatchObject({ steering: -1, braking: true });
    expect(controls.pressKey("Space")).toMatchObject({ steering: -1, brakeHeld: true });
    expect(controls.release(8)).toMatchObject({ steering: -1, braking: true });
    expect(controls.releaseAll()).toEqual(RELEASED);
  });

  it("auto-throttles, visibly brakes, and materially slows while brake is held", () => {
    const physics = new CityDrivePhysics(cityRoute("carrot-market"));
    for (let index = 0; index < 30; index += 1) physics.step(0.1, RELEASED);
    const cruisingSpeed = physics.snapshot.speed;
    expect(cruisingSpeed).toBeGreaterThan(7);
    const braking = { steering: 0, braking: true, steeringHeld: false, brakeHeld: true } as const;
    for (let index = 0; index < 10; index += 1) physics.step(0.1, braking);
    expect(physics.snapshot.speed).toBeLessThan(cruisingSpeed * 0.25);
    expect(physics.snapshot.braking).toBe(true);
  });

  it("can be manually steered through outbound and return route corners", () => {
    const outbound = cityRoute("carrot-market");
    const outboundPhysics = new CityDrivePhysics(outbound);
    const outboundSteps = simulatePointerSteering(outboundPhysics, [-18, -44], 3);
    expect(outboundSteps).toBeLessThan(1_200);

    const home = cityRoute("carrot-market", "home");
    const homePhysics = new CityDrivePhysics(home);
    expect(simulatePointerSteering(homePhysics, [0, -44], 3)).toBeLessThan(1_200);
    expect(simulatePointerSteering(homePhysics, CITY_GARAGE_POSITION, 3)).toBeLessThan(1_200);
  });

  it("detects return arrival across varied frame partitions and route approaches", () => {
    const approaches: ReadonlyArray<readonly [CityPoint, CityPoint]> = [
      [[0, 44], [0, 60]],
      [[-3.5, 42], [3.5, 59]],
      [[3.8, 43], [-2.5, 59]],
    ];
    const framePartitions: readonly (readonly number[])[] = [
      [1],
      [0.5, 0.5],
      [0.05, 0.12, 0.33, 0.08, 0.42],
    ];

    for (const [from, to] of approaches) {
      for (const partitions of framePartitions) {
        let previous = from;
        let progress = 0;
        let arrived = false;
        for (const partition of partitions) {
          progress += partition;
          const next: CityPoint = [
            from[0] + (to[0] - from[0]) * progress,
            from[1] + (to[1] - from[1]) * progress,
          ];
          arrived ||= didReachCityTrigger(
            previous,
            next,
            CITY_GARAGE_POSITION,
            GARAGE_TRIGGER_RADIUS,
          );
          previous = next;
        }
        expect(arrived, `${from.join(",")} -> ${to.join(",")} via ${partitions.join(",")}`).toBe(true);
      }
    }
  });
});

describe("serializable city travel snapshots", () => {
  it("round-trips an outbound leg with its safe pose and collected route state", () => {
    const outbound = new CityRouteMachine();
    outbound.selectDestination("carrot-market");
    outbound.confirmDeparture();
    const snapshot = outbound.createTravelSnapshot(
      { position: [0, 27], headingRadians: Math.PI },
      ["coin-garage", "coin-maple"],
    );
    const serialized: unknown = JSON.parse(JSON.stringify(snapshot));
    const restored = new CityRouteMachine([], serialized);
    expect(restored.state).toMatchObject({
      phase: "driving-outbound",
      selected: "carrot-market",
    });
    expect(restored.restoredTravelSnapshot).toMatchObject({
      safeCarPose: { position: [0, 27], headingRadians: Math.PI },
      collectedRouteState: { coinIds: ["coin-garage", "coin-maple"] },
      returnRequired: true,
    });
  });

  it("restores arrived, required-return board, and driving-home phases without unlocking teleport", () => {
    const trip = new CityRouteMachine();
    trip.selectDestination("cloud-boutique");
    trip.confirmDeparture();
    trip.arrive("cloud-boutique");
    const arrived = trip.createTravelSnapshot(
      { position: [26, -68], headingRadians: Math.PI / 2 },
      ["coin-promenade"],
    );
    const arrivedReload = new CityRouteMachine([], arrived);
    expect(arrivedReload.state).toMatchObject({ phase: "arrived", selected: "cloud-boutique" });
    arrivedReload.openReturnBoard();
    expect(arrivedReload.state).toMatchObject({ phase: "return-board", returnRequired: true });
    const returnBoard = arrivedReload.createTravelSnapshot(
      { position: [26, -68], headingRadians: -Math.PI / 2 },
      ["coin-promenade"],
    );
    const returnReload = new CityRouteMachine(arrivedReload.visitedShops(), returnBoard);
    expect(returnReload.state).toMatchObject({ phase: "return-board", returnRequired: true });
    expect(() => returnReload.useQuickReturn()).toThrow(/first visit/u);
    returnReload.confirmReturnDeparture();
    const drivingHome = returnReload.createTravelSnapshot(
      { position: [0, -68], headingRadians: 0 },
      ["coin-promenade"],
    );
    const drivingReload = new CityRouteMachine(returnReload.visitedShops(), drivingHome);
    expect(drivingReload.state).toMatchObject({
      phase: "driving-home",
      visited: "cloud-boutique",
    });
  });

  it("fails closed to the garage board and upgrades inconsistent first-return data", () => {
    const invalid = {
      ...createSafeBoardTravelSnapshot(),
      phase: "driving-outbound",
      destination: "carrot-market",
      safeCarPose: { position: [999, 999], headingRadians: 0 },
    };
    expect(parseCityTravelSnapshot(invalid)).toBeNull();
    expect(new CityRouteMachine([], invalid).state).toEqual({
      phase: "destination-board",
      car: "parked",
      selected: null,
    });

    const tampered = {
      phase: "return-board",
      destination: null,
      visitedShop: "carrot-market",
      returnRequired: false,
      safeCarPose: { position: [-18, -44], headingRadians: Math.PI / 2 },
      collectedRouteState: { coinIds: [] },
    };
    const parsed = parseCityTravelSnapshot(tampered, []);
    expect(parsed?.returnRequired).toBe(true);
    const restored = new CityRouteMachine([], tampered);
    expect(restored.state).toMatchObject({ phase: "return-board", returnRequired: true });
    expect(() => restored.useQuickReturn()).toThrow(/first visit/u);
  });
});

describe("pickups and recovery", () => {
  it("collects each coin once and activates boost pads spatially", () => {
    const coin = CITY_COINS[0];
    const boost = CITY_BOOST_PADS[0];
    if (!coin || !boost) throw new Error("City pickup data is incomplete");
    const firstCoin = detectCityPickups(coin.position, new Set());
    expect(firstCoin.coinIds).toContain(coin.id);
    expect(detectCityPickups(coin.position, new Set([coin.id])).coinIds).not.toContain(coin.id);
    expect(detectCityPickups(boost.position, new Set()).boostPadIds).toContain(boost.id);

    const physics = new CityDrivePhysics(cityRoute("carrot-market"), {
      position: coin.position,
      headingRadians: Math.PI,
    });
    const step = physics.step(0.01, RELEASED);
    expect(step.collectedCoinIds).toContain(coin.id);
    expect(physics.snapshot.collectedCoinIds).toContain(coin.id);
  });

  it("soft-bounces at a boundary instead of remaining pinned", () => {
    const route = cityRoute("carrot-market");
    const physics = new CityDrivePhysics(route, {
      position: [56.7, 42],
      headingRadians: Math.PI / 2,
    });
    let sawCollision = false;
    let sawRecovery = false;
    for (let index = 0; index < 80; index += 1) {
      const result = physics.step(0.1, RELEASED);
      sawCollision ||= result.collided;
      sawRecovery ||= result.snapshot.recoveryMode !== "none";
    }
    expect(sawCollision).toBe(true);
    expect(sawRecovery).toBe(true);
    expect(isPointInWorld(physics.snapshot.position, 1.15)).toBe(true);
    expect(isValidCarPosition(physics.snapshot.position, 1.15)).toBe(true);
  });

  it("relocates boundary, building, and loop-pocket poses onto a bounded road sample", () => {
    const route = cityRoute("carrot-market");
    const building = CITY_BUILDINGS.find(({ shop }) => shop === "fluff-salon");
    if (!building) throw new Error("Fluff Salon lot is missing");
    const pockets: readonly CityPoint[] = [
      [90, 90],
      building.center,
      [35, 8],
    ];
    for (const pocket of pockets) {
      const recovered = computeBoundedRecoveryPose(pocket, route);
      expect(isPointInWorld(recovered.position, 1.15)).toBe(true);
      expect(isValidCarPosition(recovered.position, 1.15)).toBe(true);
      expect(nearestRouteSample(recovered.position, route).distanceFromRoute).toBeLessThan(0.001);
      expect(Number.isFinite(recovered.headingRadians)).toBe(true);
    }
  });
});

describe("marker legibility and mobile budgets", () => {
  it("keeps a fog-free gold marker with a beacon, exact P disc, and trigger-aligned ring", () => {
    expect(CITY_MARKER_VISUALS.fogEnabled).toBe(false);
    expect(CITY_MARKER_VISUALS.goldCss).toBe("#ffc62f");
    expect(CITY_MARKER_VISUALS.beaconHeight).toBeGreaterThanOrEqual(12);
    expect(CITY_MARKER_VISUALS.discRadius).toBeLessThan(PARKING_TRIGGER_RADIUS);
    expect(CITY_MARKER_VISUALS.ringInnerRadius).toBeLessThan(PARKING_TRIGGER_RADIUS);
    expect(CITY_MARKER_VISUALS.ringOuterRadius).toBeGreaterThan(PARKING_TRIGGER_RADIUS);
  });

  it("keeps control hit regions out of reserved portrait HUD regions", () => {
    for (const region of Object.values(CITY_CONTROL_HIT_REGIONS)) {
      for (const reserved of CITY_HUD_RESERVED_REGIONS) {
        expect(hitRegionsOverlap(region, reserved)).toBe(false);
      }
    }
    const pointer = computeEdgePointer(390, 844, 12, -4);
    expect(pointer.x).toBeGreaterThanOrEqual(34);
    expect(pointer.x).toBeLessThanOrEqual(356);
    expect(pointer.y).toBeGreaterThanOrEqual(112);
    expect(pointer.y).toBeLessThan(714);
  });

  it("caps instanced city content to portrait-mobile budgets", () => {
    expect(CITY_BUILDINGS.length).toBeLessThanOrEqual(CITY_RENDER_BUDGET.maxBuildings);
    expect(CITY_RENDER_BUDGET.maxTrafficCars).toBeLessThanOrEqual(6);
    expect(CITY_RENDER_BUDGET.maxBreadcrumbs).toBeLessThanOrEqual(24);
    expect(CITY_RENDER_BUDGET.targetDrawCalls).toBeLessThanOrEqual(54);
  });

  it("frames the parked garage from in front of its back wall", () => {
    const desired = new Vector3();
    const lookAt = new Vector3();
    computeCityCameraPose({
      position: CITY_GARAGE_POSITION,
      headingRadians: Math.PI,
      speed: 0,
      boostSeconds: 0,
      braking: false,
      recoveryMode: "none",
      recoveryAttempts: 0,
      noProgressSeconds: 0,
      collectedCoinIds: [],
    }, desired, lookAt);
    expect(desired.z).toBeLessThan(59.15);
    expect(lookAt.z).toBeLessThan(desired.z);
    expect(desired.distanceTo(lookAt)).toBeGreaterThan(8);
  });

  it("falls back procedurally when every vendored city asset fails", async () => {
    const loader = new FallbackAssetLoader(() => Promise.reject(new Error("offline")));
    const depot = new CityAssetDepot(loader);
    const audit = await depot.preload();
    expect(audit.every(({ source }) => source === "procedural")).toBe(true);
    expect(audit.every(({ warning }) => warning === "offline")).toBe(true);
    expect(depot.clone("city.car").isObject3D).toBe(true);
    depot.dispose();
  });
});
