import type { AssetKey } from "../core/contracts/assets";

export type VendoredAssetRole = "primary";

export interface VendoredAssetReference {
  readonly path: `assets/vendor/${string}` | `assets/curated/${string}`;
  readonly role: VendoredAssetRole;
}

export interface RuntimeAssetManifestEntry {
  readonly fallback: string;
  readonly vendored: readonly VendoredAssetReference[];
}

export interface AssetCredit {
  readonly packId: string;
  readonly title: string;
  readonly creator: "Kenney" | "Kay Lousberg";
  readonly license: "Creative Commons Zero (CC0)";
  readonly source: string;
}

export interface AssetLicenseNotice {
  readonly path: "assets/LICENSES.md";
  readonly packCount: 3;
  readonly fileCount: 7;
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

export const ASSET_LICENSE_NOTICE = {
  path: "assets/LICENSES.md",
  packCount: 3,
  fileCount: 7,
} as const satisfies AssetLicenseNotice;

/**
 * Planned keys for upcoming features. They are not part of the frozen
 * ASSET_KEYS contract yet; the curated GLBs are committed and audited ahead
 * of the gameplay code that will consume them. An entry with an empty
 * vendored list is allowed only as an intentional fallback-first decision.
 */
export const PLANNED_ASSET_KEYS = [
  "city.road-straight",
  "city.road-corner",
  "city.road-t",
  "city.road-4way",
  "city.curb",
  "city.sidewalk",
  "building.city-a",
  "building.city-b",
  "building.city-c",
  "city.traffic-car-a",
  "city.traffic-car-b",
  "city.bench",
  "city.hydrant",
  "city.sign",
  "surf.cart",
  "surf.ramp",
  "surf.crate",
  "food.nougat-jar",
  "food.cake",
  "home.nougatschleuse",
  "home.picnic-bench",
  "home.record-player",
] as const;

export type PlannedAssetKey = (typeof PLANNED_ASSET_KEYS)[number];

export const PLANNED_ASSET_MANIFEST = {
  "city.road-straight": {
    fallback: "road-straight",
    vendored: [file("assets/curated/kenney-city-kit-roads/city-road-straight.glb")],
  },
  "city.road-corner": {
    fallback: "road-corner",
    vendored: [file("assets/curated/kenney-city-kit-roads/city-road-corner.glb")],
  },
  "city.road-t": {
    fallback: "road-t",
    vendored: [file("assets/curated/kenney-city-kit-roads/city-road-t.glb")],
  },
  "city.road-4way": {
    fallback: "road-4way",
    vendored: [file("assets/curated/kenney-city-kit-roads/city-road-4way.glb")],
  },
  "city.curb": {
    fallback: "curb",
    vendored: [file("assets/curated/kenney-city-kit-roads/city-curb.glb")],
  },
  "city.sidewalk": {
    fallback: "sidewalk",
    vendored: [file("assets/curated/kaykit-city-builder-bits/city-sidewalk.glb")],
  },
  "building.city-a": {
    fallback: "city-building-a",
    vendored: [file("assets/curated/kaykit-city-builder-bits/building-city-a.glb")],
  },
  "building.city-b": {
    fallback: "city-building-b",
    vendored: [file("assets/curated/kaykit-city-builder-bits/building-city-b.glb")],
  },
  "building.city-c": {
    fallback: "city-building-c",
    vendored: [file("assets/curated/kaykit-city-builder-bits/building-city-c.glb")],
  },
  "city.traffic-car-a": {
    fallback: "traffic-car-a",
    vendored: [file("assets/curated/kaykit-city-builder-bits/city-traffic-car-a.glb")],
  },
  "city.traffic-car-b": {
    fallback: "traffic-car-b",
    vendored: [file("assets/curated/kaykit-city-builder-bits/city-traffic-car-b.glb")],
  },
  "city.bench": {
    fallback: "street-bench",
    vendored: [file("assets/curated/kaykit-city-builder-bits/city-bench.glb")],
  },
  "city.hydrant": {
    fallback: "fire-hydrant",
    vendored: [file("assets/curated/kaykit-city-builder-bits/city-hydrant.glb")],
  },
  "city.sign": {
    fallback: "street-sign",
    vendored: [file("assets/curated/kenney-city-kit-roads/city-sign.glb")],
  },
  "surf.cart": {
    fallback: "surf-cart",
    vendored: [file("assets/curated/kenney-mini-market/surf-cart.glb")],
  },
  "surf.ramp": {
    fallback: "surf-ramp",
    vendored: [file("assets/curated/kenney-platformer-kit/surf-ramp.glb")],
  },
  "surf.crate": {
    fallback: "surf-crate",
    vendored: [file("assets/curated/kenney-platformer-kit/surf-crate.glb")],
  },
  "food.nougat-jar": {
    fallback: "nougat-jar",
    vendored: [file("assets/curated/kaykit-restaurant-bits/food-nougat-jar.glb")],
  },
  "food.cake": {
    fallback: "cake",
    vendored: [file("assets/curated/kenney-food-kit/food-cake.glb")],
  },
  "home.nougatschleuse": {
    fallback: "nougatschleuse",
    vendored: [file("assets/curated/kenney-mini-arcade/home-nougatschleuse.glb")],
  },
  "home.picnic-bench": {
    fallback: "picnic-bench",
    vendored: [file("assets/curated/kenney-furniture-kit/home-picnic-bench.glb")],
  },
  "home.record-player": {
    fallback: "record-player",
    vendored: [file("assets/curated/kenney-furniture-kit/home-record-player.glb")],
  },
} as const satisfies Readonly<Record<PlannedAssetKey, RuntimeAssetManifestEntry>>;

export const CURATED_ASSET_CREDITS = [
  {
    packId: "kenney-city-kit-roads",
    title: "City Kit (Roads)",
    creator: "Kenney",
    license: "Creative Commons Zero (CC0)",
    source: "kenney.nl/assets/city-kit-roads",
  },
  {
    packId: "kenney-food-kit",
    title: "Food Kit",
    creator: "Kenney",
    license: "Creative Commons Zero (CC0)",
    source: "kenney.nl/assets/food-kit",
  },
  {
    packId: "kenney-furniture-kit",
    title: "Furniture Kit",
    creator: "Kenney",
    license: "Creative Commons Zero (CC0)",
    source: "kenney.nl/assets/furniture-kit",
  },
  {
    packId: "kenney-mini-arcade",
    title: "Mini Arcade",
    creator: "Kenney",
    license: "Creative Commons Zero (CC0)",
    source: "kenney.nl/assets/mini-arcade",
  },
  {
    packId: "kenney-mini-market",
    title: "Mini Market",
    creator: "Kenney",
    license: "Creative Commons Zero (CC0)",
    source: "kenney.nl/assets/mini-market",
  },
  {
    packId: "kenney-platformer-kit",
    title: "Platformer Kit",
    creator: "Kenney",
    license: "Creative Commons Zero (CC0)",
    source: "kenney.nl/assets/platformer-kit",
  },
  {
    packId: "kaykit-city-builder-bits",
    title: "KayKit City Builder Bits",
    creator: "Kay Lousberg",
    license: "Creative Commons Zero (CC0)",
    source: "github.com/KayKit-Game-Assets/KayKit-City-Builder-Bits-1.0",
  },
  {
    packId: "kaykit-restaurant-bits",
    title: "KayKit Restaurant Bits",
    creator: "Kay Lousberg",
    license: "Creative Commons Zero (CC0)",
    source: "github.com/KayKit-Game-Assets/KayKit-Restaurant-Bits-1.0",
  },
] as const satisfies readonly AssetCredit[];

export function assetManifestEntry(key: AssetKey): RuntimeAssetManifestEntry {
  return ASSET_MANIFEST[key];
}

export function plannedAssetManifestEntry(key: PlannedAssetKey): RuntimeAssetManifestEntry {
  return PLANNED_ASSET_MANIFEST[key];
}
