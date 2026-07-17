import type { MinigameStubDefinition } from "../stub";

export const definition = {
  id: "garden-moles",
  title: "Garden Moles",
  instructions: "Gently shoo the moles before they nibble the garden.",
} as const satisfies MinigameStubDefinition;
