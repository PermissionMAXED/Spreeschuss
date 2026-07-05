import * as THREE from 'three';
import { paletteKey, hashStr, mulberry32, placedBox, mergeInto } from './util.js';
import { glowTexture } from '../../engine/textures.js';

// =====================================================================
// FROZEN INTERFACE — signature landmark (decoration ONLY).
//
//   addLandmark(group, map)
//     Adds ONE signature landmark piece per map (e.g. a monument,
//     sculpture, antenna cluster, mural) so every map gets a memorable
//     orientation anchor. `group` is the map group, `map` the raw
//     map-data object (map.spawns holds raw [x, z, rot?] arrays;
//     map.boxes the collider boxes; map.sites the raw site data).
//     Landmarks live OUTSIDE the playable area (beyond the perimeter
//     walls at +-w/2, +-d/2, like skyline.js), on top of existing
//     collider volumes, or obey rule 3 like any other in-play decor.
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
// HERO LANDMARK — one palette-defining monument per map, placed beyond
// the perimeter walls (fully outside the playable bounds) so it anchors
// the horizon over the skyline:
//   Spree   — Berlin TV-tower homage: shaft, glinting sphere with a lit
//             window band, antenna, red aviation light.
//   Sand    — great pyramid with heat-pale banding + gilded obelisk.
//   Neon    — holo-megatower: twisted stacked slabs ringed by scrolling
//             emissive sign bands (texture-offset animation).
//   Ice     — crystalline aurora spire with faint pulsing glow ridges.
//   Ruins   — broken colosseum ring with collapsed arches and embers.
//   Toxic   — pair of hyperboloid cooling towers, glowing rims with a
//             slow-drifting additive haze.
//   Crimson — fortress citadel silhouette with lit battlements.
//
// Budget per map: <= 3 static merged meshes + <= 2 emissive merged
// meshes + <= 1 glow sprite (max 6 draw calls, inside rule 6's cap).
// Bearing is deterministic from hashStr(map.id); distance sits at
// max(w, d)/2 + 28..45 from the center AND is pushed past the map's
// bounding circle plus the landmark footprint, so no geometry ever
// enters the playable area. Base colors are faded toward the palette
// fog/horizon color for depth cueing; scene fog does the rest.

// ------------------------------------------------- local geo helpers
// (fresh geometry per call — never module-level singletons)
const cyl = (rt, rb, h, x, y, z, seg = 10, open = false) => {
  const g = new THREE.CylinderGeometry(rt, rb, h, seg, 1, open);
  g.translate(x, y, z);
  return g;
};
const cone = (r, h, x, y, z, seg = 8) => {
  const g = new THREE.ConeGeometry(r, h, seg);
  g.translate(x, y, z);
  return g;
};
const sph = (r, x, y, z, ws = 10, hs = 8) => {
  const g = new THREE.SphereGeometry(r, ws, hs);
  g.translate(x, y, z);
  return g;
};
// rotate a local (ox, oz) offset by yaw (matches BoxGeometry.rotateY)
const rot = (ox, oz, yaw) => [ox * Math.cos(yaw) + oz * Math.sin(yaw), -ox * Math.sin(yaw) + oz * Math.cos(yaw)];

// ------------------------------------------ scrolling sign band canvas
// CPU-side canvas cache (rule 4): painted once per map, wrapped in a
// FRESH CanvasTexture on every call. 256x64 px (<= 256 rule).
const signCanvasCache = new Map();

