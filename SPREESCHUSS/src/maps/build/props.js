import * as THREE from 'three';
import { glowTexture } from '../../engine/textures.js';
import { paletteKey, placedBox, mergeInto, hashStr, mulberry32 } from './util.js';

// =====================================================================
// FROZEN INTERFACE — gameplay-area props (decoration ONLY).
//
//   addProps(group, map, rand)
//     Adds small decorative props INSIDE the playable area. Called by
//     mapbuilder.js after lighting; receives the map group, the raw map
//     data (map.spawns holds the raw [x, z, rot?] spawn arrays) and the
//     shared map-seeded PRNG. Site data is read from map.sites directly.
//
// HARD RULES (all enforced below, see the check helpers):
//   - Decoration adds NO colliders, ever. Every prop is one of:
//       (a) flat floor decal    <= 0.021 high (kept at y 0.006..0.011,
//           below the site rings at 0.015);
//       (b) wall-mounted detail <= 0.06 proud of an existing collider
//           face (interior boxes from map.boxes, or the frozen perimeter
//           walls at +-w/2, +-d/2 with thickness 1 / height 6). Bodies
//           are half-embedded in the wall so the visible protrusion
//           never exceeds 0.06 while the shape can still read as 3D;
//       (c) overhead element with its lowest point >= 2.6 (cables,
//           string lights, lamp arms, banners);
//   - >= 1 m XZ clearance from every spawn point (footprint-aware);
//   - site ring interiors (center +- radius) hold nothing but flat
//     decals;
//   - deterministic from `rand` ONLY (this stage runs LAST in the
//     rand-consumer chain — do not reorder it in mapbuilder.js);
//   - NO lights (lighting.js owns all lights) and no animation hooks;
//   - budget: everything merges into <= 6 meshes (decals / glow decals /
//     dark metal / emissive accents / signage / banners) + <= 6 glow
//     sprites for the hanging lamps.
//
// Canvas textures follow the engine/textures.js caching contract:
// canvases are painted ONCE per palette and cached CPU-side, but every
// call returns FRESH CanvasTexture wrappers because Renderer.clearScene
// disposes all scene textures between matches. All canvases <= 256 px.
// =====================================================================

// Frozen perimeter dimensions (mirrors structures.js WALL_HEIGHT/THICKNESS).
const PERIM_H = 6;
const PERIM_T = 1;

// Decoration identity per palette (keyed by util.paletteKey).
const THEMES = {
  Spree:   { hazard: '#e8c33a', puddle: '#101c26', drift: '#8a97a2', puddles: 4, drifts: 0, arrows: false, posters: 3, lamps: 3, strings: true,  leaks: true,  pipe: '#333e48' },
  Sand:    { hazard: '#c04f28', puddle: '#20180c', drift: '#d9c184', puddles: 0, drifts: 9, arrows: false, posters: 0, lamps: 2, strings: false, leaks: false, pipe: '#6b5c40' },
  Neon:    { hazard: '#ff3fa4', puddle: '#191233', drift: '#4a4470', puddles: 3, drifts: 0, arrows: true,  posters: 4, lamps: 2, strings: true,  leaks: false, pipe: '#262040' },
  Ice:     { hazard: '#e07a30', puddle: '#0e1c26', drift: '#eaf4fb', puddles: 0, drifts: 8, arrows: false, posters: 0, lamps: 2, strings: false, leaks: false, pipe: '#54707e' },
  Ruins:   { hazard: '#b9882e', puddle: '#181209', drift: '#a68e6c', puddles: 2, drifts: 7, arrows: false, posters: 2, lamps: 1, strings: false, leaks: true,  pipe: '#4c4335' },
  Toxic:   { hazard: '#cdd23a', puddle: '#26400f', drift: '#5e7247', puddles: 6, drifts: 0, arrows: false, posters: 3, lamps: 2, strings: true,  leaks: true,  pipe: '#3a4833' },
  Crimson: { hazard: '#e0b84a', puddle: '#1c0e12', drift: '#6e4a50', puddles: 2, drifts: 0, arrows: false, posters: 3, lamps: 3, strings: true,  leaks: true,  pipe: '#3c2830' },
};

// ------------------------------------------------------------ canvases

const canvasCache = new Map(); // key -> canvas (CPU-side, painted once)

function makeCanvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

// css color from hex + brightness multiplier (converted back to sRGB, see
// the color-management note in engine/textures.js).
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

// Atlas regions in normalized uv (canvas y-down -> texture v-up flip).
const R = (px, py, pw, ph, S = 256) => ({ u0: px / S, v0: 1 - (py + ph) / S, u1: (px + pw) / S, v1: 1 - py / S });
const REG = {
  hazard:  R(0, 0, 256, 64),
  manhole: R(0, 64, 64, 64),
  grate:   R(64, 64, 64, 64),
  arrow:   R(128, 64, 64, 64),
  insA:    R(192, 64, 64, 64),
  smudge:  R(0, 128, 64, 64),
  puddle:  R(64, 128, 64, 64),
  drift:   R(128, 128, 64, 64),
  insB:    R(192, 128, 64, 64),
  poster:  R(0, 192, 64, 64),
  tag:     R(64, 192, 64, 64),
  vent:    R(128, 192, 64, 64),
  leak:    R(192, 192, 64, 64),
};
const SIGN = {
  A: { left: R(0, 0, 64, 64, 128), right: R(64, 0, 64, 64, 128) },
  B: { left: R(0, 64, 64, 64, 128), right: R(64, 64, 64, 64, 128) },
};

