import { Vector3 } from "three";
import type { AssetLoader } from "../../core/contracts/assets";
import {
  createEconomy,
  grantReward,
  type Economy,
} from "../../core/contracts/economy";
import type { DriveControls } from "../../core/contracts/input";
import type {
  CityDriveState,
  GameScene,
  SceneContext,
  ShopId,
} from "../../core/contracts/scenes";
import {
  CITY_DESTINATIONS,
  CITY_GARAGE_HEADING,
  CITY_GARAGE_POSITION,
  GARAGE_TRIGGER_RADIUS,
  cityRoute,
  didReachCityTrigger,
  districtAt,
  nearestRouteSample,
  nextRouteManeuver,
  pointAlongRoute,
  type CityPoint,
} from "../../data/city";
import type { GameRenderer } from "../../render/renderer";
import {
  CityDriveOverlay,
  computeEdgePointer,
  type EdgePointerLayout,
  type CityOverlayMetrics,
} from "./overlay";
import { CityRouteMachine } from "./route-machine";
import {
  CITY_PARKING_BONUS_COINS,
  CityDrivePhysics,
  CityTrafficSim,
  evaluateParkingArrival,
  type CityCarSnapshot,
  type ParkingArrivalQuality,
} from "./simulation";
import { CityWorld, type CityWorldStats } from "./world";
import {
  shouldEmitCityTravelSnapshot,
  type CityTravelSnapshot,
} from "./travel-snapshot";

export interface CityDriveSceneOptions {
  readonly renderer: GameRenderer;
  readonly mount: HTMLElement;
  readonly controller?: CityRouteMachine;
  readonly assetLoader?: AssetLoader;
  readonly economy?: Economy;
  readonly onEconomyChanged?: (economy: Economy) => void;
  readonly onStateChanged?: (state: CityDriveState) => void;
  readonly onEnterShop?: (shop: ShopId, scene: CityDriveScene) => void;
  readonly onCoinsCollected?: (count: number, ids: readonly string[]) => void;
  readonly onBoost?: (padIds: readonly string[]) => void;
  readonly onTravelSnapshotChanged?: (snapshot: CityTravelSnapshot) => void;
}

export interface CityDriveDebugSnapshot {
  readonly state: CityDriveState;
  readonly car: CityCarSnapshot;
  readonly economy: Economy;
  readonly activeRoute: readonly CityPoint[];
  readonly worldStats: CityWorldStats | null;
  readonly travelSnapshot: CityTravelSnapshot;
  readonly cameraPosition: readonly [number, number, number];
}

const RELEASED_CONTROLS: DriveControls = {
  steering: 0,
  braking: false,
  steeringHeld: false,
  brakeHeld: false,
};

export class CityDriveScene implements GameScene {
  readonly id = "city:drive" as const;
  readonly controller: CityRouteMachine;
  private readonly physics: CityDrivePhysics;
  private readonly traffic = new CityTrafficSim();
  private lastParking: ParkingArrivalQuality | null = null;
  private world: CityWorld | null = null;
  private overlay: CityDriveOverlay | null = null;
  private economy: Economy;
  private activeRoute: readonly CityPoint[];
  private controls: DriveControls = RELEASED_CONTROLS;
  private entered = false;
  private disposed = false;
  private previousMountPosition = "";
  private travelSnapshotSeconds = 0;
  private lastEmittedSafePosition: CityPoint | null = null;
  private lifecycleFlushInstalled = false;
  private readonly destinationScratch = new Vector3();
  private readonly cameraSpaceScratch = new Vector3();
  private readonly projectedScratch = new Vector3();
  private readonly edgePointerScratch: EdgePointerLayout = { x: 0, y: 0, angleRadians: 0 };
  private readonly safePoseScratch: [number, number, number] = [0, 0.35, 0];

  constructor(private readonly options: CityDriveSceneOptions) {
    this.controller = options.controller ?? new CityRouteMachine();
    this.economy = options.economy ?? createEconomy();
    const restored = this.controller.restoredTravelSnapshot;
    const restoredShop = restored?.destination ?? restored?.visitedShop ?? "carrot-market";
    this.activeRoute = cityRoute(
      restoredShop,
      restored?.phase === "driving-home" ? "home" : "outbound",
    );
    this.physics = new CityDrivePhysics(this.activeRoute, {
      position: restored?.safeCarPose.position ?? CITY_GARAGE_POSITION,
      headingRadians: restored?.safeCarPose.headingRadians ?? CITY_GARAGE_HEADING,
      collectedCoinIds: restored?.collectedRouteState.coinIds ?? [],
    });
    this.physics.attachTraffic(this.traffic);
    if (
      !restored
      || restored.phase === "destination-board"
      || restored.phase === "depart-ready"
    ) {
      this.physics.park(false);
    } else if (restored.phase === "arrived" || restored.phase === "return-board") {
      this.physics.park(true);
    }
  }

