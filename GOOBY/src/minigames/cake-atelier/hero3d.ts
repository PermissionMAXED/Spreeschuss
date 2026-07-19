/**
 * Cake Atelier hero showcase — a Stage3D lease presenting the real curated
 * `food.cake` GLB (Kenney Food Kit, CC0) on a slowly turning pedestal.
 *
 * Lease discipline: the showcase acquires the shared Stage3D lease lazily on
 * first show, keeps exactly one lease for the lifetime of the minigame
 * mount, and releases it on dispose. Release is leak-neutral by contract —
 * the lease tracker disposes every geometry/material/texture the showcase
 * created (including the loaded GLB tree), and `resourceDelta()` exposes the
 * renderer-count diff against the lease baseline so tests can assert the
 * baseline is restored.
 */
import {
  AmbientLight,
  Color,
  CylinderGeometry,
  DirectionalLight,
  Group,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  TorusGeometry,
  Box3,
  Vector3,
  type Object3D,
  type WebGLRenderer,
} from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { Clock } from "../../core/contracts/clock";
import { PLANNED_ASSET_MANIFEST } from "../../data/assetManifest";
import { ResourceTracker } from "../../render/renderer";
import {
  acquireStage3d,
  diffStageResourceBaseline,
  type Stage3dLease,
  type StageResourceBaseline,
} from "../../render/stage3d";

export interface CakeHeroOptions {
  readonly mount: HTMLElement;
  readonly clock: Clock;
  /** Static hero (no turntable loop) for reduced-motion players. */
  readonly reducedMotion: boolean;
}

export interface CakeHeroShowcase {
  readonly active: boolean;
  /** "curated" once the GLB landed, "procedural" on fallback, else "loading". */
  readonly source: "loading" | "curated" | "procedural";
  show(): void;
  setPaused(paused: boolean): void;
  /** Renderer resource counts relative to the lease baseline. */
  resourceDelta(): StageResourceBaseline | null;
  dispose(): void;
}

const CURATED_CAKE_PATH = PLANNED_ASSET_MANIFEST["food.cake"].vendored[0]?.path ?? "";

const LUT_WARMED_RENDERERS = new WeakSet<WebGLRenderer>();

/**
 * three.js lazily creates its module-level DFG lookup texture on the first
 * render of a physically-based material — which would land *after* a lease
 * captured its resource baseline and make an otherwise clean release look
 * like a one-texture leak. Warm the shared renderer through a throwaway
 * lease once, so the real lease's baseline already includes the LUT and
 * `resourceDelta()` reads exactly zero after release.
 */
function warmSharedPbrCaches(mount: HTMLElement, clock: Clock): void {
  const probe = acquireStage3d(mount, { clock });
  try {
    if (LUT_WARMED_RENDERERS.has(probe.renderer)) return;
    const mesh = new Mesh(new SphereGeometry(0.1, 4, 3), new MeshStandardMaterial());
    mesh.frustumCulled = false;
    probe.scene.add(mesh);
    probe.resize({ width: 8, height: 8 });
    probe.renderOnce();
    LUT_WARMED_RENDERERS.add(probe.renderer);
  } finally {
    probe.release();
  }
}

function buildPedestal(): Group {
  const pedestal = new Group();
  pedestal.name = "cake-hero-pedestal";
  const plate = new Mesh(
    new CylinderGeometry(1.5, 1.62, 0.16, 36),
    new MeshStandardMaterial({ color: 0xfff3dd, roughness: 0.35, metalness: 0.08 }),
  );
  plate.position.y = 0.08;
  pedestal.add(plate);
  const stem = new Mesh(
    new CylinderGeometry(0.32, 0.46, 0.5, 20),
    new MeshStandardMaterial({ color: 0xf3ddc0, roughness: 0.5 }),
  );
  stem.position.y = -0.25;
  pedestal.add(stem);
  return pedestal;
}

/** Offline-safe stand-in cake so the showcase never renders empty. */
function buildProceduralCake(): Group {
  const cake = new Group();
  cake.name = "cake-hero-procedural";
  const sponge = new MeshStandardMaterial({ color: 0xf6d7a8, roughness: 0.82 });
  const frosting = new MeshStandardMaterial({ color: 0xf5a0a8, roughness: 0.55 });
  const tiers: ReadonlyArray<readonly [number, number, number]> = [
    [1.1, 0.42, 0.21],
    [0.82, 0.36, 0.6],
    [0.56, 0.32, 0.94],
  ];
  for (const [radius, height, y] of tiers) {
    const tier = new Mesh(new CylinderGeometry(radius, radius * 1.04, height, 28), sponge);
    tier.position.y = y;
    cake.add(tier);
    const icing = new Mesh(new TorusGeometry(radius * 0.94, 0.07, 10, 26), frosting);
    icing.rotation.x = Math.PI / 2;
    icing.position.y = y + height / 2;
    cake.add(icing);
  }
  const cherry = new Mesh(
    new SphereGeometry(0.14, 14, 10),
    new MeshStandardMaterial({ color: 0xd95d72, roughness: 0.4 }),
  );
  cherry.position.y = 1.24;
  cake.add(cherry);
  return cake;
}

