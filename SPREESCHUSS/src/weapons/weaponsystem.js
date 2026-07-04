import * as THREE from 'three';
import { raycastWorld, rayEntity } from '../game/collision.js';
import { audio } from '../audio/audio.js';
import { weaponById } from './weapons.js';

const _tmpDir = new THREE.Vector3();

// Handle a shooter's fire intent this frame. Returns true if a shot fired.
export function updateShooter(game, e, wantFire, now) {
  const w = e.weapon();
  if (!e.alive) return false;
  if (now < e.reloadUntil) return false;
  const ammo = e.ammo[w.id] ?? (w.mag || 0);
  if (wantFire) {
    if (now < e.nextFire) return false;
    if (w.mag > 0 && ammo <= 0) {
      startReload(e, now);
      return false;
    }
    e.nextFire = now + 1 / w.fireRate;
    if (w.mag > 0 && !game.settings.infiniteAmmo) e.ammo[w.id] = ammo - 1;
    discharge(game, e, w);
    // recoil for local player
    if (e.isPlayer) {
      game.addRecoil(w.recoil * 0.006, (Math.random() - 0.5) * w.recoil * 0.004);
    }
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

function discharge(game, e, w) {
  const origin = e.eyePosition();
  const baseDir = e.aimDir();
  const moving = e.vel.lengthSq() > 1;
  const pellets = w.pellets || 1;
  const spreadRad = (w.spread || 0) * (Math.PI / 180) * (moving && e.isPlayer ? 2.2 : 1) * (e.effects && game.now < e.effects.slowUntil ? 1.5 : 1);

  audio.shoot(w.cat);
  if (e.isPlayer) game.muzzleFlash();

  for (let i = 0; i < pellets; i++) {
    const dir = baseDir.clone();
    if (spreadRad > 0) {
      dir.x += (Math.random() - 0.5) * spreadRad;
      dir.y += (Math.random() - 0.5) * spreadRad;
      dir.z += (Math.random() - 0.5) * spreadRad;
      dir.normalize();
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
