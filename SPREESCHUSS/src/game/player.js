import * as THREE from 'three';
import { moveAndCollide } from './collision.js';
import { updateShooter, finishReloadIfDue } from '../weapons/weaponsystem.js';
import { EYE, RADIUS, HEIGHT } from './entity.js';
import { bus } from '../engine/eventbus.js';
import { audio } from '../audio/audio.js';

const WALK = 5.6;
const RUN = 5.6;      // Valorant-like: base run speed
const SLOW = 2.8;     // walking (shift)
const CROUCH = 2.4;
const JUMP = 5.2;
const GRAVITY = 16;

// --- game-feel tuning -------------------------------------------------------
// Everything below is feel/view-layer only. The nav contract above (RUN, JUMP,
// GRAVITY, crouch factor, collision height) is frozen: slide speed never
// exceeds RUN and the jump arc is untouched.
const AIR_ACCEL = 10;                       // m/s^2 steering while airborne
const SLIDE_DUR = 0.5;                      // s until a slide times out
const SLIDE_COOLDOWN = 0.7;                 // s between slides
const SLIDE_BOOST = 1.12;                   // entry boost, capped at RUN
const SLIDE_MIN_FRAC = 0.9;                 // needs >= 90% of run speed
const SLIDE_STEER = 0.3;                    // input authority while sliding
const SLIDE_ROLL = 2.5 * Math.PI / 180;     // max camera roll during a slide
const FALL_MIN = 2.5;                       // m/s impact where the dip starts
const FALL_MAX = 9;                         // m/s impact for the maximum dip
const DIP_MAX = 0.09;                       // m camera dip on hardest landing
const DIP_OMEGA = 20;                       // spring rate (~0.25 s recovery)
const BOB_RATE = 10;                        // rad/s bob phase at full run
const SHAKE_MAX = 0.6 * Math.PI / 180;      // rad of shake at >= 60 damage
const SHAKE_DMG = 60;                       // damage for maximum shake
const SHAKE_DECAY = 16;                     // 1/s exponential decay (~0.2 s)
const SHAKE_SCOPED = 0.3;                   // shake kept while scoped

// Controls the local player entity from Input, drives the main camera.
export class PlayerController {
  constructor(game, input, camera) {
    this.game = game;
    this.input = input;
    this.camera = camera;
    this.e = null;
    this.recoil = { x: 0, y: 0 };
    this.bob = 0;
    this.crouching = false;

    // slide state: momentum carried in `dir`/decel, cooldown gate in cdUntil
    this.slide = { active: false, t: 0, decel: 0, dir: new THREE.Vector3(), cdUntil: 0 };
    this._crouchWasDown = false;
    // view-feel state (never touches e.yaw/e.pitch — aim stays authoritative)
    this._eyeH = HEIGHT;      // smoothed stand/crouch height, camera only
    this._dip = 0;            // landing dip spring position (m, <= 0)
    this._dipVel = 0;
    this._roll = 0;           // smoothed slide camera roll (rad)
    this._stepCount = 0;      // footstep counter derived from this.bob
    this._shake = { amp: 0, t: 0, dirP: 0, dirY: 0 };
    bus.on('damage', (d) => this._onDamage(d));
  }

  attach(entity) {
    this.e = entity;
  }

  addRecoil(x, y) {
    this.recoil.x += x;
    this.recoil.y += y;
  }

