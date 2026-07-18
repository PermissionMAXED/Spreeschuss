/**
 * Stage3D — a managed lease over the existing shared rendering stack.
 *
 * `acquireStage3d(mount, { quality, clock })` hands a minigame a fresh scene
 * and portrait camera drawn by one cached, manager-owned `GameRenderer`
 * (creating WebGL contexts per round leaks them on iOS WebKit). Ownership is
 * cache-safe: leases can never dispose the shared renderer — releasing a
 * lease disposes only the lease's scene resources, restores the mount DOM,
 * detaches every listener, and returns the renderer to its resource baseline,
 * even when a loop callback or a disposal step throws, and regardless of
 * pause state. Adaptive quality is delegated to the existing
 * `RenderQualityRuntime`/`QUALITY_PRESETS` pipeline.
 */
import {
  Scene,
  Texture,
  type Object3D,
  type PerspectiveCamera,
  type WebGLRenderer,
} from "three";
import type { Clock } from "../../core/contracts/clock";
import { QUALITY_PRESETS, RenderQualityRuntime, type QualityTier } from "../quality";
import { GameRenderer, ResourceTracker } from "../renderer";
import {
  createStageCameraRig,
  createStagePortraitCamera,
  type StageCameraRig,
  type StageCameraRigSpec,
} from "./cameras";

export type StageFrameCallback = (dtSeconds: number) => void;

export interface StageViewportSize {
  readonly width: number;
  readonly height: number;
  readonly pixelRatio?: number;
}

export interface StageViewport {
  readonly width: number;
  readonly height: number;
  readonly pixelRatio: number;
}

export interface Stage3dOptions {
  /** Injected clock; loop deltas never read wall time directly. */
  readonly clock: Clock;
  /** Quality override; omit to keep the adaptive detected tier. */
  readonly quality?: QualityTier;
  /** Camera rig; defaults to the portrait fixed framing. */
  readonly camera?: StageCameraRigSpec;
}

export interface StageResourceBaseline {
  readonly geometries: number;
  readonly textures: number;
  readonly programs: number;
}

export interface Stage3dLease {
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
  readonly canvas: HTMLCanvasElement;
  /** Shared renderer for read-only inspection; the manager owns disposal. */
  readonly renderer: WebGLRenderer;
  /** Track lease-scoped resources not reachable from the scene graph. */
  readonly tracker: ResourceTracker;
  /** Renderer resource counts captured when the lease began. */
  readonly baseline: StageResourceBaseline;
  readonly released: boolean;
  readonly looping: boolean;
  setCameraRig(spec: StageCameraRigSpec): void;
  setChaseTarget(target: Object3D | null): void;
  /** Advances the camera rig without rendering (for external loops). */
  updateCamera(dtSeconds: number): void;
  /** Deterministic: explicit sizes always win over measured mount bounds. */
  resize(size?: StageViewportSize): StageViewport;
  renderOnce(): void;
  /** Starts/stops the internal clock-driven loop. `null` stops (pause). */
  setLoop(frame: StageFrameCallback | null): void;
  release(): void;
}

export interface Stage3dRendererHost {
  readonly renderer: WebGLRenderer;
  dispose(): void;
}

export type Stage3dRendererHostFactory = (canvas: HTMLCanvasElement) => Stage3dRendererHost;

export interface Stage3dManagerOptions {
  /** Test seam: swaps WebGL construction for fakes. Production uses GameRenderer. */
  readonly createHost?: Stage3dRendererHostFactory;
}

const MAX_LOOP_FRAME_SECONDS = 0.25;

function createDefaultHost(canvas: HTMLCanvasElement): Stage3dRendererHost {
  const game = new GameRenderer(canvas, "balanced");
  return {
    renderer: game.renderer,
    dispose: () => {
      game.dispose();
    },
  };
}

export function captureStageResourceBaseline(renderer: WebGLRenderer): StageResourceBaseline {
  return {
    geometries: renderer.info.memory.geometries,
    textures: renderer.info.memory.textures,
    programs: renderer.info.programs?.length ?? 0,
  };
}

export function diffStageResourceBaseline(
  renderer: WebGLRenderer,
  baseline: StageResourceBaseline,
): StageResourceBaseline {
  const current = captureStageResourceBaseline(renderer);
  return {
    geometries: current.geometries - baseline.geometries,
    textures: current.textures - baseline.textures,
    programs: current.programs - baseline.programs,
  };
}

