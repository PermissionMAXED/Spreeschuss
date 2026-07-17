import { describe, expect, it } from "vitest";
import { MINIGAME_IDS, SHOP_IDS } from "../core/contracts/scenes";
import type { Needs } from "../core/contracts/simulation";
import {
  MINIGAME_CARDS,
  OnboardingProgress,
  UI_STORAGE_KEY,
  UiModel,
  formatCountdown,
  getLevelProgress,
  parseUiState,
  shopNavigationIntent,
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

  it("persists equipped slots, settings, and high scores defensively", () => {
    const storage = new MemoryStorage();
    const model = new UiModel(storage);

    model.equip("head", "sunny-bucket-hat");
    model.setPreference("reducedMotion", true);
    expect(model.recordResult("carrot-catch", 420)).toEqual({ isNewBest: true, best: 420 });
    expect(model.recordResult("carrot-catch", 120)).toEqual({ isNewBest: false, best: 420 });

    const restored = new UiModel(storage);
    expect(restored.persisted.equipped.head).toBe("sunny-bucket-hat");
    expect(restored.persisted.preferences.reducedMotion).toBe(true);
    expect(restored.persisted.highScores["carrot-catch"]).toBe(420);
    expect(storage.values.has(UI_STORAGE_KEY)).toBe(true);
    expect(parseUiState("{not json")).toMatchObject({ version: 1, highScores: {} });
  });

  it("formats sleep and level progress for compact HUD presentation", () => {
    expect(formatCountdown(30 * 60 * 1_000)).toBe("30:00");
    expect(formatCountdown(999)).toBe("00:01");
    expect(formatCountdown(-1)).toBe("00:00");
    expect(getLevelProgress({ coins: 0, xp: 50, level: 1 })).toBe(0.5);
  });
});
