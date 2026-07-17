import type { AssetKey } from "../../core/contracts/assets";
import {
  HOME_ZONE_IDS,
  type HomeZoneId,
  type MinigameId,
  type NormalUiDestination,
} from "../../core/contracts/scenes";

export const HOME_GRID_SIZE = 0.5;

export type DecorId =
  | "armchair"
  | "bookshelf"
  | "coffee-table"
  | "floor-lamp"
  | "oval-rug"
  | "sleepy-bed";

export interface DecorDefinition {
  readonly id: DecorId;
  readonly label: string;
  readonly assetKey: AssetKey;
  readonly footprint: readonly [width: number, depth: number];
  readonly allowedZones: readonly HomeZoneId[];
}

export interface HomeRect {
  readonly center: readonly [x: number, z: number];
  readonly size: readonly [width: number, depth: number];
}

export interface DecorSlot {
  readonly id: string;
  readonly position: readonly [x: number, z: number];
  readonly allowedDecor: readonly DecorId[];
}

export interface HomeZoneBlueprint {
  readonly id: HomeZoneId;
  readonly title: string;
  readonly subtitle: string;
  readonly sceneId: `home:${HomeZoneId}`;
  readonly destination: NormalUiDestination;
  readonly palette: {
    readonly background: number;
    readonly wall: number;
    readonly floor: number;
    readonly accent: number;
  };
  readonly bounds: HomeRect;
  readonly blocked: readonly HomeRect[];
  readonly decorSlots: readonly DecorSlot[];
  readonly camera: {
    readonly position: readonly [number, number, number];
    readonly target: readonly [number, number, number];
  };
}

const ALL_HOME_ZONES = [...HOME_ZONE_IDS];

export const HOME_DECOR_CATALOG: Readonly<Record<DecorId, DecorDefinition>> = {
  armchair: {
    id: "armchair",
    label: "Cloud Armchair",
    assetKey: "furniture.armchair",
    footprint: [1.7, 1.45],
    allowedZones: ALL_HOME_ZONES,
  },
  bookshelf: {
    id: "bookshelf",
    label: "Story Shelf",
    assetKey: "furniture.bookshelf",
    footprint: [1.6, 0.75],
    allowedZones: ["living-room", "bedroom"],
  },
  "coffee-table": {
    id: "coffee-table",
    label: "Acorn Table",
    assetKey: "furniture.coffee-table",
    footprint: [2.2, 2.2],
    allowedZones: ["living-room", "garden"],
  },
  "floor-lamp": {
    id: "floor-lamp",
    label: "Sunbeam Lamp",
    assetKey: "furniture.lamp",
    footprint: [0.8, 0.8],
    allowedZones: ["living-room", "bedroom"],
  },
  "oval-rug": {
    id: "oval-rug",
    label: "Meadow Rug",
    assetKey: "furniture.rug",
    footprint: [3.5, 2.35],
    allowedZones: ["living-room", "bedroom"],
  },
  "sleepy-bed": {
    id: "sleepy-bed",
    label: "Dreamy Bed",
    assetKey: "furniture.bed",
    footprint: [2.7, 1.8],
    allowedZones: ["bedroom"],
  },
};

const commonSlots: readonly DecorSlot[] = [
  { id: "left-nook", position: [-3, 1.25], allowedDecor: ["armchair", "floor-lamp", "bookshelf"] },
  { id: "right-nook", position: [3, 1.25], allowedDecor: ["armchair", "floor-lamp", "bookshelf"] },
  { id: "center", position: [0, 0.75], allowedDecor: ["coffee-table", "oval-rug"] },
];

