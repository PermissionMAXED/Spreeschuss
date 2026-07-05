import * as THREE from 'three';
import { raycastWorld, rayEntity } from '../game/collision.js';
import { audio } from '../audio/audio.js';
import { weaponById } from './weapons.js';

// ---------------------------------------------------------------------------
// Gunfeel layer: deterministic spray patterns + a speed-proportional accuracy
// model, shared by the player and bots.
//
//  * Every weapon carries a seeded `pattern` (weapons.js): per-shot aim
//    offsets indexed by consecutive-shot count. The count resets after a
//    short firing pause, restoring first-shot accuracy.
//  * The PLAYER gets the full pattern applied to the bullet path and a
//    matching camera punch via game.addRecoil — pulling the mouse down
//    (lowering e.pitch) cancels the climb exactly like CS/Valorant.
//  * BOTS aim straight at their target, so the pattern is applied as an aim
//    perturbation scaled by how well their difficulty tier "compensates".
// ---------------------------------------------------------------------------

const DEG = Math.PI / 180;
const RUN_SPEED = 5.6; // player.js RUN — movement spread scales off this

// How much of the spray pattern a bot pulls down (a practiced human ≈ 1.0).
const BOT_COMPENSATION = { easy: 0.6, normal: 0.8, hard: 0.92 };
// Bots time their shots between strafe direction changes, so their movement
// spread penalty is reduced (a full penalty would blind them while strafing).
const BOT_MOVE_SPREAD = 0.45;

const _tmpDir = new THREE.Vector3();
const _botDir = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const WORLD_UP = new THREE.Vector3(0, 1, 0);

// --- Bot trigger --------------------------------------------------------
// bots.js gates its `wantFire` on `now - b.seenAt > react`, but it also
// refreshes `b.seenAt = now` on every frame the enemy is visible, so that
// expression is permanently `0 > react` and bots aim without ever firing.
// bots.js is outside this layer, so the intended gate is reconstructed here:
// target sighted continuously for a reaction time, aim settled on target,
// and target in weapon range with clear line of sight.
const BOT_REACT = { easy: 0.35, normal: 0.2, hard: 0.1 };    // mirrors bots.js DIFF.react
const BOT_FIRE_GAP = { easy: 0.12, normal: 0.06, hard: 0.02 }; // mirrors bots.js DIFF.fireGap
const BOT_BURST = 9;         // full-auto rounds before a bot eases off the trigger
const BOT_BURST_PAUSE = 0.42; // seconds — long enough for the spray pattern to reset

function botWantsFire(game, e, w, now) {
  const b = e.bot;
  if (!b || !b.target || !b.target.alive) return false;
  if (now < (e._botPauseUntil || 0)) return false; // easing off between bursts
  const from = e.eyePosition();
  _botDir.copy(b.target.eyePosition()).sub(from);
  const dist = _botDir.length();
  if (dist < 1e-4 || dist > (w.range || 60)) { e._botSeenSince = -1; return false; }
  _botDir.multiplyScalar(1 / dist);
  if (raycastWorld(game.colliders, from, _botDir, dist) < dist - 0.1) {
    e._botSeenSince = -1; // sight broken → reaction timer restarts
    return false;
  }
  if (!(e._botSeenSince >= 0) || e._botTargetId !== b.target.id) {
    e._botSeenSince = now;
    e._botTargetId = b.target.id;
  }
  if (now - e._botSeenSince < (BOT_REACT[game.settings?.botDifficulty] ?? BOT_REACT.normal)) return false;
  // fire only once the aim has converged onto the target (bots.js turn-lerp)
  const dot = THREE.MathUtils.clamp(e.aimDir().dot(_botDir), -1, 1);
  return Math.acos(dot) < 0.08;
}

