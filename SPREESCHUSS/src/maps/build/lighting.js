import * as THREE from 'three';
import { paletteKey, hashStr, mulberry32 } from './util.js';

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
//
// Budget (hard): 1 hemi + 1 ambient + 2 directionals (sun + fill, only
// the sun casts shadows) + <= 4 point lights. Everything is static and
// deterministic per palette (seeded from paletteKey — never the shared
// map PRNG, which later build stages depend on).
// =====================================================================

// Lighting identity per palette (keyed by util.paletteKey).
//
//   sun.dir      — normalized-ish direction the sun sits in (y = elevation;
//                  low y => long raking shadows).
//   fill         — second directional: colored bounce/rim from the opposite
//                  side of the sun, never casts shadows.
//   points.site  — [color, intensity] of the pool over each plant site.
//   points.accents — up to two [color, intensity] midmap / arena accents.
//
// Balance notes (ACES, in-game exposure 1.2): floor irradiance =
// sun*sin(elev) + hemi.sky + ambient. Keep it ~2.4–4.5 so no palette
// reads murky or blown out; dark-albedo palettes (Neon/Toxic/Crimson)
// sit higher, bright-albedo ones (Ice/Sand) lower.
const LIGHTING = {
  Spree: { // balanced overcast city — soft neutral key, cool skylight, gentle river-teal fill
    sun: { color: '#f2ecdf', intensity: 1.75, dir: [0.42, 0.9, 0.3] },
    hemi: { sky: '#a4c6e2', ground: '#4c5a66', intensity: 1.9 },
    fill: { color: '#4fa0b4', intensity: 0.5, dir: [-0.55, 0.5, -0.45] },
    ambient: { color: '#e6edf4', intensity: 0.9 },
    fogNear: 1.0, fogFar: 1.0,
    points: { site: ['#43b7c7', 15], accents: [['#ffb168', 9], ['#43b7c7', 8]] },
  },
  Sand: { // low hot desert sun, long shadows, cool blue sky filling the shade
    sun: { color: '#ffc887', intensity: 2.5, dir: [0.8, 0.38, 0.28] },
    hemi: { sky: '#f0d0a0', ground: '#7a6a48', intensity: 0.95 },
    fill: { color: '#88aed8', intensity: 0.55, dir: [-0.7, 0.5, -0.35] },
    ambient: { color: '#ffeed8', intensity: 0.5 },
    fogNear: 1.05, fogFar: 1.1,
    points: { site: ['#ffcf6f', 13], accents: [['#ffdca0', 8], ['#ffb668', 8]] },
  },
  Neon: { // dim cool moon key; strong magenta fill + raised ambient so emissives carry
    sun: { color: '#aab4ff', intensity: 0.95, dir: [0.35, 0.85, 0.3] },
    hemi: { sky: '#7a5ce8', ground: '#2c2148', intensity: 1.5 },
    fill: { color: '#ff3fa4', intensity: 1.35, dir: [-0.6, 0.4, -0.5] },
    ambient: { color: '#c8bfff', intensity: 1.15 },
    fogNear: 0.95, fogFar: 0.95,
    points: { site: ['#ff3fa4', 19], accents: [['#7a5cff', 12], ['#ff3fa4', 11]] },
  },
  Ice: { // high cold key + bright ambient bounce off the snowpack
    sun: { color: '#eef8ff', intensity: 2.25, dir: [0.42, 0.78, 0.3] },
    hemi: { sky: '#dceefc', ground: '#7e96a8', intensity: 1.35 },
    fill: { color: '#9fd8f0', intensity: 0.35, dir: [-0.5, 0.55, -0.4] },
    ambient: { color: '#dfeefb', intensity: 0.68 },
    fogNear: 1.1, fogFar: 1.2,
    points: { site: ['#7fe0ff', 12], accents: [['#bef0ff', 7], ['#7fe0ff', 7]] },
  },
  Ruins: { // ember dusk: raking amber sun through dust, cool slate shade
    sun: { color: '#ffa055', intensity: 2.8, dir: [0.88, 0.26, 0.14] },
    hemi: { sky: '#c8a284', ground: '#48403a', intensity: 1.2 },
    fill: { color: '#6a84a8', intensity: 0.7, dir: [-0.75, 0.42, -0.3] },
    ambient: { color: '#f0d8c0', intensity: 0.6 },
    fogNear: 0.95, fogFar: 1.0,
    points: { site: ['#ffa050', 13], accents: [['#ffc880', 8], ['#ff9a4a', 8]] },
  },
  Toxic: { // sickly green hemisphere dominates a weak hazy key
    sun: { color: '#dcecc0', intensity: 1.45, dir: [0.4, 0.7, 0.42] },
    hemi: { sky: '#b2dc8e', ground: '#26381e', intensity: 2.3 },
    fill: { color: '#9fe04a', intensity: 0.5, dir: [-0.5, 0.45, -0.5] },
    ambient: { color: '#d6e8c0', intensity: 0.75 },
    fogNear: 0.9, fogFar: 0.85,
    points: { site: ['#9fe04a', 15], accents: [['#c8f07a', 9], ['#78c83c', 9]] },
  },
  Crimson: { // dramatic split: warm ember key vs teal counter-fill
    sun: { color: '#ffab88', intensity: 2.25, dir: [0.7, 0.48, 0.22] },
    hemi: { sky: '#e89a8e', ground: '#3c2a34', intensity: 1.25 },
    // brightened cyan so the split still reads on red-dominant albedos
    fill: { color: '#45d8cc', intensity: 1.5, dir: [-0.7, 0.36, -0.55] },
    ambient: { color: '#f4dcd4', intensity: 0.7 },
    fogNear: 0.95, fogFar: 0.95,
    points: { site: ['#ff5a6a', 15], accents: [['#2ed8c8', 11], ['#ff7a5a', 9]] },
  },
};

