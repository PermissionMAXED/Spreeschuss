import type { Material, WebGLRenderer } from "three";
import {
  QUALITY_PRESETS,
  RenderQualityRuntime,
  countSceneMaterials,
  type QualityPreset,
  type QualityTier,
  type RenderQualitySnapshot,
} from "../render/quality";
import type { GameRenderer, RenderQuality } from "../render/renderer";
import { AdaptiveQualityGovernor } from "./governor";
import {
  diffResources,
  hasLikelyResourceLeak,
  percentile,
  type ResourceDiff,
  type ResourceMetrics,
} from "./math";

const WINDOW_SIZE = 300;
const RESOURCE_SAMPLE_MS = 1_000;

class RollingMetric {
  private readonly values = new Float64Array(WINDOW_SIZE);
  private readonly scratch = new Float64Array(WINDOW_SIZE);
  private cursor = 0;
  private countValue = 0;
  private sum = 0;

  get count(): number {
    return this.countValue;
  }

  push(value: number): void {
    if (this.countValue === WINDOW_SIZE) this.sum -= this.values[this.cursor] ?? 0;
    else this.countValue += 1;
    this.values[this.cursor] = value;
    this.sum += value;
    this.cursor = (this.cursor + 1) % WINDOW_SIZE;
  }

  average(): number {
    return this.countValue === 0 ? 0 : this.sum / this.countValue;
  }

  p95(): number {
    return percentile(this.values, this.countValue, 0.95, this.scratch);
  }

  reset(): void {
    this.cursor = 0;
    this.countValue = 0;
    this.sum = 0;
  }
}

interface PerformanceWithMemory extends Performance {
  readonly memory?: {
    readonly usedJSHeapSize: number;
  };
}

export interface RollingFrameSnapshot {
  readonly fps: number;
  readonly averageMs: number;
  readonly p95Ms: number;
  readonly samples: number;
}

export interface RenderMetricsSnapshot {
  readonly drawCalls: number;
  readonly drawCallsP95: number;
  readonly triangles: number;
  readonly trianglesP95: number;
}

export interface ResourceMetricsSnapshot {
  readonly current: ResourceMetrics;
  readonly baseline: ResourceMetrics | null;
  readonly diff: ResourceDiff | null;
  readonly completedTransitions: number;
  readonly likelyLeak: boolean;
}

export interface PerformanceSnapshot {
  readonly averageFrameMs: number;
  readonly p95FrameMs: number;
  readonly sampleCount: number;
  readonly recommendedQuality: RenderQuality;
  readonly frame: RollingFrameSnapshot;
  readonly render: RenderMetricsSnapshot;
  readonly resources: ResourceMetricsSnapshot;
  readonly quality: RenderQualitySnapshot & {
    readonly qualityTransitions: number;
    readonly appliedPixelRatio: number | null;
    readonly shadowsEnabled: boolean | null;
    readonly cameraFar: number | null;
  };
}

export interface DevPerfControls {
  setQuality(tier: QualityTier | "auto"): void;
  showOverlay(visible: boolean): void;
  markResourceBaseline(): ResourceMetrics;
  markTransition(): void;
  resetRollingMetrics(): void;
  simulateGovernor(start: QualityTier, fps: number, durationMs: number): QualityTier;
}

export interface PerfDebugApi {
  readonly version: 1;
  snapshot(): PerformanceSnapshot;
  controls?: DevPerfControls;
}

interface DebugRoot {
  perf?: PerfDebugApi;
}

interface MutableResourceMetrics {
  geometries: number;
  textures: number;
  programs: number;
  materials: number;
  heapBytes: number | null;
}

function emptyResources(): MutableResourceMetrics {
  return {
    geometries: 0,
    textures: 0,
    programs: 0,
    materials: 0,
    heapBytes: null,
  };
}

function cloneResources(resources: ResourceMetrics): ResourceMetrics {
  return {
    geometries: resources.geometries,
    textures: resources.textures,
    programs: resources.programs,
    materials: resources.materials,
    heapBytes: resources.heapBytes,
  };
}

function legacyQuality(tier: QualityTier): RenderQuality {
  if (tier === "low") return "battery";
  if (tier === "high") return "high";
  return "balanced";
}

