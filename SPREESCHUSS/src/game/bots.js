import * as THREE from 'three';
import { moveAndCollide, raycastWorld } from './collision.js';
import { updateShooter, finishReloadIfDue, startReload } from '../weapons/weaponsystem.js';
import { RADIUS, HEIGHT, EYE } from './entity.js';

// Bot AI. No pathfinding / navmesh by design: maps guarantee that beelines +
// wall-sliding + jumping low cover always reach the objective (see maps.js).
// On top of that guarantee this module layers:
//   - whisker steering: 3 short raycasts angled around the move direction
//     smoothly steer around walls (and through choke doors) instead of
//     grinding along them;
//   - stuck detection: horizontal progress is sampled every 1.5 s; a stuck
//     bot commits to one lateral detour direction for ~1 s (alternating side
//     on repeat) instead of oscillating;
//   - combat memory: last-seen enemy positions are hunted briefly, and
//     taking damage from an unseen attacker turns the bot toward the most
//     likely threat;
//   - difficulty-scaled combat rhythm: burst fire with pauses, counter-strafe
//     stop on 'hard', smoothed aim error resampled per interval, reaction
//     delays, sticky closest-visible target selection;
//   - ability usage keyed by ability `type` (smoke/heal/dash/molly/flash/
//     turret/trap/...), with safe fallbacks when an agent lacks a type.

const GRAVITY = 16;
const JUMP_IMPULSE = 5.0; // apex ~0.78 m -> clears all <= 0.7 m map cover

// Whiskers are cast at chest height: jumpable low cover (<= 0.7 m by map
// design) passes under them and is handled by the auto-jump, while every
// real wall (>= 1.2 m on all 35 maps) registers and gets steered around.
const WHISKER_H = 1.0;
const WHISKER_LOOK = 2.75;  // forward whisker length
const WHISKER_SIDE = 2.3;   // side whisker length
const WHISKER_ANG = 0.55;   // side whisker angle (rad, ~31 deg)
// Lateral offsets probed when a wall blocks the way: doors on the 35 maps are
// 3.5-4.5 m wide and sit on the beeline axes, so a parallel ray shifted a few
// meters sideways finds the near opening and picks the correct slide side.
const PROBE_OFFS = [2.2, 4.4, 6.6];
// Detour angles tried (relative to the goal direction) when a bot is stuck.
const DETOUR_ANGS = [0.9, 1.5, 2.1, 2.7];

const DIFF = {
  easy: {
    speed: 4.8, turn: 4.0, react: 0.48, sticky: 2.4,
    aimErr: 0.105, errInt: 0.42, aimH: 1.0, fireGate: 0.15,
    burst: 2, burstJit: 2, pause: 0.6, counterStrafe: 0,
    huntTime: 2.0, strafeP: 0.45, abilityMin: 10, abilityRand: 10,
  },
  normal: {
    speed: 5.4, turn: 7.0, react: 0.22, sticky: 1.7,
    aimErr: 0.045, errInt: 0.26, aimH: 1.25, fireGate: 0.09,
    burst: 4, burstJit: 3, pause: 0.3, counterStrafe: 0,
    huntTime: 3.0, strafeP: 0.75, abilityMin: 8, abilityRand: 8,
  },
  hard: {
    speed: 5.6, turn: 11.5, react: 0.1, sticky: 1.2,
    aimErr: 0.016, errInt: 0.15, aimH: 1.45, fireGate: 0.05,
    burst: 7, burstJit: 4, pause: 0.16, counterStrafe: 0.18,
    huntTime: 4.0, strafeP: 1.0, abilityMin: 6, abilityRand: 6,
  },
};

const ABILITY_KEYS = ['Q', 'C', 'E'];

// Module-level scratch (bots update sequentially on one thread) so the hot
// path never allocates.
const _losO = new THREE.Vector3();
const _losD = new THREE.Vector3();
const _wOrig = new THREE.Vector3();
const _wDir = new THREE.Vector3();
const _wish = new THREE.Vector3();
const _ctx = {
  hpFrac: 1, enemyHidden: false, crossing: false, farTravel: false,
  defendingHold: false, hunting: false, free: false,
};

