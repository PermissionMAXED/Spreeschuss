import {
  Box3,
  BoxGeometry,
  CapsuleGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  Texture,
  TorusGeometry,
  Vector3,
  type Material,
  type Object3D,
} from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type {
  DisplayFixture,
  FurnitureCatalogItem,
  ShopCatalogItem,
  WardrobeCosmeticCatalogItem,
} from "../../data/catalog";
import { COSMETIC_CATALOG } from "../../data/catalog";
import type { ShopId } from "../../core/contracts/scenes";
import { applyCosmeticModelAttachment } from "../../gooby/attachments";

const material = (color: number, roughness = 0.78): MeshStandardMaterial =>
  new MeshStandardMaterial({ color, roughness, metalness: roughness < 0.5 ? 0.16 : 0 });

function mesh(
  geometry:
    | BoxGeometry
    | CapsuleGeometry
    | ConeGeometry
    | CylinderGeometry
    | IcosahedronGeometry
    | SphereGeometry
    | TorusGeometry,
  color: number,
  roughness?: number,
): Mesh {
  const value = new Mesh(geometry, material(color, roughness));
  value.castShadow = true;
  value.receiveShadow = true;
  return value;
}

function addFoodModel(group: Group, item: ShopCatalogItem): void {
  const color = item.display.color;
  if (item.id.includes("spread")) {
    const jar = mesh(new CylinderGeometry(0.32, 0.38, 0.72, 18), 0xf2dfbd);
    jar.position.y = 0.04;
    const filling = mesh(new CylinderGeometry(0.285, 0.33, 0.52, 18), color);
    filling.position.y = 0.02;
    const lid = mesh(new CylinderGeometry(0.35, 0.35, 0.12, 18), 0x7b654f, 0.42);
    lid.position.y = 0.45;
    const moon = mesh(new SphereGeometry(0.12, 10, 8), 0xf1cc69);
    moon.scale.set(0.65, 1, 0.18);
    moon.position.set(0, 0.05, 0.35);
    group.add(jar, filling, lid, moon);
    return;
  }
  if (item.id.includes("carrot")) {
    const root = mesh(new ConeGeometry(0.22, 0.9, 14), color);
    root.rotation.z = Math.PI;
    root.position.y = -0.14;
    const leaves = mesh(new ConeGeometry(0.16, 0.42, 8), 0x68a65c);
    leaves.position.y = 0.48;
    group.add(root, leaves);
    return;
  }
  if (
    item.id.includes("pancake") ||
    item.id.includes("muffin") ||
    item.id.includes("pie") ||
    item.id.includes("cake") ||
    item.id.includes("tart")
  ) {
    for (let index = 0; index < 3; index += 1) {
      const layer = mesh(new CylinderGeometry(0.42 - index * 0.025, 0.44, 0.14, 18), color);
      layer.position.y = index * 0.14;
      group.add(layer);
    }
    const topping = mesh(
      item.id.includes("cake") ? new SphereGeometry(0.11, 10, 8) : new TorusGeometry(0.2, 0.04, 8, 16),
      (color ^ 0x2f1f27) & 0xffffff,
    );
    topping.position.y = 0.5;
    topping.rotation.x = Math.PI / 2;
    group.add(topping);
    return;
  }
  const bowl = mesh(new CylinderGeometry(0.42, 0.3, 0.22, 18), 0xf4dfbc);
  bowl.position.y = -0.12;
  group.add(bowl);
  for (let index = 0; index < 5; index += 1) {
    const bite = mesh(new SphereGeometry(0.15, 12, 8), color + index * 0x030303);
    bite.position.set((index - 2) * 0.16, 0.08 + (index % 2) * 0.1, (index % 2) * 0.08);
    group.add(bite);
  }
}

