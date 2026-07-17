import {
  Color,
  Fog,
  Material,
  PerspectiveCamera,
  type Camera,
  type Object3D,
  type Scene,
  type WebGLRenderer,
} from "three";

export type QualityTier = "low" | "mid" | "high";

export interface QualityPreset {
  readonly pixelRatioCap: number;
  readonly shadows: boolean;
  readonly particleDensity: number;
  readonly fogNear: number;
  readonly fogFar: number;
  readonly drawDistance: number;
}

export const QUALITY_PRESETS: Readonly<Record<QualityTier, QualityPreset>> = Object.freeze({
  low: Object.freeze({
    pixelRatioCap: 1,
    shadows: false,
    particleDensity: 0.4,
    fogNear: 38,
    fogFar: 72,
    drawDistance: 76,
  }),
  mid: Object.freeze({
    pixelRatioCap: 1.5,
    shadows: true,
    particleDensity: 0.7,
    fogNear: 64,
    fogFar: 104,
    drawDistance: 110,
  }),
  high: Object.freeze({
    pixelRatioCap: 2,
    shadows: true,
    particleDensity: 1,
    fogNear: 92,
    fogFar: 120,
    drawDistance: 120,
  }),
});

export interface DeviceQualityProfile {
  readonly gpu: string;
  readonly memoryGb: number | null;
  readonly logicalCores: number;
  readonly screenPixels: number;
  readonly devicePixelRatio: number;
  readonly mobile: boolean;
}

interface NavigatorWithMemory extends Navigator {
  readonly deviceMemory?: number;
}

interface DebugRendererInfo {
  readonly UNMASKED_RENDERER_WEBGL: number;
}

const LOW_GPU = /swiftshader|llvmpipe|software|powervr\s+sgx|mali-(?:4|t6|t7|g31|g51)|adreno\s+(?:[1-4]\d\d|5[0-2]\d)|apple\s+a(?:7|8|9|10|11)\b/iu;
const HIGH_GPU = /apple\s+(?:a1[5-9]|m[1-9])\b|adreno\s+7\d\d|mali-g(?:7[1-9]|[89]\d)|immortalis/iu;