export function initBot(e) {
  e.bot = {
    // targeting / perception
    target: null,
    seenAt: -10,
    seenStart: -10,
    targetLockAt: -10,
    nextTargetEval: 0,
    // combat memory
    memPos: new THREE.Vector3(),
    memUntil: -10,
    lastHp: e.hp ?? 100,
    // navigation
    moveTarget: new THREE.Vector3(),
    hasMove: false,
    nextThink: 0,
    holdPoint: new THREE.Vector3(),
    holdSet: false,
    holdRefreshAt: 0,
    steer: 0,
    avoidDir: 0,
    avoidHoldUntil: 0,
    forwardClear: true,
    progPos: new THREE.Vector3(),
    progAt: 0,
    detourUntil: 0,
    detourDir: Math.random() < 0.5 ? 1 : -1,
    detourAng: DETOUR_ANGS[0],
    stuckCount: 0,
    wantHop: false,
    // combat rhythm
    strafe: Math.random() < 0.5 ? 1 : -1,
    strafing: true,
    nextStrafe: 0,
    burstCount: 0,
    burstLen: 3,
    pauseUntil: 0,
    holdMoveUntil: 0,
    errYaw: 0,
    errPitch: 0,
    nextErr: 0,
    // abilities / idle facing
    nextAbilityAt: 3 + Math.random() * 6,
    holdYaw: e.yaw ?? 0,
    nextHoldFace: 0,
    seed: Math.random(),
  };
}

