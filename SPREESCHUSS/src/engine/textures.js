import * as THREE from 'three';

// =====================================================================
// Procedural canvas textures — the game ships with NO external assets.
//
// Caching strategy (important for clearScene() compatibility):
//  - Canvases are cached CPU-side and painted only once per unique key.
//  - Every call returns a FRESH THREE.CanvasTexture wrapping the cached
//    canvas, because clearScene() disposes every texture found on scene
//    materials between matches. A disposed clone never poisons the cache.
//  - Sky textures are the one exception: scene.background/environment
//    are never disposed by clearScene(), so live texture instances are
//    cached and reused across matches (also keeps the PMREM env cached).
// All canvases are <= 512px.
// =====================================================================

const canvasCache = new Map(); // key -> { color:canvas, emissive:canvas|null }
const skyCache = new Map();    // key -> THREE.CanvasTexture (never disposed)

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

function texFromCanvas(c, { wrap = true, srgb = true, aniso = 4 } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (wrap) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso; // renderer clamps to hardware max
  return t;
}

// ---------------------------------------------------------------- painters

function pixelNoise(ctx, S, hex, variance, rand) {
  const base = srgb(hex);
  const img = ctx.getImageData(0, 0, S, S);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rand() - 0.5) * variance;
    d[i] = c255(base[0] + n);
    d[i + 1] = c255(base[1] + n);
    d[i + 2] = c255(base[2] + n);
    d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

function stains(ctx, S, rand, n, color, maxA = 0.16, maxR = 0.35) {
  for (let i = 0; i < n; i++) {
    const x = rand() * S; const y = rand() * S; const r = (0.1 + rand() * maxR) * S;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color.replace('%A%', (rand() * maxA).toFixed(3)));
    g.addColorStop(1, color.replace('%A%', '0'));
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
}

