import * as THREE from 'three';
import { surfaceTexture } from '../../engine/textures.js';
import { paletteKey } from './util.js';

// =====================================================================
// FROZEN INTERFACE — map surface materials.
//
//   createMaterials(map) -> {
//     floorMat,          // THREE.MeshStandardMaterial for the arena floor
//                        // (map repeat already set to w/4 x d/4)
//     wallMat(color),    // shared THREE.MeshStandardMaterial per box color
//                        // (cached — UVs are scaled per box instead of
//                        // cloning the material/texture, see structures.js)
//     accentBoxMat,      // emissive material for boxes whose color equals
//                        // palette.accent
//   }
//
// This module owns the surface half of the theme table: wall/floor
// texture kinds and roughness/metalness/envMapIntensity per palette.
// Textures come from engine/textures.js (fresh CanvasTexture wrappers
// over cached canvases — safe to dispose via Renderer.clearScene()).
// =====================================================================

// Surface identity per palette (keyed by util.paletteKey).
const SURFACES = {
  Spree: {
    wall: 'concrete', floor: 'floor_concrete',
    wallRough: 0.82, wallMetal: 0.06, floorRough: 0.9, floorMetal: 0.04, env: 0.45,
  },
  Sand: {
    wall: 'brick', floor: 'floor_stone',
    wallRough: 0.95, wallMetal: 0.0, floorRough: 0.95, floorMetal: 0.0, env: 0.25,
  },
  Neon: {
    wall: 'neon', floor: 'floor_neon',
    wallRough: 0.5, wallMetal: 0.35, floorRough: 0.4, floorMetal: 0.3, env: 0.8,
  },
  Ice: {
    wall: 'ice', floor: 'floor_ice',
    wallRough: 0.22, wallMetal: 0.08, floorRough: 0.18, floorMetal: 0.05, env: 1.3,
  },
  Ruins: {
    wall: 'brick_ruin', floor: 'floor_stone',
    wallRough: 0.97, wallMetal: 0.0, floorRough: 0.96, floorMetal: 0.0, env: 0.2,
  },
  Toxic: {
    wall: 'moss', floor: 'floor_moss',
    wallRough: 0.9, wallMetal: 0.04, floorRough: 0.85, floorMetal: 0.02, env: 0.3,
  },
  Crimson: {
    wall: 'metal', floor: 'floor_metal',
    wallRough: 0.55, wallMetal: 0.45, floorRough: 0.5, floorMetal: 0.4, env: 0.7,
  },
};

export function createMaterials(map) {
  const pal = map.palette;
  const surf = SURFACES[paletteKey(pal)];
  const [w, d] = map.size;

  const floorSurf = surfaceTexture(surf.floor, pal.floor, pal.accent);
  floorSurf.map.repeat.set(w / 4, d / 4);
  if (floorSurf.emissiveMap) floorSurf.emissiveMap.repeat.set(w / 4, d / 4);
  const floorMat = new THREE.MeshStandardMaterial({
    map: floorSurf.map,
    roughness: surf.floorRough,
    metalness: surf.floorMetal,
    envMapIntensity: surf.env,
    ...(floorSurf.emissiveMap ? { emissive: new THREE.Color(pal.accent), emissiveIntensity: 0.55, emissiveMap: floorSurf.emissiveMap } : {}),
  });

  // one shared wall material per box color — UVs are scaled per box instead
  // of cloning the material/texture, so texture density matches all faces
  const wallMatCache = new Map();
  const wallMat = (color) => {
    if (!wallMatCache.has(color)) {
      const s = surfaceTexture(surf.wall, color, pal.accent);
      const m = new THREE.MeshStandardMaterial({
        map: s.map,
        roughness: surf.wallRough,
        metalness: surf.wallMetal,
        envMapIntensity: surf.env,
      });
      if (s.emissiveMap) {
        m.emissive = new THREE.Color(pal.accent);
        m.emissiveIntensity = 0.75;
        m.emissiveMap = s.emissiveMap;
      }
      wallMatCache.set(color, m);
    }
    return wallMatCache.get(color);
  };

  // emissive accent material: any box whose color equals palette.accent glows
  const accentSurf = surfaceTexture('accent', pal.accent, pal.accent);
  const accentBoxMat = new THREE.MeshStandardMaterial({
    map: accentSurf.map,
    emissive: new THREE.Color(pal.accent),
    emissiveIntensity: 1.0,
    emissiveMap: accentSurf.emissiveMap,
    roughness: 0.45,
    metalness: 0.15,
    envMapIntensity: surf.env,
  });

  return { floorMat, wallMat, accentBoxMat };
}
