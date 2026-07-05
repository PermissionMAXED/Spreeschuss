// Ability selection tests: keyed by type, situational, and crash-safe when
// an agent lacks types/abilities.
import { buildColliders, makeGame, makeBot, updateBot, THREE } from './harness.mjs';
import { AGENTS, agentById } from '../src/agents/agents.js';

const DT = 1 / 60;

function simulate(bot, game, seconds, onCast) {
  game.castAbility = (e, key) => {
    const ab = e.agent && e.agent.abilities ? e.agent.abilities[key] : null;
    onCast(key, ab ? ab.type : null);
    return true;
  };
  let now = 0;
  for (let i = 0; i < seconds / DT; i++) {
    now += DT;
    updateBot(game, bot, DT, now);
  }
}

// 1. heal when hp < 50 (Sani has heal on C and E)
{
  const colliders = buildColliders({ size: [60, 60], boxes: [] });
  const bot = makeBot('att', 0, 0, 'vandal', agentById('sani'));
  bot.hp = 40;
  const casts = [];
  simulate(bot, makeGame(colliders, [bot], { target: new THREE.Vector3(0, 0, 0) }), 8, (k, t) => casts.push(t));
  console.log(`HEAL low-hp: casts=[${casts}] ${casts.includes('heal') ? 'PASS' : 'FAIL'}`);
}

// 2. no heal at full hp; nothing else situational -> no casts
{
  const colliders = buildColliders({ size: [60, 60], boxes: [] });
  const bot = makeBot('att', 0, 0, 'vandal', agentById('sani'));
  const casts = [];
  simulate(bot, makeGame(colliders, [bot], { target: new THREE.Vector3(0, 0, 0) }), 10, (k, t) => casts.push(t));
  console.log(`IDLE full-hp: casts=[${casts}] ${casts.length === 0 ? 'PASS' : 'FAIL'}`);
}

// 3. smoke while crossing open ground toward a far objective (Nebel C/E smoke)
{
  const colliders = buildColliders({ size: [90, 90], boxes: [] });
  const bot = makeBot('att', 0, -35, 'vandal', agentById('nebel'));
  const casts = [];
  simulate(bot, makeGame(colliders, [bot], { target: new THREE.Vector3(0, 0, 35) }), 10, (k, t) => casts.push(t));
  console.log(`SMOKE crossing: casts=[${casts}] ${casts.includes('smoke') ? 'PASS' : 'FAIL'}`);
}

// 4. dash when far from objective (Spree Q/E dash)
{
  const colliders = buildColliders({ size: [90, 90], boxes: [] });
  const bot = makeBot('att', 0, -35, 'vandal', agentById('spree'));
  const casts = [];
  simulate(bot, makeGame(colliders, [bot], { target: new THREE.Vector3(0, 0, 35) }), 10, (k, t) => casts.push(t));
  console.log(`DASH far travel: casts=[${casts}] ${casts.includes('dash') || casts.includes('flash') ? 'PASS' : 'FAIL'} (dash expected)`);
}

// 5. molly/flash when an enemy is near but hidden (Brandt = molly everywhere)
{
  const colliders = buildColliders({ size: [60, 60], boxes: [{ pos: [0, 1.6, 5], size: [10, 3.2, 1] }] });
  const bot = makeBot('att', 0, 0, 'vandal', agentById('brandt'));
  const enemy = makeBot('def', 0, 12); // behind the wall
  const casts = [];
  const game = makeGame(colliders, [bot, enemy], { target: new THREE.Vector3(0, 0, 0) });
  game.castAbility = (e, key) => { casts.push(e.agent.abilities[key].type); return true; };
  let now = 0;
  for (let i = 0; i < 1 / DT; i++) { now += DT; updateBot(game, bot, DT, now); }
  bot.hp -= 15; // unseen damage -> memory of the hidden enemy
  for (let i = 0; i < 6 / DT; i++) { now += DT; updateBot(game, bot, DT, now); }
  console.log(`MOLLY hidden enemy: casts=[${casts}] ${casts.includes('molly') ? 'PASS' : 'FAIL'}`);
}

// 6. turret/trap while defending near a site (plant mode, Bollwerk)
{
  const colliders = buildColliders({ size: [60, 60], boxes: [] });
  const bot = makeBot('def', 0, 18, 'vandal', agentById('bollwerk'));
  const casts = [];
  const game = makeGame(colliders, [bot], {
    mode: { kind: 'plant' },
    spike: { carrier: null, planted: false },
    target: new THREE.Vector3(0, 0, 20),
  });
  game.castAbility = (e, key) => { casts.push(e.agent.abilities[key].type); return true; };
  let now = 0;
  for (let i = 0; i < 12 / DT; i++) { now += DT; updateBot(game, bot, DT, now); }
  console.log(`TURRET/TRAP defending: casts=[${casts}] ${casts.some((t) => t === 'turret' || t === 'trap' || t === 'wall') ? 'PASS' : 'FAIL'}`);
}

// 7. SAFETY: agent with no types / missing abilities / no agent -> no throw
{
  const colliders = buildColliders({ size: [60, 60], boxes: [] });
  const weird = {
    id: 'weird', name: 'Weird', color: '#fff',
    abilities: {
      C: { name: 'NoType', charges: 1 },              // no type
      Q: { name: 'Unknown', type: 'blackhole', charges: 1 }, // unknown type
      E: { name: 'NoType2', charges: 1 },
      X: { name: 'Ult', ult: true, points: 7 },
    },
  };
  let threw = null;
  try {
    const bot = makeBot('att', 0, -20, 'vandal', weird);
    bot.hp = 30;
    const game = makeGame(colliders, [bot], { target: new THREE.Vector3(0, 0, 20) });
    let now = 0;
    for (let i = 0; i < 12 / DT; i++) { now += DT; updateBot(game, bot, DT, now); }
    // no agent at all
    const bot2 = makeBot('att', 0, -20, 'vandal', null);
    for (let i = 0; i < 6 / DT; i++) { now += DT; updateBot(game, bot2, DT, now); }
    // abilityState stripped after construction (defensive)
    const bot3 = makeBot('att', 0, -20, 'vandal', weird);
    bot3.abilityState = undefined;
    bot3.hp = 30;
    for (let i = 0; i < 6 / DT; i++) { now += DT; updateBot(game, bot3, DT, now); }
  } catch (err) {
    threw = err;
  }
  console.log(`SAFETY no-type agents: ${threw ? 'FAIL ' + threw.message : 'PASS (no throw)'}`);
}

// 8. every real agent runs 30 s in a busy scene without throwing
{
  let threw = null;
  try {
    for (const agent of AGENTS) {
      const colliders = buildColliders({ size: [60, 60], boxes: [{ pos: [0, 1.6, 5], size: [8, 3.2, 1] }] });
      const bot = makeBot('att', 0, -15, 'vandal', agent);
      bot.hp = 45;
      const enemy = makeBot('def', 0, 15);
      const game = makeGame(colliders, [bot, enemy], {
        mode: { kind: 'plant' },
        spike: { carrier: bot, planted: false },
        target: new THREE.Vector3(0, 0, 20),
      });
      let now = 0;
      for (let i = 0; i < 30 / DT; i++) { now += DT; updateBot(game, bot, DT, now); }
    }
  } catch (err) { threw = err; }
  console.log(`ALL AGENTS 30s sim: ${threw ? 'FAIL ' + threw.stack : 'PASS'}`);
}
