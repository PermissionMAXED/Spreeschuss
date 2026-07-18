import { MUSIC_PROGRAMS, type MusicProgram, type MusicZone } from "./contracts";

export const MUSIC_THEMES = MUSIC_PROGRAMS;

export type MusicTheme = MusicProgram;

export interface MusicTrack {
  setGain(gain: number, fadeSeconds: number): void;
  stop(fadeSeconds: number): void;
}

export interface MusicMixer {
  start(theme: MusicTheme, initialGain: number): MusicTrack;
  setMasterGain(gain: number, fadeSeconds: number): void;
  duck(gain: number, durationSeconds: number): void;
  setPaused?(paused: boolean): void;
  dispose(): void;
}

export function themeForZone(zone: MusicZone | MusicTheme): MusicTheme {
  if ((MUSIC_THEMES as readonly string[]).includes(zone)) return zone as MusicTheme;
  if (zone.startsWith("home:")) return "home";
  if (zone === "city") return "city";
  if (zone.startsWith("shop:")) return "shop";
  if (zone === "minigame:shopping-surf") return "surf";
  if (zone === "minigame:cake-atelier") return "cake";
  if (
    zone === "minigame:memory-meadow" ||
    zone === "minigame:veggie-sort" ||
    zone === "minigame:pond-fishing" ||
    zone === "minigame:library-stack" ||
    zone === "minigame:snail-mail" ||
    zone === "minigame:topiary-trim" ||
    zone === "minigame:firefly-lantern"
  ) {
    return "calm";
  }
  return "action";
}

export class ZoneMusicDirector {
  private track: MusicTrack | null = null;
  private theme: MusicTheme | null = null;
  private muted = false;
  private hidden = false;
  private reducedMotion = false;

  constructor(
    private readonly mixer: MusicMixer,
    private readonly fadeSeconds = 1.2,
  ) {}

  get currentTheme(): MusicTheme | null {
    return this.theme;
  }

  get isMuted(): boolean {
    return this.muted;
  }

  setZone(zone: MusicZone | MusicTheme): void {
    const nextTheme = themeForZone(zone);
    if (nextTheme === this.theme) return;
    const previous = this.track;
    this.track = this.mixer.start(nextTheme, 0);
    const fade = this.transitionSeconds;
    this.track.setGain(1, fade);
    previous?.stop(fade);
    this.theme = nextTheme;
  }

  setMuted(muted: boolean): void {
    if (muted === this.muted) return;
    this.muted = muted;
    this.mixer.setMasterGain(muted ? 0 : 1, 0.03);
  }

  setReducedMotion(reducedMotion: boolean): void {
    this.reducedMotion = reducedMotion;
  }

  setHidden(hidden: boolean): void {
    if (hidden === this.hidden) return;
    this.hidden = hidden;
    this.mixer.setPaused?.(hidden);
  }

  duck(gain = 0.38, durationSeconds = 0.28): void {
    if (!this.muted) this.mixer.duck(gain, durationSeconds);
  }

  dispose(): void {
    this.track?.stop(0.03);
    this.track = null;
    this.theme = null;
    this.mixer.dispose();
  }

  private get transitionSeconds(): number {
    return this.reducedMotion ? 0.03 : this.fadeSeconds;
  }
}
