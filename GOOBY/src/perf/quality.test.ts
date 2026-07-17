import { PerspectiveCamera, Scene, type WebGLRenderer } from "three";
import { describe, expect, it, vi } from "vitest";
import {
  QUALITY_PRESETS,
  RenderQualityRuntime,
  detectQualityTier,
  type DeviceQualityProfile,
} from "../render/quality";

const base: DeviceQualityProfile = {
  gpu: "Apple GPU",
  memoryGb: 4,
  logicalCores: 6,
  screenPixels: 3_000_000,
  devicePixelRatio: 3,
  mobile: true,
};

describe("detectQualityTier", () => {
  it("selects low for constrained legacy devices", () => {
    expect(detectQualityTier({
      ...base,
      gpu: "Apple A10 GPU",
      memoryGb: 2,
      logicalCores: 2,
      screenPixels: 5_200_000,
    })).toBe("low");
  });

  it("selects mid for an iPhone with privacy-limited GPU and memory data", () => {
    expect(detectQualityTier({
      ...base,
      memoryGb: null,
      gpu: "Apple GPU",
    })).toBe("mid");
  });

  it("selects high for a modern high-end GPU with sufficient memory and cores", () => {
    expect(detectQualityTier({
      ...base,
      gpu: "Apple A17 GPU",
      memoryGb: 8,
      logicalCores: 8,
      screenPixels: 2_800_000,
    })).toBe("high");
  });

  it("caps every preset at a 2x pixel ratio", () => {
    expect(Object.values(QUALITY_PRESETS).every(({ pixelRatioCap }) => pixelRatioCap <= 2)).toBe(true);
  });

  it("applies renderer quality without injecting fog into fog-free scenes", () => {
    const setPixelRatio = vi.fn();
    const renderer = {
      getContext: () => {
        throw new Error("GPU details are unavailable in this test");
      },
      setPixelRatio,
      shadowMap: { enabled: false },
    } as unknown as WebGLRenderer;
    const scene = new Scene();
    const camera = new PerspectiveCamera(36, 1, 0.1, 500);
    const quality = new RenderQualityRuntime();

    quality.connect(renderer, scene, camera);

    expect(setPixelRatio).toHaveBeenCalled();
    expect(camera.far).toBe(QUALITY_PRESETS[quality.active].drawDistance);
    expect(scene.fog).toBeNull();
    expect(scene.userData.goobyQualityTier).toBe(quality.active);
  });
});
