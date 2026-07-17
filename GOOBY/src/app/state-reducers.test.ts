import { describe, expect, it } from "vitest";
import { FakeClock } from "../core/contracts/clock";
import type { MinigameSettlementReceipt } from "../core/contracts/minigame";
import type { SavePort, SaveRecord } from "../core/contracts/platform";
import {
  createDefaultSave,
  loadSave,
  SaveStateSchema,
  type CanonicalSaveState,
} from "../core/contracts/save";
import { RevisionConflictError } from "../core/platform";
import { CityRouteMachine } from "../scenes/city";
import { harvestCarrot } from "../scenes/home/state";
import { parseUiState, type UiPersistedState } from "../ui/model";
import { ReplayableSaveCoordinator } from "./save-coordinator";
import {
  migrateLegacyUiReducer,
  reconcileExternalState,
  savedTravelSnapshot,
  sanitizeCanonicalUi,
  setQuietHoursReducer,
  settlementReceiptForRun,
  settleMinigameReducer,
  withTravelSnapshotReducer,
} from "./state-reducers";

const RECEIPT: MinigameSettlementReceipt = {
  runId: "carrot-catch:1000:1",
  minigameId: "carrot-catch",
  payout: { coins: 10, xp: 7, score: 80 },
  bestScore: 80,
  completedAt: 1_000,
};

const SECOND_RECEIPT: MinigameSettlementReceipt = {
  runId: "carrot-catch:2000:2",
  minigameId: "carrot-catch",
  payout: { coins: 4, xp: 3, score: 40 },
  bestScore: 80,
  completedAt: 2_000,
};

class ConflictSave implements SavePort {
  record: SaveRecord;
  conflictWinner: CanonicalSaveState | null;

  constructor(initial: CanonicalSaveState, conflictWinner: CanonicalSaveState | null) {
    this.record = { revision: 0, payload: initial };
    this.conflictWinner = conflictWinner;
  }

  load(): Promise<SaveRecord> {
    return Promise.resolve(this.record);
  }

  commit(expectedRevision: number, payload: unknown): Promise<SaveRecord> {
    if (this.conflictWinner) {
      this.record = { revision: 1, payload: this.conflictWinner };
      this.conflictWinner = null;
      return Promise.reject(new RevisionConflictError());
    }
    if (expectedRevision !== this.record.revision) return Promise.reject(new RevisionConflictError());
    this.record = { revision: expectedRevision + 1, payload };
    return Promise.resolve(this.record);
  }

  clear(): Promise<void> {
    return Promise.resolve();
  }
}

class RepeatedConflictSave implements SavePort {
  record: SaveRecord;
  private readonly winners: CanonicalSaveState[];

  constructor(initial: CanonicalSaveState, winners: readonly CanonicalSaveState[]) {
    this.record = { revision: 0, payload: initial };
    this.winners = [...winners];
  }

  load(): Promise<SaveRecord> {
    return Promise.resolve(this.record);
  }

  commit(expectedRevision: number, payload: unknown): Promise<SaveRecord> {
    const winner = this.winners.shift();
    if (winner) {
      this.record = { revision: this.record.revision + 1, payload: winner };
      return Promise.reject(new RevisionConflictError());
    }
    if (expectedRevision !== this.record.revision) return Promise.reject(new RevisionConflictError());
    this.record = { revision: expectedRevision + 1, payload };
    return Promise.resolve(this.record);
  }

  clear(): Promise<void> {
    return Promise.resolve();
  }
}

function canonical(now = 0): CanonicalSaveState {
  return SaveStateSchema.parse(createDefaultSave(now));
}

