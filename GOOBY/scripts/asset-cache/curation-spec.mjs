/**
 * Checked-in deterministic curation spec: the single source of truth for
 * which cached official source files become committed runtime assets.
 *
 * Every entry maps one planned AssetKey to one genuine file inside a locked
 * source from scripts/asset-cache/sources.mjs. Outputs are self-contained
 * GLBs (external buffers/images deterministically embedded), committed under
 * public/assets/curated/<sourceId>/, with verbatim source licenses under
 * assets/curated/vendor/<sourceId>/License.txt.
 *
 * Naming note: planned keys are Gooby gameplay names; the recorded provenance
 * always states the genuine upstream file. "home.record-player" intentionally
 * curates the Furniture Kit radio model as its visual stand-in because no
 * approved source ships a turntable model.
 */

export const CURATED_MODELS_MANIFEST_PATH = "assets/curated/manifest.json";
export const CURATED_LICENSE_ROOT = "assets/curated/vendor";
export const CURATED_OUTPUT_ROOT = "assets/curated";
export const CURATED_DOCUMENT_PATH = "assets/curated/CURATED.md";

/** Committed runtime payload budget (public/assets, everything included). */
export const RUNTIME_ASSET_BUDGET_BYTES = 40 * 1024 * 1024;

const KAYKIT_CITY = "addons/kaykit_city_builder_bits/Assets/gltf";
const KAYKIT_RESTAURANT = "addons/kaykit_restaurant_bits/Assets/gltf";

const entry = (key, fallback, sourceId, sourcePath, purpose) => ({
  key,
  fallback,
  sourceId,
  sourcePath,
  purpose,
  mode: "embed",
  output: `${CURATED_OUTPUT_ROOT}/${sourceId}/${key.replaceAll(".", "-")}.glb`,
});

export const CURATED_MODEL_SPECS = [
  // City road system.
  entry("city.road-straight", "road-straight", "kenney-city-kit-roads", "Models/GLB format/road-straight.glb", "Straight road segment"),
  entry("city.road-corner", "road-corner", "kenney-city-kit-roads", "Models/GLB format/road-bend.glb", "Curved corner road segment"),
  entry("city.road-t", "road-t", "kenney-city-kit-roads", "Models/GLB format/road-intersection.glb", "Three-way T road intersection"),
  entry("city.road-4way", "road-4way", "kenney-city-kit-roads", "Models/GLB format/road-crossroad.glb", "Four-way road crossing"),
  entry("city.curb", "curb", "kenney-city-kit-roads", "Models/GLB format/road-side.glb", "Road-side curb edge tile"),
  entry("city.sidewalk", "sidewalk", "kaykit-city-builder-bits", `${KAYKIT_CITY}/base.gltf`, "Raised sidewalk base tile"),
  // City buildings.
  entry("building.city-a", "city-building-a", "kaykit-city-builder-bits", `${KAYKIT_CITY}/building_A.gltf`, "City building facade A"),
  entry("building.city-b", "city-building-b", "kaykit-city-builder-bits", `${KAYKIT_CITY}/building_B.gltf`, "City building facade B"),
  entry("building.city-c", "city-building-c", "kaykit-city-builder-bits", `${KAYKIT_CITY}/building_C.gltf`, "City building facade C"),
  // Ambient traffic.
  entry("city.traffic-car-a", "traffic-car-a", "kaykit-city-builder-bits", `${KAYKIT_CITY}/car_taxi.gltf`, "Ambient traffic taxi"),
  entry("city.traffic-car-b", "traffic-car-b", "kaykit-city-builder-bits", `${KAYKIT_CITY}/car_hatchback.gltf`, "Ambient traffic hatchback"),
  // Street props.
  entry("city.bench", "street-bench", "kaykit-city-builder-bits", `${KAYKIT_CITY}/bench.gltf`, "Street bench prop"),
  entry("city.hydrant", "fire-hydrant", "kaykit-city-builder-bits", `${KAYKIT_CITY}/firehydrant.gltf`, "Fire hydrant prop"),
  entry("city.sign", "street-sign", "kenney-city-kit-roads", "Models/GLB format/sign-highway.glb", "Street sign prop"),
  // Surf minigame props.
  entry("surf.cart", "surf-cart", "kenney-mini-market", "Models/GLB format/shopping-cart.glb", "Rideable surf shopping cart"),
  entry("surf.ramp", "surf-ramp", "kenney-platformer-kit", "Models/GLB format/platform-ramp.glb", "Surf jump ramp"),
  entry("surf.crate", "surf-crate", "kenney-platformer-kit", "Models/GLB format/crate.glb", "Surf obstacle crate"),
  // Food items.
  entry("food.nougat-jar", "nougat-jar", "kaykit-restaurant-bits", `${KAYKIT_RESTAURANT}/jar_A_large.gltf`, "Nougat storage jar"),
  entry("food.cake", "cake", "kenney-food-kit", "Models/GLB format/cake.glb", "Celebration cake"),
  // Home contraptions.
  entry("home.nougatschleuse", "nougatschleuse", "kenney-mini-arcade", "Models/GLB format/vending-machine.glb", "Nougatschleuse dispenser contraption"),
  entry("home.picnic-bench", "picnic-bench", "kenney-furniture-kit", "Models/GLTF format/bench.glb", "Garden picnic bench"),
  entry("home.record-player", "record-player", "kenney-furniture-kit", "Models/GLTF format/radio.glb", "Record player (radio model stand-in)"),
];

export const PLANNED_MODEL_KEYS = CURATED_MODEL_SPECS.map(({ key }) => key);
