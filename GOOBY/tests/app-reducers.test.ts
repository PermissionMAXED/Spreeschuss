import { describe, expect, it } from "vitest";
import type { MinigameSettlementReceipt } from "../src/core/contracts/minigame";
import {
  createDefaultSave,
  SaveStateSchema,
  UI_SCALE_MAX,
  UI_SCALE_MIN,
  type CanonicalSaveState,
} from "../src/core/contracts/save";
import { SLEEP_DURATION_MS } from "../src/core/contracts/simulation";
import type { MinigameId } from "../src/core/contracts/scenes";
import {
  beginSleepReducer,
  catchUpOfflineReducer,
  clampUiScale,
  setBusVolumeReducer,
  setDevWorkshopFlagReducer,
  setDevWorkshopUnlockedReducer,
  setLanguageReducer,
  settleMinigameReducer,
  setUiScaleReducer,
  unlockAchievementReducer,
  unlockStickerReducer,
  wakeReducer,
} from "../src/app/state-reducers";

function baseState(now = 10_000): CanonicalSaveState {
  return SaveStateSchema.parse(createDefaultSave(now));
}

describe("sleep and wake reducers", () => {
  it("starts sleep exactly once with a captured timestamp", () => {
    const state = baseState(10_000);
    const sleeping = beginSleepReducer(10_000, false)(state);
    expect(sleeping.simulation.sleep).toEqual({
      startedAt: 10_000,
      completesAt: 10_000 + SLEEP_DURATION_MS,
    });

    const again = beginSleepReducer(20_000, false)(sleeping);
    expect(again).toBe(sleeping);

    const rationale = beginSleepReducer(20_000, true)(sleeping);
    expect(rationale.simulation.sleep).toEqual(sleeping.simulation.sleep);
    expect(rationale.ui.sleepRationaleSeen).toBe(true);
    expect(beginSleepReducer(30_000, true)(rationale)).toBe(rationale);
  });

  it("settles a gentle early wake with exactly the partial energy earned", () => {
    const start = 10_000;
    const tired = SaveStateSchema.parse({
      ...createDefaultSave(start),
      simulation: {
        needs: { hunger: 70, energy: 10, hygiene: 70, fun: 70 },
        lastSimulatedAt: start,
        sleep: null,
      },
    });
    const sleeping = beginSleepReducer(start, false)(tired);
    const wake = wakeReducer(start + SLEEP_DURATION_MS / 3);
    const awake = wake(sleeping);
    expect(awake.simulation.sleep).toBeNull();
    expect(awake.simulation.needs.energy).toBeCloseTo(40);
  });

  it("is deterministic under conflict replay: same reducer, same result", () => {
    const start = 10_000;
    const sleeping = beginSleepReducer(start, false)(baseState(start));
    const wake = wakeReducer(start + SLEEP_DURATION_MS / 3);

    const optimistic = wake(sleeping);
    // A conflict replay reapplies the identical reducer to the winner state
    // (arbitrarily later in wall-clock time). The captured timestamp keeps
    // the settlement byte-for-byte identical instead of re-reading the clock.
    const replayed = wake(sleeping);
    expect(replayed).toEqual(optimistic);
    expect(replayed.simulation.needs.energy).toBe(optimistic.simulation.needs.energy);
  });

  it("never regresses a gentle wake into a full night on late replay", () => {
    const start = 10_000;
    const tired = SaveStateSchema.parse({
      ...createDefaultSave(start),
      simulation: {
        needs: { hunger: 70, energy: 10, hygiene: 70, fun: 70 },
        lastSimulatedAt: start,
        sleep: null,
      },
    });
    const sleeping = beginSleepReducer(start, false)(tired);
    const wake = wakeReducer(start + SLEEP_DURATION_MS / 3);
    // Even when the replay physically happens after completesAt, the outcome
    // stays the partial rest the player actually saw when tapping wake.
    const replayedMuchLater = wake(sleeping);
    expect(replayedMuchLater.simulation.needs.energy).toBeCloseTo(40);
    expect(replayedMuchLater.simulation.needs.energy).toBeLessThan(100);
  });

  it("treats a second wake as a no-op instead of double-settling", () => {
    const start = 10_000;
    const sleeping = beginSleepReducer(start, false)(baseState(start));
    const awake = wakeReducer(start + SLEEP_DURATION_MS / 4)(sleeping);
    const doubleWake = wakeReducer(start + SLEEP_DURATION_MS / 2)(awake);
    expect(doubleWake).toBe(awake);
  });

  it("grants the full rest when the wake lands after natural completion", () => {
    const start = 10_000;
    const sleeping = beginSleepReducer(start, false)(baseState(start));
    const awake = wakeReducer(start + SLEEP_DURATION_MS + 1_000)(sleeping);
    expect(awake.simulation.sleep).toBeNull();
    // Fully rested at completion, minus one second of ordinary awake decay.
    expect(awake.simulation.needs.energy).toBeGreaterThan(99.99);
  });

  it("catches up offline time deterministically and skips no-op catch-ups", () => {
    const state = baseState(10_000);
    expect(catchUpOfflineReducer(10_000)(state)).toBe(state);
    const later = catchUpOfflineReducer(10_000 + 3_600_000)(state);
    expect(later.simulation.lastSimulatedAt).toBe(10_000 + 3_600_000);
    expect(later.simulation.needs.hunger).toBeLessThan(state.simulation.needs.hunger);
    expect(catchUpOfflineReducer(10_000 + 3_600_000)(later)).toBe(later);
  });
});

