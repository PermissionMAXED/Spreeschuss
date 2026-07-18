import type { AudioPort } from "../core/contracts/platform";
import {
  AUDIO_BUSES,
  clampBusVolume,
  DEFAULT_AUDIO_BUS_VOLUMES,
  type AudioBus,
  type AudioBusVolumes,
} from "../core/contracts/audio";
import {
  AUDIO_ASSET_CUES,
  busForCue,
  type AudioAssetKey,
  type PlaybackBus,
  type ResolvedAudioFile,
  type RuntimeAudioFile,
  type RuntimeAudioManifest,
  type RuntimeAudioManifestRecord,
  type SoundRequest,
  type SoundCue,
  type VolumeSettings,
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
type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export const BUS_RAMP_SECONDS = 0.03;
export const DEFAULT_AUDIO_MANIFEST_URL = "/assets/audio/manifest.json";

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
  home: { root: 261.63, bpm: 76, scale: [0, 4, 7, 11, 7, 4, 2, 7], warmth: 0.85, pulse: 0.18 },
  city: { root: 196, bpm: 112, scale: [0, 7, 10, 12, 7, 15, 10, 7], warmth: 0.54, pulse: 0.52 },
  shop: { root: 311.13, bpm: 96, scale: [0, 4, 11, 7, 14, 11, 7, 4], warmth: 0.66, pulse: 0.28 },
  calm: { root: 246.94, bpm: 72, scale: [0, 3, 7, 10, 12, 10, 7, 3], warmth: 0.82, pulse: 0.12 },
  action: { root: 329.63, bpm: 132, scale: [0, 7, 12, 4, 9, 16, 12, 7], warmth: 0.44, pulse: 0.62 },
  lullaby: { root: 196, bpm: 54, scale: [0, 7, 3, 7, 10, 7, 3, 5], warmth: 1, pulse: 0.04 },
  surf: { root: 220, bpm: 124, scale: [0, 7, 4, 11, 14, 11, 7, 4], warmth: 0.48, pulse: 0.7 },
  cake: { root: 293.66, bpm: 108, scale: [0, 4, 7, 12, 9, 16, 12, 7], warmth: 0.7, pulse: 0.4 },
};

export function automateGain(parameter: AudioParam, value: number, seconds: number, now: number): void {
  parameter.cancelScheduledValues(now);
  parameter.setValueAtTime(parameter.value, now);
  parameter.linearRampToValueAtTime(clampBusVolume(value), now + Math.max(BUS_RAMP_SECONDS, seconds));
}

const AUDIO_EXTENSION = /\.(?:m4a|mp3|wav)$/iu;

function manifestRecordFile(record: RuntimeAudioManifestRecord | string | undefined): RuntimeAudioFile | null {
  if (typeof record === "string") return { path: record };
  if (!record) return null;
  if (typeof record.output === "string") {
    return {
      path: record.output,
      ...(record.loopStartSeconds === undefined ? {} : { loopStartSeconds: record.loopStartSeconds }),
      ...(record.loopEndSeconds === undefined ? {} : { loopEndSeconds: record.loopEndSeconds }),
    };
  }
  if (record.output && typeof record.output.path === "string") {
    return {
      ...record.output,
      ...(record.output.loopStartSeconds === undefined && record.loopStartSeconds !== undefined
        ? { loopStartSeconds: record.loopStartSeconds }
        : {}),
      ...(record.output.loopEndSeconds === undefined && record.loopEndSeconds !== undefined
        ? { loopEndSeconds: record.loopEndSeconds }
        : {}),
    };
  }
  if (typeof record.path === "string") {
    return {
      path: record.path,
      ...(record.loopStartSeconds === undefined ? {} : { loopStartSeconds: record.loopStartSeconds }),
      ...(record.loopEndSeconds === undefined ? {} : { loopEndSeconds: record.loopEndSeconds }),
    };
  }
  return null;
}

/** Reads one optional same-origin runtime manifest and caches every decode promise. */
export class SameOriginAudioResolver {
  private manifestPromise: Promise<RuntimeAudioManifest | null> | null = null;
  private readonly decoded = new Map<string, Promise<AudioBuffer | null>>();
  private _fallbackCount = 0;

