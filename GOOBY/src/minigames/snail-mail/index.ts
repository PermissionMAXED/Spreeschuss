import { cpStubManifest, createCpStubModule, type CpStubTheme } from "../stub";

export const manifest = cpStubManifest({
  id: "snail-mail",
  category: "puzzle",
  audioCues: ["go", "hit", "miss", "combo"],
  tutorial: [
    {
      icon: "✉",
      title: { en: "Deliver the letters", de: "Stelle die Briefe zu" },
      body: {
        en: "A letter lights up over its mailbox. Tap it to make the delivery.",
        de: "Ein Brief leuchtet über seinem Briefkasten auf. Tippe ihn an, um ihn zuzustellen.",
      },
    },
    {
      icon: "🐌",
      title: { en: "Don't rush the snail", de: "Hetze die Schnecke nicht" },
      body: {
        en: "The snail courier naps between rounds. Poking it drops your letters.",
        de: "Der Schneckenkurier döst zwischen den Runden. Ihn anzustupsen lässt deine Briefe fallen.",
      },
    },
    {
      icon: "✦",
      title: { en: "Express streak", de: "Express-Serie" },
      body: {
        en: "Deliver letter after letter for an express bonus.",
        de: "Stelle Brief um Brief zu und verdiene den Express-Bonus.",
      },
    },
  ],
});

const theme: CpStubTheme = {
  id: "snail-mail",
  padGlyph: "▤",
  targetGlyph: "✉",
  hazardGlyph: "🐌",
  targetLabel: { en: "Deliver the glowing letter", de: "Stelle den leuchtenden Brief zu" },
  hazardLabel: { en: "Let the snail nap", de: "Lass die Schnecke dösen" },
  padLabel: { en: "Mailbox", de: "Briefkasten" },
  accent: "#e8a9b4",
  backdrop: "linear-gradient(180deg,#fdeef1,#f7dade)",
  targetLifetimeSeconds: 2,
};

export const { definition, createMinigame } = createCpStubModule(manifest, theme);
