/**
 * Cloud Bounce settlement wrapper — one paid settlement per run, unpaid
 * exits everywhere else, plus the pure payout curve.
 *
 * Every lifecycle interaction funnels through this object so the invariants
 * hold no matter which UI path fires (tutorial quit, pause quit, results,
 * dispose). Runtime-import free (types only) so the node
 * `--experimental-strip-types` specialist runner can execute it against fake
 * lifecycles.
 */
import type {
  MinigameContext,
  MinigamePayout,
  MinigameRunId,
  MinigameSettlementReceipt,
} from "../../core/contracts/minigame";

export const CLOUD_COIN_CAP = 60;
export const CLOUD_XP_CAP = 140;

/** Pure payout curve: clamped, integer, and never negative. */
export function cloudPayout(score: number, stars: number): MinigamePayout {
  const safeScore = Math.max(0, Math.floor(Number.isFinite(score) ? score : 0));
  const safeStars = Math.max(0, Math.floor(Number.isFinite(stars) ? stars : 0));
  return {
    score: safeScore,
    coins: Math.min(CLOUD_COIN_CAP, Math.floor(safeScore / 14) + safeStars),
    xp: Math.min(CLOUD_XP_CAP, Math.floor(safeScore / 7) + safeStars * 3),
  };
}

export interface CloudSettlement {
  /** Highest persisted score known to the app, refreshed on settle. */
  readonly persistedBest: number;
  /** True while a scored run is open and unsettled. */
  readonly runActive: boolean;
  /** True once the current/most recent run has been paid. */
  readonly settled: boolean;
  readonly receipt: MinigameSettlementReceipt | null;
  /** Opens a scored run. Re-opening while active abandons the stale run. */
  begin(): void;
  /**
   * Settles the open run exactly once and returns the persisted best after
   * payment. Returns null when nothing was open or it settled already.
   */
  complete(payout: MinigamePayout): number | null;
  /** Abandons any open run without paying. True when something was closed. */
  exitUnpaid(): boolean;
}

interface ContextWithBest extends MinigameContext {
  readonly bestScore?: number;
}

const LOCAL_RUN: MinigameRunId = "cloud-local-run";

export function createCloudSettlement(context: MinigameContext): CloudSettlement {
  const shared = context as ContextWithBest;
  let runId: MinigameRunId | null = null;
  let receipt: MinigameSettlementReceipt | null = null;
  let settledFlag = false;

  return {
    get persistedBest() {
      return Math.max(
        0,
        context.lifecycle?.persistedBest ?? 0,
        shared.bestScore ?? 0,
        receipt?.bestScore ?? 0,
      );
    },
    get runActive() {
      return runId !== null;
    },
    get settled() {
      return settledFlag;
    },
    get receipt() {
      return receipt;
    },
    begin() {
      settledFlag = false;
      receipt = null;
      // beginRun() itself emits run-exited for any stale active run, so a
      // restart from the pause menu never leaks a paid path.
      runId = context.lifecycle?.beginRun() ?? LOCAL_RUN;
    },
    complete(payout) {
      if (runId === null || settledFlag) return null;
      settledFlag = true;
      if (context.lifecycle && runId !== LOCAL_RUN) {
        receipt = context.lifecycle.completeRun(runId, payout);
        runId = null;
        return receipt.bestScore;
      }
      runId = null;
      context.finish(payout);
      return Math.max(shared.bestScore ?? 0, payout.score);
    },
    exitUnpaid() {
      const hadRun = runId !== null;
      runId = null;
      // Exit never settles by contract; harmless when nothing is active.
      context.lifecycle?.exit();
      return hadRun;
    },
  };
}