  debugSnapshot(): CityDriveDebugSnapshot {
    const car = this.physics.snapshot;
    return {
      state: this.controller.state,
      car,
      economy: this.economy,
      activeRoute: this.activeRoute,
      worldStats: this.world?.stats ?? null,
      travelSnapshot: this.controller.createTravelSnapshot(
        this.physics.safePose,
        car.collectedCoinIds,
      ),
      cameraPosition: [
        this.options.renderer.camera.position.x,
        this.options.renderer.camera.position.y,
        this.options.renderer.camera.position.z,
      ],
    };
  }

  async enter(context: SceneContext): Promise<void> {
    if (this.disposed) throw new Error("A disposed city scene cannot be entered");
    if (this.entered) return;
    this.entered = true;
    this.installLifecycleFlush();
    this.previousMountPosition = this.options.mount.style.position;
    if (getComputedStyle(this.options.mount).position === "static") {
      this.options.mount.style.position = "relative";
    }
    this.world = this.options.assetLoader
      ? await CityWorld.create(this.options.renderer, this.options.assetLoader)
      : await CityWorld.create(this.options.renderer);
    this.overlay = new CityDriveOverlay(this.options.mount, {
      select: (shop) => this.selectDestination(shop),
      depart: () => this.depart(),
      enterShop: () => this.enterShop(),
      driveHome: () => this.driveHome(),
      quickReturn: () => this.quickReturn(),
      controlsChanged: (controls) => this.updateControls(controls),
    });
    this.resize(context);
    this.configureWorldForState();
    const car = this.physics.snapshot;
    this.world.setCar(car);
    this.world.setTraffic(this.traffic.cars);
    this.world.snapCamera(car);
    this.renderUi(car);
    this.emitTravelSnapshot(car);
  }

  update(deltaSeconds: number): void {
    if (!this.entered || this.disposed || !this.world || !this.overlay) return;
    const state = this.controller.state;
    const driving = state.phase === "driving-outbound" || state.phase === "driving-home";
    let car: CityCarSnapshot;

    if (driving) {
      const previousPosition = this.physics.snapshot.position;
      const step = this.physics.step(deltaSeconds, this.controls);
      car = step.snapshot;
      if (step.collectedCoinIds.length > 0) {
        this.economy = grantReward(this.economy, { coins: step.collectedCoinIds.length });
        this.options.onEconomyChanged?.(this.economy);
        this.options.onCoinsCollected?.(step.collectedCoinIds.length, step.collectedCoinIds);
      }
      if (step.activatedBoostPadIds.length > 0) this.options.onBoost?.(step.activatedBoostPadIds);
      const safe = this.physics.safePose;
      this.safePoseScratch[0] = safe.position[0];
      this.safePoseScratch[2] = safe.position[1];
      this.controller.pinSafePose(
        this.safePoseScratch,
        safe.headingRadians,
      );

      if (state.phase === "driving-outbound") {
        const arrived = this.controller.tryArriveAlong(previousPosition, step.snapshot.position);
        if (arrived) {
          this.applyParkingArrival(car);
          this.physics.park(true);
          this.world.showDestination(null);
          this.overlay.releaseControls();
          this.emitState(car);
        }
      } else if (didReachCityTrigger(
        previousPosition,
        step.snapshot.position,
        CITY_GARAGE_POSITION,
        GARAGE_TRIGGER_RADIUS,
      )) {
        this.controller.arriveHome();
        this.physics.setRoute(cityRoute("carrot-market"), {
          position: CITY_GARAGE_POSITION,
          headingRadians: CITY_GARAGE_HEADING,
        });
        this.physics.park(false);
        this.world.showDestination(null);
        this.overlay.releaseControls();
        this.emitState(car);
      }
    } else {
      car = this.physics.snapshot;
      // The city stays alive while parked: traffic keeps circulating and
      // yields around the player's bay at the same deterministic 60Hz rate.
      this.traffic.step(deltaSeconds, car.position);
    }

    this.world.setTraffic(this.traffic.cars);
    this.world.update(deltaSeconds, car, driving ? this.physics.renderPose() : undefined);
    this.renderUi(car);
    this.updateEdgePointer();
    this.travelSnapshotSeconds += deltaSeconds;
    if (shouldEmitCityTravelSnapshot(
      this.travelSnapshotSeconds,
      this.lastEmittedSafePosition,
      this.physics.safePose.position,
    )) {
      this.emitTravelSnapshot(car);
    }
  }

  resize(context: SceneContext): void {
    void context;
    this.options.renderer.resize();
    this.updateEdgePointer();
  }

  exit(): void {
    this.flushTravelSnapshot();
    this.overlay?.releaseControls();
    this.controls = RELEASED_CONTROLS;
    this.entered = false;
  }

