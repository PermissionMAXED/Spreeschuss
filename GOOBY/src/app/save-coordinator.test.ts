import { describe, expect, it } from "vitest";
import type { SavePort, SaveRecord } from "../core/contracts/platform";
import {
  createDefaultSave,
  loadSave,
  SaveStateSchema,
  type CanonicalSaveState,
} from "../core/contracts/save";
import { RevisionConflictError } from "../core/platform";
import {
  ReplayableSaveCoordinator,
  type ReplayableSaveReducer,
  type SaveApplyReason,
} from "./save-coordinator";

class OneFailureSave implements SavePort {
  record: SaveRecord;
  private failNext = true;

  constructor(
    initial: CanonicalSaveState,
    private readonly externalWinner: CanonicalSaveState | null = null,
  ) {
    this.record = { revision: 0, payload: initial };
  }

  load(): Promise<SaveRecord> {
    return Promise.resolve(this.record);
  }

  commit(expectedRevision: number, payload: unknown): Promise<SaveRecord> {
    if (this.failNext) {
      this.failNext = false;
      if (this.externalWinner) this.record = { revision: 1, payload: this.externalWinner };
      return Promise.reject(new Error("storage unavailable"));
    }
    if (expectedRevision !== this.record.revision) return Promise.reject(new RevisionConflictError());
    this.record = { revision: expectedRevision + 1, payload };
    return Promise.resolve(this.record);
  }

  clear(): Promise<void> {
    return Promise.resolve();
  }
}

function canonical(): CanonicalSaveState {
  return SaveStateSchema.parse(createDefaultSave(1_000));
}

function addCoins(amount: number): ReplayableSaveReducer {
  return (state) => SaveStateSchema.parse({
    ...state,
    economy: {
      ...state.economy,
      coins: state.economy.coins + amount,
    },
  });
}

describe("ReplayableSaveCoordinator persistence recovery", () => {
  it("rolls back a failed optimistic mutation so it cannot leak into the next save", async () => {
    const initial = canonical();
    const port = new OneFailureSave(initial);
    const applications: Array<{ state: CanonicalSaveState; reason: SaveApplyReason }> = [];
    const coordinator = new ReplayableSaveCoordinator(
      port,
      () => 1_000,
      initial,
      0,
      (state, reason) => applications.push({ state, reason }),
    );

    const failed = coordinator.apply(addCoins(10));
    expect(coordinator.state.economy.coins).toBe(50);
    await expect(failed).rejects.toThrow("storage unavailable");

    expect(coordinator.state.economy.coins).toBe(40);
    expect(applications.at(-1)).toMatchObject({
      reason: "persistence-rollback",
      state: { economy: { coins: 40 } },
    });

    await coordinator.apply(addCoins(5));
    const reloaded = await loadSave(port, 1_000);
    expect(reloaded.state.economy.coins).toBe(45);
    expect(coordinator.revision).toBe(1);
  });

  it("reloads the persisted state after an ambiguous non-conflict failure", async () => {
    const initial = canonical();
    const externalWinner = SaveStateSchema.parse({
      ...initial,
      economy: { ...initial.economy, coins: 47 },
      inventory: { ...initial.inventory, carrot: 4 },
    });
    const port = new OneFailureSave(initial, externalWinner);
    const coordinator = new ReplayableSaveCoordinator(
      port,
      () => 1_000,
      initial,
      0,
      () => undefined,
    );

    await expect(coordinator.apply(addCoins(10))).rejects.toThrow("storage unavailable");

    expect(coordinator.state).toEqual(externalWinner);
    expect(coordinator.revision).toBe(1);
    await coordinator.apply(addCoins(2));
    expect((await loadSave(port, 1_000)).state.economy.coins).toBe(49);
  });
});