// Handle a shooter's fire intent this frame. Returns true if a shot fired.
export function updateShooter(game, e, wantFire, now) {
  const w = e.weapon();
  if (!e.alive) return false;
  if (now < e.reloadUntil) return false;
  const ammo = e.ammo[w.id] ?? (w.mag || 0);
  if (!wantFire && e.isBot && e.bot) wantFire = botWantsFire(game, e, w, now);
  if (wantFire) {
    if (now < e.nextFire) return false;
    if (w.mag > 0 && ammo <= 0) {
      startReload(e, now);
      return false;
    }
    e.nextFire = now + 1 / w.fireRate;
    if (w.mag > 0 && !game.settings.infiniteAmmo) e.ammo[w.id] = ammo - 1;
    // consecutive-shot tracking: pattern index resets after `recovery`
    // seconds without firing (or on weapon switch)
    const recovery = w.recovery ?? (1 / w.fireRate + 0.25);
    let spray = e._spray;
    if (!spray || spray.wid !== w.id || now > spray.resetAt) {
      spray = { wid: w.id, idx: 0, resetAt: 0 };
      e._spray = spray;
    }
    const shotIdx = spray.idx;
    spray.idx++;
    spray.resetAt = now + recovery;
    // bots dump controlled bursts instead of emptying the magazine blindly;
    // the pause exceeds `recovery`, so each burst restarts the pattern
    if (e.isBot && w.auto && spray.idx >= BOT_BURST) {
      e._botPauseUntil = now + BOT_BURST_PAUSE + Math.random() * 0.15;
    }
    // semi-auto trigger discipline: bots can't click faster than their tier
    if (e.isBot && !w.auto) {
      e.nextFire += BOT_FIRE_GAP[game.settings?.botDifficulty] ?? BOT_FIRE_GAP.normal;
    }
    discharge(game, e, w, shotIdx);
    return true;
  }
  return false;
}

export function startReload(e, now) {
  const w = e.weapon();
  if (w.mag <= 0) return;
  if (e._reloadWeapon && now < e.reloadUntil) return; // already reloading
  const reserve = e.reserve[w.id] ?? 0;
  if (e.ammo[w.id] >= w.mag) return;
  if (reserve <= 0) return;
  e.reloadUntil = now + 2.0;
  e._reloadWeapon = w.id;
  if (e.isPlayer) audio.reload();
}

export function finishReloadIfDue(e, now) {
  if (e._reloadWeapon && now >= e.reloadUntil) {
    // Look up the weapon that was actually being reloaded (player may have
    // switched slots mid-reload) so its magazine is correctly refilled.
    const id = e._reloadWeapon;
    const w = weaponById(id);
    if (w.mag > 0) {
      const need = w.mag - (e.ammo[id] ?? 0);
      const take = Math.min(need, e.reserve[id] ?? 0);
      e.ammo[id] = (e.ammo[id] ?? 0) + take;
      e.reserve[id] = (e.reserve[id] ?? 0) - take;
    }
    e._reloadWeapon = null;
  }
}

// Pattern point for shot `idx` (holds the last point for very long sprays).
function patternOffset(w, idx) {
  const pat = w.pattern;
  if (!pat || !pat.length) return null;
  return pat[Math.min(idx, pat.length - 1)];
}

// Per-shot camera punch = the pattern's shot-to-shot delta, so what the
// camera does matches where the next bullet actually goes.
function patternKick(w, idx) {
  const pat = w.pattern;
  if (!pat || !pat.length) return { p: 0, y: 0 };
  const i = Math.min(idx, pat.length - 1);
  const prev = i > 0 ? pat[i - 1] : { p: 0, y: 0 };
  return { p: pat[i].p - prev.p, y: pat[i].y - prev.y };
}

// Effective cone half-angle in degrees for this shot.
//  base * firstShot|bloom  →  ×scopedMult when scoped  →  + movement/air adds
function effectiveSpreadDeg(game, e, w, shotIdx) {
  let s = w.spread || 0;
  if (shotIdx === 0) s *= w.firstShot ?? 1; // rested first shot flies true
  else if (w.bloom) s *= Math.max(0.5, 1 + Math.min(shotIdx, 14) * w.bloom);

  const hspeed = Math.hypot(e.vel.x, e.vel.z);
  if (w.scoped) {
    // player: laser while actually scoped; bot snipers: laser once settled
    const scopedNow = e.isPlayer ? !!game.scopeActive : hspeed < 0.5;
    if (scopedNow) s *= w.scopedMult ?? 0.05;
  }

  // movement penalty proportional to actual speed: running is punished,
  // shift-walking is half, crouch-still is free
  const botFactor = e.isBot ? BOT_MOVE_SPREAD : 1;
  s += (hspeed / RUN_SPEED) * (w.moveSpread ?? 0) * botFactor;
  if (e._onGround === false) s += (w.jumpSpread ?? 0) * botFactor; // airborne

  if (e.effects && game.now < e.effects.slowUntil) s *= 1.5; // concuss debuff
  return s;
}

// Shaped shotgun cloud: 1 center pellet, an inner ring at 45% radius and an
// outer ring at full radius. The whole cloud gets a random rotation per shot
// plus small per-pellet jitter — consistent coverage, no dice-roll gaps.
function pelletOffset(i, n, spreadRad) {
  if (i === 0) return { y: 0, p: 0 };
  const inner = Math.max(1, Math.round((n - 1) * 0.4));
  const onInner = i <= inner;
  const ringCount = onInner ? inner : n - 1 - inner;
  const ringIdx = onInner ? i - 1 : i - 1 - inner;
  const radius = spreadRad * (onInner ? 0.45 : 1.0) * (0.88 + Math.random() * 0.24);
  const ang = (ringIdx / ringCount) * Math.PI * 2 + (onInner ? 0 : Math.PI / ringCount) + (Math.random() - 0.5) * 0.3;
  return { y: Math.cos(ang) * radius, p: Math.sin(ang) * radius };
}