describe("replayable canonical save integration", () => {
  it("reloads a revision winner and reapplies a local settlement without losing either reward", async () => {
    const initial = canonical();
    const winner = SaveStateSchema.parse({
      ...initial,
      economy: { coins: 45, xp: 3, level: 1 },
      inventory: { ...initial.inventory, "crisp-carrot": 1 },
    });
    const port = new ConflictSave(initial, winner);
    let applied = initial;
    const coordinator = new ReplayableSaveCoordinator(
      port,
      () => 1_000,
      initial,
      0,
      (state) => {
        applied = state;
      },
    );

    await coordinator.apply(settleMinigameReducer(RECEIPT));

    expect(applied.economy).toMatchObject({ coins: 55, xp: 10 });
    expect(applied.inventory["crisp-carrot"]).toBe(1);
    expect(applied.minigameSettlement?.runId).toBe(RECEIPT.runId);
    expect(coordinator.revision).toBe(2);
  });

  it("does not pay twice when the revision winner already settled the same run", async () => {
    const initial = canonical();
    const winner = settleMinigameReducer(RECEIPT)(initial);
    const port = new ConflictSave(initial, winner);
    let applied = initial;
    const coordinator = new ReplayableSaveCoordinator(
      port,
      () => 1_000,
      initial,
      0,
      (state) => {
        applied = state;
      },
    );

    await coordinator.apply(settleMinigameReducer(RECEIPT));

    expect(applied.economy.coins).toBe(50);
    expect(applied.economy.xp).toBe(7);
  });

  it("replays all queued reducers in order without duplicating a winner's settlement", async () => {
    const initial = canonical();
    const winner = settleMinigameReducer(RECEIPT)(initial);
    const port = new ConflictSave(initial, winner);
    let applied = initial;
    const coordinator = new ReplayableSaveCoordinator(
      port,
      () => 1_000,
      initial,
      0,
      (state) => {
        applied = state;
      },
    );

    const settlement = coordinator.apply(settleMinigameReducer(RECEIPT));
    const queuedReward = coordinator.apply((state) => SaveStateSchema.parse({
      ...state,
      economy: {
        ...state.economy,
        coins: state.economy.coins + 5,
      },
    }));
    await Promise.all([settlement, queuedReward]);

    expect(applied.economy).toMatchObject({ coins: 55, xp: 7 });
    expect(applied.minigameSettlement?.runId).toBe(RECEIPT.runId);
    expect(coordinator.revision).toBe(2);
  });

  it("retains older settled runs so replay cannot pay them again", () => {
    const once = settleMinigameReducer(RECEIPT)(canonical());
    const twice = settleMinigameReducer(SECOND_RECEIPT)(once);
    const replayed = settleMinigameReducer(RECEIPT)(twice);

    expect(replayed).toBe(twice);
    expect(replayed.economy).toMatchObject({ coins: 54, xp: 10 });
    expect(settlementReceiptForRun(replayed, RECEIPT.runId)).toMatchObject(RECEIPT);
    expect(settlementReceiptForRun(replayed, SECOND_RECEIPT.runId)).toMatchObject(SECOND_RECEIPT);
  });

  it("merges two writers' daily harvests as distinct grants under one canonical ledger", async () => {
    const dayMs = 24 * 60 * 60 * 1_000;
    const clock = new FakeClock(dayMs * 42 + 500);
    const initial = canonical(clock.now());
    const firstHarvest = SaveStateSchema.parse(harvestCarrot(initial, clock).save);
    const secondHarvest = SaveStateSchema.parse(harvestCarrot(initial, clock).save);
    const firstWriter = reconcileExternalState(initial, firstHarvest);
    const secondWriter = reconcileExternalState(initial, secondHarvest);
    const winner = firstWriter(initial);
    const port = new ConflictSave(initial, winner);
    let applied = initial;
    const coordinator = new ReplayableSaveCoordinator(
      port,
      () => clock.now(),
      initial,
      0,
      (state) => {
        applied = state;
      },
    );

    await coordinator.apply(secondWriter);

    expect(applied.inventory.carrot).toBe(5);
    expect(applied.dailyHarvest).toEqual({ day: 42, count: 2 });
    expect(applied.inventory["__home.harvest.count"]).toBe(2);
    expect(Object.keys(applied.inventory).filter((key) =>
      key.startsWith("__home.harvest.receipt.v1|"))).toHaveLength(2);
  });

  it("replays one harvest through repeated conflicts idempotently and enforces the daily quota", async () => {
    const dayMs = 24 * 60 * 60 * 1_000;
    const clock = new FakeClock(dayMs * 7 + 100);
    const initial = canonical(clock.now());
    const harvested = SaveStateSchema.parse(harvestCarrot(initial, clock).save);
    const firstWriter = reconcileExternalState(initial, harvested);
    const secondWriter = reconcileExternalState(initial, harvested);
    const thirdWriter = reconcileExternalState(initial, harvested);
    const localWriter = reconcileExternalState(initial, harvested);
    const firstWinner = firstWriter(initial);
    const secondWinner = secondWriter(firstWinner);
    const thirdWinner = thirdWriter(secondWinner);
    const port = new RepeatedConflictSave(initial, [firstWinner, secondWinner, thirdWinner]);
    let applied = initial;
    const coordinator = new ReplayableSaveCoordinator(
      port,
      () => clock.now(),
      initial,
      0,
      (state) => {
        applied = state;
      },
    );

    await coordinator.apply(localWriter);

    expect(applied.inventory.carrot).toBe(6);
    expect(applied.dailyHarvest).toEqual({ day: 7, count: 3 });
    expect(applied.inventory["__home.harvest.count"]).toBe(3);
    expect(Object.keys(applied.inventory).filter((key) =>
      key.startsWith("__home.harvest.receipt.v1|"))).toHaveLength(4);
    expect(coordinator.revision).toBe(4);
    const replayedAgain = localWriter(applied);
    expect(replayedAgain.inventory.carrot).toBe(6);
    expect(replayedAgain.dailyHarvest).toEqual({ day: 7, count: 3 });
  });

  it("migrates a webview-shaped legacy UI record into canonical fields and rejects unowned outfits", () => {
    const legacy: UiPersistedState = {
      version: 1,
      equipped: { head: "sunny-bucket-hat" },
      preferences: { audio: false, haptics: false, reducedMotion: true, notifications: false },
      quietHours: { startHour: 21, endHour: 8 },
      highScores: { "carrot-catch": 99 },
      sleepRationaleSeen: true,
    };
    const withoutOwnership = migrateLegacyUiReducer(legacy)(canonical());
    expect(withoutOwnership.settings).toMatchObject({
      muted: true,
      haptics: false,
      reducedMotion: true,
      notifications: false,
    });
    expect(withoutOwnership.ui).toMatchObject({
      equipped: {},
      highScores: { "carrot-catch": 99 },
      sleepRationaleSeen: true,
    });
    expect(withoutOwnership.notificationPolicy.quietHours).toEqual({
      startHour: 21,
      endHour: 8,
    });

    const owned = SaveStateSchema.parse({
      ...canonical(),
      inventory: { carrot: 3, "sunny-bucket-hat": 1 },
      ui: { equipped: { head: "sunny-bucket-hat", neck: "not-a-real-item" }, highScores: {}, sleepRationaleSeen: false },
    });
    expect(sanitizeCanonicalUi(owned).ui.equipped).toEqual({ head: "sunny-bucket-hat" });
  });

  it("does not let a corrupt legacy UI sidecar reset canonical settings or equipment", () => {
    const state = SaveStateSchema.parse({
      ...canonical(),
      inventory: { carrot: 3, "sunny-bucket-hat": 1 },
      settings: {
        muted: true,
        haptics: false,
        reducedMotion: true,
        notifications: false,
      },
      ui: {
        equipped: { head: "sunny-bucket-hat" },
        highScores: { "carrot-catch": 50 },
        sleepRationaleSeen: true,
      },
    });

    const migrated = migrateLegacyUiReducer(parseUiState("{ corrupt"))(state);

    expect(migrated.settings).toEqual(state.settings);
    expect(migrated.ui).toEqual(state.ui);
  });

  it("round-trips quiet-hour edits and the disabled toggle through a canonical save adapter", async () => {
    const initial = canonical();
    const port = new ConflictSave(initial, null);
    const coordinator = new ReplayableSaveCoordinator(
      port,
      () => 1_000,
      initial,
      0,
      () => undefined,
    );

    await coordinator.apply(setQuietHoursReducer({ startHour: 21, endHour: 8 }));
    expect((await loadSave(port, 1_000)).state.notificationPolicy.quietHours).toEqual({
      startHour: 21,
      endHour: 8,
    });

    await coordinator.apply(setQuietHoursReducer({ startHour: 22, endHour: 7 }));
    expect((await loadSave(port, 1_000)).state.notificationPolicy.quietHours).toEqual({
      startHour: 22,
      endHour: 7,
    });

    await coordinator.apply(setQuietHoursReducer(null));
    expect((await loadSave(port, 1_000)).state.notificationPolicy.quietHours).toBeNull();
  });

  it("round-trips an active city snapshot through the canonical save port", async () => {
    const initial = canonical();
    const snapshot = {
      phase: "driving-home",
      destination: null,
      visitedShop: "cloud-boutique",
      returnRequired: true,
      safeCarPose: { position: [0, -68], headingRadians: 0 },
      collectedRouteState: { coinIds: ["coin-promenade"] },
    };
    const port = new ConflictSave(initial, null);
    const coordinator = new ReplayableSaveCoordinator(
      port,
      () => 1_000,
      initial,
      0,
      () => undefined,
    );

    await coordinator.apply(withTravelSnapshotReducer(snapshot));
    const reloaded = await loadSave(port, 1_000);

    expect(savedTravelSnapshot(reloaded.state)).toEqual(snapshot);
    expect(reloaded.revision).toBe(1);
    expect(new CityRouteMachine(
      reloaded.state.travel.visitedShops,
      savedTravelSnapshot(reloaded.state),
    ).state).toMatchObject({
      phase: "driving-home",
      visited: "cloud-boutique",
    });
  });
});
