export type AudioLicenseId = "CC0-1.0" | "CC-BY-4.0" | "LicenseRef-Gooby-First-Party";
export type AudioSourceId =
  | "kenney-interface-sounds"
  | "kenney-ui-audio"
  | "kenney-impact-sounds"
  | "kenney-music-jingles"
  | "yannz-indie-meditations"
  | "gooby-first-party-synth-recipes";
export type MusicZoneCreditId =
  | "home"
  | "city"
  | "shop"
  | "calm"
  | "action"
  | "lullaby"
  | "surf"
  | "cake";

export interface AudioSourceCredit {
  readonly id: AudioSourceId;
  readonly title: string;
  readonly author: string;
  readonly source: string;
  readonly license: AudioLicenseId;
  readonly licenseText: string;
  readonly attributionRequired: boolean;
}

export interface AudioFileCredit {
  readonly id: string;
  readonly output: `assets/audio/${string}`;
  readonly sourceId: AudioSourceId;
  readonly sourceEntry: string;
}

export interface MusicTrackCredit extends AudioFileCredit {
  readonly id: MusicZoneCreditId;
  readonly title: string;
  readonly author: "Yanni Ziangos (YannZ)";
  readonly license: "CC-BY-4.0";
  readonly source: "opengameart.org/content/indie-meditations-free-music-pack";
  readonly attribution: string;
  readonly modification: string;
}

const sourceOgg = (path: string): string => `${path}.${"ogg"}`;

export const AUDIO_SOURCE_CREDITS = [
  {
    id: "kenney-interface-sounds",
    title: "Interface Sounds",
    author: "Kenney",
    source: "kenney.nl/assets/interface-sounds",
    license: "CC0-1.0",
    licenseText: "Creative Commons Zero 1.0 Universal (CC0 1.0)",
    attributionRequired: false,
  },
  {
    id: "kenney-ui-audio",
    title: "UI Audio",
    author: "Kenney Vleugels",
    source: "kenney.nl/assets/ui-audio",
    license: "CC0-1.0",
    licenseText: "Creative Commons Zero 1.0 Universal (CC0 1.0)",
    attributionRequired: false,
  },
  {
    id: "kenney-impact-sounds",
    title: "Impact Sounds",
    author: "Kenney",
    source: "kenney.nl/assets/impact-sounds",
    license: "CC0-1.0",
    licenseText: "Creative Commons Zero 1.0 Universal (CC0 1.0)",
    attributionRequired: false,
  },
  {
    id: "kenney-music-jingles",
    title: "Music Jingles",
    author: "Kenney Vleugels",
    source: "kenney.nl/assets/music-jingles",
    license: "CC0-1.0",
    licenseText: "Creative Commons Zero 1.0 Universal (CC0 1.0)",
    attributionRequired: false,
  },
  {
    id: "yannz-indie-meditations",
    title: "Indie Meditations (Minimalist & Cozy Vibes) FREE Music Pack",
    author: "Yanni Ziangos (YannZ)",
    source: "opengameart.org/content/indie-meditations-free-music-pack",
    license: "CC-BY-4.0",
    licenseText: "Creative Commons Attribution 4.0 International (CC BY 4.0)",
    attributionRequired: true,
  },
  {
    id: "gooby-first-party-synth-recipes",
    title: "Original nonverbal Gooby synth recipes",
    author: "Gooby’s Cozy Burrow project authors",
    source: "src/audio/synth-bank.ts",
    license: "LicenseRef-Gooby-First-Party",
    licenseText: "Original first-party project work",
    attributionRequired: false,
  },
] as const satisfies readonly AudioSourceCredit[];