  constructor(
    private readonly fetcher: Fetcher = globalThis.fetch.bind(globalThis),
    private readonly manifestUrl = DEFAULT_AUDIO_MANIFEST_URL,
    private readonly origin = globalThis.location?.origin ?? "http://localhost",
  ) {}

  get fallbackCount(): number {
    return this._fallbackCount;
  }

  get cacheSize(): number {
    return this.decoded.size;
  }

  async resolveSfx(cue: SoundCue, context: AudioContext): Promise<{ file: ResolvedAudioFile; buffer: AudioBuffer } | null> {
    const aliases = [cue, `sfx.${cue}`, `audio.${cue}`];
    for (const [assetKey, mappedCue] of Object.entries(AUDIO_ASSET_CUES)) {
      if (mappedCue === cue) aliases.push(assetKey);
    }
    return this.resolve(aliases, "sfx", context);
  }

  async resolveMusic(theme: MusicTheme, context: AudioContext): Promise<{ file: ResolvedAudioFile; buffer: AudioBuffer } | null> {
    return this.resolve([theme, `music.${theme}`], "music", context);
  }

  noteFallback(): void {
    this._fallbackCount += 1;
  }

  private async resolve(
    aliases: readonly string[],
    section: "sfx" | "music",
    context: AudioContext,
  ): Promise<{ file: ResolvedAudioFile; buffer: AudioBuffer } | null> {
    const manifest = await this.manifest();
    const sections = [manifest?.[section], manifest?.cues, manifest?.keys];
    let raw: RuntimeAudioFile | null = null;
    for (const alias of aliases) {
      for (const records of sections) {
        raw = manifestRecordFile(records?.[alias]);
        if (raw) break;
      }
      if (raw) break;
    }
    const file = raw ? this.safeFile(raw) : null;
    if (!file) return null;
    const buffer = await this.decode(file.url, context);
    return buffer ? { file, buffer } : null;
  }

  private manifest(): Promise<RuntimeAudioManifest | null> {
    if (this.manifestPromise) return this.manifestPromise;
    this.manifestPromise = (async () => {
      try {
        const url = new URL(this.manifestUrl, this.origin);
        if (url.origin !== this.origin) return null;
        const response = await this.fetcher(url.href, { credentials: "same-origin" });
        if (!response.ok) return null;
        const parsed: unknown = await response.json();
        if (!parsed || typeof parsed !== "object") return null;
        const manifest = parsed as Partial<RuntimeAudioManifest>;
        return manifest.schemaVersion === 1 && (manifest.domain === undefined || manifest.domain === "audio")
          ? manifest as RuntimeAudioManifest
          : null;
      } catch {
        return null;
      }
    })();
    return this.manifestPromise;
  }

  private safeFile(file: RuntimeAudioFile): ResolvedAudioFile | null {
    try {
      const url = new URL(file.path, `${this.origin}/`);
      if (url.origin !== this.origin || !AUDIO_EXTENSION.test(url.pathname)) return null;
      const loopStartSeconds = Number.isFinite(file.loopStartSeconds) && (file.loopStartSeconds ?? -1) >= 0
        ? file.loopStartSeconds
        : undefined;
      const loopEndSeconds = Number.isFinite(file.loopEndSeconds) && (file.loopEndSeconds ?? 0) > 0
        ? file.loopEndSeconds
        : undefined;
      return {
        path: file.path,
        url: url.href,
        ...(loopStartSeconds === undefined ? {} : { loopStartSeconds }),
        ...(loopEndSeconds === undefined ? {} : { loopEndSeconds }),
      };
    } catch {
      return null;
    }
  }

  private decode(url: string, context: AudioContext): Promise<AudioBuffer | null> {
    const cached = this.decoded.get(url);
    if (cached) return cached;
    const decoded = (async () => {
      try {
        const response = await this.fetcher(url, { credentials: "same-origin" });
        if (!response.ok) return null;
        const bytes = await response.arrayBuffer();
        return await context.decodeAudioData(bytes.slice(0));
      } catch {
        return null;
      }
    })();
    this.decoded.set(url, decoded);
    return decoded;
  }
}

