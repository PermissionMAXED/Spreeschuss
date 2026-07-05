import * as THREE from 'three';
import { mergeInto, hashStr, mulberry32 } from './util.js';

// =====================================================================
// FROZEN INTERFACE — gameplay structures (the ONLY collider source).
//
//   WALL_HEIGHT (6), WALL_THICKNESS (1)
//     Perimeter wall dimensions. Collider layout is FROZEN.
//
//   buildStructures(group, map, mats, rand) -> colliders[]
//     Adds the floor, the dark out-of-bounds apron, the 4 perimeter
//     walls and every box in map.boxes to `group`, and returns the
//     collider array: one AABB {min,max} per perimeter wall and per box,
//     EXACTLY center±size/2. Nothing else in the map build may add
//     colliders. `mats` comes from materials.js; `rand` is the shared
//     deterministic PRNG (unused here — structures must stay purely
//     data-driven so the skyline draw order stays stable; decoration
//     jitter uses a private map-seeded PRNG instead).
//
// All boxes sharing a material are merged into ONE mesh (huge draw-call
// saving, since every mesh is also redrawn into the shadow map).
// Colliders are tracked independently and stay exactly center±size/2
// per box.
//
// ------------------------- ARCHITECTURAL DRESSING (NO colliders) ----
// Every collider box is dressed so it reads as designed architecture
// instead of a bare textured cube. Dressing is classified from the box
// dimensions alone (deterministic; jitter comes from the private PRNG):
//
//   lintels (bottom >= 2.4)  underside frame + cross ribs, door-jamb
//                            boards / corner strips on the adjacent
//                            wall faces, glow door-edge markers;
//   low cover (top <= 0.78)  crate framing: corner strips, top-edge
//                            rims and wrap-around straps;
//   platforms (h <= 1.7)     top-edge rims + corner strips;
//   walls (thin + long)      light cap slab, dark base skirt, periodic
//                            through-wall pilasters;
//   blocks (chunky)          base skirt, corner edge guards, roof-lip
//                            ring, inset panel seam grid;
//   pillars                  skirt + cap slab + corner guards;
//   accent boxes             thin dark frames (end collars / corner
//                            tabs) so the glow strips look built-in.
//
// The perimeter walls get buttress ribs (inside face), coping stones
// with a varied cap line and corner finials (all above the collider
// top, unreachable). The floor is a set of merged patches: a border
// band near the walls sits ~2 mm proud (visual only, coverage
// identical), with dark expansion-joint lines covering the seams.
//
// HITSCAN / NAV HONESTY (bullets + movement resolve against the AABBs,
// never against meshes):
//   - trim on or near collider faces stays within +-0.05 m of the
//     collider surface. Distinct proudness tiers (0.015 / 0.02 / 0.03 /
//     0.035..0.04 / 0.045 / 0.05) keep stacked trim pieces off each
//     other's render planes (no z-fighting);
//   - anything chunkier (perimeter coping/finials, tall-roof lips) sits
//     above 2.6 m over walkable ground or fully inside a box volume;
//   - nothing is added into doorway openings below 2.4 m — jamb boards
//     hug the wall collider end faces within +-0.045.
//
// PERFORMANCE: merge-by-material stays. This module emits at most:
// 1 floor + 1 apron + one mesh per box color (2 in practice) + 3 trim
// meshes (dark / light cap / glow micro) — ~7 meshes, well under 12.
// =====================================================================

export const WALL_HEIGHT = 6;
export const WALL_THICKNESS = 1;

// Scale BoxGeometry UVs so textures keep world-scale density on every face
// (one shared material per color instead of a clone per box). Face order in
// BoxGeometry: +x, -x, +y, -y, +z, -z with 4 consecutive uv verts per face.
const TILE = 3; // world units per texture repeat
function scaleBoxUVs(geo, sx, sy, sz, tile = TILE) {
  const uv = geo.attributes.uv;
  const dims = [
    [sz, sy], [sz, sy], // ±x
    [sx, sz], [sx, sz], // ±y
    [sx, sy], [sx, sy], // ±z
  ];
  for (let f = 0; f < 6; f++) {
    const [du, dv] = dims[f];
    for (let i = f * 4; i < f * 4 + 4; i++) {
      uv.setXY(i, uv.getX(i) * Math.max(0.5, du / tile), uv.getY(i) * Math.max(0.5, dv / tile));
    }
  }
  uv.needsUpdate = true;
  return geo;
}

