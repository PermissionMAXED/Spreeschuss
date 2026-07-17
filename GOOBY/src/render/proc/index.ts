import {
  BoxGeometry,
  CapsuleGeometry,
  ConeGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  RingGeometry,
  Shape,
  SphereGeometry,
  TorusGeometry,
} from "three";
import type {
  BufferGeometry,
  Object3D,
} from "three";
import type { AssetKey, AssetLoader, AssetValue, LoadedAsset } from "../../core/contracts/assets";

type Vec3 = readonly [number, number, number];
type AudioAssetKey = Extract<AssetKey, `audio.${string}`>;

const COLORS = {
  cream: 0xffe0ac,
  creamLight: 0xfff2ce,
  apricot: 0xf2a36f,
  coral: 0xe97f72,
  blush: 0xf5a0a8,
  rose: 0xd95d72,
  honey: 0xf4bf63,
  butter: 0xffd97b,
  mint: 0x82bfa3,
  leaf: 0x6da85e,
  sky: 0x8ec9d6,
  blue: 0x6fa8c4,
  lavender: 0xaa94ca,
  wood: 0xa96e4d,
  darkWood: 0x76503f,
  ink: 0x4f4650,
  road: 0x6c6870,
  white: 0xfff8e8,
} as const;

const material = (
  color: number,
  options: Partial<{
    roughness: number;
    metalness: number;
    transparent: boolean;
    opacity: number;
    emissive: number;
  }> = {},
): MeshStandardMaterial => new MeshStandardMaterial({
  color,
  roughness: options.roughness ?? 0.78,
  metalness: options.metalness ?? 0,
  transparent: options.transparent ?? false,
  opacity: options.opacity ?? 1,
  emissive: options.emissive ?? 0x000000,
});

const part = (
  geometry: BufferGeometry,
  color: number,
  options?: Parameters<typeof material>[1],
): Mesh => new Mesh(geometry, material(color, options));

function place(object: Object3D, position: Vec3, rotation: Vec3 = [0, 0, 0]): Object3D {
  object.position.set(...position);
  object.rotation.set(...rotation);
  return object;
}

function box(
  size: Vec3,
  color: number,
  position: Vec3,
  rotation: Vec3 = [0, 0, 0],
): Mesh {
  return place(part(new BoxGeometry(...size), color), position, rotation) as Mesh;
}

function cylinder(
  radii: readonly [number, number],
  height: number,
  color: number,
  position: Vec3,
  radialSegments = 16,
  rotation: Vec3 = [0, 0, 0],
): Mesh {
  return place(
    part(new CylinderGeometry(radii[0], radii[1], height, radialSegments), color),
    position,
    rotation,
  ) as Mesh;
}

function sphere(radius: number, color: number, position: Vec3, scale: Vec3 = [1, 1, 1]): Mesh {
  const result = place(part(new SphereGeometry(radius, 18, 13), color), position) as Mesh;
  result.scale.set(...scale);
  return result;
}

function capsule(
  radius: number,
  length: number,
  color: number,
  position: Vec3,
  rotation: Vec3 = [0, 0, 0],
): Mesh {
  return place(part(new CapsuleGeometry(radius, length, 7, 14), color), position, rotation) as Mesh;
}

function finish(group: Group, key: AssetKey, style: string): Object3D {
  group.name = `procedural:${key}`;
  group.userData.assetKey = key;
  group.userData.procedural = true;
  group.userData.style = style;
  group.traverse((object) => {
    if (object instanceof Mesh) {
      object.castShadow = true;
      object.receiveShadow = true;
    }
  });
  return group;
}

