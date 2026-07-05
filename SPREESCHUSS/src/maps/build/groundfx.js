import * as THREE from 'three';
import { paletteKey, hashStr, mulberry32, mergeInto } from './util.js';

// =====================================================================
// FROZEN INTERFACE — ground FX (decoration ONLY).
//
//   addGroundFX(group, map, sites)
//     Adds flat floor-level effects (e.g. shimmer decals, scorch marks,
//     drain overflow, approach markings). `group` is the map group,
//     `map` the raw map-data object (map.spawns holds raw [x, z, rot?]
//     arrays; map.boxes the collider boxes), `sites` the built sites
//     object { KEY: { center: THREE.Vector3, radius, ring } } from
//     addSiteMarkers (map.sites holds the raw data). Everything this
//     stage adds stays in flat-floor-decal territory (rule 3a).
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

// GROUND FINISH — premium per-palette floor treatment (this module's
// whole output is flat floor "paint", strictly rule 3a):
//   - full-floor SHEEN plane on the wet palettes: near-black metallic
//     MeshStandardMaterial (metal ~0.9, rough 0.08-0.2) so Fresnel makes
//     the cached sky environment (scene.environment on Neon/Ice/Crimson,
//     see sky.js) and the point-light speculars "reflect" at glancing
//     angles while the floor stays readable top-down. A patchy alphaMap
//     keeps it rain-wet rather than uniformly lacquered (Ice gets a
//     near-uniform glaze instead).
//       Spree rain-wet · Neon rain-slick (strongest) · Toxic chemical
//       slick · Crimson polished dark · Ice icy glaze.
//   - Sand/Ruins stay DRY: no sheen, only a very subtle additive
//     mineral-sparkle tiling layer.
//   - PUDDLE clusters (3-7, merged into ONE mesh): organic canvas decals
//     with a dark base, a vertical sky-gradient "fake reflection" and a
//     bright rim. A distinct, larger layer than the small props.js
//     puddles. Placed on open floor (same inflate logic as props.js
//     onOpenFloor), >= 1 m from spawns; flat decals, so allowed inside
//     site rings.
//   - SITE STREAKS: one soft radial emissive smear per site under the
//     ring (additive, accent-tinted, opacity <= 0.25 so it never crosses
//     the 0.9 bloom threshold).
// Layering (z-fight-safe: floor slabs at 0/0.0018, expansion joints top
// out at 0.004, props decals cycle 0.006..0.0108, site glow disc 0.012,
// rings 0.015+): sheen/sparkle y 0.0048 < puddles 0.0052..0.0058 <
// streaks 0.010. All layers use polygonOffset -1, depthWrite false and
// negative renderOrder (sheen -3 < puddles -2 < streaks -1) so the
// stack blends bottom-up before all default-order transparents.
// Draw calls: <= 3 per map (sheen/sparkle + puddles + streaks).

// Ground-finish identity per palette (keyed by util.paletteKey).
//   sheen: { opacity <= 0.18 (Ice <= 0.24), roughness 0.08-0.2,
//            metalness 0.85-0.95, env 0.6-1.2, near-black tint,
//            base = alphaMap base gray 0-255, blots = wet-patch count }
//   puddles: decal count (0 disables); sparkle: dry glint tint or null.
const THEMES = {
  Spree:   { sheen: { opacity: 0.13, roughness: 0.16, metalness: 0.90, env: 0.80, tint: '#0b1016', base: 150, blots: 22 }, puddles: 5, sparkle: null },
  Sand:    { sheen: null, puddles: 0, sparkle: '#ffdfa8' },
  Neon:    { sheen: { opacity: 0.18, roughness: 0.08, metalness: 0.95, env: 1.20, tint: '#0b0817', base: 175, blots: 18 }, puddles: 6, sparkle: null },
  Ice:     { sheen: { opacity: 0.24, roughness: 0.10, metalness: 0.90, env: 1.20, tint: '#0d141a', base: 218, blots: 10 }, puddles: 4, sparkle: null },
  Ruins:   { sheen: null, puddles: 0, sparkle: '#f0e6d2' },
  Toxic:   { sheen: { opacity: 0.15, roughness: 0.14, metalness: 0.88, env: 0.70, tint: '#0a120a', base: 150, blots: 26 }, puddles: 7, sparkle: null },
  Crimson: { sheen: { opacity: 0.12, roughness: 0.12, metalness: 0.92, env: 1.00, tint: '#120b0d', base: 178, blots: 14 }, puddles: 3, sparkle: null },
};