class WebMusicTrack implements MusicTrack {
  private source: AudioBufferSourceNode | null = null;
  private gainNode: GainNode | null = null;
  private readonly initialGain: number;
  private targetGain: number;
  private pendingFadeSeconds = 0;
  private stopped = false;
  private activating = false;

  constructor(
    readonly theme: MusicTheme,
    initialGain: number,
    private readonly owner: GoobyWebAudioEngine,
  ) {
    this.initialGain = initialGain;
    this.targetGain = initialGain;
  }

  activate(context: AudioContext, destination: AudioNode): void {
    if (this.stopped || this.source || this.activating) return;
    this.activating = true;
    void this.owner.musicSource(this.theme).then(({ buffer, file }) => {
      this.activating = false;
      if (this.stopped || this.source || this.owner.audioContext !== context) return;
      const source = context.createBufferSource();
      const gainNode = context.createGain();
      source.buffer = buffer;
      source.loop = true;
      const loopStart = Math.min(file?.loopStartSeconds ?? 0, buffer.duration);
      const loopEnd = Math.min(file?.loopEndSeconds ?? buffer.duration, buffer.duration);
      if (loopEnd > loopStart) {
        source.loopStart = loopStart;
        source.loopEnd = loopEnd;
      }
      gainNode.gain.value = this.initialGain;
      source.connect(gainNode).connect(destination);
      source.start();
      source.onended = () => this.owner.releaseTrack(this);
      this.source = source;
      this.gainNode = gainNode;
      if (this.targetGain !== this.initialGain) {
        automateGain(gainNode.gain, this.targetGain, this.pendingFadeSeconds, context.currentTime);
      }
    });
  }

  setGain(gain: number, fadeSeconds: number): void {
    this.targetGain = Math.max(0, gain);
    this.pendingFadeSeconds = fadeSeconds;
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
    this.activating = false;
  }
}

export class GoobyWebAudioEngine implements AudioPort, SfxPlayer, MusicMixer, SynthVoiceOutput {
  private context: AudioContext | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private masterGain: GainNode | null = null;
  private readonly busGains: Partial<Record<AudioBus, GainNode>> = {};
  private musicMixGain: GainNode | null = null;
  private duckGain: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private readonly musicBuffers = new Map<MusicTheme, AudioBuffer>();
  private readonly tracks: WebMusicTrack[] = [];
  private readonly synth = new ProceduralSynthBank(this);
  private musicMuted = false;
  private muted = false;
  private paused = false;
  private wantsRunning = false;
  private settingsVolumes: AudioBusVolumes = DEFAULT_AUDIO_BUS_VOLUMES;
  private voicePriority = Number.NEGATIVE_INFINITY;
  private readonly activeVoiceSources = new Set<AudioScheduledSourceNode>();

  constructor(
    private readonly contextFactory: ContextFactory = () => new AudioContext(),
    readonly files: SameOriginAudioResolver = new SameOriginAudioResolver(),
  ) {}

  get audioContext(): AudioContext | null {
    return this.context;
  }

  get unlocked(): boolean {
    return this.context?.state === "running";
  }

  get volumes(): AudioBusVolumes {
    return this.settingsVolumes;
  }

  get isMuted(): boolean {
    return this.muted;
  }

  get fallbackCount(): number {
    return this.files.fallbackCount;
  }

  async unlock(): Promise<void> {
    this.wantsRunning = true;
    if (!this.context) this.buildGraph(this.contextFactory());
    if (!this.paused && this.context?.state === "suspended") await this.context.resume();
    this.activateTracks();
  }

  play(effect: FoundationEffect): void;
  play(request: SoundRequest): void;
  play(effectOrRequest: FoundationEffect | SoundRequest): void {
    if (!this.context || this.context.state !== "running" || this.muted) return;
    if (typeof effectOrRequest === "string") {
      const cue = FOUNDATION_CUES[effectOrRequest];
      void this.playResolved({ cue, bus: busForCue(cue), group: "gooby", pitch: 1, gain: 1, duckMusic: false });
      return;
    }
    void this.playResolved(effectOrRequest);
  }

