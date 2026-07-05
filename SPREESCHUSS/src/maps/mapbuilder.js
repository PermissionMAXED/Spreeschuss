import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { surfaceTexture, skyTexture, glowTexture, letterTexture } from '../engine/textures.js';

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

// ---------------------------------------------------------------- themes
// Visual identity per palette. Palettes are matched by color distance (the
// map-data generator may omit `name`), falling back to concrete.
const THEMES = {
  Spree: {
    ref: { floor: '#3a4a5a', wall: '#5a6b7a', accent: '#43b7c7' },
    wall: 'concrete', floor: 'floor_concrete',
    wallRough: 0.82, wallMetal: 0.06, floorRough: 0.9, floorMetal: 0.04, env: 0.45,
    sun: { color: '#fff3e0', intensity: 2.1, pos: [0.5, 0.75, 0.35] },
    hemi: { sky: '#9fc8e8', ground: '#54646f', intensity: 2.0 },
    fill: 0.55, ambient: 1.0,
    sky: { horizon: 'city', windows: 0.4, stars: 110, clouds: 5, reflect: true, glow: 0.3 },
    fogNear: 1.0, fogFar: 1.0,
    skyline: 'city', cranes: 2,
  },
  Sand: {
    ref: { floor: '#8a7a55', wall: '#b7a06a', accent: '#e0b84a' },
    wall: 'brick', floor: 'floor_stone',
    wallRough: 0.95, wallMetal: 0.0, floorRough: 0.95, floorMetal: 0.0, env: 0.25,
    sun: { color: '#ffdca8', intensity: 2.0, pos: [0.62, 0.5, 0.2] },
    hemi: { sky: '#e8c890', ground: '#8a7a55', intensity: 1.05 },
    fill: 0.4, ambient: 0.55,
    sky: { horizon: 'ridge', stars: 45, clouds: 4, disc: '#ffd9a0', discSize: 0.06, glow: 0.5 },
    fogNear: 1.05, fogFar: 1.1,
    skyline: 'slabs', cranes: 0,
  },
  Neon: {
    ref: { floor: '#3a3560', wall: '#544c86', accent: '#ff3fa4' },
    wall: 'neon', floor: 'floor_neon',
    wallRough: 0.5, wallMetal: 0.35, floorRough: 0.4, floorMetal: 0.3, env: 0.8,
    sun: { color: '#cfd4ff', intensity: 1.4, pos: [0.4, 0.8, 0.3] },
    hemi: { sky: '#8a6cf0', ground: '#413465', intensity: 1.6 },
    fill: 1.0, ambient: 0.95,
    sky: { horizon: 'city', windows: 0.6, stars: 170, reflect: true, glow: 0.5 },
    fogNear: 0.9, fogFar: 0.95,
    skyline: 'city', cranes: 1,
  },
  Ice: {
    ref: { floor: '#6a8090', wall: '#9fc0d0', accent: '#7fe0ff' },
    wall: 'ice', floor: 'floor_ice',
    wallRough: 0.22, wallMetal: 0.08, floorRough: 0.18, floorMetal: 0.05, env: 1.3,
    sun: { color: '#eaf6ff', intensity: 1.9, pos: [0.45, 0.85, 0.4] },
    hemi: { sky: '#cfe8f8', ground: '#5a7484', intensity: 1.15 },
    fill: 0.45, ambient: 0.55,
    sky: { horizon: 'ridge', stars: 150, clouds: 3, disc: '#eafcff', discSize: 0.045, glow: 0.3 },
    fogNear: 1.1, fogFar: 1.2,
    skyline: 'shards', cranes: 0,
  },
  Ruins: {
    ref: { floor: '#6a6052', wall: '#8a7a68', accent: '#e0a95a' },
    wall: 'brick_ruin', floor: 'floor_stone',
    wallRough: 0.97, wallMetal: 0.0, floorRough: 0.96, floorMetal: 0.0, env: 0.2,
    sun: { color: '#ffc890', intensity: 2.0, pos: [0.65, 0.42, 0.15] },
    hemi: { sky: '#c8a880', ground: '#6a604f', intensity: 1.6 },
    fill: 0.45, ambient: 0.85,
    sky: { horizon: 'ridge', stars: 60, clouds: 6, disc: '#ffb46a', discSize: 0.07, glow: 0.5 },
    fogNear: 0.95, fogFar: 1.0,
    skyline: 'slabs', cranes: 1,
  },
  Toxic: {
    ref: { floor: '#3a4a34', wall: '#557048', accent: '#9fe04a' },
    wall: 'moss', floor: 'floor_moss',
    wallRough: 0.9, wallMetal: 0.04, floorRough: 0.85, floorMetal: 0.02, env: 0.3,
    sun: { color: '#e8f0c8', intensity: 1.9, pos: [0.4, 0.7, 0.4] },
    hemi: { sky: '#aed494', ground: '#46583e', intensity: 1.9 },
    fill: 0.6, ambient: 1.0,
    sky: { horizon: 'ridge', stars: 50, clouds: 7, glow: 0.38 },
    fogNear: 0.85, fogFar: 0.85,
    skyline: 'city', cranes: 1,
  },
  Crimson: {
    ref: { floor: '#5a3840', wall: '#804a56', accent: '#ff5a6a' },
    wall: 'metal', floor: 'floor_metal',
    wallRough: 0.55, wallMetal: 0.45, floorRough: 0.5, floorMetal: 0.4, env: 0.7,
    sun: { color: '#ffd0c0', intensity: 1.9, pos: [0.55, 0.6, 0.25] },
    hemi: { sky: '#f0a094', ground: '#64424a', intensity: 1.7 },
    fill: 0.65, ambient: 0.95,
    sky: { horizon: 'city', windows: 0.28, stars: 90, disc: '#ff6a5a', discSize: 0.08, glow: 0.45 },
    fogNear: 0.95, fogFar: 0.95,
    skyline: 'city', cranes: 1,
  },
};

