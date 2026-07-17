import {
  BoxGeometry,
  CapsuleGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  TorusGeometry,
  type Material,
  type Object3D,
} from "three";
import type {
  CatalogItem,
  CosmeticCatalogItem,
  DisplayFixture,
  FurnitureCatalogItem,
} from "../../data/catalog";
import type { ShopId } from "../../core/contracts/scenes";

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

function addFoodModel(group: Group, item: CatalogItem): void {
  const color = item.display.color;
  if (item.id.includes("carrot")) {
    const root = mesh(new ConeGeometry(0.22, 0.9, 14), color);
    root.rotation.z = Math.PI;
    root.position.y = -0.14;
    const leaves = mesh(new ConeGeometry(0.16, 0.42, 8), 0x68a65c);
    leaves.position.y = 0.48;
    group.add(root, leaves);
    return;
  }
  if (item.id.includes("pancake") || item.id.includes("muffin") || item.id.includes("pie")) {
    for (let index = 0; index < 3; index += 1) {
      const layer = mesh(new CylinderGeometry(0.42 - index * 0.025, 0.44, 0.14, 18), color);
      layer.position.y = index * 0.14;
      group.add(layer);
    }
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
  if (item.id.includes("cushion")) {
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

export function createCosmeticModel(item: CosmeticCatalogItem): Group {
  const group = new Group();
  const color = item.display.color;
  if (item.slot === "head") {
    const crown = mesh(new CylinderGeometry(0.48, 0.58, 0.3, 20), color);
    crown.position.y = 0.18;
    const brim = mesh(new CylinderGeometry(0.72, 0.72, 0.08, 24), color - 0x080808);
    group.add(crown, brim);
  } else if (item.slot === "ears") {
    for (const side of [-1, 1]) {
      const clip = mesh(new SphereGeometry(0.2, 12, 10), color);
      clip.scale.set(0.7, 1.15, 0.5);
      clip.position.x = side * 0.34;
      group.add(clip);
    }
  } else if (item.slot === "neck") {
    const collar = mesh(new TorusGeometry(0.48, 0.11, 10, 24), color);
    collar.rotation.x = Math.PI / 2;
    const charm = mesh(new IcosahedronGeometry(0.16, 1), color + 0x181008);
    charm.position.y = -0.48;
    group.add(collar, charm);
  } else {
    const pack = mesh(new CapsuleGeometry(0.46, 0.45, 6, 14), color);
    pack.scale.set(1, 1, 0.38);
    const flap = mesh(new BoxGeometry(0.7, 0.22, 0.18), color - 0x111111);
    flap.position.set(0, 0.22, 0.18);
    group.add(pack, flap);
  }
  return group;
}

export function createCatalogItemModel(item: CatalogItem): Group {
  const group = item.kind === "cosmetic" ? createCosmeticModel(item) : new Group();
  if (item.kind === "food") addFoodModel(group, item);
  if (item.kind === "furniture") addFurnitureModel(group, item);
  group.name = `Catalog item: ${item.name}`;
  group.userData.catalogItemId = item.id;
  return group;
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
  root.traverse((child) => {
    const renderable = child as Object3D & {
      geometry?: { dispose(): void };
      material?: Material | Material[];
    };
    renderable.geometry?.dispose();
    if (Array.isArray(renderable.material)) renderable.material.forEach((value) => value.dispose());
    else renderable.material?.dispose();
  });
  root.removeFromParent();
}