export function addLighting(scene, group, map, sites) {
  const pal = map.palette;
  const theme = LIGHTING[paletteKey(pal)];
  const [w, d] = map.size;
  const maxDim = Math.max(w, d);

  // --- Fog -----------------------------------------------------------------
  // Near is clamped to >= 0.45 * maxDim so gameplay space is never hidden;
  // far keeps the same floor as before (map diagonal + 55) so on the deepest
  // maps the far site sits well inside the first third of the fog band.
  const fogNear = maxDim * Math.max(0.45, 0.5 * theme.fogNear);
  const fogFar = Math.max(maxDim * 2.0 * theme.fogFar, Math.hypot(w, d) + 55);
  scene.fog = new THREE.Fog(new THREE.Color(pal.fog ?? pal.skyBottom), fogNear, fogFar);

  // --- Global lights ---------------------------------------------------------
  const hemi = new THREE.HemisphereLight(new THREE.Color(theme.hemi.sky), new THREE.Color(theme.hemi.ground), theme.hemi.intensity);
  group.add(hemi);

  const sun = new THREE.DirectionalLight(new THREE.Color(theme.sun.color), theme.sun.intensity);
  const sunDir = new THREE.Vector3(theme.sun.dir[0], theme.sun.dir[1], theme.sun.dir[2]).normalize();
  sun.position.copy(sunDir).multiplyScalar(maxDim * 0.85 + 30);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  group.add(sun);
  group.add(sun.target); // target stays at the map origin
  fitSunShadow(sun, w, d);

  const fill = new THREE.DirectionalLight(new THREE.Color(theme.fill.color), theme.fill.intensity);
  fill.position.set(theme.fill.dir[0] * w, theme.fill.dir[1] * 80, theme.fill.dir[2] * d);
  group.add(fill);

  const amb = new THREE.AmbientLight(new THREE.Color(theme.ambient.color), theme.ambient.intensity);
  group.add(amb);

  // --- Point lights (<= 4 total) --------------------------------------------
  addPointLights(group, map, sites, theme, w, d);
}

