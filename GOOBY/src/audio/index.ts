import type { Clock } from "../core/contracts/clock";
import type { EventBus, GameEvents } from "../core/contracts/events";
import type { RandomSource } from "../core/contracts/rng";
import type { AudioEvents, MusicZone } from "./contracts";
import { ZoneMusicDirector } from "./music-director";
import { SoundDirector } from "./sound-director";
import { GoobyWebAudioEngine } from "./web-audio-engine";

export * from "./contracts";
export * from "./music-director";
export * from "./sound-director";
export * from "./synth-bank";
export * from "./web-audio-engine";

export class GoobyAudioSystem {
  readonly engine: GoobyWebAudioEngine;
  readonly music: ZoneMusicDirector;
  readonly sounds: SoundDirector;

  constructor(clock: Clock, rng: RandomSource) {
    this.engine = new GoobyWebAudioEngine();
    this.music = new ZoneMusicDirector(this.engine);
    this.sounds = new SoundDirector(this.engine, this.music, clock, rng);
  }

  async start(zone: MusicZone): Promise<void> {
    await this.engine.unlock();
    this.sounds.setZone(zone);
  }

  bind(audioEvents: EventBus<AudioEvents>, gameEvents?: EventBus<GameEvents>): () => void {
    const removeAudio = this.sounds.bindAudioEvents(audioEvents);
    const removeGame = gameEvents ? this.sounds.bindGameEvents(gameEvents) : null;
    return () => {
      removeAudio();
      removeGame?.();
    };
  }

  dispose(): void {
    this.sounds.dispose();
  }
}
