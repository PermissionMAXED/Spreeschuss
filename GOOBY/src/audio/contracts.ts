import { ASSET_KEYS, type AssetKey } from "../core/contracts/assets";
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

export type MusicZone =
  | `home:${HomeZoneId}`
  | "city"
  | `shop:${ShopId}`
  | `minigame:${MinigameId}`
  | "lullaby";

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
  "audio:zone": { readonly zone: MusicZone };
  "audio:mute": { readonly muted: boolean };
}

export type SfxGroup = "ui" | "gooby" | "vehicle" | "reward" | "gameplay";

export const SFX_CONCURRENCY_CAPS: Readonly<Record<SfxGroup, number>> = {
  ui: 3,
  gooby: 4,
  vehicle: 3,
  reward: 4,
  gameplay: 6,
};

export interface SoundRequest {
  readonly cue: SoundCue;
  readonly group: SfxGroup;
  readonly pitch: number;
  readonly gain: number;
  readonly duckMusic: boolean;
}