function goobyBody(): Group {
  const group = new Group();
  group.add(
    sphere(0.82, COLORS.cream, [0, 0.93, 0], [1.04, 1.18, 0.9]),
    sphere(0.58, COLORS.creamLight, [0, 1.91, 0.02], [1.05, 0.92, 0.94]),
    sphere(0.5, COLORS.creamLight, [0, 0.91, 0.7], [0.8, 0.95, 0.18]),
    sphere(0.21, COLORS.cream, [-0.57, 0.28, 0.12], [1.25, 0.75, 1.15]),
    sphere(0.21, COLORS.cream, [0.57, 0.28, 0.12], [1.25, 0.75, 1.15]),
    sphere(0.25, COLORS.white, [0, 0.93, -0.74], [1, 1, 0.8]),
    capsule(0.21, 0.83, COLORS.cream, [-0.29, 2.65, -0.02], [0, 0, -0.14]),
    capsule(0.21, 0.76, COLORS.cream, [0.28, 2.62, -0.02], [0, 0, 0.2]),
    capsule(0.1, 0.62, COLORS.blush, [-0.29, 2.66, 0.18], [0, 0, -0.14]),
    capsule(0.1, 0.56, COLORS.blush, [0.28, 2.63, 0.18], [0, 0, 0.2]),
    sphere(0.17, COLORS.creamLight, [-0.25, 1.7, 0.49], [1.2, 0.82, 0.7]),
    sphere(0.17, COLORS.creamLight, [0.25, 1.7, 0.49], [1.2, 0.82, 0.7]),
    sphere(0.085, COLORS.apricot, [0, 1.82, 0.58], [1.1, 0.8, 0.7]),
    box([0.13, 0.2, 0.06], COLORS.white, [-0.07, 1.58, 0.56], [0, 0, -0.03]),
    box([0.13, 0.2, 0.06], COLORS.white, [0.07, 1.58, 0.56], [0, 0, 0.03]),
  );
  // A tiny wearable bow makes the fallback useful to cosmetic previews too.
  group.add(
    sphere(0.2, COLORS.coral, [0.48, 2.28, 0.3], [1.35, 0.72, 0.45]),
    sphere(0.2, COLORS.coral, [0.78, 2.28, 0.3], [1.35, 0.72, 0.45]),
    sphere(0.11, COLORS.honey, [0.63, 2.28, 0.4], [1, 1, 0.5]),
  );
  return group;
}

function goobyEye(): Group {
  const group = new Group();
  group.add(
    sphere(0.24, COLORS.white, [0, 0, 0], [1, 1.1, 0.72]),
    sphere(0.135, COLORS.ink, [0, -0.01, 0.17], [1, 1.1, 0.58]),
    sphere(0.047, COLORS.white, [-0.045, 0.055, 0.255], [1, 1, 0.5]),
  );
  return group;
}

function carrot(): Group {
  const group = new Group();
  const root = part(new ConeGeometry(0.25, 1.2, 18), 0xf28b32);
  root.position.y = -0.35;
  root.rotation.z = Math.PI;
  group.add(root);
  for (const [x, angle] of [[-0.11, -0.32], [0, 0], [0.11, 0.32]] as const) {
    group.add(capsule(0.045, 0.38, COLORS.leaf, [x, 0.43, 0], [0, 0, angle]));
  }
  group.add(
    box([0.13, 0.025, 0.02], 0xd66f2a, [-0.13, -0.16, 0.21], [0, 0, -0.24]),
    box([0.11, 0.025, 0.02], 0xd66f2a, [0.1, -0.43, 0.16], [0, 0, 0.25]),
  );
  return group;
}

function apple(): Group {
  const group = new Group();
  group.add(
    sphere(0.42, 0xe35f5b, [-0.16, 0, 0], [0.92, 1, 0.94]),
    sphere(0.42, 0xe35f5b, [0.16, 0, 0], [0.92, 1, 0.94]),
    cylinder([0.045, 0.06], 0.35, COLORS.darkWood, [0.02, 0.47, 0], 10, [0, 0, 0.18]),
  );
  const leaf = part(new SphereGeometry(0.16, 12, 8), COLORS.leaf);
  leaf.scale.set(1.5, 0.35, 0.75);
  leaf.position.set(0.19, 0.5, 0);
  leaf.rotation.z = -0.42;
  group.add(leaf);
  return group;
}

function pancake(): Group {
  const group = new Group();
  for (let index = 0; index < 4; index += 1) {
    group.add(cylinder([0.48 - index * 0.015, 0.5], 0.13, 0xe6a451, [0, index * 0.13, 0], 22));
  }
  group.add(
    cylinder([0.37, 0.37], 0.035, 0xb96d3d, [0, 0.54, 0], 22),
    box([0.2, 0.08, 0.18], COLORS.butter, [0, 0.59, 0], [0, 0.22, 0]),
    sphere(0.08, 0xa95d36, [0.42, 0.29, 0.05], [0.22, 1.6, 0.35]),
  );
  return group;
}