function colorDist(a, b) {
  const ca = new THREE.Color(a);
  const cb = new THREE.Color(b);
  return (ca.r - cb.r) ** 2 + (ca.g - cb.g) ** 2 + (ca.b - cb.b) ** 2;
}

function detectTheme(pal) {
  if (pal.name && THEMES[pal.name]) return THEMES[pal.name];
  let best = THEMES.Spree;
  let bestD = Infinity;
  for (const t of Object.values(THEMES)) {
    const d2 = colorDist(pal.wall, t.ref.wall) + colorDist(pal.floor, t.ref.floor) + colorDist(pal.accent, t.ref.accent);
    if (d2 < bestD) { bestD = d2; best = t; }
  }
  return best;
}

function hashStr(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

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

// ---------------------------------------------------------------- build
export function buildMap(scene, map) {
  const group = new THREE.Group();
  group.name = 'map';
  scene.add(group);

  const pal = map.palette;
  const theme = detectTheme(pal);
  const [w, d] = map.size;
  const maxDim = Math.max(w, d);
  const rand = mulberry32(hashStr(map.id || map.name || 'map'));

  // --- Sky + environment + fog -------------------------------------------
  const sky = skyTexture(pal.skyTop, pal.skyBottom, { ...theme.sky, accent: pal.accent });
  scene.background = sky;
  // Image-based env reflections only where the theme is glossy enough to
  // show them (Ice/Neon/Crimson); rough themes skip the per-fragment cost.
  scene.environment = theme.env >= 0.6 ? sky : null;

  const fogNear = maxDim * 0.5 * theme.fogNear;
  const fogFar = Math.max(maxDim * 2.0 * theme.fogFar, Math.hypot(w, d) + 55);
  scene.fog = new THREE.Fog(new THREE.Color(pal.fog ?? pal.skyBottom), fogNear, fogFar);

  // --- Lighting (this file owns all scene lights) -------------------------
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

  // --- Shared materials ----------------------------------------------------
  const floorSurf = surfaceTexture(theme.floor, pal.floor, pal.accent);
  floorSurf.map.repeat.set(w / 4, d / 4);
  if (floorSurf.emissiveMap) floorSurf.emissiveMap.repeat.set(w / 4, d / 4);
  const floorMat = new THREE.MeshStandardMaterial({
    map: floorSurf.map,
    roughness: theme.floorRough,
    metalness: theme.floorMetal,
    envMapIntensity: theme.env,
    ...(floorSurf.emissiveMap ? { emissive: new THREE.Color(pal.accent), emissiveIntensity: 0.55, emissiveMap: floorSurf.emissiveMap } : {}),
  });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, d), floorMat);
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

  // one shared wall material per box color — UVs are scaled per box instead
  // of cloning the material/texture, so texture density matches all faces
  const wallMatCache = new Map();
  const wallMat = (color) => {
    if (!wallMatCache.has(color)) {
      const surf = surfaceTexture(theme.wall, color, pal.accent);
      const m = new THREE.MeshStandardMaterial({
        map: surf.map,
        roughness: theme.wallRough,
        metalness: theme.wallMetal,
        envMapIntensity: theme.env,
      });
      if (surf.emissiveMap) {
        m.emissive = new THREE.Color(pal.accent);
        m.emissiveIntensity = 0.75;
        m.emissiveMap = surf.emissiveMap;
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
    envMapIntensity: theme.env,
  });

  // --- Gameplay geometry (colliders EXACTLY as before) --------------------
  // All boxes sharing a material are merged into ONE mesh (huge draw-call
  // saving, since every mesh is also redrawn into the shadow map). Colliders
  // are tracked independently and stay exactly center±size/2 per box.
  const colliders = [];
  const boxBuckets = new Map(); // material -> geometries
  const addBox = (pos, size, color) => {
    const geo = scaleBoxUVs(new THREE.BoxGeometry(size[0], size[1], size[2]), size[0], size[1], size[2]);
    geo.translate(pos[0], pos[1], pos[2]);
    const isAccent = color != null && color === pal.accent;
    const mat = isAccent ? accentBoxMat : wallMat(color || pal.wall);
    if (!boxBuckets.has(mat)) boxBuckets.set(mat, []);
    boxBuckets.get(mat).push(geo);
    colliders.push({
      min: new THREE.Vector3(pos[0] - size[0] / 2, pos[1] - size[1] / 2, pos[2] - size[2] / 2),
      max: new THREE.Vector3(pos[0] + size[0] / 2, pos[1] + size[1] / 2, pos[2] + size[2] / 2),
    });
  };

  // Outer perimeter walls (collider layout FROZEN: height 6, thickness 1)
  const H = 6;
  const t = 1;
  addBox([0, H / 2, -d / 2], [w + t, H, t], pal.wall);
  addBox([0, H / 2, d / 2], [w + t, H, t], pal.wall);
  addBox([-w / 2, H / 2, 0], [t, H, d + t], pal.wall);
  addBox([w / 2, H / 2, 0], [t, H, d + t], pal.wall);

  // Interior boxes / cover / walls
  for (const b of map.boxes || []) {
    addBox(b.pos, b.size, b.color);
  }
  for (const [mat, geos] of boxBuckets) {
    const mesh = new THREE.Mesh(mergeGeometries(geos, false), mat);
    for (const g of geos) g.dispose();
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  // --- Boundary decoration (NO colliders) ---------------------------------
  addWallTrim(group, w, d, H, t, pal, theme);
  addSkyline(group, w, d, pal, theme, rand);

  // --- Site presentation ---------------------------------------------------
  const sites = {};
  const pointLights = [];
  for (const key of Object.keys(map.sites || {})) {
    const s = map.sites[key];
    const center = new THREE.Vector3(s.center[0], 0.02, s.center[1]);
    const ring = addSiteMarker(group, key, center, s.radius, pal);
    sites[key] = { center, radius: s.radius, ring };
    if (pointLights.length < 4) {
      const pl = new THREE.PointLight(new THREE.Color(pal.accent), 14, 20, 2);
      pl.position.set(center.x, 3.4, center.z);
      group.add(pl);
      pointLights.push(pl);
    }
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

  const spawns = normalizeSpawns(map.spawns);

  return {
    colliders,
    spawns,
    sites,
    bounds: { min: new THREE.Vector3(-w / 2, 0, -d / 2), max: new THREE.Vector3(w / 2, H, d / 2) },
    group,
  };
}

// ------------------------------------------------------------- decoration

// helper: box geometry translated into place, for merged decoration meshes
function placedBox(sx, sy, sz, x, y, z, ry = 0) {
  const g = new THREE.BoxGeometry(sx, sy, sz);
  if (ry) g.rotateY(ry);
  g.translate(x, y, z);
  return g;
}

// Thin accent strips mounted on the collidered perimeter walls (<= 0.05
// proud, so hitscan still resolves against the wall collider) + roof caps.
// Everything merges into two meshes (glow trim + dark skirt/caps).
function addWallTrim(group, w, d, H, t, pal, theme) {
  const trimMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(pal.accent).multiplyScalar(0.5),
    emissive: new THREE.Color(pal.accent),
    emissiveIntensity: 1.1,
    roughness: 0.4,
    metalness: 0.2,
  });
  const darkMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(pal.wall).multiplyScalar(0.35),
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
  const merge = (geos, mat) => {
    const m = new THREE.Mesh(mergeGeometries(geos, false), mat);
    for (const g of geos) g.dispose();
    group.add(m);
  };
  merge(glowGeos, trimMat);
  merge(darkGeos, darkMat);
}

