import {
  BoxGeometry,
  Float32BufferAttribute,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  SphereGeometry,
  TorusGeometry,
  Matrix4,
  type BufferGeometry,
  type Material,
  type Object3D,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
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

export function makeNougatDispenser(): Group {
  const dispenser = new Group();
  dispenser.name = "home:nougatschleuse";
  const body = box([1.05, 1.45, 0.82], 0xd7b07c, [0, 0.74, 0]);
  const window = box([0.68, 0.72, 0.06], 0x6b4a3d, [0, 0.93, 0.44]);
  const label = box([0.56, 0.18, 0.05], 0xffe5ae, [0, 1.24, 0.48]);
  const tray = box([0.72, 0.12, 0.5], 0x8c674e, [0, 0.18, 0.49]);
  const lever = new Group();
  lever.name = "nougatschleuse:lever";
  const leverStem = box([0.09, 0.58, 0.09], 0x6f7277);
  leverStem.position.y = 0.22;
  leverStem.rotation.z = -0.18;
  const leverKnob = sphere(0.13, 0xe7a25f, [0.1, 0.51, 0]);
  lever.add(leverStem, leverKnob);
  lever.position.set(0.58, 0.76, 0.28);
  dispenser.add(body, window, label, tray, lever);
  dispenser.userData.genericFoodId = "hazelnut-nougat-spread";
  return dispenser;
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

export interface StaticBatchResult {
  readonly sourceMeshes: number;
  readonly batchedMeshes: number;
  readonly drawCallsSaved: number;
}

interface StaticBatchEntry {
  readonly mesh: Mesh<BufferGeometry, MeshStandardMaterial>;
  readonly geometry: BufferGeometry;
  readonly material: MeshStandardMaterial;
}

const canBakeVertexColor = (material: MeshStandardMaterial): boolean =>
  !material.map &&
  !material.normalMap &&
  !material.vertexColors &&
  material.metalness === 0 &&
  material.emissive.getHex() === 0 &&
  material.emissiveIntensity === 1;

const materialSignature = (material: MeshStandardMaterial): string => canBakeVertexColor(material)
  ? [
      "vertex-color",
      Math.round(material.roughness * 5) / 5,
      material.side,
      material.depthTest,
      material.depthWrite,
      material.colorWrite,
      material.flatShading,
      material.wireframe,
    ].join("|")
  : [
  material.color.getHex(),
  material.emissive.getHex(),
  material.emissiveIntensity,
  material.roughness,
  material.metalness,
  material.opacity,
  material.side,
  material.depthTest,
  material.depthWrite,
  material.colorWrite,
  material.vertexColors,
  material.flatShading,
  material.wireframe,
  material.map?.uuid ?? "",
  material.normalMap?.uuid ?? "",
].join("|");

/**
 * Bakes non-interactive room meshes into one geometry per visually equivalent
 * material. Animated and hit-tested subtrees stay separate, while the static
 * shell/furniture keeps identical shading, shadows, and triangle counts.
 */
export function batchStaticHomeGeometry(
  root: Object3D,
  excludedRoots: Iterable<Object3D> = [],
): StaticBatchResult {
  root.updateWorldMatrix(true, true);
  const excluded = new Set<Object3D>();
  for (const object of excludedRoots) object.traverse((child) => excluded.add(child));

  const groups = new Map<string, StaticBatchEntry[]>();
  root.traverse((object) => {
    if (excluded.has(object) || !(object instanceof Mesh)) return;
    const mesh = object as Mesh<BufferGeometry, Material | Material[]>;
    const meshMaterial = mesh.material;
    if (
      !(meshMaterial instanceof MeshStandardMaterial) ||
      meshMaterial.transparent ||
      meshMaterial.opacity < 1 ||
      mesh.geometry.morphAttributes.position
    ) return;
    const key = materialSignature(meshMaterial);
    const entries = groups.get(key) ?? [];
    const standardMesh = mesh as Mesh<BufferGeometry, MeshStandardMaterial>;
    entries.push({ mesh: standardMesh, geometry: mesh.geometry, material: meshMaterial });
    groups.set(key, entries);
  });

  const rootInverse = new Matrix4().copy(root.matrixWorld).invert();
  const removedEntries: StaticBatchEntry[] = [];
  const retainedMaterials = new Set<Material>();
  let batchedMeshes = 0;
  let sourceMeshes = 0;

  for (const entries of groups.values()) {
    if (entries.length < 2) continue;
    const bakeVertexColors = entries.every(({ material }) => canBakeVertexColor(material));
    const transformed = entries.map(({ mesh, geometry }) => {
      const localMatrix = new Matrix4().copy(rootInverse).multiply(mesh.matrixWorld);
      const result = geometry.clone().applyMatrix4(localMatrix);
      if (bakeVertexColors) {
        const positions = result.getAttribute("position");
        const colors = new Float32Array(positions.count * 3);
        for (let index = 0; index < positions.count; index += 1) {
          colors[index * 3] = mesh.material.color.r;
          colors[index * 3 + 1] = mesh.material.color.g;
          colors[index * 3 + 2] = mesh.material.color.b;
        }
        result.setAttribute("color", new Float32BufferAttribute(colors, 3));
      }
      return result;
    });
    const merged = mergeGeometries(transformed, false);
    for (const geometry of transformed) geometry.dispose();
    if (!merged) continue;

    const firstMaterial = entries[0]?.material;
    const material = bakeVertexColors && firstMaterial
      ? new MeshStandardMaterial({
          color: 0xffffff,
          roughness: Math.round(firstMaterial.roughness * 5) / 5,
          vertexColors: true,
        })
      : firstMaterial;
    if (!material) {
      merged.dispose();
      continue;
    }
    retainedMaterials.add(material);
    const batch = new Mesh(merged, material);
    batch.name = `home:static-batch:${batchedMeshes + 1}`;
    batch.castShadow = entries.some(({ mesh }) => mesh.castShadow);
    batch.receiveShadow = entries.some(({ mesh }) => mesh.receiveShadow);
    root.add(batch);
    for (const entry of entries) {
      entry.mesh.removeFromParent();
      removedEntries.push(entry);
    }
    sourceMeshes += entries.length;
    batchedMeshes += 1;
  }

  const remainingGeometries = new Set<BufferGeometry>();
  const remainingMaterials = new Set<Material>(retainedMaterials);
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    const mesh = object as Mesh<BufferGeometry, Material | Material[]>;
    remainingGeometries.add(mesh.geometry);
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) remainingMaterials.add(material);
  });
  const disposed = new Set<BufferGeometry | Material>();
  for (const { geometry, material } of removedEntries) {
    if (!remainingGeometries.has(geometry) && !disposed.has(geometry)) {
      disposed.add(geometry);
      geometry.dispose();
    }
    if (!remainingMaterials.has(material) && !disposed.has(material)) {
      disposed.add(material);
      material.dispose();
    }
  }
  root.updateWorldMatrix(true, true);
  return {
    sourceMeshes,
    batchedMeshes,
    drawCallsSaved: sourceMeshes - batchedMeshes,
  };
}

