import { describe, expect, it } from "vitest";
import { FakeClock } from "../src/core/contracts/clock";
import {
  createMinigameLifecycle,
  type MinigameSettlementReceipt,
} from "../src/core/contracts/minigame";
import type { SavePort, SaveRecord } from "../src/core/contracts/platform";
import {
  commitSave,
  createDefaultSave,
  loadSave,
  migrateSave,
  SaveStateSchema,
} from "../src/core/contracts/save";

class MemorySave implements SavePort {
  constructor(private record: SaveRecord | null) {}

  load(): Promise<SaveRecord | null> {
    return Promise.resolve(this.record);
  }

  commit(expectedRevision: number, payload: unknown): Promise<SaveRecord> {
    if ((this.record?.revision ?? 0) !== expectedRevision) return Promise.reject(new Error("revision conflict"));
    this.record = { revision: expectedRevision + 1, payload };
    return Promise.resolve(this.record);
  }

  clear(): Promise<void> {
    this.record = null;
    return Promise.resolve();
  }
}

describe("save migrations", () => {
  it("migrates a version one save without dropping progression", () => {
    const migrated = migrateSave({
      version: 1,
      name: "Bun",
      onboardingComplete: true,
      createdAt: 100,
      lastSeenAt: 200,
      needs: { hunger: 50, energy: 60, hygiene: 70, fun: 80 },
      coins: 99,
      xp: 425,
      carrots: 8,
    });
    expect(migrated).toMatchObject({
      version: 2,
      profile: { name: "Bun", onboardingComplete: true },
      economy: { coins: 99, xp: 425, level: 3 },
      inventory: { carrot: 8 },
    });
  });

  it("fills version-one optional defaults and preserves its simulation timestamp", () => {
    const migrated = migrateSave({
      version: 1,
      createdAt: 100,
      lastSeenAt: 9_876,
      needs: { hunger: 1, energy: 2, hygiene: 3, fun: 4 },
    });
    expect(migrated).toEqual({
      version: 2,
      profile: { name: "Gooby", onboardingComplete: false, createdAt: 100 },
      simulation: {
        needs: { hunger: 1, energy: 2, hygiene: 3, fun: 4 },
        lastSimulatedAt: 9_876,
        sleep: null,
      },
      economy: { coins: 40, xp: 0, level: 1 },
      inventory: { carrot: 3 },
      settings: {
        muted: false,
        reducedMotion: false,
        haptics: true,
        notifications: true,
      },
      ui: {
        equipped: {},
        highScores: {},
        sleepRationaleSeen: false,
      },
      travel: { visitedShops: [] },
      dailyHarvest: { day: null, count: 0 },
      notificationPolicy: {
        quietHours: null,
        suppressWhenForeground: true,
      },
      minigameSettlement: null,
    });
  });

  it.each(["", "   \t"])("repairs an empty version-one name %j", (name) => {
    const migrated = migrateSave({
      version: 1,
      name,
      createdAt: 100,
      lastSeenAt: 200,
      needs: { hunger: 50, energy: 60, hygiene: 70, fun: 80 },
    });

    expect(migrated?.profile.name).toBe("Gooby");
    expect(SaveStateSchema.safeParse(migrated).success).toBe(true);
  });

  it("defaults canonical fields when loading an old version-two save", () => {
    const oldV2 = {
      version: 2,
      profile: { name: "Bun", onboardingComplete: true, createdAt: 100 },
      simulation: {
        needs: { hunger: 50, energy: 60, hygiene: 70, fun: 80 },
        lastSimulatedAt: 200,
        sleep: null,
      },
      economy: { coins: 12, xp: 25, level: 1 },
      inventory: { carrot: 2 },
      settings: { muted: false, reducedMotion: false },
    };

    const migrated = migrateSave(oldV2);
    expect(migrated).toMatchObject({
      settings: {
        muted: false,
        reducedMotion: false,
        haptics: true,
        notifications: true,
      },
      ui: { equipped: {}, highScores: {}, sleepRationaleSeen: false },
      travel: { visitedShops: [] },
      dailyHarvest: { day: null, count: 0 },
      notificationPolicy: { quietHours: null, suppressWhenForeground: true },
      minigameSettlement: null,
    });
    expect(SaveStateSchema.safeParse(migrated).success).toBe(true);
  });

  it("repairs a stale derived level in an otherwise current save", () => {
    const stale = {
      ...createDefaultSave(1_000),
      economy: { coins: 12, xp: 900, level: 1 },
    };
    expect(migrateSave(stale)?.economy).toEqual({ coins: 12, xp: 900, level: 4 });
  });

  it("recovers corrupted payloads with a valid default", async () => {
    const loaded = await loadSave(new MemorySave({ revision: 4, payload: { version: 2, broken: true } }), 9_000);
    expect(loaded.recovered).toBe(true);
    expect(loaded.revision).toBe(4);
    expect(loaded.state).toEqual(createDefaultSave(9_000));
  });

  it("rejects malformed current saves instead of trusting them", () => {
    expect(migrateSave({ ...createDefaultSave(0), simulation: { needs: { hunger: -5 } } })).toBeNull();
  });

  it("commits only schema-valid saves against the expected revision", async () => {
    const port = new MemorySave(null);
    const state = createDefaultSave(12_345);
    await expect(commitSave(port, 0, state)).resolves.toBe(1);
    await expect(commitSave(port, 0, state)).rejects.toThrow(/revision conflict/u);

    const invalid = { ...state, economy: { ...state.economy, coins: -1 } };
    expect(SaveStateSchema.safeParse(invalid).success).toBe(false);
    await expect(commitSave(port, 1, invalid as never)).rejects.toThrow();
  });
});

describe("minigame settlement lifecycle", () => {
  it("settles a run once, replays its receipt, and leaves a zero-action exit unpaid", () => {
    const clock = new FakeClock(5_000);
    const settlements = new Map<string, MinigameSettlementReceipt>();
    const bestScores = new Map<string, number>();
    const feedback: string[] = [];
    let payoutsApplied = 0;
    const lifecycle = createMinigameLifecycle(
      "carrot-catch",
      clock,
      {
        getBestScore: (id) => bestScores.get(id) ?? 0,
        getSettlement: (runId) => settlements.get(runId) ?? null,
        settle: (receipt) => {
          const previous = settlements.get(receipt.runId);
          if (previous) return previous;
          settlements.set(receipt.runId, receipt);
          bestScores.set(receipt.minigameId, receipt.bestScore);
          payoutsApplied += 1;
          return receipt;
        },
      },
      {
        emit: (event) => {
          feedback.push(event.kind);
        },
      },
    );

    const abandoned = lifecycle.beginRun();
    lifecycle.exit();
    expect(() => lifecycle.completeRun(abandoned, { coins: 5, xp: 5, score: 10 })).toThrow(
      /inactive/u,
    );
    expect(payoutsApplied).toBe(0);

    const runId = lifecycle.beginRun();
    const receipt = lifecycle.completeRun(runId, { coins: 5, xp: 7, score: 20 });
    expect(lifecycle.completeRun(runId, { coins: 999, xp: 999, score: 999 })).toBe(receipt);
    expect(payoutsApplied).toBe(1);
    expect(lifecycle.persistedBest).toBe(20);
    expect(feedback).toEqual(["run-began", "run-exited", "run-began", "run-completed"]);
  });
});
