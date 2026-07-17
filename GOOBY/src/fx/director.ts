import type { EventBus } from "../core/contracts/events";
import type { AudioEvents } from "../audio/contracts";
import type { ParticleKind } from "./index";

export interface FxEvents {
  "fx:burst": {
    readonly kind: ParticleKind;
    readonly x: number;
    readonly y: number;
    readonly count?: number;
    readonly intensity?: number;
  };
  "fx:clear": Record<string, never>;
}

export interface FxBurstSpec {
  readonly kind: ParticleKind;
  readonly count: number;
  readonly intensity: number;
}

export interface ParticleEmitter {
  burst(kind: ParticleKind, x: number, y: number, count: number, intensity?: number): void;
  clear(): void;
}

const UI_FX: Readonly<Record<AudioEvents["audio:ui"]["action"], FxBurstSpec | null>> = {
  tap: null,
  confirm: { kind: "sparkles", count: 5, intensity: 0.8 },
  back: null,
  open: { kind: "sparkles", count: 3, intensity: 0.65 },
  close: null,
  denied: { kind: "stars", count: 4, intensity: 0.7 },
};

const GOOBY_FX: Readonly<Record<AudioEvents["audio:gooby"]["action"], FxBurstSpec>> = {
  pet: { kind: "hearts", count: 5, intensity: 0.9 },
  tickle: { kind: "sparkles", count: 9, intensity: 1.1 },
  poke: { kind: "stars", count: 4, intensity: 0.75 },
  feed: { kind: "hearts", count: 5, intensity: 0.85 },
  chew: { kind: "crumbs", count: 7, intensity: 0.8 },
  bathe: { kind: "bubbles", count: 12, intensity: 1 },
  sleep: { kind: "zzz", count: 3, intensity: 0.7 },
  wake: { kind: "sparkles", count: 10, intensity: 1 },
};

const ECONOMY_FX: Readonly<Record<AudioEvents["audio:economy"]["action"], FxBurstSpec>> = {
  coin: { kind: "coin", count: 7, intensity: 0.9 },
  purchase: { kind: "sparkles", count: 12, intensity: 1.1 },
};

const CAR_FX: Readonly<Record<AudioEvents["audio:car"]["action"], FxBurstSpec | null>> = {
  "engine-start": { kind: "dust", count: 7, intensity: 0.9 },
  "engine-loop": null,
  "engine-stop": { kind: "dust", count: 4, intensity: 0.6 },
  skid: { kind: "dust", count: 12, intensity: 1.25 },
  brake: { kind: "dust", count: 7, intensity: 0.9 },
  pickup: { kind: "coin", count: 8, intensity: 1 },
  recovery: { kind: "stars", count: 11, intensity: 1.2 },
};

const MINIGAME_FX: Readonly<Record<AudioEvents["audio:minigame"]["action"], FxBurstSpec>> = {
  hit: { kind: "sparkles", count: 5, intensity: 0.9 },
  miss: { kind: "stars", count: 4, intensity: 0.65 },
  combo: { kind: "stars", count: 12, intensity: 1.2 },
  countdown: { kind: "sparkles", count: 3, intensity: 0.6 },
  go: { kind: "dust", count: 10, intensity: 1.1 },
  win: { kind: "confetti", count: 28, intensity: 1.3 },
  lose: { kind: "dust", count: 7, intensity: 0.7 },
  score: { kind: "coin", count: 6, intensity: 0.9 },
};

export function particleForAudioEvent<Key extends keyof AudioEvents>(
  event: Key,
  payload: AudioEvents[Key],
): FxBurstSpec | null {
  if (event === "audio:ui") return UI_FX[(payload as AudioEvents["audio:ui"]).action];
  if (event === "audio:gooby") return GOOBY_FX[(payload as AudioEvents["audio:gooby"]).action];
  if (event === "audio:economy") return ECONOMY_FX[(payload as AudioEvents["audio:economy"]).action];
  if (event === "audio:car") return CAR_FX[(payload as AudioEvents["audio:car"]).action];
  if (event === "audio:minigame") return MINIGAME_FX[(payload as AudioEvents["audio:minigame"]).action];
  return null;
}

export class FxDirector {
  private readonly removeListeners: Array<() => void> = [];

  constructor(
    private readonly emitter: ParticleEmitter,
    private readonly centerX: () => number = () => innerWidth / 2,
    private readonly centerY: () => number = () => innerHeight / 2,
  ) {}

  bindFxEvents(bus: EventBus<FxEvents>): () => void {
    const removers = [
      bus.on("fx:burst", ({ kind, x, y, count, intensity }) => {
        this.emitter.burst(kind, x, y, count ?? 1, intensity ?? 1);
      }),
      bus.on("fx:clear", () => this.emitter.clear()),
    ];
    this.removeListeners.push(...removers);
    return () => this.remove(removers);
  }

  bindAudioEvents(bus: EventBus<AudioEvents>): () => void {
    const removers = [
      bus.on("audio:ui", (payload) => this.emitMapped("audio:ui", payload)),
      bus.on("audio:gooby", (payload) => this.emitMapped("audio:gooby", payload)),
      bus.on("audio:economy", (payload) => this.emitMapped("audio:economy", payload)),
      bus.on("audio:car", (payload) => this.emitMapped("audio:car", payload)),
      bus.on("audio:minigame", (payload) => this.emitMapped("audio:minigame", payload)),
    ];
    this.removeListeners.push(...removers);
    return () => this.remove(removers);
  }

  dispose(): void {
    for (const remove of this.removeListeners) remove();
    this.removeListeners.length = 0;
  }

  private emitMapped<Key extends keyof AudioEvents>(event: Key, payload: AudioEvents[Key]): void {
    const spec = particleForAudioEvent(event, payload);
    if (spec) this.emitter.burst(spec.kind, this.centerX(), this.centerY(), spec.count, spec.intensity);
  }

  private remove(removers: readonly (() => void)[]): void {
    for (const remove of removers) {
      remove();
      const index = this.removeListeners.indexOf(remove);
      if (index >= 0) this.removeListeners.splice(index, 1);
    }
  }
}
