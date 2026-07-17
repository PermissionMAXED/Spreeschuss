import type { MinigameStubDefinition } from "../stub";

export const definition = {
  id: "carrot-cannon",
  title: "Carrot Cannon",
  instructions: "Aim bouncy carrots at the picnic targets.",
} as const satisfies MinigameStubDefinition;
