import {
  AUDIO_ASSET_CUES,
  type AudioAssetKey,
  type SoundCue,
} from "./contracts";

export interface ToneVoice {
  readonly kind: "tone";
  readonly wave: OscillatorType;
  readonly frequency: number;
  readonly endFrequency?: number;
  readonly offset: number;
  readonly duration: number;
  readonly attack: number;
  readonly gain: number;
}

export interface NoiseVoice {
  readonly kind: "noise";
  readonly frequency: number;
  readonly offset: number;
  readonly duration: number;
  readonly attack: number;
  readonly gain: number;
}

export type SynthVoice = ToneVoice | NoiseVoice;

const tone = (
  wave: OscillatorType,
  frequency: number,
  offset: number,
  duration: number,
  gain: number,
  endFrequency?: number,
): ToneVoice => {
  const base = { kind: "tone" as const, wave, frequency, offset, duration, attack: Math.min(0.018, duration * 0.2), gain };
  return endFrequency === undefined ? base : { ...base, endFrequency };
};

const noise = (
  frequency: number,
  offset: number,
  duration: number,
  gain: number,
): NoiseVoice => ({ kind: "noise", frequency, offset, duration, attack: 0.006, gain });

export const SYNTH_RECIPES: Readonly<Record<SoundCue, readonly SynthVoice[]>> = {
  "ui-tap": [tone("sine", 620, 0, 0.055, 0.07, 760)],
  "ui-confirm": [tone("sine", 523.25, 0, 0.1, 0.07), tone("sine", 783.99, 0.07, 0.14, 0.075)],
  "ui-back": [tone("triangle", 560, 0, 0.08, 0.055, 390)],
  "ui-open": [tone("sine", 430, 0, 0.11, 0.055, 660), tone("sine", 660, 0.06, 0.12, 0.04, 880)],
  "ui-close": [tone("sine", 680, 0, 0.11, 0.05, 410)],
  "ui-denied": [tone("square", 155, 0, 0.075, 0.035), tone("square", 138, 0.085, 0.1, 0.03)],
  pet: [tone("sine", 523.25, 0, 0.16, 0.07), tone("sine", 659.25, 0.07, 0.18, 0.07), tone("sine", 783.99, 0.14, 0.2, 0.06)],
  tickle: [tone("sine", 680, 0, 0.1, 0.055, 840), tone("sine", 790, 0.065, 0.1, 0.05, 980), tone("triangle", 920, 0.13, 0.12, 0.04, 1160)],
  poke: [tone("triangle", 185, 0, 0.07, 0.09, 125), noise(900, 0, 0.035, 0.025)],
  feed: [tone("sine", 330, 0, 0.11, 0.055, 440), tone("sine", 494, 0.075, 0.13, 0.055)],
  chew: [noise(760, 0, 0.07, 0.055), tone("square", 145, 0.01, 0.08, 0.035, 105), noise(640, 0.1, 0.07, 0.05)],
  bathe: [noise(1800, 0, 0.22, 0.035), tone("sine", 720, 0, 0.16, 0.035, 980), tone("sine", 920, 0.12, 0.18, 0.03, 1180)],
  sleep: [tone("sine", 392, 0, 0.42, 0.055), tone("sine", 329.63, 0.22, 0.48, 0.05), tone("sine", 261.63, 0.45, 0.58, 0.045)],
  wake: [tone("sine", 261.63, 0, 0.18, 0.06), tone("sine", 392, 0.11, 0.2, 0.065), tone("sine", 523.25, 0.23, 0.25, 0.065)],
  coin: [tone("sine", 988, 0, 0.09, 0.07), tone("sine", 1480, 0.055, 0.2, 0.06)],
  purchase: [tone("triangle", 392, 0, 0.11, 0.055), tone("triangle", 523.25, 0.08, 0.12, 0.06), tone("sine", 783.99, 0.17, 0.22, 0.07)],
  "engine-start": [tone("sawtooth", 62, 0, 0.48, 0.055, 112), noise(260, 0, 0.3, 0.025)],
  "engine-loop": [tone("sawtooth", 88, 0, 0.3, 0.035, 98), tone("square", 44, 0, 0.3, 0.025)],
  "engine-stop": [tone("sawtooth", 96, 0, 0.38, 0.045, 42)],
  skid: [noise(1900, 0, 0.42, 0.06), tone("sawtooth", 230, 0, 0.36, 0.024, 170)],
  brake: [noise(980, 0, 0.18, 0.045), tone("triangle", 135, 0, 0.2, 0.04, 82)],
  pickup: [tone("square", 440, 0, 0.09, 0.04, 660), tone("sine", 880, 0.07, 0.18, 0.065)],
  recovery: [tone("triangle", 180, 0, 0.14, 0.05, 320), tone("sine", 440, 0.12, 0.22, 0.055)],
  "minigame-hit": [tone("triangle", 540, 0, 0.08, 0.065, 760), noise(1250, 0, 0.045, 0.02)],
  "minigame-miss": [tone("square", 180, 0, 0.14, 0.035, 112), noise(420, 0, 0.11, 0.025)],
  "minigame-combo": [tone("sine", 660, 0, 0.11, 0.06), tone("sine", 880, 0.065, 0.13, 0.06), tone("sine", 1320, 0.14, 0.2, 0.06)],
  "minigame-countdown": [tone("triangle", 440, 0, 0.12, 0.055)],
  "minigame-go": [tone("square", 660, 0, 0.12, 0.05), tone("sine", 990, 0.08, 0.22, 0.07)],
  "minigame-win": [tone("sine", 523.25, 0, 0.2, 0.065), tone("sine", 659.25, 0.13, 0.22, 0.065), tone("sine", 783.99, 0.26, 0.23, 0.065), tone("sine", 1046.5, 0.4, 0.42, 0.075)],
  "minigame-lose": [tone("triangle", 392, 0, 0.2, 0.05), tone("triangle", 311.13, 0.16, 0.25, 0.045), tone("triangle", 246.94, 0.34, 0.36, 0.04)],
  "minigame-score": [tone("sine", 784, 0, 0.065, 0.05, 1046)],
};

export interface SynthVoiceOutput {
  tone(voice: ToneVoice, pitch: number, gain: number): void;
  noise(voice: NoiseVoice, pitch: number, gain: number): void;
}

export class ProceduralSynthBank {
  constructor(private readonly output: SynthVoiceOutput) {}

  play(cue: SoundCue, pitch = 1, gain = 1): void {
    for (const voice of SYNTH_RECIPES[cue]) {
      if (voice.kind === "tone") this.output.tone(voice, pitch, gain);
      else this.output.noise(voice, pitch, gain);
    }
  }

  playAsset(key: AudioAssetKey, pitch = 1, gain = 1): void {
    this.play(AUDIO_ASSET_CUES[key], pitch, gain);
  }
}

export function synthAudibility(cue: SoundCue): number {
  let energy = 0;
  for (const voice of SYNTH_RECIPES[cue]) energy += voice.gain * Math.max(voice.duration - voice.attack, 0);
  return energy;
}
