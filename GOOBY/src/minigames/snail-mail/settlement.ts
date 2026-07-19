import type {
  MinigameContext,
  MinigamePayout,
  MinigameRunId,
  MinigameSettlementReceipt,
} from "../../core/contracts/minigame";

interface ContextWithBest extends MinigameContext {
  readonly bestScore?: number;
}

export interface SnailMailSettlement {
  readonly persistedBest: number;
  readonly active: boolean;
  readonly receipt: MinigameSettlementReceipt | null;
  begin(): void;
  complete(payout: MinigamePayout): MinigamePayout | null;
  exitUnpaid(): boolean;
}

export function createSnailMailSettlement(context: MinigameContext): SnailMailSettlement {
  const shared = context as ContextWithBest;
  let runId: MinigameRunId | null = null;
  let receipt: MinigameSettlementReceipt | null = null;
  let completed: MinigamePayout | null = null;

  return {
    get persistedBest() {
      return Math.max(
        0,
        context.lifecycle?.persistedBest ?? 0,
        shared.bestScore ?? 0,
        receipt?.bestScore ?? 0,
      );
    },
    get active() {
      return runId !== null;
    },
    get receipt() {
      return receipt;
    },
    begin() {
      if (runId !== null) context.lifecycle?.exit();
      receipt = null;
      completed = null;
      runId = context.lifecycle?.beginRun() ?? "snail-mail-local";
    },
    complete(payout) {
      if (runId === null || completed !== null) return null;
      completed = { ...payout };
      if (context.lifecycle && runId !== "snail-mail-local") {
        receipt = context.lifecycle.completeRun(runId, payout);
      } else {
        context.finish(payout);
      }
      runId = null;
      return completed;
    },
    exitUnpaid() {
      const wasActive = runId !== null;
      runId = null;
      if (wasActive) context.lifecycle?.exit();
      return wasActive;
    },
  };
}