// 256px decal atlas: floor markings + wall grime, palette-flavored.
function decalAtlasCanvas(key, pal, T) {
  const cacheKey = `props:decals:${key}:${pal.accent}`;
  if (canvasCache.has(cacheKey)) return canvasCache.get(cacheKey);
  const c = makeCanvas(256);
  const ctx = c.getContext('2d');
  const rnd = mulberry32(hashStr(cacheKey));

  // --- hazard stripe band (0,0 .. 256,64), worn diagonal paint
  ctx.save();
  ctx.beginPath(); ctx.rect(0, 0, 256, 64); ctx.clip();
  for (let i = -2; i < 12; i++) {
    ctx.fillStyle = i % 2 ? 'rgba(14,14,16,0.85)' : css(T.hazard, 1, 0.88);
    ctx.beginPath();
    ctx.moveTo(i * 28, 64); ctx.lineTo(i * 28 + 28, 64);
    ctx.lineTo(i * 28 + 52, 0); ctx.lineTo(i * 28 + 24, 0);
    ctx.closePath(); ctx.fill();
  }
  ctx.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 30; i++) {
    ctx.globalAlpha = 0.35 + rnd() * 0.6;
    ctx.beginPath();
    ctx.ellipse(rnd() * 256, rnd() * 64, 2 + rnd() * 8, 1 + rnd() * 4, rnd() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  const cell = (px, py, fn) => { ctx.save(); ctx.translate(px, py); fn(); ctx.restore(); };
  const circle = (x, y, r) => { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); };

  // --- manhole disc
  cell(0, 64, () => {
    ctx.fillStyle = 'rgba(10,12,14,0.85)'; circle(32, 32, 27); ctx.fill();
    ctx.strokeStyle = 'rgba(190,196,204,0.4)'; ctx.lineWidth = 3; circle(32, 32, 25); ctx.stroke();
    ctx.strokeStyle = 'rgba(160,168,176,0.22)'; ctx.lineWidth = 2; circle(32, 32, 16); ctx.stroke();
    ctx.lineWidth = 2.5;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      ctx.strokeStyle = 'rgba(150,158,166,0.3)';
      ctx.beginPath();
      ctx.moveTo(32 + Math.cos(a) * 6, 32 + Math.sin(a) * 6);
      ctx.lineTo(32 + Math.cos(a) * 15, 32 + Math.sin(a) * 15);
      ctx.stroke();
      ctx.fillStyle = 'rgba(200,206,212,0.4)';
      circle(32 + Math.cos(a) * 21, 32 + Math.sin(a) * 21, 1.7); ctx.fill();
    }
  });

  // --- drain grate
  cell(64, 64, () => {
    ctx.fillStyle = 'rgba(8,10,12,0.88)'; ctx.fillRect(7, 7, 50, 50);
    ctx.strokeStyle = 'rgba(175,183,192,0.35)'; ctx.lineWidth = 3; ctx.strokeRect(8.5, 8.5, 47, 47);
    for (let y = 15; y <= 47; y += 8) {
      ctx.fillStyle = 'rgba(0,0,0,0.95)'; ctx.fillRect(13, y, 38, 3.6);
      ctx.fillStyle = 'rgba(255,255,255,0.1)'; ctx.fillRect(13, y - 1.4, 38, 1.4);
    }
  });

  // --- direction chevrons (white; tinted by the glow material)
  cell(128, 64, () => {
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.lineWidth = 7;
    ctx.lineJoin = 'miter';
    for (let k = 0; k < 3; k++) {
      ctx.beginPath();
      ctx.moveTo(11, 52 - k * 15);
      ctx.lineTo(32, 36 - k * 15);
      ctx.lineTo(53, 52 - k * 15);
      ctx.stroke();
    }
  });

  // --- attacker insignia (accent ring + up chevrons)
  cell(192, 64, () => {
    ctx.strokeStyle = css(pal.accent, 1.1, 0.75); ctx.lineWidth = 4; circle(32, 32, 23); ctx.stroke();
    ctx.strokeStyle = css(pal.accent, 1.1, 0.3); ctx.lineWidth = 2; circle(32, 32, 28); ctx.stroke();
    ctx.lineWidth = 5;
    ctx.strokeStyle = css(pal.accent, 1.25, 0.85);
    for (let k = 0; k < 2; k++) {
      ctx.beginPath();
      ctx.moveTo(18, 42 - k * 13); ctx.lineTo(32, 30 - k * 13); ctx.lineTo(46, 42 - k * 13);
      ctx.stroke();
    }
    ctx.fillStyle = css(pal.accent, 1.2, 0.8);
    for (const a of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      ctx.fillRect(32 + Math.cos(a) * 23 - 1.5, 32 + Math.sin(a) * 23 - 1.5, 3, 3);
    }
  });

  // --- worn-floor smudge
  cell(0, 128, () => {
    const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
    g.addColorStop(0, 'rgba(0,0,0,0.4)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    for (let i = 0; i < 9; i++) {
      ctx.beginPath();
      ctx.ellipse(10 + rnd() * 44, 10 + rnd() * 44, 1 + rnd() * 3, 1 + rnd() * 2, rnd() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
  });

  // --- puddle
  cell(64, 128, () => {
    for (const [ox, oy, rx, ry] of [[30, 34, 24, 16], [42, 26, 14, 10], [20, 26, 12, 9]]) {
      const g = ctx.createRadialGradient(ox, oy, 1, ox, oy, Math.max(rx, ry));
      g.addColorStop(0, css(T.puddle, 1, 0.62));
      g.addColorStop(0.8, css(T.puddle, 1, 0.5));
      g.addColorStop(1, css(T.puddle, 1, 0));
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.ellipse(ox, oy, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.ellipse(30, 33, 20, 13, 0.15, -2.4, -0.9); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.beginPath(); ctx.ellipse(24, 28, 5, 2.2, -0.5, 0, Math.PI * 2); ctx.fill();
  });

  // --- sand / snow drift
  cell(128, 128, () => {
    for (const [ox, oy, rx, ry] of [[32, 36, 27, 13], [20, 30, 13, 8], [45, 32, 12, 7]]) {
      const g = ctx.createRadialGradient(ox, oy, 1, ox, oy, Math.max(rx, ry));
      g.addColorStop(0, css(T.drift, 1, 0.55));
      g.addColorStop(1, css(T.drift, 1, 0));
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.ellipse(ox, oy, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = css(T.drift, 0.72, 0.35);
    for (let i = 0; i < 14; i++) {
      ctx.fillRect(8 + rnd() * 48, 22 + rnd() * 26, 1.4, 1.4);
    }
  });

  // --- defender insignia (rotated square + bar)
  cell(192, 128, () => {
    ctx.save();
    ctx.translate(32, 32); ctx.rotate(Math.PI / 4);
    ctx.strokeStyle = 'rgba(230,236,242,0.7)'; ctx.lineWidth = 4;
    ctx.strokeRect(-16, -16, 32, 32);
    ctx.restore();
    ctx.strokeStyle = css(pal.accent, 1.1, 0.7); ctx.lineWidth = 3; circle(32, 32, 10); ctx.stroke();
    ctx.fillStyle = 'rgba(230,236,242,0.65)';
    ctx.fillRect(29, 4, 6, 9); ctx.fillRect(29, 51, 6, 9);
    ctx.fillRect(4, 29, 9, 6); ctx.fillRect(51, 29, 9, 6);
  });

  // --- poster
  cell(0, 192, () => {
    ctx.fillStyle = 'rgba(16,20,26,0.94)'; ctx.fillRect(6, 4, 52, 56);
    ctx.fillStyle = css(pal.accent, 0.85, 0.9); ctx.fillRect(9, 7, 46, 13);
    ctx.fillStyle = 'rgba(230,235,240,0.8)';
    ctx.fillRect(11, 9, 26, 3.5); ctx.fillRect(11, 14.5, 34, 3);
    ctx.strokeStyle = css(pal.accent, 1.2, 0.85); ctx.lineWidth = 2.5;
    circle(32, 36, 10); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(26, 36); ctx.lineTo(38, 36); ctx.moveTo(32, 30); ctx.lineTo(32, 42); ctx.stroke();
    ctx.fillStyle = 'rgba(200,206,212,0.55)';
    for (let i = 0; i < 3; i++) ctx.fillRect(11, 50 + i * 3.4, 18 + rnd() * 24, 2);
  });

  // --- graffiti tag (transparent bg, spray strokes)
  cell(64, 192, () => {
    ctx.lineCap = 'round';
    ctx.strokeStyle = css(pal.accent, 1.25, 0.75);
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(10, 44);
    ctx.bezierCurveTo(18, 12, 30, 52, 38, 22);
    ctx.bezierCurveTo(43, 8, 52, 34, 55, 20);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(240,244,248,0.6)';
    ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(12, 50); ctx.lineTo(52, 46); ctx.stroke();
    ctx.fillStyle = css(pal.accent, 1.3, 0.5);
    for (let i = 0; i < 10; i++) { circle(8 + rnd() * 48, 12 + rnd() * 40, 0.8 + rnd() * 1.4); ctx.fill(); }
  });

  // --- vent grille
  cell(128, 192, () => {
    ctx.fillStyle = 'rgba(9,11,13,0.92)'; ctx.fillRect(5, 10, 54, 44);
    ctx.strokeStyle = 'rgba(170,178,188,0.4)'; ctx.lineWidth = 3; ctx.strokeRect(6.5, 11.5, 51, 41);
    for (let y = 17; y <= 46; y += 7) {
      ctx.fillStyle = 'rgba(0,0,0,0.9)'; ctx.fillRect(11, y, 42, 3.2);
      ctx.fillStyle = 'rgba(255,255,255,0.14)'; ctx.fillRect(11, y - 1.6, 42, 1.6);
    }
    ctx.fillStyle = 'rgba(210,216,222,0.5)';
    for (const [x, y] of [[9, 14], [55, 14], [9, 50], [55, 50]]) { circle(x, y, 1.6); ctx.fill(); }
  });

  // --- leak / drip stain (drawn top-down)
  cell(192, 192, () => {
    for (const [x, w2, len] of [[26, 5, 56], [36, 3, 42], [20, 2.5, 30]]) {
      const g = ctx.createLinearGradient(0, 0, 0, len);
      g.addColorStop(0, 'rgba(6,8,8,0.4)');
      g.addColorStop(1, 'rgba(6,8,8,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - w2 / 2, 2, w2, len);
    }
  });

  canvasCache.set(cacheKey, c);
  return c;
}

// 128px signage atlas: A/B wayfinding plates with left/right arrows.
function signAtlasCanvas(key, pal) {
  const cacheKey = `props:signs:${key}:${pal.accent}`;
  if (canvasCache.has(cacheKey)) return canvasCache.get(cacheKey);
  const c = makeCanvas(128);
  const ctx = c.getContext('2d');
  for (const [letter, dir, px, py] of [['A', -1, 0, 0], ['A', 1, 64, 0], ['B', -1, 0, 64], ['B', 1, 64, 64]]) {
    ctx.save();
    ctx.translate(px, py);
    ctx.fillStyle = 'rgb(13,17,22)';
    ctx.fillRect(1, 1, 62, 62);
    ctx.strokeStyle = css(pal.accent, 1.1, 0.9);
    ctx.lineWidth = 2.5;
    ctx.strokeRect(4.5, 4.5, 55, 55);
    ctx.fillStyle = '#eef2f6';
    ctx.font = '900 32px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(letter, 32, 26);
    // arrow: tail bar + triangle head pointing along `dir`
    ctx.fillStyle = css(pal.accent, 1.2, 1);
    ctx.fillRect(dir < 0 ? 26 : 14, 45, 24, 5);
    ctx.beginPath();
    const tipX = dir < 0 ? 12 : 52;
    ctx.moveTo(tipX, 47.5);
    ctx.lineTo(tipX - dir * 10, 39.5);
    ctx.lineTo(tipX - dir * 10, 55.5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  canvasCache.set(cacheKey, c);
  return c;
}

// 64x128 hanging banner (transparent swallowtail bottom).
function bannerCanvas(key, pal) {
  const cacheKey = `props:banner:${key}:${pal.accent}`;
  if (canvasCache.has(cacheKey)) return canvasCache.get(cacheKey);
  const c = makeCanvas(64, 128);
  const ctx = c.getContext('2d');
  ctx.beginPath();
  ctx.moveTo(2, 0); ctx.lineTo(62, 0); ctx.lineTo(62, 118);
  ctx.lineTo(47, 104); ctx.lineTo(32, 118); ctx.lineTo(17, 104); ctx.lineTo(2, 118);
  ctx.closePath();
  ctx.save();
  ctx.clip();
  ctx.fillStyle = css(pal.accent, 0.34, 0.97);
  ctx.fillRect(0, 0, 64, 128);
  ctx.fillStyle = css(pal.accent, 0.55, 0.95);
  ctx.fillRect(2, 0, 5, 128); ctx.fillRect(57, 0, 5, 128);
  ctx.fillStyle = css(pal.accent, 1.25, 0.95);
  ctx.fillRect(2, 78, 60, 7);
  const g = ctx.createLinearGradient(0, 60, 0, 128);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.4)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 60, 64, 68);
  ctx.strokeStyle = css(pal.accent, 1.4, 0.95);
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(32, 36, 17, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = '#f2f5f8';
  ctx.font = '900 24px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('S', 32, 37);
  ctx.restore();
  canvasCache.set(cacheKey, c);
  return c;
}

// ------------------------------------------------------------ addProps

export function addProps(group, map, rand) {
  const pal = map.palette;
  const key = paletteKey(pal);
  const T = THEMES[key];
  const [w, d] = map.size;
  const hw = w / 2;
  const hd = d / 2;

  const props = new THREE.Group();
  props.name = 'props';
  group.add(props);

  // ---------------------------------------------------------- context
  const boxes = map.boxes || [];
  const spawnPts = [];
  for (const arr of Object.values(map.spawns || {})) {
    for (const s of arr || []) spawnPts.push([s[0], s[1]]);
  }
  const siteEntries = Object.entries(map.sites || {});
  const siteList = siteEntries.map(([, s]) => ({ x: s.center[0], z: s.center[1], r: s.radius }));

  // solids (interior boxes + frozen perimeter walls) for inside tests
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
  const SPAWN_R = 1.05; // required XZ clearance from spawn points (>= 1.0)

  // rect (x +- hx, z +- hz) keeps >= SPAWN_R from every spawn point
  const clearOfSpawns = (x, z, hx = 0, hz = hx) => spawnPts.every(([sx, sz]) => {
    const dx = Math.max(0, Math.abs(sx - x) - hx);
    const dz = Math.max(0, Math.abs(sz - z) - hz);
    return dx * dx + dz * dz >= SPAWN_R * SPAWN_R;
  });

  // rect stays fully outside every site ring interior (non-decals only)
  const outsideSites = (x, z, hx = 0, hz = hx) => siteList.every((s) => {
    const dx = Math.max(0, Math.abs(s.x - x) - hx);
    const dz = Math.max(0, Math.abs(s.z - z) - hz);
    return dx * dx + dz * dz > (s.r + 0.15) * (s.r + 0.15);
  });

  // floor rect overlaps no grounded box footprint (keeps decals visible)
  const onOpenFloor = (x, z, hx, hz = hx, margin = 0.15) => boxes.every((b) => {
    if (b.pos[1] - b.size[1] / 2 > 0.2) return true; // lifted lintels: floor below stays visible
    return Math.abs(x - b.pos[0]) > b.size[0] / 2 + hx + margin ||
           Math.abs(z - b.pos[2]) > b.size[2] / 2 + hz + margin;
  });

  const pointInSolid = (x, y, z, pad = 0.08) => solids.some((s) =>
    x > s.x0 - pad && x < s.x1 + pad && y > s.y0 - pad && y < s.y1 + pad && z > s.z0 - pad && z < s.z1 + pad);

  // ------------------------------------------------------ geo buckets
  const decalGeos = [];   // lit decals (floor + wall), decal atlas
  const glowGeos = [];    // additive glow decals (Neon lane arrows)
  const metalGeos = [];   // pipes, boxes, cables, lockers, lamp hardware
  const accentGeos = [];  // emissive LEDs + string-light bulbs
  const signGeos = [];    // wayfinding plates (sign atlas)
  const bannerGeos = [];  // hanging cloth
  const lampSpots = [];   // glow sprite positions (budget <= 6)

  const mapUV = (geo, r) => {
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) {
      uv.setXY(i, r.u0 + uv.getX(i) * (r.u1 - r.u0), r.v0 + uv.getY(i) * (r.v1 - r.v0));
    }
    return geo;
  };

  // flat floor decal (rule a): y cycles 0.006..0.0108, always below the
  // site rings at 0.015 and above the floor plane (polygonOffset too)
  let decalIdx = 0;
  const floorDecal = (list, region, x, z, sx, sz, rot = 0) => {
    const cos = Math.abs(Math.cos(rot));
    const sin = Math.abs(Math.sin(rot));
    const hx = (sx * cos + sz * sin) / 2;
    const hz = (sx * sin + sz * cos) / 2;
    if (!clearOfSpawns(x, z, hx, hz)) return false;
    const g = mapUV(new THREE.PlaneGeometry(sx, sz), region);
    g.rotateX(-Math.PI / 2);
    if (rot) g.rotateY(rot);
    g.translate(x, 0.006 + (decalIdx = (decalIdx + 1) % 4) * 0.0016, z);
    list.push(g);
    return true;
  };
  // canvas-up points toward -z after rotateX; this yaw makes it point (dx, dz)
  const arrowRot = (dx, dz) => Math.atan2(-dx, -dz);

  // ------------------------------------------------------- wall faces
  // mountable faces: sides of grounded, tall-enough interior boxes plus
  // the 4 inner perimeter faces (frozen: +-w/2, +-d/2, t = 1)
  const faces = [];
  for (const b of boxes) {
    const top = b.pos[1] + b.size[1] / 2;
    const bot = b.pos[1] - b.size[1] / 2;
    if (bot > 0.3 || top < 2.2) continue;
    const [sx, , sz] = b.size;
    faces.push({ cx: b.pos[0] + sx / 2, cz: b.pos[2], nx: 1, nz: 0, len: sz, top, used: [] });
    faces.push({ cx: b.pos[0] - sx / 2, cz: b.pos[2], nx: -1, nz: 0, len: sz, top, used: [] });
    faces.push({ cx: b.pos[0], cz: b.pos[2] + sz / 2, nx: 0, nz: 1, len: sx, top, used: [] });
    faces.push({ cx: b.pos[0], cz: b.pos[2] - sz / 2, nx: 0, nz: -1, len: sx, top, used: [] });
  }
  const perimN = { cx: 0, cz: -(hd - PERIM_T / 2), nx: 0, nz: 1, len: w - 1.6, top: PERIM_H, perim: true, used: [] };
  const perimS = { cx: 0, cz: hd - PERIM_T / 2, nx: 0, nz: -1, len: w - 1.6, top: PERIM_H, perim: true, used: [] };
  const perimW = { cx: -(hw - PERIM_T / 2), cz: 0, nx: 1, nz: 0, len: d - 1.6, top: PERIM_H, perim: true, used: [] };
  const perimE = { cx: hw - PERIM_T / 2, cz: 0, nx: -1, nz: 0, len: d - 1.6, top: PERIM_H, perim: true, used: [] };
  faces.push(perimN, perimS, perimW, perimE);

  const facePos = (f, along) => (f.nx ? [f.cx, f.cz + along] : [f.cx + along, f.cz]);
  const faceRy = (f) => (f.nx ? (f.nx > 0 ? Math.PI / 2 : -Math.PI / 2) : (f.nz > 0 ? 0 : Math.PI));
  const faceFree = (f, along, half) => f.used.every(([a, h]) => Math.abs(along - a) >= half + h + 0.25);

  // wall-mounted quad (rule b): `proud` <= 0.06 in front of the collider face
  const wallDecal = (list, region, f, along, y, sw, sh, proud = 0.015) => {
    if (Math.abs(along) + sw / 2 > f.len / 2 - 0.2) return false;
    const [x, z] = facePos(f, along);
    if (!clearOfSpawns(x, z, sw / 2) || !outsideSites(x, z, sw / 2) || !faceFree(f, along, sw / 2)) return false;
    const g = mapUV(new THREE.PlaneGeometry(sw, sh), region);
    g.rotateY(faceRy(f));
    g.translate(x + f.nx * proud, y, z + f.nz * proud);
    list.push(g);
    f.used.push([along, sw / 2]);
    return true;
  };

  // wall-mounted box (rule b): half-embedded so it protrudes exactly `proud`
  const wallBox = (list, f, along, y, sw, sh, depth, proud) => {
    const [x, z] = facePos(f, along);
    const off = proud - depth / 2;
    list.push(f.nx
      ? placedBox(depth, sh, sw, x + f.nx * off, y, z)
      : placedBox(sw, sh, depth, x, y, z + f.nz * off));
  };

  // =====================================================================
  // GROUND STORY (flat decals, rule a)
  // =====================================================================

  const atk = map.spawns?.attackers || [];
  const def = map.spawns?.defenders || [];
  const zA = atk.length ? atk.reduce((s, p) => s + p[1], 0) / atk.length : 0;
  const zD = def.length ? def.reduce((s, p) => s + p[1], 0) / def.length : 0;

  // choke wall row (plant template: 3.2 m tall, 1 m thick, resting on floor)
  const chokeAll = boxes.filter((b) =>
    Math.abs(b.size[1] - 3.2) < 0.05 && Math.abs(b.size[2] - 1) < 0.05 && Math.abs(b.pos[1] - 1.6) < 0.05);
  const zChoke = chokeAll.length >= 2 ? chokeAll[0].pos[2] : null;
  const choke = zChoke === null ? [] : chokeAll.filter((b) => Math.abs(b.pos[2] - zChoke) < 0.1);
  const midDoor = zChoke !== null && boxes.some((b) =>
    Math.abs(b.size[2] - 1.15) < 0.05 && Math.abs(b.pos[2] - zChoke) < 0.1 && Math.abs(b.pos[0]) < 0.6);

  // hazard stripes flanking every choke door (doors sit on the site x lines)
  if (zChoke !== null) {
    const doorXs = [...siteList.map((s) => s.x), ...(midDoor ? [0] : [])];
    for (const dx of doorXs) {
      const wStrip = dx === 0 ? 3.1 : 4.3;
      for (const side of [-1, 1]) {
        const z = zChoke + side * 1.45;
        if (onOpenFloor(dx, z, wStrip / 2, 0.45, 0.1)) {
          floorDecal(decalGeos, REG.hazard, dx, z, wStrip, 0.9);
        }
      }
    }
  }

  // hazard strips at the connector doorways through the building blocks
  if (siteList.length) {
    const blockCx = Math.abs(siteList[0].x);
    for (const sgn of [-1, 1]) {
      const segs = boxes
        .filter((b) => Math.abs(Math.abs(b.pos[0]) - blockCx) < 0.05 && b.pos[0] * sgn > 0 &&
          Math.abs(b.pos[1] - b.size[1] / 2) < 0.05 && b.size[1] >= 3.2 && b.size[0] >= 3)
        .sort((a, b) => a.pos[2] - b.pos[2]);
      for (let i = 0; i + 1 < segs.length; i++) {
        const gap0 = segs[i].pos[2] + segs[i].size[2] / 2;
        const gap1 = segs[i + 1].pos[2] - segs[i + 1].size[2] / 2;
        const gap = gap1 - gap0;
        if (gap < 2.2 || gap > 6.5) continue;
        const bw = segs[i].size[0];
        const gz = (gap0 + gap1) / 2;
        for (const mouth of [-1, 1]) {
          const mx = sgn * blockCx + mouth * (bw / 2 - 0.55);
          if (onOpenFloor(mx, gz, 0.5, gap / 2 - 0.35, 0.05)) {
            floorDecal(decalGeos, REG.hazard, mx, gz, gap - 0.7, 0.9, Math.PI / 2);
          }
        }
      }
    }
  }

  // worn traffic lanes: spawn -> door -> site beelines (doors sit on the
  // site x lines, so a straight lane is always the real traffic path)
  const laneXs = [...siteList.map((s) => s.x), ...(midDoor ? [0] : [])];
  if (atk.length && siteList.length) {
    const zEndBase = Math.max(...siteList.map((s) => s.z - s.r - 1));
    for (const lx of laneXs) {
      const zStart = zA + 2.6;
      const zEnd = zEndBase;
      const n = Math.max(3, Math.ceil((zEnd - zStart) / 2.8));
      for (let i = 0; i < n; i++) {
        const z = zStart + ((i + 0.5) / n) * (zEnd - zStart) + (rand() - 0.5) * 1.8;
        const x = lx + (rand() - 0.5) * 2.0;
        const s = 1.9 + rand() * 1.1;
        const rot = rand() * Math.PI;
        if (onOpenFloor(x, z, s / 2, s / 2, 0.05)) {
          floorDecal(decalGeos, REG.smudge, x, z, s, s * (0.7 + rand() * 0.3), rot);
        }
      }
    }
  }
  if (!siteList.length && (map.spawns?.ffa || []).length) {
    // FFA: worn streaks along the spawn -> center beelines
    const ffa = map.spawns.ffa;
    for (let i = 0; i < ffa.length; i += 2) {
      for (const t of [0.32, 0.58]) {
        const x = ffa[i][0] * (1 - t) + (rand() - 0.5) * 1.6;
        const z = ffa[i][1] * (1 - t) + (rand() - 0.5) * 1.6;
        const s = 2.0 + rand() * 1.0;
        const rot = rand() * Math.PI;
        if (onOpenFloor(x, z, s / 2, s / 2, 0.05)) {
          floorDecal(decalGeos, REG.smudge, x, z, s, s * 0.75, rot);
        }
      }
    }
  }

  // drain grates + manhole discs scattered on open floor
  let grates = 0;
  let manholes = 0;
  for (let i = 0; i < 12; i++) {
    const x = (rand() * 2 - 1) * (hw - 4);
    const z = (rand() * 2 - 1) * (hd - 4);
    const rot = Math.floor(rand() * 4) * (Math.PI / 2);
    const wantGrate = i % 2 === 0;
    if (wantGrate ? grates >= 3 : manholes >= 2) continue;
    const s = wantGrate ? 1.15 : 1.05;
    if (!onOpenFloor(x, z, s / 2, s / 2, 0.3)) continue;
    if (floorDecal(decalGeos, wantGrate ? REG.grate : REG.manhole, x, z, s, s, rot)) {
      if (wantGrate) grates++; else manholes++;
    }
  }

  // puddles (Toxic / Spree / Neon / ...) on open floor
  for (let i = 0, placed = 0; i < T.puddles * 2 && placed < T.puddles; i++) {
    const x = (rand() * 2 - 1) * (hw - 3.5);
    const z = (rand() * 2 - 1) * (hd - 3.5);
    const s = 1.3 + rand() * 1.3;
    const rot = rand() * Math.PI;
    if (!onOpenFloor(x, z, s / 2, s / 2, 0.15)) continue;
    if (floorDecal(decalGeos, REG.puddle, x, z, s, s * (0.65 + rand() * 0.3), rot)) placed++;
  }

  // sand / snow drifts hugging the perimeter wall bases (Sand/Ruins/Ice)
  for (let i = 0, placed = 0; i < T.drifts * 2 && placed < T.drifts; i++) {
    const f = [perimN, perimS, perimW, perimE][Math.floor(rand() * 4)];
    const along = (rand() * 2 - 1) * (f.len / 2 - 2.5);
    const away = 0.55 + rand() * 0.9;
    const [fx, fz] = facePos(f, along);
    const x = fx + f.nx * away;
    const z = fz + f.nz * away;
    const s = 1.7 + rand() * 1.5;
    const rot = (f.nx ? Math.PI / 2 : 0) + (rand() - 0.5) * 0.5;
    if (!onOpenFloor(x, z, s / 2, s / 2, 0.1)) continue;
    if (floorDecal(decalGeos, REG.drift, x, z, s, s * 0.5, rot)) placed++;
  }

  // glowing lane arrows (Neon): flat additive decals pointing at the sites
  if (T.arrows) {
    if (siteList.length && atk.length) {
      for (const lx of laneXs) {
        const zEnd = Math.max(...siteList.map((s) => s.z - s.r - 2));
        const zStart = zA + 4;
        const n = Math.max(2, Math.floor((zEnd - zStart) / 6));
        for (let i = 0; i < n; i++) {
          const z = zStart + ((i + 0.5) / n) * (zEnd - zStart);
          const x = lx + (rand() - 0.5) * 0.8;
          if (onOpenFloor(x, z, 0.6, 0.6, 0.1)) {
            floorDecal(glowGeos, REG.arrow, x, z, 1.15, 1.15, arrowRot(0, 1));
          }
        }
      }
    } else {
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 + 0.4;
        const x = Math.cos(a) * (hw - 11);
        const z = Math.sin(a) * (hd - 11);
        if (onOpenFloor(x, z, 0.6, 0.6, 0.1)) {
          floorDecal(glowGeos, REG.arrow, x, z, 1.15, 1.15, arrowRot(-Math.cos(a), -Math.sin(a)));
        }
      }
    }
  }

  // painted team insignia on the spawn-room floors
  if (atk.length) {
    const x = atk.reduce((s, p) => s + p[0], 0) / atk.length;
    if (onOpenFloor(x, zA - 2.7, 1.35, 1.35, 0.15)) floorDecal(decalGeos, REG.insA, x, zA - 2.7, 2.7, 2.7, Math.PI);
  }
  if (def.length) {
    const x = def.reduce((s, p) => s + p[0], 0) / def.length;
    if (onOpenFloor(x, zD + 2.7, 1.35, 1.35, 0.15)) floorDecal(decalGeos, REG.insB, x, zD + 2.7, 2.7, 2.7, 0);
  }

  // =====================================================================
  // WALL STORY (rule b: <= 0.06 proud of collider faces)
  // =====================================================================

  // twin pipe runs + conduit junction boxes along the two long perimeter walls
  const longFaces = w >= d ? [perimN, perimS] : [perimW, perimE];
  for (const f of longFaces) {
    const L = f.len - 10;
    if (L < 8) continue;
    const [mx, mz] = facePos(f, 0);
    const hx = f.nx ? 0.12 : L / 2;
    const hz = f.nx ? L / 2 : 0.12;
    if (!clearOfSpawns(mx, mz, hx, hz) || !outsideSites(mx, mz, hx, hz)) continue;
    // main pipe (0.15 sq, proud 0.05) + thin conduit above it (0.08, proud 0.05)
    wallBox(metalGeos, f, 0, 2.05, L, 0.15, 0.15, 0.05);
    wallBox(metalGeos, f, 0, 2.32, L, 0.08, 0.08, 0.05);
    // collars
    const nCol = Math.max(2, Math.round(L / 9));
    for (let i = 0; i < nCol; i++) {
      const a = -L / 2 + ((i + 0.5) / nCol) * L;
      wallBox(metalGeos, f, a, 2.05, 0.14, 0.22, 0.2, 0.058);
    }
    // vertical drops to the floor at both run ends
    for (const side of [-1, 1]) {
      wallBox(metalGeos, f, side * (L / 2 + 0.25), 1.03, 0.15, 2.06, 0.15, 0.05);
    }
    // junction boxes with status LEDs (and drip stains for grimy themes)
    const nJ = Math.max(1, Math.round(L / 11));
    for (let i = 0; i < nJ; i++) {
      const a = -L / 2 + ((i + 0.5) / nJ) * L + (rand() - 0.5) * 3;
      const [jx, jz] = facePos(f, a);
      if (!clearOfSpawns(jx, jz, 0.3) || !outsideSites(jx, jz, 0.3) || !faceFree(f, a, 0.35)) continue;
      wallBox(metalGeos, f, a, 2.14, 0.36, 0.62, 0.09, 0.048);
      if (T.strings || key === 'Neon') {
        wallBox(accentGeos, f, a, 2.34, 0.05, 0.05, 0.012, 0.058);
      }
      f.used.push([a, 0.4]);
      if (T.leaks && rand() < 0.45) {
        const g = mapUV(new THREE.PlaneGeometry(0.5, 1.35), REG.leak);
        g.rotateY(faceRy(f));
        g.translate(jx + f.nx * 0.013, 1.12, jz + f.nz * 0.013);
        decalGeos.push(g);
        const sx2 = jx + f.nx * 0.55;
        const sz2 = jz + f.nz * 0.55;
        if (onOpenFloor(sx2, sz2, 0.55, 0.45, 0.05)) {
          floorDecal(decalGeos, REG.smudge, sx2, sz2, 1.1, 0.9, rand() * Math.PI);
        }
      }
    }
  }

  // single pipe runs along tall interior box faces (building blocks)
  let interiorPipes = 0;
  for (const f of faces) {
    if (f.perim || interiorPipes >= 6 || f.top < 3.05 || f.len < 7.2) continue;
    if (rand() > 0.65) continue;
    const L = f.len - 1.4;
    const [mx, mz] = facePos(f, 0);
    const hx = f.nx ? 0.12 : L / 2;
    const hz = f.nx ? L / 2 : 0.12;
    if (!clearOfSpawns(mx, mz, hx, hz) || !outsideSites(mx, mz, hx, hz)) continue;
    const y = Math.min(f.top - 0.8, 2.45);
    wallBox(metalGeos, f, 0, y, L, 0.15, 0.15, 0.05);
    wallBox(metalGeos, f, -L / 2 + 0.3, y / 2, 0.15, y, 0.15, 0.05); // end drop
    const nCol = Math.max(1, Math.round(L / 7));
    for (let i = 0; i < nCol; i++) {
      wallBox(metalGeos, f, -L / 2 + ((i + 0.5) / nCol) * L, y, 0.14, 0.22, 0.2, 0.058);
    }
    interiorPipes++;
  }

  // vent grilles (low on interior boxes, mid-height on the perimeter)
  for (let i = 0, placed = 0; i < 10 && placed < 4; i++) {
    const f = faces[Math.floor(rand() * faces.length)];
    const along = (rand() * 2 - 1) * Math.max(0, f.len / 2 - 1.2);
    if (f.len < 3) continue;
    if (wallDecal(decalGeos, REG.vent, f, along, f.perim ? 1.55 : 0.55, 0.62, 0.46)) placed++;
  }

  // posters + graffiti tags for the urban palettes
  for (let i = 0, placed = 0; i < T.posters * 3 && placed < T.posters; i++) {
    const f = faces[Math.floor(rand() * faces.length)];
    const along = (rand() * 2 - 1) * Math.max(0, f.len / 2 - 1.2);
    const y = 1.22 + rand() * 0.3; // stays below the perimeter pipe band
    if (f.len < 3.5 || f.top < 2.2) continue;
    const region = i % 3 === 2 ? REG.tag : REG.poster;
    if (wallDecal(decalGeos, region, f, along, y, 0.74, 0.74)) placed++;
  }

  // A/B wayfinding plates on both sides of the choke wall, flanking the
  // doors (doors sit exactly on the site x lines)
  if (zChoke !== null) {
    for (const [letter, s] of siteEntries) {
      const doorX = s.center[0];
      for (const side of [-1, 1]) {
        const px = doorX + side * 3.6;
        const seg = choke.find((b) => Math.abs(px - b.pos[0]) <= b.size[0] / 2 - 0.5);
        if (!seg) continue;
        for (const nz of [-1, 1]) {
          const pz = zChoke + nz * 0.5;
          if (!clearOfSpawns(px, pz, 0.35) || !outsideSites(px, pz, 0.35)) continue;
          const ry = nz > 0 ? 0 : Math.PI;
          // backer plate (proud 0.042) + printed face (proud 0.05)
          metalGeos.push(placedBox(0.62, 0.56, 0.08, px, 1.9, pz + nz * 0.002));
          const dirX = Math.sign(doorX - px); // arrow points at the door
          const right = dirX * Math.cos(ry) > 0;
          const g = mapUV(new THREE.PlaneGeometry(0.52, 0.52), SIGN[letter]?.[right ? 'right' : 'left'] || SIGN.A.right);
          g.rotateY(ry);
          g.translate(px, 1.9, pz + nz * 0.05);
          signGeos.push(g);
        }
      }
    }
  }

  // equipment-locker silhouettes on the perimeter walls behind each team
  if (atk.length && def.length) {
    const teamFaces = [zA < 0 ? perimN : perimS, zD < 0 ? perimN : perimS];
    for (const f of teamFaces) {
      for (const clusterX of [-12, 12]) {
        for (let j = 0; j < 4; j++) {
          const a = clusterX + (j - 1.5) * 0.82;
          const [lx, lz] = facePos(f, a);
          if (Math.abs(a) + 0.4 > f.len / 2 - 0.3) continue;
          if (!clearOfSpawns(lx, lz, 0.4) || !outsideSites(lx, lz, 0.4) || !faceFree(f, a, 0.41)) continue;
          wallBox(metalGeos, f, a, 0.925, 0.74, 1.85, 0.11, 0.055);
          if (T.strings) wallBox(accentGeos, f, a, 1.62, 0.05, 0.05, 0.012, 0.058);
        }
        f.used.push([clusterX, 2.1]);
      }
    }
  }

  // =====================================================================
  // OVERHEAD STORY (rule c: lowest point >= 2.6)
  // =====================================================================

  // sagging cable between two points; every part stays >= 2.6 by the sag
  // budget picked at the call sites (checked again via cableClear)
  const hangCable = (p0, p1, sag, bulbs) => {
    const segs = 8;
    const pts = [];
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      pts.push([
        p0[0] + (p1[0] - p0[0]) * t,
        p0[1] + (p1[1] - p0[1]) * t - sag * 4 * t * (1 - t),
        p0[2] + (p1[2] - p0[2]) * t,
      ]);
    }
    for (let i = 0; i < segs; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const dz = b[2] - a[2];
      const len = Math.hypot(dx, dy, dz);
      const g = new THREE.BoxGeometry(len + 0.03, 0.05, 0.05);
      g.rotateZ(Math.atan2(dy, Math.hypot(dx, dz)));
      g.rotateY(Math.atan2(-dz, dx));
      g.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
      metalGeos.push(g);
      if (bulbs && i > 0) {
        const bg = new THREE.BoxGeometry(0.08, 0.1, 0.08);
        bg.translate(pts[i][0], pts[i][1] - 0.07, pts[i][2]);
        accentGeos.push(bg);
      }
    }
  };

  // dense sampling: every point on the span (bulbs included) must keep
  // spawn clearance, stay out of site rings and clip no collider volume
  const cableClear = (p0, p1, sag) => {
    const L = Math.hypot(p1[0] - p0[0], p1[2] - p0[2]);
    const n = Math.max(8, Math.ceil(L / 0.4));
    for (let i = 1; i < n; i++) {
      const t = i / n;
      const x = p0[0] + (p1[0] - p0[0]) * t;
      const y = p0[1] + (p1[1] - p0[1]) * t - sag * 4 * t * (1 - t);
      const z = p0[2] + (p1[2] - p0[2]) * t;
      if (y - 0.15 < 2.6) return false;
      if (!clearOfSpawns(x, z, 0.25)) return false;
      if (!outsideSites(x, z, 0.35)) return false;
      const nearEnd = t * L < 0.6 || (1 - t) * L < 0.6;
      if (!nearEnd && pointInSolid(x, y - 0.1, z, 0.15)) return false;
    }
    return true;
  };

  // catenary spans between facing tall anchors (building blocks / choke /
  // FFA monoliths / the frozen perimeter walls)
  const anchors = [];
  for (const b of boxes) {
    const top = b.pos[1] + b.size[1] / 2;
    if (top < 3.15 || b.pos[1] - b.size[1] / 2 > 0.3) continue;
    anchors.push({
      x0: b.pos[0] - b.size[0] / 2, x1: b.pos[0] + b.size[0] / 2,
      z0: b.pos[2] - b.size[2] / 2, z1: b.pos[2] + b.size[2] / 2, top,
    });
  }
  anchors.push(
    { x0: -hw - 0.5, x1: -hw + 0.5, z0: -hd, z1: hd, top: PERIM_H },
    { x0: hw - 0.5, x1: hw + 0.5, z0: -hd, z1: hd, top: PERIM_H },
    { x0: -hw, x1: hw, z0: -hd - 0.5, z1: -hd + 0.5, top: PERIM_H },
    { x0: -hw, x1: hw, z0: hd - 0.5, z1: hd + 0.5, top: PERIM_H },
  );
  const spanCandidates = [];
  for (let i = 0; i < anchors.length; i++) {
    for (let j = 0; j < anchors.length; j++) {
      if (i === j) continue;
      const a = anchors[i];
      const b = anchors[j];
      const gapX = b.x0 - a.x1;
      if (gapX >= 4.5 && gapX <= 30) {
        const o0 = Math.max(a.z0, b.z0);
        const o1 = Math.min(a.z1, b.z1);
        if (o1 - o0 >= 2.4) {
          spanCandidates.push({ axis: 'x', from: a.x1 - 0.03, to: b.x0 + 0.03, lo: o0 + 1, hi: o1 - 1, top: Math.min(a.top, b.top) });
        }
      }
      const gapZ = b.z0 - a.z1;
      if (gapZ >= 4.5 && gapZ <= 30) {
        const o0 = Math.max(a.x0, b.x0);
        const o1 = Math.min(a.x1, b.x1);
        if (o1 - o0 >= 2.4) {
          spanCandidates.push({ axis: 'z', from: a.z1 - 0.03, to: b.z0 + 0.03, lo: o0 + 1, hi: o1 - 1, top: Math.min(a.top, b.top) });
        }
      }
    }
  }
  for (let i = spanCandidates.length - 1; i > 0; i--) { // deterministic shuffle
    const j = Math.floor(rand() * (i + 1));
    [spanCandidates[i], spanCandidates[j]] = [spanCandidates[j], spanCandidates[i]];
  }
  const placedSpans = [];
  const maxSpans = siteList.length ? 4 : 3;
  for (const c of spanCandidates) {
    if (placedSpans.length >= maxSpans) break;
    const attachY = Math.min(c.top, 5.4) - 0.35;
    if (attachY < 3.0) continue;
    const cross = c.lo + rand() * Math.max(0, c.hi - c.lo);
    const sag = Math.min(0.55, attachY - 2.78);
    const p0 = c.axis === 'x' ? [c.from, attachY, cross] : [cross, attachY, c.from];
    const p1 = c.axis === 'x' ? [c.to, attachY, cross] : [cross, attachY, c.to];
    const mid = [(p0[0] + p1[0]) / 2, (p0[2] + p1[2]) / 2];
    if (placedSpans.some(([mx, mz]) => Math.hypot(mx - mid[0], mz - mid[1]) < 5)) continue;
    if (!cableClear(p0, p1, sag)) continue;
    hangCable(p0, p1, sag, T.strings);
    placedSpans.push(mid);
  }

  // festoon strings cutting across two arena corners (string-light themes)
  if (T.strings) {
    let strings = 0;
    for (const [sx, sz] of [[1, 1], [-1, -1], [1, -1], [-1, 1]]) {
      if (strings >= 2) break;
      const backA = 6 + rand() * 4;
      const backB = 6 + rand() * 4;
      if (rand() > 0.7) continue;
      const p0 = [sx * (hw - 0.52), 4.5, sz * (hd - backA)];
      const p1 = [sx * (hw - backB), 4.5, sz * (hd - 0.52)];
      if (!cableClear(p0, p1, 0.5)) continue;
      hangCable(p0, p1, 0.5, true);
      strings++;
    }
  }

  // hanging lamps on perimeter wall arms (housings only — NO lights, just
  // a small additive glow sprite per bulb)
  const lampFaces = w >= d ? [perimW, perimE, perimN, perimS] : [perimN, perimS, perimW, perimE];
  for (let i = 0, placed = 0; i < 9 && placed < Math.min(T.lamps, 6); i++) {
    const f = lampFaces[i % 2]; // the two long walls
    const along = (rand() * 2 - 1) * (f.len / 2 - 4);
    const [fx, fz] = facePos(f, along);
    const x = fx + f.nx * 0.78;
    const z = fz + f.nz * 0.78;
    if (!clearOfSpawns(x, z, 0.35) || !outsideSites(x, z, 0.35)) continue;
    if (pointInSolid(x, 3.9, z, 0.25) || pointInSolid(x, 3.0, z, 0.25)) continue;
    if (!faceFree(f, along, 0.6)) continue;
    // arm (from inside the wall out into the room, all parts >= 2.6 up)
    metalGeos.push(f.nx
      ? placedBox(0.9, 0.055, 0.055, fx + f.nx * 0.4, 4.35, fz)
      : placedBox(0.055, 0.055, 0.9, fx, 4.35, fz + f.nz * 0.4));
    metalGeos.push(placedBox(0.035, 0.24, 0.035, x, 4.21, z)); // stem
    const shade = new THREE.CylinderGeometry(0.09, 0.3, 0.3, 10);
    shade.translate(x, 3.97, z);
    metalGeos.push(shade);
    lampSpots.push([x, 3.85, z]);
    f.used.push([along, 0.6]);
    placed++;
  }

  // hanging banners on the wall behind the defender spawn (bottom >= 2.6)
  if (def.length) {
    const f = zD > 0 ? perimS : perimN;
    for (const along of [-6.5, 0, 6.5]) {
      const [bx, bz] = facePos(f, along);
      if (!clearOfSpawns(bx, bz, 0.75) || !outsideSites(bx, bz, 0.75) || !faceFree(f, along, 0.8)) continue;
      wallBox(metalGeos, f, along, 5.24, 1.55, 0.06, 0.06, 0.05); // rod
      const g = new THREE.PlaneGeometry(1.4, 2.5);
      g.rotateY(faceRy(f));
      g.translate(bx + f.nx * 0.035, 3.95, bz + f.nz * 0.035);
      bannerGeos.push(g);
      f.used.push([along, 0.7]);
    }
  }

  // =====================================================================
  // MERGE + MATERIALS (fresh per call — clearScene disposes everything)
  // =====================================================================

  const decalCanvas = decalAtlasCanvas(key, pal, T);

  const decalMesh = mergeInto(props, decalGeos, new THREE.MeshLambertMaterial({
    map: freshTex(decalCanvas),
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  }));
  if (decalMesh) decalMesh.receiveShadow = true;

  mergeInto(props, glowGeos, new THREE.MeshBasicMaterial({
    map: freshTex(decalCanvas),
    color: new THREE.Color(pal.accent).multiplyScalar(1.2),
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  }));

  const metalMesh = mergeInto(props, metalGeos, new THREE.MeshStandardMaterial({
    color: new THREE.Color(T.pipe),
    roughness: 0.6,
    metalness: 0.55,
  }));
  if (metalMesh) metalMesh.receiveShadow = true;

  mergeInto(props, accentGeos, new THREE.MeshStandardMaterial({
    color: new THREE.Color(pal.accent).multiplyScalar(0.5),
    emissive: new THREE.Color(pal.accent),
    emissiveIntensity: 1.15,
    roughness: 0.4,
    metalness: 0.2,
  }));

  mergeInto(props, signGeos, new THREE.MeshBasicMaterial({
    map: freshTex(signAtlasCanvas(key, pal)),
  }));

  const bannerMesh = mergeInto(props, bannerGeos, new THREE.MeshLambertMaterial({
    map: freshTex(bannerCanvas(key, pal)),
    transparent: true,
    side: THREE.DoubleSide,
  }));
  if (bannerMesh) bannerMesh.receiveShadow = true;

  // lamp bulb glows: one shared sprite material, hard-capped at 6 sprites
  if (lampSpots.length) {
    const bulb = new THREE.Color(pal.accent).lerp(new THREE.Color('#fff6e0'), 0.6);
    const sm = new THREE.SpriteMaterial({
      map: glowTexture(),
      color: bulb,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    });
    for (const [x, y, z] of lampSpots.slice(0, 6)) {
      const sp = new THREE.Sprite(sm);
      sp.scale.set(0.85, 0.85, 0.85);
      sp.position.set(x, y, z);
      props.add(sp);
    }
  }
}
