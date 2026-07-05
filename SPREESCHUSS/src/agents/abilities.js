import * as THREE from 'three';

// Reusable ability BEHAVIORS. Each factory returns a spec merged into the
// agent's ability definition. At cast time `cast(game, caster, aim)` is called.
// `game` must expose the helper API documented in game.js (effects, damage,
// temp colliders, flashes, reveals, slows, heals).
//
// Ability spec shape:
//   { id, name, key, type, charges, cost, cooldown, ult, points, desc, cast(game, caster, aim) }
//
// The file has two sections:
//   1. The ten CLASSIC behaviors (flash/smoke/molly/slow/wall/dash/heal/
//      recon/turret/trap). These are kept backward compatible.
//   2. COMPOSITE behaviors that layer 2-3 helper calls into shaped or staged
//      effects (smoke rows, molly lines, blink-dashes, fortresses, ...).
//      Every composite still reports one of the ten classic `type` strings so
//      menu icons and HUD labels keep working.

const AIM_RANGE = 60;

function forwardPoint(caster, aim, dist) {
  const dir = aim?.dir || new THREE.Vector3(0, 0, -1);
  return caster.eyePosition().add(dir.clone().multiplyScalar(dist));
}

// ---------------------------------------------------------------- geometry helpers
const UP = new THREE.Vector3(0, 1, 0);

// Horizontal aim direction (ignores pitch) so ground shapes like molly lines
// and smoke rows never compress when the caster looks up or down.
function flatDir(caster, aim) {
  const d = (aim?.dir || new THREE.Vector3(0, 0, -1)).clone();
  d.y = 0;
  if (d.lengthSq() < 1e-6) d.set(-Math.sin(caster.yaw), 0, -Math.cos(caster.yaw));
  return d.normalize();
}

// Point on the ground `dist` metres ahead of the caster (flat projection).
function groundPoint(caster, aim, dist, y = 0.05) {
  const p = caster.pos.clone().add(flatDir(caster, aim).multiplyScalar(dist));
  p.y = y;
  return p;
}

// Right-hand vector of a flat direction (for rows / flanking placements).
function rightOf(dir) {
  return new THREE.Vector3().crossVectors(dir, UP).normalize();
}

// Team key whose ENEMIES include the caster — used by risk/reward recon that
// intentionally reveals the caster's own position (game.reveal(team, ...)
// reveals every entity NOT on `team`).
function exposingTeam(caster) {
  return caster.team === 'att' ? 'def' : 'att';
}

