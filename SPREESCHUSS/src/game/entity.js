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

// ---------------------------------------------------------------- avatar
// Private helpers for buildAvatar.

function _box(parent, mat, w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  parent.add(m);
  return m;
}

// Box stretched between two points (used for posed arm segments).
function _limb(parent, mat, a, b, w, d) {
  const from = new THREE.Vector3(...a);
  const to = new THREE.Vector3(...b);
  const dir = to.clone().sub(from);
  const len = dir.length();
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, len, d), mat);
  m.position.copy(from).add(to).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  parent.add(m);
  return m;
}

// Compact rifle prop held by the avatar (local +Z = facing direction).
function _gunProp(parent, gunMat, darkMat) {
  const gun = new THREE.Group();
  _box(gun, gunMat, 0.06, 0.08, 0.36, 0, 0, 0.1);                 // receiver
  _box(gun, darkMat, 0.05, 0.06, 0.14, 0, 0.005, -0.14);          // stock
  _box(gun, darkMat, 0.045, 0.13, 0.07, 0, -0.09, 0.08, -0.25);   // magazine
  _box(gun, darkMat, 0.04, 0.09, 0.06, 0, -0.075, -0.04, 0.2);    // grip
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.22, 8), darkMat);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.01, 0.37);
  gun.add(barrel);
  _box(gun, darkMat, 0.012, 0.035, 0.012, 0, 0.06, 0.3);          // front sight
  parent.add(gun);
  return gun;
}

