export const MAX_TOTAL_BYTES = 150 * 1024 * 1024;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

const consumer = (assetKey, path, marker) => ({ assetKey, path, marker });
const model = (source, output, purpose, consumers) => ({
  source,
  output,
  purpose,
  kind: "model",
  consumers,
});
const image = (source, output, purpose) => ({ source, output, purpose, kind: "image" });

export const PACKS = [
  {
    id: "city-kit-commercial",
    title: "City Kit (Commercial)",
    pageUrl: "https://kenney.nl/assets/city-kit-commercial",
    files: [
      model(
        "Models/GLB format/building-a.glb",
        "assets/vendor/city-kit-commercial/carrot-market.glb",
        "Visible Carrot Market facade",
        [consumer("building.carrot-market", "src/scenes/city/world.ts", "this.assets.clone(`building.${shop}`)")],
      ),
      model(
        "Models/GLB format/building-b.glb",
        "assets/vendor/city-kit-commercial/fluff-salon.glb",
        "Visible Fluff Salon facade",
        [consumer("building.fluff-salon", "src/scenes/city/world.ts", "this.assets.clone(`building.${shop}`)")],
      ),
      image("Models/GLB format/Textures/colormap.png", "assets/vendor/city-kit-commercial/Textures/colormap.png", "Shared embedded-model palette"),
    ],
  },
  {
    id: "city-kit-suburban",
    title: "City Kit (Suburban)",
    pageUrl: "https://kenney.nl/assets/city-kit-suburban",
    files: [
      model(
        "Models/GLB format/building-type-a.glb",
        "assets/vendor/city-kit-suburban/cloud-boutique.glb",
        "Visible Cloud Boutique facade",
        [consumer("building.cloud-boutique", "src/scenes/city/world.ts", "this.assets.clone(`building.${shop}`)")],
      ),
      image("Models/GLB format/Textures/colormap.png", "assets/vendor/city-kit-suburban/Textures/colormap.png", "Shared embedded-model palette"),
    ],
  },
  {
    id: "car-kit",
    title: "Car Kit",
    pageUrl: "https://kenney.nl/assets/car-kit",
    files: [
      model(
        "Models/GLB format/sedan.glb",
        "assets/vendor/car-kit/gooby-car.glb",
        "Visible player car",
        [consumer("city.car", "src/scenes/city/world.ts", 'this.assets.clone("city.car")')],
      ),
      image("Models/GLB format/Textures/colormap.png", "assets/vendor/car-kit/Textures/colormap.png", "Shared embedded-model palette"),
    ],
  },
];

const vendored = (path, role = "primary") => ({ path, role });

export const ASSET_KEY_MAP = {
  "gooby.body": { fallback: "gooby-body" },
  "gooby.eye": { fallback: "gooby-eye" },
  "food.carrot": { fallback: "carrot" },
  "food.apple": { fallback: "apple" },
  "food.pancake": { fallback: "pancake" },
  "furniture.sofa": { fallback: "sofa" },
  "furniture.armchair": { fallback: "armchair" },
  "furniture.coffee-table": { fallback: "coffee-table" },
  "furniture.rug": { fallback: "rug" },
  "furniture.lamp": { fallback: "floor-lamp" },
  "furniture.bookshelf": { fallback: "bookshelf" },
  "furniture.bed": { fallback: "bed" },
  "furniture.bathtub": { fallback: "bathtub" },
  "furniture.kitchen-counter": { fallback: "kitchen-counter" },
  "city.road": { fallback: "toy-road" },
  "city.tree": { fallback: "flowering-tree" },
  "city.lamp": { fallback: "street-lamp" },
  "city.car": {
    fallback: "gooby-car",
    vendored: [vendored("assets/vendor/car-kit/gooby-car.glb")],
  },
  "building.carrot-market": { fallback: "carrot-market", vendored: [vendored("assets/vendor/city-kit-commercial/carrot-market.glb")] },
  "building.cloud-boutique": { fallback: "cloud-boutique", vendored: [vendored("assets/vendor/city-kit-suburban/cloud-boutique.glb")] },
  "building.fluff-salon": { fallback: "fluff-salon", vendored: [vendored("assets/vendor/city-kit-commercial/fluff-salon.glb")] },
  "icon.heart": { fallback: "heart-icon" },
  "icon.carrot": { fallback: "carrot-icon" },
  "icon.coin": { fallback: "coin-icon" },
  "icon.sleep": { fallback: "sleep-icon" },
  "particle.heart": { fallback: "heart-particle" },
  "particle.sparkle": { fallback: "sparkle-particle" },
  "particle.bubble": { fallback: "bubble-particle" },
  "audio.happy": { fallback: "happy-chime" },
  "audio.munch": { fallback: "munch-crunch" },
  "audio.sleep": { fallback: "sleep-chime" },
  "audio.wake": { fallback: "wake-chime" },
  "audio.tap": { fallback: "tap-pop" },
};