export function updateBot(game, e, dt, now) {
  if (!e.alive) return;
  if (!e.bot || !e.bot.memPos) initBot(e);
  const diff = DIFF[game.settings.botDifficulty] || DIFF.normal;
  const b = e.bot;

  // ------------------------------------------------------------ weapon upkeep
  finishReloadIfDue(e, now);
  {
    const cw = e.weapon();
    if (cw.mag > 0) {
      const mag = e.ammo[cw.id] ?? 0;
      const reserve = e.reserve[cw.id] ?? 0;
      if (mag <= 0) {
        if (reserve > 0) {
          if (now >= e.reloadUntil) startReload(e, now);
        } else if (e.currentSlot === 'primary') e.currentSlot = 'sidearm';
        else if (e.currentSlot === 'sidearm') e.currentSlot = 'knife';
      } else if (mag < cw.mag * 0.35 && reserve > 0 && now - b.seenAt > 2.5 && now >= e.reloadUntil) {
        // top up when out of combat
        startReload(e, now);
      }
    }
  }
  const w = e.weapon();

  const eyeX = e.pos.x;
  const eyeY = e.pos.y + EYE;
  const eyeZ = e.pos.z;
  const flashed = now < e.effects.flashUntil;

  // ------------------------------------------------------------ damage react
  if (e.hp < b.lastHp - 0.01) {
    if (now - b.seenAt > 0.5) {
      // hit by an unseen attacker: turn toward the most likely threat
      const guess = nearestEnemyAny(game, e);
      if (guess) {
        b.memPos.set(guess.pos.x, guess.pos.y, guess.pos.z);
        b.memUntil = Math.max(b.memUntil, now + 2.5);
        b.seenStart = now; // fresh reaction delay once we spot them
      }
    }
    // taking damage warrants a prompt utility response (heal when hurt,
    // molly/flash the suspected angle) instead of the slow idle cadence
    b.nextAbilityAt = Math.min(b.nextAbilityAt, now + 0.9 + Math.random() * 0.8);
  } else if (e.hp > b.lastHp + 25) {
    b.memUntil = 0; // respawn / big heal -> stale memory is meaningless
  }
  b.lastHp = e.hp;

  // ------------------------------------------------------------ perception
  if (b.target && (!b.target.alive || (b.target.team === e.team && e.team !== 'ffa'))) b.target = null;
  let canSee = false;
  if (!flashed) {
    if (b.target) {
      canSee = losClear(game.colliders, eyeX, eyeY, eyeZ,
        b.target.pos.x, b.target.pos.y + EYE, b.target.pos.z);
    }
    if (now >= b.nextTargetEval) {
      b.nextTargetEval = now + 0.25 + Math.random() * 0.15;
      const sticky = canSee && now - b.targetLockAt < diff.sticky;
      if (!sticky) {
        const fresh = pickClosestVisible(game, e, eyeX, eyeY, eyeZ);
        if (fresh) {
          if (fresh !== b.target) {
            b.target = fresh;
            b.targetLockAt = now;
            b.seenStart = now;
            b.burstCount = 0;
          }
          canSee = true;
        }
      }
    }
    if (canSee) {
      if (now - b.seenAt > 0.6) {
        b.seenStart = now; // re-acquired after losing sight -> react again
        b.burstCount = 0;
      }
      b.seenAt = now;
      b.memPos.set(b.target.pos.x, b.target.pos.y, b.target.pos.z);
      b.memUntil = now + diff.huntTime;
    }
  }

  // ------------------------------------------------------------ objective
  if (now >= b.nextThink) {
    b.nextThink = now + 0.5 + Math.random() * 0.4;
    computeMoveTarget(game, e, b, now);
  }

  const sp = game.spike;
  const isCarrier = !!(sp && sp.carrier === e && !sp.planted);
  let hunting = false;
  let hasGoal = false;
  let goalX = 0;
  let goalZ = 0;
  if (!canSee && now < b.memUntil && !isCarrier) {
    const mdx = b.memPos.x - e.pos.x;
    const mdz = b.memPos.z - e.pos.z;
    if (mdx * mdx + mdz * mdz < 4.8) {
      b.memUntil = 0; // reached last-seen spot, nothing there
    } else {
      goalX = b.memPos.x;
      goalZ = b.memPos.z;
      hasGoal = true;
      hunting = true;
    }
  }
  if (!hasGoal && b.hasMove) {
    goalX = b.moveTarget.x;
    goalZ = b.moveTarget.z;
    hasGoal = true;
  }
  const dGoal = hasGoal ? Math.hypot(goalX - e.pos.x, goalZ - e.pos.z) : Infinity;
  const arriveR = hunting ? 2.2 : 1.9;

  // ------------------------------------------------------------ combat aim
  let aiming = false;
  let wantFire = false;
  if (!flashed && b.target && b.target.alive && (canSee || now - b.seenAt < 0.7)) {
    aiming = true;
    const t = b.target;
    const adx = t.pos.x - eyeX;
    const ady = t.pos.y + diff.aimH - eyeY;
    const adz = t.pos.z - eyeZ;
    const ad = Math.sqrt(adx * adx + ady * ady + adz * adz) || 1;
    const desiredYaw = Math.atan2(-adx, -adz);
    const desiredPitch = Math.asin(THREE.MathUtils.clamp(ady / ad, -1, 1));
    if (now >= b.nextErr) {
      // smooth, human-like error: resampled per interval, wider at range
      b.nextErr = now + diff.errInt;
      const errScale = diff.aimErr * (0.6 + Math.min(ad, 40) * 0.025);
      b.errYaw = (Math.random() - 0.5) * 2 * errScale;
      b.errPitch = (Math.random() - 0.5) * 1.2 * errScale;
    }
    e.yaw = angleLerp(e.yaw, desiredYaw + b.errYaw, Math.min(1, diff.turn * dt));
    e.pitch = THREE.MathUtils.clamp(
      angleLerp(e.pitch, desiredPitch + b.errPitch, Math.min(1, diff.turn * dt)),
      -1.4, 1.4,
    );
    const offAim = Math.abs(shortAngle(e.yaw - desiredYaw)) + Math.abs(shortAngle(e.pitch - desiredPitch));
    wantFire = canSee && ad < (w.range || 60) && offAim < diff.fireGate
      && now >= b.seenStart + diff.react && now >= b.pauseUntil;
  }
  // weaponsystem.js has an autonomous bot trigger (botWantsFire) that kicks
  // in whenever a bot passes wantFire=false. This module owns the full fire
  // decision (reaction, burst rhythm, flash respect), so hold the weapon
  // layer's pause gate whenever the decision this frame is "don't fire".
  if (!wantFire) e._botPauseUntil = now + 0.25;
  const fired = updateShooter(game, e, wantFire, now);
  if (fired) {
    if (b.burstCount === 0) {
      // opening a burst: counter-strafe stop on 'hard', plan the burst length
      if (diff.counterStrafe > 0) b.holdMoveUntil = now + diff.counterStrafe;
      b.burstLen = w.auto ? Math.max(1, Math.round(diff.burst + Math.random() * diff.burstJit)) : 1;
    }
    b.burstCount++;
    if (b.burstCount >= b.burstLen) {
      b.burstCount = 0;
      b.pauseUntil = now + diff.pause * (0.75 + Math.random() * 0.5) * (w.auto ? 1 : 0.6);
      b.nextErr = 0; // recenter aim error after every burst
    }
  }

  // ------------------------------------------------------------ abilities
  if (!flashed && now >= b.nextAbilityAt) {
    buildAbilityContext(game, e, b, now, canSee, hunting, hasGoal, dGoal, goalX, goalZ);
    tryAbility(game, e, b, diff, now);
  }

  // ------------------------------------------------------------ movement
  _wish.set(0, 0, 0);
  let moving = false;
  const inFight = aiming && canSee && b.target;
  if (inFight) {
    // fight relative to the enemy: strafe + range control
    const t = b.target;
    const edx = t.pos.x - e.pos.x;
    const edz = t.pos.z - e.pos.z;
    const ed = Math.hypot(edx, edz) || 1;
    const ex = edx / ed;
    const ez = edz / ed;
    if (now >= b.nextStrafe) {
      b.strafe = -b.strafe;
      b.strafing = Math.random() < diff.strafeP;
      b.nextStrafe = now + 0.35 + Math.random() * 0.7;
    }
    const rush = w.cat === 'melee' || w.cat === 'shotgun';
    let closeF = 0;
    if (rush) closeF = 1.1;
    else if (ed > Math.min((w.range || 60) * 0.6, 30)) closeF = 0.6;
    else if (ed < 4.5) closeF = -0.6;
    const sMag = b.strafing && !rush ? 1 : 0.2;
    _wish.set(ez * b.strafe * sMag + ex * closeF, 0, -ex * b.strafe * sMag + ez * closeF);
  } else if (hasGoal && dGoal > arriveR) {
    _wish.set((goalX - e.pos.x) / dGoal, 0, (goalZ - e.pos.z) / dGoal);
    if (now < b.detourUntil) rotateVecXZ(_wish, b.detourDir * b.detourAng);
  }
  if (_wish.lengthSq() > 1e-6) {
    _wish.normalize();
    moving = true;
    applyWhiskers(game, e, b, dt, now);
  }

  // stuck detection: sample horizontal progress every 1.5 s while traveling;
  // when stuck, commit to one lateral detour side (alternating on repeats)
  if (now >= b.progAt + 1.5) {
    const pd = Math.hypot(e.pos.x - b.progPos.x, e.pos.z - b.progPos.z);
    if (moving && !inFight && hasGoal && dGoal > 3 && pd < 0.9 && now >= b.detourUntil) {
      // widen the detour angle on repeated failures (up to walking back out)
      b.detourDir = -b.detourDir;
      b.detourAng = DETOUR_ANGS[b.stuckCount % DETOUR_ANGS.length];
      b.stuckCount++;
      b.detourUntil = now + 0.9 + Math.random() * 0.6;
      b.wantHop = true;
    } else if (pd >= 0.9) {
      b.stuckCount = 0;
    }
    b.progPos.copy(e.pos);
    b.progAt = now;
  }

  let speed = diff.speed * (w.moveSpeed || 1);
  if (now < e.effects.slowUntil) speed *= (1 - e.effects.slowAmt);
  if (now < b.holdMoveUntil) speed = 0; // counter-strafe: plant feet to shoot
  e.vel.x = _wish.x * speed;
  e.vel.z = _wish.z * speed;
  e.vel.y -= GRAVITY * dt;

  // auto-jump low cover: knee ray blocked but head-height ray clear means the
  // obstacle is jumpable; while detouring we hop regardless as a last resort
  if (moving && speed > 0 && e._onGround) {
    _wOrig.set(e.pos.x, e.pos.y + 0.35, e.pos.z);
    _wDir.set(_wish.x, 0, _wish.z);
    const dLow = raycastWorld(game.colliders, _wOrig, _wDir, 1.2);
    if (dLow < 1.05) {
      _wOrig.y = e.pos.y + 1.1;
      const dHigh = raycastWorld(game.colliders, _wOrig, _wDir, 1.35);
      if (dHigh >= 1.3 || now < b.detourUntil) e.vel.y = JUMP_IMPULSE;
    }
  }
  if (b.wantHop) {
    if (e._onGround) e.vel.y = JUMP_IMPULSE;
    b.wantHop = false;
  }

  const res = moveAndCollide(game.colliders, e.pos, e.vel, dt, RADIUS, HEIGHT);
  e.pos.copy(res.pos);
  e.vel.copy(res.vel);
  e._onGround = res.onGround;

  if (now < e.effects.healUntil) e.hp = Math.min(e.maxHp, e.hp + e.effects.healRate * dt);

  // objective actions (plant/defuse)
  game.botObjective(e, dt, now);

  // ------------------------------------------------------------ facing
  if (!aiming && !flashed) {
    if (hunting) {
      const yawTo = Math.atan2(-(b.memPos.x - e.pos.x), -(b.memPos.z - e.pos.z));
      e.yaw = angleLerp(e.yaw, yawTo, Math.min(1, diff.turn * 0.8 * dt));
      e.pitch = angleLerp(e.pitch, 0, Math.min(1, 4 * dt));
    } else if (moving) {
      e.yaw = angleLerp(e.yaw, Math.atan2(-_wish.x, -_wish.z), Math.min(1, 6 * dt));
      e.pitch = angleLerp(e.pitch, 0, Math.min(1, 4 * dt));
    } else {
      // holding: settle on an angle toward the likely approach
      if (now >= b.nextHoldFace) {
        b.nextHoldFace = now + 2.2 + b.seed * 1.5;
        const g = nearestEnemyAny(game, e);
        if (g) b.holdYaw = Math.atan2(-(g.pos.x - e.pos.x), -(g.pos.z - e.pos.z));
      }
      e.yaw = angleLerp(e.yaw, b.holdYaw, Math.min(1, 3.5 * dt));
      e.pitch = angleLerp(e.pitch, 0, Math.min(1, 3 * dt));
    }
  }
}

