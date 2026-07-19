/**
 * Cloud Bounce Stage3D view — a light, instanced, allocation-free scene.
 *
 * The scene leases the shared Stage3D surface with a fixed portrait camera
 * and renders the pure model relative to a smoothed view focus: object
 * `worldY = (y - focus) · scale`, so the world slides down as Gooby climbs
 * and both camera rigs stay put. Every repeating thing (cloud puffs, spring
 * pads, bonus stars, wind-band veils and their arrow streaks) lives in a
 * fixed-capacity `InstancedMesh` pool sized to the model's recycled slot
 * pools — steady frames allocate nothing.
 *
 * Kind coding never relies on color alone: moving clouds sweep, fading
 * clouds shrink with their dissolve, spring clouds carry a visible pad, and
 * wind streaks are arrow-shaped (rotated per direction). Reduced motion
 * snaps the focus (no camera easing), freezes star spin, streak drift and
 * the hero squash, and keeps the sky gradient step-free.
 *
 * The low quality tier trims sphere/cone segment counts and swaps PBR
 * materials for Lambert; the sky/fog colors stay identical.
 */
import {
  AmbientLight,
  BoxGeometry,
  Color,
  ConeGeometry,
  DirectionalLight,
  Fog,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  MeshStandardMaterial,
  Object3D,
  OctahedronGeometry,
  SphereGeometry,
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
import {
  CLOUD_POOL_CAPACITY,
  CLOUD_WIND_HEIGHT,
  CLOUD_WIND_INTERVAL,
  cloudWindBandBottom,
  cloudWindDirection,
  cloudWindStrength,
  STAR_POOL_CAPACITY,
  type CloudState,
} from "./model";

export interface CloudSceneOptions {
  readonly mount: HTMLElement;
  readonly clock: Clock;
  readonly reducedMotion: boolean;
  /** Test seam: swaps the shared Stage3D acquisition for fakes. */
  readonly acquire?: (mount: HTMLElement, options: Stage3dOptions) => Stage3dLease;
}

export interface CloudScenePerf {
  readonly drawCalls: number;
  readonly triangles: number;
}

export interface CloudScene {
  readonly active: boolean;
  readonly canvas: HTMLCanvasElement | null;
  /** Renderer resource counts relative to the lease baseline (leak tests). */
  resourceDelta(): StageResourceBaseline | null;
  perf(): CloudScenePerf;
  /** The smoothed view focus in model units (reduced motion snaps it). */
  focusY(): number;
  /** Syncs pools, hero, and sky to the model state, then draws once. */
  render(state: CloudState, dtSeconds: number): void;
  dispose(): void;
}

/** World meters per model unit (model field width is 1). */
export const CLOUD_WORLD_SCALE = 7;
const CAMERA_FOV = 46;
const CAMERA_Z = 16.5;
const CAMERA_Y = 0.4;
const FOCUS_STIFFNESS = 6;
/** Visible altitude half-window in model units (for band/star culling). */
const VIEW_HALF_UNITS = 1.15;

const SKY_LOW = 0x8fd0f2;
const SKY_HIGH = 0x3f63b8;
const KIND_COLORS = {
  static: 0xffffff,
  moving: 0xcfe8ff,
  fading: 0xe8dcf4,
  spring: 0xfff1cd,
} as const;

const SPRING_PAD_CAPACITY = 10;
const WIND_BAND_CAPACITY = 3;
const WIND_STREAKS_PER_BAND = 4;
const WIND_STREAK_CAPACITY = WIND_BAND_CAPACITY * WIND_STREAKS_PER_BAND;

interface Pool {
  readonly meshes: InstancedMesh[];
  readonly offsets: Matrix4[];
  readonly capacity: number;
  written: number;
}

function createPool(
  parent: Group,
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
    parent.add(mesh);
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

/** Deterministic unit hash for decorative offsets (never re-rolls). */
function unitHash(index: number, salt: number): number {
  let value = (index * 0x9e3779b1 + salt * 0x85ebca6b) >>> 0;
  value = Math.imul(value ^ (value >>> 15), value | 1) >>> 0;
  return ((value ^ (value >>> 13)) >>> 0) / 4_294_967_296;
}

export function createCloudScene(options: CloudSceneOptions): CloudScene {
  const acquire = options.acquire ?? acquireStage3d;
  const reducedMotion = options.reducedMotion;
  const lease = acquire(options.mount, {
    clock: options.clock,
    camera: {
      kind: "portrait-fixed",
      position: { x: 0, y: CAMERA_Y, z: CAMERA_Z },
      lookAt: { x: 0, y: CAMERA_Y, z: 0 },
      fov: CAMERA_FOV,
    },
  });
  let disposed = false;

  const lowTier = lease.scene.userData.goobyQualityTier === "low" || lease.camera.far <= 80;
  const surfaceMaterial = (
    color: number | Color,
    roughness: number,
    extra: { transparent?: boolean; opacity?: number } = {},
  ): Material => {
    const material = lowTier
      ? new MeshLambertMaterial({ color })
      : new MeshStandardMaterial({ color, roughness, metalness: 0 });
    if (extra.transparent === true) {
      material.transparent = true;
      material.opacity = extra.opacity ?? 1;
      material.depthWrite = false;
    }
    return material;
  };

  const skyColor = new Color(SKY_LOW);
  const skyLow = new Color(SKY_LOW);
  const skyHigh = new Color(SKY_HIGH);
  lease.scene.background = skyColor;
  const fog = new Fog(SKY_LOW, 30, 70);
  lease.scene.fog = fog;
  lease.scene.add(new AmbientLight(0xfdf6ea, 1.2));
  const sun = new DirectionalLight(0xfff6e0, 1.7);
  sun.position.set(5, 10, 7);
  lease.scene.add(sun);

  const root = new Group();
  root.name = "cloud-bounce-pools";
  lease.scene.add(root);

  // --- Pool parts -----------------------------------------------------------
  const puffGeometry = new SphereGeometry(1, lowTier ? 8 : 12, lowTier ? 6 : 9);
  const puffMaterial = surfaceMaterial(0xffffff, 0.85);
  const puffCenter = new Matrix4().makeScale(0.62, 0.42, 0.5);
  const puffLeft = new Matrix4()
    .makeTranslation(-0.52, -0.06, 0.04)
    .multiply(new Matrix4().makeScale(0.4, 0.3, 0.38));
  const puffRight = new Matrix4()
    .makeTranslation(0.52, -0.06, -0.04)
    .multiply(new Matrix4().makeScale(0.4, 0.3, 0.38));
  const cloudPool = createPool(
    root,
    [
      { geometry: puffGeometry, material: puffMaterial, offset: puffCenter },
      { geometry: puffGeometry, material: puffMaterial, offset: puffLeft },
      { geometry: puffGeometry, material: puffMaterial, offset: puffRight },
    ],
    CLOUD_POOL_CAPACITY,
    true,
    "cloud-puff",
  );

  const padGeometry = new BoxGeometry(0.9, 0.12, 0.55);
  const padMaterial = surfaceMaterial(0xf07a5f, 0.55);
  const springPool = createPool(
    root,
    [{ geometry: padGeometry, material: padMaterial, offset: new Matrix4() }],
    SPRING_PAD_CAPACITY,
    false,
    "spring-pad",
  );

  const starGeometry = new OctahedronGeometry(0.3, 0);
  const starMaterial = surfaceMaterial(0xf6c343, 0.35);
  const starPool = createPool(
    root,
    [{ geometry: starGeometry, material: starMaterial, offset: new Matrix4() }],
    STAR_POOL_CAPACITY,
    true,
    "star",
  );

  const bandGeometry = new BoxGeometry(
    CLOUD_WORLD_SCALE + 1.2,
    CLOUD_WIND_HEIGHT * CLOUD_WORLD_SCALE,
    0.06,
  );
  const bandMaterial = surfaceMaterial(0xffffff, 1, { transparent: true, opacity: 0.16 });
  const bandPool = createPool(
    root,
    [{ geometry: bandGeometry, material: bandMaterial, offset: new Matrix4() }],
    WIND_BAND_CAPACITY,
    true,
    "wind-band",
  );

  // Arrow streaks: shaft + nose cone baked to point +x; west wind rotates
  // the whole instance by π, so direction reads as shape, not color.
  const streakShaftGeometry = new BoxGeometry(0.7, 0.07, 0.07);
  const streakTipGeometry = new ConeGeometry(0.12, 0.24, lowTier ? 5 : 7);
  const streakMaterial = surfaceMaterial(0xffffff, 0.6, { transparent: true, opacity: 0.65 });
  const streakTipOffset = new Matrix4()
    .makeTranslation(0.45, 0, 0)
    .multiply(new Matrix4().makeRotationZ(-Math.PI / 2));
  const streakPool = createPool(
    root,
    [
      { geometry: streakShaftGeometry, material: streakMaterial, offset: new Matrix4() },
      { geometry: streakTipGeometry, material: streakMaterial, offset: streakTipOffset },
    ],
    WIND_STREAK_CAPACITY,
    true,
    "wind-streak",
  );

  const pools = [cloudPool, springPool, starPool, bandPool, streakPool];

  // --- Hero -----------------------------------------------------------------
  const hero = new Group();
  hero.name = "cloud-hero";
  const fur = surfaceMaterial(0xf5efe6, 0.7);
  const heroSegments = lowTier ? 9 : 12;
  const heroRings = lowTier ? 7 : 10;
  const body = new Mesh(new SphereGeometry(0.34, heroSegments, heroRings), fur);
  body.scale.set(1, 1.1, 0.95);
  hero.add(body);
  const head = new Mesh(new SphereGeometry(0.24, heroSegments, heroRings), fur);
  head.position.set(0, 0.44, 0.05);
  hero.add(head);
  const earGeometry = new BoxGeometry(0.1, 0.42, 0.07);
  for (const side of [-1, 1] as const) {
    const ear = new Mesh(earGeometry, fur);
    ear.position.set(side * 0.11, 0.78, 0);
    ear.rotation.z = side * -0.12;
    hero.add(ear);
  }
  lease.scene.add(hero);

  // --- Frame scratch (preallocated; the render loop never allocates). ------
  const scratch = new Object3D();
  const scratchMatrix = new Matrix4();
  const scratchColor = new Color();
  const fadeTarget = new Color(SKY_LOW);

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

  let viewFocus = 0;
  const worldX = (x: number): number => (x - 0.5) * CLOUD_WORLD_SCALE;
  const worldY = (y: number): number => (y - viewFocus) * CLOUD_WORLD_SCALE;

  const writeClouds = (state: CloudState): void => {
    for (const cloud of state.clouds) {
      if (!cloud.active) continue;
      if (Math.abs(cloud.y - viewFocus) > VIEW_HALF_UNITS + 0.3) continue;
      const size = cloud.halfWidth * CLOUD_WORLD_SCALE;
      const dissolve = cloud.kind === "fading" ? Math.max(0.15, cloud.fade) : 1;
      resetScratch();
      scratch.position.set(worldX(cloud.x), worldY(cloud.y) - 0.18, 0);
      scratch.scale.set(size * dissolve, size * 0.9 * dissolve, size * 0.9 * dissolve);
      scratchColor.setHex(KIND_COLORS[cloud.kind]);
      if (cloud.kind === "fading" && cloud.bounced) {
        scratchColor.lerp(fadeTarget, 1 - cloud.fade);
      }
      writeInstance(cloudPool, scratchColor);
      if (cloud.kind === "spring") {
        resetScratch();
        scratch.position.set(worldX(cloud.x), worldY(cloud.y) + 0.12, 0.1);
        writeInstance(springPool, null);
      }
    }
  };

  const writeStars = (state: CloudState): void => {
    for (const star of state.starSlots) {
      if (!star.active) continue;
      if (Math.abs(star.y - viewFocus) > VIEW_HALF_UNITS + 0.2) continue;
      resetScratch();
      scratch.position.set(worldX(star.x), worldY(star.y), 0.2);
      scratch.rotation.y = reducedMotion ? star.twinkle : state.time * 2 + star.twinkle;
      scratch.rotation.z = Math.PI / 4;
      writeInstance(starPool, null);
    }
  };

  const writeWind = (state: CloudState): void => {
    const from = Math.max(
      0,
      Math.floor((viewFocus - VIEW_HALF_UNITS - cloudWindBandBottom(0)) / CLOUD_WIND_INTERVAL),
    );
    for (let index = from; index < from + WIND_BAND_CAPACITY; index += 1) {
      const bottom = cloudWindBandBottom(index);
      if (bottom > viewFocus + VIEW_HALF_UNITS + CLOUD_WIND_HEIGHT) break;
      if (bottom + CLOUD_WIND_HEIGHT < viewFocus - VIEW_HALF_UNITS) continue;
      const centerY = worldY(bottom + CLOUD_WIND_HEIGHT / 2);
      const direction = cloudWindDirection(index);
      resetScratch();
      scratch.position.set(0, centerY, -0.6);
      scratchColor.setHex(direction > 0 ? 0xd9f2ff : 0xf2e3ff);
      writeInstance(bandPool, scratchColor);

      const drift = reducedMotion
        ? 0
        : state.time * cloudWindStrength(index) * direction * 0.6;
      for (let streak = 0; streak < WIND_STREAKS_PER_BAND; streak += 1) {
        const phase = unitHash(index * WIND_STREAKS_PER_BAND + streak, 11);
        const cycle = ((phase + drift / 1.4) % 1 + 1) % 1;
        const x = (cycle - 0.5) * (CLOUD_WORLD_SCALE + 0.8);
        const rowY = centerY
          + (unitHash(index * WIND_STREAKS_PER_BAND + streak, 23) - 0.5)
            * CLOUD_WIND_HEIGHT * CLOUD_WORLD_SCALE * 0.7;
        resetScratch();
        scratch.position.set(x, rowY, -0.4);
        if (direction < 0) scratch.rotation.y = Math.PI;
        scratchColor.setHex(0xffffff);
        writeInstance(streakPool, scratchColor);
      }
    }
  };

  const poseHero = (state: CloudState): void => {
    hero.position.set(worldX(state.x), worldY(state.y) + 0.28, 0.3);
    if (reducedMotion) {
      hero.scale.set(1, 1, 1);
      hero.rotation.z = 0;
    } else {
      const stretch = Math.max(0.85, Math.min(1.18, 1 + state.vy * 0.05));
      hero.scale.set(2 - stretch, stretch, 1);
      hero.rotation.z = Math.max(-0.25, Math.min(0.25, -state.vx * 0.25));
    }
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
    focusY() {
      return viewFocus;
    },
    render(state, dtSeconds) {
      if (disposed || lease.released) return;
      // The focus chases the model camera; reduced motion snaps instantly.
      if (reducedMotion || dtSeconds <= 0) {
        if (reducedMotion) viewFocus = state.cameraY;
      } else {
        viewFocus += (state.cameraY - viewFocus) * (1 - Math.exp(-FOCUS_STIFFNESS * dtSeconds));
      }

      // Sky deepens with altitude; one Color mutated in place.
      const altitude = Math.max(0, Math.min(1, viewFocus / 14));
      skyColor.copy(skyLow).lerp(skyHigh, altitude);
      fog.color.copy(skyColor);
      fadeTarget.copy(skyColor);

      for (const pool of pools) beginPool(pool);
      writeClouds(state);
      writeStars(state);
      writeWind(state);
      for (const pool of pools) commitPool(pool);
      poseHero(state);

      lease.updateCamera(dtSeconds);
      lease.renderOnce();
      lastDrawCalls = lease.renderer.info.render.calls;
      lastTriangles = lease.renderer.info.render.triangles;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      // Release disposes every geometry/material/texture reachable from the
      // lease scene (pools, hero, lights) back to the baseline.
      lease.release();
    },
  };
}
