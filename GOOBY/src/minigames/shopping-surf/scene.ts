/**
 * Shopping Surf Stage3D view — instanced, pooled, allocation-free per frame.
 *
 * The scene leases the shared Stage3D surface and renders the pure model as
 * an endless-runner: the cart stays near the origin while course entities are
 * projected to `worldZ = -(entity.z - state.distance)`. Every repeating thing
 * (crates, ramps, banners, coins, groceries, buildings, market stalls, props,
 * lane dashes, curbs) lives in a fixed-capacity `InstancedMesh` pool whose
 * matrices are rewritten in place each frame from the recycled model chunks —
 * steady-state frames allocate nothing.
 *
 * City dressing consumes only the frozen `CityEnvironmentApi`: building
 * heights/colors cycle deterministically through `places.buildings`, the road
 * span respects `geometry`, and the backdrop tint comes from the districts.
 * Assets come from the surf depot (curated GLBs with total procedural
 * fallback); when a curated template lands, the affected pools rebuild once.
 *
 * Reduced motion swaps the damped chase rig for the static portrait rig and
 * freezes the cosmetic bob/spin channels.
 */
import {
  AmbientLight,
  BoxGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  Fog,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  SphereGeometry,
  TorusGeometry,
  type BufferGeometry,
  type Material,
} from "three";
import type { Clock } from "../../core/contracts/clock";
import {
  acquireStage3d,
  diffStageResourceBaseline,
  type Stage3dLease,
  type Stage3dOptions,
  type StageResourceBaseline,
} from "../../render/stage3d";
import type { CityEnvironmentApi } from "../../scenes/city/environment/api";
import {
  extractInstanceParts,
  type SurfAssetDepot,
  type SurfAssetKey,
} from "./assets";
import {
  SURF_BANNER_DUCK_HEIGHT,
  SURF_CHUNK_LENGTH,
  SURF_GROCERY_LIST_SIZE,
  SURF_LANE_COUNT,
  SURF_LANE_SPACING,
  surfLaneX,
  type SurfState,
} from "./model";

export interface SurfSceneOptions {
  readonly mount: HTMLElement;
  readonly clock: Clock;
  readonly reducedMotion: boolean;
  readonly depot: SurfAssetDepot;
  readonly city: CityEnvironmentApi;
  /** Test seam: swaps the shared Stage3D acquisition for fakes. */
  readonly acquire?: (mount: HTMLElement, options: Stage3dOptions) => Stage3dLease;
}

export interface SurfScenePerf {
  readonly drawCalls: number;
  readonly triangles: number;
}

export interface SurfScene {
  readonly active: boolean;
  readonly canvas: HTMLCanvasElement | null;
  /** Renderer resource counts relative to the lease baseline (leak tests). */
  resourceDelta(): StageResourceBaseline | null;
  perf(): SurfScenePerf;
  /** Syncs pools, cart, and camera to the model state, then draws once. */
  render(state: SurfState, dtSeconds: number): void;
  dispose(): void;
}

/** How far ahead/behind the cart the world stays populated (meters). */
const VIEW_AHEAD = 96;
const VIEW_BEHIND = 16;

const GROCERY_COLORS = [0xf28d35, 0xf7f7f2, 0xd9a066, 0xf6d55c, 0xe0685a, 0xf2b04d] as const;
const BANNER_COLORS = [0xe0685a, 0x5aa9d6, 0xf2b04d] as const;

const SKY_COLOR = 0x9fd9f6;
const CHASE_FOV = 44;

interface Pool {
  readonly meshes: InstancedMesh[];
  readonly offsets: Matrix4[];
  readonly capacity: number;
  written: number;
}

function createPool(
  scene: Group,
  parts: ReadonlyArray<{ geometry: BufferGeometry; material: Material; offset: Matrix4 }>,
  capacity: number,
  colored: boolean,
  name: string,
): Pool {
  const meshes: InstancedMesh[] = [];
  const offsets: Matrix4[] = [];
  const white = new Color(0xffffff);
  for (const [index, partSpec] of parts.entries()) {
    const mesh = new InstancedMesh(partSpec.geometry, partSpec.material, capacity);
    mesh.name = `${name}:${index}`;
    mesh.frustumCulled = false;
    mesh.count = 0;
    if (colored) {
      for (let instance = 0; instance < capacity; instance += 1) mesh.setColorAt(instance, white);
    }
    scene.add(mesh);
    meshes.push(mesh);
    offsets.push(partSpec.offset);
  }
  return { meshes, offsets, capacity, written: 0 };
}

