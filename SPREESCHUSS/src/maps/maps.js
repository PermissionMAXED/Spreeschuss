// Data-driven map registry. Standard plant maps + special FFA maps are
// generated procedurally from seeds so the game ships with many distinct
// layouts without any external assets.
//
// Plant maps rotate through FOUR structurally distinct templates
// (index % 4), each built from a shared tactical grammar of named landmark
// compositions (door-walls with glowing lintel frames, crate gates, L-wall
// defender corners, plant-site "default" boxes, sight breakers, accent
// beacon pylons):
//   0 "Lanes"     — classic three lanes carved by two building blocks with
//                   connector tunnels, mid arch, full-width choke wall.
//   1 "Asym"      — long-A perimeter corridor with a gate, short gated B
//                   lane, narrow mid link corridor, STAGGERED choke walls
//                   (A deep / B early) joined by a divider spine.
//   2 "Courtyard" — both sites inside walled courtyards with four gates
//                   each (doors centered on the site x/z lines), twin-block
//                   mid street, perimeter flank corridors.
//   3 "Terrace"   — elevated mid spine (0.7 m steps up to a 1.4 m deck,
//                   jump-traversable for players AND bots) between two
//                   ground half-lanes; thin masses with tunnels; 3-door
//                   choke. Raised deck is impassable to the validator BFS,
//                   so both ground half-lanes always stay open.
// FFA maps are five hand-shaped arenas: stepped ziggurat, split-pit with an
// overhead bridge, ring corridor, cross plaza with four bunker rooms, and a
// pillar forest around a two-step dais.
//
// Nav notes (bots have no pathfinding, they beeline + slide along walls and
// auto-jump obstacles below ~0.7 m; player jump apex ~0.85 m, bot ~0.78 m):
//  - every door in a wall that crosses a travel axis sits exactly on a site
//    center line (x line for walls along x, z line for walls along z), so a
//    bot sliding along the wall toward its site always converges on a door;
//  - big masses / lane walls run along z (the attacker travel axis), so a
//    blocked bot keeps making z-progress and passes around ends / tunnels;
//  - all freestanding lane cover is <= 0.7 m tall (auto-jumpable) and all
//    real walls are >= 1.2 m tall (registered by the chest-height whisker
//    rays) — nothing between 0.7 and 1.2 ever spawns;
//  - doors are 3.6-4.4 m wide (bot lateral probes assume 3.5-4.5) and the
//    validator BFS (0.45 m inflation, 0.5 m grid) keeps >= 2.5 m real
//    clearance through every door;
//  - lintels / bridges keep bottom >= 2.5 m (headroom, walk-under);
//  - two-step raised routes (0.7 then 1.4) are bot-climbable, but never
//    replace the ground route: the validator only treats individual boxes
//    with top <= 0.8 as passable.
//
// This module MUST stay dependency-free (no three.js, no DOM) so it can be
// imported from plain Node (see scripts/validate_maps.mjs).

function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PALETTES = [
  { name: 'Spree', floor: '#3a4a5a', wall: '#5a6b7a', accent: '#43b7c7', skyTop: '#0f2233', skyBottom: '#2b4a63', fog: '#1c3346' },
  { name: 'Sand',  floor: '#8a7a55', wall: '#b7a06a', accent: '#e0b84a', skyTop: '#3a3a55', skyBottom: '#c9a66b', fog: '#9a8a60' },
  { name: 'Neon',  floor: '#3a3560', wall: '#544c86', accent: '#ff3fa4', skyTop: '#241448', skyBottom: '#43267a', fog: '#2a1c48' },
  { name: 'Ice',   floor: '#6a8090', wall: '#9fc0d0', accent: '#7fe0ff', skyTop: '#123244', skyBottom: '#5a8aa0', fog: '#3a5a6a' },
  { name: 'Ruins', floor: '#6a6052', wall: '#8a7a68', accent: '#e0a95a', skyTop: '#3a2e22', skyBottom: '#8a7050', fog: '#4a4034' },
  { name: 'Toxic', floor: '#3a4a34', wall: '#557048', accent: '#9fe04a', skyTop: '#182814', skyBottom: '#3a5a34', fog: '#26361f' },
  { name: 'Crimson', floor: '#5a3840', wall: '#804a56', accent: '#ff5a6a', skyTop: '#3a1420', skyBottom: '#7a2838', fog: '#4a2028' },
];

const NAMES = [
  'Spreebogen', 'Alexplatz', 'Reichshafen', 'Kanzleramt', 'Museumsinsel', 'Kreuzberg', 'Tempelhof',
  'Warschauer', 'Charlottenburg', 'Mauerpark', 'Gendarmenmarkt', 'Nikolai', 'Friedrichshain',
  'Wedding', 'Moabit', 'Prenzlberg', 'Schoeneberg', 'Neukoelln', 'Treptow', 'Lichtenberg',
  'Spandau', 'Zehlendorf', 'Steglitz', 'Marzahn', 'Koepenick', 'Pankow', 'Reinickendorf',
  'Wilmersdorf', 'Mitte', 'Gesundbrunnen',
];

const FFA_NAMES = ['Arena Spree', 'Betonpit', 'Neon Dome', 'Bunker 61', 'Dachlabyrinth'];

// Remove boxes whose XZ footprint (plus margin) contains any spawn point, so
// players can never spawn inside a collider on unlucky seeds. Layouts are
// designed with clear spawn rooms; this stays as a safety net.
function clearSpawnBoxes(boxes, spawnPoints, margin = 0.6) {
  return boxes.filter((b) => !spawnPoints.some(([x, z]) =>
    Math.abs(x - b.pos[0]) <= b.size[0] / 2 + margin &&
    Math.abs(z - b.pos[2]) <= b.size[2] / 2 + margin));
}