function cracks(ctx, S, rand, n, stroke, width = 1) {
  ctx.strokeStyle = stroke;
  ctx.lineWidth = width;
  for (let i = 0; i < n; i++) {
    let x = rand() * S; let y = rand() * S;
    ctx.beginPath();
    ctx.moveTo(x, y);
    const segs = 3 + Math.floor(rand() * 4);
    for (let s2 = 0; s2 < segs; s2++) {
      x += (rand() - 0.5) * S * 0.22;
      y += (rand() - 0.2) * S * 0.2;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

function paintConcrete(ctx, S, color, rand) {
  pixelNoise(ctx, S, color, 20, rand);
  // 2x2 large panels with seams + bevel
  const P = S / 2;
  for (let px = 0; px <= 2; px++) {
    ctx.fillStyle = 'rgba(0,0,0,0.34)';
    ctx.fillRect(px * P - 1.5, 0, 3, S);
    ctx.fillRect(0, px * P - 1.5, S, 3);
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.fillRect(px * P + 1.5, 0, 1, S);
    ctx.fillRect(0, px * P + 1.5, S, 1);
  }
  // bolts near panel corners
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  for (let px = 0; px < 2; px++) {
    for (let py = 0; py < 2; py++) {
      for (const [ox, oy] of [[10, 10], [P - 10, 10], [10, P - 10], [P - 10, P - 10]]) {
        ctx.beginPath();
        ctx.arc(px * P + ox, py * P + oy, 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  stains(ctx, S, rand, 5, 'rgba(0,0,0,%A%)', 0.18);
  cracks(ctx, S, rand, 2, 'rgba(0,0,0,0.18)');
}

function paintBricks(ctx, S, color, rand, ruined = false) {
  pixelNoise(ctx, S, color, 14, rand);
  const rows = 6;
  const cols = 3;
  const bh = S / rows;
  const bw = S / cols;
  for (let r = 0; r < rows; r++) {
    const off = (r % 2) * bw * 0.5;
    for (let cI = -1; cI < cols; cI++) {
      const x = cI * bw + off;
      const jitter = (rand() - 0.5) * 0.26;
      ctx.fillStyle = css(color, 0.86 + jitter + (ruined ? (rand() - 0.5) * 0.2 : 0), 0.55);
      ctx.fillRect(x + 2, r * bh + 2, bw - 4, bh - 4);
      // top-light bevel
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fillRect(x + 2, r * bh + 2, bw - 4, 2);
    }
    // mortar lines
    ctx.fillStyle = 'rgba(0,0,0,0.38)';
    ctx.fillRect(0, r * bh - 1, S, 2.5);
    for (let cI = 0; cI <= cols; cI++) {
      ctx.fillRect(((cI * bw + off) % S) - 1, r * bh, 2.5, bh);
    }
  }
  if (ruined) {
    // chipped corners + heavy cracks + dark weathering
    for (let i = 0; i < 14; i++) {
      ctx.fillStyle = `rgba(0,0,0,${0.12 + rand() * 0.2})`;
      const x = rand() * S; const y = rand() * S;
      ctx.beginPath();
      ctx.ellipse(x, y, 3 + rand() * 9, 2 + rand() * 6, rand() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
    cracks(ctx, S, rand, 5, 'rgba(0,0,0,0.35)', 1.4);
    stains(ctx, S, rand, 6, 'rgba(20,14,6,%A%)', 0.22);
  } else {
    stains(ctx, S, rand, 4, 'rgba(0,0,0,%A%)', 0.12);
  }
}

// dark tech panels + accent light seams; returns emissive companion
function paintNeon(ctx, S, color, accent, rand, emCtx) {
  pixelNoise(ctx, S, color, 12, rand);
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(0, 0, S, S);
  const P = S / 4;
  // panel seams
  for (let i = 0; i <= 4; i++) {
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(i * P - 1, 0, 2, S);
    ctx.fillRect(0, i * P - 1, S, 2);
    ctx.fillStyle = css(color, 1.5, 0.25);
    ctx.fillRect(i * P + 1, 0, 1, S);
    ctx.fillRect(0, i * P + 1, S, 1);
  }
  // choose glowing seam segments once, draw on BOTH canvases so the
  // emissive map stays perfectly aligned with the color map
  const segs = [];
  for (let i = 0; i < 7; i++) {
    const vert = rand() > 0.5;
    const line = Math.floor(rand() * 5) * P;
    const a = rand() * S * 0.6;
    const b = a + S * (0.2 + rand() * 0.5);
    segs.push({ vert, line, a, b });
  }
  const dots = [];
  for (let i = 0; i < 10; i++) dots.push({ x: rand() * S, y: rand() * S, r: 1.2 + rand() * 1.6 });
  for (const target of [ctx, emCtx]) {
    target.save();
    target.strokeStyle = css(accent, 1.0, 0.95);
    target.shadowColor = css(accent, 1, 1);
    target.shadowBlur = 7;
    target.lineWidth = 2;
    for (const s2 of segs) {
      target.beginPath();
      if (s2.vert) { target.moveTo(s2.line, s2.a); target.lineTo(s2.line, s2.b); }
      else { target.moveTo(s2.a, s2.line); target.lineTo(s2.b, s2.line); }
      target.stroke();
    }
    target.fillStyle = css(accent, 1.15, 1);
    for (const d of dots) {
      target.beginPath();
      target.arc(d.x, d.y, d.r, 0, Math.PI * 2);
      target.fill();
    }
    target.restore();
  }
}

function paintIce(ctx, S, color, rand) {
  pixelNoise(ctx, S, color, 8, rand);
  // vertical sheen bands
  for (let i = 0; i < 5; i++) {
    const x = rand() * S; const w2 = 20 + rand() * 60;
    const g = ctx.createLinearGradient(x, 0, x + w2, 0);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.5, `rgba(255,255,255,${0.05 + rand() * 0.08})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x, 0, w2, S);
  }
  cracks(ctx, S, rand, 6, 'rgba(255,255,255,0.22)', 1);
  cracks(ctx, S, rand, 3, 'rgba(30,60,90,0.18)', 1.6);
  // sparkles
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  for (let i = 0; i < 26; i++) {
    ctx.globalAlpha = 0.2 + rand() * 0.5;
    ctx.fillRect(rand() * S, rand() * S, 1.4, 1.4);
  }
  ctx.globalAlpha = 1;
}

function paintMoss(ctx, S, color, accent, rand) {
  paintConcrete(ctx, S, color, rand);
  // moss patches, denser near the bottom edge
  const mossCol = new THREE.Color(accent).lerp(new THREE.Color('#2c4a1e'), 0.55);
  const mossHex = `#${mossCol.getHexString()}`;
  for (let i = 0; i < 16; i++) {
    const x = rand() * S;
    const y = S - rand() * rand() * S;
    const r = 8 + rand() * 26;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, css(mossHex, 0.9, 0.5));
    g.addColorStop(1, css(mossHex, 0.9, 0));
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // drip streaks
  for (let i = 0; i < 7; i++) {
    const x = rand() * S; const y = rand() * S * 0.5;
    const g = ctx.createLinearGradient(0, y, 0, y + 40 + rand() * 60);
    g.addColorStop(0, 'rgba(10,20,8,0.22)');
    g.addColorStop(1, 'rgba(10,20,8,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, 2 + rand() * 3, 100);
  }
}

function paintMetal(ctx, S, color, rand) {
  pixelNoise(ctx, S, color, 10, rand);
  ctx.fillStyle = 'rgba(0,0,0,0.14)';
  ctx.fillRect(0, 0, S, S);
  // horizontal brushed streaks
  for (let i = 0; i < 40; i++) {
    ctx.fillStyle = `rgba(255,255,255,${rand() * 0.05})`;
    ctx.fillRect(0, rand() * S, S, 1);
    ctx.fillStyle = `rgba(0,0,0,${rand() * 0.08})`;
    ctx.fillRect(0, rand() * S, S, 1);
  }
  // plates 2 wide x 3 high with rivets
  const pw = S / 2; const ph = S / 3;
  for (let px = 0; px <= 2; px++) { ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.fillRect(px * pw - 1, 0, 3, S); }
  for (let py = 0; py <= 3; py++) { ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.fillRect(0, py * ph - 1, S, 3); }
  ctx.fillStyle = 'rgba(220,220,230,0.35)';
  for (let px = 0; px < 2; px++) {
    for (let py = 0; py < 3; py++) {
      for (let i = 0; i < 5; i++) {
        const t2 = (i + 0.5) / 5;
        ctx.beginPath(); ctx.arc(px * pw + t2 * pw, py * ph + 6, 1.6, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(px * pw + 6, py * ph + t2 * ph, 1.6, 0, Math.PI * 2); ctx.fill();
      }
    }
  }
  // scratches
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 8; i++) {
    const x = rand() * S; const y = rand() * S;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (rand() - 0.5) * 50, y + (rand() - 0.5) * 30); ctx.stroke();
  }
}

// bright framed panel for accent (emissive) boxes; emissive companion is a
// grayscale mask: hot center panel, dark frame
function paintAccent(ctx, S, color, rand, emCtx) {
  pixelNoise(ctx, S, color, 16, rand);
  const B = 18; // frame width
  ctx.fillStyle = css(color, 0.32);
  ctx.fillRect(0, 0, S, B); ctx.fillRect(0, S - B, S, B);
  ctx.fillRect(0, 0, B, S); ctx.fillRect(S - B, 0, B, S);
  ctx.strokeStyle = css(color, 1.6, 0.8);
  ctx.lineWidth = 2;
  ctx.strokeRect(B, B, S - 2 * B, S - 2 * B);
  // diagonal energy lines in the hot panel
  ctx.save();
  ctx.beginPath(); ctx.rect(B, B, S - 2 * B, S - 2 * B); ctx.clip();
  ctx.strokeStyle = css(color, 1.35, 0.5);
  ctx.lineWidth = 5;
  for (let i = -6; i < 12; i++) {
    ctx.beginPath(); ctx.moveTo(i * 32, S); ctx.lineTo(i * 32 + S, 0); ctx.stroke();
  }
  ctx.restore();
  // emissive mask
  const g = emCtx.createRadialGradient(S / 2, S / 2, S * 0.1, S / 2, S / 2, S * 0.7);
  g.addColorStop(0, 'rgb(255,255,255)');
  g.addColorStop(1, 'rgb(120,120,120)');
  emCtx.fillStyle = g;
  emCtx.fillRect(0, 0, S, S);
  emCtx.fillStyle = 'rgb(18,18,18)';
  emCtx.fillRect(0, 0, S, B); emCtx.fillRect(0, S - B, S, B);
  emCtx.fillRect(0, 0, B, S); emCtx.fillRect(S - B, 0, B, S);
}

// building facade: dark base + grid of windows (some lit). Used as both
// color map and emissive map on skyline silhouettes.
function paintFacade(ctx, S, color, accent, rand, density) {
  pixelNoise(ctx, S, `#${new THREE.Color(color).multiplyScalar(0.24).getHexString()}`, 8, rand);
  const cols = 6; const rows = 9;
  const cw = S / cols; const rh = S / rows;
  const palette = ['#ffd9a0', '#ffeecb', '#bfe3ff', accent];
  for (let r = 0; r < rows; r++) {
    // floor separator
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(0, r * rh - 1, S, 2);
    for (let cI = 0; cI < cols; cI++) {
      const x = cI * cw + cw * 0.22;
      const y = r * rh + rh * 0.2;
      const ww = cw * 0.56; const wh = rh * 0.55;
      if (rand() < density) {
        const wc = palette[Math.floor(rand() * palette.length)];
        ctx.fillStyle = css(wc, 0.75 + rand() * 0.45);
        ctx.fillRect(x, y, ww, wh);
      } else {
        ctx.fillStyle = 'rgba(8,10,14,0.85)';
        ctx.fillRect(x, y, ww, wh);
      }
    }
  }
}

// -------------------------------------------------------------- floors

function paintFloorConcrete(ctx, S, color, rand) {
  pixelNoise(ctx, S, color, 18, rand);
  const P = S / 2;
  for (let i = 0; i <= 2; i++) {
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(i * P - 2, 0, 4, S);
    ctx.fillRect(0, i * P - 2, S, 4);
  }
  // faint inner grid
  ctx.strokeStyle = 'rgba(0,0,0,0.10)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 8; i++) {
    ctx.beginPath(); ctx.moveTo(i * S / 8, 0); ctx.lineTo(i * S / 8, S); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i * S / 8); ctx.lineTo(S, i * S / 8); ctx.stroke();
  }
  stains(ctx, S, rand, 6, 'rgba(0,0,0,%A%)', 0.2);
  cracks(ctx, S, rand, 3, 'rgba(0,0,0,0.2)');
}

function paintFloorStone(ctx, S, color, rand) {
  pixelNoise(ctx, S, color, 14, rand);
  const n = 4;
  const cs = S / n;
  for (let gx = 0; gx < n; gx++) {
    for (let gy = 0; gy < n; gy++) {
      const jx = (rand() - 0.5) * 8; const jy = (rand() - 0.5) * 8;
      ctx.fillStyle = css(color, 0.82 + rand() * 0.3, 0.5);
      ctx.fillRect(gx * cs + 3 + jx, gy * cs + 3 + jy, cs - 6, cs - 6);
      ctx.strokeStyle = 'rgba(0,0,0,0.42)';
      ctx.lineWidth = 3;
      ctx.strokeRect(gx * cs + jx, gy * cs + jy, cs, cs);
    }
  }
  stains(ctx, S, rand, 5, 'rgba(30,20,8,%A%)', 0.2);
  cracks(ctx, S, rand, 3, 'rgba(0,0,0,0.25)');
}

function paintFloorNeon(ctx, S, color, accent, rand, emCtx) {
  pixelNoise(ctx, S, color, 10, rand);
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(0, 0, S, S);
  const n = 8; const cs = S / n;
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  ctx.lineWidth = 2;
  for (let i = 0; i <= n; i++) {
    ctx.beginPath(); ctx.moveTo(i * cs, 0); ctx.lineTo(i * cs, S); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i * cs); ctx.lineTo(S, i * cs); ctx.stroke();
  }
  const dots = [];
  for (let i = 0; i < 12; i++) {
    dots.push({ x: Math.floor(rand() * (n + 1)) * cs, y: Math.floor(rand() * (n + 1)) * cs });
  }
  for (const target of [ctx, emCtx]) {
    target.save();
    target.fillStyle = css(accent, 1.0, 0.9);
    target.shadowColor = css(accent, 1, 1);
    target.shadowBlur = 6;
    for (const d of dots) {
      target.beginPath(); target.arc(d.x, d.y, 2, 0, Math.PI * 2); target.fill();
    }
    target.restore();
  }
}

function paintFloorIce(ctx, S, color, rand) {
  pixelNoise(ctx, S, color, 6, rand);
  for (let i = 0; i < 6; i++) {
    const x = rand() * S; const y = rand() * S; const r = 30 + rand() * 70;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(255,255,255,${0.04 + rand() * 0.08})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  cracks(ctx, S, rand, 8, 'rgba(255,255,255,0.25)', 1.2);
  cracks(ctx, S, rand, 4, 'rgba(20,50,80,0.2)', 2);
}

function paintFloorMoss(ctx, S, color, accent, rand) {
  paintFloorConcrete(ctx, S, color, rand);
  const mossCol = new THREE.Color(accent).lerp(new THREE.Color('#243c16'), 0.6);
  const mossHex = `#${mossCol.getHexString()}`;
  for (let i = 0; i < 12; i++) {
    const x = rand() * S; const y = rand() * S; const r = 10 + rand() * 32;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, css(mossHex, 1, 0.45));
    g.addColorStop(1, css(mossHex, 1, 0));
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // dark puddles
  for (let i = 0; i < 4; i++) {
    ctx.fillStyle = 'rgba(6,14,8,0.4)';
    ctx.beginPath();
    ctx.ellipse(rand() * S, rand() * S, 14 + rand() * 26, 8 + rand() * 16, rand() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
}

function paintFloorMetal(ctx, S, color, rand) {
  paintMetal(ctx, S, color, rand);
  // tread dots
  ctx.fillStyle = 'rgba(255,255,255,0.10)';
  const step = S / 16;
  for (let gx = 0; gx < 16; gx++) {
    for (let gy = 0; gy < 16; gy++) {
      if ((gx + gy) % 2 === 0) ctx.fillRect(gx * step + step * 0.35, gy * step + step * 0.35, 3, 3);
    }
  }
}

// ------------------------------------------------------------ public API

// Themed surface. Returns { map, emissiveMap|null } — always fresh texture
// objects (safe to dispose via clearScene), backed by cached canvases.
export function surfaceTexture(kind, colorHex, accentHex = '#ffffff', opts = {}) {
  const key = `surf:${kind}:${colorHex}:${accentHex}:${JSON.stringify(opts)}`;
  let entry = canvasCache.get(key);
  if (!entry) {
    const S = 256;
    const c = makeCanvas(S);
    const ctx = c.getContext('2d');
    const rand = mulberry32(hashStr(key));
    let em = null;
    let emCtx = null;
    const needsEmissive = kind === 'neon' || kind === 'floor_neon' || kind === 'accent';
    if (needsEmissive) {
      em = makeCanvas(S);
      emCtx = em.getContext('2d');
      emCtx.fillStyle = '#000';
      emCtx.fillRect(0, 0, S, S);
    }
    switch (kind) {
      case 'concrete': paintConcrete(ctx, S, colorHex, rand); break;
      case 'brick': paintBricks(ctx, S, colorHex, rand, false); break;
      case 'brick_ruin': paintBricks(ctx, S, colorHex, rand, true); break;
      case 'neon': paintNeon(ctx, S, colorHex, accentHex, rand, emCtx); break;
      case 'ice': paintIce(ctx, S, colorHex, rand); break;
      case 'moss': paintMoss(ctx, S, colorHex, accentHex, rand); break;
      case 'metal': paintMetal(ctx, S, colorHex, rand); break;
      case 'accent': paintAccent(ctx, S, colorHex, rand, emCtx); break;
      case 'facade': paintFacade(ctx, S, colorHex, accentHex, rand, opts.density ?? 0.3); break;
      case 'floor_concrete': paintFloorConcrete(ctx, S, colorHex, rand); break;
      case 'floor_stone': paintFloorStone(ctx, S, colorHex, rand); break;
      case 'floor_neon': paintFloorNeon(ctx, S, colorHex, accentHex, rand, emCtx); break;
      case 'floor_ice': paintFloorIce(ctx, S, colorHex, rand); break;
      case 'floor_moss': paintFloorMoss(ctx, S, colorHex, accentHex, rand); break;
      case 'floor_metal': paintFloorMetal(ctx, S, colorHex, rand); break;
      default: paintConcrete(ctx, S, colorHex, rand); break;
    }
    entry = { color: c, emissive: em };
    canvasCache.set(key, entry);
  }
  return {
    map: texFromCanvas(entry.color),
    emissiveMap: entry.emissive ? texFromCanvas(entry.emissive) : null,
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
    pixelNoise(ctx, S, colorHex, opts.grain ?? 22, rand);
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
    entry = { color: c, emissive: null };
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
    entry = { color: c, emissive: null };
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
    entry = { color: c, emissive: null };
    canvasCache.set(key, entry);
  }
  const t = texFromCanvas(entry.color, { wrap: false });
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
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
