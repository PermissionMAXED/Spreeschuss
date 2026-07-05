// Procedural RADIO VOICE — no speech samples, no speechSynthesis.
// Stylized "team comms" gibberish: each line is 1-7 syllabic bursts. A
// syllable is two parallel bandpass-filtered pulse/saw oscillators (formant
// F1/F2 bands) sweeping between vowel-like filter pairs, fronted by a tiny
// consonant noise burst. Lines are dressed as radio traffic: everything runs
// through a drive -> 300-3000 Hz band -> presence peak chain, with a subtle
// static bed underneath and a squelch click at both ends.
//
// Per-agent identity: base pitch (±30 %), syllable rate and filter character
// (formant scale = vocal-tract length, formant Q, waveform, F2 balance) are
// all seeded from a hash of the agentId, so the 16 agents get 16 stable,
// recognizable voices while the syllables themselves stay randomized.
//
// Mix discipline: the whole voice bus tops out at VOICE_GAIN (0.22 <= 0.25)
// and feeds audio.master, so the shared sheen -> compressor -> tanh limiter
// chain applies and gunfire ducks the radio naturally.

import { audio } from './audio.js';
import { bus } from '../engine/eventbus.js';

const VOICE_GAIN = 0.22;      // hard mix ceiling for the whole radio bus
const LINE_COOLDOWN = 4;      // >= 4 s between line starts; also skips overlap

// Vowel-ish formant pairs [F1, F2] in Hz (scaled per agent). Loosely the
// German a/e/i/o/u/ä space — cadence sells it, no real words needed.
const VOWELS = [
  [700, 1220], // a
  [530, 1840], // e
  [400, 2100], // i
  [560, 850],  // o
  [430, 1020], // u
  [640, 1600], // ä
];

// ------------------------------------------------------------- seeded rng
function hashStr(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Stable per-agent voice profile derived from the id hash. Cached: the same
// agent always sounds like the same operator on the net.
const profiles = new Map();
function profileFor(id) {
  let p = profiles.get(id);
  if (p) return p;
  const r = mulberry32(hashStr(String(id)));
  p = {
    base: 108 * (0.7 + 0.6 * r()),          // fundamental, ±30 % around ~108 Hz
    rate: 0.85 + 0.4 * r(),                 // syllables per second multiplier
    formant: 0.84 + 0.34 * r(),             // vocal-tract scale on F1/F2
    q: 5.5 + 6 * r(),                       // formant filter sharpness
    waveA: r() < 0.55 ? 'sawtooth' : 'square', // buzzy vs hollow chest tone
    f2bal: 0.4 + 0.45 * r(),                // brightness: F2 band level
    octB: r() < 0.35 ? 2 : 1,               // some voices double F2 an octave up
    drift: 0.03 + 0.05 * r(),               // intra-syllable pitch glide depth
  };
  profiles.set(id, p);
  return p;
}

// --------------------------------------------------------- shared radio bus
// Built lazily once the engine context exists (init() is a user gesture):
// lineIn -> tanh drive -> highpass 300 -> lowpass 3000 -> presence peak
// -> VOICE_GAIN -> audio.master. Never touches ctx.destination directly.
let chain = null;
function radioChain() {
  if (chain) return chain;
  const ctx = audio.ctx;
  const input = ctx.createGain();
  input.gain.value = 1;
  const drive = ctx.createWaveShaper();
  const curve = new Float32Array(512);
  for (let i = 0; i < 512; i++) curve[i] = Math.tanh(((i / 255.5) - 1) * 2.6) / Math.tanh(2.6);
  drive.curve = curve;
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass'; hp.frequency.value = 300; hp.Q.value = 0.7;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass'; lp.frequency.value = 3000; lp.Q.value = 0.7;
  const peak = ctx.createBiquadFilter();
  peak.type = 'peaking'; peak.frequency.value = 1800; peak.Q.value = 1; peak.gain.value = 4;
  const out = ctx.createGain();
  out.gain.value = VOICE_GAIN;
  input.connect(drive); drive.connect(hp); hp.connect(lp); lp.connect(peak); peak.connect(out);
  out.connect(audio.master);
  chain = { input };
  return chain;
}

// ----------------------------------------------------------- line elements
function squelch(lineIn, t0, open) {
  const ctx = audio.ctx;
  const g = ctx.createGain();
  const dur = open ? 0.03 : 0.022;
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(open ? 0.5 : 0.4, t0 + 0.002);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass'; f.Q.value = 1.2;
  f.frequency.setValueAtTime(2400, t0);
  const src = ctx.createBufferSource();
  src.buffer = audio._noiseBuf;
  src.connect(f); f.connect(g); g.connect(lineIn);
  src.start(t0, Math.random() * 1.5, dur + 0.02);
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(open ? 1750 : 1500, t0);
  const og = ctx.createGain();
  og.gain.setValueAtTime(0, t0);
  og.gain.linearRampToValueAtTime(0.12, t0 + 0.002);
  og.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  o.connect(og); og.connect(lineIn);
  o.start(t0); o.stop(t0 + dur + 0.02);
  return { nodes: [g, f, og], osc: o };
}

function staticBed(lineIn, t0, dur) {
  const ctx = audio.ctx;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(0.05, t0 + 0.02);
  g.gain.setValueAtTime(0.05, t0 + dur - 0.03);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur + 0.04);
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass'; f.frequency.setValueAtTime(1300, t0); f.Q.value = 0.4;
  const src = ctx.createBufferSource();
  src.buffer = audio._noiseBuf;
  src.connect(f); f.connect(g); g.connect(lineIn);
  src.start(t0, Math.random() * 0.5, dur + 0.08);
  return [g, f];
}