// Layer heights (rule 3a: flat decals, y within 0.004..0.012, under the
// site rings at 0.015) and render order (bottom-up within transparents).
const SHEEN_Y = 0.0048;
const PUDDLE_Y = 0.0052; // + idx * 0.0003, max 0.0058
const STREAK_Y = 0.010;

// ------------------------------------------------------------ canvases
// CPU-side canvas cache (painted once per palette); every call wraps the
// cached canvas in a FRESH CanvasTexture (rule 4). All canvases <= 256px.

const canvasCache = new Map(); // key -> canvas

function makeCanvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

// css color from hex with brightness multiplier / optional mix — converted
// back to sRGB bytes (see the color-management note in engine/textures.js).
function css(hex, mul = 1, alpha = 1, mixHex = null, mixAmt = 0) {
  const c = new THREE.Color(hex);
  if (mixHex) c.lerp(new THREE.Color(mixHex), mixAmt);
  c.multiplyScalar(mul).convertLinearToSRGB();
  const v = (x) => Math.max(0, Math.min(255, Math.round(x * 255)));
  return `rgba(${v(c.r)},${v(c.g)},${v(c.b)},${alpha})`;
}

function freshTex(canvas, srgb = true) {
  const t = new THREE.CanvasTexture(canvas);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.anisotropy = 4;
  return t;
}

// --- wetness mask (sheen alphaMap, green channel): base gray = overall
// film strength, darker blots = drying patches, white blots = saturated
// pools. Low frequency on purpose — it stretches across the whole floor.
function wetMaskCanvas(key, T) {
  const cacheKey = `groundfx:mask:${key}:${T.base}:${T.blots}`;
  if (canvasCache.has(cacheKey)) return canvasCache.get(cacheKey);
  const S = 256;
  const c = makeCanvas(S);
  const ctx = c.getContext('2d');
  const rnd = mulberry32(hashStr(cacheKey));
  ctx.fillStyle = `rgb(${T.base},${T.base},${T.base})`;
  ctx.fillRect(0, 0, S, S);
  const blot = (v, a, count, rMin, rMax) => {
    for (let i = 0; i < count; i++) {
      const rw = rMin + rnd() * (rMax - rMin);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rw);
      g.addColorStop(0, `rgba(${v},${v},${v},${a})`);
      g.addColorStop(1, `rgba(${v},${v},${v},0)`);
      ctx.save();
      ctx.translate(rnd() * S, rnd() * S);
      ctx.rotate(rnd() * Math.PI);
      ctx.scale(1, 0.5 + rnd() * 0.6);
      ctx.fillStyle = g;
      ctx.fillRect(-rw, -rw, rw * 2, rw * 2);
      ctx.restore();
    }
  };
  blot(Math.round(T.base * 0.45), 0.55, Math.round(T.blots * 0.6), 20, 48); // drying patches
  blot(255, 0.5, T.blots, 14, 40); // saturated pools
  canvasCache.set(cacheKey, c);
  return c;
}

// --- smooth organic blob path through the midpoints of a wobbled polar
// outline (closed, always convex-ish — reads as standing liquid).
function blobPath(ctx, rads, cx, cy, R, squash) {
  const N = rads.length;
  const pt = (i) => {
    const k = ((i % N) + N) % N;
    const a = (k / N) * Math.PI * 2;
    return [cx + Math.cos(a) * R * rads[k], cy + Math.sin(a) * R * rads[k] * squash];
  };
  ctx.beginPath();
  const [x0, y0] = pt(0);
  const [x1, y1] = pt(1);
  ctx.moveTo((x0 + x1) / 2, (y0 + y1) / 2);
  for (let i = 1; i <= N; i++) {
    const [ax, ay] = pt(i);
    const [bx, by] = pt(i + 1);
    ctx.quadraticCurveTo(ax, ay, (ax + bx) / 2, (ay + by) / 2);
  }
  ctx.closePath();
}

