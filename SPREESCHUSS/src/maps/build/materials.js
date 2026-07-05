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
// surfaceTexture() may also return an optional bumpMap companion; it is
// consumed HERE ONLY (bumpScale tuned per palette below).
// =====================================================================

// Surface identity per palette (keyed by util.paletteKey). Each of the 7
// palettes gets a distinct wall+floor pairing:
//   Spree   - Berlin plaster walls (hairline cracks, graffiti) over asphalt
//             with worn lane paint
//   Sand    - ashlar sandstone walls over large sandstone flags w/ drifts
//   Neon    - dark glass curtain walls w/ accent LED strips over glow-grid
//             tiles
//   Ice     - glacial ice walls over cracked frozen floor
//   Ruins   - crumbling brick (missing bricks, soot) over worn stone slabs
//   Toxic   - moss-eaten concrete over damp concrete w/ puddles
//   Crimson - riveted metal plating over diamond-plate deck
const SURFACES = {
  Spree: {
    wall: 'plaster', floor: 'asphalt',
    wallRough: 0.86, wallMetal: 0.02, floorRough: 0.93, floorMetal: 0.02, env: 0.45,
    wallBump: 4, floorBump: 3,
  },
  Sand: {
    wall: 'sandstone', floor: 'sandstone', floorOpts: { floor: true },
    wallRough: 0.95, wallMetal: 0.0, floorRough: 0.94, floorMetal: 0.0, env: 0.25,
    wallBump: 5, floorBump: 5,
  },
  Neon: {
    wall: 'panel_glass', floor: 'floor_neon',
    wallRough: 0.3, wallMetal: 0.55, floorRough: 0.38, floorMetal: 0.3, env: 1.0,
    wallBump: 2, floorBump: 0, wallEmissive: 1.3, floorEmissive: 0.8,
  },
  Ice: {
    wall: 'ice', floor: 'floor_ice',
    wallRough: 0.2, wallMetal: 0.06, floorRough: 0.16, floorMetal: 0.04, env: 1.35,
    wallBump: 1.5, floorBump: 1.5,
  },
  Ruins: {
    wall: 'brick_ruin', floor: 'floor_stone',
    wallRough: 0.97, wallMetal: 0.0, floorRough: 0.95, floorMetal: 0.0, env: 0.2,
    wallBump: 6, floorBump: 5,
  },
  Toxic: {
    wall: 'moss', floor: 'floor_moss',
    wallRough: 0.92, wallMetal: 0.03, floorRough: 0.86, floorMetal: 0.02, env: 0.3,
    wallBump: 4, floorBump: 4,
  },
  Crimson: {
    wall: 'metal', floor: 'floor_metal',
    wallRough: 0.52, wallMetal: 0.5, floorRough: 0.46, floorMetal: 0.45, env: 0.75,
    wallBump: 3, floorBump: 4,
  },
};

export function createMaterials(map) {
  const pal = map.palette;
  const surf = SURFACES[paletteKey(pal)];
  const [w, d] = map.size;

  const floorSurf = surfaceTexture(surf.floor, pal.floor, pal.accent, surf.floorOpts ?? {});
  floorSurf.map.repeat.set(w / 4, d / 4);
  if (floorSurf.emissiveMap) floorSurf.emissiveMap.repeat.set(w / 4, d / 4);
  if (floorSurf.bumpMap) floorSurf.bumpMap.repeat.set(w / 4, d / 4);
  const floorMat = new THREE.MeshStandardMaterial({
    map: floorSurf.map,
    roughness: surf.floorRough,
    metalness: surf.floorMetal,
    envMapIntensity: surf.env,
    ...(floorSurf.emissiveMap ? {
      emissive: new THREE.Color(pal.accent),
      emissiveIntensity: surf.floorEmissive ?? 0.55,
      emissiveMap: floorSurf.emissiveMap,
    } : {}),
    ...(floorSurf.bumpMap && surf.floorBump ? { bumpMap: floorSurf.bumpMap, bumpScale: surf.floorBump } : {}),
  });

  // one shared wall material per box color — UVs are scaled per box instead
  // of cloning the material/texture, so texture density matches all faces
  const wallMatCache = new Map();
  const wallMat = (color) => {
    if (!wallMatCache.has(color)) {
      const s = surfaceTexture(surf.wall, color, pal.accent, surf.wallOpts ?? {});
      const m = new THREE.MeshStandardMaterial({
        map: s.map,
        roughness: surf.wallRough,
        metalness: surf.wallMetal,
        envMapIntensity: surf.env,
      });
      if (s.emissiveMap) {
        m.emissive = new THREE.Color(pal.accent);
        m.emissiveIntensity = surf.wallEmissive ?? 0.75;
        m.emissiveMap = s.emissiveMap;
      }
      if (s.bumpMap && surf.wallBump) {
        m.bumpMap = s.bumpMap;
        m.bumpScale = surf.wallBump;
      }
      wallMatCache.set(color, m);
    }
    return wallMatCache.get(color);
  };

  // emissive accent material: any box whose color equals palette.accent
  // glows — the emissive mask keeps only stripes/rim hot (tight bloom)
  const accentSurf = surfaceTexture('accent', pal.accent, pal.accent);
  const accentBoxMat = new THREE.MeshStandardMaterial({
    map: accentSurf.map,
    emissive: new THREE.Color(pal.accent),
    emissiveIntensity: 1.1,
    emissiveMap: accentSurf.emissiveMap,
    roughness: 0.42,
    metalness: 0.18,
    envMapIntensity: surf.env,
  });

  return { floorMat, wallMat, accentBoxMat };
}