// ---------------------------------------------------------------- navigation

// Shape the raw game.botMoveTarget() output into team play: attackers group
// on the carrier's site, defenders hold stable angles near their site and
// everyone rotates onto the spike post-plant. Ring offsets keyed by a per-bot
// seed spread the squad instead of stacking it on one point.
function computeMoveTarget(game, e, b, now) {
  const base = game.botMoveTarget(e);
  if (!base) {
    b.hasMove = false;
    return;
  }
  b.moveTarget.copy(base);
  b.hasMove = true;
  const mode = game.mode;
  if (!mode || mode.kind !== 'plant') return;
  const sp = game.spike;
  if (!sp) return;

  if (e.team === 'att') {
    if (!sp.planted) {
      const carrier = sp.carrier;
      if (carrier && carrier !== e && carrier.alive) {
        if (carrier.isBot) {
          const ct = game.botMoveTarget(carrier); // the carrier's site
          if (ct) b.moveTarget.copy(ct);
        } else {
          // human carrier: escort their actual position
          b.moveTarget.set(carrier.pos.x, 0, carrier.pos.z);
        }
        ringOffset(b.moveTarget, b.seed, 2.2 + b.seed * 3.2);
      }
      // the carrier itself beelines to the site center to plant
    } else if (b.seed > 0.3) {
      // post-plant: most attackers guard angles around the spike
      ringOffset(b.moveTarget, b.seed, 2.5 + b.seed * 3.5);
    }
  } else if (e.team === 'def') {
    if (sp.planted) {
      // retake: ~half commit straight onto the spike to defuse, rest cover
      if (b.seed > 0.55) ringOffset(b.moveTarget, b.seed, 2.5 + b.seed * 2.5);
    } else {
      // hold a stable point near the site instead of rerolling every think
      if (!b.holdSet || now >= b.holdRefreshAt) {
        b.holdPoint.copy(b.moveTarget);
        ringOffset(b.holdPoint, b.seed, 1.5 + b.seed * 2.0);
        b.holdRefreshAt = now + 8 + b.seed * 6;
        b.holdSet = true;
      }
      b.moveTarget.copy(b.holdPoint);
    }
  }
}

