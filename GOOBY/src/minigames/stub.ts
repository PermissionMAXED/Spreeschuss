import type { MinigameId } from "../core/contracts/scenes";

/**
 * Shared definition shape every minigame module exports alongside its
 * factory. The name is historical: the compile-green stub era shipped this
 * type first, and all twenty-four final specialist builds still export it so
 * the registry can enumerate id/title/instructions without instantiating a
 * module. No checkpoint stub implementations remain.
 */
export interface MinigameStubDefinition {
  readonly id: MinigameId;
  readonly title: string;
  readonly instructions: string;
}
