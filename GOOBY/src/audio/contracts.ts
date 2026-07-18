import { ASSET_KEYS, type AssetKey } from "../core/contracts/assets";
import {
  DEFAULT_AUDIO_BUS_VOLUMES,
  type AudioBusVolumes,
  type VoiceCue,
  type VoiceCueRequest,
} from "../core/contracts/audio";
import type { HomeZoneId, MinigameId, ShopId } from "../core/contracts/scenes";

export type AudioAssetKey = Extract<AssetKey, `audio.${string}`>;

export const AUDIO_ASSET_KEYS = ASSET_KEYS.filter(
  (key): key is AudioAssetKey => key.startsWith("audio."),
);

export const SOUND_CUES = [
  "ui-tap",
  "ui-confirm",
  "ui-back",
  "ui-open",
  "ui-close",
  "ui-denied",
  "pet",
  "tickle",
  "poke",
  "feed",
  "chew",
  "bathe",
  "sleep",
  "wake",
  "coin",
  "purchase",
  "engine-start",
  "engine-loop",
  "engine-stop",
  "skid",
  "brake",
  "pickup",
  "recovery",
  "minigame-hit",
  "minigame-miss",
  "minigame-combo",
  "minigame-countdown",
  "minigame-go",
  "minigame-win",
  "minigame-lose",
  "minigame-score",
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

export type SoundCue = (typeof SOUND_CUES)[number];

export const AUDIO_ASSET_CUES: Readonly<Record<AudioAssetKey, SoundCue>> = {
  "audio.happy": "pet",
  "audio.munch": "chew",
  "audio.sleep": "sleep",
  "audio.wake": "wake",
  "audio.tap": "ui-tap",
};

export type UiSoundAction = "tap" | "confirm" | "back" | "open" | "close" | "denied";
export type GoobySoundAction = "pet" | "tickle" | "poke" | "feed" | "chew" | "bathe" | "sleep" | "wake";
export type EconomySoundAction = "coin" | "purchase";
export type CarSoundAction = "engine-start" | "engine-loop" | "engine-stop" | "skid" | "brake" | "pickup" | "recovery";
export type MinigameSoundAction =
  | "hit"
  | "miss"
  | "combo"
  | "countdown"
  | "go"
  | "win"
  | "lose"
  | "score";

export const MUSIC_PROGRAMS = [
  "home",
  "city",
  "shop",
  "calm",
  "action",
  "lullaby",
  "surf",
  "cake",
] as const;
export type MusicProgram = (typeof MUSIC_PROGRAMS)[number];

export type MusicZone =
  | MusicProgram
  | `home:${HomeZoneId}`
  | `shop:${ShopId}`
  | `minigame:${MinigameId}`;

export interface AudioEvents {
  "audio:ui": { readonly action: UiSoundAction };
  "audio:gooby": { readonly action: GoobySoundAction };
  "audio:economy": { readonly action: EconomySoundAction; readonly amount?: number };
  "audio:car": { readonly action: CarSoundAction; readonly intensity?: number };
  "audio:minigame": {
    readonly action: MinigameSoundAction;
    readonly combo?: number;
    readonly score?: number;
  };
  "audio:voice": VoiceCueRequest;
  "audio:zone": { readonly zone: MusicZone };
  "audio:mute": { readonly muted: boolean };
  "audio:settings": VolumeSettings;
  "audio:volume": { readonly bus: keyof AudioBusVolumes; readonly volume: number };
}

export type SfxGroup = "ui" | "gooby" | "voice" | "vehicle" | "reward" | "gameplay";
export type PlaybackBus = "sfx" | "ui" | "voice";

export const SFX_CONCURRENCY_CAPS: Readonly<Record<SfxGroup, number>> = {
  ui: 3,
  gooby: 4,
  voice: 2,
  vehicle: 3,
  reward: 4,
  gameplay: 6,
};

export interface SoundRequest {
  readonly cue: SoundCue;
  readonly bus: PlaybackBus;
  readonly group: SfxGroup;
  readonly pitch: number;
  readonly gain: number;
  readonly duckMusic: boolean;
  readonly priority?: number;
}

/** Canonical persisted settings payload accepted by the live audio mixer. */
export interface VolumeSettings {
  readonly volumes: AudioBusVolumes;
  readonly muted: boolean;
  readonly reducedMotion: boolean;
}

export const DEFAULT_VOLUME_SETTINGS: VolumeSettings = Object.freeze({
  volumes: DEFAULT_AUDIO_BUS_VOLUMES,
  muted: false,
  reducedMotion: false,
});

export interface RuntimeAudioFile {
  readonly path: string;
  readonly loopStartSeconds?: number;
  readonly loopEndSeconds?: number;
}

export interface RuntimeAudioManifestRecord {
  readonly output?: RuntimeAudioFile | string | null;
  readonly path?: string;
  readonly loopStartSeconds?: number;
  readonly loopEndSeconds?: number;
}

/**
 * Runtime subset of the curated audio-domain manifest. `keys` is canonical;
 * `cues`, `sfx`, and `music` keep hand-authored development manifests useful.
 */
export interface RuntimeAudioManifest {
  readonly schemaVersion: 1;
  readonly domain?: "audio";
  readonly keys?: Readonly<Record<string, RuntimeAudioManifestRecord | string>>;
  readonly cues?: Readonly<Record<string, RuntimeAudioManifestRecord | string>>;
  readonly sfx?: Readonly<Record<string, RuntimeAudioManifestRecord | string>>;
  readonly music?: Readonly<Record<string, RuntimeAudioManifestRecord | string>>;
}

export interface ResolvedAudioFile extends RuntimeAudioFile {
  readonly url: string;
}

export function busForCue(cue: SoundCue): PlaybackBus {
  if (cue.startsWith("ui-")) return "ui";
  if (cue.startsWith("voice-")) return "voice";
  return "sfx";
}

export function voiceRequest(cue: VoiceCue, priority = 0): SoundRequest {
  return {
    cue,
    bus: "voice",
    group: "voice",
    pitch: 1,
    gain: Math.min(1, 0.72 + Math.max(0, priority) * 0.06),
    duckMusic: priority > 0,
    priority,
  };
}
