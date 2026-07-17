import type { MinigameStubDefinition } from "../stub";

export const definition = {
  id: "veggie-sort",
  title: "Veggie Sort",
  instructions: "Sort colorful vegetables into the matching baskets.",
} as const satisfies MinigameStubDefinition;
