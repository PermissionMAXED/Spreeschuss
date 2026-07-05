// Procedural WebAudio SFX — no external sound files.
// Every event is layered synthesis (sub thump + mid body + air crack + mechanical
// noise) built from oscillators plus one shared noise buffer, routed
// master -> high-shelf sheen -> compressor -> tanh soft-clip limiter, so any
// number of overlapping voices can never hard-clip. A small procedural
// impulse-response convolver (decaying noise burst generated once in init())
// provides a shared room-reverb send that the big sounds opt into.

import { initVoice } from './voice.js';

// Per-category gunshot recipes. Layer fields:
//   sub     – low sine thump                { f, to, d(ur), g(ain) }
//   body    – swept mid oscillator(s)       { w(ave), f, to, d, g, pair(detune cents), lp, lpTo }
//   crack   – highpass-noise air transient  { f, d, g }
//   mid     – bandpass-noise powder body    { f, to, d, g }
//   mech    – delayed action clacks         [{ f, when, d, g }]
//   ticks   – tiny dry bolt ticks           [{ f, when, g }]
//   ring    – high-Q metallic zing          { f, d, g }
//   slap    – delayed room-slap burst       { when, f, to, d, g }
//   tail    – lowpass boom tail             { f, to, d, g }
//   subTail – lingering sub after-rumble    { f, to, d, g }
//   send    – room-reverb send amount
const SHOTS = {
  // full-bodied punch, tight tail, single bolt tick — the all-rounder
  rifle: {
    sub:  { f: 145, to: 52, d: 0.13, g: 0.5 },
    body: { w: 'sawtooth', f: 265, to: 96, d: 0.1, g: 0.15, pair: 14, lp: 3200, lpTo: 850 },
    crack: { f: 2600, d: 0.045, g: 0.36 },
    mid:  { f: 1250, to: 500, d: 0.09, g: 0.26 },
    mech: [{ f: 3300, when: 0.045, d: 0.02, g: 0.09 }],
    send: 0.2,
  },
  // light, fast and dry — short layers + tiny action ticks so autofire chatters
  smg: {
    sub:  { f: 200, to: 86, d: 0.05, g: 0.24 },
    body: { w: 'sawtooth', f: 345, to: 150, d: 0.045, g: 0.17, lp: 3800, lpTo: 1400 },
    crack: { f: 3200, d: 0.028, g: 0.34 },
    mid:  { f: 1600, to: 800, d: 0.045, g: 0.2 },
    ticks: [{ f: 4300, when: 0.032, g: 0.05 }, { f: 3700, when: 0.062, g: 0.035 }],
    send: 0.07,
  },
  // rounded pistol pop with a slide clack shortly after the report
  sidearm: {
    sub:  { f: 215, to: 88, d: 0.09, g: 0.4 },
    body: { w: 'triangle', f: 430, to: 160, d: 0.07, g: 0.24, lp: 3000, lpTo: 1100 },
    crack: { f: 2700, d: 0.038, g: 0.3 },
    mid:  { f: 1050, to: 480, d: 0.08, g: 0.22 },
    mech: [{ f: 2700, when: 0.065, d: 0.022, g: 0.11 }],
    send: 0.14,
  },
  // huge: deep sub drop, long lowpass boom tail, audible bolt cycle afterwards
  sniper: {
    sub:  { f: 102, to: 34, d: 0.55, g: 0.58 },
    body: { w: 'sawtooth', f: 215, to: 56, d: 0.28, g: 0.14, pair: 10, lp: 2200, lpTo: 300 },
    crack: { f: 1800, d: 0.07, g: 0.42 },
    mid:  { f: 900, to: 260, d: 0.24, g: 0.3 },
    tail: { f: 620, to: 85, d: 1.05, g: 0.32 },
    subTail: { f: 58, to: 30, d: 0.85, g: 0.16 },
    mech: [{ f: 2300, when: 0.4, d: 0.03, g: 0.1 }, { f: 1700, when: 0.52, d: 0.03, g: 0.12 }],
    send: 0.5,
  },
  // wide low blast with an early room slap and a shk-clunk of the action
  shotgun: {
    sub:  { f: 88, to: 42, d: 0.3, g: 0.55 },
    body: { w: 'triangle', f: 132, to: 56, d: 0.28, g: 0.3, lp: 1800, lpTo: 500 },
    crack: { f: 1500, d: 0.06, g: 0.34 },
    mid:  { f: 750, to: 320, d: 0.12, g: 0.3 },
    slap: { when: 0.045, f: 900, to: 300, d: 0.16, g: 0.28 },
    tail: { f: 760, to: 190, d: 0.42, g: 0.3 },
    mech: [{ f: 1900, when: 0.24, d: 0.025, g: 0.09 }, { f: 1400, when: 0.31, d: 0.03, g: 0.11 }],
    send: 0.38,
  },
  // industrial chatter: gritty square body, metallic ring, belt/action rattle
  heavy: {
    sub:  { f: 132, to: 54, d: 0.09, g: 0.52 },
    body: { w: 'square', f: 200, to: 88, d: 0.065, g: 0.17, lp: 2100, lpTo: 700 },
    crack: { f: 1900, d: 0.03, g: 0.2 },
    mid:  { f: 720, to: 350, d: 0.07, g: 0.22 },
    ring: { f: 3150, d: 0.055, g: 0.07 },
    ticks: [{ f: 2900, when: 0.02, g: 0.07 }, { f: 2500, when: 0.045, g: 0.05 }],
    send: 0.13,
  },
};

