// Procedural WebAudio SFX — no external sound files.
class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.enabled = true;
    this.volume = 0.5;
  }

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(this.ctx.destination);
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  _noiseBuffer(dur) {
    const n = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  play({ type = 'sine', freq = 440, dur = 0.15, gain = 0.4, sweep = 0, noise = false }) {
    if (!this.enabled || !this.ctx) return;
    this.resume();
    const t = this.ctx.currentTime;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    g.connect(this.master);
    if (noise) {
      const src = this.ctx.createBufferSource();
      src.buffer = this._noiseBuffer(dur);
      const filt = this.ctx.createBiquadFilter();
      filt.type = 'bandpass';
      filt.frequency.value = freq;
      src.connect(filt);
      filt.connect(g);
      src.start(t);
      src.stop(t + dur);
    } else {
      const o = this.ctx.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(freq, t);
      if (sweep) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + sweep), t + dur);
      o.connect(g);
      o.start(t);
      o.stop(t + dur);
    }
  }

  shoot(cat = 'rifle') {
    const map = {
      rifle: { freq: 220, dur: 0.12, sweep: -140, gain: 0.35 },
      smg: { freq: 260, dur: 0.08, sweep: -120, gain: 0.28 },
      sidearm: { freq: 300, dur: 0.1, sweep: -160, gain: 0.3 },
      sniper: { freq: 140, dur: 0.3, sweep: -90, gain: 0.5 },
      shotgun: { freq: 120, dur: 0.25, sweep: -70, gain: 0.5 },
      heavy: { freq: 200, dur: 0.1, sweep: -110, gain: 0.32 },
      melee: { freq: 500, dur: 0.08, sweep: -200, gain: 0.25 },
    };
    const c = map[cat] || map.rifle;
    this.play({ type: 'sawtooth', ...c });
    this.play({ noise: true, freq: 900, dur: c.dur * 0.6, gain: c.gain * 0.5 });
  }

  hit() { this.play({ type: 'square', freq: 900, dur: 0.05, gain: 0.25, sweep: 300 }); }
  headshot() { this.play({ type: 'square', freq: 1400, dur: 0.08, gain: 0.35, sweep: 500 }); }
  reload() { this.play({ type: 'square', freq: 180, dur: 0.06, gain: 0.2 }); setTimeout(() => this.play({ type: 'square', freq: 220, dur: 0.06, gain: 0.2 }), 120); }
  death() { this.play({ type: 'sawtooth', freq: 300, dur: 0.4, gain: 0.3, sweep: -220 }); }
  plant() { this.play({ type: 'square', freq: 400, dur: 0.1, gain: 0.3 }); }
  beep(f = 660) { this.play({ type: 'sine', freq: f, dur: 0.08, gain: 0.25 }); }
  ability() { this.play({ type: 'triangle', freq: 520, dur: 0.2, gain: 0.3, sweep: 260 }); }
  win() { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this.beep(f), i * 120)); }
  lose() { [523, 440, 349, 262].forEach((f, i) => setTimeout(() => this.beep(f), i * 140)); }
  buy() { this.play({ type: 'sine', freq: 880, dur: 0.06, gain: 0.2 }); }
}

export const audio = new AudioEngine();
