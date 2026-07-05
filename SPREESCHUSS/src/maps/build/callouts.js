import * as THREE from 'three';
import { hashStr, mulberry32 } from './util.js';

// =====================================================================
// FROZEN INTERFACE — location callouts (decoration ONLY).
//
//   addCallouts(group, map, sites)
//     Adds readable location-name markers ("MID", "A MAIN", "CONNECTOR"
//     etc.) as painted floor decals or wall-mounted plates so players
//     can call positions. `group` is the map group, `map` the raw
//     map-data object (map.spawns holds raw [x, z, rot?] arrays;
//     map.boxes the collider boxes), `sites` the built sites object
//     { KEY: { center: THREE.Vector3, radius, ring } } from
//     addSiteMarkers (map.sites holds the raw data). Callout names must
//     derive deterministically from map data / the local PRNG.
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
// Implementation — floating GERMAN region labels so players can call
// positions. Regions derive deterministically from the map layout only:
//   - every built site gets "SPOT <KEY>" above its ring (y = 5.2);
//   - the map center gets "MITTE";
//   - plant maps: "ANMARSCH" halfway between the attacker spawn centroid
//     and the center, "HOF" halfway between the defender centroid and
//     the center (plant maps run attackers -z -> defenders +z);
//   - plant maps: the widest clearly-distinct open corridor on each
//     flank ("GASSE LINKS" at +x / "GASSE RECHTS" at -x, from the
//     attacker travel direction) found by scanning map.boxes footprint
//     gaps on a coarse 1 m grid — skipped gracefully when ambiguous;
//   - FFA maps: center label + three compass ring labels ("NORD" = -z,
//     matching minimap-up, "OST" = +x, "SÜD" = +z, "WEST" = -x) by
//     bearing from the center (one direction dropped via the PRNG).
// Each label is ONE THREE.Sprite (shared Sprite geometry — never
// disposed) with a fresh 256x64 CanvasTexture: crisp uppercase text,
// palette-accent underline, transparent background. Labels hang
// overhead at y 4.6-5.4 (rule 3c; below WALL_HEIGHT 6), render with
// depthTest so walls occlude them, and an onBeforeRender hook fades
// material.opacity by camera distance (full 10-35 m, gone beyond 45 m,
// also faded out when nearly overhead so they never clutter aim).
// Totals: 4-7 labels per map, hard cap 8 sprites, zero colliders/lights.

const LABEL_W = 256; // canvas <= 256 px (rule 6)
const LABEL_H = 64;
const MAX_LABELS = 8;
const BASE_OPACITY = 0.5; // <= 0.55, subtle
const MIN_GAP = 7; // m — minimum XZ spacing between labels (no overlap)

// CPU-side canvas cache (rule 4: canvases may be cached, textures must be
// fresh wrappers per call — same pattern as engine/textures.js). Painting
// is a pure function of (text, accent), so caching is deterministic.
const labelCanvasCache = new Map();

// sRGB discipline from engine/textures.js: three r152+ converts hex input
// into the LINEAR working space; canvas painting needs sRGB bytes.
function cssCol(hex, mul = 1, alpha = 1) {
  const c = new THREE.Color(hex).multiplyScalar(mul).convertLinearToSRGB();
  const b = (v) => Math.max(0, Math.min(255, Math.round(v * 255)));
  return `rgba(${b(c.r)},${b(c.g)},${b(c.b)},${alpha})`;
}