/**
 * Catalog cosmetics are tiny solid-color procedural meshes. Baking their
 * colors into vertices keeps every silhouette while making re-equips a stable
 * one-geometry/one-material operation.
 */
export function batchSolidColorModel(root: Object3D): boolean {
  root.updateWorldMatrix(true, true);
  const rootInverse = new Matrix4().copy(root.matrixWorld).invert();
  const meshes: Array<Mesh<BufferGeometry, MeshStandardMaterial>> = [];
  root.traverse((object) => {
    if (
      object instanceof Mesh &&
      object.material instanceof MeshStandardMaterial &&
      !object.material.transparent
    ) {
      meshes.push(object as Mesh<BufferGeometry, MeshStandardMaterial>);
    }
  });
  if (meshes.length < 2) return false;

  const transformed = meshes.map((mesh) => {
    const geometry = mesh.geometry.clone();
    geometry.applyMatrix4(new Matrix4().copy(rootInverse).multiply(mesh.matrixWorld));
    const positions = geometry.getAttribute("position");
    const colors = new Float32Array(positions.count * 3);
    for (let index = 0; index < positions.count; index += 1) {
      colors[index * 3] = mesh.material.color.r;
      colors[index * 3 + 1] = mesh.material.color.g;
      colors[index * 3 + 2] = mesh.material.color.b;
    }
    geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
    return geometry;
  });
  const merged = mergeGeometries(transformed, false);
  for (const geometry of transformed) geometry.dispose();
  if (!merged) return false;

  const material = new MeshStandardMaterial({
    color: 0xffffff,
    roughness: meshes[0]?.material.roughness ?? 0.78,
    metalness: meshes[0]?.material.metalness ?? 0,
    vertexColors: true,
  });
  const batch = new Mesh(merged, material);
  batch.name = "home:solid-color-batch";
  batch.castShadow = meshes.some((mesh) => mesh.castShadow);
  batch.receiveShadow = meshes.some((mesh) => mesh.receiveShadow);

  const disposed = new Set<BufferGeometry | Material>();
  for (const mesh of meshes) {
    mesh.removeFromParent();
    if (!disposed.has(mesh.geometry)) {
      disposed.add(mesh.geometry);
      mesh.geometry.dispose();
    }
    if (!disposed.has(mesh.material)) {
      disposed.add(mesh.material);
      mesh.material.dispose();
    }
  }
  root.add(batch);
  return true;
}