// ------------------------------------------------------------ shared grammar
// Darken / lighten a '#rrggbb' hex. Used for the wall-family shades (each map
// uses at most 4 distinct box colors: wall, accent, dark, light — shared
// material cache stays small).
function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v) => Math.max(0, Math.min(255, Math.round(v * f))).toString(16).padStart(2, '0');
  return `#${ch((n >> 16) & 255)}${ch((n >> 8) & 255)}${ch(n & 255)}`;
}

// Box-list builder context. `ground` rests a box on the floor, `lifted`
// places a box with an explicit bottom height (lintels, bridges, deck tops).
function makeCtx(pal) {
  const boxes = [];
  return {
    pal,
    dark: shade(pal.wall, 0.78),
    light: shade(pal.wall, 1.16),
    boxes,
    ground: (x, z, sx, sy, sz, color) => boxes.push({ pos: [x, sy / 2, z], size: [sx, sy, sz], color }),
    lifted: (x, z, bottom, sx, sy, sz, color) => boxes.push({ pos: [x, bottom + sy / 2, z], size: [sx, sy, sz], color }),
  };
}

// Wall along x (crosses the z travel axis) with doorways. Every door gets a
// lintel (bottom 2.6, walk-under headroom) and a glowing accent frame.
// Doors that carry bot traffic MUST sit on a site center x line.
function doorWallX(c, z, x0, x1, doors, h, thick, color, frames = true) {
  const sorted = [...doors].sort((a, b) => a.x - b.x);
  let cur = x0;
  for (const dr of sorted) {
    const a = dr.x - dr.w / 2;
    if (a - cur > 0.4) c.ground((cur + a) / 2, z, a - cur, h, thick, color);
    c.lifted(dr.x, z, 2.6, dr.w + 0.6, Math.max(0.5, h - 2.6), thick + 0.1, color);
    if (frames) c.lifted(dr.x, z, 2.62, dr.w + 0.9, 0.4, thick + 0.24, c.pal.accent);
    cur = dr.x + dr.w / 2;
  }
  if (x1 - cur > 0.4) c.ground((cur + x1) / 2, z, x1 - cur, h, thick, color);
}

// Wall / building mass along z (parallel to the travel axis) with doorway
// tunnels (lintel bottom 2.7). Thick masses read as buildings.
function doorWallZ(c, x, z0, z1, doors, h, thick, color) {
  const sorted = [...doors].sort((a, b) => a.z - b.z);
  let cur = z0;
  for (const dr of sorted) {
    const a = dr.z - dr.w / 2;
    if (a - cur > 0.4) c.ground(x, (cur + a) / 2, thick, h, a - cur, color);
    c.lifted(x, dr.z, 2.7, thick, Math.max(0.5, h - 2.7), dr.w + 0.6, color);
    cur = dr.z + dr.w / 2;
  }
  if (z1 - cur > 0.4) c.ground(x, (cur + z1) / 2, thick, h, z1 - cur, color);
}

// Glowing accent strips on both mouths of a tunnel through a z-running mass.
function tunnelMouths(c, x, halfThick, z, doorW) {
  for (const s of [-1, 1]) {
    c.lifted(x + s * (halfThick - 0.35), z, 2.55, 0.5, 0.3, doorW - 0.4, c.pal.accent);
  }
}

// L-wall corner: two overlapping wall arms meeting at (cornerX, cornerZ),
// extending dirX along x and dirZ along z. Defender post-plant cover.
function lWall(c, cornerX, cornerZ, dirX, dirZ, lenX, lenZ, h, color, t = 0.8) {
  c.ground(cornerX + (dirX * lenX) / 2, cornerZ, lenX, h, t, color);
  c.ground(cornerX, cornerZ + (dirZ * lenZ) / 2, t, h, lenZ, color);
}

// Plant "default" box: low crate with a thin glowing cap (total 0.68 —
// jumpable and validator-passable). The classic post-plant hiding spot.
function plantDefault(c, x, z) {
  c.ground(x, z, 1.5, 0.6, 1.5, c.pal.wall);
  c.lifted(x, z, 0.6, 1.1, 0.08, 1.1, c.pal.accent);
}

// Double crate: two low crates side by side — standard lane cover (<= 0.7).
function doubleCrate(c, x, z, alongX, rand, accent = false) {
  const h1 = 0.56 + rand() * 0.12;
  const h2 = 0.5 + rand() * 0.14;
  if (alongX) {
    c.ground(x - 0.95, z, 1.8, h1, 1.5, c.pal.wall);
    c.ground(x + 0.95, z, 1.8, h2, 1.5, accent ? c.pal.accent : c.pal.wall);
  } else {
    c.ground(x, z - 0.95, 1.5, h1, 1.8, c.pal.wall);
    c.ground(x, z + 0.95, 1.5, h2, 1.8, accent ? c.pal.accent : c.pal.wall);
  }
}

// One-way sightline breaker: tall thin wall with a glowing top strip.
function sightBreaker(c, x, z, alongX, len, h = 3.0) {
  const sx = alongX ? len : 0.9;
  const sz = alongX ? 0.9 : len;
  c.ground(x, z, sx, h, sz, c.pal.wall);
  c.lifted(x, z, h - 0.02, alongX ? len - 0.6 : 0.45, 0.22, alongX ? 0.45 : len - 0.6, c.pal.accent);
}

// Glowing beacon pylon — emissive landmark / callout anchor. Freestanding
// only in open space; next to walls it must ABUT them (no slit gaps).
function beacon(c, x, z, h = 2.6, s = 1.1) {
  c.ground(x, z, s, h, s, c.pal.accent);
}

