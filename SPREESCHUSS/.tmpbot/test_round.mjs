// Full 5v5 plant-round integration test with game.js's botMoveTarget /
// botObjective logic replicated verbatim. Verifies: attackers group on the
// carrier's site, spike gets planted, defenders rotate post-plant, and a
// perf sample of updateBot cost.
import { buildColliders, makeGame, makeBot, PLANT_MAPS, updateBot, THREE } from './harness.mjs';
import { agentById, AGENTS } from '../src/agents/agents.js';

const DT = 1 / 60;
const PLANT_TIME = 4;
const DEFUSE_TIME = 7;

// same slab test game.js uses in visionBlocked
function rayBoxLocal(origin, dir, b) {
  let tmin = -Infinity; let tmax = Infinity;
  for (const ax of ['x', 'y', 'z']) {
    const o = origin[ax]; const dd = dir[ax]; const mn = b.min[ax]; const mx = b.max[ax];
    if (Math.abs(dd) < 1e-8) { if (o < mn || o > mx) return null; }
    else {
      let t1 = (mn - o) / dd; let t2 = (mx - o) / dd;
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
      if (tmin > tmax) return null;
    }
  }
  if (tmax < 0) return null;
  return tmin > 0 ? tmin : tmax;
}

function runRound(map, difficulty, disarmDefenders = false) {
  const colliders = buildColliders(map);
  const sites = {};
  for (const k of Object.keys(map.sites)) {
    sites[k] = { center: new THREE.Vector3(map.sites[k].center[0], 0, map.sites[k].center[1]), radius: map.sites[k].radius };
  }
  const entities = [];
  for (let i = 0; i < 5; i++) {
    const sp = map.spawns.attackers[i];
    const e = makeBot('att', sp[0], sp[1], 'vandal', AGENTS[i]);
    e.yaw = sp[2];
    entities.push(e);
  }
  if (!disarmDefenders) {
    for (let i = 0; i < 5; i++) {
      const sp = map.spawns.defenders[i];
      const e = makeBot('def', sp[0], sp[1], 'vandal', AGENTS[i + 5]);
      e.yaw = sp[2];
      // sidearm ammo like resetForRound would provide
      e.ammo.classic = 12; e.reserve.classic = 36;
      entities.push(e);
    }
  }
  const spike = { carrier: entities[0], planted: false, plantPos: null, site: null, plantProgress: 0, defuseProgress: 0, plantedAt: 0, exploded: false, defused: false };

  const game = makeGame(colliders, entities, { difficulty, mode: { kind: 'plant', friendlyFire: false }, spike });
  const visionBlocked = (from, to) => {
    const dir = to.clone().sub(from);
    const dist = dir.length();
    if (dist < 0.001) return false;
    dir.normalize();
    // walls only (no smokes in this harness)
    for (const b2 of colliders) {
      const t = rayBoxLocal(from, dir, b2);
      if (t !== null && t < dist - 0.4) return true;
    }
    return false;
  };
  const enemyNear = (e, range) => {
    for (const o of entities) {
      if (!o.alive || o.team === e.team) continue;
      if (o.pos.distanceTo(e.pos) < range && !visionBlocked(e.eyePosition(), o.eyePosition())) return true;
    }
    return false;
  };
  const siteAt = (pos) => {
    for (const key of Object.keys(sites)) {
      const s = sites[key];
      if (Math.hypot(pos.x - s.center.x, pos.z - s.center.z) <= s.radius) return key;
    }
    return null;
  };
  // ---- verbatim game.js logic (plant mode branch) ----
  game.botMoveTarget = (e) => {
    const sp = spike;
    const keys = Object.keys(sites);
    if (e.team === 'att') {
      if (sp && sp.planted) return sp.plantPos.clone();
      if (sp && sp.carrier === e) {
        if (!e._siteTarget) e._siteTarget = keys[Math.floor(Math.random() * keys.length)];
        return sites[e._siteTarget].center.clone();
      }
      if (!e._siteTarget) e._siteTarget = keys[Math.floor(Math.random() * keys.length)];
      return sites[e._siteTarget].center.clone();
    }
    if (sp && sp.planted) return sp.plantPos.clone();
    if (!e._holdSite) e._holdSite = keys[Math.floor(Math.random() * keys.length)];
    const c = sites[e._holdSite].center;
    return new THREE.Vector3(c.x + (Math.random() - 0.5) * 6, 0, c.z - 4 + (Math.random() - 0.5) * 4);
  };
  let winner = null;
  game.botObjective = (e, dt, now) => {
    const sp = spike;
    if (winner) return;
    if (e.team === 'att' && !sp.planted && sp.carrier === e) {
      const site = siteAt(e.pos);
      if (site && !enemyNear(e, 8)) {
        sp.plantProgress += dt / PLANT_TIME;
        if (sp.plantProgress >= 1) {
          sp.planted = true;
          sp.plantedAt = now;
          sp.site = site;
          sp.plantPos = e.pos.clone();
        }
      }
    }
    if (e.team === 'def' && sp.planted && !sp.defused) {
      const d2 = Math.hypot(e.pos.x - sp.plantPos.x, e.pos.z - sp.plantPos.z);
      if (d2 < 2 && !enemyNear(e, 8)) {
        if (sp._defuseTick !== now) {
          sp._defuseTick = now;
          sp.defuseProgress += dt / DEFUSE_TIME;
        }
        if (sp.defuseProgress >= 1) { sp.defused = true; winner = 'def'; }
      }
    }
  };
  game.castAbility = () => false; // abilities exercised in test_abilities

  let now = 0;
  let plantedAt = -1;
  let groupedAtPlant = -1;
  let defusedAt = -1;
  let perfMs = 0;
  let perfN = 0;
  for (let i = 0; i < 120 / DT; i++) {
    now += DT;
    game.now = now;
    const t0 = performance.now();
    for (const e of entities) if (e.alive) updateBot(game, e, DT, now);
    perfMs += performance.now() - t0;
    perfN++;
    if (spike.planted && plantedAt < 0) {
      plantedAt = now;
      const siteC = sites[spike.site].center;
      groupedAtPlant = entities.filter((e) => e.team === 'att' && e.alive
        && Math.hypot(e.pos.x - siteC.x, e.pos.z - siteC.z) < 14).length;
    }
    if (spike.defused && defusedAt < 0) defusedAt = now;
    const attAlive = entities.filter((e) => e.team === 'att' && e.alive).length;
    const defAlive = entities.filter((e) => e.team === 'def' && e.alive).length;
    if (disarmDefenders) {
      if (spike.planted) { winner = 'att-plant'; break; } // objective reached
    } else {
      if (!spike.planted && (attAlive === 0 || defAlive === 0)) { winner = attAlive ? 'att-wipe' : 'def-wipe'; break; }
      if (spike.planted && (defAlive === 0 || spike.defused)) { winner = spike.defused ? 'def-defuse' : 'att-plant-hold'; break; }
      if (spike.planted && now - spike.plantedAt > 45) { winner = 'att-detonate'; break; }
    }
  }
  return { winner, plantedAt, groupedAtPlant, defusedAt, msPerTick: perfMs / perfN };
}

