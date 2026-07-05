// Procedurally generated Spreeschuss logo (canvas only, no external assets).
// Crosshair-in-shield mark with a Spree "river" cut. Renders at device pixel
// ratio so it stays crisp on high-DPI screens.
export function makeLogoCanvas(size = 320) {
  const dpr = Math.min(3, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
  const c = document.createElement('canvas');
  c.width = Math.round(size * dpr);
  c.height = Math.round(size * dpr);
  c.style.width = size + 'px';
  c.style.height = size + 'px';
  const ctx = c.getContext('2d');
  ctx.scale(dpr, dpr);

  const cx = size / 2;
  const cy = size / 2;

  // --- ambient glow behind the mark
  const glow = ctx.createRadialGradient(cx, cy, size * 0.04, cx, cy, size * 0.52);
  glow.addColorStop(0, 'rgba(67,183,199,0.38)');
  glow.addColorStop(0.6, 'rgba(67,183,199,0.10)');
  glow.addColorStop(1, 'rgba(10,20,30,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, size, size);

  const hexPath = (r) => {
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 3) * i - Math.PI / 2;
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
  };

  // --- hex shield body
  const R = size * 0.38;
  hexPath(R);
  const body = ctx.createLinearGradient(cx - R, cy - R, cx + R, cy + R);
  body.addColorStop(0, '#122a3d');
  body.addColorStop(0.55, '#0c1d2c');
  body.addColorStop(1, '#1d4152');
  ctx.fillStyle = body;
  ctx.fill();

  // Spree river: a soft diagonal band across the shield interior.
  ctx.save();
  hexPath(R * 0.96);
  ctx.clip();
  const band = ctx.createLinearGradient(cx - R, cy + R * 0.55, cx + R, cy - R * 0.55);
  band.addColorStop(0, 'rgba(67,183,199,0)');
  band.addColorStop(0.5, 'rgba(67,183,199,0.30)');
  band.addColorStop(1, 'rgba(67,183,199,0)');
  ctx.fillStyle = band;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-Math.PI / 7);
  ctx.fillRect(-R * 1.4, -R * 0.16, R * 2.8, R * 0.32);
  // thin bright core line of the river
  ctx.fillStyle = 'rgba(127,224,255,0.5)';
  ctx.fillRect(-R * 1.4, -size * 0.006, R * 2.8, size * 0.012);
  ctx.restore();
  ctx.restore();

  // --- double shield stroke (outer bold, inner hairline)
  ctx.lineJoin = 'round';
  hexPath(R);
  ctx.lineWidth = size * 0.022;
  ctx.strokeStyle = '#43b7c7';
  ctx.shadowColor = 'rgba(67,183,199,0.55)';
  ctx.shadowBlur = size * 0.04;
  ctx.stroke();
  ctx.shadowBlur = 0;
  hexPath(R * 0.88);
  ctx.lineWidth = size * 0.006;
  ctx.strokeStyle = 'rgba(127,224,255,0.35)';
  ctx.stroke();

  // corner rivets on the outer hex
  ctx.fillStyle = '#7fe0ff';
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i - Math.PI / 2;
    ctx.beginPath();
    ctx.arc(cx + Math.cos(a) * R, cy + Math.sin(a) * R, size * 0.011, 0, Math.PI * 2);
    ctx.fill();
  }

  // --- crosshair: four ticks with flared tips + fine ring
  ctx.save();
  ctx.translate(cx, cy);
  ctx.lineCap = 'round';

  // fine targeting ring
  ctx.beginPath();
  ctx.arc(0, 0, size * 0.155, 0, Math.PI * 2);
  ctx.lineWidth = size * 0.008;
  ctx.strokeStyle = 'rgba(255,209,102,0.45)';
  ctx.stroke();
  // ring tick marks at 45°
  ctx.strokeStyle = 'rgba(255,209,102,0.7)';
  ctx.lineWidth = size * 0.008;
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (Math.PI / 2) * i;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * size * 0.135, Math.sin(a) * size * 0.135);
    ctx.lineTo(Math.cos(a) * size * 0.175, Math.sin(a) * size * 0.175);
    ctx.stroke();
  }

  // main crosshair arms
  const gap = size * 0.055;
  const len = size * 0.155;
  ctx.strokeStyle = '#ffd166';
  ctx.shadowColor = 'rgba(255,209,102,0.6)';
  ctx.shadowBlur = size * 0.025;
  const arm = (dx, dy) => {
    ctx.beginPath();
    ctx.lineWidth = size * 0.022;
    ctx.moveTo(dx * gap, dy * gap);
    ctx.lineTo(dx * (gap + len), dy * (gap + len));
    ctx.stroke();
    // flared tip
    ctx.beginPath();
    ctx.lineWidth = size * 0.036;
    ctx.moveTo(dx * (gap + len * 0.72), dy * (gap + len * 0.72));
    ctx.lineTo(dx * (gap + len), dy * (gap + len));
    ctx.stroke();
  };
  arm(0, -1); arm(0, 1); arm(-1, 0); arm(1, 0);
  ctx.shadowBlur = 0;

  // center dot with white core
  ctx.beginPath();
  ctx.arc(0, 0, size * 0.030, 0, Math.PI * 2);
  ctx.fillStyle = '#ff5a4a';
  ctx.shadowColor = 'rgba(255,90,74,0.8)';
  ctx.shadowBlur = size * 0.03;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.beginPath();
  ctx.arc(-size * 0.008, -size * 0.008, size * 0.010, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fill();
  ctx.restore();

  return c;
}

