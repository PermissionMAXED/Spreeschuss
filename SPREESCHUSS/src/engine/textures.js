import * as THREE from 'three';

// =====================================================================
// Procedural canvas textures — the game ships with NO external assets.
//
// Caching strategy (important for clearScene() compatibility):
//  - Canvases are cached CPU-side and painted only once per unique key.
//  - Every call returns a FRESH THREE.CanvasTexture wrapping the cached
//    canvas, because clearScene() disposes every texture found on scene
//    materials between matches. A disposed clone never poisons the cache.
//  - Sky textures are the one exception (live cached instances, never
//    disposed) — they live in src/maps/build/sky.js.
// All canvases are <= 512px.
//
// surfaceTexture() returns { map, emissiveMap|null, bumpMap|null }:
//  - map          sRGB color canvas.
//  - emissiveMap  aligned emissive companion (neon / accent kinds).
//    Emissive discipline: the bloom threshold is 0.9 (renderer.js), so
//    emissive canvases keep bright content to tight strips/dots — the
//    soft halo around a glow line lives on the COLOR canvas only.
//  - bumpMap      grayscale height companion (linear color space),
//    painted in the same pass as the color canvas so seams, bricks and
//    cracks stay pixel-aligned. Consumed only by maps/build/materials.js
//    (additive, non-breaking field).
// =====================================================================

const canvasCache = new Map(); // key -> { color:canvas, emissive:canvas|null, bump:canvas|null }

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

// blend two hex colors in linear space, back to an sRGB hex string
function blend(a, b, t) {
  const c = new THREE.Color(a).lerp(new THREE.Color(b), t);
  return `#${c.getHexString()}`;
}

const gray = (v, a = 1) => `rgba(${v | 0},${v | 0},${v | 0},${a})`;

function texFromCanvas(c, { wrap = true, srgb: toSrgb = true, aniso = 4 } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (wrap) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (toSrgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso; // renderer clamps to hardware max
  return t;
}

// ------------------------------------------------------------ noise fields

// Tiling multi-octave value noise in ~[-1,1]. Coarse random grids are
// bilinearly sampled with wrapped indices so the field repeats seamlessly.
function noiseField(S, rand, octaves = 4) {
  const field = new Float32Array(S * S);
  let amp = 1;
  let total = 0;
  for (let o = 0; o < octaves; o++) {
    const res = 4 << o;
    const grid = new Float32Array(res * res);
    for (let i = 0; i < grid.length; i++) grid[i] = rand() * 2 - 1;
    const inv = res / S;
    for (let y = 0; y < S; y++) {
      const gy = y * inv;
      const y0 = gy | 0;
      const fy = gy - y0;
      const sy = fy * fy * (3 - 2 * fy);
      const r0 = y0 * res;
      const r1 = ((y0 + 1) % res) * res;
      for (let x = 0; x < S; x++) {
        const gx = x * inv;
        const x0 = gx | 0;
        const fx = gx - x0;
        const sx = fx * fx * (3 - 2 * fx);
        const x1 = (x0 + 1) % res;
        const a = grid[r0 + x0];
        const b = grid[r0 + x1];
        const cv = grid[r1 + x0];
        const dv = grid[r1 + x1];
        field[y * S + x] += amp * ((a + (b - a) * sx) * (1 - sy) + (cv + (dv - cv) * sx) * sy);
      }
    }
    total += amp;
    amp *= 0.55;
  }
  const norm = 1 / total;
  for (let i = 0; i < field.length; i++) field[i] *= norm;
  return field;
}

// Base coat: low-frequency brightness variation + a second low-frequency
// color-TEMPERATURE field (subtle warm/cool drift along `axis`) + fine grain.
// Returns the brightness field so bump painting can reuse it (keeps large
// tonal shapes and large height shapes aligned).
function shade(ctx, S, hex, rand, { grain = 14, amp = 14, temp = 8, axis = [1, 0.3, -1], octaves = 4 } = {}) {
  const base = srgb(hex);
  const fB = noiseField(S, rand, octaves);
  const fT = noiseField(S, rand, 3);
  const img = ctx.createImageData(S, S);
  const d = img.data;
  for (let i = 0, p = 0; i < S * S; i++, p += 4) {
    const b = fB[i] * amp;
    const t = fT[i] * temp;
    const n = (rand() - 0.5) * grain;
    d[p] = c255(base[0] + b + n + t * axis[0]);
    d[p + 1] = c255(base[1] + b + n + t * axis[1]);
    d[p + 2] = c255(base[2] + b + n + t * axis[2]);
    d[p + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return fB;
}

// Grayscale bump base built from a field (usually the one shade() returned).
function bumpFromField(bctx, S, field, mid = 128, amp = 18, rand = null, grain = 0) {
  const img = bctx.createImageData(S, S);
  const d = img.data;
  for (let i = 0, p = 0; i < S * S; i++, p += 4) {
    const g = c255(mid + field[i] * amp + (grain && rand ? (rand() - 0.5) * grain : 0));
    d[p] = g;
    d[p + 1] = g;
    d[p + 2] = g;
    d[p + 3] = 255;
  }
  bctx.putImageData(img, 0, 0);
}

// ---------------------------------------------------------- paint helpers

// Per-panel ambient-occlusion vignette with a consistent TOP-LIGHT model:
// upper edge catches light (`top`), lower edge falls into shadow (`bottom`).
function panelShade(ctx, x, y, w, h, { ao = 0.2, inset = 0.16, top = 0, bottom = 0 } = {}) {
  const ix = Math.max(3, w * inset);
  const iy = Math.max(3, h * inset);
  let g = ctx.createLinearGradient(x, y, x + ix, y);
  g.addColorStop(0, `rgba(0,0,0,${ao})`);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(x, y, ix, h);
  g = ctx.createLinearGradient(x + w, y, x + w - ix, y);
  g.addColorStop(0, `rgba(0,0,0,${ao})`);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(x + w - ix, y, ix, h);
  g = ctx.createLinearGradient(0, y, 0, y + iy);
  g.addColorStop(0, `rgba(0,0,0,${ao * 0.7})`);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, iy);
  g = ctx.createLinearGradient(0, y + h, 0, y + h - iy);
  g.addColorStop(0, `rgba(0,0,0,${ao})`);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(x, y + h - iy, w, iy);
  if (top) {
    const th = Math.max(2, h * 0.08);
    g = ctx.createLinearGradient(0, y, 0, y + th);
    g.addColorStop(0, `rgba(255,255,255,${top})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, th);
  }
  if (bottom) {
    const bhh = Math.max(2, h * 0.12);
    g = ctx.createLinearGradient(0, y + h, 0, y + h - bhh);
    g.addColorStop(0, `rgba(0,0,0,${bottom})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x, y + h - bhh, w, bhh);
  }
}

// Soft radial stains; stamps near the border are re-drawn on the wrapped
// side so the texture keeps tiling cleanly.
function stains(ctx, S, rand, n, rgb, maxA = 0.14, maxR = 0.3) {
  for (let i = 0; i < n; i++) {
    const x = rand() * S;
    const y = rand() * S;
    const r = (0.08 + rand() * maxR) * S;
    const a = (0.35 + rand() * 0.65) * maxA;
    for (const ox of [-S, 0, S]) {
      for (const oy of [-S, 0, S]) {
        const cx = x + ox;
        const cy = y + oy;
        if (cx + r < 0 || cx - r > S || cy + r < 0 || cy - r > S) continue;
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        g.addColorStop(0, `rgba(${rgb},${a.toFixed(3)})`);
        g.addColorStop(1, `rgba(${rgb},0)`);
        ctx.fillStyle = g;
        ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
      }
    }
  }
}

// One vertical weather/rust streak fading downward.
function dripAt(ctx, x, y, w, len, rgb, a) {
  const g = ctx.createLinearGradient(0, y, 0, y + len);
  g.addColorStop(0, `rgba(${rgb},${a.toFixed(3)})`);
  g.addColorStop(1, `rgba(${rgb},0)`);
  ctx.fillStyle = g;
  ctx.fillRect(x - w / 2, y, w, len);
}

function drips(ctx, S, rand, n, rgb, maxA = 0.14) {
  for (let i = 0; i < n; i++) {
    dripAt(ctx, rand() * S, rand() * S * 0.6, 1.5 + rand() * 3, 40 + rand() * 100, rgb, (0.4 + rand() * 0.6) * maxA);
  }
}

// Jagged crack polyline (points only — callers stroke it on 1+ canvases so
// the color map and bump map stay aligned).
function crackPts(S, rand, x0, y0, ang0) {
  let x = x0;
  let y = y0;
  let ang = ang0;
  const pts = [[x, y]];
  const segs = 5 + Math.floor(rand() * 6);
  for (let i = 0; i < segs; i++) {
    ang += (rand() - 0.5) * 1.0;
    const len = S * (0.025 + rand() * 0.05);
    x += Math.cos(ang) * len;
    y += Math.sin(ang) * len;
    pts.push([x, y]);
  }
  return pts;
}

// Stroke a polyline with tapering width (cracks thin out toward the tip).
function strokeTaper(ctx, pts, style, w0, w1) {
  ctx.strokeStyle = style;
  ctx.lineCap = 'round';
  const nSeg = pts.length - 1;
  for (let i = 0; i < nSeg; i++) {
    ctx.lineWidth = Math.max(0.3, w0 + (w1 - w0) * (i / nSeg));
    ctx.beginPath();
    ctx.moveTo(pts[i][0], pts[i][1]);
    ctx.lineTo(pts[i + 1][0], pts[i + 1][1]);
    ctx.stroke();
  }
}

// n cracks with occasional branching; mirrored into the bump map as grooves.
function cracks(ctx, S, rand, n, style, w0 = 1.2, w1 = 0.35, bctx = null, bumpW = 2) {
  for (let i = 0; i < n; i++) {
    const main = crackPts(S, rand, rand() * S, rand() * S, rand() * Math.PI * 2);
    const paths = [main];
    if (rand() < 0.55) {
      const p = main[1 + Math.floor(rand() * (main.length - 2))];
      paths.push(crackPts(S, rand, p[0], p[1], rand() * Math.PI * 2));
    }
    for (const pts of paths) {
      strokeTaper(ctx, pts, style, w0, w1);
      if (bctx) strokeTaper(bctx, pts, gray(74, 0.75), bumpW, bumpW * 0.35);
    }
  }
}

// Irregular chip outline (relative points) — precomputed so a brick that is
// drawn twice for wrap-around tiling gets the identical chip.
function chipShape(rand, r) {
  const n = 6 + Math.floor(rand() * 4);
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rr = r * (0.55 + rand() * 0.6);
    pts.push([Math.cos(a) * rr, Math.sin(a) * rr]);
  }
  return pts;
}

// Chipped paint/plaster/stone: recessed fill, shadow on the upper inner rim
// and a light catch on the lower rim (consistent with the top-light model).
function drawChip(ctx, x, y, pts, fill, bctx = null, rim = 0.2) {
  const trace = (t) => {
    t.beginPath();
    t.moveTo(x + pts[0][0], y + pts[0][1]);
    for (let i = 1; i < pts.length; i++) t.lineTo(x + pts[i][0], y + pts[i][1]);
    t.closePath();
  };
  trace(ctx);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.save();
  trace(ctx);
  ctx.clip();
  const r = Math.max(...pts.map((p) => Math.hypot(p[0], p[1])));
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(x, y, r * 0.9, Math.PI * 1.02, Math.PI * 1.98);
  ctx.stroke();
  ctx.strokeStyle = `rgba(255,255,255,${rim})`;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, y, r * 0.9, Math.PI * 0.05, Math.PI * 0.95);
  ctx.stroke();
  ctx.restore();
  if (bctx) {
    trace(bctx);
    bctx.fillStyle = gray(66, 0.95);
    bctx.fill();
  }
}

