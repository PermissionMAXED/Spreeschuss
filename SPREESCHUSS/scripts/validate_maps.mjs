// Automated map validator. Run with: node scripts/validate_maps.mjs
// Exits 0 when every map passes, non-zero with per-map messages otherwise.
//
// Checks per map:
//  a) every spawn point is >= 0.6 (XZ) from every box footprint;
//  b) walkability grid BFS at 0.5 m over x in [-w/2+1, w/2-1], z in
//     [-d/2+1, d/2-1]. A cell is BLOCKED if any box footprint (inflated by
//     0.45 = player radius + slack) covers it AND the box is impassable
//     (top > 0.8, too tall to jump over, AND bottom < 2.0, too low to walk
//     under). Plant maps: every attacker AND defender spawn must reach every
//     site center. FFA maps: all ffa spawns must share one component;
//  c) every site center cell is unblocked.

import { ALL_MAPS, PLANT_MAPS, FFA_MAPS } from '../src/maps/maps.js';

const STEP = 0.5;
const INFLATE = 0.45;
const SPAWN_MARGIN = 0.6;
const JUMP_TOP = 0.8; // boxes with top <= this can be jumped over
const WALK_UNDER = 2.0; // boxes with bottom >= this can be walked under
const EPS = 1e-6;

function boxTop(b) { return b.pos[1] + b.size[1] / 2; }
function boxBottom(b) { return b.pos[1] - b.size[1] / 2; }
function isImpassable(b) { return boxTop(b) > JUMP_TOP && boxBottom(b) < WALK_UNDER; }

// XZ distance from a point to a box footprint rectangle (0 if inside).
function footprintDist(b, x, z) {
  const dx = Math.max(0, Math.abs(x - b.pos[0]) - b.size[0] / 2);
  const dz = Math.max(0, Math.abs(z - b.pos[2]) - b.size[2] / 2);
  return Math.hypot(dx, dz);
}

class Grid {
  constructor(map) {
    const [w, d] = map.size;
    this.x0 = -w / 2 + 1;
    this.z0 = -d / 2 + 1;
    this.nx = Math.floor((w - 2) / STEP + EPS) + 1;
    this.nz = Math.floor((d - 2) / STEP + EPS) + 1;
    this.blocked = new Uint8Array(this.nx * this.nz);
    this.comp = new Int32Array(this.nx * this.nz).fill(-1);
    for (const b of map.boxes) {
      if (!isImpassable(b)) continue;
      const i0 = Math.max(0, Math.ceil((b.pos[0] - b.size[0] / 2 - INFLATE - this.x0) / STEP - EPS));
      const i1 = Math.min(this.nx - 1, Math.floor((b.pos[0] + b.size[0] / 2 + INFLATE - this.x0) / STEP + EPS));
      const j0 = Math.max(0, Math.ceil((b.pos[2] - b.size[2] / 2 - INFLATE - this.z0) / STEP - EPS));
      const j1 = Math.min(this.nz - 1, Math.floor((b.pos[2] + b.size[2] / 2 + INFLATE - this.z0) / STEP + EPS));
      for (let i = i0; i <= i1; i++) {
        for (let j = j0; j <= j1; j++) this.blocked[j * this.nx + i] = 1;
      }
    }
    this.#label();
  }

  #label() {
    let next = 0;
    const queue = new Int32Array(this.nx * this.nz);
    for (let start = 0; start < this.blocked.length; start++) {
      if (this.blocked[start] || this.comp[start] !== -1) continue;
      const id = next++;
      let head = 0;
      let tail = 0;
      queue[tail++] = start;
      this.comp[start] = id;
      while (head < tail) {
        const cur = queue[head++];
        const ci = cur % this.nx;
        const cj = (cur - ci) / this.nx;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const ni = ci + di;
          const nj = cj + dj;
          if (ni < 0 || nj < 0 || ni >= this.nx || nj >= this.nz) continue;
          const n = nj * this.nx + ni;
          if (this.blocked[n] || this.comp[n] !== -1) continue;
          this.comp[n] = id;
          queue[tail++] = n;
        }
      }
    }
  }

  cell(x, z) {
    const i = Math.min(this.nx - 1, Math.max(0, Math.round((x - this.x0) / STEP)));
    const j = Math.min(this.nz - 1, Math.max(0, Math.round((z - this.z0) / STEP)));
    return j * this.nx + i;
  }

  componentAt(x, z) {
    const c = this.cell(x, z);
    return this.blocked[c] ? -1 : this.comp[c];
  }
}

