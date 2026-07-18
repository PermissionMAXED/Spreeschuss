import { cpStubManifest, createCpStubModule, type CpStubTheme } from "../stub";

export const manifest = cpStubManifest({
  id: "library-stack",
  category: "puzzle",
  audioCues: ["go", "hit", "miss", "combo"],
  tutorial: [
    {
      icon: "📚",
      title: { en: "Shelve the storybooks", de: "Räume die Bilderbücher ein" },
      body: {
        en: "A storybook glows over its shelf slot. Tap it to tuck it in neatly.",
        de: "Ein Bilderbuch leuchtet über seinem Regalplatz. Tippe es an, um es ordentlich einzuräumen.",
      },
    },
    {
      icon: "🕸",
      title: { en: "Dodge the dust", de: "Weiche dem Staub aus" },
      body: {
        en: "Dusty cobweb corners make Gooby sneeze and cost points.",
        de: "Staubige Spinnwebenecken bringen Gooby zum Niesen und kosten Punkte.",
      },
    },
    {
      icon: "✦",
      title: { en: "Librarian streak", de: "Bibliotheks-Serie" },
      body: {
        en: "Shelve book after book to earn the tidy librarian bonus.",
        de: "Räume Buch um Buch ein und verdiene den Bonus für ordentliche Bibliothekare.",
      },
    },
  ],
});

const theme: CpStubTheme = {
  id: "library-stack",
  padGlyph: "▯",
  targetGlyph: "📚",
  hazardGlyph: "🕸",
  targetLabel: { en: "Shelve the glowing storybook", de: "Räume das leuchtende Bilderbuch ein" },
  hazardLabel: { en: "Avoid the dusty cobweb", de: "Meide die staubige Spinnwebe" },
  padLabel: { en: "Shelf slot", de: "Regalplatz" },
  accent: "#c5aee8",
  backdrop: "linear-gradient(180deg,#f2ecfb,#e2d6f5)",
  targetLifetimeSeconds: 2,
};

export const { definition, createMinigame } = createCpStubModule(manifest, theme);
