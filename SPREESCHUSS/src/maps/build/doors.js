import * as THREE from 'three';
import { paletteKey, hashStr, mulberry32, placedBox, mergeInto } from './util.js';

// =====================================================================
// FROZEN INTERFACE — doorway dressing (decoration ONLY).
//
//   addDoorDecor(group, map)
//     Adds decorative dressing around doorway / choke openings (e.g.
//     frame plates, threshold strips, header signage). `group` is the
//     map group, `map` the raw map-data object (map.spawns holds raw
//     [x, z, rot?] arrays; map.boxes the collider boxes; map.sites the
//     raw site data). Openings never gain geometry below 2.4 m that is
//     more than 0.06 proud of the flanking collider faces — doors stay
//     fully passable and hitscan-honest.
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
// IMPLEMENTATION — fake SEALED doors & gates ("inhabited walls").
//
// 3-7 purely decorative door assemblies per map, mounted flat onto
// existing collider faces (grounded interior boxes >= 2.6 m tall whose
// face is >= 2.8 m wide, plus the 4 perimeter walls). Every assembly is
// visibly CLOSED — shutters down, arches bricked, hatches dogged shut —
// so nothing ever reads as a walkable opening:
//   - painted leaf decal (canvas atlas, palette-flavored) at 0.03 proud;
//   - dark half-embedded frame (jambs + header, wallBox pattern) 0.043;
//   - glowing keypad / card-reader face beside the door (emissive-look
//     MeshBasic canvas panel, NO light) + conduit stub;
//   - over-door lamp housing with a small emissive lens (NO light);
//   - stenciled 2-digit door number + warning stripes (leaf overlays +
//     a flat hazard decal on the floor in front, y 0.0132 < rings 0.015).
// Max protrusion 0.05. Fake doors keep >= 1.2 m from every face END so
// they can never sit beside a REAL doorway gap (real openings live
// between boxes), >= 1 m XZ from every spawn, and fully outside site
// ring interiors (only the flat floor stripe may enter nothing anyway).
// A front-probe against the collider volumes rejects spots covered by
// abutting boxes and drops the lamp under low tunnel lintels.
//
// Palette flavor: Neon neon-rimmed sliding doors / Ruins boarded and
// bricked-up arches / Ice frosted bulkhead hatches / Sand wooden gates /
// Toxic hazard airlocks / Spree U-Bahn-style service doors + roller
// shutters / Crimson iron-banded gates.
//
// Draw calls: everything merges into <= 5 meshes (dark structure /
// painted faces / accent glow / lit panels / lamp lenses).
// =====================================================================

// Frozen perimeter dimensions (mirrors structures.js WALL_HEIGHT/THICKNESS).
const PERIM_H = 6;
const PERIM_T = 1;

// Door identity per palette (keyed by util.paletteKey).
const THEMES = {
  Spree:   { frame: '#242e37', body: '#43525f', hazard: '#e8c33a', lamp: '#ffe6b8', frough: 0.55, fmetal: 0.55, sign: 'U' },
  Sand:    { frame: '#4c3a22', body: '#96743f', hazard: '#c04f28', lamp: '#ffdf9e', frough: 0.85, fmetal: 0.05, sign: 'S' },
  Neon:    { frame: '#1a1631', body: '#1c1838', hazard: '#ff3fa4', lamp: '#efd9ff', frough: 0.4,  fmetal: 0.6,  sign: 'N' },
  Ice:     { frame: '#3e576b', body: '#a9c3d3', hazard: '#e07a30', lamp: '#eaf6ff', frough: 0.35, fmetal: 0.45, sign: 'H' },
  Ruins:   { frame: '#3a3126', body: '#6f5642', hazard: '#b9882e', lamp: '#ffc98a', frough: 0.9,  fmetal: 0.05, sign: 'X' },
  Toxic:   { frame: '#2b3a25', body: '#4a5a3e', hazard: '#cdd23a', lamp: '#f2ffc9', frough: 0.6,  fmetal: 0.5,  sign: '!' },
  Crimson: { frame: '#20161a', body: '#3c2528', hazard: '#e0b84a', lamp: '#ffc9a0', frough: 0.55, fmetal: 0.6,  sign: 'K' },
};

// ------------------------------------------------------------ canvases

const canvasCache = new Map(); // key -> canvas (CPU-side, painted once)

function makeCanvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

// css color from hex + brightness multiplier (converted back to sRGB,
// same color-management convention as engine/textures.js / props.js).
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
// Regions are inset 1 px so mipmap sampling never bleeds across cells.
const R = (px, py, pw, ph, S = 256) => ({ u0: px / S, v0: 1 - (py + ph) / S, u1: (px + pw) / S, v1: 1 - py / S });
const REG = {
  gate:   R(1, 1, 126, 126),
  doorA:  R(129, 1, 62, 126),
  doorB:  R(193, 1, 62, 126),
  keypad: R(1, 129, 46, 62),
  reader: R(49, 129, 46, 62),
  plate:  R(97, 129, 62, 62),
  hazard: R(161, 129, 94, 30),
};
const DIGIT = (n) => R(n * 24 + 2, 193, 20, 30);

