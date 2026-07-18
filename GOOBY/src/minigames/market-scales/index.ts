import { cpStubManifest, createCpStubModule, type CpStubTheme } from "../stub";

export const manifest = cpStubManifest({
  id: "market-scales",
  category: "puzzle",
  audioCues: ["go", "hit", "miss", "combo"],
  tutorial: [
    {
      icon: "⚖",
      title: { en: "Balance the scale", de: "Bring die Waage ins Gleichgewicht" },
      body: {
        en: "The market scale calls for one glowing weight at a time. Tap it to balance.",
        de: "Die Marktwaage verlangt immer ein leuchtendes Gewicht. Tippe es an, um sie auszugleichen.",
      },
    },
    {
      icon: "🪨",
      title: { en: "Too heavy!", de: "Zu schwer!" },
      body: {
        en: "Heavy boulders tip the scale over and cost points. Leave them be.",
        de: "Schwere Felsbrocken kippen die Waage und kosten Punkte. Lass sie liegen.",
      },
    },
    {
      icon: "✦",
      title: { en: "Steady hands", de: "Ruhige Hände" },
      body: {
        en: "Balance weight after weight to earn a merchant's streak bonus.",
        de: "Gleiche Gewicht um Gewicht aus, um den Serienbonus der Händler zu verdienen.",
      },
    },
  ],
});

const theme: CpStubTheme = {
  id: "market-scales",
  padGlyph: "▿",
  targetGlyph: "⚖",
  hazardGlyph: "🪨",
  targetLabel: { en: "Tap the balancing weight", de: "Tippe das passende Gewicht an" },
  hazardLabel: { en: "Leave the heavy boulder", de: "Lass den schweren Felsbrocken liegen" },
  padLabel: { en: "Scale tray", de: "Waagschale" },
  accent: "#d9b98a",
  backdrop: "linear-gradient(180deg,#f8ecd9,#efdcbb)",
  targetLifetimeSeconds: 2.1,
};

export const { definition, createMinigame } = createCpStubModule(manifest, theme);
