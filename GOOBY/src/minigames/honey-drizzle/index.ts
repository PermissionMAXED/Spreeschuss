import { cpStubManifest, createCpStubModule, type CpStubTheme } from "../stub";

export const manifest = cpStubManifest({
  id: "honey-drizzle",
  category: "rhythm",
  audioCues: ["go", "hit", "miss", "combo"],
  tutorial: [
    {
      icon: "🍯",
      title: { en: "Wait for the glow", de: "Warte auf das Glühen" },
      body: {
        en: "Pancakes glow golden one after another. Drizzle honey right on the beat.",
        de: "Pfannkuchen glühen goldig nacheinander auf. Träufle den Honig genau im Takt.",
      },
    },
    {
      icon: "🔥",
      title: { en: "Skip the scorchers", de: "Überspringe die Angebrannten" },
      body: {
        en: "Scorched pancakes hiss and burn honey points. Let them cool down.",
        de: "Angebrannte Pfannkuchen zischen und verbrennen Honigpunkte. Lass sie abkühlen.",
      },
    },
    {
      icon: "♫",
      title: { en: "Hold the rhythm", de: "Halte den Rhythmus" },
      body: {
        en: "Drizzle in rhythm without a miss to build a sweet streak.",
        de: "Träufle im Rhythmus ohne Fehler und baue eine süße Serie auf.",
      },
    },
  ],
});

const theme: CpStubTheme = {
  id: "honey-drizzle",
  padGlyph: "🥞",
  targetGlyph: "🍯",
  hazardGlyph: "🔥",
  targetLabel: { en: "Drizzle the golden pancake", de: "Beträufle den goldenen Pfannkuchen" },
  hazardLabel: { en: "Let the scorched pancake cool", de: "Lass den angebrannten Pfannkuchen abkühlen" },
  padLabel: { en: "Waiting pancake", de: "Wartender Pfannkuchen" },
  accent: "#f4c860",
  backdrop: "linear-gradient(180deg,#fdf1d7,#f8e2ae)",
  targetLifetimeSeconds: 1.4,
};

export const { definition, createMinigame } = createCpStubModule(manifest, theme);
