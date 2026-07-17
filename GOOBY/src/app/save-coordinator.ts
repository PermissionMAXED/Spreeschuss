import type { SavePort } from "../core/contracts/platform";
import {
  commitSave,
  loadSave,
  type CanonicalSaveState,
} from "../core/contracts/save";
import { RevisionConflictError } from "../core/platform";

export type ReplayableSaveReducer = (state: CanonicalSaveState) => CanonicalSaveState;
export type SaveApplyReason = "optimistic" | "conflict-replay" | "persistence-rollback";

interface PendingMutation {
  readonly reduce: ReplayableSaveReducer;
  readonly resolve: () => void;
  readonly reject: (error: unknown) => void;
}

function isRevisionConflict(error: unknown): boolean {
  return error instanceof RevisionConflictError
    || (error instanceof Error && /revision conflict|changed since it was loaded/iu.test(error.message));
}

/**
 * Serializes canonical-save mutations and keeps their reducers until the
 * compare-and-commit succeeds. A revision loser reloads the winner and replays
 * the exact pending reducer sequence before retrying.
 */
export class ReplayableSaveCoordinator {
  private pending: PendingMutation[] = [];
  private running: Promise<void> | null = null;
  private committedState: CanonicalSaveState;

  constructor(
    private readonly port: SavePort,
    private readonly now: () => number,
    private currentState: CanonicalSaveState,
    private currentRevision: number,
    private readonly onApplied: (state: CanonicalSaveState, reason: SaveApplyReason) => void,
  ) {
    this.committedState = currentState;
  }

  get state(): CanonicalSaveState {
    return this.currentState;
  }

  get revision(): number {
    return this.currentRevision;
  }

  replaceLocalState(state: CanonicalSaveState): void {
    this.currentState = state;
  }

  apply(reduce: ReplayableSaveReducer): Promise<void> {
    const next = reduce(this.currentState);
    let resolve: () => void = () => {};
    let reject: (error: unknown) => void = () => {};
    const committed = new Promise<void>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    });
    this.pending.push({ reduce, resolve, reject });
    this.currentState = next;
    this.onApplied(next, "optimistic");
    void this.flush().catch(() => undefined);
    return committed;
  }

  flush(): Promise<void> {
    this.running ??= this.commitPending().finally(() => {
      this.running = null;
      if (this.pending.length > 0) void this.flush().catch(() => undefined);
    });
    return this.running;
  }

  async clear(): Promise<void> {
    await this.flush();
    await this.port.clear();
    this.currentRevision = 0;
  }

  private async commitPending(): Promise<void> {
    while (this.pending.length > 0) {
      const batchSize = this.pending.length;
      const candidate = this.currentState;
      try {
        this.currentRevision = await commitSave(this.port, this.currentRevision, candidate);
        this.committedState = candidate;
        const committed = this.pending.splice(0, batchSize);
        for (const mutation of committed) mutation.resolve();
      } catch (error) {
        if (!isRevisionConflict(error)) {
          let rollbackState = this.committedState;
          let rollbackRevision = this.currentRevision;
          try {
            const persisted = await loadSave(this.port, this.now());
            rollbackState = persisted.state;
            rollbackRevision = persisted.revision;
          } catch {
            // The last known committed snapshot is safer than leaking optimism.
          }
          const failed = this.pending.splice(0);
          this.currentState = rollbackState;
          this.currentRevision = rollbackRevision;
          this.committedState = rollbackState;
          this.onApplied(rollbackState, "persistence-rollback");
          for (const mutation of failed) mutation.reject(error);
          throw error;
        }
        const winner = await loadSave(this.port, this.now());
        this.currentRevision = winner.revision;
        this.committedState = winner.state;
        this.currentState = this.pending.reduce(
          (state, mutation) => mutation.reduce(state),
          winner.state,
        );
        this.onApplied(this.currentState, "conflict-replay");
      }
    }
  }
}
