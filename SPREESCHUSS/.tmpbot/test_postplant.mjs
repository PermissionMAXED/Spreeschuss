// Post-plant discipline: defenders rotate to the planted spike and defuse;
// defenders pre-plant hold angles near their site (stable hold points).
import { buildColliders, makeGame, makeBot, PLANT_MAPS, updateBot, THREE } from './harness.mjs';
import { AGENTS } from '../src/agents/agents.js';

const DT = 1 / 60;
const DEFUSE_TIME = 7;

// A) retake + defuse on 8 maps
let defused = 0;
for (let m = 0; m < 8; m++) {
  const map = PLANT_MAPS[m * 3 + 1];
  const colliders = buildColliders(map);
  const siteA = map.sites.A;
  const spike = {
    carrier: null, planted: true, defused: false,
    plantPos: new THREE.Vector3(siteA.center[0], 0, siteA.center[1]),
    site: 'A', plantedAt: 0, defuseProgress: 0,
  };
  const entities = [];
  for (let i = 0; i < 5; i++) {
    const sp = map.spawns.defenders[i];
    const e = makeBot('def', sp[0], sp[1], 'vandal', AGENTS[i]);
    entities.push(e);
  }
  const game = makeGame(colliders, entities, {
    mode: { kind: 'plant', friendlyFire: false },
    spike,
    botMoveTarget: () => spike.plantPos.clone(),
  });
  game.botObjective = (e, dt, now) => {
    if (e.team !== 'def' || !spike.planted || spike.defused) return;
    const d = Math.hypot(e.pos.x - spike.plantPos.x, e.pos.z - spike.plantPos.z);
    if (d < 2) {
      if (spike._tick !== now) { spike._tick = now; spike.defuseProgress += dt / DEFUSE_TIME; }
      if (spike.defuseProgress >= 1) spike.defused = true;
    }
  };
  let now = 0;
  let t = -1;
  for (let i = 0; i < 60 / DT; i++) {
    now += DT;
    for (const e of entities) if (e.alive) updateBot(game, e, DT, now);
    if (spike.defused) { t = now; break; }
  }
  if (t > 0) defused++;
  console.log(`retake ${map.id}: defused=${spike.defused} at ${t.toFixed(1)}s`);
}
console.log(`RETAKE: defused=${defused}/8`);

// B) pre-plant defender hold stability: after walking to the site, defenders
// should stay near it (stable hold, not wandering) for the next 20 s.
{
  const map = PLANT_MAPS[2];
  const colliders = buildColliders(map);
  const siteB = map.sites.B;
  const center = new THREE.Vector3(siteB.center[0], 0, siteB.center[1]);
  const spike = { carrier: null, planted: false };
  const entities = [];
  for (let i = 0; i < 5; i++) {
    const sp = map.spawns.defenders[i];
    entities.push(makeBot('def', sp[0], sp[1], 'vandal', AGENTS[i]));
  }
  const game = makeGame(colliders, entities, {
    mode: { kind: 'plant', friendlyFire: false },
    spike,
    botMoveTarget: () => new THREE.Vector3(
      center.x + (Math.random() - 0.5) * 6, 0, center.z - 4 + (Math.random() - 0.5) * 4),
  });
  let now = 0;
  for (let i = 0; i < 15 / DT; i++) { now += DT; for (const e of entities) updateBot(game, e, DT, now); }
  let maxDrift = 0;
  const anchors = entities.map((e) => e.pos.clone());
  for (let i = 0; i < 20 / DT; i++) {
    now += DT;
    for (let j = 0; j < entities.length; j++) {
      updateBot(game, entities[j], DT, now);
      maxDrift = Math.max(maxDrift, entities[j].pos.distanceTo(anchors[j]));
    }
  }
  const nearSite = entities.filter((e) => Math.hypot(e.pos.x - center.x, e.pos.z - center.z) < 12).length;
  console.log(`HOLD: defendersNearSite=${nearSite}/5 maxDrift20s=${maxDrift.toFixed(1)}m ${nearSite >= 4 && maxDrift < 12 ? 'PASS' : 'FAIL'}`);
}
