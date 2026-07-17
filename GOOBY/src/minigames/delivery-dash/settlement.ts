import type {
  MinigameContext,
  MinigamePayout,
} from "../../core/contracts/minigame";

export interface DeliverySettlement {
  readonly persistedBest: number;
  readonly closed: boolean;
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

  return {
    get persistedBest() {
      return Math.max(0, context.lifecycle?.persistedBest ?? 0, shared.bestScore ?? 0);
    },
    get closed() {
      return closed;
    },
    complete(payout) {
      if (closed) return false;
      closed = true;
      context.finish(payout);
      return true;
    },
    abandon() {
      if (closed) return false;
      closed = true;
      context.lifecycle?.exit();
      return true;
    },
  };
}
