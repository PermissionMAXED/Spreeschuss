import * as THREE from 'three';
import { bus } from '../engine/eventbus.js';

// First-person weapon viewmodel parented to the main camera and rendered in
// the single main pass. Procedurally builds a distinct gun per weapon
// category and animates sway/bob, recoil kick, reload dip and switch raise.

const RELOAD_DURATION = 2.0; // must match startReload() in weaponsystem.js
const RAISE_TIME = 0.3;      // weapon-switch raise animation length (s)
const FLASH_TIME = 0.04;     // muzzle flash duration (~40 ms)

// ---------------------------------------------------------------- materials
function metal(color, rough = 0.4, met = 0.8, emissive = 0x000000, ei = 0) {
  return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: met, emissive, emissiveIntensity: ei });
}

// Shared palette: dark gunmetal receiver, near-black furniture, lighter steel
// for barrels/slides, matte polymer grips, plus a per-category emissive
// accent (kept subtle — a bloom pass runs on top of this).
function palette(accent) {
  return {
    body: metal(0x4a525e, 0.38, 0.82, 0x141a21, 0.4),
    dark: metal(0x23272e, 0.58, 0.55, 0x0a0d10, 0.35),
    steel: metal(0x7b838e, 0.28, 0.95, 0x14171b, 0.25),
    grip: metal(0x2f3239, 0.78, 0.2),
    accent: metal(accent, 0.35, 0.5, accent, 0.9),
  };
}

const ACCENTS = {
  sidearm: 0x49c6d8, smg: 0xffb454, rifle: 0x43b7c7, sniper: 0xa385ff,
  shotgun: 0xff7a45, heavy: 0x7ee081, melee: 0x9fd8ff,
};

// Per-category resting pose of the gun group (camera space, bottom-right).
const POSES = {
  sidearm: { pos: [0.24, -0.22, -0.48], rot: [0, -0.08, 0], scale: 1.1 },
  smg: { pos: [0.24, -0.23, -0.44], rot: [0, -0.09, 0], scale: 1.05 },
  rifle: { pos: [0.24, -0.24, -0.42], rot: [0, -0.08, 0], scale: 1.0 },
  sniper: { pos: [0.22, -0.23, -0.36], rot: [0, -0.07, 0], scale: 0.88 },
  shotgun: { pos: [0.24, -0.25, -0.44], rot: [0, -0.09, 0], scale: 0.95 },
  heavy: { pos: [0.26, -0.26, -0.46], rot: [0, -0.1, 0], scale: 0.92 },
  melee: { pos: [0.27, -0.31, -0.42], rot: [0.08, 0.4, -0.15], scale: 1.1 },
};

// ---------------------------------------------------------------- geo helpers
function box(parent, mat, w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  parent.add(m);
  return m;
}

// cylinder with its length along Z (barrel orientation)
function tube(parent, mat, r1, r2, len, x, y, z, seg = 10) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, len, seg), mat);
  m.rotation.x = Math.PI / 2;
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}

// ---------------------------------------------------------------- gun builders
// Each returns { g, muzzle: [x,y,z] } with the muzzle in gun-local space.
// Forward is -Z; the grip sits near the origin.

function buildSidearm(p) {
  const g = new THREE.Group();
  box(g, p.steel, 0.075, 0.075, 0.4, 0, 0.075, -0.2);            // slide
  box(g, p.dark, 0.078, 0.05, 0.07, 0, 0.078, -0.045);           // rear serrations
  box(g, p.body, 0.07, 0.06, 0.35, 0, 0.008, -0.175);            // frame
  tube(g, p.dark, 0.019, 0.019, 0.05, 0, 0.075, -0.42);          // barrel stub
  box(g, p.grip, 0.066, 0.19, 0.11, 0, -0.11, -0.03, 0.22);      // grip
  box(g, p.dark, 0.02, 0.012, 0.1, 0, -0.05, -0.11);             // trigger guard bottom
  box(g, p.dark, 0.02, 0.05, 0.012, 0, -0.028, -0.16);           // trigger guard front
  box(g, p.dark, 0.013, 0.022, 0.02, 0, 0.123, -0.385);          // front sight
  box(g, p.dark, 0.042, 0.018, 0.022, 0, 0.121, -0.025);         // rear sight
  box(g, p.accent, 0.079, 0.013, 0.13, 0, 0.05, -0.3);           // slide accent strip
  return { g, muzzle: [0, 0.075, -0.46] };
}