  playAsset(key: AudioAssetKey, pitch = 1, gain = 1): void {
    const cue = AUDIO_ASSET_CUES[key];
    this.play({ cue, bus: busForCue(cue), group: "gooby", pitch, gain, duckMusic: false });
  }

  setMuted(muted: boolean): void {
    if (muted === this.muted) return;
    this.muted = muted;
    const context = this.context;
    if (context && this.masterGain) {
      automateGain(
        this.masterGain.gain,
        muted ? 0 : this.settingsVolumes.master,
        BUS_RAMP_SECONDS,
        context.currentTime,
      );
    }
  }

  setBusVolume(bus: AudioBus, volume: number): void {
    const clamped = clampBusVolume(volume);
    if (this.settingsVolumes[bus] === clamped) return;
    this.settingsVolumes = Object.freeze({ ...this.settingsVolumes, [bus]: clamped });
    const context = this.context;
    const gain = bus === "master" ? this.masterGain : this.busGains[bus];
    if (!context || !gain) return;
    automateGain(
      gain.gain,
      bus === "master" && this.muted ? 0 : clamped,
      BUS_RAMP_SECONDS,
      context.currentTime,
    );
  }

  applySettings(settings: VolumeSettings): void {
    if (settings.muted) this.setMuted(true);
    for (const bus of AUDIO_BUSES) this.setBusVolume(bus, settings.volumes[bus]);
    if (!settings.muted) this.setMuted(false);
  }

  start(theme: MusicTheme, initialGain: number): MusicTrack {
    const track = new WebMusicTrack(theme, initialGain, this);
    this.tracks.push(track);
    const context = this.context;
    const musicBus = this.busGains.music;
    if (context && musicBus) track.activate(context, musicBus);
    return track;
  }

