import * as THREE from 'three';
import { placedBox, mergeInto } from './util.js';

// =====================================================================
// FROZEN INTERFACE — perimeter wall decoration (NO colliders).
//
//   addWallTrim(group, w, d, H, t, palette)
//     Glow trim strips, dark skirts and roof caps mounted on the
//     collidered perimeter walls. Everything stays <= 0.05 proud of the
//     wall colliders (so hitscan still resolves against the collider)
//     or above them (roof caps, unreachable). Merges into two meshes
//     (glow trim + dark skirt/caps). `H`/`t` are the perimeter wall
//     height/thickness from structures.js.
// =====================================================================

export function addWallTrim(group, w, d, H, t, palette) {
  const trimMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(palette.accent).multiplyScalar(0.5),
    emissive: new THREE.Color(palette.accent),
    emissiveIntensity: 1.1,
    roughness: 0.4,
    metalness: 0.2,
  });
  const darkMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(palette.wall).multiplyScalar(0.35),
    roughness: 0.7,
    metalness: 0.3,
  });

  const TRIM_H = 0.14; // glowing band
  const TRIM_T = 0.05; // proudness (allowed <= 0.05)
  const yGlow = 2.7;
  const ySkirt = 0.45;
  const inner = { x: w / 2 - t / 2, z: d / 2 - t / 2 };

  const glowGeos = [];
  const darkGeos = [];
  for (const side of [-1, 1]) {
    // north/south walls (normal along z)
    glowGeos.push(placedBox(w - 2.4, TRIM_H, TRIM_T, 0, yGlow, side * (inner.z - TRIM_T / 2)));
    darkGeos.push(placedBox(w - 2.4, 0.5, TRIM_T, 0, ySkirt, side * (inner.z - TRIM_T / 2 + 0.01)));
    // east/west walls (normal along x)
    glowGeos.push(placedBox(TRIM_T, TRIM_H, d - 2.4, side * (inner.x - TRIM_T / 2), yGlow, 0));
    darkGeos.push(placedBox(TRIM_T, 0.5, d - 2.4, side * (inner.x - TRIM_T / 2 + 0.01), ySkirt, 0));
    // roof caps along the wall tops (above the collider, unreachable)
    darkGeos.push(placedBox(w + t + 0.1, 0.12, t + 0.1, 0, H + 0.06, side * (d / 2)));
    darkGeos.push(placedBox(t + 0.1, 0.12, d + t + 0.1, side * (w / 2), H + 0.06, 0));
    // slim glow line on top of the caps
    glowGeos.push(placedBox(w - 2, 0.06, 0.08, 0, H + 0.15, side * (d / 2)));
    glowGeos.push(placedBox(0.08, 0.06, d - 2, side * (w / 2), H + 0.15, 0));
  }
  mergeInto(group, glowGeos, trimMat);
  mergeInto(group, darkGeos, darkMat);
}