// Silhouette architecture OUTSIDE the perimeter walls: facade towers with
// lit windows, corner pillars, antenna masts and simple cranes. Players can
// never reach these, so none of it has colliders and rotation is allowed.
// All geometry merges into 4 meshes (facades / dark / accent caps / tip
// lights) + a handful of glow sprites, keeping draw calls low.
function addSkyline(group, w, d, pal, theme, rand) {
  const deco = new THREE.Group();
  deco.name = 'skyline';
  group.add(deco);

  // Lambert materials: skyline is distant silhouette fill, PBR would only
  // cost fragment work (esp. with scene.environment set) with no visible gain
  const facadeSurf = surfaceTexture('facade', pal.wall, pal.accent, { density: theme.skyline === 'city' ? 0.42 : 0.14 });
  const facadeMat = new THREE.MeshLambertMaterial({
    map: facadeSurf.map,
    emissiveMap: facadeSurf.map,
    emissive: new THREE.Color('#ffffff'),
    emissiveIntensity: 0.5,
  });
  const darkMat = new THREE.MeshLambertMaterial({
    color: new THREE.Color(pal.fog ?? pal.skyBottom).multiplyScalar(0.5),
  });
  const capMat = new THREE.MeshLambertMaterial({
    color: new THREE.Color(pal.accent).multiplyScalar(0.6),
    emissive: new THREE.Color(pal.accent),
    emissiveIntensity: 1.2,
  });
  const tipMat = new THREE.MeshBasicMaterial({ color: 0xff4444 });

  const facadeGeos = [];
  const darkGeos = [];
  const capGeos = [];
  const tipGeos = [];
  const glowSpots = [];
  const tip = (x, y, z, r = 0.32) => {
    const g = new THREE.SphereGeometry(r, 6, 6);
    g.translate(x, y, z);
    tipGeos.push(g);
    glowSpots.push([x, y, z]);
  };

  // ring of towers/slabs/shards around all 4 sides
  const sides = [
    { axis: 'z', sign: -1 }, { axis: 'z', sign: 1 },
    { axis: 'x', sign: -1 }, { axis: 'x', sign: 1 },
  ];
  for (const side of sides) {
    const len = side.axis === 'z' ? w : d;
    const count = Math.max(4, Math.round(len / 14));
    for (let i = 0; i < count; i++) {
      const along = -len / 2 + (i + 0.35 + rand() * 0.3) * (len / count);
      const away = (side.axis === 'z' ? d / 2 : w / 2) + 7 + rand() * 20;
      const bw = 5 + rand() * 8;
      const bh = theme.skyline === 'shards' ? 10 + rand() * 16 : 7 + rand() * rand() * 24;
      const x = side.axis === 'z' ? along : side.sign * away;
      const z = side.axis === 'z' ? side.sign * away : along;
      if (theme.skyline === 'shards') {
        const g = new THREE.ConeGeometry(0.5, 1, 5);
        g.scale(bw, bh, bw);
        g.rotateZ((rand() - 0.5) * 0.22);
        g.rotateY((rand() - 0.5) * 0.5);
        g.translate(x, bh / 2 - 0.6, z);
        darkGeos.push(g);
      } else {
        const g = placedBox(bw, bh, 4 + rand() * 6, 0, 0, 0, (rand() - 0.5) * 0.5);
        g.translate(x, bh / 2 - 0.6, z);
        (theme.skyline === 'slabs' && rand() > 0.4 ? darkGeos : facadeGeos).push(g);
      }
      // red aviation tip light on the tallest towers
      if (bh > 22 && theme.skyline !== 'shards') tip(x, bh - 0.4, z, 0.35);
    }
  }

  // glowing corner pillars just outside the arena corners
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const px = sx * (w / 2 + 1.6);
      const pz = sz * (d / 2 + 1.6);
      darkGeos.push(placedBox(1.4, 9, 1.4, px, 4.0, pz));
      capGeos.push(placedBox(1.5, 0.5, 1.5, px, 8.8, pz));
    }
  }

  // antenna masts
  for (let i = 0; i < 2; i++) {
    const sx = rand() > 0.5 ? 1 : -1;
    const sz = rand() > 0.5 ? 1 : -1;
    const px = sx * (w / 2 + 12 + rand() * 14);
    const pz = sz * (d / 2 + 12 + rand() * 14);
    const h2 = 24 + rand() * 12;
    const mast = new THREE.CylinderGeometry(0.22, 0.55, h2, 6);
    mast.translate(px, h2 / 2 - 0.5, pz);
    darkGeos.push(mast);
    for (const fy of [0.55, 0.8]) {
      darkGeos.push(placedBox(3.2, 0.18, 0.18, px, h2 * fy, pz, rand() * Math.PI));
    }
    tip(px, h2 - 0.2, pz, 0.3);
  }

  // construction cranes (Berlin!) for the urban themes
  for (let i = 0; i < (theme.cranes || 0); i++) {
    const ch = 18 + rand() * 8;
    const jib = 12 + rand() * 6;
    const yaw = rand() * Math.PI * 2;
    const sx = rand() > 0.5 ? 1 : -1;
    const sz = rand() > 0.5 ? 1 : -1;
    const cx = sx * (w / 2 + 10 + rand() * 16);
    const cz = sz * (d / 2 + 10 + rand() * 16);
    const parts = [
      placedBox(0.9, ch, 0.9, 0, ch / 2, 0),                       // mast
      placedBox(jib, 0.6, 0.7, jib / 2 - 2.5, ch + 0.3, 0),        // jib arm
      placedBox(1.6, 1.2, 1.2, -3.4, ch + 0.3, 0),                 // counterweight
    ];
    const cableLen = 6 + rand() * 6;
    parts.push(placedBox(0.08, cableLen, 0.08, jib - 4, ch - cableLen / 2 + 0.3, 0));
    for (const g of parts) {
      g.rotateY(yaw);
      g.translate(cx, -0.5, cz);
      darkGeos.push(g);
    }
    const tx = jib - 2.5;
    tip(cx + Math.cos(yaw) * tx, ch - 0.2, cz - Math.sin(yaw) * tx, 0.28);
  }

  const merge = (geos, mat) => {
    if (!geos.length) return;
    const m = new THREE.Mesh(mergeGeometries(geos, false), mat);
    for (const g of geos) g.dispose();
    deco.add(m);
  };
  merge(facadeGeos, facadeMat);
  merge(darkGeos, darkMat);
  merge(capGeos, capMat);
  merge(tipGeos, tipMat);

  // one shared additive glow sprite material for all tip lights
  if (glowSpots.length) {
    const gm = new THREE.SpriteMaterial({
      map: glowTexture(), color: new THREE.Color('#ff5544'),
      transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    });
    for (const [x, y, z] of glowSpots.slice(0, 10)) {
      const sp = new THREE.Sprite(gm);
      sp.scale.set(2.3, 2.3, 2.3);
      sp.position.set(x, y, z);
      deco.add(sp);
    }
  }
}

