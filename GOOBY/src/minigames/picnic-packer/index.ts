import { cpStubManifest, createCpStubModule, type CpStubTheme } from "../stub";

export const manifest = cpStubManifest({
  id: "picnic-packer",
  category: "puzzle",
  audioCues: ["go", "hit", "miss", "combo"],
  tutorial: [
    {
      icon: "🧺",
      title: { en: "Pack the basket", de: "Packe den Korb" },
      body: {
        en: "The picnic basket wishes for one treat at a time. Tap the glowing snack.",
        de: "Der Picknickkorb wünscht sich immer eine Leckerei. Tippe den leuchtenden Snack an.",
      },
    },
    {
      icon: "🐜",
      title: { en: "Shoo the ants", de: "Verscheuche die Ameisen" },
      body: {
        en: "Ants sneak onto the blanket. Tapping them spills points from the basket.",
        de: "Ameisen krabbeln auf die Decke. Sie anzutippen verschüttet Punkte aus dem Korb.",
      },
    },
  ],
});

const theme: CpStubTheme = {
  id: "picnic-packer",
  padGlyph: "▢",
  targetGlyph: "🧺",
  hazardGlyph: "🐜",
  targetLabel: { en: "Pack the wished-for treat", de: "Packe die gewünschte Leckerei ein" },
  hazardLabel: { en: "Leave the ant alone", de: "Lass die Ameise in Ruhe" },
  padLabel: { en: "Blanket spot", de: "Deckenplatz" },
  accent: "#f6d78a",
  backdrop: "linear-gradient(180deg,#fdf3d8,#f8e7bd)",
  hazardChance: 0.28,
};

export const { definition, createMinigame } = createCpStubModule(manifest, theme);
