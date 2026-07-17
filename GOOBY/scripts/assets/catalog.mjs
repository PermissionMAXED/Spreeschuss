export const MAX_TOTAL_BYTES = 150 * 1024 * 1024;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

const model = (source, output, purpose) => ({ source, output, purpose, kind: "model" });
const image = (source, output, purpose) => ({ source, output, purpose, kind: "image" });
const audio = (source, output, purpose) => ({
  source,
  output,
  purpose,
  kind: "audio",
  transform: "ogg-to-wav",
});

export const PACKS = [
  {
    id: "furniture-kit",
    title: "Furniture Kit",
    pageUrl: "https://kenney.nl/assets/furniture-kit",
    files: [
      model("Models/GLTF format/loungeSofa.glb", "assets/vendor/furniture-kit/sofa.glb", "Living-room sofa"),
      model("Models/GLTF format/loungeChair.glb", "assets/vendor/furniture-kit/armchair.glb", "Living-room armchair"),
      model("Models/GLTF format/tableCoffee.glb", "assets/vendor/furniture-kit/coffee-table.glb", "Coffee table"),
      model("Models/GLTF format/rugRounded.glb", "assets/vendor/furniture-kit/rug.glb", "Rounded rug"),
      model("Models/GLTF format/lampRoundFloor.glb", "assets/vendor/furniture-kit/lamp.glb", "Floor lamp"),
      model("Models/GLTF format/bookcaseOpen.glb", "assets/vendor/furniture-kit/bookshelf.glb", "Open bookshelf"),
      model("Models/GLTF format/bedSingle.glb", "assets/vendor/furniture-kit/bed.glb", "Single bed"),
      model("Models/GLTF format/bathtub.glb", "assets/vendor/furniture-kit/bathtub.glb", "Bathtub"),
      model("Models/GLTF format/kitchenCabinet.glb", "assets/vendor/furniture-kit/kitchen-counter.glb", "Kitchen counter"),
    ],
  },
  {
    id: "food-kit",
    title: "Food Kit",
    pageUrl: "https://kenney.nl/assets/food-kit",
    files: [
      model("Models/GLB format/carrot.glb", "assets/vendor/food-kit/carrot.glb", "Carrot food and icon source"),
      model("Models/GLB format/apple.glb", "assets/vendor/food-kit/apple.glb", "Apple food"),
      model("Models/GLB format/pancakes.glb", "assets/vendor/food-kit/pancake.glb", "Pancake stack"),
      image("Models/GLB format/Textures/colormap.png", "assets/vendor/food-kit/Textures/colormap.png", "Shared embedded-model palette"),
    ],
  },
  {
    id: "city-kit-roads",
    title: "City Kit (Roads)",
    pageUrl: "https://kenney.nl/assets/city-kit-roads",
    files: [
      model("Models/GLB format/road-straight.glb", "assets/vendor/city-kit-roads/road.glb", "Straight city road"),
      model("Models/GLB format/light-curved.glb", "assets/vendor/city-kit-roads/street-lamp.glb", "Curved street lamp"),
      image("Models/GLB format/Textures/colormap.png", "assets/vendor/city-kit-roads/Textures/colormap.png", "Shared embedded-model palette"),
    ],
  },
  {
    id: "city-kit-commercial",
    title: "City Kit (Commercial)",
    pageUrl: "https://kenney.nl/assets/city-kit-commercial",
    files: [
      model("Models/GLB format/building-a.glb", "assets/vendor/city-kit-commercial/carrot-market.glb", "Market facade base"),
      model("Models/GLB format/building-b.glb", "assets/vendor/city-kit-commercial/fluff-salon.glb", "Salon facade base"),
      image("Models/GLB format/Textures/colormap.png", "assets/vendor/city-kit-commercial/Textures/colormap.png", "Shared embedded-model palette"),
    ],
  },
  {
    id: "city-kit-suburban",
    title: "City Kit (Suburban)",
    pageUrl: "https://kenney.nl/assets/city-kit-suburban",
    files: [
      model("Models/GLB format/building-type-a.glb", "assets/vendor/city-kit-suburban/cloud-boutique.glb", "Boutique facade base"),
      image("Models/GLB format/Textures/colormap.png", "assets/vendor/city-kit-suburban/Textures/colormap.png", "Shared embedded-model palette"),
    ],
  },
  {
    id: "car-kit",
    title: "Car Kit",
    pageUrl: "https://kenney.nl/assets/car-kit",
    files: [
      model("Models/GLB format/sedan.glb", "assets/vendor/car-kit/gooby-car.glb", "Gooby car base"),
      model("Models/GLB format/hatchback-sports.glb", "assets/vendor/car-kit/traffic-car.glb", "Traffic-car variation"),
      image("Models/GLB format/Textures/colormap.png", "assets/vendor/car-kit/Textures/colormap.png", "Shared embedded-model palette"),
    ],
  },
  {
    id: "racing-kit",
    title: "Racing Kit",
    pageUrl: "https://kenney.nl/assets/racing-kit",
    files: [
      model("Models/GLTF format/pitsGarage.glb", "assets/vendor/racing-kit/garage.glb", "City garage and driving set dressing"),
      model("Models/GLTF format/flagCheckersSmall.glb", "assets/vendor/racing-kit/checkered-flag.glb", "Driving finish marker"),
    ],
  },
  {
    id: "nature-kit",
    title: "Nature Kit",
    pageUrl: "https://kenney.nl/assets/nature-kit",
    files: [
      model("Models/GLTF format/tree_default.glb", "assets/vendor/nature-kit/tree.glb", "City tree"),
      model("Models/GLTF format/flower_yellowA.glb", "assets/vendor/nature-kit/flower.glb", "Warm garden accent"),
    ],
  },
  {
    id: "minigolf-kit",
    title: "Minigolf Kit",
    pageUrl: "https://kenney.nl/assets/minigolf-kit",
    files: [
      model("Models/GLB format/ball-red.glb", "assets/vendor/minigolf-kit/ball.glb", "Toy-box ball prop"),
      model("Models/GLB format/flag-red.glb", "assets/vendor/minigolf-kit/flag.glb", "Toy-box activity marker"),
      image("Models/GLB format/Textures/colormap.png", "assets/vendor/minigolf-kit/Textures/colormap.png", "Shared embedded-model palette"),
    ],
  },
  {
    id: "ui-pack",
    title: "UI Pack",
    pageUrl: "https://kenney.nl/assets/ui-pack",
    files: [
      image("PNG/Yellow/Default/button_round_flat.png", "assets/vendor/ui-pack/round-button.png", "Warm icon backing plate"),
    ],
  },
  {
    id: "game-icons",
    title: "Game Icons",
    pageUrl: "https://kenney.nl/assets/game-icons",
    files: [
      image("PNG/White/2x/star.png", "assets/vendor/game-icons/star.png", "Sleep and sparkle accent"),
    ],
  },
  {
    id: "mobile-controls",
    title: "Mobile Controls (Onscreen Controls)",
    pageUrl: "https://kenney.nl/assets/mobile-controls",
    files: [
      image("Sprites/Icons/Default/icon_hand.png", "assets/vendor/mobile-controls/hand.png", "Touch interaction affordance"),
      image("Sprites/Style A/Default/button_circle.png", "assets/vendor/mobile-controls/touch-button.png", "Onscreen touch target"),
    ],
  },
  {
    id: "particle-pack",
    title: "Particle Pack",
    pageUrl: "https://kenney.nl/assets/particle-pack",
    files: [
      image("PNG (Transparent)/spark_03.png", "assets/vendor/particle-pack/sparkle.png", "Sparkle particle"),
      image("PNG (Transparent)/circle_03.png", "assets/vendor/particle-pack/bubble.png", "Bubble particle"),
      image("PNG (Transparent)/magic_02.png", "assets/vendor/particle-pack/magic.png", "Happy reaction accent"),
    ],
  },
  {
    id: "interface-sounds",
    title: "Interface Sounds",
    pageUrl: "https://kenney.nl/assets/interface-sounds",
    files: [
      audio("Audio/click_001.ogg", "assets/vendor/interface-sounds/tap.wav", "Tap sound"),
    ],
  },
  {
    id: "music-jingles",
    title: "Music Jingles",
    pageUrl: "https://kenney.nl/assets/music-jingles",
    files: [
      audio("Audio/Pizzicato jingles/jingles_PIZZI03.ogg", "assets/vendor/music-jingles/happy.wav", "Happy reward jingle"),
    ],
  },
];