  update(dt, now) {
    const e = this.e;
    if (!e) return;

    // --- Look ---
    if (this.input.locked && this.game.state === 'playing' && e.alive) {
      const m = this.input.consumeMouse();
      const sens = this.input.sensitivity * (this.game.scopeActive ? 0.45 : 1);
      e.yaw -= m.dx * sens;
      e.pitch -= m.dy * sens;
    } else {
      this.input.consumeMouse();
    }
    // recoil recovery
    this.recoil.x *= 0.86;
    this.recoil.y *= 0.86;
    const pitch = THREE.MathUtils.clamp(e.pitch + this.recoil.x, -1.5, 1.5);
    e.pitch = THREE.MathUtils.clamp(e.pitch, -1.5, 1.5);

    if (!e.alive) {
      // zero all view-feel offsets so the death/spectate camera path is
      // exactly the pre-feel behavior and respawns start from a clean slate
      this.slide.active = false;
      this._dip = 0;
      this._dipVel = 0;
      this._roll = 0;
      this._shake.amp = 0;
      this._eyeH = HEIGHT;
      this._crouchWasDown = this.input.isDown('ControlLeft') || this.input.isDown('KeyC');
      this._syncCamera(pitch);
      return;
    }

    // --- Move ---
    const forward = new THREE.Vector3(Math.sin(e.yaw), 0, Math.cos(e.yaw)).multiplyScalar(-1);
    const right = new THREE.Vector3(-forward.z, 0, forward.x);
    const wish = new THREE.Vector3();
    if (this.input.isDown('KeyW')) wish.add(forward);
    if (this.input.isDown('KeyS')) wish.sub(forward);
    if (this.input.isDown('KeyD')) wish.add(right);
    if (this.input.isDown('KeyA')) wish.sub(right);

    const crouchHeld = this.input.isDown('ControlLeft') || this.input.isDown('KeyC');
    const crouchPressed = crouchHeld && !this._crouchWasDown;
    this._crouchWasDown = crouchHeld;
    this.crouching = crouchHeld;
    const walking = this.input.isDown('ShiftLeft');
    const wmove = e.weapon().moveSpeed || 1;
    const slowMult = now < e.effects.slowUntil ? (1 - e.effects.slowAmt) : 1;
    let speed = RUN * wmove;
    if (walking) speed = SLOW * wmove;
    if (this.crouching) speed = CROUCH * wmove;
    speed *= slowMult;

    const grounded = e.pos.y <= 0.02 || e._onGround;
    const hspeed = Math.hypot(e.vel.x, e.vel.z);
    const runCap = RUN * wmove * slowMult;       // current max ground speed
    const crouchCap = CROUCH * wmove * slowMult; // slide decays to this

    // --- Slide start: fresh crouch press at (near) full run speed ---
    if (crouchPressed && grounded && !this.slide.active &&
        now >= this.slide.cdUntil && hspeed >= runCap * SLIDE_MIN_FRAC && hspeed > 0.01) {
      this.slide.active = true;
      this.slide.t = 0;
      const s0 = Math.min(hspeed * SLIDE_BOOST, RUN); // never above max ground speed
      this.slide.decel = Math.max(0.01, (s0 - crouchCap) / SLIDE_DUR);
      this.slide.dir.set(e.vel.x, 0, e.vel.z).normalize();
      e.vel.x = this.slide.dir.x * s0;
      e.vel.z = this.slide.dir.z * s0;
      audio.slide?.();
    }
    // slide end: key release, leaving the ground, or timeout
    if (this.slide.active) {
      this.slide.t += dt;
      if (!crouchHeld || !grounded || this.slide.t >= SLIDE_DUR) this._endSlide(now);
    }

    if (this.slide.active) {
      // momentum-based: carried speed bleeds off at a fixed rate (walls that
      // zero the velocity are respected — speed is re-read every frame) and
      // input only steers the slide direction with damped authority
      let cur = Math.max(0, Math.hypot(e.vel.x, e.vel.z) - this.slide.decel * dt);
      if (wish.lengthSq() > 0) {
        const wd = wish.clone().normalize();
        this.slide.dir.lerp(wd, Math.min(1, 3 * SLIDE_STEER * dt));
        if (this.slide.dir.lengthSq() > 1e-6) this.slide.dir.normalize();
      }
      e.vel.x = this.slide.dir.x * cur;
      e.vel.z = this.slide.dir.z * cur;
      if (cur <= crouchCap) this._endSlide(now); // momentum spent -> normal crouch
    } else if (grounded) {
      // grounded stays instant-set: counter-strafe stopping power intact
      if (wish.lengthSq() > 0) wish.normalize().multiplyScalar(speed);
      e.vel.x = wish.x;
      e.vel.z = wish.z;
    } else if (wish.lengthSq() > 0) {
      // airborne: preserve momentum, accelerate toward the wish direction;
      // steering can redirect but never push past the ground speed cap
      const wd = wish.clone().normalize();
      const cap = Math.max(hspeed, runCap);
      e.vel.x += wd.x * AIR_ACCEL * dt;
      e.vel.z += wd.z * AIR_ACCEL * dt;
      const ns = Math.hypot(e.vel.x, e.vel.z);
      if (ns > cap) {
        const f = cap / ns;
        e.vel.x *= f;
        e.vel.z *= f;
      }
    }

    // jump / gravity (arc frozen: JUMP/GRAVITY untouched)
    e.vel.y -= GRAVITY * dt;
    if (this.input.isDown('Space') && grounded && e.vel.y <= 0.1) {
      if (this.slide.active) this._endSlide(now); // slide-jump keeps momentum
      e.vel.y = JUMP;
    }

    const h = this.crouching ? HEIGHT * 0.65 : HEIGHT;
    const preVy = e.vel.y;          // vertical speed going into the collision pass
    const wasOnGround = e._onGround; // last frame's collision result
    const res = moveAndCollide(this.game.colliders, e.pos, e.vel, dt, RADIUS, h);
    e.pos.copy(res.pos);
    e.vel.copy(res.vel);
    e._onGround = res.onGround;

    // landing impact: was airborne, now grounded — dip the camera and report
    if (res.onGround && !wasOnGround && preVy < -FALL_MIN) {
      const impact = Math.min(1, (-preVy - FALL_MIN) / (FALL_MAX - FALL_MIN));
      // initial spring velocity chosen so the dip peaks at impact * DIP_MAX
      this._dipVel -= impact * DIP_MAX * DIP_OMEGA * Math.E;
      audio.land?.(impact);
    }

    // healing over time
    if (now < e.effects.healUntil) {
      e.hp = Math.min(e.maxHp, e.hp + e.effects.healRate * dt);
    }

    // --- Fire / reload ---
    finishReloadIfDue(e, now);
    const canAct = this.input.locked && this.game.state === 'playing' && !this.game.buyOpen;
    const w = e.weapon();
    if (canAct && this.input.mouse.left) {
      const wantFire = w.auto || !this._firedThisClick;
      const fired = updateShooter(this.game, e, wantFire, now);
      if (fired && !w.auto) this._firedThisClick = true;
    }
    if (!this.input.mouse.left) this._firedThisClick = false;

    // view bob + footsteps: one phase (this.bob) drives both so audio and
    // visual stay locked; cadence scales with actual horizontal speed and a
    // step fires every half bob cycle (two steps per cycle at a run)
    const hsp = Math.hypot(e.vel.x, e.vel.z);
    if (hsp > 1 && res.onGround && !this.slide.active) {
      this.bob += dt * BOB_RATE * Math.min(1, hsp / RUN);
      const step = Math.floor(this.bob / Math.PI);
      if (step !== this._stepCount) {
        this._stepCount = step;
        audio.footstep?.();
      }
    } else {
      this._stepCount = Math.floor(this.bob / Math.PI);
    }

    // --- integrate view-feel springs/lerps (camera only) ---
    const fdt = Math.min(dt, 0.05);
    this._eyeH += (h - this._eyeH) * Math.min(1, fdt * 12); // crouch/slide eye lerp
    // critically damped spring returns the landing dip in ~0.25 s
    this._dipVel += (-DIP_OMEGA * DIP_OMEGA * this._dip - 2 * DIP_OMEGA * this._dipVel) * fdt;
    this._dip += this._dipVel * fdt;
    let rollT = 0;
    if (this.slide.active) {
      // roll with the sideways component of the slide relative to the view
      const lat = this.slide.dir.x * right.x + this.slide.dir.z * right.z;
      rollT = THREE.MathUtils.clamp(SLIDE_ROLL * (0.3 + lat), -SLIDE_ROLL, SLIDE_ROLL);
    }
    this._roll += (rollT - this._roll) * Math.min(1, fdt * 10);
    this._shake.t += fdt;

    this._syncCamera(pitch, this._eyeH);
  }

