import type { AudioPort } from "../core/contracts/platform";
import {
  AUDIO_ASSET_CUES,
  type AudioAssetKey,
  type SoundRequest,
} from "./contracts";
import {
  type MusicMixer,
  type MusicTheme,
  type MusicTrack,
} from "./music-director";
import {
  type NoiseVoice,
  ProceduralSynthBank,
  type SynthVoiceOutput,
  type ToneVoice,
} from "./synth-bank";
import type { SfxPlayer } from "./sound-director";

type FoundationEffect = Parameters<AudioPort["play"]>[0];
type ContextFactory = () => AudioContext;

const FOUNDATION_CUES: Readonly<Record<FoundationEffect, SoundRequest["cue"]>> = {
  happy: "pet",
  munch: "chew",
  sleep: "sleep",
  wake: "wake",
  tap: "ui-tap",
};

interface ThemeSpec {
  readonly root: number;
  readonly bpm: number;
  readonly scale: readonly number[];
  readonly warmth: number;
  readonly pulse: number;
}

const THEME_SPECS: Readonly<Record<MusicTheme, ThemeSpec>> = {
  "home-cozy": { root: 261.63, bpm: 76, scale: [0, 4, 7, 11, 7, 4, 2, 7], warmth: 0.85, pulse: 0.18 },
  "home-kitchen": { root: 293.66, bpm: 94, scale: [0, 7, 4, 9, 7, 12, 9, 4], warmth: 0.72, pulse: 0.3 },
  "home-bubbles": { root: 329.63, bpm: 88, scale: [0, 4, 9, 7, 12, 9, 7, 4], warmth: 0.62, pulse: 0.15 },
  "home-dream": { root: 220, bpm: 62, scale: [0, 7, 3, 10, 7, 3, 5, 7], warmth: 0.92, pulse: 0.08 },
  "home-garden": { root: 293.66, bpm: 82, scale: [0, 4, 7, 9, 12, 9, 7, 4], warmth: 0.76, pulse: 0.22 },
  "city-drive": { root: 196, bpm: 112, scale: [0, 7, 10, 12, 7, 15, 10, 7], warmth: 0.54, pulse: 0.52 },
  "shop-market": { root: 261.63, bpm: 104, scale: [0, 4, 7, 12, 9, 7, 4, 11], warmth: 0.7, pulse: 0.36 },
  "shop-boutique": { root: 311.13, bpm: 92, scale: [0, 4, 11, 7, 14, 11, 7, 4], warmth: 0.64, pulse: 0.24 },
  "shop-salon": { root: 349.23, bpm: 98, scale: [0, 7, 4, 11, 9, 14, 11, 7], warmth: 0.6, pulse: 0.32 },
  "minigame-bouncy": { root: 329.63, bpm: 132, scale: [0, 7, 12, 4, 9, 16, 12, 7], warmth: 0.44, pulse: 0.62 },
  "minigame-focus": { root: 246.94, bpm: 106, scale: [0, 3, 7, 10, 12, 10, 7, 3], warmth: 0.66, pulse: 0.38 },
  "minigame-rhythm": { root: 220, bpm: 124, scale: [0, 7, 3, 10, 12, 15, 10, 7], warmth: 0.48, pulse: 0.7 },
  lullaby: { root: 196, bpm: 54, scale: [0, 7, 3, 7, 10, 7, 3, 5], warmth: 1, pulse: 0.04 },
};

function automateGain(parameter: AudioParam, value: number, seconds: number, now: number): void {
  parameter.cancelScheduledValues(now);
  parameter.setValueAtTime(Math.max(0.0001, parameter.value), now);
  parameter.exponentialRampToValueAtTime(Math.max(0.0001, value), now + Math.max(0.006, seconds));
}

class WebMusicTrack implements MusicTrack {
  private source: AudioBufferSourceNode | null = null;
  private gainNode: GainNode | null = null;
  private targetGain: number;
  private stopped = false;

  constructor(
    readonly theme: MusicTheme,
    initialGain: number,
    private readonly owner: GoobyWebAudioEngine,
  ) {
    this.targetGain = initialGain;
  }

  activate(context: AudioContext, destination: AudioNode, buffer: AudioBuffer): void {
    if (this.stopped || this.source) return;
    const source = context.createBufferSource();
    const gainNode = context.createGain();
    source.buffer = buffer;
    source.loop = true;
    gainNode.gain.value = Math.max(0.0001, this.targetGain);
    source.connect(gainNode).connect(destination);
    source.start();
    source.onended = () => this.owner.releaseTrack(this);
    this.source = source;
    this.gainNode = gainNode;
  }

  setGain(gain: number, fadeSeconds: number): void {
    this.targetGain = Math.max(0, gain);
    const context = this.owner.audioContext;
    if (context && this.gainNode) automateGain(this.gainNode.gain, this.targetGain, fadeSeconds, context.currentTime);
  }

