import type { Clock } from "./clock";
import type { RandomSource } from "./rng";
import type { MinigameId } from "./scenes";

export interface MinigamePayout {
  readonly coins: number;
  readonly xp: number;
  readonly score: number;
}

export type MinigameRunId = string;

export interface MinigameSettlementReceipt {
  readonly runId: MinigameRunId;
  readonly minigameId: MinigameId;
  readonly payout: MinigamePayout;
  readonly bestScore: number;
  readonly completedAt: number;
}

export type MinigameFeedbackEvent =
  | { readonly kind: "run-began"; readonly minigameId: MinigameId; readonly runId: MinigameRunId }
  | { readonly kind: "run-completed"; readonly receipt: MinigameSettlementReceipt }
  | { readonly kind: "run-exited"; readonly minigameId: MinigameId; readonly runId: MinigameRunId };

/** Shared audio/haptic/visual feedback is injected instead of being owned by a minigame. */
export interface MinigameFeedback {
  emit(event: MinigameFeedbackEvent): void;
}

/**
 * Settlement implementations must return the previously persisted receipt for a
 * duplicate run id and apply its payout at most once.
 */
export interface MinigameSettlementPersistence {
  getBestScore(minigameId: MinigameId): number;
  getSettlement(runId: MinigameRunId): MinigameSettlementReceipt | null;
  settle(receipt: MinigameSettlementReceipt): MinigameSettlementReceipt;
}

export interface MinigameLifecycle {
  readonly feedback: MinigameFeedback;
  readonly persistedBest: number;
  beginRun(): MinigameRunId;
  completeRun(runId: MinigameRunId, payout: MinigamePayout): MinigameSettlementReceipt;
  /** Exiting abandons the active run and never settles a payout. */
  exit(): void;
}

function validatePayout(payout: MinigamePayout): void {
  if (
    !Number.isFinite(payout.coins) ||
    !Number.isFinite(payout.xp) ||
    !Number.isFinite(payout.score) ||
    payout.coins < 0 ||
    payout.xp < 0 ||
    payout.score < 0
  ) {
    throw new RangeError("Minigame payout values must be finite and non-negative");
  }
}

export function createMinigameLifecycle(
  minigameId: MinigameId,
  clock: Clock,
  persistence: MinigameSettlementPersistence,
  feedback: MinigameFeedback,
): MinigameLifecycle {
  let activeRun: MinigameRunId | null = null;
  let sequence = 0;

  return {
    feedback,
    get persistedBest() {
      return persistence.getBestScore(minigameId);
    },
    beginRun() {
      if (activeRun) {
        feedback.emit({ kind: "run-exited", minigameId, runId: activeRun });
      }
      do {
        sequence += 1;
        activeRun = `${minigameId}:${clock.now()}:${sequence}`;
      } while (persistence.getSettlement(activeRun));
      feedback.emit({ kind: "run-began", minigameId, runId: activeRun });
      return activeRun;
    },
    completeRun(runId, payout) {
      const previous = persistence.getSettlement(runId);
      if (previous) return previous;
      if (runId !== activeRun) throw new Error("Cannot settle an inactive minigame run");
      validatePayout(payout);
      const receipt = persistence.settle({
        runId,
        minigameId,
        payout: { ...payout },
        bestScore: Math.max(persistence.getBestScore(minigameId), payout.score),
        completedAt: clock.now(),
      });
      activeRun = null;
      feedback.emit({ kind: "run-completed", receipt });
      return receipt;
    },
    exit() {
      if (!activeRun) return;
      const runId = activeRun;
      activeRun = null;
      feedback.emit({ kind: "run-exited", minigameId, runId });
    },
  };
}

export interface MinigameContext {
  readonly clock: Clock;
  readonly rng: RandomSource;
  readonly mount: HTMLElement;
  /** New integrations should use this explicit, replay-safe lifecycle. */
  readonly lifecycle?: MinigameLifecycle;
  /** @deprecated Use lifecycle.completeRun(runId, payout). */
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
