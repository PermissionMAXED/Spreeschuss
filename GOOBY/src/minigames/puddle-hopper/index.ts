import { cpStubManifest, createCpStubModule, type CpStubTheme } from "../stub";

export const manifest = cpStubManifest({
  id: "puddle-hopper",
  category: "action",
  audioCues: ["go", "hit", "miss", "combo"],
  tutorial: [
    {
      icon: "☂",
      title: { en: "Hop on dry stones", de: "Hüpfe auf trockene Steine" },
      body: {
        en: "A dry stepping stone lights up after each rain shower. Hop onto it quickly.",
        de: "Nach jedem Regenschauer leuchtet ein trockener Trittstein auf. Hüpfe schnell darauf.",
      },
    },
    {
      icon: "💧",
      title: { en: "Skip the puddles", de: "Überspringe die Pfützen" },
      body: {
        en: "Splashy puddles look tempting but soak your score.",
        de: "Spritzige Pfützen sehen verlockend aus, weichen aber deinen Punktestand auf.",
      },
    },
  ],
});

const theme: CpStubTheme = {
  id: "puddle-hopper",
  padGlyph: "◇",
  targetGlyph: "☂",
  hazardGlyph: "💧",
  targetLabel: { en: "Hop onto the dry stone", de: "Hüpfe auf den trockenen Stein" },
  hazardLabel: { en: "Skip the splashy puddle", de: "Überspringe die spritzige Pfütze" },
  padLabel: { en: "Stepping stone", de: "Trittstein" },
  accent: "#9fd6c9",
  backdrop: "linear-gradient(180deg,#e3f4ef,#cdeae2)",
  hazardChance: 0.3,
};

export const { definition, createMinigame } = createCpStubModule(manifest, theme);