function signBandTexture(accent, seedKey) {
  const key = `lm:sign:${accent}:${seedKey}`;
  let c = signCanvasCache.get(key);
  if (!c) {
    c = document.createElement('canvas');
    c.width = 256;
    c.height = 64;
    const ctx = c.getContext('2d');
    const rand = mulberry32(hashStr(key));
    ctx.fillStyle = '#060412';
    ctx.fillRect(0, 0, 256, 64);
    const cols = [accent, accent, '#3fd2ff', '#7d5cff', '#ff8a3f'];
    let x = 2;
    while (x < 246) {
      const gw = 10 + rand() * 20;
      const col = cols[Math.floor(rand() * cols.length)];
      // glyph-ish vertical bars with dark notches (fake holo signage)
      const n = 1 + Math.floor(rand() * 3);
      for (let k = 0; k < n; k++) {
        const bx = x + (k / n) * gw;
        const bw = Math.max(3.5, gw / n - 2.5);
        const by = 4 + rand() * 8;
        const bh = 64 - by - (4 + rand() * 8);
        ctx.globalAlpha = 0.88 + rand() * 0.12;
        ctx.fillStyle = col;
        ctx.fillRect(bx, by, bw, bh);
        if (rand() < 0.55) {
          ctx.globalAlpha = 1;
          ctx.fillStyle = '#060412';
          ctx.fillRect(bx - 0.5, by + bh * (0.22 + rand() * 0.5), bw + 1, 2 + rand() * 3.5);
        }
      }
      // rare white-hot sliver — small deliberate bloom point
      if (rand() < 0.3) {
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(x + rand() * gw, 8 + rand() * 40, 2.5, 7 + rand() * 10);
      }
      x += gw + 3 + rand() * 6;
    }
    ctx.globalAlpha = 1;
    signCanvasCache.set(key, c);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

// -------------------------------------------------------- the builders
// Each builder works in LOCAL space (origin at the landmark base, +z
// facing the map center; ground at y = -0.5) and registers geometry
// buckets on B. It also sets B.foot — the XZ footprint radius used by
// the placement solver to keep the whole monument outside the playable
// bounds.

function buildSpree(B) {
  const { rnd } = B;
  const H = 54 + rnd() * 5;
  const shaftH = H * 0.66;
  const body = B.bucket(B.lambert('#9aa7b4', 0.85, 0.3)); // pale concrete, fog-faded
  const shell = B.bucket(B.lambert('#d5dee6', 1.0, 0.18)); // glinting steel sphere
  const glow = B.bucket(B.emissive('#ffd9a0', 1.2)); // lit window band + glint
  const hot = B.bucket(new THREE.MeshBasicMaterial({ color: '#ff5b4a' })); // aviation bulb

  body.push(cyl(2.5, 5.6, 6.5, 0, 2.75, 0, 12)); // base flare
  body.push(cyl(1.35, 2.5, shaftH, 0, shaftH / 2 - 0.5, 0, 12)); // tapered shaft
  body.push(placedBox(9, 3, 9, 6.5, 1.0, 2.5, 0.45)); // ground pavilion

  const sy = shaftH + 2.4; // sphere center
  const r = 4.6;
  shell.push(sph(r, 0, sy, 0, 16, 12));
  glow.push(cyl(r * 0.992, r * 0.992, 0.9, 0, sy + 0.5, 0, 16, true)); // window band
  glow.push(sph(0.5, 0.9, sy + 2.3, 3.9, 8, 6)); // sun glint on the map-facing side

  body.push(cyl(0.62, 0.85, 1.8, 0, sy + r + 0.6, 0, 8)); // antenna collar
  const aLen = H - (sy + r);
  body.push(cyl(0.12, 0.4, aLen, 0, sy + r + aLen / 2, 0, 6)); // antenna
  hot.push(sph(0.42, 0, H, 0, 6, 5));
  B.sprite = { x: 0, y: H, z: 0, scale: 2.2, color: '#ff5544', opacity: 0.85 };
  B.foot = 12;
}

function buildSand(B) {
  const { rnd } = B;
  const ph = 27 + rnd() * 4; // pyramid height
  const pr = ph * 0.72; // pyramid corner radius
  const body = B.bucket(B.lambert('#c8a86a', 0.75, 0.3));
  const pale = B.bucket(B.lambert('#eedcae', 0.95, 0.22)); // heat-pale bands
  const glow = B.bucket(B.emissive('#ffd98a', 1.25)); // gilded pyramidion

  body.push(cone(pr, ph, 0, ph / 2 - 0.6, 0, 4));
  // heat-pale banding: slightly proud frustum rings up the faces
  for (const t of [0.24, 0.46, 0.68]) {
    const hb = 0.8;
    pale.push(cyl(pr * (1 - t - hb / ph) + 0.18, pr * (1 - t + hb / ph) + 0.18, hb * 2, 0, ph * t - 0.6, 0, 4, true));
  }
  // obelisk on a plinth, offset to the side
  const ox = pr * 0.55 + 8.5;
  const oz = 5.5;
  const oh = 30 + rnd() * 4;
  body.push(placedBox(5, 2.4, 5, ox, 0.6, oz));
  body.push(cyl(1.0, 1.75, oh, ox, 1.8 + oh / 2, oz, 4)); // square shaft
  glow.push(cone(1.3, 2.6, ox, 1.8 + oh + 1.3, oz, 4)); // pyramidion
  B.sprite = { x: ox, y: 1.8 + oh + 2.4, z: oz, scale: 2.2, color: '#ffdf9a', opacity: 0.5 };
  B.foot = Math.max(pr, Math.hypot(ox, oz) + 3.6);
}

function buildNeon(B) {
  const { rnd, accent } = B;
  const H = 52 + rnd() * 5;
  const body = B.bucket(new THREE.MeshLambertMaterial({
    color: B.tone('#191430', 1, 0.22),
    emissive: new THREE.Color(accent),
    emissiveIntensity: 0.07,
  }));
  const hot = B.bucket(new THREE.MeshBasicMaterial({ color: '#ffeaf6' })); // crown beacon

  // twisted stack of slabs
  const slabs = [[0, 0.30, 7.4], [0.33, 0.56, 6.1], [0.59, 0.79, 4.9], [0.82, 0.94, 3.7]];
  const twist = (rnd() < 0.5 ? 1 : -1) * (0.18 + rnd() * 0.12);
  slabs.forEach(([f0, f1, hw], i) => {
    const h = (f1 - f0) * H;
    body.push(placedBox(hw * 2, h, hw * 2, 0, f0 * H + h / 2 - 0.5, 0, i * twist));
  });

  // scrolling holo sign bands floating around the slab junctions
  const tex = signBandTexture(accent, B.id);
  tex.repeat.set(2, 1);
  // slight overdrive so the glyphs stay luminous through the palette fog
  // (sign bands are an allowed deliberate hot point)
  const bandMat = new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(1.5, 1.5, 1.5) });
  const speed = (rnd() < 0.5 ? 1 : -1) * (0.028 + rnd() * 0.03);
  const bands = B.bucket(bandMat, () => () => {
    tex.offset.x = (performance.now() * 0.001 * speed) % 1;
  });
  for (const [f, hw, bh] of [[0.315, 7.4, 2.9], [0.575, 6.1, 2.5], [0.805, 4.9, 2.1]]) {
    bands.push(cyl(hw * 1.45, hw * 1.45, bh, 0, f * H, 0, 12, true));
  }

  body.push(cyl(0.16, 0.5, H * 0.09, 0, H * 0.985, 0, 6)); // crown mast
  hot.push(sph(0.4, 0, H * 1.03, 0, 6, 5));
  B.sprite = { x: 0, y: H * 1.03, z: 0, scale: 2.6, color: accent, opacity: 0.9 };
  B.foot = 11;
}

