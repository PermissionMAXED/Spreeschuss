import { cpStubManifest, createCpStubModule, type CpStubTheme } from "../stub";

export const manifest = cpStubManifest({
  id: "firefly-lantern",
  category: "action",
  audioCues: ["go", "hit", "miss", "combo"],
  tutorial: [
    {
      icon: "✦",
      title: { en: "Catch the glow", de: "Fange das Leuchten" },
      body: {
        en: "Fireflies blink over the meadow. Tap one while it glows to fill the lantern.",
        de: "Glühwürmchen blinken über der Wiese. Tippe eines an, solange es leuchtet, um die Laterne zu füllen.",
      },
    },
    {
      icon: "🐝",
      title: { en: "Mind the bees", de: "Achte auf die Bienen" },
      body: {
        en: "Sleepy bees drift by. Let them pass or the lantern loses light.",
        de: "Verschlafene Bienen schweben vorbei. Lass sie ziehen, sonst verliert die Laterne Licht.",
      },
    },
    {
      icon: "🏮",
      title: { en: "Keep it shining", de: "Halte sie am Leuchten" },
      body: {
        en: "Catch firefly after firefly to build a glowing streak.",
        de: "Fange Glühwürmchen um Glühwürmchen, um eine leuchtende Serie aufzubauen.",
      },
    },
  ],
});

const theme: CpStubTheme = {
  id: "firefly-lantern",
  padGlyph: "·",
  targetGlyph: "✦",
  hazardGlyph: "🐝",
  targetLabel: { en: "Catch the glowing firefly", de: "Fange das leuchtende Glühwürmchen" },
  hazardLabel: { en: "Let the bee drift past", de: "Lass die Biene vorbeiziehen" },
  padLabel: { en: "Dark meadow", de: "Dunkle Wiese" },
  accent: "#ffe27a",
  backdrop: "linear-gradient(180deg,#2e3560,#454f86)",
  targetLifetimeSeconds: 1.5,
};

export const { definition, createMinigame } = createCpStubModule(manifest, theme);
