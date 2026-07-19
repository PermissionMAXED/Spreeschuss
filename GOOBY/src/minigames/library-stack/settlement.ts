import type {
  MinigameContext,
  MinigamePayout,
  MinigameRunId,
  MinigameSettlementReceipt,
} from "../../core/contracts/minigame";

interface ContextWithBest extends MinigameContext {
  readonly bestScore?: number;
}

export interface LibrarySettlement {
  readonly persistedBest: number;
  readonly active: boolean;
  readonly receipt: MinigameSettlementReceipt | null;
  begin(): void;
  complete(payout: MinigamePayout): number | null;
  exitUnpaid(): boolean;
}

export function createLibrarySettlement(context: MinigameContext): LibrarySettlement {
  const shared = context as ContextWithBest;
  let runId: MinigameRunId | null = null;
  let receipt: MinigameSettlementReceipt | null = null;
  let settled = false;
  return {
    get persistedBest() {
      return Math.max(0, context.lifecycle?.persistedBest ?? 0, shared.bestScore ?? 0, receipt?.bestScore ?? 0);
    },
    get active() {
      return runId !== null;
    },
    get receipt() {
      return receipt;
    },
    begin() {
      settled = false;
      receipt = null;
      runId = context.lifecycle?.beginRun() ?? "library-local-run";
    },
    complete(payout) {
      if (runId === null || settled) return null;
      settled = true;
      if (context.lifecycle && runId !== "library-local-run") {
        receipt = context.lifecycle.completeRun(runId, payout);
        runId = null;
        return receipt.bestScore;
      }
      runId = null;
      context.finish(payout);
      return Math.max(shared.bestScore ?? 0, payout.score);
    },
    exitUnpaid() {
      const active = runId !== null;
      runId = null;
      context.lifecycle?.exit();
      return active;
    },
  };
}
