import type { MusicZone } from "./contracts";

export const MUSIC_THEMES = [
  "home-cozy",
  "home-kitchen",
  "home-bubbles",
  "home-dream",
  "home-garden",
  "city-drive",
  "shop-market",
  "shop-boutique",
  "shop-salon",
  "minigame-bouncy",
  "minigame-focus",
  "minigame-rhythm",
  "lullaby",
] as const;

export type MusicTheme = (typeof MUSIC_THEMES)[number];

export interface MusicTrack {
  setGain(gain: number, fadeSeconds: number): void;
  stop(fadeSeconds: number): void;
}

export interface MusicMixer {
  start(theme: MusicTheme, initialGain: number): MusicTrack;
  setMasterGain(gain: number, fadeSeconds: number): void;
  duck(gain: number, durationSeconds: number): void;
  dispose(): void;
}

export function themeForZone(zone: MusicZone): MusicTheme {
  if (zone === "lullaby") return "lullaby";
  if (zone === "city") return "city-drive";
  if (zone === "home:living-room") return "home-cozy";
  if (zone === "home:kitchen") return "home-kitchen";
  if (zone === "home:bathroom") return "home-bubbles";
  if (zone === "home:bedroom") return "home-dream";
  if (zone === "home:garden") return "home-garden";
  if (zone === "shop:carrot-market") return "shop-market";
  if (zone === "shop:cloud-boutique") return "shop-boutique";
  if (zone === "shop:fluff-salon") return "shop-salon";
  if (zone === "minigame:rhythm-hop" || zone === "minigame:gooby-says") return "minigame-rhythm";
  if (
    zone === "minigame:memory-meadow" ||
    zone === "minigame:veggie-sort" ||
    zone === "minigame:pond-fishing"
  ) {
    return "minigame-focus";
  }
  return "minigame-bouncy";
}

export class ZoneMusicDirector {
  private track: MusicTrack | null = null;
  private theme: MusicTheme | null = null;
  private muted = false;

  constructor(
    private readonly mixer: MusicMixer,
    private readonly fadeSeconds = 1.25,
  ) {}

  get currentTheme(): MusicTheme | null {
    return this.theme;
  }

  get isMuted(): boolean {
    return this.muted;
  }

  setZone(zone: MusicZone): void {
    const nextTheme = themeForZone(zone);
    if (nextTheme === this.theme) return;
    const previous = this.track;
    this.track = this.mixer.start(nextTheme, 0);
    this.track.setGain(1, this.fadeSeconds);
    previous?.stop(this.fadeSeconds);
    this.theme = nextTheme;
  }

  setMuted(muted: boolean): void {
    if (muted === this.muted) return;
    this.muted = muted;
    this.mixer.setMasterGain(muted ? 0 : 1, 0.18);
  }

  duck(gain = 0.38, durationSeconds = 0.28): void {
    if (!this.muted) this.mixer.duck(gain, durationSeconds);
  }

  dispose(): void {
    this.track?.stop(0.08);
    this.track = null;
    this.theme = null;
    this.mixer.dispose();
  }
}
