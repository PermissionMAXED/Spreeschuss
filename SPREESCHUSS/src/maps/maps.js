// Data-driven map registry. Standard plant maps + special FFA maps are
// generated procedurally from seeds so the game ships with many distinct
// layouts without any external assets.
//
// Plant maps follow a structured tactical template instead of random
// scatter: attacker spawn courtyard -> three lanes (A / mid / B) carved by
// two solid building blocks with doorway connectors between the lanes -> a
// full-width choke wall with a door in front of each site -> plant sites
// with tall anchors + low plant cover -> defender yard behind the sites.
// FFA maps are open arenas: a central feature, a mid ring of short walls /
// pillars, low cover, and spawns around the edge.
//
// Nav notes (bots have no pathfinding, they beeline + slide along walls and
// auto-jump obstacles below ~0.7 m):
//  - every choke door sits exactly on a site's x line, so a bot sliding
//    along the choke wall toward its site always reaches a doorway;
//  - lane-separating blocks run along z, so blocked bots keep making
//    z-progress and pass around block ends / through connector gaps;
//  - all freestanding lane cover is <= 0.7 m tall (jumpable), so straight
//    spawn->site lines are always traversable.
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

// ---------------------------------------------------------------- plant maps
// Structured, seeded plant layout. Attackers enter at -Z, defenders hold +Z.
function genPlantMap(index) {
  const rand = mulberry32(1000 + index * 97);
  const pal = PALETTES[index % PALETTES.length];

  const w = 56 + Math.floor(rand() * 3) * 6; // 56 / 62 / 68
  const d = 78 + Math.floor(rand() * 3) * 8; // 78 / 86 / 94
  const hw = w / 2;
  const hd = d / 2;

  const boxes = [];
  // box resting on the floor
  const ground = (x, z, sx, sy, sz, color) => boxes.push({ pos: [x, sy / 2, z], size: [sx, sy, sz], color });
  // box with an explicit bottom height (lintels / trim; bottom >= 2.4 keeps headroom)
  const lifted = (x, z, bottom, sx, sy, sz, color) => boxes.push({ pos: [x, bottom + sy / 2, z], size: [sx, sy, sz], color });

  // ---- zone lines along z ----
  const zAtk = -hd + 6;    // attacker spawn row
  const zB0 = -hd + 16;    // building blocks start (attacker courtyard ends)
  const zChoke = hd - 24;  // choke wall in front of the sites
  const zB1 = zChoke - 5;  // blocks end (connector corridor before the choke)
  const zSite = hd - 15;   // site centers
  const zDef = hd - 6;     // defender spawn row

  // ---- lane split: | A lane | block | mid | block | B lane | ----
  let laneW = 10 + Math.floor(rand() * 3) * 1.5;
  let midW = 10 + Math.floor(rand() * 3) * 2;
  let blockW = hw - laneW - midW / 2;
  if (blockW > 14) { // very wide maps get wider lanes instead of huge blocks
    const extra = blockW - 14;
    laneW += extra / 2;
    midW += extra;
    blockW = 14;
  }
  const bx0 = midW / 2;             // block inner face (mid lane edge)
  const blockCx = bx0 + blockW / 2; // block / site / choke-door center line
  const wallH = 3.2;
  const blockH = 3.4 + rand();

  // ---- two building blocks with doorway connectors between the lanes ----
  for (const s of [-1, 1]) {
    const nGaps = 1 + (rand() > 0.5 ? 1 : 0);
    const gaps = [];
    for (let g = 0; g < nGaps; g++) {
      const gz = zB0 + ((g + 1) / (nGaps + 1)) * (zB1 - zB0) + (rand() - 0.5) * 4;
      const gw = 3.5 + rand();
      gaps.push([gz - gw / 2, gz + gw / 2]);
    }
    let cursor = zB0;
    for (const [g0, g1] of gaps) {
      if (g0 - cursor > 1.2) ground(s * blockCx, (cursor + g0) / 2, blockW, blockH, g0 - cursor, pal.wall);
      // lintel over the connector doorway (bottom at 2.7 = headroom) + glow strip
      lifted(s * blockCx, (g0 + g1) / 2, 2.7, blockW, blockH - 2.7, g1 - g0 + 0.2, pal.wall);
      lifted(s * bx0, (g0 + g1) / 2, 2.72, 0.5, 0.22, g1 - g0 - 0.5, pal.accent);
      cursor = g1;
    }
    ground(s * blockCx, (cursor + zB1) / 2, blockW, blockH, zB1 - cursor, pal.wall);
    // roofline trim strip along the mid-facing edge of the block
    lifted(s * (bx0 + 0.35), (zB0 + zB1) / 2, blockH - 0.02, 0.5, 0.25, (zB1 - zB0) - 1, pal.accent);
  }

  // ---- optional mid divider (splits mid into two half lanes on some maps) ----
  if (rand() < 0.45) {
    const len = 8 + rand() * 6;
    const zMid = (zB0 + zB1) / 2 + (rand() - 0.5) * 6;
    ground(0, zMid, 1.2, 3.0, len, pal.wall);
    lifted(0, zMid, 2.98, 0.5, 0.2, len - 0.6, pal.accent);
  }

  // ---- choke wall: a door in front of each site (+ optional mid door) ----
  const doorW = 4.2;
  const midDoor = rand() > 0.5;
  const doorXs = [-blockCx, ...(midDoor ? [0] : []), blockCx];
  let cx = -hw;
  for (const dx of doorXs) {
    const half = dx === 0 ? 1.7 : doorW / 2;
    if (dx - half - cx > 0.8) ground((cx + dx - half) / 2, zChoke, dx - half - cx, wallH, 1, pal.wall);
    lifted(dx, zChoke, 2.7, half * 2 + 0.6, wallH - 2.6, 1.15, pal.accent); // door frame
    cx = dx + half;
  }
  ground((cx + hw) / 2, zChoke, hw - cx, wallH, 1, pal.wall);

  // ---- plant sites (one per block center line) ----
  const siteR = 4.6 + rand() * 0.8;
  const sites = {
    A: { center: [-blockCx, zSite], radius: siteR },
    B: { center: [blockCx, zSite], radius: siteR },
  };
  for (const s of [-1, 1]) {
    const sx = s * blockCx;
    // tall anchor cover flanking the site (kept clear of the ring center)
    ground(sx + s * 4.4, zSite + 1.6, 2.6, 2.5, 2.2, pal.wall);
    ground(sx - s * 4.2, zSite - 2.6, 2.2, 2.3, 2.0, pal.wall);
    // low plant cover inside the ring (jumpable)
    ground(sx - s * 0.6, zSite + 3.9, 2.4, 0.62, 1.4, pal.wall);
    ground(sx + s * 2.4, zSite - 4.2, 1.5, 0.55, 1.5, pal.accent);
    // defender screen behind the site, with a glow strip on top
    const scx = sx + s * (rand() - 0.5) * 2;
    ground(scx, zSite + 6, 8, 2.4, 1, pal.wall);
    lifted(scx, zSite + 6, 2.38, 8.4, 0.25, 1.15, pal.accent);
  }

  // ---- low cover in the three lanes (jumpable, keeps beelines traversable) ----
  const lanes = [
    { cx: -(hw - laneW / 2), half: laneW / 2 - 2.6 },
    { cx: 0, half: midW / 2 - 2.6 },
    { cx: hw - laneW / 2, half: laneW / 2 - 2.6 },
  ];
  for (const lane of lanes) {
    const n = 2 + Math.floor(rand() * 2);
    for (let i = 0; i < n; i++) {
      const z = zB0 + 2.5 + ((i + 0.5) / n) * (zB1 - zB0 - 5) + (rand() - 0.5) * 3;
      const x = lane.cx + (rand() - 0.5) * 2 * Math.max(0.5, lane.half);
      ground(x, z, 1.6 + rand() * 1.2, 0.52 + rand() * 0.18, 1.4 + rand() * 1.2,
        rand() > 0.72 ? pal.accent : pal.wall);
    }
  }

  // ---- attacker courtyard staging cover ----
  const nCourt = 2 + Math.floor(rand() * 2);
  for (let i = 0; i < nCourt; i++) {
    const x = (rand() - 0.5) * 2 * (hw - 8);
    const z = -hd + 11.5 + rand() * (zB0 - 2.5 - (-hd + 11.5));
    ground(x, z, 1.8 + rand() * 1.2, 0.55 + rand() * 0.15, 1.6 + rand(),
      rand() > 0.75 ? pal.accent : pal.wall);
  }

  // ---- connector corridor crate between block ends and the choke ----
  if (rand() > 0.4) {
    ground((rand() - 0.5) * 2 * (hw - 6), (zB1 + zChoke) / 2, 1.8, 0.5, 1.3, pal.wall);
  }

  // ---- spawn-room props (clear of the 0.6 spawn margin by construction) ----
  for (const s of [-1, 1]) {
    ground(s * (4 + rand() * 5), -hd + 2.9, 1.8, 0.7, 1.5, pal.wall);   // behind attackers
    ground(s * (2.5 + rand() * 2), hd - 10.6, 1.7, 0.6, 1.4, pal.wall); // defender yard
  }

  const spawns = {
    // Attackers start bottom facing +Z (into map), defenders top facing -Z
    attackers: [-8, -4, 0, 4, 8].map((x) => [x, zAtk, Math.PI]),
    defenders: [-8, -4, 0, 4, 8].map((x) => [x, zDef, 0]),
  };

  const spawnPoints = [...spawns.attackers, ...spawns.defenders].map(([x, z]) => [x, z]);
  const clearedBoxes = clearSpawnBoxes(boxes, spawnPoints);

  return {
    id: `plant_${index}`,
    name: NAMES[index % NAMES.length],
    mode: 'plant',
    palette: pal,
    size: [w, d],
    boxes: clearedBoxes,
    sites,
    spawns,
  };
}