function buildSmg(p) {
  const g = new THREE.Group();
  box(g, p.body, 0.085, 0.105, 0.46, 0, 0.02, -0.28);            // receiver
  box(g, p.dark, 0.05, 0.028, 0.44, 0, 0.09, -0.28);             // top rail
  box(g, p.steel, 0.016, 0.016, 0.24, -0.026, 0.05, 0.06);       // wire stock rails
  box(g, p.steel, 0.016, 0.016, 0.24, 0.026, 0.05, 0.06);
  box(g, p.dark, 0.09, 0.11, 0.03, 0, 0.02, 0.185);              // butt pad
  tube(g, p.steel, 0.017, 0.017, 0.2, 0, 0.035, -0.6);           // barrel
  tube(g, p.dark, 0.03, 0.03, 0.1, 0, 0.035, -0.53);             // barrel collar
  box(g, p.grip, 0.05, 0.13, 0.055, 0, -0.1, -0.42, -0.15);      // vertical foregrip
  box(g, p.grip, 0.06, 0.16, 0.09, 0, -0.11, -0.1, 0.25);        // pistol grip
  box(g, p.dark, 0.05, 0.17, 0.075, 0, -0.13, -0.28, 0.08);      // short mag
  box(g, p.dark, 0.026, 0.026, 0.05, 0.055, 0.045, -0.16);       // charging handle
  box(g, p.accent, 0.087, 0.012, 0.22, 0, 0.079, -0.3);          // accent strip
  return { g, muzzle: [0, 0.035, -0.72] };
}

function buildRifle(p) {
  const g = new THREE.Group();
  box(g, p.body, 0.09, 0.12, 0.42, 0, 0.02, -0.34);              // receiver
  box(g, p.dark, 0.075, 0.1, 0.26, 0, 0.005, 0.0);               // stock
  box(g, p.dark, 0.08, 0.13, 0.04, 0, -0.005, 0.14);             // butt pad
  box(g, p.dark, 0.075, 0.085, 0.36, 0, 0.03, -0.72);            // long handguard
  box(g, p.accent, 0.078, 0.013, 0.28, 0, 0.03, -0.72);          // handguard accent vents
  tube(g, p.steel, 0.015, 0.015, 0.22, 0, 0.035, -0.98);         // barrel
  box(g, p.dark, 0.036, 0.036, 0.07, 0, 0.035, -1.07);           // muzzle device
  box(g, p.dark, 0.012, 0.05, 0.012, 0, 0.095, -0.88);           // front sight post
  box(g, p.dark, 0.04, 0.012, 0.03, 0, 0.072, -0.88);            // front sight base
  box(g, p.dark, 0.05, 0.03, 0.16, 0, 0.1, -0.3);                // rear sight rail
  box(g, p.grip, 0.06, 0.17, 0.1, 0, -0.11, -0.2, 0.28);         // pistol grip
  // curved magazine suggested by three progressively tilted segments
  box(g, p.dark, 0.055, 0.09, 0.1, 0, -0.115, -0.4, 0.12);
  box(g, p.dark, 0.055, 0.09, 0.1, 0, -0.19, -0.425, 0.34);
  box(g, p.dark, 0.055, 0.08, 0.095, 0, -0.255, -0.47, 0.55);
  return { g, muzzle: [0, 0.035, -1.11] };
}

function buildSniper(p) {
  const g = new THREE.Group();
  box(g, p.body, 0.085, 0.115, 0.52, 0, 0, -0.4);                // receiver
  box(g, p.dark, 0.07, 0.11, 0.3, 0, -0.01, 0.02);               // stock
  box(g, p.dark, 0.06, 0.045, 0.16, 0, 0.07, 0.05);              // cheek riser
  box(g, p.dark, 0.075, 0.14, 0.04, 0, -0.02, 0.185);            // butt pad
  tube(g, p.steel, 0.019, 0.023, 0.7, 0, 0.02, -0.98);           // long barrel
  tube(g, p.dark, 0.032, 0.032, 0.09, 0, 0.02, -1.31);           // muzzle brake
  // large scope
  tube(g, p.dark, 0.032, 0.032, 0.3, 0, 0.135, -0.38);           // main tube
  tube(g, p.dark, 0.052, 0.044, 0.09, 0, 0.135, -0.55);          // objective bell
  tube(g, p.dark, 0.042, 0.042, 0.07, 0, 0.135, -0.23);          // ocular
  tube(g, p.accent, 0.038, 0.038, 0.008, 0, 0.135, -0.596);      // lens glint
  box(g, p.steel, 0.024, 0.05, 0.03, 0, 0.09, -0.3);             // scope mounts
  box(g, p.steel, 0.024, 0.05, 0.03, 0, 0.09, -0.47);
  // bolt handle
  const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.08, 8), p.steel);
  bolt.rotation.z = Math.PI / 2;
  bolt.position.set(0.07, 0.035, -0.2);
  g.add(bolt);
  box(g, p.dark, 0.028, 0.028, 0.028, 0.11, 0.035, -0.2);        // bolt knob
  // folded bipod hint under the barrel
  box(g, p.steel, 0.012, 0.24, 0.012, -0.035, -0.1, -0.82, -0.35, 0, 0.3);
  box(g, p.steel, 0.012, 0.24, 0.012, 0.035, -0.1, -0.82, -0.35, 0, -0.3);
  box(g, p.grip, 0.06, 0.16, 0.09, 0, -0.12, -0.16, 0.3);        // grip
  box(g, p.dark, 0.05, 0.08, 0.14, 0, -0.09, -0.36);             // mag
  return { g, muzzle: [0, 0.02, -1.37] };
}

