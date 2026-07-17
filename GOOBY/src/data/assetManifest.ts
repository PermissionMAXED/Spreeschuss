import type { AssetKey } from "../core/contracts/assets";

export type VendoredAssetRole = "primary" | "variant" | "accent" | "backplate";

export interface VendoredAssetReference {
  readonly path: `assets/vendor/${string}`;
  readonly role: VendoredAssetRole;
}

export interface RuntimeAssetManifestEntry {
  readonly fallback: string;
  readonly vendored: readonly VendoredAssetReference[];
}

const file = (
  path: VendoredAssetReference["path"],
  role: VendoredAssetRole = "primary",
): VendoredAssetReference => ({ path, role });

export const ASSET_MANIFEST = {
  "gooby.body": { fallback: "gooby-body", vendored: [] },
  "gooby.eye": { fallback: "gooby-eye", vendored: [] },
  "food.carrot": { fallback: "carrot", vendored: [file("assets/vendor/food-kit/carrot.glb")] },
  "food.apple": { fallback: "apple", vendored: [file("assets/vendor/food-kit/apple.glb")] },
  "food.pancake": { fallback: "pancake", vendored: [file("assets/vendor/food-kit/pancake.glb")] },
  "furniture.sofa": { fallback: "sofa", vendored: [file("assets/vendor/furniture-kit/sofa.glb")] },
  "furniture.armchair": { fallback: "armchair", vendored: [file("assets/vendor/furniture-kit/armchair.glb")] },
  "furniture.coffee-table": { fallback: "coffee-table", vendored: [file("assets/vendor/furniture-kit/coffee-table.glb")] },
  "furniture.rug": { fallback: "rug", vendored: [file("assets/vendor/furniture-kit/rug.glb")] },
  "furniture.lamp": { fallback: "floor-lamp", vendored: [file("assets/vendor/furniture-kit/lamp.glb")] },
  "furniture.bookshelf": { fallback: "bookshelf", vendored: [file("assets/vendor/furniture-kit/bookshelf.glb")] },
  "furniture.bed": { fallback: "bed", vendored: [file("assets/vendor/furniture-kit/bed.glb")] },
  "furniture.bathtub": { fallback: "bathtub", vendored: [file("assets/vendor/furniture-kit/bathtub.glb")] },
  "furniture.kitchen-counter": { fallback: "kitchen-counter", vendored: [file("assets/vendor/furniture-kit/kitchen-counter.glb")] },
  "city.road": { fallback: "toy-road", vendored: [file("assets/vendor/city-kit-roads/road.glb")] },
  "city.tree": { fallback: "flowering-tree", vendored: [file("assets/vendor/nature-kit/tree.glb")] },
  "city.lamp": { fallback: "street-lamp", vendored: [file("assets/vendor/city-kit-roads/street-lamp.glb")] },
  "city.car": {
    fallback: "gooby-car",
    vendored: [
      file("assets/vendor/car-kit/gooby-car.glb"),
      file("assets/vendor/car-kit/traffic-car.glb", "variant"),
    ],
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
  "icon.heart": {
    fallback: "heart-icon",
    vendored: [file("assets/vendor/ui-pack/round-button.png", "backplate")],
  },
  "icon.carrot": { fallback: "carrot-icon", vendored: [file("assets/vendor/food-kit/carrot.glb")] },
  "icon.coin": { fallback: "coin-icon", vendored: [] },
  "icon.sleep": {
    fallback: "sleep-icon",
    vendored: [file("assets/vendor/game-icons/star.png", "accent")],
  },
  "particle.heart": { fallback: "heart-particle", vendored: [] },
  "particle.sparkle": {
    fallback: "sparkle-particle",
    vendored: [file("assets/vendor/particle-pack/sparkle.png")],
  },
  "particle.bubble": {
    fallback: "bubble-particle",
    vendored: [file("assets/vendor/particle-pack/bubble.png")],
  },
  "audio.happy": {
    fallback: "happy-chime",
    vendored: [file("assets/vendor/music-jingles/happy.wav")],
  },
  "audio.munch": { fallback: "munch-crunch", vendored: [] },
  "audio.sleep": { fallback: "sleep-chime", vendored: [] },
  "audio.wake": { fallback: "wake-chime", vendored: [] },
  "audio.tap": {
    fallback: "tap-pop",
    vendored: [file("assets/vendor/interface-sounds/tap.wav")],
  },
} as const satisfies Readonly<Record<AssetKey, RuntimeAssetManifestEntry>>;

export function assetManifestEntry(key: AssetKey): RuntimeAssetManifestEntry {
  return ASSET_MANIFEST[key];
}
