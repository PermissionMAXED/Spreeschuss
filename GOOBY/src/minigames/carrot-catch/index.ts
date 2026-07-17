import type { MinigameStubDefinition } from "../stub";

export const definition = {
  id: "carrot-catch",
  title: "Carrot Catch",
  instructions: "Catch the sweetest carrots before they touch the grass.",
} as const satisfies MinigameStubDefinition;