function labelCanvas(text, accentHex) {
  const key = `${text}:${accentHex}`;
  let c = labelCanvasCache.get(key);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = LABEL_W;
  c.height = LABEL_H;
  const ctx = c.getContext('2d');
  // transparent background — only text + underline are painted
  let size = 30;
  ctx.font = `800 ${size}px Arial, sans-serif`;
  const maxW = LABEL_W - 32;
  const measured = ctx.measureText(text).width;
  if (measured > maxW) {
    size = Math.floor(size * (maxW / measured));
    ctx.font = `800 ${size}px Arial, sans-serif`;
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const cx = LABEL_W / 2;
  // soft dark halo pass for contrast against bright skies, then a crisp pass
  ctx.shadowColor = 'rgba(4,8,12,0.9)';
  ctx.shadowBlur = 6;
  ctx.fillStyle = 'rgba(234,241,247,0.96)';
  ctx.fillText(text, cx, 26);
  ctx.shadowBlur = 0;
  ctx.fillText(text, cx, 26);
  // palette accent underline with end ticks
  const uw = Math.min(LABEL_W - 24, ctx.measureText(text).width + 22);
  ctx.shadowColor = cssCol(accentHex, 1, 1);
  ctx.shadowBlur = 5;
  ctx.fillStyle = cssCol(accentHex, 1.1, 0.92);
  ctx.fillRect(cx - uw / 2, 47, uw, 3.5);
  ctx.fillRect(cx - uw / 2, 43, 2.5, 10);
  ctx.fillRect(cx + uw / 2 - 2.5, 43, 2.5, 10);
  ctx.shadowBlur = 0;
  labelCanvasCache.set(key, c);
  return c;
}

// Fresh CanvasTexture + SpriteMaterial per call (clearScene disposes both;
// the Sprite's shared geometry is guarded there and never disposed).
function makeLabelSprite(text, accentHex) {
  const tex = new THREE.CanvasTexture(labelCanvas(text, accentHex));
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = 4;
  const mat = new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    opacity: 0, // faded in by the distance hook
    depthTest: true, // walls occlude labels naturally
    depthWrite: false,
    sizeAttenuation: true,
  });
  const sp = new THREE.Sprite(mat);
  sp.scale.set(3.9, 3.9 * (LABEL_H / LABEL_W), 1);
  sp.name = `callout:${text}`;
  return sp;
}

function centroid(points) {
  if (!points || !points.length) return null;
  let x = 0;
  let z = 0;
  for (const p of points) { x += p[0]; z += p[1]; }
  return [x / points.length, z / points.length];
}

// --------------------------------------------------------------- lane scan
// Coarse-grid corridor detection over map.boxes footprints. A column of
// constant x is "open" where no impassable box (same top>0.8 / bottom<2.0
// criteria as the validator, inflated by the 0.45 player radius) covers it
// inside the central z band. Contiguous nearly-open columns form corridor
// runs; the widest clearly-distinct run per flank becomes a GASSE label.
function findFlankLanes(map) {
  const [w, d] = map.size;
  const hw = w / 2;
  const solid = (map.boxes || []).filter(
    (b) => b.pos[1] + b.size[1] / 2 > 0.8 && b.pos[1] - b.size[1] / 2 < 2.0,
  );
  const STEP = 1;
  const INFLATE = 0.45;
  const zHalf = d * 0.22; // central band between courtyard and choke zones
  const openAt = (x, z) => {
    for (const b of solid) {
      if (Math.abs(x - b.pos[0]) <= b.size[0] / 2 + INFLATE &&
          Math.abs(z - b.pos[2]) <= b.size[2] / 2 + INFLATE) return false;
    }
    return true;
  };
  // contiguous runs of nearly-open columns (a lane may still be crossed by
  // one door-wall, so require >= 85% open instead of fully open)
  const runs = [];
  let run = null;
  for (let x = -hw + 2; x <= hw - 2 + 1e-6; x += STEP) {
    let open = 0;
    let n = 0;
    let zSum = 0;
    for (let z = -zHalf; z <= zHalf + 1e-6; z += STEP) {
      n++;
      if (openAt(x, z)) { open++; zSum += z; }
    }
    if (open / n >= 0.85) {
      const zMean = zSum / open;
      if (!run) run = { x0: x, x1: x, zSum: zMean, cols: 1 };
      else { run.x1 = x; run.zSum += zMean; run.cols++; }
    } else if (run) { runs.push(run); run = null; }
  }
  if (run) runs.push(run);
  for (const r of runs) {
    r.width = r.x1 - r.x0 + STEP;
    r.cx = (r.x0 + r.x1) / 2;
    r.cz = r.zSum / r.cols;
  }
  // one clear flank corridor per side; the near-center strip belongs to
  // MITTE and is never a "Gasse"
  const flank = (sign) => {
    const cands = runs
      .filter((r) => r.width >= 3 && sign * r.cx > w * 0.15)
      .sort((a, b) => b.width - a.width);
    if (!cands.length) return null;
    if (cands.length > 1 && cands[1].width > cands[0].width - 1) return null; // ambiguous
    return cands[0];
  };
  // attackers travel -z -> +z, so their LEFT hand points to +x
  const left = flank(1);
  const right = flank(-1);
  return left && right ? { left, right } : null; // pair or nothing
}

