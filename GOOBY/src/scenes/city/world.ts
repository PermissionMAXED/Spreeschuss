import {
  AmbientLight,
  BoxGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Euler,
  Group,
  HemisphereLight,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  RingGeometry,
  Vector3,
} from "three";
import type { AssetLoader } from "../../core/contracts/assets";
import type { ShopId } from "../../core/contracts/scenes";
import {
  CITY_BOOST_PADS,
  CITY_BUILDINGS,
  CITY_COINS,
  CITY_DESTINATIONS,
  CITY_DISTRICTS,
  CITY_GARAGE_POSITION,
  CITY_LAMP_POSITIONS,
  CITY_ROADS,
  CITY_TRAFFIC_LOOPS,
  CITY_TREE_POSITIONS,
  CITY_WORLD_BOUNDS,
  PARKING_TRIGGER_RADIUS,
  pointAlongRoute,
  routeLength,
  type CityPoint,
} from "../../data/city";
import { ProceduralGooby } from "../../gooby";
import { ResourceTracker } from "../../render/renderer";
import type { GameRenderer } from "../../render/renderer";
import { CityAssetDepot, type CityAssetAudit } from "./assets";
import type { CityCarSnapshot } from "./simulation";

export const CITY_MARKER_VISUALS = {
  fogEnabled: false,
  gold: 0xffc62f,
  goldCss: "#ffc62f",
  discRadius: 3.05,
  ringInnerRadius: 3.12,
  ringOuterRadius: 3.72,
  triggerRadius: PARKING_TRIGGER_RADIUS,
  beaconHeight: 15,
  beaconRadius: 0.22,
  breadcrumbSpacing: 7.5,
} as const;

export const CITY_RENDER_BUDGET = {
  targetDrawCalls: 54,
  maxBuildings: 18,
  maxInstancedProps: 96,
  maxTrafficCars: 6,
  maxBreadcrumbs: 24,
} as const;

export interface CityWorldStats {
  readonly buildings: number;
  readonly trees: number;
  readonly lamps: number;
  readonly trafficCars: number;
  readonly breadcrumbCapacity: number;
}

interface TrafficCar {
  readonly loopIndex: number;
  readonly laneOffset: number;
  readonly phase: number;
}

function material(color: number, roughness = 0.86): MeshStandardMaterial {
  return new MeshStandardMaterial({ color, roughness, metalness: roughness < 0.45 ? 0.18 : 0 });
}

function setMatrix(
  mesh: InstancedMesh,
  index: number,
  position: Vector3,
  scale: Vector3,
  quaternion = new Quaternion(),
): void {
  mesh.setMatrixAt(index, new Matrix4().compose(position, quaternion, scale));
}

function closedLoopSample(points: readonly CityPoint[], distance: number): {
  readonly point: CityPoint;
  readonly headingRadians: number;
} {
  const closed = [...points, points[0] ?? [0, 0]];
  const total = routeLength(closed);
  return pointAlongRoute(closed, ((distance % total) + total) % total);
}

export class CityWorld {
  readonly root = new Group();
  private readonly tracker = new ResourceTracker();
  private readonly assets: CityAssetDepot;
  private readonly markerRoot = new Group();
  private readonly breadcrumbMesh: InstancedMesh;
  private readonly trafficMesh: InstancedMesh;
  private readonly coinMesh: InstancedMesh;
  private readonly brakeMaterials: readonly [MeshStandardMaterial, MeshStandardMaterial];
  private readonly trafficCars: readonly TrafficCar[];
  private readonly gooby = new ProceduralGooby();
  private auditEntries: readonly CityAssetAudit[] = [];
  private playerCar = new Group();
  private activeTarget: Vector3 | null = null;
  private elapsed = 0;
  private built = false;

