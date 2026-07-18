import type { Clock } from "../core/contracts/clock";
import type { AudioBus, VoiceCue } from "../core/contracts/audio";
import type { EventBus, GameEvents } from "../core/contracts/events";
import type { RandomSource } from "../core/contracts/rng";
import { HOME_ZONE_IDS, MINIGAME_IDS, SHOP_IDS } from "../core/contracts/scenes";
import {
  SFX_CONCURRENCY_CAPS,
  type AudioEvents,
  type CarSoundAction,
  type EconomySoundAction,
  type GoobySoundAction,
  type MinigameSoundAction,
  type MusicZone,
  type SfxGroup,
  type SoundCue,
  type SoundRequest,
  type UiSoundAction,
  type VolumeSettings,
  voiceRequest,
} from "./contracts";
import type { ZoneMusicDirector } from "./music-director";
import { SYNTH_RECIPES } from "./synth-bank";

export type SoundEvent =
  | { readonly type: "ui"; readonly action: UiSoundAction }
  | { readonly type: "gooby"; readonly action: GoobySoundAction }
  | { readonly type: "economy"; readonly action: EconomySoundAction; readonly amount?: number }
  | { readonly type: "car"; readonly action: CarSoundAction; readonly intensity?: number }
  | { readonly type: "voice"; readonly cue: VoiceCue; readonly priority?: number }
  | {
    readonly type: "minigame";
    readonly action: MinigameSoundAction;
    readonly combo?: number;
    readonly score?: number;
  };

export interface SfxPlayer {
  play(request: SoundRequest): void;
  setMuted(muted: boolean): void;
  setBusVolume?(bus: AudioBus, volume: number): void;
  applySettings?(settings: VolumeSettings): void;
}

const UI_CUES: Readonly<Record<UiSoundAction, SoundCue>> = {
  tap: "ui-tap",
  confirm: "ui-confirm",
  back: "ui-back",
  open: "ui-open",
  close: "ui-close",
  denied: "ui-denied",
};

const GOOBY_CUES: Readonly<Record<GoobySoundAction, SoundCue>> = {
  pet: "pet",
  tickle: "tickle",
  poke: "poke",
  feed: "feed",
  chew: "chew",
  bathe: "bathe",
  sleep: "sleep",
  wake: "wake",
};

const GOOBY_VOICE_CUES: Readonly<Record<GoobySoundAction, VoiceCue>> = {
  pet: "voice-happy",
  tickle: "voice-giggle",
  poke: "voice-curious",
  feed: "voice-hungry",
  chew: "voice-munch-happy",
  bathe: "voice-cheer",
  sleep: "voice-sleepy",
  wake: "voice-good-morning",
};

export function voiceCueForGooby(action: GoobySoundAction): VoiceCue {
  return GOOBY_VOICE_CUES[action];
}

const CAR_CUES: Readonly<Record<CarSoundAction, SoundCue>> = {
  "engine-start": "engine-start",
  "engine-loop": "engine-loop",
  "engine-stop": "engine-stop",
  skid: "skid",
  brake: "brake",
  pickup: "pickup",
  recovery: "recovery",
};

const MINIGAME_CUES: Readonly<Record<MinigameSoundAction, SoundCue>> = {
  hit: "minigame-hit",
  miss: "minigame-miss",
  combo: "minigame-combo",
  countdown: "minigame-countdown",
  go: "minigame-go",
  win: "minigame-win",
  lose: "minigame-lose",
  score: "minigame-score",
};

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(maximum, Math.max(minimum, value));