export function logoDataURL(size = 320) {
  return makeLogoCanvas(size).toDataURL('image/png');
}

// ================================================================ shared icons
// Inline-SVG ability icons keyed by ability `type` (the existing 10-type set).
// Shared by menu (agent detail) and HUD (ability bar / buy menu).
const svgIcon = (body, vb = '0 0 14 14') => `<svg viewBox="${vb}" width="14" height="14" aria-hidden="true">${body}</svg>`;

export const ABILITY_ICONS = {
  flash: svgIcon('<path d="M7 0l1.5 5.5L14 7 8.5 8.5 7 14 5.5 8.5 0 7l5.5-1.5z" fill="currentColor"/>'),
  smoke: svgIcon('<circle cx="4" cy="9" r="3" fill="currentColor"/><circle cx="7.2" cy="5.6" r="3.6" fill="currentColor"/><circle cx="10.4" cy="9" r="3" fill="currentColor"/>'),
  molly: svgIcon('<path d="M7 0c1 3 4 4.2 4 8a4 4 0 1 1-8 0c0-2 .9-3.1 1.9-4.2.1 1 .5 1.9 1.2 2.2C6 4 5.6 2 7 0z" fill="currentColor"/>'),
  slow: svgIcon('<path d="M7 0v14M0 7h14M2.2 2.2l9.6 9.6M11.8 2.2 2.2 11.8" stroke="currentColor" stroke-width="1.4" fill="none"/>'),
  wall: svgIcon('<path d="M1 2.5h12v3H1zM1 8.5h5.2v3H1zM7.8 8.5H13v3H7.8z" fill="currentColor"/>'),
  dash: svgIcon('<path d="M1.5 2l5 5-5 5M7.5 2l5 5-5 5" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'),
  heal: svgIcon('<path d="M5 1h4v4h4v4H9v4H5V9H1V5h4z" fill="currentColor"/>'),
  recon: svgIcon('<ellipse cx="7" cy="7" rx="6.2" ry="4" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="7" cy="7" r="2" fill="currentColor"/>'),
  turret: svgIcon('<path d="M5.5 1h3v4.4H13v3H9.8V13H4.2V8.4H1v-3h4.5z" fill="currentColor"/>'),
  trap: svgIcon('<path d="M1 7.5 3.6 3l2 4 1.4-4 1.4 4 2-4L13 7.5V12H1z" fill="currentColor"/>'),
};

// ================================================================ portraits
// Procedural agent portraits: a stylized bust (hooded silhouette + glowing
// visor) drawn from the agent's color and role. Deterministic per agent via a
// small string hash, cached per agent id + size. No external assets.
const PORTRAIT_CACHE = new Map();
const PORTRAIT_URL_CACHE = new Map();