function buildShotgun(p) {
  const g = new THREE.Group();
  box(g, p.body, 0.095, 0.13, 0.36, 0, 0, -0.3);                 // receiver
  box(g, p.dark, 0.075, 0.115, 0.3, 0, -0.015, 0.02);            // stock
  box(g, p.dark, 0.08, 0.14, 0.04, 0, -0.03, 0.185);             // butt pad
  tube(g, p.steel, 0.024, 0.024, 0.62, 0, 0.05, -0.76);          // barrel
  tube(g, p.dark, 0.021, 0.021, 0.56, 0, -0.015, -0.72);         // under-barrel tube mag
  box(g, p.grip, 0.078, 0.075, 0.17, 0, -0.015, -0.56);          // pump sleeve
  box(g, p.dark, 0.084, 0.014, 0.17, 0, -0.015, -0.56);          // pump rib
  box(g, p.dark, 0.084, 0.075, 0.02, 0, -0.015, -0.63);          // pump front lip
  box(g, p.dark, 0.022, 0.03, 0.05, 0, 0.09, -1.02);             // front sight base
  box(g, p.accent, 0.012, 0.016, 0.012, 0, 0.113, -1.02);        // bead sight (accent)
  box(g, p.accent, 0.098, 0.045, 0.014, 0, 0.01, -0.3);          // receiver side accent
  box(g, p.dark, 0.02, 0.05, 0.012, 0, -0.06, -0.16);            // trigger guard
  return { g, muzzle: [0, 0.05, -1.09] };
}

function buildHeavy(p) {
  const g = new THREE.Group();
  box(g, p.body, 0.13, 0.17, 0.55, 0, 0, -0.33);                 // thick receiver
  // carry handle: two posts + top bar
  box(g, p.dark, 0.03, 0.05, 0.03, 0, 0.11, -0.2);
  box(g, p.dark, 0.03, 0.05, 0.03, 0, 0.11, -0.46);
  box(g, p.dark, 0.035, 0.03, 0.32, 0, 0.15, -0.33);
  box(g, p.dark, 0.1, 0.2, 0.2, 0, -0.17, -0.36);                // box magazine
  box(g, p.accent, 0.104, 0.02, 0.2, 0, -0.085, -0.36);          // ammo window accent
  tube(g, p.steel, 0.026, 0.026, 0.5, 0, 0.02, -0.85);           // thick barrel
  tube(g, p.dark, 0.044, 0.044, 0.05, 0, 0.02, -0.66);           // shroud rings
  tube(g, p.dark, 0.044, 0.044, 0.05, 0, 0.02, -0.78);
  tube(g, p.dark, 0.044, 0.044, 0.05, 0, 0.02, -0.9);
  box(g, p.dark, 0.06, 0.06, 0.09, 0, 0.02, -1.1);               // muzzle brake
  box(g, p.grip, 0.065, 0.17, 0.1, 0, -0.13, -0.08, 0.3);        // rear grip
  box(g, p.grip, 0.055, 0.13, 0.06, 0, -0.12, -0.56, -0.1);      // front grip
  box(g, p.dark, 0.09, 0.13, 0.18, 0, -0.01, 0.04);              // stock block
  return { g, muzzle: [0, 0.02, -1.16] };
}