const vendored = (path, role = "primary") => ({ path, role });

export const ASSET_KEY_MAP = {
  "gooby.body": { fallback: "gooby-body" },
  "gooby.eye": { fallback: "gooby-eye" },
  "food.carrot": { fallback: "carrot", vendored: [vendored("assets/vendor/food-kit/carrot.glb")] },
  "food.apple": { fallback: "apple", vendored: [vendored("assets/vendor/food-kit/apple.glb")] },
  "food.pancake": { fallback: "pancake", vendored: [vendored("assets/vendor/food-kit/pancake.glb")] },
  "furniture.sofa": { fallback: "sofa", vendored: [vendored("assets/vendor/furniture-kit/sofa.glb")] },
  "furniture.armchair": { fallback: "armchair", vendored: [vendored("assets/vendor/furniture-kit/armchair.glb")] },
  "furniture.coffee-table": { fallback: "coffee-table", vendored: [vendored("assets/vendor/furniture-kit/coffee-table.glb")] },
  "furniture.rug": { fallback: "rug", vendored: [vendored("assets/vendor/furniture-kit/rug.glb")] },
  "furniture.lamp": { fallback: "floor-lamp", vendored: [vendored("assets/vendor/furniture-kit/lamp.glb")] },
  "furniture.bookshelf": { fallback: "bookshelf", vendored: [vendored("assets/vendor/furniture-kit/bookshelf.glb")] },
  "furniture.bed": { fallback: "bed", vendored: [vendored("assets/vendor/furniture-kit/bed.glb")] },
  "furniture.bathtub": { fallback: "bathtub", vendored: [vendored("assets/vendor/furniture-kit/bathtub.glb")] },
  "furniture.kitchen-counter": { fallback: "kitchen-counter", vendored: [vendored("assets/vendor/furniture-kit/kitchen-counter.glb")] },
  "city.road": { fallback: "toy-road", vendored: [vendored("assets/vendor/city-kit-roads/road.glb")] },
  "city.tree": { fallback: "flowering-tree", vendored: [vendored("assets/vendor/nature-kit/tree.glb")] },
  "city.lamp": { fallback: "street-lamp", vendored: [vendored("assets/vendor/city-kit-roads/street-lamp.glb")] },
  "city.car": {
    fallback: "gooby-car",
    vendored: [
      vendored("assets/vendor/car-kit/gooby-car.glb"),
      vendored("assets/vendor/car-kit/traffic-car.glb", "variant"),
    ],
  },
  "building.carrot-market": { fallback: "carrot-market", vendored: [vendored("assets/vendor/city-kit-commercial/carrot-market.glb")] },
  "building.cloud-boutique": { fallback: "cloud-boutique", vendored: [vendored("assets/vendor/city-kit-suburban/cloud-boutique.glb")] },
  "building.fluff-salon": { fallback: "fluff-salon", vendored: [vendored("assets/vendor/city-kit-commercial/fluff-salon.glb")] },
  "icon.heart": {
    fallback: "heart-icon",
    vendored: [vendored("assets/vendor/ui-pack/round-button.png", "backplate")],
  },
  "icon.carrot": { fallback: "carrot-icon", vendored: [vendored("assets/vendor/food-kit/carrot.glb")] },
  "icon.coin": { fallback: "coin-icon" },
  "icon.sleep": {
    fallback: "sleep-icon",
    vendored: [vendored("assets/vendor/game-icons/star.png", "accent")],
  },
  "particle.heart": { fallback: "heart-particle" },
  "particle.sparkle": {
    fallback: "sparkle-particle",
    vendored: [vendored("assets/vendor/particle-pack/sparkle.png")],
  },
  "particle.bubble": {
    fallback: "bubble-particle",
    vendored: [vendored("assets/vendor/particle-pack/bubble.png")],
  },
  "audio.happy": {
    fallback: "happy-chime",
    vendored: [vendored("assets/vendor/music-jingles/happy.wav")],
  },
  "audio.munch": { fallback: "munch-crunch" },
  "audio.sleep": { fallback: "sleep-chime" },
  "audio.wake": { fallback: "wake-chime" },
  "audio.tap": {
    fallback: "tap-pop",
    vendored: [vendored("assets/vendor/interface-sounds/tap.wav")],
  },
};