function ringOffset(v, seed, r) {
  const a = seed * Math.PI * 2 * 3.7;
  v.x += Math.cos(a) * r;
  v.z += Math.sin(a) * r;
}

// Whisker steering: forward + two angled rays at chest height. A blocked
// forward ray commits to the clearer side until the way opens (prevents
// left/right oscillation in choke doors); near-miss side rays add a gentle
// repulsion so bots stop scraping along walls.
function applyWhiskers(game, e, b, dt, now) {
  const dx = _wish.x;
  const dz = _wish.z;
  const y = e.pos.y + WHISKER_H;
  const cols = game.colliders;
  const df = castWhisker(cols, e.pos.x, y, e.pos.z, dx, dz, 0, WHISKER_LOOK);
  const dl = castWhisker(cols, e.pos.x, y, e.pos.z, dx, dz, WHISKER_ANG, WHISKER_SIDE);
  const dr = castWhisker(cols, e.pos.x, y, e.pos.z, dx, dz, -WHISKER_ANG, WHISKER_SIDE);
  b.forwardClear = df >= WHISKER_LOOK;
  let steer = 0;
  if (df < WHISKER_LOOK) {
    if (b.avoidDir === 0) b.avoidDir = pickAvoidSide(cols, e, b, dx, dz, y, dl, dr);
    steer = b.avoidDir * (0.55 + 1.45 * (1 - df / WHISKER_LOOK));
    b.avoidHoldUntil = now + 0.4;
  } else {
    if (now >= b.avoidHoldUntil) b.avoidDir = 0;
    const near = WHISKER_SIDE * 0.6;
    if (dl < near) steer -= 0.85 * (1 - dl / near);
    if (dr < near) steer += 0.85 * (1 - dr / near);
  }
  b.steer += (steer - b.steer) * Math.min(1, 12 * dt);
  if (Math.abs(b.steer) > 0.01) {
    rotateVecXZ(_wish, THREE.MathUtils.clamp(b.steer, -2.0, 2.0));
  }
}