  private constructor(
    private readonly gameRenderer: GameRenderer,
    assetLoader?: AssetLoader,
  ) {
    this.assets = assetLoader ? new CityAssetDepot(assetLoader) : new CityAssetDepot();
    this.root.name = "gooby-city";
    this.markerRoot.name = "selected-parking-marker";
    this.markerRoot.visible = false;

    this.breadcrumbMesh = new InstancedMesh(
      new ConeGeometry(0.52, 1.35, 3),
      new MeshBasicMaterial({ color: CITY_MARKER_VISUALS.gold, transparent: true, opacity: 0.92 }),
      CITY_RENDER_BUDGET.maxBreadcrumbs,
    );
    this.breadcrumbMesh.name = "route-breadcrumbs";
    this.breadcrumbMesh.frustumCulled = false;

    this.trafficMesh = new InstancedMesh(
      new BoxGeometry(2, 0.7, 1.05),
      new MeshStandardMaterial({ color: 0x78a9bf, roughness: 0.58 }),
      CITY_RENDER_BUDGET.maxTrafficCars,
    );
    this.trafficMesh.name = "instanced-traffic";
    this.trafficMesh.castShadow = true;
    this.trafficCars = CITY_TRAFFIC_LOOPS.flatMap((_, loopIndex) => [
      { loopIndex, laneOffset: -1.45, phase: 0 },
      { loopIndex, laneOffset: 1.45, phase: 0.5 },
    ]).slice(0, CITY_RENDER_BUDGET.maxTrafficCars);

    this.coinMesh = new InstancedMesh(
      new CylinderGeometry(0.36, 0.36, 0.12, 12),
      new MeshStandardMaterial({
        color: 0xffc339,
        emissive: 0x7e3d00,
        emissiveIntensity: 0.4,
        metalness: 0.45,
        roughness: 0.32,
      }),
      CITY_COINS.length,
    );
    this.coinMesh.name = "instanced-coins";
    this.coinMesh.castShadow = true;

    const leftBrake = material(0xff2f2f, 0.3);
    leftBrake.emissive.setHex(0x8c0808);
    leftBrake.emissiveIntensity = 0.35;
    const rightBrake = leftBrake.clone();
    this.brakeMaterials = [leftBrake, rightBrake];
  }

  static async create(
    gameRenderer: GameRenderer,
    assetLoader?: AssetLoader,
  ): Promise<CityWorld> {
    const world = new CityWorld(gameRenderer, assetLoader);
    await world.build();
    return world;
  }

  get stats(): CityWorldStats {
    return {
      buildings: CITY_BUILDINGS.length,
      trees: CITY_TREE_POSITIONS.length,
      lamps: CITY_LAMP_POSITIONS.length,
      trafficCars: this.trafficCars.length,
      breadcrumbCapacity: CITY_RENDER_BUDGET.maxBreadcrumbs,
    };
  }

  get audit(): readonly CityAssetAudit[] {
    return this.auditEntries;
  }

  get destinationPosition(): Vector3 | null {
    return this.activeTarget?.clone() ?? null;
  }

  private async build(): Promise<void> {
    this.auditEntries = await this.assets.preload();
    this.gameRenderer.scene.background = new Color(0x9bd4e3);
    this.gameRenderer.scene.fog = null;

    this.buildGround();
    this.buildRoads();
    this.buildBuildings();
    this.buildInstancedProps();
    this.buildGarage();
    this.buildMarker();
    this.buildPickups();
    this.buildPlayerCar();

    const ambient = new AmbientLight(0xffe9c8, 1.05);
    const sky = new HemisphereLight(0xbce9ff, 0x73935f, 2.1);
    const sun = new DirectionalLight(0xfff1cf, 2.9);
    sun.position.set(-28, 44, 22);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -55;
    sun.shadow.camera.right = 55;
    sun.shadow.camera.top = 65;
    sun.shadow.camera.bottom = -65;
    this.root.add(ambient, sky, sun, this.markerRoot, this.breadcrumbMesh, this.trafficMesh, this.coinMesh);
    this.gameRenderer.scene.add(this.root);
    this.tracker.trackTree(this.root);
    this.built = true;
    this.updateCoins(new Set());
    this.updateTraffic(0);
  }

  private buildGround(): void {
    const width = CITY_WORLD_BOUNDS.maxX - CITY_WORLD_BOUNDS.minX;
    const depth = CITY_WORLD_BOUNDS.maxZ - CITY_WORLD_BOUNDS.minZ;
    const ground = new Mesh(
      new PlaneGeometry(width + 12, depth + 12),
      material(0x9dc785),
    );
    ground.name = "city-ground";
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(
      (CITY_WORLD_BOUNDS.minX + CITY_WORLD_BOUNDS.maxX) / 2,
      -0.12,
      (CITY_WORLD_BOUNDS.minZ + CITY_WORLD_BOUNDS.maxZ) / 2,
    );
    ground.receiveShadow = true;
    this.root.add(ground);

    for (const district of CITY_DISTRICTS) {
      const patch = new Mesh(
        new PlaneGeometry(district.size[0], district.size[1]),
        material(district.groundColor),
      );
      patch.name = `district-${district.id}`;
      patch.rotation.x = -Math.PI / 2;
      patch.position.set(district.center[0], -0.08, district.center[1]);
      patch.receiveShadow = true;
      this.root.add(patch);
    }
  }

