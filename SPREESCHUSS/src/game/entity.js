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
// Every playable agent gets a unique procedural model (AGENT_DECOR below),
// all built on one shared core rig so the gameplay contract is identical for
// every skin:
//   - group origin at the FEET, local +Z is the facing direction
//     (game.js sets mesh.position = feet pos, rotation.y = yaw + PI)
//   - total height ~1.8 m, body silhouette within ~0.45 m of the origin axis
//   - the visible head/helmet lives in the ~1.50-1.75 m band, matching the
//     analytic head hitbox in collision.js (hits above 0.82 x 1.85 m)
//   - animation is fully self-driven via an onBeforeRender hook on the torso
//     mesh (game.js never calls per-frame avatar updates); walk speed is
//     inferred from position deltas and feet never clip the floor mid-swing.

function _box(parent, mat, w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  parent.add(m);
  return m;
}

function _cyl(parent, mat, rt, rb, h, x, y, z, rx = 0, ry = 0, rz = 0, seg = 10) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  parent.add(m);
  return m;
}

function _sph(parent, mat, r, x, y, z, seg = 10) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, seg, Math.max(6, seg - 2)), mat);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}

function _cone(parent, mat, r, h, x, y, z, rx = 0, ry = 0, rz = 0, seg = 8) {
  const m = new THREE.Mesh(new THREE.ConeGeometry(r, h, seg), mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  parent.add(m);
  return m;
}

function _tor(parent, mat, r, tube, x, y, z, rx = 0, ry = 0, rz = 0, arc = Math.PI * 2) {
  const m = new THREE.Mesh(new THREE.TorusGeometry(r, tube, 6, 18, arc), mat);
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

// ---------------------------------------------------------------- materials
// Small shared material sets. Agent colors never change after construction
// (_swapSides only reassigns e.color, never recolors built meshes), so sets
// are cached per color hex and shared by every mesh of that agent's avatar.
// Idle animations only mutate transforms, never cached materials.
const _MAT_CACHE = new Map();
let _NEUTRAL = null;

function _neutralMats() {
  if (_NEUTRAL) return _NEUTRAL;
  _NEUTRAL = {
    suit: new THREE.MeshStandardMaterial({ color: 0x2c313a, roughness: 0.75, metalness: 0.1 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x1c2026, roughness: 0.6, metalness: 0.4 }),
    metal: new THREE.MeshStandardMaterial({ color: 0x454d58, roughness: 0.4, metalness: 0.8 }),
    steel: new THREE.MeshStandardMaterial({ color: 0x8d97a5, roughness: 0.3, metalness: 0.85 }),
    black: new THREE.MeshStandardMaterial({ color: 0x0a0d12, roughness: 0.55, metalness: 0.3 }),
    snow: new THREE.MeshStandardMaterial({ color: 0xe4e7ec, roughness: 0.9, metalness: 0.02 }),
    leather: new THREE.MeshStandardMaterial({ color: 0x4a3b2e, roughness: 0.85, metalness: 0.05 }),
  };
  return _NEUTRAL;
}

function _agentMats(base) {
  const key = base.getHexString();
  let m = _MAT_CACHE.get(key);
  if (m) return m;
  m = {
    plate: new THREE.MeshStandardMaterial({ color: base, roughness: 0.45, metalness: 0.35 }),
    limb: new THREE.MeshStandardMaterial({ color: base.clone().multiplyScalar(0.42), roughness: 0.7, metalness: 0.15 }),
    cloth: new THREE.MeshStandardMaterial({ color: base.clone().multiplyScalar(0.3), roughness: 0.92, metalness: 0.02 }),
    glow: new THREE.MeshStandardMaterial({ color: 0x0b0e12, roughness: 0.25, metalness: 0.6, emissive: base, emissiveIntensity: 1.25 }),
    glowSoft: new THREE.MeshStandardMaterial({ color: base.clone().multiplyScalar(0.25), roughness: 0.5, metalness: 0.2, emissive: base, emissiveIntensity: 0.5 }),
  };
  _MAT_CACHE.set(key, m);
  return m;
}

// ---------------------------------------------------------------- core rig
// Shared skeleton for every skin: hip-pivot legs (boot bottoms rest at 0.02
// so a full swing can never dip below the floor), an `upper` group that bobs
// as one unit, an empty `head` group at 1.62 m (contents must stay within
// roughly local -0.12..+0.13 => 1.50-1.75 m, the analytic headshot band) and
// a `hold` group carrying both arms plus the held prop.
function _coreRig(M, N, o = {}) {
  const b = o.bulk ?? 1;
  const torsoMat = o.torso ? (M[o.torso] || N[o.torso]) : N.suit;
  const g = new THREE.Group();

  const mkLeg = (side) => {
    const leg = new THREE.Group();
    leg.position.set(0.11 * b * side, 0.78, 0);
    _box(leg, M.limb, 0.15 * b, 0.4, 0.18 * b, 0, -0.2, 0);        // thigh
    _box(leg, torsoMat, 0.12 * b, 0.34, 0.14 * b, 0, -0.55, 0.005); // shin
    _box(leg, N.dark, 0.13 * b, 0.09, 0.24, 0, -0.715, 0.04);      // boot
    g.add(leg);
    return leg;
  };
  const legL = mkLeg(-1);
  const legR = mkLeg(1);

  const upper = new THREE.Group();
  g.add(upper);
  _box(upper, torsoMat, 0.4 * b, 0.22, 0.24 * b, 0, 0.75, 0);      // hips
  _box(upper, N.dark, 0.42 * b, 0.07, 0.26 * b, 0, 0.85, 0);       // belt
  const torso = _box(upper, torsoMat, 0.46 * b, 0.52, 0.26 * b, 0, 1.14, 0);
  _box(upper, M.plate, 0.42 * b, 0.32, 0.07, 0, 1.21, 0.13 * b);   // chest plate

  const head = new THREE.Group();
  head.position.y = 1.62;
  head.name = 'head';
  upper.add(head);

  const hold = new THREE.Group();
  hold.position.set(0, 1.3, 0);
  upper.add(hold);
  const rel = (x, y, z) => [x, y - 1.3, z];
  // right arm: shoulder -> elbow -> rear grip
  _limb(hold, M.limb, rel(0.28 * b, 1.33, 0.02), rel(0.27, 1.12, 0.12), 0.11 * b, 0.12 * b);
  _limb(hold, torsoMat, rel(0.27, 1.12, 0.12), rel(0.12, 1.17, 0.24), 0.09, 0.09);
  _box(hold, N.dark, 0.08, 0.08, 0.08, ...rel(0.11, 1.17, 0.26));  // right glove
  // left arm: shoulder -> elbow -> foregrip
  _limb(hold, M.limb, rel(-0.28 * b, 1.33, 0.02), rel(-0.2, 1.12, 0.18), 0.11 * b, 0.12 * b);
  _limb(hold, torsoMat, rel(-0.2, 1.12, 0.18), rel(0.0, 1.2, 0.4), 0.09, 0.09);
  _box(hold, N.dark, 0.08, 0.08, 0.08, ...rel(0.01, 1.2, 0.42));   // left glove
  let gun = null;
  if (o.gun !== false) {
    gun = _gunProp(hold, N.metal, N.dark);
    gun.position.set(0.07, -0.08, 0.22); // hold-local (~1.22 m up, in front)
  }
  return { g, upper, head, hold, legL, legR, torso, gun, bulk: b };
}

// ---------------------------------------------------------------- role armor
// Shared armor language so the four roles read at a glance:
// Duellant light/angular, Wächter heavy plated, Initiator sensor pods,
// Stratege cloak/canister rig.
function _roleArmor(rig, M, N, role) {
  const { upper, legL, legR, bulk: b } = rig;
  const sx = Math.min(0.3 * b, 0.33); // shoulder x, capped to stay in silhouette
  if (role === 'Duellant') {
    _box(upper, M.plate, 0.15, 0.08, 0.2, -sx, 1.38, 0, 0, 0, 0.35);   // angular wedges
    _box(upper, M.plate, 0.15, 0.08, 0.2, sx, 1.38, 0, 0, 0, -0.35);
    _box(legL, M.plate, 0.14 * b, 0.09, 0.06, 0, -0.4, 0.08, -0.4);    // knee fins
    _box(legR, M.plate, 0.14 * b, 0.09, 0.06, 0, -0.4, 0.08, -0.4);
  } else if (role === 'Wächter') {
    for (const s of [-1, 1]) {
      _box(upper, M.plate, 0.19, 0.11, 0.24, s * sx, 1.38, 0);         // layered pauldrons
      _box(upper, N.dark, 0.15, 0.09, 0.2, s * (sx + 0.02), 1.27, 0);
      _box(upper, M.plate, 0.09, 0.13, 0.2 * b, s * 0.22 * b, 0.73, 0); // waist plates
    }
    _box(upper, N.dark, 0.26 * b, 0.07, 0.18 * b, 0, 1.42, -0.03);     // collar guard
  } else if (role === 'Initiator') {
    _cyl(upper, N.metal, 0.045, 0.055, 0.13, sx, 1.4, 0);              // sensor pod
    _sph(upper, M.glow, 0.02, sx, 1.47, 0);
    _box(upper, N.metal, 0.014, 0.22, 0.014, -sx, 1.4, -0.06, 0.22);   // whip antenna
    _box(upper, N.dark, 0.09, 0.1, 0.05, -0.12, 0.87, 0.13 * b);       // scanner pouches
    _box(upper, N.dark, 0.09, 0.1, 0.05, 0.12, 0.87, 0.13 * b);
  } else if (role === 'Stratege') {
    _cyl(upper, N.metal, 0.055, 0.055, 0.22, -0.11, 1.02, -0.17 * b);  // canister rig
    _cyl(upper, N.metal, 0.055, 0.055, 0.22, 0.11, 1.02, -0.17 * b);
    _box(upper, M.cloth, 0.17, 0.34, 0.025, -0.13, 0.68, -0.16 * b, 0.1); // waist capes
    _box(upper, M.cloth, 0.17, 0.34, 0.025, 0.13, 0.68, -0.16 * b, 0.1);
  }
}

// ---------------------------------------------------------------- fallback
// Generic humanoid for entities without a (known) agent — the pre-rework look.
function _genericDecor(rig, M, N) {
  const { head, upper } = rig;
  _box(head, N.suit, 0.24, 0.24, 0.25, 0, 0, 0);                  // helmet
  _box(head, N.dark, 0.26, 0.1, 0.26, 0, 0.08, -0.01);            // helmet crown
  _box(head, M.glow, 0.2, 0.07, 0.03, 0, 0.02, 0.125);            // visor slit
  _box(head, N.dark, 0.16, 0.06, 0.03, 0, -0.08, 0.12);           // chin guard
  _box(upper, M.plate, 0.3, 0.1, 0.06, 0, 1.0, 0.12);             // ab plate
  _box(upper, M.plate, 0.15, 0.09, 0.21, -0.3, 1.36, 0);          // shoulder pads
  _box(upper, M.plate, 0.15, 0.09, 0.21, 0.3, 1.36, 0);
  _box(upper, N.dark, 0.32, 0.38, 0.13, 0, 1.15, -0.19);          // backpack
  _box(upper, M.limb, 0.2, 0.16, 0.05, 0, 1.1, -0.27);            // pack pouch
  _box(upper, N.metal, 0.02, 0.2, 0.02, 0.12, 1.42, -0.2);        // antenna
  _box(rig.legL, N.dark, 0.16, 0.07, 0.19, 0, -0.4, 0.01);        // knee pads
  _box(rig.legR, N.dark, 0.16, 0.07, 0.19, 0, -0.4, 0.01);
  return null;
}

// ---------------------------------------------------------------- agents
// One entry per playable agent. `rig` tweaks the core proportions, `gait`
// tunes the shared walk cycle and `build(rig, M, N)` adds the unique
// headgear / signature emissive motif / prop, returning an optional idle
// flavor callback `(now, walk) => {}` layered on top of the shared cycle.
// Idle callbacks capture mesh refs and must not allocate per frame; they may
// `+=` onto upper/hold rotations because the shared cycle reassigns them
// every frame before idles run.
const AGENT_STYLES = {
  // -------- Spree (Duellant): aero speed-fin helmet, chevron visor, calf dash thrusters
  spree: {
    rig: { bulk: 0.92 },
    gait: { bob: 1.15, swing: 0.6 },
    build(rig, M, N) {
      const { head, hold } = rig;
      _box(head, N.suit, 0.22, 0.24, 0.24, 0, 0, 0);
      _box(head, M.plate, 0.04, 0.08, 0.28, 0, 0.08, -0.04, 0.22);      // swept crest fin
      _box(head, M.glow, 0.1, 0.045, 0.03, -0.05, 0.02, 0.115, 0, 0, 0.35);  // visor chevron
      _box(head, M.glow, 0.1, 0.045, 0.03, 0.05, 0.02, 0.115, 0, 0, -0.35);
      _box(head, N.dark, 0.14, 0.06, 0.03, 0, -0.08, 0.115);            // chin guard
      for (const leg of [rig.legL, rig.legR]) {
        _cyl(leg, N.metal, 0.04, 0.05, 0.15, 0, -0.55, -0.095);         // dash thruster
        _cyl(leg, M.glow, 0.024, 0.034, 0.03, 0, -0.64, -0.095);        // exhaust glow
      }
      _box(hold, M.glow, 0.014, 0.09, 0.12, 0.315, -0.07, 0.06);        // sprinter arm stripes
      _box(hold, M.glow, 0.014, 0.09, 0.12, -0.315, -0.07, 0.06);
      return (now) => {
        rig.head.rotation.y = Math.sin(now * 1.9) * 0.22;               // eager quick scan
        rig.upper.position.y += Math.sin(now * 3.1) * 0.005;            // on-their-toes bounce
      };
    },
  },
  // -------- Nebel (Stratege): deep hood, single wide eye slit, smoke vial bandolier
  nebel: {
    rig: { torso: 'cloth' },
    gait: { bob: 0.9 },
    build(rig, M, N) {
      const { head, upper } = rig;
      const hood = _sph(head, M.cloth, 0.15, 0, 0, -0.01);
      hood.scale.set(1, 0.95, 1.06);
      _cone(head, M.cloth, 0.06, 0.13, 0, 0.05, -0.14, 2.5);            // folded hood point
      _box(head, N.black, 0.16, 0.17, 0.06, 0, -0.02, 0.09);            // shadowed face
      _box(head, M.glow, 0.12, 0.026, 0.02, 0, 0.005, 0.125);           // wide eye slit
      for (let i = -1; i <= 1; i++)
        _cyl(upper, N.metal, 0.026, 0.026, 0.1, i * 0.09, 1.21 - i * 0.07, 0.16, 0.4); // vial bandolier
      _tor(upper, M.glow, 0.05, 0.01, 0, 1.05, 0.16);                   // fog-ring sigil
      return (now) => {
        rig.head.rotation.y = Math.sin(now * 0.55) * 0.42;              // slow lighthouse scan
        rig.upper.rotation.x += Math.sin(now * 0.8) * 0.012;            // cloak breathing
      };
    },
  },
  // -------- Funke (Initiator): mono-lens scope eye, antenna crown, shoulder scout drone
  funke: {
    gait: { bob: 1.1 },
    build(rig, M, N) {
      const { head, upper } = rig;
      _box(head, N.suit, 0.22, 0.24, 0.24, 0, 0, 0);
      _box(head, M.plate, 0.24, 0.06, 0.25, 0, 0.09, 0);                // sensor headband
      _cyl(head, M.glow, 0.055, 0.055, 0.05, 0.045, 0.02, 0.12, Math.PI / 2); // big scope eye
      _cyl(head, N.metal, 0.006, 0.006, 0.08, -0.08, 0.09, -0.02, 0, 0, -0.15); // antenna crown
      _cyl(head, N.metal, 0.006, 0.006, 0.08, 0.02, 0.095, -0.06, 0, 0, 0.1);
      _sph(head, M.glow, 0.014, -0.092, 0.132, -0.02);
      _sph(head, M.glow, 0.014, 0.024, 0.137, -0.06);
      const drone = new THREE.Group();
      drone.position.set(-0.27, 1.43, -0.04);
      upper.add(drone);
      _box(drone, N.metal, 0.09, 0.05, 0.09, 0, 0, 0);                  // pet drone body
      _sph(drone, M.glow, 0.016, 0, 0, 0.048);                          // drone eye
      const rotor = new THREE.Group();
      rotor.position.y = 0.045;
      drone.add(rotor);
      _box(rotor, N.dark, 0.17, 0.007, 0.02, 0, 0, 0);
      _box(rotor, N.dark, 0.02, 0.007, 0.17, 0, 0, 0);
      _box(upper, M.glow, 0.16, 0.03, 0.02, 0, 1.19, 0.17, 0, 0, 0.785); // X spark sigil
      _box(upper, M.glow, 0.16, 0.03, 0.02, 0, 1.19, 0.17, 0, 0, -0.785);
      return (now) => {
        rotor.rotation.y = now * 22;                                    // drone rotor spin
        rig.head.rotation.z = Math.sin(now * 2.3) * 0.07;               // curious head tilt
        rig.head.rotation.y = Math.sin(now * 1.4) * 0.28;
      };
    },
  },
  // -------- Bollwerk (Wächter): riot bunker helm, barricade back-rack, hazard chevrons
  bollwerk: {
    rig: { bulk: 1.15 },
    gait: { bob: 0.75, swing: 0.42 },
    build(rig, M, N) {
      const { head, upper, hold } = rig;
      _box(head, M.plate, 0.26, 0.22, 0.26, 0, 0.01, 0);                // riot helm
      _box(head, N.dark, 0.28, 0.06, 0.28, 0, 0.1, -0.01);              // crown ridge
      _box(head, M.glow, 0.18, 0.032, 0.02, 0, 0.01, 0.14);             // slit visor
      _box(head, N.dark, 0.2, 0.08, 0.05, 0, -0.08, 0.115);             // jaw grill
      _box(upper, N.metal, 0.4, 0.3, 0.04, 0, 1.16, -0.23, 0.08);       // barricade slabs
      _box(upper, M.plate, 0.34, 0.26, 0.04, 0, 1.03, -0.28, 0.16);
      _box(upper, M.glow, 0.14, 0.035, 0.02, -0.05, 1.02, 0.17, 0, 0, 0.55); // hazard chevrons
      _box(upper, M.glow, 0.14, 0.035, 0.02, 0.05, 1.02, 0.17, 0, 0, -0.55);
      _box(hold, M.plate, 0.14, 0.11, 0.15, 0.2, -0.155, 0.18);         // forearm guards
      _box(hold, M.plate, 0.13, 0.11, 0.15, -0.1, -0.14, 0.29);
      return (now) => {
        rig.upper.rotation.z += Math.sin(now * 0.7) * 0.022;            // heavy weight shift
        rig.head.rotation.y = Math.sin(now * 0.7) * 0.2;
      };
    },
  },
  // -------- Brandt (Initiator): respirator gas mask, twin fuel tanks with pilot flame
  brandt: {
    build(rig, M, N) {
      const { head, upper } = rig;
      _box(head, N.suit, 0.22, 0.24, 0.24, 0, 0.01, 0);
      _box(head, M.plate, 0.24, 0.08, 0.25, 0, 0.1, -0.01);             // fire helm cap
      _box(head, N.dark, 0.12, 0.1, 0.08, 0, -0.055, 0.13);             // respirator snout
      _cyl(head, N.metal, 0.042, 0.042, 0.05, -0.1, -0.06, 0.09, 0, 0, Math.PI / 2); // filters
      _cyl(head, N.metal, 0.042, 0.042, 0.05, 0.1, -0.06, 0.09, 0, 0, Math.PI / 2);
      _cyl(head, M.glow, 0.034, 0.034, 0.02, -0.06, 0.045, 0.12, Math.PI / 2);       // round eyes
      _cyl(head, M.glow, 0.034, 0.034, 0.02, 0.06, 0.045, 0.12, Math.PI / 2);
      _cyl(upper, N.metal, 0.07, 0.07, 0.34, -0.1, 1.12, -0.22);        // fuel tanks
      _cyl(upper, N.metal, 0.07, 0.07, 0.34, 0.1, 1.12, -0.22);
      const flame = _cone(upper, M.glow, 0.028, 0.08, -0.1, 1.33, -0.22); // pilot flame
      _cone(upper, M.glow, 0.045, 0.1, 0, 1.17, 0.175);                 // flame sigil
      _sph(upper, M.glow, 0.024, 0, 1.09, 0.175);
      return (now) => {
        const s = 1 + Math.sin(now * 7.3) * 0.3;                        // flame flicker
        flame.scale.y = s;
        flame.scale.x = flame.scale.z = 2 - s;
        rig.head.rotation.y = Math.sin(now * 0.9) * 0.15;
      };
    },
  },
  // -------- Sani (Stratege): beret + headset, white med pack with glowing cross
  sani: {
    build(rig, M, N) {
      const { head, upper } = rig;
      _box(head, N.suit, 0.22, 0.24, 0.24, 0, 0, 0);
      _cyl(head, M.cloth, 0.14, 0.15, 0.045, 0.02, 0.095, -0.01, 0, 0, 0.14); // beret
      _sph(head, M.glow, 0.016, -0.09, 0.1, 0.09);                      // beret badge
      _box(head, N.dark, 0.02, 0.02, 0.1, 0.11, -0.04, 0.06);           // headset boom
      _sph(head, M.glow, 0.013, 0.1, -0.045, 0.12);                     // mic tip
      _box(upper, N.snow, 0.3, 0.34, 0.14, 0, 1.12, -0.22);             // white med pack
      _box(upper, M.glow, 0.05, 0.2, 0.02, 0, 1.12, -0.3);              // glowing cross
      _box(upper, M.glow, 0.16, 0.05, 0.02, 0, 1.12, -0.3);
      _box(upper, M.glow, 0.026, 0.09, 0.02, 0.12, 1.24, 0.17);         // chest cross
      _box(upper, M.glow, 0.08, 0.028, 0.02, 0.12, 1.24, 0.17);
      _box(upper, N.snow, 0.09, 0.1, 0.05, -0.15, 0.86, 0.13);          // medic pouches
      _box(upper, N.snow, 0.09, 0.1, 0.05, 0.15, 0.86, 0.13);
      return (now) => {
        rig.head.rotation.y = Math.sin(now * 0.5) * 0.15;               // calm patrol glance
        rig.head.rotation.x = Math.max(0, Math.sin(now * 0.35)) * 0.12; // checks the pack
      };
    },
  },
  // -------- Schatten (Duellant): horned cowl, slanted glow eyes, claw-mark sigil
  schatten: {
    rig: { bulk: 0.9, torso: 'black' },
    gait: { bob: 1.05, swing: 0.62 },
    build(rig, M, N) {
      const { head, upper } = rig;
      _box(head, N.black, 0.22, 0.24, 0.24, 0, 0, 0);                   // dark cowl
      _box(head, N.black, 0.03, 0.09, 0.09, -0.09, 0.095, -0.03, -0.25, 0, 0.3); // horn fins
      _box(head, N.black, 0.03, 0.09, 0.09, 0.09, 0.095, -0.03, -0.25, 0, -0.3);
      _box(head, N.dark, 0.18, 0.09, 0.05, 0, -0.06, 0.105);            // half mask
      _box(head, M.glow, 0.055, 0.017, 0.02, -0.055, 0.035, 0.12, 0, 0, -0.4); // slanted eyes
      _box(head, M.glow, 0.055, 0.017, 0.02, 0.055, 0.035, 0.12, 0, 0, 0.4);
      _cone(upper, N.black, 0.05, 0.15, 0.27, 1.45, 0, 0, 0, -0.35);    // shoulder spike
      for (let i = -1; i <= 1; i++)
        _box(upper, M.glow, 0.02, 0.15, 0.015, i * 0.06, 1.19, 0.17, 0, 0, 0.5); // claw marks
      _box(upper, M.cloth, 0.08, 0.26, 0.02, -0.1, 0.68, -0.15);        // waist tassels
      _box(upper, M.cloth, 0.08, 0.26, 0.02, 0.1, 0.68, -0.15);
      return (now) => {
        rig.upper.rotation.x += 0.05;                                   // prowling lean
        rig.head.rotation.y = Math.sin(now * 0.5) * 0.5;                // wide slow sweep
      };
    },
  },
  // -------- Anker (Wächter): diver dome helm with porthole, glowing anchor sigil
  anker: {
    rig: { bulk: 1.15 },
    gait: { bob: 0.7, swing: 0.45 },
    build(rig, M, N) {
      const { head, upper, hold } = rig;
      const dome = _sph(head, M.plate, 0.145, 0, 0.005, 0);             // diver dome
      dome.scale.y = 0.95;
      _cyl(head, M.glow, 0.058, 0.058, 0.025, 0, 0.005, 0.125, Math.PI / 2); // porthole
      _tor(head, N.metal, 0.125, 0.02, 0, -0.11, 0, Math.PI / 2);       // neck seal ring
      _box(upper, M.glow, 0.028, 0.15, 0.015, 0, 1.22, 0.18);           // anchor shank
      _box(upper, M.glow, 0.1, 0.024, 0.015, 0, 1.27, 0.18);            // anchor stock
      _tor(upper, M.glow, 0.055, 0.012, 0, 1.16, 0.18, 0, 0, Math.PI, Math.PI); // anchor arms
      _tor(upper, N.steel, 0.028, 0.009, -0.13, 1.34, 0.16, 0, 0, 0.5); // chest chain links
      _tor(upper, N.steel, 0.028, 0.009, -0.05, 1.31, 0.17, 0, 0, 0.9);
      _box(hold, M.plate, 0.14, 0.11, 0.15, 0.2, -0.155, 0.18);         // forearm guards
      _box(hold, M.plate, 0.13, 0.11, 0.15, -0.1, -0.14, 0.29);
      return (now) => {
        rig.head.rotation.y = Math.sin(now * 0.4) * 0.3;                // ponderous scan
      };
    },
  },
  // -------- Radar (Initiator): twin goggle lenses, spinning back dish, sonar arcs
  radar: {
    build(rig, M, N) {
      const { head, upper } = rig;
      _box(head, N.suit, 0.22, 0.24, 0.24, 0, 0, 0);
      _box(head, N.dark, 0.24, 0.07, 0.06, 0, 0.03, 0.105);             // goggle band
      _cyl(head, M.glow, 0.042, 0.042, 0.035, -0.06, 0.03, 0.13, Math.PI / 2); // twin lenses
      _cyl(head, M.glow, 0.042, 0.042, 0.035, 0.06, 0.03, 0.13, Math.PI / 2);
      _box(head, N.metal, 0.05, 0.08, 0.09, 0.115, -0.02, 0);           // ear unit
      _cyl(upper, N.metal, 0.014, 0.014, 0.28, 0, 1.24, -0.21);         // dish mast
      const dish = new THREE.Group();
      dish.position.set(0, 1.4, -0.21);
      upper.add(dish);
      _cone(dish, N.steel, 0.13, 0.05, 0, 0, 0.01, Math.PI / 2);        // radar dish
      _sph(dish, M.glow, 0.02, 0, 0, 0.05);                             // feed glow
      _tor(upper, M.glow, 0.05, 0.008, 0, 1.16, 0.175, 0, 0, 0.75, 1.6); // sonar wave arcs
      _tor(upper, M.glow, 0.09, 0.008, 0, 1.16, 0.175, 0, 0, 0.75, 1.6);
      return (now) => {
        dish.rotation.y = now * 1.8;                                    // constant sweep
        rig.head.rotation.z = Math.sin(now * 1.1) * 0.05;               // listening tilt
      };
    },
  },
  // -------- Titan (Duellant): mohawk crest, V-visor, brute gauntlets, exhaust stacks
  titan: {
    rig: { bulk: 1.05 },
    gait: { bob: 1.1, swing: 0.58 },
    build(rig, M, N) {
      const { head, upper, hold } = rig;
      _box(head, N.suit, 0.23, 0.24, 0.24, 0, 0, 0);
      _box(head, M.plate, 0.02, 0.07, 0.09, 0, 0.1, 0.05);              // mohawk crest
      _box(head, M.plate, 0.02, 0.08, 0.09, 0, 0.105, -0.01);
      _box(head, M.plate, 0.02, 0.06, 0.09, 0, 0.095, -0.07);
      _box(head, M.glow, 0.09, 0.028, 0.025, -0.045, 0.025, 0.12, 0, 0, -0.5); // V-visor
      _box(head, M.glow, 0.09, 0.028, 0.025, 0.045, 0.025, 0.12, 0, 0, 0.5);
      _box(head, N.dark, 0.17, 0.07, 0.04, 0, -0.075, 0.11);            // jaw guard
      _box(hold, M.plate, 0.16, 0.13, 0.17, 0.2, -0.155, 0.18);         // brute gauntlets
      _box(hold, M.plate, 0.15, 0.13, 0.17, -0.1, -0.14, 0.29);
      _box(upper, M.glow, 0.11, 0.03, 0.02, -0.05, 1.15, 0.18, 0, 0, -0.55); // chest V sigil
      _box(upper, M.glow, 0.11, 0.03, 0.02, 0.05, 1.15, 0.18, 0, 0, 0.55);
      _cyl(upper, N.metal, 0.045, 0.045, 0.18, -0.14, 1.3, -0.2, 0.35); // exhaust stacks
      _cyl(upper, N.metal, 0.045, 0.045, 0.18, 0.14, 1.3, -0.2, 0.35);
      return (now) => {
        rig.upper.rotation.z += Math.sin(now * 0.85) * 0.03;            // shoulder roll
        rig.upper.rotation.x += 0.02;                                   // charge-ready lean
        rig.head.rotation.x = Math.sin(now * 1.1) * 0.04;
      };
    },
  },
  // -------- Wispel (Stratege): wide-brim veil hat, tri-dot face, orbiting wisp orbs
  wispel: {
    rig: { torso: 'cloth' },
    gait: { bob: 0.85 },
    build(rig, M, N) {
      const { head, upper } = rig;
      _sph(head, M.cloth, 0.12, 0, 0.025, 0);                           // veil dome
      _cyl(head, M.cloth, 0.19, 0.19, 0.018, 0, 0.045, 0);              // wide brim
      _box(head, N.black, 0.16, 0.16, 0.05, 0, -0.04, 0.085);           // hidden face
      _sph(head, M.glow, 0.014, 0, 0.005, 0.115);                       // tri-dot gaze
      _sph(head, M.glow, 0.012, -0.05, -0.025, 0.115);
      _sph(head, M.glow, 0.012, 0.05, -0.025, 0.115);
      _box(upper, M.cloth, 0.3, 0.36, 0.03, 0, 0.86, 0.155, 0.06);      // robe skirt front
      _box(upper, M.plate, 0.08, 0.44, 0.02, 0, 1.15, 0.155, 0, 0, 0.5); // silk sash
      const orbA = _sph(upper, M.glow, 0.032, 0.3, 1.1, 0);             // wisp orbs
      const orbB = _sph(upper, M.glow, 0.026, -0.3, 1.25, 0);
      return (now) => {
        orbA.position.set(Math.cos(now * 0.9) * 0.33, 1.08 + Math.sin(now * 1.7) * 0.08, Math.sin(now * 0.9) * 0.33);
        orbB.position.set(Math.cos(-now * 1.2 + 2) * 0.3, 1.3 + Math.sin(now * 1.3 + 1) * 0.08, Math.sin(-now * 1.2 + 2) * 0.3);
        rig.upper.rotation.z += Math.sin(now * 0.5) * 0.018;            // ghostly sway
        rig.head.rotation.y = Math.sin(now * 0.4) * 0.25;
      };
    },
  },
  // -------- Klinge (Duellant): oni half-mask + headband, katana instead of a gun
  klinge: {
    rig: { bulk: 0.9, gun: false },
    gait: { bob: 1.25, swing: 0.62 },
    build(rig, M, N) {
      const { head, upper, hold } = rig;
      _box(head, N.suit, 0.22, 0.24, 0.24, 0, 0, 0);
      _box(head, M.plate, 0.2, 0.1, 0.05, 0, -0.055, 0.105);            // oni half-mask
      _box(head, M.glow, 0.05, 0.018, 0.02, -0.055, 0.035, 0.12, 0, 0, 0.35); // fierce eyes
      _box(head, M.glow, 0.05, 0.018, 0.02, 0.055, 0.035, 0.12, 0, 0, -0.35);
      _box(head, N.black, 0.24, 0.045, 0.25, 0, 0.075, 0);              // headband
      _box(head, M.cloth, 0.05, 0.018, 0.28, 0, 0.05, -0.22, -0.5);     // trailing ribbon
      const blade = new THREE.Group();                                  // katana, two-hand guard pose
      blade.position.set(0.11, -0.13, 0.26);
      blade.rotation.set(0.65, 0, 0.12);
      hold.add(blade);
      _box(blade, N.steel, 0.014, 0.6, 0.045, 0, 0.36, 0);              // blade
      _box(blade, M.glow, 0.006, 0.58, 0.01, 0, 0.36, 0.026);           // glowing edge
      _box(blade, N.dark, 0.085, 0.02, 0.085, 0, 0.055, 0);             // tsuba guard
      _box(blade, N.leather, 0.032, 0.13, 0.045, 0, -0.03, 0);          // wrapped hilt
      _box(upper, N.black, 0.05, 0.66, 0.07, 0, 1.05, -0.19, 0, 0, 0.6); // back sheath
      _box(upper, M.glow, 0.02, 0.14, 0.015, -0.05, 1.2, 0.17, 0, 0, 0.45); // duel stripes
      _box(upper, M.glow, 0.02, 0.14, 0.015, 0.03, 1.14, 0.17, 0, 0, 0.45);
      return (now) => {
        rig.hold.rotation.z += Math.sin(now * 0.65) * 0.06;             // blade flourish
        rig.head.rotation.y = Math.sin(now * 1.6) * 0.18;               // alert scanning
      };
    },
  },
  // -------- Frost (Wächter): fur-rim hood, ice-crystal pauldrons, snowflake sigil
  frost: {
    rig: { bulk: 1.12 },
    gait: { bob: 0.8, swing: 0.46 },
    build(rig, M, N) {
      const { head, upper } = rig;
      _sph(head, M.plate, 0.135, 0, 0.005, -0.01);                      // icy hood dome
      _tor(head, N.snow, 0.115, 0.032, 0, -0.005, 0.07, 0, 0, 0);       // fur rim
      _box(head, M.glow, 0.13, 0.028, 0.02, 0, 0, 0.12);                // cold visor band
      _cone(upper, M.glowSoft, 0.045, 0.13, 0.3, 1.48, 0, 0, 0, -0.2);  // ice crystals
      _cone(upper, M.glowSoft, 0.04, 0.11, -0.31, 1.46, 0, 0, 0, 0.3);
      for (let i = 0; i < 3; i++)
        _box(upper, M.glow, 0.13, 0.016, 0.014, 0, 1.19, 0.175, 0, 0, i * Math.PI / 3); // snowflake
      _cone(upper, M.glowSoft, 0.03, 0.13, -0.08, 0.96, -0.21, Math.PI); // hanging icicles
      _cone(upper, M.glowSoft, 0.024, 0.1, 0.07, 0.97, -0.21, Math.PI);
      return (now) => {
        rig.upper.rotation.z += Math.sin(now * 16) * 0.0035;            // cold shiver
        rig.head.rotation.x = 0.06 + Math.sin(now * 1.3) * 0.02;        // huddled chin-down
      };
    },
  },
  // -------- Volt (Initiator): tesla coil crown, zigzag bolt sigil, coil back-pack
  volt: {
    gait: { bob: 1.1 },
    build(rig, M, N) {
      const { head, upper } = rig;
      _box(head, N.suit, 0.22, 0.24, 0.24, 0, 0, 0);
      _cyl(head, N.metal, 0.05, 0.06, 0.03, 0, 0.125, 0);               // coil discs
      _cyl(head, N.metal, 0.035, 0.045, 0.025, 0, 0.145, 0);
      const tip = _sph(head, M.glow, 0.016, 0, 0.15, 0);                // charged tip
      _cyl(head, M.glowSoft, 0.03, 0.03, 0.06, -0.125, 0.02, 0, 0, 0, Math.PI / 2); // capacitors
      _cyl(head, M.glowSoft, 0.03, 0.03, 0.06, 0.125, 0.02, 0, 0, 0, Math.PI / 2);
      _box(head, M.glow, 0.14, 0.026, 0.02, 0, 0.02, 0.121);            // visor band
      _box(upper, M.glow, 0.09, 0.024, 0.02, -0.03, 1.26, 0.175, 0, 0, 0.7);  // zigzag bolt
      _box(upper, M.glow, 0.09, 0.024, 0.02, 0.015, 1.19, 0.175, 0, 0, -0.7);
      _box(upper, M.glow, 0.09, 0.024, 0.02, -0.03, 1.12, 0.175, 0, 0, 0.7);
      _tor(upper, N.metal, 0.09, 0.014, 0, 1.06, -0.2, Math.PI / 2);    // coil pack rings
      _tor(upper, N.metal, 0.07, 0.014, 0, 1.16, -0.2, Math.PI / 2);
      return (now) => {
        tip.scale.setScalar(1 + Math.sin(now * 6.2) * 0.3);             // crackling charge
        rig.head.rotation.y = Math.sin(now * 3.1) * 0.09;               // twitchy scanning
      };
    },
  },
  // -------- Mauer (Wächter): slab bunker helm, tower shield on the back
  mauer: {
    rig: { bulk: 1.18 },
    gait: { bob: 0.6, swing: 0.4 },
    build(rig, M, N) {
      const { head, upper } = rig;
      _box(head, M.plate, 0.26, 0.2, 0.26, 0, 0.02, 0);                 // bunker helm
      _box(head, N.dark, 0.3, 0.035, 0.3, 0, 0.115, 0.01);              // brim slab
      _box(head, M.glow, 0.16, 0.026, 0.02, 0, 0.045, 0.135);           // narrow slit
      _box(head, N.dark, 0.2, 0.07, 0.04, 0, -0.085, 0.12);             // jaw plate
      _box(upper, N.steel, 0.44, 0.6, 0.04, 0, 1.02, -0.26, 0.06);      // tower shield
      _box(upper, N.dark, 0.05, 0.6, 0.02, -0.14, 1.02, -0.285, 0.06);  // shield ribs
      _box(upper, N.dark, 0.05, 0.6, 0.02, 0.14, 1.02, -0.285, 0.06);
      _box(upper, M.glow, 0.4, 0.026, 0.015, 0, 1.3, -0.288, 0.06);     // glow border
      _box(upper, M.glow, 0.4, 0.026, 0.015, 0, 0.74, -0.288, 0.06);
      return (now) => {
        rig.head.rotation.y = Math.sin(now * 0.35) * 0.18;              // stoic slow scan
      };
    },
  },
  // -------- Echo (Stratege): dome helm with sonic emitters, pulsing sonar rings
  echo: {
    build(rig, M, N) {
      const { head, upper } = rig;
      const dome = _sph(head, M.plate, 0.14, 0, 0.005, 0);              // smooth dome helm
      dome.scale.y = 0.92;
      _box(head, M.glow, 0.13, 0.035, 0.02, 0, -0.005, 0.125);          // visor slit
      _cyl(head, N.dark, 0.052, 0.052, 0.05, -0.135, 0, 0, 0, 0, Math.PI / 2); // sonic emitters
      _cyl(head, N.dark, 0.052, 0.052, 0.05, 0.135, 0, 0, 0, 0, Math.PI / 2);
      _tor(head, M.glow, 0.042, 0.008, -0.163, 0, 0, 0, Math.PI / 2);   // emitter glow rings
      _tor(head, M.glow, 0.042, 0.008, 0.163, 0, 0, 0, Math.PI / 2);
      const r1 = _tor(upper, M.glow, 0.055, 0.01, 0, 1.15, -0.21);      // sonar array (back)
      const r2 = _tor(upper, M.glowSoft, 0.095, 0.01, 0, 1.15, -0.22);
      const r3 = _tor(upper, M.glowSoft, 0.135, 0.01, 0, 1.15, -0.23);
      _tor(upper, M.glow, 0.05, 0.009, 0, 1.15, 0.175, 0, 0, 0.72, 1.7); // chest wave arcs
      _tor(upper, M.glow, 0.09, 0.009, 0, 1.15, 0.175, 0, 0, 0.72, 1.7);
      return (now) => {
        r1.scale.setScalar(1 + Math.sin(now * 2.2) * 0.15);             // sonar pulse
        r2.scale.setScalar(1 + Math.sin(now * 2.2 - 0.9) * 0.15);
        r3.scale.setScalar(1 + Math.sin(now * 2.2 - 1.8) * 0.15);
        rig.head.rotation.x = Math.sin(now * 2.1) * 0.04;               // rhythmic nod
      };
    },
  },
};

// ---------------------------------------------------------------- animation
// Self-driven: movement speed is inferred from the group's position deltas
// (game.js moves the group every tick) inside an onBeforeRender hook on the
// torso mesh, which is always rendered while the avatar is visible. The
// per-agent idle callback runs after the shared cycle each frame; nothing in
// here allocates.
function _attachAnim(rig, idleFn, gait = {}) {
  const bob = gait.bob ?? 1;
  const swingAmp = gait.swing ?? 0.55;
  const { g, upper, hold, legL, legR, torso } = rig;
  const anim = { lastX: 0, lastZ: 0, lastT: -1, phase: Math.random() * Math.PI * 2, idle: Math.random() * Math.PI * 2, speed: 0 };
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

    const swing = Math.sin(anim.phase) * swingAmp * walk;
    legL.rotation.x = swing;
    legR.rotation.x = -swing;
    // torso bob + subtle idle breathing; feet never leave the floor
    upper.position.y = Math.abs(Math.cos(anim.phase)) * 0.035 * bob * walk + Math.sin(now * 1.7 + anim.idle) * 0.008;
    upper.rotation.x = 0; // reset so idle flavors can lean via `+=`
    upper.rotation.y = Math.sin(anim.phase) * 0.06 * walk;
    upper.rotation.z = Math.sin(anim.phase) * 0.03 * walk;
    // prop sway: gentle idle scan + walk pump
    hold.rotation.x = Math.sin(now * 1.4 + anim.idle) * 0.03 + Math.sin(anim.phase * 2) * 0.04 * walk;
    hold.rotation.y = Math.sin(now * 0.9 + anim.idle) * 0.04;
    hold.rotation.z = 0;
    if (idleFn) idleFn(now, walk);
  };
}

// ---------------------------------------------------------------- buildAvatar
// Builds the avatar for bots/other players. `agent` selects the unique
// per-agent model (AGENT_STYLES keyed by agent.id); undefined or unknown
// agents fall back to the generic humanoid (with role armor if the role is
// recognized). See the contract notes at the top of this section.
export function buildAvatar(color, agent) {
  const base = new THREE.Color(color);
  const M = _agentMats(base);
  const N = _neutralMats();
  const style = agent ? AGENT_STYLES[agent.id] : null;
  const rig = _coreRig(M, N, style?.rig);
  if (agent?.role) _roleArmor(rig, M, N, agent.role);
  const idleFn = style ? style.build(rig, M, N) : _genericDecor(rig, M, N);
  _attachAnim(rig, idleFn, style?.gait);
  rig.g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return rig.g;
}