export const AbilityBehaviors = {
  // ================================================================ classic
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
      game.spawnZone(p, opts.radius ?? 4, opts.duration ?? 5, { dps: opts.dps ?? 45, team: caster.team, owner: caster, color: 0xff6a2a });
    },
  }),

  slow: (opts = {}) => ({
    type: 'slow',
    cast(game, caster, aim) {
      const p = forwardPoint(caster, aim, opts.dist ?? 16);
      p.y = 0.05;
      game.spawnZone(p, opts.radius ?? 5, opts.duration ?? 6, { slow: opts.slow ?? 0.5, team: caster.team, owner: caster, color: 0x7fe0ff });
    },
  }),

  wall: (opts = {}) => ({
    type: 'wall',
    cast(game, caster, aim) {
      const p = forwardPoint(caster, aim, opts.dist ?? 8);
      const yaw = caster.yaw;
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
      game.spawnTurret(p, caster.team, { dps: opts.dps ?? 18, range: opts.range ?? 30, duration: opts.duration ?? 40, owner: caster });
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

  // ================================================================ composite
  // --- flash family --------------------------------------------------------
  // Several flash pops along the aim line. `delay` staggers pops (seconds)
  // so the second/third pop catches players turning back after the first.
  // Optional `reveal` tags the area around the deepest pop at cast time.
  flashVolley: (opts = {}) => ({
    type: 'flash',
    cast(game, caster, aim) {
      const origin = caster.eyePosition();
      const dir = (aim?.dir || new THREE.Vector3(0, 0, -1)).clone().normalize();
      const dists = opts.dists || [10, 16];
      const delay = opts.delay ?? 0;
      dists.forEach((dist, i) => {
        const pos = origin.clone().add(dir.clone().multiplyScalar(dist));
        const pop = () => game.spawnFlash(pos, caster, opts.duration ?? 1.4, opts.radius ?? 20);
        if (delay > 0 && i > 0) setTimeout(pop, i * delay * 1000);
        else pop();
      });
      if (opts.reveal) {
        const at = origin.clone().add(dir.clone().multiplyScalar(dists[dists.length - 1]));
        game.reveal(caster.team, at, opts.reveal.radius ?? 12, opts.reveal.duration ?? 3);
      }
    },
  }),

  // Flash that also tags enemies around the detonation point on the minimap.
  flashRecon: (opts = {}) => ({
    type: 'flash',
    cast(game, caster, aim) {
      const pos = forwardPoint(caster, aim, opts.dist ?? 16);
      game.spawnFlash(pos, caster, opts.duration ?? 1.3, opts.radius ?? 18);
      game.reveal(caster.team, pos, opts.revealRadius ?? 12, opts.revealDuration ?? 2.5);
    },
  }),

  // Flash delivered as a visible lightning bolt (tracer from eye to impact).
  boltFlash: (opts = {}) => ({
    type: 'flash',
    cast(game, caster, aim) {
      const eye = caster.eyePosition();
      const pos = forwardPoint(caster, aim, opts.dist ?? 16);
      game.spawnTracer(eye, pos);
      game.spawnFlash(pos, caster, opts.duration ?? 1.4, opts.radius ?? 20);
    },
  }),

  // Area-denial sensory overload: big flash + slow zone + reveal in one spot.
  sonicBoom: (opts = {}) => ({
    type: 'flash',
    cast(game, caster, aim) {
      const air = forwardPoint(caster, aim, opts.dist ?? 16);
      const ground = groundPoint(caster, aim, opts.dist ?? 16);
      game.spawnFlash(air, caster, opts.flashDuration ?? 1.8, opts.flashRadius ?? 24);
      game.spawnZone(ground, opts.slowRadius ?? 8, opts.slowDuration ?? 6, { slow: opts.slow ?? 0.5, team: caster.team, owner: caster, color: opts.color ?? 0xc743c7 });
      game.reveal(caster.team, ground, opts.revealRadius ?? 16, opts.revealDuration ?? 5);
    },
  }),

  // --- smoke family --------------------------------------------------------
  // Row of smokes perpendicular to the aim — a full smoke WALL in one cast.
  smokeWall: (opts = {}) => ({
    type: 'smoke',
    cast(game, caster, aim) {
      const dir = flatDir(caster, aim);
      const right = rightOf(dir);
      const count = opts.count ?? 3;
      const gap = opts.gap ?? 7;
      const center = caster.pos.clone().add(dir.clone().multiplyScalar(opts.dist ?? 18));
      center.y = 0;
      for (let i = 0; i < count; i++) {
        const off = (i - (count - 1) / 2) * gap;
        game.spawnSmoke(center.clone().add(right.clone().multiplyScalar(off)), opts.radius ?? 4.5, opts.duration ?? 15);
      }
    },
  }),

  // Smoke with a lingering slow (optionally damaging) zone underneath — a
  // toxic cloud you cannot simply sprint through.
  gasCloud: (opts = {}) => ({
    type: 'smoke',
    cast(game, caster, aim) {
      const p = groundPoint(caster, aim, opts.dist ?? 14);
      game.spawnSmoke(p.clone().setY(0), opts.radius ?? 4.5, opts.duration ?? 12);
      game.spawnZone(p, opts.slowRadius ?? opts.radius ?? 4.5, opts.slowDuration ?? 8, { slow: opts.slow ?? 0.4, dps: opts.dps ?? 0, team: caster.team, owner: caster, color: opts.color ?? 0x9a86e8 });
    },
  }),

  // Instant self-cover: smoke dropped on the caster + small heal-over-time.
  rescueSmoke: (opts = {}) => ({
    type: 'smoke',
    cast(game, caster) {
      game.spawnSmoke(caster.pos.clone().setY(0), opts.radius ?? 4, opts.duration ?? 8);
      if (opts.heal) game.healOverTime(caster, opts.heal, opts.healDuration ?? 2);
    },
  }),

  // --- molly family --------------------------------------------------------
  // Shaped napalm: several small damage zones laid out along the aim line.
  mollyLine: (opts = {}) => ({
    type: 'molly',
    cast(game, caster, aim) {
      const dir = flatDir(caster, aim);
      const count = opts.count ?? 4;
      for (let i = 0; i < count; i++) {
        const p = caster.pos.clone().add(dir.clone().multiplyScalar((opts.start ?? 6) + i * (opts.gap ?? 4)));
        p.y = 0.05;
        game.spawnZone(p, opts.radius ?? 2.2, opts.duration ?? 4, { dps: opts.dps ?? 35, team: caster.team, owner: caster, color: opts.color ?? 0xff6a2a });
      }
    },
  }),

  // Ring of fire around a target point, optional core zone in the middle.
  mollyRing: (opts = {}) => ({
    type: 'molly',
    cast(game, caster, aim) {
      const c = groundPoint(caster, aim, opts.dist ?? 18);
      const count = opts.count ?? 6;
      const ring = opts.ringRadius ?? 7;
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2;
        const p = new THREE.Vector3(c.x + Math.cos(a) * ring, 0.05, c.z + Math.sin(a) * ring);
        game.spawnZone(p, opts.radius ?? 3, opts.duration ?? 7, { dps: opts.dps ?? 50, team: caster.team, owner: caster, color: 0xff6a2a });
      }
      if (opts.center) {
        game.spawnZone(c, opts.center.radius ?? 4, opts.center.duration ?? opts.duration ?? 7, { dps: opts.center.dps ?? opts.dps ?? 50, team: caster.team, owner: caster, color: 0xff2a2a });
      }
    },
  }),

  // Zone centred on the CASTER (melee whirl / stand-your-ground field).
  // Reports 'molly' when it damages, 'slow' when it only hampers.
  selfBurst: (opts = {}) => ({
    type: opts.dps ? 'molly' : 'slow',
    cast(game, caster) {
      const p = caster.pos.clone();
      p.y = 0.05;
      game.spawnZone(p, opts.radius ?? 4, opts.duration ?? 3, { dps: opts.dps ?? 0, slow: opts.slow ?? 0, team: caster.team, owner: caster, color: opts.color ?? (opts.dps ? 0xff9f43 : 0x7fe0ff) });
    },
  }),

  // Lightning strikes: a cluster of short high-dps zones with sky tracers,
  // optionally topped by a disorienting flash at the centre.
  stormcall: (opts = {}) => ({
    type: 'molly',
    cast(game, caster, aim) {
      const c = groundPoint(caster, aim, opts.dist ?? 18);
      const n = opts.strikes ?? 3;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + Math.PI / 2;
        const p = new THREE.Vector3(c.x + Math.cos(a) * (opts.spread ?? 5), 0.05, c.z + Math.sin(a) * (opts.spread ?? 5));
        game.spawnZone(p, opts.radius ?? 3, opts.duration ?? 2.5, { dps: opts.dps ?? 90, team: caster.team, owner: caster, color: opts.color ?? 0xf0e04a });
        game.spawnTracer(p.clone().setY(18), p.clone().setY(0.2));
      }
      if (opts.flash) game.spawnFlash(c.clone().setY(2), caster, opts.flash.duration ?? 1.2, opts.flash.radius ?? 18);
    },
  }),

  // --- slow family ---------------------------------------------------------
  // Projected control storm: one large zone that can slow AND damage, with
  // optional whiteout smokes ('center' = one smoke inside, 'ring' = smokes on
  // the rim so victims are slow AND blind).
  slowStorm: (opts = {}) => ({
    type: 'slow',
    cast(game, caster, aim) {
      const c = groundPoint(caster, aim, opts.dist ?? 16);
      const radius = opts.radius ?? 8;
      game.spawnZone(c, radius, opts.duration ?? 8, { slow: opts.slow ?? 0.5, dps: opts.dps ?? 0, team: caster.team, owner: caster, color: opts.color ?? 0x7fe0ff });
      if (opts.smokes === 'center') {
        game.spawnSmoke(c.clone().setY(0), opts.smokeRadius ?? 5, opts.smokeDuration ?? opts.duration ?? 8);
      } else if (opts.smokes === 'ring') {
        const n = opts.smokeCount ?? 3;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2 + Math.PI / 6;
          const p = new THREE.Vector3(c.x + Math.cos(a) * radius, 0, c.z + Math.sin(a) * radius);
          game.spawnSmoke(p, opts.smokeRadius ?? 4, opts.smokeDuration ?? opts.duration ?? 8);
        }
      }
    },
  }),

  // --- dash family ---------------------------------------------------------
  // Blink-style dash that covers the departure point (and optionally the
  // expected arrival area) with small smokes.
  blinkDash: (opts = {}) => ({
    type: 'dash',
    cast(game, caster, aim) {
      if (opts.originSmoke) game.spawnSmoke(caster.pos.clone().setY(0), opts.originSmoke.radius ?? 3, opts.originSmoke.duration ?? 6);
      if (opts.aheadSmoke) {
        const p = caster.pos.clone().add(flatDir(caster, aim).multiplyScalar(opts.aheadSmoke.dist ?? 7));
        p.y = 0;
        game.spawnSmoke(p, opts.aheadSmoke.radius ?? 3, opts.aheadSmoke.duration ?? 6);
      }
      caster.applyImpulse(caster.forward().multiplyScalar(opts.force ?? 22), opts.up ?? 3);
    },
  }),

  // Charging dash that scorches the launch path with damage zones; the big
  // version also drops a slow field at the end of the charge.
  dashTrail: (opts = {}) => ({
    type: 'dash',
    cast(game, caster, aim) {
      const dir = flatDir(caster, aim);
      for (let i = 0; i < (opts.zoneCount ?? 2); i++) {
        const p = caster.pos.clone().add(dir.clone().multiplyScalar(i * (opts.zoneGap ?? 3.5)));
        p.y = 0.05;
        game.spawnZone(p, opts.zoneRadius ?? 2.2, opts.zoneDuration ?? 2.5, { dps: opts.dps ?? 35, team: caster.team, owner: caster, color: 0xe0433a });
      }
      if (opts.endSlow) {
        const p = caster.pos.clone().add(dir.clone().multiplyScalar(opts.endSlow.dist ?? 12));
        p.y = 0.05;
        game.spawnZone(p, opts.endSlow.radius ?? 5, opts.endSlow.duration ?? 3, { slow: opts.endSlow.slow ?? 0.4, team: caster.team, owner: caster, color: 0xffb04a });
      }
      caster.applyImpulse(caster.forward().multiplyScalar(opts.force ?? 20), opts.up ?? 1);
    },
  }),

  // Hunter's dash: brief reveal pulse where the dash is headed.
  huntDash: (opts = {}) => ({
    type: 'dash',
    cast(game, caster, aim) {
      const p = caster.pos.clone().add(flatDir(caster, aim).multiplyScalar(opts.revealDist ?? 8));
      game.reveal(caster.team, p, opts.revealRadius ?? 10, opts.revealDuration ?? 2);
      caster.applyImpulse(caster.forward().multiplyScalar(opts.force ?? 22), opts.up ?? 3);
    },
  }),

  // Entry-breach ult: huge dash + deep flash + reveal of the breached area.
  // The flash pops well beyond the landing spot — turn your eyes or eat it.
  breachDash: (opts = {}) => ({
    type: 'dash',
    cast(game, caster, aim) {
      const dir = (aim?.dir || new THREE.Vector3(0, 0, -1)).clone().normalize();
      const flashPos = caster.eyePosition().add(dir.multiplyScalar(opts.flashDist ?? 20));
      game.spawnFlash(flashPos, caster, opts.flashDuration ?? 1.5, opts.flashRadius ?? 20);
      const revealPos = caster.pos.clone().add(flatDir(caster, aim).multiplyScalar(opts.revealDist ?? 12));
      game.reveal(caster.team, revealPos, opts.revealRadius ?? 14, opts.revealDuration ?? 3);
      caster.applyImpulse(caster.forward().multiplyScalar(opts.force ?? 28), opts.up ?? 4);
    },
  }),

  // Vanishing ult: thick smoke on the departure point, monster dash, and a
  // reveal pulse around the arrival area to pick a victim.
  shadowDive: (opts = {}) => ({
    type: 'dash',
    cast(game, caster, aim) {
      game.spawnSmoke(caster.pos.clone().setY(0), opts.smokeRadius ?? 5, opts.smokeDuration ?? 8);
      const landing = caster.pos.clone().add(flatDir(caster, aim).multiplyScalar(opts.revealDist ?? 10));
      game.reveal(caster.team, landing, opts.revealRadius ?? 16, opts.revealDuration ?? 4);
      caster.applyImpulse(caster.forward().multiplyScalar(opts.force ?? 30), opts.up ?? 5);
    },
  }),

  // Blade-dancer ult: leap in, shred the landing area, drink the chaos.
  bladeDance: (opts = {}) => ({
    type: 'dash',
    cast(game, caster, aim) {
      const p = caster.pos.clone().add(flatDir(caster, aim).multiplyScalar(opts.zoneDist ?? 7));
      p.y = 0.05;
      game.spawnZone(p, opts.zoneRadius ?? 4, opts.zoneDuration ?? 3, { dps: opts.dps ?? 60, team: caster.team, owner: caster, color: 0xff4a6a });
      game.healOverTime(caster, opts.heal ?? 50, opts.healDuration ?? 3);
      caster.applyImpulse(caster.forward().multiplyScalar(opts.force ?? 26), opts.up ?? 4);
    },
  }),

  // --- wall family ---------------------------------------------------------
  // Wall PARALLEL to the aim direction — splits a lane lengthwise instead of
  // blocking it, forcing a 50/50 on which side enemies push.
  corridorWall: (opts = {}) => ({
    type: 'wall',
    cast(game, caster, aim) {
      const p = caster.pos.clone().add(flatDir(caster, aim).multiplyScalar(opts.dist ?? 10));
      game.spawnWall(p, caster.yaw + Math.PI / 2, opts.length ?? 16, opts.height ?? 3.5, opts.duration ?? 12);
    },
  }),

  // Frontal cover wall plus a self heal — fortify-and-patch-up in one cast.
  guardWall: (opts = {}) => ({
    type: 'wall',
    cast(game, caster, aim) {
      const p = caster.pos.clone().add(flatDir(caster, aim).multiplyScalar(opts.dist ?? 3));
      game.spawnWall(p, caster.yaw, opts.length ?? 8, opts.height ?? 3, opts.duration ?? 15);
      if (opts.heal) game.healOverTime(caster, opts.heal, opts.healDuration ?? 3);
    },
  }),

  // Projected U-shaped fort (front + two side walls, open towards the caster)
  // at the aim point, optionally garrisoned by a sensor turret inside.
  fortress: (opts = {}) => ({
    type: 'wall',
    cast(game, caster, aim) {
      const dir = flatDir(caster, aim);
      const right = rightOf(dir);
      const c = caster.pos.clone().add(dir.clone().multiplyScalar(opts.dist ?? 12));
      c.y = 0;
      const w = opts.width ?? 12;
      const d = opts.depth ?? 9;
      const h = opts.height ?? 4.5;
      const dur = opts.duration ?? 18;
      game.spawnWall(c.clone().add(dir.clone().multiplyScalar(d / 2)), caster.yaw, w, h, dur);
      game.spawnWall(c.clone().add(right.clone().multiplyScalar(w / 2)), caster.yaw + Math.PI / 2, d, h, dur);
      game.spawnWall(c.clone().add(right.clone().multiplyScalar(-w / 2)), caster.yaw + Math.PI / 2, d, h, dur);
      if (opts.turret) {
        game.spawnTurret(c.clone().setY(0.05), caster.team, { dps: opts.turret.dps ?? 10, range: opts.turret.range ?? 30, duration: opts.turret.duration ?? dur, owner: caster });
      }
    },
  }),

  // Panic bunker: four walls boxing in the CASTER, plus a heal while holed up.
  bunkerSelf: (opts = {}) => ({
    type: 'wall',
    cast(game, caster) {
      const dir = caster.forward();
      const right = rightOf(dir);
      const half = (opts.size ?? 7) / 2;
      const len = (opts.size ?? 7) + 1;
      const h = opts.height ?? 4;
      const dur = opts.duration ?? 12;
      const c = caster.pos;
      game.spawnWall(c.clone().add(dir.clone().multiplyScalar(half)), caster.yaw, len, h, dur);
      game.spawnWall(c.clone().add(dir.clone().multiplyScalar(-half)), caster.yaw, len, h, dur);
      game.spawnWall(c.clone().add(right.clone().multiplyScalar(half)), caster.yaw + Math.PI / 2, len, h, dur);
      game.spawnWall(c.clone().add(right.clone().multiplyScalar(-half)), caster.yaw + Math.PI / 2, len, h, dur);
      if (opts.heal) game.healOverTime(caster, opts.heal, opts.healDuration ?? 4);
    },
  }),

  // --- turret family -------------------------------------------------------
  // Defensive line ult: a long wall with an attack turret dug in at each end.
  turretLine: (opts = {}) => ({
    type: 'turret',
    cast(game, caster, aim) {
      const dir = flatDir(caster, aim);
      const right = rightOf(dir);
      const c = caster.pos.clone().add(dir.clone().multiplyScalar(opts.dist ?? 10));
      c.y = 0;
      const len = opts.length ?? 18;
      game.spawnWall(c, caster.yaw, len, opts.height ?? 4, opts.wallDuration ?? 20);
      const back = dir.clone().multiplyScalar(-2);
      for (const side of [-1, 1]) {
        const p = c.clone().add(right.clone().multiplyScalar(side * (len / 2 + 1))).add(back);
        p.y = 0.05;
        game.spawnTurret(p, caster.team, { dps: opts.dps ?? 18, range: opts.range ?? 32, duration: opts.turretDuration ?? 18, owner: caster });
      }
    },
  }),

  // --- recon family --------------------------------------------------------
  // Sonar pulse centred on the CASTER. With `exposeSelf` the ping also marks
  // the caster's own position for the enemy team — intel at a price.
  reconPulse: (opts = {}) => ({
    type: 'recon',
    cast(game, caster) {
      game.reveal(caster.team, caster.pos.clone(), opts.radius ?? 16, opts.duration ?? 3);
      if (opts.exposeSelf) {
        game.reveal(exposingTeam(caster), caster.pos.clone(), opts.exposeRadius ?? 6, opts.exposeDuration ?? opts.duration ?? 3);
      }
    },
  }),

  // Sweeping beam: a chain of reveal pulses marching down the aim line, with
  // a tracer so the whole lobby sees where the beam went.
  reconSweep: (opts = {}) => ({
    type: 'recon',
    cast(game, caster, aim) {
      const dir = flatDir(caster, aim);
      let last = null;
      for (let i = 0; i < (opts.count ?? 3); i++) {
        const p = caster.pos.clone().add(dir.clone().multiplyScalar((opts.start ?? 8) + i * (opts.gap ?? 9)));
        game.reveal(caster.team, p, opts.radius ?? 9, opts.duration ?? 4);
        last = p;
      }
      if (last) game.spawnTracer(caster.eyePosition(), last.clone().setY(1.2));
    },
  }),

  // --- trap family ---------------------------------------------------------
  // Trap that also fires an immediate scouting ping where it lands, so
  // placing it doubles as a corner check.
  trapPlus: (opts = {}) => ({
    type: 'trap',
    cast(game, caster, aim) {
      const p = groundPoint(caster, aim, opts.dist ?? 8);
      game.spawnTrap(p, caster.team, { radius: opts.radius ?? 3.5, effect: opts.effect ?? 'reveal', duration: opts.duration ?? 40 });
      if (opts.scoutRadius) game.reveal(caster.team, p, opts.scoutRadius, opts.scoutDuration ?? 2);
    },
  }),

  // --- heal family ---------------------------------------------------------
  // Combat stim: heal-over-time plus a small forward lunge to re-engage.
  combatStim: (opts = {}) => ({
    type: 'heal',
    cast(game, caster) {
      game.healOverTime(caster, opts.amount ?? 40, opts.duration ?? 2.5);
      if (opts.force) caster.applyImpulse(caster.forward().multiplyScalar(opts.force), opts.up ?? 1);
    },
  }),

  // Medic ult: big self heal + covering smoke + a ward zone that slows any
  // enemy trying to storm the aid station.
  medicField: (opts = {}) => ({
    type: 'heal',
    cast(game, caster) {
      const p = caster.pos.clone();
      p.y = 0.05;
      game.healOverTime(caster, opts.heal ?? 100, opts.healDuration ?? 5);
      game.spawnSmoke(p.clone().setY(0), opts.smokeRadius ?? 6, opts.smokeDuration ?? 10);
      game.spawnZone(p, opts.wardRadius ?? 7, opts.wardDuration ?? 8, { slow: opts.wardSlow ?? 0.4, team: caster.team, owner: caster, color: 0x4ae08a });
    },
  }),
};

// Compose an ability definition from a behavior + metadata.
export function makeAbility(behaviorFactory, meta) {
  return { ...behaviorFactory(meta.opts || {}), ...meta };
}
