/**
 * Shared audio-mixing contract. The runtime audio implementation stays inside
 * `src/audio`; this contract only fixes the bus topology, default levels, and
 * the voice-cue vocabulary so persistence, settings UI, and specialists agree.
 */

export const AUDIO_BUSES = ["master", "music", "sfx", "ui", "voice"] as const;
export type AudioBus = (typeof AUDIO_BUSES)[number];

export type AudioBusVolumes = Readonly<Record<AudioBus, number>>;

export const AUDIO_VOLUME_MIN = 0;
export const AUDIO_VOLUME_MAX = 1;

export const DEFAULT_AUDIO_BUS_VOLUMES: AudioBusVolumes = Object.freeze({
  master: 1,
  music: 0.8,
  sfx: 0.9,
  ui: 0.8,
  voice: 1,
});

export function isAudioBus(value: unknown): value is AudioBus {
  return typeof value === "string" && (AUDIO_BUSES as readonly string[]).includes(value);
}

export function clampBusVolume(volume: number): number {
  if (!Number.isFinite(volume)) return AUDIO_VOLUME_MAX;
  return Math.min(AUDIO_VOLUME_MAX, Math.max(AUDIO_VOLUME_MIN, volume));
}

/** Every non-master bus is scaled by master; master scales only itself. */
export function effectiveBusGain(volumes: AudioBusVolumes, bus: AudioBus): number {
  const own = clampBusVolume(volumes[bus]);
  if (bus === "master") return own;
  return clampBusVolume(volumes.master) * own;
}

export function withBusVolume(
  volumes: AudioBusVolumes,
  bus: AudioBus,
  volume: number,
): AudioBusVolumes {
  return Object.freeze({ ...volumes, [bus]: clampBusVolume(volume) });
}

/** Port implemented by the audio system when it adopts contract-driven buses. */
export interface AudioMixerPort {
  readonly volumes: AudioBusVolumes;
  setBusVolume(bus: AudioBus, volume: number): void;
  setMuted(muted: boolean): void;
}

/**
 * Gooby's spoken-gibberish vocalization cues. They live on the dedicated
 * `voice` bus so voice loudness is adjustable independently of music and SFX.
 */
export const VOICE_CUES = [
  "voice-greeting",
  "voice-happy",
  "voice-giggle",
  "voice-curious",
  "voice-hungry",
  "voice-munch-happy",
  "voice-sleepy",
  "voice-yawn",
  "voice-goodnight",
  "voice-good-morning",
  "voice-cheer",
  "voice-sad",
] as const;
export type VoiceCue = (typeof VOICE_CUES)[number];

export interface VoiceCueRequest {
  readonly cue: VoiceCue;
  readonly bus: "voice";
  /** Playback priority; higher interrupts lower within the voice bus. */
  readonly priority: number;
}

export function createVoiceCueRequest(cue: VoiceCue, priority = 0): VoiceCueRequest {
  if (!Number.isFinite(priority)) throw new RangeError("Voice cue priority must be finite");
  return Object.freeze({ cue, bus: "voice", priority });
}

if (new Set(AUDIO_BUSES).size !== AUDIO_BUSES.length) {
  throw new Error("Audio buses must be unique");
}
if (new Set(VOICE_CUES).size !== VOICE_CUES.length) {
  throw new Error("Voice cues must be unique");
}
