import * as THREE from 'three';
import { paletteKey } from './util.js';

// =====================================================================
// FROZEN INTERFACE — scene lighting + fog (owns ALL map lights).
//
//   addLighting(scene, group, map, sites)
//     Adds hemisphere light, the sun (the ONLY shadow caster, with an
//     ortho shadow box fitted to the map), an accent fill directional,
//     ambient light, `scene.fog`, and the map point lights: one per
//     plant site first, then midmap accent spots, HARD-CAPPED at <= 4
//     point lights total (the viewmodel adds its own separately).
//     `sites` is the object returned by sites.js (insertion order of
//     map.sites determines which sites get lights when there are > 4).
//
// This module owns the lighting half of the theme table: sun/hemi/fill/
// ambient/fog scaling values per palette.
// =====================================================================

// Lighting identity per palette (keyed by util.paletteKey).
const LIGHTING = {
  Spree: {
    sun: { color: '#fff3e0', intensity: 2.1, pos: [0.5, 0.75, 0.35] },
    hemi: { sky: '#9fc8e8', ground: '#54646f', intensity: 2.0 },
    fill: 0.55, ambient: 1.0,
    fogNear: 1.0, fogFar: 1.0,
  },
  Sand: {
    sun: { color: '#ffdca8', intensity: 2.0, pos: [0.62, 0.5, 0.2] },
    hemi: { sky: '#e8c890', ground: '#8a7a55', intensity: 1.05 },
    fill: 0.4, ambient: 0.55,
    fogNear: 1.05, fogFar: 1.1,
  },
  Neon: {
    sun: { color: '#cfd4ff', intensity: 1.4, pos: [0.4, 0.8, 0.3] },
    hemi: { sky: '#8a6cf0', ground: '#413465', intensity: 1.6 },
    fill: 1.0, ambient: 0.95,
    fogNear: 0.9, fogFar: 0.95,
  },
  Ice: {
    sun: { color: '#eaf6ff', intensity: 1.9, pos: [0.45, 0.85, 0.4] },
    hemi: { sky: '#cfe8f8', ground: '#5a7484', intensity: 1.15 },
    fill: 0.45, ambient: 0.55,
    fogNear: 1.1, fogFar: 1.2,
  },
  Ruins: {
    sun: { color: '#ffc890', intensity: 2.0, pos: [0.65, 0.42, 0.15] },
    hemi: { sky: '#c8a880', ground: '#6a604f', intensity: 1.6 },
    fill: 0.45, ambient: 0.85,
    fogNear: 0.95, fogFar: 1.0,
  },
  Toxic: {
    sun: { color: '#e8f0c8', intensity: 1.9, pos: [0.4, 0.7, 0.4] },
    hemi: { sky: '#aed494', ground: '#46583e', intensity: 1.9 },
    fill: 0.6, ambient: 1.0,
    fogNear: 0.85, fogFar: 0.85,
  },
  Crimson: {
    sun: { color: '#ffd0c0', intensity: 1.9, pos: [0.55, 0.6, 0.25] },
    hemi: { sky: '#f0a094', ground: '#64424a', intensity: 1.7 },
    fill: 0.65, ambient: 0.95,
    fogNear: 0.95, fogFar: 0.95,
  },
};

export function addLighting(scene, group, map, sites) {
  const pal = map.palette;
  const theme = LIGHTING[paletteKey(pal)];
  const [w, d] = map.size;
  const maxDim = Math.max(w, d);

  // --- Fog -----------------------------------------------------------------
  const fogNear = maxDim * 0.5 * theme.fogNear;
  const fogFar = Math.max(maxDim * 2.0 * theme.fogFar, Math.hypot(w, d) + 55);
  scene.fog = new THREE.Fog(new THREE.Color(pal.fog ?? pal.skyBottom), fogNear, fogFar);

  // --- Global lights ---------------------------------------------------------
  const hemi = new THREE.HemisphereLight(new THREE.Color(theme.hemi.sky), new THREE.Color(theme.hemi.ground), theme.hemi.intensity);
  group.add(hemi);

  const sun = new THREE.DirectionalLight(new THREE.Color(theme.sun.color), theme.sun.intensity);
  sun.position.set(theme.sun.pos[0] * w, theme.sun.pos[1] * 90, theme.sun.pos[2] * d);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 5;
  sun.shadow.camera.far = 320;
  sun.shadow.bias = -0.0003;
  sun.shadow.normalBias = 0.05;
  const half = Math.hypot(w, d) / 2 + 12; // fit ortho shadow box to the map
  const sc = sun.shadow.camera;
  sc.left = -half; sc.right = half; sc.top = half; sc.bottom = -half;
  sc.updateProjectionMatrix();
  group.add(sun);

  const fill = new THREE.DirectionalLight(new THREE.Color(pal.accent), theme.fill);
  fill.position.set(-0.4 * w, 40, -0.3 * d);
  group.add(fill);
  const amb = new THREE.AmbientLight(0xffffff, theme.ambient);
  group.add(amb);

  // --- Point lights (<= 4 total) --------------------------------------------
  const pointLights = [];
  for (const key of Object.keys(sites)) {
    if (pointLights.length >= 4) break;
    const center = sites[key].center;
    const pl = new THREE.PointLight(new THREE.Color(pal.accent), 14, 20, 2);
    pl.position.set(center.x, 3.4, center.z);
    group.add(pl);
    pointLights.push(pl);
  }
  // midmap accent lights (map point lights stay <= 4; viewmodel adds its own)
  const midSpots = Object.keys(sites).length
    ? [[0, 0]]
    : [[0, 0], [-w / 4, -d / 4], [w / 4, d / 4]];
  for (const [mx, mz] of midSpots) {
    if (pointLights.length >= 4) break;
    const pl = new THREE.PointLight(new THREE.Color(pal.accent), 9, 18, 2);
    pl.position.set(mx, 4.6, mz);
    group.add(pl);
    pointLights.push(pl);
  }
}