// Decide which way to slide along a blocking wall. Parallel rays shifted
// sideways at increasing offsets look for the nearest opening (choke doors /
// connector gaps sit on the beeline axes by map design); if neither side
// shows an opening, fall back to whisker clearance, then to the strafe bias.
function pickAvoidSide(colliders, e, b, dx, dz, y, dl, dr) {
  const px = -dz; // lateral (+1 side) unit vector, matches +angle rotation
  const pz = dx;
  const probeLen = WHISKER_LOOK + 2.5;
  for (let i = 0; i < PROBE_OFFS.length; i++) {
    const off = PROBE_OFFS[i];
    _wOrig.set(e.pos.x + px * off, y, e.pos.z + pz * off);
    _wDir.set(dx, 0, dz);
    const dPlus = raycastWorld(colliders, _wOrig, _wDir, probeLen);
    _wOrig.set(e.pos.x - px * off, y, e.pos.z - pz * off);
    const dMinus = raycastWorld(colliders, _wOrig, _wDir, probeLen);
    const plusOpen = dPlus >= probeLen - 0.01;
    const minusOpen = dMinus >= probeLen - 0.01;
    if (plusOpen && !minusOpen) return 1;
    if (minusOpen && !plusOpen) return -1;
    if (plusOpen && minusOpen) break; // both open this close: no preference
  }
  if (dl > dr + 0.2) return 1;
  if (dr > dl + 0.2) return -1;
  return b.strafe >= 0 ? 1 : -1;
}

function castWhisker(colliders, x, y, z, dx, dz, ang, maxDist) {
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  _wDir.set(dx * c - dz * s, 0, dx * s + dz * c);
  _wOrig.set(x, y, z);
  return raycastWorld(colliders, _wOrig, _wDir, maxDist);
}

function rotateVecXZ(v, a) {
  const c = Math.cos(a);
  const s = Math.sin(a);
  const x = v.x * c - v.z * s;
  v.z = v.x * s + v.z * c;
  v.x = x;
}

// ---------------------------------------------------------------- perception

function losClear(colliders, fx, fy, fz, tx, ty, tz) {
  _losD.set(tx - fx, ty - fy, tz - fz);
  const dist = _losD.length();
  if (dist < 0.001) return true;
  _losD.multiplyScalar(1 / dist);
  _losO.set(fx, fy, fz);
  return raycastWorld(colliders, _losO, _losD, dist) >= dist - 0.1;
}

function pickClosestVisible(game, e, ex, ey, ez) {
  let best = null;
  let bestD = Infinity;
  const ents = game.entities;
  for (let i = 0; i < ents.length; i++) {
    const o = ents[i];
    if (o === e || !o.alive) continue;
    if (o.team === e.team && e.team !== 'ffa') continue;
    const dx = o.pos.x - ex;
    const dz = o.pos.z - ez;
    const d = dx * dx + dz * dz;
    if (d >= bestD || d > 12100) continue; // 110 m cap
    if (losClear(game.colliders, ex, ey, ez, o.pos.x, o.pos.y + EYE, o.pos.z)) {
      bestD = d;
      best = o;
    }
  }
  return best;
}