// Standard plant-site kit: L-shaped defender screen behind the site (with a
// glow strip), a tall anchor on the mid-facing corner, the default box, and
// a low accent crate on the attacker side. `s` = sign of the site's x.
function siteKit(c, sx, zSite, s, screen = true) {
  if (screen) {
    const cX = sx - s * 4.0;
    const cZ = zSite + 5.4;
    c.ground(cX + s * 3.5, cZ, 7.0, 2.5, 0.8, c.light);
    c.ground(cX, cZ - 1.6, 0.8, 2.5, 3.2, c.light);
    c.lifted(cX + s * 3.5, cZ, 2.48, 6.2, 0.22, 1.0, c.pal.accent);
  }
  c.ground(sx - s * 4.4, zSite - 2.6, 2.4, 2.3, 2.0, c.light); // tall anchor
  plantDefault(c, sx - s * 1.2, zSite + 2.9);
  c.ground(sx + s * 2.6, zSite - 4.4, 1.5, 0.55, 1.5, c.pal.accent);
}

// Attacker / defender spawn rows (5 each). Attackers enter at -Z facing +Z.
function plantSpawns(hd) {
  return {
    attackers: [-8, -4, 0, 4, 8].map((x) => [x, -hd + 6, Math.PI]),
    defenders: [-8, -4, 0, 4, 8].map((x) => [x, hd - 6, 0]),
  };
}

// Small props behind the spawn rows (clear of the 0.6 spawn margin).
function spawnRowProps(c, hd, rand, defZ = null) {
  for (const s of [-1, 1]) {
    c.ground(s * (4.5 + rand() * 4), -hd + 2.9, 1.8, 0.7, 1.5, c.pal.wall);
    c.ground(s * (12 + rand() * 3), defZ ?? hd - 2.9, 1.7, 0.6, 1.4, c.pal.wall);
  }
}

// ---------------------------------------------------- plant template 0: Lanes
// Classic: courtyard -> A / mid / B lanes carved by two building blocks with
// connector tunnels -> mid arch or sight breaker -> full-width choke wall
// with a door per site (+ optional mid door) -> sites -> defender yard.
function genPlantLanes(rand, pal) {
  const w = 56 + Math.floor(rand() * 3) * 6;
  const d = 78 + Math.floor(rand() * 3) * 8;
  const hw = w / 2;
  const hd = d / 2;
  const c = makeCtx(pal);

  const zB0 = -hd + 16;
  const zChoke = hd - 24;
  const zB1 = zChoke - 5;
  const zSite = hd - 15;

  let laneW = 10 + Math.floor(rand() * 3) * 1.5;
  let midW = 10 + Math.floor(rand() * 3) * 2;
  let blockW = hw - laneW - midW / 2;
  if (blockW > 14) {
    const extra = blockW - 14;
    laneW += extra / 2;
    midW += extra;
    blockW = 14;
  }
  const bx0 = midW / 2;
  const blockCx = bx0 + blockW / 2;
  const blockH = 3.4 + rand();

  // Mid feature line is chosen first so connector tunnels can keep their
  // distance from it (avoids tight pockets between tunnel mouths and arch).
  const zMidF = (zB0 + zB1) / 2 + (rand() - 0.5) * 5;

  // Two building blocks with 1-2 connector tunnels each.
  for (const s of [-1, 1]) {
    const nGaps = 1 + (rand() > 0.5 ? 1 : 0);
    const doors = [];
    for (let g = 0; g < nGaps; g++) {
      let gz = zB0 + ((g + 1) / (nGaps + 1)) * (zB1 - zB0) + (rand() - 0.5) * 4;
      if (Math.abs(gz - zMidF) < 5.5) gz = zMidF + (gz >= zMidF ? 5.5 : -5.5);
      gz = Math.min(zB1 - 3.5, Math.max(zB0 + 3.5, gz));
      doors.push({ z: gz, w: 3.8 + rand() * 0.6 });
    }
    doorWallZ(c, s * blockCx, zB0, zB1, doors, blockH, blockW, c.dark);
    for (const dr of doors) tunnelMouths(c, s * blockCx, blockW / 2, dr.z, dr.w);
    // roofline glow strip along the mid-facing edge of the block
    c.lifted(s * (bx0 + 0.35), (zB0 + zB1) / 2, blockH - 0.02, 0.5, 0.25, (zB1 - zB0) - 1, pal.accent);
  }

  // Mid feature: crate-gate arch spanning mid, or a sight breaker.
  const arch = rand() < 0.5;
  if (arch) {
    doorWallX(c, zMidF, -bx0 - 0.3, bx0 + 0.3, [{ x: 0, w: 4.4 }], 3.1, 1.0, pal.wall);
  } else {
    sightBreaker(c, 0, zMidF, false, 8 + rand() * 5);
  }

  // Choke wall: door in front of each site (+ optional mid door).
  const midDoor = rand() > 0.5;
  const chokeDoors = [{ x: -blockCx, w: 4.2 }, ...(midDoor ? [{ x: 0, w: 3.6 }] : []), { x: blockCx, w: 4.2 }];
  doorWallX(c, zChoke, -hw, hw, chokeDoors, 3.2, 1, pal.wall);

  // Sites + kits + beacon pylons abutting the choke wall next to each door.
  const siteR = 4.6 + rand() * 0.8;
  const sites = {
    A: { center: [-blockCx, zSite], radius: siteR },
    B: { center: [blockCx, zSite], radius: siteR },
  };
  for (const s of [-1, 1]) {
    siteKit(c, s * blockCx, zSite, s);
    beacon(c, s * Math.min(blockCx + 4.9, hw - 2.2), zChoke - 0.9);
  }

  // Lane cover (all <= 0.7, jumpable).
  const laneCx = hw - laneW / 2;
  for (const s of [-1, 1]) {
    doubleCrate(c, s * (laneCx + (rand() - 0.5) * 2.5), zB0 + 0.32 * (zB1 - zB0) + (rand() - 0.5) * 4, rand() > 0.5, rand);
    c.ground(s * (laneCx + (rand() - 0.5) * 3), zB0 + 0.72 * (zB1 - zB0) + (rand() - 0.5) * 3,
      1.7 + rand(), 0.55 + rand() * 0.14, 1.5 + rand(), rand() > 0.7 ? pal.accent : pal.wall);
  }
  // mid lane crates hug the block faces, staggered away from the mid feature
  for (const s of [-1, 1]) {
    const mz = zMidF + s * (5.5 + rand() * 3);
    if (mz > zB0 + 2 && mz < zB1 - 2) {
      c.ground(s * (bx0 - 1.6), mz, 1.6, 0.6 + rand() * 0.1, 1.6, rand() > 0.6 ? pal.accent : pal.wall);
    }
  }

  // Attacker courtyard staging cover.
  doubleCrate(c, (rand() - 0.5) * 2 * (hw - 9), -hd + 11.5 + rand() * 2, true, rand, rand() > 0.6);
  c.ground(-(rand() - 0.5) * 2 * (hw - 10), zB0 - 2.6, 1.8, 0.6, 1.5, pal.wall);

  spawnRowProps(c, hd, rand, hd - 2.9);
  return { size: [w, d], boxes: c.boxes, sites, spawns: plantSpawns(hd) };
}