function buildIce(B) {
  const { rnd, accent } = B;
  const H = 47 + rnd() * 6;
  const body = B.bucket(new THREE.MeshLambertMaterial({
    color: B.tone('#d8f0fa', 1.0, 0.14),
    emissive: new THREE.Color('#54c8e8'),
    emissiveIntensity: 0.16,
  }));
  const phase = rnd() * Math.PI * 2;
  const ridgeMat = new THREE.MeshLambertMaterial({
    color: B.tone(accent, 0.35, 0.35),
    emissive: new THREE.Color(accent),
    emissiveIntensity: 0.85,
  });
  const ridges = B.bucket(ridgeMat, () => () => {
    // faint aurora pulse along the glow ridges (stays mostly sub-bloom)
    ridgeMat.emissiveIntensity = 0.62 + 0.45 * (0.5 + 0.5 * Math.sin(performance.now() * 0.0012 + phase));
  });
  const hot = B.bucket(new THREE.MeshBasicMaterial({ color: '#eaffff' }));

  body.push(cone(5.6, H, 0, H / 2 - 0.8, 0, 6)); // main crystal
  for (let i = 0; i < 3; i++) { // leaning satellite shards
    const sh = H * (0.35 + rnd() * 0.22);
    const g = new THREE.ConeGeometry(2.4 + rnd() * 1.6, sh, 5);
    g.rotateZ((rnd() - 0.5) * 0.45);
    g.rotateY(rnd() * Math.PI);
    g.translate((rnd() - 0.5) * 11, sh / 2 - 1.2, (rnd() - 0.5) * 11);
    body.push(g);
  }
  for (let i = 0; i < 2; i++) { // frost heave at the base
    body.push(cone(2.6 + rnd() * 1.2, 2.5 + rnd() * 1.5, (rnd() - 0.5) * 8, 0.6, (rnd() - 0.5) * 8, 5));
  }
  // glow ridges hugging the spire faces
  const slope = Math.atan(5.6 / H);
  for (let k = 0; k < 3; k++) {
    const hr = H * (0.45 + rnd() * 0.1);
    const yc = H * 0.22 + hr / 2;
    const rc = 5.6 * (1 - yc / H) + 0.12;
    const g = new THREE.BoxGeometry(0.32, hr, 0.3);
    g.rotateX(-slope);
    g.translate(0, yc, rc);
    g.rotateY(k * (Math.PI * 2 / 3) + 0.5);
    ridges.push(g);
  }
  hot.push(sph(0.3, 0, H - 0.8, 0, 6, 5)); // hot crystal tip
  B.sprite = { x: 0, y: H - 0.8, z: 0, scale: 2.4, color: '#bfefff', opacity: 0.55 };
  B.foot = 13;
}

