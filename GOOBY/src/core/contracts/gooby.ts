import type { Object3D, Vector3 } from "three";

export type GoobyMood = "content" | "delighted" | "sleepy" | "curious" | "grumpy";
export type GoobyReaction = "pet" | "tickle" | "poke" | "feed" | "sleep" | "wake";

export interface GoobyActor {
  readonly root: Object3D;
  readonly interactionTarget: Object3D;
  readonly mood: GoobyMood;
  setMood(mood: GoobyMood): void;
  react(reaction: GoobyReaction, at?: Vector3): void;
  setSleeping(sleeping: boolean): void;
  update(deltaSeconds: number, elapsedSeconds: number): void;
  dispose(): void;
}