  _endSlide(now) {
    if (!this.slide.active) return;
    this.slide.active = false;
    this.slide.cdUntil = now + SLIDE_COOLDOWN;
  }

  // 'damage' bus payload (emitted by game.js): directional view shake when we
  // are the victim. Kill shots are ignored (e.alive is already false) so the
  // death camera is never disturbed.
  _onDamage(d) {
    const e = this.e;
    if (!d || !d.victimIsPlayer || !e || !e.alive) return;
    const amp = Math.min(1, (d.amount || 0) / SHAKE_DMG) * SHAKE_MAX;
    if (amp <= 0) return;
    // keep whichever shake (incoming vs. still-decaying) is stronger
    if (amp < this._shake.amp * Math.exp(-this._shake.t * SHAKE_DECAY)) return;
    // push the view away from the attacker: lateral sign in view space
    let lat = 0;
    if (d.attackerPos) {
      const dx = d.attackerPos.x - e.pos.x;
      const dz = d.attackerPos.z - e.pos.z;
      const len = Math.hypot(dx, dz);
      // right vector matches the movement basis: (cos yaw, 0, -sin yaw)
      if (len > 1e-4) lat = (dx * Math.cos(e.yaw) - dz * Math.sin(e.yaw)) / len;
    }
    const dirP = -0.75;                                  // flinch pitches down
    const dirY = 0.8 * THREE.MathUtils.clamp(lat, -1, 1); // and away from the hit
    const n = Math.hypot(dirP, dirY);
    this._shake.amp = amp;
    this._shake.t = 0;
    this._shake.dirP = dirP / n;
    this._shake.dirY = dirY / n;
  }

  _syncCamera(pitch, h = HEIGHT) {
    const e = this.e;
    const eye = (h / HEIGHT) * EYE;
    const bobY = Math.sin(this.bob) * 0.03;
    // damage shake: additive rotational offset only — e.yaw/e.pitch (the aim)
    // are never displaced. Kick decays exponentially with a short wobble.
    let shakeP = 0;
    let shakeY = 0;
    if (this._shake.amp > 0) {
      const k = Math.exp(-this._shake.t * SHAKE_DECAY);
      if (k < 0.01) {
        this._shake.amp = 0;
      } else {
        const scope = this.game.scopeActive ? SHAKE_SCOPED : 1;
        const kick = this._shake.amp * k * Math.cos(this._shake.t * 34) * scope;
        shakeP = this._shake.dirP * kick;
        shakeY = this._shake.dirY * kick;
      }
    }
    this.camera.position.set(e.pos.x, e.pos.y + eye + bobY + this._dip, e.pos.z);
    // `pitch` already includes recoil.x; only add yaw recoil here.
    const euler = new THREE.Euler(pitch + shakeP, e.yaw + this.recoil.y + shakeY, this._roll, 'YXZ');
    this.camera.quaternion.setFromEuler(euler);
  }
}
