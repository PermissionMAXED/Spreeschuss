import * as THREE from 'three';
import { paletteKey, hashStr, mulberry32 } from './util.js';

// =====================================================================
// FROZEN INTERFACE — sky background + image-based environment.
//
//   applySky(scene, map)
//     Builds the equirect sky texture for the map palette, sets
//     `scene.background`, and sets `scene.environment` to the same
//     texture only for the glossy palettes (Neon / Ice / Crimson —
//     rough themes skip the per-fragment reflection cost), else null.
//
// CACHING (important for Renderer.clearScene() compatibility): sky
// textures are cached as LIVE THREE.CanvasTexture instances keyed by
// palette + sky colors, and reused across matches — clearScene() never
// disposes scene.background / scene.environment, and reuse keeps the
// PMREM env cached. NEVER dispose a sky texture. (Surface textures in
// engine/textures.js are the opposite: fresh wrappers per call,
// disposed every match.)
//
// This module owns the sky half of the theme table. Every palette has a
// hand-tuned signature painter (see PAINTERS at the bottom):
//   Spree   — overcast Berlin dusk, layered cloud banks, TV tower.
//   Sand    — dust-haze gradient, huge low sun with a bloom-hot core,
//             birds as tiny specks over the dunes.
//   Neon    — aurora-like color bands, dense lit-window horizon,
//             light-pollution domes.
//   Ice     — green/teal aurora curtains, sharp star field, twin moons.
//   Ruins   — smoke columns on the horizon, ember-tinted clouds.
//   Toxic   — sickly layered overcast broken by a god-ray gap.
//   Crimson — giant banded red sun over an industrial silhouette.
// All painters draw from a PRNG seeded by the cache key, so every sky
// is fully deterministic per palette. Canvas stays at 512 px.
// =====================================================================

// Sky identity per palette (keyed by util.paletteKey). `environment`
// mirrors "envMapIntensity >= 0.6" from the materials table.
const SKIES = {
  Spree: { environment: false },
  Sand: { environment: false },
  Neon: { environment: true },
  Ice: { environment: true },
  Ruins: { environment: false },
  Toxic: { environment: false },
  Crimson: { environment: true },
};

export function applySky(scene, map) {
  const pal = map.palette;
  const key = paletteKey(pal);
  const theme = SKIES[key];
  const sky = skyTexture(key, pal.skyTop, pal.skyBottom, pal.accent);
  scene.background = sky;
  // Image-based env reflections only where the theme is glossy enough to
  // show them (Ice/Neon/Crimson); rough themes skip the per-fragment cost.
  scene.environment = theme.environment ? sky : null;
}

// ----------------------------------------------------- canvas helpers
// Private copies of the tiny paint helpers (the shared originals stay in
// engine/textures.js for the surface textures).

const skyCache = new Map(); // key -> THREE.CanvasTexture (never disposed)

function makeCanvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

const c255 = (v) => Math.max(0, Math.min(255, Math.round(v)));

// IMPORTANT: three r152+ color management converts hex/style inputs into the
// LINEAR working space, so `new THREE.Color(hex).r * 255` yields values much
// darker than the source hex. Canvas painting needs sRGB bytes, so always
// convert back with convertLinearToSRGB() before writing pixels.
function srgb(hex, mul = 1, mixHex = null, mixAmt = 0) {
  const c = new THREE.Color(hex);
  if (mixHex) c.lerp(new THREE.Color(mixHex), mixAmt);
  c.multiplyScalar(mul).convertLinearToSRGB();
  return [c255(c.r * 255), c255(c.g * 255), c255(c.b * 255)];
}

// css color string from a hex string with brightness multiplier / optional mix
function css(hex, mul = 1, alpha = 1, mixHex = null, mixAmt = 0) {
  const [r, g, b] = srgb(hex, mul, mixHex, mixAmt);
  return `rgba(${r},${g},${b},${alpha})`;
}

// ------------------------------------------------------------------ sky

// Equirect signature sky for one palette. Returns a CACHED live texture
// instance — safe because scene.background/scene.environment are never
// disposed by clearScene(), and reuse keeps the PMREM env cached.
export function skyTexture(palKey, top = '#12203a', bottom = '#2a3d63', accent = '#43b7c7') {
  const key = `sky:v2:${palKey}:${top}:${bottom}:${accent}`;
  if (skyCache.has(key)) return skyCache.get(key);

  const S = 512;
  const c = makeCanvas(S);
  const P = {
    ctx: c.getContext('2d'),
    S,
    HZ: S / 2, // horizon row of the equirect canvas
    rand: mulberry32(hashStr(key)),
    top,
    bottom,
    accent,
  };
  (PAINTERS[palKey] || PAINTERS.Spree)(P);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.mapping = THREE.EquirectangularReflectionMapping;
  skyCache.set(key, tex);
  return tex;
}

// -------------------------------------------------------- paint toolkit
// All helpers keep the x=0 / x=S seam continuous: blobs re-draw wrapped
// copies, ridges close their random walk, and band shapes use integer
// sine frequencies.

