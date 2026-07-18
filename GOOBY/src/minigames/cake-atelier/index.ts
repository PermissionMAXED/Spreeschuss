import { cpStubManifest, createCpStubModule, type CpStubTheme } from "../stub";

export const manifest = cpStubManifest({
  id: "cake-atelier",
  category: "skill",
  audioCues: ["go", "hit", "miss", "combo"],
  tutorial: [
    {
      icon: "🍰",
      title: { en: "Read the recipe", de: "Lies das Rezept" },
      body: {
        en: "A glowing topping appears on one plate at a time. Tap it before it fades.",
        de: "Ein leuchtender Belag erscheint auf jeweils einem Teller. Tippe ihn an, bevor er verblasst.",
      },
    },
    {
      icon: "🌶",
      title: { en: "Skip the pepper", de: "Lass die Chili liegen" },
      body: {
        en: "Fiery peppers sneak onto the plates. Tapping one costs frosting points.",
        de: "Feurige Chilis schleichen sich auf die Teller. Sie anzutippen kostet Zuckerguss-Punkte.",
      },
    },
    {
      icon: "✦",
      title: { en: "Bake a streak", de: "Backe eine Serie" },
      body: {
        en: "Quick, clean taps build a decorating streak for bonus points.",
        de: "Schnelle, saubere Treffer bauen eine Deko-Serie für Bonuspunkte auf.",
      },
    },
  ],
});

const theme: CpStubTheme = {
  id: "cake-atelier",
  padGlyph: "◯",
  targetGlyph: "🍰",
  hazardGlyph: "🌶",
  targetLabel: { en: "Tap the cake topping", de: "Tippe den Tortenbelag an" },
  hazardLabel: { en: "Avoid the fiery pepper", de: "Meide die feurige Chili" },
  padLabel: { en: "Empty plate", de: "Leerer Teller" },
  accent: "#f7b2c8",
  backdrop: "linear-gradient(180deg,#ffe9f2,#ffd7e6)",
};

export const { definition, createMinigame } = createCpStubModule(manifest, theme);
