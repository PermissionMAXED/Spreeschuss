import * as THREE from 'three';
import { paletteKey, placedBox, mergeInto, hashStr, mulberry32 } from './util.js';

// =====================================================================
// FROZEN INTERFACE — animated decoration (decoration ONLY).
//
//   addAnimatedDecor(group, map, sites)
//     Adds small ambient-motion decor (e.g. flickering signage, rotating
//     vent fans, swaying banners, blinking beacons). `group` is the map
//     group, `map` the raw map-data object (map.spawns holds raw
//     [x, z, rot?] arrays; map.boxes the collider boxes), `sites` the
//     built sites object { KEY: { center: THREE.Vector3, radius, ring } }
//     from addSiteMarkers (map.sites holds the raw data). ALL motion is
//     driven exclusively by onBeforeRender hooks on this module's own
//     meshes (rule 5); animation must never move anything outside
//     decal/proud/overhead limits (rule 3) at any point of its cycle.
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
// IMPLEMENTATION — ambient motion, one identity mix per palette:
//   fans   spinning turbine ventilators on unreachable rooftops
//          (grounded boxes with top >= 3.0; rule c — lowest moving
//          part stays >= top + 0.4);
//   lamps  blinking status/hazard lamps half-embedded in collider
//          faces (rule b, <= 0.06 proud); blinking is EMISSIVE
//          MATERIAL PULSING only (bloom threshold 0.9 makes the
//          peaks pop) — never a light;
//   flags  waving cloth on poles mounted ON TOP of the perimeter
//          walls (base y > 6, rule c); the cloth is a small plane
//          (8x5 segments) whose vertices are re-waved per frame;
//   dish   one slowly rotating radar dish on the tallest rooftop;
//   steam  looping puff sprites rising from wall-mounted vents; the
//          whole loop (position - scale/2) stays >= 2.6 (rule c).
//
// All motion is a stateless function of performance.now() — culled
// meshes simply freeze and resume with zero drift. Per-map phases /
// speeds come from the local PRNG, so every map animates differently
// but deterministically. Budget audit (worst cases): Spree = 1 static
// + 1 lamps + 2 fans + 1 dish + 3 steam sprites = 8 draw calls,
// 4 animated meshes; Toxic = 7 calls with 4 sprites; every other
// palette <= 5 calls. Animated meshes <= 4 (< 6), sprites <= 4.
// =====================================================================

// Frozen perimeter dimensions (mirrors structures.js WALL_HEIGHT/THICKNESS).
const PERIM_H = 6;
const PERIM_T = 1;

// Animated-decor identity per palette (keyed by util.paletteKey).
//   fans/flags/vents/lamps: element counts; puffs: sprites per vent;
//   dish: radar dish allowed; blink: lamp pulse pattern; lamp: lamp
//   color override (null -> palette accent); twoGroups: split lamps
//   into two alternating blink groups; flagStyle/flagSpeed: cloth look
//   and wave speed; steamTint: puff sprite tint.
const THEMES = {
  Spree:   { fans: 2, flags: 0, dish: true,  vents: 1, puffs: 3, lamps: 4,  blink: 'pulse',   lamp: null,      twoGroups: false, flagStyle: 'field',    flagSpeed: 1.0,  steamTint: '#cdd7e2' },
  Sand:    { fans: 0, flags: 2, dish: true,  vents: 0, puffs: 0, lamps: 3,  blink: 'slow',    lamp: null,      twoGroups: false, flagStyle: 'field',    flagSpeed: 1.15, steamTint: '#d8d2c2' },
  Neon:    { fans: 1, flags: 0, dish: true,  vents: 0, puffs: 0, lamps: 10, blink: 'double',  lamp: null,      twoGroups: true,  flagStyle: 'field',    flagSpeed: 1.0,  steamTint: '#cdd7e2' },
  Ice:     { fans: 0, flags: 1, dish: false, vents: 0, puffs: 0, lamps: 3,  blink: 'slow',    lamp: null,      twoGroups: false, flagStyle: 'field',    flagSpeed: 0.45, steamTint: '#e2ecf4' },
  Ruins:   { fans: 0, flags: 3, dish: false, vents: 0, puffs: 0, lamps: 4,  blink: 'flicker', lamp: '#ff9a40', twoGroups: false, flagStyle: 'tattered', flagSpeed: 0.8,  steamTint: '#d0c8ba' },
  Toxic:   { fans: 1, flags: 0, dish: false, vents: 2, puffs: 2, lamps: 4,  blink: 'pulse',   lamp: null,      twoGroups: false, flagStyle: 'field',    flagSpeed: 1.0,  steamTint: '#c6d8b6' },
  Crimson: { fans: 0, flags: 2, dish: true,  vents: 0, puffs: 0, lamps: 5,  blink: 'double',  lamp: null,      twoGroups: false, flagStyle: 'banner',   flagSpeed: 0.9,  steamTint: '#d8c6c6' },
};

