import * as THREE from 'three';
import { moveAndCollide, raycastWorld } from './collision.js';
import { updateShooter, finishReloadIfDue, startReload } from '../weapons/weaponsystem.js';
import { RADIUS, HEIGHT, EYE } from './entity.js';

const GRAVITY = 16;

const DIFF = {
  easy:   { aimErr: 0.09, turn: 4.5, react: 0.35, speed: 4.8, fireGap: 0.12 },
  normal: { aimErr: 0.045, turn: 7, react: 0.2, speed: 5.4, fireGap: 0.06 },
  hard:   { aimErr: 0.02, turn: 11, react: 0.1, speed: 5.6, fireGap: 0.02 },
};

export function initBot(e) {
  e.bot = {
    target: null,
    moveTarget: null,
    nextThink: 0,
    seenAt: 0,
    strafe: (Math.random() < 0.5 ? 1 : -1),
    nextStrafe: 0,
    nextAbility: 2 + Math.random() * 6,
  };
}

function los(game, from, to) {
  const dir = to.clone().sub(from);
  const dist = dir.length();
  dir.normalize();
  const wall = raycastWorld(game.colliders, from, dir, dist);
  return wall >= dist - 0.5;
}

function nearestEnemy(game, e) {
  let best = null;
  let bestD = Infinity;
  for (const o of game.entities) {
    if (!o.alive) continue;
    if (o.team === e.team && e.team !== 'ffa') continue;
    if (o === e) continue;
    const d = o.pos.distanceToSquared(e.pos);
    if (d < bestD) { bestD = d; best = o; }
  }
  return best;
}

export function updateBot(game, e, dt, now) {
  if (!e.alive) return;
  if (!e.bot) initBot(e);
  const diff = DIFF[game.settings.botDifficulty] || DIFF.normal;
  const b = e.bot;

  finishReloadIfDue(e, now);
  const w = e.weapon();
  if (w.mag > 0 && (e.ammo[w.id] ?? 0) <= 0 && now >= e.reloadUntil) startReload(e, now);

  // Perception
  const enemy = nearestEnemy(game, e);
  let canSee = false;
  if (enemy) {
    const from = e.eyePosition();
    const to = enemy.eyePosition();
    canSee = los(game, from, to) && (now >= e.effects.flashUntil);
    if (canSee) { b.target = enemy; b.seenAt = now; }
  }

  // Decide move target
  if (now >= b.nextThink) {
    b.nextThink = now + 0.6 + Math.random() * 0.6;
    b.moveTarget = chooseObjective(game, e);
  }

  // Combat aim
  let aiming = false;
  if (b.target && b.target.alive && (canSee || now - b.seenAt < 0.6)) {
    aiming = true;
    const to = b.target.eyePosition();
    const from = e.eyePosition();
    const desired = to.clone().sub(from).normalize();
    const desiredYaw = Math.atan2(-desired.x, -desired.z);
    const desiredPitch = Math.asin(THREE.MathUtils.clamp(desired.y, -1, 1));
    e.yaw = angleLerp(e.yaw, desiredYaw + (Math.random() - 0.5) * diff.aimErr, Math.min(1, diff.turn * dt));
    e.pitch = THREE.MathUtils.clamp(
      angleLerp(e.pitch, desiredPitch + (Math.random() - 0.5) * diff.aimErr, Math.min(1, diff.turn * dt)),
      -1.4, 1.4,
    );
    // fire if roughly on target and in range
    const dist = from.distanceTo(to);
    const aimErr = Math.abs(shortAngle(e.yaw - desiredYaw)) + Math.abs(shortAngle(e.pitch - desiredPitch));
    const wantFire = canSee && aimErr < 0.08 && dist < (w.range || 60) && now - b.seenAt > diff.react;
    updateShooter(game, e, wantFire, now);

    // occasional ability use
    if (now >= b.nextAbility && canSee && dist < 40) {
      b.nextAbility = now + 6 + Math.random() * 8;
      tryBotAbility(game, e);
    }
  }

  // Movement
  const mt = b.moveTarget;
  const wish = new THREE.Vector3();
  if (mt) {
    const to = mt.clone().setY(0).sub(new THREE.Vector3(e.pos.x, 0, e.pos.z));
    to.y = 0;
    const d = to.length();
    if (d > 1.5) {
      to.normalize();
      wish.copy(to);
      // strafe while shooting
      if (aiming) {
        if (now >= b.nextStrafe) { b.strafe *= -1; b.nextStrafe = now + 0.6 + Math.random(); }
        const side = new THREE.Vector3(to.z, 0, -to.x).multiplyScalar(b.strafe * 0.6);
        wish.add(side).normalize();
      }
    } else if (aiming) {
      // strafe in place when at objective and fighting
      if (now >= b.nextStrafe) { b.strafe *= -1; b.nextStrafe = now + 0.5 + Math.random(); }
      wish.set(Math.sin(e.yaw + 1.57) * b.strafe, 0, Math.cos(e.yaw + 1.57) * b.strafe);
    }
  }

  let speed = diff.speed * (e.weapon().moveSpeed || 1);
  if (now < e.effects.slowUntil) speed *= (1 - e.effects.slowAmt);
  if (wish.lengthSq() > 0) wish.normalize().multiplyScalar(speed);
  e.vel.x = wish.x;
  e.vel.z = wish.z;
  e.vel.y -= GRAVITY * dt;

  // obstacle jump
  const fwd = new THREE.Vector3(wish.x, 0, wish.z).normalize();
  if (fwd.lengthSq() > 0) {
    const wallAhead = raycastWorld(game.colliders, e.eyePosition().setY(e.pos.y + 0.4), fwd, 1.2);
    if (wallAhead < 1.1 && e._onGround) e.vel.y = 5.0;
  }

  const res = moveAndCollide(game.colliders, e.pos, e.vel, dt, RADIUS, HEIGHT);
  e.pos.copy(res.pos);
  e.vel.copy(res.vel);
  e._onGround = res.onGround;

  if (now < e.effects.healUntil) e.hp = Math.min(e.maxHp, e.hp + e.effects.healRate * dt);

  // objective actions (plant/defuse)
  game.botObjective(e, dt, now);

  // face move dir if not aiming
  if (!aiming && (e.vel.x || e.vel.z)) {
    const yaw = Math.atan2(-e.vel.x, -e.vel.z);
    e.yaw = angleLerp(e.yaw, yaw, Math.min(1, 6 * dt));
  }
}

function chooseObjective(game, e) {
  return game.botMoveTarget(e);
}

function tryBotAbility(game, e) {
  const keys = ['Q', 'C', 'E'];
  const key = keys[Math.floor(Math.random() * keys.length)];
  game.castAbility(e, key);
}

function shortAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
function angleLerp(a, b, t) {
  return a + shortAngle(b - a) * t;
}
