import type { AssetKey } from "../core/contracts/assets";

export type VendoredAssetRole = "primary";

export interface VendoredAssetReference {
  readonly path: `assets/vendor/${string}`;
  readonly role: VendoredAssetRole;
}

export interface RuntimeAssetManifestEntry {
  readonly fallback: string;
  readonly vendored: readonly VendoredAssetReference[];
}

export interface AssetCredit {
  readonly packId: string;
  readonly title: string;
  readonly creator: "Kenney";
  readonly license: "Creative Commons Zero (CC0)";
  readonly source: string;
}

const file = (
  path: VendoredAssetReference["path"],
  role: VendoredAssetRole = "primary",
): VendoredAssetReference => ({ path, role });

export const ASSET_MANIFEST = {
  "gooby.body": { fallback: "gooby-body", vendored: [] },
  "gooby.eye": { fallback: "gooby-eye", vendored: [] },
  "food.carrot": { fallback: "carrot", vendored: [] },
  "food.apple": { fallback: "apple", vendored: [] },
  "food.pancake": { fallback: "pancake", vendored: [] },
  "furniture.sofa": { fallback: "sofa", vendored: [] },
  "furniture.armchair": { fallback: "armchair", vendored: [] },
  "furniture.coffee-table": { fallback: "coffee-table", vendored: [] },
  "furniture.rug": { fallback: "rug", vendored: [] },
  "furniture.lamp": { fallback: "floor-lamp", vendored: [] },
  "furniture.bookshelf": { fallback: "bookshelf", vendored: [] },
  "furniture.bed": { fallback: "bed", vendored: [] },
  "furniture.bathtub": { fallback: "bathtub", vendored: [] },
  "furniture.kitchen-counter": { fallback: "kitchen-counter", vendored: [] },
  "city.road": { fallback: "toy-road", vendored: [] },
  "city.tree": { fallback: "flowering-tree", vendored: [] },
  "city.lamp": { fallback: "street-lamp", vendored: [] },
  "city.car": {
    fallback: "gooby-car",
    vendored: [file("assets/vendor/car-kit/gooby-car.glb")],
  },
  "building.carrot-market": {
    fallback: "carrot-market",
    vendored: [file("assets/vendor/city-kit-commercial/carrot-market.glb")],
  },
  "building.cloud-boutique": {
    fallback: "cloud-boutique",
    vendored: [file("assets/vendor/city-kit-suburban/cloud-boutique.glb")],
  },
  "building.fluff-salon": {
    fallback: "fluff-salon",
    vendored: [file("assets/vendor/city-kit-commercial/fluff-salon.glb")],
  },
  "icon.heart": { fallback: "heart-icon", vendored: [] },
  "icon.carrot": { fallback: "carrot-icon", vendored: [] },
  "icon.coin": { fallback: "coin-icon", vendored: [] },
  "icon.sleep": { fallback: "sleep-icon", vendored: [] },
  "particle.heart": { fallback: "heart-particle", vendored: [] },
  "particle.sparkle": { fallback: "sparkle-particle", vendored: [] },
  "particle.bubble": { fallback: "bubble-particle", vendored: [] },
  "audio.happy": { fallback: "happy-chime", vendored: [] },
  "audio.munch": { fallback: "munch-crunch", vendored: [] },
  "audio.sleep": { fallback: "sleep-chime", vendored: [] },
  "audio.wake": { fallback: "wake-chime", vendored: [] },
  "audio.tap": { fallback: "tap-pop", vendored: [] },
} as const satisfies Readonly<Record<AssetKey, RuntimeAssetManifestEntry>>;

export const ASSET_CREDITS = [
  {
    packId: "city-kit-commercial",
    title: "City Kit (Commercial)",
    creator: "Kenney",
    license: "Creative Commons Zero (CC0)",
    source: "kenney.nl/assets/city-kit-commercial",
  },
  {
    packId: "city-kit-suburban",
    title: "City Kit (Suburban)",
    creator: "Kenney",
    license: "Creative Commons Zero (CC0)",
    source: "kenney.nl/assets/city-kit-suburban",
  },
  {
    packId: "car-kit",
    title: "Car Kit",
    creator: "Kenney",
    license: "Creative Commons Zero (CC0)",
    source: "kenney.nl/assets/car-kit",
  },
] as const satisfies readonly AssetCredit[];

export function assetManifestEntry(key: AssetKey): RuntimeAssetManifestEntry {
  return ASSET_MANIFEST[key];
}
