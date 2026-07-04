// Data-driven map registry. Standard plant maps + special FFA maps are
// generated procedurally from seeds so the game ships with many distinct
// layouts without any external assets.

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
// players can never spawn inside a collider on unlucky seeds.
function clearSpawnBoxes(boxes, spawnPoints, margin = 0.6) {
  return boxes.filter((b) => !spawnPoints.some(([x, z]) =>
    Math.abs(x - b.pos[0]) <= b.size[0] / 2 + margin &&
    Math.abs(z - b.pos[2]) <= b.size[2] / 2 + margin));
}

// Build a symmetric plant map from a seed.
function genPlantMap(index) {
  const rand = mulberry32(1000 + index * 97);
  const pal = PALETTES[index % PALETTES.length];
  const w = 60 + Math.floor(rand() * 20);
  const d = 70 + Math.floor(rand() * 24);
  const boxes = [];

  const add = (x, z, sx, sy, sz, color) => boxes.push({ pos: [x, sy / 2, z], size: [sx, sy, sz], color });

  // Mid divider structures
  const midCount = 3 + Math.floor(rand() * 3);
  for (let i = 0; i < midCount; i++) {
    const z = -d / 2 + 12 + (i / (midCount - 1)) * (d - 24);
    const sx = 4 + rand() * 6;
    add(0, z, sx, 2 + rand() * 2.5, 3 + rand() * 3, pal.wall);
  }

  // Symmetric cover on both lanes
  const laneX = w / 2 - 12;
  for (let side = -1; side <= 1; side += 2) {
    const covers = 5 + Math.floor(rand() * 4);
    for (let i = 0; i < covers; i++) {
      const x = side * (6 + rand() * (laneX));
      const z = -d / 2 + 8 + rand() * (d - 16);
      add(x, z, 2 + rand() * 3, 1.4 + rand() * 2.2, 2 + rand() * 3, rand() > 0.7 ? pal.accent : pal.wall);
    }
  }

  // Site structures near top (defender side) and choke walls
  const siteA = [-w / 4, d / 2 - 16];
  const siteB = [w / 4, d / 2 - 16];
  const threeSites = rand() > 0.55;
  const siteC = [0, d / 2 - 26];

  for (const s of [siteA, siteB, ...(threeSites ? [siteC] : [])]) {
    // boxes around a plant site to create cover
    add(s[0] - 4, s[1], 2, 2.2, 4, pal.wall);
    add(s[0] + 4, s[1], 2, 2.2, 4, pal.wall);
    add(s[0], s[1] + 4, 5, 1.6, 2, pal.accent);
  }

  const sites = threeSites
    ? { A: { center: siteA, radius: 5 }, B: { center: siteB, radius: 5 }, C: { center: siteC, radius: 4.5 } }
    : { A: { center: siteA, radius: 5.5 }, B: { center: siteB, radius: 5.5 } };

  const spawns = {
    // Attackers start bottom facing +Z (into map), defenders top facing -Z
    attackers: [
      [-8, -d / 2 + 6, Math.PI], [-4, -d / 2 + 6, Math.PI], [0, -d / 2 + 6, Math.PI], [4, -d / 2 + 6, Math.PI], [8, -d / 2 + 6, Math.PI],
    ],
    defenders: [
      [-8, d / 2 - 6, 0], [-4, d / 2 - 6, 0], [0, d / 2 - 6, 0], [4, d / 2 - 6, 0], [8, d / 2 - 6, 0],
    ],
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

function genFFAMap(index) {
  const rand = mulberry32(50000 + index * 131);
  const pal = PALETTES[(index + 2) % PALETTES.length];
  const w = 44 + Math.floor(rand() * 16);
  const d = 44 + Math.floor(rand() * 16);
  const boxes = [];
  const add = (x, z, sx, sy, sz, color) => boxes.push({ pos: [x, sy / 2, z], size: [sx, sy, sz], color });

  const count = 16 + Math.floor(rand() * 12);
  for (let i = 0; i < count; i++) {
    const x = (rand() - 0.5) * (w - 8);
    const z = (rand() - 0.5) * (d - 8);
    add(x, z, 1.5 + rand() * 3.5, 1.2 + rand() * 3, 1.5 + rand() * 3.5, rand() > 0.75 ? pal.accent : pal.wall);
  }
  // central raised platform
  add(0, 0, 8, 1, 8, pal.accent);

  const ffa = [];
  const spawnCount = 12;
  for (let i = 0; i < spawnCount; i++) {
    const a = (i / spawnCount) * Math.PI * 2;
    const r = Math.min(w, d) / 2 - 5;
    ffa.push([Math.cos(a) * r, Math.sin(a) * r, Math.PI / 2 - a]);
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