function sofa(width = 2.55): Group {
  const group = new Group();
  group.add(
    box([width, 0.5, 1.02], COLORS.coral, [0, 0.62, 0]),
    box([width, 1.08, 0.28], 0xd97067, [0, 1.22, -0.39], [-0.1, 0, 0]),
    box([0.3, 0.76, 1.08], 0xd97067, [-width / 2, 0.82, 0]),
    box([0.3, 0.76, 1.08], 0xd97067, [width / 2, 0.82, 0]),
  );
  const cushions = width > 2 ? [-0.58, 0.58] : [0];
  for (const x of cushions) {
    group.add(
      box([width > 2 ? 1.05 : 0.78, 0.22, 0.77], 0xeea07f, [x, 0.91, 0.06], [-0.05, 0, 0]),
      box([width > 2 ? 1.02 : 0.76, 0.72, 0.18], 0xe88e78, [x, 1.35, -0.19], [-0.12, 0, 0]),
    );
  }
  for (const x of [-width / 2 + 0.24, width / 2 - 0.24]) {
    group.add(cylinder([0.055, 0.075], 0.27, COLORS.darkWood, [x, 0.135, -0.28], 9));
  }
  if (width > 2) {
    group.add(sphere(0.28, COLORS.mint, [0.82, 1.32, 0.08], [1, 1, 0.35]));
  }
  return group;
}

function coffeeTable(): Group {
  const group = new Group();
  group.add(
    cylinder([1.02, 1.06], 0.16, COLORS.wood, [0, 0.76, 0], 24),
    cylinder([0.67, 0.7], 0.09, 0x8c5c43, [0, 0.25, 0], 20),
  );
  for (const [x, z] of [[-0.58, -0.38], [0.58, -0.38], [-0.58, 0.38], [0.58, 0.38]] as const) {
    group.add(cylinder([0.06, 0.075], 0.58, COLORS.darkWood, [x, 0.44, z], 8));
  }
  group.add(cylinder([0.23, 0.26], 0.055, COLORS.sky, [0.25, 0.88, 0], 18));
  return group;
}

function rug(): Group {
  const group = new Group();
  const base = part(new CylinderGeometry(1.7, 1.7, 0.055, 36), COLORS.mint);
  base.scale.z = 0.68;
  const inset = part(new CylinderGeometry(1.42, 1.42, 0.063, 36), COLORS.creamLight);
  inset.scale.z = 0.68;
  inset.position.y = 0.012;
  const center = part(new CylinderGeometry(0.72, 0.72, 0.071, 32), COLORS.coral);
  center.scale.z = 0.68;
  center.position.y = 0.02;
  group.add(base, inset, center);
  return group;
}

function floorLamp(street = false): Group {
  const group = new Group();
  const metal = street ? COLORS.ink : 0x756461;
  group.add(
    cylinder([0.32, 0.38], 0.1, metal, [0, 0.05, 0], 16),
    cylinder([0.045, 0.07], street ? 2.6 : 2.25, metal, [0, street ? 1.35 : 1.17, 0], 10),
  );
  if (street) {
    const arm = part(new TorusGeometry(0.38, 0.045, 8, 18, Math.PI / 2), metal);
    arm.position.set(0.37, 2.62, 0);
    arm.rotation.set(0, 0, Math.PI / 2);
    group.add(
      arm,
      cylinder([0.2, 0.12], 0.28, COLORS.butter, [0.76, 2.66, 0], 16, [0, 0, Math.PI]),
    );
  } else {
    const shade = part(new ConeGeometry(0.52, 0.68, 22, 1, true), COLORS.butter, {
      emissive: 0x332000,
    });
    shade.position.y = 2.25;
    group.add(shade, sphere(0.11, 0xfff0a8, [0, 2.24, 0]));
  }
  return group;
}