// Plant-site marker: crisp double ring + soft additive glow disc + faint
// light shaft + floating glowing letter sprite. Returns the main ring mesh
// (kept as the `ring` key of the site for the frozen contract).
function addSiteMarker(group, key, center, radius, pal) {
  const accent = new THREE.Color(pal.accent);

  const glowDisc = new THREE.Mesh(
    new THREE.CircleGeometry(radius * 0.96, 48),
    new THREE.MeshBasicMaterial({
      map: glowTexture(), color: accent, transparent: true, opacity: 0.4,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    }),
  );
  glowDisc.rotation.x = -Math.PI / 2;
  glowDisc.position.set(center.x, 0.015, center.z);
  group.add(glowDisc);

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(radius - 0.3, radius, 64),
    new THREE.MeshBasicMaterial({ color: accent, side: THREE.DoubleSide, transparent: true, opacity: 0.95 }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.copy(center);
  group.add(ring);

  const innerRing = new THREE.Mesh(
    new THREE.RingGeometry(radius - 1.0, radius - 0.84, 48),
    new THREE.MeshBasicMaterial({ color: accent, side: THREE.DoubleSide, transparent: true, opacity: 0.45 }),
  );
  innerRing.rotation.x = -Math.PI / 2;
  innerRing.position.set(center.x, 0.03, center.z);
  group.add(innerRing);

  // faint vertical light shaft up to the letter
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.32, 0.85, 3.0, 12, 1, true),
    new THREE.MeshBasicMaterial({
      color: accent, transparent: true, opacity: 0.14, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    }),
  );
  beam.position.set(center.x, 1.55, center.z);
  group.add(beam);

  const lbl = makeSiteLabel(key, pal.accent);
  lbl.position.set(center.x, 3.4, center.z);
  group.add(lbl);

  return ring;
}

function makeSiteLabel(letter, accentHex) {
  const mat = new THREE.SpriteMaterial({
    map: letterTexture(letter, accentHex),
    transparent: true,
    depthWrite: false,
  });
  const sp = new THREE.Sprite(mat);
  sp.scale.set(2.7, 2.7, 2.7);
  return sp;
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
