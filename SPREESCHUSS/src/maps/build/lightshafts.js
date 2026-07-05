import * as THREE from 'three';
import { hashStr, mulberry32, paletteKey, mergeInto } from './util.js';

// =====================================================================
// FROZEN INTERFACE — fake volumetric light shafts (decoration ONLY).
//
//   addLightShafts(group, map, sites)
//     Adds FAKE volumetric shafts (additive translucent cones / planes,
//     dust motes in the beam) suggesting light spilling over walls or
//     down from above. `group` is the map group, `map` the raw map-data
//     object (map.spawns holds raw [x, z, rot?] arrays; map.boxes the
//     collider boxes), `sites` the built sites object
//     { KEY: { center: THREE.Vector3, radius, ring } } from
//     addSiteMarkers (map.sites holds the raw data). These are meshes
//     only — NO THREE.Light of any kind (rule 1); shafts hanging into
//     the playable volume are overhead decor (rule 3c, lowest point
//     >= 2.6 m).
//
// DECORATION STAGE ORDER (FROZEN — mapbuilder.js calls these at the END
// of buildMap, AFTER addProps, in exactly this order):
//   addGroundFX -> addDoorDecor -> addLandmark -> addAnimatedDecor ->
//   addLightShafts -> addCallouts -> addAtmosphere
//
// SHARED HARD RULES (identical for all 7 decoration modules):
//   1. ZERO colliders, ZERO lights of any kind — lighting.js owns the
//      <= 4 point-light budget.
//   2. Determinism: use a LOCAL PRNG only —
//        const rnd = mulberry32(hashStr((map.id || map.name || 'map') + ':<modulename>'))
//      from ./util.js. NEVER touch the shared builder `rand`: the
//      existing stage order and shared-PRNG consumption are frozen, and
//      consuming `rand` would change structures/skyline/props visuals.
//   3. Placement safety (same rules as props.js): decor inside the
//      playable area must be one of
//        (a) a flat floor decal <= 0.021 high;
//        (b) mounted <= 0.06 proud of an existing collider face
//            (map.boxes, or the perimeter walls at +-w/2, +-d/2 with
//            thickness 1 / height 6 — see structures.js);
//        (c) overhead with its lowest point >= 2.6 m.
//      Keep >= 1 m XZ clearance from every spawn point (map.spawns
//      holds raw [x, z, rot?] arrays); site ring interiors
//      (center +- radius) may contain nothing except flat decals.
//   4. Disposal: Renderer.clearScene() disposes ALL scene geometries /
//      materials / textures between matches (three.js' shared Sprite
//      geometry excepted). Create FRESH Geometry / Material /
//      CanvasTexture instances on every call; CPU-side canvas caching
//      is allowed but must return fresh THREE.CanvasTexture wrappers
//      (same pattern as engine/textures.js). Never share module-level
//      Geometry/Material singletons.
//   5. Animation only via onBeforeRender hooks on this module's own
//      meshes — the render loop and game.js are frozen and will never
//      tick decorations.
//   6. Budget: <= 10 draw calls added (use mergeInto from ./util.js
//      for static parts), <= 1 THREE.Points system, modest canvas
//      sizes (<= 256 px).
// =====================================================================
//
// IMPLEMENTATION — 2..4 faked volumetric skylight shafts per map:
//   - each shaft = 2 crossed, slightly tapered gradient planes (bright
//     top -> transparent bottom, feathered left/right edges so there is
//     no hard silhouette from any angle) + a small "source" disc at the
//     top. Everything is AdditiveBlending / depthWrite:false / fog:false
//     so the beams never occlude gameplay and never depth-sort-pop
//     against other transparents (additive is order-independent).
//   - beam brightness stays far below the 0.9 bloom threshold (material
//     opacity <= 0.08); only the small ceiling source disc is allowed to
//     bloom faintly.
//   - ONE THREE.Points system carries the drifting dust motes of ALL
//     shafts (<= 240 points), animated via onBeforeRender (rule 5).
//   - draw calls: 1 merged beam mesh + 1 merged disc mesh + 1 Points
//     system = 3 total. Per-shaft tint rides on vertex colors so one
//     material serves every shaft (Neon alternates magenta/cyan).