// Fit the sun's ortho shadow box exactly to the shadow-relevant volume (the
// playable area up to the perimeter-wall caps) by projecting its corners into
// light space — much tighter than the old diagonal-radius fit, so the 2048
// map spends all its texels on real casters. Bias scales with the resulting
// texel size to kill acne on big maps without peter-panning small ones.
function fitSunShadow(sun, w, d) {
  const hx = w / 2 + 1.2; // + perimeter wall thickness/caps
  const hz = d / 2 + 1.2;
  const maxH = 6.6;       // WALL_HEIGHT (6) + roof caps

  const view = new THREE.Matrix4()
    .lookAt(sun.position, new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0))
    .setPosition(sun.position)
    .invert();

  const v = new THREE.Vector3();
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  let minDist = Infinity, maxDist = -Infinity;
  for (const cx of [-hx, hx]) {
    for (const cy of [0, maxH]) {
      for (const cz of [-hz, hz]) {
        v.set(cx, cy, cz).applyMatrix4(view);
        minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x);
        minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
        minDist = Math.min(minDist, -v.z); maxDist = Math.max(maxDist, -v.z);
      }
    }
  }

  const pad = 2.5; // PCF kernel margin
  const sc = sun.shadow.camera;
  sc.left = minX - pad;
  sc.right = maxX + pad;
  sc.bottom = minY - pad;
  sc.top = maxY + pad;
  sc.near = Math.max(1, minDist - 6);
  sc.far = maxDist + 10;
  sc.updateProjectionMatrix();

  const texel = Math.max(sc.right - sc.left, sc.top - sc.bottom) / 2048;
  sun.shadow.bias = -(0.0001 + texel * 0.0025);
  sun.shadow.normalBias = THREE.MathUtils.clamp(texel * 1.7, 0.02, 0.09);
}

// Point-light spend strategy (cap 4, sun stays the only shadow caster):
//   plant maps — one pool per site (insertion order) first, then up to two
//   colored accents weaving down the mid corridor;
//   FFA maps  — all four on arena rhythm: a hero light over the central
//   feature + three ring accents at palette-seeded phase.
// Distance/decay are tuned so each light reads as a pool on the floor
// instead of a broad wash.
function addPointLights(group, map, sites, theme, w, d) {
  const rng = mulberry32(hashStr('pl:' + paletteKey(map.palette)));
  let budget = 4;
  const add = (color, intensity, x, y, z, dist, decay) => {
    if (budget <= 0) return;
    budget--;
    const pl = new THREE.PointLight(new THREE.Color(color), intensity, dist, decay);
    pl.position.set(x, y, z);
    group.add(pl);
  };

  const siteKeys = Object.keys(sites);
  if (siteKeys.length) {
    // plant map: site pools first (frozen insertion-order semantics)
    const [siteColor, siteInt] = theme.points.site;
    for (const key of siteKeys) {
      if (budget <= 0) break;
      const s = sites[key];
      const dist = THREE.MathUtils.clamp(s.radius * 3.8, 15, 22);
      add(siteColor, siteInt, s.center.x, 3.1, s.center.z, dist, 1.9);
    }
    // midmap accents on alternating sides of the mid corridor
    const side = rng() < 0.5 ? -1 : 1;
    const spots = [
      [side * (1.6 + rng() * 1.2), -d * 0.14],
      [-side * (1.6 + rng() * 1.2), d * 0.08],
    ];
    for (let i = 0; i < spots.length && budget > 0; i++) {
      const [color, intensity] = theme.points.accents[i % theme.points.accents.length];
      add(color, intensity, spots[i][0], 4.3, spots[i][1], 16, 2.0);
    }
  } else {
    // FFA arena: hero pool over the central feature + a phased accent ring
    const [heroColor, heroInt] = theme.points.site;
    add(heroColor, heroInt + 2, 0, 5.5, 0, 26, 1.8);
    const ringR = Math.min(w, d) * 0.3;
    const phase = rng() * Math.PI * 2;
    for (let i = 0; i < 3 && budget > 0; i++) {
      const a = phase + (i / 3) * Math.PI * 2;
      const [color, intensity] = theme.points.accents[i % theme.points.accents.length];
      add(color, intensity + 2, Math.cos(a) * ringR, 4.2, Math.sin(a) * ringR, 19, 1.9);
    }
  }
}
