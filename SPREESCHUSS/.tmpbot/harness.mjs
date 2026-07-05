// Headless harness for bots.js — NOT part of the repo.
// Replicates map colliders (mapbuilder contract: every box center±size/2 +
// 4 perimeter walls H=6 t=1) and a minimal game API stub.
import * as THREE from 'three';
import { ALL_MAPS, PLANT_MAPS, FFA_MAPS } from '../src/maps/maps.js';
import { Entity } from '../src/game/entity.js';
import { initBot, updateBot } from '../src/game/bots.js';

export function buildColliders(map) {
  const colliders = [];
  const [w, d] = map.size;
  const add = (pos, size) => colliders.push({
    min: new THREE.Vector3(pos[0] - size[0] / 2, pos[1] - size[1] / 2, pos[2] - size[2] / 2),
    max: new THREE.Vector3(pos[0] + size[0] / 2, pos[1] + size[1] / 2, pos[2] + size[2] / 2),
  });
  const H = 6, t = 1;
  add([0, H / 2, -d / 2], [w + t, H, t]);
  add([0, H / 2, d / 2], [w + t, H, t]);
  add([-w / 2, H / 2, 0], [t, H, d + t]);
  add([w / 2, H / 2, 0], [t, H, d + t]);
  for (const b of map.boxes || []) add(b.pos, b.size);
  return colliders;
}

export function makeGame(colliders, entities, opts = {}) {
  return {
    colliders,
    entities,
    settings: { botDifficulty: opts.difficulty || 'normal', infiniteAmmo: false, noCooldown: false, oneShot: false, ...opts.settings },
    mode: opts.mode || { kind: 'tdm', friendlyFire: false },
    spike: opts.spike || null,
    now: 0,
    botMoveTarget: opts.botMoveTarget || ((e) => (opts.target ? opts.target.clone() : e.pos.clone())),
    botObjective: opts.botObjective || (() => {}),
    castAbility: opts.castAbility || (() => false),
    spawnTracer() {},
    onDamage: opts.onDamage || (() => {}),
    fx: null,
  };
}

export function makeBot(team, x, z, weapon = 'vandal', agent = null) {
  const e = new Entity({ team, agent: agent || undefined });
  e.pos.set(x, 0, z);
  e.spawnPos.copy(e.pos);
  if (weapon) e.giveWeapon(weapon);
  initBot(e);
  return e;
}

export { ALL_MAPS, PLANT_MAPS, FFA_MAPS, updateBot, THREE };
