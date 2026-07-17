import { Group, Mesh } from "three";
import { describe, expect, it } from "vitest";
import { ASSET_KEYS } from "../../core/contracts/assets";
import { ASSET_MANIFEST } from "../../data/assetManifest";
import {
  FallbackAssetLoader,
  PROCEDURAL_AUDIO_RECIPES,
  createProceduralAsset,
} from ".";

function meshCount(root: Group): number {
  let count = 0;
  root.traverse((object) => {
    if (object instanceof Mesh) count += 1;
  });
  return count;
}

describe("offline procedural asset library", () => {
  it("constructs a named warm-toy-box fallback for every frozen AssetKey", () => {
    for (const key of ASSET_KEYS) {
      const asset = createProceduralAsset(key);
      expect(asset).toBeInstanceOf(Group);
      expect(asset.name).toBe(`procedural:${key}`);
      expect(asset.userData).toMatchObject({
        assetKey: key,
        procedural: true,
        style: `warm-toy-box/${key.split(".")[0]}`,
      });
      if (!key.startsWith("audio.")) expect(meshCount(asset as Group)).toBeGreaterThan(0);
    }
  });

  it("uses recognizable multi-part silhouettes instead of generic placeholder cubes", () => {
    const minimumParts = {
      "gooby.body": 15,
      "food.carrot": 6,
      "food.apple": 4,
      "food.pancake": 7,
      "furniture.sofa": 10,
      "furniture.armchair": 8,
      "furniture.bookshelf": 20,
      "furniture.bed": 10,
      "furniture.bathtub": 8,
      "furniture.kitchen-counter": 10,
      "city.road": 10,
      "city.tree": 8,
      "city.car": 17,
      "building.carrot-market": 20,
      "building.cloud-boutique": 20,
      "building.fluff-salon": 20,
    } as const;
    for (const [key, minimum] of Object.entries(minimumParts)) {
      expect(meshCount(createProceduralAsset(key as keyof typeof minimumParts) as Group), key).toBeGreaterThanOrEqual(minimum);
    }
  });

  it("publishes complete synthesized-audio hooks for forced fallback playback", () => {
    type AudioKey = keyof typeof PROCEDURAL_AUDIO_RECIPES;
    const audioKeys = ASSET_KEYS.filter(
      (key): key is AudioKey => Object.prototype.hasOwnProperty.call(PROCEDURAL_AUDIO_RECIPES, key),
    );
    expect(Object.keys(PROCEDURAL_AUDIO_RECIPES)).toEqual(audioKeys);
    for (const key of audioKeys) {
      const hook = createProceduralAsset(key);
      expect(hook.userData.audioFallbackHook).toBe(true);
      expect(hook.userData.audioRecipe).toEqual(PROCEDURAL_AUDIO_RECIPES[key]);
    }
  });

  it("maps every key to a local vendored candidate and/or a procedural fallback", () => {
    expect(Object.keys(ASSET_MANIFEST)).toEqual([...ASSET_KEYS]);
    for (const key of ASSET_KEYS) {
      const entry = ASSET_MANIFEST[key];
      expect(entry.fallback.length).toBeGreaterThan(0);
      for (const candidate of entry.vendored) {
        expect(candidate.path).toMatch(/^assets\/vendor\//u);
        expect(candidate.path).not.toMatch(/https?:\/\//u);
        expect(candidate.path).not.toMatch(/\.ogg$/u);
      }
    }
  });

  it("falls back totally when vendored loading is disabled or corrupt", async () => {
    const disabled = new FallbackAssetLoader(() => Promise.resolve(null));
    const disabledResult = await disabled.preload(ASSET_KEYS);
    expect(disabledResult).toHaveLength(ASSET_KEYS.length);
    expect(disabledResult.every(({ source }) => source === "procedural")).toBe(true);

    const corrupt = new FallbackAssetLoader(() => Promise.reject(new Error("forced corrupt vendored asset")));
    const corruptResult = await corrupt.load("city.car");
    expect(corruptResult.source).toBe("procedural");
    expect(corruptResult.warning).toBe("forced corrupt vendored asset");
    expect(corruptResult.value).toBeInstanceOf(Group);
  });
});