function bookshelf(): Group {
  const group = new Group();
  group.add(
    box([1.5, 2.5, 0.22], COLORS.wood, [0, 1.25, -0.22]),
    box([0.16, 2.55, 0.5], COLORS.darkWood, [-0.68, 1.27, 0]),
    box([0.16, 2.55, 0.5], COLORS.darkWood, [0.68, 1.27, 0]),
  );
  for (const y of [0.16, 0.82, 1.48, 2.14]) {
    group.add(box([1.4, 0.12, 0.54], COLORS.darkWood, [0, y, 0]));
  }
  const bookColors = [COLORS.coral, COLORS.honey, COLORS.sky, COLORS.mint, COLORS.lavender];
  for (let shelf = 0; shelf < 3; shelf += 1) {
    for (let index = 0; index < 5; index += 1) {
      const height = 0.35 + ((index + shelf) % 3) * 0.06;
      group.add(box(
        [0.16, height, 0.28],
        bookColors[(index + shelf) % bookColors.length] ?? COLORS.coral,
        [-0.43 + index * 0.22, 0.42 + shelf * 0.66, 0.12],
        [0, 0, index === 4 ? -0.1 : 0],
      ));
    }
  }
  return group;
}

function bed(): Group {
  const group = new Group();
  group.add(
    box([2.1, 0.35, 3.25], COLORS.wood, [0, 0.28, 0]),
    box([1.92, 0.32, 3.02], COLORS.creamLight, [0, 0.56, 0]),
    box([2.1, 1.35, 0.22], COLORS.darkWood, [0, 1.0, -1.55]),
    box([1.94, 0.13, 1.75], COLORS.coral, [0, 0.76, 0.52]),
    sphere(0.4, COLORS.white, [-0.48, 0.83, -0.88], [1.45, 0.48, 0.9]),
    sphere(0.4, COLORS.white, [0.48, 0.83, -0.88], [1.45, 0.48, 0.9]),
  );
  for (const x of [-0.85, 0.85]) {
    for (const z of [-1.35, 1.35]) group.add(box([0.13, 0.42, 0.13], COLORS.darkWood, [x, 0.12, z]));
  }
  return group;
}

function bathtub(): Group {
  const group = new Group();
  group.add(
    box([2.35, 0.72, 1.35], COLORS.white, [0, 0.43, 0]),
    box([1.86, 0.5, 0.88], COLORS.sky, [0, 0.72, 0]),
    box([1.68, 0.22, 0.72], 0xb8e5e7, [0, 0.89, 0]),
    cylinder([0.055, 0.055], 0.64, 0xb7a99f, [0.72, 1.18, -0.48], 10),
  );
  const faucet = part(new TorusGeometry(0.22, 0.045, 8, 14, Math.PI), 0xb7a99f, {
    metalness: 0.55,
    roughness: 0.3,
  });
  faucet.position.set(0.5, 1.48, -0.48);
  faucet.rotation.y = Math.PI / 2;
  group.add(faucet);
  for (const [x, z, radius] of [[-0.5, 0, 0.12], [0.15, 0.12, 0.09], [0.55, -0.05, 0.1]] as const) {
    group.add(sphere(radius, 0xd8f8f5, [x, 1.02, z], [1, 1, 1],));
  }
  return group;
}

function kitchenCounter(): Group {
  const group = new Group();
  group.add(
    box([2.6, 1.25, 0.82], COLORS.creamLight, [0, 0.63, 0]),
    box([2.72, 0.14, 0.94], COLORS.wood, [0, 1.3, 0]),
    box([0.09, 1.08, 0.08], COLORS.wood, [0, 0.65, 0.43]),
    box([1.1, 0.78, 0.07], 0xf4c89f, [-0.63, 0.69, 0.44]),
    box([1.1, 0.78, 0.07], 0xf4c89f, [0.63, 0.69, 0.44]),
  );
  group.add(
    box([0.48, 0.05, 0.52], 0x9ac8ca, [0.55, 1.39, 0]),
    cylinder([0.035, 0.035], 0.38, 0xaaa3a0, [0.55, 1.58, -0.19], 9),
    box([0.26, 0.045, 0.045], 0xaaa3a0, [0.67, 1.74, -0.19]),
    cylinder([0.025, 0.025], 0.18, 0xaaa3a0, [0.8, 1.66, -0.19], 8),
    box([0.32, 0.055, 0.06], COLORS.darkWood, [-0.63, 0.72, 0.49]),
    box([0.32, 0.055, 0.06], COLORS.darkWood, [0.63, 0.72, 0.49]),
  );
  return group;
}