function discharge(game, e, w, shotIdx) {
  const origin = e.eyePosition();
  const baseDir = e.aimDir();
  const pellets = w.pellets || 1;
  const spreadRad = effectiveSpreadDeg(game, e, w, shotIdx) * DEG;

  // camera-space basis for applying yaw/pitch offsets to the bullet path
  _right.crossVectors(baseDir, WORLD_UP);
  if (_right.lengthSq() < 1e-6) _right.set(1, 0, 0);
  _right.normalize();
  _up.crossVectors(_right, baseDir).normalize();

  // recoil pattern → aim perturbation. The player eats the full offset (and
  // cancels it by pulling down); bots compensate most of it by difficulty.
  // Bots pull DOWN (pitch) better than they track lateral drift — they aim at
  // eye height, so uncompensated climb would sail over the head.
  let patY = 0;
  let patP = 0;
  const pat = patternOffset(w, shotIdx);
  if (pat) {
    const comp = e.isPlayer ? 0 : (BOT_COMPENSATION[game.settings?.botDifficulty] ?? BOT_COMPENSATION.normal);
    patY = pat.y * (1 - comp);
    patP = pat.p * (1 - comp) * (e.isBot ? 0.5 : 1);
  }

  audio.shoot(w.cat);
  if (e.isPlayer) {
    game.muzzleFlash();
    // camera punch: base per-weapon thump + this shot's pattern delta
    const kick = patternKick(w, shotIdx);
    game.addRecoil(
      w.recoil * 0.008 + kick.p * 1.4,
      kick.y * 1.2 + (Math.random() - 0.5) * w.recoil * 0.003,
    );
  }

  // per-shot rotation of the shotgun ring cloud
  const cloudRot = Math.random() * Math.PI * 2;
  const cosR = Math.cos(cloudRot);
  const sinR = Math.sin(cloudRot);

  for (let i = 0; i < pellets; i++) {
    let offY = patY;
    let offP = patP;
    if (pellets > 1) {
      const p = pelletOffset(i, pellets, spreadRad);
      offY += p.y * cosR - p.p * sinR;
      offP += p.y * sinR + p.p * cosR;
    } else if (spreadRad > 0) {
      // uniform disc sample, biased slightly toward the center
      const a = Math.random() * Math.PI * 2;
      const r = spreadRad * Math.pow(Math.random(), 0.75);
      offY += Math.cos(a) * r;
      offP += Math.sin(a) * r;
    }
    const dir = _tmpDir.copy(baseDir);
    if (offY !== 0 || offP !== 0) {
      dir.addScaledVector(_right, offY).addScaledVector(_up, offP).normalize();
    }
    const wallDist = raycastWorld(game.colliders, origin, dir, w.range);
    let hitEntity = null;
    let hitInfo = null;
    let best = Math.min(wallDist, w.range);
    for (const other of game.entities) {
      if (other === e || !other.alive) continue;
      if (game.mode.friendlyFire === false && other.team === e.team && e.team !== 'ffa') continue;
      if (other.team === e.team && e.team !== 'ffa') continue;
      const hit = rayEntity(origin, dir, other.pos, 0.45, 1.85);
      if (hit && hit.t < best) {
        best = hit.t;
        hitEntity = other;
        hitInfo = hit;
      }
    }
    // tracer
    const end = origin.clone().add(dir.clone().multiplyScalar(best));
    game.spawnTracer(origin, end);

    // shot ended on world geometry -> impact sparks + bullet-hole decal (visual only)
    if (!hitEntity && wallDist < w.range && w.cat !== 'melee' && game.fx) {
      game.fx.wallImpact(origin, dir, wallDist);
    }

    if (hitEntity) {
      let dmg = w.damage;
      // falloff
      if (w.falloff && best > w.falloff) {
        dmg *= Math.max(0.5, 1 - (best - w.falloff) / (w.range - w.falloff));
      }
      if (hitInfo.part === 'head') dmg *= w.headMult || 1;
      else if (hitInfo.part === 'leg') dmg *= w.legMult || 1;
      if (game.settings.oneShot) dmg = 1000;
      const applied = hitEntity.takeDamage(dmg, hitInfo.part);
      game.onDamage(e, hitEntity, applied, hitInfo.part, hitInfo.point);
    }
  }
}