// Decoration box helper (untextured trim materials — UVs irrelevant).
function deco(arr, sx, sy, sz, x, y, z) {
  const g = new THREE.BoxGeometry(sx, sy, sz);
  g.translate(x, y, z);
  arr.push(g);
}

function linspace(a, b, n) {
  if (n <= 1) return [(a + b) / 2];
  const out = [];
  for (let i = 0; i < n; i++) out.push(a + (i / (n - 1)) * (b - a));
  return out;
}

// ---------------------------------------------------------------- floor
// A few large merged patches instead of one plane: 3 interior slabs plus
// a border band along the walls lifted ~2 mm (purely visual; total
// coverage is identical, no gaps). UVs are rewritten from world position
// so texture density/alignment matches the original single plane.
function buildFloor(group, map, mats, darkGeos) {
  const [w, d] = map.size;
  const B = 1.8;        // border band width
  const LIFT = 0.0018;  // border lift (visual only)
  const geos = [];
  const patch = (x, z, sx, sz, y) => {
    const g = new THREE.PlaneGeometry(sx, sz);
    g.rotateX(-Math.PI / 2);
    g.translate(x, y, z);
    const p = g.attributes.position;
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (p.getX(i) + w / 2) / w, (p.getZ(i) + d / 2) / d);
    geos.push(g);
  };

  const iw = w - 2 * B;
  const idz = d - 2 * B;
  for (const k of [-1, 0, 1]) patch(0, k * (idz / 3), iw, idz / 3, 0); // interior slabs
  patch(0, -(d - B) / 2, w, B, LIFT); // border band (n/s/w/e)
  patch(0, (d - B) / 2, w, B, LIFT);
  patch(-(w - B) / 2, 0, B, idz, LIFT);
  patch((w - B) / 2, 0, B, idz, LIFT);

  const mesh = mergeInto(group, geos, mats.floorMat);
  mesh.receiveShadow = true;
  mesh.name = 'structFloor';

  // dark expansion-joint lines covering the patch seams (<= 4 mm tall,
  // flat floor decal territory — no collider anywhere near the floor)
  const jx = w / 2 - B;
  const jz = d / 2 - B;
  deco(darkGeos, 2 * jx + 0.12, 0.004, 0.12, 0, 0.002, -jz);
  deco(darkGeos, 2 * jx + 0.12, 0.004, 0.12, 0, 0.002, jz);
  deco(darkGeos, 0.12, 0.0035, 2 * jz - 0.16, -jx, 0.00175, 0);
  deco(darkGeos, 0.12, 0.0035, 2 * jz - 0.16, jx, 0.00175, 0);
  for (const k of [-1, 1]) deco(darkGeos, iw - 0.16, 0.003, 0.1, 0, 0.0015, k * (idz / 6));
}

// ------------------------------------------------ shape classification
function describeBoxes(map) {
  const pal = map.palette;
  return (map.boxes || []).map((b) => {
    const [sx, sy, sz] = b.size;
    const [x, y, z] = b.pos;
    return {
      sx, sy, sz, x, y, z,
      hx: sx / 2, hy: sy / 2, hz: sz / 2,
      bottom: y - sy / 2, top: y + sy / 2,
      minX: x - sx / 2, maxX: x + sx / 2,
      minZ: z - sz / 2, maxZ: z + sz / 2,
      accent: b.color != null && b.color === pal.accent,
    };
  });
}

// True when another box sits on/over most of this box's top face (e.g. the
// defender-screen glow strip) — a cap slab there would be buried, skip it.
function topCovered(it, items) {
  const area = it.sx * it.sz;
  for (const o of items) {
    if (o === it || o.bottom > it.top + 0.15 || o.top < it.top - 0.05) continue;
    const ox = Math.min(it.maxX, o.maxX) - Math.max(it.minX, o.minX);
    const oz = Math.min(it.maxZ, o.maxZ) - Math.max(it.minZ, o.minZ);
    if (ox > 0 && oz > 0 && ox * oz > area * 0.5) return true;
  }
  return false;
}

