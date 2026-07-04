import * as THREE from 'three';

// Reusable ability BEHAVIORS. Each factory returns a spec merged into the
// agent's ability definition. At cast time `cast(game, caster, aim)` is called.
// `game` must expose the helper API documented in game.js (effects, damage,
// temp colliders, flashes, reveals, slows, heals).
//
// Ability spec shape:
//   { id, name, key, type, charges, cost, cooldown, ult, points, desc, cast(game, caster, aim) }

const AIM_RANGE = 60;

function forwardPoint(caster, aim, dist) {
  const dir = aim?.dir || new THREE.Vector3(0, 0, -1);
  return caster.eyePosition().add(dir.clone().multiplyScalar(dist));
}

export const AbilityBehaviors = {
  flash: (opts = {}) => ({
    type: 'flash',
    cast(game, caster, aim) {
      const origin = caster.eyePosition();
      const dir = (aim?.dir || new THREE.Vector3(0, 0, -1)).clone();
      const detonate = origin.clone().add(dir.multiplyScalar(opts.dist ?? 14));
      game.spawnFlash(detonate, caster, opts.duration ?? 1.6, opts.radius ?? 22);
    },
  }),

  smoke: (opts = {}) => ({
    type: 'smoke',
    cast(game, caster, aim) {
      const p = forwardPoint(caster, aim, opts.dist ?? 18);
      p.y = 0;
      game.spawnSmoke(p, opts.radius ?? 5, opts.duration ?? 15);
    },
  }),

  molly: (opts = {}) => ({
    type: 'molly',
    cast(game, caster, aim) {
      const p = forwardPoint(caster, aim, opts.dist ?? 16);
      p.y = 0.05;
      game.spawnZone(p, opts.radius ?? 4, opts.duration ?? 5, { dps: opts.dps ?? 45, team: caster.team, color: 0xff6a2a });
    },
  }),

  slow: (opts = {}) => ({
    type: 'slow',
    cast(game, caster, aim) {
      const p = forwardPoint(caster, aim, opts.dist ?? 16);
      p.y = 0.05;
      game.spawnZone(p, opts.radius ?? 5, opts.duration ?? 6, { slow: opts.slow ?? 0.5, team: caster.team, color: 0x7fe0ff });
    },
  }),

  wall: (opts = {}) => ({
    type: 'wall',
    cast(game, caster, aim) {
      const p = forwardPoint(caster, aim, opts.dist ?? 8);
      const yaw = caster.yaw + Math.PI / 2;
      game.spawnWall(p, yaw, opts.length ?? 12, opts.height ?? 3.5, opts.duration ?? 20);
    },
  }),

  dash: (opts = {}) => ({
    type: 'dash',
    cast(game, caster) {
      const dir = caster.forward();
      caster.applyImpulse(dir.multiplyScalar(opts.force ?? 18), opts.up ?? 3);
    },
  }),

  heal: (opts = {}) => ({
    type: 'heal',
    cast(game, caster) {
      game.healOverTime(caster, opts.amount ?? 60, opts.duration ?? 4);
    },
  }),

  recon: (opts = {}) => ({
    type: 'recon',
    cast(game, caster, aim) {
      const p = forwardPoint(caster, aim, opts.dist ?? 20);
      game.reveal(caster.team, p, opts.radius ?? 18, opts.duration ?? 4);
    },
  }),

  turret: (opts = {}) => ({
    type: 'turret',
    cast(game, caster, aim) {
      const p = forwardPoint(caster, aim, opts.dist ?? 4);
      p.y = 0.05;
      game.spawnTurret(p, caster.team, { dps: opts.dps ?? 18, range: opts.range ?? 30, duration: opts.duration ?? 40 });
    },
  }),

  trap: (opts = {}) => ({
    type: 'trap',
    cast(game, caster, aim) {
      const p = forwardPoint(caster, aim, opts.dist ?? 6);
      p.y = 0.05;
      game.spawnTrap(p, caster.team, { radius: opts.radius ?? 3, effect: opts.effect ?? 'slow', duration: opts.duration ?? 4 });
    },
  }),
};

// Compose an ability definition from a behavior + metadata.
export function makeAbility(behaviorFactory, meta) {
  return { ...behaviorFactory(meta.opts || {}), ...meta };
}
