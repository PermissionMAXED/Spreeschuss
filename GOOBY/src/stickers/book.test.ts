import { describe, expect, it } from "vitest";
import {
  SaveStateSchema,
  createDefaultSave,
  type CanonicalSaveState,
} from "../core/contracts/save";
import {
  DE_CATALOG,
  EN_CATALOG,
} from "../i18n";
import { createFakeDomHost } from "../minigames/shared/testing/fake-dom";
import type { FakeElement } from "../minigames/shared/testing/fake-dom";
import {
  createStickerBook,
  pageForKeyboard,
  pageForSwipe,
} from "./book";

function unlockedState(): CanonicalSaveState {
  const state = SaveStateSchema.parse(createDefaultSave(0));
  return SaveStateSchema.parse({
    ...state,
    stickers: {
      unlocked: {
        "sticker.care.first-pet": 86_400_000,
      },
    },
    achievements: {
      unlocked: {
        "sticker.care.first-pet": 86_400_000,
      },
    },
  });
}

function descendants(root: FakeElement): readonly FakeElement[] {
  return [
    root,
    ...root.childNodes.flatMap((child) => descendants(child)),
  ];
}

function withClass(root: FakeElement, className: string): readonly FakeElement[] {
  return descendants(root).filter((element) => element.classList.contains(className));
}

describe("sticker book model navigation", () => {
  it("clamps keyboard and swipe page navigation", () => {
    expect(pageForKeyboard("home-life", "ArrowLeft")).toBe("home-life");
    expect(pageForKeyboard("home-life", "End")).toBe("dreams-seasons");
    expect(pageForKeyboard("dreams-seasons", "ArrowRight")).toBe("dreams-seasons");
    expect(pageForKeyboard("city-days", "PageDown")).toBe("game-medals");
    expect(pageForKeyboard("city-days", "Escape")).toBeNull();
    expect(pageForSwipe("home-life", -47)).toBeNull();
    expect(pageForSwipe("home-life", -48)).toBe("city-days");
    expect(pageForSwipe("city-days", 70)).toBe("home-life");
  });
});