export class PerformanceProbe {
  private readonly frames = new RollingMetric();
  private readonly drawCalls = new RollingMetric();
  private readonly triangles = new RollingMetric();
  private readonly governor = new AdaptiveQualityGovernor();
  private readonly quality = new RenderQualityRuntime();
  private readonly materials = new Set<Material>();
  private readonly qualityListeners = new Set<
    (preset: QualityPreset, tier: QualityTier) => void
  >();
  private readonly currentResources = emptyResources();
  private readonly debugApi: PerfDebugApi;
  private qualityTarget: GameRenderer | null = null;
  private resourceBaseline: ResourceMetrics | null = null;
  private resourceTransitions = 0;
  private qualityTransitions = 0;
  private bucketElapsedMs = 0;
  private bucketFrames = 0;
  private resourceElapsedMs = 0;
  private logicalNow = typeof performance === "undefined" ? 0 : performance.now();
  private previousSampleAt: number | null = null;

  constructor() {
    this.quality.setListener(this.onQualityChanged);
    this.debugApi = { version: 1, snapshot: () => this.snapshot() };
    if (import.meta.env.DEV) {
      void import("./dev").then(({ installDevPerformanceTools }) => {
        installDevPerformanceTools(this.debugApi, {
          snapshot: () => this.snapshot(),
          setQuality: (tier) => {
            this.quality.setOverride(tier === "auto" ? null : tier);
            this.governor.reset(this.logicalNow);
          },
          markResourceBaseline: () => {
            this.captureResources();
            this.resourceBaseline = cloneResources(this.currentResources);
            this.resourceTransitions = 0;
            return cloneResources(this.resourceBaseline);
          },
          markTransition: () => this.markTransition(),
          resetRollingMetrics: () => {
            this.frames.reset();
            this.drawCalls.reset();
            this.triangles.reset();
          },
          simulateGovernor: (start, fps, durationMs) => {
            this.quality.setDetectedTierForTest(start);
            this.governor.reset();
            let remaining = Math.max(0, durationMs);
            while (remaining > 0) {
              const elapsed = Math.min(1_000, remaining);
              this.logicalNow += elapsed;
              const next = this.governor.update(
                fps,
                elapsed,
                this.logicalNow,
                this.quality.active,
                this.quality.detected,
                null,
              );
              if (next) this.quality.setAutomaticTier(next);
              remaining -= elapsed;
            }
            return this.quality.active;
          },
        });
      });
    }
  }

  connectRenderer(renderer: GameRenderer): void {
    this.qualityTarget = renderer;
    this.quality.connect(renderer.renderer, renderer.scene, renderer.camera);
    renderer.setQuality(legacyQuality(this.quality.active));
  }

  onQualityChange(listener: (preset: QualityPreset, tier: QualityTier) => void): () => void {
    this.qualityListeners.add(listener);
    listener(QUALITY_PRESETS[this.quality.active], this.quality.active);
    return () => {
      this.qualityListeners.delete(listener);
    };
  }

  markTransition(): void {
    this.resourceTransitions += 1;
  }

  sample(frameMs: number): void {
    if (!Number.isFinite(frameMs) || frameMs <= 0) return;
    if (typeof document !== "undefined" && document.visibilityState === "hidden") {
      this.bucketElapsedMs = 0;
      this.bucketFrames = 0;
      return;
    }
    let observedFrameMs = frameMs;
    if (typeof performance !== "undefined") {
      const sampleAt = performance.now();
      if (this.previousSampleAt !== null) {
        observedFrameMs = Math.max(frameMs, sampleAt - this.previousSampleAt);
      }
      this.previousSampleAt = sampleAt;
    }
    const safeFrameMs = Math.min(250, observedFrameMs);
    this.logicalNow += safeFrameMs;
    this.frames.push(safeFrameMs);
    this.bucketElapsedMs += safeFrameMs;
    this.bucketFrames += 1;
    this.resourceElapsedMs += safeFrameMs;

    const renderer = this.quality.getRenderer();
    if (renderer) this.sampleRenderer(renderer);
    if (this.bucketElapsedMs >= 1_000) this.evaluateGovernor();
    if (this.resourceElapsedMs >= RESOURCE_SAMPLE_MS) {
      this.resourceElapsedMs %= RESOURCE_SAMPLE_MS;
      this.captureResources();
    }
    this.attachDebugSurface();
  }