// diagonal warning stripes clipped to a rect (with optional paint wear)
function hazardBand(ctx, T, x, y, w, h, rnd) {
  ctx.save();
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  for (let i = -1; i < Math.ceil(w / 14) + 2; i++) {
    ctx.fillStyle = i % 2 ? 'rgba(12,12,14,0.9)' : css(T.hazard, 1, 0.9);
    ctx.beginPath();
    ctx.moveTo(x + i * 14, y + h); ctx.lineTo(x + i * 14 + 14, y + h);
    ctx.lineTo(x + i * 14 + 14 + h * 0.7, y); ctx.lineTo(x + i * 14 + h * 0.7, y);
    ctx.closePath(); ctx.fill();
  }
  if (rnd) {
    ctx.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 7; i++) {
      ctx.globalAlpha = 0.3 + rnd() * 0.5;
      ctx.beginPath();
      ctx.ellipse(x + rnd() * w, y + rnd() * h, 1 + rnd() * 4, 1 + rnd() * 2, rnd() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

// One sealed door / gate leaf painted into rect (x,y,w,h). `gate` is the
// wide double-leaf variant, `variant` a wear/patch alternate for doors.
function paintLeaf(ctx, key, pal, T, rnd, x, y, w, h, gate, variant) {
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath(); ctx.rect(0, 0, w, h); ctx.clip();

  const dot = (px, py, r, style) => { ctx.fillStyle = style; ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2); ctx.fill(); };
  const rivetRow = (x0, y0, x1, y1, n, r = 1.6) => {
    for (let i = 0; i < n; i++) dot(x0 + ((x1 - x0) * i) / (n - 1), y0 + ((y1 - y0) * i) / (n - 1), r, 'rgba(230,236,242,0.35)');
  };
  const planks = (shadeLo, shadeHi, gapA) => {
    const n = Math.max(4, Math.round(w / 12));
    const bw = w / n;
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = css(T.body, shadeLo + rnd() * (shadeHi - shadeLo));
      ctx.fillRect(i * bw, 0, bw - 1.2, h);
      ctx.fillStyle = `rgba(14,9,4,${gapA})`;
      ctx.fillRect(i * bw + bw - 1.2, 0, 1.2, h);
    }
  };

  if (key === 'Spree') {
    if (gate) {
      // sealed roller shutter: slats between guide rails, hazard base rail
      ctx.fillStyle = css(T.body); ctx.fillRect(0, 0, w, h);
      for (let sy = 4; sy < h - 22; sy += 9) {
        ctx.fillStyle = css(T.body, 1.2); ctx.fillRect(4, sy, w - 8, 3.5);
        ctx.fillStyle = css(T.body, 0.7); ctx.fillRect(4, sy + 3.5, w - 8, 4.5);
        ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.fillRect(4, sy + 8, w - 8, 1);
      }
      ctx.fillStyle = css(T.frame, 0.85); ctx.fillRect(0, 0, 5, h); ctx.fillRect(w - 5, 0, 5, h);
      ctx.fillStyle = css(T.body, 0.5); ctx.fillRect(4, h - 22, w - 8, 9);
      hazardBand(ctx, T, 4, h - 13, w - 8, 13, rnd);
    } else {
      // U-Bahn service door: grated window, roundel, kick plate
      ctx.fillStyle = css(T.body); ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = 'rgba(255,255,255,0.13)'; ctx.lineWidth = 2; ctx.strokeRect(5, 5, w - 10, h - 10);
      ctx.fillStyle = 'rgba(6,9,12,0.95)'; ctx.fillRect(w * 0.28, 12, w * 0.44, 24);
      for (let i = 0; i < 4; i++) { ctx.fillStyle = 'rgba(190,202,214,0.3)'; ctx.fillRect(w * 0.28, 15 + i * 6, w * 0.44, 1.6); }
      ctx.strokeStyle = css(T.frame, 1.3); ctx.lineWidth = 2; ctx.strokeRect(w * 0.28, 12, w * 0.44, 24);
      dot(w / 2, h * 0.52, 9.5, 'rgba(22,74,146,0.96)');
      ctx.strokeStyle = 'rgba(238,242,246,0.9)'; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.arc(w / 2, h * 0.52, 9.5, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#eef2f6'; ctx.font = '900 12px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('U', w / 2, h * 0.52 + 0.5);
      ctx.fillStyle = css(T.body, 1.3); ctx.fillRect(6, h - 26, w - 12, 18);
      rivetRow(8, 8, 8, h - 8, 6); rivetRow(w - 8, 8, w - 8, h - 8, 6);
    }
  } else if (key === 'Sand') {
    // wooden gate/door: planks, stud rails, diagonal brace on gates
    planks(0.82, 1.14, 0.55);
    for (const ry of [h * 0.2, h * 0.72]) {
      ctx.fillStyle = css(T.frame, 1.05); ctx.fillRect(2, ry, w - 4, 9);
      ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(2, ry + 8, w - 4, 1.5);
      for (let sx = 7; sx < w - 4; sx += 11) dot(sx, ry + 4.5, 1.7, 'rgba(16,12,8,0.85)');
    }
    if (gate) {
      ctx.strokeStyle = css(T.frame, 0.95); ctx.lineWidth = 8;
      ctx.beginPath(); ctx.moveTo(5, h * 0.68); ctx.lineTo(w - 5, h * 0.26); ctx.stroke();
      ctx.fillStyle = 'rgba(14,9,4,0.6)'; ctx.fillRect(w / 2 - 1, 0, 2, h);
    }
    for (let i = 0; i < 4; i++) dot(6 + rnd() * (w - 12), 10 + rnd() * (h - 20), 1.2 + rnd(), 'rgba(30,20,8,0.5)');
  } else if (key === 'Neon') {
    // sliding doors sealed shut: near-black panels, lit center seam
    ctx.fillStyle = css(T.body, 0.9); ctx.fillRect(0, 0, w, h);
    const gg = ctx.createLinearGradient(0, 0, 0, h);
    gg.addColorStop(0, 'rgba(255,255,255,0.09)');
    gg.addColorStop(0.5, 'rgba(255,255,255,0)');
    gg.addColorStop(1, 'rgba(0,0,0,0.28)');
    ctx.fillStyle = gg; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(255,255,255,0.1)'; ctx.lineWidth = 1.5;
    if (gate) { ctx.strokeRect(6, 8, w / 2 - 10, h - 16); ctx.strokeRect(w / 2 + 4, 8, w / 2 - 10, h - 16); }
    else ctx.strokeRect(6, 8, w - 12, h - 16);
    ctx.strokeStyle = css(pal.accent, 0.9, 0.28); ctx.lineWidth = 7;
    ctx.beginPath(); ctx.moveTo(w / 2, 4); ctx.lineTo(w / 2, h - 4); ctx.stroke();
    ctx.strokeStyle = css(pal.accent, 1.35, 0.95); ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(w / 2, 4); ctx.lineTo(w / 2, h - 4); ctx.stroke();
    ctx.fillStyle = css(pal.accent, 1.2, 0.7);
    ctx.fillRect(w / 2 - 8, h * 0.3, 16, 2); ctx.fillRect(w / 2 - 8, h * 0.3 + 5, 16, 2);
    for (const ly of [h * 0.16, h * 0.84]) { ctx.fillStyle = css(pal.accent, 1, 0.14); ctx.fillRect(8, ly, w - 16, 1.5); }
  } else if (key === 'Ice') {
    // frosted bulkhead hatch: pale steel, rivet border, dogged wheel(s)
    const bg = ctx.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, css(T.body, 1.08));
    bg.addColorStop(1, css(T.body, 0.82));
    ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(20,34,44,0.5)'; ctx.lineWidth = 3; ctx.strokeRect(6, 6, w - 12, h - 12);
    rivetRow(10, 10, w - 10, 10, Math.max(3, Math.round(w / 14)), 1.5);
    rivetRow(10, h - 10, w - 10, h - 10, Math.max(3, Math.round(w / 14)), 1.5);
    rivetRow(10, 10, 10, h - 10, 6, 1.5); rivetRow(w - 10, 10, w - 10, h - 10, 6, 1.5);
    const wheels = gate ? [[w * 0.3, h * 0.5], [w * 0.7, h * 0.5]] : [[w / 2, h * 0.48]];
    if (gate) { ctx.fillStyle = 'rgba(20,34,44,0.45)'; ctx.fillRect(w / 2 - 1, 6, 2, h - 12); }
    for (const [wx, wy] of wheels) {
      const wr = Math.min(w, h) * 0.14;
      ctx.strokeStyle = 'rgba(24,40,52,0.85)'; ctx.lineWidth = 4.5;
      ctx.beginPath(); ctx.arc(wx, wy, wr, 0, Math.PI * 2); ctx.stroke();
      ctx.lineWidth = 3;
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * Math.PI * 2 + 0.5;
        ctx.beginPath(); ctx.moveTo(wx, wy); ctx.lineTo(wx + Math.cos(a) * wr, wy + Math.sin(a) * wr); ctx.stroke();
      }
      dot(wx, wy, 3, 'rgba(24,40,52,0.9)');
    }
    for (const [cx2, cy2] of [[0, 0], [w, 0], [0, h], [w, h]]) {
      const fg = ctx.createRadialGradient(cx2, cy2, 2, cx2, cy2, Math.min(w, h) * 0.55);
      fg.addColorStop(0, 'rgba(240,250,255,0.75)');
      fg.addColorStop(1, 'rgba(240,250,255,0)');
      ctx.fillStyle = fg; ctx.fillRect(0, 0, w, h);
    }
  } else if (key === 'Ruins') {
    // bricked-up arch with boards nailed across (clearly filled in)
    ctx.fillStyle = css(T.frame, 1.15); ctx.fillRect(0, 0, w, h);
    const rows = Math.ceil(h / 9);
    for (let r2 = 0; r2 < rows; r2++) {
      const bw = 15;
      for (let bx = -((r2 % 2) * bw) / 2; bx < w; bx += bw) {
        ctx.fillStyle = rnd() < 0.07 ? 'rgba(10,7,4,0.9)' : css(T.body, 0.78 + rnd() * 0.4);
        ctx.fillRect(bx + 1, r2 * 9 + 1, bw - 2, 7);
      }
    }
    // arch line + keystone (reads as an old opening, now filled)
    ctx.strokeStyle = 'rgba(24,18,12,0.8)'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(3, h * 0.34);
    ctx.quadraticCurveTo(w / 2, -h * 0.12, w - 3, h * 0.34);
    ctx.stroke();
    ctx.fillStyle = css(T.frame, 0.8); ctx.fillRect(w / 2 - 5, 0, 10, 12);
    const board = (x0, y0, x1, y1, th) => {
      const a = Math.atan2(y1 - y0, x1 - x0);
      const len = Math.hypot(x1 - x0, y1 - y0);
      ctx.save(); ctx.translate(x0, y0); ctx.rotate(a);
      ctx.fillStyle = 'rgba(122,95,58,0.94)'; ctx.fillRect(0, -th / 2, len, th);
      ctx.fillStyle = 'rgba(60,44,24,0.6)'; ctx.fillRect(0, th / 2 - 1.5, len, 1.5);
      ctx.restore();
      dot(x0 + (x1 - x0) * 0.08, y0 + (y1 - y0) * 0.08, 1.6, 'rgba(20,14,8,0.9)');
      dot(x0 + (x1 - x0) * 0.92, y0 + (y1 - y0) * 0.92, 1.6, 'rgba(20,14,8,0.9)');
    };
    board(2, h * 0.42, w - 2, h * 0.62, 8);
    board(w - 2, h * 0.36, 2, h * 0.7, 8);
    if (!gate || variant) board(2, h * 0.85, w - 2, h * 0.82, 7);
  } else if (key === 'Toxic') {
    // hazard airlock: chevron band, trefoil, bolts, GESPERRT stencil
    ctx.fillStyle = css(T.body); ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(255,255,255,0.1)'; ctx.lineWidth = 2; ctx.strokeRect(5, 5, w - 10, h - 10);
    hazardBand(ctx, T, 4, h * 0.4, w - 8, h * 0.19, rnd);
    const tr = Math.min(w, h) * 0.11;
    ctx.strokeStyle = css(pal.accent, 1.2, 0.85); ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(w / 2, h * 0.2, tr, 0, Math.PI * 2); ctx.stroke();
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2 - Math.PI / 2;
      dot(w / 2 + Math.cos(a) * tr * 0.55, h * 0.2 + Math.sin(a) * tr * 0.55, tr * 0.3, css(pal.accent, 1.25, 0.9));
    }
    dot(w / 2, h * 0.2, tr * 0.14, css(pal.accent, 1.3, 1));
    ctx.fillStyle = 'rgba(235,240,235,0.75)';
    // narrow doors keep the stencil clear of the hazard-striped jambs
    ctx.font = `900 ${gate ? 12 : 7}px Arial`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('GESPERRT', w / 2, h * 0.71);
    for (const [bx2, by2] of [[9, 9], [w - 9, 9], [9, h - 9], [w - 9, h - 9]]) dot(bx2, by2, 2.2, 'rgba(220,228,220,0.4)');
    for (let i = 0; i < 3; i++) {
      const sx = 8 + rnd() * (w - 16);
      const sg = ctx.createLinearGradient(0, h * 0.6, 0, h * 0.6 + 18 + rnd() * 14);
      sg.addColorStop(0, 'rgba(20,30,10,0.5)');
      sg.addColorStop(1, 'rgba(20,30,10,0)');
      ctx.fillStyle = sg; ctx.fillRect(sx, h * 0.6, 2.5 + rnd() * 2, 32);
    }
  } else {
    // Crimson: iron-banded gate — dark planks, riveted bands, padlock
    planks(0.72, 1.12, 0.7);
    for (const ry of [h * 0.16, h * 0.5, h * 0.82]) {
      ctx.fillStyle = 'rgba(18,12,14,0.96)'; ctx.fillRect(1, ry - 4.5, w - 2, 9);
      ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fillRect(1, ry - 4.5, w - 2, 1.6);
      for (let sx = 7; sx < w - 4; sx += 12) dot(sx, ry, 1.7, 'rgba(210,214,220,0.4)');
    }
    if (gate) {
      ctx.fillStyle = 'rgba(10,7,8,0.7)'; ctx.fillRect(w / 2 - 1.2, 0, 2.4, h);
      ctx.strokeStyle = 'rgba(200,205,212,0.55)'; ctx.lineWidth = 3.5;
      ctx.beginPath(); ctx.arc(w / 2, h * 0.5 + 6, 6, Math.PI, 0); ctx.stroke();
      ctx.fillStyle = 'rgba(12,12,16,0.98)'; ctx.fillRect(w / 2 - 7, h * 0.5 + 6, 14, 12);
      dot(w / 2, h * 0.5 + 11, 1.6, css(pal.accent, 1.1, 0.9));
    } else {
      for (const hy of [h * 0.28, h * 0.68]) {
        ctx.fillStyle = 'rgba(18,12,14,0.95)';
        ctx.beginPath();
        ctx.moveTo(0, hy - 4); ctx.lineTo(w * 0.42, hy - 1); ctx.lineTo(w * 0.42, hy + 1); ctx.lineTo(0, hy + 4);
        ctx.closePath(); ctx.fill();
        dot(w * 0.38, hy, 1.6, 'rgba(210,214,220,0.4)');
      }
    }
  }

  // variant wear: patch plate on the alternate door (skipped for Toxic —
  // it would sit on the GESPERRT stencil)
  if (!gate && variant && key !== 'Toxic') {
    ctx.fillStyle = css(T.frame, 1.25, 0.9);
    ctx.fillRect(w * 0.14, h * 0.6, w * 0.34, h * 0.14);
    ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 1.5;
    ctx.strokeRect(w * 0.14, h * 0.6, w * 0.34, h * 0.14);
  }

  // common finish: inner-edge AO, header shadow, base grime
  ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 3; ctx.strokeRect(1.5, 1.5, w - 3, h - 3);
  const g0 = ctx.createLinearGradient(0, 0, 0, 14);
  g0.addColorStop(0, 'rgba(0,0,0,0.38)'); g0.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g0; ctx.fillRect(0, 0, w, 14);
  const g1 = ctx.createLinearGradient(0, h - 18, 0, h);
  g1.addColorStop(0, 'rgba(0,0,0,0)'); g1.addColorStop(1, 'rgba(0,0,0,0.32)');
  ctx.fillStyle = g1; ctx.fillRect(0, h - 18, w, 18);
  ctx.restore();
}

