import * as THREE from 'three';
import { glowTexture } from '../../engine/textures.js';
import { hashStr, mulberry32, paletteKey } from './util.js';

// =====================================================================
// FROZEN INTERFACE — ambient atmosphere (decoration ONLY).
//
//   addAtmosphere(group, map)
//     Adds ambient particulate / haze effects (e.g. drifting dust,
//     snow, embers, fireflies as ONE Points system; soft haze cards
//     near the perimeter). `group` is the map group, `map` the raw
//     map-data object (map.spawns holds raw [x, z, rot?] arrays;
//     map.boxes the collider boxes; map.sites the raw site data).
//     Particles floating through the playable volume are fine — they
//     are non-solid overhead/ambient decor — but nothing this stage
//     adds may read as a solid object inside the playable area unless
//     it obeys rule 3.
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

// Per-palette weather (keyed by util.paletteKey):
//   Spree   — fine drizzle, faint short streaks.
//   Sand    — drifting dust motes + occasional low gust sheet overhead.
//   Neon    — additive rain streaks + low haze glints near the floor.
//   Ice     — slow tumbling snow.
//   Ruins   — floating ash flecks.
//   Toxic   — luminous drifting spores (slow upward drift).
//   Crimson — rising embers with flicker, a few deliberately hot points.
//
// Budget per map: 1-2 Points systems (task budget; <= 2 draw calls,
// <= 1500 vertices total). Bloom threshold is 0.9 (renderer.js): all
// particle tints stay well below it, except the small hot ember
// fraction on Crimson which may pop slightly by design.

// ---------------------------------------------------------------- textures
// CPU-side canvas cache (rule 4): each canvas is painted ONCE per key and
// kept, but every use wraps it in a FRESH THREE.CanvasTexture because
// Renderer.clearScene() disposes every scene texture between matches.
// All canvases <= 128 px.
const canvasCache = new Map();

function makeCanvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function freshTex(canvas, wrap = false) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = wrap ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  return t;
}

// Vertical rain/drizzle streak for point sprites: a soft column with a
// brighter core and faded tips, reads as motion blur on a falling drop.
function streakTexture() {
  const key = 'atmo:streak';
  let c = canvasCache.get(key);
  if (!c) {
    c = makeCanvas(32, 128);
    const ctx = c.getContext('2d');
    const column = (x, cw, a) => {
      const g = ctx.createLinearGradient(0, 0, 0, 128);
      g.addColorStop(0, 'rgba(255,255,255,0)');
      g.addColorStop(0.3, `rgba(255,255,255,${a * 0.7})`);
      g.addColorStop(0.72, `rgba(255,255,255,${a})`);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x, 0, cw, 128);
    };
    column(12, 8, 0.3);   // soft halo
    column(14, 4, 0.55);  // body
    column(15.2, 1.6, 0.95); // core
    canvasCache.set(key, c);
  }
  return freshTex(c);
}

// Wispy tiling haze for the Sand gust sheet; stamps near the border are
// re-drawn on the wrapped side so the texture tiles cleanly.
function gustCanvas() {
  const key = 'atmo:gust';
  let c = canvasCache.get(key);
  if (!c) {
    const S = 128;
    c = makeCanvas(S);
    const ctx = c.getContext('2d');
    const rnd = mulberry32(hashStr(key));
    for (let i = 0; i < 18; i++) {
      const x = rnd() * S;
      const y = rnd() * S;
      const rx = 22 + rnd() * 36;
      const ry = 3 + rnd() * 7;
      const a = 0.05 + rnd() * 0.1;
      for (const ox of [-S, 0, S]) {
        for (const oy of [-S, 0, S]) {
          if (x + ox + rx < 0 || x + ox - rx > S || y + oy + ry < 0 || y + oy - ry > S) continue;
          ctx.save();
          ctx.translate(x + ox, y + oy);
          ctx.scale(1, ry / rx); // elongated wisp along x
          const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
          g.addColorStop(0, `rgba(255,246,224,${a.toFixed(3)})`);
          g.addColorStop(1, 'rgba(255,246,224,0)');
          ctx.fillStyle = g;
          ctx.fillRect(-rx, -rx, rx * 2, rx * 2);
          ctx.restore();
        }
      }
    }
    canvasCache.set(key, c);
  }
  return c;
}

