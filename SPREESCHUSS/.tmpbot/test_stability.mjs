// Long-run FFA stability: 10 bots, 120 s, respawns — no NaN, stay in bounds,
// flash respected (no firing while flashed), and a perf sample.
import { buildColliders, makeGame, makeBot, FFA_MAPS, updateBot, THREE } from './harness.mjs';
import { AGENTS } from '../src/agents/agents.js';

const DT = 1 / 60;
const map = FFA_MAPS[0];
const colliders = buildColliders(map);
const [w, d] = map.size;
const entities = [];
for (let i = 0; i < 10; i++) {
  const sp = map.spawns.ffa[i % map.spawns.ffa.length];
  const e = makeBot('ffa', sp[0], sp[1], 'vandal', AGENTS[i % AGENTS.length]);
  e.ammo.classic = 12; e.reserve.classic = 36;
  entities.push(e);
}
let kills = 0;
const game = makeGame(colliders, entities, {
  difficulty: 'normal',
  mode: { kind: 'ffa', friendlyFire: true, freeAbilities: true },
  botMoveTarget: (e) => {
    let best = null; let bd = Infinity;
    for (const o of entities) {
      if (!o.alive || o === e) continue;
      const d2 = o.pos.distanceToSquared(e.pos);
      if (d2 < bd) { bd = d2; best = o; }
    }
    return best ? best.pos.clone() : new THREE.Vector3((Math.random() - 0.5) * 30, 0, (Math.random() - 0.5) * 30);
  },
  onDamage: (att, vic) => { if (!vic.alive) kills++; },
  castAbility: () => Math.random() < 0.9, // pretend most casts succeed
});

let now = 0;
let bad = 0;
let flashViolations = 0;
let perf = 0;
for (let i = 0; i < 120 / DT; i++) {
  now += DT;
  // random flashes to exercise flash handling
  if (i % 600 === 300) {
    const v = entities[Math.floor(Math.random() * entities.length)];
    v.effects.flashUntil = now + 1.2;
  }
  const t0 = performance.now();
  for (const e of entities) {
    if (!e.alive) {
      // instant respawn harness-style
      e.hp = e.maxHp; e.alive = true;
      const sp = map.spawns.ffa[Math.floor(Math.random() * map.spawns.ffa.length)];
      e.pos.set(sp[0], 0, sp[1]);
      e.vel.set(0, 0, 0);
      e.ammo.vandal = 25; e.reserve.vandal = 75;
      continue;
    }
    const fireBefore = e.nextFire;
    updateBot(game, e, DT, now);
    if (now < e.effects.flashUntil && e.nextFire > fireBefore) flashViolations++;
    if (!Number.isFinite(e.pos.x) || !Number.isFinite(e.pos.z) || !Number.isFinite(e.yaw)) bad++;
    if (Math.abs(e.pos.x) > w / 2 + 1 || Math.abs(e.pos.z) > d / 2 + 1) bad++;
  }
  perf += performance.now() - t0;
}
console.log(`STABILITY 120s x10 bots: badStates=${bad} flashFireViolations=${flashViolations} kills=${kills} avgMsPerTick=${(perf / (120 / DT)).toFixed(3)} ${bad === 0 && flashViolations === 0 && kills > 10 ? 'PASS' : 'FAIL'}`);