  private buildRoads(): void {
    const dashTransforms: Array<{ position: Vector3; quaternion: Quaternion }> = [];
    for (const road of CITY_ROADS) {
      const dx = road.to[0] - road.from[0];
      const dz = road.to[1] - road.from[1];
      const length = Math.hypot(dx, dz);
      const heading = Math.atan2(dx, dz);
      const roadMesh = new Mesh(
        new BoxGeometry(road.width, 0.09, length),
        material(0x62666b, 0.94),
      );
      roadMesh.name = `road-${road.id}`;
      roadMesh.position.set((road.from[0] + road.to[0]) / 2, 0, (road.from[1] + road.to[1]) / 2);
      roadMesh.rotation.y = heading;
      roadMesh.receiveShadow = true;
      this.root.add(roadMesh);

      for (let distance = 4; distance < length - 2; distance += 7) {
        const ratio = distance / length;
        dashTransforms.push({
          position: new Vector3(
            road.from[0] + dx * ratio,
            0.07,
            road.from[1] + dz * ratio,
          ),
          quaternion: new Quaternion().setFromEuler(new Euler(0, heading, 0)),
        });
      }
    }

    const dashes = new InstancedMesh(
      new BoxGeometry(0.16, 0.025, 2.4),
      new MeshBasicMaterial({ color: 0xffe2a1 }),
      dashTransforms.length,
    );
    dashes.name = "instanced-road-dashes";
    for (const [index, transform] of dashTransforms.entries()) {
      setMatrix(dashes, index, transform.position, new Vector3(1, 1, 1), transform.quaternion);
    }
    dashes.instanceMatrix.needsUpdate = true;
    this.root.add(dashes);
  }

  private buildBuildings(): void {
    for (const lot of CITY_BUILDINGS) {
      if (lot.shop) {
        const building = this.assets.clone(`building.${lot.shop}`);
        building.name = lot.id;
        building.position.set(lot.center[0], 0, lot.center[1]);
        building.scale.set(
          (lot.halfSize[0] * 2) / 3.2,
          lot.height / 3,
          (lot.halfSize[1] * 2) / 2.2,
        );
        building.traverse((child) => {
          child.castShadow = true;
          child.receiveShadow = true;
        });
        this.root.add(building);
        continue;
      }

      const building = new Group();
      building.name = lot.id;
      const body = new Mesh(
        new BoxGeometry(lot.halfSize[0] * 2, lot.height, lot.halfSize[1] * 2),
        material(lot.color),
      );
      body.position.y = lot.height / 2;
      body.castShadow = true;
      body.receiveShadow = true;
      const roof = new Mesh(
        new ConeGeometry(Math.max(lot.halfSize[0], lot.halfSize[1]) * 1.35, 2.2, 4),
        material(0x865b50),
      );
      roof.position.y = lot.height + 1;
      roof.rotation.y = Math.PI / 4;
      roof.castShadow = true;
      building.position.set(lot.center[0], 0, lot.center[1]);
      building.add(body, roof);
      this.root.add(building);
    }
  }