// Raised rivet head: highlight up-top, shadowed underside (top light).
function rivet(ctx, x, y, r, bctx = null) {
  const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.45, r * 0.1, x, y, r);
  g.addColorStop(0, 'rgba(255,255,255,0.55)');
  g.addColorStop(0.55, 'rgba(160,166,178,0.25)');
  g.addColorStop(1, 'rgba(0,0,0,0.5)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  if (bctx) {
    bctx.fillStyle = gray(185, 0.95);
    bctx.beginPath();
    bctx.arc(x, y, r * 0.9, 0, Math.PI * 2);
    bctx.fill();
  }
}

// Recessed form-tie/bolt hole: dark cavity, lower rim catches the light.
function boltHole(ctx, x, y, r, bctx = null) {
  ctx.fillStyle = 'rgba(8,9,11,0.55)';
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.16)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(x, y, r, Math.PI * 0.1, Math.PI * 0.9);
  ctx.stroke();
  if (bctx) {
    bctx.fillStyle = gray(62, 0.95);
    bctx.beginPath();
    bctx.arc(x, y, r, 0, Math.PI * 2);
    bctx.fill();
  }
}

// Faded spray-paint tag (kept away from the borders so tiling is clean):
// bold throw-up strokes with a darker halo pass, like real buffed graffiti.
function graffiti(ctx, S, rand, colors) {
  const n = 1 + (rand() < 0.45 ? 1 : 0);
  for (let t = 0; t < n; t++) {
    const w = S * (0.15 + rand() * 0.14);
    const h = w * (0.3 + rand() * 0.25);
    const cx = w / 2 + 14 + rand() * (S - w - 28);
    const cy = h / 2 + S * 0.18 + rand() * (S * 0.64 - h);
    const col = colors[Math.floor(rand() * colors.length)];
    // letter-ish zigzag: sharp verticals connected by loops
    const pts = [];
    const nL = 4 + Math.floor(rand() * 3);
    for (let k = 0; k < nL; k++) {
      const x = -w / 2 + (k / (nL - 1)) * w;
      pts.push([x + (rand() - 0.5) * w * 0.08, -h / 2 + rand() * h * 0.45]);
      pts.push([x + (rand() - 0.5) * w * 0.12, h / 2 - rand() * h * 0.4]);
    }
    const rot = (rand() - 0.5) * 0.2;
    const alpha = 0.18 + rand() * 0.12;
    const under = rand() < 0.65;
    const wobble = pts.map(() => (rand() - 0.5) * w * 0.14);
    const drawTag = (style, lw, a) => {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(rot);
      ctx.globalAlpha = a;
      ctx.strokeStyle = style;
      ctx.lineWidth = lw;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let k = 1; k < pts.length; k++) {
        const mx = (pts[k - 1][0] + pts[k][0]) / 2 + wobble[k];
        ctx.quadraticCurveTo(mx, pts[k - 1][1], pts[k][0], pts[k][1]);
      }
      ctx.stroke();
      if (under) {
        ctx.lineWidth = lw * 0.55;
        ctx.beginPath();
        ctx.moveTo(-w / 2, h * 0.55);
        ctx.quadraticCurveTo(0, h * 0.9, w / 2, h * 0.5);
        ctx.stroke();
      }
      ctx.restore();
      ctx.globalAlpha = 1;
    };
    drawTag('rgba(10,10,14,1)', 10 + rand() * 5, alpha * 0.55); // dark halo
    drawTag(css(col, 0.95 + rand() * 0.35), 5.5 + rand() * 3.5, alpha);
  }
}

// Clumpy moss patch: many small overlapping soft dots read as growth.
function mossClump(ctx, bctx, S, rand, mossHex, cx, cy, R, dense = 1) {
  const n = Math.round((6 + rand() * 8) * dense);
  for (let i = 0; i < n; i++) {
    const a = rand() * Math.PI * 2;
    const rr = rand() * R;
    const x = cx + Math.cos(a) * rr;
    const y = cy + Math.sin(a) * rr * 0.8;
    const r = 2.5 + rand() * 5;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, css(mossHex, 0.7 + rand() * 0.5, 0.4));
    g.addColorStop(1, css(mossHex, 0.8, 0));
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
    if (bctx) {
      bctx.fillStyle = gray(150, 0.35);
      bctx.beginPath();
      bctx.arc(x, y, r * 0.7, 0, Math.PI * 2);
      bctx.fill();
    }
  }
}

// ---------------------------------------------------------------- painters

function paintConcrete(ctx, S, color, rand, bctx) {
  const fB = shade(ctx, S, color, rand, { grain: 13, amp: 15, temp: 9 });
  if (bctx) bumpFromField(bctx, S, fB, 132, 20, rand, 8);
  const P = S / 2;
  // 2x2 cast panels: per-panel tone, AO vignette, consistent top light
  for (let px = 0; px < 2; px++) {
    for (let py = 0; py < 2; py++) {
      const x = px * P;
      const y = py * P;
      ctx.fillStyle = css(color, 0.82 + rand() * 0.36, 0.1);
      ctx.fillRect(x, y, P, P);
      panelShade(ctx, x + 2, y + 2, P - 4, P - 4, { ao: 0.16, inset: 0.14, top: 0.09, bottom: 0.13 });
      // form-tie holes near the corners, some bleeding rust
      for (const [ox, oy] of [[24, 24], [P - 24, 24], [24, P - 24], [P - 24, P - 24]]) {
        boltHole(ctx, x + ox, y + oy, 4.5, bctx);
        if (rand() < 0.3) dripAt(ctx, x + ox, y + oy + 4, 2 + rand() * 2, 20 + rand() * 60, '122,63,26', 0.08 + rand() * 0.09);
      }
    }
  }
  // panel seams: dark groove + lit top edge of the panel below the seam
  for (let i = 0; i <= 2; i++) {
    ctx.fillStyle = 'rgba(0,0,0,0.36)';
    ctx.fillRect(i * P - 2, 0, 4, S);
    ctx.fillRect(0, i * P - 2, S, 4);
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.fillRect(0, i * P + 2, S, 1.5);
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    ctx.fillRect(i * P + 2, 0, 1, S);
    if (bctx) {
      bctx.fillStyle = gray(70, 0.9);
      bctx.fillRect(i * P - 2, 0, 4, S);
      bctx.fillRect(0, i * P - 2, S, 4);
    }
  }
  // layered weathering
  stains(ctx, S, rand, 5, '0,0,0', 0.15);
  stains(ctx, S, rand, 2, '255,255,255', 0.05, 0.2); // efflorescence
  drips(ctx, S, rand, 6, '20,22,26', 0.12);
  cracks(ctx, S, rand, 3, 'rgba(0,0,0,0.26)', 1.2, 0.3, bctx, 2);
  // chipped spots exposing darker aggregate
  for (let i = 0; i < 5; i++) {
    drawChip(ctx, rand() * S, rand() * S, chipShape(rand, 4 + rand() * 8), css(color, 0.55), bctx);
  }
}

// Berlin Altbau plaster: blotchy render, trowel sweeps, hairline cracks,
// chipped patches exposing masonry, worn graffiti tags.
function paintPlaster(ctx, S, color, accent, rand, bctx) {
  const fB = shade(ctx, S, color, rand, { grain: 11, amp: 9, temp: 8, octaves: 5 });
  if (bctx) bumpFromField(bctx, S, fB, 130, 8, rand, 5);
  // broad, very faint trowel sweep arcs
  for (let i = 0; i < 10; i++) {
    const x = rand() * S;
    const y = rand() * S;
    const r = 40 + rand() * 90;
    ctx.strokeStyle = rand() < 0.5
      ? `rgba(255,255,255,${0.01 + rand() * 0.014})`
      : `rgba(0,0,0,${0.012 + rand() * 0.018})`;
    ctx.lineWidth = 10 + rand() * 18;
    const a0 = rand() * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(x, y, r, a0, a0 + 0.6 + rand() * 0.9);
    ctx.stroke();
  }
  // old repair patches (slightly off-tone, soft-edged)
  for (let i = 0; i < 2; i++) {
    const w = 60 + rand() * 120;
    const h = 50 + rand() * 90;
    const x = rand() * (S - w);
    const y = rand() * (S - h);
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.12)';
    ctx.shadowBlur = 8;
    ctx.fillStyle = css(color, 0.92 + rand() * 0.18, 0.09, '#9a938a', 0.25);
    ctx.fillRect(x, y, w, h);
    ctx.restore();
  }
  // chipped plaster exposing weathered masonry underneath (kept close to
  // the wall tone so it reads as depth, not as bright decals)
  const brickTone = blend(color, '#6a4434', 0.55);
  const cavity = blend(color, '#100c0a', 0.72);
  const nChips = 2 + Math.floor(rand() * 2);
  for (let i = 0; i < nChips; i++) {
    const x = 40 + rand() * (S - 80);
    const y = 40 + rand() * (S - 80);
    const pts = chipShape(rand, 9 + rand() * 16);
    drawChip(ctx, x, y, pts, cavity, bctx, 0.2);
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x + pts[0][0], y + pts[0][1]);
    for (let k = 1; k < pts.length; k++) ctx.lineTo(x + pts[k][0], y + pts[k][1]);
    ctx.closePath();
    ctx.clip();
    for (let by = -2; by <= 2; by++) {
      for (let bx = -2; bx <= 2; bx++) {
        ctx.fillStyle = css(brickTone, 0.65 + rand() * 0.4, 0.55);
        ctx.fillRect(x + bx * 15 + (by % 2) * 7.5 - 6, y + by * 9 - 3.5, 13, 7);
      }
    }
    // shadow of the plaster edge falling over the cavity (top light)
    const sg = ctx.createLinearGradient(0, y - 14, 0, y + 10);
    sg.addColorStop(0, 'rgba(0,0,0,0.5)');
    sg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = sg;
    ctx.fillRect(x - 30, y - 14, 60, 24);
    ctx.restore();
  }
  // hairline cracks, a couple anchored to the top edge
  cracks(ctx, S, rand, 4, 'rgba(0,0,0,0.30)', 1.0, 0.25, bctx, 1.6);
  for (let i = 0; i < 2; i++) {
    const pts = crackPts(S, rand, rand() * S, 0, Math.PI / 2 + (rand() - 0.5) * 0.7);
    strokeTaper(ctx, pts, 'rgba(0,0,0,0.28)', 1.1, 0.2);
    if (bctx) strokeTaper(bctx, pts, gray(74, 0.8), 1.6, 0.5);
  }
  graffiti(ctx, S, rand, [accent, accent, '#232830']);
  drips(ctx, S, rand, 5, '30,32,30', 0.1);
  stains(ctx, S, rand, 4, '20,22,20', 0.1);
}