// -------------------------------------------------------- box dressing
// All offsets keep trim within +-0.05 of the box's collider faces; see
// header. Proudness tiers are staggered so overlapping trim pieces never
// share a render plane.

// Crate framing for low cover: corner strips + top-edge rims (+ straps).
function frameCrate(it, dark, rng, withStraps) {
  const y0 = it.bottom < 0.1 ? 0.003 : it.bottom - 0.03;
  const gh = it.top + 0.028 - y0;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      deco(dark, 0.08, gh, 0.08, it.x + sx * it.hx, y0 + gh / 2, it.z + sz * it.hz);
    }
  }
  deco(dark, it.sx - 0.02, 0.07, 0.07, it.x, it.top, it.z - it.hz);
  deco(dark, it.sx - 0.02, 0.07, 0.07, it.x, it.top, it.z + it.hz);
  deco(dark, 0.07, 0.07, it.sz - 0.02, it.x - it.hx, it.top, it.z);
  deco(dark, 0.07, 0.07, it.sz - 0.02, it.x + it.hx, it.top, it.z);

  if (!withStraps) return;
  const alongX = it.sx >= it.sz;
  const len = alongX ? it.sx : it.sz;
  if (len < 1.3) return;
  const n = len > 2.4 ? 2 : 1;
  const centers = n === 1
    ? [(rng() - 0.5) * len * 0.2]
    : [-len / 4 + (rng() - 0.5) * 0.2, len / 4 + (rng() - 0.5) * 0.2];
  const sh = it.sy - 0.03; // side piece height (top at top-0.024, clear of rims)
  for (const c of centers) {
    if (alongX) {
      deco(dark, 0.14, 0.06, it.sz + 0.09, it.x + c, it.top, it.z);
      deco(dark, 0.14, sh, 0.06, it.x + c, 0.003 + sh / 2, it.z - it.hz);
      deco(dark, 0.14, sh, 0.06, it.x + c, 0.003 + sh / 2, it.z + it.hz);
    } else {
      deco(dark, it.sx + 0.09, 0.06, 0.14, it.x, it.top, it.z + c);
      deco(dark, 0.06, sh, 0.14, it.x - it.hx, 0.003 + sh / 2, it.z + c);
      deco(dark, 0.06, sh, 0.14, it.x + it.hx, 0.003 + sh / 2, it.z + c);
    }
  }
}

// Dark base skirt ring wrapping the box bottom (0.05 proud all around).
function baseSkirt(it, dark) {
  if (it.bottom > 0.1) return;
  deco(dark, it.sx + 0.1, 0.42, it.sz + 0.1, it.x, 0.003 + 0.21, it.z);
}

// Light cap slab on wall/pillar tops (+-0.05 of the top face).
function capSlab(it, items, cap) {
  if (topCovered(it, items)) return;
  deco(cap, it.sx + 0.09, 0.1, it.sz + 0.09, it.x, it.top, it.z);
}

// Periodic pilaster strips through a thin wall (0.04 proud on both faces;
// bottoms tucked into the skirt, tops into the cap slab).
function wallPilasters(it, dark, rng) {
  const alongX = it.sx >= it.sz;
  const len = alongX ? it.sx : it.sz;
  const y0 = 0.4;
  const y1 = it.top - 0.03;
  const hgt = y1 - y0;
  if (hgt < 0.6 || len < 2.4) return;
  const count = Math.max(2, Math.round(len / 3.2));
  const lo = (alongX ? it.minX : it.minZ) + 0.45;
  const hi = (alongX ? it.maxX : it.maxZ) - 0.45;
  for (const p of linspace(lo, hi, count)) {
    const c = Math.min(hi, Math.max(lo, p + (rng() - 0.5) * 0.3));
    if (alongX) deco(dark, 0.32, hgt, it.sz + 0.08, c, y0 + hgt / 2, it.z);
    else deco(dark, it.sx + 0.08, hgt, 0.32, it.x, y0 + hgt / 2, c);
  }
}

// Vertical edge guards on the 4 corners of blocks/pillars.
function cornerGuards(it, dark) {
  const y0 = it.bottom < 0.1 ? 0.003 : it.bottom - 0.03;
  const gh = it.top - 0.08 - y0;
  if (gh < 0.4) return;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      deco(dark, 0.09, gh, 0.09, it.x + sx * it.hx, y0 + gh / 2, it.z + sz * it.hz);
    }
  }
}

