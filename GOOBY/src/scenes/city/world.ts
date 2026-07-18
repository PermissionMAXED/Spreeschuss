import {
  AmbientLight,
  BoxGeometry,
  CapsuleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Euler,
  Float32BufferAttribute,
  Frustum,
  Group,
  HemisphereLight,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  RingGeometry,
  SphereGeometry,
  Texture,
  Vector3,
} from "three";
import type {
  Box3,
  BufferGeometry,
  Material,
  NormalBufferAttributes,
  Object3D,
  PerspectiveCamera,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { AssetLoader } from "../../core/contracts/assets";
import type { ShopId } from "../../core/contracts/scenes";
import {
  CITY_BOOST_PADS,
  CITY_BUILDINGS,
  CITY_COINS,
  CITY_CURB_HEIGHT,
  CITY_DESTINATIONS,
  CITY_DISTRICTS,
  CITY_GARAGE_POSITION,
  CITY_LAMP_POSITIONS,
  CITY_PARKING_BAYS,
  CITY_ROADS,
  CITY_TOPOLOGY,
  CITY_TREE_POSITIONS,
  CITY_WORLD_BOUNDS,
  PARKING_TRIGGER_RADIUS,
  nearestRouteSample,
  pointAlongRoute,
  routeLength,
  type CityBuildingLot,
  type CityPoint,
  type CityRoadTile,
} from "../../data/city";
import { ResourceTracker } from "../../render/renderer";
import type { GameRenderer } from "../../render/renderer";
import { CityAssetDepot, type CityAssetAudit } from "./assets";
import {
  CityCuratedDepot,
  createCuratedCityResolver,
  type CityCuratedAudit,
} from "./environment/depot";
import type { CityCuratedKey } from "./environment/procedural";
import {
  CITY_BOOST_SPEED,
  type CityCarSnapshot,
  type CityRenderPose,
  type CityTrafficCarState,
} from "./simulation";

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
  targetDrawCalls: 48,
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

const INSTANCE_MATRIX = new Matrix4();
const INSTANCE_QUATERNION = new Quaternion();
const INSTANCE_POSITION = new Vector3();
const INSTANCE_SCALE = new Vector3();
const INSTANCE_EULER = new Euler();
const COLOR_SCRATCH = new Color();
const HIDDEN_SCALE = new Vector3(0, 0, 0);
const UNIT_SCALE = new Vector3(1, 1, 1);
const PLACE_MATRIX = new Matrix4();
const PLACE_QUATERNION = new Quaternion();
const PLACE_POSITION = new Vector3();
const PLACE_SCALE = new Vector3();
const WHITE = new Color(0xffffff);
const CULL_MATRIX = new Matrix4();
const CULL_FRUSTUM = new Frustum();
const CULL_POINT = new Vector3();
/** Conservative bounding radii so parked-idle culling never pops props. */
const TREE_CULL_RADIUS = 4.2;
const LAMP_CULL_RADIUS = 4.4;
const COIN_CULL_RADIUS = 1.6;

/** Sphere-vs-frustum check for compacting instanced props while parked. */
function sphereVisible(
  frustum: Frustum,
  x: number,
  y: number,
  z: number,
  radius: number,
): boolean {
  CULL_POINT.set(x, y, z);
  for (const plane of frustum.planes) {
    if (plane.distanceToPoint(CULL_POINT) < -radius) return false;
  }
  return true;
}

function material(color: number, roughness = 0.86): MeshStandardMaterial {
  return new MeshStandardMaterial({ color, roughness, metalness: roughness < 0.45 ? 0.18 : 0 });
}

type MergableGeometry = BufferGeometry<NormalBufferAttributes>;

/**
 * Flattens a loaded asset into one non-indexed geometry with position/normal/
 * uv/color attributes. Authored UVs and material colors survive so the merged
 * chunk renders correctly under a single shared textured material.
 */
function flattenObjectGeometry(source: Object3D): MergableGeometry {
  source.updateMatrixWorld(true);
  const geometries: MergableGeometry[] = [];
  source.traverse((child) => {
    if (!(child as Object3D & { isMesh?: boolean }).isMesh) return;
    const childMesh = child as Mesh<MergableGeometry, Material | Material[]>;
    let geometry = childMesh.geometry.clone();
    geometry.applyMatrix4(child.matrixWorld);
    if (!geometry.getAttribute("normal")) geometry.computeVertexNormals();
    if (geometry.index) {
      const nonIndexed = geometry.toNonIndexed();
      geometry.dispose();
      geometry = nonIndexed;
    }
    const count = geometry.getAttribute("position").count;
    if (!geometry.getAttribute("uv")) {
      geometry.setAttribute("uv", new Float32BufferAttribute(new Float32Array(count * 2), 2));
    }
    for (const attributeName of Object.keys(geometry.attributes)) {
      if (!["position", "normal", "uv", "color"].includes(attributeName)) {
        geometry.deleteAttribute(attributeName);
      }
    }
    const sourceMaterial = Array.isArray(childMesh.material)
      ? childMesh.material[0]
      : childMesh.material;
    const colorCandidate = sourceMaterial as (Material & { color?: unknown }) | undefined;
    const color = colorCandidate?.color instanceof Color ? colorCandidate.color : WHITE;
    if (!geometry.getAttribute("color")) {
      const colors = new Float32Array(count * 3);
      for (let index = 0; index < count; index += 1) {
        const offset = index * 3;
        colors[offset] = color.r;
        colors[offset + 1] = color.g;
        colors[offset + 2] = color.b;
      }
      geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
    }
    geometries.push(geometry);
  });
  const merged = mergeGeometries(geometries, false);
  for (const geometry of geometries) geometry.dispose();
  if (!merged) throw new Error(`City asset produced no mergeable geometry: ${source.name}`);
  return merged;
}

function firstTexture(source: Object3D): Texture | null {
  let found: Texture | null = null;
  source.traverse((child) => {
    if (found || !(child as Object3D & { isMesh?: boolean }).isMesh) return;
    const childMesh = child as Mesh;
    const meshMaterial = Array.isArray(childMesh.material) ? childMesh.material[0] : childMesh.material;
    const candidate = meshMaterial as (Material & { map?: unknown }) | undefined;
    if (candidate?.map instanceof Texture) found = candidate.map;
  });
  return found;
}

/** Rewrites UVs from world-space x/z so tiling reads seamlessly across tiles. */
function applyWorldSpaceUvs(geometry: MergableGeometry, scale = 0.1): void {
  const positions = geometry.getAttribute("position");
  const uvs = new Float32Array(positions.count * 2);
  for (let index = 0; index < positions.count; index += 1) {
    uvs[index * 2] = positions.getX(index) * scale;
    uvs[index * 2 + 1] = positions.getZ(index) * scale;
  }
  geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
}

function tintGeometry(geometry: MergableGeometry, tint: Color): void {
  const colors = geometry.getAttribute("color");
  for (let index = 0; index < colors.count; index += 1) {
    colors.setXYZ(
      index,
      colors.getX(index) * tint.r,
      colors.getY(index) * tint.g,
      colors.getZ(index) * tint.b,
    );
  }
}

/**
 * Spatial chunking: static geometry merges into a grid of cells (three
 * x-columns by z-rows). The tight per-cell bounding spheres let the low-tier
 * draw distance (camera.far = 76) cull whole distant cells, which is what
 * keeps the parked/driving triangle budgets honest, while the merged cells
 * keep the draw count below the call budget. Triangle-heavy sets (buildings)
 * use finer rows for better culling; flat cheap sets (roads, accents) use
 * coarser rows so they cost fewer draw calls.
 */
const CHUNK_COLUMNS = 3;
const CHUNK_MAX_Z = 66;
const CHUNK_MIN_Z = -90;

function chunkCellFor(x: number, z: number, rows: number): number {
  const rowDepth = (CHUNK_MAX_Z - CHUNK_MIN_Z) / rows;
  const column = x < -20 ? 0 : x > 20 ? 2 : 1;
  const row = Math.max(
    0,
    Math.min(rows - 1, Math.floor((CHUNK_MAX_Z - z) / rowDepth)),
  );
  return row * CHUNK_COLUMNS + column;
}

class ChunkSet {
  private readonly parts = new Map<number, MergableGeometry[]>();

  constructor(private readonly rows = 7) {}

  add(
    template: MergableGeometry,
    matrix: Matrix4,
    options: { tint?: Color; worldUvs?: boolean } = {},
  ): void {
    const geometry = template.clone();
    geometry.applyMatrix4(matrix);
    if (options.tint) tintGeometry(geometry, options.tint);
    if (options.worldUvs) applyWorldSpaceUvs(geometry);
    PLACE_POSITION.setFromMatrixPosition(matrix);
    const cell = chunkCellFor(PLACE_POSITION.x, PLACE_POSITION.z, this.rows);
    const list = this.parts.get(cell);
    if (list) list.push(geometry);
    else this.parts.set(cell, [geometry]);
  }

  build(
    sharedMaterial: Material,
    name: string,
    parent: Object3D,
    castShadow = false,
  ): Mesh[] {
    const meshes: Mesh[] = [];
    for (const [cell, geometries] of this.parts) {
      if (geometries.length === 0) continue;
      const merged = mergeGeometries(geometries, false);
      for (const geometry of geometries) geometry.dispose();
      if (!merged) continue;
      merged.computeBoundingSphere();
      merged.computeBoundingBox();
      const mesh = new Mesh(merged, sharedMaterial);
      mesh.name = `${name}-cell-${cell}`;
      mesh.castShadow = castShadow;
      mesh.receiveShadow = true;
      parent.add(mesh);
      meshes.push(mesh);
    }
    this.parts.clear();
    return meshes;
  }
}

function placementMatrix(
  x: number,
  y: number,
  z: number,
  rotationY = 0,
  scaleX = 1,
  scaleY = 1,
  scaleZ = 1,
): Matrix4 {
  return PLACE_MATRIX.compose(
    PLACE_POSITION.set(x, y, z),
    PLACE_QUATERNION.setFromEuler(INSTANCE_EULER.set(0, rotationY, 0)),
    PLACE_SCALE.set(scaleX, scaleY, scaleZ),
  );
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

/** Extra yaw mapping each curated tile model onto the canonical topology tile. */
const TILE_MODEL_KEYS: Readonly<Record<CityRoadTile["kind"], CityCuratedKey>> = {
  straight: "city.road-straight",
  corner: "city.road-corner",
  t: "city.road-t",
  cross: "city.road-4way",
};
const TILE_MODEL_YAW: Readonly<Record<CityRoadTile["kind"], number>> = {
  straight: 0,
  corner: 0,
  t: 0,
  cross: 0,
};

function lowPolyDriver(): MergableGeometry {
  const group = new Group();
  const add = (geometry: BufferGeometry, color: number, x: number, y: number, z: number, s: readonly [number, number, number] = [1, 1, 1], rz = 0): void => {
    const mesh = new Mesh(geometry, new MeshStandardMaterial({ color }));
    mesh.position.set(x, y, z);
    mesh.scale.set(s[0], s[1], s[2]);
    mesh.rotation.z = rz;
    group.add(mesh);
  };
  const cream = 0xffe0ac;
  const creamLight = 0xfff2ce;
  const blush = 0xf5a0a8;
  const ink = 0x4f4650;
  add(new SphereGeometry(0.8, 10, 7), cream, 0, 0.9, 0, [1.04, 1.14, 0.9]);
  add(new SphereGeometry(0.56, 10, 7), creamLight, 0, 1.86, 0.02, [1.05, 0.92, 0.94]);
  add(new CapsuleGeometry(0.2, 0.8, 2, 7), cream, -0.28, 2.56, -0.02, [1, 1, 1], -0.14);
  add(new CapsuleGeometry(0.2, 0.74, 2, 7), cream, 0.28, 2.54, -0.02, [1, 1, 1], 0.2);
  add(new CapsuleGeometry(0.09, 0.56, 2, 6), blush, -0.28, 2.57, 0.16, [1, 1, 1], -0.14);
  add(new CapsuleGeometry(0.09, 0.52, 2, 6), blush, 0.28, 2.55, 0.16, [1, 1, 1], 0.2);
  add(new SphereGeometry(0.11, 8, 6), ink, -0.22, 1.94, 0.48, [1, 1.15, 0.6]);
  add(new SphereGeometry(0.11, 8, 6), ink, 0.22, 1.94, 0.48, [1, 1.15, 0.6]);
  add(new SphereGeometry(0.08, 8, 6), 0xf2a36f, 0, 1.78, 0.55, [1.1, 0.8, 0.7]);
  add(new SphereGeometry(0.13, 8, 6), blush, -0.42, 1.7, 0.42, [1, 0.7, 0.5]);
  add(new SphereGeometry(0.13, 8, 6), blush, 0.42, 1.7, 0.42, [1, 0.7, 0.5]);
  return flattenObjectGeometry(group);
}

export class CityWorld {
  readonly root = new Group();
  private readonly tracker = new ResourceTracker();
  private readonly assets: CityAssetDepot;
  private readonly curated: CityCuratedDepot;
  private readonly markerRoot = new Group();
  private readonly breadcrumbMesh: InstancedMesh;
  private readonly coinMesh: InstancedMesh;
  private readonly brakeMaterial: MeshStandardMaterial;
  private auditEntries: readonly CityAssetAudit[] = [];
  private curatedAuditEntries: readonly CityCuratedAudit[] = [];
  private playerCar = new Group();
  private trafficRoot = new Group();
  private readonly trafficMeshes: Mesh[] = [];
  private activeTarget: Vector3 | null = null;
  private activeRoute: readonly CityPoint[] = [];
  private breadcrumbDistances: number[] = [];
  private retiredBreadcrumbs = -1;
  private elapsed = 0;
  private built = false;
  private trafficCarCount = 0;
  private readonly chunkCulling: { mesh: Mesh; box: Box3 }[] = [];
  private readonly lodMeshes: { mesh: Mesh; full: Material; low: Material }[] = [];
  private readonly lodVariants = new Map<Material, Material>();
  private brakeMaterialLow: MeshLambertMaterial | null = null;
  private materialsLow = false;
  private treeTrunks: InstancedMesh | null = null;
  private treeCrowns: InstancedMesh | null = null;
  private lampPoles: InstancedMesh | null = null;
  private lampHeads: InstancedMesh | null = null;
  private idleCulled = false;
  private readonly idleCameraPosition = new Vector3();
  private readonly idleCameraQuaternion = new Quaternion();
  private idleCameraFov = 0;
  private idleCameraAspect = 0;
  private idleCameraFar = 0;
  private staticCoinCount = -1;
  private lastCollectedIds: readonly string[] = [];
  private readonly templateCache = new Map<CityCuratedKey, MergableGeometry>();
  private readonly coinPosition = new Vector3();
  private readonly coinQuaternion = new Quaternion();
  private readonly cameraDesired = new Vector3();
  private readonly cameraLookAt = new Vector3();
  private readonly baseFov: number;
  private readonly reducedMotion: boolean;

  private constructor(
    private readonly gameRenderer: GameRenderer,
    assetLoader?: AssetLoader,
  ) {
    this.assets = assetLoader ? new CityAssetDepot(assetLoader) : new CityAssetDepot();
    this.curated = new CityCuratedDepot(createCuratedCityResolver());
    this.root.name = "gooby-city";
    this.markerRoot.name = "selected-parking-marker";
    this.markerRoot.visible = false;
    this.trafficRoot.name = "lane-traffic";
    this.baseFov = gameRenderer.camera.fov;
    this.reducedMotion = typeof window !== "undefined"
      && typeof window.matchMedia === "function"
      && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    this.breadcrumbMesh = new InstancedMesh(
      new ConeGeometry(0.52, 1.35, 3),
      new MeshBasicMaterial({ color: CITY_MARKER_VISUALS.gold, transparent: true, opacity: 0.92 }),
      CITY_RENDER_BUDGET.maxBreadcrumbs,
    );
    this.breadcrumbMesh.name = "route-breadcrumbs";
    this.breadcrumbMesh.frustumCulled = false;

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

    this.brakeMaterial = material(0xff2f2f, 0.3);
    this.brakeMaterial.emissive.setHex(0x8c0808);
    this.brakeMaterial.emissiveIntensity = 0.35;
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
      trafficCars: this.trafficCarCount,
      breadcrumbCapacity: CITY_RENDER_BUDGET.maxBreadcrumbs,
      drawCalls: this.gameRenderer.renderer.info.render.calls,
      targetDrawCalls: CITY_RENDER_BUDGET.targetDrawCalls,
    };
  }

  get audit(): readonly CityAssetAudit[] {
    return this.auditEntries;
  }

  get curatedAudit(): readonly CityCuratedAudit[] {
    return this.curatedAuditEntries;
  }

  copyDestinationPosition(target: Vector3): boolean {
    if (!this.activeTarget) return false;
    target.copy(this.activeTarget);
    return true;
  }

  private template(key: CityCuratedKey): MergableGeometry {
    let geometry = this.templateCache.get(key);
    if (!geometry) {
      geometry = flattenObjectGeometry(this.curated.clone(key));
      this.templateCache.set(key, geometry);
    }
    return geometry;
  }

  private async build(): Promise<void> {
    const [frozenAudit, curatedAudit] = await Promise.all([
      this.assets.preload(),
      this.curated.preload(),
    ]);
    this.auditEntries = frozenAudit;
    this.curatedAuditEntries = curatedAudit;
    this.gameRenderer.scene.background = new Color(0x9bd4e3);
    this.gameRenderer.scene.fog = null;

    this.buildGround();
    this.buildStaticChunks();
    this.buildInstancedProps();
    this.buildMarker();
    this.buildPickups();
    this.buildPlayerCar();
    for (const geometry of this.templateCache.values()) geometry.dispose();
    this.templateCache.clear();

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
    this.root.add(ambient, sky, sun, this.markerRoot, this.breadcrumbMesh, this.trafficRoot, this.coinMesh);
    this.gameRenderer.scene.add(this.root);
    this.tracker.trackTree(this.root);
    this.built = true;
    this.updateCoins([]);
    // Freeze the coin culling sphere around the full layout before any
    // parked-idle compaction can shrink the rendered instance count.
    this.coinMesh.computeBoundingSphere();
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
    // Overdraw control: the full-city ground fills last so its fragments
    // fail the depth test wherever roads, patches or lots already drew.
    // Opaque-only ordering, so the rendered image is pixel-identical.
    ground.renderOrder = 2;
    this.root.add(this.withLod(ground));

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
    patches.renderOrder = 1;
    this.root.add(this.withLod(patches));
  }

  /**
   * Merges the whole static city into three spatially chunked sets: one
   * Kenney-textured road surface (tiles + bay aprons + signs), one
   * KayKit-textured chunk (sidewalks + lots + props), and one vertex-colored
   * accent chunk (curb lips, bay paint, garage). The flat road/accent sets use
   * coarse rows (few draws); the triangle-heavy kit set uses fine rows so the
   * low draw distance culls distant buildings and holds the triangle budget.
   */
  private buildStaticChunks(): void {
    const roadTextured = this.curated.source("city.road-straight") === "vendored";
    const kitTextured = this.curated.source("city.sidewalk") === "vendored";
    const roadChunks = new ChunkSet(3);
    const kitChunks = new ChunkSet(14);
    const accentChunks = new ChunkSet(3);

    for (const tile of CITY_TOPOLOGY.tiles) {
      roadChunks.add(
        this.template(TILE_MODEL_KEYS[tile.kind]),
        placementMatrix(
          tile.center[0],
          0,
          tile.center[1],
          tile.rotationRadians + TILE_MODEL_YAW[tile.kind],
          tile.width,
          1,
          tile.length,
        ),
        { worldUvs: !roadTextured },
      );
    }

    // Curated curb aprons pave every parking bay and the garage stall.
    for (const bay of CITY_PARKING_BAYS) {
      roadChunks.add(
        this.template("city.curb"),
        placementMatrix(
          bay.center[0],
          0.012,
          bay.center[1],
          bay.headingRadians,
          bay.halfWidth * 2.2,
          1,
          bay.halfLength * 1.6,
        ),
        { worldUvs: !roadTextured },
      );
    }

    // Street signs mark junction corners (capped, deterministic order).
    let signCount = 0;
    for (const node of CITY_TOPOLOGY.nodes) {
      if (node.kind !== "tee" && node.kind !== "cross") continue;
      if (signCount >= 6) break;
      roadChunks.add(
        this.template("city.sign"),
        placementMatrix(node.point[0] + 6.1, 0, node.point[1] + 6.1, Math.PI + signCount, 3.4, 3.4, 3.4),
        { tint: COLOR_SCRATCH.setHex(0xffffff).clone() },
      );
      signCount += 1;
    }

    // Raised curb lips trace the same segments the physics scrubs against.
    const curbTemplate = flattenObjectGeometry(new Mesh(
      new BoxGeometry(1, CITY_CURB_HEIGHT, 0.34),
      new MeshStandardMaterial({ color: 0xcfc4b1 }),
    ));
    for (const curb of CITY_TOPOLOGY.curbs) {
      const dx = curb.to[0] - curb.from[0];
      const dz = curb.to[1] - curb.from[1];
      const length = Math.hypot(dx, dz);
      if (length < 0.05) continue;
      accentChunks.add(
        curbTemplate,
        placementMatrix(
          (curb.from[0] + curb.to[0]) / 2,
          CITY_CURB_HEIGHT / 2,
          (curb.from[1] + curb.to[1]) / 2,
          Math.atan2(dx, dz) + Math.PI / 2,
          1,
          1,
          length + 0.34,
        ),
        { worldUvs: true },
      );
    }
    curbTemplate.dispose();

    // Painted bay outlines confirm exactly where parking validation runs.
    const paintTemplate = flattenObjectGeometry(new Mesh(
      new BoxGeometry(1, 0.012, 0.18),
      new MeshStandardMaterial({ color: 0xfff3cf }),
    ));
    for (const bay of CITY_PARKING_BAYS) {
      const sin = Math.sin(bay.headingRadians);
      const cos = Math.cos(bay.headingRadians);
      for (const side of [-1, 1]) {
        accentChunks.add(paintTemplate, placementMatrix(
          bay.center[0] + cos * side * bay.halfWidth,
          0.03,
          bay.center[1] - sin * side * bay.halfWidth,
          bay.headingRadians,
          1,
          1,
          bay.halfLength * 2,
        ), { worldUvs: true });
      }
      accentChunks.add(paintTemplate, placementMatrix(
        bay.center[0] - sin * bay.halfLength,
        0.03,
        bay.center[1] - cos * bay.halfLength,
        bay.headingRadians + Math.PI / 2,
        1,
        1,
        bay.halfWidth * 2,
      ), { worldUvs: true });
    }
    paintTemplate.dispose();

    for (const [index, strip] of CITY_TOPOLOGY.sidewalks.entries()) {
      kitChunks.add(
        this.template("city.sidewalk"),
        placementMatrix(
          strip.center[0],
          0,
          strip.center[1],
          0,
          strip.halfSize[0],
          0.9,
          strip.halfSize[1],
        ),
        { worldUvs: !kitTextured },
      );
      // Benches and hydrants alternate along the longer strips.
      const length = Math.max(strip.halfSize[0], strip.halfSize[1]) * 2;
      if (length < 12 || index % 2 !== 0) continue;
      const alongX = strip.halfSize[0] > strip.halfSize[1];
      const propKey: CityCuratedKey = index % 4 === 0 ? "city.bench" : "city.hydrant";
      kitChunks.add(
        this.template(propKey),
        placementMatrix(
          strip.center[0] + (alongX ? length / 4 : 0),
          0.1,
          strip.center[1] + (alongX ? 0 : length / 4),
          alongX ? 0 : Math.PI / 2,
          2.6,
          2.6,
          2.6,
        ),
      );
    }

    let variantIndex = 0;
    for (const lot of CITY_BUILDINGS) {
      if (lot.shop) {
        this.buildShopLot(lot, lot.shop);
        continue;
      }
      const variant: CityCuratedKey = lot.height > 9
        ? "building.city-c"
        : variantIndex % 2 === 0 ? "building.city-a" : "building.city-b";
      variantIndex += 1;
      const modelHeight = variant === "building.city-c" ? 2.98 : 1.65;
      kitChunks.add(
        this.template(variant),
        placementMatrix(
          lot.center[0],
          0,
          lot.center[1],
          yawTowardNearestRoad(lot.center),
          lot.halfSize[0],
          lot.height / modelHeight,
          lot.halfSize[1],
        ),
        { tint: COLOR_SCRATCH.setHex(lot.color).lerp(WHITE, 0.55).clone() },
      );
    }

    // Garage stall built from simple merged parts.
    const garageParts = new Group();
    const garagePart = (geometry: BufferGeometry, color: number, x: number, y: number, z: number): void => {
      const mesh = new Mesh(geometry, new MeshStandardMaterial({ color }));
      mesh.position.set(x, y, z);
      garageParts.add(mesh);
    };
    garagePart(new CylinderGeometry(7.2, 7.2, 0.12, 24), 0xd5ab72, 0, 0.02, 52);
    garagePart(new BoxGeometry(15, 7, 0.7), 0xe7c38e, 0, 3.5, 59.5);
    garagePart(new BoxGeometry(16, 0.7, 8), 0x9a6551, 0, 7, 56);
    garagePart(new BoxGeometry(7.5, 2.2, 0.32), 0x58484c, 0, 4.3, 58.9);
    const garageGeometry = flattenObjectGeometry(garageParts);
    accentChunks.add(garageGeometry, placementMatrix(0, 0, 0), { worldUvs: true });
    garageGeometry.dispose();

    const roadMap = firstTexture(this.curated.template("city.road-straight"));
    const kitMap = firstTexture(this.curated.template("city.sidewalk"));
    const roadMaterial = new MeshStandardMaterial({
      map: roadTextured ? roadMap : null,
      vertexColors: true,
      roughness: 0.92,
    });
    const kitMaterial = new MeshStandardMaterial({
      map: kitTextured ? kitMap : null,
      vertexColors: true,
      roughness: 0.85,
    });
    const accentMaterial = new MeshStandardMaterial({ vertexColors: true, roughness: 0.82 });
    for (const meshes of [
      roadChunks.build(roadMaterial, "city-roads", this.root),
      kitChunks.build(kitMaterial, "city-kit", this.root),
      accentChunks.build(accentMaterial, "city-accents", this.root),
    ]) {
      this.registerChunkCulling(meshes);
      for (const mesh of meshes) this.withLod(mesh);
    }
  }

  /**
   * Chunk cells cull against their exact bounding boxes while a parked board
   * is up. Cell geometry is baked in world space, so the geometry box is the
   * world box and the test is exact-conservative (no visual popping).
   */
  private registerChunkCulling(meshes: readonly Mesh[]): void {
    for (const mesh of meshes) {
      const box = mesh.geometry.boundingBox;
      if (box) this.chunkCulling.push({ mesh, box });
    }
  }

  /**
   * Quality-aware material LOD: the LOW tier swaps every PBR Standard
   * material for a prebuilt diffuse-only Lambert twin (same texture map,
   * vertex colors, emissive and transparency), which is far cheaper per
   * fragment on software rasterizers. MID/HIGH keep full Standard lighting.
   * Twins are created once at build time and cached, so tier switches only
   * flip material pointers — no allocation or material churn at runtime.
   */
  private lowMaterialVariant(full: MeshStandardMaterial): Material {
    const cached = this.lodVariants.get(full);
    if (cached) return cached;
    const low = new MeshLambertMaterial({
      color: full.color.clone(),
      map: full.map,
      vertexColors: full.vertexColors,
      transparent: full.transparent,
      opacity: full.opacity,
      side: full.side,
      emissive: full.emissive.clone(),
      emissiveIntensity: full.emissiveIntensity,
    });
    this.lodVariants.set(full, low);
    this.tracker.track(low);
    return low;
  }

  /** Registers a mesh for LOW-tier material swapping (prebuilt twin). */
  private withLod<T extends Mesh>(mesh: T): T {
    const full = mesh.material as MeshStandardMaterial;
    const low = this.lowMaterialVariant(full);
    this.lodMeshes.push({ mesh, full, low });
    if (this.materialsLow) mesh.material = low;
    return mesh;
  }

  private applyMaterialLod(low: boolean): void {
    if (this.materialsLow === low) return;
    this.materialsLow = low;
    for (const entry of this.lodMeshes) {
      entry.mesh.material = low ? entry.low : entry.full;
    }
  }

  private buildShopLot(lot: CityBuildingLot, shop: ShopId): void {
    const merged = flattenObjectGeometry(this.assets.clone(`building.${shop}`));
    const mesh = new Mesh(
      merged,
      new MeshStandardMaterial({ vertexColors: true, roughness: 0.74, metalness: 0.04 }),
    );
    mesh.name = lot.id;
    mesh.position.set(lot.center[0], 0, lot.center[1]);
    mesh.scale.set(
      (lot.halfSize[0] * 2) / 3.2,
      lot.height / 3,
      (lot.halfSize[1] * 2) / 2.2,
    );
    mesh.rotation.y = yawTowardNearestRoad(lot.center);
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    this.root.add(this.withLod(mesh));
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
    this.treeTrunks = trunks;
    this.treeCrowns = crowns;

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
    this.lampPoles = lampPoles;
    this.lampHeads = lampHeads;

    this.restoreInstancedProps();
    // Freeze the culling spheres around the full layouts now so later
    // parked-idle compaction can never shrink them below the restored set.
    trunks.computeBoundingSphere();
    crowns.computeBoundingSphere();
    lampPoles.computeBoundingSphere();
    lampHeads.computeBoundingSphere();
    this.root.add(
      this.withLod(trunks),
      this.withLod(crowns),
      this.withLod(lampPoles),
      this.withLod(lampHeads),
    );
  }

  private layoutTree(slot: number, index: number): void {
    const tree = CITY_TREE_POSITIONS[index];
    if (!tree || !this.treeTrunks || !this.treeCrowns) return;
    const scale = 0.82 + (index % 4) * 0.08;
    setMatrix(
      this.treeTrunks,
      slot,
      INSTANCE_POSITION.set(tree[0], 0.85 * scale, tree[1]),
      INSTANCE_SCALE.set(scale, scale, scale),
    );
    setMatrix(
      this.treeCrowns,
      slot,
      INSTANCE_POSITION.set(tree[0], 2.45 * scale, tree[1]),
      INSTANCE_SCALE.set(scale, scale, scale),
    );
  }

  private layoutLamp(slot: number, index: number): void {
    const lamp = CITY_LAMP_POSITIONS[index];
    if (!lamp || !this.lampPoles || !this.lampHeads) return;
    setMatrix(this.lampPoles, slot, INSTANCE_POSITION.set(lamp[0], 1.9, lamp[1]), UNIT_SCALE);
    setMatrix(this.lampHeads, slot, INSTANCE_POSITION.set(lamp[0], 3.85, lamp[1]), UNIT_SCALE);
  }

  /** Full instanced layouts for driving; parked-idle compacts these down. */
  private restoreInstancedProps(): void {
    if (this.treeTrunks && this.treeCrowns) {
      for (let index = 0; index < CITY_TREE_POSITIONS.length; index += 1) {
        this.layoutTree(index, index);
      }
      this.treeTrunks.count = CITY_TREE_POSITIONS.length;
      this.treeCrowns.count = CITY_TREE_POSITIONS.length;
      this.treeTrunks.instanceMatrix.needsUpdate = true;
      this.treeCrowns.instanceMatrix.needsUpdate = true;
    }
    if (this.lampPoles && this.lampHeads) {
      for (let index = 0; index < CITY_LAMP_POSITIONS.length; index += 1) {
        this.layoutLamp(index, index);
      }
      this.lampPoles.count = CITY_LAMP_POSITIONS.length;
      this.lampHeads.count = CITY_LAMP_POSITIONS.length;
      this.lampPoles.instanceMatrix.needsUpdate = true;
      this.lampHeads.instanceMatrix.needsUpdate = true;
    }
  }

  /** Prefix-compacts trees and lamps down to the frustum-visible set. */
  private compactInstancedProps(frustum: Frustum): void {
    if (this.treeTrunks && this.treeCrowns) {
      let slot = 0;
      for (let index = 0; index < CITY_TREE_POSITIONS.length; index += 1) {
        const tree = CITY_TREE_POSITIONS[index];
        if (!tree || !sphereVisible(frustum, tree[0], 2.2, tree[1], TREE_CULL_RADIUS)) continue;
        this.layoutTree(slot, index);
        slot += 1;
      }
      this.treeTrunks.count = slot;
      this.treeCrowns.count = slot;
      this.treeTrunks.instanceMatrix.needsUpdate = true;
      this.treeCrowns.instanceMatrix.needsUpdate = true;
    }
    if (this.lampPoles && this.lampHeads) {
      let slot = 0;
      for (let index = 0; index < CITY_LAMP_POSITIONS.length; index += 1) {
        const lamp = CITY_LAMP_POSITIONS[index];
        if (!lamp || !sphereVisible(frustum, lamp[0], 2, lamp[1], LAMP_CULL_RADIUS)) continue;
        this.layoutLamp(slot, index);
        slot += 1;
      }
      this.lampPoles.count = slot;
      this.lampHeads.count = slot;
      this.lampPoles.instanceMatrix.needsUpdate = true;
      this.lampHeads.instanceMatrix.needsUpdate = true;
    }
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
    this.withLod(disc);
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
    this.root.add(this.withLod(bases), chevrons);
  }

  private buildPlayerCar(): void {
    this.playerCar = new Group();
    this.playerCar.name = "player-car";
    const carGeometry = flattenObjectGeometry(this.assets.clone("city.car"));
    const car = new Mesh(
      carGeometry,
      new MeshStandardMaterial({ vertexColors: true, roughness: 0.74, metalness: 0.04 }),
    );
    car.name = "merged-player-car";
    car.rotation.y = -Math.PI / 2;
    car.castShadow = true;
    this.withLod(car);

    const brakeParts = new Group();
    for (const x of [-0.43, 0.43]) {
      const light = new Mesh(new BoxGeometry(0.34, 0.24, 0.1), this.brakeMaterial);
      light.position.set(x, 0.73, -1.16);
      brakeParts.add(this.withLod(light));
    }
    brakeParts.name = "brake-lights";
    const brakeLow = this.lodVariants.get(this.brakeMaterial);
    this.brakeMaterialLow = brakeLow instanceof MeshLambertMaterial ? brakeLow : null;

    const driver = new Mesh(
      lowPolyDriver(),
      new MeshStandardMaterial({ vertexColors: true, roughness: 0.78 }),
    );
    driver.name = "city-driver-gooby";
    driver.position.set(0, 0.58, 0.05);
    driver.rotation.y = Math.PI;
    driver.scale.setScalar(0.2);
    driver.castShadow = false;
    this.withLod(driver);

    this.playerCar.add(car, brakeParts, driver);
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

    this.activeRoute = marker && route.length >= 2 ? route : [];
    this.breadcrumbDistances = [];
    this.retiredBreadcrumbs = -1;
    const total = this.activeRoute.length >= 2 ? routeLength(this.activeRoute) : 0;
    for (
      let distance = CITY_MARKER_VISUALS.breadcrumbSpacing;
      distance < total - 2 && this.breadcrumbDistances.length < CITY_RENDER_BUDGET.maxBreadcrumbs;
      distance += CITY_MARKER_VISUALS.breadcrumbSpacing
    ) {
      this.breadcrumbDistances.push(distance);
    }
    this.layOutBreadcrumbs(0);
    this.breadcrumbMesh.visible = marker !== null;
  }

  /** Crumbs behind the car retire so guidance always reads "ahead". */
  private layOutBreadcrumbs(retiredCount: number): void {
    if (retiredCount === this.retiredBreadcrumbs) return;
    this.retiredBreadcrumbs = retiredCount;
    for (const [index, distance] of this.breadcrumbDistances.entries()) {
      if (index < retiredCount) {
        setMatrix(this.breadcrumbMesh, index, INSTANCE_POSITION.set(0, -30, 0), HIDDEN_SCALE);
        continue;
      }
      const sample = pointAlongRoute(this.activeRoute, distance);
      setMatrix(
        this.breadcrumbMesh,
        index,
        INSTANCE_POSITION.set(sample.point[0], 0.2, sample.point[1]),
        UNIT_SCALE,
        INSTANCE_QUATERNION.setFromEuler(INSTANCE_EULER.set(Math.PI / 2, sample.headingRadians, 0)),
      );
    }
    for (let index = this.breadcrumbDistances.length; index < CITY_RENDER_BUDGET.maxBreadcrumbs; index += 1) {
      setMatrix(this.breadcrumbMesh, index, INSTANCE_POSITION.set(0, -30, 0), HIDDEN_SCALE);
    }
    this.breadcrumbMesh.instanceMatrix.needsUpdate = true;
  }

  setCar(snapshot: CityCarSnapshot, pose?: CityRenderPose, animateCoins = true): void {
    const shown = pose ?? snapshot;
    this.playerCar.position.set(shown.position[0], 0.08, shown.position[1]);
    this.playerCar.rotation.y = shown.headingRadians;
    this.brakeMaterial.emissiveIntensity = snapshot.braking ? 3.4 : 0.35;
    this.brakeMaterial.color.setHex(snapshot.braking ? 0xff1515 : 0xa71e1e);
    if (this.brakeMaterialLow) {
      this.brakeMaterialLow.emissiveIntensity = this.brakeMaterial.emissiveIntensity;
      this.brakeMaterialLow.color.copy(this.brakeMaterial.color);
    }
    this.lastCollectedIds = snapshot.collectedCoinIds;
    if (animateCoins) {
      // Driving: coins bob and spin every frame.
      this.staticCoinCount = -1;
      this.updateCoins(snapshot.collectedCoinIds);
    } else if (this.staticCoinCount !== snapshot.collectedCoinIds.length) {
      // Parked boards freeze the coins in place; re-lay only on collection.
      this.staticCoinCount = snapshot.collectedCoinIds.length;
      this.updateCoins(snapshot.collectedCoinIds);
      // A re-lay while parked invalidates any compacted coin prefix.
      this.idleCulled = false;
    }
    if (this.activeRoute.length >= 2 && this.breadcrumbDistances.length > 0) {
      const progressed = nearestRouteSample(shown.position, this.activeRoute).distanceAlongRoute;
      let retired = 0;
      while (
        retired < this.breadcrumbDistances.length
        && (this.breadcrumbDistances[retired] ?? Number.POSITIVE_INFINITY) < progressed + 1.5
      ) {
        retired += 1;
      }
      this.layOutBreadcrumbs(retired);
    }
  }

  /** Renders the deterministic traffic agents (one culled mesh per car). */
  setTraffic(cars: readonly CityTrafficCarState[]): void {
    if (!this.built) return;
    const count = Math.min(cars.length, CITY_RENDER_BUDGET.maxTrafficCars);
    this.trafficCarCount = count;
    while (this.trafficMeshes.length < count) {
      const index = this.trafficMeshes.length;
      const car = cars[index];
      if (!car) break;
      const mesh = this.createTrafficMesh(car);
      this.trafficMeshes.push(mesh);
      this.trafficRoot.add(mesh);
      this.tracker.trackTree(mesh);
    }
    for (const [index, mesh] of this.trafficMeshes.entries()) {
      const car = cars[index];
      if (!car) {
        mesh.visible = false;
        continue;
      }
      mesh.visible = true;
      mesh.position.set(car.position[0], mesh.userData.baseY as number, car.position[1]);
      mesh.rotation.y = car.headingRadians;
    }
  }

  private createTrafficMesh(car: CityTrafficCarState): Mesh {
    const key: CityCuratedKey = car.kind === "curated-b" ? "city.traffic-car-b" : "city.traffic-car-a";
    const geometry = car.kind === "compact"
      ? flattenObjectGeometry(compactTrafficCar())
      : flattenObjectGeometry(this.curated.clone(key));
    geometry.computeBoundingBox();
    const scale = car.kind === "compact" ? 4.1 : 4.5;
    const map = car.kind === "compact" ? null : firstTexture(this.curated.template(key));
    const mesh = new Mesh(
      geometry,
      new MeshStandardMaterial({ map, vertexColors: true, roughness: 0.7 }),
    );
    mesh.name = `traffic-${car.id}`;
    mesh.scale.setScalar(scale);
    mesh.userData.baseY = -(geometry.boundingBox?.min.y ?? 0) * scale + 0.02;
    mesh.castShadow = false;
    return this.withLod(mesh);
  }

  update(
    deltaSeconds: number,
    car: CityCarSnapshot,
    pose?: CityRenderPose,
    parkedIdle = false,
  ): void {
    if (!this.built) return;
    this.elapsed += deltaSeconds;
    this.applyMaterialLod(this.gameRenderer.scene.userData.goobyQualityTier === "low");
    this.setCar(car, pose, !parkedIdle);
    // Parked boards drop the marker beacon to a low-rate tick; driving restores it.
    this.markerRoot.rotation.y += deltaSeconds * (this.reducedMotion || parkedIdle ? 0.1 : 0.32);
    this.updateCamera(deltaSeconds, car, pose);
    this.updateIdleCulling(parkedIdle);
  }

  /**
   * Parked boards leave the camera (nearly) static, so the world switches to
   * cached culling: chunk cells hide behind exact bounding-box tests and
   * instanced props/coins compact down to the frustum-visible prefix. The
   * cache refreshes only when the camera or viewport actually changes, and
   * everything restores on the first driving frame.
   */
  private updateIdleCulling(parkedIdle: boolean): void {
    if (!parkedIdle) {
      if (this.idleCulled) this.clearIdleCulling();
      return;
    }
    const camera = this.gameRenderer.camera;
    if (this.idleCulled && !this.idleCameraChanged(camera)) return;
    this.idleCulled = true;
    this.idleCameraPosition.copy(camera.position);
    this.idleCameraQuaternion.copy(camera.quaternion);
    this.idleCameraFov = camera.fov;
    this.idleCameraAspect = camera.aspect;
    this.idleCameraFar = camera.far;
    camera.updateMatrixWorld();
    CULL_MATRIX.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    CULL_FRUSTUM.setFromProjectionMatrix(CULL_MATRIX);
    for (const entry of this.chunkCulling) {
      entry.mesh.visible = CULL_FRUSTUM.intersectsBox(entry.box);
    }
    this.compactInstancedProps(CULL_FRUSTUM);
    this.updateCoins(this.lastCollectedIds, CULL_FRUSTUM);
  }

  private idleCameraChanged(camera: PerspectiveCamera): boolean {
    return camera.position.distanceToSquared(this.idleCameraPosition) > 1e-6
      || Math.abs(1 - Math.abs(camera.quaternion.dot(this.idleCameraQuaternion))) > 1e-7
      || camera.fov !== this.idleCameraFov
      || camera.aspect !== this.idleCameraAspect
      || camera.far !== this.idleCameraFar;
  }

  private clearIdleCulling(): void {
    this.idleCulled = false;
    for (const entry of this.chunkCulling) entry.mesh.visible = true;
    this.restoreInstancedProps();
    this.staticCoinCount = -1;
    this.updateCoins(this.lastCollectedIds);
  }

  /**
   * Coin layout; with a frustum (parked-idle) the visible coins compact into
   * the leading instance slots so offscreen coins cost zero triangles.
   */
  private updateCoins(collected: readonly string[], frustum: Frustum | null = null): void {
    const spin = this.elapsed * 2.6;
    let slot = 0;
    for (const [index, coin] of CITY_COINS.entries()) {
      const visible = !collected.includes(coin.id);
      if (frustum && (
        !visible
        || !sphereVisible(frustum, coin.position[0], 0.9, coin.position[1], COIN_CULL_RADIUS)
      )) continue;
      setMatrix(
        this.coinMesh,
        slot,
        this.coinPosition.set(
          coin.position[0],
          visible ? 0.85 + Math.sin(spin + index) * 0.12 : -20,
          coin.position[1],
        ),
        visible ? UNIT_SCALE : HIDDEN_SCALE,
        this.coinQuaternion.setFromEuler(INSTANCE_EULER.set(Math.PI / 2, spin + index * 0.4, 0)),
      );
      slot += 1;
    }
    this.coinMesh.count = frustum ? slot : CITY_COINS.length;
    this.coinMesh.instanceMatrix.needsUpdate = true;
  }

  /**
   * Smooth chase camera: the target and look-ahead come from the interpolated
   * render pose, and the field of view widens gently with speed. Reduced
   * motion pins the FOV and stiffens the follow so the frame never swims.
   */
  private updateCamera(deltaSeconds: number, car: CityCarSnapshot, pose?: CityRenderPose): void {
    const focus = pose
      ? { ...car, position: pose.position, headingRadians: pose.headingRadians }
      : car;
    computeCityCameraPose(focus, this.cameraDesired, this.cameraLookAt);
    const smoothing = 1 - Math.exp(-deltaSeconds * (this.reducedMotion ? 10 : 4.6));
    const camera = this.gameRenderer.camera;
    camera.position.lerp(this.cameraDesired, smoothing);
    camera.lookAt(this.cameraLookAt);
    const speedRatio = Math.max(0, Math.min(1, Math.abs(car.speed) / CITY_BOOST_SPEED));
    const targetFov = this.reducedMotion
      ? this.baseFov
      : this.baseFov + speedRatio * speedRatio * 6;
    if (Math.abs(camera.fov - targetFov) > 0.01) {
      camera.fov += (targetFov - camera.fov) * smoothing;
      camera.updateProjectionMatrix();
    }
  }

  snapCamera(car: CityCarSnapshot): void {
    computeCityCameraPose(car, this.cameraDesired, this.cameraLookAt);
    this.gameRenderer.camera.position.copy(this.cameraDesired);
    this.gameRenderer.camera.lookAt(this.cameraLookAt);
  }

  dispose(): void {
    const camera = this.gameRenderer.camera;
    if (camera.fov !== this.baseFov) {
      camera.fov = this.baseFov;
      camera.updateProjectionMatrix();
    }
    this.assets.dispose();
    this.curated.dispose();
    this.tracker.dispose();
  }
}

function compactTrafficCar(): Group {
  const group = new Group();
  const add = (geometry: BufferGeometry, color: number, x: number, y: number, z: number): void => {
    const mesh = new Mesh(geometry, new MeshStandardMaterial({ color }));
    mesh.position.set(x, y, z);
    group.add(mesh);
  };
  add(new BoxGeometry(0.42, 0.17, 0.92), 0x8fb6a0, 0, 0.14, 0);
  add(new BoxGeometry(0.36, 0.15, 0.44), 0xdff1ef, 0, 0.3, 0.03);
  for (const x of [-0.2, 0.2]) {
    for (const z of [-0.28, 0.28]) {
      add(new BoxGeometry(0.07, 0.13, 0.14), 0x3e3a41, x, 0.065, z);
    }
  }
  return group;
}

/** Buildings rotate so their door face points at the closest road segment. */
function yawTowardNearestRoad(center: CityPoint): number {
  let bestDistance = Number.POSITIVE_INFINITY;
  let yaw = 0;
  for (const road of CITY_ROADS) {
    const ax = road.from[0];
    const az = road.from[1];
    const bx = road.to[0];
    const bz = road.to[1];
    const dx = bx - ax;
    const dz = bz - az;
    const lengthSquared = dx * dx + dz * dz;
    const t = lengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, ((center[0] - ax) * dx + (center[1] - az) * dz) / lengthSquared));
    const px = ax + dx * t;
    const pz = az + dz * t;
    const distance = Math.hypot(center[0] - px, center[1] - pz);
    if (distance < bestDistance) {
      bestDistance = distance;
      yaw = Math.atan2(px - center[0], pz - center[1]);
    }
  }
  // Snap to quarter turns so axis-aligned lots stay axis aligned.
  return Math.round(yaw / (Math.PI / 2)) * (Math.PI / 2);
}