  private buildInstancedProps(): void {
    const trunks = new InstancedMesh(
      new CylinderGeometry(0.18, 0.24, 1.7, 7),
      material(0x76523e),
      CITY_TREE_POSITIONS.length,
    );
    const crowns = new InstancedMesh(
      new ConeGeometry(1.2, 2.4, 7),
      material(0x5f9d65),
      CITY_TREE_POSITIONS.length,
    );
    trunks.name = "instanced-tree-trunks";
    crowns.name = "instanced-tree-crowns";
    trunks.castShadow = true;
    crowns.castShadow = true;
    for (const [index, tree] of CITY_TREE_POSITIONS.entries()) {
      const scale = 0.82 + (index % 4) * 0.08;
      setMatrix(trunks, index, new Vector3(tree[0], 0.85 * scale, tree[1]), new Vector3(scale, scale, scale));
      setMatrix(crowns, index, new Vector3(tree[0], 2.45 * scale, tree[1]), new Vector3(scale, scale, scale));
    }
    trunks.instanceMatrix.needsUpdate = true;
    crowns.instanceMatrix.needsUpdate = true;

    const lampPoles = new InstancedMesh(
      new CylinderGeometry(0.08, 0.12, 3.8, 7),
      material(0x525563, 0.36),
      CITY_LAMP_POSITIONS.length,
    );
    const lampHeads = new InstancedMesh(
      new BoxGeometry(0.42, 0.28, 0.42),
      new MeshStandardMaterial({
        color: 0xffe7a3,
        emissive: 0xffb62e,
        emissiveIntensity: 0.85,
        roughness: 0.4,
      }),
      CITY_LAMP_POSITIONS.length,
    );
    lampPoles.name = "instanced-lamp-poles";
    lampHeads.name = "instanced-lamp-heads";
    for (const [index, lamp] of CITY_LAMP_POSITIONS.entries()) {
      setMatrix(lampPoles, index, new Vector3(lamp[0], 1.9, lamp[1]), new Vector3(1, 1, 1));
      setMatrix(lampHeads, index, new Vector3(lamp[0], 3.85, lamp[1]), new Vector3(1, 1, 1));
    }
    lampPoles.instanceMatrix.needsUpdate = true;
    lampHeads.instanceMatrix.needsUpdate = true;
    this.root.add(trunks, crowns, lampPoles, lampHeads);
  }

  private buildGarage(): void {
    const garage = new Group();
    garage.name = "city-garage";
    const floor = new Mesh(new CylinderGeometry(7.2, 7.2, 0.12, 24), material(0xd5ab72));
    floor.position.y = 0.02;
    const back = new Mesh(new BoxGeometry(15, 7, 0.7), material(0xe7c38e));
    back.position.set(0, 3.5, 59.5);
    back.castShadow = true;
    const roof = new Mesh(new BoxGeometry(16, 0.7, 8), material(0x9a6551));
    roof.position.set(0, 7, 56);
    roof.castShadow = true;
    const board = new Mesh(new BoxGeometry(7.5, 2.2, 0.32), material(0x58484c, 0.55));
    board.position.set(0, 4.3, 58.9);
    garage.add(floor, back, roof, board);
    this.root.add(garage);
  }

  private buildMarker(): void {
    const disc = new Mesh(
      new CylinderGeometry(CITY_MARKER_VISUALS.discRadius, CITY_MARKER_VISUALS.discRadius, 0.08, 40),
      new MeshStandardMaterial({
        color: 0xffe47a,
        emissive: 0x8c4b00,
        emissiveIntensity: 0.42,
        transparent: true,
        opacity: 0.84,
        roughness: 0.62,
      }),
    );
    disc.name = "parking-disc";
    disc.position.y = 0.08;
    const ring = new Mesh(
      new RingGeometry(CITY_MARKER_VISUALS.ringInnerRadius, CITY_MARKER_VISUALS.ringOuterRadius, 48),
      new MeshBasicMaterial({
        color: CITY_MARKER_VISUALS.gold,
        side: DoubleSide,
        transparent: true,
        opacity: 0.96,
      }),
    );
    ring.name = "parking-ring";
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.14;

    const pStem = new Mesh(new BoxGeometry(0.5, 0.07, 2.7), new MeshBasicMaterial({ color: 0xffffff }));
    pStem.position.set(-0.45, 0.18, 0);
    const pTop = new Mesh(new BoxGeometry(1.35, 0.07, 0.5), new MeshBasicMaterial({ color: 0xffffff }));
    pTop.position.set(0.12, 0.18, -1.1);
    const pMiddle = pTop.clone();
    pMiddle.position.z = 0;
    const pSide = new Mesh(new BoxGeometry(0.45, 0.07, 1.25), new MeshBasicMaterial({ color: 0xffffff }));
    pSide.position.set(0.56, 0.18, -0.55);

    const beacon = new Mesh(
      new CylinderGeometry(
        CITY_MARKER_VISUALS.beaconRadius * 0.35,
        CITY_MARKER_VISUALS.beaconRadius,
        CITY_MARKER_VISUALS.beaconHeight,
        10,
      ),
      new MeshBasicMaterial({
        color: CITY_MARKER_VISUALS.gold,
        transparent: true,
        opacity: 0.56,
        depthWrite: false,
      }),
    );
    beacon.name = "parking-beacon";
    beacon.position.y = CITY_MARKER_VISUALS.beaconHeight / 2;
    const beaconTop = new Mesh(
      new ConeGeometry(0.82, 1.8, 8),
      new MeshBasicMaterial({ color: CITY_MARKER_VISUALS.gold }),
    );
    beaconTop.position.y = CITY_MARKER_VISUALS.beaconHeight + 0.6;
    beaconTop.rotation.z = Math.PI;

    this.markerRoot.add(disc, ring, pStem, pTop, pMiddle, pSide, beacon, beaconTop);
  }

