// Combat tests: difficulty differentiation, damage-reaction memory, hunt.
import { buildColliders, makeGame, makeBot, FFA_MAPS, updateBot, THREE } from './harness.mjs';

const DT = 1 / 60;

// ---------------------------------------------------------------- 1. TTK
// One bot vs a stationary 100 hp dummy at 18 m in an empty arena.
function ttk(difficulty, trials = 30) {
  const times = [];
  for (let k = 0; k < trials; k++) {
    const colliders = buildColliders({ size: [60, 60], boxes: [] });
    const bot = makeBot('att', 0, -9);
    const dummy = makeBot('def', 0, 9);
    dummy.isBot = false; // never updated; just a target
    const game = makeGame(colliders, [bot, dummy], {
      difficulty,
      mode: { kind: 'tdm', friendlyFire: false },
      target: new THREE.Vector3(0, 0, 9),
      onDamage: () => {},
    });
    let now = 0;
    let t = -1;
    for (let i = 0; i < 20 / DT; i++) {
      now += DT;
      updateBot(game, bot, DT, now);
      if (!dummy.alive) { t = now; break; }
    }
    times.push(t < 0 ? 20 : t);
  }
  times.sort((a, b) => a - b);
  const avg = times.reduce((s, x) => s + x, 0) / times.length;
  return { avg, med: times[Math.floor(times.length / 2)] };
}

for (const d of ['easy', 'normal', 'hard']) {
  const r = ttk(d);
  console.log(`TTK ${d}: avg=${r.avg.toFixed(2)}s med=${r.med.toFixed(2)}s`);
}

// ---------------------------------------------------------------- 2. 5v5
// Easy team vs hard team on an open FFA map. Each side reads its difficulty
// through its own game proxy (shared world). Expect hard to dominate.
function teamFight(diffA, diffB, rounds = 12) {
  let winsA = 0;
  let winsB = 0;
  for (let k = 0; k < rounds; k++) {
    const map = FFA_MAPS[k % FFA_MAPS.length];
    const colliders = buildColliders(map);
    const entities = [];
    for (let i = 0; i < 5; i++) {
      const sp = map.spawns.ffa[i];
      entities.push(makeBot('att', sp[0], sp[1]));
    }
    for (let i = 0; i < 5; i++) {
      const sp = map.spawns.ffa[(i + 6) % map.spawns.ffa.length];
      entities.push(makeBot('def', sp[0], sp[1]));
    }
    const mkTarget = (e) => {
      let best = null; let bd = Infinity;
      for (const o of entities) {
        if (!o.alive || o.team === e.team) continue;
        const d2 = o.pos.distanceToSquared(e.pos);
        if (d2 < bd) { bd = d2; best = o; }
      }
      return best ? best.pos.clone() : e.pos.clone();
    };
    const base = { mode: { kind: 'tdm', friendlyFire: false }, botMoveTarget: mkTarget };
    const gameA = makeGame(colliders, entities, { ...base, difficulty: diffA });
    const gameB = makeGame(colliders, entities, { ...base, difficulty: diffB });
    let now = 0;
    for (let i = 0; i < 90 / DT; i++) {
      now += DT;
      for (const e of entities) {
        if (!e.alive) continue;
        updateBot(e.team === 'att' ? gameA : gameB, e, DT, now);
      }
      const aAlive = entities.some((e) => e.team === 'att' && e.alive);
      const bAlive = entities.some((e) => e.team === 'def' && e.alive);
      if (!aAlive || !bAlive) break;
    }
    const aCount = entities.filter((e) => e.team === 'att' && e.alive).length;
    const bCount = entities.filter((e) => e.team === 'def' && e.alive).length;
    if (aCount > bCount) winsA++; else if (bCount > aCount) winsB++;
  }
  return { winsA, winsB };
}

let r = teamFight('hard', 'easy');
console.log(`5v5 hard vs easy: hard=${r.winsA} easy=${r.winsB}`);
r = teamFight('hard', 'normal');
console.log(`5v5 hard vs normal: hard=${r.winsA} normal=${r.winsB}`);
r = teamFight('normal', 'easy');
console.log(`5v5 normal vs easy: normal=${r.winsA} easy=${r.winsB}`);

// ------------------------------------------------- 3. damage-reaction turn
// Bot faces away; attacker behind a wall pokes it (no LOS). Expect the bot to
// turn toward the attacker within ~1 s of taking damage.
{
  const colliders = buildColliders({ size: [40, 40], boxes: [{ pos: [0, 1.6, 6], size: [8, 3.2, 1] }] });
  const bot = makeBot('att', 0, 0);
  bot.yaw = Math.PI; // facing -z (attacker is at +z behind the wall)
  const enemy = makeBot('def', 0, 12);
  const game = makeGame(colliders, [bot, enemy], {
    mode: { kind: 'tdm', friendlyFire: false },
    target: new THREE.Vector3(0, 0, 0), // stay in place
  });
  let now = 0;
  for (let i = 0; i < 2 / DT; i++) { now += DT; updateBot(game, bot, DT, now); }
  const yawBefore = bot.yaw;
  bot.hp -= 20; // simulate wallbang / zone damage from the unseen enemy
  for (let i = 0; i < 1.2 / DT; i++) { now += DT; updateBot(game, bot, DT, now); }
  // desired yaw toward enemy at +z from origin-ish: atan2(-dx, -dz)
  const want = Math.atan2(-(enemy.pos.x - bot.pos.x), -(enemy.pos.z - bot.pos.z));
  const err = Math.abs(Math.atan2(Math.sin(bot.yaw - want), Math.cos(bot.yaw - want)));
  console.log(`DMG-REACT: yawBefore=${yawBefore.toFixed(2)} yawAfter=${bot.yaw.toFixed(2)} errToThreat=${err.toFixed(2)} rad ${err < 0.6 ? 'PASS' : 'FAIL'}`);
  // and it should start hunting toward the memory position
  console.log(`DMG-REACT hunt: memUntil>now=${bot.bot.memUntil > now} moved=${bot.pos.z > 0.5 ? 'toward threat' : bot.pos.z.toFixed(2)}`);
}

// ------------------------------------------------- 4. hunt after lost sight
// Enemy visible, then teleported behind cover: bot should move to the
// last-seen position (hunt) instead of instantly forgetting.
{
  const colliders = buildColliders({ size: [40, 40], boxes: [{ pos: [6, 1.6, 8], size: [3, 3.2, 3] }] });
  const bot = makeBot('att', 0, 0);
  const enemy = makeBot('def', 0, 14);
  enemy.invulnerable = true;
  const game = makeGame(colliders, [bot, enemy], {
    mode: { kind: 'tdm', friendlyFire: false },
    target: new THREE.Vector3(0, 0, 0),
  });
  let now = 0;
  for (let i = 0; i < 1.5 / DT; i++) { now += DT; updateBot(game, bot, DT, now); }
  const sawIt = bot.bot.target === enemy;
  enemy.pos.set(6, 0, 8.5 + 3); // hide behind the block
  enemy.pos.set(30, 0, 18); // actually move far behind cover corner
  for (let i = 0; i < 2.5 / DT; i++) { now += DT; updateBot(game, bot, DT, now); }
  const dToLastSeen = Math.hypot(bot.pos.x - 0, bot.pos.z - 14);
  console.log(`HUNT: sawTarget=${sawIt} distToLastSeen=${dToLastSeen.toFixed(1)} (started 14.0) ${dToLastSeen < 6 ? 'PASS' : 'FAIL'}`);
}