// ----------------------------------------------------- plant template 1: Asym
// Long-A: narrow perimeter corridor with a gate; short-B: wide lane with an
// early crate-gate; mid link corridor between two building masses;
// STAGGERED chokes (A deep at hd-22, B early at hd-27) joined by a divider.
function genPlantAsym(rand, pal) {
  const w = 62 + (rand() > 0.5 ? 6 : 0);
  const d = 86 + (rand() > 0.5 ? 8 : 0);
  const hw = w / 2;
  const hd = d / 2;
  const c = makeCtx(pal);

  const zB0 = -hd + 16;
  const zChokeA = hd - 22;
  const zChokeB = hd - 27;
  const siteAx = -hw + 11.5;
  const siteBx = hw - 11;
  const zSiteA = hd - 13;
  const zSiteB = hd - 17;

  const xCorr = -hw + 9;   // A corridor east wall (left mass west face)
  const xMid0 = -2;        // mid corridor west face
  const xMid1 = 3.4;       // mid corridor east face
  const xRB1 = hw - 12;    // right mass east face (B lane west edge)
  const massH = 3.6 + rand() * 0.6;

  // Left mass (long) with one tunnel alley linking A corridor <-> mid.
  const zAlleyL = zB0 + 0.55 * ((zChokeA - 5) - zB0) + (rand() - 0.5) * 4;
  const lCx = (xCorr + xMid0) / 2;
  const lThick = xMid0 - xCorr;
  doorWallZ(c, lCx, zB0, zChokeA - 5, [{ z: zAlleyL, w: 4.4 }], massH, lThick, c.dark);
  tunnelMouths(c, lCx, lThick / 2, zAlleyL, 4.4);
  c.lifted(xMid0 + 0.35, (zB0 + zChokeA - 5) / 2, massH - 0.02, 0.5, 0.25, (zChokeA - 5 - zB0) - 1, pal.accent);

  // Right mass (short, starts late -> open B courtyard) with one tunnel.
  const zRB0 = zB0 + 7;
  const zAlleyR = zRB0 + 0.4 * ((zChokeB - 5) - zRB0) + (rand() - 0.5) * 3;
  const rCx = (xMid1 + xRB1) / 2;
  const rThick = xRB1 - xMid1;
  doorWallZ(c, rCx, zRB0, zChokeB - 5, [{ z: zAlleyR, w: 4.2 }], massH, rThick, c.dark);
  tunnelMouths(c, rCx, rThick / 2, zAlleyR, 4.2);
  c.lifted(xMid1 - 0.35, (zRB0 + zChokeB - 5) / 2, massH - 0.02, 0.5, 0.25, (zChokeB - 5 - zRB0) - 1, pal.accent);

  // "A-Long" gate across the perimeter corridor. The door abuts the mass
  // face so a bot sliding +z along the mass goes straight through it.
  const zGateA = -hd + 36 + rand() * 6;
  doorWallX(c, zGateA, -hw, xCorr + 0.2, [{ x: xCorr - 2.4, w: 4.4 }], 3.1, 1.0, pal.wall);

  // "B-Short" gate across the wide B lane (door abuts the mass face too).
  const zGateB = -hd + 28 + rand() * 4;
  doorWallX(c, zGateB, xRB1 - 0.2, hw, [{ x: xRB1 + 2.4, w: 4.4 }], 3.1, 1.0, pal.wall);

  // Staggered choke walls + divider spine between them.
  doorWallX(c, zChokeA, -hw, 6.5, [{ x: siteAx, w: 4.2 }, { x: 0.7, w: 3.8 }], 3.2, 1, pal.wall);
  doorWallX(c, zChokeB, 5.5, hw, [{ x: siteBx, w: 4.4 }], 3.2, 1, pal.wall);
  c.ground(6, (zChokeA + zChokeB) / 2, 1.0, 3.2, zChokeA - zChokeB + 1, pal.wall);

  const sites = {
    A: { center: [siteAx, zSiteA], radius: 4.4 },
    B: { center: [siteBx, zSiteB], radius: 5.2 },
  };
  // Site A (tight): kit mirrored to hug the left edge.
  siteKit(c, siteAx, zSiteA, -1);
  beacon(c, siteAx + 4.6, zChokeA - 0.9);
  // Site B (open): kit + tall tower flush against the screen arm (no slot).
  siteKit(c, siteBx, zSiteB, 1);
  c.ground(siteBx - 5.5, zSiteB + 3.4, 2.2, 3.0, 2.2, c.light); // B tower
  beacon(c, siteBx - 4.8, zChokeB - 0.9);

  // Cover: A corridor crate, B lane double crates, connector crates.
  c.ground(xCorr - 1.6, zGateA + 8 + rand() * 3, 1.6, 0.6, 1.7, pal.wall);
  doubleCrate(c, (xRB1 + hw) / 2 + (rand() - 0.5) * 3, zGateB + 9 + rand() * 4, true, rand, rand() > 0.5);
  c.ground((xRB1 + hw) / 2 - 2 + rand() * 4, zChokeB - 8 - rand() * 3, 1.8, 0.62, 1.5, pal.wall);
  c.ground(2 + rand() * 3, zChokeA - 8, 1.6, 0.58, 1.6, rand() > 0.5 ? pal.accent : pal.wall);

  // Attacker courtyard staging cover (courtyard reaches deeper on the B side).
  doubleCrate(c, -6 + rand() * 8, -hd + 11.5 + rand() * 2, true, rand);
  c.ground(xRB1 + 3 + rand() * 4, zB0 + 2.5, 1.7, 0.62, 1.6, rand() > 0.6 ? pal.accent : pal.wall);

  spawnRowProps(c, hd, rand, hd - 2.9);
  return { size: [w, d], boxes: c.boxes, sites, spawns: plantSpawns(hd) };
}

