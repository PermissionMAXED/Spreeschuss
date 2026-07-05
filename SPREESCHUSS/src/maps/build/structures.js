import * as THREE from 'three';
import { mergeInto } from './util.js';

// =====================================================================
// FROZEN INTERFACE — gameplay structures (the ONLY collider source).
//
//   WALL_HEIGHT (6), WALL_THICKNESS (1)
//     Perimeter wall dimensions. Collider layout is FROZEN.
//
//   buildStructures(group, map, mats, rand) -> colliders[]
//     Adds the floor plane, the dark out-of-bounds apron, the 4 perimeter
//     walls and every box in map.boxes to `group`, and returns the
//     collider array: one AABB {min,max} per perimeter wall and per box,
//     EXACTLY center±size/2. Nothing else in the map build may add
//     colliders. `mats` comes from materials.js; `rand` is the shared
//     deterministic PRNG (currently unused here — structures must stay
//     purely data-driven so the skyline draw order stays stable).
//
// All boxes sharing a material are merged into ONE mesh (huge draw-call
// saving, since every mesh is also redrawn into the shadow map).
// Colliders are tracked independently and stay exactly center±size/2
// per box.
// =====================================================================

export const WALL_HEIGHT = 6;
export const WALL_THICKNESS = 1;

// Scale BoxGeometry UVs so textures keep world-scale density on every face
// (one shared material per color instead of a clone per box). Face order in
// BoxGeometry: +x, -x, +y, -y, +z, -z with 4 consecutive uv verts per face.
const TILE = 3; // world units per texture repeat
function scaleBoxUVs(geo, sx, sy, sz, tile = TILE) {
  const uv = geo.attributes.uv;
  const dims = [
    [sz, sy], [sz, sy], // ±x
    [sx, sz], [sx, sz], // ±y
    [sx, sy], [sx, sy], // ±z
  ];
  for (let f = 0; f < 6; f++) {
    const [du, dv] = dims[f];
    for (let i = f * 4; i < f * 4 + 4; i++) {
      uv.setXY(i, uv.getX(i) * Math.max(0.5, du / tile), uv.getY(i) * Math.max(0.5, dv / tile));
    }
  }
  uv.needsUpdate = true;
  return geo;
}

export function buildStructures(group, map, mats, rand) { // eslint-disable-line no-unused-vars
  const pal = map.palette;
  const [w, d] = map.size;

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mats.floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  group.add(floor);

  // dark apron so the world outside the arena isn't a void below the sky
  // (Lambert: large fill area, doesn't need PBR shading)
  const apron = new THREE.Mesh(
    new THREE.PlaneGeometry(w + 260, d + 260),
    new THREE.MeshLambertMaterial({ color: new THREE.Color(pal.fog ?? pal.skyBottom).multiplyScalar(0.45) }),
  );
  apron.rotation.x = -Math.PI / 2;
  apron.position.y = -0.03;
  group.add(apron);

  const colliders = [];
  const boxBuckets = new Map(); // material -> geometries
  const addBox = (pos, size, color) => {
    const geo = scaleBoxUVs(new THREE.BoxGeometry(size[0], size[1], size[2]), size[0], size[1], size[2]);
    geo.translate(pos[0], pos[1], pos[2]);
    const isAccent = color != null && color === pal.accent;
    const mat = isAccent ? mats.accentBoxMat : mats.wallMat(color || pal.wall);
    if (!boxBuckets.has(mat)) boxBuckets.set(mat, []);
    boxBuckets.get(mat).push(geo);
    colliders.push({
      min: new THREE.Vector3(pos[0] - size[0] / 2, pos[1] - size[1] / 2, pos[2] - size[2] / 2),
      max: new THREE.Vector3(pos[0] + size[0] / 2, pos[1] + size[1] / 2, pos[2] + size[2] / 2),
    });
  };

  // Outer perimeter walls (collider layout FROZEN: height 6, thickness 1)
  const H = WALL_HEIGHT;
  const t = WALL_THICKNESS;
  addBox([0, H / 2, -d / 2], [w + t, H, t], pal.wall);
  addBox([0, H / 2, d / 2], [w + t, H, t], pal.wall);
  addBox([-w / 2, H / 2, 0], [t, H, d + t], pal.wall);
  addBox([w / 2, H / 2, 0], [t, H, d + t], pal.wall);

  // Interior boxes / cover / walls
  for (const b of map.boxes || []) {
    addBox(b.pos, b.size, b.color);
  }
  for (const [mat, geos] of boxBuckets) {
    const mesh = mergeInto(group, geos, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
  }

  return colliders;
}