// ----------------------------------------------------------------- ffa maps
// Open arena: central feature, mid ring of short walls / pillars, low cover
// mix, spawns around the edge facing inward.
function genFFAMap(index) {
  const rand = mulberry32(50000 + index * 131);
  const pal = PALETTES[(index + 2) % PALETTES.length];
  const w = 46 + Math.floor(rand() * 3) * 6;
  const d = w + (rand() > 0.5 ? 6 : 0);
  const hw = w / 2;
  const hd = d / 2;

  const boxes = [];
  const ground = (x, z, sx, sy, sz, color) => boxes.push({ pos: [x, sy / 2, z], size: [sx, sy, sz], color });
  const lifted = (x, z, bottom, sx, sy, sz, color) => boxes.push({ pos: [x, bottom + sy / 2, z], size: [sx, sy, sz], color });

  // ---- central feature (jump-step platform / monolith / cross plaza) ----
  const feature = index % 3;
  if (feature === 0) {
    // stepped plinth: 0.6 m steps up to a 1.2 m platform, glowing cap
    ground(0, 0, 6, 1.2, 6, pal.wall);
    ground(0, 3.8, 3.2, 0.6, 1.6, pal.wall);
    ground(0, -3.8, 3.2, 0.6, 1.6, pal.wall);
    ground(3.8, 0, 1.6, 0.6, 3.2, pal.wall);
    ground(-3.8, 0, 1.6, 0.6, 3.2, pal.wall);
    lifted(0, 0, 1.18, 2.2, 0.35, 2.2, pal.accent);
  } else if (feature === 1) {
    // tall monolith with a glowing crown, orbited by low accent crates
    ground(0, 0, 2.4, 4.2, 2.4, pal.wall);
    lifted(0, 0, 4.18, 2.8, 0.3, 2.8, pal.accent);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) ground(sx * 3.4, sz * 3.4, 1.6, 0.6, 1.6, pal.accent);
  } else {
    // accent pillar in a cross of low platforms
    ground(0, 0, 1.2, 3.2, 1.2, pal.accent);
    ground(3.2, 0, 3.0, 0.7, 2.0, pal.wall);
    ground(-3.2, 0, 3.0, 0.7, 2.0, pal.wall);
    ground(0, 3.2, 2.0, 0.7, 3.0, pal.wall);
    ground(0, -3.2, 2.0, 0.7, 3.0, pal.wall);
  }

  // ---- pinwheel of short sight-blocker walls around the center ----
  const r1 = 9.5 + rand() * 2.5;
  const wallLen = 5.5 + rand() * 2.5;
  const off = 2.2;
  const wallSpots = [
    { x: off, z: r1, alongX: true }, { x: -off, z: -r1, alongX: true },
    ...(rand() > 0.35 ? [{ x: r1, z: -off, alongX: false }, { x: -r1, z: off, alongX: false }] : []),
  ];
  for (const spot of wallSpots) {
    const sx = spot.alongX ? wallLen : 1;
    const sz = spot.alongX ? 1 : wallLen;
    ground(spot.x, spot.z, sx, 3, sz, pal.wall);
    lifted(spot.x, spot.z, 2.98, spot.alongX ? sx - 0.6 : 0.5, 0.2, spot.alongX ? 0.5 : sz - 0.6, pal.accent);
  }

  // ---- tall pillars on the diagonals (kept >= 2.5 from the walls) ----
  if (rand() > 0.3) {
    const r2 = off + wallLen / 2 + 3.4 + rand() * 1.5;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) ground(sx * r2, sz * r2, 1.5, 2.8, 1.5, pal.wall);
  }

  // ---- low cover: outer ring + corners + axis crates in front of walls ----
  const nRing = 6 + Math.floor(rand() * 3);
  const phase = rand() * Math.PI;
  for (let i = 0; i < nRing; i++) {
    const a = phase + (i / nRing) * Math.PI * 2;
    ground(Math.cos(a) * (hw - 9), Math.sin(a) * (hd - 9),
      1.6 + rand(), 0.55 + rand() * 0.15, 1.6 + rand(),
      rand() > 0.7 ? pal.accent : pal.wall);
  }
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      if (rand() > 0.35) ground(sx * (hw - 5.5), sz * (hd - 5.5), 1.7, 0.6, 1.7, rand() > 0.5 ? pal.accent : pal.wall);
    }
  }
  for (const [ax, az] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    if (rand() > 0.4) ground(ax * (r1 - 3.0), az * (r1 - 3.0), 1.8, 0.6, 1.5, pal.wall);
  }

  // ---- spawns around the edge, facing the center ----
  const ffa = [];
  const spawnCount = 12;
  for (let i = 0; i < spawnCount; i++) {
    const a = (i / spawnCount) * Math.PI * 2;
    ffa.push([Math.cos(a) * (hw - 5), Math.sin(a) * (hd - 5), Math.PI / 2 - a]);
  }

  const clearedBoxes = clearSpawnBoxes(boxes, ffa.map(([x, z]) => [x, z]));

  return {
    id: `ffa_${index}`,
    name: FFA_NAMES[index % FFA_NAMES.length],
    mode: 'ffa',
    palette: pal,
    size: [w, d],
    boxes: clearedBoxes,
    sites: {},
    spawns: { ffa },
  };
}

export const PLANT_MAPS = Array.from({ length: 30 }, (_, i) => genPlantMap(i));
export const FFA_MAPS = Array.from({ length: 5 }, (_, i) => genFFAMap(i));
export const ALL_MAPS = [...PLANT_MAPS, ...FFA_MAPS];

export function getMapById(id) {
  return ALL_MAPS.find((m) => m.id === id) || PLANT_MAPS[0];
}
