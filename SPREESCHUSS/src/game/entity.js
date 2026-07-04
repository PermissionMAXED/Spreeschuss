import * as THREE from 'three';
import { weaponById } from '../weapons/weapons.js';

export const EYE = 1.6;
export const HEIGHT = 1.8;
export const RADIUS = 0.4;

let NEXT_ID = 1;

export class Entity {
  constructor(opts) {
    this.id = NEXT_ID++;
    this.name = opts.name || `Bot ${this.id}`;
    this.team = opts.team; // 'att' | 'def' | 'ffa'
    this.isPlayer = !!opts.isPlayer;
    this.isBot = !opts.isPlayer;
    this.agent = opts.agent;
    this.color = new THREE.Color(opts.agent?.color || (opts.team === 'att' ? '#e0433a' : '#3a7ae0'));

    this.pos = new THREE.Vector3(0, 0, 0);
    this.vel = new THREE.Vector3(0, 0, 0);
    this.yaw = 0;
    this.pitch = 0;

    this.maxHp = 100;
    this.hp = 100;
    this.armor = 0;
    this.alive = true;
    this.invulnerable = false;

    this.credits = 800;
    this.inventory = { primary: null, sidearm: 'classic', knife: 'knife', armor: 0 };
    this.currentSlot = 'sidearm';
    this.ammo = {};
    this.reserve = {};
    this.reloadUntil = 0;
    this.nextFire = 0;

    this.kills = 0;
    this.deaths = 0;
    this.assists = 0;

    this.ultPoints = 0;
    this.abilityState = {};
    if (this.agent) {
      for (const key of ['C', 'Q', 'E', 'X']) {
        const ab = this.agent.abilities[key];
        this.abilityState[key] = { charges: ab.charges ?? (ab.ult ? 0 : 1), cdUntil: 0 };
      }
    }

    this.effects = { flashUntil: 0, flashIntensity: 0, slowUntil: 0, slowAmt: 0, healUntil: 0, healRate: 0, revealedUntil: 0 };
    this.mesh = null;
    this.spawnPos = new THREE.Vector3();
  }

  eyePosition() {
    return new THREE.Vector3(this.pos.x, this.pos.y + EYE, this.pos.z);
  }

  forward() {
    return new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw)).normalize().multiplyScalar(-1);
  }

  aimDir() {
    const cp = Math.cos(this.pitch);
    return new THREE.Vector3(
      -Math.sin(this.yaw) * cp,
      Math.sin(this.pitch),
      -Math.cos(this.yaw) * cp,
    ).normalize();
  }

  weapon() {
    return weaponById(this.inventory[this.currentSlot] || 'classic');
  }

  applyImpulse(horiz, up = 0) {
    this.vel.x += horiz.x;
    this.vel.z += horiz.z;
    if (up) this.vel.y = Math.max(this.vel.y, up);
  }

  giveWeapon(id) {
    const w = weaponById(id);
    if (w.cat === 'sidearm') { this.inventory.sidearm = id; this.currentSlot = 'primary' in this.inventory && this.inventory.primary ? this.currentSlot : 'sidearm'; }
    else if (w.cat === 'melee') { /* always have knife */ }
    else { this.inventory.primary = id; this.currentSlot = 'primary'; }
    this.ammo[id] = w.mag;
    this.reserve[id] = w.reserve;
  }

  resetForRound(keepLoadout = true) {
    this.hp = this.maxHp;
    this.armor = this.inventory.armor || 0;
    this.alive = true;
    this.vel.set(0, 0, 0);
    this.reloadUntil = 0;
    this.effects.flashUntil = 0;
    this.effects.slowUntil = 0;
    this.effects.healUntil = 0;
    this.effects.revealedUntil = 0;
    if (!keepLoadout) {
      this.inventory = { primary: null, sidearm: 'classic', knife: 'knife', armor: 0 };
    }
    // refill ammo
    for (const id of [this.inventory.primary, this.inventory.sidearm]) {
      if (!id) continue;
      const w = weaponById(id);
      this.ammo[id] = w.mag;
      this.reserve[id] = w.reserve;
    }
    this.currentSlot = this.inventory.primary ? 'primary' : 'sidearm';
    // reset ability charges/cooldowns
    if (this.agent) {
      for (const key of ['C', 'Q', 'E', 'X']) {
        const ab = this.agent.abilities[key];
        if (ab.ult) continue; // ult persists across rounds
        this.abilityState[key] = { charges: ab.charges ?? 1, cdUntil: 0 };
      }
    }
  }

  takeDamage(amount, part = 'body') {
    if (!this.alive) return 0;
    if (this.invulnerable) return 0;
    let dmg = amount;
    if (this.armor > 0) {
      const absorbed = Math.min(this.armor, dmg * 0.5);
      this.armor -= absorbed;
      dmg -= absorbed;
    }
    this.hp -= dmg;
    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
    }
    return dmg;
  }
}

// Build a simple humanoid mesh for bots/other players.
export function buildAvatar(color) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.1 });
  const dark = new THREE.MeshStandardMaterial({ color: new THREE.Color(color).multiplyScalar(0.6), roughness: 0.7 });

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.7, 0.28), mat);
  torso.position.y = 1.05;
  g.add(torso);
  const hips = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.3, 0.26), dark);
  hips.position.y = 0.6;
  g.add(hips);
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.7, 0.2), dark);
  legL.position.set(-0.12, 0.35, 0);
  g.add(legL);
  const legR = legL.clone();
  legR.position.x = 0.12;
  g.add(legR);
  const armL = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.6, 0.16), mat);
  armL.position.set(-0.34, 1.1, 0);
  g.add(armL);
  const armR = armL.clone();
  armR.position.x = 0.34;
  g.add(armR);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.28, 0.26), mat);
  head.position.y = 1.6;
  head.name = 'head';
  g.add(head);
  // visor
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.08, 0.02), new THREE.MeshBasicMaterial({ color: 0x111111 }));
  visor.position.set(0, 1.62, 0.14);
  g.add(visor);

  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}