  private buildPickups(): void {
    for (const boost of CITY_BOOST_PADS) {
      const pad = new Group();
      pad.name = boost.id;
      const base = new Mesh(
        new BoxGeometry(3.4, 0.08, 1.75),
        new MeshStandardMaterial({
          color: 0x55d5c3,
          emissive: 0x087c78,
          emissiveIntensity: 0.52,
          roughness: 0.45,
        }),
      );
      base.position.y = 0.09;
      const chevronLeft = new Mesh(
        new BoxGeometry(0.25, 0.06, 1),
        new MeshBasicMaterial({ color: 0xf1fff4 }),
      );
      chevronLeft.rotation.y = -0.62;
      chevronLeft.position.set(-0.35, 0.16, 0);
      const chevronRight = chevronLeft.clone();
      chevronRight.rotation.y = 0.62;
      chevronRight.position.x = 0.35;
      pad.position.set(boost.position[0], 0, boost.position[1]);
      pad.add(base, chevronLeft, chevronRight);
      this.root.add(pad);
    }
  }

  private buildPlayerCar(): void {
    this.playerCar = new Group();
    this.playerCar.name = "player-car";
    const car = this.assets.clone("city.car");
    car.rotation.y = -Math.PI / 2;
    car.traverse((child) => {
      child.castShadow = true;
      child.receiveShadow = true;
    });
    const leftBrake = new Mesh(new BoxGeometry(0.34, 0.24, 0.1), this.brakeMaterials[0]);
    const rightBrake = new Mesh(new BoxGeometry(0.34, 0.24, 0.1), this.brakeMaterials[1]);
    leftBrake.name = "left-brake-light";
    rightBrake.name = "right-brake-light";
    leftBrake.position.set(-0.43, 0.73, -1.16);
    rightBrake.position.set(0.43, 0.73, -1.16);
    this.gooby.root.name = "city-driver-gooby";
    this.gooby.root.position.set(0, 0.58, 0.05);
    this.gooby.root.rotation.y = Math.PI;
    this.gooby.root.scale.setScalar(0.2);
    this.playerCar.add(car, leftBrake, rightBrake, this.gooby.root);
    this.root.add(this.playerCar);
  }

  showDestination(shop: ShopId | null, route: readonly CityPoint[] = []): void {
    const marker = shop ? CITY_DESTINATIONS[shop].markerPosition : null;
    this.configureRouteMarker(marker, route);
  }

  showGarageRoute(route: readonly CityPoint[]): void {
    this.configureRouteMarker([CITY_GARAGE_POSITION[0], 0.2, CITY_GARAGE_POSITION[1]], route);
  }