class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.comp = null;
    this.limiter = null;
    this.sheen = null;
    this.enabled = true;
    this._volume = 0.5;
    this._noiseBuf = null;
    this._verb = null;
    this._verbIn = null;
    this._verbOut = null;
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
    // tanh soft-clip after the compressor: transients from many simultaneous
    // shots that leak through the compressor's attack can never hard-clip.
    this.limiter = this.ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) curve[i] = Math.tanh((i / 511.5) - 1);
    this.limiter.curve = curve;
    this.limiter.connect(this.ctx.destination);
    this.comp = this.ctx.createDynamicsCompressor();
    this.comp.threshold.value = -16;
    this.comp.knee.value = 18;
    this.comp.ratio.value = 5;
    this.comp.attack.value = 0.002;
    this.comp.release.value = 0.25;
    this.comp.connect(this.limiter);
    // gentle high-shelf "sheen" ahead of the compressor adds air to cracks and
    // dings; the comp + limiter behind it keep the added energy safe.
    this.sheen = this.ctx.createBiquadFilter();
    this.sheen.type = 'highshelf';
    this.sheen.frequency.value = 6800;
    this.sheen.gain.value = 2.5;
    this.sheen.connect(this.comp);
    this.master = this.ctx.createGain();
    this.master.gain.value = this._volume;
    this.master.connect(this.sheen);
    // One shared noise buffer, reused by every noise voice (random read offset
    // per voice gives variation without per-shot buffer allocation).
    const n = Math.floor(this.ctx.sampleRate * 2);
    this._noiseBuf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = this._noiseBuf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    // Shared room reverb: voices tap in via _sendTap(); the convolver's IR is
    // a procedurally generated noise burst — still no audio files. Wet return
    // feeds the master so the whole chain (volume/comp/limiter) applies.
    this._verb = this.ctx.createConvolver();
    this._verb.buffer = this._buildImpulse();
    this._verbIn = this.ctx.createGain();
    this._verbOut = this.ctx.createGain();
    // subtle wet return: the room must never duck the dry transient through
    // the compressor or read as a distinct slapback echo
    this._verbOut.gain.value = 0.22;
    this._verbIn.connect(this._verb);
    this._verb.connect(this._verbOut);
    this._verbOut.connect(this.master);
    // Procedural radio-voice callouts (voice.js). Subscribes to the bus once;
    // guarded so repeat init() calls stay idempotent.
    initVoice();
  }

  // Procedural room impulse response: stereo decaying noise burst whose tail
  // darkens as it fades (one-pole lowpass with growing smoothing), plus a few
  // discrete early reflections that give small-room "slap".
  _buildImpulse() {
    const sr = this.ctx.sampleRate;
    const len = Math.floor(sr * 0.8);
    const ir = this.ctx.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / len;
        lp += ((Math.random() * 2 - 1) - lp) * (0.75 - 0.55 * t);
        d[i] = lp * Math.pow(1 - t, 1.7);
      }
      for (const [sec, amp] of [[0.009, 0.3], [0.017, 0.24], [0.029, 0.18], [0.043, 0.13]]) {
        // slightly different reflection timing/polarity per channel = width
        d[Math.floor(sr * sec * (ch ? 1.11 : 1))] += (ch ? -amp : amp);
      }
    }
    return ir;
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') {
      const p = this.ctx.resume();
      if (p && p.catch) p.catch(() => {});
    }
  }

  _ready() {
    if (!this.enabled || !this.ctx) return false;
    this.resume();
    return true;
  }

  _rand(a, b) { return a + Math.random() * (b - a); }

  // Envelope gain node: short linear attack (clamped >= 1 ms so nothing ever
  // clicks), exponential decay, connected to master.
  _env(gain, t0, attack, dur) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + Math.max(0.001, attack));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    g.connect(this.master);
    return g;
  }

  // Optional per-voice tap into the shared room-reverb convolver. The returned
  // send gain must be disconnected together with the voice.
  _sendTap(g, amount) {
    if (!amount || !this._verbIn) return null;
    const s = this.ctx.createGain();
    s.gain.value = amount;
    g.connect(s);
    s.connect(this._verbIn);
    return s;
  }

  _tone({ type = 'sine', freq = 440, sweepTo = 0, dur = 0.15, gain = 0.3, attack = 0.004, when = 0, detune = 0, pair = 0, lp = 0, lpTo = 0, send = 0 }) {
    const t0 = this.ctx.currentTime + when;
    const g = this._env(gain, t0, attack, dur);
    const s = this._sendTap(g, send);
    let dest = g;
    let f = null;
    if (lp) {
      f = this.ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.Q.value = 0.6;
      f.frequency.setValueAtTime(Math.max(40, lp), t0);
      if (lpTo) f.frequency.exponentialRampToValueAtTime(Math.max(40, lpTo), t0 + dur);
      f.connect(g);
      dest = f;
    }
    const oscs = [];
    const make = (dt) => {
      const o = this.ctx.createOscillator();
      o.type = type;
      o.detune.value = detune + dt;
      o.frequency.setValueAtTime(Math.max(20, freq), t0);
      if (sweepTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, sweepTo), t0 + dur);
      o.connect(dest);
      o.start(t0);
      o.stop(t0 + dur + 0.03);
      oscs.push(o);
    };
    // `pair` spawns two oscillators detuned +/- cents for a chorused body
    if (pair) { make(-pair); make(pair); } else make(0);
    oscs[0].onended = () => {
      for (const o of oscs) o.disconnect();
      if (f) f.disconnect();
      g.disconnect();
      if (s) s.disconnect();
    };
  }

  _noise({ dur = 0.1, gain = 0.3, attack = 0.002, when = 0, filter = 'bandpass', freq = 1000, sweepTo = 0, Q = 0.8, send = 0 }) {
    const t0 = this.ctx.currentTime + when;
    const g = this._env(gain, t0, attack, dur);
    const s = this._sendTap(g, send);
    const f = this.ctx.createBiquadFilter();
    f.type = filter;
    f.Q.value = Q;
    f.frequency.setValueAtTime(Math.max(30, freq), t0);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(Math.max(30, sweepTo), t0 + dur);
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuf;
    src.connect(f);
    f.connect(g);
    src.onended = () => { src.disconnect(); f.disconnect(); g.disconnect(); if (s) s.disconnect(); };
    const offset = Math.random() * Math.max(0, this._noiseBuf.duration - dur - 0.05);
    src.start(t0, offset, dur + 0.05);
  }

  // Short bandpass-noise transient: mag catches, bolt clacks, action ticks.
  _click({ f = 2200, when = 0, gain = 0.15, dur = 0.018, q = 1.6, send = 0 }) {
    this._noise({ filter: 'bandpass', freq: f, Q: q, dur, gain, attack: 0.001, when, send });
  }

  // Low mechanical body knock (square edge + sine weight dropping in pitch).
  _knock({ f = 180, when = 0, gain = 0.15, dur = 0.05 }) {
    this._tone({ type: 'square', freq: f, sweepTo: f * 0.7, dur, gain: gain * 0.7, attack: 0.0015, when });
    this._tone({ type: 'sine', freq: f * 0.6, sweepTo: f * 0.4, dur: dur * 1.5, gain, attack: 0.002, when });
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
    if (cat === 'melee') {
      // swing whoosh: rising bandpass sweep + blade shimmer + faint low body
      const v = this._rand(0.85, 1.15);
      this._noise({ filter: 'bandpass', freq: 460 * this._rand(0.9, 1.1), sweepTo: 2100, Q: 1.5, dur: 0.14, gain: 0.3 * v, attack: 0.018 });
      this._noise({ filter: 'bandpass', freq: 3600, sweepTo: 6200, Q: 6, dur: 0.09, gain: 0.06 * v, attack: 0.012, when: 0.015 });
      this._tone({ type: 'triangle', freq: 330, sweepTo: 165, dur: 0.11, gain: 0.11 * v, attack: 0.015 });
      return;
    }
    const p = SHOTS[cat] || SHOTS.rifle;
    // per-shot jitter so autofire never sounds machine-stamped
    const v = this._rand(0.86, 1.14);   // loudness
    const fj = this._rand(0.94, 1.06);  // oscillator pitch
    const cj = this._rand(0.9, 1.1);    // filter cutoffs
    const det = this._rand(-38, 38);    // body detune (cents)
    const send = p.send;
    const su = p.sub;
    this._tone({ type: 'sine', freq: su.f * fj, sweepTo: su.to, dur: su.d, gain: su.g * v, attack: 0.0015, send: send * 0.25 });
    const b = p.body;
    this._tone({ type: b.w, freq: b.f * fj, sweepTo: b.to, dur: b.d, gain: b.g * v, detune: det, pair: b.pair || 0, lp: b.lp ? b.lp * cj : 0, lpTo: b.lpTo || 0, attack: 0.0012, send: send * 0.6 });
    const c = p.crack;
    this._noise({ filter: 'highpass', freq: c.f * cj, Q: 0.7, dur: c.d, gain: c.g * v, attack: 0.001, send });
    if (p.mid) this._noise({ filter: 'bandpass', freq: p.mid.f * cj, sweepTo: p.mid.to, Q: 0.9, dur: p.mid.d, gain: p.mid.g * v, attack: 0.0015, send: send * 0.8 });
    if (p.ring) this._noise({ filter: 'bandpass', freq: p.ring.f * cj, Q: 9, dur: p.ring.d, gain: p.ring.g * v, attack: 0.001, send });
    if (p.mech) for (const m of p.mech) this._click({ f: m.f, when: m.when + this._rand(0, 0.012), dur: m.d, gain: m.g * v });
    if (p.ticks) for (const tk of p.ticks) this._click({ f: tk.f, when: tk.when + this._rand(0, 0.008), dur: 0.012, gain: tk.g * v, q: 3 });
    if (p.slap) this._noise({ filter: 'bandpass', freq: p.slap.f, sweepTo: p.slap.to, Q: 1.1, dur: p.slap.d, gain: p.slap.g * v, attack: 0.002, when: p.slap.when, send });
    if (p.tail) this._noise({ filter: 'lowpass', freq: p.tail.f * cj, sweepTo: p.tail.to, Q: 0.5, dur: p.tail.d, gain: p.tail.g * v, attack: 0.004, send });
    if (p.subTail) this._tone({ type: 'sine', freq: p.subTail.f, sweepTo: p.subTail.to, dur: p.subTail.d, gain: p.subTail.g * v, attack: 0.01, when: 0.03, send: send * 0.2 });
  }

  // ------------------------------------------------------------------ feedback
  hit() {
    if (!this._ready()) return;
    const fj = this._rand(0.96, 1.04); // tiny pitch wobble avoids autofire fatigue
    this._tone({ type: 'square', freq: 950 * fj, sweepTo: 1300 * fj, dur: 0.035, gain: 0.19, attack: 0.001 });
    this._tone({ type: 'sine', freq: 1900 * fj, dur: 0.025, gain: 0.06, attack: 0.001 });
    this._noise({ filter: 'highpass', freq: 3800, dur: 0.02, gain: 0.09, attack: 0.001 });
  }

  headshot() {
    if (!this._ready()) return;
    // small metallic bell: inharmonic partial stack (loose minor-third bell
    // profile) + strike noise; clearly above hit() in the feedback hierarchy
    const f = 1380;
    this._tone({ type: 'sine', freq: f, dur: 0.3, gain: 0.27, attack: 0.001, send: 0.3 });
    this._tone({ type: 'sine', freq: f * 2.0, dur: 0.2, gain: 0.11, attack: 0.001, send: 0.3 });
    this._tone({ type: 'sine', freq: f * 2.76, dur: 0.14, gain: 0.07, attack: 0.001, send: 0.3 });
    this._tone({ type: 'sine', freq: f * 4.07, dur: 0.09, gain: 0.04, attack: 0.001 });
    this._noise({ filter: 'highpass', freq: 6000, dur: 0.02, gain: 0.07, attack: 0.001 });
  }

  death() {
    if (!this._ready()) return;
    // kill confirm: heavy sub pitch-drop + growl through a closing lowpass +
    // noise whoomp + delayed body-drop thud — the biggest feedback event
    this._tone({ type: 'sine', freq: 160, sweepTo: 38, dur: 0.42, gain: 0.46, attack: 0.002, send: 0.1 });
    this._tone({ type: 'sawtooth', freq: 430, sweepTo: 110, dur: 0.34, gain: 0.16, attack: 0.003, pair: 16, lp: 1500, lpTo: 240, send: 0.25 });
    this._noise({ filter: 'bandpass', freq: 520, sweepTo: 160, Q: 0.8, dur: 0.28, gain: 0.22, attack: 0.002, send: 0.3 });
    this._knock({ f: 95, when: 0.12, gain: 0.18, dur: 0.06 });
  }

  reload() {
    if (!this._ready()) return;
    // Three mechanical stages scheduled on the audio clock across the 2.0 s
    // reload window (weaponsystem sets `reloadUntil = now + 2.0`).
    // stage 1 (~0.1 s): mag release click, slide-out scrape, mag-away thock
    this._click({ f: 2600, when: 0.1, gain: 0.2, dur: 0.02 });
    this._noise({ filter: 'bandpass', freq: 1150, sweepTo: 700, Q: 1.8, dur: 0.09, gain: 0.11, attack: 0.012, when: 0.13 });
    this._knock({ f: 165, when: 0.16, gain: 0.16 });
    // stage 2 (~1.0 s): fresh mag slides up and seats with a firm clack
    this._noise({ filter: 'bandpass', freq: 700, sweepTo: 1250, Q: 1.8, dur: 0.08, gain: 0.1, attack: 0.012, when: 0.98 });
    this._click({ f: 1600, when: 1.07, gain: 0.26, dur: 0.026 });
    this._knock({ f: 230, when: 1.07, gain: 0.18, dur: 0.045 });
    // stage 3 (~1.55 s): charging handle back (click + spring zing), then the
    // bolt slams home just before the window closes
    this._click({ f: 2400, when: 1.52, gain: 0.16, dur: 0.02 });
    this._tone({ type: 'triangle', freq: 720, sweepTo: 1150, dur: 0.07, gain: 0.07, attack: 0.004, when: 1.54 });
    this._noise({ filter: 'bandpass', freq: 3200, sweepTo: 4600, Q: 5, dur: 0.06, gain: 0.05, attack: 0.003, when: 1.54 });
    this._click({ f: 1300, when: 1.66, gain: 0.28, dur: 0.03 });
    this._knock({ f: 200, when: 1.66, gain: 0.14, dur: 0.04 });
  }

  plant() {
    if (!this._ready()) return;
    // arming tension: beating square cluster over a sub throb, repeated once,
    // then a rising "armed" confirmation chirp
    this._tone({ type: 'square', freq: 380, dur: 0.1, gain: 0.16, attack: 0.002 });
    this._tone({ type: 'square', freq: 404, dur: 0.1, gain: 0.1, attack: 0.002 });
    this._tone({ type: 'sine', freq: 92, dur: 0.16, gain: 0.3, attack: 0.003 });
    this._tone({ type: 'square', freq: 380, dur: 0.09, gain: 0.14, attack: 0.002, when: 0.16 });
    this._tone({ type: 'sine', freq: 92, dur: 0.12, gain: 0.22, attack: 0.003, when: 0.16 });
    this._tone({ type: 'sine', freq: 640, sweepTo: 1280, dur: 0.09, gain: 0.1, attack: 0.002, when: 0.3 });
  }

  beep(f = 660) {
    if (!this._ready()) return;
    // kept fully compatible for round-start (700 Hz) and trap alerts (400 Hz);
    // a soft octave above and a warm half-octave body round out the tone
    this._tone({ type: 'sine', freq: f, dur: 0.1, gain: 0.22, attack: 0.004 });
    this._tone({ type: 'sine', freq: f * 2, dur: 0.07, gain: 0.05, attack: 0.004 });
    this._tone({ type: 'triangle', freq: f * 0.5, dur: 0.09, gain: 0.05, attack: 0.004 });
  }

  ability() {
    if (!this._ready()) return;
    // airy rising swoosh: bandpass sweep + chorused triangle + late sparkle
    this._noise({ filter: 'bandpass', freq: 340, sweepTo: 1500, Q: 1.3, dur: 0.28, gain: 0.24, attack: 0.025, send: 0.2 });
    this._tone({ type: 'triangle', freq: 420, sweepTo: 860, dur: 0.24, gain: 0.1, attack: 0.02, pair: 12, send: 0.2 });
    this._tone({ type: 'sine', freq: 1680, sweepTo: 2500, dur: 0.18, gain: 0.035, attack: 0.03, when: 0.05 });
  }

  buy() {
    if (!this._ready()) return;
    // two plucks a fourth apart + a tiny register "ting"
    this._pluck(880, 0, 0.12, 0.8);
    this._pluck(1174.7, 0.07, 0.16, 1);
    this._tone({ type: 'sine', freq: 2349.3, dur: 0.06, gain: 0.04, attack: 0.002, when: 0.07 });
  }

  // -------------------------------------------------------------- movement foley
  // Cheap by design (2-3 voices each) — these fire many times per second
  // while running, so heavy randomization does the anti-fatigue work instead
  // of extra layers.
  footstep() {
    if (!this._ready()) return;
    // sole scuff: short bandpass noise tap, pitch/level/time jittered so a
    // long run reads as steps, never a machine-gun loop
    const fj = this._rand(0.78, 1.28);      // wide pitch spread per step
    const v = this._rand(0.65, 1.0);        // level spread
    const w = this._rand(0, 0.014);         // micro timing offset
    this._noise({ filter: 'bandpass', freq: 1050 * fj, sweepTo: 480 * fj, Q: 1.1, dur: 0.03, gain: 0.075 * v, attack: 0.002, when: w });
    // tiny heel knock underneath; skipped sometimes so step pairs differ
    if (Math.random() < 0.8) {
      this._tone({ type: 'sine', freq: this._rand(105, 150), sweepTo: 70, dur: 0.035, gain: 0.075 * v, attack: 0.002, when: w });
    }
    // occasional faint grit tick on top (dust/gravel variation)
    if (Math.random() < 0.3) {
      this._click({ f: this._rand(2600, 4200), when: w + this._rand(0.004, 0.012), dur: 0.01, gain: 0.02 * v, q: 2.5 });
    }
  }

  land(intensity = 0.5) {
    if (!this._ready()) return;
    const k = Math.min(1, Math.max(0, intensity));
    const v = this._rand(0.9, 1.1);
    // sub knock: body weight arriving, deeper + longer the harder the fall
    this._tone({ type: 'sine', freq: (120 - 35 * k) * v, sweepTo: 42, dur: 0.08 + 0.09 * k, gain: (0.14 + 0.3 * k) * v, attack: 0.002 });
    this._knock({ f: 150 * this._rand(0.92, 1.08), gain: 0.06 + 0.12 * k, dur: 0.045 });
    // noise chuff: boots + gear compressing on impact
    this._noise({ filter: 'bandpass', freq: 620 * this._rand(0.85, 1.15), sweepTo: 240, Q: 0.9, dur: 0.06 + 0.07 * k, gain: 0.05 + 0.14 * k, attack: 0.002 });
    // hard landings add a short high scuff on top
    if (k > 0.55) this._noise({ filter: 'highpass', freq: 2600, dur: 0.03, gain: 0.06 * k, attack: 0.001 });
  }

  slide() {
    if (!this._ready()) return;
    const fj = this._rand(0.88, 1.14);
    // main scrape: broadband noise through a falling bandpass — fabric and
    // boot soles losing speed against the floor
    this._noise({ filter: 'bandpass', freq: 1500 * fj, sweepTo: 260, Q: 0.8, dur: 0.35, gain: 0.16, attack: 0.02 });
    // darker friction bed underneath, fading with the scrape
    this._noise({ filter: 'lowpass', freq: 520 * fj, sweepTo: 150, Q: 0.5, dur: 0.32, gain: 0.1, attack: 0.03 });
    // entry scuff as the slide starts
    this._noise({ filter: 'highpass', freq: 3200, dur: 0.04, gain: 0.045, attack: 0.003 });
  }

  // -------------------------------------------------------------- stingers
  // Shared stinger instrument: fast pluck on top of a detuned-saw pad.
  _pluck(f, when, dur, vel = 1) {
    this._tone({ type: 'triangle', freq: f, dur, gain: 0.17 * vel, attack: 0.002, when, send: 0.25 });
    this._tone({ type: 'sine', freq: f * 2, dur: dur * 0.55, gain: 0.05 * vel, attack: 0.002, when });
  }

  _pad(f, when, dur, vel = 1, bright = true) {
    this._tone({ type: 'sawtooth', freq: f, dur, gain: 0.075 * vel, attack: 0.02, when, pair: 9, lp: f * (bright ? 6 : 3), lpTo: f * 1.6, send: 0.35 });
  }

  _note(f, when, dur, vel = 1, bright = true) {
    this._pluck(f, when, dur * 0.6, vel);
    this._pad(f, when, dur, vel, bright);
  }

  win() {
    if (!this._ready()) return;
    // rising five-note major fanfare (C E G B C) over a C3 pad bed
    this._pad(130.81, 0, 1.5, 0.9, true);
    const N = [[523.25, 0, 0.3, 0.9], [659.25, 0.11, 0.3, 0.9], [783.99, 0.22, 0.3, 0.95], [987.77, 0.34, 0.34, 1], [1046.5, 0.48, 0.9, 1.1]];
    for (const [f, w, d, vel] of N) this._note(f, w, d, vel, true);
  }

  lose() {
    if (!this._ready()) return;
    // sagging five-note minor descent (D C A F D) over a dark D2 pad bed
    this._pad(73.42, 0, 1.9, 1, false);
    const N = [[587.33, 0, 0.34, 1], [523.25, 0.14, 0.34, 0.95], [440, 0.28, 0.36, 0.9], [349.23, 0.44, 0.4, 0.9], [293.66, 0.62, 1.1, 1]];
    for (const [f, w, d, vel] of N) this._note(f, w, d, vel, false);
  }
}

export const audio = new AudioEngine();