describe("settings reducers", () => {
  it("clamps the ui scale to the contract bounds", () => {
    expect(clampUiScale(Number.NaN)).toBe(1);
    expect(clampUiScale(0)).toBe(UI_SCALE_MIN);
    expect(clampUiScale(9)).toBe(UI_SCALE_MAX);
    const state = baseState();
    expect(setUiScaleReducer(1.2)(state).settings.uiScale).toBe(1.2);
    expect(setUiScaleReducer(0.1)(state).settings.uiScale).toBe(UI_SCALE_MIN);
    expect(setUiScaleReducer(5)(state).settings.uiScale).toBe(UI_SCALE_MAX);
    expect(setUiScaleReducer(1)(state)).toBe(state);
  });

  it("sets and clamps each audio bus volume independently", () => {
    const state = baseState();
    const quietMusic = setBusVolumeReducer("music", 0.25)(state);
    expect(quietMusic.settings.volumes.music).toBe(0.25);
    expect(quietMusic.settings.volumes.master).toBe(state.settings.volumes.master);
    expect(setBusVolumeReducer("voice", 4)(state).settings.volumes.voice).toBe(1);
    expect(setBusVolumeReducer("sfx", -2)(state).settings.volumes.sfx).toBe(0);
    expect(setBusVolumeReducer("master", state.settings.volumes.master)(state)).toBe(state);
    expect(setBusVolumeReducer("ui", 0.5)(state).settings.volumes.ui).toBe(0.5);
  });

  it("persists the language setting including auto", () => {
    const state = baseState();
    const german = setLanguageReducer("de")(state);
    expect(german.settings.language).toBe("de");
    expect(setLanguageReducer("de")(german)).toBe(german);
    expect(setLanguageReducer("auto")(german).settings.language).toBe("auto");
  });

  it("toggles the dev workshop and its flags", () => {
    const state = baseState();
    const unlocked = setDevWorkshopUnlockedReducer(true)(state);
    expect(unlocked.devWorkshop.unlocked).toBe(true);
    expect(setDevWorkshopUnlockedReducer(true)(unlocked)).toBe(unlocked);
    const flagged = setDevWorkshopFlagReducer("show-fps", true)(unlocked);
    expect(flagged.devWorkshop.flags["show-fps"]).toBe(true);
    expect(setDevWorkshopFlagReducer("show-fps", true)(flagged)).toBe(flagged);
    expect(setDevWorkshopFlagReducer("show-fps", false)(flagged).devWorkshop.flags["show-fps"])
      .toBe(false);
  });
});

