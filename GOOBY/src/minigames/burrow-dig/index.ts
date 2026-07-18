import { cpStubManifest, createCpStubModule, type CpStubTheme } from "../stub";

export const manifest = cpStubManifest({
  id: "burrow-dig",
  category: "skill",
  audioCues: ["go", "hit", "miss", "combo"],
  tutorial: [
    {
      icon: "⛏",
      title: { en: "Dig the sparkle", de: "Grabe beim Funkeln" },
      body: {
        en: "Soil patches sparkle where keepsakes are buried. Dig there right away.",
        de: "Erdflecken funkeln dort, wo Andenken vergraben sind. Grabe sofort dort.",
      },
    },
    {
      icon: "🪱",
      title: { en: "Spare the worms", de: "Verschone die Würmer" },
      body: {
        en: "Wiggly worms nap underground. Digging them up costs treasure points.",
        de: "Zappelige Würmer schlafen unter der Erde. Sie auszugraben kostet Schatzpunkte.",
      },
    },
    {
      icon: "✦",
      title: { en: "Treasure streak", de: "Schatz-Serie" },
      body: {
        en: "Uncover keepsake after keepsake for a burrowing bonus.",
        de: "Grabe Andenken um Andenken aus und sichere dir den Buddel-Bonus.",
      },
    },
  ],
});

const theme: CpStubTheme = {
  id: "burrow-dig",
  padGlyph: "▒",
  targetGlyph: "✦",
  hazardGlyph: "🪱",
  targetLabel: { en: "Dig the sparkling soil", de: "Grabe die funkelnde Erde aus" },
  hazardLabel: { en: "Spare the napping worm", de: "Verschone den schlafenden Wurm" },
  padLabel: { en: "Soil patch", de: "Erdfleck" },
  accent: "#c99b6f",
  backdrop: "linear-gradient(180deg,#f0e0cd,#e2c7a6)",
  hazardChance: 0.25,
};

export const { definition, createMinigame } = createCpStubModule(manifest, theme);