// --- one 128px puddle cell: dark base + vertical sky-gradient "fake
// reflection" (bright horizon band low in the pool) + ripples + rim.
// Alpha never exceeds ~0.8 so puddles read as flat paint, never holes.
function paintPuddleCell(ctx, rnd, pal, key) {
  const N = 14;
  let rads = [];
  for (let i = 0; i < N; i++) rads.push(0.55 + rnd() * 0.45);
  rads = rads.map((r, i) => (rads[(i + N - 1) % N] + 2 * r + rads[(i + 1) % N]) / 4);
  const R = 52;
  const squash = 0.78 + rnd() * 0.14;
  const path = () => blobPath(ctx, rads, 64, 66, R, squash);

  // dark water base: crushed floor color, translucent (floor grain shows)
  path();
  ctx.fillStyle = css(pal.floor, 0.14, 0.66);
  ctx.fill();

  ctx.save();
  path();
  ctx.clip();
  // vertical sky reflection: zenith at the top edge -> hot horizon band
  const g = ctx.createLinearGradient(0, 66 - R, 0, 66 + R * squash);
  g.addColorStop(0, css(pal.skyTop, 0.85, 0.5));
  g.addColorStop(0.55, css(pal.skyBottom, 1.0, 0.42, '#ffffff', 0.12));
  g.addColorStop(0.78, css(pal.skyBottom, 1.1, 0.5, '#ffffff', 0.32));
  g.addColorStop(1, css(pal.skyBottom, 0.6, 0.4));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);

  // faint wind ripples
  ctx.strokeStyle = 'rgba(255,255,255,0.14)';
  ctx.lineWidth = 1.2;
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.ellipse(38 + rnd() * 52, 40 + rnd() * 50, 8 + rnd() * 16, 2 + rnd() * 3.5, (rnd() - 0.5) * 0.5,
      Math.PI * (0.9 + rnd() * 0.4), Math.PI * (1.7 + rnd() * 0.4));
    ctx.stroke();
  }

  if (key === 'Toxic') {
    // chemical slick: oily interference rings (accent + violet)
    for (const [hex, a] of [[pal.accent, 0.15], ['#b07ae0', 0.10]]) {
      ctx.strokeStyle = css(hex, 1.1, a);
      ctx.lineWidth = 3 + rnd() * 2.5;
      ctx.beginPath();
      ctx.ellipse(56 + rnd() * 18, 58 + rnd() * 16, 16 + rnd() * 16, 9 + rnd() * 8, rnd() * Math.PI, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  if (key === 'Ice') {
    // refreeze cracks in the glaze
    ctx.strokeStyle = 'rgba(235,250,255,0.22)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      let x = 34 + rnd() * 60;
      let y = 34 + rnd() * 60;
      ctx.moveTo(x, y);
      for (let s = 0; s < 3; s++) {
        x += (rnd() - 0.5) * 34;
        y += (rnd() - 0.5) * 34;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }
  // bright sheen catch along the far (top) edge
  const rg = ctx.createLinearGradient(0, 66 - R, 0, 66 - R * 0.25);
  rg.addColorStop(0, `rgba(255,255,255,${key === 'Ice' ? 0.30 : 0.20})`);
  rg.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = rg;
  ctx.fillRect(0, 0, 128, 64);
  ctx.restore();

  // thin bright rim all around (reads as the meniscus edge, not a hole)
  path();
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 1.6;
  ctx.stroke();
}

// 256px atlas of four 128px puddle variants, palette-flavored.
function puddleAtlasCanvas(key, pal) {
  const cacheKey = `groundfx:puddles:${key}:${pal.floor}:${pal.skyTop}:${pal.skyBottom}:${pal.accent}`;
  if (canvasCache.has(cacheKey)) return canvasCache.get(cacheKey);
  const c = makeCanvas(256);
  const ctx = c.getContext('2d');
  const rnd = mulberry32(hashStr(cacheKey));
  for (const [px, py] of [[0, 0], [128, 0], [0, 128], [128, 128]]) {
    ctx.save();
    ctx.translate(px, py);
    paintPuddleCell(ctx, rnd, pal, key);
    ctx.restore();
  }
  canvasCache.set(cacheKey, c);
  return c;
}

// Atlas cells in normalized uv (canvas y-down -> texture v-up flip).
const PUDDLE_CELLS = [
  { u0: 0.0, v0: 0.5, u1: 0.5, v1: 1.0 },
  { u0: 0.5, v0: 0.5, u1: 1.0, v1: 1.0 },
  { u0: 0.0, v0: 0.0, u1: 0.5, v1: 0.5 },
  { u0: 0.5, v0: 0.0, u1: 1.0, v1: 0.5 },
];

// --- 128px white radial smear (soft core + tapered streak spokes); the
// additive material tints it with the palette accent per map.
function streakCanvas() {
  const cacheKey = 'groundfx:streak:v1';
  if (canvasCache.has(cacheKey)) return canvasCache.get(cacheKey);
  const S = 128;
  const c = makeCanvas(S);
  const ctx = c.getContext('2d');
  const rnd = mulberry32(hashStr(cacheKey));
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 60);
  g.addColorStop(0, 'rgba(255,255,255,0.40)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.15)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  const n = 14;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + (rnd() - 0.5) * 0.5;
    const len = 34 + rnd() * 26;
    const wdt = 3 + rnd() * 5;
    ctx.save();
    ctx.translate(64, 64);
    ctx.rotate(a);
    const lg = ctx.createLinearGradient(0, 0, len, 0);
    lg.addColorStop(0, `rgba(255,255,255,${(0.20 + rnd() * 0.14).toFixed(3)})`);
    lg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = lg;
    ctx.beginPath();
    ctx.moveTo(4, -wdt / 2);
    ctx.lineTo(len, -0.6);
    ctx.lineTo(len, 0.6);
    ctx.lineTo(4, wdt / 2);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  canvasCache.set(cacheKey, c);
  return c;
}

// --- 128px tiling mineral glints for the dry palettes (additive, tinted
// by the material color; opacity stays far below the 0.9 bloom threshold).
function sparkleCanvas() {
  const cacheKey = 'groundfx:sparkle:v1';
  if (canvasCache.has(cacheKey)) return canvasCache.get(cacheKey);
  const S = 128;
  const c = makeCanvas(S);
  const ctx = c.getContext('2d');
  const rnd = mulberry32(hashStr(cacheKey));
  for (let i = 0; i < 90; i++) {
    const a = 0.2 + rnd() * rnd() * 0.75;
    ctx.fillStyle = `rgba(255,255,255,${a.toFixed(3)})`;
    const s = 0.6 + rnd();
    ctx.fillRect(rnd() * S, rnd() * S, s, s);
  }
  for (let i = 0; i < 6; i++) {
    const x = rnd() * S;
    const y = rnd() * S;
    const r = 1.4 + rnd() * 1.4;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255,255,255,0.75)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  canvasCache.set(cacheKey, c);
  return c;
}

// ---------------------------------------------------------- addGroundFX

export function addGroundFX(group, map, sites) {
  // Local PRNG (rule 2) — NEVER the shared builder rand.
  const rnd = mulberry32(hashStr((map.id || map.name || 'map') + ':groundfx'));

  const fx = new THREE.Group();
  fx.name = 'groundfx';
  group.add(fx);

  const pal = map.palette;
  const key = paletteKey(pal);
  const T = THEMES[key];
  const [w, d] = map.size;
  const hw = w / 2;
  const hd = d / 2;

  // ---------------------------------------------------- rule helpers
  const boxes = map.boxes || [];
  const spawnPts = [];
  for (const arr of Object.values(map.spawns || {})) {
    for (const s of arr || []) spawnPts.push([s[0], s[1]]);
  }
  const SPAWN_R = 1.05; // >= 1 m XZ clearance from spawns (rule 3)
  const clearOfSpawns = (x, z, hx, hz = hx) => spawnPts.every(([sx, sz]) => {
    const dx = Math.max(0, Math.abs(sx - x) - hx);
    const dz = Math.max(0, Math.abs(sz - z) - hz);
    return dx * dx + dz * dz >= SPAWN_R * SPAWN_R;
  });
  // decal rect overlaps no grounded box footprint (same style as props.js)
  const onOpenFloor = (x, z, hx, hz = hx, margin = 0.15) => boxes.every((b) => {
    if (b.pos[1] - b.size[1] / 2 > 0.2) return true; // lifted: floor below stays visible
    return Math.abs(x - b.pos[0]) > b.size[0] / 2 + hx + margin ||
           Math.abs(z - b.pos[2]) > b.size[2] / 2 + hz + margin;
  });

  const flatMatOpts = {
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  };

  // ------------------------------------------- 1) full-floor finish
  if (T.sheen) {
    // Near-black metal + low roughness: nothing reflects top-down (floor
    // stays readable) but Fresnel pushes the sky env / light speculars to
    // full strength at glancing angles — the wet-street look. sky.js sets
    // scene.environment on Neon/Ice/Crimson; Spree/Toxic pick up the
    // point-light speculars plus the explicit puddle reflections below.
    const g = new THREE.PlaneGeometry(w, d);
    g.rotateX(-Math.PI / 2);
    g.translate(0, SHEEN_Y, 0);
    const alpha = freshTex(wetMaskCanvas(key, T), false); // grayscale mask, no sRGB
    const sheen = new THREE.Mesh(g, new THREE.MeshStandardMaterial({
      color: new THREE.Color(T.sheen.tint),
      opacity: T.sheen.opacity,
      roughness: T.sheen.roughness,
      metalness: T.sheen.metalness,
      envMapIntensity: T.sheen.env,
      alphaMap: alpha,
      ...flatMatOpts,
    }));
    sheen.renderOrder = -3;
    fx.add(sheen);
  } else if (T.sparkle) {
    // dry palettes: no sheen, just a whisper of mineral glint
    const g = new THREE.PlaneGeometry(w, d);
    g.rotateX(-Math.PI / 2);
    g.translate(0, SHEEN_Y, 0);
    const tex = freshTex(sparkleCanvas());
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(w / 7, d / 7);
    const sparkle = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
      map: tex,
      color: new THREE.Color(T.sparkle),
      opacity: 0.07,
      blending: THREE.AdditiveBlending,
      ...flatMatOpts,
    }));
    sparkle.renderOrder = -3;
    fx.add(sparkle);
  }

  // ------------------------------------------------- 2) puddle layer
  if (T.puddles > 0) {
    const geos = [];
    let placed = 0;
    for (let i = 0; i < T.puddles * 5 && placed < T.puddles; i++) {
      const x = (rnd() * 2 - 1) * (hw - 3);
      const z = (rnd() * 2 - 1) * (hd - 3);
      const sx = 2.0 + rnd() * 1.6; // deliberately larger than props puddles
      const sz = sx * (0.7 + rnd() * 0.35);
      const rot = rnd() * Math.PI * 2;
      const cos = Math.abs(Math.cos(rot));
      const sin = Math.abs(Math.sin(rot));
      const hx = (sx * cos + sz * sin) / 2;
      const hz = (sx * sin + sz * cos) / 2;
      if (!clearOfSpawns(x, z, hx, hz)) continue;
      if (!onOpenFloor(x, z, hx, hz, 0.12)) continue;
      const cell = PUDDLE_CELLS[placed % 4];
      const g = new THREE.PlaneGeometry(sx, sz);
      const uv = g.attributes.uv;
      for (let k = 0; k < uv.count; k++) {
        uv.setXY(k, cell.u0 + uv.getX(k) * (cell.u1 - cell.u0), cell.v0 + uv.getY(k) * (cell.v1 - cell.v0));
      }
      g.rotateX(-Math.PI / 2);
      g.rotateY(rot);
      g.translate(x, PUDDLE_Y + (placed % 3) * 0.0003, z);
      geos.push(g);
      placed++;
    }
    const mesh = mergeInto(fx, geos, new THREE.MeshBasicMaterial({
      map: freshTex(puddleAtlasCanvas(key, pal)),
      ...flatMatOpts,
    }));
    if (mesh) mesh.renderOrder = -2;
  }

  // ------------------------------------------------- 3) site streaks
  const siteKeys = Object.keys(sites || {});
  if (siteKeys.length) {
    const geos = [];
    for (const k of siteKeys) {
      const s = sites[k];
      const span = s.radius * 2.35;
      const g = new THREE.PlaneGeometry(span, span);
      g.rotateX(-Math.PI / 2);
      g.rotateY(rnd() * Math.PI * 2);
      g.translate(s.center.x, STREAK_Y, s.center.z);
      geos.push(g);
    }
    const mesh = mergeInto(fx, geos, new THREE.MeshBasicMaterial({
      map: freshTex(streakCanvas()),
      color: new THREE.Color(pal.accent),
      opacity: 0.22, // additive, way under the 0.9 bloom threshold
      blending: THREE.AdditiveBlending,
      fog: false,
      ...flatMatOpts,
    }));
    if (mesh) mesh.renderOrder = -1;
  }
}
