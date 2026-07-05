import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// =====================================================================
// FROZEN INTERFACE — shared map-build helpers.
//
// This file is FROZEN: later map specialists import from it but never
// edit it. Exports:
//
//   paletteKey(palette) -> 'Spree'|'Sand'|'Neon'|'Ice'|'Ruins'|'Toxic'|'Crimson'
//     Resolves a map palette to its theme key. Uses `palette.name` when
//     present (and known), otherwise picks the nearest theme by summed
//     squared color distance over wall/floor/accent, defaulting to
//     'Spree'. Every per-module theme table is keyed by this value.
//
//   mulberry32(seed) -> () => float in [0,1)
//     Deterministic PRNG. Same implementation as maps.js / textures.js.
//
//   hashStr(s) -> uint32
//     FNV-1a string hash, used to seed mulberry32.
//
//   placedBox(sx, sy, sz, x, y, z, ry = 0) -> THREE.BoxGeometry
//     Box geometry rotated around Y (if ry) then translated into place,
//     for merged decoration meshes.
//
//   mergeInto(group, geos, mat) -> THREE.Mesh | null
//     Merges geometries into ONE mesh with the given material, disposes
//     the source geometries, adds the mesh to `group` and returns it
//     (null when `geos` is empty). Callers set shadow flags on the
//     returned mesh when needed.
// =====================================================================

// Reference colors per theme, used only for nearest-palette matching.
// (The map-data generator may omit `palette.name`.)
const REFS = {
  Spree: { floor: '#3a4a5a', wall: '#5a6b7a', accent: '#43b7c7' },
  Sand: { floor: '#8a7a55', wall: '#b7a06a', accent: '#e0b84a' },
  Neon: { floor: '#3a3560', wall: '#544c86', accent: '#ff3fa4' },
  Ice: { floor: '#6a8090', wall: '#9fc0d0', accent: '#7fe0ff' },
  Ruins: { floor: '#6a6052', wall: '#8a7a68', accent: '#e0a95a' },
  Toxic: { floor: '#3a4a34', wall: '#557048', accent: '#9fe04a' },
  Crimson: { floor: '#5a3840', wall: '#804a56', accent: '#ff5a6a' },
};

function colorDist(a, b) {
  const ca = new THREE.Color(a);
  const cb = new THREE.Color(b);
  return (ca.r - cb.r) ** 2 + (ca.g - cb.g) ** 2 + (ca.b - cb.b) ** 2;
}

export function paletteKey(palette) {
  if (palette.name && REFS[palette.name]) return palette.name;
  let best = 'Spree';
  let bestD = Infinity;
  for (const [key, ref] of Object.entries(REFS)) {
    const d2 = colorDist(palette.wall, ref.wall) + colorDist(palette.floor, ref.floor) + colorDist(palette.accent, ref.accent);
    if (d2 < bestD) { bestD = d2; best = key; }
  }
  return best;
}

export function hashStr(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function placedBox(sx, sy, sz, x, y, z, ry = 0) {
  const g = new THREE.BoxGeometry(sx, sy, sz);
  if (ry) g.rotateY(ry);
  g.translate(x, y, z);
  return g;
}

export function mergeInto(group, geos, mat) {
  if (!geos.length) return null;
  const mesh = new THREE.Mesh(mergeGeometries(geos, false), mat);
  for (const g of geos) g.dispose();
  group.add(mesh);
  return mesh;
}