function buildRuins(B) {
  const { rnd, pal } = B;
  const R = 16 + rnd() * 3;
  const bays = 18;
  const tierH = 8.6;
  const pierH = 6.8;
  const chord = 2 * R * Math.sin(Math.PI / bays);
  const body = B.bucket(B.lambert(pal.wall ?? '#8a7a68', 0.8, 0.28));
  const pale = B.bucket(B.lambert('#cbb694', 0.95, 0.25)); // broken caps / cornice
  const glow = B.bucket(B.emissive('#ff9a50', 1.35)); // ember light in the arches

  // collapsed sector: piers degrade toward the gap center
  const gapC = rnd() * Math.PI * 2;
  const gapHalf = 0.55 + rnd() * 0.35;
  const angDist = (a) => Math.abs(((a - gapC + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
  const tiersOf = [];
  for (let i = 0; i < bays; i++) {
    const a = (i / bays) * Math.PI * 2;
    const da = angDist(a);
    let tiers = 3;
    if (da < gapHalf) {
      const f = da / gapHalf;
      tiers = f < 0.35 ? 0 : (f < 0.7 ? 1 : 2);
    }
    tiersOf.push(tiers);
  }
  let embers = 0;
  for (let i = 0; i < bays; i++) {
    const a = (i / bays) * Math.PI * 2;
    const x = Math.cos(a) * R;
    const z = Math.sin(a) * R;
    const tiers = tiersOf[i];
    if (tiers === 0) { // toppled: stump + rubble
      const shh = 0.9 + rnd() * 2.6;
      body.push(placedBox(1.7, shh, 1.9, x, shh / 2 - 0.5, z, -a));
      pale.push(placedBox(1.8, 0.4, 2.0, x, shh - 0.3, z, -a));
      if (rnd() < 0.75) {
        body.push(cone(1.4 + rnd() * 1.3, 1.8 + rnd() * 1.4, x + (rnd() - 0.5) * 5, 0.4, z + (rnd() - 0.5) * 5, 5));
      }
      continue;
    }
    for (let t = 0; t < tiers; t++) {
      body.push(placedBox(1.7, pierH, 1.9, x, t * tierH + pierH / 2 - 0.5, z, -a));
    }
    if (tiers < 3) { // pale fractured cap on the broken stack
      pale.push(placedBox(1.8, 0.5, 2.0, x, (tiers - 1) * tierH + pierH - 0.24, z, -a));
    }
    // lintel ring segments between intact neighbouring piers
    const minT = Math.min(tiers, tiersOf[(i + 1) % bays]);
    const amid = a + Math.PI / bays;
    const cx = Math.cos(amid) * R;
    const cz = Math.sin(amid) * R;
    for (let t = 0; t < minT; t++) {
      body.push(placedBox(1.5, 1.7, chord + 0.6, cx, t * tierH + pierH + 0.35, cz, -amid));
    }
    if (minT === 3) {
      pale.push(placedBox(1.9, 0.55, chord + 0.8, cx, 3 * tierH - 0.2, cz, -amid)); // cornice
      if (angDist(amid) > 2.35) { // surviving attic band opposite the gap
        body.push(placedBox(1.3, 3.2, chord + 0.4, cx, 3 * tierH + 1.55, cz, -amid));
      }
      if (embers < 5 && rnd() < 0.3) { // firelight deep in a ground arch
        glow.push(placedBox(0.35, 1.8, 2.8, cx, 2.4, cz, -amid));
        embers++;
      }
    }
  }
  B.sprite = { x: 0, y: 3.5, z: 0, scale: 8, color: '#ff8a4a', opacity: 0.26 };
  B.foot = R + 3.5;
}

// hyperboloid cooling-tower shell (lathe profile, base at y = 0)
function coolingTowerGeo(r0, h) {
  const pts = [];
  const rT = r0 * 0.55; // throat radius
  const tTh = 0.78; // throat height fraction
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    let r;
    if (t <= tTh) {
      const u = 1 - t / tTh;
      r = rT + (r0 - rT) * u * u;
    } else {
      r = rT + rT * 0.14 * ((t - tTh) / (1 - tTh));
    }
    pts.push(new THREE.Vector2(r, t * h));
  }
  return new THREE.LatheGeometry(pts, 14);
}

function buildToxic(B) {
  const { rnd, accent } = B;
  const body = B.bucket(B.lambert('#a8b8a0', 0.68, 0.32)); // hazed concrete
  const glow = B.bucket(B.emissive(accent, 1.15)); // rim rings + beacon
  const phase = rnd() * Math.PI * 2;
  const hazeMat = new THREE.MeshBasicMaterial({
    map: glowTexture(),
    color: new THREE.Color(accent),
    transparent: true,
    opacity: 0.24,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
  });
  const haze = B.bucket(hazeMat, (mesh) => () => {
    // slow drifting glow haze breathing over the tower rims
    const t = performance.now() * 0.001;
    hazeMat.opacity = 0.15 + 0.11 * (0.5 + 0.5 * Math.sin(t * 0.5 + phase));
    mesh.position.y = Math.sin(t * 0.21 + phase) * 0.9;
  });

  const towers = [[-8, -2.5, 44, 9.8], [8.5, 3, 36, 8.0]];
  for (const [tx, tz, th, r0] of towers) {
    const shell = coolingTowerGeo(r0, th);
    shell.translate(tx, -0.5, tz);
    body.push(shell);
    const rimR = r0 * 0.55 * 1.14;
    glow.push(cyl(rimR + 0.18, rimR + 0.18, 1.1, tx, th - 1.0, tz, 14, true));
    const disc = new THREE.CircleGeometry(rimR * 1.75, 18);
    disc.rotateX(-Math.PI / 2);
    disc.translate(tx, th + 0.9, tz);
    haze.push(disc);
  }
  body.push(placedBox(7, 4.5, 5, 0.5, 1.75, 0.5)); // pump house
  body.push(placedBox(14, 1.0, 1.0, 0, 1.6, 0.2)); // feed pipe
  // beacon mast on the taller tower's rim
  const bx = -8;
  const bz = -2.5 + 9.8 * 0.55 * 1.14;
  body.push(cyl(0.08, 0.15, 3, bx, 44.6, bz, 6));
  glow.push(sph(0.38, bx, 46.3, bz, 6, 5));
  B.sprite = { x: bx, y: 46.3, z: bz, scale: 2, color: accent, opacity: 0.8 };
  B.foot = 18.7;
}

function buildCrimson(B) {
  const { pal } = B; // fixed fortress silhouette; bearing/distance still vary per map
  const s = 15; // curtain-wall half-size
  const wallH = 12.5;
  const towerW = 5.2;
  const towerH = wallH + 8;
  const body = B.bucket(B.lambert(pal.wall ?? '#804a56', 0.78, 0.3));
  const dark = B.bucket(B.lambert('#2e181e', 0.9, 0.4)); // roofs / parapet caps
  const glow = B.bucket(B.emissive('#ffb168', 1.45)); // torches + lit windows
  const hot = B.bucket(new THREE.MeshBasicMaterial({ color: '#ffd9a8' })); // braziers / beacon

  const merlon = (x, z, y) => body.push(placedBox(1.0, 1.2, 1.0, x, y, z));
  const ring = (cx, cz, hw, step, y) => {
    const n = Math.max(1, Math.round((2 * hw) / step));
    for (let k = 0; k <= n; k++) {
      const v = -hw + (2 * hw * k) / n;
      merlon(cx + v, cz - hw, y);
      merlon(cx + v, cz + hw, y);
      if (k > 0 && k < n) {
        merlon(cx - hw, cz + v, y);
        merlon(cx + hw, cz + v, y);
      }
    }
  };

  // curtain walls (+z faces the map; the front wall is split by the gate)
  const wallLen = 2 * s - towerW;
  body.push(placedBox(2, wallH, wallLen, -s, wallH / 2 - 0.5, 0));
  body.push(placedBox(2, wallH, wallLen, s, wallH / 2 - 0.5, 0));
  body.push(placedBox(wallLen, wallH, 2, 0, wallH / 2 - 0.5, -s));
  const gateW = 7;
  const segLen = (wallLen - gateW) / 2;
  body.push(placedBox(segLen, wallH, 2, -(gateW / 2 + segLen / 2), wallH / 2 - 0.5, s));
  body.push(placedBox(segLen, wallH, 2, gateW / 2 + segLen / 2, wallH / 2 - 0.5, s));
  for (const [px, pz, sx, sz] of [[-s, 0, 2.6, wallLen], [s, 0, 2.6, wallLen], [0, -s, wallLen, 2.6]]) {
    dark.push(placedBox(sx, 0.4, sz, px, wallH - 0.3, pz)); // parapet lips
  }
  // wall-walk merlons
  const wStep = 2.4;
  for (let v = -s + towerW / 2 + 1; v <= s - towerW / 2 - 1; v += wStep) {
    merlon(-s, v, wallH + 0.1);
    merlon(s, v, wallH + 0.1);
    merlon(v, -s, wallH + 0.1);
    if (Math.abs(v) > gateW / 2 + 0.8) merlon(v, s, wallH + 0.1);
  }
  // corner towers
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      body.push(placedBox(towerW, towerH, towerW, sx * s, towerH / 2 - 0.5, sz * s));
      dark.push(placedBox(towerW + 0.9, 0.7, towerW + 0.9, sx * s, towerH - 0.15, sz * s));
      ring(sx * s, sz * s, 1.9, 1.9, towerH + 0.75);
      if (sz === 1) { // lit arrow slits facing the map
        glow.push(placedBox(0.8, 2.0, 0.16, sx * s, towerH - 6, s + towerW / 2 + 0.08));
        glow.push(placedBox(0.8, 2.0, 0.16, sx * s, towerH - 11, s + towerW / 2 + 0.08));
      }
    }
  }
  // gatehouse: flanking towers, lintel, warm lit gate
  for (const gx of [-3.5, 3.5]) {
    body.push(placedBox(3.6, wallH + 4, 3.6, gx, (wallH + 4) / 2 - 0.5, s));
    ring(gx, s, 1.3, 1.3, wallH + 4.1);
    hot.push(sph(0.3, gx, wallH + 5.1, s, 6, 5)); // brazier
  }
  body.push(placedBox(4.2, 2.2, 3.0, 0, wallH - 1.6, s));
  glow.push(placedBox(3.4, 4.6, 0.16, 0, 2.1, s + 1.08)); // gate light
  // torch string under the front parapet
  for (let x = -12; x <= 12; x += 4) {
    if (Math.abs(x) < gateW / 2 + 1) continue;
    glow.push(placedBox(0.8, 1.0, 0.16, x, wallH - 1.8, s + 1.08));
  }
  // keep + setback + donjon
  const keepH = 26;
  body.push(placedBox(13, keepH, 13, 0, keepH / 2 - 0.5, -2));
  dark.push(placedBox(13.8, 0.6, 13.8, 0, keepH - 0.2, -2));
  ring(0, -2, 5.9, 2.95, keepH + 0.7);
  body.push(placedBox(9, 7, 9, 0, keepH + 3, -2));
  const donjonH = 52;
  body.push(placedBox(6.4, donjonH, 6.4, 3.2, donjonH / 2 - 0.5, -4));
  const roof = new THREE.ConeGeometry(4.7, 5.0, 4);
  roof.rotateY(Math.PI / 4); // align the 4-sided roof with the square donjon
  roof.translate(3.2, donjonH + 2.0, -4);
  dark.push(roof);
  // lit keep windows facing the map
  for (const wy of [12, 17, 22]) {
    for (const wx of [-3.6, 0, 3.6]) {
      glow.push(placedBox(1.0, 2.0, 0.16, wx, wy, 4.58));
    }
  }
  // donjon watch lights up the shaft so the silhouette reads at distance
  for (const wy of [donjonH - 5, donjonH - 12, donjonH - 19]) {
    glow.push(placedBox(1.2, 2.2, 0.16, 3.2, wy, -4 + 3.28));
  }
  hot.push(sph(0.45, 3.2, donjonH + 4.8, -4, 6, 5)); // donjon beacon
  B.sprite = { x: 3.2, y: donjonH + 4.8, z: -4, scale: 2.6, color: '#ffcf9a', opacity: 0.75 };
  B.foot = Math.hypot(s, s) + towerW / 2 + 1.2;
}

