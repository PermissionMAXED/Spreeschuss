// Procedural WebAudio SFX — no external sound files.
// Layered synthesis (low thump + filtered-noise crack + pitch-swept body) routed
// through master gain -> compressor so overlapping gunfire doesn't clip.
class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.comp = null;
    this.limiter = null;
    this.enabled = true;
    this._volume = 0.5;
    this._noiseBuf = null;
  }

  // `volume` stays a plain-looking field but live-updates the master gain.
  get volume() { return this._volume; }
  set volume(v) {
    this._volume = v;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
  }

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    this.comp = this.ctx.createDynamicsCompressor();
    this.comp.threshold.value = -16;
    this.comp.knee.value = 18;
    this.comp.ratio.value = 5;
    this.comp.attack.value = 0.002;
    this.comp.release.value = 0.25;
    // tanh soft-clip after the compressor: transients from many simultaneous
    // shots that leak through the compressor's attack can never hard-clip.
    this.limiter = this.ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) curve[i] = Math.tanh((i / 511.5) - 1);
    this.limiter.curve = curve;
    this.limiter.connect(this.ctx.destination);
    this.comp.connect(this.limiter);
    this.master = this.ctx.createGain();
    this.master.gain.value = this._volume;
    this.master.connect(this.comp);
    // One shared noise buffer, reused by every noise voice (random read offset
    // per voice gives variation without per-shot buffer allocation).
    const n = Math.floor(this.ctx.sampleRate * 2);
    this._noiseBuf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = this._noiseBuf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  _ready() {
    if (!this.enabled || !this.ctx) return false;
    this.resume();
    return true;
  }

  _rand(a, b) { return a + Math.random() * (b - a); }

  // Envelope gain node: short linear attack, exponential decay, connected to master.
  _env(gain, t0, attack, dur) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    g.connect(this.master);
    return g;
  }

  _tone({ type = 'sine', freq = 440, sweepTo = 0, dur = 0.15, gain = 0.3, attack = 0.004, when = 0, detune = 0 }) {
    const t0 = this.ctx.currentTime + when;
    const g = this._env(gain, t0, attack, dur);
    const o = this.ctx.createOscillator();
    o.type = type;
    if (detune) o.detune.value = detune;
    o.frequency.setValueAtTime(Math.max(20, freq), t0);
    if (sweepTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, sweepTo), t0 + dur);
    o.connect(g);
    o.onended = () => { o.disconnect(); g.disconnect(); };
    o.start(t0);
    o.stop(t0 + dur + 0.03);
  }

  _noise({ dur = 0.1, gain = 0.3, attack = 0.002, when = 0, filter = 'bandpass', freq = 1000, sweepTo = 0, Q = 0.8 }) {
    const t0 = this.ctx.currentTime + when;
    const g = this._env(gain, t0, attack, dur);
    const f = this.ctx.createBiquadFilter();
    f.type = filter;
    f.Q.value = Q;
    f.frequency.setValueAtTime(Math.max(30, freq), t0);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(Math.max(30, sweepTo), t0 + dur);
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuf;
    src.connect(f);
    f.connect(g);
    src.onended = () => { src.disconnect(); f.disconnect(); g.disconnect(); };
    const offset = Math.random() * Math.max(0, this._noiseBuf.duration - dur - 0.05);
    src.start(t0, offset, dur + 0.05);
  }

  // Legacy one-voice helper kept for API compatibility.
  play({ type = 'sine', freq = 440, dur = 0.15, gain = 0.4, sweep = 0, noise = false }) {
    if (!this._ready()) return;
    if (noise) this._noise({ freq, dur, gain });
    else this._tone({ type, freq, sweepTo: sweep ? freq + sweep : 0, dur, gain });
  }

  // ------------------------------------------------------------------ gunshots
  shoot(cat = 'rifle') {
    if (!this._ready()) return;
    const P = {
      //         low "thump"                          swept "body" osc                        noise "crack" (highpass)        noise mid/tail
      rifle:   { th: [150, 55, 0.13, 0.5, 'sine'],     bo: [290, 100, 0.09, 0.2, 'sawtooth'],  cr: [2500, 0.05, 0.34],  md: { f: 1300, to: 520, d: 0.09, g: 0.28 } },
      smg:     { th: [185, 72, 0.07, 0.38, 'sine'],    bo: [330, 135, 0.05, 0.15, 'sawtooth'], cr: [3000, 0.03, 0.28],  md: { f: 1500, to: 750, d: 0.05, g: 0.2 } },
      sidearm: { th: [215, 82, 0.09, 0.42, 'sine'],    bo: [390, 145, 0.07, 0.18, 'triangle'], cr: [2200, 0.04, 0.3],   md: { f: 1050, to: 500, d: 0.08, g: 0.24 } },
      sniper:  { th: [110, 38, 0.5, 0.58, 'sine'],     bo: [230, 60, 0.24, 0.22, 'sawtooth'],  cr: [2000, 0.06, 0.4],   md: { f: 950, to: 300, d: 0.2, g: 0.28 },
                 tail: { f: 520, to: 120, d: 0.7, g: 0.32 } },
      shotgun: { th: [92, 44, 0.3, 0.55, 'sine'],      bo: [135, 58, 0.28, 0.3, 'triangle'],   cr: [1800, 0.05, 0.3],
                 tail: { f: 900, to: 210, d: 0.34, g: 0.42 } },
      heavy:   { th: [145, 62, 0.08, 0.44, 'sine'],    bo: [260, 110, 0.06, 0.16, 'square'],   cr: [2200, 0.035, 0.24], md: { f: 850, to: 420, d: 0.07, g: 0.26 } },
      melee:   null, // whoosh, handled below
    };
    if (cat === 'melee') {
      // swing whoosh: rising bandpass sweep + faint low body, no crack
      const v = this._rand(0.85, 1.15);
      this._noise({ filter: 'bandpass', freq: 480 * this._rand(0.92, 1.08), sweepTo: 1900, Q: 1.4, dur: 0.13, gain: 0.3 * v, attack: 0.02 });
      this._tone({ type: 'triangle', freq: 330, sweepTo: 170, dur: 0.11, gain: 0.11 * v, attack: 0.015 });
      return;
    }
    const p = P[cat] || P.rifle;
    // slight per-shot variation so autofire doesn't sound machine-stamped
    const v = this._rand(0.88, 1.12);
    const fj = this._rand(0.95, 1.05);
    const det = this._rand(-35, 35);
    const [tf, tt, td, tg, tw] = p.th;
    this._tone({ type: tw, freq: tf * fj, sweepTo: tt, dur: td, gain: tg * v, attack: 0.003 });
    const [bf, bt, bd, bg, bw] = p.bo;
    this._tone({ type: bw, freq: bf * fj, sweepTo: bt, dur: bd, gain: bg * v, detune: det, attack: 0.002 });
    const [cf, cd, cg] = p.cr;
    this._noise({ filter: 'highpass', freq: cf * fj, Q: 0.7, dur: cd, gain: cg * v, attack: 0.001 });
    if (p.md) this._noise({ filter: 'bandpass', freq: p.md.f * fj, sweepTo: p.md.to, Q: 0.9, dur: p.md.d, gain: p.md.g * v });
    if (p.tail) this._noise({ filter: 'lowpass', freq: p.tail.f, sweepTo: p.tail.to, Q: 0.5, dur: p.tail.d, gain: p.tail.g * v, attack: 0.004 });
  }

  // ------------------------------------------------------------------ feedback
  hit() {
    if (!this._ready()) return;
    this._tone({ type: 'square', freq: 960, sweepTo: 1280, dur: 0.035, gain: 0.2, attack: 0.001 });
    this._noise({ filter: 'highpass', freq: 3500, dur: 0.02, gain: 0.1, attack: 0.001 });
  }

  headshot() {
    if (!this._ready()) return;
    // bright two-partial ding
    this._tone({ type: 'sine', freq: 1560, dur: 0.11, gain: 0.28, attack: 0.001 });
    this._tone({ type: 'sine', freq: 2340, dur: 0.08, gain: 0.13, attack: 0.001 });
    this._noise({ filter: 'highpass', freq: 5000, dur: 0.02, gain: 0.08, attack: 0.001 });
  }

  death() {
    if (!this._ready()) return;
    // kill confirmation: low thud + descending growl
    this._tone({ type: 'sine', freq: 125, sweepTo: 45, dur: 0.26, gain: 0.42, attack: 0.003 });
    this._tone({ type: 'sawtooth', freq: 520, sweepTo: 150, dur: 0.3, gain: 0.18, attack: 0.004 });
    this._noise({ filter: 'bandpass', freq: 650, sweepTo: 220, Q: 0.8, dur: 0.18, gain: 0.2 });
  }

  reload() {
    if (!this._ready()) return;
    // stage 1: mag out (click + low blip)
    this._noise({ filter: 'highpass', freq: 1800, dur: 0.025, gain: 0.24, attack: 0.001 });
    this._tone({ type: 'square', freq: 165, dur: 0.05, gain: 0.16, attack: 0.002 });
    // stage 2: mag in + bolt (clack + spring), scheduled on the audio clock
    this._noise({ filter: 'highpass', freq: 1400, dur: 0.03, gain: 0.28, attack: 0.001, when: 0.24 });
    this._tone({ type: 'square', freq: 235, dur: 0.05, gain: 0.18, attack: 0.002, when: 0.24 });
    this._tone({ type: 'triangle', freq: 720, sweepTo: 1050, dur: 0.06, gain: 0.07, attack: 0.004, when: 0.27 });
  }

  plant() {
    if (!this._ready()) return;
    // tense arming pulse: two low squares + sub
    this._tone({ type: 'square', freq: 385, dur: 0.09, gain: 0.22, attack: 0.003 });
    this._tone({ type: 'sine', freq: 96, dur: 0.16, gain: 0.28, attack: 0.004 });
    this._tone({ type: 'square', freq: 320, dur: 0.09, gain: 0.18, attack: 0.003, when: 0.13 });
  }

  beep(f = 660) {
    if (!this._ready()) return;
    this._tone({ type: 'sine', freq: f, dur: 0.09, gain: 0.22, attack: 0.004 });
    this._tone({ type: 'sine', freq: f * 2, dur: 0.06, gain: 0.05, attack: 0.004 });
  }

  ability() {
    if (!this._ready()) return;
    // smooth swoosh: rising bandpass noise + soft triangle underlay
    this._noise({ filter: 'bandpass', freq: 350, sweepTo: 1400, Q: 1.2, dur: 0.28, gain: 0.26, attack: 0.03 });
    this._tone({ type: 'triangle', freq: 420, sweepTo: 840, dur: 0.24, gain: 0.12, attack: 0.02 });
  }

  buy() {
    if (!this._ready()) return;
    this._tone({ type: 'sine', freq: 880, dur: 0.05, gain: 0.18, attack: 0.003 });
    this._tone({ type: 'sine', freq: 1175, dur: 0.06, gain: 0.16, attack: 0.003, when: 0.07 });
  }

  _stingerNote(f, when, dur, bright) {
    this._tone({ type: 'triangle', freq: f, dur, gain: 0.2, attack: 0.005, when });
    this._tone({ type: 'sine', freq: f * 2, dur: dur * 0.7, gain: bright ? 0.07 : 0.03, attack: 0.005, when });
  }

  win() {
    if (!this._ready()) return;
    [523, 659, 784, 1046].forEach((f, i) => this._stingerNote(f, i * 0.12, 0.22, true));
  }

  lose() {
    if (!this._ready()) return;
    [523, 440, 349, 262].forEach((f, i) => this._stingerNote(f, i * 0.14, 0.26, false));
  }
}

export const audio = new AudioEngine();
