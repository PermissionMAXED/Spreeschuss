import type { MinigameStubDefinition } from "../stub";

export const definition = {
  id: "gooby-says",
  title: "Gooby Says",
  instructions: "Remember Gooby's gestures and repeat the sequence.",
} as const satisfies MinigameStubDefinition;