function addFurnitureModel(group: Group, item: FurnitureCatalogItem): void {
  const color = item.display.color;
  const scale = { tiny: 0.65, small: 0.82, medium: 1, large: 1.15 }[item.footprint];
  if (item.id === "nougatschleuse") {
    const cabinet = mesh(new BoxGeometry(0.9, 1.5, 0.62), color);
    cabinet.position.y = 0.78;
    const window = mesh(new BoxGeometry(0.57, 0.52, 0.04), 0x5f4038, 0.3);
    window.position.set(0, 1.02, 0.34);
    const chute = mesh(new BoxGeometry(0.5, 0.16, 0.42), 0xc18a60, 0.45);
    chute.position.set(0, 0.38, 0.43);
    chute.rotation.x = -0.22;
    const wheel = mesh(new TorusGeometry(0.2, 0.055, 8, 18), 0xe2bd69, 0.35);
    wheel.position.set(0.32, 0.72, 0.36);
    group.add(cabinet, window, chute, wheel);
  } else if (item.id === "picnic-bench") {
    const top = mesh(new BoxGeometry(1.45, 0.16, 0.7), color);
    top.position.y = 0.76;
    const seats = [-0.62, 0.62].map((z) => {
      const seat = mesh(new BoxGeometry(1.45, 0.13, 0.34), color - 0x10100c);
      seat.position.set(0, 0.46, z);
      return seat;
    });
    const legs = [-0.48, 0.48].flatMap((x) => [-0.38, 0.38].map((z) => {
      const leg = mesh(new BoxGeometry(0.13, 0.72, 0.13), 0x72513c);
      leg.position.set(x, 0.35, z);
      leg.rotation.z = x < 0 ? -0.12 : 0.12;
      return leg;
    }));
    group.add(top, ...seats, ...legs);
  } else if (item.id === "record-player") {
    const caseBody = mesh(new BoxGeometry(1.1, 0.35, 0.78), color);
    caseBody.position.y = 0.3;
    const record = mesh(new CylinderGeometry(0.31, 0.31, 0.035, 24), 0x31313b, 0.28);
    record.rotation.x = Math.PI / 2;
    record.position.set(-0.12, 0.5, 0.02);
    const label = mesh(new CylinderGeometry(0.09, 0.09, 0.045, 18), 0xe7a65e);
    label.rotation.x = Math.PI / 2;
    label.position.copy(record.position);
    const arm = mesh(new CylinderGeometry(0.025, 0.025, 0.48, 8), 0xcab98c, 0.3);
    arm.rotation.z = -0.72;
    arm.position.set(0.28, 0.58, 0.1);
    group.add(caseBody, record, label, arm);
  } else if (item.id.includes("cushion")) {
    const cushion = mesh(new SphereGeometry(0.62, 18, 12), color);
    cushion.scale.set(1.05, 0.38, 0.92);
    cushion.position.y = 0.24;
    group.add(cushion);
  } else if (item.id.includes("rug") || item.id.includes("mat") || item.id.includes("quilt")) {
    const textile = mesh(new CylinderGeometry(0.65, 0.65, 0.08, 24), color);
    textile.scale.set(1.15 * scale, 1, 0.72 * scale);
    group.add(textile);
  } else if (item.id.includes("lamp")) {
    const stem = mesh(new CylinderGeometry(0.035, 0.06, 1.25, 10), 0x7d6a5d, 0.45);
    stem.position.y = 0.62;
    const shade = mesh(new ConeGeometry(0.38, 0.52, 16, 1, true), color);
    shade.position.y = 1.18;
    group.add(stem, shade);
  } else if (
    item.id.includes("seat") ||
    item.id.includes("chair") ||
    item.id.includes("bench") ||
    item.id.includes("sofa")
  ) {
    const seat = mesh(new BoxGeometry(1.2 * scale, 0.3, 0.62), color);
    seat.position.y = 0.45;
    const back = mesh(new BoxGeometry(1.2 * scale, 0.86, 0.2), color - 0x101010);
    back.position.set(0, 0.82, -0.24);
    group.add(seat, back);
  } else if (item.id.includes("vase") || item.id.includes("planter")) {
    const pot = mesh(new CylinderGeometry(0.3, 0.24, 0.58, 16), color);
    pot.position.y = 0.3;
    const sprig = mesh(new IcosahedronGeometry(0.34, 1), 0x6fa267);
    sprig.position.y = 0.78;
    group.add(pot, sprig);
  } else if (item.id.includes("mirror") || item.id.includes("print")) {
    const frame = mesh(new TorusGeometry(0.55, 0.09, 8, 24), color, 0.5);
    frame.rotation.x = Math.PI / 2;
    frame.position.y = 0.62;
    const glass = mesh(new CylinderGeometry(0.47, 0.47, 0.04, 24), 0xa9d1d5, 0.28);
    glass.rotation.x = Math.PI / 2;
    glass.position.y = 0.62;
    group.add(frame, glass);
  } else {
    const body = mesh(new BoxGeometry(1.15 * scale, 0.7 * scale, 0.72 * scale), color);
    body.position.y = 0.38 * scale;
    const detail = mesh(new CylinderGeometry(0.17, 0.17, 0.1, 12), 0xf5d99c);
    detail.rotation.x = Math.PI / 2;
    detail.position.set(0, 0.42 * scale, 0.4 * scale);
    group.add(body, detail);
  }
  group.scale.setScalar(0.75);
}

