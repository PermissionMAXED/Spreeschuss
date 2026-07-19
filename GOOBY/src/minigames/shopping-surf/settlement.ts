/**
 * Shopping Surf settlement wrapper — one paid settlement per run, unpaid
 * exits everywhere else.
 *
 * The module funnels every lifecycle interaction through this object so the
 * invariants hold no matter which UI path fires (tutorial quit, practice
 * quit, pause quit, results, dispose):
 *
 * - `begin()` opens exactly one lifecycle run for a scored attempt;
 * - `complete(payout)` settles the open run at most once and reports the
 *   persisted best;
 * - `exitUnpaid()` abandons whatever is open without ever paying, and is
 *   idempotent once the run is closed.
 *
 * Runtime-import free (types only) so the node `--experimental-strip-types`
 * specialist runner can execute it against fake lifecycles.
 */
import type {
  MinigameContext,
  MinigamePayout,
  MinigameRunId,
  MinigameSettlementReceipt,
} from "../../core/contracts/minigame";

export interface SurfSettlement {
  /** Highest persisted score known to the app, refreshed on settle. */
  readonly persistedBest: number;
  /** True while a scored run is open and unsettled. */
  readonly runActive: boolean;
  /** True once the current/most recent run has been paid. */
  readonly settled: boolean;
  /** The receipt of the settled run, if any. */
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

export function createSurfSettlement(context: MinigameContext): SurfSettlement {
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
      runId = context.lifecycle?.beginRun() ?? "surf-local-run";
    },
    complete(payout) {
      if (runId === null || settledFlag) return null;
      settledFlag = true;
      if (context.lifecycle && runId !== "surf-local-run") {
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