interface CachedStageHost {
  readonly document: Document;
  readonly canvas: HTMLCanvasElement;
  readonly host: Stage3dRendererHost;
}

class ActiveStageLease implements Stage3dLease {
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;
  readonly tracker = new ResourceTracker();
  readonly baseline: StageResourceBaseline;
  private rig: StageCameraRig;
  private chaseTarget: Object3D | null = null;
  private loopCallback: StageFrameCallback | null = null;
  private rafHandle: number | null = null;
  private lastTickMs: number | null = null;
  private sized = false;
  private releasedFlag = false;
  private readonly view: (Window & typeof globalThis) | null;
  private readonly onViewResize: () => void;

  constructor(
    private readonly mount: HTMLElement,
    private readonly cached: CachedStageHost,
    private readonly options: Stage3dOptions,
    private readonly quality: RenderQualityRuntime,
    private readonly onReleased: () => void,
  ) {
    const rigSpec = options.camera ?? { kind: "portrait-fixed" as const };
    this.camera = createStagePortraitCamera(rigSpec);
    this.rig = createStageCameraRig(rigSpec);
    this.rig.snap(this.camera, null);
    this.view = mount.ownerDocument.defaultView;
    this.onViewResize = () => {
      if (!this.releasedFlag) this.resize();
    };
    mount.append(this.cached.canvas);
    this.quality.setOverride(options.quality ?? null);
    this.quality.connect(this.renderer, this.scene, this.camera);
    this.view?.addEventListener("resize", this.onViewResize);
    this.baseline = captureStageResourceBaseline(this.renderer);
    this.resize();
  }

  get renderer(): WebGLRenderer {
    return this.cached.host.renderer;
  }

  get canvas(): HTMLCanvasElement {
    return this.cached.canvas;
  }

  get released(): boolean {
    return this.releasedFlag;
  }

  get looping(): boolean {
    return this.loopCallback !== null;
  }

  setCameraRig(spec: StageCameraRigSpec): void {
    this.assertLive();
    this.rig = createStageCameraRig(spec);
    if (spec.fov !== undefined && spec.fov !== this.camera.fov) {
      this.camera.fov = spec.fov;
      this.camera.updateProjectionMatrix();
    }
    this.rig.snap(this.camera, this.chaseTarget);
  }

  setChaseTarget(target: Object3D | null): void {
    this.assertLive();
    this.chaseTarget = target;
  }

  updateCamera(dtSeconds: number): void {
    this.assertLive();
    this.rig.update(this.camera, this.chaseTarget, dtSeconds);
  }

  resize(size?: StageViewportSize): StageViewport {
    this.assertLive();
    const width = Math.max(1, Math.floor(size?.width ?? this.mount.clientWidth));
    const height = Math.max(1, Math.floor(size?.height ?? this.mount.clientHeight));
    const requestedRatio = size?.pixelRatio ?? this.view?.devicePixelRatio ?? 1;
    const cap = QUALITY_PRESETS[this.quality.active].pixelRatioCap;
    const pixelRatio = Math.min(2, cap, Math.max(0.5, requestedRatio));
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.sized = true;
    return { width, height, pixelRatio };
  }

  renderOnce(): void {
    this.assertLive();
    if (!this.sized) this.resize();
    this.renderer.render(this.scene, this.camera);
  }

  setLoop(frame: StageFrameCallback | null): void {
    this.assertLive();
    this.stopLoop();
    if (frame === null) return;
    const view = this.view;
    if (!view) {
      throw new Error("Stage3D loops require a window; call renderOnce from external drivers instead");
    }
    this.loopCallback = frame;
    this.lastTickMs = null;
    const tick = (): void => {
      this.rafHandle = null;
      if (this.releasedFlag || this.loopCallback !== frame) return;
      const nowMs = this.options.clock.now();
      const dtSeconds = this.lastTickMs === null
        ? 0
        : Math.min(MAX_LOOP_FRAME_SECONDS, Math.max(0, (nowMs - this.lastTickMs) / 1_000));
      this.lastTickMs = nowMs;
      try {
        frame(dtSeconds);
        this.rig.update(this.camera, this.chaseTarget, dtSeconds);
        this.renderOnce();
      } catch (error) {
        this.stopLoop();
        throw error;
      }
      if (!this.releasedFlag && this.loopCallback === frame) {
        this.rafHandle = view.requestAnimationFrame(tick);
      }
    };
    this.rafHandle = view.requestAnimationFrame(tick);
  }