function cosmeticVariation(item: WardrobeCosmeticCatalogItem): number {
  const slotItems = COSMETIC_CATALOG.filter(({ slot }) => slot === item.slot);
  const index = slotItems.findIndex(({ id }) => id === item.id);
  return Math.max(0, index);
}

export function createCosmeticModel(item: WardrobeCosmeticCatalogItem): Group {
  const group = new Group();
  const color = item.display.color;
  const variation = cosmeticVariation(item);
  group.userData.proceduralVariant = `${item.slot}-${variation}`;
  if (item.slot === "head") {
    const crown = variation % 3 === 2
      ? mesh(new ConeGeometry(0.5, 0.82 + variation * 0.025, 12), color)
      : mesh(new CylinderGeometry(0.4 + variation * 0.025, 0.58, 0.28 + variation * 0.035, 16 + variation), color);
    crown.position.y = 0.18 + variation * 0.025;
    const brim = mesh(
      new CylinderGeometry(0.62 + variation * 0.018, 0.62 + variation * 0.018, 0.07, 18 + variation),
      (color - 0x080808) & 0xffffff,
    );
    group.add(crown, brim);
    const accent = mesh(
      new TorusGeometry(0.4 + variation * 0.009, 0.035 + (variation % 2) * 0.012, 7, 16 + variation),
      (color ^ 0x3a2418) & 0xffffff,
    );
    accent.rotation.x = Math.PI / 2;
    accent.position.y = 0.18 + variation * 0.018;
    group.add(accent);
  } else if (item.slot === "ears") {
    for (const side of [-1, 1]) {
      const clip = variation % 3 === 0
        ? mesh(new SphereGeometry(0.16 + variation * 0.008, 10, 8), color)
        : variation % 3 === 1
          ? mesh(new ConeGeometry(0.17, 0.38 + variation * 0.02, 7 + variation), color)
          : mesh(new TorusGeometry(0.15 + variation * 0.006, 0.05, 7, 14 + variation), color);
      clip.scale.set(0.7 + variation * 0.025, 1.05, 0.5);
      clip.position.set(side * (0.3 + variation * 0.015), variation * 0.018, 0);
      clip.rotation.z = side * variation * 0.08;
      group.add(clip);
    }
  } else if (item.slot === "neck") {
    const collar = mesh(new TorusGeometry(0.43 + variation * 0.012, 0.075 + variation * 0.006, 8, 20 + variation), color);
    collar.rotation.x = Math.PI / 2;
    const charm = variation % 3 === 0
      ? mesh(new IcosahedronGeometry(0.13 + variation * 0.008, 1), (color + 0x181008) & 0xffffff)
      : variation % 3 === 1
        ? mesh(new SphereGeometry(0.13 + variation * 0.008, 10, 8), (color ^ 0x382010) & 0xffffff)
        : mesh(new ConeGeometry(0.14 + variation * 0.006, 0.3, 6 + variation), (color ^ 0x182838) & 0xffffff);
    charm.position.y = -0.4 - variation * 0.02;
    group.add(collar, charm);
  } else if (item.slot === "back") {
    const pack = variation % 2 === 0
      ? mesh(new CapsuleGeometry(0.38 + variation * 0.018, 0.36 + variation * 0.035, 6, 12 + variation), color)
      : mesh(new BoxGeometry(0.72 + variation * 0.04, 0.68 + variation * 0.025, 0.22), color);
    pack.scale.z = 0.5;
    const flap = mesh(new BoxGeometry(0.58 + variation * 0.025, 0.15 + variation * 0.012, 0.16), (color - 0x111111) & 0xffffff);
    flap.position.set(0, 0.18 + variation * 0.02, 0.18);
    group.add(pack, flap);
    if (variation >= 4) {
      for (const side of [-1, 1]) {
        const wing = mesh(new SphereGeometry(0.3 + variation * 0.012, 10, 8), (color ^ 0x24172c) & 0xffffff);
        wing.scale.set(0.65, 1.35, 0.24);
        wing.position.x = side * (0.42 + variation * 0.02);
        wing.rotation.z = side * 0.42;
        group.add(wing);
      }
    }
  } else if (item.slot === "face") {
    if (variation === 0 || variation === 3 || variation === 5 || variation === 7) {
      for (const side of [-1, 1]) {
        const lens = mesh(new TorusGeometry(0.2 + variation * 0.008, 0.035 + variation * 0.003, 7, 16 + variation), color, 0.35);
        lens.position.x = side * 0.23;
        group.add(lens);
      }
      const bridge = mesh(new BoxGeometry(0.16, 0.035, 0.035), color, 0.35);
      group.add(bridge);
    } else {
      for (let index = 0; index < 2 + (variation % 3); index += 1) {
        const mark = variation % 2 === 0
          ? mesh(new IcosahedronGeometry(0.07 + variation * 0.004, 0), color)
          : mesh(new SphereGeometry(0.075 + variation * 0.003, 8, 6), color);
        mark.position.set((index - 1) * 0.2, (index % 2) * 0.12 - 0.08, 0);
        mark.scale.z = 0.25;
        group.add(mark);
      }
    }
  } else {
    for (const side of [-1, 1]) {
      const paw = variation % 3 === 0
        ? mesh(new CapsuleGeometry(0.2 + variation * 0.007, 0.26, 5, 10), color)
        : variation % 3 === 1
          ? mesh(new BoxGeometry(0.37 + variation * 0.01, 0.32, 0.38), color)
          : mesh(new TorusGeometry(0.19 + variation * 0.005, 0.07, 7, 14 + variation), color);
      paw.position.x = side * 0.48;
      paw.rotation.z = side * (0.08 + variation * 0.025);
      group.add(paw);
    }
  }
  if (item.slot === "head" || item.slot === "ears" || item.slot === "neck" || item.slot === "back") {
    applyCosmeticModelAttachment(item.slot, group);
  } else {
    group.scale.setScalar(item.slot === "face" ? 0.58 : 0.7);
    group.userData.cosmeticSocket = item.slot;
  }
  return group;
}