function beginPool(pool: Pool): void {
  pool.written = 0;
}

function commitPool(pool: Pool): void {
  for (const mesh of pool.meshes) {
    mesh.count = pool.written;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }
}

function simplePart(
  geometry: BufferGeometry,
  material: Material,
): { geometry: BufferGeometry; material: Material; offset: Matrix4 } {
  return { geometry, material, offset: new Matrix4() };
}

export function createSurfScene(options: SurfSceneOptions): SurfScene {
  const acquire = options.acquire ?? acquireStage3d;
  const lease = acquire(options.mount, {
    clock: options.clock,
    camera: options.reducedMotion
      ? {
        kind: "portrait-fixed",
        position: { x: 0, y: 4.6, z: 7.8 },
        lookAt: { x: 0, y: 0.9, z: -7 },
        fov: CHASE_FOV,
      }
      : {
        kind: "portrait-chase",
        offset: { x: 0, y: 3, z: 6.1 },
        lookAhead: { x: 0, y: 0.75, z: -5 },
        stiffness: 7.5,
        fov: CHASE_FOV,
      },
  });

  const city = options.city;
  const depot = options.depot;
  const reducedMotion = options.reducedMotion;
  let disposed = false;

  lease.scene.background = new Color(SKY_COLOR);
  lease.scene.fog = new Fog(SKY_COLOR, 34, VIEW_AHEAD + 8);
  lease.scene.add(new AmbientLight(0xfff4e0, 1.15));
  const sun = new DirectionalLight(0xfff6e8, 1.9);
  sun.position.set(4, 9, 5);
  lease.scene.add(sun);

  // --- Static street bed (does not move; motion is sold by the pools). ---
  const laneSpan = SURF_LANE_COUNT * SURF_LANE_SPACING;
  const roadWidth = Math.max(laneSpan + 1.2, city.geometry.roadWidth);
  const sidewalkWidth = Math.max(1.8, city.geometry.sidewalkWidth);
  const districts = city.places.districts;
  const groundColor = new Color(districts[0]?.groundColor ?? 0x9ec48a);

  const staticRoot = new Group();
  staticRoot.name = "surf-street";
  const road = new Mesh(
    new BoxGeometry(roadWidth, 0.1, VIEW_AHEAD + VIEW_BEHIND + 20),
    new MeshStandardMaterial({ color: 0x565b64, roughness: 0.92 }),
  );
  road.position.set(0, -0.05, -(VIEW_AHEAD - VIEW_BEHIND) / 2);
  staticRoot.add(road);
  const walkMaterial = new MeshStandardMaterial({ color: 0xddd2bf, roughness: 0.9 });
  for (const side of [-1, 1] as const) {
    const walk = new Mesh(
      new BoxGeometry(sidewalkWidth, 0.16, VIEW_AHEAD + VIEW_BEHIND + 20),
      walkMaterial,
    );
    walk.position.set(
      side * (roadWidth / 2 + sidewalkWidth / 2),
      -0.02,
      -(VIEW_AHEAD - VIEW_BEHIND) / 2,
    );
    staticRoot.add(walk);
  }
  const ground = new Mesh(
    new BoxGeometry(90, 0.06, VIEW_AHEAD + VIEW_BEHIND + 40),
    new MeshStandardMaterial({ color: groundColor, roughness: 1 }),
  );
  ground.position.set(0, -0.12, -(VIEW_AHEAD - VIEW_BEHIND) / 2);
  staticRoot.add(ground);
  lease.scene.add(staticRoot);

  // --- Instanced pools -----------------------------------------------------
  const poolRoot = new Group();
  poolRoot.name = "surf-pools";
  lease.scene.add(poolRoot);

  const dashGeometry = new BoxGeometry(0.16, 0.02, 1.4);
  const dashMaterial = new MeshStandardMaterial({ color: 0xf3e6c2, roughness: 0.6 });
  const curbGeometry = new BoxGeometry(0.3, 0.14, 3.4);
  const curbMaterial = new MeshStandardMaterial({ color: 0xb9ad9a, roughness: 0.85 });
  const coinGeometry = new CylinderGeometry(0.34, 0.34, 0.09, 14);
  const coinMaterial = new MeshStandardMaterial({ color: 0xf6c343, roughness: 0.3, metalness: 0.35 });
  const groceryGeometry = new BoxGeometry(0.62, 0.62, 0.62);
  const groceryMaterial = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 });
  const bannerPostGeometry = new BoxGeometry(0.12, 1.9, 0.12);
  const bannerPostMaterial = new MeshStandardMaterial({ color: 0x6a6f7c, roughness: 0.5 });
  const bannerClothGeometry = new BoxGeometry(SURF_LANE_SPACING - 0.3, 0.5, 0.08);
  const bannerClothMaterial = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.7 });
  const stallBaseGeometry = new BoxGeometry(1.9, 0.9, 1.3);
  const stallBaseMaterial = new MeshStandardMaterial({ color: 0xa96e4d, roughness: 0.85 });
  const stallCanopyGeometry = new BoxGeometry(2.2, 0.12, 1.7);
  const stallCanopyMaterial = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.75 });

  interface Pools {
    crate: Pool;
    ramp: Pool;
    coin: Pool;
    grocery: Pool;
    bannerPost: Pool;
    bannerCloth: Pool;
    buildingA: Pool;
    buildingB: Pool;
    buildingC: Pool;
    sign: Pool;
    hydrant: Pool;
    stallBase: Pool;
    stallCanopy: Pool;
    dash: Pool;
    curb: Pool;
  }

  let pools: Pools | null = null;

  const buildPools = (): Pools => ({
    crate: createPool(poolRoot, extractInstanceParts(depot.template("surf.crate"), 2), 40, false, "crate"),
    ramp: createPool(poolRoot, extractInstanceParts(depot.template("surf.ramp"), 2), 14, false, "ramp"),
    coin: createPool(poolRoot, [simplePart(coinGeometry, coinMaterial)], 90, false, "coin"),
    grocery: createPool(poolRoot, [simplePart(groceryGeometry, groceryMaterial)], SURF_GROCERY_LIST_SIZE + 2, true, "grocery"),
    bannerPost: createPool(poolRoot, [simplePart(bannerPostGeometry, bannerPostMaterial)], 24, false, "banner-post"),
    bannerCloth: createPool(poolRoot, [simplePart(bannerClothGeometry, bannerClothMaterial)], 12, true, "banner-cloth"),
    buildingA: createPool(poolRoot, extractInstanceParts(depot.template("building.city-a"), 2), 14, true, "building-a"),
    buildingB: createPool(poolRoot, extractInstanceParts(depot.template("building.city-b"), 2), 14, true, "building-b"),
    buildingC: createPool(poolRoot, extractInstanceParts(depot.template("building.city-c"), 2), 14, true, "building-c"),
    sign: createPool(poolRoot, extractInstanceParts(depot.template("city.sign"), 2), 10, false, "sign"),
    hydrant: createPool(poolRoot, extractInstanceParts(depot.template("city.hydrant"), 2), 10, false, "hydrant"),
    stallBase: createPool(poolRoot, [simplePart(stallBaseGeometry, stallBaseMaterial)], 12, false, "stall-base"),
    stallCanopy: createPool(poolRoot, [simplePart(stallCanopyGeometry, stallCanopyMaterial)], 12, true, "stall-canopy"),
    dash: createPool(poolRoot, [simplePart(dashGeometry, dashMaterial)], 70, false, "dash"),
    curb: createPool(poolRoot, [simplePart(curbGeometry, curbMaterial)], 70, false, "curb"),
  });

  const destroyPools = (): void => {
    if (!pools) return;
    for (const pool of Object.values(pools) as Pool[]) {
      for (const mesh of pool.meshes) {
        poolRoot.remove(mesh);
        mesh.dispose();
      }
    }
    pools = null;
  };

  pools = buildPools();

  // --- Cart hero -----------------------------------------------------------
  const cartRoot = new Group();
  cartRoot.name = "surf-cart-root";
  lease.scene.add(cartRoot);
  let cartModel: Object3D | null = null;

  const mountCartModel = (): void => {
    if (cartModel) cartRoot.remove(cartModel);
    cartModel = depot.template("surf.cart").clone(true);
    cartModel.name = "surf-cart-model";
    cartRoot.add(cartModel);
  };
  mountCartModel();

  const rider = new Group();
  rider.name = "surf-rider";
  const fur = new MeshStandardMaterial({ color: 0xf5efe6, roughness: 0.7 });
  const body = new Mesh(new SphereGeometry(0.3, 12, 10), fur);
  body.position.set(0, 0.92, 0.1);
  body.scale.set(1, 1.15, 0.95);
  rider.add(body);
  const head = new Mesh(new SphereGeometry(0.22, 12, 10), fur);
  head.position.set(0, 1.36, 0.08);
  rider.add(head);
  const earGeometry = new BoxGeometry(0.09, 0.4, 0.06);
  for (const side of [-1, 1] as const) {
    const ear = new Mesh(earGeometry, fur);
    ear.position.set(side * 0.1, 1.68, 0.05);
    ear.rotation.z = side * -0.14;
    rider.add(ear);
  }
  cartRoot.add(rider);

  const shieldRing = new Mesh(
    new TorusGeometry(1.05, 0.05, 8, 26),
    new MeshStandardMaterial({ color: 0x8fd3ff, roughness: 0.25 }),
  );
  shieldRing.rotation.x = Math.PI / 2;
  shieldRing.position.y = 0.5;
  shieldRing.visible = false;
  cartRoot.add(shieldRing);

  const cameraAnchor = new Object3D();
  cameraAnchor.name = "surf-camera-anchor";
  lease.scene.add(cameraAnchor);
  lease.setChaseTarget(cameraAnchor);

  // Curated upgrades rebuild the pools / cart clone exactly once per key.
  let rebuildPools = false;
  const stopUpgrades = depot.onUpgrade((key: SurfAssetKey) => {
    if (disposed) return;
    if (key === "surf.cart") mountCartModel();
    else rebuildPools = true;
  });

  // --- Frame scratch (preallocated; the render loop never allocates). ------
  const scratch = new Object3D();
  const scratchMatrix = new Matrix4();
  const scratchColor = new Color();
  const buildings = city.places.buildings;

  const writeInstance = (pool: Pool, color: Color | null): void => {
    if (pool.written >= pool.capacity) return;
    scratch.updateMatrix();
    for (let index = 0; index < pool.meshes.length; index += 1) {
      const mesh = pool.meshes[index];
      const offset = pool.offsets[index];
      if (!mesh || !offset) continue;
      scratchMatrix.multiplyMatrices(scratch.matrix, offset);
      mesh.setMatrixAt(pool.written, scratchMatrix);
      if (color && mesh.instanceColor) mesh.setColorAt(pool.written, color);
    }
    pool.written += 1;
  };

  const resetScratch = (): void => {
    scratch.position.set(0, 0, 0);
    scratch.rotation.set(0, 0, 0);
    scratch.scale.set(1, 1, 1);
  };

  const writeEnvironment = (state: SurfState, live: Pools): void => {
    const distance = state.distance;

    // Lane divider dashes every 4 m in both dividers.
    const dashStart = Math.floor((distance - VIEW_BEHIND) / 4) * 4;
    for (let z = dashStart; z <= distance + VIEW_AHEAD; z += 4) {
      const viewZ = -(z - distance);
      for (const divider of [-1, 1] as const) {
        resetScratch();
        scratch.position.set(divider * (SURF_LANE_SPACING / 2), 0.01, viewZ);
        writeInstance(live.dash, null);
      }
    }

    // Curbs every 4 m on both road edges.
    const curbStart = Math.floor((distance - VIEW_BEHIND) / 4) * 4;
    for (let z = curbStart; z <= distance + VIEW_AHEAD; z += 4) {
      const viewZ = -(z - distance);
      for (const side of [-1, 1] as const) {
        resetScratch();
        scratch.position.set(side * (roadWidth / 2 + 0.15), 0.05, viewZ);
        writeInstance(live.curb, null);
      }
    }

    // Buildings every 13 m per side, styled from the frozen city lots.
    const slotStart = Math.floor((distance - VIEW_BEHIND) / 13);
    const slotEnd = Math.ceil((distance + VIEW_AHEAD) / 13);
    for (let slot = slotStart; slot <= slotEnd; slot += 1) {
      const z = slot * 13;
      const viewZ = -(z - distance);
      for (const side of [-1, 1] as const) {
        const lotIndex = ((slot * 7 + (side === 1 ? 3 : 0)) % buildings.length + buildings.length) % buildings.length;
        const lot = buildings[lotIndex];
        if (!lot) continue;
        const kindPick = (slot + (side === 1 ? 1 : 0)) % 3;
        const pool = kindPick === 0 ? live.buildingA : kindPick === 1 ? live.buildingB : live.buildingC;
        resetScratch();
        scratch.position.set(side * (roadWidth / 2 + sidewalkWidth + 1.6), 0, viewZ);
        scratch.rotation.y = side === 1 ? -Math.PI / 2 : Math.PI / 2;
        const rise = Math.max(0.8, Math.min(2.2, lot.height / 2.4));
        scratch.scale.set(1.35, rise, 1.35);
        scratchColor.setHex(lot.color);
        writeInstance(pool, scratchColor);
      }
    }

    // Market stalls on alternating sides every other chunk.
    const chunkStart = Math.floor((distance - VIEW_BEHIND) / SURF_CHUNK_LENGTH);
    const chunkEnd = Math.ceil((distance + VIEW_AHEAD) / SURF_CHUNK_LENGTH);
    for (let chunk = chunkStart; chunk <= chunkEnd; chunk += 1) {
      const stallZ = chunk * SURF_CHUNK_LENGTH + 9;
      const viewZ = -(stallZ - distance);
      const side = chunk % 2 === 0 ? 1 : -1;
      resetScratch();
      scratch.position.set(side * (roadWidth / 2 + sidewalkWidth / 2), 0.45, viewZ);
      writeInstance(live.stallBase, null);
      resetScratch();
      scratch.position.set(side * (roadWidth / 2 + sidewalkWidth / 2), 1.32, viewZ);
      scratchColor.setHex(BANNER_COLORS[((chunk % 3) + 3) % 3] ?? 0xe0685a);
      writeInstance(live.stallCanopy, scratchColor);

      // Street props: a sign near the chunk seam, a hydrant mid-chunk.
      const signZ = chunk * SURF_CHUNK_LENGTH + 2;
      resetScratch();
      scratch.position.set(-(roadWidth / 2 + 0.7), 0, -(signZ - distance));
      writeInstance(live.sign, null);
      const hydrantZ = chunk * SURF_CHUNK_LENGTH + 18;
      resetScratch();
      scratch.position.set(roadWidth / 2 + 0.7, 0, -(hydrantZ - distance));
      writeInstance(live.hydrant, null);
    }
  };

  const writeEntities = (state: SurfState, live: Pools): void => {
    const distance = state.distance;
    for (const chunk of state.chunks) {
      if (chunk.startZ > distance + VIEW_AHEAD) continue;
      if (chunk.startZ + SURF_CHUNK_LENGTH < distance - VIEW_BEHIND) continue;
      for (let index = 0; index < chunk.entityCount; index += 1) {
        const entity = chunk.entities[index];
        if (!entity || entity.kind === "none") continue;
        const viewZ = -(entity.z - distance);
        if (viewZ > VIEW_BEHIND || viewZ < -VIEW_AHEAD) continue;
        const laneX = surfLaneX(entity.lane);
        switch (entity.kind) {
          case "crate": {
            resetScratch();
            scratch.position.set(laneX, 0, viewZ);
            writeInstance(live.crate, null);
            break;
          }
          case "ramp": {
            resetScratch();
            scratch.position.set(laneX, 0, viewZ);
            writeInstance(live.ramp, null);
            break;
          }
          case "banner": {
            for (const side of [-1, 1] as const) {
              resetScratch();
              scratch.position.set(laneX + side * (SURF_LANE_SPACING / 2 - 0.1), 0.95, viewZ);
              writeInstance(live.bannerPost, null);
            }
            resetScratch();
            scratch.position.set(laneX, SURF_BANNER_DUCK_HEIGHT + 0.62, viewZ);
            scratchColor.setHex(
              BANNER_COLORS[((Math.floor(entity.z / 7) % 3) + 3) % 3] ?? 0xe0685a,
            );
            writeInstance(live.bannerCloth, scratchColor);
            break;
          }
          case "coin": {
            if (entity.resolved) break;
            resetScratch();
            scratch.position.set(laneX, 0.62, viewZ);
            scratch.rotation.x = Math.PI / 2;
            scratch.rotation.z = reducedMotion ? 0.6 : state.time * 2.4 + entity.z * 0.31;
            writeInstance(live.coin, null);
            break;
          }
          case "grocery": {
            if (entity.resolved) break;
            resetScratch();
            const bob = reducedMotion ? 0 : Math.sin(state.time * 2.2 + entity.z) * 0.09;
            scratch.position.set(laneX, 0.95 + bob, viewZ);
            scratch.rotation.y = reducedMotion ? 0.5 : state.time * 1.4;
            scratchColor.setHex(
              GROCERY_COLORS[entity.groceryIndex >= 0 ? entity.groceryIndex % GROCERY_COLORS.length : 0]
              ?? 0xf28d35,
            );
            writeInstance(live.grocery, scratchColor);
            break;
          }
          default:
            break;
        }
      }
    }
  };

  const poseCart = (state: SurfState): void => {
    const targetX = surfLaneX(state.lane);
    cartRoot.position.set(state.x, state.y, 0);
    const lean = Math.max(-0.3, Math.min(0.3, (targetX - state.x) * 0.22));
    cartRoot.rotation.z = reducedMotion ? 0 : -lean;
    cartRoot.rotation.x = state.airborne && !reducedMotion
      ? Math.max(-0.32, Math.min(0.32, -state.vy * 0.035))
      : 0;
    cartRoot.rotation.y = state.trickPending && !reducedMotion ? state.time * 10 : 0;
    const duckSquash = state.ducking ? 0.68 : 1;
    cartRoot.scale.set(1, duckSquash, 1);

    shieldRing.visible = state.invulnerable > 0
      && (reducedMotion || Math.floor(state.time * 10) % 2 === 0);

    cameraAnchor.position.set(state.x * 0.85, 0, 0);
  };

  let lastDrawCalls = 0;
  let lastTriangles = 0;

  return {
    get active() {
      return !disposed && !lease.released;
    },
    get canvas() {
      return disposed ? null : lease.canvas;
    },
    resourceDelta() {
      // Readable after dispose too: the released lease keeps its renderer
      // reference, so leak tests can assert the post-release delta is zero.
      return diffStageResourceBaseline(lease.renderer, lease.baseline);
    },
    perf() {
      return { drawCalls: lastDrawCalls, triangles: lastTriangles };
    },
    render(state, dtSeconds) {
      if (disposed || lease.released) return;
      if (rebuildPools) {
        rebuildPools = false;
        destroyPools();
        pools = buildPools();
      }
      const live = pools;
      if (!live) return;
      for (const pool of Object.values(live) as Pool[]) beginPool(pool);
      writeEnvironment(state, live);
      writeEntities(state, live);
      for (const pool of Object.values(live) as Pool[]) commitPool(pool);
      poseCart(state);
      lease.updateCamera(dtSeconds);
      lease.renderOnce();
      lastDrawCalls = lease.renderer.info.render.calls;
      lastTriangles = lease.renderer.info.render.triangles;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      stopUpgrades();
      // Release disposes every geometry/material/texture reachable from the
      // lease scene (pools, cart clone, street bed) back to the baseline.
      lease.release();
    },
  };
}
