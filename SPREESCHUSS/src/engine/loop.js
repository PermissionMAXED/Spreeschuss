// Fixed-timestep game loop with render callback.
export class Loop {
  constructor(update, render, step = 1 / 120) {
    this.update = update;
    this.render = render;
    this.step = step;
    this.acc = 0;
    this.last = 0;
    this.running = false;
    this._raf = this._raf.bind(this);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now() / 1000;
    requestAnimationFrame(this._raf);
  }

  stop() {
    this.running = false;
  }

  _raf() {
    if (!this.running) return;
    const now = performance.now() / 1000;
    let dt = now - this.last;
    this.last = now;
    if (dt > 0.25) dt = 0.25; // clamp after tab switch
    this.acc += dt;
    let guard = 0;
    while (this.acc >= this.step && guard < 8) {
      this.update(this.step);
      this.acc -= this.step;
      guard++;
    }
    this.render(dt, this.acc / this.step);
    requestAnimationFrame(this._raf);
  }
}