// ------------------------------------------------ plant template 2: Courtyard
// Both sites live inside walled courtyards with FOUR gates each (every door
// centered on the site x or z line). Twin mid blocks form a narrow mid
// street; perimeter corridors flank around to the courtyards' outer gates.
function genPlantCourtyards(rand, pal) {
  const w = 56 + Math.floor(rand() * 3) * 6;
  const d = 78 + Math.floor(rand() * 3) * 8;
  const hw = w / 2;
  const hd = d / 2;
  const c = makeCtx(pal);

  const zB0 = -hd + 16;
  const zCy0 = hd - 24;   // courtyard front wall
  const zCy1 = hd - 8;    // courtyard back wall
  const zSite = hd - 16;
  const cyIn = hw - 22;   // courtyard inner wall |x|
  const cyOut = hw - 7;   // courtyard outer wall |x|
  const siteX = hw - 14.5;
  const cyH = 2.7;

  // Twin mid blocks with a 4.4 m street between and one cross alley each.
  const zM0 = -hd + 24;
  const zM1 = hd - 32;
  const blockH = 3.6 + rand() * 0.5;
  const zAlley = [zM0 + 0.35 * (zM1 - zM0) + (rand() - 0.5) * 3, zM0 + 0.7 * (zM1 - zM0) + (rand() - 0.5) * 3];
  for (const s of [-1, 1]) {
    const cx = s * 5.1; // block spans s*2.2 .. s*8
    doorWallZ(c, cx, zM0, zM1, [{ z: zAlley[s < 0 ? 0 : 1], w: 3.8 }], blockH, 5.8, c.dark);
    tunnelMouths(c, cx, 2.9, zAlley[s < 0 ? 0 : 1], 3.8);
    c.lifted(s * 2.55, (zM0 + zM1) / 2, blockH - 0.02, 0.5, 0.25, (zM1 - zM0) - 1, pal.accent);
  }
  // Twin glowing obelisks framing the mid street mouth (abut block fronts).
  beacon(c, 4.5, zM0 - 0.45, 2.8);
  beacon(c, -4.5, zM0 - 0.45, 2.8);

  // Side warehouses (only on wide maps) to carve the perimeter flanks.
  if (w >= 62) {
    for (const s of [-1, 1]) {
      const bCx = s * (hw - 11.5); // spans hw-15 .. hw-8
      c.ground(bCx, (-hd + 30 + hd - 40) / 2, 7, 3.3, d - 70, c.dark);
      c.lifted(bCx, (-hd + 30 + hd - 40) / 2, 3.28, 0.5, 0.22, d - 72, pal.accent);
    }
  }

  // Courtyards: 4 walls, 4 gates (front/back on the site x line, sides on
  // the site z line).
  const sites = {
    A: { center: [-siteX, zSite], radius: 4.6 },
    B: { center: [siteX, zSite], radius: 4.6 },
  };
  for (const s of [-1, 1]) {
    const sx = s * siteX;
    const x0 = s < 0 ? -cyOut : cyIn;
    const x1 = s < 0 ? -cyIn : cyOut;
    doorWallX(c, zCy0, x0, x1, [{ x: sx, w: 4.2 }], cyH, 0.8, c.light);
    doorWallX(c, zCy1, x0, x1, [{ x: sx, w: 3.8 }], cyH, 0.8, c.light, false);
    doorWallZ(c, s * cyOut, zCy0, zCy1, [{ z: zSite, w: 4.2 }], cyH, 0.8, c.light);
    doorWallZ(c, s * cyIn, zCy0, zCy1, [{ z: zSite, w: 4.2 }], cyH, 0.8, c.light);
    // interior kit: tall anchor (kept >= 2.5 m off the inner wall so the
    // pocket beside it stays walkable), default box, low accent crate
    c.ground(sx - s * 3.2, zSite + 1.2, 2.2, 2.2, 2.0, c.dark);
    plantDefault(c, sx + s * 1.4, zSite + 2.6);
    c.ground(sx + s * 3.8, zSite - 3.4, 1.5, 0.55, 1.5, pal.accent);
  }

  // Plaza sight breaker between the mid street exit and the courtyard doors.
  sightBreaker(c, (rand() - 0.5) * 3, hd - 28, true, 4.5 + rand() * 1.5);

  // Flank corridor markers (low, jumpable) + plaza cover.
  for (const s of [-1, 1]) {
    c.ground(s * (hw - 3.6), -hd + 34 + rand() * 6, 1.6, 0.62, 1.6, pal.accent);
    doubleCrate(c, s * (hw - 13 - rand() * 4), zM1 + 4 + rand() * 2, true, rand);
  }

  // Attacker courtyard staging cover.
  doubleCrate(c, (rand() - 0.5) * 2 * (hw - 10), -hd + 11.5 + rand() * 2, true, rand, rand() > 0.6);
  c.ground((rand() - 0.5) * 16, zB0 + 3.5, 1.8, 0.6, 1.5, pal.wall);

  spawnRowProps(c, hd, rand, hd - 3.4);
  return { size: [w, d], boxes: c.boxes, sites, spawns: plantSpawns(hd) };
}