// Roof-lip ring along a block's top edges. Chunkier profile only when the
// roof is above 2.6 m (unreachable-for-hitscan territory).
function roofLip(it, cap) {
  const tall = it.top >= 2.65;
  const lipH = tall ? 0.12 : 0.09;
  const lipY = tall ? it.top + 0.01 : it.top;
  deco(cap, it.sx + 0.09, lipH, 0.08, it.x, lipY, it.z - it.hz);
  deco(cap, it.sx + 0.09, lipH, 0.08, it.x, lipY, it.z + it.hz);
  deco(cap, 0.07, lipH - 0.03, it.sz - 0.02, it.x - it.hx, lipY - 0.02, it.z);
  deco(cap, 0.07, lipH - 0.03, it.sz - 0.02, it.x + it.hx, lipY - 0.02, it.z);
}

// Inset panel seam grid on a block's side faces (0.015/0.02 proud strips
// read as panel joints without leaving the collider surface).
function panelSeams(it, dark) {
  const faces = [
    { n: 'z', pos: it.z - it.hz, len: it.sx, cx: it.x, lo: it.minX },
    { n: 'z', pos: it.z + it.hz, len: it.sx, cx: it.x, lo: it.minX },
    { n: 'x', pos: it.x - it.hx, len: it.sz, cx: it.z, lo: it.minZ },
    { n: 'x', pos: it.x + it.hx, len: it.sz, cx: it.z, lo: it.minZ },
  ];
  for (const f of faces) {
    if (f.len < 2.2) continue;
    // vertical seams
    const nV = Math.floor(f.len / 2.7);
    const yV0 = 0.5;
    const yV1 = it.top - 0.45;
    if (nV >= 1 && yV1 - yV0 > 0.7) {
      for (let i = 1; i <= nV; i++) {
        const c = f.lo + (i / (nV + 1)) * f.len;
        if (f.n === 'z') deco(dark, 0.06, yV1 - yV0, 0.03, c, (yV0 + yV1) / 2, f.pos);
        else deco(dark, 0.03, yV1 - yV0, 0.06, f.pos, (yV0 + yV1) / 2, c);
      }
    }
    // horizontal seams
    const ys = [];
    if (it.top >= 1.9) ys.push(1.15);
    if (it.top >= 3.3) ys.push(it.top - 0.6);
    for (const y of ys) {
      if (f.n === 'z') deco(dark, f.len - 0.5, 0.06, 0.04, f.cx, y, f.pos);
      else deco(dark, 0.04, 0.06, f.len - 0.5, f.pos, y, f.cx);
    }
  }
}

// Thin dark frame on accent (glowing) boxes: end collars on elongated
// strips, corner tabs on squarish slabs — reads as a manufactured fixture.
function accentFrame(it, dark) {
  const elongated = Math.max(it.sx, it.sz) >= 2 * Math.min(it.sx, it.sz);
  if (elongated && Math.max(it.sx, it.sz) >= 0.9) {
    if (it.sx >= it.sz) {
      deco(dark, 0.16, it.sy + 0.07, it.sz + 0.07, it.minX + 0.1, it.y, it.z);
      deco(dark, 0.16, it.sy + 0.07, it.sz + 0.07, it.maxX - 0.1, it.y, it.z);
    } else {
      deco(dark, it.sx + 0.07, it.sy + 0.07, 0.16, it.x, it.y, it.minZ + 0.1);
      deco(dark, it.sx + 0.07, it.sy + 0.07, 0.16, it.x, it.y, it.maxZ - 0.1);
    }
  } else {
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        deco(dark, 0.07, it.sy + 0.06, 0.07, it.x + sx * it.hx, it.y, it.z + sz * it.hz);
      }
    }
  }
}