  setMasterGain(gain: number, fadeSeconds: number): void {
    this.musicMuted = gain <= 0;
    const context = this.context;
    if (context && this.musicMixGain) automateGain(this.musicMixGain.gain, gain, fadeSeconds, context.currentTime);
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

  setPaused(paused: boolean): void {
    if (paused === this.paused) return;
    this.paused = paused;
    const context = this.context;
    if (!context) return;
    if (paused) {
      void context.suspend().then(() => {
        if (!this.paused && this.wantsRunning) {
          void context.resume().then(() => this.activateTracks()).catch(() => undefined);
        }
      }).catch(() => undefined);
    } else if (this.wantsRunning) {
      void context.resume().then(() => this.activateTracks()).catch(() => undefined);
    }
  }

  tone(voice: ToneVoice, pitch: number, gain: number, bus: PlaybackBus = "sfx"): void {
    const context = this.context;
    const destination = this.busGains[bus];
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
    if (bus === "voice") this.trackVoiceSource(oscillator);
    oscillator.start(at);
    oscillator.stop(at + voice.duration + 0.01);
  }

  noise(voice: NoiseVoice, pitch: number, gain: number, bus: PlaybackBus = "sfx"): void {
    const context = this.context;
    const destination = this.busGains[bus];
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
    if (bus === "voice") this.trackVoiceSource(source);
    source.start(at);
    source.stop(at + voice.duration + 0.01);
  }

  private async playResolved(request: SoundRequest): Promise<void> {
    const context = this.context;
    if (!context || context.state !== "running" || this.muted) return;
    const priority = request.priority ?? 0;
    const resolved = await this.files.resolveSfx(request.cue, context);
    if (this.context !== context || context.state !== "running" || this.muted) return;
    if (request.bus === "voice" && priority < this.voicePriority && this.activeVoiceSources.size > 0) return;
    if (request.bus === "voice") this.prepareVoice(priority);
    if (resolved) {
      this.playBuffer(resolved.buffer, request, context);
      return;
    }
    this.files.noteFallback();
    this.synth.play(request.cue, request.pitch, request.gain, request.bus);
  }

  private playBuffer(buffer: AudioBuffer, request: SoundRequest, context: AudioContext): void {
    const destination = this.busGains[request.bus];
    if (!destination) return;
    const source = context.createBufferSource();
    const gain = context.createGain();
    source.buffer = buffer;
    source.playbackRate.value = request.pitch;
    gain.gain.value = clampBusVolume(request.gain);
    source.connect(gain).connect(destination);
    if (request.bus === "voice") this.trackVoiceSource(source);
    source.start();
  }

  private prepareVoice(priority: number): void {
    if (priority > this.voicePriority) {
      for (const source of this.activeVoiceSources) {
        try {
          source.stop();
        } catch {
          // A source may have ended between iteration and stop.
        }
      }
      this.activeVoiceSources.clear();
    }
    this.voicePriority = Math.max(this.voicePriority, priority);
  }

  private trackVoiceSource(source: AudioScheduledSourceNode): void {
    this.activeVoiceSources.add(source);
    source.addEventListener("ended", () => {
      this.activeVoiceSources.delete(source);
      if (this.activeVoiceSources.size === 0) this.voicePriority = Number.NEGATIVE_INFINITY;
    }, { once: true });
  }

  async musicSource(theme: MusicTheme): Promise<{ buffer: AudioBuffer; file: ResolvedAudioFile | null }> {
    const context = this.context;
    if (!context) throw new Error("Audio context is not initialized");
    const procedural = this.musicBuffer(theme);
    const resolved = await this.files.resolveMusic(theme, context);
    if (resolved) return resolved;
    this.files.noteFallback();
    return { buffer: procedural, file: null };
  }

  releaseTrack(track: WebMusicTrack): void {
    const index = this.tracks.indexOf(track);
    if (index >= 0) this.tracks.splice(index, 1);
    track.dispose();
  }

  dispose(): void {
    this.wantsRunning = false;
    for (const source of this.activeVoiceSources) {
      try {
        source.stop();
      } catch {
        // Already stopped.
      }
    }
    this.activeVoiceSources.clear();
    for (const track of [...this.tracks]) track.dispose();
    this.tracks.length = 0;
    this.musicBuffers.clear();
    this.noiseBuffer = null;
    this.compressor?.disconnect();
    this.masterGain?.disconnect();
    for (const bus of AUDIO_BUSES) this.busGains[bus]?.disconnect();
    this.musicMixGain?.disconnect();
    this.duckGain?.disconnect();
    if (this.context) void this.context.close();
    this.context = null;
    this.compressor = null;
    this.masterGain = null;
    for (const bus of AUDIO_BUSES) delete this.busGains[bus];
    this.musicMixGain = null;
    this.duckGain = null;
  }

  private buildGraph(context: AudioContext): void {
    this.context = context;
    this.compressor = context.createDynamicsCompressor();
    this.compressor.threshold.value = -12;
    this.compressor.knee.value = 18;
    this.compressor.ratio.value = 5;
    this.masterGain = context.createGain();
    for (const bus of AUDIO_BUSES) {
      if (bus !== "master") this.busGains[bus] = context.createGain();
    }
    this.musicMixGain = context.createGain();
    this.duckGain = context.createGain();
    this.masterGain.gain.value = this.muted ? 0 : this.settingsVolumes.master;
    for (const bus of AUDIO_BUSES) {
      if (bus !== "master" && this.busGains[bus]) {
        this.busGains[bus].gain.value = this.settingsVolumes[bus];
      }
    }
    this.duckGain.gain.value = 1;
    this.musicMixGain.gain.value = this.musicMuted ? 0 : 1;
    this.busGains.music?.connect(this.duckGain).connect(this.musicMixGain).connect(this.masterGain);
    this.busGains.sfx?.connect(this.masterGain);
    this.busGains.ui?.connect(this.masterGain);
    this.busGains.voice?.connect(this.masterGain);
    this.masterGain.connect(this.compressor).connect(context.destination);
    this.noiseBuffer = this.createNoiseBuffer(context);
  }

  private activateTracks(): void {
    const context = this.context;
    const destination = this.busGains.music;
    if (!context || !destination) return;
    for (const track of this.tracks) track.activate(context, destination);
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