describe("accessible localized sticker book", () => {
  it("renders four pages of nine with images, silhouettes, progress, rarity, and dates", () => {
    const dom = createFakeDomHost();
    const seen: string[] = [];
    const book = createStickerBook({
      host: dom.asHtmlElement(dom.host),
      state: unlockedState(),
      catalog: EN_CATALOG,
      imageFor: (id) => id === "sticker.care.first-pet" ? "/stickers/first-pet.webp" : null,
      onStickerSeen: (id) => seen.push(id),
    });
    const root = book.root as unknown as FakeElement;

    expect(root.getAttribute("role")).toBe("region");
    expect(withClass(root, "sticker-page")).toHaveLength(4);
    expect(withClass(root, "sticker-page__grid").map(({ childElementCount }) => childElementCount))
      .toEqual([9, 9, 9, 9]);
    expect(withClass(root, "sticker-card")).toHaveLength(36);
    expect(withClass(root, "sticker-card__image")).toHaveLength(1);
    expect(withClass(root, "sticker-card__silhouette")).toHaveLength(35);

    const image = withClass(root, "sticker-card__image")[0];
    expect(image?.getAttribute("src")).toBe("/stickers/first-pet.webp");
    expect(image?.getAttribute("alt")).toContain("First Pat sticker, Common rarity");
    const unlockedCard = withClass(root, "sticker-card")
      .find((card) => card.getAttribute("data-sticker-id") === "sticker.care.first-pet");
    expect(unlockedCard?.getAttribute("aria-label")).toContain("Collected Jan 2, 1970");
    unlockedCard?.dispatch("click");
    expect(seen).toEqual(["sticker.care.first-pet"]);

    const lockedCard = withClass(root, "sticker-card")
      .find((card) => card.getAttribute("data-sticker-id") === "sticker.care.level-five");
    expect(lockedCard?.getAttribute("aria-label")).toContain("Reach level five.");
    expect(lockedCard?.getAttribute("aria-label")).toContain("Progress 0 of 5");
    expect(lockedCard?.getAttribute("aria-label")).toContain("Rare rarity");
    book.dispose();
  });

  it("localizes German alt text, hints, progress, dates, and rarity", () => {
    const dom = createFakeDomHost();
    const book = createStickerBook({
      host: dom.asHtmlElement(dom.host),
      state: unlockedState(),
      catalog: DE_CATALOG,
    });
    const root = book.root as unknown as FakeElement;
    const image = withClass(root, "sticker-card__image")[0];
    expect(image?.getAttribute("alt")).toContain("Erstes Streicheln-Sticker");
    expect(image?.getAttribute("alt")).toContain("Seltenheit Gewöhnlich");

    const unlockedCard = withClass(root, "sticker-card")
      .find((card) => card.getAttribute("data-sticker-id") === "sticker.care.first-pet");
    expect(unlockedCard?.getAttribute("aria-label")).toContain("Gesammelt am 02.01.1970");
    const lockedCard = withClass(root, "sticker-card")
      .find((card) => card.getAttribute("data-sticker-id") === "sticker.care.level-five");
    expect(lockedCard?.getAttribute("aria-label")).toContain("Erreiche Stufe fünf.");
    expect(lockedCard?.getAttribute("aria-label")).toContain("Fortschritt 0 von 5");
    expect(lockedCard?.getAttribute("aria-label")).toContain("Seltenheit Selten");
    book.dispose();
  });

  it("supports keyboard, pointer controls, swipe, uiScale, and reduced motion", () => {
    const dom = createFakeDomHost();
    const pages: string[] = [];
    const book = createStickerBook({
      host: dom.asHtmlElement(dom.host),
      state: unlockedState(),
      catalog: EN_CATALOG,
      uiScale: 9,
      reducedMotion: true,
      onPageChanged: (page) => pages.push(page),
    });
    const root = book.root as unknown as FakeElement;
    expect(root.style.getPropertyValue("--sticker-ui-scale")).toBe("1.35");
    expect(root.getAttribute("data-reduced-motion")).toBe("true");

    const keyEvent = root.dispatch("keydown", { key: "End" });
    expect(keyEvent.defaultPrevented).toBe(true);
    expect(book.page).toBe("dreams-seasons");
    root.dispatch("keydown", { key: "Home" });
    expect(book.page).toBe("home-life");
    root.dispatch("pointerdown", { clientX: 300, isPrimary: true });
    root.dispatch("pointerup", { clientX: 100, isPrimary: true });
    expect(book.page).toBe("city-days");

    const navButtons = descendants(root).filter(({ tagName }) => tagName === "BUTTON")
      .filter((element) => element.getAttribute("aria-label")?.includes("page"));
    expect(navButtons).toHaveLength(2);
    navButtons[1]?.dispatch("click");
    expect(book.page).toBe("game-medals");
    expect(pages).toEqual(["dreams-seasons", "home-life", "city-days", "game-medals"]);
    book.dispose();
  });

  it("uses a procedural image only when the manifest source is missing or fails", () => {
    const dom = createFakeDomHost();
    const book = createStickerBook({
      host: dom.asHtmlElement(dom.host),
      state: unlockedState(),
      catalog: EN_CATALOG,
      imageFor: () => "/stickers/missing.webp",
    });
    const root = book.root as unknown as FakeElement;
    const image = withClass(root, "sticker-card__image")[0];
    expect(image?.getAttribute("data-procedural-placeholder")).toBeNull();
    image?.dispatch("error");
    expect(image?.getAttribute("data-procedural-placeholder")).toBe("true");
    expect(image?.getAttribute("src")).toMatch(/^data:image\/svg\+xml/);
    book.dispose();
    expect(dom.host.childElementCount).toBe(0);
    expect(dom.document.getElementById("gooby-sticker-book-styles")).toBeNull();
  });
});
