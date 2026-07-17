import type { Clock } from "../core/contracts/clock";
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
} from "./contracts";
import type { ZoneMusicDirector } from "./music-director";
import { SYNTH_RECIPES } from "./synth-bank";

export type SoundEvent =
  | { readonly type: "ui"; readonly action: UiSoundAction }
  | { readonly type: "gooby"; readonly action: GoobySoundAction }
  | { readonly type: "economy"; readonly action: EconomySoundAction; readonly amount?: number }
  | { readonly type: "car"; readonly action: CarSoundAction; readonly intensity?: number }
  | {
    readonly type: "minigame";
    readonly action: MinigameSoundAction;
    readonly combo?: number;
    readonly score?: number;
  };

export interface SfxPlayer {
  play(request: SoundRequest): void;
  setMuted(muted: boolean): void;
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
    return { cue: UI_CUES[event.action], group: "ui", pitch: 1 + randomPitch, gain: 0.72, duckMusic: false };
  }
  if (event.type === "gooby") {
    const emphatic = event.action === "feed" || event.action === "wake" || event.action === "bathe";
    return {
      cue: GOOBY_CUES[event.action],
      group: "gooby",
      pitch: 1 + randomPitch,
      gain: emphatic ? 0.95 : 0.82,
      duckMusic: emphatic,
    };
  }
  if (event.type === "economy") {
    return {
      cue: event.action,
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
      group: "vehicle",
      pitch: event.action === "engine-loop" ? 0.82 + intensity * 0.42 : 0.95 + randomPitch,
      gain: 0.5 + intensity * 0.42,
      duckMusic: event.action === "recovery" || event.action === "pickup",
    };
  }
  const combo = clamp(event.combo ?? 0, 0, 20);
  const result = event.action === "win" || event.action === "lose";
  return {
    cue: MINIGAME_CUES[event.action],
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
    vehicle: [],
    reward: [],
    gameplay: [],
  };
  private muted = false;
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

  bindAudioEvents(bus: EventBus<AudioEvents>): () => void {
    const removers = [
      bus.on("audio:ui", ({ action }) => this.play({ type: "ui", action })),
      bus.on("audio:gooby", ({ action }) => this.play({ type: "gooby", action })),
      bus.on("audio:economy", ({ action, amount }) =>
        this.play(amount === undefined ? { type: "economy", action } : { type: "economy", action, amount })),
      bus.on("audio:car", ({ action, intensity }) =>
        this.play(intensity === undefined ? { type: "car", action } : { type: "car", action, intensity })),
      bus.on("audio:minigame", ({ action, combo, score }) => {
        const event: SoundEvent = { type: "minigame", action, ...(combo === undefined ? {} : { combo }), ...(score === undefined ? {} : { score }) };
        this.play(event);
      }),
      bus.on("audio:zone", ({ zone }) => this.setZone(zone)),
      bus.on("audio:mute", ({ muted }) => this.setMuted(muted)),
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
      bus.on("gooby:reaction", ({ kind }) => this.play({ type: "gooby", action: kind })),
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
