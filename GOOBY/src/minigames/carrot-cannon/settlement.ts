import type {
  MinigameContext,
  MinigamePayout,
} from "../../core/contracts/minigame";

export interface CannonSettlement {
  readonly persistedBest: number;
  readonly closed: boolean;
  complete(payout: MinigamePayout): boolean;
  abandon(): boolean;
}

interface ContextWithBest extends MinigameContext {
  readonly bestScore?: number;
}

/** Bridges the specialist UI to the app-owned, replay-safe run lifecycle. */
export function createCannonSettlement(context: MinigameContext): CannonSettlement {
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
