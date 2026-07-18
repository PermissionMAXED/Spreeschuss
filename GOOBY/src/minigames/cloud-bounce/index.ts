import { cpStubManifest, createCpStubModule, type CpStubTheme } from "../stub";

export const manifest = cpStubManifest({
  id: "cloud-bounce",
  category: "action",
  audioCues: ["go", "hit", "miss", "combo"],
  tutorial: [
    {
      icon: "☁",
      title: { en: "Bounce on fluff", de: "Springe auf Flauschwolken" },
      body: {
        en: "A fluffy cloud puffs up somewhere in the sky. Bounce onto it before it drifts away.",
        de: "Irgendwo am Himmel plustert sich eine Flauschwolke auf. Springe darauf, bevor sie davonzieht.",
      },
    },
    {
      icon: "🌩",
      title: { en: "Dodge the grumbles", de: "Weiche den Brummelwolken aus" },
      body: {
        en: "Grumbly storm clouds zap away points. Keep your paws off them.",
        de: "Brummelige Gewitterwolken blitzen dir Punkte weg. Pfoten weg von ihnen.",
      },
    },
  ],
});

const theme: CpStubTheme = {
  id: "cloud-bounce",
  padGlyph: "○",
  targetGlyph: "☁",
  hazardGlyph: "🌩",
  targetLabel: { en: "Bounce onto the fluffy cloud", de: "Springe auf die Flauschwolke" },
  hazardLabel: { en: "Dodge the storm cloud", de: "Weiche der Gewitterwolke aus" },
  padLabel: { en: "Open sky", de: "Freier Himmel" },
  accent: "#bcd9f7",
  backdrop: "linear-gradient(180deg,#e8f2ff,#cfe4fb)",
  targetLifetimeSeconds: 1.7,
};

export const { definition, createMinigame } = createCpStubModule(manifest, theme);