export const AUDIO_SFX_CREDITS = [
  ["ui", "kenney-ui-audio", sourceOgg("Audio/click1")],
  ["confirm", "kenney-interface-sounds", sourceOgg("Audio/confirmation_002")],
  ["back", "kenney-interface-sounds", sourceOgg("Audio/back_001")],
  ["toggle", "kenney-ui-audio", sourceOgg("Audio/switch6")],
  ["slider", "kenney-interface-sounds", sourceOgg("Audio/scroll_005")],
  ["error", "kenney-interface-sounds", sourceOgg("Audio/error_004")],
  ["hit", "kenney-impact-sounds", sourceOgg("Audio/impactMetal_light_003")],
  ["miss", "kenney-music-jingles", sourceOgg("Audio/Hit jingles/jingles_HIT14")],
  ["combo", "kenney-music-jingles", sourceOgg("Audio/Pizzicato jingles/jingles_PIZZI11")],
  ["go", "kenney-music-jingles", sourceOgg("Audio/Hit jingles/jingles_HIT02")],
  ["win", "kenney-music-jingles", sourceOgg("Audio/Pizzicato jingles/jingles_PIZZI16")],
  ["lose", "kenney-music-jingles", sourceOgg("Audio/Hit jingles/jingles_HIT15")],
  ["coin", "kenney-music-jingles", sourceOgg("Audio/Steel jingles/jingles_STEEL09")],
  ["purchase", "kenney-interface-sounds", sourceOgg("Audio/confirmation_004")],
  ["pickup", "kenney-music-jingles", sourceOgg("Audio/Steel jingles/jingles_STEEL03")],
  ["brake", "kenney-interface-sounds", sourceOgg("Audio/scratch_001")],
  ["skid", "kenney-interface-sounds", sourceOgg("Audio/scratch_005")],
].map(([id, sourceId, sourceEntry]) => ({
  id,
  output: `assets/audio/sfx/${id}.wav`,
  sourceId,
  sourceEntry,
})) as readonly AudioFileCredit[];

const musicAttribution = (title: string): string =>
  `“${title}” by Yanni Ziangos (YannZ), licensed under Creative Commons Attribution 4.0 International (CC BY 4.0). `
  + "Source: opengameart.org/content/indie-meditations-free-music-pack; "
  + "license: creativecommons.org/licenses/by/4.0/. "
  + "Modified for Gooby’s Cozy Burrow by converting the original OGG to normalized AAC-LC M4A.";

const musicTrack = (
  id: MusicZoneCreditId,
  title: string,
  sourceEntry: string,
): MusicTrackCredit => ({
  id,
  title,
  output: `assets/audio/music/${id}.m4a`,
  sourceId: "yannz-indie-meditations",
  sourceEntry,
  author: "Yanni Ziangos (YannZ)",
  license: "CC-BY-4.0",
  source: "opengameart.org/content/indie-meditations-free-music-pack",
  attribution: musicAttribution(title),
  modification: "Converted from the authored loopable OGG to normalized 44.1 kHz AAC-LC M4A.",
});

export const MUSIC_TRACK_CREDITS = [
  musicTrack("home", "lvl 2 – the village", sourceOgg("lvl_2_the_village")),
  musicTrack("city", "lvl 7 – the raft on the ocean", sourceOgg("lvl_7_the_raft_on_the_ocean")),
  musicTrack("shop", "lvl 1 – the royal palace", sourceOgg("lvl_1_the_royal_palace")),
  musicTrack("calm", "lvl 5 – the oasis or resting place", sourceOgg("lvl_5_the_oasis_or_resting_place")),
  musicTrack("action", "lvl 9 – the volcanic ascent", sourceOgg("lvl_9_the_volcanic_ascent")),
  musicTrack("lullaby", "lvl 0 – the tutorial", sourceOgg("lvl_0_the_tutorial")),
  musicTrack("surf", "lvl 6 – the beach", sourceOgg("lvl_6_the_beach")),
  musicTrack("cake", "lvl 3 – the grassland", sourceOgg("lvl_3_the_grassland")),
] as const satisfies readonly MusicTrackCredit[];

export const GOOBY_VOICE_CREDITS = [
  ["happy", "SYNTH_RECIPES[\"voice-happy\"]"],
  ["giggle", "SYNTH_RECIPES[\"voice-giggle\"]"],
  ["curious", "SYNTH_RECIPES[\"voice-curious\"]"],
  ["sleepy", "SYNTH_RECIPES[\"voice-sleepy\"]"],
  ["sad", "SYNTH_RECIPES[\"voice-sad\"]"],
].map(([id, sourceEntry]) => ({
  id,
  output: `assets/audio/voice/${id}.wav`,
  sourceId: "gooby-first-party-synth-recipes",
  sourceEntry,
})) as readonly AudioFileCredit[];

export const AUDIO_LICENSE_NOTICE_PATH = "assets/LICENSES.md" as const;
export const AUDIO_SOURCE_LOCK_PATH = "assets/audio/sources.lock.json" as const;
