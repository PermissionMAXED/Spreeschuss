import type {
  MinigameLifecycle,
  MinigamePayout,
  MinigameRunId,
  MinigameSettlementReceipt,
} from "../../core/contracts/minigame";

/**
 * Keeps one module-owned run active at a time. Completed receipts remain
 * available so repeated terminal UI events cannot settle the payout twice.
 */
export class MinigameRunSession {
  private readonly lifecycle: MinigameLifecycle;
  private runId: MinigameRunId | null = null;
  private receipt: MinigameSettlementReceipt | null = null;
  private acted = false;

  public constructor(lifecycle: MinigameLifecycle) {
    this.lifecycle = lifecycle;
  }

  public get persistedBest(): number {
    return this.lifecycle.persistedBest;
  }

  public begin(): MinigameRunId {
    this.runId = this.lifecycle.beginRun();
    this.receipt = null;
    this.acted = false;
    return this.runId;
  }

  public markAction(): void {
    if (this.runId) this.acted = true;
  }

  public complete(payout: MinigamePayout): MinigameSettlementReceipt | null {
    if (this.receipt) return this.receipt;
    if (!this.runId) return null;
    this.receipt = this.lifecycle.completeRun(this.runId, payout);
    this.runId = null;
    return this.receipt;
  }

  /** A zero-action quit abandons the run and never creates a receipt. */
  public quit(payout: MinigamePayout): MinigameSettlementReceipt | null {
    if (this.acted) return this.complete(payout);
    this.exit();
    return null;
  }

  public exit(): void {
    this.lifecycle.exit();
    this.runId = null;
  }
}