export function createCatalogItemModel(item: ShopCatalogItem): Group {
  const group = item.kind === "cosmetic" ? createCosmeticModel(item) : new Group();
  if (item.kind === "food") addFoodModel(group, item);
  if (item.kind === "furniture") addFurnitureModel(group, item);
  group.name = `Catalog item: ${item.name}`;
  group.userData.catalogItemId = item.id;
  return group;
}

export const CURATED_CATALOG_ASSETS: Readonly<Record<string, string>> = Object.freeze({
  "hazelnut-nougat-spread": "assets/curated/kaykit-restaurant-bits/food-nougat-jar.glb",
  "cloudberry-layer-cake": "assets/curated/kenney-food-kit/food-cake.glb",
  "lemon-daisy-cake": "assets/curated/kenney-food-kit/food-cake.glb",
  "cocoa-acorn-cake": "assets/curated/kenney-food-kit/food-cake.glb",
  "celebration-carrot-cake": "assets/curated/kenney-food-kit/food-cake.glb",
  nougatschleuse: "assets/curated/kenney-mini-arcade/home-nougatschleuse.glb",
  "picnic-bench": "assets/curated/kenney-furniture-kit/home-picnic-bench.glb",
  "record-player": "assets/curated/kenney-furniture-kit/home-record-player.glb",
});

/**
 * Keeps the immediate procedural model on screen, then swaps in a matching
 * local curated GLB when that optional asset has been installed.
 */
export async function hydrateCuratedCatalogModel(
  item: ShopCatalogItem,
  target: Group,
): Promise<boolean> {
  const path = CURATED_CATALOG_ASSETS[item.id];
  if (!path || typeof document === "undefined") return false;
  try {
    const gltf = await new GLTFLoader().loadAsync(new URL(path, document.baseURI).href);
    if (target.parent === null) {
      disposeObjectTree(gltf.scene);
      return false;
    }
    for (const child of [...target.children]) disposeObjectTree(child);
    const bounds = new Box3().setFromObject(gltf.scene);
    const size = bounds.getSize(new Vector3());
    const center = bounds.getCenter(new Vector3());
    const largest = Math.max(size.x, size.y, size.z, 0.001);
    gltf.scene.position.sub(center);
    gltf.scene.scale.setScalar(1.2 / largest);
    gltf.scene.name = `curated:${item.id}`;
    target.add(gltf.scene);
    target.userData.assetSource = "curated";
    return true;
  } catch {
    target.userData.assetSource = "procedural";
    return false;
  }
}

export function createDisplayFixture(kind: DisplayFixture, color: number): Group {
  const group = new Group();
  if (kind === "shelf") {
    const board = mesh(new BoxGeometry(1.35, 0.12, 0.72), color);
    board.position.y = -0.08;
    const back = mesh(new BoxGeometry(1.35, 0.88, 0.1), color - 0x101010);
    back.position.set(0, 0.33, -0.33);
    group.add(board, back);
  } else if (kind === "pedestal") {
    const plinth = mesh(new CylinderGeometry(0.62, 0.72, 0.62, 18), color);
    plinth.position.y = -0.34;
    group.add(plinth);
  } else {
    const bar = mesh(new CylinderGeometry(0.045, 0.045, 1.3, 10), color, 0.45);
    bar.rotation.z = Math.PI / 2;
    const stem = mesh(new CylinderGeometry(0.05, 0.06, 1.15, 10), color - 0x151515, 0.45);
    stem.position.y = -0.55;
    group.add(bar, stem);
  }
  return group;
}

