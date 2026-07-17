import type { AudioPort } from "./contracts/platform";

const NOTES: Readonly<Record<Parameters<AudioPort["play"]>[0], readonly number[]>> = {
  happy: [523.25, 659.25, 783.99],
  munch: [180, 140, 210],
  sleep: [392, 329.63, 261.63],
  wake: [261.63, 392, 523.25],
  tap: [440],
};

export class WebAudioSynth implements AudioPort {
  private context: AudioContext | null = null;
  private muted = false;

  get unlocked(): boolean {
    return this.context?.state === "running";
  }

  async unlock(): Promise<void> {
    this.context ??= new AudioContext();
    if (this.context.state === "suspended") await this.context.resume();
  }

  play(effect: Parameters<AudioPort["play"]>[0]): void {
    const context = this.context;
    if (!context || context.state !== "running" || this.muted) return;
    const notes = NOTES[effect];
    const start = context.currentTime;
    notes.forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const at = start + index * 0.08;
      oscillator.type = effect === "munch" ? "square" : "sine";
      oscillator.frequency.setValueAtTime(frequency, at);
      gain.gain.setValueAtTime(effect === "munch" ? 0.05 : 0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.08, at + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.15);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(at);
      oscillator.stop(at + 0.16);
    });
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
  }

  dispose(): void {
    if (this.context) void this.context.close();
    this.context = null;
  }
}