function paintBricks(ctx, S, color, rand, ruined, bctx) {
  const mortar = blend(color, '#8d857a', 0.5);
  shade(ctx, S, ruined ? blend(mortar, '#3d362c', 0.35) : mortar, rand, { grain: 12, amp: 8, temp: 5, octaves: 3 });
  if (bctx) {
    bctx.fillStyle = gray(92);
    bctx.fillRect(0, 0, S, S);
  }
  const rows = 8;
  const cols = 4;
  const bh = S / rows;
  const bw = S / cols;
  const gp = 3; // half mortar joint
  const drawBrick = (x, y, w, h, st) => {
    if (st.missing) {
      // brick fell out: dark cavity, shadowed top, lit lower lip, rubble
      ctx.fillStyle = css(color, 0.3, 0.95, '#080604', 0.75);
      ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(x - 1, y - 1, w + 2, h * 0.4);
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      ctx.fillRect(x - 1, y + h - 3, w + 2, 3);
      for (const [rx, rw2] of st.rubble) {
        ctx.fillStyle = css(color, 0.5, 0.9);
        ctx.fillRect(x + rx * (w - 10), y + h - 7, 4 + rw2 * 6, 5);
      }
      if (bctx) {
        bctx.fillStyle = gray(48);
        bctx.fillRect(x - 1, y - 1, w + 2, h + 2);
      }
      return;
    }
    const lg = ctx.createLinearGradient(0, y, 0, y + h);
    lg.addColorStop(0, css(color, st.tone * 1.08, 1, st.tint, st.tintAmt));
    lg.addColorStop(1, css(color, st.tone * 0.9, 1, st.tint, st.tintAmt));
    ctx.fillStyle = lg;
    ctx.fillRect(x, y, w, h);
    for (const [sx, sy, light, r] of st.speckle) {
      ctx.fillStyle = light ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.12)';
      ctx.fillRect(x + 2 + sx * (w - 4), y + 2 + sy * (h - 4), r, r);
    }
    panelShade(ctx, x, y, w, h, { ao: 0.13, inset: 0.18, top: 0.12, bottom: 0.16 });
    // shadow cast into the mortar joint below (top light)
    ctx.fillStyle = 'rgba(0,0,0,0.30)';
    ctx.fillRect(x, y + h, w, 2);
    if (bctx) {
      bctx.fillStyle = gray(st.bumpTone);
      bctx.fillRect(x, y, w, h);
      for (const [sx, sy, light, r] of st.speckle) {
        bctx.fillStyle = gray(st.bumpTone + (light ? 18 : -22), 0.9);
        bctx.fillRect(x + 2 + sx * (w - 4), y + 2 + sy * (h - 4), r, r);
      }
    }
    if (st.chip) {
      const cxp = x + (st.chip[0] ? w : 0);
      const cyp = y + (st.chip[1] ? h : 0);
      drawChip(ctx, cxp, cyp, st.chip[2], css(mortar, 0.8), bctx, 0.16);
    }
  };
  for (let r = 0; r < rows; r++) {
    const off = (r % 2) * bw * 0.5;
    const y = r * bh + gp;
    const h = bh - gp * 2;
    for (let c = 0; c < cols; c++) {
      const x = c * bw + off + gp;
      const w = bw - gp * 2;
      // style is computed ONCE so the wrap-around copy is identical
      const st = {
        tone: 0.78 + rand() * 0.36,
        tint: rand() < 0.5 ? '#b06038' : '#4a5568',
        tintAmt: rand() * 0.16,
        bumpTone: 138 + rand() * 26,
        missing: ruined && rand() < 0.05,
        chip: null,
        speckle: [],
        rubble: [[rand(), rand()], [rand(), rand()]],
      };
      if (!ruined && rand() < 0.07) { // over-fired clinker brick
        st.tone *= 0.52;
        st.tint = '#2a1c22';
        st.tintAmt = 0.4;
      }
      const nSpeck = 6 + Math.floor(rand() * 6);
      for (let i = 0; i < nSpeck; i++) st.speckle.push([rand(), rand(), rand() < 0.5, 0.5 + rand() * 1.3]);
      if ((ruined ? rand() < 0.3 : rand() < 0.07) && !st.missing) {
        st.chip = [rand() < 0.5, rand() < 0.5, chipShape(rand, 5 + rand() * 7)];
      }
      drawBrick(x, y, w, h, st);
      if (x + w > S) drawBrick(x - S, y, w, h, st);
    }
  }
  if (ruined) {
    cracks(ctx, S, rand, 5, 'rgba(0,0,0,0.34)', 1.6, 0.4, bctx, 2.4);
    stains(ctx, S, rand, 6, '24,16,8', 0.2);
    drips(ctx, S, rand, 6, '14,10,6', 0.2);
    stains(ctx, S, rand, 3, '210,200,180', 0.06); // dust / efflorescence
  } else {
    stains(ctx, S, rand, 4, '0,0,0', 0.1);
    stains(ctx, S, rand, 2, '235,230,215', 0.05);
    cracks(ctx, S, rand, 1, 'rgba(0,0,0,0.2)', 1, 0.3, bctx, 1.5);
  }
}