function nearestEnemyAny(game, e) {
  let best = null;
  let bestD = Infinity;
  const ents = game.entities;
  for (let i = 0; i < ents.length; i++) {
    const o = ents[i];
    if (o === e || !o.alive) continue;
    if (o.team === e.team && e.team !== 'ffa') continue;
    const d = o.pos.distanceToSquared(e.pos);
    if (d < bestD) {
      bestD = d;
      best = o;
    }
  }
  return best;
}

// ---------------------------------------------------------------- abilities

function buildAbilityContext(game, e, b, now, canSee, hunting, hasGoal, dGoal, goalX, goalZ) {
  const mode = game.mode;
  const isPlant = !!(mode && mode.kind === 'plant');
  const planted = !!(game.spike && game.spike.planted);
  const facingGoal = hasGoal && dGoal > 0.5
    && Math.abs(shortAngle(e.yaw - Math.atan2(-(goalX - e.pos.x), -(goalZ - e.pos.z)))) < 0.55;
  const memFresh = now < b.memUntil;
  const memD = memFresh ? Math.hypot(b.memPos.x - e.pos.x, b.memPos.z - e.pos.z) : Infinity;
  const facingMem = memFresh
    && Math.abs(shortAngle(e.yaw - Math.atan2(-(b.memPos.x - e.pos.x), -(b.memPos.z - e.pos.z)))) < 0.6;

  _ctx.hpFrac = e.hp / (e.maxHp || 100);
  _ctx.enemyHidden = memFresh && !canSee && memD > 4 && memD < 20 && facingMem;
  _ctx.crossing = !canSee && !hunting && hasGoal && dGoal > 14 && b.forwardClear && facingGoal
    && !(isPlant && e.team === 'def' && !planted);
  _ctx.farTravel = !canSee && hasGoal && dGoal > 24 && facingGoal && !!e._onGround;
  _ctx.defendingHold = isPlant && !canSee && hasGoal && dGoal < 8
    && ((e.team === 'def' && !planted) || (e.team === 'att' && planted));
  _ctx.hunting = hunting;
  _ctx.free = !!((mode && mode.freeAbilities) || game.settings.noCooldown);
}

function tryAbility(game, e, b, diff, now) {
  const abilities = e.agent ? e.agent.abilities : null;
  if (!abilities) {
    b.nextAbilityAt = now + 60;
    return;
  }
  let bestKey = null;
  let bestScore = 34; // minimum situational score to bother casting
  for (let i = 0; i < ABILITY_KEYS.length; i++) {
    const key = ABILITY_KEYS[i];
    const ab = abilities[key];
    if (!ab || ab.ult) continue;
    const st = e.abilityState ? e.abilityState[key] : null;
    if (st) {
      if (now < (st.cdUntil || 0)) continue;
      if (!_ctx.free && (st.charges ?? 0) <= 0) continue;
    }
    const s = scoreAbility(ab.type);
    if (s > bestScore) {
      bestScore = s;
      bestKey = key;
    }
  }
  if (bestKey && game.castAbility(e, bestKey)) {
    b.nextAbilityAt = now + diff.abilityMin + Math.random() * diff.abilityRand;
  } else {
    b.nextAbilityAt = now + 1.5 + Math.random();
  }
}

// Situational value of an ability by its `type`. Unknown or missing types
// score 0 and are simply never cast (safe fallback).
function scoreAbility(type) {
  const c = _ctx;
  switch (type) {
    case 'heal': return c.hpFrac < 0.5 ? 100 : 0;
    case 'turret': return c.defendingHold ? 84 : 0;
    case 'trap': return c.defendingHold ? 78 : 0;
    case 'molly': return c.enemyHidden ? 76 : 0;
    case 'flash': return c.enemyHidden ? 66 : 0;
    case 'slow': return c.enemyHidden ? 62 : (c.defendingHold ? 36 : 0);
    case 'smoke': return c.crossing ? 60 : 0;
    case 'wall': return c.crossing ? 48 : (c.defendingHold ? 44 : 0);
    case 'dash': return c.farTravel ? 46 : 0;
    case 'recon': return (c.crossing || c.hunting) ? 42 : 0;
    default: return 0;
  }
}

// ---------------------------------------------------------------- math

function shortAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function angleLerp(a, b, t) {
  return a + shortAngle(b - a) * t;
}