  pause(): void {
    this.flushTravelSnapshot();
    this.overlay?.releaseControls();
    this.controls = RELEASED_CONTROLS;
  }

  dispose(): void {
    if (this.disposed) return;
    this.flushTravelSnapshot();
    this.disposed = true;
    this.removeLifecycleFlush();
    this.overlay?.dispose();
    this.overlay = null;
    this.world?.dispose();
    this.world = null;
    this.options.mount.style.position = this.previousMountPosition;
  }

  completeShopVisit(): void {
    this.controller.openReturnBoard();
    this.physics.park(true);
    this.world?.showDestination(null);
    this.emitState();
    this.renderUi(this.physics.snapshot);
  }

  /**
   * Grades the swept arrival into the bay and pays the perfect-parking bonus
   * when the car rolled in slowly while pointing down the bay heading.
   */
  private applyParkingArrival(car: CityCarSnapshot): void {
    const quality = evaluateParkingArrival(car, this.activeRoute);
    this.lastParking = quality;
    if (!quality.bonus) return;
    this.economy = grantReward(this.economy, { coins: CITY_PARKING_BONUS_COINS });
    this.options.onEconomyChanged?.(this.economy);
  }

  recoverCar(reason: "off-route" | "stalled" | "invalid-pose"): void {
    const recovered = this.physics.recoverNow(reason);
    this.controller.pinSafePose(
      [recovered.position[0], 0.35, recovered.position[1]],
      recovered.headingRadians,
    );
    const car = this.physics.snapshot;
    this.world?.setCar(car);
    this.renderUi(car);
  }

  /** Development-only acceleration for full-app browser coverage. */
  completeCurrentLegForTest(): void {
    if (!import.meta.env.DEV && import.meta.env.MODE !== "test") {
      throw new Error("City test acceleration is unavailable in production");
    }
    const state = this.controller.state;
    if (state.phase === "driving-outbound") {
      this.controller.arrive(state.selected);
      const end = pointAlongRoute(this.activeRoute, Number.POSITIVE_INFINITY);
      this.physics.setRoute(this.activeRoute, {
        position: end.point,
        headingRadians: end.headingRadians,
      });
      this.physics.park(true);
      this.applyParkingArrival(this.physics.snapshot);
      this.world?.showDestination(null);
    } else if (state.phase === "driving-home") {
      this.controller.arriveHome();
      this.physics.setRoute(cityRoute("carrot-market"), {
        position: CITY_GARAGE_POSITION,
        headingRadians: CITY_GARAGE_HEADING,
      });
      this.physics.park(false);
      this.world?.showDestination(null);
    } else {
      throw new Error(`No active city leg to complete from ${state.phase}`);
    }
    this.overlay?.releaseControls();
    this.emitState();
    this.renderUi(this.physics.snapshot);
  }

  private selectDestination(shop: ShopId): void {
    this.controller.selectDestination(shop);
    this.physics.park(false);
    this.world?.showDestination(null);
    this.emitState();
    this.renderUi(this.physics.snapshot);
  }

  private depart(): void {
    const state = this.controller.state;
    if (state.phase !== "depart-ready") return;
    this.controller.confirmDeparture();
    this.lastParking = null;
    this.activeRoute = cityRoute(state.selected, "outbound");
    const start = pointAlongRoute(this.activeRoute, 0);
    this.physics.setRoute(this.activeRoute, {
      position: start.point,
      headingRadians: start.headingRadians,
    });
    this.world?.showDestination(state.selected, this.activeRoute);
    this.emitState();
    this.renderUi(this.physics.snapshot);
  }

  private enterShop(): void {
    const state = this.controller.state;
    if (state.phase !== "arrived") return;
    this.options.onEnterShop?.(state.selected, this);
  }

  private driveHome(): void {
    const state = this.controller.state;
    if (state.phase !== "return-board") return;
    this.controller.confirmReturnDeparture();
    this.lastParking = null;
    this.activeRoute = cityRoute(state.visited, "home");
    const start = pointAlongRoute(this.activeRoute, 0);
    this.physics.setRoute(this.activeRoute, {
      position: start.point,
      headingRadians: start.headingRadians,
    });
    this.world?.showGarageRoute(this.activeRoute);
    this.emitState();
    this.renderUi(this.physics.snapshot);
  }

  private quickReturn(): void {
    this.controller.useQuickReturn();
    this.activeRoute = cityRoute("carrot-market");
    this.physics.setRoute(this.activeRoute, {
      position: CITY_GARAGE_POSITION,
      headingRadians: CITY_GARAGE_HEADING,
    });
    this.physics.park(false);
    this.world?.showDestination(null);
    this.emitState();
    this.renderUi(this.physics.snapshot);
  }

