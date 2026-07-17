import {
  AmbientLight,
  BoxGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Euler,
  Float32BufferAttribute,
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
import type {
  BufferGeometry,
  Material,
  NormalBufferAttributes,
  Object3D,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
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
  readonly drawCalls: number;
  readonly targetDrawCalls: number;
}

interface TrafficCar {
  readonly loopIndex: number;
  readonly laneOffset: number;
  readonly phase: number;
}

interface PreparedTrafficLoop {
  readonly points: readonly CityPoint[];
  readonly segmentLengths: readonly number[];
  readonly totalLength: number;
}

const INSTANCE_MATRIX = new Matrix4();
const INSTANCE_QUATERNION = new Quaternion();
const INSTANCE_POSITION = new Vector3();
const INSTANCE_SCALE = new Vector3();
const INSTANCE_EULER = new Euler();
const COLOR_SCRATCH = new Color();
const HIDDEN_SCALE = new Vector3(0, 0, 0);
const UNIT_SCALE = new Vector3(1, 1, 1);

function material(color: number, roughness = 0.86): MeshStandardMaterial {
  return new MeshStandardMaterial({ color, roughness, metalness: roughness < 0.45 ? 0.18 : 0 });
}

function mergeAssetMeshes(source: Object3D, name: string): Mesh {
  source.updateMatrixWorld(true);
  const geometries: Array<BufferGeometry<NormalBufferAttributes>> = [];
  source.traverse((child) => {
    if (!(child as Object3D & { isMesh?: boolean }).isMesh) return;
    const childMesh = child as Mesh<
      BufferGeometry<NormalBufferAttributes>,
      Material | Material[]
    >;
    let geometry = childMesh.geometry.clone();
    geometry.applyMatrix4(child.matrixWorld);
    if (!geometry.getAttribute("normal")) geometry.computeVertexNormals();
    for (const attributeName of Object.keys(geometry.attributes)) {
      if (attributeName !== "position" && attributeName !== "normal") {
        geometry.deleteAttribute(attributeName);
      }
    }
    if (geometry.index) {
      const nonIndexed = geometry.toNonIndexed();
      geometry.dispose();
      geometry = nonIndexed;
    }
    const sourceMaterial = Array.isArray(childMesh.material)
      ? childMesh.material[0]
      : childMesh.material;
    const colorCandidate = sourceMaterial as (Material & { color?: unknown }) | undefined;
    const color = colorCandidate?.color instanceof Color
      ? colorCandidate.color
      : COLOR_SCRATCH.setHex(0xffffff);
    const count = geometry.getAttribute("position").count;
    const colors = new Float32Array(count * 3);
    for (let index = 0; index < count; index += 1) {
      const offset = index * 3;
      colors[offset] = color.r;
      colors[offset + 1] = color.g;
      colors[offset + 2] = color.b;
    }
    geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
    geometries.push(geometry);
  });
  const merged = mergeGeometries(geometries, false);
  for (const geometry of geometries) geometry.dispose();
  source.removeFromParent();
  if (!merged) throw new Error(`City asset could not be merged: ${name}`);
  const mesh = new Mesh(
    merged,
    new MeshStandardMaterial({ vertexColors: true, roughness: 0.74, metalness: 0.04 }),
  );
  mesh.name = name;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function setMatrix(
  mesh: InstancedMesh,
  index: number,
  position: Vector3,
  scale: Vector3,
  quaternion = INSTANCE_QUATERNION.identity(),
): void {
  mesh.setMatrixAt(index, INSTANCE_MATRIX.compose(position, quaternion, scale));
}

function prepareTrafficLoop(points: readonly CityPoint[]): PreparedTrafficLoop {
  const segmentLengths: number[] = [];
  let totalLength = 0;
  for (let index = 0; index < points.length; index += 1) {
    const from = points[index];
    const to = points[(index + 1) % points.length];
    if (!from || !to) continue;
    const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
    segmentLengths.push(length);
    totalLength += length;
  }
  return { points, segmentLengths, totalLength };
}

function sampleTrafficLoop(loop: PreparedTrafficLoop, distance: number, target: Vector3): number {
  let remaining = ((distance % loop.totalLength) + loop.totalLength) % loop.totalLength;
  for (let index = 0; index < loop.points.length; index += 1) {
    const from = loop.points[index];
    const to = loop.points[(index + 1) % loop.points.length];
    const length = loop.segmentLengths[index];
    if (!from || !to || length === undefined) continue;
    if (remaining <= length || index === loop.points.length - 1) {
      const ratio = length === 0 ? 0 : Math.min(1, remaining / length);
      target.set(
        from[0] + (to[0] - from[0]) * ratio,
        0,
        from[1] + (to[1] - from[1]) * ratio,
      );
      return Math.atan2(to[0] - from[0], to[1] - from[1]);
    }
    remaining -= length;
  }
  target.set(0, 0, 0);
  return 0;
}

export function computeCityCameraPose(
  car: CityCarSnapshot,
  desired: Vector3,
  lookAt: Vector3,
): void {
  const garageDx = car.position[0] - CITY_GARAGE_POSITION[0];
  const garageDz = car.position[1] - CITY_GARAGE_POSITION[1];
  if (Math.abs(car.speed) < 0.1 && garageDx * garageDx + garageDz * garageDz < 16) {
    desired.set(4, 5.2, 57);
    lookAt.set(CITY_GARAGE_POSITION[0], 1, CITY_GARAGE_POSITION[1] - 6);
    return;
  }
  const forwardX = Math.sin(car.headingRadians);
  const forwardZ = Math.cos(car.headingRadians);
  desired.set(
    car.position[0] - forwardX * 8.2,
    6.4,
    car.position[1] - forwardZ * 8.2,
  );
  lookAt.set(
    car.position[0] + forwardX * 5.5,
    0.8,
    car.position[1] + forwardZ * 5.5,
  );
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
  private readonly preparedTrafficLoops = CITY_TRAFFIC_LOOPS.map(({ points }) => prepareTrafficLoop(points));
  private readonly gooby = new ProceduralGooby();
  private auditEntries: readonly CityAssetAudit[] = [];
  private playerCar = new Group();
  private activeTarget: Vector3 | null = null;
  private elapsed = 0;
  private built = false;
  private readonly trafficPosition = new Vector3();
  private readonly trafficScale = new Vector3(1, 1, 1);
  private readonly trafficQuaternion = new Quaternion();
  private readonly coinPosition = new Vector3();
  private readonly coinQuaternion = new Quaternion();
  private readonly cameraDesired = new Vector3();
  private readonly cameraLookAt = new Vector3();

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
    this.trafficMesh.castShadow = false;
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
    this.coinMesh.castShadow = false;

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
      drawCalls: this.gameRenderer.renderer.info.render.calls,
      targetDrawCalls: CITY_RENDER_BUDGET.targetDrawCalls,
    };
  }

  get audit(): readonly CityAssetAudit[] {
    return this.auditEntries;
  }

  copyDestinationPosition(target: Vector3): boolean {
    if (!this.activeTarget) return false;
    target.copy(this.activeTarget);
    return true;
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
    this.updateCoins([]);
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

    const patches = new InstancedMesh(
      new PlaneGeometry(1, 1),
      material(0xffffff),
      CITY_DISTRICTS.length,
    );
    patches.name = "instanced-district-ground";
    patches.receiveShadow = true;
    for (const [index, district] of CITY_DISTRICTS.entries()) {
      setMatrix(
        patches,
        index,
        INSTANCE_POSITION.set(district.center[0], -0.08, district.center[1]),
        INSTANCE_SCALE.set(district.size[0], district.size[1], 1),
        INSTANCE_QUATERNION.setFromEuler(INSTANCE_EULER.set(-Math.PI / 2, 0, 0)),
      );
      patches.setColorAt(index, COLOR_SCRATCH.setHex(district.groundColor));
    }
    patches.instanceMatrix.needsUpdate = true;
    if (patches.instanceColor) patches.instanceColor.needsUpdate = true;
    this.root.add(patches);
  }

  private buildRoads(): void {
    const dashTransforms: Array<{ position: Vector3; quaternion: Quaternion }> = [];
    const roads = new InstancedMesh(
      new BoxGeometry(1, 1, 1),
      material(0x62666b, 0.94),
      CITY_ROADS.length,
    );
    roads.name = "instanced-roads";
    roads.receiveShadow = true;
    for (const [roadIndex, road] of CITY_ROADS.entries()) {
      const dx = road.to[0] - road.from[0];
      const dz = road.to[1] - road.from[1];
      const length = Math.hypot(dx, dz);
      const heading = Math.atan2(dx, dz);
      setMatrix(
        roads,
        roadIndex,
        INSTANCE_POSITION.set((road.from[0] + road.to[0]) / 2, 0, (road.from[1] + road.to[1]) / 2),
        INSTANCE_SCALE.set(road.width, 0.09, length),
        INSTANCE_QUATERNION.setFromEuler(INSTANCE_EULER.set(0, heading, 0)),
      );

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
    roads.instanceMatrix.needsUpdate = true;
    this.root.add(roads);

    const dashes = new InstancedMesh(
      new BoxGeometry(0.16, 0.025, 2.4),
      new MeshBasicMaterial({ color: 0xffe2a1 }),
      dashTransforms.length,
    );
    dashes.name = "instanced-road-dashes";
    for (const [index, transform] of dashTransforms.entries()) {
      setMatrix(dashes, index, transform.position, UNIT_SCALE, transform.quaternion);
    }
    dashes.instanceMatrix.needsUpdate = true;
    this.root.add(dashes);
  }

  private buildBuildings(): void {
    const proceduralLots = CITY_BUILDINGS.filter(({ shop }) => shop === null);
    const bodies = new InstancedMesh(
      new BoxGeometry(1, 1, 1),
      material(0xffffff),
      proceduralLots.length,
    );
    const roofs = new InstancedMesh(
      new ConeGeometry(1, 1, 4),
      material(0x865b50),
      proceduralLots.length,
    );
    bodies.name = "instanced-building-bodies";
    roofs.name = "instanced-building-roofs";
    bodies.castShadow = false;
    bodies.receiveShadow = true;
    roofs.castShadow = false;
    let proceduralIndex = 0;
    for (const lot of CITY_BUILDINGS) {
      if (lot.shop) {
        const building = mergeAssetMeshes(this.assets.clone(`building.${lot.shop}`), lot.id);
        building.position.set(lot.center[0], 0, lot.center[1]);
        building.scale.set(
          (lot.halfSize[0] * 2) / 3.2,
          lot.height / 3,
          (lot.halfSize[1] * 2) / 2.2,
        );
        building.castShadow = false;
        this.root.add(building);
        continue;
      }
      setMatrix(
        bodies,
        proceduralIndex,
        INSTANCE_POSITION.set(lot.center[0], lot.height / 2, lot.center[1]),
        INSTANCE_SCALE.set(lot.halfSize[0] * 2, lot.height, lot.halfSize[1] * 2),
      );
      bodies.setColorAt(proceduralIndex, COLOR_SCRATCH.setHex(lot.color));
      const roofRadius = Math.max(lot.halfSize[0], lot.halfSize[1]) * 1.35;
      setMatrix(
        roofs,
        proceduralIndex,
        INSTANCE_POSITION.set(lot.center[0], lot.height + 1, lot.center[1]),
        INSTANCE_SCALE.set(roofRadius, 2.2, roofRadius),
        INSTANCE_QUATERNION.setFromEuler(INSTANCE_EULER.set(0, Math.PI / 4, 0)),
      );
      proceduralIndex += 1;
    }
    bodies.instanceMatrix.needsUpdate = true;
    if (bodies.instanceColor) bodies.instanceColor.needsUpdate = true;
    roofs.instanceMatrix.needsUpdate = true;
    this.root.add(bodies, roofs);
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
    trunks.castShadow = false;
    crowns.castShadow = false;
    for (const [index, tree] of CITY_TREE_POSITIONS.entries()) {
      const scale = 0.82 + (index % 4) * 0.08;
      setMatrix(
        trunks,
        index,
        INSTANCE_POSITION.set(tree[0], 0.85 * scale, tree[1]),
        INSTANCE_SCALE.set(scale, scale, scale),
      );
      setMatrix(
        crowns,
        index,
        INSTANCE_POSITION.set(tree[0], 2.45 * scale, tree[1]),
        INSTANCE_SCALE.set(scale, scale, scale),
      );
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
      setMatrix(lampPoles, index, INSTANCE_POSITION.set(lamp[0], 1.9, lamp[1]), UNIT_SCALE);
      setMatrix(lampHeads, index, INSTANCE_POSITION.set(lamp[0], 3.85, lamp[1]), UNIT_SCALE);
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

    const parkingLetter = new InstancedMesh(
      new BoxGeometry(1, 1, 1),
      new MeshBasicMaterial({ color: 0xffffff }),
      4,
    );
    parkingLetter.name = "instanced-parking-letter";
    setMatrix(parkingLetter, 0, INSTANCE_POSITION.set(-0.45, 0.18, 0), INSTANCE_SCALE.set(0.5, 0.07, 2.7));
    setMatrix(parkingLetter, 1, INSTANCE_POSITION.set(0.12, 0.18, -1.1), INSTANCE_SCALE.set(1.35, 0.07, 0.5));
    setMatrix(parkingLetter, 2, INSTANCE_POSITION.set(0.12, 0.18, 0), INSTANCE_SCALE.set(1.35, 0.07, 0.5));
    setMatrix(parkingLetter, 3, INSTANCE_POSITION.set(0.56, 0.18, -0.55), INSTANCE_SCALE.set(0.45, 0.07, 1.25));
    parkingLetter.instanceMatrix.needsUpdate = true;

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

    this.markerRoot.add(disc, ring, parkingLetter, beacon, beaconTop);
  }

  private buildPickups(): void {
    const bases = new InstancedMesh(
      new BoxGeometry(3.4, 0.08, 1.75),
      new MeshStandardMaterial({
        color: 0x55d5c3,
        emissive: 0x087c78,
        emissiveIntensity: 0.52,
        roughness: 0.45,
      }),
      CITY_BOOST_PADS.length,
    );
    const chevrons = new InstancedMesh(
      new BoxGeometry(0.25, 0.06, 1),
      new MeshBasicMaterial({ color: 0xf1fff4 }),
      CITY_BOOST_PADS.length * 2,
    );
    bases.name = "instanced-boost-pad-bases";
    chevrons.name = "instanced-boost-pad-chevrons";
    for (const [index, boost] of CITY_BOOST_PADS.entries()) {
      setMatrix(
        bases,
        index,
        INSTANCE_POSITION.set(boost.position[0], 0.09, boost.position[1]),
        UNIT_SCALE,
      );
      setMatrix(
        chevrons,
        index * 2,
        INSTANCE_POSITION.set(boost.position[0] - 0.35, 0.16, boost.position[1]),
        UNIT_SCALE,
        INSTANCE_QUATERNION.setFromEuler(INSTANCE_EULER.set(0, -0.62, 0)),
      );
      setMatrix(
        chevrons,
        index * 2 + 1,
        INSTANCE_POSITION.set(boost.position[0] + 0.35, 0.16, boost.position[1]),
        UNIT_SCALE,
        INSTANCE_QUATERNION.setFromEuler(INSTANCE_EULER.set(0, 0.62, 0)),
      );
    }
    bases.instanceMatrix.needsUpdate = true;
    chevrons.instanceMatrix.needsUpdate = true;
    this.root.add(bases, chevrons);
  }

  private buildPlayerCar(): void {
    this.playerCar = new Group();
    this.playerCar.name = "player-car";
    const car = mergeAssetMeshes(this.assets.clone("city.car"), "merged-player-car");
    car.rotation.y = -Math.PI / 2;
    car.castShadow = false;
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
    this.gooby.root.traverse((child) => {
      child.castShadow = false;
    });
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
    if (marker) {
      (this.activeTarget ??= new Vector3()).set(marker[0], marker[1], marker[2]);
    } else {
      this.activeTarget = null;
    }
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
        INSTANCE_POSITION.set(sample.point[0], 0.2, sample.point[1]),
        UNIT_SCALE,
        INSTANCE_QUATERNION.setFromEuler(INSTANCE_EULER.set(Math.PI / 2, sample.headingRadians, 0)),
      );
      breadcrumbIndex += 1;
    }
    for (let index = breadcrumbIndex; index < CITY_RENDER_BUDGET.maxBreadcrumbs; index += 1) {
      setMatrix(this.breadcrumbMesh, index, INSTANCE_POSITION.set(0, 0, 0), HIDDEN_SCALE);
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
    this.updateCoins(snapshot.collectedCoinIds);
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

  private updateCoins(collected: readonly string[]): void {
    const spin = this.elapsed * 2.6;
    for (const [index, coin] of CITY_COINS.entries()) {
      const visible = !collected.includes(coin.id);
      setMatrix(
        this.coinMesh,
        index,
        this.coinPosition.set(
          coin.position[0],
          visible ? 0.85 + Math.sin(spin + index) * 0.12 : -20,
          coin.position[1],
        ),
        visible ? UNIT_SCALE : HIDDEN_SCALE,
        this.coinQuaternion.setFromEuler(INSTANCE_EULER.set(Math.PI / 2, spin + index * 0.4, 0)),
      );
    }
    this.coinMesh.instanceMatrix.needsUpdate = true;
  }

  private updateTraffic(deltaSeconds: number): void {
    const trafficTime = this.elapsed + deltaSeconds * 0.08;
    for (const [index, car] of this.trafficCars.entries()) {
      const loop = CITY_TRAFFIC_LOOPS[car.loopIndex];
      const prepared = this.preparedTrafficLoops[car.loopIndex];
      if (!loop || !prepared) continue;
      const heading = sampleTrafficLoop(
        prepared,
        trafficTime * loop.speed + prepared.totalLength * (loop.phase + car.phase),
        this.trafficPosition,
      );
      const sideX = Math.cos(heading) * car.laneOffset;
      const sideZ = -Math.sin(heading) * car.laneOffset;
      setMatrix(
        this.trafficMesh,
        index,
        this.trafficPosition.set(
          this.trafficPosition.x + sideX,
          0.48,
          this.trafficPosition.z + sideZ,
        ),
        this.trafficScale,
        this.trafficQuaternion.setFromEuler(INSTANCE_EULER.set(0, heading, 0)),
      );
    }
    this.trafficMesh.instanceMatrix.needsUpdate = true;
  }

  private updateCamera(deltaSeconds: number, car: CityCarSnapshot): void {
    computeCityCameraPose(car, this.cameraDesired, this.cameraLookAt);
    const smoothing = 1 - Math.exp(-deltaSeconds * 4.6);
    this.gameRenderer.camera.position.lerp(this.cameraDesired, smoothing);
    this.gameRenderer.camera.lookAt(this.cameraLookAt);
  }

  snapCamera(car: CityCarSnapshot): void {
    computeCityCameraPose(car, this.cameraDesired, this.cameraLookAt);
    this.gameRenderer.camera.position.copy(this.cameraDesired);
    this.gameRenderer.camera.lookAt(this.cameraLookAt);
  }

  dispose(): void {
    this.gooby.dispose();
    this.assets.dispose();
    this.tracker.dispose();
  }
}