  snapshot(): PerformanceSnapshot {
    const averageFrameMs = this.frames.average();
    const p95FrameMs = this.frames.p95();
    const baseline = this.resourceBaseline ? cloneResources(this.resourceBaseline) : null;
    const current = cloneResources(this.currentResources);
    const diff = baseline ? diffResources(baseline, current) : null;
    const quality = this.quality.snapshot();
    return {
      averageFrameMs,
      p95FrameMs,
      sampleCount: this.frames.count,
      recommendedQuality: legacyQuality(quality.active),
      frame: {
        fps: averageFrameMs > 0 ? 1_000 / averageFrameMs : 0,
        averageMs: averageFrameMs,
        p95Ms: p95FrameMs,
        samples: this.frames.count,
      },
      render: {
        drawCalls: this.drawCalls.average(),
        drawCallsP95: this.drawCalls.p95(),
        triangles: this.triangles.average(),
        trianglesP95: this.triangles.p95(),
      },
      resources: {
        current,
        baseline,
        diff,
        completedTransitions: this.resourceTransitions,
        likelyLeak: diff ? hasLikelyResourceLeak(diff, this.resourceTransitions) : false,
      },
      quality: {
        ...quality,
        qualityTransitions: this.qualityTransitions,
        appliedPixelRatio: this.qualityTarget?.renderer.getPixelRatio() ?? null,
        shadowsEnabled: this.qualityTarget?.renderer.shadowMap.enabled ?? null,
        cameraFar: this.qualityTarget?.camera.far ?? null,
      },
    };
  }

  dispose(): void {
    this.qualityListeners.clear();
    this.qualityTarget = null;
  }

  private sampleRenderer(renderer: WebGLRenderer): void {
    this.drawCalls.push(renderer.info.render.calls);
    this.triangles.push(renderer.info.render.triangles);
  }

  private evaluateGovernor(): void {
    const elapsed = this.bucketElapsedMs;
    const fps = this.bucketFrames * 1_000 / elapsed;
    this.bucketElapsedMs = 0;
    this.bucketFrames = 0;
    const next = this.governor.update(
      fps,
      elapsed,
      this.logicalNow,
      this.quality.active,
      this.quality.detected,
      this.quality.override,
    );
    if (next) this.quality.setAutomaticTier(next);
  }

  private captureResources(): void {
    const renderer = this.quality.getRenderer();
    const scene = this.quality.getScene();
    if (!renderer || !scene) return;
    this.currentResources.geometries = renderer.info.memory.geometries;
    this.currentResources.textures = renderer.info.memory.textures;
    this.currentResources.programs = renderer.info.programs?.length ?? 0;
    this.currentResources.materials = countSceneMaterials(scene, this.materials);
    const memory = (performance as PerformanceWithMemory).memory;
    this.currentResources.heapBytes = memory && Number.isFinite(memory.usedJSHeapSize)
      ? memory.usedJSHeapSize
      : null;
    this.resourceBaseline ??= cloneResources(this.currentResources);
  }

  private readonly onQualityChanged = (tier: QualityTier, previous: QualityTier): void => {
    this.qualityTransitions += 1;
    const preset = QUALITY_PRESETS[tier];
    this.qualityTarget?.setQuality(legacyQuality(tier));
    for (const listener of this.qualityListeners) listener(preset, tier);
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("gooby:qualitychange", {
        detail: { tier, previous, preset },
      }));
    }
  };

  private attachDebugSurface(): void {
    if (typeof window === "undefined") return;
    const candidate = (window as Window & { __gooby?: DebugRoot }).__gooby;
    if (!candidate || candidate.perf === this.debugApi || !Object.isExtensible(candidate)) return;
    Object.defineProperty(candidate, "perf", {
      configurable: false,
      enumerable: true,
      writable: false,
      value: this.debugApi,
    });
  }
}

export { AdaptiveQualityGovernor } from "./governor";
export { diffResources, hasLikelyResourceLeak, percentile } from "./math";