function fitOnPedestal(model: Object3D, targetSize: number): void {
  const bounds = new Box3().setFromObject(model);
  const size = bounds.getSize(new Vector3());
  const center = bounds.getCenter(new Vector3());
  const largest = Math.max(size.x, size.y, size.z, 0.001);
  model.position.sub(center);
  model.position.y += size.y / 2;
  model.scale.setScalar(targetSize / largest);
}

export function createCakeHeroShowcase(options: CakeHeroOptions): CakeHeroShowcase {
  let lease: Stage3dLease | null = null;
  let released: Stage3dLease | null = null;
  let turntable: Group | null = null;
  let source: CakeHeroShowcase["source"] = "loading";
  let paused = false;
  let disposed = false;
  let spin = 0;

  const populate = (activeLease: Stage3dLease): void => {
    activeLease.scene.background = new Color(0xffe9f0);
    turntable = new Group();
    turntable.name = "cake-hero-turntable";
    turntable.add(buildPedestal());
    activeLease.scene.add(turntable);
    activeLease.scene.add(new AmbientLight(0xfff4e4, 1.05));
    const key = new DirectionalLight(0xfffaf0, 2.2);
    key.position.set(2.6, 4.4, 3.4);
    activeLease.scene.add(key);
    const rim = new DirectionalLight(0xffd9e4, 0.9);
    rim.position.set(-3, 2.2, -2.6);
    activeLease.scene.add(rim);
  };

  const attachCake = (model: Object3D, from: "curated" | "procedural"): void => {
    if (disposed || !lease || lease.released || !turntable) {
      // The lease is gone (e.g. the GLB resolved after dispose): free the
      // orphaned tree instead of attaching it anywhere.
      const orphan = new ResourceTracker();
      orphan.trackTree(model);
      orphan.dispose();
      return;
    }
    fitOnPedestal(model, 2.35);
    model.position.y += 0.16;
    turntable.add(model);
    source = from;
    lease.renderOnce();
  };

  const loadCurated = (): void => {
    void new GLTFLoader()
      .loadAsync(new URL(CURATED_CAKE_PATH, document.baseURI).href)
      .then((gltf) => {
        gltf.scene.name = "curated:food.cake";
        attachCake(gltf.scene, "curated");
      })
      .catch(() => {
        attachCake(buildProceduralCake(), "procedural");
      });
  };

  const startLoop = (activeLease: Stage3dLease): void => {
    if (options.reducedMotion) {
      // Reduced motion: a still hero. One render per state change instead
      // of a turntable animation.
      activeLease.renderOnce();
      return;
    }
    activeLease.setLoop((dt) => {
      if (paused || !turntable) return;
      spin += dt * 0.6;
      turntable.rotation.y = spin;
    });
  };

  return {
    get active() {
      return lease !== null && !lease.released;
    },
    get source() {
      return source;
    },
    show(): void {
      if (disposed || (lease && !lease.released)) return;
      const width = Math.max(1, Math.floor(options.mount.clientWidth) || 300);
      const height = Math.max(1, Math.floor(options.mount.clientHeight) || 170);
      warmSharedPbrCaches(options.mount, options.clock);
      lease = acquireStage3d(options.mount, {
        clock: options.clock,
        camera: {
          kind: "portrait-fixed",
          position: { x: 0, y: 2.4, z: 5.4 },
          lookAt: { x: 0, y: 0.9, z: 0 },
          fov: 34,
        },
      });
      lease.resize({ width, height });
      populate(lease);
      loadCurated();
      lease.renderOnce();
      startLoop(lease);
    },
    setPaused(next: boolean): void {
      paused = next;
    },
    resourceDelta(): StageResourceBaseline | null {
      const reference = lease ?? released;
      if (!reference) return null;
      return diffStageResourceBaseline(reference.renderer, reference.baseline);
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      turntable = null;
      const held = lease;
      lease = null;
      released = held;
      held?.release();
    },
  };
}
