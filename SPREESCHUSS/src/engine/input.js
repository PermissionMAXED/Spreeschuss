// Keyboard + mouse + pointer-lock input manager.
import { bus } from './eventbus.js';

export class Input {
  constructor(domElement) {
    this.dom = domElement;
    this.keys = new Set();
    this.mouse = { dx: 0, dy: 0, left: false, right: false };
    this.locked = false;
    this.enabled = true;
    this.sensitivity = 0.0022;
    this._bind();
  }

  _bind() {
    // Keys the game consumes — prevent browser defaults (Tab focus change,
    // Space page-scroll) so pointer lock isn't lost mid-match.
    const consumed = new Set(['Tab', 'Space', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyC', 'KeyQ', 'KeyE', 'KeyX', 'KeyR', 'KeyF', 'KeyB', 'Digit1', 'Digit2', 'Digit3']);
    window.addEventListener('keydown', (e) => {
      if (!this.enabled) return;
      if (consumed.has(e.code)) e.preventDefault();
      this.keys.add(e.code);
      bus.emit('key:down', e.code);
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      bus.emit('key:up', e.code);
    });
    document.addEventListener('mousemove', (e) => {
      if (this.locked && this.enabled) {
        this.mouse.dx += e.movementX;
        this.mouse.dy += e.movementY;
      }
    });
    document.addEventListener('mousedown', (e) => {
      if (!this.enabled) return;
      if (e.button === 0) this.mouse.left = true;
      if (e.button === 2) this.mouse.right = true;
    });
    document.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouse.left = false;
      if (e.button === 2) this.mouse.right = false;
    });
    document.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.dom;
      bus.emit('pointerlock', this.locked);
    });
  }

  requestLock() {
    if (this.dom.requestPointerLock) this.dom.requestPointerLock();
  }

  exitLock() {
    if (document.exitPointerLock) document.exitPointerLock();
  }

  isDown(code) {
    return this.keys.has(code);
  }

  // Consume accumulated mouse delta (call once per frame).
  consumeMouse() {
    const d = { dx: this.mouse.dx, dy: this.mouse.dy };
    this.mouse.dx = 0;
    this.mouse.dy = 0;
    return d;
  }
}
