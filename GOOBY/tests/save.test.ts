import { describe, expect, it } from "vitest";
import { DEFAULT_AUDIO_BUS_VOLUMES } from "../src/core/contracts/audio";
import { FakeClock } from "../src/core/contracts/clock";
import {
  createMinigameLifecycle,
  type MinigameSettlementReceipt,
} from "../src/core/contracts/minigame";
import type { SavePort, SaveRecord } from "../src/core/contracts/platform";
import { MINIGAME_IDS } from "../src/core/contracts/scenes";
import { STICKER_IDS } from "../src/core/contracts/stickers";
import {
  commitSave,
  createDefaultSave,
  loadSave,
  migrateSave,
  migrateSaveV1ToV2,
  migrateSaveV2ToV3,
  SaveStateSchema,
  SaveV2Schema,
  UI_SCALE_MAX,
  UI_SCALE_MIN,
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
      version: 3,
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
      version: 3,
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
        uiScale: 1,
        volumes: { ...DEFAULT_AUDIO_BUS_VOLUMES },
        language: "auto",
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
      stickers: { unlocked: {} },
      achievements: { unlocked: {} },
      minigameStats: {},
      devWorkshop: { unlocked: false, flags: {} },
    });
  });

  it("walks the explicit v1 → v2 → v3 chain, freezing each historical step", () => {
    const v1 = {
      version: 1 as const,
      name: "Chain Bun",
      onboardingComplete: true,
      createdAt: 100,
      lastSeenAt: 200,
      needs: { hunger: 50, energy: 60, hygiene: 70, fun: 80 },
      coins: 15,
      xp: 120,
      carrots: 4,
    };
    const v2 = migrateSaveV1ToV2({ ...v1 });
    expect(v2.version).toBe(2);
    expect(SaveV2Schema.parse(v2)).toEqual(v2);
    expect(v2.profile).toEqual({ name: "Chain Bun", onboardingComplete: true, createdAt: 100 });
    expect(v2.inventory).toEqual({ carrot: 4 });
    expect(v2).not.toHaveProperty("stickers");

    const v3 = migrateSaveV2ToV3(v2);
    expect(v3.version).toBe(3);
    expect(v3.profile).toEqual(v2.profile);
    expect(v3.simulation).toEqual(v2.simulation);
    expect(v3.economy).toEqual(v2.economy);
    expect(v3.inventory).toEqual(v2.inventory);
    expect(v3.settings).toEqual({
      ...v2.settings,
      uiScale: 1,
      volumes: { ...DEFAULT_AUDIO_BUS_VOLUMES },
      language: "auto",
    });
    expect(v3.stickers).toEqual({ unlocked: {} });
    expect(v3.achievements).toEqual({ unlocked: {} });
    expect(v3.minigameStats).toEqual({});
    expect(v3.devWorkshop).toEqual({ unlocked: false, flags: {} });
    expect(migrateSave(v1)).toEqual(v3);
  });

  it("preserves every populated version-two field verbatim across the v3 step", () => {
    const populatedV2 = {
      version: 2,
      profile: { name: "Keeper", onboardingComplete: true, createdAt: 111 },
      simulation: {
        needs: { hunger: 44, energy: 55, hygiene: 66, fun: 77 },
        lastSimulatedAt: 999,
        sleep: { startedAt: 900, completesAt: 1_900 },
      },
      economy: { coins: 321, xp: 654, level: 4 },
      inventory: { carrot: 7, "furniture.sofa": 1, "__city.travel.v1|{}": 1 },
      settings: { muted: true, reducedMotion: true, haptics: false, notifications: false },
      ui: {
        equipped: {},
        highScores: { "carrot-catch": 240, "rhythm-hop": 88 },
        sleepRationaleSeen: true,
      },
      travel: { visitedShops: ["carrot-market"] },
      dailyHarvest: { day: 20_240, count: 2 },
      notificationPolicy: {
        quietHours: { startHour: 22, endHour: 7 },
        suppressWhenForeground: false,
      },
      minigameSettlement: {
        runId: "carrot-catch:1:1",
        minigameId: "carrot-catch",
        payout: { coins: 12, xp: 24, score: 240 },
        bestScore: 240,
        completedAt: 500,
      },
    };

    const migrated = migrateSave(populatedV2);
    expect(migrated).not.toBeNull();
    expect(migrated?.version).toBe(3);
    expect(migrated?.profile).toEqual(populatedV2.profile);
    expect(migrated?.simulation).toEqual(populatedV2.simulation);
    expect(migrated?.inventory).toEqual(populatedV2.inventory);
    expect(migrated?.settings).toMatchObject(populatedV2.settings);
    expect(migrated?.ui).toEqual(populatedV2.ui);
    expect(migrated?.ui.highScores["carrot-catch"]).toBe(240);
    expect(migrated?.travel).toEqual(populatedV2.travel);
    expect(migrated?.dailyHarvest).toEqual(populatedV2.dailyHarvest);
    expect(migrated?.notificationPolicy).toEqual(populatedV2.notificationPolicy);
    expect(migrated?.minigameSettlement).toEqual(populatedV2.minigameSettlement);
    expect(migrated?.economy.level).toBe(3);
  });

  it("keeps v3 fields written by a newer runtime into a version-two payload", () => {
    const modern = createDefaultSave(1_000);
    const written = SaveStateSchema.parse(modern);
    const persistedAsV2 = { ...written, version: 2 };
    const migrated = migrateSave(persistedAsV2);
    expect(migrated?.version).toBe(3);
    expect(migrated?.settings.volumes).toEqual({ ...DEFAULT_AUDIO_BUS_VOLUMES });
  });

  it("rejects unknown and missing versions instead of guessing", () => {
    expect(migrateSave({ version: 99 })).toBeNull();
    expect(migrateSave({ version: 0 })).toBeNull();
    expect(migrateSave({})).toBeNull();
    expect(migrateSave(null)).toBeNull();
    expect(migrateSave("nonsense")).toBeNull();
  });

  it("bounds the new v3 settings exactly as the contract promises", () => {
    const base = createDefaultSave(0);
    const settings = SaveStateSchema.parse(base).settings;
    expect(settings.uiScale).toBe(1);
    expect(settings.language).toBe("auto");
    expect(settings.volumes).toEqual({ ...DEFAULT_AUDIO_BUS_VOLUMES });

    const atBounds = {
      ...base,
      settings: { ...settings, uiScale: UI_SCALE_MIN },
    };
    expect(SaveStateSchema.safeParse(atBounds).success).toBe(true);
    expect(SaveStateSchema.safeParse({
      ...base,
      settings: { ...settings, uiScale: UI_SCALE_MAX },
    }).success).toBe(true);
    expect(SaveStateSchema.safeParse({
      ...base,
      settings: { ...settings, uiScale: UI_SCALE_MIN - 0.01 },
    }).success).toBe(false);
    expect(SaveStateSchema.safeParse({
      ...base,
      settings: { ...settings, uiScale: UI_SCALE_MAX + 0.01 },
    }).success).toBe(false);
    expect(SaveStateSchema.safeParse({
      ...base,
      settings: { ...settings, volumes: { ...settings.volumes, music: 1.5 } },
    }).success).toBe(false);
    expect(SaveStateSchema.safeParse({
      ...base,
      settings: { ...settings, language: "fr" },
    }).success).toBe(false);
  });

  it("accepts all six cosmetic slots in the persisted equipped table", () => {
    const base = createDefaultSave(0);
    const parsed = SaveStateSchema.safeParse({
      ...base,
      ui: {
        equipped: {
          head: "cosmetic.head.sunhat",
          ears: "cosmetic.ears.ribbon",
          neck: "cosmetic.neck.scarf",
          back: "cosmetic.back.cape",
          face: "cosmetic.face.glasses",
          paws: "cosmetic.paws.mittens",
        },
        highScores: {},
        sleepRationaleSeen: false,
      },
    });
    expect(parsed.success).toBe(true);
  });

  it("keeps high scores for every one of the twenty-four minigame ids", () => {
    const base = createDefaultSave(0);
    const highScores = Object.fromEntries(MINIGAME_IDS.map((id, index) => [id, 10 + index]));
    const parsed = SaveStateSchema.safeParse({
      ...base,
      ui: { equipped: {}, highScores, sleepRationaleSeen: false },
    });
    expect(parsed.success).toBe(true);
    expect(Object.keys(parsed.success ? parsed.data.ui.highScores : {})).toHaveLength(24);
    expect(SaveStateSchema.safeParse({
      ...base,
      ui: { equipped: {}, highScores: { "not-a-game": 3 }, sleepRationaleSeen: false },
    }).success).toBe(false);
  });

  it("stores per-minigame stats and sticker unlocks for every contract id", () => {
    const base = createDefaultSave(0);
    const minigameStats = Object.fromEntries(MINIGAME_IDS.map((id, index) => [id, {
      plays: index + 1,
      bestScore: 10 * (index + 1),
      totalScore: 12.5 * (index + 1),
      lastPlayedAt: 1_000 + index,
    }]));
    const stickers = {
      unlocked: Object.fromEntries(STICKER_IDS.map((id, index) => [id, 2_000 + index])),
    };
    const parsed = SaveStateSchema.safeParse({ ...base, minigameStats, stickers });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(Object.keys(parsed.data.minigameStats)).toHaveLength(24);
      expect(Object.keys(parsed.data.stickers.unlocked)).toHaveLength(36);
    }
    expect(SaveStateSchema.safeParse({
      ...base,
      stickers: { unlocked: { "sticker.not-real": 1 } },
    }).success).toBe(false);
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