  stop(fadeSeconds: number): void {
    if (this.stopped) return;
    this.stopped = true;
    const context = this.owner.audioContext;
    if (!context || !this.source || !this.gainNode) {
      this.owner.releaseTrack(this);
      return;
    }
    automateGain(this.gainNode.gain, 0, fadeSeconds, context.currentTime);
    this.source.stop(context.currentTime + Math.max(0.01, fadeSeconds));
  }

  dispose(): void {
    this.source?.disconnect();
    this.gainNode?.disconnect();
    this.source = null;
    this.gainNode = null;
  }
}

export class GoobyWebAudioEngine implements AudioPort, SfxPlayer, MusicMixer, SynthVoiceOutput {
  private context: AudioContext | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private sfxGain: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private duckGain: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private readonly musicBuffers = new Map<MusicTheme, AudioBuffer>();
  private readonly tracks: WebMusicTrack[] = [];
  private readonly synth = new ProceduralSynthBank(this);
  private sfxMuted = false;
  private musicMuted = false;

  constructor(private readonly contextFactory: ContextFactory = () => new AudioContext()) {}

  get audioContext(): AudioContext | null {
    return this.context;
  }

  get unlocked(): boolean {
    return this.context?.state === "running";
  }

  async unlock(): Promise<void> {
    if (!this.context) this.buildGraph(this.contextFactory());
    if (this.context?.state === "suspended") await this.context.resume();
    this.activateTracks();
  }

  play(effect: FoundationEffect): void;
  play(request: SoundRequest): void;
  play(effectOrRequest: FoundationEffect | SoundRequest): void {
    if (!this.context || this.context.state !== "running" || this.sfxMuted) return;
    if (typeof effectOrRequest === "string") {
      this.synth.play(FOUNDATION_CUES[effectOrRequest]);
      return;
    }
    this.synth.play(effectOrRequest.cue, effectOrRequest.pitch, effectOrRequest.gain);
  }

  playAsset(key: AudioAssetKey, pitch = 1, gain = 1): void {
    if (!this.context || this.context.state !== "running" || this.sfxMuted) return;
    this.synth.play(AUDIO_ASSET_CUES[key], pitch, gain);
  }

  setMuted(muted: boolean): void {
    this.sfxMuted = muted;
    const context = this.context;
    if (context && this.sfxGain) automateGain(this.sfxGain.gain, muted ? 0 : 1, 0.06, context.currentTime);
  }

  start(theme: MusicTheme, initialGain: number): MusicTrack {
    const track = new WebMusicTrack(theme, initialGain, this);
    this.tracks.push(track);
    const context = this.context;
    if (context && this.musicGain) track.activate(context, this.musicGain, this.musicBuffer(theme));
    return track;
  }

  setMasterGain(gain: number, fadeSeconds: number): void {
    this.musicMuted = gain <= 0;
    const context = this.context;
    if (context && this.duckGain) automateGain(this.duckGain.gain, gain, fadeSeconds, context.currentTime);
  }

  duck(gain: number, durationSeconds: number): void {
    const context = this.context;
    const duck = this.duckGain;
    if (!context || !duck || this.musicMuted) return;
    const now = context.currentTime;
    duck.gain.cancelScheduledValues(now);
    duck.gain.setValueAtTime(Math.max(0.0001, duck.gain.value), now);
    duck.gain.exponentialRampToValueAtTime(Math.max(0.0001, gain), now + 0.035);
    duck.gain.setValueAtTime(Math.max(0.0001, gain), now + Math.max(0.04, durationSeconds));
    duck.gain.exponentialRampToValueAtTime(1, now + Math.max(0.04, durationSeconds) + 0.18);
  }

  tone(voice: ToneVoice, pitch: number, gain: number): void {
    const context = this.context;
    const destination = this.sfxGain;
    if (!context || !destination) return;
    const at = context.currentTime + voice.offset;
    const oscillator = context.createOscillator();
    const envelope = context.createGain();
    oscillator.type = voice.wave;
    oscillator.frequency.setValueAtTime(Math.max(20, voice.frequency * pitch), at);
    if (voice.endFrequency !== undefined) {
      oscillator.frequency.exponentialRampToValueAtTime(
        Math.max(20, voice.endFrequency * pitch),
        at + voice.duration,
      );
    }
    envelope.gain.setValueAtTime(0.0001, at);
    envelope.gain.exponentialRampToValueAtTime(Math.max(0.0001, voice.gain * gain), at + voice.attack);
    envelope.gain.exponentialRampToValueAtTime(0.0001, at + voice.duration);
    oscillator.connect(envelope).connect(destination);
    oscillator.start(at);
    oscillator.stop(at + voice.duration + 0.01);
  }