function finiteOr(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

export function detectQualityTier(profile: DeviceQualityProfile): QualityTier {
  let score = 0;
  if (profile.memoryGb !== null) {
    if (profile.memoryGb <= 2) score -= 2;
    else if (profile.memoryGb <= 4) score -= 0.75;
    else if (profile.memoryGb >= 8) score += 1;
  }
  if (profile.logicalCores <= 2) score -= 2;
  else if (profile.logicalCores <= 4) score -= 0.75;
  else if (profile.logicalCores >= 8) score += 1;

  if (profile.screenPixels >= 5_000_000) score -= 1;
  else if (profile.screenPixels >= 3_500_000) score -= 0.5;

  if (LOW_GPU.test(profile.gpu)) score -= 2.5;
  else if (HIGH_GPU.test(profile.gpu)) score += 2;

  if (profile.mobile && profile.devicePixelRatio >= 3.5) score -= 0.5;
  if (score <= -1.5) return "low";
  if (score >= 2) return "high";
  return "mid";
}

export function readDeviceQualityProfile(gpu = "unknown"): DeviceQualityProfile {
  if (typeof navigator === "undefined" || typeof screen === "undefined") {
    return {
      gpu,
      memoryGb: null,
      logicalCores: 4,
      screenPixels: 1_000_000,
      devicePixelRatio: 1,
      mobile: false,
    };
  }
  const memory = (navigator as NavigatorWithMemory).deviceMemory;
  const ratio = typeof window === "undefined" ? 1 : finiteOr(window.devicePixelRatio, 1);
  const width = finiteOr(screen.width, 390);
  const height = finiteOr(screen.height, 844);
  return {
    gpu,
    memoryGb: typeof memory === "number" && Number.isFinite(memory) ? memory : null,
    logicalCores: Math.max(1, Math.floor(finiteOr(navigator.hardwareConcurrency, 4))),
    screenPixels: Math.round(width * height * ratio * ratio),
    devicePixelRatio: ratio,
    mobile: /android|iphone|ipad|ipod|mobile/iu.test(navigator.userAgent),
  };
}

function readGpuName(renderer: WebGLRenderer): string {
  try {
    const context = renderer.getContext();
    const extension = context.getExtension("WEBGL_debug_renderer_info") as DebugRendererInfo | null;
    const value: unknown = extension
      ? context.getParameter(extension.UNMASKED_RENDERER_WEBGL)
      : context.getParameter(context.RENDERER);
    return typeof value === "string" && value.trim() ? value.trim() : "unknown";
  } catch {
    return "unknown";
  }
}

export interface RenderQualitySnapshot {
  readonly detected: QualityTier;
  readonly active: QualityTier;
  readonly override: QualityTier | null;
  readonly preset: QualityPreset;
  readonly profile: DeviceQualityProfile;
}

type QualityListener = (tier: QualityTier, previous: QualityTier) => void;

export class RenderQualityRuntime {
  private renderer: WebGLRenderer | null = null;
  private scene: Scene | null = null;
  private camera: Camera | null = null;
  private profileValue = readDeviceQualityProfile();
  private detectedValue = detectQualityTier(this.profileValue);
  private activeValue = this.detectedValue;
  private overrideValue: QualityTier | null = null;
  private listener: QualityListener | null = null;
  private rendererProfileRead = false;

  get active(): QualityTier {
    return this.activeValue;
  }

  get detected(): QualityTier {
    return this.detectedValue;
  }

  get override(): QualityTier | null {
    return this.overrideValue;
  }

  get profile(): DeviceQualityProfile {
    return this.profileValue;
  }

  setListener(listener: QualityListener): void {
    this.listener = listener;
  }

  setOverride(tier: QualityTier | null): void {
    this.overrideValue = tier;
    this.setActive(tier ?? this.detectedValue);
  }

  setAutomaticTier(tier: QualityTier): void {
    if (this.overrideValue === null) this.setActive(tier);
  }

  setDetectedTierForTest(tier: QualityTier): void {
    this.detectedValue = tier;
    this.overrideValue = null;
    this.setActive(tier);
  }

  snapshot(): RenderQualitySnapshot {
    return {
      detected: this.detectedValue,
      active: this.activeValue,
      override: this.overrideValue,
      preset: QUALITY_PRESETS[this.activeValue],
      profile: this.profileValue,
    };
  }

  connect(renderer: WebGLRenderer, scene: Object3D, camera: Camera): void {
    let changed = false;
    if (this.renderer !== renderer) {
      this.renderer = renderer;
      this.rendererProfileRead = false;
      changed = true;
    }
    if (scene.type === "Scene" && this.scene !== scene) {
      this.scene = scene as Scene;
      changed = true;
    }
    if (this.camera !== camera) {
      this.camera = camera;
      changed = true;
    }
    if (!this.rendererProfileRead) {
      this.rendererProfileRead = true;
      this.profileValue = readDeviceQualityProfile(readGpuName(renderer));
      this.detectedValue = detectQualityTier(this.profileValue);
      if (this.overrideValue === null) this.setActive(this.detectedValue);
    }
    if (changed) this.apply();
    else this.applyScene();
  }

  getRenderer(): WebGLRenderer | null {
    return this.renderer;
  }

  getScene(): Scene | null {
    return this.scene;
  }

  private setActive(tier: QualityTier): void {
    const previous = this.activeValue;
    this.activeValue = tier;
    this.apply();
    if (tier !== previous) this.listener?.(tier, previous);
  }

  private apply(): void {
    const preset = QUALITY_PRESETS[this.activeValue];
    const renderer = this.renderer;
    if (renderer) {
      const ratio = typeof window === "undefined" ? 1 : finiteOr(window.devicePixelRatio, 1);
      renderer.setPixelRatio(Math.min(2, preset.pixelRatioCap, ratio));
      renderer.shadowMap.enabled = preset.shadows;
    }
    if (this.camera instanceof PerspectiveCamera) {
      if (this.camera.far !== preset.drawDistance) {
        this.camera.far = preset.drawDistance;
        this.camera.updateProjectionMatrix();
      }
    }
    this.applyScene();
    if (typeof document !== "undefined") {
      document.documentElement.dataset.quality = this.activeValue;
      document.documentElement.style.setProperty("--gooby-particle-density", String(preset.particleDensity));
    }
  }

  private applyScene(): void {
    if (!this.scene) return;
    const preset = QUALITY_PRESETS[this.activeValue];
    const fog = this.scene.fog;
    if (fog instanceof Fog) {
      const background = this.scene.background;
      if (background instanceof Color) fog.color.copy(background);
      fog.near = preset.fogNear;
      fog.far = preset.fogFar;
    }
    this.scene.userData.goobyQualityTier = this.activeValue;
    this.scene.userData.goobyParticleDensity = preset.particleDensity;
  }
}

export function countSceneMaterials(scene: Object3D, target: Set<Material>): number {
  target.clear();
  scene.traverse((object) => {
    const candidate = object as Object3D & { readonly material?: Material | Material[] };
    const material = candidate.material;
    if (Array.isArray(material)) {
      for (const entry of material) target.add(entry);
    } else if (material instanceof Material) {
      target.add(material);
    }
  });
  return target.size;
}