// Ashlar sandstone blocks (walls) or large flags (opts.floor): sediment
// strata, wind pitting, chiseled top-lit bevels, sand drifts on floors.
function paintSandstone(ctx, S, color, rand, floor, bctx) {
  const mortar = blend(color, '#39301f', 0.5);
  shade(ctx, S, mortar, rand, { grain: 9, amp: 8, temp: 5, octaves: 3 });
  if (bctx) {
    bctx.fillStyle = gray(88);
    bctx.fillRect(0, 0, S, S);
  }
  const rows = floor ? 3 : 4;
  const cols = floor ? 3 : 2;
  const bh = S / rows;
  const bw = S / cols;
  const gp = floor ? 4 : 3;
  const drawBlock = (x, y, w, h, st) => {
    const lg = ctx.createLinearGradient(0, y, 0, y + h);
    lg.addColorStop(0, css(color, st.tone * 1.03, 1, st.tint, st.tintAmt));
    lg.addColorStop(1, css(color, st.tone * 0.96, 1, st.tint, st.tintAmt));
    ctx.fillStyle = lg;
    ctx.fillRect(x, y, w, h);
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    for (const [ty, th, tl, ta] of st.strata) {
      ctx.fillStyle = tl ? `rgba(255,244,214,${ta})` : `rgba(64,48,26,${ta})`;
      ctx.fillRect(x - 2, y + ty * h, w + 4, th);
    }
    // granular sand-grain speckle over the whole face
    for (const [gx2, gy2, gl, ga, gr] of st.grains) {
      ctx.fillStyle = gl ? `rgba(255,240,210,${ga})` : `rgba(52,40,22,${ga})`;
      ctx.fillRect(x + gx2 * w, y + gy2 * h, gr, gr);
    }
    for (const [px, py, pr, pa] of st.pits) {
      ctx.fillStyle = `rgba(40,30,16,${pa})`;
      ctx.beginPath();
      ctx.ellipse(x + px * w, y + py * h, pr, pr * 0.75, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    panelShade(ctx, x, y, w, h, floor ? { ao: 0.18, inset: 0.12 } : { ao: 0.15, inset: 0.14, top: 0.07, bottom: 0.12 });
    if (!floor) {
      ctx.fillStyle = 'rgba(0,0,0,0.30)';
      ctx.fillRect(x, y + h, w, 2);
    }
    if (bctx) {
      bctx.fillStyle = gray(st.bumpTone);
      bctx.fillRect(x, y, w, h);
      for (const [px, py, pr] of st.pits) {
        bctx.fillStyle = gray(st.bumpTone - 34, 0.9);
        bctx.beginPath();
        bctx.ellipse(x + px * w, y + py * h, pr, pr * 0.75, 0, 0, Math.PI * 2);
        bctx.fill();
      }
    }
    if (st.chip) {
      drawChip(ctx, x + st.chip[0] * w, y + st.chip[1] * h, st.chip[2], css(color, 0.58), bctx, 0.18);
    }
  };
  const clamp01 = (v) => Math.max(0.04, Math.min(0.96, v));
  for (let r = 0; r < rows; r++) {
    const off = floor ? 0 : (r % 2) * bw * 0.5;
    const y = r * bh + gp;
    const h = bh - gp * 2;
    for (let c = 0; c < cols; c++) {
      const x = c * bw + off + gp;
      const w = bw - gp * 2;
      const st = {
        tone: 0.82 + rand() * 0.28,
        tint: rand() < 0.6 ? '#c08848' : '#8a8070',
        tintAmt: rand() * 0.2,
        bumpTone: 140 + rand() * 26,
        strata: [],
        grains: [],
        pits: [],
        chip: null,
      };
      const nStrata = 2 + Math.floor(rand() * 3);
      for (let i = 0; i < nStrata; i++) st.strata.push([rand(), 3 + rand() * 5, rand() < 0.5, 0.035 + rand() * 0.045]);
      const nGrain = 60 + Math.floor(rand() * 40);
      for (let i = 0; i < nGrain; i++) st.grains.push([rand(), rand(), rand() < 0.45, 0.04 + rand() * 0.09, 1 + rand() * 1.6]);
      const nClust = 1 + Math.floor(rand() * 2);
      for (let cl = 0; cl < nClust; cl++) {
        const ccx = rand();
        const ccy = rand();
        const nPits = 5 + Math.floor(rand() * 8);
        for (let k = 0; k < nPits; k++) {
          st.pits.push([clamp01(ccx + (rand() - 0.5) * 0.3), clamp01(ccy + (rand() - 0.5) * 0.3), 1 + rand() * 2.2, 0.1 + rand() * 0.14]);
        }
      }
      if (rand() < (floor ? 0.12 : 0.2)) st.chip = [rand() < 0.5 ? 0 : 1, rand() < 0.5 ? 0 : 1, chipShape(rand, 7 + rand() * 9)];
      drawBlock(x, y, w, h, st);
      if (x + w > S) drawBlock(x - S, y, w, h, st);
    }
  }
  if (floor) {
    // wind-blown sand drifts + pebbles collecting in the joints
    const sand = blend(color, '#e0c084', 0.55);
    const [sr, sg, sb] = srgb(sand);
    stains(ctx, S, rand, 6, `${sr},${sg},${sb}`, 0.2, 0.25);
    for (let i = 0; i < 14; i++) {
      const onX = rand() < 0.5;
      const line = Math.floor(rand() * (onX ? rows : cols) + (rand() < 0.5 ? 0 : 1)) * (onX ? bh : bw);
      const x = onX ? rand() * S : line + (rand() - 0.5) * 8;
      const y = onX ? line + (rand() - 0.5) * 8 : rand() * S;
      ctx.fillStyle = rand() < 0.5 ? css(sand, 0.9, 0.6) : css(mortar, 0.6, 0.6);
      ctx.beginPath();
      ctx.ellipse(x % S, y % S, 1 + rand() * 2, 0.8 + rand() * 1.4, rand() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    drips(ctx, S, rand, 4, '40,30,16', 0.12);
    stains(ctx, S, rand, 3, '30,22,10', 0.12);
  }
  cracks(ctx, S, rand, floor ? 3 : 2, 'rgba(30,20,8,0.30)', 1.2, 0.3, bctx, 1.8);
}

// Dark tech panels + accent light seams. Halo is drawn on the color map
// only; the emissive companion keeps crisp cores (bloom threshold 0.9).
function paintNeon(ctx, S, color, accent, rand, emCtx, bctx) {
  const base = blend(color, '#090b12', 0.6);
  const fB = shade(ctx, S, base, rand, { grain: 8, amp: 9, temp: 6 });
  if (bctx) bumpFromField(bctx, S, fB, 130, 10, rand, 4);
  const P = S / 4;
  for (let px = 0; px < 4; px++) {
    for (let py = 0; py < 4; py++) {
      const x = px * P;
      const y = py * P;
      ctx.fillStyle = css(base, 0.8 + rand() * 0.5, 0.12);
      ctx.fillRect(x, y, P, P);
      panelShade(ctx, x + 1, y + 1, P - 2, P - 2, { ao: 0.22, inset: 0.16, top: 0.05, bottom: 0.1 });
      const roll = rand();
      if (roll < 0.16) { // vent slats
        const vw = P * 0.5;
        const vx = x + P * 0.25;
        const vy = y + P * 0.3;
        for (let k = 0; k < 5; k++) {
          ctx.fillStyle = 'rgba(0,0,0,0.5)';
          ctx.fillRect(vx, vy + k * 7, vw, 3.5);
          ctx.fillStyle = 'rgba(255,255,255,0.05)';
          ctx.fillRect(vx, vy + k * 7 + 3.5, vw, 1);
          if (bctx) {
            bctx.fillStyle = gray(96);
            bctx.fillRect(vx, vy + k * 7, vw, 3.5);
          }
        }
      } else if (roll < 0.34) { // hazard ticks in a corner
        ctx.fillStyle = css(accent, 0.9, 0.26);
        for (let k = 0; k < 3; k++) {
          ctx.save();
          ctx.translate(x + P - 14 - k * 9, y + P - 13);
          ctx.rotate(Math.PI / 4);
          ctx.fillRect(-1.5, -6, 3, 12);
          ctx.restore();
        }
      }
      rivet(ctx, x + 7, y + 7, 1.8, bctx);
      rivet(ctx, x + P - 7, y + 7, 1.8, bctx);
      rivet(ctx, x + 7, y + P - 7, 1.8, bctx);
      rivet(ctx, x + P - 7, y + P - 7, 1.8, bctx);
    }
  }
  for (let i = 0; i <= 4; i++) {
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(i * P - 1.5, 0, 3, S);
    ctx.fillRect(0, i * P - 1.5, S, 3);
    ctx.fillStyle = css(accent, 0.8, 0.14);
    ctx.fillRect(i * P + 1.5, 0, 1, S);
    ctx.fillRect(0, i * P + 1.5, S, 1);
    if (bctx) {
      bctx.fillStyle = gray(84, 0.9);
      bctx.fillRect(i * P - 1.5, 0, 3, S);
      bctx.fillRect(0, i * P - 1.5, S, 3);
    }
  }
  // choose glowing seam segments + LED dots once, then draw halo (color map)
  // and crisp core (emissive map) from the same geometry
  const segs = [];
  for (let i = 0; i < 7; i++) {
    const vert = rand() > 0.5;
    const line = Math.floor(rand() * 5) * P;
    const a = rand() * S * 0.6;
    const b = a + S * (0.15 + rand() * 0.45);
    segs.push({ vert, line, a, b });
  }
  const dots = [];
  for (let i = 0; i < 9; i++) dots.push({ x: rand() * S, y: rand() * S, r: 1.3 + rand() * 1.5 });
  ctx.save();
  ctx.lineCap = 'round';
  ctx.strokeStyle = css(accent, 1.0, 0.9);
  ctx.shadowColor = css(accent, 1, 1);
  ctx.shadowBlur = 9;
  ctx.lineWidth = 2.4;
  for (const sg of segs) {
    ctx.beginPath();
    if (sg.vert) { ctx.moveTo(sg.line, sg.a); ctx.lineTo(sg.line, sg.b); } else { ctx.moveTo(sg.a, sg.line); ctx.lineTo(sg.b, sg.line); }
    ctx.stroke();
  }
  ctx.fillStyle = css(accent, 1.15, 1);
  for (const d of dots) {
    ctx.beginPath();
    ctx.arc(d.x, d.y, d.r + 0.6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  emCtx.save();
  emCtx.lineCap = 'round';
  emCtx.strokeStyle = css(accent, 1.05, 1);
  emCtx.lineWidth = 2;
  for (const sg of segs) {
    emCtx.beginPath();
    if (sg.vert) { emCtx.moveTo(sg.line, sg.a); emCtx.lineTo(sg.line, sg.b); } else { emCtx.moveTo(sg.a, sg.line); emCtx.lineTo(sg.b, sg.line); }
    emCtx.stroke();
  }
  emCtx.fillStyle = css(accent, 1.2, 1);
  for (const d of dots) {
    emCtx.beginPath();
    emCtx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
    emCtx.fill();
  }
  emCtx.restore();
}

// Dark glass curtain wall: sky-lit panes with a consistent diagonal sheen,
// beveled mullions, and a tight accent LED strip along one mullion.
function paintPanelGlass(ctx, S, color, accent, rand, emCtx, bctx) {
  const frame = blend(color, '#232833', 0.55);
  const glass = blend(color, '#070a12', 0.62);
  shade(ctx, S, frame, rand, { grain: 7, amp: 7, temp: 4, octaves: 3 });
  if (bctx) {
    bctx.fillStyle = gray(168);
    bctx.fillRect(0, 0, S, S);
  }
  const cols = 3;
  const rows = 4;
  const pw = S / cols;
  const ph = S / rows;
  const M = 6; // mullion half-width
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      const x = c * pw + M;
      const y = r * ph + M;
      const w = pw - M * 2;
      const h = ph - M * 2;
      const tone = 0.85 + rand() * 0.3;
      const lg = ctx.createLinearGradient(0, y, 0, y + h);
      lg.addColorStop(0, css(glass, tone * 1.5));
      lg.addColorStop(0.45, css(glass, tone));
      lg.addColorStop(1, css(glass, tone * 0.72));
      ctx.fillStyle = lg;
      ctx.fillRect(x, y, w, h);
      // consistent diagonal sheen band (same angle on every pane)
      const c0 = 0.3 + rand() * 0.25;
      const sh = ctx.createLinearGradient(x, y + h, x + w, y);
      sh.addColorStop(Math.max(0, c0 - 0.16), 'rgba(255,255,255,0)');
      sh.addColorStop(c0, `rgba(225,238,255,${0.1 + rand() * 0.07})`);
      sh.addColorStop(Math.min(1, c0 + 0.16), 'rgba(255,255,255,0)');
      ctx.fillStyle = sh;
      ctx.fillRect(x, y, w, h);
      // rare dim interior light — color map only, must NOT bloom
      if (rand() < 0.14) {
        ctx.fillStyle = css('#ffd9a0', 0.6, 0.1);
        ctx.fillRect(x + w * 0.15 + rand() * w * 0.3, y + h * 0.25, w * 0.28, h * 0.5);
      }
      // mullion overhang shadow on the glass (top light)
      const sg = ctx.createLinearGradient(0, y, 0, y + 6);
      sg.addColorStop(0, 'rgba(0,0,0,0.30)');
      sg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = sg;
      ctx.fillRect(x, y, w, 6);
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
      if (bctx) {
        bctx.fillStyle = gray(122);
        bctx.fillRect(x, y, w, h);
      }
    }
  }
  // mullion bevels: lit top edge, shaded lower edge (top light)
  for (let r = 0; r <= rows; r++) {
    const y = r * ph;
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.fillRect(0, y - M + 1, S, 1.5);
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.fillRect(0, y + M - 2, S, 1.5);
  }
  for (let c = 0; c <= cols; c++) {
    const x = c * pw;
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fillRect(x - M + 1, 0, 1.5, S);
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.fillRect(x + M - 2, 0, 1.5, S);
  }
  for (let c = 0; c <= cols; c++) {
    for (let r = 0; r <= rows; r++) {
      rivet(ctx, c * pw, r * ph, 2.2, bctx);
    }
  }
  // accent LED strip on one mullion + a few node dots
  const yLed = (1 + Math.floor(rand() * (rows - 1))) * ph;
  const segs = [];
  let xc = 8 + rand() * 30;
  while (xc < S - 20) {
    const len = 40 + rand() * 90;
    segs.push([xc, Math.min(S - 6, xc + len)]);
    xc += len + 18 + rand() * 50;
  }
  const dots = [];
  for (let i = 0; i < 5; i++) {
    dots.push([Math.floor(rand() * (cols + 1)) * pw, Math.floor(rand() * (rows + 1)) * ph]);
  }
  ctx.save();
  ctx.lineCap = 'round';
  ctx.shadowColor = css(accent, 1, 1);
  ctx.shadowBlur = 8;
  ctx.strokeStyle = css(accent, 1.05, 0.95);
  ctx.lineWidth = 2.2;
  for (const [a, b] of segs) {
    ctx.beginPath();
    ctx.moveTo(a, yLed);
    ctx.lineTo(b, yLed);
    ctx.stroke();
  }
  ctx.fillStyle = css(accent, 1.15, 1);
  for (const [dx, dy] of dots) {
    ctx.beginPath();
    ctx.arc(dx, dy, 2.6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  emCtx.save();
  emCtx.lineCap = 'round';
  emCtx.strokeStyle = css(accent, 1.1, 1);
  emCtx.lineWidth = 2;
  for (const [a, b] of segs) {
    emCtx.beginPath();
    emCtx.moveTo(a, yLed);
    emCtx.lineTo(b, yLed);
    emCtx.stroke();
  }
  emCtx.fillStyle = css(accent, 1.2, 1);
  for (const [dx, dy] of dots) {
    emCtx.beginPath();
    emCtx.arc(dx, dy, 2, 0, Math.PI * 2);
    emCtx.fill();
  }
  emCtx.restore();
}

function paintIce(ctx, S, color, rand, bctx) {
  const fB = shade(ctx, S, color, rand, { grain: 5, amp: 12, temp: 9, axis: [-0.7, 0.15, 1], octaves: 5 });
  if (bctx) bumpFromField(bctx, S, fB, 128, 7, rand, 3);
  const deep = blend(color, '#0a2a4a', 0.65);
  const [dr, dg, db] = srgb(deep);
  stains(ctx, S, rand, 7, `${dr},${dg},${db}`, 0.16, 0.3); // depth pockets
  // vertical sheen bands
  for (let i = 0; i < 5; i++) {
    const x = rand() * S;
    const w2 = 30 + rand() * 90;
    const g = ctx.createLinearGradient(x, 0, x + w2, 0);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.5, `rgba(255,255,255,${0.05 + rand() * 0.07})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x, 0, w2, S);
  }
  // faint horizontal freeze strata
  for (let i = 0; i < 8; i++) {
    ctx.fillStyle = `rgba(255,255,255,${0.02 + rand() * 0.03})`;
    ctx.fillRect(0, rand() * S, S, 1.5 + rand() * 3);
  }
  // deep fractures: blue depth shadow + wide soft halo + bright core
  for (let i = 0; i < 5; i++) {
    const pts = crackPts(S, rand, rand() * S, rand() * S, rand() * Math.PI * 2);
    strokeTaper(ctx, pts.map(([px, py]) => [px + 1.5, py + 1.5]), 'rgba(12,40,70,0.25)', 3.5, 1.2);
    strokeTaper(ctx, pts, 'rgba(255,255,255,0.10)', 5, 2);
    strokeTaper(ctx, pts, 'rgba(255,255,255,0.5)', 1.4, 0.4);
    if (bctx) strokeTaper(bctx, pts, gray(96, 0.7), 2, 0.6);
    if (rand() < 0.6) {
      const p = pts[1 + Math.floor(rand() * (pts.length - 2))];
      strokeTaper(ctx, crackPts(S, rand, p[0], p[1], rand() * Math.PI * 2), 'rgba(255,255,255,0.32)', 0.9, 0.3);
    }
  }
  // trapped air bubble clusters
  for (let cl = 0; cl < 5; cl++) {
    const cx = rand() * S;
    const cy = rand() * S;
    const n = 5 + Math.floor(rand() * 8);
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = `rgba(255,255,255,${0.15 + rand() * 0.3})`;
      ctx.beginPath();
      ctx.arc(cx + (rand() - 0.5) * 50, cy + (rand() - 0.5) * 50, 0.6 + rand() * 1.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // sparkles
  for (let i = 0; i < 30; i++) {
    ctx.fillStyle = `rgba(255,255,255,${0.2 + rand() * 0.5})`;
    ctx.fillRect(rand() * S, rand() * S, 1.6, 1.6);
  }
}

function paintMoss(ctx, S, color, accent, rand, bctx) {
  paintConcrete(ctx, S, color, rand, bctx);
  const mossHex = blend(accent, '#2c4a1e', 0.55);
  // patches, denser near the bottom edge
  for (let i = 0; i < 12; i++) {
    mossClump(ctx, bctx, S, rand, mossHex, rand() * S, S - rand() * rand() * S, 12 + rand() * 26);
  }
  // moss creeping along the panel seams
  const P = S / 2;
  for (let i = 0; i < 10; i++) {
    if (rand() < 0.5) {
      mossClump(ctx, bctx, S, rand, mossHex, rand() * S, Math.floor(rand() * 3) * P + (rand() - 0.5) * 8, 9, 0.8);
    } else {
      mossClump(ctx, bctx, S, rand, mossHex, Math.floor(rand() * 3) * P + (rand() - 0.5) * 8, rand() * S, 9, 0.8);
    }
  }
  // pale lichen dots
  const lichen = blend(accent, '#cfe0a8', 0.5);
  for (let i = 0; i < 9; i++) {
    ctx.fillStyle = css(lichen, 0.9, 0.16 + rand() * 0.14);
    ctx.beginPath();
    ctx.arc(rand() * S, rand() * S, 2 + rand() * 4, 0, Math.PI * 2);
    ctx.fill();
  }
  drips(ctx, S, rand, 7, '10,20,8', 0.2);
}

function paintMetal(ctx, S, color, rand, bctx) {
  const base = blend(color, '#101216', 0.3);
  const fB = shade(ctx, S, base, rand, { grain: 8, amp: 10, temp: 6 });
  if (bctx) bumpFromField(bctx, S, fB, 130, 9, rand, 4);
  // brushed streaks
  for (let i = 0; i < 55; i++) {
    ctx.fillStyle = i % 2 ? `rgba(255,255,255,${rand() * 0.05})` : `rgba(0,0,0,${rand() * 0.07})`;
    ctx.fillRect(0, rand() * S, S, 1);
  }
  const pw = S / 2;
  const ph = S / 3;
  // plates: per-plate tone, AO, top light, worn shiny corners
  for (let px = 0; px < 2; px++) {
    for (let py = 0; py < 3; py++) {
      const x = px * pw;
      const y = py * ph;
      ctx.fillStyle = css(base, 0.8 + rand() * 0.45, 0.12);
      ctx.fillRect(x, y, pw, ph);
      panelShade(ctx, x + 2, y + 2, pw - 4, ph - 4, { ao: 0.16, inset: 0.12, top: 0.1, bottom: 0.12 });
      if (rand() < 0.5) {
        const cx = x + (rand() < 0.5 ? 8 : pw - 8);
        const cy = y + (rand() < 0.5 ? 8 : ph - 8);
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, 14);
        g.addColorStop(0, 'rgba(230,235,245,0.16)');
        g.addColorStop(1, 'rgba(230,235,245,0)');
        ctx.fillStyle = g;
        ctx.fillRect(cx - 14, cy - 14, 28, 28);
      }
    }
  }
  // seams: groove + lit lower lip on horizontal seams
  for (let px = 0; px <= 2; px++) {
    ctx.fillStyle = 'rgba(0,0,0,0.42)';
    ctx.fillRect(px * pw - 1.5, 0, 3, S);
    if (bctx) {
      bctx.fillStyle = gray(80, 0.9);
      bctx.fillRect(px * pw - 1.5, 0, 3, S);
    }
  }
  for (let py = 0; py <= 3; py++) {
    ctx.fillStyle = 'rgba(0,0,0,0.42)';
    ctx.fillRect(0, py * ph - 1.5, S, 3);
    ctx.fillStyle = 'rgba(255,255,255,0.09)';
    ctx.fillRect(0, py * ph + 1.5, S, 1.2);
    if (bctx) {
      bctx.fillStyle = gray(80, 0.9);
      bctx.fillRect(0, py * ph - 1.5, S, 3);
    }
  }
  // rivets along plate edges, some bleeding rust
  for (let px = 0; px < 2; px++) {
    for (let py = 0; py < 3; py++) {
      for (let i = 0; i < 5; i++) {
        const t2 = (i + 0.5) / 5;
        const rx = px * pw + t2 * pw;
        const ry = py * ph + 7;
        rivet(ctx, rx, ry, 2.6, bctx);
        if (rand() < 0.22) dripAt(ctx, rx, ry + 3, 2 + rand() * 2, 14 + rand() * 40, '122,60,26', 0.1 + rand() * 0.1);
        rivet(ctx, px * pw + 7, py * ph + t2 * ph, 2.6, bctx);
      }
    }
  }
  // scratches: bright line with a dark parallel shadow
  for (let i = 0; i < 9; i++) {
    const x = rand() * S;
    const y = rand() * S;
    const dx = (rand() - 0.5) * 90;
    const dy = (rand() - 0.5) * 40;
    ctx.strokeStyle = 'rgba(0,0,0,0.18)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + 0.8, y + 0.8);
    ctx.lineTo(x + dx + 0.8, y + dy + 0.8);
    ctx.stroke();
    ctx.strokeStyle = `rgba(255,255,255,${0.1 + rand() * 0.12})`;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + dx, y + dy);
    ctx.stroke();
    if (bctx) {
      bctx.strokeStyle = gray(100, 0.5);
      bctx.beginPath();
      bctx.moveTo(x, y);
      bctx.lineTo(x + dx, y + dy);
      bctx.stroke();
    }
  }
  stains(ctx, S, rand, 3, '112,58,24', 0.13, 0.16); // rust
  stains(ctx, S, rand, 3, '8,8,10', 0.16, 0.22); // grime
}

// Bright framed panel for accent (emissive) boxes. Emissive discipline: the
// mask keeps the frame black and the panel dim — only the energy stripes and
// the inner rim run hot, so bloom stays tight instead of full-surface.
function paintAccent(ctx, S, color, rand, emCtx) {
  shade(ctx, S, color, rand, { grain: 12, amp: 10, temp: 6, octaves: 3 });
  const B = Math.round(S * 0.085); // frame width
  ctx.fillStyle = css(color, 0.3);
  ctx.fillRect(0, 0, S, B);
  ctx.fillRect(0, S - B, S, B);
  ctx.fillRect(0, 0, B, S);
  ctx.fillRect(S - B, 0, B, S);
  // machined frame bevels (top light)
  ctx.fillStyle = 'rgba(255,255,255,0.16)';
  ctx.fillRect(0, 0, S, 2);
  ctx.fillStyle = 'rgba(0,0,0,0.30)';
  ctx.fillRect(0, S - 2, S, 2);
  ctx.fillStyle = 'rgba(255,255,255,0.07)';
  ctx.fillRect(0, 0, 2, S);
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.fillRect(S - 2, 0, 2, S);
  // inner panel base (dimmer than the stripes)
  ctx.fillStyle = css(color, 0.6);
  ctx.fillRect(B, B, S - 2 * B, S - 2 * B);
  const drawStripes = (t, coreStyle, dimStyle) => {
    t.save();
    t.beginPath();
    t.rect(B, B, S - 2 * B, S - 2 * B);
    t.clip();
    t.translate(S / 2, S / 2);
    t.rotate(-Math.PI / 4);
    for (let x = -S; x < S; x += 72) {
      t.fillStyle = coreStyle;
      t.fillRect(x, -S, 30, S * 2);
      if (dimStyle) {
        t.fillStyle = dimStyle;
        t.fillRect(x + 30, -S, 4, S * 2);
      }
    }
    t.restore();
  };
  drawStripes(ctx, css(color, 1.55, 0.85), 'rgba(0,0,0,0.25)');
  panelShade(ctx, B, B, S - 2 * B, S - 2 * B, { ao: 0.18, inset: 0.1, top: 0.06, bottom: 0.1 });
  ctx.save();
  ctx.strokeStyle = css(color, 1.7, 0.95);
  ctx.shadowColor = css(color, 1.4, 1);
  ctx.shadowBlur = 7;
  ctx.lineWidth = 3;
  ctx.strokeRect(B - 1.5, B - 1.5, S - 2 * B + 3, S - 2 * B + 3);
  ctx.restore();
  rivet(ctx, B / 2, B / 2, 3.4);
  rivet(ctx, S - B / 2, B / 2, 3.4);
  rivet(ctx, B / 2, S - B / 2, 3.4);
  rivet(ctx, S - B / 2, S - B / 2, 3.4);
  // emissive mask
  const g = emCtx.createRadialGradient(S / 2, S / 2, S * 0.1, S / 2, S / 2, S * 0.7);
  g.addColorStop(0, 'rgb(96,96,96)');
  g.addColorStop(1, 'rgb(58,58,58)');
  emCtx.fillStyle = g;
  emCtx.fillRect(B, B, S - 2 * B, S - 2 * B);
  drawStripes(emCtx, 'rgb(255,255,255)', null);
  emCtx.strokeStyle = 'rgb(255,255,255)';
  emCtx.lineWidth = 3;
  emCtx.strokeRect(B - 1.5, B - 1.5, S - 2 * B + 3, S - 2 * B + 3);
}

// building facade: dark base + grid of windows (some lit). Used as both
// color map and emissive map on skyline silhouettes.
function paintFacade(ctx, S, color, accent, rand, density) {
  shade(ctx, S, blend(color, '#05070c', 0.76), rand, { grain: 6, amp: 8, temp: 5, octaves: 3 });
  const cols = 6;
  const rows = 9;
  const cw = S / cols;
  const rh = S / rows;
  for (let c = 0; c <= cols; c++) { // vertical piers
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(c * cw - 0.5, 0, 1, S);
  }
  const warm = ['#ffd9a0', '#ffeecb', '#ffe2ae'];
  const cool = ['#bfe3ff', '#d6ecff'];
  for (let r = 0; r < rows; r++) {
    // floor slab + lit slab edge
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(0, r * rh - 1, S, 2);
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    ctx.fillRect(0, r * rh + 1, S, 1);
    for (let c = 0; c < cols; c++) {
      const x = c * cw + cw * 0.2;
      const y = r * rh + rh * 0.18;
      const ww = cw * 0.6;
      const wh = rh * 0.58;
      if (rand() < density) {
        const wc = rand() < 0.1 ? accent : (rand() < 0.72 ? warm[Math.floor(rand() * warm.length)] : cool[Math.floor(rand() * cool.length)]);
        const bright = 0.7 + rand() * 0.5;
        const g = ctx.createLinearGradient(0, y, 0, y + wh);
        g.addColorStop(0, css(wc, bright));
        g.addColorStop(1, css(wc, bright * (rand() < 0.35 ? 0.3 : 0.8))); // some half-lit
        ctx.fillStyle = g;
        ctx.fillRect(x, y, ww, wh);
        ctx.fillStyle = 'rgba(0,0,0,0.30)';
        ctx.fillRect(x + ww / 2 - 0.5, y, 1, wh); // window mullion
      } else {
        ctx.fillStyle = 'rgba(7,9,13,0.88)';
        ctx.fillRect(x, y, ww, wh);
        ctx.fillStyle = 'rgba(150,180,220,0.07)'; // faint sky reflection
        ctx.fillRect(x, y, ww, wh * 0.3);
      }
    }
  }
}

// -------------------------------------------------------------- floors

function paintFloorConcrete(ctx, S, color, rand, bctx) {
  const fB = shade(ctx, S, color, rand, { grain: 15, amp: 16, temp: 8 });
  if (bctx) bumpFromField(bctx, S, fB, 132, 18, rand, 8);
  const P = S / 2;
  for (let px = 0; px < 2; px++) {
    for (let py = 0; py < 2; py++) {
      const x = px * P;
      const y = py * P;
      ctx.fillStyle = css(color, 0.84 + rand() * 0.3, 0.1);
      ctx.fillRect(x, y, P, P);
      panelShade(ctx, x + 3, y + 3, P - 6, P - 6, { ao: 0.14, inset: 0.1 });
      for (const [ox, oy] of [[30, 30], [P - 30, 30], [30, P - 30], [P - 30, P - 30]]) {
        boltHole(ctx, x + ox, y + oy, 3.5, bctx);
      }
    }
  }
  // expansion joints
  for (let i = 0; i <= 2; i++) {
    ctx.fillStyle = 'rgba(0,0,0,0.42)';
    ctx.fillRect(i * P - 2.5, 0, 5, S);
    ctx.fillRect(0, i * P - 2.5, S, 5);
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    ctx.fillRect(i * P + 2.5, 0, 1, S);
    ctx.fillRect(0, i * P + 2.5, S, 1);
    if (bctx) {
      bctx.fillStyle = gray(72, 0.9);
      bctx.fillRect(i * P - 2.5, 0, 5, S);
      bctx.fillRect(0, i * P - 2.5, S, 5);
    }
  }
  // faint saw-cut inner grid
  ctx.strokeStyle = 'rgba(0,0,0,0.09)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 8; i++) {
    ctx.beginPath();
    ctx.moveTo(i * S / 8, 0);
    ctx.lineTo(i * S / 8, S);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, i * S / 8);
    ctx.lineTo(S, i * S / 8);
    ctx.stroke();
  }
  // tire scuff arcs
  for (let i = 0; i < 5; i++) {
    const x = rand() * S;
    const y = rand() * S;
    const r = 40 + rand() * 120;
    const a0 = rand() * Math.PI * 2;
    ctx.strokeStyle = `rgba(0,0,0,${0.04 + rand() * 0.05})`;
    ctx.lineWidth = 3 + rand() * 5;
    ctx.beginPath();
    ctx.arc(x, y, r, a0, a0 + 0.3 + rand() * 0.5);
    ctx.stroke();
  }
  stains(ctx, S, rand, 6, '0,0,0', 0.18);
  stains(ctx, S, rand, 2, '12,10,6', 0.22, 0.14); // oil
  cracks(ctx, S, rand, 3, 'rgba(0,0,0,0.24)', 1.3, 0.3, bctx, 2);
  for (let i = 0; i < 4; i++) {
    drawChip(ctx, rand() * S, rand() * S, chipShape(rand, 3.5 + rand() * 6), css(color, 0.55), bctx);
  }
}

function paintFloorStone(ctx, S, color, rand, bctx) {
  const joint = blend(color, '#241d12', 0.55);
  shade(ctx, S, joint, rand, { grain: 10, amp: 8, temp: 5, octaves: 3 });
  if (bctx) {
    bctx.fillStyle = gray(86);
    bctx.fillRect(0, 0, S, S);
  }
  const n = 4;
  const cs = S / n;
  for (let gx = 0; gx < n; gx++) {
    for (let gy = 0; gy < n; gy++) {
      // per-slab inset jitter (kept inside the cell so the texture tiles)
      const j = 3 + rand() * 5;
      const x = gx * cs + j;
      const y = gy * cs + j;
      const w = cs - j * 2;
      const h = cs - j * 2;
      const tone = 0.78 + rand() * 0.36;
      const tint = rand() < 0.5 ? '#8a7a5a' : '#5a6470';
      ctx.fillStyle = css(color, tone, 1, tint, rand() * 0.2);
      ctx.fillRect(x, y, w, h);
      // soft center-light undulation
      const g = ctx.createRadialGradient(x + w / 2, y + h / 2, 4, x + w / 2, y + h / 2, w * 0.7);
      g.addColorStop(0, `rgba(255,255,255,${0.04 + rand() * 0.05})`);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x, y, w, h);
      panelShade(ctx, x, y, w, h, { ao: 0.2, inset: 0.14 });
      const nPits = 5 + Math.floor(rand() * 8);
      for (let i = 0; i < nPits; i++) {
        ctx.fillStyle = `rgba(20,14,6,${0.1 + rand() * 0.14})`;
        ctx.beginPath();
        ctx.ellipse(x + 4 + rand() * (w - 8), y + 4 + rand() * (h - 8), 1 + rand() * 2.4, 0.8 + rand() * 1.8, rand() * 3, 0, Math.PI * 2);
        ctx.fill();
      }
      if (bctx) {
        bctx.fillStyle = gray(136 + rand() * 26);
        bctx.fillRect(x, y, w, h);
      }
      if (rand() < 0.28) { // cracked slab
        const pts = crackPts(cs, rand, x + w * 0.2 + rand() * w * 0.6, y + h * 0.2 + rand() * h * 0.6, rand() * Math.PI * 2);
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, y, w, h);
        ctx.clip();
        strokeTaper(ctx, pts, 'rgba(0,0,0,0.3)', 1.4, 0.4);
        ctx.restore();
        if (bctx) {
          bctx.save();
          bctx.beginPath();
          bctx.rect(x, y, w, h);
          bctx.clip();
          strokeTaper(bctx, pts, gray(72, 0.8), 2, 0.6);
          bctx.restore();
        }
      }
    }
  }
  // grit + pebbles collecting in the joints
  for (let i = 0; i < 40; i++) {
    const onX = rand() < 0.5;
    const line = Math.floor(rand() * (n + 1)) * cs;
    const x = onX ? rand() * S : line + (rand() - 0.5) * 6;
    const y = onX ? line + (rand() - 0.5) * 6 : rand() * S;
    ctx.fillStyle = rand() < 0.6 ? css(joint, 1.5, 0.5) : css(joint, 0.6, 0.5);
    ctx.beginPath();
    ctx.arc(x, y, 0.7 + rand() * 1.6, 0, Math.PI * 2);
    ctx.fill();
  }
  stains(ctx, S, rand, 5, '30,20,8', 0.16);
}

function paintFloorNeon(ctx, S, color, accent, rand, emCtx) {
  const base = blend(color, '#0a0c12', 0.55);
  shade(ctx, S, base, rand, { grain: 8, amp: 9, temp: 5 });
  const n = 8;
  const cs = S / n;
  for (let gx = 0; gx < n; gx++) {
    for (let gy = 0; gy < n; gy++) {
      ctx.fillStyle = css(base, 0.75 + rand() * 0.55, 0.1);
      ctx.fillRect(gx * cs, gy * cs, cs, cs);
      if (rand() < 0.1) { // etched circuit trace on a few tiles
        const x0 = gx * cs + 6 + rand() * (cs - 24);
        const y0 = gy * cs + 6 + rand() * (cs - 24);
        const lx = x0 + 10 + rand() * 14;
        const ly = y0 + 8 + rand() * 10;
        ctx.strokeStyle = css(accent, 0.7, 0.14);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(lx, y0);
        ctx.lineTo(lx, ly);
        ctx.stroke();
      }
    }
  }
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  ctx.lineWidth = 2;
  for (let i = 0; i <= n; i++) {
    ctx.beginPath();
    ctx.moveTo(i * cs, 0);
    ctx.lineTo(i * cs, S);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, i * cs);
    ctx.lineTo(S, i * cs);
    ctx.stroke();
  }
  stains(ctx, S, rand, 4, '0,0,0', 0.14);
  // glow nodes at intersections + a few tile-edge light segments —
  // halo on the color map, crisp cores on the emissive map
  const dots = [];
  for (let i = 0; i < 12; i++) {
    dots.push([Math.floor(rand() * (n + 1)) * cs, Math.floor(rand() * (n + 1)) * cs]);
  }
  const segs = [];
  for (let i = 0; i < 4; i++) {
    const vert = rand() < 0.5;
    const line = Math.floor(rand() * (n + 1)) * cs;
    const a = Math.floor(rand() * n) * cs;
    segs.push([vert, line, a, a + cs]);
  }
  ctx.save();
  ctx.lineCap = 'round';
  ctx.fillStyle = css(accent, 1.0, 0.9);
  ctx.strokeStyle = css(accent, 1.0, 0.85);
  ctx.shadowColor = css(accent, 1, 1);
  ctx.shadowBlur = 7;
  ctx.lineWidth = 2;
  for (const [dx, dy] of dots) {
    ctx.beginPath();
    ctx.arc(dx, dy, 2.4, 0, Math.PI * 2);
    ctx.fill();
  }
  for (const [vert, line, a, b] of segs) {
    ctx.beginPath();
    if (vert) { ctx.moveTo(line, a); ctx.lineTo(line, b); } else { ctx.moveTo(a, line); ctx.lineTo(b, line); }
    ctx.stroke();
  }
  ctx.restore();
  emCtx.save();
  emCtx.lineCap = 'round';
  emCtx.fillStyle = css(accent, 1.15, 1);
  emCtx.strokeStyle = css(accent, 1.05, 1);
  emCtx.lineWidth = 1.6;
  for (const [dx, dy] of dots) {
    emCtx.beginPath();
    emCtx.arc(dx, dy, 2, 0, Math.PI * 2);
    emCtx.fill();
  }
  for (const [vert, line, a, b] of segs) {
    emCtx.beginPath();
    if (vert) { emCtx.moveTo(line, a); emCtx.lineTo(line, b); } else { emCtx.moveTo(a, line); emCtx.lineTo(b, line); }
    emCtx.stroke();
  }
  emCtx.restore();
}

function paintFloorIce(ctx, S, color, rand, bctx) {
  const fB = shade(ctx, S, color, rand, { grain: 5, amp: 10, temp: 8, axis: [-0.7, 0.15, 1], octaves: 5 });
  if (bctx) bumpFromField(bctx, S, fB, 128, 6, rand, 3);
  const deep = blend(color, '#08243e', 0.7);
  const [dr, dg, db] = srgb(deep);
  stains(ctx, S, rand, 6, `${dr},${dg},${db}`, 0.18, 0.3);
  // frozen glow pockets
  for (let i = 0; i < 6; i++) {
    const x = rand() * S;
    const y = rand() * S;
    const r = 30 + rand() * 70;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(255,255,255,${0.04 + rand() * 0.07})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // web of cracks: deep faint + bright surface
  for (let i = 0; i < 7; i++) {
    const pts = crackPts(S, rand, rand() * S, rand() * S, rand() * Math.PI * 2);
    strokeTaper(ctx, pts, 'rgba(16,44,74,0.22)', 4, 1.4);
    strokeTaper(ctx, pts, 'rgba(255,255,255,0.34)', 1.4, 0.4);
    if (bctx) strokeTaper(bctx, pts, gray(100, 0.6), 1.6, 0.5);
    if (rand() < 0.5) {
      const p = pts[1 + Math.floor(rand() * (pts.length - 2))];
      strokeTaper(ctx, crackPts(S, rand, p[0], p[1], rand() * Math.PI * 2), 'rgba(255,255,255,0.22)', 0.9, 0.3);
    }
  }
  // skate scratches
  for (let i = 0; i < 8; i++) {
    const x = rand() * S;
    const y = rand() * S;
    const r = 60 + rand() * 160;
    const a0 = rand() * Math.PI * 2;
    ctx.strokeStyle = `rgba(255,255,255,${0.06 + rand() * 0.08})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x, y, r, a0, a0 + 0.2 + rand() * 0.3);
    ctx.stroke();
  }
  // bubble clusters
  for (let cl = 0; cl < 4; cl++) {
    const cx = rand() * S;
    const cy = rand() * S;
    const m = 4 + Math.floor(rand() * 7);
    for (let i = 0; i < m; i++) {
      ctx.fillStyle = `rgba(255,255,255,${0.14 + rand() * 0.26})`;
      ctx.beginPath();
      ctx.arc(cx + (rand() - 0.5) * 46, cy + (rand() - 0.5) * 46, 0.5 + rand() * 1.1, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function paintFloorMoss(ctx, S, color, accent, rand, bctx) {
  paintFloorConcrete(ctx, S, color, rand, bctx);
  const mossHex = blend(accent, '#243c16', 0.6);
  for (let i = 0; i < 10; i++) {
    mossClump(ctx, bctx, S, rand, mossHex, rand() * S, rand() * S, 10 + rand() * 26);
  }
  // growth along the expansion joints
  const P = S / 2;
  for (let i = 0; i < 8; i++) {
    const onX = rand() < 0.5;
    const line = Math.floor(rand() * 3) * P;
    mossClump(ctx, bctx, S, rand, mossHex,
      onX ? rand() * S : line + (rand() - 0.5) * 10,
      onX ? line + (rand() - 0.5) * 10 : rand() * S, 8, 0.8);
  }
  // stagnant puddles with a faint reflection rim
  for (let i = 0; i < 4; i++) {
    const x = rand() * S;
    const y = rand() * S;
    const rx = 14 + rand() * 26;
    const ry = 8 + rand() * 16;
    const rot = rand() * 3;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.fillStyle = 'rgba(6,14,10,0.5)';
    ctx.beginPath();
    ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(190,220,230,0.13)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.ellipse(0, 0, rx * 0.9, ry * 0.9, 0, Math.PI * 1.1, Math.PI * 1.9);
    ctx.stroke();
    ctx.restore();
    if (bctx) {
      bctx.save();
      bctx.translate(x, y);
      bctx.rotate(rot);
      bctx.fillStyle = gray(120, 0.8);
      bctx.beginPath();
      bctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
      bctx.fill();
      bctx.restore();
    }
  }
}

function paintFloorMetal(ctx, S, color, rand, bctx) {
  paintMetal(ctx, S, color, rand, bctx);
  // diamond-plate tread bars (raised in the bump map)
  const step = S / 16;
  for (let gx = 0; gx < 16; gx++) {
    for (let gy = 0; gy < 16; gy++) {
      const x = gx * step + step / 2;
      const y = gy * step + step / 2;
      const a = ((gx + gy) % 2 === 0 ? 1 : -1) * Math.PI / 4;
      const bar = (t, fill, ox, oy) => {
        t.save();
        t.translate(x + ox, y + oy);
        t.rotate(a);
        t.fillStyle = fill;
        t.fillRect(-8, -2.5, 16, 5);
        t.restore();
      };
      bar(ctx, 'rgba(0,0,0,0.28)', 1.4, 1.6); // cast shadow (top light)
      bar(ctx, 'rgba(255,255,255,0.15)', 0, 0);
      if (bctx) bar(bctx, gray(196, 0.95), 0, 0);
    }
  }
}

// Urban asphalt with aggregate speckle, tar-sealed cracks, repair patches
// and worn painted lane markings.
function paintAsphalt(ctx, S, color, accent, rand, bctx) {
  const base = blend(color, '#17181c', 0.6);
  const fB = shade(ctx, S, base, rand, { grain: 12, amp: 9, temp: 5 });
  if (bctx) bumpFromField(bctx, S, fB, 130, 12, rand, 10);
  // aggregate speckle
  for (let i = 0; i < 420; i++) {
    const light = rand() < 0.55;
    ctx.fillStyle = light
      ? `rgba(210,214,222,${0.05 + rand() * 0.09})`
      : `rgba(0,0,0,${0.08 + rand() * 0.1})`;
    const x = rand() * S;
    const y = rand() * S;
    const r = 0.6 + rand() * 1.1;
    ctx.fillRect(x, y, r, r);
    if (bctx && light && rand() < 0.4) {
      bctx.fillStyle = gray(150, 0.5);
      bctx.fillRect(x, y, r, r);
    }
  }
  // repair patches
  for (let i = 0; i < 2; i++) {
    const w = 90 + rand() * 150;
    const h = 70 + rand() * 120;
    const x = rand() * (S - w);
    const y = rand() * (S - h);
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = 10;
    ctx.fillStyle = css(base, 0.78, 0.35);
    ctx.fillRect(x, y, w, h);
    ctx.restore();
    ctx.strokeStyle = 'rgba(0,0,0,0.18)';
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, w, h);
    if (bctx) {
      bctx.fillStyle = gray(122, 0.7);
      bctx.fillRect(x, y, w, h);
    }
  }
  // tar-sealed cracks with a faint sheen
  for (let i = 0; i < 5; i++) {
    const pts = crackPts(S, rand, rand() * S, rand() * S, rand() * Math.PI * 2);
    strokeTaper(ctx, pts, 'rgba(6,7,8,0.6)', 3, 1);
    strokeTaper(ctx, pts.map(([px, py]) => [px, py - 1]), 'rgba(255,255,255,0.04)', 1, 0.4);
    if (bctx) strokeTaper(bctx, pts, gray(88, 0.8), 3, 1);
  }
  // worn painted markings: dashed center line + accent-tinted zone edge
  const lx = S / 2;
  for (let yD = 0; yD < S; yD += 128) {
    ctx.fillStyle = 'rgba(216,212,196,0.6)';
    ctx.fillRect(lx - 7, yD + 16, 14, 64);
    if (bctx) {
      bctx.fillStyle = gray(140, 0.5);
      bctx.fillRect(lx - 7, yD + 16, 14, 64);
    }
  }
  ctx.fillStyle = css(accent, 0.8, 0.16);
  ctx.fillRect(S * 0.12 - 3, 0, 6, S);
  for (let i = 0; i < 110; i++) { // wear the paint back down to asphalt
    const onEdge = rand() < 0.25;
    const x = onEdge ? S * 0.12 - 4 + rand() * 8 : lx - 8 + rand() * 16;
    const y = rand() * S;
    ctx.fillStyle = css(base, 0.8 + rand() * 0.4, 0.5);
    ctx.fillRect(x, y, 1.5 + rand() * 3, 1.5 + rand() * 3);
  }
  stains(ctx, S, rand, 3, '10,9,8', 0.24, 0.16); // oil
  stains(ctx, S, rand, 4, '0,0,0', 0.12);
}

// ------------------------------------------------------------ public API

const EMISSIVE_KINDS = new Set(['neon', 'floor_neon', 'accent', 'panel_glass']);
const BUMP_KINDS = new Set([
  'concrete', 'plaster', 'brick', 'brick_ruin', 'sandstone', 'neon', 'panel_glass',
  'ice', 'moss', 'metal', 'asphalt',
  'floor_concrete', 'floor_stone', 'floor_moss', 'floor_metal', 'floor_ice',
]);

// Themed surface. Returns { map, emissiveMap|null, bumpMap|null } — always
// fresh texture objects (safe to dispose via clearScene), backed by cached
// canvases. Painters are deterministic per cache key.
export function surfaceTexture(kind, colorHex, accentHex = '#ffffff', opts = {}) {
  const key = `surf:${kind}:${colorHex}:${accentHex}:${JSON.stringify(opts)}`;
  let entry = canvasCache.get(key);
  if (!entry) {
    const S = kind === 'facade' ? 256 : 512;
    const c = makeCanvas(S);
    const ctx = c.getContext('2d');
    const rand = mulberry32(hashStr(key));
    let em = null;
    let emCtx = null;
    if (EMISSIVE_KINDS.has(kind)) {
      em = makeCanvas(S);
      emCtx = em.getContext('2d');
      emCtx.fillStyle = '#000';
      emCtx.fillRect(0, 0, S, S);
    }
    let bump = null;
    let bctx = null;
    if (BUMP_KINDS.has(kind)) {
      bump = makeCanvas(S);
      bctx = bump.getContext('2d');
      bctx.fillStyle = 'rgb(128,128,128)';
      bctx.fillRect(0, 0, S, S);
    }
    switch (kind) {
      case 'concrete': paintConcrete(ctx, S, colorHex, rand, bctx); break;
      case 'plaster': paintPlaster(ctx, S, colorHex, accentHex, rand, bctx); break;
      case 'brick': paintBricks(ctx, S, colorHex, rand, false, bctx); break;
      case 'brick_ruin': paintBricks(ctx, S, colorHex, rand, true, bctx); break;
      case 'sandstone': paintSandstone(ctx, S, colorHex, rand, !!opts.floor, bctx); break;
      case 'neon': paintNeon(ctx, S, colorHex, accentHex, rand, emCtx, bctx); break;
      case 'panel_glass': paintPanelGlass(ctx, S, colorHex, accentHex, rand, emCtx, bctx); break;
      case 'ice': paintIce(ctx, S, colorHex, rand, bctx); break;
      case 'moss': paintMoss(ctx, S, colorHex, accentHex, rand, bctx); break;
      case 'metal': paintMetal(ctx, S, colorHex, rand, bctx); break;
      case 'accent': paintAccent(ctx, S, colorHex, rand, emCtx); break;
      case 'facade': paintFacade(ctx, S, colorHex, accentHex, rand, opts.density ?? 0.3); break;
      case 'asphalt': paintAsphalt(ctx, S, colorHex, accentHex, rand, bctx); break;
      case 'floor_concrete': paintFloorConcrete(ctx, S, colorHex, rand, bctx); break;
      case 'floor_stone': paintFloorStone(ctx, S, colorHex, rand, bctx); break;
      case 'floor_neon': paintFloorNeon(ctx, S, colorHex, accentHex, rand, emCtx); break;
      case 'floor_ice': paintFloorIce(ctx, S, colorHex, rand, bctx); break;
      case 'floor_moss': paintFloorMoss(ctx, S, colorHex, accentHex, rand, bctx); break;
      case 'floor_metal': paintFloorMetal(ctx, S, colorHex, rand, bctx); break;
      default: paintConcrete(ctx, S, colorHex, rand, bctx); break;
    }
    entry = { color: c, emissive: em, bump };
    canvasCache.set(key, entry);
  }
  return {
    map: texFromCanvas(entry.color),
    emissiveMap: entry.emissive ? texFromCanvas(entry.emissive) : null,
    bumpMap: entry.bump ? texFromCanvas(entry.bump, { srgb: false }) : null,
  };
}

// Generic tile texture (legacy-compatible: noise + grid lines).
export function tileTexture(colorHex, opts = {}) {
  const key = `tile:${colorHex}:${JSON.stringify(opts)}`;
  let entry = canvasCache.get(key);
  if (!entry) {
    const S = 256;
    const c = makeCanvas(S);
    const ctx = c.getContext('2d');
    const rand = mulberry32(hashStr(key));
    shade(ctx, S, colorHex, rand, { grain: opts.grain ?? 22, amp: 8, temp: 5, octaves: 3 });
    const tiles = opts.tiles ?? 4;
    ctx.strokeStyle = opts.line ?? 'rgba(0,0,0,0.28)';
    ctx.lineWidth = opts.lineWidth ?? 2;
    const s = S / tiles;
    for (let i = 0; i <= tiles; i++) {
      ctx.beginPath();
      ctx.moveTo(i * s, 0);
      ctx.lineTo(i * s, S);
      ctx.moveTo(0, i * s);
      ctx.lineTo(S, i * s);
      ctx.stroke();
    }
    entry = { color: c, emissive: null, bump: null };
    canvasCache.set(key, entry);
  }
  return texFromCanvas(entry.color);
}

// Soft radial glow (white -> transparent) for additive discs / halos.
export function glowTexture() {
  const key = 'glow';
  let entry = canvasCache.get(key);
  if (!entry) {
    const S = 128;
    const c = makeCanvas(S);
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.4, 'rgba(255,255,255,0.45)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
    entry = { color: c, emissive: null, bump: null };
    canvasCache.set(key, entry);
  }
  const t = texFromCanvas(entry.color, { wrap: false });
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

// Floating site letter: glowing ring + letter with halo.
export function letterTexture(letter, accentHex = '#ffd166') {
  const key = `letter:${letter}:${accentHex}`;
  let entry = canvasCache.get(key);
  if (!entry) {
    const S = 256;
    const c = makeCanvas(S);
    const ctx = c.getContext('2d');
    // dark backing disc for contrast against bright skies
    let g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S * 0.48);
    g.addColorStop(0, 'rgba(4,8,12,0.66)');
    g.addColorStop(0.75, 'rgba(4,8,12,0.4)');
    g.addColorStop(1, 'rgba(4,8,12,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
    // outer halo
    g = ctx.createRadialGradient(S / 2, S / 2, S * 0.3, S / 2, S / 2, S * 0.5);
    g.addColorStop(0, css(accentHex, 1, 0));
    g.addColorStop(0.8, css(accentHex, 1, 0.22));
    g.addColorStop(1, css(accentHex, 1, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
    // ring
    ctx.strokeStyle = css(accentHex, 1.15, 0.95);
    ctx.lineWidth = 6;
    ctx.shadowColor = css(accentHex, 1, 1);
    ctx.shadowBlur = 16;
    ctx.beginPath();
    ctx.arc(S / 2, S / 2, S * 0.36, 0, Math.PI * 2);
    ctx.stroke();
    // letter
    ctx.font = '900 130px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowBlur = 26;
    ctx.fillStyle = '#ffffff';
    ctx.fillText(letter, S / 2, S / 2 + 8);
    ctx.shadowBlur = 0;
    ctx.strokeStyle = css(accentHex, 0.6, 0.9);
    ctx.lineWidth = 3;
    ctx.strokeText(letter, S / 2, S / 2 + 8);
    entry = { color: c, emissive: null, bump: null };
    canvasCache.set(key, entry);
  }
  const t = texFromCanvas(entry.color, { wrap: false });
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}