// One syllable: consonant noise tick, then two oscillators voiced through
// F1/F2 bandpass filters whose centers glide vowel -> vowel.
function syllable(lineIn, p, t0, dur, f0, f0End, loud) {
  const ctx = audio.ctx;
  const nodes = [];
  const v1 = VOWELS[(Math.random() * VOWELS.length) | 0];
  const v2 = VOWELS[(Math.random() * VOWELS.length) | 0];

  // consonant: 12-20 ms filtered noise burst right at onset (skipped
  // sometimes so lines don't sound stamped from one mold)
  if (Math.random() < 0.75) {
    const cd = 0.012 + Math.random() * 0.008;
    const cg = ctx.createGain();
    cg.gain.setValueAtTime(0, t0);
    cg.gain.linearRampToValueAtTime(0.3 * loud, t0 + 0.002);
    cg.gain.exponentialRampToValueAtTime(0.001, t0 + cd);
    const cf = ctx.createBiquadFilter();
    cf.type = 'bandpass'; cf.Q.value = 1.8;
    cf.frequency.setValueAtTime(1500 + Math.random() * 3000, t0);
    const cs = ctx.createBufferSource();
    cs.buffer = audio._noiseBuf;
    cs.connect(cf); cf.connect(cg); cg.connect(lineIn);
    cs.start(t0, Math.random() * 1.5, cd + 0.02);
    nodes.push(cg, cf);
  }

  // voiced body envelope: fast attack, held, released before the gap
  const von = t0 + 0.012;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, von);
  g.gain.linearRampToValueAtTime(loud, von + 0.014);
  g.gain.setValueAtTime(loud, von + dur * 0.6);
  g.gain.exponentialRampToValueAtTime(0.001, von + dur);
  g.connect(lineIn);
  nodes.push(g);

  const stop = von + dur + 0.03;
  const mk = (wave, fMul, band, bandTo, level) => {
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.Q.value = p.q;
    bp.frequency.setValueAtTime(Math.max(80, band), von);
    bp.frequency.exponentialRampToValueAtTime(Math.max(80, bandTo), von + dur);
    const lg = ctx.createGain();
    lg.gain.value = level;
    const o = ctx.createOscillator();
    o.type = wave;
    o.frequency.setValueAtTime(Math.max(30, f0 * fMul), von);
    o.frequency.exponentialRampToValueAtTime(Math.max(30, f0End * fMul), von + dur);
    o.detune.value = (Math.random() - 0.5) * 14;
    o.connect(bp); bp.connect(lg); lg.connect(g);
    o.start(von); o.stop(stop);
    nodes.push(bp, lg);
  };
  const s = p.formant;
  mk(p.waveA, 1, v1[0] * s, v2[0] * s, 1);
  mk('square', p.octB, v1[1] * s, v2[1] * s, p.f2bal);
  return { nodes, end: stop };
}

// ------------------------------------------------------------------ speaker
let nextOkAt = -Infinity; // ctx-clock throttle: no overlap, >= 4 s spacing