  release(): void {
    if (this.releasedFlag) return;
    this.releasedFlag = true;
    const failures: unknown[] = [];
    const attempt = (step: () => void): void => {
      try {
        step();
      } catch (error) {
        failures.push(error);
      }
    };
    attempt(() => {
      this.stopLoop();
    });
    attempt(() => {
      this.disposeSceneResources();
    });
    attempt(() => {
      this.renderer.renderLists.dispose();
    });
    attempt(() => {
      this.view?.removeEventListener("resize", this.onViewResize);
    });
    attempt(() => {
      if (this.cached.canvas.parentElement === this.mount) this.cached.canvas.remove();
    });
    this.onReleased();
    if (failures.length > 0) {
      throw failures[0] instanceof Error
        ? failures[0]
        : new Error(`Stage3D release failed: ${String(failures[0])}`);
    }
  }

  private stopLoop(): void {
    this.loopCallback = null;
    this.lastTickMs = null;
    if (this.rafHandle !== null) {
      this.view?.cancelAnimationFrame(this.rafHandle);
      this.rafHandle = null;
    }
  }

  private disposeSceneResources(): void {
    if (this.scene.background instanceof Texture) this.tracker.track(this.scene.background);
    if (this.scene.environment instanceof Texture) this.tracker.track(this.scene.environment);
    this.scene.background = null;
    this.scene.environment = null;
    this.tracker.trackTree(this.scene);
    try {
      this.tracker.dispose();
    } finally {
      this.scene.clear();
    }
  }

  private assertLive(): void {
    if (this.releasedFlag) throw new Error("Stage3D lease was already released");
  }
}

export class Stage3dManager {
  private readonly createHost: Stage3dRendererHostFactory;
  private readonly quality = new RenderQualityRuntime();
  private cached: CachedStageHost | null = null;
  private activeLease: ActiveStageLease | null = null;
  private disposed = false;

  constructor(options: Stage3dManagerOptions = {}) {
    this.createHost = options.createHost ?? createDefaultHost;
  }

  get hasActiveLease(): boolean {
    return this.activeLease !== null;
  }

  /** The manager-owned renderer, if one has been created; tests inspect it. */
  get sharedRenderer(): WebGLRenderer | null {
    return this.cached?.host.renderer ?? null;
  }

  acquire(mount: HTMLElement, options: Stage3dOptions): Stage3dLease {
    if (this.disposed) throw new Error("Stage3D manager was disposed");
    if (this.activeLease) {
      throw new Error("Stage3D lease is already active; release it before acquiring another");
    }
    const document = mount.ownerDocument;
    if (this.cached && this.cached.document !== document) {
      this.disposeCachedHost();
    }
    if (!this.cached) {
      const canvas = document.createElement("canvas");
      canvas.style.display = "block";
      canvas.style.width = "100%";
      canvas.style.height = "100%";
      this.cached = { document, canvas, host: this.createHost(canvas) };
    }
    const lease = new ActiveStageLease(mount, this.cached, options, this.quality, () => {
      this.activeLease = null;
    });
    this.activeLease = lease;
    return lease;
  }

  /** Fully tears down the cached renderer; releases any active lease first. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const failures: unknown[] = [];
    if (this.activeLease) {
      try {
        this.activeLease.release();
      } catch (error) {
        failures.push(error);
      }
      this.activeLease = null;
    }
    try {
      this.disposeCachedHost();
    } catch (error) {
      failures.push(error);
    }
    if (failures.length > 0) {
      throw failures[0] instanceof Error
        ? failures[0]
        : new Error(`Stage3D manager dispose failed: ${String(failures[0])}`);
    }
  }

  private disposeCachedHost(): void {
    const cached = this.cached;
    this.cached = null;
    if (!cached) return;
    try {
      cached.host.dispose();
    } finally {
      cached.canvas.remove();
    }
  }
}

let defaultManager: Stage3dManager | null = null;

/**
 * Acquires the shared Stage3D lease from the module-default manager. The
 * manager (and its cached renderer) persists across leases by design; call
 * {@link disposeStage3dRuntime} to tear the cache down completely.
 */
export function acquireStage3d(mount: HTMLElement, options: Stage3dOptions): Stage3dLease {
  defaultManager ??= new Stage3dManager();
  return defaultManager.acquire(mount, options);
}

/** Disposes the default manager's cached renderer and clears the cache. */
export function disposeStage3dRuntime(): void {
  const manager = defaultManager;
  defaultManager = null;
  manager?.dispose();
}