// ------------------------------------------------------------ canvases
// CPU-side canvas cache (painted once per key); every call wraps the
// cached canvas in a FRESH CanvasTexture (clearScene disposal contract).

const canvasCache = new Map();

function makeCanvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

// css color from hex + brightness multiplier (sRGB conversion — see the
// color-management note in engine/textures.js).
function css(hex, mul = 1, alpha = 1) {
  const c = new THREE.Color(hex).multiplyScalar(mul).convertLinearToSRGB();
  const v = (x) => Math.max(0, Math.min(255, Math.round(x * 255)));
  return `rgba(${v(c.r)},${v(c.g)},${v(c.b)},${alpha})`;
}

function freshTex(canvas) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.anisotropy = 4;
  return t;
}

// 128x80 flag cloth (hoist at x = 0). Styles: field (banded emblem),
// banner (ceremonial slash), tattered (eroded fly edge + holes).
function flagCanvas(key, pal, style) {
  const cacheKey = `animdecor:flag:${key}:${pal.accent}:${style}`;
  if (canvasCache.has(cacheKey)) return canvasCache.get(cacheKey);
  const c = makeCanvas(128, 80);
  const ctx = c.getContext('2d');
  const rnd = mulberry32(hashStr(cacheKey));

  if (style === 'banner') {
    ctx.fillStyle = css(pal.accent, 0.4);
    ctx.fillRect(0, 0, 128, 80);
    ctx.fillStyle = css(pal.accent, 0.95);
    ctx.fillRect(0, 0, 128, 13);
    ctx.fillRect(0, 67, 128, 13);
    ctx.strokeStyle = 'rgba(238,242,246,0.85)';
    ctx.lineWidth = 9;
    ctx.beginPath(); ctx.moveTo(22, 62); ctx.lineTo(70, 18); ctx.stroke();
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(44, 62); ctx.lineTo(92, 18); ctx.stroke();
  } else {
    ctx.fillStyle = css(pal.accent, style === 'tattered' ? 0.4 : 0.52);
    ctx.fillRect(0, 0, 128, 80);
    ctx.fillStyle = css(pal.accent, 1.05);
    ctx.fillRect(0, 31, 128, 18);
    ctx.strokeStyle = 'rgba(238,242,246,0.85)';
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(56, 40, 13, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = 'rgba(238,242,246,0.85)';
    ctx.beginPath(); ctx.arc(56, 40, 4, 0, Math.PI * 2); ctx.fill();
  }
  // dark hoist strip + fly-edge shading + wear streaks
  ctx.fillStyle = 'rgba(14,17,21,0.8)';
  ctx.fillRect(0, 0, 9, 80);
  const g = ctx.createLinearGradient(0, 0, 128, 0);
  g.addColorStop(0, 'rgba(0,0,0,0.22)');
  g.addColorStop(0.35, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.2)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 80);
  ctx.fillStyle = 'rgba(0,0,0,0.14)';
  for (let i = 0; i < 7; i++) ctx.fillRect(16 + rnd() * 100, 6 + rnd() * 64, 1.5 + rnd() * 3, 6 + rnd() * 18);

  if (style === 'tattered') {
    ctx.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 26; i++) {
      ctx.beginPath();
      ctx.ellipse(110 + rnd() * 20, rnd() * 80, 4 + rnd() * 9, 3 + rnd() * 6, rnd() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
    for (let i = 0; i < 14; i++) {
      ctx.beginPath();
      ctx.ellipse(36 + rnd() * 92, 73 + rnd() * 9, 3 + rnd() * 7, 2 + rnd() * 4, rnd() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
    for (let i = 0; i < 6; i++) {
      ctx.beginPath();
      ctx.arc(28 + rnd() * 84, 14 + rnd() * 52, 1.5 + rnd() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  }
  canvasCache.set(cacheKey, c);
  return c;
}

// 64px soft radial puff for the steam sprites.
function puffCanvas() {
  const cacheKey = 'animdecor:puff';
  if (canvasCache.has(cacheKey)) return canvasCache.get(cacheKey);
  const c = makeCanvas(64);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  g.addColorStop(0, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.55, 'rgba(255,255,255,0.34)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  canvasCache.set(cacheKey, c);
  return c;
}

// ------------------------------------------------------ blink patterns
// Emissive-intensity envelopes (bloom threshold ~0.9: peaks pop, lows
// read as dormant hardware). Pure functions of time — no state.
function blinkValue(mode, t, ph) {
  if (mode === 'double') {
    const s = (t * 0.9 + ph) % 2;
    return (s < 0.09 || (s > 0.22 && s < 0.31)) ? 1.65 : 0.12;
  }
  if (mode === 'flicker') {
    return Math.max(0.08,
      0.62 + 0.3 * Math.sin(t * 6.7 + ph) * Math.sin(t * 1.9 + ph * 2) + 0.18 * Math.sin(t * 11.3 + ph));
  }
  if (mode === 'slow') {
    return 0.35 + 0.55 * (0.5 + 0.5 * Math.sin(t * 0.8 + ph));
  }
  // 'pulse'
  return 0.55 + 1.0 * Math.pow(0.5 + 0.5 * Math.sin(t * 2.1 + ph), 2);
}

// ------------------------------------------------------ addAnimatedDecor

export function addAnimatedDecor(group, map, sites) {
  // Local PRNG (rule 2) — NEVER the shared builder rand.
  const rnd = mulberry32(hashStr((map.id || map.name || 'map') + ':animdecor'));

  const anim = new THREE.Group();
  anim.name = 'animdecor';
  group.add(anim);

  const pal = map.palette;
  const key = paletteKey(pal);
  const T = THEMES[key];
  const [w, d] = map.size;
  const hw = w / 2;
  const hd = d / 2;
  const now = () => performance.now() / 1000;

  // ---------------------------------------------------------- context
  const boxes = map.boxes || [];
  const spawnPts = [];
  for (const arr of Object.values(map.spawns || {})) {
    for (const s of arr || []) spawnPts.push([s[0], s[1]]);
  }
  const siteList = Object.values(sites || {}).map((s) => ({ x: s.center.x, z: s.center.z, r: s.radius }));

  // solids (interior boxes + frozen perimeter walls) for embed tests
  const solids = boxes.map((b) => ({
    x0: b.pos[0] - b.size[0] / 2, x1: b.pos[0] + b.size[0] / 2,
    y0: b.pos[1] - b.size[1] / 2, y1: b.pos[1] + b.size[1] / 2,
    z0: b.pos[2] - b.size[2] / 2, z1: b.pos[2] + b.size[2] / 2,
  }));
  for (const [cx, cz, sx, sz] of [
    [0, -hd, w + PERIM_T, PERIM_T], [0, hd, w + PERIM_T, PERIM_T],
    [-hw, 0, PERIM_T, d + PERIM_T], [hw, 0, PERIM_T, d + PERIM_T],
  ]) {
    solids.push({ x0: cx - sx / 2, x1: cx + sx / 2, y0: 0, y1: PERIM_H, z0: cz - sz / 2, z1: cz + sz / 2 });
  }

  // ------------------------------------------------------ rule checks
  const SPAWN_R = 1.05; // >= 1 m XZ clearance from every spawn point

  // circle (x, z, r) keeps >= SPAWN_R from every spawn point
  const clearOfSpawns = (x, z, r = 0) =>
    spawnPts.every(([sx, sz]) => Math.hypot(sx - x, sz - z) >= SPAWN_R + r);

  // circle stays fully outside every site ring interior
  const outsideSites = (x, z, r = 0) =>
    siteList.every((s) => Math.hypot(s.x - x, s.z - z) > s.r + r + 0.15);

  const pointInSolid = (x, y, z, pad = 0.02) => solids.some((s) =>
    x > s.x0 - pad && x < s.x1 + pad && y > s.y0 - pad && y < s.y1 + pad && z > s.z0 - pad && z < s.z1 + pad);

  // vertical slab (y0..y1) around (x, z, r) is free of every box — used
  // for rooftop spots (fan / dish swept volumes never clip lintels,
  // bridges, crowns or roof glow strips)
  const roofClear = (x, z, r, y0, y1) => boxes.every((b) => {
    const bTop = b.pos[1] + b.size[1] / 2;
    const bBot = b.pos[1] - b.size[1] / 2;
    if (bTop <= y0 + 0.02 || bBot >= y1) return true;
    const dx = Math.max(0, Math.abs(x - b.pos[0]) - b.size[0] / 2);
    const dz = Math.max(0, Math.abs(z - b.pos[2]) - b.size[2] / 2);
    return dx * dx + dz * dz > r * r;
  });

  // separation between this module's own elements
  const placed = [];
  const selfClear = (x, z, r) => placed.every(([px, pz, pr]) => Math.hypot(px - x, pz - z) >= r + pr);
  const claim = (x, z, r) => placed.push([x, z, r]);

  // ------------------------------------------------------- wall faces
  // mountable faces: sides of grounded TALL interior boxes (top >= 3,
  // high mounts read as building hardware) + the 4 inner perimeter faces
  const faces = [];
  for (const b of boxes) {
    const top = b.pos[1] + b.size[1] / 2;
    const bot = b.pos[1] - b.size[1] / 2;
    if (bot > 0.3 || top < 3.0) continue;
    const [sx, , sz] = b.size;
    faces.push(
      { cx: b.pos[0] + sx / 2, cz: b.pos[2], nx: 1, nz: 0, len: sz, top },
      { cx: b.pos[0] - sx / 2, cz: b.pos[2], nx: -1, nz: 0, len: sz, top },
      { cx: b.pos[0], cz: b.pos[2] + sz / 2, nx: 0, nz: 1, len: sx, top },
      { cx: b.pos[0], cz: b.pos[2] - sz / 2, nx: 0, nz: -1, len: sx, top },
    );
  }
  const perimFaces = [
    { cx: 0, cz: -(hd - PERIM_T / 2), nx: 0, nz: 1, len: w - 4, top: PERIM_H, perim: true },
    { cx: 0, cz: hd - PERIM_T / 2, nx: 0, nz: -1, len: w - 4, top: PERIM_H, perim: true },
    { cx: -(hw - PERIM_T / 2), cz: 0, nx: 1, nz: 0, len: d - 4, top: PERIM_H, perim: true },
    { cx: hw - PERIM_T / 2, cz: 0, nx: -1, nz: 0, len: d - 4, top: PERIM_H, perim: true },
  ];

  const facePos = (f, along) => (f.nx ? [f.cx, f.cz + along] : [f.cx + along, f.cz]);
  const faceRy = (f) => (f.nx ? (f.nx > 0 ? Math.PI / 2 : -Math.PI / 2) : (f.nz > 0 ? 0 : Math.PI));

  // -------------------------------------------------------- materials
  // Fresh per call (rule 4); the dark mount material is shared across
  // this module's meshes (double-dispose in clearScene is harmless).
  const metalMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(pal.wall).multiplyScalar(0.4),
    roughness: 0.58,
    metalness: 0.55,
  });
  const steelMat = new THREE.MeshStandardMaterial({
    color: '#98a4ae',
    roughness: 0.45,
    metalness: 0.7,
  });

  const staticGeos = []; // merged mounts: plinths, ducts, poles, housings
  const lampGeosA = []; // blink group A (emissive)
  const lampGeosB = []; // blink group B (Neon alternation)

  // wall-mounted box (rule b): half-embedded so it protrudes exactly `proud`
  const wallBox = (list, f, along, y, sw, sh, depth, proud) => {
    const [x, z] = facePos(f, along);
    const off = proud - depth / 2;
    list.push(f.nx
      ? placedBox(depth, sh, sw, x + f.nx * off, y, z)
      : placedBox(sw, sh, depth, x, y, z + f.nz * off));
  };

  // =====================================================================
  // ROOFTOP STORY (rule c: everything >= box top >= 3.0)
  // =====================================================================

  // unreachable rooftops: grounded, tall, wide enough for hardware
  const roofs = [];
  for (const b of boxes) {
    const top = b.pos[1] + b.size[1] / 2;
    const bot = b.pos[1] - b.size[1] / 2;
    if (bot > 0.3 || top < 3.0) continue;
    if (Math.min(b.size[0], b.size[2]) < 1.7) continue;
    roofs.push({ x: b.pos[0], z: b.pos[2], hx: b.size[0] / 2, hz: b.size[2] / 2, top });
  }

  // ---- spinning turbine ventilators
  let fansLeft = T.fans;
  for (let i = 0; i < T.fans * 6 && fansLeft > 0 && roofs.length; i++) {
    const rf = roofs[Math.floor(rnd() * roofs.length)];
    const x = rf.x + (rnd() * 2 - 1) * Math.max(0, rf.hx - 0.75);
    const z = rf.z + (rnd() * 2 - 1) * Math.max(0, rf.hz - 0.75);
    if (!clearOfSpawns(x, z, 0.6) || !outsideSites(x, z, 0.6) || !selfClear(x, z, 1.8)) continue;
    if (!roofClear(x, z, 0.62, rf.top, rf.top + 0.95)) continue;

    // static base: plinth + duct throat
    staticGeos.push(placedBox(0.62, 0.2, 0.62, x, rf.top + 0.1, z));
    const duct = new THREE.CylinderGeometry(0.3, 0.36, 0.22, 12);
    duct.translate(x, rf.top + 0.29, z);
    staticGeos.push(duct);

    // rotor: 8 pitched fins + cap + shaft, own mesh spinning around Y.
    // Lowest moving point: rf.top + 0.41 >= 3.41 (rule c).
    const rotorGeos = [];
    for (let k = 0; k < 8; k++) {
      const fin = new THREE.BoxGeometry(0.17, 0.34, 0.03);
      fin.rotateY(0.55);
      fin.translate(0.27, 0, 0);
      fin.rotateY((k / 8) * Math.PI * 2);
      rotorGeos.push(fin);
    }
    const cap = new THREE.CylinderGeometry(0.3, 0.35, 0.07, 12);
    cap.translate(0, 0.21, 0);
    rotorGeos.push(cap);
    rotorGeos.push(new THREE.CylinderGeometry(0.045, 0.045, 0.42, 8));
    const rotor = mergeInto(anim, rotorGeos, steelMat);
    rotor.name = 'animdecor:fan';
    rotor.position.set(x, rf.top + 0.58, z);
    const speed = (1.8 + rnd() * 1.4) * (rnd() < 0.5 ? 1 : -1);
    const phase = rnd() * Math.PI * 2;
    rotor.onBeforeRender = () => { rotor.rotation.y = now() * speed + phase; };

    claim(x, z, 0.7);
    fansLeft--;
  }

  // ---- slowly rotating radar dish (tallest suitable rooftop)
  if (T.dish) {
    const cand = roofs
      .filter((rf) => Math.min(rf.hx, rf.hz) >= 1.1)
      .sort((a, b) => b.top - a.top);
    for (const rf of cand) {
      const x = rf.x + (rnd() * 2 - 1) * Math.max(0, rf.hx - 1.1);
      const z = rf.z + (rnd() * 2 - 1) * Math.max(0, rf.hz - 1.1);
      if (!clearOfSpawns(x, z, 0.9) || !outsideSites(x, z, 0.9) || !selfClear(x, z, 2)) continue;
      if (!roofClear(x, z, 0.95, rf.top, rf.top + 1.5)) continue;

      staticGeos.push(placedBox(0.6, 0.12, 0.6, x, rf.top + 0.06, z));
      staticGeos.push(placedBox(0.18, 0.4, 0.18, x, rf.top + 0.32, z));

      // rotating assembly (local origin = pivot on the pedestal top).
      // Lowest swept point: rf.top + ~0.39 >= 3.39 (rule c).
      const dishGeos = [];
      const yoke = new THREE.BoxGeometry(0.09, 0.26, 0.09);
      yoke.translate(0, 0.06, 0);
      dishGeos.push(yoke);
      const plate = new THREE.CylinderGeometry(0.5, 0.07, 0.16, 14);
      plate.rotateX(-0.95);
      plate.translate(0, 0.3, 0.06);
      dishGeos.push(plate);
      const feed = new THREE.CylinderGeometry(0.018, 0.018, 0.42, 6);
      feed.rotateX(-0.95);
      feed.translate(0, 0.42, -0.11);
      dishGeos.push(feed);
      const dish = mergeInto(anim, dishGeos, steelMat);
      dish.name = 'animdecor:dish';
      dish.position.set(x, rf.top + 0.55, z);
      const spd = 0.22 + rnd() * 0.12;
      const ph = rnd() * Math.PI * 2;
      dish.onBeforeRender = () => { dish.rotation.y = now() * spd + ph; };

      claim(x, z, 1.0);
      break;
    }
  }

  // =====================================================================
  // WALL STORY (rule b: <= 0.06 proud of collider faces)
  // =====================================================================

  // ---- blinking status / hazard lamps (emissive pulsing ONLY, no lights)
  const lampFaces = [...faces.filter((f) => f.len >= 2.4), ...perimFaces];
  let lampCount = 0;
  for (let i = 0; i < T.lamps * 5 && lampCount < T.lamps && lampFaces.length; i++) {
    const f = lampFaces[Math.floor(rnd() * lampFaces.length)];
    const along = (rnd() * 2 - 1) * Math.max(0, f.len / 2 - 1.0);
    const y = f.perim ? 5.45 : f.top - 0.45;
    const [x, z] = facePos(f, along);
    if (!clearOfSpawns(x, z, 0.15) || !outsideSites(x, z, 0.15) || !selfClear(x, z, 1.1)) continue;
    if (pointInSolid(x + f.nx * 0.15, y, z + f.nz * 0.15)) continue; // face abuts another box
    wallBox(staticGeos, f, along, y, 0.24, 0.32, 0.1, 0.045); // housing plate
    const bucket = T.twoGroups && lampCount % 2 ? lampGeosB : lampGeosA;
    wallBox(bucket, f, along, y + 0.02, 0.14, 0.14, 0.012, 0.058); // lens cap
    claim(x, z, 0.5);
    lampCount++;
  }

  // ---- steam vents (louvered mount, rule b) + looping puff sprites (rule c)
  const ventSpots = [];
  if (T.vents > 0) {
    const ventFaces = [...faces.filter((f) => f.len >= 3 && f.top >= 3.3), ...perimFaces];
    for (let i = 0; i < T.vents * 8 && ventSpots.length < T.vents && ventFaces.length; i++) {
      const f = ventFaces[Math.floor(rnd() * ventFaces.length)];
      const along = (rnd() * 2 - 1) * Math.max(0, f.len / 2 - 1.4);
      const y = f.perim ? 3.0 : f.top - 0.45; // >= 2.85 -> puffs start >= 3.4
      const [x, z] = facePos(f, along);
      // 1.2 slack: puff sprites drift <= ~0.6 from the vent, so the whole
      // loop keeps >= 1 m XZ from every spawn point
      if (!clearOfSpawns(x, z, 1.2) || !outsideSites(x, z, 1.2) || !selfClear(x, z, 1.6)) continue;
      if (pointInSolid(x + f.nx * 0.15, y, z + f.nz * 0.15)) continue;
      // rising puff column must not thread through lintels / bridges
      let blocked = false;
      for (const dy of [0.6, 1.2, 1.9]) {
        if (pointInSolid(x + f.nx * 0.4, y + dy, z + f.nz * 0.4, 0.2)) blocked = true;
      }
      if (blocked) continue;
      wallBox(staticGeos, f, along, y, 0.72, 0.56, 0.12, 0.035); // frame
      wallBox(staticGeos, f, along, y, 0.56, 0.42, 0.1, 0.052);  // louver panel
      for (const dy of [-0.13, 0, 0.13]) {
        wallBox(staticGeos, f, along, y + dy, 0.5, 0.05, 0.01, 0.058); // slats
      }
      ventSpots.push({ x, z, y, nx: f.nx, nz: f.nz });
      claim(x, z, 0.8);
    }
  }

  // =====================================================================
  // PERIMETER-TOP STORY (rule c: poles on the 6 m wall top)
  // =====================================================================

  if (T.flags > 0) {
    const flagWalls = [
      { dirx: 1, dirz: 0, x0: 0, z0: -hd, len: w },
      { dirx: 1, dirz: 0, x0: 0, z0: hd, len: w },
      { dirx: 0, dirz: 1, x0: -hw, z0: 0, len: d },
      { dirx: 0, dirz: 1, x0: hw, z0: 0, len: d },
    ];
    let placedFlags = 0;
    for (let i = 0; i < T.flags * 6 && placedFlags < T.flags; i++) {
      const wall = flagWalls[Math.floor(rnd() * flagWalls.length)];
      const along = (rnd() * 2 - 1) * (wall.len / 2 - 4.5);
      if (Math.abs(along) < 2.5) continue; // keep off the wall-top glow line
      const x = wall.x0 + wall.dirx * along;
      const z = wall.z0 + wall.dirz * along;
      if (!clearOfSpawns(x, z, 1.3) || !outsideSites(x, z, 1.3) || !selfClear(x, z, 4)) continue;

      // pole + finial on TOP of the wall (base y 6.02 — above the collider)
      const pole = new THREE.CylinderGeometry(0.028, 0.045, 2.3, 8);
      pole.translate(x, 6.02 + 1.15, z);
      staticGeos.push(pole);
      const finial = new THREE.SphereGeometry(0.06, 8, 6);
      finial.translate(x, 6.02 + 2.36, z);
      staticGeos.push(finial);

      // cloth: 8x5-segment plane, hoist at local x=0.05, waved per frame
      const cloth = new THREE.PlaneGeometry(1.05, 0.6, 8, 5);
      cloth.translate(0.575, 0, 0);
      const isTattered = T.flagStyle === 'tattered';
      const clothMat = new THREE.MeshLambertMaterial({
        map: freshTex(flagCanvas(key, pal, T.flagStyle)),
        side: THREE.DoubleSide,
        alphaTest: isTattered ? 0.4 : 0,
      });
      const flag = new THREE.Mesh(cloth, clothMat);
      flag.name = 'animdecor:flag';
      flag.position.set(x, 6.02 + 1.94, z);
      flag.rotation.y = wall.dirx ? 0 : Math.PI / 2;
      // wave never exceeds +-0.22 in the wall-normal direction and the
      // cloth stays > 7.5 m up (rule c with huge margin)
      const pos = cloth.attributes.position;
      const base = Float32Array.from(pos.array);
      const spd = T.flagSpeed * (0.85 + rnd() * 0.3);
      const ph = rnd() * Math.PI * 2;
      const amp = isTattered ? 0.2 : 0.16;
      flag.onBeforeRender = () => {
        const t = now() * spd + ph;
        for (let v = 0; v < pos.count; v++) {
          const bx = base[v * 3];
          const by = base[v * 3 + 1];
          const fr = Math.max(0, bx - 0.05) / 1.05; // 0 at hoist -> 1 at fly edge
          pos.setZ(v, Math.sin(bx * 5.2 - t * 3.1) * amp * fr + Math.sin(bx * 2.3 - t * 1.7) * 0.05 * fr);
          pos.setY(v, by - 0.07 * fr * fr + Math.sin(bx * 4.1 - t * 2.6) * 0.05 * fr);
        }
        pos.needsUpdate = true;
      };
      cloth.computeBoundingSphere();
      cloth.boundingSphere.radius += 0.35; // wave slack for frustum culling
      anim.add(flag);

      claim(x, z, 1.5);
      placedFlags++;
    }
  }

  // =====================================================================
  // MERGE + HOOKS (fresh materials per call; hooks die with the meshes)
  // =====================================================================

  const staticMesh = mergeInto(anim, staticGeos, metalMat);
  if (staticMesh) {
    staticMesh.name = 'animdecor:static';
    staticMesh.receiveShadow = true;
  }

  const lampColor = new THREE.Color(T.lamp || pal.accent);
  const addLampMesh = (geos, ph) => {
    if (!geos.length) return;
    const mat = new THREE.MeshStandardMaterial({
      color: lampColor.clone().multiplyScalar(0.3),
      emissive: lampColor.clone(),
      emissiveIntensity: 1,
      roughness: 0.35,
      metalness: 0.2,
    });
    const mesh = mergeInto(anim, geos, mat);
    mesh.name = 'animdecor:lamps';
    mesh.onBeforeRender = () => { mat.emissiveIntensity = blinkValue(T.blink, now(), ph); };
  };
  addLampMesh(lampGeosA, rnd() * Math.PI * 2);
  addLampMesh(lampGeosB, rnd() * Math.PI * 2);

  // steam puffs: <= 4 sprites, own material each (per-sprite opacity).
  // Whole loop keeps position.y - scale/2 >= start - 0.2 >= 2.6 (rule c).
  if (ventSpots.length) {
    const tex = freshTex(puffCanvas());
    let sprites = 0;
    for (const vs of ventSpots) {
      const tx = vs.nz; // tangent along the face
      const tz = -vs.nx;
      for (let p = 0; p < T.puffs && sprites < 4; p++) {
        const mat = new THREE.SpriteMaterial({
          map: tex,
          color: new THREE.Color(T.steamTint),
          transparent: true,
          opacity: 0,
          depthWrite: false,
        });
        const sp = new THREE.Sprite(mat);
        sp.name = 'animdecor:steam';
        sp.frustumCulled = false; // keeps the loop continuous (tiny quad)
        const y0 = vs.y + 0.55;
        const off = rnd();
        const rate = 0.13 + rnd() * 0.05;
        const swayPh = rnd() * Math.PI * 2;
        sp.onBeforeRender = () => {
          const t = now();
          const pr = ((t * rate + off) % 1 + 1) % 1;
          const s = 0.4 + pr * 0.75;
          sp.scale.set(s, s, 1);
          const sway = Math.sin(t * 0.7 + swayPh) * 0.1 * pr;
          sp.position.set(
            vs.x + vs.nx * (0.12 + 0.35 * pr) + tx * sway,
            y0 + pr * 1.5,
            vs.z + vs.nz * (0.12 + 0.35 * pr) + tz * sway,
          );
          mat.opacity = 0.34 * Math.sin(Math.PI * pr);
          mat.rotation = swayPh + t * 0.12;
        };
        sp.position.set(vs.x + vs.nx * 0.12, y0, vs.z + vs.nz * 0.12);
        sp.scale.set(0.4, 0.4, 1);
        anim.add(sp);
        sprites++;
      }
    }
  }
}
