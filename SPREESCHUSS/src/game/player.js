import * as THREE from 'three';
import { moveAndCollide } from './collision.js';
import { updateShooter, finishReloadIfDue } from '../weapons/weaponsystem.js';
import { EYE, RADIUS, HEIGHT } from './entity.js';

const WALK = 5.6;
const RUN = 5.6;      // Valorant-like: base run speed
const SLOW = 2.8;     // walking (shift)
const CROUCH = 2.4;
const JUMP = 5.2;
const GRAVITY = 16;

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

    this.crouching = this.input.isDown('ControlLeft') || this.input.isDown('KeyC');
    const walking = this.input.isDown('ShiftLeft');
    const wmove = e.weapon().moveSpeed || 1;
    let speed = RUN * wmove;
    if (walking) speed = SLOW * wmove;
    if (this.crouching) speed = CROUCH * wmove;
    // slow effect
    if (now < e.effects.slowUntil) speed *= (1 - e.effects.slowAmt);

    if (wish.lengthSq() > 0) wish.normalize().multiplyScalar(speed);
    e.vel.x = wish.x;
    e.vel.z = wish.z;

    // jump / gravity
    e.vel.y -= GRAVITY * dt;
    const onGroundApprox = e.pos.y <= 0.02 || e._onGround;
    if (this.input.isDown('Space') && onGroundApprox && e.vel.y <= 0.1) {
      e.vel.y = JUMP;
    }

    const h = this.crouching ? HEIGHT * 0.65 : HEIGHT;
    const res = moveAndCollide(this.game.colliders, e.pos, e.vel, dt, RADIUS, h);
    e.pos.copy(res.pos);
    e.vel.copy(res.vel);
    e._onGround = res.onGround;

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

    // view bob
    const moved = e.vel.x * e.vel.x + e.vel.z * e.vel.z;
    if (moved > 1 && res.onGround) this.bob += dt * 10;

    this._syncCamera(pitch, h);
  }

  _syncCamera(pitch, h = HEIGHT) {
    const e = this.e;
    const eye = (h / HEIGHT) * EYE;
    const bobY = Math.sin(this.bob) * 0.03;
    this.camera.position.set(e.pos.x, e.pos.y + eye + bobY, e.pos.z);
    // `pitch` already includes recoil.x; only add yaw recoil here.
    const euler = new THREE.Euler(pitch, e.yaw + this.recoil.y, 0, 'YXZ');
    this.camera.quaternion.setFromEuler(euler);
  }
}