// -------------------------------------------------- plant template 3: Terrace
// Elevated mid: a 1.4 m deck (reached over 0.7 m steps at both ends and side
// hop-crates) runs down the middle of a wide mid zone, flanked by two ground
// half-lanes. Thin masses with tunnels separate the side lanes; the 3-door
// choke wall always includes a mid door.
function genPlantTerrace(rand, pal) {
  const w = 62 + (rand() > 0.5 ? 6 : 0);
  const d = 78 + (rand() > 0.5 ? 8 : 0);
  const hw = w / 2;
  const hd = d / 2;
  const c = makeCtx(pal);

  const zB0 = -hd + 16;
  const zChoke = hd - 24;
  const zB1 = zChoke - 5;
  const zSite = hd - 15;
  const massCx = hw - 14; // masses span hw-17 .. hw-11
  const massH = 3.6 + rand() * 0.6;

  // Side masses with one tunnel each (side lane <-> mid half-lane).
  for (const s of [-1, 1]) {
    const gz = zB0 + (0.35 + rand() * 0.3) * (zB1 - zB0);
    doorWallZ(c, s * massCx, zB0, zB1, [{ z: gz, w: 4.0 }], massH, 6, c.dark);
    tunnelMouths(c, s * massCx, 3, gz, 4.0);
    c.lifted(s * (massCx - 3 + 0.35), (zB0 + zB1) / 2, massH - 0.02, 0.5, 0.25, (zB1 - zB0) - 1, pal.accent);
  }

  // Elevated mid spine: step (0.7) -> deck (1.4) -> step (0.7). The deck is
  // impassable to the BFS; both ground half-lanes remain open.
  const zS0 = -hd + 26;
  const zDeckEnd = hd - 32;
  const deckLen = zDeckEnd - zS0 - 3;
  const zDeckC = (zS0 + 3 + zDeckEnd) / 2;
  c.ground(0, zS0 + 1.5, 5, 0.7, 3, c.light);                       // south step
  c.lifted(0, zDeckC, 0.7, 5, 0.7, deckLen, c.light);               // deck
  c.ground(0, zDeckEnd + 1.5, 5, 0.7, 3, c.light);                  // north step
  for (const s of [-1, 1]) {
    c.lifted(s * 2.28, zDeckC, 1.38, 0.44, 0.18, deckLen - 1.2, pal.accent); // glow edges
    c.ground(s * 3.35, zDeckC + s * (2 + rand() * 3), 1.7, 0.7, 2.4, pal.wall); // hop crates
  }

  // Choke wall: A door, mid door, B door (all on center lines).
  doorWallX(c, zChoke, -hw, hw,
    [{ x: -massCx, w: 4.2 }, { x: 0, w: 3.6 }, { x: massCx, w: 4.2 }], 3.2, 1, pal.wall);

  const siteR = 4.8;
  const sites = {
    A: { center: [-massCx, zSite], radius: siteR },
    B: { center: [massCx, zSite], radius: siteR },
  };
  for (const s of [-1, 1]) {
    siteKit(c, s * massCx, zSite, s);
    beacon(c, s * 4.4, zChoke - 0.93);
  }

  // Mid half-lane and side lane cover.
  for (const s of [-1, 1]) {
    doubleCrate(c, s * ((2.5 + massCx - 3) / 2 + (rand() - 0.5) * 2), zB0 + (0.3 + rand() * 0.35) * (zB1 - zB0), rand() > 0.5, rand, rand() > 0.6);
    c.ground(s * (hw - 5.5 - rand() * 3), zB0 + (0.4 + rand() * 0.35) * (zB1 - zB0), 1.7, 0.6, 1.6, pal.wall);
  }

  // Courtyard: gateway strip pointing at the spine + staging crates.
  c.ground(0, zS0 - 3, 3.2, 0.5, 1.2, pal.accent);
  doubleCrate(c, -10 - rand() * 6, -hd + 11.5 + rand() * 2, true, rand);
  c.ground(10 + rand() * 6, -hd + 12 + rand() * 2, 1.8, 0.62, 1.6, pal.wall);

  spawnRowProps(c, hd, rand, hd - 2.9);
  return { size: [w, d], boxes: c.boxes, sites, spawns: plantSpawns(hd) };
}

// ---------------------------------------------------------------- plant maps
const PLANT_TEMPLATES = [genPlantLanes, genPlantAsym, genPlantCourtyards, genPlantTerrace];

function genPlantMap(index) {
  const rand = mulberry32(1000 + index * 97);
  const pal = PALETTES[index % PALETTES.length];
  const t = PLANT_TEMPLATES[index % PLANT_TEMPLATES.length](rand, pal);

  const spawnPoints = [...t.spawns.attackers, ...t.spawns.defenders].map(([x, z]) => [x, z]);
  return {
    id: `plant_${index}`,
    name: NAMES[index % NAMES.length],
    mode: 'plant',
    palette: pal,
    size: t.size,
    boxes: clearSpawnBoxes(t.boxes, spawnPoints),
    sites: t.sites,
    spawns: t.spawns,
  };
}

// ----------------------------------------------------------------- ffa maps
// Twelve spawn points on an ellipse facing the center.
function ringSpawns(hw, hd, r, phase = 0) {
  const pts = [];
  for (let i = 0; i < 12; i++) {
    const a = phase + (i / 12) * Math.PI * 2;
    pts.push([Math.cos(a) * Math.min(r, hw - 5), Math.sin(a) * Math.min(r, hd - 5), Math.PI / 2 - a]);
  }
  return pts;
}

