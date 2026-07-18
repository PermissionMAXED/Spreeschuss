import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
} from "three";
import type { Object3D } from "three";
import type { PlannedAssetKey } from "../../../data/assetManifest";

/**
 * Total procedural fallbacks for the curated city keys. Every factory matches
 * the local-space footprint of its curated GLB (road tiles are 1x1 centered on
 * the origin, KayKit buildings cover a 2x2 footprint from y=0, traffic cars
 * are ~0.9 long) so world placement code never branches on the asset source.
 */

export const CITY_CURATED_KEYS = [
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
] as const satisfies readonly PlannedAssetKey[];

export type CityCuratedKey = (typeof CITY_CURATED_KEYS)[number];

const PALETTE = {
  asphalt: 0x585c63,
  marking: 0xf3e6c2,
  concrete: 0xd3c8b6,
  sidewalk: 0xddd2bf,
  trim: 0xb9ad9a,
  brickA: 0xdfb488,
  brickB: 0xafc7d8,
  brickC: 0xe0a9a0,
  roof: 0x8a6250,
  window: 0xbfe2e8,
  carA: 0x6fa8c4,
  carB: 0xe0995c,
  tyre: 0x3e3a41,
  wood: 0xa96e4d,
  steel: 0x6a6f7c,
} as const;

function part(
  geometry: BoxGeometry | CylinderGeometry,
  color: number,
  x: number,
  y: number,
  z: number,
  rotationY = 0,
): Mesh {
  const mesh = new Mesh(geometry, new MeshStandardMaterial({ color, roughness: 0.82 }));
  mesh.position.set(x, y, z);
  mesh.rotation.y = rotationY;
  return mesh;
}

function roadBase(): Mesh {
  return part(new BoxGeometry(1, 0.024, 1), PALETTE.asphalt, 0, 0.001, 0);
}

function marking(width: number, length: number, x: number, z: number, rotationY = 0): Mesh {
  return part(new BoxGeometry(width, 0.006, length), PALETTE.marking, x, 0.017, z, rotationY);
}

function roadStraight(): Group {
  const group = new Group();
  group.add(roadBase());
  for (const z of [-0.3, 0.14]) group.add(marking(0.028, 0.24, 0, z + 0.08));
  for (const x of [-0.46, 0.46]) group.add(marking(0.024, 1, x, 0));
  return group;
}

function roadCorner(): Group {
  // Canonical corner joins the +x and -z arms (mirrors the topology tiles).
  const group = new Group();
  group.add(roadBase());
  group.add(marking(0.028, 0.3, 0.1, -0.32));
  group.add(marking(0.3, 0.028, 0.32, -0.1));
  group.add(marking(0.024, 0.62, -0.46, -0.19));
  group.add(marking(0.62, 0.024, 0.19, 0.46));
  return group;
}

function roadT(): Group {
  // Canonical tee is open toward +z / -z / +x with the flat edge on -x.
  const group = new Group();
  group.add(roadBase());
  group.add(marking(0.024, 1, -0.46, 0));
  for (const z of [-0.34, 0.34]) group.add(marking(0.028, 0.2, 0, z));
  group.add(marking(0.2, 0.028, 0.34, 0));
  return group;
}

function roadCross(): Group {
  const group = new Group();
  group.add(roadBase());
  for (const [x, z] of [[-0.34, 0], [0.34, 0]] as const) group.add(marking(0.2, 0.028, x, z));
  for (const [x, z] of [[0, -0.34], [0, 0.34]] as const) group.add(marking(0.028, 0.2, x, z));
  return group;
}

function curb(): Group {
  const group = new Group();
  group.add(part(new BoxGeometry(1, 0.02, 1.3), PALETTE.concrete, 0, 0.01, -0.15));
  group.add(part(new BoxGeometry(1, 0.02, 0.12), PALETTE.trim, 0, 0.022, 0.42));
  return group;
}

function sidewalk(): Group {
  const group = new Group();
  group.add(part(new BoxGeometry(2, 0.1, 2), PALETTE.sidewalk, 0, 0.05, 0));
  for (const x of [-0.5, 0.5]) {
    group.add(part(new BoxGeometry(0.03, 0.012, 2), PALETTE.trim, x, 0.106, 0));
  }
  return group;
}

