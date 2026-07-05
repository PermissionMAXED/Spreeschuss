// Nav test: bots must reach plant sites (and cross-map points on FFA maps)
// from every spawn using beeline + whisker steering + auto-jump only.
import { buildColliders, makeGame, makeBot, PLANT_MAPS, FFA_MAPS, updateBot, THREE } from './harness.mjs';

const DT = 1 / 60;
const MAX_T = 50;

function runNav(map, startXZ, goalXZ, difficulty) {
  const colliders = buildColliders(map);
  const bot = makeBot('att', startXZ[0], startXZ[1]);
  const goal = new THREE.Vector3(goalXZ[0], 0, goalXZ[1]);
  const game = makeGame(colliders, [bot], {
    difficulty,
    mode: { kind: 'nav' },
    botMoveTarget: () => goal.clone(),
  });
  let now = 0;
  for (let i = 0; i < MAX_T / DT; i++) {
    now += DT;
    updateBot(game, bot, DT, now);
    const d = Math.hypot(bot.pos.x - goal.x, bot.pos.z - goal.z);
    if (d <= 2.5) return { ok: true, t: now };
  }
  const d = Math.hypot(bot.pos.x - goal.x, bot.pos.z - goal.z);
  return { ok: false, t: MAX_T, d, end: [bot.pos.x.toFixed(1), bot.pos.z.toFixed(1)] };
}

let pass = 0;
let fail = 0;
const fails = [];
let worst = 0;

for (const map of PLANT_MAPS) {
  const cases = [];
  const sites = Object.entries(map.sites);
  // every attacker & defender spawn to BOTH sites (incl. cross-lane routes)
  for (const [siteKey, s] of sites) {
    for (const sp of map.spawns.attackers) cases.push({ from: sp, to: s.center, label: `att->${siteKey}` });
    for (const sp of map.spawns.defenders) cases.push({ from: sp, to: s.center, label: `def->${siteKey}` });
  }
  // site-to-site rotation (post-plant retake path)
  cases.push({ from: sites[0][1].center, to: sites[1][1].center, label: 'A->B' });
  for (const c of cases) {
    const r = runNav(map, c.from, c.to, 'normal');
    if (r.ok) { pass++; worst = Math.max(worst, r.t); }
    else { fail++; fails.push(`${map.id} ${c.label} from(${c.from[0]},${c.from[1]}) d=${r.d.toFixed(1)} end=${r.end}`); }
  }
}

for (const map of FFA_MAPS) {
  const sp = map.spawns.ffa;
  for (let i = 0; i < sp.length; i++) {
    const from = sp[i];
    const to = sp[(i + Math.floor(sp.length / 2)) % sp.length]; // opposite side, crosses center
    const r = runNav(map, from, to, 'normal');
    if (r.ok) { pass++; worst = Math.max(worst, r.t); }
    else { fail++; fails.push(`${map.id} spawn${i} d=${r.d.toFixed(1)} end=${r.end}`); }
  }
}

console.log(`NAV: pass=${pass} fail=${fail} worstTime=${worst.toFixed(1)}s`);
if (fails.length) { console.log(fails.slice(0, 25).join('\n')); process.exit(1); }
