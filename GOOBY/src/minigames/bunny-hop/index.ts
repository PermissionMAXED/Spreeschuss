import type { MinigameStubDefinition } from "../stub";

export const definition = {
  id: "bunny-hop",
  title: "Bunny Hop",
  instructions: "Time each hop and land on the soft stepping stones.",
} as const satisfies MinigameStubDefinition;