export function soundRequestFor(event: SoundEvent, variation = 0): SoundRequest {
  const randomPitch = clamp(variation, -1, 1) * 0.035;
  if (event.type === "ui") {
    return { cue: UI_CUES[event.action], bus: "ui", group: "ui", pitch: 1 + randomPitch, gain: 0.72, duckMusic: false };
  }
  if (event.type === "gooby") {
    const emphatic = event.action === "feed" || event.action === "wake" || event.action === "bathe";
    return {
      cue: GOOBY_CUES[event.action],
      bus: "sfx",
      group: "gooby",
      pitch: 1 + randomPitch,
      gain: emphatic ? 0.95 : 0.82,
      duckMusic: emphatic,
    };
  }
  if (event.type === "economy") {
    return {
      cue: event.action,
      bus: "sfx",
      group: "reward",
      pitch: clamp(1 + Math.log2(Math.max(1, event.amount ?? 1)) * 0.018 + randomPitch, 0.9, 1.28),
      gain: event.action === "purchase" ? 0.95 : 0.78,
      duckMusic: event.action === "purchase",
    };
  }
  if (event.type === "car") {
    const intensity = clamp(event.intensity ?? 0.5, 0, 1);
    return {
      cue: CAR_CUES[event.action],
      bus: "sfx",
      group: "vehicle",
      pitch: event.action === "engine-loop" ? 0.82 + intensity * 0.42 : 0.95 + randomPitch,
      gain: 0.5 + intensity * 0.42,
      duckMusic: event.action === "recovery" || event.action === "pickup",
    };
  }
  if (event.type === "voice") {
    const request = voiceRequest(event.cue, event.priority);
    return { ...request, pitch: 1 + randomPitch };
  }
  const combo = clamp(event.combo ?? 0, 0, 20);
  const result = event.action === "win" || event.action === "lose";
  return {
    cue: MINIGAME_CUES[event.action],
    bus: "sfx",
    group: "gameplay",
    pitch: clamp(1 + combo * (event.action === "combo" ? 0.035 : 0.018) + randomPitch, 0.82, 1.7),
    gain: result ? 1 : 0.76 + Math.min(combo, 8) * 0.025,
    duckMusic: result || event.action === "combo" || event.action === "go",
  };
}

function requestDurationMs(cue: SoundCue): number {
  let end = 0;
  for (const voice of SYNTH_RECIPES[cue]) end = Math.max(end, voice.offset + voice.duration);
  return end * 1_000;
}

export function musicZoneForRoute(routeId: string): MusicZone | null {
  if (routeId === "city:drive") return "city";
  for (const zone of HOME_ZONE_IDS) if (routeId === `home:${zone}`) return `home:${zone}`;
  for (const shop of SHOP_IDS) if (routeId === `shop:${shop}`) return `shop:${shop}`;
  for (const game of MINIGAME_IDS) if (routeId === `minigame:${game}`) return `minigame:${game}`;
  return null;
}

export class SoundDirector {
  private readonly activeUntil: Record<SfxGroup, number[]> = {
    ui: [],
    gooby: [],
    voice: [],
    vehicle: [],
    reward: [],
    gameplay: [],
  };
  private muted = false;
  private voicePriority = Number.NEGATIVE_INFINITY;
  private voiceActiveUntil = 0;
  private readonly removeListeners: Array<() => void> = [];

  constructor(
    private readonly player: SfxPlayer,
    private readonly music: ZoneMusicDirector,
    private readonly clock: Clock,
    private readonly rng: RandomSource,
  ) {}

  get isMuted(): boolean {
    return this.muted;
  }

  play(event: SoundEvent): boolean {
    if (this.muted) return false;
    const request = soundRequestFor(event, this.rng.next() * 2 - 1);
    const active = this.activeUntil[request.group];
    const now = this.clock.now();
    for (let index = active.length - 1; index >= 0; index -= 1) {
      if ((active[index] ?? Number.POSITIVE_INFINITY) <= now) active.splice(index, 1);
    }
    if (request.group === "voice") {
      if (now >= this.voiceActiveUntil) this.voicePriority = Number.NEGATIVE_INFINITY;
      const priority = request.priority ?? 0;
      if (priority < this.voicePriority) return false;
      if (priority > this.voicePriority) active.length = 0;
      this.voicePriority = priority;
      this.voiceActiveUntil = now + requestDurationMs(request.cue);
    }
    if (active.length >= SFX_CONCURRENCY_CAPS[request.group]) return false;
    active.push(now + requestDurationMs(request.cue));
    this.player.play(request);
    if (request.duckMusic) this.music.duck();
    return true;
  }