// ------------------------------------------------------------- lintels
// Underside frame + cross ribs (coffered ceiling read on wide connector
// lintels), all within +-0.045 of the bottom face and above 2.4 m.
function lintelUnderside(it, dark) {
  if (it.sy < 0.35 || Math.min(it.sx, it.sz) < 0.8) return;
  const y = it.bottom;
  if (it.sx >= it.sz) {
    deco(dark, it.sx - 0.06, 0.09, 0.09, it.x, y, it.z - it.hz + 0.075);
    deco(dark, it.sx - 0.06, 0.09, 0.09, it.x, y, it.z + it.hz - 0.075);
    const n = Math.floor((it.sx - 0.8) / 1.7);
    for (let i = 1; i <= n; i++) {
      deco(dark, 0.09, 0.07, Math.max(0.3, it.sz - 0.28), it.minX + (i / (n + 1)) * it.sx, y - 0.005, it.z);
    }
  } else {
    deco(dark, 0.09, 0.09, it.sz - 0.06, it.x - it.hx + 0.075, y, it.z);
    deco(dark, 0.09, 0.09, it.sz - 0.06, it.x + it.hx - 0.075, y, it.z);
    const n = Math.floor((it.sz - 0.8) / 1.7);
    for (let i = 1; i <= n; i++) {
      deco(dark, Math.max(0.3, it.sx - 0.28), 0.07, 0.09, it.x, y - 0.005, it.minZ + (i / (n + 1)) * it.sz);
    }
  }
}

// Find the wall boxes whose end faces flank the gap below a lintel: the
// lintel footprint overlaps the wall by a thin sliver (<= 0.45) along one
// axis and a wide run (>= 0.5) along the other. The wall face inside that
// sliver is the door jamb.
function findJambs(it, items) {
  const jambs = [];
  const eps = 1e-6;
  for (const o of items) {
    if (o === it || o.bottom > 0.5 || o.top < it.bottom - 0.45) continue;
    const x0 = Math.max(it.minX, o.minX);
    const x1 = Math.min(it.maxX, o.maxX);
    const z0 = Math.max(it.minZ, o.minZ);
    const z1 = Math.min(it.maxZ, o.maxZ);
    const ox = x1 - x0;
    const oz = z1 - z0;
    if (ox <= 0 || oz <= 0) continue;
    if (ox <= 0.45 && oz >= 0.5) {
      if (x1 >= o.maxX - eps) jambs.push({ axis: 'x', face: o.maxX, dir: 1, c0: z0, c1: z1, wall: o });
      else if (x0 <= o.minX + eps) jambs.push({ axis: 'x', face: o.minX, dir: -1, c0: z0, c1: z1, wall: o });
    } else if (oz <= 0.45 && ox >= 0.5) {
      if (z1 >= o.maxZ - eps) jambs.push({ axis: 'z', face: o.maxZ, dir: 1, c0: x0, c1: x1, wall: o });
      else if (z0 <= o.minZ + eps) jambs.push({ axis: 'z', face: o.minZ, dir: -1, c0: x0, c1: x1, wall: o });
    }
  }
  return jambs;
}

// Slim door-frame trims hugging the jamb collider faces (+-0.045), plus
// glow door-edge markers / door headers so open paths read at a glance.
function dressDoorway(it, items, dark, glow) {
  const jambs = findJambs(it, items);
  const hgt = it.bottom + 0.05 - 0.003;
  const yMid = 0.003 + hgt / 2;
  for (const j of jambs) {
    const wide = j.c1 - j.c0;
    const cMid = (j.c0 + j.c1) / 2;
    if (j.axis === 'x') {
      if (wide <= 1.6) {
        deco(dark, 0.09, hgt, wide + 0.08, j.face, yMid, cMid);
        for (const s of [-1, 1]) {
          deco(glow, 0.12, 0.9, 0.08, j.face - j.dir * 0.3, 1.5, j.wall.z + s * j.wall.hz);
        }
      } else {
        deco(dark, 0.09, hgt, 0.3, j.face, yMid, j.c0 + 0.35);
        deco(dark, 0.09, hgt, 0.3, j.face, yMid, j.c1 - 0.35);
      }
    } else if (wide <= 1.6) {
      deco(dark, wide + 0.08, hgt, 0.09, cMid, yMid, j.face);
      for (const s of [-1, 1]) {
        deco(glow, 0.08, 0.9, 0.12, j.wall.x + s * j.wall.hx, 1.5, j.face - j.dir * 0.3);
      }
    } else {
      deco(dark, 0.3, hgt, 0.09, j.c0 + 0.35, yMid, j.face);
      deco(dark, 0.3, hgt, 0.09, j.c1 - 0.35, yMid, j.face);
    }
  }
  // glowing door header on the lintel faces across the opening (skip accent
  // lintels — those glow on their own)
  if (!it.accent && jambs.length === 2 && jambs[0].axis === jambs[1].axis) {
    const doorW = Math.abs(jambs[0].face - jambs[1].face);
    const mid = (jambs[0].face + jambs[1].face) / 2;
    if (doorW > 1.0 && it.sy >= 0.5) {
      if (jambs[0].axis === 'x') {
        for (const s of [-1, 1]) deco(glow, Math.max(0.6, doorW - 0.5), 0.14, 0.08, mid, it.bottom + 0.28, it.z + s * it.hz);
      } else {
        for (const s of [-1, 1]) deco(glow, 0.08, 0.14, Math.max(0.6, doorW - 0.5), it.x + s * it.hx, it.bottom + 0.28, mid);
      }
    }
  }
}

