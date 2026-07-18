import { describe, expect, it } from "vitest";
import {
  CITY_DAYS_STICKER_IDS,
  DREAMS_SEASONS_STICKER_IDS,
  GAME_MEDAL_STICKER_IDS,
  HOME_LIFE_STICKER_IDS,
  isStickerId,
  STICKER_COUNT,
  STICKER_DEFINITIONS,
  STICKER_IDS,
  STICKER_PAGE_IDS,
  STICKERS_BY_ID,
  STICKERS_PER_PAGE,
  stickersOnPage,
} from "../src/core/contracts/stickers";
import { DE_CATALOG, EN_CATALOG } from "../src/i18n";
import {
  isStickerUnlocked,
  stickerBookPages,
  stickerProgress,
} from "../src/stickers";

describe("sticker contract", () => {
  it("freezes exactly thirty-six unique sticker ids", () => {
    expect(STICKER_COUNT).toBe(36);
    expect(STICKER_IDS).toHaveLength(36);
    expect(new Set(STICKER_IDS).size).toBe(36);
    expect(STICKER_DEFINITIONS).toHaveLength(36);
    expect(STICKERS_BY_ID.size).toBe(36);
  });

  it("lays out four lead pages of exactly nine stickers each", () => {
    expect(STICKER_PAGE_IDS).toEqual([
      "home-life",
      "city-days",
      "game-medals",
      "dreams-seasons",
    ]);
    expect(STICKERS_PER_PAGE).toBe(9);
    for (const page of STICKER_PAGE_IDS) {
      const entries = stickersOnPage(page);
      expect(entries).toHaveLength(9);
      expect(entries.map(({ slot }) => slot)).toEqual(Array.from({ length: 9 }, (_, i) => i));
      for (const entry of entries) {
        expect(entry.page).toBe(page);
        expect(entry.icon.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("assigns every lead-list sticker to its themed page", () => {
    expect(HOME_LIFE_STICKER_IDS).toHaveLength(9);
    expect(CITY_DAYS_STICKER_IDS).toHaveLength(9);
    expect(GAME_MEDAL_STICKER_IDS).toHaveLength(9);
    expect(DREAMS_SEASONS_STICKER_IDS).toHaveLength(9);
    for (const id of HOME_LIFE_STICKER_IDS) {
      expect(STICKERS_BY_ID.get(id)?.page).toBe("home-life");
    }
    for (const id of CITY_DAYS_STICKER_IDS) {
      expect(STICKERS_BY_ID.get(id)?.page).toBe("city-days");
    }
    for (const id of GAME_MEDAL_STICKER_IDS) {
      expect(STICKERS_BY_ID.get(id)?.page).toBe("game-medals");
    }
    for (const id of DREAMS_SEASONS_STICKER_IDS) {
      expect(STICKERS_BY_ID.get(id)?.page).toBe("dreams-seasons");
    }
  });

  it("keeps the original care and city milestone ids stable", () => {
    expect(HOME_LIFE_STICKER_IDS).toEqual([
      "sticker.care.first-pet",
      "sticker.care.first-feed",
      "sticker.care.first-bath",
      "sticker.care.full-night-sleep",
      "sticker.care.gentle-wake",
      "sticker.care.garden-harvest",
      "sticker.care.wardrobe-first-outfit",
      "sticker.care.decorated-room",
      "sticker.care.level-five",
    ]);
    expect(CITY_DAYS_STICKER_IDS.slice(0, 3)).toEqual([
      "sticker.city.first-trip",
      "sticker.city.all-shops",
      "sticker.city.smooth-driver",
    ]);
  });

  it("guards sticker ids at runtime", () => {
    expect(isStickerId("sticker.care.first-pet")).toBe(true);
    expect(isStickerId("sticker.games.all-games")).toBe(true);
    expect(isStickerId("sticker.seasons.winter-frost")).toBe(true);
    expect(isStickerId("sticker.minigame.library-stack")).toBe(false);
    expect(isStickerId("sticker.games.nonexistent")).toBe(false);
    expect(isStickerId(12)).toBe(false);
  });
});

describe("sticker book module", () => {
  it("builds localized pages with unlock timestamps", () => {
    const unlocks = {
      "sticker.care.first-pet": 111,
      "sticker.games.first-round": 222,
    } as const;
    const pagesEn = stickerBookPages(unlocks, EN_CATALOG);
    const pagesDe = stickerBookPages(unlocks, DE_CATALOG);
    expect(pagesEn).toHaveLength(4);
    expect(pagesEn.map(({ id }) => id)).toEqual([...STICKER_PAGE_IDS]);
    expect(pagesEn.every(({ entries }) => entries.length === 9)).toBe(true);

    const firstPet = pagesEn[0]?.entries.find(
      ({ definition }) => definition.id === "sticker.care.first-pet",
    );
    expect(firstPet?.unlockedAt).toBe(111);
    expect(firstPet?.title.trim().length).toBeGreaterThan(0);

    const firstRoundEn = pagesEn[2]?.entries.find(
      ({ definition }) => definition.id === "sticker.games.first-round",
    );
    const firstRoundDe = pagesDe[2]?.entries.find(
      ({ definition }) => definition.id === "sticker.games.first-round",
    );
    expect(firstRoundEn?.unlockedAt).toBe(222);
    expect(firstRoundEn?.title).toBe(EN_CATALOG.stickers["sticker.games.first-round"].title);
    expect(firstRoundDe?.title).toBe(DE_CATALOG.stickers["sticker.games.first-round"].title);
    expect(firstRoundEn?.title).not.toBe(firstRoundDe?.title);

    const locked = pagesEn[2]?.entries.find(
      ({ definition }) => definition.id === "sticker.games.all-games",
    );
    expect(locked?.unlockedAt).toBeNull();
  });

  it("titles every page from the localized catalogs", () => {
    const pagesEn = stickerBookPages({}, EN_CATALOG);
    const pagesDe = stickerBookPages({}, DE_CATALOG);
    for (const [index, page] of STICKER_PAGE_IDS.entries()) {
      expect(pagesEn[index]?.title).toBe(EN_CATALOG.stickerPages[page]);
      expect(pagesDe[index]?.title).toBe(DE_CATALOG.stickerPages[page]);
      expect(pagesEn[index]?.title.trim().length).toBeGreaterThan(0);
      expect(pagesDe[index]?.title.trim().length).toBeGreaterThan(0);
    }
  });

  it("counts unlock progress out of thirty-six", () => {
    expect(stickerProgress({})).toEqual({ unlocked: 0, total: 36 });
    expect(stickerProgress({ "sticker.care.first-pet": 1 })).toEqual({ unlocked: 1, total: 36 });
    const all = Object.fromEntries(STICKER_IDS.map((id) => [id, 5]));
    expect(stickerProgress(all)).toEqual({ unlocked: 36, total: 36 });
  });

  it("answers unlock membership without mutating the table", () => {
    const unlocks = { "sticker.care.first-feed": 9 } as const;
    expect(isStickerUnlocked(unlocks, "sticker.care.first-feed")).toBe(true);
    expect(isStickerUnlocked(unlocks, "sticker.care.first-pet")).toBe(false);
    expect(unlocks).toEqual({ "sticker.care.first-feed": 9 });
  });
});