// 256px door atlas: leaves + keypad/reader faces + sign plate + hazard
// strip + stencil digits, palette-flavored, painted once per palette.
function doorAtlasCanvas(key, pal, T) {
  const cacheKey = `doors:${key}:${pal.accent}`;
  if (canvasCache.has(cacheKey)) return canvasCache.get(cacheKey);
  const c = makeCanvas(256);
  const ctx = c.getContext('2d');
  const rnd = mulberry32(hashStr(cacheKey));

  paintLeaf(ctx, key, pal, T, rnd, 0, 0, 128, 128, true, false);
  paintLeaf(ctx, key, pal, T, rnd, 128, 0, 64, 128, false, false);
  paintLeaf(ctx, key, pal, T, rnd, 192, 0, 64, 128, false, true);

  const dead = key === 'Ruins'; // ruins electronics barely alive
  const glow = (mul, a) => css(dead ? '#c25a1e' : pal.accent, dead ? mul * 0.8 : mul, dead ? a * 0.65 : a);

  // --- keypad face (0,128 .. 48,192)
  ctx.save(); ctx.translate(0, 128);
  ctx.fillStyle = dead ? 'rgb(30,24,18)' : 'rgb(14,17,22)'; ctx.fillRect(0, 0, 48, 64);
  ctx.strokeStyle = 'rgba(255,255,255,0.16)'; ctx.lineWidth = 2; ctx.strokeRect(2, 2, 44, 60);
  const sg = ctx.createLinearGradient(6, 6, 42, 6);
  sg.addColorStop(0, glow(0.7, 0.85)); sg.addColorStop(0.55, glow(1.35, 0.95)); sg.addColorStop(1, glow(0.6, 0.8));
  ctx.fillStyle = sg; ctx.fillRect(6, 6, 36, 10);
  for (let r2 = 0; r2 < 4; r2++) {
    for (let q = 0; q < 3; q++) {
      const on = dead ? rnd() < 0.25 : rnd() < 0.85;
      ctx.fillStyle = on ? glow(1.2, 0.95) : 'rgba(90,96,104,0.5)';
      ctx.beginPath(); ctx.arc(12 + q * 12, 25 + r2 * 10, 2.8, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.restore();

  // --- card reader face (48,128 .. 96,192)
  ctx.save(); ctx.translate(48, 128);
  ctx.fillStyle = dead ? 'rgb(32,26,20)' : 'rgb(13,16,20)'; ctx.fillRect(0, 0, 48, 64);
  ctx.strokeStyle = 'rgba(255,255,255,0.16)'; ctx.lineWidth = 2; ctx.strokeRect(2, 2, 44, 60);
  ctx.fillStyle = 'rgba(0,0,0,0.9)'; ctx.fillRect(20, 8, 8, 40);
  ctx.fillStyle = glow(1.35, 0.95); ctx.fillRect(23, 9, 2, 38);
  ctx.strokeStyle = glow(1, 0.5); ctx.lineWidth = 1.6;
  for (let k = 1; k <= 2; k++) { ctx.beginPath(); ctx.arc(12, 14, 3 * k, -Math.PI / 3, Math.PI / 3); ctx.stroke(); }
  ctx.fillStyle = glow(1.25, 0.95); ctx.beginPath(); ctx.arc(14, 56, 2.6, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = css(T.hazard, 1.15, dead ? 0.5 : 0.9); ctx.beginPath(); ctx.arc(34, 56, 2.6, 0, Math.PI * 2); ctx.fill();
  ctx.restore();

  // --- palette sign plate (96,128 .. 160,192); the whole cell is filled
  // (panel faces use an opaque unlit material — no transparent corners)
  ctx.save(); ctx.translate(96, 128);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgb(13,15,19)'; ctx.fillRect(0, 0, 64, 64);
  if (key === 'Spree') {
    ctx.fillStyle = 'rgba(22,74,146,0.98)';
    ctx.beginPath(); ctx.arc(32, 32, 26, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(240,244,248,0.95)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(32, 32, 26, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#f2f5f8'; ctx.font = '900 34px Arial'; ctx.fillText('U', 32, 34);
  } else if (key === 'Toxic') {
    ctx.fillStyle = css(T.hazard, 1.05, 0.96);
    ctx.beginPath(); ctx.moveTo(32, 5); ctx.lineTo(60, 56); ctx.lineTo(4, 56); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(10,12,8,0.9)'; ctx.lineWidth = 3.5;
    ctx.beginPath(); ctx.moveTo(32, 9); ctx.lineTo(56, 53); ctx.lineTo(8, 53); ctx.closePath(); ctx.stroke();
    ctx.fillStyle = 'rgb(12,14,8)'; ctx.font = '900 28px Arial'; ctx.fillText('!', 32, 39);
  } else {
    ctx.strokeStyle = css(pal.accent, 1.15, 0.92); ctx.lineWidth = 3; ctx.strokeRect(7.5, 7.5, 49, 49);
    ctx.fillStyle = '#eef2f6'; ctx.font = '900 30px Arial'; ctx.fillText(T.sign, 32, 33);
  }
  ctx.restore();

  // --- hazard strip (160,128 .. 256,160)
  hazardBand(ctx, T, 160, 128, 96, 32, rnd);

  // --- stencil digits 0-9 (0,192 .. 240,224)
  ctx.save();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = '900 26px Arial';
  for (let n = 0; n < 10; n++) {
    ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = 4;
    ctx.strokeText(String(n), n * 24 + 12, 208);
    ctx.fillStyle = 'rgba(238,242,246,0.92)';
    ctx.fillText(String(n), n * 24 + 12, 208);
  }
  ctx.globalCompositeOperation = 'destination-out'; // stencil bridges
  ctx.fillRect(0, 201, 240, 1.7);
  ctx.fillRect(0, 214, 240, 1.7);
  ctx.restore();

  canvasCache.set(cacheKey, c);
  return c;
}

// --------------------------------------------------------- addDoorDecor

export function addDoorDecor(group, map) {
  // Local PRNG (rule 2) — NEVER the shared builder rand.
  const rnd = mulberry32(hashStr((map.id || map.name || 'map') + ':doors'));
  const pal = map.palette;
  const key = paletteKey(pal);
  const T = THEMES[key];
  const [w, d] = map.size;
  const hw = w / 2;
  const hd = d / 2;

  const doors = new THREE.Group();
  doors.name = 'doordecor';
  group.add(doors);

  // ---------------------------------------------------------- context
  const boxes = map.boxes || [];
  const spawnPts = [];
  for (const arr of Object.values(map.spawns || {})) {
    for (const s of arr || []) spawnPts.push([s[0], s[1]]);
  }
  const siteList = Object.values(map.sites || {}).map((s) => ({ x: s.center[0], z: s.center[1], r: s.radius }));

  // solids (interior boxes + frozen perimeter walls) for front probes
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

  const clearOfSpawns = (x, z, hx = 0, hz = hx) => spawnPts.every(([sx, sz]) => {
    const dx = Math.max(0, Math.abs(sx - x) - hx);
    const dz = Math.max(0, Math.abs(sz - z) - hz);
    return dx * dx + dz * dz >= SPAWN_R * SPAWN_R;
  });

  const outsideSites = (x, z, hx = 0, hz = hx) => siteList.every((s) => {
    const dx = Math.max(0, Math.abs(s.x - x) - hx);
    const dz = Math.max(0, Math.abs(s.z - z) - hz);
    return dx * dx + dz * dz > (s.r + 0.15) * (s.r + 0.15);
  });

  const pointInSolid = (x, y, z, pad = 0.01) => solids.some((s) =>
    x > s.x0 - pad && x < s.x1 + pad && y > s.y0 - pad && y < s.y1 + pad && z > s.z0 - pad && z < s.z1 + pad);

  // ------------------------------------------------------- wall faces
  // Neighbouring modules mount fixtures at KNOWN along positions; doors
  // keep clear so nothing renders across a leaf. All values below mirror
  // FROZEN placement code:
  //  - structures.js wallPilasters: ~len/3.2 strips (0.04 proud) spread
  //    over thin walls with <= 0.15 jitter;
  //  - structures.js dressPerimeter buttress ribs: replayed exactly from
  //    its private PRNG mulberry32(hashStr('structures:' + id)), which
  //    dressPerimeter consumes FIRST (ribs, then coping stones per wall,
  //    in wall order north/south/west/east);
  //  - props.js: locker clusters (along ±12) / banners (0, ±6.5) on the
  //    team walls, pipe end-drops on the two long walls.
  // avoid entries are [alongPos, halfWidth] pairs
  const perimAvoid = [[], [], [], []]; // north, south, west, east
  {
    const srng = mulberry32(hashStr('structures:' + (map.id || map.name || 'map')));
    for (let wi = 0; wi < 4; wi++) {
      const len = wi < 2 ? w : d;
      let c = -len / 2 + 2.2 + srng() * 2;
      while (c < len / 2 - 2.2) {
        perimAvoid[wi].push([c, 0.35]); // buttress rib (0.34 wide)
        c += 5.6 + srng() * 2.2;
      }
      let s = -len / 2 + 1.5; // coping stones: consume the same stream
      for (;;) {
        const sl = 1.3 + srng() * 0.9;
        srng(); // stone height
        if (s + sl > len / 2 - 1.5) break;
        s += sl + 0.5 + srng() * 0.8;
      }
    }
  }
  if ((map.spawns?.attackers || []).length) {
    for (const wi of [0, 1]) {
      perimAvoid[wi].push([0, 0.9], [-6.5, 0.9], [6.5, 0.9]); // banners
      perimAvoid[wi].push([-12, 2.0], [12, 2.0]); // locker clusters
    }
  }
  {
    const li = w >= d ? [0, 1] : [2, 3]; // props pipe walls: end drops
    const L = (w >= d ? w : d) - 1.6 - 10;
    if (L >= 8) for (const wi of li) perimAvoid[wi].push([-(L / 2 + 0.25), 0.3], [L / 2 + 0.25, 0.3]);
  }
  const siteXs = siteList.map((s) => s.x);

  // mountable faces: sides of grounded interior boxes >= 2.6 m tall
  // whose face is >= 2.8 m wide, plus the 4 inner perimeter faces
  const faces = [];
  for (const b of boxes) {
    const bot = b.pos[1] - b.size[1] / 2;
    const top = b.pos[1] + b.size[1] / 2;
    if (bot > 0.15 || top < 2.6) continue;
    const [sx, sy, sz] = b.size;
    const thin = Math.min(sx, sz);
    const long = Math.max(sx, sz);
    let pil = null; // absolute along-axis coords of pilaster strips
    if (thin <= 1.8 && long >= 2.6) {
      const n = Math.max(2, Math.round(long / 3.2));
      const c0 = (sx >= sz ? b.pos[0] : b.pos[2]) - long / 2 + 0.45;
      pil = [];
      for (let i = 0; i < n; i++) pil.push(c0 + (n <= 1 ? (long - 0.9) / 2 : (i / (n - 1)) * (long - 0.9)));
    }
    // choke-wall segments (plant template: 3.2 tall / 1 thick) carry the
    // props.js A/B wayfinding plates at siteX ± 3.6 — keep off those
    const choke = Math.abs(sy - 3.2) < 0.05 && Math.abs(sz - 1) < 0.05;
    const plates = choke ? siteXs.flatMap((x) => [[x - 3.6, 0.4], [x + 3.6, 0.4]]) : [];
    const pilAv = (pil || []).map((p) => [p, 0.32]);
    if (sz >= 2.8) {
      const av = sz >= sx ? pilAv : [];
      faces.push({ cx: b.pos[0] + sx / 2, cz: b.pos[2], nx: 1, nz: 0, len: sz, top, avoid: av, used: [] });
      faces.push({ cx: b.pos[0] - sx / 2, cz: b.pos[2], nx: -1, nz: 0, len: sz, top, avoid: av, used: [] });
    }
    if (sx >= 2.8) {
      const av = [...(sx > sz ? pilAv : []), ...plates];
      faces.push({ cx: b.pos[0], cz: b.pos[2] + sz / 2, nx: 0, nz: 1, len: sx, top, avoid: av, used: [] });
      faces.push({ cx: b.pos[0], cz: b.pos[2] - sz / 2, nx: 0, nz: -1, len: sx, top, avoid: av, used: [] });
    }
  }
  const perims = [
    { cx: 0, cz: -(hd - PERIM_T / 2), nx: 0, nz: 1, len: w - 1.6, top: PERIM_H, perim: true, avoid: perimAvoid[0], used: [] },
    { cx: 0, cz: hd - PERIM_T / 2, nx: 0, nz: -1, len: w - 1.6, top: PERIM_H, perim: true, avoid: perimAvoid[1], used: [] },
    { cx: -(hw - PERIM_T / 2), cz: 0, nx: 1, nz: 0, len: d - 1.6, top: PERIM_H, perim: true, avoid: perimAvoid[2], used: [] },
    { cx: hw - PERIM_T / 2, cz: 0, nx: -1, nz: 0, len: d - 1.6, top: PERIM_H, perim: true, avoid: perimAvoid[3], used: [] },
  ];

  const facePos = (f, along) => (f.nx ? [f.cx, f.cz + along] : [f.cx + along, f.cz]);
  const faceRy = (f) => (f.nx ? (f.nx > 0 ? Math.PI / 2 : -Math.PI / 2) : (f.nz > 0 ? 0 : Math.PI));
  // +along direction that reads left-to-right for a viewer facing the door
  const uSign = (f) => (f.nx ? -f.nx : f.nz);

  // ------------------------------------------------------ geo buckets
  const darkGeos = [];   // frames, keypad bodies, lamp housings, thresholds
  const leafGeos = [];   // door leaf decals (atlas)
  const overGeos = [];   // leaf overlays: stencil digits, hazard edging
  const stripeGeos = []; // flat floor warning stripes (atlas)
  const glowGeos = [];   // accent emissive (neon rims)
  const panelGeos = [];  // lit keypad/reader/sign faces (atlas, unlit mat)
  const lampGeos = [];   // warm over-door lamp lenses (emissive)

  const mapUV = (geo, r) => {
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) {
      uv.setXY(i, r.u0 + uv.getX(i) * (r.u1 - r.u0), r.v0 + uv.getY(i) * (r.v1 - r.v0));
    }
    return geo;
  };

  // wall-mounted box: half-embedded so it protrudes exactly `proud`
  // (props.js wallBox pattern; proud <= 0.05 everywhere in this module)
  const put = (list, f, along, y, sw, sh, depth, proud) => {
    const [x, z] = facePos(f, along);
    const off = proud - depth / 2;
    list.push(f.nx
      ? placedBox(depth, sh, sw, x + f.nx * off, y, z)
      : placedBox(sw, sh, depth, x, y, z + f.nz * off));
  };

  // wall-mounted textured quad at `proud` in front of the collider face
  const quad = (list, region, f, along, y, sw, sh, proud) => {
    const [x, z] = facePos(f, along);
    const g = mapUV(new THREE.PlaneGeometry(sw, sh), region);
    g.rotateY(faceRy(f));
    g.translate(x + f.nx * proud, y, z + f.nz * proud);
    list.push(g);
  };

  // the sliver of air the assembly occupies (<= 0.05 in front of the
  // face) must clip no collider volume: rejects spots covered by flush
  // abutting boxes and assemblies poking into low tunnel lintels
  const frontClear = (f, along, half, top) => {
    const n = Math.max(4, Math.ceil((2 * half) / 0.35));
    for (let i = 0; i <= n; i++) {
      const [px, pz] = facePos(f, along - half + (i / n) * 2 * half);
      for (const y of [0.35, 1.0, 1.8, Math.min(top, f.top) - 0.06]) {
        if (pointInSolid(px + f.nx * 0.09, y, pz + f.nz * 0.09)) return false;
      }
    }
    return true;
  };

  // ----------------------------------------------------- one assembly
  const tryPlace = (f, wide) => {
    const leafW = wide ? 2.7 + rnd() * 0.6 : 1.14 + rnd() * 0.1;
    // leaf top: below wall caps; perimeter doors stay under the y~2.6+
    // trim bands perimeter.js / props.js run along the outer walls
    const y1 = Math.min(wide ? 2.45 + rnd() * 0.25 : 2.3, f.perim ? 2.18 : f.top - 0.22);
    if (y1 < 2.02) return false;
    const halfSpan = leafW / 2 + 0.62; // leaf + frame + keypad/plate room
    const maxAlong = f.len / 2 - 1.2 - halfSpan; // stay off face ENDS
    if (maxAlong < 0) return false;
    const along = (rnd() * 2 - 1) * maxAlong;
    if (!f.used.every(([a, h]) => Math.abs(along - a) >= halfSpan + h + 0.9)) return false;
    // keep clear of known neighbour-module fixtures on this face
    if (f.avoid.some(([p, ph]) => Math.abs(p - along) < halfSpan + ph + 0.2)) return false;
    const [x, z] = facePos(f, along);
    const hx = f.nx ? 0.35 : halfSpan;
    const hz = f.nx ? halfSpan : 0.35;
    if (!clearOfSpawns(x, z, hx, hz) || !outsideSites(x, z, hx, hz)) return false;
    let lamp = f.top >= y1 + 0.4;
    if (!frontClear(f, along, halfSpan, y1 + (lamp ? 0.34 : 0.18))) {
      if (!lamp || !frontClear(f, along, halfSpan, y1 + 0.18)) return false;
      lamp = false; // e.g. under a tunnel lintel: drop the lamp housing
    }

    // ------- sealed leaf (0.032 proud — clear of the 0.03 perimeter
    // base bands and 0.015/0.02 panel seams) + stenciled door number
    const region = wide ? REG.gate : (rnd() < 0.55 ? REG.doorA : REG.doorB);
    quad(leafGeos, region, f, along, (0.42 + y1) / 2, leafW, y1 - 0.42, 0.032);
    const dW = wide ? 0.2 : 0.16;
    const dH = wide ? 0.3 : 0.24;
    // stencil number near the leaf top; Toxic keeps the top free for the
    // trefoil + chevron band, so its number is sprayed near the base
    const dy = y1 - (key === 'Toxic' ? 0.86 : (wide ? 0.2 : 0.21)) * (y1 - 0.42);
    quad(overGeos, DIGIT(Math.floor(rnd() * 10)), f, along - uSign(f) * dW * 0.56, dy, dW, dH, 0.0385);
    quad(overGeos, DIGIT(Math.floor(rnd() * 10)), f, along + uSign(f) * dW * 0.56, dy, dW, dH, 0.0385);

    // ------- dark frame: jambs + header, half-embedded (0.043 proud)
    const jambH = y1 + 0.02 - 0.42;
    const jambYc = (0.42 + y1 + 0.02) / 2;
    put(darkGeos, f, along - (leafW / 2 + 0.075), jambYc, 0.15, jambH, 0.12, 0.043);
    put(darkGeos, f, along + (leafW / 2 + 0.075), jambYc, 0.15, jambH, 0.12, 0.043);
    put(darkGeos, f, along, y1 + 0.09, leafW + 0.45, 0.14, 0.12, 0.043);
    // perimeter walls have no structures.js base skirt: add a plinth
    if (f.perim) put(darkGeos, f, along, 0.2, leafW + 0.45, 0.4, 0.1, 0.041);

    // ------- glowing keypad / card reader beside the door (NO light)
    const s = rnd() < 0.5 ? -1 : 1;
    const ka = along + s * (leafW / 2 + 0.36);
    put(darkGeos, f, ka, 1.3, 0.18, 0.28, 0.07, 0.045);
    put(darkGeos, f, along + s * (leafW / 2 + 0.21), 1.28, 0.13, 0.05, 0.04, 0.034); // conduit stub
    quad(panelGeos, rnd() < 0.5 ? REG.keypad : REG.reader, f, ka, 1.31, 0.15, 0.24, 0.0485);

    // ------- over-door lamp housing, emissive lens only (NO light)
    if (lamp) {
      put(darkGeos, f, along, y1 + 0.26, 0.34, 0.13, 0.1, 0.044);
      put(lampGeos, f, along, y1 + 0.19, 0.2, 0.06, 0.05, 0.048);
    }

    // ------- palette accents
    if (key === 'Neon') { // neon-rimmed sliding doors
      put(glowGeos, f, along - (leafW / 2 - 0.045), (0.42 + y1) / 2, 0.05, y1 - 0.46, 0.03, 0.037);
      put(glowGeos, f, along + (leafW / 2 - 0.045), (0.42 + y1) / 2, 0.05, y1 - 0.46, 0.03, 0.037);
      put(glowGeos, f, along, y1 - 0.06, leafW - 0.2, 0.05, 0.03, 0.037);
    }
    if (key === 'Toxic') { // hazard-edged airlock jamb stripes
      for (const e of [-1, 1]) {
        const g = mapUV(new THREE.PlaneGeometry(y1 - 0.5, 0.14), REG.hazard);
        g.rotateZ(Math.PI / 2);
        g.rotateY(faceRy(f));
        const [qx, qz] = facePos(f, along + e * (leafW / 2 - 0.1));
        g.translate(qx + f.nx * 0.036, (0.42 + y1) / 2, qz + f.nz * 0.036);
        overGeos.push(g);
      }
    }
    if (!wide) { // palette sign plate opposite the keypad
      const pa = along - s * (leafW / 2 + 0.38);
      put(darkGeos, f, pa, 1.98, 0.36, 0.36, 0.06, 0.045);
      quad(panelGeos, REG.plate, f, pa, 1.98, 0.3, 0.3, 0.0485);
    }

    // ------- flat warning stripe on the floor across the doorway
    const spx = x + f.nx * 0.46;
    const spz = z + f.nz * 0.46;
    const sw2 = leafW + 0.5;
    const blocked = [-sw2 / 2, 0, sw2 / 2].some((da) => {
      const [qx, qz] = facePos(f, along + da);
      return pointInSolid(qx + f.nx * 0.46, 0.15, qz + f.nz * 0.46, 0.05);
    });
    if (!blocked && clearOfSpawns(spx, spz, f.nx ? 0.28 : sw2 / 2, f.nx ? sw2 / 2 : 0.28)) {
      const g = mapUV(new THREE.PlaneGeometry(sw2, 0.5), REG.hazard);
      g.rotateX(-Math.PI / 2);
      if (f.nx) g.rotateY(Math.PI / 2);
      g.translate(spx, 0.0132, spz); // above props decals (<= 0.0108), below rings (0.015)
      stripeGeos.push(g);
    }

    f.used.push([along, halfSpan]);
    return true;
  };

  // ------------------------------------------------------- placement
  const shuffle = (arr) => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  };

  const target = 4 + Math.floor(rnd() * 3); // 4..6 assemblies (cap 7)
  let placed = 0;
  // interior faces first (roomy building masses / walls); perimeter after,
  // short walls first (props.js runs its pipe band along the long ones)
  const perimOrder = shuffle(perims.slice()).sort((a, b) => a.len - b.len);
  for (const f of [...shuffle(faces), ...perimOrder]) {
    if (placed >= target) break;
    for (let a = 0; a < (f.perim ? 4 : 2); a++) {
      const wide = !f.perim && f.len >= 7.6 && rnd() < 0.55;
      if (tryPlace(f, wide)) { placed++; break; }
    }
  }
  // top-up on the perimeter so every map gets at least 3
  for (let a = 0; a < 40 && placed < 3; a++) {
    if (tryPlace(perims[Math.floor(rnd() * 4)], false)) placed++;
  }

  // =====================================================================
  // MERGE + MATERIALS (fresh per call — clearScene disposes everything)
  // <= 5 draw calls: dark / painted faces / accent glow / panels / lamps
  // =====================================================================
  const atlas = doorAtlasCanvas(key, pal, T);

  const darkMesh = mergeInto(doors, darkGeos, new THREE.MeshStandardMaterial({
    color: new THREE.Color(T.frame),
    roughness: T.frough,
    metalness: T.fmetal,
  }));
  if (darkMesh) darkMesh.receiveShadow = true;

  const decalMesh = mergeInto(doors, [...stripeGeos, ...leafGeos, ...overGeos], new THREE.MeshLambertMaterial({
    map: freshTex(atlas),
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  }));
  if (decalMesh) decalMesh.receiveShadow = true;

  mergeInto(doors, glowGeos, new THREE.MeshStandardMaterial({
    color: new THREE.Color(pal.accent).multiplyScalar(0.5),
    emissive: new THREE.Color(pal.accent),
    emissiveIntensity: 1.1,
    roughness: 0.4,
    metalness: 0.2,
  }));

  mergeInto(doors, panelGeos, new THREE.MeshBasicMaterial({
    map: freshTex(atlas),
  }));

  mergeInto(doors, lampGeos, new THREE.MeshStandardMaterial({
    color: new THREE.Color(T.lamp).multiplyScalar(0.4),
    emissive: new THREE.Color(T.lamp),
    emissiveIntensity: 1.0,
    roughness: 0.35,
    metalness: 0.1,
  }));
}