// ---------------------------------------------------- perimeter walls
// Buttress ribs on the inside faces (0.045 proud, split around the glow
// band perimeter.js mounts at y 2.63..2.77), coping stones with a varied
// cap line and corner finials on top (above the collider, unreachable).
function dressPerimeter(w, d, dark, cap, rng) {
  const t = WALL_THICKNESS;
  const yCop = WALL_HEIGHT + 0.11; // tucked 0.01 into the perimeter roof cap
  const walls = [
    { axis: 'x', len: w, face: -d / 2 + t / 2, out: -d / 2 - 0.29 }, // north
    { axis: 'x', len: w, face: d / 2 - t / 2, out: d / 2 + 0.29 },   // south
    { axis: 'z', len: d, face: -w / 2 + t / 2, out: -w / 2 - 0.29 }, // west
    { axis: 'z', len: d, face: w / 2 - t / 2, out: w / 2 + 0.29 },   // east
  ];
  for (const wall of walls) {
    // buttress ribs, two segments clearing the perimeter glow band
    let c = -wall.len / 2 + 2.2 + rng() * 2;
    while (c < wall.len / 2 - 2.2) {
      for (const [y0, y1] of [[0.42, 2.56], [2.84, 5.62]]) {
        const h = y1 - y0;
        if (wall.axis === 'x') deco(dark, 0.34, h, 0.09, c, y0 + h / 2, wall.face);
        else deco(dark, 0.09, h, 0.34, wall.face, y0 + h / 2, c);
      }
      c += 5.6 + rng() * 2.2;
    }
    // coping stones along the outer top edge (bottom tucked into the roof
    // cap perimeter.js places at y 6.0..6.12; glow line at z|x ~0 untouched)
    let s = -wall.len / 2 + 1.5;
    for (;;) {
      const len = 1.3 + rng() * 0.9;
      const h = 0.1 + rng() * 0.16;
      if (s + len > wall.len / 2 - 1.5) break;
      if (wall.axis === 'x') deco(cap, len, h, 0.48, s + len / 2, yCop + h / 2, wall.out);
      else deco(cap, 0.48, h, len, wall.out, yCop + h / 2, s + len / 2);
      s += len + 0.5 + rng() * 0.8;
    }
  }
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) deco(cap, 1.26, 0.34, 1.26, sx * (w / 2), yCop + 0.17, sz * (d / 2));
  }
}