describe("sticker and achievement reducers", () => {
  it("unlocks a sticker exactly once and never rewrites the timestamp", () => {
    const state = baseState();
    const unlocked = unlockStickerReducer("sticker.care.first-pet", 111)(state);
    expect(unlocked.stickers.unlocked["sticker.care.first-pet"]).toBe(111);
    const again = unlockStickerReducer("sticker.care.first-pet", 999)(unlocked);
    expect(again).toBe(unlocked);
    expect(again.stickers.unlocked["sticker.care.first-pet"]).toBe(111);
  });

  it("unlocks achievements exactly once", () => {
    const state = baseState();
    const unlocked = unlockAchievementReducer("achievement.first-week", 50)(state);
    expect(unlocked.achievements.unlocked["achievement.first-week"]).toBe(50);
    expect(unlockAchievementReducer("achievement.first-week", 999)(unlocked)).toBe(unlocked);
  });
});

describe("minigame settlement stats", () => {
  const receipt: MinigameSettlementReceipt = {
    runId: "cake-atelier:1000:1",
    minigameId: "cake-atelier",
    payout: { coins: 8, xp: 20, score: 120 },
    bestScore: 120,
    completedAt: 5_000,
  };

  it("records stats and the first-round game medal alongside the payout", () => {
    const state = baseState();
    const settled = settleMinigameReducer(receipt)(state);
    expect(settled.economy.coins).toBe(state.economy.coins + 8);
    expect(settled.ui.highScores["cake-atelier"]).toBe(120);
    expect(settled.minigameStats["cake-atelier"]).toEqual({
      plays: 1,
      bestScore: 120,
      totalScore: 120,
      lastPlayedAt: 5_000,
    });
    expect(settled.stickers.unlocked["sticker.games.first-round"]).toBe(5_000);
    expect(settled.stickers.unlocked["sticker.games.new-best"]).toBeUndefined();
    expect(settled.stickers.unlocked["sticker.games.three-games"]).toBeUndefined();
  });

  it("replays a settled run without double-counting stats or rewards", () => {
    const state = baseState();
    const settled = settleMinigameReducer(receipt)(state);
    const replayed = settleMinigameReducer(receipt)(settled);
    expect(replayed).toBe(settled);
  });

  it("accumulates plays across distinct runs but keeps the first medal time", () => {
    const state = baseState();
    const first = settleMinigameReducer(receipt)(state);
    const second = settleMinigameReducer({
      ...receipt,
      runId: "cake-atelier:2000:2",
      payout: { coins: 2, xp: 5, score: 60 },
      bestScore: 120,
      completedAt: 9_000,
    })(first);
    expect(second.minigameStats["cake-atelier"]).toEqual({
      plays: 2,
      bestScore: 120,
      totalScore: 180,
      lastPlayedAt: 9_000,
    });
    expect(second.stickers.unlocked["sticker.games.first-round"]).toBe(5_000);
    expect(second.stickers.unlocked["sticker.games.new-best"]).toBeUndefined();
    expect(second.ui.highScores["cake-atelier"]).toBe(120);
  });

  it("awards the new-best medal only when an existing best is beaten", () => {
    const state = baseState();
    const first = settleMinigameReducer(receipt)(state);
    const improved = settleMinigameReducer({
      ...receipt,
      runId: "cake-atelier:3000:3",
      payout: { coins: 4, xp: 10, score: 150 },
      bestScore: 150,
      completedAt: 12_000,
    })(first);
    expect(improved.stickers.unlocked["sticker.games.new-best"]).toBe(12_000);
    const again = settleMinigameReducer({
      ...receipt,
      runId: "cake-atelier:4000:4",
      payout: { coins: 4, xp: 10, score: 200 },
      bestScore: 200,
      completedAt: 15_000,
    })(improved);
    expect(again.stickers.unlocked["sticker.games.new-best"]).toBe(12_000);
  });

  it("unlocks the distinct-game medal at three different minigames", () => {
    const games: readonly MinigameId[] = ["carrot-catch", "bunny-hop", "rhythm-hop"];
    let state = baseState();
    for (const [index, minigameId] of games.entries()) {
      state = settleMinigameReducer({
        runId: `${minigameId}:${index}:1`,
        minigameId,
        payout: { coins: 1, xp: 2, score: 30 },
        bestScore: 30,
        completedAt: 20_000 + index,
      })(state);
    }
    expect(state.stickers.unlocked["sticker.games.three-games"]).toBe(20_002);
    expect(state.stickers.unlocked["sticker.games.six-games"]).toBeUndefined();
    expect(Object.keys(state.minigameStats)).toHaveLength(3);
  });
});
