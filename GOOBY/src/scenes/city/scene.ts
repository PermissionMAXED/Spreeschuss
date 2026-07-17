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
  distance2d,
  districtAt,
  nearestRouteSample,
  pointAlongRoute,
  type CityPoint,
} from "../../data/city";
import type { GameRenderer } from "../../render/renderer";
import {
  CityDriveOverlay,
  computeEdgePointer,
  type CityOverlayMetrics,
} from "./overlay";
import { CityRouteMachine } from "./route-machine";
import {
  CityDrivePhysics,
  type CityCarSnapshot,
} from "./simulation";
import { CityWorld, type CityWorldStats } from "./world";

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
}

export interface CityDriveDebugSnapshot {
  readonly state: CityDriveState;
  readonly car: CityCarSnapshot;
  readonly economy: Economy;
  readonly activeRoute: readonly CityPoint[];
  readonly worldStats: CityWorldStats | null;
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
  private world: CityWorld | null = null;
  private overlay: CityDriveOverlay | null = null;
  private economy: Economy;
  private activeRoute: readonly CityPoint[];
  private controls: DriveControls = RELEASED_CONTROLS;
  private entered = false;
  private disposed = false;
  private previousMountPosition = "";

  constructor(private readonly options: CityDriveSceneOptions) {
    this.controller = options.controller ?? new CityRouteMachine();
    this.economy = options.economy ?? createEconomy();
    this.activeRoute = cityRoute("carrot-market");
    this.physics = new CityDrivePhysics(this.activeRoute, {
      position: CITY_GARAGE_POSITION,
      headingRadians: CITY_GARAGE_HEADING,
    });
    this.physics.park(false);
  }

  debugSnapshot(): CityDriveDebugSnapshot {
    return {
      state: this.controller.state,
      car: this.physics.snapshot,
      economy: this.economy,
      activeRoute: this.activeRoute,
      worldStats: this.world?.stats ?? null,
    };
  }

  async enter(context: SceneContext): Promise<void> {
    if (this.disposed) throw new Error("A disposed city scene cannot be entered");
    if (this.entered) return;
    this.entered = true;
    this.previousMountPosition = this.options.mount.style.position;
    if (getComputedStyle(this.options.mount).position === "static") {
      this.options.mount.style.position = "relative";
    }
    this.world = this.options.assetLoader
      ? await CityWorld.create(this.options.renderer, this.options.assetLoader)
      : await CityWorld.create(this.options.renderer);
    this.world.showDestination(null);
    this.overlay = new CityDriveOverlay(this.options.mount, {
      select: (shop) => this.selectDestination(shop),
      depart: () => this.depart(),
      enterShop: () => this.enterShop(),
      driveHome: () => this.driveHome(),
      quickReturn: () => this.quickReturn(),
      controlsChanged: (controls) => this.updateControls(controls),
    });
    this.resize(context);
    this.world.setCar(this.physics.snapshot);
    this.renderUi();
  }

  update(deltaSeconds: number): void {
    if (!this.entered || this.disposed || !this.world || !this.overlay) return;
    const state = this.controller.state;

    if (state.phase === "driving-outbound" || state.phase === "driving-home") {
      this.controller.updateControls(this.controls);
      const step = this.physics.step(deltaSeconds, this.controls);
      if (step.collectedCoinIds.length > 0) {
        this.economy = grantReward(this.economy, { coins: step.collectedCoinIds.length });
        this.options.onEconomyChanged?.(this.economy);
        this.options.onCoinsCollected?.(step.collectedCoinIds.length, step.collectedCoinIds);
      }
      if (step.activatedBoostPadIds.length > 0) this.options.onBoost?.(step.activatedBoostPadIds);
      const safe = this.physics.safePose;
      this.controller.pinSafePose(
        [safe.position[0], 0.35, safe.position[1]],
        safe.headingRadians,
      );

      if (state.phase === "driving-outbound") {
        const arrived = this.controller.tryArriveAt(step.snapshot.position);
        if (arrived) {
          this.physics.park(true);
          this.overlay.releaseControls();
          this.emitState();
        }
      } else if (distance2d(step.snapshot.position, CITY_GARAGE_POSITION) <= GARAGE_TRIGGER_RADIUS) {
        this.controller.arriveHome();
        this.physics.setRoute(cityRoute("carrot-market"), {
          position: CITY_GARAGE_POSITION,
          headingRadians: CITY_GARAGE_HEADING,
        });
        this.physics.park(false);
        this.world.showDestination(null);
        this.overlay.releaseControls();
        this.emitState();
      }
    }

    this.world.update(deltaSeconds, this.physics.snapshot);
    this.renderUi();
    this.updateEdgePointer();
  }