// ---------------------------------------------------------------- main
export function buildStructures(group, map, mats, rand) { // eslint-disable-line no-unused-vars
  const pal = map.palette;
  const [w, d] = map.size;
  // Private deterministic PRNG for decoration jitter. The shared `rand`
  // stays unconsumed: skyline/props draw from it and must stay stable.
  const rng = mulberry32(hashStr('structures:' + (map.id || map.name || 'map')));

  // trim materials (module-local; renderer.clearScene() disposes them)
  const darkMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(pal.wall).multiplyScalar(0.42),
    roughness: 0.62, metalness: 0.3, envMapIntensity: 0.5,
  });
  const capMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(pal.wall).lerp(new THREE.Color('#ffffff'), 0.22),
    roughness: 0.8, metalness: 0.1, envMapIntensity: 0.4,
  });
  const glowMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(pal.accent).multiplyScalar(0.55),
    emissive: new THREE.Color(pal.accent), emissiveIntensity: 0.9,
    roughness: 0.4, metalness: 0.2, envMapIntensity: 0.4,
  });
  const dark = [];
  const cap = [];
  const glow = [];

  buildFloor(group, map, mats, dark);

  // dark apron so the world outside the arena isn't a void below the sky
  // (Lambert: large fill area, doesn't need PBR shading)
  const apron = new THREE.Mesh(
    new THREE.PlaneGeometry(w + 260, d + 260),
    new THREE.MeshLambertMaterial({ color: new THREE.Color(pal.fog ?? pal.skyBottom).multiplyScalar(0.45) }),
  );
  apron.rotation.x = -Math.PI / 2;
  apron.position.y = -0.03;
  group.add(apron);

  const colliders = [];
  const boxBuckets = new Map(); // material -> geometries
  const addBox = (pos, size, color) => {
    const geo = scaleBoxUVs(new THREE.BoxGeometry(size[0], size[1], size[2]), size[0], size[1], size[2]);
    geo.translate(pos[0], pos[1], pos[2]);
    const isAccent = color != null && color === pal.accent;
    const mat = isAccent ? mats.accentBoxMat : mats.wallMat(color || pal.wall);
    if (!boxBuckets.has(mat)) boxBuckets.set(mat, []);
    boxBuckets.get(mat).push(geo);
    colliders.push({
      min: new THREE.Vector3(pos[0] - size[0] / 2, pos[1] - size[1] / 2, pos[2] - size[2] / 2),
      max: new THREE.Vector3(pos[0] + size[0] / 2, pos[1] + size[1] / 2, pos[2] + size[2] / 2),
    });
  };

  // Outer perimeter walls (collider layout FROZEN: height 6, thickness 1)
  const H = WALL_HEIGHT;
  const t = WALL_THICKNESS;
  addBox([0, H / 2, -d / 2], [w + t, H, t], pal.wall);
  addBox([0, H / 2, d / 2], [w + t, H, t], pal.wall);
  addBox([-w / 2, H / 2, 0], [t, H, d + t], pal.wall);
  addBox([w / 2, H / 2, 0], [t, H, d + t], pal.wall);

  // Interior boxes / cover / walls
  for (const b of map.boxes || []) {
    addBox(b.pos, b.size, b.color);
  }
  for (const [mat, geos] of boxBuckets) {
    const mesh = mergeInto(group, geos, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = 'structBoxes';
  }

  // ---- architectural dressing (decoration only — never touches colliders)
  dressPerimeter(w, d, dark, cap, rng);

  const items = describeBoxes(map);
  for (const it of items) {
    const thin = Math.min(it.sx, it.sz);
    const long = Math.max(it.sx, it.sz);
    if (it.bottom >= 2.4) {
      // lintel over a gap (headroom preserved by data contract)
      lintelUnderside(it, dark);
      dressDoorway(it, items, dark, glow);
      if (it.accent) accentFrame(it, dark);
    } else if (it.top <= 0.78) {
      frameCrate(it, dark, rng, true); // low lane cover: crate read
    } else if (it.accent && it.sy <= 0.45) {
      accentFrame(it, dark); // floated glow strip (e.g. defender screens)
    } else if (it.sy <= 1.7) {
      frameCrate(it, dark, rng, false); // walkable platform: rim + corners
    } else if (thin <= 1.8 && long >= 2.6) {
      baseSkirt(it, dark); // interior wall
      capSlab(it, items, cap);
      wallPilasters(it, dark, rng);
    } else if (thin <= 1.8) {
      baseSkirt(it, dark); // pillar
      capSlab(it, items, cap);
      cornerGuards(it, dark);
    } else {
      baseSkirt(it, dark); // building block
      cornerGuards(it, dark);
      roofLip(it, cap);
      panelSeams(it, dark);
    }
  }

  const darkMesh = mergeInto(group, dark, darkMat);
  if (darkMesh) {
    darkMesh.castShadow = true;
    darkMesh.receiveShadow = true;
    darkMesh.name = 'structTrimDark';
  }
  const capMesh = mergeInto(group, cap, capMat);
  if (capMesh) {
    capMesh.castShadow = true;
    capMesh.receiveShadow = true;
    capMesh.name = 'structTrimCap';
  }
  const glowMesh = mergeInto(group, glow, glowMat);
  if (glowMesh) glowMesh.name = 'structTrimGlow';

  return colliders;
}