// Vertical gradients: zenith -> horizon, then the dim below-horizon half.
function baseSky(P, { zenith = 0.85, horizon = 1.08, warm = null, warmAmt = 0 } = {}) {
  const { ctx, S, HZ, top, bottom } = P;
  let g = ctx.createLinearGradient(0, 0, 0, HZ);
  g.addColorStop(0, css(top, zenith));
  g.addColorStop(0.58, css(top, 1, 1, bottom, 0.55));
  g.addColorStop(1, warm ? css(bottom, horizon, 1, warm, warmAmt) : css(bottom, horizon));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, HZ + 1);
  g = ctx.createLinearGradient(0, HZ, 0, S);
  g.addColorStop(0, warm ? css(bottom, 0.9, 1, warm, warmAmt * 0.6) : css(bottom, 0.9));
  g.addColorStop(0.32, css(bottom, 0.42));
  g.addColorStop(1, css(bottom, 0.15));
  ctx.fillStyle = g;
  ctx.fillRect(0, HZ, S, S - HZ);
}

// Soft squashed radial blob, drawn again at ±S when it crosses the seam.
function blob(P, x, y, rw, rh, hex, mul, alpha) {
  const { ctx, S } = P;
  const c0 = css(hex, mul, alpha);
  const c1 = css(hex, mul, 0);
  const draw = (bx) => {
    const g = ctx.createRadialGradient(bx, y, 0, bx, y, rw);
    g.addColorStop(0, c0);
    g.addColorStop(1, c1);
    ctx.save();
    ctx.translate(bx, y);
    ctx.scale(1, rh / rw);
    ctx.translate(-bx, -y);
    ctx.fillStyle = g;
    ctx.fillRect(bx - rw, y - rw, rw * 2, rw * 2);
    ctx.restore();
  };
  draw(x);
  if (x - rw < 0) draw(x + S);
  if (x + rw > S) draw(x - S);
}