function road(): Group {
  const group = new Group();
  group.add(
    box([4.8, 0.16, 8], COLORS.road, [0, 0, 0]),
    box([0.62, 0.28, 8], 0xcbb899, [-2.7, 0.08, 0]),
    box([0.62, 0.28, 8], 0xcbb899, [2.7, 0.08, 0]),
  );
  for (const z of [-3, -1, 1, 3]) group.add(box([0.1, 0.025, 0.9], COLORS.butter, [0, 0.1, z]));
  for (const x of [-1.5, -0.75, 0, 0.75, 1.5]) {
    group.add(box([0.38, 0.025, 1.3], COLORS.white, [x, 0.1, -2.7]));
  }
  return group;
}

function tree(): Group {
  const group = new Group();
  group.add(
    cylinder([0.2, 0.29], 1.65, COLORS.wood, [0, 0.82, 0], 11),
    sphere(0.78, COLORS.leaf, [0, 1.95, 0], [1.1, 0.9, 1]),
    sphere(0.6, COLORS.mint, [-0.48, 1.76, 0.04], [1, 0.85, 1]),
    sphere(0.62, 0x78af70, [0.48, 1.75, -0.03], [1, 0.92, 1]),
    sphere(0.5, 0x91c47c, [0.05, 2.39, 0], [1, 0.8, 1]),
  );
  for (const [x, y, z, color] of [
    [-0.42, 2.18, 0.5, COLORS.blush],
    [0.38, 1.98, 0.56, COLORS.butter],
    [0.12, 2.46, 0.39, COLORS.white],
  ] as const) {
    group.add(sphere(0.085, color, [x, y, z], [1.4, 0.55, 0.45]));
  }
  return group;
}

function car(): Group {
  const group = new Group();
  group.add(
    box([2.5, 0.62, 1.28], COLORS.apricot, [0, 0.68, 0]),
    box([1.25, 0.62, 1.05], COLORS.cream, [0.18, 1.26, 0]),
    box([0.5, 0.42, 1.18], COLORS.creamLight, [-1.12, 0.76, 0]),
    box([0.44, 0.46, 0.82], COLORS.sky, [-0.31, 1.31, 0]),
    box([0.44, 0.46, 0.82], COLORS.sky, [0.67, 1.31, 0]),
    capsule(0.1, 0.34, COLORS.cream, [-0.2, 1.79, -0.27], [0, 0, -0.12]),
    capsule(0.1, 0.34, COLORS.cream, [0.5, 1.79, -0.27], [0, 0, 0.12]),
    sphere(0.07, COLORS.ink, [-1.37, 0.78, -0.35]),
    sphere(0.07, COLORS.ink, [-1.37, 0.78, 0.35]),
    sphere(0.05, COLORS.blush, [-1.39, 0.63, 0]),
  );
  for (const x of [-0.78, 0.82]) {
    for (const z of [-0.69, 0.69]) {
      group.add(cylinder([0.29, 0.29], 0.19, COLORS.ink, [x, 0.42, z], 18, [Math.PI / 2, 0, 0]));
      group.add(cylinder([0.13, 0.13], 0.205, COLORS.honey, [x, 0.42, z], 12, [Math.PI / 2, 0, 0]));
    }
  }
  return group;
}

function signCarrot(): Group {
  const sign = carrot();
  sign.scale.setScalar(0.48);
  sign.rotation.z = -0.22;
  return sign;
}

function signCloud(): Group {
  const group = new Group();
  group.add(
    sphere(0.26, COLORS.white, [-0.25, 0, 0]),
    sphere(0.36, COLORS.white, [0, 0.1, 0]),
    sphere(0.25, COLORS.white, [0.29, 0, 0]),
    box([0.64, 0.24, 0.25], COLORS.white, [0, -0.1, 0]),
  );
  return group;
}