  resize(context: SceneContext): void {
    void context;
    this.options.renderer.resize();
    this.updateEdgePointer();
  }

  exit(): void {
    this.overlay?.releaseControls();
    this.entered = false;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
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
    this.renderUi();
  }

  recoverCar(reason: "off-route" | "stalled" | "invalid-pose"): void {
    const recovered = this.physics.recoverNow(reason);
    this.controller.pinSafePose(
      [recovered.position[0], 0.35, recovered.position[1]],
      recovered.headingRadians,
    );
    this.world?.setCar(this.physics.snapshot);
    this.renderUi();
  }

  /** Development-only acceleration for full-app browser coverage. */
  completeCurrentLegForTest(): void {
    if (!import.meta.env.DEV && import.meta.env.MODE !== "test") {
      throw new Error("City test acceleration is unavailable in production");
    }
    const state = this.controller.state;
    if (state.phase === "driving-outbound") {
      this.controller.arrive(state.selected);
      this.physics.park(true);
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
    this.renderUi();
  }

  private selectDestination(shop: ShopId): void {
    this.controller.selectDestination(shop);
    this.physics.park(false);
    this.world?.showDestination(null);
    this.emitState();
    this.renderUi();
  }

  private depart(): void {
    const state = this.controller.state;
    if (state.phase !== "depart-ready") return;
    this.controller.confirmDeparture();
    this.activeRoute = cityRoute(state.selected, "outbound");
    const start = pointAlongRoute(this.activeRoute, 0);
    this.physics.setRoute(this.activeRoute, {
      position: start.point,
      headingRadians: start.headingRadians,
    });
    this.world?.showDestination(state.selected, this.activeRoute);
    this.emitState();
    this.renderUi();
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
    this.activeRoute = cityRoute(state.visited, "home");
    const start = pointAlongRoute(this.activeRoute, 0);
    this.physics.setRoute(this.activeRoute, {
      position: start.point,
      headingRadians: start.headingRadians,
    });
    this.world?.showGarageRoute(this.activeRoute);
    this.emitState();
    this.renderUi();
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
    this.renderUi();
  }

  private updateControls(controls: DriveControls): void {
    this.controls = controls;
    this.controller.updateControls(controls);
  }

  private renderUi(): void {
    if (!this.overlay) return;
    const state = this.controller.state;
    const car = this.physics.snapshot;
    let target: CityPoint = CITY_GARAGE_POSITION;
    let destinationLabel = "Gooby Garage";
    if (state.phase === "depart-ready" || state.phase === "driving-outbound" || state.phase === "arrived") {
      const destination = CITY_DESTINATIONS[state.selected];
      target = [destination.markerPosition[0], destination.markerPosition[2]];
      destinationLabel = destination.label;
    } else if (state.phase === "return-board" || state.phase === "driving-home") {
      destinationLabel = state.phase === "return-board" ? "Gooby Garage" : "Gooby Garage";
    }
    const routeDistance = state.phase === "driving-outbound" || state.phase === "driving-home"
      ? nearestRouteSample(car.position, this.activeRoute).remainingDistance
      : distance2d(car.position, target);
    const metrics: CityOverlayMetrics = {
      distance: routeDistance,
      destinationLabel,
      districtLabel: districtAt(car.position).label,
      coinsCollected: car.collectedCoinIds.length,
      boostSeconds: car.boostSeconds,
      recoveryMode: car.recoveryMode,
    };
    this.overlay.render(state, metrics);
  }

  private updateEdgePointer(): void {
    if (!this.world || !this.overlay) return;
    const target = this.world.destinationPosition;
    const state = this.controller.state;
    if (!target || (state.phase !== "driving-outbound" && state.phase !== "driving-home")) return;
    const camera = this.options.renderer.camera;
    const cameraSpace = target.clone().applyMatrix4(camera.matrixWorldInverse);
    const projected = target.clone().project(camera);
    const layout = computeEdgePointer(
      this.options.renderer.renderer.domElement.clientWidth,
      this.options.renderer.renderer.domElement.clientHeight,
      projected.x,
      projected.y,
      cameraSpace.z > 0,
    );
    this.overlay.placeEdgePointer(layout);
  }

  private emitState(): void {
    this.options.onStateChanged?.(this.controller.state);
  }
}

export function createCityDriveScene(options: CityDriveSceneOptions): CityDriveScene {
  return new CityDriveScene(options);
}

export function cityDestinationVector(shop: ShopId): Vector3 {
  const marker = CITY_DESTINATIONS[shop].markerPosition;
  return new Vector3(marker[0], marker[1], marker[2]);
}