const SHOPKEEPER_STYLE: Readonly<
  Record<ShopId, { readonly name: string; readonly body: number; readonly apron: number; readonly species: string }>
> = {
  "carrot-market": { name: "Pip Parsnip", body: 0x9e7554, apron: 0x77a66b, species: "hedgehog" },
  "cloud-boutique": { name: "Moss Marigold", body: 0x87a378, apron: 0xe0b36d, species: "tortoise" },
  "fluff-salon": { name: "Lumi Larkspur", body: 0xe8d6c1, apron: 0xb59bd0, species: "alpaca" },
};

export class ProceduralShopkeeper {
  readonly root = new Group();
  readonly name: string;
  readonly greeting: string;
  private readonly arm: Group;
  private greetingAge = Number.POSITIVE_INFINITY;

  constructor(shopId: ShopId) {
    const style = SHOPKEEPER_STYLE[shopId];
    this.name = style.name;
    this.greeting =
      shopId === "carrot-market"
        ? "Welcome! Every snack is fresh and always in stock."
        : shopId === "cloud-boutique"
          ? "Come in! Let’s find something cozy for your rooms."
          : "Hello, lovely! Try on anything—reverting is always one tap.";
    this.root.name = `${style.name}, ${style.species} shopkeeper`;

    const body = mesh(new SphereGeometry(0.72, 20, 16), style.body);
    body.scale.set(0.86, 1.2, 0.74);
    body.position.y = 1.05;
    const head = mesh(new SphereGeometry(0.53, 20, 16), style.body + 0x10100b);
    head.position.y = 2.03;
    const apron = mesh(new BoxGeometry(0.92, 0.92, 0.12), style.apron);
    apron.position.set(0, 0.96, 0.62);
    apron.rotation.x = -0.08;
    this.arm = new Group();
    const forearm = mesh(new CapsuleGeometry(0.12, 0.65, 5, 10), style.body);
    forearm.position.y = -0.36;
    this.arm.position.set(0.66, 1.5, 0);
    this.arm.rotation.z = -0.5;
    this.arm.add(forearm);
    const eyes = [-0.19, 0.19].map((x) => {
      const eye = mesh(new SphereGeometry(0.06, 10, 8), 0x40373a);
      eye.position.set(x, 2.1, 0.48);
      return eye;
    });
    this.root.add(body, head, apron, this.arm, ...eyes);

    if (shopId === "carrot-market") {
      for (let index = 0; index < 7; index += 1) {
        const spine = mesh(new ConeGeometry(0.1, 0.52, 7), 0x76523f);
        spine.position.set((index - 3) * 0.17, 1.4 + (index % 2) * 0.18, -0.52);
        spine.rotation.x = -0.5;
        this.root.add(spine);
      }
    } else if (shopId === "cloud-boutique") {
      const shell = mesh(new SphereGeometry(0.65, 18, 14), 0x7f8b62);
      shell.scale.z = 0.48;
      shell.position.set(0, 1.08, -0.58);
      this.root.add(shell);
    } else {
      const tuft = mesh(new IcosahedronGeometry(0.36, 1), 0xf4eadc);
      tuft.position.y = 2.5;
      this.root.add(tuft);
    }
  }

  greet(): string {
    this.greetingAge = 0;
    return `${this.name}: ${this.greeting}`;
  }

  update(deltaSeconds: number, elapsedSeconds: number): void {
    this.greetingAge += deltaSeconds;
    const wave = this.greetingAge < 2.4 ? Math.sin(this.greetingAge * 8) * 0.38 : 0;
    this.arm.rotation.z = -0.5 + wave;
    this.root.position.y = Math.sin(elapsedSeconds * 1.8) * 0.025;
  }
}

export function disposeObjectTree(root: Object3D): void {
  const disposed = new Set<{ dispose(): void }>();
  root.traverse((child) => {
    const renderable = child as Object3D & {
      geometry?: { dispose(): void };
      material?: Material | Material[];
    };
    if (renderable.geometry) disposed.add(renderable.geometry);
    const materials = Array.isArray(renderable.material)
      ? renderable.material
      : renderable.material
        ? [renderable.material]
        : [];
    for (const value of materials) {
      disposed.add(value);
      for (const property of Object.values(value)) {
        if (property instanceof Texture) disposed.add(property);
      }
    }
  });
  root.removeFromParent();
  for (const resource of disposed) resource.dispose();
}