function validateMap(map) {
  const errors = [];
  const spawnGroups = Object.entries(map.spawns || {});

  // a) spawn clearance from every box footprint
  for (const [group, points] of spawnGroups) {
    points.forEach(([x, z], idx) => {
      for (const b of map.boxes) {
        const dist = footprintDist(b, x, z);
        if (dist < SPAWN_MARGIN - EPS) {
          errors.push(`spawn ${group}[${idx}] at (${x.toFixed(1)}, ${z.toFixed(1)}) is ${dist.toFixed(2)} < ${SPAWN_MARGIN} from box at (${b.pos[0].toFixed(1)}, ${b.pos[2].toFixed(1)})`);
        }
      }
    });
  }

  const grid = new Grid(map);
  const siteEntries = Object.entries(map.sites || {});

  // c) site center cells unblocked
  for (const [key, site] of siteEntries) {
    if (grid.componentAt(site.center[0], site.center[1]) === -1) {
      errors.push(`site ${key} center (${site.center[0].toFixed(1)}, ${site.center[1].toFixed(1)}) is on a blocked cell`);
    }
  }

  // b) reachability
  if (map.mode === 'plant') {
    for (const group of ['attackers', 'defenders']) {
      (map.spawns[group] || []).forEach(([x, z], idx) => {
        const sc = grid.componentAt(x, z);
        if (sc === -1) {
          errors.push(`spawn ${group}[${idx}] at (${x.toFixed(1)}, ${z.toFixed(1)}) is on a blocked cell`);
          return;
        }
        for (const [key, site] of siteEntries) {
          const tc = grid.componentAt(site.center[0], site.center[1]);
          if (tc !== -1 && tc !== sc) {
            errors.push(`spawn ${group}[${idx}] cannot reach site ${key}`);
          }
        }
      });
    }
  } else {
    let ref = null;
    (map.spawns.ffa || []).forEach(([x, z], idx) => {
      const sc = grid.componentAt(x, z);
      if (sc === -1) {
        errors.push(`spawn ffa[${idx}] at (${x.toFixed(1)}, ${z.toFixed(1)}) is on a blocked cell`);
        return;
      }
      if (ref === null) ref = sc;
      else if (sc !== ref) errors.push(`spawn ffa[${idx}] is disconnected from spawn ffa[0]`);
    });
  }

  return errors;
}

// ---- registry sanity ----
const registryErrors = [];
if (PLANT_MAPS.length !== 30) registryErrors.push(`expected 30 plant maps, got ${PLANT_MAPS.length}`);
if (FFA_MAPS.length !== 5) registryErrors.push(`expected 5 FFA maps, got ${FFA_MAPS.length}`);
PLANT_MAPS.forEach((m, i) => { if (m.id !== `plant_${i}`) registryErrors.push(`plant map ${i} has id ${m.id}`); });
FFA_MAPS.forEach((m, i) => { if (m.id !== `ffa_${i}`) registryErrors.push(`ffa map ${i} has id ${m.id}`); });

let failures = registryErrors.length;
for (const msg of registryErrors) console.error(`REGISTRY: ${msg}`);

for (const map of ALL_MAPS) {
  const errors = validateMap(map);
  if (errors.length) {
    failures++;
    console.error(`FAIL ${map.id} (${map.name}, ${map.mode}, ${map.size[0]}x${map.size[1]}, ${map.boxes.length} boxes)`);
    for (const msg of errors) console.error(`  - ${msg}`);
  } else {
    console.log(`ok   ${map.id} (${map.name}, ${map.mode}, ${map.size[0]}x${map.size[1]}, ${map.boxes.length} boxes)`);
  }
}

if (failures > 0) {
  console.error(`\n${failures} failure(s) across ${ALL_MAPS.length} maps`);
  process.exit(1);
}
console.log(`\nall ${ALL_MAPS.length} maps passed`);
