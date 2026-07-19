import type {
  MinigameContext,
  MinigamePayout,
  MinigameRunId,
  MinigameSettlementReceipt,
} from "../../core/contracts/minigame";

export interface DeliverySettlement {
  readonly persistedBest: number;
  readonly closed: boolean;
  readonly runActive: boolean;
  readonly receipt: MinigameSettlementReceipt | null;
  begin(): void;
  complete(payout: MinigamePayout): boolean;
  abandon(): boolean;
}

interface ContextWithBest extends MinigameContext {
  readonly bestScore?: number;
}

/**
 * Keeps specialist UI actions on the app-owned settlement path. A completed
 * run is paid once; leaving tutorials or active play only exits the run.
 */
export function createDeliverySettlement(context: MinigameContext): DeliverySettlement {
  const shared = context as ContextWithBest;
  let closed = false;
  let runId: MinigameRunId | null = null;
  let managedRun = false;
  let receipt: MinigameSettlementReceipt | null = null;

  return {
    get persistedBest() {
      return Math.max(
        0,
        context.lifecycle?.persistedBest ?? 0,
        shared.bestScore ?? 0,
        receipt?.bestScore ?? 0,
      );
    },
    get closed() {
      return closed;
    },
    get runActive() {
      return runId !== null;
    },
    get receipt() {
      return receipt;
    },
    begin() {
      closed = false;
      receipt = null;
      managedRun = true;
      runId = context.lifecycle?.beginRun() ?? "delivery-local-run";
    },
    complete(payout) {
      if (closed) return false;
      closed = true;
      if (managedRun && context.lifecycle && runId !== null && runId !== "delivery-local-run") {
        receipt = context.lifecycle.completeRun(runId, payout);
      } else {
        context.finish(payout);
      }
      runId = null;
      return true;
    },
    abandon() {
      if (closed) return false;
      closed = true;
      runId = null;
      context.lifecycle?.exit();
      return true;
    },
  };
}