  noise(voice: NoiseVoice, pitch: number, gain: number): void {
    const context = this.context;
    const destination = this.sfxGain;
    if (!context || !destination || !this.noiseBuffer) return;
    const at = context.currentTime + voice.offset;
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const envelope = context.createGain();
    source.buffer = this.noiseBuffer;
    source.loop = true;
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(Math.max(40, voice.frequency * pitch), at);
    filter.Q.value = 0.75;
    envelope.gain.setValueAtTime(0.0001, at);
    envelope.gain.exponentialRampToValueAtTime(Math.max(0.0001, voice.gain * gain), at + voice.attack);
    envelope.gain.exponentialRampToValueAtTime(0.0001, at + voice.duration);
    source.connect(filter).connect(envelope).connect(destination);
    source.start(at);
    source.stop(at + voice.duration + 0.01);
  }

  releaseTrack(track: WebMusicTrack): void {
    const index = this.tracks.indexOf(track);
    if (index >= 0) this.tracks.splice(index, 1);
    track.dispose();
  }

  dispose(): void {
    for (const track of [...this.tracks]) track.dispose();
    this.tracks.length = 0;
    this.musicBuffers.clear();
    this.noiseBuffer = null;
    this.compressor?.disconnect();
    this.sfxGain?.disconnect();
    this.musicGain?.disconnect();
    this.duckGain?.disconnect();
    if (this.context) void this.context.close();
    this.context = null;
    this.compressor = null;
    this.sfxGain = null;
    this.musicGain = null;
    this.duckGain = null;
  }

  private buildGraph(context: AudioContext): void {
    this.context = context;
    this.compressor = context.createDynamicsCompressor();
    this.compressor.threshold.value = -12;
    this.compressor.knee.value = 18;
    this.compressor.ratio.value = 5;
    this.sfxGain = context.createGain();
    this.musicGain = context.createGain();
    this.duckGain = context.createGain();
    this.sfxGain.gain.value = this.sfxMuted ? 0.0001 : 1;
    this.duckGain.gain.value = this.musicMuted ? 0.0001 : 1;
    this.musicGain.gain.value = 0.34;
    this.sfxGain.connect(this.compressor);
    this.musicGain.connect(this.duckGain).connect(this.compressor);
    this.compressor.connect(context.destination);
    this.noiseBuffer = this.createNoiseBuffer(context);
  }

  private activateTracks(): void {
    const context = this.context;
    const destination = this.musicGain;
    if (!context || !destination) return;
    for (const track of this.tracks) track.activate(context, destination, this.musicBuffer(track.theme));
  }

  private createNoiseBuffer(context: AudioContext): AudioBuffer {
    const buffer = context.createBuffer(1, context.sampleRate, context.sampleRate);
    const data = buffer.getChannelData(0);
    let seed = 0x6d2b79f5;
    for (let index = 0; index < data.length; index += 1) {
      seed = (Math.imul(seed ^ (seed >>> 15), seed | 1) + 0x9e3779b9) | 0;
      data[index] = ((seed >>> 0) / 2_147_483_648 - 1) * 0.72;
    }
    return buffer;
  }

  private musicBuffer(theme: MusicTheme): AudioBuffer {
    const existing = this.musicBuffers.get(theme);
    if (existing) return existing;
    const context = this.context;
    if (!context) throw new Error("Audio context is not initialized");
    const spec = THEME_SPECS[theme];
    const beats = 8;
    const seconds = beats * 60 / spec.bpm;
    const frameCount = Math.ceil(seconds * context.sampleRate);
    const buffer = context.createBuffer(1, frameCount, context.sampleRate);
    const data = buffer.getChannelData(0);
    const beatSeconds = 60 / spec.bpm;
    for (let index = 0; index < frameCount; index += 1) {
      const time = index / context.sampleRate;
      const beatPosition = time / beatSeconds;
      const step = Math.floor(beatPosition) % spec.scale.length;
      const phase = beatPosition - Math.floor(beatPosition);
      const semitone = spec.scale[step] ?? 0;
      const frequency = spec.root * 2 ** (semitone / 12);
      const noteEnvelope = Math.min(1, phase * 14) * Math.max(0, 1 - phase) ** 1.8;
      const melody = Math.sin(Math.PI * 2 * frequency * time) * noteEnvelope * 0.11;
      const soft = Math.sin(Math.PI * 2 * frequency * 0.5 * time) * spec.warmth * 0.055;
      const pulseEnvelope = Math.max(0, 1 - phase * 7);
      const pulse = Math.sin(Math.PI * 2 * 72 * time) * pulseEnvelope * spec.pulse * 0.045;
      data[index] = Math.tanh(melody + soft + pulse);
    }
    this.musicBuffers.set(theme, buffer);
    return buffer;
  }
}