// A) disarmed defenders: attackers must group, plant and hold on many maps
let planted = 0;
let grouped = 0;
let runs = 0;
for (let i = 0; i < 10; i++) {
  const r = runRound(PLANT_MAPS[i * 3], 'normal', true);
  runs++;
  if (r.plantedAt > 0) planted++;
  if (r.groupedAtPlant >= 3) grouped++;
  console.log(`round map=${PLANT_MAPS[i * 3].id} winner=${r.winner} plantedAt=${r.plantedAt.toFixed(1)}s attNearSiteAtPlant=${r.groupedAtPlant}/5 msPerTick(10bots)=${r.msPerTick.toFixed(3)}`);
}
console.log(`PLANT: planted=${planted}/${runs} groupedOK=${grouped}/${runs}`);

// B) real 5v5 fights: rounds should resolve (someone wins) on normal
let resolved = 0;
const outcomes = {};
for (let i = 0; i < 8; i++) {
  const r = runRound(PLANT_MAPS[i * 2 + 1], 'normal', false);
  if (r.winner) resolved++;
  outcomes[r.winner] = (outcomes[r.winner] || 0) + 1;
  if (r.plantedAt > 0 && r.defusedAt > 0) outcomes.defuseHappened = (outcomes.defuseHappened || 0) + 1;
}
console.log(`FIGHT ROUNDS resolved=${resolved}/8 outcomes=${JSON.stringify(outcomes)}`);