function signScissors(): Group {
  const group = new Group();
  for (const x of [-0.16, 0.16]) {
    const handle = part(new TorusGeometry(0.13, 0.045, 8, 14), COLORS.rose);
    handle.position.set(x, -0.18, 0);
    group.add(handle);
  }
  group.add(
    box([0.08, 0.6, 0.06], 0xd2c7be, [-0.11, 0.24, 0], [0, 0, 0.34]),
    box([0.08, 0.6, 0.06], 0xd2c7be, [0.11, 0.24, 0], [0, 0, -0.34]),
  );
  return group;
}

function building(kind: "market" | "boutique" | "salon"): Group {
  const group = new Group();
  const color = kind === "market" ? 0xf2ae69 : kind === "boutique" ? 0x9fc9de : 0xe8a5c4;
  const accent = kind === "market" ? COLORS.leaf : kind === "boutique" ? COLORS.lavender : COLORS.rose;
  group.add(
    box([3.6, 3.15, 2.45], color, [0, 1.58, 0]),
    box([3.92, 0.3, 2.7], COLORS.creamLight, [0, 3.22, 0]),
    box([0.88, 1.72, 0.14], COLORS.darkWood, [0, 0.86, 1.28]),
    box([0.56, 0.72, 0.06], COLORS.sky, [0, 1.22, 1.37]),
    box([0.92, 1.12, 0.1], 0xb9e2e2, [-1.12, 1.35, 1.28]),
    box([0.92, 1.12, 0.1], 0xb9e2e2, [1.12, 1.35, 1.28]),
    box([2.96, 0.45, 0.82], COLORS.white, [0, 2.34, 1.35], [0.12, 0, 0]),
    box([1.4, 0.72, 0.16], accent, [0, 3.0, 1.3]),
  );
  for (let index = 0; index < 7; index += 1) {
    group.add(box(
      [0.38, 0.47, 0.84],
      index % 2 === 0 ? COLORS.white : accent,
      [-1.15 + index * 0.38, 2.36, 1.39],
      [0.12, 0, 0],
    ));
  }
  for (const x of [-1.58, 1.58]) {
    group.add(box([0.22, 0.32, 0.42], COLORS.wood, [x, 0.18, 1.1]));
    group.add(sphere(0.23, COLORS.leaf, [x, 0.46, 1.1], [1, 0.8, 1]));
  }
  const logo = kind === "market" ? signCarrot() : kind === "boutique" ? signCloud() : signScissors();
  logo.position.set(0, 3.02, 1.42);
  group.add(logo);
  return group;
}

function heart(depth = 0.12): Group {
  const shape = new Shape();
  shape.moveTo(0, -0.38);
  shape.bezierCurveTo(-0.62, 0.02, -0.52, 0.5, -0.2, 0.5);
  shape.bezierCurveTo(0, 0.5, 0.1, 0.36, 0, 0.22);
  shape.bezierCurveTo(0.1, 0.36, 0.2, 0.5, 0.4, 0.5);
  shape.bezierCurveTo(0.72, 0.5, 0.82, 0.02, 0, -0.38);
  const group = new Group();
  const result = part(new ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelSize: 0.035,
    bevelThickness: 0.025,
    bevelSegments: 2,
  }), COLORS.rose);
  result.geometry.center();
  group.add(result);
  return group;
}

function coin(): Group {
  const group = new Group();
  group.add(
    cylinder([0.38, 0.38], 0.11, COLORS.honey, [0, 0, 0], 28, [Math.PI / 2, 0, 0]),
    place(part(new RingGeometry(0.21, 0.28, 24), 0xffe392), [0, 0, 0.061]),
    sphere(0.085, 0xffe392, [0, 0, 0.072], [1, 1, 0.24]),
  );
  return group;
}

function sleepIcon(): Group {
  const group = new Group();
  const moon = part(new TorusGeometry(0.3, 0.13, 10, 24, Math.PI * 1.42), COLORS.lavender);
  moon.rotation.z = 0.78;
  group.add(moon);
  for (const [x, y, scale] of [[0.22, 0.15, 0.6], [0.42, 0.38, 0.43]] as const) {
    group.add(
      box([0.28 * scale, 0.055, 0.055], COLORS.blue, [x, y, 0]),
      box([0.28 * scale, 0.055, 0.055], COLORS.blue, [x, y + 0.2 * scale, 0]),
      box([0.055, 0.24 * scale, 0.055], COLORS.blue, [x, y + 0.1 * scale, 0], [0, 0, -0.85]),
    );
  }
  return group;
}