// --------------------------------------------------------------- particles

const emod = (v, r) => ((v % r) + r) % r;

// One animated THREE.Points system (1 draw call). Motion is a pure
// function of wall-clock time — pos = wrap(base + vel * t) + sway(t) —
// so there is no per-frame integration state and no drift. Base
// positions, velocities, sway and tints all come from the local PRNG,
// so the system is fully deterministic per map id. Update cost is a
// handful of flops for <= ~700 points (well under 0.3 ms/frame).
function spawnParticles(atmo, rnd, spec) {
  const n = Math.max(8, Math.round(spec.count));
  const base = new Float32Array(n * 3);
  const vel = new Float32Array(n * 3);
  const swy = new Float32Array(n * 3); // amp, freq, phase
  const col = new Float32Array(n * 3);
  const tint = new THREE.Color();
  for (let i = 0; i < n; i++) {
    const i3 = i * 3;
    base[i3] = (rnd() * 2 - 1) * spec.hx;
    base[i3 + 1] = spec.yMin + rnd() * (spec.yMax - spec.yMin);
    base[i3 + 2] = (rnd() * 2 - 1) * spec.hz;
    const jit = 0.7 + rnd() * 0.6; // per-particle wind response
    vel[i3] = spec.wind[0] * spec.windSpeed * jit;
    vel[i3 + 1] = spec.vy[0] + rnd() * (spec.vy[1] - spec.vy[0]);
    vel[i3 + 2] = spec.wind[1] * spec.windSpeed * jit;
    swy[i3] = spec.sway[0] + rnd() * (spec.sway[1] - spec.sway[0]);
    swy[i3 + 1] = spec.swayFreq[0] + rnd() * (spec.swayFreq[1] - spec.swayFreq[0]);
    swy[i3 + 2] = rnd() * Math.PI * 2;
    spec.colorFor(rnd, tint);
    col[i3] = tint.r;
    col[i3 + 1] = tint.g;
    col[i3 + 2] = tint.b;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(base.slice(), 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mat = new THREE.PointsMaterial({
    map: spec.tex,
    size: spec.size,
    transparent: true,
    opacity: spec.opacity,
    vertexColors: true,
    blending: spec.blending,
    depthWrite: false,
  });
  const pts = new THREE.Points(geo, mat);
  pts.name = spec.name;
  pts.frustumCulled = false; // hook must tick every frame so wraps never jump
  pts.renderOrder = 30; // draw after world geometry
  const posAttr = geo.attributes.position;
  const p = posAttr.array;
  const xr = spec.hx * 2;
  const zr = spec.hz * 2;
  const yr = spec.yMax - spec.yMin;
  const pulse = spec.pulse || null;
  pts.onBeforeRender = () => {
    const t = performance.now() * 0.001;
    for (let i = 0; i < n; i++) {
      const i3 = i * 3;
      const ph = t * swy[i3 + 1] + swy[i3 + 2];
      const amp = swy[i3];
      p[i3] = emod(base[i3] + vel[i3] * t + spec.hx, xr) - spec.hx + Math.sin(ph) * amp;
      p[i3 + 1] = spec.yMin + emod(base[i3 + 1] - spec.yMin + vel[i3 + 1] * t, yr);
      p[i3 + 2] = emod(base[i3 + 2] + vel[i3 + 2] * t + spec.hz, zr) - spec.hz + Math.cos(ph * 0.83) * amp * 0.7;
    }
    posAttr.needsUpdate = true;
    if (pulse) mat.opacity = spec.opacity * pulse(t);
  };
  atmo.add(pts);
}

// Sand only: one wide, very transparent scrolling haze sheet overhead
// (rule 3c: lowest point >= 2.6; kept at y = 3.05). Opacity pulses so
// gusts read as occasional, peaking at 0.075 (<= 0.08).
function addGustSheet(atmo, rnd, hx, hz, wind) {
  const tex = freshTex(gustCanvas(), true);
  tex.repeat.set(Math.max(2, Math.round(hx / 14)), Math.max(2, Math.round(hz / 14)));
  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    opacity: 0.02,
    depthWrite: false,
    side: THREE.DoubleSide, // visible from below (players look up at it)
  });
  const sheet = new THREE.Mesh(new THREE.PlaneGeometry(hx * 2, hz * 2), mat);
  sheet.name = 'gust-sheet';
  sheet.rotation.x = -Math.PI / 2;
  sheet.position.y = 3.05;
  sheet.renderOrder = 29;
  sheet.frustumCulled = false;
  const phase = rnd() * Math.PI * 2;
  sheet.onBeforeRender = () => {
    const t = performance.now() * 0.001;
    tex.offset.set(t * 0.02 * wind[0], t * 0.02 * wind[1]);
    const gust = Math.max(0, Math.sin(t * 0.16 + phase));
    mat.opacity = 0.02 + 0.055 * gust * gust;
  };
  atmo.add(sheet);
}

