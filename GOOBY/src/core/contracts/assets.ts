import type { Object3D, Texture } from "three";

export const ASSET_KEYS = [
  "gooby.body",
  "gooby.eye",
  "food.carrot",
  "food.apple",
  "food.pancake",
  "furniture.sofa",
  "furniture.armchair",
  "furniture.coffee-table",
  "furniture.rug",
  "furniture.lamp",
  "furniture.bookshelf",
  "furniture.bed",
  "furniture.bathtub",
  "furniture.kitchen-counter",
  "city.road",
  "city.tree",
  "city.lamp",
  "city.car",
  "building.carrot-market",
  "building.cloud-boutique",
  "building.fluff-salon",
  "icon.heart",
  "icon.carrot",
  "icon.coin",
  "icon.sleep",
  "particle.heart",
  "particle.sparkle",
  "particle.bubble",
  "audio.happy",
  "audio.munch",
  "audio.sleep",
  "audio.wake",
  "audio.tap",
] as const;

export type AssetKey = (typeof ASSET_KEYS)[number];
export type AssetValue = Object3D | Texture | AudioBuffer;
export type AssetSource = "vendored" | "procedural";

export interface LoadedAsset<T extends AssetValue = AssetValue> {
  readonly key: AssetKey;
  readonly value: T;
  readonly source: AssetSource;
  readonly warning?: string;
}

/**
 * Loading is total: missing/corrupt vendored files resolve to a procedural asset
 * rather than rejecting. A fallback warning remains observable for audits.
 */
export interface AssetLoader {
  load<T extends AssetValue = AssetValue>(key: AssetKey): Promise<LoadedAsset<T>>;
  preload(keys: readonly AssetKey[]): Promise<readonly LoadedAsset[]>;
  dispose(): void;
}