function buildMelee(p) {
  const g = new THREE.Group();
  // blade: extruded drop-point profile, spine up, edge down, tip toward -Z
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.lineTo(0.2, 0);
  s.quadraticCurveTo(0.28, 0.006, 0.31, 0.038);
  s.lineTo(0.05, 0.052);
  s.lineTo(0, 0.046);
  s.closePath();
  const bladeGeo = new THREE.ExtrudeGeometry(s, {
    depth: 0.008, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.003, bevelSegments: 1,
  });
  const blade = new THREE.Mesh(bladeGeo, p.steel);
  blade.rotation.y = Math.PI / 2; // shape +X -> -Z (tip forward)
  blade.position.set(-0.004, -0.02, -0.015);
  g.add(blade);
  box(g, p.accent, 0.014, 0.005, 0.18, 0, -0.019, -0.13);        // edge glow accent
  box(g, p.dark, 0.055, 0.05, 0.022, 0, 0, 0);                   // guard
  tube(g, p.grip, 0.016, 0.019, 0.12, 0, -0.005, 0.07, 8);       // grip
  box(g, p.dark, 0.026, 0.03, 0.024, 0, -0.005, 0.14);           // pommel
  return { g, muzzle: null };
}

const BUILDERS = {
  sidearm: buildSidearm, smg: buildSmg, rifle: buildRifle, sniper: buildSniper,
  shotgun: buildShotgun, heavy: buildHeavy, melee: buildMelee,
};

// ---------------------------------------------------------------- viewmodel
export class Viewmodel {
  constructor(renderer, game) {
    this.r = renderer;
    this.game = game;
    this.group = new THREE.Group();
    this.currentCat = null;
    this.recoil = 0;
    this.muzzle = null;
    this.muzzleLight = null;
    this.raiseT = 0;
    this._mount();
    // clearScene() (called on every loadMatch) wipes the scene, so force a
    // full rebuild whenever a match starts. Mounting itself is re-checked
    // defensively every frame in update() and does not rely on this event.
    bus.on('match:start', () => { this._mount(); this.currentCat = null; });
    bus.on('muzzle', () => { this.recoil = 1; if (this.muzzle) this.muzzleTimer = FLASH_TIME; });
  }

  _mount() {
    // Parent the viewmodel to the main camera and make sure the camera is part
    // of the scene graph so its children are rendered. clearScene() (run on
    // every loadMatch) wipes the scene; this is re-checked every frame in
    // update(). Returns true when the camera had to be re-added — that means
    // the scene was just wiped and the gun's GPU resources were disposed, so
    // the caller must force a rebuild.
    const cam = this.r.camera;
    const remounted = cam.parent !== this.r.scene;
    if (remounted) this.r.scene.add(cam);
    if (this.group.parent !== cam) cam.add(this.group);
    // dedicated light so the gun is well lit regardless of the map palette
    if (!this._light) {
      this._light = new THREE.PointLight(0xffffff, 2.2, 6);
      this._light.position.set(0.3, 0.1, -0.4);
    }
    if (this._light.parent !== cam) cam.add(this._light);
    return remounted;
  }

  _clear() {
    while (this.group.children.length) {
      const c = this.group.children[0];
      this.group.remove(c);
      c.traverse?.((o) => {
        // Sprites share one global geometry in three.js — disposing it would
        // break every other sprite in the scene (e.g. plant-site labels).
        if (o.geometry && !o.isSprite) o.geometry.dispose();
        if (o.material) o.material.dispose();
      });
    }
    this.gun = null;
    this.muzzle = null;
    this.muzzleLight = null;
    this.currentCat = null;
  }

  build(cat) {
    this._clear();
    const p = palette(ACCENTS[cat] ?? 0x43b7c7);
    const { g, muzzle } = (BUILDERS[cat] || buildRifle)(p);

    if (muzzle) {
      // muzzle flash sprite (kept from the original implementation)
      const mflash = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0xffd070, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
      mflash.scale.set(0.35, 0.35, 0.35);
      mflash.position.set(muzzle[0], muzzle[1], muzzle[2]);
      g.add(mflash);
      this.muzzle = mflash;
      // brief point light at the muzzle (~40 ms, small radius), driven by
      // the same 'muzzle' event / muzzleTimer as the sprite
      this.muzzleLight = new THREE.PointLight(0xffc36b, 0, 2.5, 2);
      this.muzzleLight.position.set(muzzle[0], muzzle[1], muzzle[2] + 0.05);
      g.add(this.muzzleLight);
    }

    const pose = POSES[cat] || POSES.rifle;
    g.position.set(pose.pos[0], pose.pos[1], pose.pos[2]);
    g.rotation.set(pose.rot[0], pose.rot[1], pose.rot[2]);
    g.scale.setScalar(pose.scale);
    this.group.add(g);
    this.gun = g;
    this.currentCat = cat;
    this.basePos = pose.pos;
    this.baseRot = pose.rot;
    this.raiseT = RAISE_TIME; // play the raise animation on every build/switch
  }