const BUILDERS = {
  Spree: buildSpree,
  Sand: buildSand,
  Neon: buildNeon,
  Ice: buildIce,
  Ruins: buildRuins,
  Toxic: buildToxic,
  Crimson: buildCrimson,
};

export function addLandmark(group, map) {
  // Local PRNG (rule 2) — NEVER the shared builder rand.
  const rnd = mulberry32(hashStr((map.id || map.name || 'map') + ':landmark'));

  const landmark = new THREE.Group();
  landmark.name = 'landmark';
  group.add(landmark);

  const pal = map.palette || {};
  const [w, d] = map.size;
  const fogCol = new THREE.Color(pal.fog ?? pal.skyBottom ?? '#20242c');
  // fade a hex toward the palette horizon/fog color for depth cueing
  const tone = (hex, mul = 1, fade = 0.3) => new THREE.Color(hex).multiplyScalar(mul).lerp(fogCol, fade);

  const B = {
    rnd,
    pal,
    id: map.id || map.name || 'map',
    accent: pal.accent ?? '#43b7c7',
    tone,
    foot: 10, // XZ footprint radius, overwritten by the builder
    buckets: [], // { geos, mat, hook? } -> one merged mesh each
    sprite: null, // { x, y, z, scale, color, opacity }
    bucket(mat, hook = null) {
      const b = { geos: [], mat, hook };
      this.buckets.push(b);
      return b.geos;
    },
    lambert(hex, mul, fade) {
      return new THREE.MeshLambertMaterial({ color: tone(hex, mul, fade) });
    },
    emissive(hex, intensity = 1.25) {
      return new THREE.MeshLambertMaterial({
        color: tone(hex, 0.45, 0.35),
        emissive: new THREE.Color(hex),
        emissiveIntensity: intensity,
      });
    },
  };

  (BUILDERS[paletteKey(pal)] || BUILDERS.Spree)(B);

  // --- placement: deterministic bearing from the map id; distance in the
  // 28..45 band beyond the walls, pushed past the map's bounding circle
  // plus the footprint so nothing ever enters the playable bounds.
  const bearing = ((hashStr(map.id || map.name || 'map') % 4096) / 4096) * Math.PI * 2;
  const half = Math.max(w, d) / 2;
  const minD = Math.max(half + 28, Math.hypot(w, d) / 2 + B.foot + 2);
  const maxD = Math.max(half + 45, minD + 1);
  const dist = minD + rnd() * (maxD - minD);
  const lx = Math.cos(bearing) * dist;
  const lz = Math.sin(bearing) * dist;
  // yaw so the local +z front faces the map center
  const yaw = Math.atan2(-Math.cos(bearing), -Math.sin(bearing));

  for (const b of B.buckets) {
    if (!b.geos.length) continue;
    for (const g of b.geos) {
      g.rotateY(yaw);
      g.translate(lx, 0, lz);
    }
    const mesh = mergeInto(landmark, b.geos, b.mat);
    if (mesh && b.hook) mesh.onBeforeRender = b.hook(mesh);
  }

  if (B.sprite) {
    const sp = B.sprite;
    const [sx, sz] = rot(sp.x, sp.z, yaw);
    const mat = new THREE.SpriteMaterial({
      map: glowTexture(),
      color: new THREE.Color(sp.color),
      transparent: true,
      opacity: sp.opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(sp.scale, sp.scale, sp.scale);
    sprite.position.set(lx + sx, sp.y, lz + sz);
    landmark.add(sprite);
  }
}
