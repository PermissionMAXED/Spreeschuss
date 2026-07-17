import type { Clock } from "./clock";
import type { RandomSource } from "./rng";
import type { MinigameId } from "./scenes";

export interface MinigamePayout {
  readonly coins: number;
  readonly xp: number;
  readonly score: number;
}

export interface MinigameContext {
  readonly clock: Clock;
  readonly rng: RandomSource;
  readonly mount: HTMLElement;
  finish(payout: MinigamePayout): void;
}

export interface MinigameModule {
  readonly id: MinigameId;
  readonly title: string;
  readonly instructions: string;
  mount(context: MinigameContext): void | Promise<void>;
  start(): void;
  pause(): void;
  resume(): void;
  update(deltaSeconds: number): void;
  payout(): MinigamePayout;
  dispose(): void;
}

export type MinigameFactory = () => MinigameModule;