// ------------------------------------------------------------------- main
export function addCallouts(group, map, sites) {
  // Local PRNG (rule 2) — NEVER the shared builder rand.
  const rnd = mulberry32(hashStr((map.id || map.name || 'map') + ':callouts'));

  const callouts = new THREE.Group();
  callouts.name = 'callouts';
  group.add(callouts);

  const accent = map.palette?.accent || '#43b7c7';
  const [w, d] = map.size || [50, 50];
  const placed = [];
  const camPos = new THREE.Vector3();
  const lblPos = new THREE.Vector3();

  // overhead band 4.6-5.4 (rule 3c: lowest point stays >= 4.1 >> 2.6)
  const jitterY = (base) => Math.min(5.4, Math.max(4.6, base + (rnd() - 0.5) * 0.16));

  const place = (text, x, z, y, required = false) => {
    if (callouts.children.length >= MAX_LABELS) return false;
    if (!required) {
      for (const p of placed) {
        if (Math.hypot(p.x - x, p.z - z) < MIN_GAP) return false; // no overlaps
      }
    }
    const sp = makeLabelSprite(text, accent);
    sp.position.set(x, y, z);
    const mat = sp.material;
    // distance fade (rule 5: onBeforeRender only): full at 10-35 m, gone
    // beyond 45 m; also fades away when nearly overhead to keep aim clean.
    sp.onBeforeRender = (renderer, scene, camera) => {
      camPos.setFromMatrixPosition(camera.matrixWorld);
      lblPos.setFromMatrixPosition(sp.matrixWorld);
      const dist = camPos.distanceTo(lblPos);
      const near = Math.min(1, Math.max(0, (dist - 4) / 6));
      const far = Math.min(1, Math.max(0, (45 - dist) / 10));
      mat.opacity = BASE_OPACITY * near * far;
    };
    callouts.add(sp);
    placed.push({ x, z });
    return true;
  };

  // --- sites: always labeled, above the ring ------------------------------
  for (const key of Object.keys(sites || {}).sort()) {
    const c = sites[key].center;
    place(`SPOT ${key}`, c.x, c.z, 5.2, true);
  }

  const spawns = map.spawns || {};
  const isPlant = !!(spawns.attackers?.length && spawns.defenders?.length);

  if (isPlant) {
    // --- center + approach/yard from spawn centroids -----------------------
    place('MITTE', 0, 0, jitterY(5.0));
    const att = centroid(spawns.attackers);
    const def = centroid(spawns.defenders);
    if (att) place('ANMARSCH', att[0] / 2, att[1] / 2, jitterY(4.8));
    if (def) place('HOF', def[0] / 2, def[1] / 2, jitterY(4.8));

    // --- flank corridors (skipped gracefully when ambiguous) ---------------
    const lanes = findFlankLanes(map);
    if (lanes) {
      place('GASSE LINKS', lanes.left.cx, lanes.left.cz, jitterY(4.7));
      place('GASSE RECHTS', lanes.right.cx, lanes.right.cz, jitterY(4.7));
    }
  } else {
    // --- FFA: center + three compass ring labels by bearing ----------------
    place('MITTE', 0, 0, jitterY(5.2));
    const r = Math.min(w, d) * 0.31;
    const dirs = [
      ['NORD', 0, -r], // -z is minimap-up
      ['OST', r, 0],
      ['SÜD', 0, r],
      ['WEST', -r, 0],
    ];
    const skip = Math.floor(rnd() * dirs.length);
    dirs.forEach(([text, x, z], i) => {
      if (i !== skip) place(text, x, z, jitterY(4.9));
    });
  }
}
