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
// textures are cached as LIVE THREE.CanvasTexture instances and reused
// across matches — clearScene() never disposes scene.background /
// scene.environment, and reuse keeps the PMREM env cached. NEVER
// dispose a sky texture. (Surface textures in engine/textures.js are
// the opposite: fresh wrappers per call, disposed every match.)
//
// This module owns the sky half of the theme table (per-palette sky
// options). WARNING: the option-object property ORDER is part of the
// texture cache key AND the RNG seed (JSON.stringify) — reordering keys
// changes star/cloud placement. Keep literals verbatim.
// =====================================================================

// Sky identity per palette (keyed by util.paletteKey). `environment`
// mirrors "envMapIntensity >= 0.6" from the materials table.
const SKIES = {
  Spree: {
    sky: { horizon: 'city', windows: 0.4, stars: 110, clouds: 5, reflect: true, glow: 0.3 },
    environment: false,
  },
  Sand: {
    sky: { horizon: 'ridge', stars: 45, clouds: 4, disc: '#ffd9a0', discSize: 0.06, glow: 0.5 },
    environment: false,
  },
  Neon: {
    sky: { horizon: 'city', windows: 0.6, stars: 170, reflect: true, glow: 0.5 },
    environment: true,
  },
  Ice: {
    sky: { horizon: 'ridge', stars: 150, clouds: 3, disc: '#eafcff', discSize: 0.045, glow: 0.3 },
    environment: true,
  },
  Ruins: {
    sky: { horizon: 'ridge', stars: 60, clouds: 6, disc: '#ffb46a', discSize: 0.07, glow: 0.5 },
    environment: false,
  },
  Toxic: {
    sky: { horizon: 'ridge', stars: 50, clouds: 7, glow: 0.38 },
    environment: false,
  },
  Crimson: {
    sky: { horizon: 'city', windows: 0.28, stars: 90, disc: '#ff6a5a', discSize: 0.08, glow: 0.45 },
    environment: true,
  },
};

