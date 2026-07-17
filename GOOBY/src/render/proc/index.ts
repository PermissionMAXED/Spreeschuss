import {
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  SphereGeometry,
} from "three";
import type { AssetKey, AssetLoader, AssetValue, LoadedAsset } from "../../core/contracts/assets";
import type { Object3D } from "three";

const mat = (color: number, roughness = 0.8): MeshStandardMaterial =>
  new MeshStandardMaterial({ color, roughness, metalness: roughness < 0.5 ? 0.25 : 0 });

const mesh = (
  geometry: BoxGeometry | ConeGeometry | CylinderGeometry | IcosahedronGeometry | PlaneGeometry | SphereGeometry,
  color: number,
): Mesh => new Mesh(geometry, mat(color));

function furniture(key: AssetKey): Object3D {
  const group = new Group();
  if (key === "furniture.sofa" || key === "furniture.armchair") {
    const width = key === "furniture.sofa" ? 2.6 : 1.3;
    const seat = mesh(new BoxGeometry(width, 0.55, 1), 0xe79b77);
    seat.position.y = 0.65;
    const back = mesh(new BoxGeometry(width, 1.35, 0.35), 0xd98568);
    back.position.set(0, 1.25, 0.38);
    group.add(seat, back);
    for (const x of [-width / 2, width / 2]) {
      const arm = mesh(new BoxGeometry(0.3, 0.75, 1.05), 0xd98568);
      arm.position.set(x, 0.82, 0);
      group.add(arm);
    }
  } else if (key === "furniture.coffee-table") {
    const top = mesh(new CylinderGeometry(1, 1.05, 0.18, 20), 0xa96d4b);
    top.position.y = 0.75;
    const foot = mesh(new CylinderGeometry(0.16, 0.25, 0.7, 10), 0x825039);
    foot.position.y = 0.36;
    group.add(top, foot);
  } else if (key === "furniture.lamp") {
    const pole = mesh(new CylinderGeometry(0.05, 0.08, 2.4, 10), 0x6f625d);
    pole.position.y = 1.2;
    const shade = mesh(new ConeGeometry(0.52, 0.72, 20, 1, true), 0xffd17d);
    shade.position.y = 2.3;
    group.add(pole, shade);
  } else if (key === "furniture.rug") {
    const rug = mesh(new CylinderGeometry(1.7, 1.7, 0.05, 32), 0x93c7b2);
    rug.scale.z = 0.68;
    group.add(rug);
  } else if (key === "furniture.bookshelf") {
    const frame = mesh(new BoxGeometry(1.4, 2.5, 0.35), 0xa96d4b);
    frame.position.y = 1.25;
    group.add(frame);
    for (const [index, color] of [0xf3bd62, 0x8db7cb, 0xe7837d, 0x89b986].entries()) {
      const book = mesh(new BoxGeometry(0.2, 0.65 + (index % 2) * 0.12, 0.2), color);
      book.position.set(-0.42 + index * 0.28, 1.1, -0.25);
      group.add(book);
    }
  } else {
    const body = mesh(new BoxGeometry(2.2, 1, 1.1), 0xe8b888);
    body.position.y = 0.5;
    group.add(body);
  }
  return group;
}

function carrot(): Object3D {
  const group = new Group();
  const root = mesh(new ConeGeometry(0.2, 1.05, 16), 0xf28b32);
  root.rotation.z = Math.PI;
  root.position.y = -0.45;
  group.add(root);
  for (const angle of [-0.35, 0, 0.35]) {
    const leaf = mesh(new ConeGeometry(0.08, 0.5, 9), 0x65a84d);
    leaf.position.set(Math.sin(angle) * 0.13, 0.2, 0);
    leaf.rotation.z = angle;
    group.add(leaf);
  }
  return group;
}

function car(): Object3D {
  const group = new Group();
  const body = mesh(new BoxGeometry(2.3, 0.7, 1.25), 0xf0a04b);
  body.position.y = 0.72;
  const cabin = mesh(new BoxGeometry(1.2, 0.7, 1.05), 0x9ad5e3);
  cabin.position.set(0.15, 1.35, 0);
  group.add(body, cabin);
  for (const x of [-0.75, 0.75]) {
    for (const z of [-0.68, 0.68]) {
      const wheel = mesh(new CylinderGeometry(0.3, 0.3, 0.18, 16), 0x4d4650);
      wheel.rotation.x = Math.PI / 2;
      wheel.position.set(x, 0.42, z);
      group.add(wheel);
    }
  }
  return group;
}

function building(key: AssetKey): Object3D {
  const colors: Readonly<Record<string, number>> = {
    "building.carrot-market": 0xf3a654,
    "building.cloud-boutique": 0xa9c7ea,
    "building.fluff-salon": 0xe9a8c6,
  };
  const group = new Group();
  const body = mesh(new BoxGeometry(3.2, 3, 2.2), colors[key] ?? 0xd5b58c);
  body.position.y = 1.5;
  const awning = mesh(new BoxGeometry(3.5, 0.25, 0.8), 0xfff2d0);
  awning.position.set(0, 2.15, 1.2);
  const door = mesh(new BoxGeometry(0.85, 1.6, 0.12), 0x765546);
  door.position.set(0, 0.82, 1.16);
  group.add(body, awning, door);
  return group;
}

export function createProceduralAsset(key: AssetKey): Object3D {
  if (key.startsWith("furniture.")) return furniture(key);
  if (key.startsWith("building.")) return building(key);
  if (key === "food.carrot" || key === "icon.carrot") return carrot();
  if (key === "city.car") return car();
  if (key === "city.tree") {
    const group = new Group();
    const trunk = mesh(new CylinderGeometry(0.15, 0.22, 1.5, 10), 0x8d6545);
    trunk.position.y = 0.75;
    const crown = mesh(new IcosahedronGeometry(0.85, 1), 0x79ad6b);
    crown.position.y = 1.9;
    group.add(trunk, crown);
    return group;
  }
  if (key === "city.road") return mesh(new PlaneGeometry(4, 8), 0x746f72);
  if (key.startsWith("particle.") || key.startsWith("icon.")) {
    const color = key.includes("heart") ? 0xf47d8e : key.includes("bubble") ? 0x8edbe8 : 0xffd16c;
    return mesh(new IcosahedronGeometry(0.14, 1), color);
  }
  if (key.startsWith("food.")) return mesh(new SphereGeometry(0.35, 16, 12), 0xe6a34e);
  if (key === "city.lamp") return furniture("furniture.lamp");
  return mesh(new SphereGeometry(0.45, 16, 12), 0xf4c78f);
}

export type VendoredResolver = (key: AssetKey) => Promise<AssetValue | null>;

export class FallbackAssetLoader implements AssetLoader {
  constructor(private readonly resolveVendored?: VendoredResolver) {}

  async load<T extends AssetValue = AssetValue>(key: AssetKey): Promise<LoadedAsset<T>> {
    try {
      const vendored = await this.resolveVendored?.(key);
      if (vendored) return { key, value: vendored as T, source: "vendored" };
    } catch (error) {
      return {
        key,
        value: createProceduralAsset(key) as T,
        source: "procedural",
        warning: error instanceof Error ? error.message : "Vendored asset could not be loaded",
      };
    }
    return { key, value: createProceduralAsset(key) as T, source: "procedural" };
  }

  async preload(keys: readonly AssetKey[]): Promise<readonly LoadedAsset[]> {
    return Promise.all(keys.map(async (key) => this.load(key)));
  }

  dispose(): void {
    // Returned scene objects are owned and disposed by their scene ResourceTracker.
  }
}
