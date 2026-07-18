import { afterEach, describe, expect, it } from "vitest";
import {
  APP_LANGUAGES,
  DEFAULT_LANGUAGE_SETTING,
  FALLBACK_LANGUAGE,
  isAppLanguage,
  isLanguageSetting,
  LANGUAGE_SETTINGS,
  resolveLanguage,
} from "../src/core/contracts/i18n";
import { MINIGAME_IDS, SHOP_IDS } from "../src/core/contracts/scenes";
import { STICKER_IDS, STICKER_PAGE_IDS } from "../src/core/contracts/stickers";
import {
  activeCatalog,
  applyLanguageSetting,
  catalogFor,
  catalogParityIssues,
  DE_CATALOG,
  EN_CATALOG,
  getActiveLanguage,
  localizedText,
  onLanguageChanged,
  pickLocalized,
  setActiveLanguage,
} from "../src/i18n";
import {
  MINIGAME_COPY,
  SHOP_COPY,
  STRINGS,
} from "../src/data/strings";
import {
  EN_MINIGAME_COPY,
  EN_SHOP_COPY,
  EN_STRINGS,
} from "../src/i18n/en";

afterEach(() => {
  setActiveLanguage(FALLBACK_LANGUAGE);
});

describe("language contract", () => {
  it("ships exactly english and german plus an auto setting", () => {
    expect(APP_LANGUAGES).toEqual(["en", "de"]);
    expect(LANGUAGE_SETTINGS).toEqual(["auto", "en", "de"]);
    expect(DEFAULT_LANGUAGE_SETTING).toBe("auto");
    expect(FALLBACK_LANGUAGE).toBe("en");
  });

  it("guards language values at runtime", () => {
    expect(isAppLanguage("en")).toBe(true);
    expect(isAppLanguage("de")).toBe(true);
    expect(isAppLanguage("auto")).toBe(false);
    expect(isAppLanguage("fr")).toBe(false);
    expect(isAppLanguage(7)).toBe(false);
    expect(isLanguageSetting("auto")).toBe(true);
    expect(isLanguageSetting("de")).toBe(true);
    expect(isLanguageSetting("fr")).toBe(false);
  });

  it("resolves auto from the device locale list with an english fallback", () => {
    expect(resolveLanguage("en", ["de-DE"])).toBe("en");
    expect(resolveLanguage("de", ["en-US"])).toBe("de");
    expect(resolveLanguage("auto", ["de-DE", "en-US"])).toBe("de");
    expect(resolveLanguage("auto", ["DE_at"])).toBe("de");
    expect(resolveLanguage("auto", ["fr-FR", "en-GB"])).toBe("en");
    expect(resolveLanguage("auto", ["fr-FR", "ja-JP"])).toBe("en");
    expect(resolveLanguage("auto", [])).toBe("en");
    expect(resolveLanguage("auto")).toBe("en");
  });
});

describe("runtime language switch", () => {
  it("switches the active catalog and notifies only on real changes", () => {
    const seen: string[] = [];
    const stop = onLanguageChanged((language) => seen.push(language));
    expect(getActiveLanguage()).toBe("en");
    expect(activeCatalog()).toBe(EN_CATALOG);

    expect(setActiveLanguage("de")).toBe("de");
    expect(activeCatalog()).toBe(DE_CATALOG);
    expect(setActiveLanguage("de")).toBe("de");
    expect(seen).toEqual(["de"]);

    expect(setActiveLanguage("en")).toBe("en");
    expect(seen).toEqual(["de", "en"]);
    stop();
    setActiveLanguage("de");
    expect(seen).toEqual(["de", "en"]);
  });

  it("applies a persisted setting including auto resolution", () => {
    expect(applyLanguageSetting("de")).toBe("de");
    expect(getActiveLanguage()).toBe("de");
    expect(applyLanguageSetting("auto", ["de-CH"])).toBe("de");
    expect(applyLanguageSetting("auto", ["pt-BR"])).toBe("en");
    expect(getActiveLanguage()).toBe("en");
  });

  it("builds and resolves localized manifest text for both languages", () => {
    const text = localizedText((catalog) => catalog.strings.appName);
    expect(text.en).toBe(EN_CATALOG.strings.appName);
    expect(text.de).toBe(DE_CATALOG.strings.appName);
    expect(pickLocalized(text)).toBe(text.en);
    setActiveLanguage("de");
    expect(pickLocalized(text)).toBe(text.de);
    expect(pickLocalized(text, "en")).toBe(text.en);
  });

  it("returns the requested catalog by language", () => {
    expect(catalogFor("en")).toBe(EN_CATALOG);
    expect(catalogFor("de")).toBe(DE_CATALOG);
  });
});

describe("catalog parity", () => {
  it("has structurally identical english and german catalogs", () => {
    expect(catalogParityIssues()).toEqual([]);
  });

  it("covers every minigame, shop, sticker, and sticker page in both languages", () => {
    for (const catalog of [EN_CATALOG, DE_CATALOG]) {
      expect(Object.keys(catalog.minigames).sort()).toEqual([...MINIGAME_IDS].sort());
      expect(Object.keys(catalog.shops).sort()).toEqual([...SHOP_IDS].sort());
      expect(Object.keys(catalog.stickers).sort()).toEqual([...STICKER_IDS].sort());
      expect(Object.keys(catalog.stickerPages).sort()).toEqual([...STICKER_PAGE_IDS].sort());
      for (const id of MINIGAME_IDS) {
        expect(catalog.minigames[id].title.trim().length, `${catalog.language} ${id}`).toBeGreaterThan(0);
        expect(catalog.minigames[id].instructions.trim().length).toBeGreaterThan(0);
        expect(catalog.minigames[id].icon.trim().length).toBeGreaterThan(0);
      }
      for (const id of STICKER_IDS) {
        expect(catalog.stickers[id].title.trim().length, `${catalog.language} ${id}`).toBeGreaterThan(0);
        expect(catalog.stickers[id].description.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("shares icons between languages while translating display text", () => {
    for (const id of MINIGAME_IDS) {
      expect(EN_CATALOG.minigames[id].icon).toBe(DE_CATALOG.minigames[id].icon);
    }
    expect(EN_CATALOG.strings.settings.language).not.toBe(DE_CATALOG.strings.settings.language);
    expect(EN_CATALOG.strings.nav.Settings).not.toBe(DE_CATALOG.strings.nav.Settings);
  });

  it("keeps the parameterized strings callable in both languages", () => {
    for (const catalog of [EN_CATALOG, DE_CATALOG]) {
      expect(catalog.strings.play.unlockAt(4).length).toBeGreaterThan(0);
      expect(catalog.strings.play.best(120).length).toBeGreaterThan(0);
      expect(catalog.strings.items.owned(2).length).toBeGreaterThan(0);
      expect(catalog.strings.items.placeHandoff("Sofa").length).toBeGreaterThan(0);
      expect(catalog.strings.stickers.progress(3, 36)).toContain("3");
    }
  });
});

describe("strings compatibility re-export", () => {
  it("keeps the frozen english bindings importable from data/strings", () => {
    expect(STRINGS).toBe(EN_STRINGS);
    expect(SHOP_COPY).toBe(EN_SHOP_COPY);
    expect(MINIGAME_COPY).toBe(EN_MINIGAME_COPY);
    expect(STRINGS.appName.trim().length).toBeGreaterThan(0);
    expect(Object.keys(MINIGAME_COPY)).toHaveLength(24);
  });
});
