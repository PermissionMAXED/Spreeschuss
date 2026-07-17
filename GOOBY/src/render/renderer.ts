import {
  ACESFilmicToneMapping,
  Color,
  Object3D,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Texture,
  WebGLRenderer,
} from "three";
import type { Material } from "three";

export type RenderQuality = "battery" | "balanced" | "high";

const PIXEL_RATIO_CAP: Readonly<Record<RenderQuality, number>> = {
  battery: 1,
  balanced: 1.5,
  high: 2,
};

export class ResourceTracker {
  private readonly resources = new Set<unknown>();

  track<T>(resource: T): T {
    this.resources.add(resource);
    return resource;
  }

  trackTree(root: Object3D): Object3D {
    root.traverse((object) => {
      const renderable = object as Object3D & {
        geometry?: { dispose(): void };
        material?: Material | Material[];
      };
      if (renderable.geometry) this.track(renderable.geometry);
      if (renderable.material) {
        const materials = Array.isArray(renderable.material) ? renderable.material : [renderable.material];
        for (const material of materials) {
          this.track(material);
          for (const value of Object.values(material)) {
            if (value instanceof Texture) this.track(value);
          }
        }
      }
    });
    this.track(root);
    return root;
  }

  dispose(): void {
    for (const resource of [...this.resources].reverse()) {
      if (resource instanceof Object3D) resource.removeFromParent();
      const disposable = resource as { dispose?: () => void };
      disposable.dispose?.();
    }
    this.resources.clear();
  }
}

export class GameRenderer {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(36, 9 / 16, 0.1, 120);
  private quality: RenderQuality;

  constructor(canvas: HTMLCanvasElement, quality: RenderQuality = "balanced") {
    this.quality = quality;
    this.renderer = new WebGLRenderer({
      canvas,
      alpha: false,
      antialias: quality !== "battery",
      powerPreference: quality === "high" ? "high-performance" : "default",
    });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = quality !== "battery";
    this.scene.background = new Color(0xf9d6ae);
  }

  setQuality(quality: RenderQuality): void {
    this.quality = quality;
    this.renderer.shadowMap.enabled = quality !== "battery";
    this.resize();
  }

  resize(): void {
    const canvas = this.renderer.domElement;
    const width = Math.max(1, canvas.clientWidth);
    const height = Math.max(1, canvas.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, PIXEL_RATIO_CAP[this.quality]));
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