// ffa_0 "Arena Spree" — stepped ziggurat: a two-tier centerpiece (0.65 then
// 1.3, fully jump-climbable) with a glowing crown, ringed by pinwheel walls,
// diagonal pillars and an outer crate ring.
function genFFAZiggurat(rand, pal) {
  const w = 52;
  const d = 52;
  const hw = w / 2;
  const c = makeCtx(pal);

  c.ground(0, 0, 11, 0.65, 11, c.light);                    // tier 1 (passable)
  c.lifted(0, 0, 0.65, 6.5, 0.65, 6.5, c.light);            // tier 2 (blocked core)
  c.lifted(0, 0, 1.3, 2.0, 0.3, 2.0, pal.accent);           // glowing crown
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      c.ground(sx * 7.2, sz * 7.2, 1.8, 0.6, 1.8, (sx === sz) ? pal.accent : pal.wall); // step crates
    }
  }

  // Pinwheel sight walls.
  const r1 = 12;
  const off = 2.2;
  sightBreaker(c, off, r1, true, 6, 3);
  sightBreaker(c, -off, -r1, true, 6, 3);
  sightBreaker(c, r1, -off, false, 6, 3);
  sightBreaker(c, -r1, off, false, 6, 3);

  // Diagonal pillars + outer crate ring.
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) c.ground(sx * 15, sz * 15, 1.5, 2.8, 1.5, c.dark);
  const nRing = 7 + Math.floor(rand() * 2);
  const phase = rand() * Math.PI;
  for (let i = 0; i < nRing; i++) {
    const a = phase + (i / nRing) * Math.PI * 2;
    c.ground(Math.cos(a) * (hw - 9), Math.sin(a) * (hw - 9),
      1.6 + rand() * 0.8, 0.55 + rand() * 0.15, 1.6 + rand() * 0.8,
      rand() > 0.7 ? pal.accent : pal.wall);
  }

  return { size: [w, d], boxes: c.boxes, spawns: ringSpawns(hw, hw, hw - 5) };
}

// ffa_1 "Betonpit" — split pit: two raised 0.7 m terraces (jumpable slabs)
// flank a ground-level trench that splits around a crowned island monolith;
// an overhead bridge (bottom 2.5) crosses the trench between two pillars.
function genFFAPit(rand, pal) {
  const w = 54;
  const d = 62;
  const hw = w / 2;
  const hd = d / 2;
  const c = makeCtx(pal);

  // Terraces (top 0.7 — validator-passable, auto-jumpable).
  for (const s of [-1, 1]) {
    const cx = s * ((5.5 + hw - 3) / 2);
    c.ground(cx, 0, hw - 8.5, 0.7, 2 * (hd - 9), c.light);
    // step "ramps" hugging the trench edge
    c.ground(s * 6.1, -4, 1.2, 0.35, 2.4, c.light);
    c.ground(s * 6.1, 9, 1.2, 0.35, 2.4, c.light);
    // terrace-top cover
    c.ground(s * (hw - 8), -8, 1.4, 2.8, 1.4, c.dark);       // tall pillar
    c.ground(s * (hw - 7), 6 + rand() * 3, 1.7, 0.6, 1.7, pal.wall);
    c.ground(s * 9, -14 - rand() * 2, 1.6, 0.62, 1.6, pal.accent);
  }

  // Island monolith with a glowing crown (trench splits around it).
  c.ground(0, 0, 2.2, 3.2, 2.2, c.dark);
  c.lifted(0, 0, 3.18, 2.7, 0.3, 2.7, pal.accent);

  // Overhead bridge resting on two pillars. Bottom 3.1 keeps 2.4 m headroom
  // even over the 0.7 m terraces below it.
  c.ground(7.4, 12, 1.4, 3.1, 1.4, c.dark);
  c.ground(-7.4, 12, 1.4, 3.1, 1.4, c.dark);
  c.lifted(0, 12, 3.1, 16.4, 0.5, 3.4, c.light);
  c.lifted(0, 12, 3.6, 15, 0.2, 0.5, pal.accent);

  // Trench cover.
  c.ground(3, -8, 1.5, 0.55, 1.5, pal.wall);
  c.ground(-3, -16, 1.5, 0.6, 1.5, pal.wall);

  const mk = (x, z) => [x, z, Math.PI / 2 - Math.atan2(z, x)];
  const spawns = [
    mk(-15, hd - 4), mk(-5, hd - 4), mk(5, hd - 4), mk(15, hd - 4),
    mk(-15, -hd + 4), mk(-5, -hd + 4), mk(5, -hd + 4), mk(15, -hd + 4),
    mk(0, hd - 5.5), mk(0, -hd + 5.5), mk(0, 17), mk(0, -19),
  ];
  return { size: [w, d], boxes: c.boxes, spawns };
}

// ffa_2 "Neon Dome" — ring corridor: a square ring wall with four glowing
// gates on the axes separates an inner arena (glowing podium + pillars)
// from an outer corridor with sight breakers and corner crates.
function genFFARing(rand, pal) {
  const w = 54;
  const d = 54;
  const hw = w / 2;
  const c = makeCtx(pal);

  // Ring walls with a centered gate per side.
  doorWallX(c, -12, -12.5, 12.5, [{ x: 0, w: 4.4 }], 3.2, 1, c.dark);
  doorWallX(c, 12, -12.5, 12.5, [{ x: 0, w: 4.4 }], 3.2, 1, c.dark);
  doorWallZ(c, -12, -12.5, 12.5, [{ z: 0, w: 4.4 }], 3.2, 1, c.dark);
  doorWallZ(c, 12, -12.5, 12.5, [{ z: 0, w: 4.4 }], 3.2, 1, c.dark);

  // Inner arena: glowing podium pad + diagonal pillars + low crates.
  c.ground(0, 0, 4.6, 0.55, 4.6, pal.accent);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) c.ground(sx * 6.5, sz * 6.5, 1.4, 3.0, 1.4, c.dark);
  c.ground(5.6, 0, 1.6, 0.62, 1.6, pal.wall);
  c.ground(-5.6, 0, 1.6, 0.58, 1.6, pal.wall);
  c.ground(0, 5.6, 1.6, 0.6, 1.6, pal.wall);
  c.ground(0, -5.6, 1.6, 0.56, 1.6, pal.wall);

  // Outer corridor: mid-corridor sight breakers + corner crates.
  sightBreaker(c, 19.5, 0, false, 3.5, 3);
  sightBreaker(c, -19.5, 0, false, 3.5, 3);
  sightBreaker(c, 0, 19.5, true, 3.5, 3);
  sightBreaker(c, 0, -19.5, true, 3.5, 3);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      c.ground(sx * (hw - 6.5), sz * (hw - 6.5), 1.8, 0.6 + rand() * 0.1, 1.8, (sx !== sz) ? pal.accent : pal.wall);
    }
  }

  return { size: [w, d], boxes: c.boxes, spawns: ringSpawns(hw, hw, hw - 5) };
}