  private configureRouteMarker(
    marker: readonly [number, number, number] | null,
    route: readonly CityPoint[],
  ): void {
    this.activeTarget = marker ? new Vector3(marker[0], marker[1], marker[2]) : null;
    this.markerRoot.visible = marker !== null;
    if (marker) this.markerRoot.position.set(marker[0], 0, marker[2]);

    const total = route.length >= 2 ? routeLength(route) : 0;
    let breadcrumbIndex = 0;
    for (
      let distance = CITY_MARKER_VISUALS.breadcrumbSpacing;
      distance < total - 2 && breadcrumbIndex < CITY_RENDER_BUDGET.maxBreadcrumbs;
      distance += CITY_MARKER_VISUALS.breadcrumbSpacing
    ) {
      const sample = pointAlongRoute(route, distance);
      setMatrix(
        this.breadcrumbMesh,
        breadcrumbIndex,
        new Vector3(sample.point[0], 0.2, sample.point[1]),
        new Vector3(1, 1, 1),
        new Quaternion().setFromEuler(new Euler(Math.PI / 2, sample.headingRadians, 0)),
      );
      breadcrumbIndex += 1;
    }
    for (let index = breadcrumbIndex; index < CITY_RENDER_BUDGET.maxBreadcrumbs; index += 1) {
      setMatrix(this.breadcrumbMesh, index, new Vector3(), new Vector3(0, 0, 0));
    }
    this.breadcrumbMesh.visible = marker !== null;
    this.breadcrumbMesh.instanceMatrix.needsUpdate = true;
  }

  setCar(snapshot: CityCarSnapshot): void {
    this.playerCar.position.set(snapshot.position[0], 0.08, snapshot.position[1]);
    this.playerCar.rotation.y = snapshot.headingRadians;
    for (const brakeMaterial of this.brakeMaterials) {
      brakeMaterial.emissiveIntensity = snapshot.braking ? 3.4 : 0.35;
      brakeMaterial.color.setHex(snapshot.braking ? 0xff1515 : 0xa71e1e);
    }
    this.updateCoins(new Set(snapshot.collectedCoinIds));
  }

  update(deltaSeconds: number, car: CityCarSnapshot): void {
    if (!this.built) return;
    this.elapsed += deltaSeconds;
    this.gooby.update(deltaSeconds, this.elapsed);
    this.setCar(car);
    this.markerRoot.rotation.y += deltaSeconds * 0.32;
    this.updateTraffic(deltaSeconds);
    this.updateCamera(deltaSeconds, car);
  }

  private updateCoins(collected: ReadonlySet<string>): void {
    const spin = this.elapsed * 2.6;
    for (const [index, coin] of CITY_COINS.entries()) {
      const visible = !collected.has(coin.id);
      setMatrix(
        this.coinMesh,
        index,
        new Vector3(coin.position[0], visible ? 0.85 + Math.sin(spin + index) * 0.12 : -20, coin.position[1]),
        visible ? new Vector3(1, 1, 1) : new Vector3(0, 0, 0),
        new Quaternion().setFromEuler(new Euler(Math.PI / 2, spin + index * 0.4, 0)),
      );
    }
    this.coinMesh.instanceMatrix.needsUpdate = true;
  }

  private updateTraffic(deltaSeconds: number): void {
    const trafficTime = this.elapsed + deltaSeconds * 0.08;
    for (const [index, car] of this.trafficCars.entries()) {
      const loop = CITY_TRAFFIC_LOOPS[car.loopIndex];
      if (!loop) continue;
      const points = loop.points;
      const closed = [...points, points[0] ?? [0, 0]];
      const total = routeLength(closed);
      const sample = closedLoopSample(points, trafficTime * loop.speed + total * (loop.phase + car.phase));
      const sideX = Math.cos(sample.headingRadians) * car.laneOffset;
      const sideZ = -Math.sin(sample.headingRadians) * car.laneOffset;
      setMatrix(
        this.trafficMesh,
        index,
        new Vector3(sample.point[0] + sideX, 0.48, sample.point[1] + sideZ),
        new Vector3(1, 1, 1),
        new Quaternion().setFromEuler(new Euler(0, sample.headingRadians, 0)),
      );
    }
    this.trafficMesh.instanceMatrix.needsUpdate = true;
  }

  private updateCamera(deltaSeconds: number, car: CityCarSnapshot): void {
    const forward = new Vector3(Math.sin(car.headingRadians), 0, Math.cos(car.headingRadians));
    const desired = new Vector3(car.position[0], 6.4, car.position[1])
      .addScaledVector(forward, -8.2);
    const smoothing = 1 - Math.exp(-deltaSeconds * 4.6);
    this.gameRenderer.camera.position.lerp(desired, smoothing);
    this.gameRenderer.camera.lookAt(
      car.position[0] + forward.x * 5.5,
      0.8,
      car.position[1] + forward.z * 5.5,
    );
  }

  dispose(): void {
    this.gooby.dispose();
    this.assets.dispose();
    this.tracker.dispose();
  }
}
