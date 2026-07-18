import { describe, expect, it } from "vitest";
import { MINIGAME_IDS, SHOP_IDS } from "../core/contracts/scenes";
import type { Needs } from "../core/contracts/simulation";
import {
  DEFAULT_UI_QUIET_HOURS,
  DEV_UNLOCK_TAPS,
  DEV_UNLOCK_WINDOW_MS,
  DevUnlockTracker,
  GAME_CATEGORY_BY_GAME,
  GAME_CATEGORY_IDS,
  MINIGAME_CARDS,
  OnboardingProgress,
  UI_EXTRA_COPY,
  UI_SCALE_PRESETS,
  UI_STORAGE_KEY,
  UiModel,
  clampUiScaleInput,
  formatUiScale,
  gamesInCategory,
  paginate,
  percentToVolume,
  readLegacyUiState,
  removeLegacyUiState,
  formatCountdown,
  formatQuietHour,
  getLevelProgress,
  parseQuietHourValue,
  parseUiState,
  quietHoursPresentation,
  shopNavigationIntent,
  volumeToPercent,
  type StorageLike,
} from "./model";

class MemoryStorage implements StorageLike {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

const NEEDS: Needs = { hunger: 50, energy: 60, hygiene: 70, fun: 40 };

describe("portrait UI model", () => {
  it("lists every frozen minigame exactly once with presentation metadata", () => {
    expect(MINIGAME_CARDS.map((game) => game.id)).toEqual(MINIGAME_IDS);
    expect(new Set(MINIGAME_CARDS.map((game) => game.title)).size).toBe(MINIGAME_IDS.length);
    expect(MINIGAME_CARDS.every((game) => game.icon && game.instructions && game.unlockLevel > 0)).toBe(true);
  });

  it("routes every shop through the city destination board", () => {
    for (const shop of SHOP_IDS) {
      expect(shopNavigationIntent(shop)).toEqual({
        destination: { kind: "city-board" },
        selectedShop: shop,
      });
    }
  });

  it("blocks Living Room teleport during an active first city trip", () => {
    const model = new UiModel();
    model.selectCityDestination("cloud-boutique");
    model.beginCityTrip();

    expect(model.requestLivingRoom("Finish the trip")).toEqual({
      allowed: false,
      destination: { kind: "home", zone: "living-room" },
      message: "Finish the trip",
    });

    model.markCityArrival();
    model.openReturnBoard();
    model.beginReturnTrip();
    expect(model.requestLivingRoom("Finish the trip").allowed).toBe(false);
    model.completeReturnTrip();
    expect(model.requestLivingRoom("Finish the trip").allowed).toBe(true);
  });

  it("requires observed pet and feed changes before onboarding can complete", () => {
    const onboarding = new OnboardingProgress();
    onboarding.begin(NEEDS, 3);
    onboarding.leaveIntro();

    expect(onboarding.complete()).toBe(false);
    onboarding.observe(NEEDS, 3);
    expect(onboarding.currentStep).toBe("pet");

    onboarding.observe({ ...NEEDS, fun: 40.5 }, 3);
    expect(onboarding.currentStep).toBe("feed");
    expect(onboarding.complete()).toBe(false);

    onboarding.observe({ ...NEEDS, fun: 40.5, hunger: 72 }, 2);
    expect(onboarding.currentStep).toBe("meters");
    expect(onboarding.complete()).toBe(true);
  });

  it("reads legacy UI once and keeps subsequent UI state canonical-save only", () => {
    const storage = new MemoryStorage();
    storage.setItem(UI_STORAGE_KEY, JSON.stringify({
      version: 1,
      equipped: { head: "sunny-bucket-hat" },
      preferences: { audio: false, haptics: true, reducedMotion: true, notifications: false },
      highScores: { "carrot-catch": 420 },
      sleepRationaleSeen: true,
    }));
    const legacy = readLegacyUiState(storage);
    expect(legacy).not.toBeNull();
    const model = new UiModel(legacy ?? undefined);

    expect(model.recordResult("carrot-catch", 120)).toEqual({ isNewBest: false, best: 420 });
    expect(model.persisted.equipped.head).toBe("sunny-bucket-hat");
    expect(model.persisted.preferences.reducedMotion).toBe(true);
    expect(storage.values.has(UI_STORAGE_KEY)).toBe(true);
    removeLegacyUiState(storage);
    expect(storage.values.has(UI_STORAGE_KEY)).toBe(false);
    expect(parseUiState("{not json")).toMatchObject({ version: 1, highScores: {} });
  });

  it("parses safe whole-hour quiet settings and defaults controls to 21:00–08:00", () => {
    const parsed = parseUiState(JSON.stringify({
      version: 1,
      quietHours: { startHour: 22, endHour: 7 },
    }));
    expect(parsed.quietHours).toEqual({ startHour: 22, endHour: 7 });
    expect(parseUiState(JSON.stringify({
      version: 1,
      quietHours: { startHour: 24, endHour: -1 },
    })).quietHours).toBeUndefined();
    expect(quietHoursPresentation(null, 0).bounds).toEqual(DEFAULT_UI_QUIET_HOURS);
    expect(formatQuietHour(8)).toBe("08:00");
    expect(parseQuietHourValue("23:00")).toBe(23);
    expect(parseQuietHourValue("23:30")).toBeNull();
  });

  it("reports 21:00–08:00 boundaries and equal-time semantics deterministically", () => {
    const at = (hour: number, minute = 0): number =>
      new Date(2026, 0, 2, hour, minute, 0, 0).getTime();
    const overnight = { startHour: 21, endHour: 8 };

    expect(quietHoursPresentation(overnight, at(20, 59)).quietNow).toBe(false);
    expect(quietHoursPresentation(overnight, at(21)).quietNow).toBe(true);
    expect(quietHoursPresentation(overnight, at(7, 59)).quietNow).toBe(true);
    expect(quietHoursPresentation(overnight, at(8)).quietNow).toBe(false);
    expect(quietHoursPresentation(overnight, at(22)).explanation)
      .toBe("Runs overnight from 21:00 to 08:00. Reminders due then wait until 08:00.");

    const equal = quietHoursPresentation({ startHour: 8, endHour: 8 }, at(8));
    expect(equal.quietNow).toBe(false);
    expect(equal.status).toContain("matching times create no quiet interval");
  });

  it("formats sleep and level progress for compact HUD presentation", () => {
    expect(formatCountdown(30 * 60 * 1_000)).toBe("30:00");
    expect(formatCountdown(999)).toBe("00:01");
    expect(formatCountdown(-1)).toBe("00:00");
    expect(getLevelProgress({ coins: 0, xp: 50, level: 1 })).toBe(0.5);
  });

  it("assigns every one of the 24 minigames to exactly one hub category", () => {
    expect(MINIGAME_IDS).toHaveLength(24);
    const categorized = GAME_CATEGORY_IDS.flatMap((category) =>
      gamesInCategory(category).map((card) => card.id));
    expect([...categorized].sort()).toEqual([...MINIGAME_IDS].sort());
    for (const id of MINIGAME_IDS) {
      expect(GAME_CATEGORY_IDS).toContain(GAME_CATEGORY_BY_GAME[id]);
    }
  });

  it("clamps UI scale to the 0.85–1.35 contract and formats presets as percentages", () => {
    expect(UI_SCALE_PRESETS[0]).toBe(0.85);
    expect(UI_SCALE_PRESETS.at(-1)).toBe(1.35);
    expect(clampUiScaleInput(0.5)).toBe(0.85);
    expect(clampUiScaleInput(2)).toBe(1.35);
    expect(clampUiScaleInput(Number.NaN)).toBe(1);
    expect(formatUiScale(0.85)).toBe("85%");
    expect(formatUiScale(1.35)).toBe("135%");
  });

  it("round-trips volumes between canonical 0–1 and 0–100 slider percentages", () => {
    expect(volumeToPercent(0.4)).toBe(40);
    expect(volumeToPercent(7)).toBe(100);
    expect(percentToVolume(40)).toBe(0.4);
    expect(percentToVolume(-5)).toBe(0);
    expect(percentToVolume(Number.NaN)).toBe(1);
    for (const percent of [0, 13, 50, 100]) {
      expect(volumeToPercent(percentToVolume(percent))).toBe(percent);
    }
  });

  it("pages the 48-item wardrobe lists with clamped page indexes", () => {
    const items = Array.from({ length: 48 }, (_, index) => index);
    expect(paginate(items, 0, 6)).toMatchObject({ page: 0, pages: 8 });
    expect(paginate(items, 7, 6).items).toEqual([42, 43, 44, 45, 46, 47]);
    expect(paginate(items, 99, 6).page).toBe(7);
    expect(paginate(items, -3, 6).page).toBe(0);
    expect(paginate([], 4, 6)).toEqual({ items: [], page: 0, pages: 1 });
  });

  it("unlocks the dev workshop on exactly seven taps inside ten seconds", () => {
    const tracker = new DevUnlockTracker();
    const start = 100_000;

    // Six taps never unlock.
    for (let tap = 0; tap < DEV_UNLOCK_TAPS - 1; tap += 1) {
      expect(tracker.tap(start + tap * 100)).toBe(false);
    }
    expect(tracker.count).toBe(6);

    // The seventh within the window unlocks and resets the tracker.
    expect(tracker.tap(start + 700)).toBe(true);
    expect(tracker.count).toBe(0);

    // Seven taps spread wider than the window never unlock.
    const slow = new DevUnlockTracker();
    for (let tap = 0; tap < DEV_UNLOCK_TAPS; tap += 1) {
      expect(slow.tap(start + tap * (DEV_UNLOCK_WINDOW_MS / 4))).toBe(false);
    }

    // A timeout drops stale taps instead of counting them forever.
    const resumed = new DevUnlockTracker();
    resumed.tap(start);
    resumed.tap(start + DEV_UNLOCK_WINDOW_MS + 1);
    expect(resumed.count).toBe(1);
  });

  it("keeps English and German UI-extra copy structurally identical", () => {
    const keysOf = (value: object): string[] => Object.keys(value).sort();
    expect(keysOf(UI_EXTRA_COPY.de)).toEqual(keysOf(UI_EXTRA_COPY.en));
    expect(keysOf(UI_EXTRA_COPY.de.categories)).toEqual(keysOf(UI_EXTRA_COPY.en.categories));
    expect(keysOf(UI_EXTRA_COPY.de.wardrobeSlots)).toEqual(keysOf(UI_EXTRA_COPY.en.wardrobeSlots));
    expect(keysOf(UI_EXTRA_COPY.de.dev)).toEqual(keysOf(UI_EXTRA_COPY.en.dev));
    expect(UI_EXTRA_COPY.de.page(2, 8)).toBe("Seite 2 von 8");
    expect(UI_EXTRA_COPY.en.page(2, 8)).toBe("Page 2 of 8");
  });
});