// ffa_3 "Bunker 61" — cross plaza: four bunker rooms (single glowing door
// each, facing the plaza) leave a wide + of corridors and an outer ring; a
// glowing beacon marks the plaza center.
function genFFABunker(rand, pal) {
  const w = 56;
  const d = 56;
  const hw = w / 2;
  const c = makeCtx(pal);

  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const x0 = sx > 0 ? 5.5 : -14.5;
      const x1 = sx > 0 ? 14.5 : -5.5;
      const z0 = sz > 0 ? 5.5 : -14.5;
      const z1 = sz > 0 ? 14.5 : -5.5;
      // inner wall (faces the plaza) carries the glowing door
      doorWallZ(c, sx * 5.5, z0, z1, [{ z: sz * 10, w: 3.6 }], 3.0, 0.8, c.dark);
      c.lifted(sx * 5.5, sz * 10, 2.55, 1.1, 0.35, 4.0, pal.accent);
      c.ground(sx * 14.5, sz * 10, 0.8, 3.0, z1 - z0, c.dark);              // outer wall
      c.ground(sx * 10, sz * 5.5, x1 - x0 + 0.8, 3.0, 0.8, c.dark);         // plaza-side wall
      c.ground(sx * 10, sz * 14.5, x1 - x0 + 0.8, 3.0, 0.8, c.dark);        // back wall
      c.ground(sx * 11.5, sz * 11.5, 1.5, 0.6, 1.5, pal.wall);              // room crate
    }
  }

  // Plaza: center beacon + diagonal low crates + corridor double crates.
  beacon(c, 0, 0, 3.6, 1.3);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) c.ground(sx * 3.6, sz * 3.6, 1.5, 0.55, 1.5, pal.wall);
  doubleCrate(c, 10.5, 0, false, rand, true);
  doubleCrate(c, -10.5, 0, false, rand, true);
  doubleCrate(c, 0, 10.5, true, rand);
  doubleCrate(c, 0, -10.5, true, rand);
  // outer ring diagonal crates
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) c.ground(sx * (hw - 5.5), sz * (hw - 5.5), 1.7, 0.62, 1.7, pal.wall);

  return { size: [w, d], boxes: c.boxes, spawns: ringSpawns(hw, hw, hw - 5, Math.PI / 12) };
}

// ffa_4 "Dachlabyrinth" — pillar forest: a jittered grid of tall pillars
// (some glowing) around a central two-step dais with a glowing cap, plus
// corner L-walls and scattered low crates.
function genFFAPillars(rand, pal) {
  const w = 50;
  const d = 50;
  const hw = w / 2;
  const c = makeCtx(pal);

  // Central dais: 0.7 step + 1.4 accent cap (climbable perch).
  c.ground(0, 0, 4.2, 0.7, 4.2, c.light);
  c.lifted(0, 0, 0.7, 2.2, 0.7, 2.2, pal.accent);

  // Pillar grid (skip the four inner diagonal spots -> center clearing).
  const coords = [-10.5, -3.5, 3.5, 10.5];
  let i = 0;
  for (const gx of coords) {
    for (const gz of coords) {
      if (Math.abs(gx) < 5 && Math.abs(gz) < 5) continue;
      const px = gx + (rand() - 0.5) * 1.2;
      const pz = gz + (rand() - 0.5) * 1.2;
      c.ground(px, pz, 1.7, 3.2, 1.7, i % 3 === 0 ? pal.accent : c.dark);
      if (rand() > 0.55) {
        c.ground(px + (gx > 0 ? -2.6 : 2.6), pz + (gz > 0 ? -2.6 : 2.6), 1.5, 0.55 + rand() * 0.12, 1.5, pal.wall);
      }
      i++;
    }
  }

  // Corner L-walls (tall) for edge fights.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      lWall(c, sx * 16, sz * 16, -sx, -sz, 4.2, 4.2, 2.6, c.dark);
    }
  }

  return { size: [w, d], boxes: c.boxes, spawns: ringSpawns(hw, hw, hw - 5) };
}

const FFA_TEMPLATES = [genFFAZiggurat, genFFAPit, genFFARing, genFFABunker, genFFAPillars];

function genFFAMap(index) {
  const rand = mulberry32(50000 + index * 131);
  const pal = PALETTES[(index + 2) % PALETTES.length];
  const t = FFA_TEMPLATES[index % FFA_TEMPLATES.length](rand, pal);

  return {
    id: `ffa_${index}`,
    name: FFA_NAMES[index % FFA_NAMES.length],
    mode: 'ffa',
    palette: pal,
    size: t.size,
    boxes: clearSpawnBoxes(t.boxes, t.spawns.map(([x, z]) => [x, z])),
    sites: {},
    spawns: { ffa: t.spawns },
  };
}

export const PLANT_MAPS = Array.from({ length: 30 }, (_, i) => genPlantMap(i));
export const FFA_MAPS = Array.from({ length: 5 }, (_, i) => genFFAMap(i));
export const ALL_MAPS = [...PLANT_MAPS, ...FFA_MAPS];

export function getMapById(id) {
  return ALL_MAPS.find((m) => m.id === id) || PLANT_MAPS[0];
}