  update(dt) {
    const p = this.game.player;
    if (!p) return;
    // Defensive re-mount every frame: clearScene() (loadMatch) removes the
    // camera from the scene and disposes the gun's geometry/materials. Do not
    // rely on 'match:start' event ordering — if the camera had to be
    // re-added, the old gun resources are stale, so force a rebuild too.
    if (this._mount()) this.currentCat = null;
    const cat = p.alive ? p.weapon().cat : null;
    if (cat && (cat !== this.currentCat || !this.gun)) this.build(cat);
    this.group.visible = !!(p.alive && this.game.state === 'playing' && !this.game.buyOpen && !this.game.scopeActive);
    // replay the raise animation on respawn even if the category is unchanged
    if (!p.alive) this._wasDead = true;
    else if (this._wasDead) { this._wasDead = false; this.raiseT = RAISE_TIME; }
    if (!this.gun) return;

    const t = performance.now() / 1000;
    const gun = this.gun;
    const isMelee = cat === 'melee';

    // timers
    this.recoil = Math.max(0, this.recoil - dt * (isMelee ? 5 : 8));
    this.raiseT = Math.max(0, this.raiseT - dt);
    const raise = this.raiseT / RAISE_TIME;      // 1 -> 0
    const raiseEase = raise * raise;             // ease-out (fast finish)

    // look sway: the gun lags slightly behind camera yaw/pitch
    if (this._swayRef !== p) { this._swayRef = p; this._swayYaw = p.yaw; this._swayPitch = p.pitch; }
    const sk = 1 - Math.exp(-dt * 12);
    this._swayYaw += (p.yaw - this._swayYaw) * sk;
    this._swayPitch += (p.pitch - this._swayPitch) * sk;
    const swayYaw = THREE.MathUtils.clamp(p.yaw - this._swayYaw, -0.4, 0.4);
    const swayPitch = THREE.MathUtils.clamp(p.pitch - this._swayPitch, -0.4, 0.4);

    // movement bob (smoothly blended in/out)
    const moving = (p.vel.x * p.vel.x + p.vel.z * p.vel.z) > 1 && p._onGround;
    this._bobBlend = (this._bobBlend || 0) + ((moving ? 1 : 0) - (this._bobBlend || 0)) * Math.min(1, dt * 8);
    const bobX = Math.sin(t * 10) * 0.008 * this._bobBlend;
    const bobY = Math.abs(Math.cos(t * 10)) * 0.008 * this._bobBlend;
    // idle breathing
    const idleY = Math.sin(t * 1.6) * 0.0025;

    // reload dip-and-tilt (reloadUntil > now means the player is reloading)
    let dip = 0;
    const remain = p.reloadUntil - this.game.now;
    if (!isMelee && remain > 0 && remain <= RELOAD_DURATION) {
      const prog = THREE.MathUtils.clamp(1 - remain / RELOAD_DURATION, 0, 1);
      dip = Math.sin(prog * Math.PI); // dip down into the reload, come back up
    }

    // compose pose = base + sway + bob + recoil + reload + raise
    const [bx, by, bz] = this.basePos;
    const [brx, bry, brz] = this.baseRot;
    let px = bx + bobX - swayYaw * 0.05;
    let py = by + bobY + idleY - swayPitch * 0.02 - dip * 0.13 - raiseEase * 0.24;
    let pz = bz;
    let rx = brx + swayPitch * 0.3 - dip * 0.5 - raiseEase * 0.7;
    let ry = bry + swayYaw * 0.35;
    let rz = brz + dip * 0.4;

    if (isMelee) {
      // knife attack: quick forward stab + diagonal swipe driven by recoil
      const k = this.recoil;
      pz -= k * 0.22;
      py += k * 0.05;
      rx -= k * 0.4;
      ry += k * 0.7;
      rz -= k * 0.9;
    } else {
      // gun recoil: kick back toward the camera and pitch the muzzle up
      pz += this.recoil * 0.09;
      py -= this.recoil * 0.02;
      rx += this.recoil * 0.15;
    }

    gun.position.set(px, py, pz);
    gun.rotation.set(rx, ry, rz);

    // muzzle flash sprite + brief point light
    this.muzzleTimer = Math.max(0, (this.muzzleTimer || 0) - dt);
    const flash = this.muzzleTimer > 0 ? this.muzzleTimer / FLASH_TIME : 0;
    if (this.muzzle) {
      this.muzzle.material.opacity = flash > 0 ? 0.9 : 0;
      this.muzzle.material.rotation = Math.random() * Math.PI;
      const fs = 0.3 + Math.random() * 0.15;
      this.muzzle.scale.set(fs, fs, fs);
    }
    if (this.muzzleLight) this.muzzleLight.intensity = flash * 14;
  }
}