export function applySky(scene, map) {
  const pal = map.palette;
  const theme = SKIES[paletteKey(pal)];
  const sky = skyTexture(pal.skyTop, pal.skyBottom, { ...theme.sky, accent: pal.accent });
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

// Equirect sky: gradient + horizon glow + stars + optional celestial disc,
// clouds and a horizon silhouette ('city' | 'ridge'). Returns a CACHED
// texture instance — safe because scene.background/scene.environment are
// never disposed by clearScene(), and reuse keeps the PMREM env cached.
export function skyTexture(top = '#12203a', bottom = '#2a3d63', opts = {}) {
  const key = `sky:${top}:${bottom}:${JSON.stringify(opts)}`;
  if (skyCache.has(key)) return skyCache.get(key);

  const S = 512;
  const HZ = S / 2; // horizon row
  const c = makeCanvas(S);
  const ctx = c.getContext('2d');
  const rand = mulberry32(hashStr(key));
  const accent = opts.accent ?? bottom;

  // upper sky: zenith -> horizon
  let g = ctx.createLinearGradient(0, 0, 0, HZ);
  g.addColorStop(0, css(top, 0.9));
  g.addColorStop(0.62, css(top, 1, 1, bottom, 0.55));
  g.addColorStop(1, css(bottom, 1.06));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, HZ + 1);
  // lower sky (below horizon, seen above walls at distance)
  g = ctx.createLinearGradient(0, HZ, 0, S);
  g.addColorStop(0, css(bottom, 0.92));
  g.addColorStop(0.35, css(bottom, 0.45));
  g.addColorStop(1, css(bottom, 0.16));
  ctx.fillStyle = g;
  ctx.fillRect(0, HZ, S, S - HZ);

  // horizon glow band
  const glowA = opts.glow ?? 0.32;
  ctx.globalCompositeOperation = 'lighter';
  g = ctx.createLinearGradient(0, HZ - 52, 0, HZ + 30);
  g.addColorStop(0, css(accent, 1, 0));
  g.addColorStop(0.62, css(accent, 1, glowA * 0.85, '#ffffff', 0.25));
  g.addColorStop(1, css(accent, 1, 0));
  ctx.fillStyle = g;
  ctx.fillRect(0, HZ - 52, S, 82);
  ctx.globalCompositeOperation = 'source-over';

  // celestial disc (sun / moon)
  if (opts.disc) {
    const dx = S * (0.15 + rand() * 0.7);
    const dy = S * (0.22 + rand() * 0.14);
    const dr = S * (opts.discSize ?? 0.05);
    ctx.globalCompositeOperation = 'lighter';
    g = ctx.createRadialGradient(dx, dy, 0, dx, dy, dr * 3);
    g.addColorStop(0, css(opts.disc, 1, 0.95));
    g.addColorStop(0.25, css(opts.disc, 1, 0.5));
    g.addColorStop(1, css(opts.disc, 1, 0));
    ctx.fillStyle = g;
    ctx.fillRect(dx - dr * 3, dy - dr * 3, dr * 6, dr * 6);
    ctx.globalCompositeOperation = 'source-over';
  }

  // stars (upper sky only)
  const starN = opts.stars ?? 130;
  for (let i = 0; i < starN; i++) {
    const y = rand() * HZ * 0.92;
    const fade = 1 - y / (HZ * 0.95); // fewer near horizon
    const a = rand() * rand() * 0.85 * (0.35 + 0.65 * (1 - fade * 0.4));
    ctx.fillStyle = `rgba(255,255,255,${(a * (0.3 + fade)).toFixed(3)})`;
    const r = 0.4 + rand() * 1.2;
    ctx.beginPath();
    ctx.arc(rand() * S, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  // a few bright stars with halo
  for (let i = 0; i < Math.min(8, starN / 12); i++) {
    const x = rand() * S; const y = rand() * HZ * 0.6;
    g = ctx.createRadialGradient(x, y, 0, x, y, 5);
    g.addColorStop(0, 'rgba(255,255,255,0.9)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - 5, y - 5, 10, 10);
  }

  // clouds
  if (opts.clouds) {
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < opts.clouds; i++) {
      const x = rand() * S; const y = HZ * (0.3 + rand() * 0.55);
      const rw = 40 + rand() * 90; const rh = 6 + rand() * 12;
      g = ctx.createRadialGradient(x, y, 0, x, y, rw);
      g.addColorStop(0, `rgba(255,255,255,${0.05 + rand() * 0.06})`);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(1, rh / rw);
      ctx.translate(-x, -y);
      ctx.fillRect(x - rw, y - rw, rw * 2, rw * 2);
      ctx.restore();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  // horizon silhouette
  if (opts.horizon === 'city') {
    const winDensity = opts.windows ?? 0.3;
    const fill = css(bottom, 1, 1, '#000000', 0.78);
    let x = 0;
    while (x < S) {
      const bw = 10 + rand() * 22;
      const bh = 6 + rand() * rand() * 30;
      ctx.fillStyle = fill;
      ctx.fillRect(x, HZ - bh, bw, bh + 2);
      if (x + bw > S) ctx.fillRect(x - S, HZ - bh, bw, bh + 2); // wrap seam
      // antenna on some
      if (rand() > 0.7) ctx.fillRect(x + bw / 2, HZ - bh - 6, 1.5, 6);
      // windows
      for (let wy = HZ - bh + 3; wy < HZ - 2; wy += 4) {
        for (let wx = x + 2; wx < x + bw - 2; wx += 4) {
          if (rand() < winDensity) {
            ctx.fillStyle = css(rand() > 0.6 ? accent : '#ffd9a0', 1, 0.5 + rand() * 0.4);
            ctx.fillRect(wx % S, wy, 1.6, 1.6);
          }
        }
      }
      x += bw;
    }
  } else if (opts.horizon === 'ridge') {
    for (const [amp, dark] of [[30, 0.55], [16, 0.75]]) {
      ctx.fillStyle = css(bottom, 1, 1, '#000000', dark);
      ctx.beginPath();
      ctx.moveTo(0, HZ + 2);
      let y = HZ - rand() * amp;
      for (let px = 0; px <= S; px += 16) {
        y = Math.min(HZ - 1, Math.max(HZ - amp, y + (rand() - 0.5) * amp * 0.8));
        ctx.lineTo(px, y);
      }
      ctx.lineTo(S, HZ + 2);
      ctx.closePath();
      ctx.fill();
    }
  }

  // faint water/ground reflection streaks below horizon
  if (opts.reflect) {
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 26; i++) {
      const x = rand() * S; const y = HZ + 4 + rand() * 44;
      ctx.fillStyle = css(accent, 1, 0.04 + rand() * 0.07, '#ffffff', 0.4);
      ctx.fillRect(x, y, 6 + rand() * 26, 1.2);
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.mapping = THREE.EquirectangularReflectionMapping;
  skyCache.set(key, tex);
  return tex;
}