  private updateControls(controls: DriveControls): void {
    this.controls = controls;
    this.controller.updateControls(controls);
  }

  private renderUi(car: CityCarSnapshot): void {
    if (!this.overlay) return;
    const state = this.controller.state;
    let targetX = CITY_GARAGE_POSITION[0];
    let targetZ = CITY_GARAGE_POSITION[1];
    let destinationLabel = "Gooby Garage";
    if (state.phase === "depart-ready" || state.phase === "driving-outbound" || state.phase === "arrived") {
      const destination = CITY_DESTINATIONS[state.selected];
      targetX = destination.markerPosition[0];
      targetZ = destination.markerPosition[2];
      destinationLabel = destination.label;
    } else if (state.phase === "return-board" || state.phase === "driving-home") {
      destinationLabel = state.phase === "return-board" ? "Gooby Garage" : "Gooby Garage";
    }
    const driving = state.phase === "driving-outbound" || state.phase === "driving-home";
    const routeDistance = driving
      ? nearestRouteSample(car.position, this.activeRoute).remainingDistance
      : Math.hypot(car.position[0] - targetX, car.position[1] - targetZ);
    const metrics: CityOverlayMetrics = {
      distance: routeDistance,
      destinationLabel,
      districtLabel: districtAt(car.position).label,
      coinsCollected: car.collectedCoinIds.length,
      boostSeconds: car.boostSeconds,
      recoveryMode: car.recoveryMode,
      maneuver: driving ? nextRouteManeuver(car.position, this.activeRoute) : null,
      wrongWay: driving && car.wrongWay,
      parking: state.phase === "arrived" ? this.lastParking : null,
    };
    this.overlay.render(state, metrics);
  }

  private updateEdgePointer(): void {
    if (!this.world || !this.overlay) return;
    const state = this.controller.state;
    if (
      (state.phase !== "driving-outbound" && state.phase !== "driving-home")
      || !this.world.copyDestinationPosition(this.destinationScratch)
    ) return;
    const camera = this.options.renderer.camera;
    const cameraSpace = this.cameraSpaceScratch.copy(this.destinationScratch).applyMatrix4(camera.matrixWorldInverse);
    const projected = this.projectedScratch.copy(this.destinationScratch).project(camera);
    const layout = computeEdgePointer(
      this.options.renderer.renderer.domElement.clientWidth,
      this.options.renderer.renderer.domElement.clientHeight,
      projected.x,
      projected.y,
      cameraSpace.z > 0,
      this.edgePointerScratch,
    );
    this.overlay.placeEdgePointer(layout);
  }

  private emitState(car = this.physics.snapshot): void {
    this.options.onStateChanged?.(this.controller.state);
    this.emitTravelSnapshot(car);
  }

  private emitTravelSnapshot(car: CityCarSnapshot): void {
    this.travelSnapshotSeconds = 0;
    const snapshot = this.controller.createTravelSnapshot(
      this.physics.safePose,
      car.collectedCoinIds,
    );
    this.lastEmittedSafePosition = [
      snapshot.safeCarPose.position[0],
      snapshot.safeCarPose.position[1],
    ];
    this.options.onTravelSnapshotChanged?.(snapshot);
  }

  private flushTravelSnapshot(): void {
    if (this.disposed) return;
    this.emitTravelSnapshot(this.physics.snapshot);
  }

  private installLifecycleFlush(): void {
    if (this.lifecycleFlushInstalled) return;
    this.lifecycleFlushInstalled = true;
    window.addEventListener("pagehide", this.onPageHide);
    document.addEventListener("visibilitychange", this.onVisibilityChange);
  }

  private removeLifecycleFlush(): void {
    if (!this.lifecycleFlushInstalled) return;
    this.lifecycleFlushInstalled = false;
    window.removeEventListener("pagehide", this.onPageHide);
    document.removeEventListener("visibilitychange", this.onVisibilityChange);
  }

  private readonly onPageHide = (): void => {
    this.flushTravelSnapshot();
  };

  private readonly onVisibilityChange = (): void => {
    if (document.visibilityState !== "visible") this.flushTravelSnapshot();
  };

  private configureWorldForState(): void {
    if (!this.world) return;
    const state = this.controller.state;
    if (state.phase === "driving-outbound") {
      this.world.showDestination(state.selected, this.activeRoute);
    } else if (state.phase === "driving-home") {
      this.world.showGarageRoute(this.activeRoute);
    } else {
      this.world.showDestination(null);
    }
  }
}

export function createCityDriveScene(options: CityDriveSceneOptions): CityDriveScene {
  return new CityDriveScene(options);
}

export function cityDestinationVector(shop: ShopId): Vector3 {
  const marker = CITY_DESTINATIONS[shop].markerPosition;
  return new Vector3(marker[0], marker[1], marker[2]);
}