function building(kind: "a" | "b" | "c"): Group {
  const group = new Group();
  const height = kind === "c" ? 2.98 : 1.65;
  const color = kind === "a" ? PALETTE.brickA : kind === "b" ? PALETTE.brickB : PALETTE.brickC;
  group.add(part(new BoxGeometry(2, height, 2), color, 0, height / 2, 0));
  group.add(part(new BoxGeometry(2.14, 0.1, 2.14), PALETTE.roof, 0, height + 0.05, 0));
  const rows = kind === "c" ? 3 : 1;
  for (let row = 0; row < rows; row += 1) {
    const y = height * ((row + 0.62) / (rows + 0.24));
    for (const x of [-0.55, 0.14, 0.55]) {
      group.add(part(new BoxGeometry(0.34, 0.4, 0.05), PALETTE.window, x, y, 1.0));
    }
  }
  group.add(part(new BoxGeometry(0.42, 0.62, 0.06), PALETTE.roof, kind === "b" ? 0.55 : -0.14, 0.31, 1.0));
  return group;
}

function trafficCar(kind: "a" | "b"): Group {
  const group = new Group();
  const color = kind === "a" ? PALETTE.carA : PALETTE.carB;
  group.add(part(new BoxGeometry(0.4, 0.16, 0.9), color, 0, 0.14, 0));
  group.add(part(new BoxGeometry(0.34, 0.14, 0.42), PALETTE.window, 0, 0.29, kind === "a" ? -0.04 : 0.05));
  for (const x of [-0.19, 0.19]) {
    for (const z of [-0.28, 0.28]) {
      group.add(part(new BoxGeometry(0.07, 0.13, 0.13), PALETTE.tyre, x, 0.065, z));
    }
  }
  return group;
}

function bench(): Group {
  const group = new Group();
  group.add(part(new BoxGeometry(0.4, 0.02, 0.14), PALETTE.wood, 0, 0.07, 0));
  group.add(part(new BoxGeometry(0.4, 0.05, 0.02), PALETTE.wood, 0, 0.11, -0.07));
  for (const x of [-0.17, 0.17]) {
    group.add(part(new BoxGeometry(0.02, 0.06, 0.12), PALETTE.steel, x, 0.03, 0));
  }
  return group;
}

function hydrant(): Group {
  const group = new Group();
  const body = new Mesh(
    new CylinderGeometry(0.055, 0.065, 0.2, 8),
    new MeshStandardMaterial({ color: 0xd95d47, roughness: 0.6 }),
  );
  body.position.y = 0.1;
  const cap = new Mesh(
    new CylinderGeometry(0.02, 0.045, 0.04, 8),
    new MeshStandardMaterial({ color: 0xb64a38, roughness: 0.6 }),
  );
  cap.position.y = 0.21;
  group.add(body, cap);
  return group;
}

function sign(): Group {
  const group = new Group();
  group.add(part(new BoxGeometry(0.03, 0.7, 0.03), PALETTE.steel, 0, 0.35, 0));
  group.add(part(new BoxGeometry(0.02, 0.16, 0.34), PALETTE.marking, 0.01, 0.58, 0.1));
  return group;
}

const FACTORIES: Readonly<Record<CityCuratedKey, () => Group>> = {
  "city.road-straight": roadStraight,
  "city.road-corner": roadCorner,
  "city.road-t": roadT,
  "city.road-4way": roadCross,
  "city.curb": curb,
  "city.sidewalk": sidewalk,
  "building.city-a": () => building("a"),
  "building.city-b": () => building("b"),
  "building.city-c": () => building("c"),
  "city.traffic-car-a": () => trafficCar("a"),
  "city.traffic-car-b": () => trafficCar("b"),
  "city.bench": bench,
  "city.hydrant": hydrant,
  "city.sign": sign,
};

export function createProceduralCityAsset(key: CityCuratedKey): Object3D {
  const group = FACTORIES[key]();
  group.name = `procedural:${key}`;
  group.userData.assetKey = key;
  group.userData.procedural = true;
  return group;
}