// opts: { syllables, urgency 0..1, endRise, bark }
function say(profileId, opts = {}) {
  if (!audio.enabled || !audio.ctx || !audio.master || !audio._noiseBuf) return;
  audio.resume();
  const ctx = audio.ctx;
  const now = ctx.currentTime;
  if (now < nextOkAt) return; // one line at a time + cooldown
  const p = profileFor(profileId);
  const urgency = Math.min(1, Math.max(0, opts.urgency ?? 0.4));
  const n = opts.bark ? 1 : Math.max(1, Math.min(7, opts.syllables ?? 4));
  const lineIn = radioChain().input;
  const t0 = now + 0.02;
  const nodes = [];

  // schedule syllables first to learn the line length
  let t = t0 + 0.045; // after the opening squelch
  for (let i = 0; i < n; i++) {
    // 90-140 ms per syllable, compressed when urgent / a fast talker
    let dur = (0.095 + Math.random() * 0.045) / (p.rate * (1 + 0.3 * urgency));
    dur = Math.min(0.14, Math.max(0.09, dur));
    if (opts.bark) dur = 0.16; // pained bark: one longer strained burst
    // pitch contour: gentle declination, urgency lifts the whole line,
    // final syllable rises (confirm/urgent) or falls (statement)
    const pos = n > 1 ? i / (n - 1) : 1;
    const jit = 1 + (Math.random() - 0.5) * 0.1;
    let f0 = p.base * (1.05 - 0.1 * pos) * (1 + 0.22 * urgency) * jit;
    let f0End = f0 * (1 + (Math.random() - 0.5) * 2 * p.drift);
    if (i === n - 1) f0End = f0 * (opts.endRise ? 1.16 : 0.86);
    if (opts.bark) { f0 *= 1.75; f0End = f0 * 0.55; } // strained yelp, falling
    const loud = (0.5 + Math.random() * 0.2) * (1 + 0.25 * urgency) * (opts.bark ? 1.3 : 1);
    const sy = syllable(lineIn, p, t, dur, f0, f0End, Math.min(1, loud));
    nodes.push(...sy.nodes);
    const gap = (0.02 + Math.random() * 0.035) * (1 - 0.5 * urgency);
    t = sy.end - 0.03 + gap + 0.012;
  }
  const lineEnd = t + 0.03;

  nodes.push(...squelch(lineIn, t0, true).nodes);
  nodes.push(...staticBed(lineIn, t0, lineEnd - t0));
  // closing squelch is the last thing scheduled: its oscillator ending is
  // the safe moment to tear the whole line's node graph down
  const close = squelch(lineIn, lineEnd, false);
  nodes.push(...close.nodes);
  close.osc.onended = () => { for (const nd of nodes) nd.disconnect(); };

  nextOkAt = t0 + Math.max(LINE_COOLDOWN, lineEnd - t0 + 0.25);
}

// --------------------------------------------------------------- bus wiring
// Syllable counts per ability key: basics are short calls, the ult is the
// longest, most urgent line on the net.
const KEY_SYL = { C: 3, Q: 4, E: 5, X: 7 };

let wired = false;
export function initVoice() {
  if (wired) return; // audio.init() is idempotent; so is this
  wired = true;

  // player casts: that agent's own voice, longer + hotter for the ult
  bus.on('ability:cast', (e) => {
    if (!e || !e.isPlayer) return;
    say(e.agentId, {
      syllables: e.ult ? 7 : (KEY_SYL[e.key] ?? 4),
      urgency: e.ult ? 0.95 : 0.45,
    });
  });

  // player got the frag: short rising confirmation chirp-line
  bus.on('kill', (e) => {
    if (!e || !e.player || e.attacker !== 'Du') return;
    say('funk-du', { syllables: 2 + ((Math.random() * 2) | 0), urgency: 0.35, endRise: true });
  });

  // spike down: urgent generic team radio
  bus.on('spike:planted', () => {
    say('funk-team', { syllables: 5, urgency: 0.9 });
  });

  // round start: brief squelch + two-syllable check-in
  bus.on('round:start', () => {
    say('funk-team', { syllables: 2, urgency: 0.15 });
  });

  // hard flash on the player: pained short bark
  bus.on('flash', (e) => {
    if (!e || !(e.intensity > 0.6)) return;
    say('funk-pain', { bark: true, urgency: 0.8 });
  });
}