// Shaft tint per palette (multiple entries alternate per shaft).
const TINTS = {
  Spree: ['#cfe4f2'], // cool daylight
  Sand: ['#ffd490'], // warm gold
  Neon: ['#ff4fae', '#4fe0f0'], // magenta / cyan
  Ice: ['#dcf2ff'], // pale blue (kept bright — reads over the pale scene)
  Ruins: ['#ffbe74'], // amber
  Toxic: ['#bcee74'], // sickly green
  Crimson: ['#ff7a68'], // deep red (lifted so it reads over red-on-red)
};

// ---------------------------------------------------------------- canvases
// CPU-side canvas cache (rule 4): canvases are painted once, but every
// call returns a FRESH THREE.CanvasTexture wrapper safe for clearScene.
const canvasCache = new Map();

function cachedCanvas(key, w, h, paint) {
  let c = canvasCache.get(key);
  if (!c) {
    c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    paint(c.getContext('2d'), w, h);
    canvasCache.set(key, c);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

// Beam gradient: bright top fading to nothing at the bottom edge, feathered
// left/right so the crossed planes read soft from every angle, with a few
// carved vertical streaks so the shaft reads as distinct light rays.
function beamTexture() {
  return cachedCanvas('lightshafts:beam', 128, 256, (ctx, w, h) => {
    const v = ctx.createLinearGradient(0, 0, 0, h);
    v.addColorStop(0.0, 'rgba(255,255,255,0)'); // feather the very top edge
    v.addColorStop(0.05, 'rgba(255,255,255,1)');
    v.addColorStop(0.32, 'rgba(255,255,255,0.9)');
    v.addColorStop(0.62, 'rgba(255,255,255,0.5)');
    v.addColorStop(0.86, 'rgba(255,255,255,0.16)');
    v.addColorStop(1.0, 'rgba(255,255,255,0)');
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, w, h);
    // subtle ray structure (deterministic)
    const rnd = mulberry32(hashStr('lightshafts:beam'));
    ctx.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 6; i++) {
      const x = 10 + rnd() * (w - 20);
      const sw = 5 + rnd() * 11;
      const a = 0.08 + rnd() * 0.14;
      const g = ctx.createLinearGradient(x - sw, 0, x + sw, 0);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(0.5, `rgba(0,0,0,${a.toFixed(3)})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - sw, 0, sw * 2, h);
    }
    // horizontal edge feather (alpha multiply)
    ctx.globalCompositeOperation = 'destination-in';
    const hg = ctx.createLinearGradient(0, 0, w, 0);
    hg.addColorStop(0, 'rgba(255,255,255,0)');
    hg.addColorStop(0.18, 'rgba(255,255,255,0.5)');
    hg.addColorStop(0.5, 'rgba(255,255,255,1)');
    hg.addColorStop(0.82, 'rgba(255,255,255,0.5)');
    hg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = hg;
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'source-over';
  });
}

// Soft radial glow for the ceiling "source" disc.
function discTexture() {
  return cachedCanvas('lightshafts:disc', 64, 64, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.45, 'rgba(255,255,255,0.4)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  });
}

// Tiny soft dot for the dust motes.
function moteTexture() {
  return cachedCanvas('lightshafts:mote', 32, 32, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.4, 'rgba(255,255,255,0.5)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  });
}

// ---------------------------------------------------------------- helpers

// Per-shaft tint via a vertex color attribute so ONE material (and ONE
// merged mesh) can serve differently tinted shafts.
function setVertexColor(geo, color) {
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = color.r;
    arr[i * 3 + 1] = color.g;
    arr[i * 3 + 2] = color.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
}

// ------------------------------------------------------------------ main

export function addLightShafts(group, map, sites) {
  // Local PRNG (rule 2) — NEVER the shared builder rand.
  const rnd = mulberry32(hashStr((map.id || map.name || 'map') + ':lightshafts'));

  const shafts = new THREE.Group();
  shafts.name = 'lightshafts';
  group.add(shafts);

  const [w, d] = map.size;
  const boxes = map.boxes || [];
  const spawnPts = [];
  for (const arr of Object.values(map.spawns || {})) {
    for (const s of arr || []) spawnPts.push([s[0], s[1]]);
  }
  const siteList = Object.values(sites || {}).map((s) => ({ x: s.center.x, z: s.center.z, r: s.radius }));

  // --- placement checks -----------------------------------------------------
  // Base circle overlaps no box footprint (every footprint inflated 0.6 —
  // lifted lintels included, the beam spans the full height).
  const openFloor = (x, z, r) => boxes.every((b) =>
    Math.abs(x - b.pos[0]) > b.size[0] / 2 + r + 0.6 ||
    Math.abs(z - b.pos[2]) > b.size[2] / 2 + r + 0.6);
  // Beam edge keeps >= 1.5 m XZ from every spawn point.
  const clearOfSpawns = (x, z, r) => spawnPts.every(([sx, sz]) =>
    Math.hypot(sx - x, sz - z) >= r + 1.5);
  // Whole beam stays >= 2 m outside every site ring (sites already have
  // their own vertical shaft — never double up there).
  const clearOfSites = (x, z, r) => siteList.every((s) =>
    Math.hypot(s.x - x, s.z - z) >= s.r + r + 2);

  const want = 2 + Math.floor(rnd() * 3); // 2..4 shafts
  const placed = [];
  for (let i = 0; i < 160 && placed.length < want; i++) {
    // later attempts try slimmer beams so cramped maps still find spots
    const r = 1.2 + rnd() * (i < 80 ? 1.4 : 0.5);
    const x = (rnd() * 2 - 1) * Math.max(2, w / 2 - r - 2.4);
    const z = (rnd() * 2 - 1) * Math.max(2, d / 2 - r - 2.4);
    if (!openFloor(x, z, r) || !clearOfSpawns(x, z, r) || !clearOfSites(x, z, r)) continue;
    if (placed.some((p) => Math.hypot(p.x - x, p.z - z) < p.r + r + 5)) continue;
    placed.push({
      x, z, r,
      top: 7 + rnd() * 2, // above WALL_HEIGHT 6 — reads as coming from the sky
      taper: 0.5 + rnd() * 0.2, // top width fraction (light widens downward)
      rot: rnd() * Math.PI,
    });
  }
  if (!placed.length) return;

  const tints = TINTS[paletteKey(map.palette)] || TINTS.Spree;
  const white = new THREE.Color('#ffffff');

  // --- beams + source discs (1 merged mesh each) -----------------------------
  const beamGeos = [];
  const discGeos = [];
  placed.forEach((p, idx) => {
    p.tint = new THREE.Color(tints[idx % tints.length]);
    for (const ry of [0, Math.PI / 2]) {
      const g = new THREE.PlaneGeometry(p.r * 2, p.top, 1, 6);
      const pos = g.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const t = pos.getY(i) / p.top + 0.5; // 0 bottom .. 1 top
        pos.setX(i, pos.getX(i) * (1 + (p.taper - 1) * t));
      }
      g.rotateY(p.rot + ry);
      g.translate(p.x, p.top / 2, p.z);
      setVertexColor(g, p.tint);
      beamGeos.push(g);
    }
    const dg = new THREE.CircleGeometry(p.r * p.taper * 0.7, 20);
    dg.rotateX(Math.PI / 2); // face downward
    dg.translate(p.x, p.top - 0.12, p.z);
    setVertexColor(dg, p.tint.clone().lerp(white, 0.55));
    discGeos.push(dg);
  });

  const beams = mergeInto(shafts, beamGeos, new THREE.MeshBasicMaterial({
    map: beamTexture(), vertexColors: true, transparent: true, opacity: 0.095,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    side: THREE.DoubleSide,
  }));
  // Draw before default transparents: normal-blended smoke/particles then
  // always composite OVER the beams — soft, and never a sort-order pop.
  beams.renderOrder = -1;

  const discs = mergeInto(shafts, discGeos, new THREE.MeshBasicMaterial({
    map: discTexture(), vertexColors: true, transparent: true, opacity: 0.5,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    side: THREE.DoubleSide,
  }));
  discs.renderOrder = -1;

  // --- dust motes: ONE Points system for all shafts (<= 240) -----------------
  const perShaftCap = Math.floor(240 / placed.length);
  const counts = placed.map((p) => Math.min(perShaftCap, Math.round(30 + 24 * p.r)));
  const total = counts.reduce((a, b) => a + b, 0);

  const posArr = new Float32Array(total * 3);
  const colArr = new Float32Array(total * 3);
  const base = new Float32Array(total * 3); // rest position
  const prm = new Float32Array(total * 6); // phaseX, phaseZ, phaseY, speed, sway, bob
  let k = 0;
  for (let si = 0; si < placed.length; si++) {
    const p = placed[si];
    const c = p.tint.clone().lerp(white, 0.45);
    for (let i = 0; i < counts[si]; i++, k++) {
      const y = 0.5 + rnd() * (p.top * 0.8 - 0.5);
      // local beam radius at this height (beam narrows toward the top);
      // keep motes inside even at full sway
      const rl = p.r * (1 + (p.taper - 1) * (y / p.top));
      const rr = Math.sqrt(rnd()) * Math.max(0.05, rl - 0.3);
      const a = rnd() * Math.PI * 2;
      base[k * 3] = p.x + Math.cos(a) * rr;
      base[k * 3 + 1] = y;
      base[k * 3 + 2] = p.z + Math.sin(a) * rr;
      posArr.set(base.subarray(k * 3, k * 3 + 3), k * 3);
      colArr[k * 3] = c.r;
      colArr[k * 3 + 1] = c.g;
      colArr[k * 3 + 2] = c.b;
      prm[k * 6] = rnd() * Math.PI * 2;
      prm[k * 6 + 1] = rnd() * Math.PI * 2;
      prm[k * 6 + 2] = rnd() * Math.PI * 2;
      prm[k * 6 + 3] = 0.1 + rnd() * 0.25; // rad/s — slow drift
      prm[k * 6 + 4] = 0.06 + rnd() * 0.14; // lateral sway (m)
      prm[k * 6 + 5] = 0.25 + rnd() * 0.35; // vertical bob (m)
    }
  }

  const moteGeo = new THREE.BufferGeometry();
  const moteAttr = new THREE.BufferAttribute(posArr, 3);
  moteGeo.setAttribute('position', moteAttr);
  moteGeo.setAttribute('color', new THREE.BufferAttribute(colArr, 3));
  const motes = new THREE.Points(moteGeo, new THREE.PointsMaterial({
    map: moteTexture(), vertexColors: true, transparent: true, opacity: 0.5,
    size: 0.055, sizeAttenuation: true,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  }));
  motes.frustumCulled = false; // positions drift every frame
  motes.onBeforeRender = () => {
    const t = performance.now() * 0.001;
    for (let i = 0; i < total; i++) {
      const s = prm[i * 6 + 3];
      posArr[i * 3] = base[i * 3] + Math.sin(t * s + prm[i * 6]) * prm[i * 6 + 4];
      posArr[i * 3 + 1] = base[i * 3 + 1] + Math.sin(t * s * 0.6 + prm[i * 6 + 2]) * prm[i * 6 + 5];
      posArr[i * 3 + 2] = base[i * 3 + 2] + Math.sin(t * s * 0.83 + prm[i * 6 + 1]) * prm[i * 6 + 4];
    }
    moteAttr.needsUpdate = true;
  };
  shafts.add(motes);
}
