import type {
  MinigameContext,
  MinigamePayout,
  MinigameRunId,
  MinigameSettlementReceipt,
} from "../../core/contracts/minigame";

interface ContextWithBest extends MinigameContext {
  readonly bestScore?: number;
}

export interface TopiarySettlement {
  readonly persistedBest: number;
  readonly receipt: MinigameSettlementReceipt | null;
  begin(): void;
  complete(payout: MinigamePayout): MinigamePayout | null;
  exitUnpaid(): boolean;
}

export function createTopiarySettlement(context: MinigameContext): TopiarySettlement {
  const shared = context as ContextWithBest;
  let runId: MinigameRunId | null = null;
  let receipt: MinigameSettlementReceipt | null = null;
  let paid = false;
  return {
    get persistedBest() {
      return Math.max(0, context.lifecycle?.persistedBest ?? 0, shared.bestScore ?? 0, receipt?.bestScore ?? 0);
    },
    get receipt() {
      return receipt;
    },
    begin() {
      if (runId !== null) context.lifecycle?.exit();
      paid = false;
      receipt = null;
      runId = context.lifecycle?.beginRun() ?? "topiary-local";
    },
    complete(payout) {
      if (runId === null || paid) return null;
      paid = true;
      if (context.lifecycle && runId !== "topiary-local") {
        receipt = context.lifecycle.completeRun(runId, payout);
      } else {
        context.finish(payout);
      }
      runId = null;
      return { ...payout };
    },
    exitUnpaid() {
      const active = runId !== null;
      runId = null;
      if (active) context.lifecycle?.exit();
      return active;
    },
  };
}