export const HOME_ZONE_BLUEPRINTS: Readonly<Record<HomeZoneId, HomeZoneBlueprint>> = {
  "living-room": {
    id: "living-room",
    title: "Living Room",
    subtitle: "The cozy heart of Gooby's home",
    sceneId: "home:living-room",
    destination: { kind: "home", zone: "living-room" },
    palette: { background: 0xf7d3aa, wall: 0xf4cba5, floor: 0xd49b69, accent: 0xe87e68 },
    bounds: { center: [0, 0], size: [9, 7] },
    blocked: [
      { center: [-2.8, -2.45], size: [3.2, 1.2] },
      { center: [0, -2.7], size: [1.8, 0.65] },
      { center: [3.55, -2.55], size: [1.4, 0.75] },
    ],
    decorSlots: commonSlots,
    camera: { position: [0, 4.2, 13.8], target: [0, 2, -0.15] },
  },
  kitchen: {
    id: "kitchen",
    title: "Sunny Kitchen",
    subtitle: "Fresh snacks and happy crunches",
    sceneId: "home:kitchen",
    destination: { kind: "home", zone: "kitchen" },
    palette: { background: 0xffe0a8, wall: 0xffd9b5, floor: 0xd9a878, accent: 0x7ab6a1 },
    bounds: { center: [0, 0], size: [9, 7] },
    blocked: [
      { center: [-3.4, -2.35], size: [1.7, 1.4] },
      { center: [1.25, -2.55], size: [4.7, 1.1] },
      { center: [3.65, 0.2], size: [1, 2.5] },
    ],
    decorSlots: [
      { id: "breakfast-nook", position: [-2.4, 0.65], allowedDecor: ["armchair", "coffee-table"] },
      { id: "sunny-corner", position: [2.8, 0.8], allowedDecor: ["armchair"] },
    ],
    camera: { position: [0, 4.4, 14.2], target: [0, 2, -0.25] },
  },
  bathroom: {
    id: "bathroom",
    title: "Bubble Bathroom",
    subtitle: "Splish, scrub, sparkle",
    sceneId: "home:bathroom",
    destination: { kind: "home", zone: "bathroom" },
    palette: { background: 0xbde7e6, wall: 0xccebea, floor: 0x77b7b2, accent: 0xf4a7b9 },
    bounds: { center: [0, 0], size: [9, 7] },
    blocked: [
      { center: [-2.6, -1.9], size: [3.4, 1.8] },
      { center: [2.85, -2.55], size: [1.8, 0.8] },
      { center: [3.75, 0.3], size: [0.8, 1.6] },
    ],
    decorSlots: [
      { id: "towel-corner", position: [1.9, 1.65], allowedDecor: ["armchair"] },
    ],
    camera: { position: [0, 4.2, 13.8], target: [0, 1.9, -0.2] },
  },
  bedroom: {
    id: "bedroom",
    title: "Cozy Bedroom",
    subtitle: "Soft blankets and sweeter dreams",
    sceneId: "home:bedroom",
    destination: { kind: "home", zone: "bedroom" },
    palette: { background: 0xbbb5dc, wall: 0xd8c8e5, floor: 0xa98582, accent: 0xf2b58f },
    bounds: { center: [0, 0], size: [9, 7] },
    blocked: [
      { center: [-2.5, -2], size: [3.2, 2.1] },
      { center: [3.35, -2.55], size: [1.25, 0.8] },
    ],
    decorSlots: [
      { id: "bedside", position: [0.1, -2.15], allowedDecor: ["floor-lamp"] },
      { id: "reading-nook", position: [2.65, -0.75], allowedDecor: ["armchair", "bookshelf"] },
      { id: "foot-rug", position: [-0.6, 0.75], allowedDecor: ["oval-rug"] },
    ],
    camera: { position: [0, 4.2, 13.8], target: [0, 1.9, -0.2] },
  },
  garden: {
    id: "garden",
    title: "Carrot Garden",
    subtitle: "Grow, play, and chase butterflies",
    sceneId: "home:garden",
    destination: { kind: "home", zone: "garden" },
    palette: { background: 0x9dd8e7, wall: 0x8dbd72, floor: 0x78aa63, accent: 0xf3a057 },
    bounds: { center: [0, 0], size: [9, 7] },
    blocked: [
      { center: [-2.9, -2.25], size: [2.4, 1.8] },
      { center: [3.45, -1.7], size: [1.4, 2.5] },
    ],
    decorSlots: [
      { id: "picnic-center", position: [0.2, 0.9], allowedDecor: ["coffee-table"] },
      { id: "shade-seat", position: [2.4, 0.6], allowedDecor: ["armchair"] },
    ],
    camera: { position: [0, 4.6, 14.7], target: [0, 1.7, -0.4] },
  },
};

export const GARDEN_SIGNPOSTS: readonly {
  readonly label: string;
  readonly game: MinigameId;
  readonly assetKey: AssetKey;
}[] = [
  { label: "Carrot Catch", game: "carrot-catch", assetKey: "icon.carrot" },
  { label: "Bunny Hop", game: "bunny-hop", assetKey: "particle.sparkle" },
  { label: "Garden Moles", game: "garden-moles", assetKey: "city.tree" },
];

if (Object.keys(HOME_ZONE_BLUEPRINTS).length !== HOME_ZONE_IDS.length) {
  throw new Error("Every frozen home zone requires a complete blueprint");
}
