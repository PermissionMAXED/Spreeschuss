import * as THREE from 'three';
import { hashStr, mulberry32 } from './build/util.js';
import { applySky } from './build/sky.js';
import { createMaterials } from './build/materials.js';
import { buildStructures, WALL_HEIGHT, WALL_THICKNESS } from './build/structures.js';
import { addWallTrim } from './build/perimeter.js';
import { addSkyline } from './build/skyline.js';
import { addSiteMarkers } from './build/sites.js';
import { addLighting } from './build/lighting.js';
import { addProps } from './build/props.js';

// Builds a three.js scene graph from a plain map-data object and returns
// collision + gameplay metadata. Contract (FROZEN):
//   buildMap(scene, mapData) -> {
//     colliders: [{min:THREE.Vector3, max:THREE.Vector3}],
//     spawns: { attackers:[{pos,rot}], defenders:[...], ffa:[...] },
//     sites: { A:{center:THREE.Vector3,radius,ring}, ... },
//     bounds: {min,max}, group: THREE.Group
//   }
// Every box in map.boxes and the 4 perimeter walls keep an AABB collider
// exactly matching center±size/2. Decoration NEVER adds colliders.
//
// This file is a thin orchestrator: each build stage lives in its own
// single-owner module under ./build/ (see the FROZEN INTERFACE header in
// each file). Stage order matters — skyline and props draw from the shared
// map-seeded PRNG, so stages before them must not consume `rand`.
export function buildMap(scene, map) {
  const group = new THREE.Group();
  group.name = 'map';
  scene.add(group);

  const [w, d] = map.size;
  const rand = mulberry32(hashStr(map.id || map.name || 'map'));

  applySky(scene, map);
  const mats = createMaterials(map);
  const colliders = buildStructures(group, map, mats, rand);
  addWallTrim(group, w, d, WALL_HEIGHT, WALL_THICKNESS, map.palette);
  addSkyline(group, w, d, map.palette, rand);
  const sites = addSiteMarkers(group, map);
  addLighting(scene, group, map, sites);
  addProps(group, map, rand, sites);

  const spawns = normalizeSpawns(map.spawns);

  return {
    colliders,
    spawns,
    sites,
    bounds: { min: new THREE.Vector3(-w / 2, 0, -d / 2), max: new THREE.Vector3(w / 2, WALL_HEIGHT, d / 2) },
    group,
  };
}

function normalizeSpawns(spawns = {}) {
  const conv = (arr = []) => arr.map((s) => ({
    pos: new THREE.Vector3(s[0], 1.6, s[1]),
    rot: s[2] ?? 0,
  }));
  return {
    attackers: conv(spawns.attackers),
    defenders: conv(spawns.defenders),
    ffa: conv(spawns.ffa),
  };
}
