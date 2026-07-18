import { cpStubManifest, createCpStubModule, type CpStubTheme } from "../stub";

export const manifest = cpStubManifest({
  id: "topiary-trim",
  category: "skill",
  audioCues: ["go", "hit", "miss", "combo"],
  tutorial: [
    {
      icon: "✂",
      title: { en: "Snip the twigs", de: "Schnippel die Zweige" },
      body: {
        en: "Stray twigs sprout from the hedge animals. Snip them the moment they appear.",
        de: "Wilde Zweige sprießen aus den Heckentieren. Schnippel sie ab, sobald sie erscheinen.",
      },
    },
    {
      icon: "🐦",
      title: { en: "Mind the songbirds", de: "Achte auf die Singvögel" },
      body: {
        en: "Songbirds rest in the hedge. Snipping near them scares points away.",
        de: "Singvögel rasten in der Hecke. In ihrer Nähe zu schneiden verscheucht Punkte.",
      },
    },
  ],
});

const theme: CpStubTheme = {
  id: "topiary-trim",
  padGlyph: "❋",
  targetGlyph: "🌿",
  hazardGlyph: "🐦",
  targetLabel: { en: "Snip the sprouting twig", de: "Schnippel den sprießenden Zweig ab" },
  hazardLabel: { en: "Leave the songbird in peace", de: "Lass den Singvogel in Frieden" },
  padLabel: { en: "Tidy hedge", de: "Ordentliche Hecke" },
  accent: "#a8d8a0",
  backdrop: "linear-gradient(180deg,#e9f6e4,#d3ecc9)",
  hazardChance: 0.26,
};

export const { definition, createMinigame } = createCpStubModule(manifest, theme);