// Build a readable humanoid mesh for bots/other players. The group origin is
// at the FEET (game.js sets mesh.position to the entity's feet position) and
// the local +Z axis is the facing direction (game.js sets rotation.y =
// yaw + PI). Total height ~1.8 m; the head sits at ~1.47-1.73 m, matching
// the analytic head hitbox zone (top 18% of 1.85) in collision.js.
// Idle/walk animation is fully self-driven via an onBeforeRender hook —
// game.js never calls a per-frame update on the avatar.
export function buildAvatar(color) {
  const base = new THREE.Color(color);
  const g = new THREE.Group();

  const plate = new THREE.MeshStandardMaterial({ color: base, roughness: 0.45, metalness: 0.35 });
  const limbMat = new THREE.MeshStandardMaterial({ color: base.clone().multiplyScalar(0.42), roughness: 0.7, metalness: 0.15 });
  const suit = new THREE.MeshStandardMaterial({ color: 0x2c313a, roughness: 0.75, metalness: 0.1 });
  const darkGear = new THREE.MeshStandardMaterial({ color: 0x1c2026, roughness: 0.6, metalness: 0.4 });
  const gunMetal = new THREE.MeshStandardMaterial({ color: 0x454d58, roughness: 0.4, metalness: 0.8 });
  const visorMat = new THREE.MeshStandardMaterial({ color: 0x0b0e12, roughness: 0.25, metalness: 0.6, emissive: base, emissiveIntensity: 1.1 });

  // legs: pivot groups at the hips so swinging never sinks below the floor
  const mkLeg = (side) => {
    const leg = new THREE.Group();
    leg.position.set(0.11 * side, 0.78, 0);
    // boot bottom sits at 0.02 so no corner can dip below the floor mid-swing
    _box(leg, limbMat, 0.15, 0.4, 0.18, 0, -0.2, 0);              // thigh
    _box(leg, suit, 0.12, 0.34, 0.14, 0, -0.55, 0.005);           // shin
    _box(leg, darkGear, 0.13, 0.09, 0.24, 0, -0.715, 0.04);       // boot
    _box(leg, darkGear, 0.16, 0.07, 0.19, 0, -0.4, 0.01);         // knee pad
    g.add(leg);
    return leg;
  };
  const legL = mkLeg(-1);
  const legR = mkLeg(1);

  // everything above the hips bobs together while the feet stay planted
  const upper = new THREE.Group();
  g.add(upper);

  _box(upper, suit, 0.4, 0.22, 0.24, 0, 0.75, 0);                 // hips
  _box(upper, darkGear, 0.42, 0.07, 0.26, 0, 0.85, 0);            // belt
  const torso = _box(upper, suit, 0.46, 0.52, 0.26, 0, 1.14, 0);  // torso
  _box(upper, plate, 0.42, 0.32, 0.07, 0, 1.21, 0.13);            // chest plate (agent color)
  _box(upper, plate, 0.3, 0.1, 0.06, 0, 1.0, 0.12);               // ab plate
  _box(upper, plate, 0.15, 0.09, 0.21, -0.3, 1.36, 0);            // shoulder pads
  _box(upper, plate, 0.15, 0.09, 0.21, 0.3, 1.36, 0);
  // backpack (behind = -Z)
  _box(upper, darkGear, 0.32, 0.38, 0.13, 0, 1.15, -0.19);
  _box(upper, limbMat, 0.2, 0.16, 0.05, 0, 1.1, -0.27);           // pack pouch
  _box(upper, gunMetal, 0.02, 0.2, 0.02, 0.12, 1.42, -0.2);       // antenna

  // head (kept in the 1.47-1.73 band to match the analytic head hitbox)
  const head = new THREE.Group();
  head.position.y = 1.6;
  head.name = 'head';
  _box(head, suit, 0.24, 0.26, 0.25, 0, 0, 0);                    // helmet
  _box(head, darkGear, 0.26, 0.1, 0.26, 0, 0.09, -0.01);          // helmet crown
  _box(head, visorMat, 0.2, 0.07, 0.03, 0, 0.02, 0.125);          // glowing visor slit
  _box(head, darkGear, 0.16, 0.06, 0.03, 0, -0.09, 0.12);         // chin guard
  upper.add(head);

  // arms + held gun live in one "hold" group so they sway as a unit
  const hold = new THREE.Group();
  hold.position.set(0, 1.3, 0);
  upper.add(hold);
  const rel = (x, y, z) => [x, y - 1.3, z];
  // right arm: shoulder -> elbow -> rear grip
  _limb(hold, limbMat, rel(0.28, 1.33, 0.02), rel(0.27, 1.12, 0.12), 0.11, 0.12);
  _limb(hold, suit, rel(0.27, 1.12, 0.12), rel(0.12, 1.17, 0.24), 0.09, 0.09);
  _box(hold, darkGear, 0.08, 0.08, 0.08, ...rel(0.11, 1.17, 0.26));  // right glove
  // left arm: shoulder -> elbow -> foregrip
  _limb(hold, limbMat, rel(-0.28, 1.33, 0.02), rel(-0.2, 1.12, 0.18), 0.11, 0.12);
  _limb(hold, suit, rel(-0.2, 1.12, 0.18), rel(0.0, 1.2, 0.4), 0.09, 0.09);
  _box(hold, darkGear, 0.08, 0.08, 0.08, ...rel(0.01, 1.2, 0.42));   // left glove
  const gun = _gunProp(hold, gunMetal, darkGear);
  gun.position.set(0.07, -0.08, 0.22); // hold-local (~1.22 m up, in front)

  // ------------------------------------------------------------ animation
  // Self-driven: movement speed is inferred from the group's position deltas
  // (game.js moves the group every tick) inside an onBeforeRender hook.
  const anim = { lastX: 0, lastZ: 0, lastT: -1, phase: Math.random() * Math.PI * 2, idle: Math.random() * Math.PI * 2, speed: 0 };
  // hook the torso mesh — it is always rendered while the avatar is visible
  torso.onBeforeRender = () => {
    const now = performance.now() / 1000;
    if (anim.lastT < 0) { anim.lastT = now; anim.lastX = g.position.x; anim.lastZ = g.position.z; return; }
    let dt = now - anim.lastT;
    if (dt < 0.001) return; // ignore extra render passes in the same frame
    dt = Math.min(dt, 0.1);
    anim.lastT = now;
    const dx = g.position.x - anim.lastX;
    const dz = g.position.z - anim.lastZ;
    anim.lastX = g.position.x;
    anim.lastZ = g.position.z;
    const v = Math.min(Math.hypot(dx, dz) / dt, 8);
    anim.speed += (v - anim.speed) * Math.min(1, dt * 10);
    const walk = Math.min(anim.speed / 4, 1);
    anim.phase += dt * (2 + anim.speed * 2.2);

    const swing = Math.sin(anim.phase) * 0.55 * walk;
    legL.rotation.x = swing;
    legR.rotation.x = -swing;
    // torso bob + subtle idle breathing; feet never leave the floor
    upper.position.y = Math.abs(Math.cos(anim.phase)) * 0.035 * walk + Math.sin(now * 1.7 + anim.idle) * 0.008;
    upper.rotation.y = Math.sin(anim.phase) * 0.06 * walk;
    upper.rotation.z = Math.sin(anim.phase) * 0.03 * walk;
    // weapon sway: gentle idle scan + walk pump
    hold.rotation.x = Math.sin(now * 1.4 + anim.idle) * 0.03 + Math.sin(anim.phase * 2) * 0.04 * walk;
    hold.rotation.y = Math.sin(now * 0.9 + anim.idle) * 0.04;
  };

  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}