function sparkle(): Group {
  const shape = new Shape();
  for (let index = 0; index < 16; index += 1) {
    const angle = index / 16 * Math.PI * 2;
    const radius = index % 2 === 0 ? (index % 4 === 0 ? 0.5 : 0.28) : 0.1;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    if (index === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  const group = new Group();
  const star = part(new ExtrudeGeometry(shape, { depth: 0.08, bevelEnabled: false }), COLORS.butter, {
    emissive: 0x3a2500,
  });
  star.geometry.center();
  group.add(star);
  return group;
}

function bubble(): Group {
  const group = new Group();
  group.add(
    part(new SphereGeometry(0.38, 20, 14), COLORS.sky, {
      transparent: true,
      opacity: 0.28,
      roughness: 0.12,
      metalness: 0.05,
    }),
    sphere(0.055, COLORS.white, [-0.13, 0.16, 0.31], [1.4, 0.7, 0.35]),
  );
  return group;
}

export interface ProceduralAudioRecipe {
  readonly waveform: OscillatorType;
  readonly frequencies: readonly number[];
  readonly stepSeconds: number;
  readonly durationSeconds: number;
  readonly gain: number;
}

export const PROCEDURAL_AUDIO_RECIPES = {
  "audio.happy": { waveform: "sine", frequencies: [523.25, 659.25, 783.99], stepSeconds: 0.08, durationSeconds: 0.18, gain: 0.08 },
  "audio.munch": { waveform: "square", frequencies: [180, 140, 210], stepSeconds: 0.055, durationSeconds: 0.11, gain: 0.045 },
  "audio.sleep": { waveform: "sine", frequencies: [392, 329.63, 261.63], stepSeconds: 0.13, durationSeconds: 0.25, gain: 0.055 },
  "audio.wake": { waveform: "triangle", frequencies: [261.63, 392, 523.25], stepSeconds: 0.09, durationSeconds: 0.19, gain: 0.07 },
  "audio.tap": { waveform: "sine", frequencies: [540, 720], stepSeconds: 0.025, durationSeconds: 0.07, gain: 0.045 },
} as const satisfies Readonly<Record<AudioAssetKey, ProceduralAudioRecipe>>;

function audioHook(key: AudioAssetKey): Group {
  const group = new Group();
  group.userData.audioRecipe = PROCEDURAL_AUDIO_RECIPES[key];
  group.userData.audioFallbackHook = true;
  return group;
}

const PROCEDURAL_FACTORIES = {
  "gooby.body": goobyBody,
  "gooby.eye": goobyEye,
  "food.carrot": carrot,
  "food.apple": apple,
  "food.pancake": pancake,
  "furniture.sofa": () => sofa(),
  "furniture.armchair": () => sofa(1.32),
  "furniture.coffee-table": coffeeTable,
  "furniture.rug": rug,
  "furniture.lamp": () => floorLamp(false),
  "furniture.bookshelf": bookshelf,
  "furniture.bed": bed,
  "furniture.bathtub": bathtub,
  "furniture.kitchen-counter": kitchenCounter,
  "city.road": road,
  "city.tree": tree,
  "city.lamp": () => floorLamp(true),
  "city.car": car,
  "building.carrot-market": () => building("market"),
  "building.cloud-boutique": () => building("boutique"),
  "building.fluff-salon": () => building("salon"),
  "icon.heart": heart,
  "icon.carrot": carrot,
  "icon.coin": coin,
  "icon.sleep": sleepIcon,
  "particle.heart": () => heart(0.06),
  "particle.sparkle": sparkle,
  "particle.bubble": bubble,
  "audio.happy": () => audioHook("audio.happy"),
  "audio.munch": () => audioHook("audio.munch"),
  "audio.sleep": () => audioHook("audio.sleep"),
  "audio.wake": () => audioHook("audio.wake"),
  "audio.tap": () => audioHook("audio.tap"),
} satisfies Readonly<Record<AssetKey, () => Group>>;

export function createProceduralAsset(key: AssetKey): Object3D {
  const family = key.slice(0, key.indexOf("."));
  return finish(PROCEDURAL_FACTORIES[key](), key, `warm-toy-box/${family}`);
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
