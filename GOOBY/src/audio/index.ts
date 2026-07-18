import type { Clock } from "../core/contracts/clock";
import type { EventBus, GameEvents } from "../core/contracts/events";
import type { RandomSource } from "../core/contracts/rng";
import type { AudioEvents, MusicZone, VolumeSettings } from "./contracts";
import { ZoneMusicDirector } from "./music-director";
import { SoundDirector } from "./sound-director";
import { GoobyWebAudioEngine } from "./web-audio-engine";

export * from "./contracts";
export * from "./music-director";
export * from "./sound-director";
export * from "./synth-bank";
export * from "./web-audio-engine";

interface VisibilityTarget {
  readonly hidden: boolean;
  addEventListener(type: "visibilitychange", listener: () => void): void;
  removeEventListener(type: "visibilitychange", listener: () => void): void;
}

interface ReducedMotionPreference {
  readonly matches: boolean;
  addEventListener?(type: "change", listener: () => void): void;
  removeEventListener?(type: "change", listener: () => void): void;
}

export class GoobyAudioSystem {
  readonly engine: GoobyWebAudioEngine;
  readonly music: ZoneMusicDirector;
  readonly sounds: SoundDirector;
  private persistedReducedMotion = false;
  private readonly visibility: VisibilityTarget | null;
  private readonly motionPreference: ReducedMotionPreference | null;

  constructor(
    clock: Clock,
    rng: RandomSource,
    engine = new GoobyWebAudioEngine(),
    visibility: VisibilityTarget | null = typeof document === "undefined" ? null : document,
    motionPreference: ReducedMotionPreference | null =
      typeof matchMedia === "undefined" ? null : matchMedia("(prefers-reduced-motion: reduce)"),
  ) {
    this.engine = engine;
    this.music = new ZoneMusicDirector(this.engine);
    this.sounds = new SoundDirector(this.engine, this.music, clock, rng);
    this.visibility = visibility;
    this.motionPreference = motionPreference;
    this.visibility?.addEventListener("visibilitychange", this.onVisibilityChange);
    this.motionPreference?.addEventListener?.("change", this.onMotionPreferenceChange);
    this.onVisibilityChange();
    this.onMotionPreferenceChange();
  }

  async start(zone: MusicZone): Promise<void> {
    await this.engine.unlock();
    this.sounds.setZone(zone);
  }

  bind(audioEvents: EventBus<AudioEvents>, gameEvents?: EventBus<GameEvents>): () => void {
    const removeAudio = this.sounds.bindAudioEvents(audioEvents);
    const removeSettings = audioEvents.on("audio:settings", (settings) => this.applySettings(settings));
    const removeGame = gameEvents ? this.sounds.bindGameEvents(gameEvents) : null;
    return () => {
      removeAudio();
      removeSettings();
      removeGame?.();
    };
  }

  applySettings(settings: VolumeSettings): void {
    this.persistedReducedMotion = settings.reducedMotion;
    this.sounds.applySettings({
      ...settings,
      reducedMotion: settings.reducedMotion || (this.motionPreference?.matches ?? false),
    });
  }

  dispose(): void {
    this.visibility?.removeEventListener("visibilitychange", this.onVisibilityChange);
    this.motionPreference?.removeEventListener?.("change", this.onMotionPreferenceChange);
    this.sounds.dispose();
  }

  private readonly onVisibilityChange = (): void => {
    this.music.setHidden(this.visibility?.hidden ?? false);
  };

  private readonly onMotionPreferenceChange = (): void => {
    this.music.setReducedMotion(this.persistedReducedMotion || (this.motionPreference?.matches ?? false));
  };
}