  setZone(zone: MusicZone): void {
    this.music.setZone(zone);
  }

  setMuted(muted: boolean): void {
    if (this.muted === muted) return;
    this.muted = muted;
    this.player.setMuted(muted);
    this.music.setMuted(muted);
  }

  setBusVolume(bus: AudioBus, volume: number): void {
    this.player.setBusVolume?.(bus, volume);
  }

  applySettings(settings: VolumeSettings): void {
    if (this.player.applySettings) this.player.applySettings(settings);
    else {
      for (const [bus, volume] of Object.entries(settings.volumes)) {
        this.player.setBusVolume?.(bus as AudioBus, volume);
      }
      this.player.setMuted(settings.muted);
    }
    this.muted = settings.muted;
    this.music.setMuted(settings.muted);
    this.music.setReducedMotion(settings.reducedMotion);
  }

  playGooby(action: GoobySoundAction): void {
    this.play({ type: "gooby", action });
    const priority = action === "wake" || action === "sleep" ? 2 : action === "feed" ? 1 : 0;
    this.play({ type: "voice", cue: voiceCueForGooby(action), priority });
  }

  bindAudioEvents(bus: EventBus<AudioEvents>): () => void {
    const removers = [
      bus.on("audio:ui", ({ action }) => this.play({ type: "ui", action })),
      bus.on("audio:gooby", ({ action }) => this.playGooby(action)),
      bus.on("audio:economy", ({ action, amount }) =>
        this.play(amount === undefined ? { type: "economy", action } : { type: "economy", action, amount })),
      bus.on("audio:car", ({ action, intensity }) =>
        this.play(intensity === undefined ? { type: "car", action } : { type: "car", action, intensity })),
      bus.on("audio:minigame", ({ action, combo, score }) => {
        const event: SoundEvent = { type: "minigame", action, ...(combo === undefined ? {} : { combo }), ...(score === undefined ? {} : { score }) };
        this.play(event);
      }),
      bus.on("audio:voice", ({ cue, priority }) => this.play({ type: "voice", cue, priority })),
      bus.on("audio:zone", ({ zone }) => this.setZone(zone)),
      bus.on("audio:mute", ({ muted }) => this.setMuted(muted)),
      bus.on("audio:settings", (settings) => this.applySettings(settings)),
      bus.on("audio:volume", ({ bus: audioBus, volume }) => this.setBusVolume(audioBus, volume)),
    ];
    this.removeListeners.push(...removers);
    return () => {
      for (const remove of removers) remove();
      for (const remove of removers) {
        const index = this.removeListeners.indexOf(remove);
        if (index >= 0) this.removeListeners.splice(index, 1);
      }
    };
  }

  bindGameEvents(bus: EventBus<GameEvents>): () => void {
    const removers = [
      bus.on("gooby:reaction", ({ kind }) => this.playGooby(kind)),
      bus.on("route:changed", ({ routeId }) => {
        const zone = musicZoneForRoute(routeId);
        if (zone) this.setZone(zone);
      }),
      bus.on("toast", () => this.play({ type: "ui", action: "open" })),
    ];
    this.removeListeners.push(...removers);
    return () => {
      for (const remove of removers) remove();
      for (const remove of removers) {
        const index = this.removeListeners.indexOf(remove);
        if (index >= 0) this.removeListeners.splice(index, 1);
      }
    };
  }

  dispose(): void {
    for (const remove of this.removeListeners) remove();
    this.removeListeners.length = 0;
    this.music.dispose();
  }
}
