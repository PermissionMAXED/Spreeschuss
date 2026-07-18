import { cpStubManifest, createCpStubModule, type CpStubTheme } from "../stub";

export const manifest = cpStubManifest({
  id: "shopping-surf",
  category: "action",
  audioCues: ["go", "hit", "miss", "combo"],
  tutorial: [
    {
      icon: "🛒",
      title: { en: "Watch the shelves", de: "Behalte die Regale im Blick" },
      body: {
        en: "Groceries from Gooby's list pop up on the shelves. Grab them fast.",
        de: "Waren von Goobys Einkaufszettel tauchen in den Regalen auf. Schnapp sie dir schnell.",
      },
    },
    {
      icon: "🧾",
      title: { en: "No impulse buys", de: "Keine Spontankäufe" },
      body: {
        en: "Overpriced gadgets appear too. Grabbing one shrinks your budget score.",
        de: "Auch überteuerte Gadgets tauchen auf. Zugreifen schrumpft deinen Budget-Punktestand.",
      },
    },
    {
      icon: "✦",
      title: { en: "Ride the rush", de: "Reite die Einkaufswelle" },
      body: {
        en: "Grab item after item without a miss to surf a bonus streak.",
        de: "Greif Ware um Ware ohne Fehlgriff, um eine Bonus-Serie zu surfen.",
      },
    },
  ],
});

const theme: CpStubTheme = {
  id: "shopping-surf",
  padGlyph: "▭",
  targetGlyph: "🛒",
  hazardGlyph: "💸",
  targetLabel: { en: "Grab the listed grocery", de: "Schnapp dir die Ware vom Zettel" },
  hazardLabel: { en: "Skip the pricey gadget", de: "Lass das teure Gadget liegen" },
  padLabel: { en: "Empty shelf", de: "Leeres Regal" },
  accent: "#a6d8f0",
  backdrop: "linear-gradient(180deg,#eaf6ff,#d8ecfb)",
  targetLifetimeSeconds: 1.6,
};

export const { definition, createMinigame } = createCpStubModule(manifest, theme);