// ------------------------------------------------------------ entry point

export function addAtmosphere(group, map) {
  // Local PRNG (rule 2) — NEVER the shared builder rand.
  const rnd = mulberry32(hashStr((map.id || map.name || 'map') + ':atmosphere'));

  const atmo = new THREE.Group();
  atmo.name = 'atmosphere';
  group.add(atmo);

  const key = paletteKey(map.palette);
  const [w, d] = map.size;
  const hx = w / 2 + 1; // playable volume + small margin
  const hz = d / 2 + 1;
  // Density scales with arena area, clamped so the vertex budget
  // (<= 1500 across both systems) always holds on the largest maps.
  const density = Math.min(1.3, Math.max(0.65, (w * d) / 4600));
  const windA = rnd() * Math.PI * 2; // one wind heading per map
  const wind = [Math.cos(windA), Math.sin(windA)];
  const accent = new THREE.Color(map.palette.accent);
  const vol = { hx, hz, wind };

  switch (key) {
    case 'Sand': { // drifting dust motes + occasional low gust sheets
      const dust = new THREE.Color('#d9c184');
      spawnParticles(atmo, rnd, {
        ...vol,
        name: 'dust',
        count: 320 * density,
        tex: glowTexture(),
        size: 0.2,
        opacity: 0.17,
        blending: THREE.NormalBlending,
        yMin: 0.2,
        yMax: 5.5,
        vy: [-0.16, 0.06],
        windSpeed: 1.1,
        sway: [0.15, 0.4],
        swayFreq: [0.15, 0.5],
        colorFor: (r, out) => out.copy(dust).multiplyScalar(0.7 + r() * 0.5),
      });
      addGustSheet(atmo, rnd, hx, hz, wind);
      break;
    }
    case 'Neon': { // rain streaks + low haze glints (both additive)
      const rain = accent.clone().lerp(new THREE.Color('#7fa8ff'), 0.45);
      spawnParticles(atmo, rnd, {
        ...vol,
        name: 'rain',
        count: 430 * density,
        tex: streakTexture(),
        size: 0.55,
        opacity: 0.3,
        blending: THREE.AdditiveBlending,
        yMin: 0,
        yMax: 9,
        vy: [-9, -6.5],
        windSpeed: 0.3,
        sway: [0.01, 0.04],
        swayFreq: [0.5, 1.2],
        colorFor: (r, out) => out.copy(rain).multiplyScalar(0.35 + r() * 0.3),
      });
      const glintPhase = rnd() * Math.PI * 2;
      spawnParticles(atmo, rnd, {
        ...vol,
        name: 'haze-glints',
        count: 70 * density,
        tex: glowTexture(),
        size: 0.15,
        opacity: 0.16,
        blending: THREE.AdditiveBlending,
        yMin: 0.15,
        yMax: 1.7,
        vy: [-0.03, 0.03],
        windSpeed: 0.12,
        sway: [0.1, 0.25],
        swayFreq: [0.2, 0.6],
        colorFor: (r, out) => out.copy(accent).multiplyScalar(0.25 + r() * 0.25),
        pulse: (t) => 0.55 + 0.45 * Math.sin(t * 0.7 + glintPhase),
      });
      break;
    }
    case 'Ice': { // slow tumbling snow
      const snowA = new THREE.Color('#e8f4fb');
      const snowB = new THREE.Color('#bcd8ea');
      spawnParticles(atmo, rnd, {
        ...vol,
        name: 'snow',
        count: 480 * density,
        tex: glowTexture(),
        size: 0.24,
        opacity: 0.5,
        blending: THREE.NormalBlending,
        yMin: 0,
        yMax: 8,
        vy: [-0.85, -0.35],
        windSpeed: 0.3,
        sway: [0.25, 0.6],
        swayFreq: [0.25, 0.8],
        colorFor: (r, out) => out.copy(snowA).lerp(snowB, r()).multiplyScalar(0.8 + r() * 0.3),
      });
      break;
    }
    case 'Ruins': { // floating ash flecks
      const ashA = new THREE.Color('#a99e90');
      const ashB = new THREE.Color('#6d655b');
      spawnParticles(atmo, rnd, {
        ...vol,
        name: 'ash',
        count: 240 * density,
        tex: glowTexture(),
        size: 0.15,
        opacity: 0.34,
        blending: THREE.NormalBlending,
        yMin: 0.2,
        yMax: 7,
        vy: [-0.34, 0.16],
        windSpeed: 0.5,
        sway: [0.2, 0.5],
        swayFreq: [0.2, 0.7],
        colorFor: (r, out) => out.copy(ashA).lerp(ashB, r()).multiplyScalar(0.75 + r() * 0.4),
      });
      break;
    }
    case 'Toxic': { // luminous drifting spores, slow upward drift
      const breathe = rnd() * Math.PI * 2;
      spawnParticles(atmo, rnd, {
        ...vol,
        name: 'spores',
        count: 230 * density,
        tex: glowTexture(),
        size: 0.19,
        opacity: 0.3,
        blending: THREE.AdditiveBlending,
        yMin: 0.15,
        yMax: 5.5,
        vy: [0.04, 0.2],
        windSpeed: 0.25,
        sway: [0.25, 0.5],
        swayFreq: [0.3, 0.8],
        colorFor: (r, out) => out.copy(accent).multiplyScalar(0.3 + r() * 0.25),
        pulse: (t) => 0.75 + 0.25 * Math.sin(t * 0.5 + breathe),
      });
      break;
    }
    case 'Crimson': { // rising embers with flicker; a few hot points may pop
      const ember = new THREE.Color('#d4592a');
      const hot = new THREE.Color('#ffa050');
      spawnParticles(atmo, rnd, {
        ...vol,
        name: 'embers',
        count: 200 * density,
        tex: glowTexture(),
        size: 0.13,
        opacity: 0.5,
        blending: THREE.AdditiveBlending,
        yMin: 0.1,
        yMax: 7,
        vy: [0.45, 1.2],
        windSpeed: 0.3,
        sway: [0.2, 0.5],
        swayFreq: [0.8, 1.8],
        colorFor: (r, out) => (r() < 0.12
          ? out.copy(hot).multiplyScalar(1.05 + r() * 0.25)
          : out.copy(ember).multiplyScalar(0.45 + r() * 0.35)),
        pulse: (t) => 0.65 + 0.35 * (0.5 + 0.5 * Math.sin(t * 11.3) * Math.sin(t * 5.1 + 1.3)),
      });
      break;
    }
    case 'Spree': // fine drizzle with faint streaks (also the fallback)
    default: {
      const drizzle = new THREE.Color('#a9bdca');
      spawnParticles(atmo, rnd, {
        ...vol,
        name: 'drizzle',
        count: 520 * density,
        tex: streakTexture(),
        size: 0.42,
        opacity: 0.3,
        blending: THREE.NormalBlending,
        yMin: 0,
        yMax: 9,
        vy: [-5.4, -3.8],
        windSpeed: 0.5,
        sway: [0.02, 0.06],
        swayFreq: [0.5, 1.2],
        colorFor: (r, out) => out.copy(drizzle).multiplyScalar(0.75 + r() * 0.35),
      });
      break;
    }
  }
}