function hashId(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function hexRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mixHex(a, b, t) {
  const ca = hexRgb(a); const cb = hexRgb(b);
  const ch = (i) => Math.round(ca[i] + (cb[i] - ca[i]) * t);
  return `rgb(${ch(0)},${ch(1)},${ch(2)})`;
}

function rgba(hex, alpha) {
  const [r, g, b] = hexRgb(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

export function makeAgentPortrait(agent, size = 96) {
  const key = `${agent.id}@${size}`;
  if (PORTRAIT_CACHE.has(key)) return PORTRAIT_CACHE.get(key);

  const dpr = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
  const c = document.createElement('canvas');
  c.width = Math.round(size * dpr);
  c.height = Math.round(size * dpr);
  c.style.width = size + 'px';
  c.style.height = size + 'px';
  const ctx = c.getContext('2d');
  ctx.scale(dpr, dpr);

  const col = agent.color;
  const h = hashId(agent.id);
  const u = size / 100; // design unit: portrait drawn on a 100x100 grid

  // --- backdrop: dark vertical wash tinted with the agent color
  const bg = ctx.createLinearGradient(0, 0, 0, size);
  bg.addColorStop(0, mixHex(col, '#0a1118', 0.84));
  bg.addColorStop(1, '#070d14');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, size, size);

  // diagonal accent stripes (angle varies per agent)
  ctx.save();
  ctx.translate(50 * u, 50 * u);
  ctx.rotate(-0.45 - (h % 5) * 0.06);
  ctx.fillStyle = rgba(col, 0.07);
  ctx.fillRect(-90 * u, -34 * u, 180 * u, 13 * u);
  ctx.fillStyle = rgba(col, 0.12);
  ctx.fillRect(-90 * u, 26 * u, 180 * u, 7 * u);
  ctx.restore();

  // radial glow behind the head
  const glow = ctx.createRadialGradient(50 * u, 38 * u, 4 * u, 50 * u, 38 * u, 46 * u);
  glow.addColorStop(0, rgba(col, 0.34));
  glow.addColorStop(1, rgba(col, 0));
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, size, size);

  // fine ring behind the bust
  ctx.beginPath();
  ctx.arc(50 * u, 42 * u, 31 * u, 0, Math.PI * 2);
  ctx.strokeStyle = rgba(col, 0.28);
  ctx.lineWidth = Math.max(1, 0.8 * u);
  ctx.stroke();

  // --- bust silhouette (shoulders + neck + hooded head)
  const bust = () => {
    ctx.beginPath();
    ctx.moveTo(7 * u, 101 * u);
    ctx.lineTo(9 * u, 80 * u);
    ctx.bezierCurveTo(11 * u, 66 * u, 24 * u, 59 * u, 37 * u, 56 * u); // left shoulder
    ctx.lineTo(39 * u, 50 * u); // neck left
    ctx.bezierCurveTo(32 * u, 45 * u, 31 * u, 37 * u, 33.5 * u, 29 * u); // left jaw
    ctx.bezierCurveTo(36 * u, 18.5 * u, 64 * u, 18.5 * u, 66.5 * u, 29 * u); // crown
    ctx.bezierCurveTo(69 * u, 37 * u, 68 * u, 45 * u, 61 * u, 50 * u); // right jaw
    ctx.lineTo(63 * u, 56 * u); // neck right
    ctx.bezierCurveTo(76 * u, 59 * u, 89 * u, 66 * u, 91 * u, 80 * u); // right shoulder
    ctx.lineTo(93 * u, 101 * u);
    ctx.closePath();
  };

  bust();
  const body = ctx.createLinearGradient(0, 20 * u, 0, size);
  body.addColorStop(0, '#101b26');
  body.addColorStop(0.55, '#0c151e');
  body.addColorStop(1, '#131f2b');
  ctx.fillStyle = body;
  ctx.fill();

  // rim light inside the silhouette (top-left, in agent color)
  ctx.save();
  bust();
  ctx.clip();
  const rim = ctx.createLinearGradient(10 * u, 8 * u, 74 * u, 86 * u);
  rim.addColorStop(0, rgba(col, 0.32));
  rim.addColorStop(0.4, rgba(col, 0.05));
  rim.addColorStop(1, rgba(col, 0));
  ctx.fillStyle = rim;
  ctx.fillRect(0, 0, size, size);
  // collar seam
  ctx.strokeStyle = rgba(col, 0.4);
  ctx.lineWidth = Math.max(1, 0.9 * u);
  ctx.beginPath();
  ctx.moveTo(37 * u, 62 * u);
  ctx.quadraticCurveTo(50 * u, 69 * u, 63 * u, 62 * u);
  ctx.stroke();
  // shoulder plate stripes (count varies per agent)
  const stripes = 1 + (h % 3);
  ctx.strokeStyle = rgba(col, 0.5);
  ctx.lineWidth = Math.max(1, 1.1 * u);
  for (let i = 0; i < stripes; i++) {
    ctx.beginPath();
    ctx.moveTo((13 + i * 5) * u, 96 * u);
    ctx.lineTo((22 + i * 5) * u, 72 * u);
    ctx.stroke();
  }
  ctx.restore();

  // silhouette edge glow
  bust();
  ctx.strokeStyle = rgba(col, 0.8);
  ctx.lineWidth = Math.max(1, 1.1 * u);
  ctx.shadowColor = rgba(col, 0.55);
  ctx.shadowBlur = 5 * u;
  ctx.stroke();
  ctx.shadowBlur = 0;

  // --- visor: role-specific glowing shape on the head
  const bright = mixHex(col, '#ffffff', 0.5);
  ctx.save();
  ctx.shadowColor = rgba(col, 0.9);
  ctx.shadowBlur = 7 * u;
  ctx.lineCap = 'round';
  const role = agent.role;
  if (role === 'Duellant') {
    // aggressive V-visor
    ctx.strokeStyle = bright;
    ctx.lineWidth = 4.5 * u;
    ctx.beginPath();
    ctx.moveTo(37 * u, 31 * u);
    ctx.lineTo(50 * u, 38 * u);
    ctx.lineTo(63 * u, 31 * u);
    ctx.stroke();
  } else if (role === 'Wächter') {
    // full protective visor band
    ctx.fillStyle = bright;
    const r = 3.4 * u;
    const x = 35 * u; const y = 29.5 * u; const wd = 30 * u; const ht = 8.5 * u;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + wd, y, x + wd, y + ht, r);
    ctx.arcTo(x + wd, y + ht, x, y + ht, r);
    ctx.arcTo(x, y + ht, x, y, r);
    ctx.arcTo(x, y, x + wd, y, r);
    ctx.closePath();
    ctx.fill();
  } else if (role === 'Initiator') {
    // twin recon lenses
    ctx.fillStyle = bright;
    ctx.beginPath(); ctx.arc(42 * u, 33 * u, 4.6 * u, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(58 * u, 33 * u, 4.6 * u, 0, Math.PI * 2); ctx.fill();
  } else {
    // Stratege: thin analytical slit
    ctx.strokeStyle = bright;
    ctx.lineWidth = 3.4 * u;
    ctx.beginPath();
    ctx.moveTo(37 * u, 33 * u);
    ctx.lineTo(63 * u, 33 * u);
    ctx.stroke();
  }
  ctx.restore();
  // white hot core on the visor
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  if (role === 'Initiator') {
    ctx.beginPath(); ctx.arc(41 * u, 32 * u, 1.6 * u, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(57 * u, 32 * u, 1.6 * u, 0, Math.PI * 2); ctx.fill();
  } else {
    ctx.fillRect(44 * u, (role === 'Duellant' ? 33.4 : 32.2) * u, 12 * u, 1.5 * u);
  }

  // antenna variant on some agents
  if (h % 3 === 0) {
    ctx.strokeStyle = rgba(col, 0.85);
    ctx.lineWidth = Math.max(1, 0.9 * u);
    ctx.beginPath();
    ctx.moveTo(64 * u, 22 * u);
    ctx.lineTo(70 * u, 10 * u);
    ctx.stroke();
    ctx.fillStyle = bright;
    ctx.beginPath();
    ctx.arc(70 * u, 9.4 * u, 1.7 * u, 0, Math.PI * 2);
    ctx.fill();
  }

  // chest emblem chevron
  ctx.strokeStyle = rgba(col, 0.85);
  ctx.lineWidth = 1.8 * u;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(44 * u, 78 * u);
  ctx.lineTo(50 * u, 84 * u);
  ctx.lineTo(56 * u, 78 * u);
  ctx.stroke();

  // grounding fade at the bottom edge
  const fade = ctx.createLinearGradient(0, 86 * u, 0, size);
  fade.addColorStop(0, 'rgba(7,13,20,0)');
  fade.addColorStop(1, 'rgba(7,13,20,0.55)');
  ctx.fillStyle = fade;
  ctx.fillRect(0, 86 * u, size, 14 * u);

  PORTRAIT_CACHE.set(key, c);
  return c;
}

// Data-URL variant for use inside innerHTML templates (cached as well).
export function agentPortraitURL(agent, size = 96) {
  const key = `${agent.id}@${size}`;
  if (PORTRAIT_URL_CACHE.has(key)) return PORTRAIT_URL_CACHE.get(key);
  const url = makeAgentPortrait(agent, size).toDataURL('image/png');
  PORTRAIT_URL_CACHE.set(key, url);
  return url;
}