// Tiered star field: dim points with subtle color variance, plus a few
// bright stars with halos and cross spikes. Density fades near horizon.
function stars(P, { count = 120, bright = 4, maxY = 0.9, sharp = false, tint = null } = {}) {
  const { ctx, S, HZ, rand } = P;
  for (let i = 0; i < count; i++) {
    const y = rand() * HZ * maxY;
    const high = 1 - y / (HZ * maxY); // 1 near zenith
    const a = (0.2 + rand() * rand() * 0.7) * (0.25 + 0.75 * high);
    const r = sharp ? 0.35 + rand() * 0.75 : 0.4 + rand() * 1.1;
    const roll = rand();
    let col = '255,255,255';
    if (tint && roll < 0.28) col = tint;
    else if (roll > 0.86) col = '255,222,190';
    else if (roll > 0.72) col = '198,222,255';
    ctx.fillStyle = `rgba(${col},${a.toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(rand() * S, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  for (let i = 0; i < bright; i++) {
    const x = S * (0.04 + rand() * 0.92);
    const y = rand() * HZ * Math.min(maxY, 0.6);
    const hr = 2.5 + rand() * 3.5;
    const g = ctx.createRadialGradient(x, y, 0, x, y, hr);
    g.addColorStop(0, 'rgba(255,255,255,0.95)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.28)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - hr, y - hr, hr * 2, hr * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillRect(x - hr, y - 0.4, hr * 2, 0.8);
    ctx.fillRect(x - 0.4, y - hr, 0.8, hr * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.fillRect(x - 0.8, y - 0.8, 1.6, 1.6);
  }
}

// Two-part horizon glow: a wide soft band plus a tight hot line hugging
// the horizon row (where the silhouettes will sit).
function horizonGlow(P, hex, strength, spanUp = 58, spanDown = 32) {
  const { ctx, S, HZ } = P;
  ctx.globalCompositeOperation = 'lighter';
  let g = ctx.createLinearGradient(0, HZ - spanUp, 0, HZ + spanDown);
  g.addColorStop(0, css(hex, 1, 0));
  g.addColorStop(0.6, css(hex, 1, strength * 0.7, '#ffffff', 0.22));
  g.addColorStop(0.72, css(hex, 1, strength, '#ffffff', 0.32));
  g.addColorStop(1, css(hex, 1, 0));
  ctx.fillStyle = g;
  ctx.fillRect(0, HZ - spanUp, S, spanUp + spanDown);
  g = ctx.createLinearGradient(0, HZ - 4, 0, HZ + 2);
  g.addColorStop(0, css(hex, 1, 0));
  g.addColorStop(0.7, css(hex, 1, strength * 0.55, '#ffffff', 0.6));
  g.addColorStop(1, css(hex, 1, 0));
  ctx.fillStyle = g;
  ctx.fillRect(0, HZ - 4, S, 6);
  ctx.globalCompositeOperation = 'source-over';
}

// A patchy layer of elongated soft blobs scattered across the full width.
// (Deliberately NOT a continuous band: full-width bands turn into perfect
// concentric rings around the zenith once equirect-mapped.) `lit` adds
// warm rims under some patches (light from below — dusk city glow, fires).
function cloudBank(P, { y, w, h, hex, mul = 1, alpha, lit = null, litAlpha = 0.14 }) {
  const { S, rand, ctx } = P;
  const n = 7 + Math.floor(rand() * 4);
  for (let i = 0; i < n; i++) {
    const bx = rand() * S;
    const by = y + (rand() - 0.5) * h * 1.6;
    blob(P, bx, by, w * (0.1 + rand() * 0.12), h * (0.35 + rand() * 0.45), hex, mul, alpha * (0.55 + rand() * 0.5));
  }
  if (lit) {
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 3; i++) {
      blob(P, rand() * S, y + h * 0.5 + (rand() - 0.5) * h * 0.6, w * 0.16, h * 0.18, lit, 1, litAlpha * (0.7 + rand() * 0.6));
    }
    ctx.globalCompositeOperation = 'source-over';
  }
}

// Layered wavy overcast strata built from rows of blobs; integer sine
// frequencies keep the bands seam-continuous.
function strata(P, { layers = 5, hex, litHex = null }) {
  const { ctx, S, HZ, rand } = P;
  for (let L = 0; L < layers; L++) {
    const yc = HZ * (0.24 + (L / layers) * 0.62) + (rand() - 0.5) * 10;
    const th = 10 + rand() * 16;
    const f = 1 + Math.floor(rand() * 3);
    const ph = rand() * Math.PI * 2;
    const mul = 0.55 + rand() * 0.3;
    // high layers stay faint so they don't ring around the zenith
    const alpha = (0.14 + rand() * 0.08) * (0.55 + 0.45 * (L / layers));
    for (let x = 0; x < S; x += 10) {
      if (rand() < 0.16) continue; // ragged holes in the deck
      const t = (x / S) * Math.PI * 2;
      blob(P, x + 5, yc + Math.sin(t * f + ph) * 8 + (rand() - 0.5) * 9, 26, th * 0.5, hex, mul, alpha * (0.7 + rand() * 0.6));
    }
    if (litHex) {
      ctx.globalCompositeOperation = 'lighter';
      for (let x = 0; x < S; x += 26) {
        if (rand() < 0.3) continue;
        const t = (x / S) * Math.PI * 2;
        blob(P, x + 13, yc + Math.sin(t * f + ph) * 8 + th * 0.5 + (rand() - 0.5) * 6, 22, 5, litHex, 1, 0.04 + rand() * 0.03);
      }
      ctx.globalCompositeOperation = 'source-over';
    }
  }
}

// Aurora curtains: wavy bottom edge (integer sine frequencies -> wraps)
// with vertical striation shimmer, drawn as thin additive gradient slices.
function aurora(P, { colors, bands = 3, len = 100 }) {
  const { ctx, S, HZ, rand } = P;
  ctx.globalCompositeOperation = 'lighter';
  for (let b = 0; b < bands; b++) {
    const hex = colors[b % colors.length];
    const y0 = HZ * (0.2 + rand() * 0.42);
    const amp = 14 + rand() * 20;
    const f1 = 1 + Math.floor(rand() * 2);
    const f2 = 2 + Math.floor(rand() * 3);
    const k = 24 + Math.floor(rand() * 20);
    const p1 = rand() * Math.PI * 2;
    const p2 = rand() * Math.PI * 2;
    const p3 = rand() * Math.PI * 2;
    const L = len * (0.7 + rand() * 0.6);
    const baseA = 0.09 + rand() * 0.07;
    for (let x = 0; x < S; x += 2) {
      const t = (x / S) * Math.PI * 2;
      const yb = y0 + Math.sin(t * f1 + p1) * amp + Math.sin(t * f2 + p2) * amp * 0.4;
      const stri = 0.6 + 0.4 * Math.sin(t * k + p3);
      const g = ctx.createLinearGradient(0, yb - L, 0, yb);
      g.addColorStop(0, css(hex, 1, 0));
      g.addColorStop(0.72, css(hex, 1, baseA * stri));
      g.addColorStop(1, css(hex, 1, baseA * 0.25 * stri));
      ctx.fillStyle = g;
      ctx.fillRect(x, yb - L, 2, L);
    }
  }
  ctx.globalCompositeOperation = 'source-over';
}

// Sun / celestial disc with a hot core (bloom threshold is 0.9, so the
// near-white core reads as a genuine light source) and a wide halo.
function sunDisc(P, { x, y, r, color, hot = '#fff6e8', hotStop = 0.2, halo = 2.6, haloAlpha = 0.4, bodyAlpha = 1 }) {
  const { ctx, S } = P;
  ctx.globalCompositeOperation = 'lighter';
  blob(P, x, y, r * halo, r * halo, color, 1, haloAlpha * 0.4);
  const draw = (bx) => {
    const g = ctx.createRadialGradient(bx, y, 0, bx, y, r);
    g.addColorStop(0, css(hot, 1, bodyAlpha));
    g.addColorStop(hotStop, css(hot, 1, bodyAlpha * 0.96));
    g.addColorStop(0.6, css(color, 1, bodyAlpha * 0.8));
    g.addColorStop(1, css(color, 1, 0));
    ctx.fillStyle = g;
    ctx.fillRect(bx - r, y - r, r * 2, r * 2);
  };
  draw(x);
  if (x - r < 0) draw(x + S);
  if (x + r > S) draw(x - S);
  ctx.globalCompositeOperation = 'source-over';
}

// Cratered moon with a soft halo and limb shading.
function moon(P, x, y, r, hex) {
  const { ctx, rand } = P;
  ctx.globalCompositeOperation = 'lighter';
  blob(P, x, y, r * 2.8, r * 2.8, hex, 1, 0.22);
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = css(hex, 1, 0.97);
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  for (let i = 0; i < 6; i++) {
    const a = rand() * Math.PI * 2;
    const rr = rand() * r * 0.62;
    ctx.fillStyle = css(hex, 0.74 + rand() * 0.1, 0.6);
    ctx.beginPath();
    ctx.arc(x + Math.cos(a) * rr, y + Math.sin(a) * rr, r * (0.07 + rand() * 0.12), 0, Math.PI * 2);
    ctx.fill();
  }
  const g = ctx.createRadialGradient(x - r * 0.4, y - r * 0.35, r * 0.2, x, y, r);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(20,40,55,0.28)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

// Bright cloud break with tapered light shafts fanning down to the horizon.
function godRays(P, { x, y, hex }) {
  const { ctx, HZ, rand } = P;
  ctx.globalCompositeOperation = 'lighter';
  blob(P, x, y, 46, 26, hex, 1, 0.32);
  blob(P, x, y, 20, 12, '#ffffff', 1, 0.3);
  for (let i = 0; i < 5; i++) {
    const ang = Math.PI / 2 + (i - 2) * 0.17 + (rand() - 0.5) * 0.05;
    const len = (HZ - y) * (0.85 + rand() * 0.35);
    const tx = x + Math.cos(ang) * len;
    const ty = y + Math.sin(ang) * len;
    const w1 = 9 + rand() * 12;
    const g = ctx.createLinearGradient(x, y, tx, ty);
    g.addColorStop(0, css(hex, 1, 0.14 + rand() * 0.06));
    g.addColorStop(1, css(hex, 1, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(x - 2.5, y);
    ctx.lineTo(x + 2.5, y);
    ctx.lineTo(tx + w1, ty);
    ctx.lineTo(tx - w1, ty);
    ctx.closePath();
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
}

// City silhouette row with lit windows and rooftop clutter (antennas,
// water tanks, penthouses). Handles the wrap seam like the old painter.
function cityRow(P, { maxH = 32, minH = 6, density = 0.35, darkAmt = 0.78, base = 0, roof = true } = {}) {
  const { ctx, S, HZ, rand, bottom, accent } = P;
  const fill = css(bottom, 1, 1, '#000000', darkAmt);
  const winColors = ['#ffd9a0', '#ffeecb', '#bfe3ff', accent];
  let x = 0;
  while (x < S) {
    const bw = 9 + rand() * 20;
    const bh = minH + rand() * rand() * (maxH - minH);
    const yTop = HZ - base - bh;
    const wrapped = x + bw > S;
    const rect = (rx, ry, rw2, rh2) => {
      ctx.fillRect(rx, ry, rw2, rh2);
      if (wrapped) ctx.fillRect(rx - S, ry, rw2, rh2);
    };
    ctx.fillStyle = fill;
    rect(x, yTop, bw, bh + base + 2);
    if (roof) {
      const detail = rand();
      if (detail > 0.74) {
        const ah = 5 + rand() * 5;
        rect(x + bw * 0.5 - 0.8, yTop - ah, 1.6, ah + 1);
      } else if (detail > 0.52) {
        rect(x + bw * (0.15 + rand() * 0.5), yTop - 3.2, 4, 4); // water tank
      } else if (detail > 0.34) {
        rect(x + bw * 0.24, yTop - 3, bw * 0.5, 3.5); // penthouse setback
      }
    }
    for (let wy = yTop + 3; wy < HZ - 2; wy += 4) {
      for (let wx = x + 2; wx < x + bw - 2; wx += 3.6) {
        if (rand() < density) {
          ctx.fillStyle = css(winColors[Math.floor(rand() * winColors.length)], 0.8 + rand() * 0.5, 0.5 + rand() * 0.45);
          rect(wx, wy, 1.7, 2.1);
        }
      }
    }
    x += bw;
  }
}

// Fernsehturm-style TV tower: tapered shaft, sphere with a lit window
// band, antenna spike and a glowing red aviation tip.
function tvTower(P, x, h) {
  const { ctx, HZ, bottom } = P;
  const fill = css(bottom, 1, 1, '#000000', 0.82);
  const baseY = HZ + 2;
  const sy = baseY - h * 0.68;
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(x - 3.2, baseY);
  ctx.lineTo(x - 1.2, sy);
  ctx.lineTo(x + 1.2, sy);
  ctx.lineTo(x + 3.2, baseY);
  ctx.closePath();
  ctx.fill();
  const r = h * 0.075;
  const cy = sy - r * 0.5;
  ctx.beginPath();
  ctx.arc(x, cy, r, 0, Math.PI * 2);
  ctx.fill();
  const aTop = baseY - h;
  ctx.fillRect(x - 0.7, aTop, 1.4, cy - r - aTop + 1);
  ctx.fillStyle = 'rgba(255,220,170,0.5)';
  ctx.fillRect(x - r * 0.85, cy - 1, r * 1.7, 1.7);
  ctx.fillStyle = 'rgba(255,84,64,0.95)';
  ctx.beginPath();
  ctx.arc(x, aTop + 1, 1.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalCompositeOperation = 'lighter';
  blob(P, x, aTop + 1, 5, 5, '#ff5040', 1, 0.4);
  ctx.globalCompositeOperation = 'source-over';
}

// Simple church tower + steeple silhouette.
function spire(P, x, h) {
  const { ctx, HZ, bottom } = P;
  ctx.fillStyle = css(bottom, 1, 1, '#000000', 0.8);
  ctx.fillRect(x - 4, HZ - h * 0.55, 8, h * 0.55 + 2);
  ctx.beginPath();
  ctx.moveTo(x - 4.5, HZ - h * 0.52);
  ctx.lineTo(x, HZ - h);
  ctx.lineTo(x + 4.5, HZ - h * 0.52);
  ctx.closePath();
  ctx.fill();
}

// Tapered industrial chimney with a crown and red beacon.
function chimneys(P, n) {
  const { ctx, S, HZ, rand, bottom } = P;
  for (let i = 0; i < n; i++) {
    const x = S * (0.05 + rand() * 0.9);
    const h = 42 + rand() * 26;
    const cw = 5 + rand() * 3;
    ctx.fillStyle = css(bottom, 1, 1, '#000000', 0.86);
    ctx.beginPath();
    ctx.moveTo(x - cw, HZ + 2);
    ctx.lineTo(x - cw * 0.55, HZ - h);
    ctx.lineTo(x + cw * 0.55, HZ - h);
    ctx.lineTo(x + cw, HZ + 2);
    ctx.closePath();
    ctx.fill();
    ctx.fillRect(x - cw * 0.75, HZ - h - 2.5, cw * 1.5, 3);
    ctx.fillStyle = 'rgba(255,80,60,0.9)';
    ctx.fillRect(x - 1, HZ - h - 4.5, 2, 2);
  }
}

// Broken building stumps: adjacent slices of differing heights read as
// collapsed floors; some keep a small fire-lit window.
function ruinStubs(P, n = 9) {
  const { ctx, S, HZ, rand, bottom } = P;
  const fill = css(bottom, 1, 1, '#000000', 0.74);
  for (let i = 0; i < n; i++) {
    const x = rand() * S;
    const bw = 8 + rand() * 14;
    const bh = 8 + rand() * 16;
    const slices = 2 + Math.floor(rand() * 3);
    let sx2 = x;
    ctx.fillStyle = fill;
    for (let s2 = 0; s2 < slices; s2++) {
      const sw = bw / slices;
      const sh = bh * (0.35 + rand() * 0.65);
      ctx.fillRect(sx2 % S, HZ - sh, sw + 0.5, sh + 2);
      sx2 += sw;
    }
    if (rand() < 0.4) {
      ctx.fillStyle = 'rgba(255,140,70,0.55)';
      ctx.fillRect((x + rand() * bw) % S, HZ - 2 - rand() * bh * 0.35, 1.8, 1.8);
    }
  }
}

// Billowing smoke column rising from the horizon, widening as it climbs.
function smoke(P, x, h, hex = '#221a14') {
  const { S, HZ, rand } = P;
  let px = ((x % S) + S) % S;
  let r = 4.5 + rand() * 2.5;
  const drift = (rand() - 0.5) * 1.6;
  for (let y = HZ + 1; y > HZ - h; y -= r * 0.7) {
    const prog = (HZ - y) / h;
    blob(P, px, y, r, r * 0.92, hex, 1, 0.4 * (1 - prog * 0.7));
    px = ((px + drift + (rand() - 0.5) * 3) % S + S) % S;
    r *= 1.13;
  }
}

// Jagged mountain ridge; the random walk is closed so the seam matches.
// `snow` strokes a faint light line along the crest.
function ridge(P, { amp, darkAmt, step = 16, snow = 0 }) {
  const { ctx, S, HZ, rand, bottom } = P;
  const N = Math.ceil(S / step);
  const ys = [];
  let y = HZ - rand() * amp;
  for (let i = 0; i <= N; i++) {
    ys.push(y);
    y = Math.min(HZ - 1, Math.max(HZ - amp, y + (rand() - 0.5) * amp * 0.8));
  }
  const err = ys[N] - ys[0];
  for (let i = 0; i <= N; i++) ys[i] = Math.min(HZ - 1, ys[i] - (err * i) / N);
  ctx.fillStyle = css(bottom, 1, 1, '#000000', darkAmt);
  ctx.beginPath();
  ctx.moveTo(0, HZ + 2);
  for (let i = 0; i <= N; i++) ctx.lineTo(i * step, ys[i]);
  ctx.lineTo(S, HZ + 2);
  ctx.closePath();
  ctx.fill();
  if (snow) {
    ctx.strokeStyle = `rgba(235,248,255,${snow})`;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(0, ys[0] - 0.5);
    for (let i = 1; i <= N; i++) ctx.lineTo(i * step, ys[i] - 0.5);
    ctx.stroke();
  }
}

// Smooth dune line from integer-frequency sines (seam-continuous).
function dunes(P, { amp, darkAmt, mul = 1 }) {
  const { ctx, S, HZ, rand, bottom } = P;
  const f1 = 2 + Math.floor(rand() * 2);
  const f2 = 5 + Math.floor(rand() * 3);
  const p1 = rand() * Math.PI * 2;
  const p2 = rand() * Math.PI * 2;
  ctx.fillStyle = css(bottom, mul, 1, '#000000', darkAmt);
  ctx.beginPath();
  ctx.moveTo(0, HZ + 2);
  for (let x = 0; x <= S; x += 4) {
    const t = (x / S) * Math.PI * 2;
    const e = 0.5 + 0.5 * Math.sin(t * f1 + p1);
    const e2 = 0.5 + 0.5 * Math.sin(t * f2 + p2);
    ctx.lineTo(x, HZ - amp * (0.18 + 0.55 * e + 0.27 * e2));
  }
  ctx.lineTo(S, HZ + 2);
  ctx.closePath();
  ctx.fill();
}

// Tiny distant birds: two wing arcs per speck.
function birds(P, { n, x0, x1, y0, y1 }) {
  const { ctx, rand } = P;
  ctx.strokeStyle = 'rgba(30,22,16,0.8)';
  ctx.lineWidth = 1.1;
  for (let i = 0; i < n; i++) {
    const x = x0 + rand() * (x1 - x0);
    const y = y0 + rand() * (y1 - y0);
    const s2 = 1.3 + rand() * 2;
    ctx.beginPath();
    ctx.moveTo(x - s2, y);
    ctx.quadraticCurveTo(x - s2 * 0.35, y - s2 * 0.9, x, y);
    ctx.quadraticCurveTo(x + s2 * 0.35, y - s2 * 0.9, x + s2, y);
    ctx.stroke();
  }
}

// Below-horizon reflection streaks: depth-biased toward the horizon, plus
// an optional glitter column under a sun/moon.
function reflections(P, { colors, n = 28, maxDepth = 50, column = null }) {
  const { ctx, S, HZ, rand } = P;
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < n; i++) {
    const depth = rand() * rand();
    const y = HZ + 3 + depth * maxDepth;
    const len = (10 + rand() * 30) * (1 - depth * 0.55);
    const hex = colors[Math.floor(rand() * colors.length)];
    ctx.fillStyle = css(hex, 1, (0.05 + rand() * 0.08) * (1 - depth * 0.5), '#ffffff', 0.35);
    ctx.fillRect(rand() * S - len / 2, y, len, 1 + (1 - depth) * 0.8);
  }
  if (column) {
    for (let i = 0; i < 15; i++) {
      const dy = 3 + rand() * maxDepth;
      const spread = 2 + dy * 0.45;
      const len = 5 + rand() * 13;
      ctx.fillStyle = css(column.hex, 1, 0.1 + rand() * 0.12);
      ctx.fillRect(column.x + (rand() - 0.5) * spread * 2 - len / 2, HZ + dy, len, 1.3);
    }
  }
  ctx.globalCompositeOperation = 'source-over';
}

// --------------------------------------------------- signature painters

function paintSpree(P) {
  const { S, HZ, rand, top, accent } = P;
  baseSky(P, { warm: '#d8895c', warmAmt: 0.3 });
  stars(P, { count: 70, bright: 2, maxY: 0.72 });
  // layered overcast: high veil, mid slate banks, low banks lit by the city
  cloudBank(P, { y: HZ * 0.2, w: 300, h: 26, hex: top, mul: 1.5, alpha: 0.16 });
  cloudBank(P, { y: HZ * 0.32, w: 340, h: 34, hex: top, mul: 0.62, alpha: 0.3 });
  cloudBank(P, { y: HZ * 0.5, w: 320, h: 40, hex: top, mul: 0.5, alpha: 0.34, lit: '#e89a5e', litAlpha: 0.1 });
  cloudBank(P, { y: HZ * 0.62, w: 360, h: 36, hex: top, mul: 0.44, alpha: 0.36, lit: '#e89a5e', litAlpha: 0.12 });
  cloudBank(P, { y: HZ * 0.78, w: 380, h: 30, hex: top, mul: 0.4, alpha: 0.3, lit: '#e8a066', litAlpha: 0.16 });
  horizonGlow(P, accent, 0.3);
  horizonGlow(P, '#e89a5e', 0.16, 40, 24);
  cityRow(P, { maxH: 30, density: 0.4 });
  tvTower(P, S * (0.3 + rand() * 0.4), 78);
  spire(P, S * (0.05 + rand() * 0.18), 36);
  reflections(P, { colors: [accent, '#e8a066'], n: 34, maxDepth: 52 });
}

function paintSand(P) {
  const { ctx, S, HZ, rand } = P;
  baseSky(P, { warm: '#ffb46a', warmAmt: 0.42, horizon: 1.12 });
  stars(P, { count: 26, bright: 1, maxY: 0.5 });
  // drifting dust-haze patches above the horizon (scattered, not banded —
  // continuous bands would ring around the zenith once equirect-mapped)
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 3; i++) {
    const y = HZ * (0.62 + i * 0.12);
    for (let x = 0; x < S; x += 46) {
      if (rand() < 0.25) continue;
      blob(P, x + rand() * 46, y + (rand() - 0.5) * 22, 55 + rand() * 40, 6 + rand() * 6, '#e8b478', 1, 0.04 + rand() * 0.03);
    }
  }
  ctx.globalCompositeOperation = 'source-over';
  const sunX = S * (0.28 + rand() * 0.44);
  sunDisc(P, { x: sunX, y: HZ - 26, r: 44, color: '#ffc476', hot: '#fff6e2', hotStop: 0.3, halo: 3, haloAlpha: 0.45 });
  horizonGlow(P, '#ffb46a', 0.42);
  birds(P, { n: 9, x0: sunX - 100, x1: sunX + 100, y0: HZ - 105, y1: HZ - 30 });
  dunes(P, { amp: 26, darkAmt: 0.3, mul: 0.9 });
  dunes(P, { amp: 14, darkAmt: 0.52, mul: 0.8 });
  reflections(P, { colors: ['#ffd9a0', '#ffb46a'], n: 20, maxDepth: 40, column: { x: sunX, hex: '#ffd9a0' } });
}

function paintNeon(P) {
  const { ctx, S, HZ, rand, accent } = P;
  baseSky(P, { zenith: 0.8 });
  aurora(P, { colors: [accent, '#7d5cff', '#3fd2ff'], bands: 4, len: 96 });
  stars(P, { count: 210, bright: 6, tint: '224,160,255' });
  // light-pollution domes over the city
  ctx.globalCompositeOperation = 'lighter';
  const domeColors = [accent, '#ff8a3f', '#3fd2ff', accent];
  for (let i = 0; i < 4; i++) {
    blob(P, rand() * S, HZ - 4, 70 + rand() * 60, 34 + rand() * 22, domeColors[i], 1, 0.1 + rand() * 0.07);
  }
  ctx.globalCompositeOperation = 'source-over';
  horizonGlow(P, accent, 0.55);
  cityRow(P, { maxH: 40, minH: 12, density: 0.55, darkAmt: 0.55, base: 4, roof: false }); // far hazy row
  cityRow(P, { maxH: 26, minH: 6, density: 0.72, darkAmt: 0.84 }); // near dark row
  reflections(P, { colors: [accent, '#3fd2ff', '#ffd9a0'], n: 46, maxDepth: 58 });
}

function paintIce(P) {
  const { S, HZ, rand, accent } = P;
  baseSky(P, { zenith: 0.75 });
  stars(P, { count: 260, bright: 9, sharp: true, tint: '170,255,225' });
  aurora(P, { colors: ['#41f0a0', '#2fe8cd', '#7fe0ff'], bands: 3, len: 120 });
  const mx = S * (0.2 + rand() * 0.35);
  const my = HZ * (0.26 + rand() * 0.1);
  moon(P, mx, my, 21, '#eafcff');
  moon(P, mx + 58 + rand() * 30, my + (rand() - 0.5) * 46, 8.5, '#cfe2e8');
  horizonGlow(P, accent, 0.28);
  ridge(P, { amp: 40, darkAmt: 0.42, step: 12, snow: 0.4 });
  ridge(P, { amp: 22, darkAmt: 0.66, step: 10, snow: 0.22 });
  reflections(P, { colors: ['#7fe0ff', '#41f0a0'], n: 26, maxDepth: 48, column: { x: mx, hex: '#eafcff' } });
}

function paintRuins(P) {
  const { ctx, S, HZ, rand, top } = P;
  baseSky(P, { warm: '#c97a3e', warmAmt: 0.28 });
  stars(P, { count: 46, bright: 2, maxY: 0.62 });
  sunDisc(P, { x: S * (0.55 + rand() * 0.3), y: HZ - 42, r: 24, color: '#ffa050', hot: '#ffd9a0', halo: 2.0, haloAlpha: 0.2, bodyAlpha: 0.66 });
  // ember-tinted cloud banks (fires below light the undersides)
  cloudBank(P, { y: HZ * 0.4, w: 320, h: 34, hex: top, mul: 0.5, alpha: 0.34, lit: '#ff8a4a', litAlpha: 0.12 });
  cloudBank(P, { y: HZ * 0.58, w: 340, h: 38, hex: top, mul: 0.42, alpha: 0.38, lit: '#ff8a4a', litAlpha: 0.16 });
  cloudBank(P, { y: HZ * 0.74, w: 360, h: 30, hex: top, mul: 0.38, alpha: 0.32, lit: '#ff7a30', litAlpha: 0.18 });
  horizonGlow(P, '#ff9a5a', 0.32);
  ridge(P, { amp: 26, darkAmt: 0.5, step: 14 });
  ruinStubs(P);
  // smoke columns with fire glow at their bases
  for (let i = 0; i < 4; i++) {
    const sx2 = rand() * S;
    ctx.globalCompositeOperation = 'lighter';
    blob(P, sx2, HZ - 1, 16, 7, '#ff7a30', 1, 0.4);
    ctx.globalCompositeOperation = 'source-over';
    smoke(P, sx2, 90 + rand() * 60);
  }
  // drifting embers near the horizon
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 26; i++) {
    ctx.fillStyle = css('#ffb46a', 1, 0.25 + rand() * 0.5);
    ctx.fillRect(rand() * S, HZ - 4 - rand() * 46, 1.1, 1.1);
  }
  ctx.globalCompositeOperation = 'source-over';
  reflections(P, { colors: ['#ff9a5a', '#ffb46a'], n: 18, maxDepth: 42 });
}

function paintToxic(P) {
  const { ctx, S, HZ, rand, top, accent } = P;
  baseSky(P);
  stars(P, { count: 22, bright: 0, maxY: 0.4 });
  strata(P, { layers: 5, hex: top, litHex: '#c8e87a' });
  godRays(P, { x: S * (0.3 + rand() * 0.4), y: HZ * 0.34, hex: '#e8f0c8' });
  horizonGlow(P, accent, 0.28);
  // faint industrial glow domes on the horizon
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 2; i++) {
    blob(P, rand() * S, HZ - 3, 55 + rand() * 40, 22 + rand() * 12, accent, 1, 0.09);
  }
  ctx.globalCompositeOperation = 'source-over';
  ridge(P, { amp: 24, darkAmt: 0.5, step: 16 });
  ridge(P, { amp: 13, darkAmt: 0.72, step: 12 });
  reflections(P, { colors: [accent], n: 16, maxDepth: 40 });
}

function paintCrimson(P) {
  const { ctx, S, HZ, rand, top, accent } = P;
  baseSky(P, { zenith: 0.7, warm: '#ff5a4a', warmAmt: 0.2 });
  stars(P, { count: 100, bright: 4, tint: '255,150,140' });
  const sx2 = S * (0.3 + rand() * 0.4);
  const sy2 = HZ - 58;
  sunDisc(P, { x: sx2, y: sy2, r: 78, color: '#ff5240', hot: '#ffc9a8', hotStop: 0.16, halo: 2.4, haloAlpha: 0.5 });
  // banded stratus slicing across the giant disc — kept low (across the
  // disc itself) and faded out sideways so nothing rings around the zenith
  for (let i = 0; i < 6; i++) {
    const by = sy2 - 28 + rand() * 92;
    const bh = 2 + rand() * rand() * 6;
    const bw = 90 + rand() * 40;
    const g = ctx.createLinearGradient(sx2 - bw, 0, sx2 + bw, 0);
    const mid = css(top, 0.75, 0.4 + rand() * 0.28);
    g.addColorStop(0, css(top, 0.75, 0));
    g.addColorStop(0.3, mid);
    g.addColorStop(0.7, mid);
    g.addColorStop(1, css(top, 0.75, 0));
    ctx.fillStyle = g;
    ctx.fillRect(sx2 - bw, by, bw * 2, bh);
  }
  horizonGlow(P, accent, 0.46);
  cityRow(P, { maxH: 30, density: 0.24, darkAmt: 0.84 });
  chimneys(P, 3);
  reflections(P, { colors: [accent, '#ffb46a'], n: 30, maxDepth: 52, column: { x: sx2, hex: '#ff8a70' } });
}

const PAINTERS = {
  Spree: paintSpree,
  Sand: paintSand,
  Neon: paintNeon,
  Ice: paintIce,
  Ruins: paintRuins,
  Toxic: paintToxic,
  Crimson: paintCrimson,
};
