import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  SphereGeometry,
  TorusGeometry,
  type Object3D,
} from "three";
import { HOME_ZONE_BLUEPRINTS } from "../../data/home";
import type { HomeZoneId } from "../../core/contracts/scenes";

export function standardMaterial(
  color: number,
  roughness = 0.82,
  metalness = 0,
): MeshStandardMaterial {
  return new MeshStandardMaterial({ color, roughness, metalness });
}

export function box(
  size: readonly [number, number, number],
  color: number,
  position: readonly [number, number, number] = [0, 0, 0],
): Mesh {
  const value = new Mesh(new BoxGeometry(...size), standardMaterial(color));
  value.position.set(...position);
  value.castShadow = true;
  value.receiveShadow = true;
  return value;
}

export function sphere(
  radius: number,
  color: number,
  position: readonly [number, number, number] = [0, 0, 0],
): Mesh {
  const value = new Mesh(new SphereGeometry(radius, 18, 14), standardMaterial(color));
  value.position.set(...position);
  value.castShadow = true;
  return value;
}

export function makeRoomShell(zone: HomeZoneId, outdoors = false): Group {
  const blueprint = HOME_ZONE_BLUEPRINTS[zone];
  const shell = new Group();
  const floor = new Mesh(
    new PlaneGeometry(12, 16),
    standardMaterial(blueprint.palette.floor, outdoors ? 1 : 0.92),
  );
  floor.position.z = 2.25;
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  shell.add(floor);
  if (outdoors) return shell;

  const wall = box([10, 7, 0.24], blueprint.palette.wall, [0, 3.5, -3.25]);
  const leftWall = box([0.24, 7, 8], blueprint.palette.wall, [-4.9, 3.5, 0]);
  const rightWall = box([0.24, 7, 8], blueprint.palette.wall, [4.9, 3.5, 0]);
  const baseboard = box([9.8, 0.22, 0.16], 0xffefd5, [0, 0.16, -3.08]);
  shell.add(wall, leftWall, rightWall, baseboard);
  return shell;
}

export function makeDoor(color: number, hinge: "left" | "right" = "left"): Group {
  const door = new Group();
  const panel = box([1.25, 2.75, 0.16], color, [0, 1.375, 0]);
  const inset = box([0.82, 0.85, 0.05], color + 0x090505, [0, 1.72, 0.11]);
  const knob = sphere(0.09, 0xe2b959, [hinge === "left" ? 0.43 : -0.43, 1.35, 0.16]);
  door.add(panel, inset, knob);
  return door;
}

export function makeWindow(glassColor = 0x9dd6df): {
  readonly root: Group;
  readonly glass: Mesh;
  readonly curtains: readonly [Mesh, Mesh];
} {
  const root = new Group();
  const frame = box([2.75, 2.1, 0.15], 0xfff1cf);
  const glass = new Mesh(new PlaneGeometry(2.35, 1.7), standardMaterial(glassColor, 0.26));
  glass.position.z = 0.1;
  const barX = box([0.1, 1.72, 0.08], 0xfff5df, [0, 0, 0.16]);
  const barY = box([2.36, 0.1, 0.08], 0xfff5df, [0, 0, 0.16]);
  const leftCurtain = box([0.5, 2.3, 0.16], 0xe7a6a0, [-1.58, 0, 0.2]);
  const rightCurtain = box([0.5, 2.3, 0.16], 0xe7a6a0, [1.58, 0, 0.2]);
  root.add(frame, glass, barX, barY, leftCurtain, rightCurtain);
  return { root, glass, curtains: [leftCurtain, rightCurtain] };
}

export function makeCounter(length: number, color = 0xeac395): Group {
  const counter = new Group();
  counter.add(
    box([length, 1.05, 1.05], color, [0, 0.525, 0]),
    box([length + 0.12, 0.14, 1.18], 0xffe9c8, [0, 1.1, 0]),
  );
  for (let x = -length / 2 + 0.65; x < length / 2; x += 1.3) {
    counter.add(box([0.05, 0.65, 0.08], 0xbd8e6c, [x, 0.55, 0.55]));
  }
  return counter;
}

export function makeMirror(): Group {
  const mirror = new Group();
  const frame = new Mesh(new TorusGeometry(0.88, 0.1, 10, 28), standardMaterial(0xf6c977, 0.4, 0.18));
  const glass = new Mesh(new CylinderGeometry(0.78, 0.78, 0.045, 32), standardMaterial(0xc9e9eb, 0.12, 0.2));
  glass.rotation.x = Math.PI / 2;
  glass.position.z = -0.02;
  mirror.add(frame, glass);
  return mirror;
}

export function makeFence(): Group {
  const fence = new Group();
  fence.add(
    box([9.8, 0.18, 0.18], 0xf2d6a0, [0, 0.8, -3.15]),
    box([9.8, 0.18, 0.18], 0xf2d6a0, [0, 1.45, -3.15]),
  );
  for (let x = -4.7; x <= 4.7; x += 0.65) {
    fence.add(box([0.16, 1.75, 0.16], 0xffe5b0, [x, 0.875, -3.15]));
  }
  return fence;
}

export function makeSignpost(color: number): Group {
  const sign = new Group();
  sign.add(
    box([0.14, 1.6, 0.14], 0x8c6448, [0, 0.8, 0]),
    box([1.25, 0.62, 0.16], color, [0, 1.55, 0]),
    sphere(0.09, 0xffefbb, [0.42, 1.55, 0.12]),
  );
  return sign;
}

export function setShadowTree(root: Object3D): void {
  root.traverse((child) => {
    if (child instanceof Mesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });
}
