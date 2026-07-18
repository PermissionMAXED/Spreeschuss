import type { CanonicalSaveState } from "../core/contracts/save";
import {
  STICKER_IDS,
  STICKER_PAGE_IDS,
  stickersOnPage,
  type StickerDefinition,
  type StickerId,
  type StickerPageId,
} from "../core/contracts/stickers";
import {
  activeCatalog,
  type AppLanguage,
  type LanguageCatalog,
} from "../i18n";
import {
  ACHIEVEMENTS_BY_ID,
  type AchievementRarity,
} from "../data/achievements";
import stickerAssetManifest from "../data/stickers/manifest.json";
import {
  achievementProgress,
  isStickerNew,
} from "./progression";

const STYLE_ID = "gooby-sticker-book-styles";
const SWIPE_DISTANCE = 48;
let styleUsers = 0;
let nextBookInstance = 1;

const STYLES = `
.sticker-book{--sticker-ui-scale:1;position:relative;color:#49382f;font-size:calc(16px * var(--sticker-ui-scale));touch-action:pan-y}
.sticker-book[data-reduced-motion="false"] .sticker-card,.sticker-book[data-reduced-motion="false"] .sticker-page{transition:transform .18s ease,opacity .18s ease}
.sticker-book__header{align-items:center;display:flex;gap:.65em;justify-content:space-between}
.sticker-book__title{font-size:1.35em;margin:0}.sticker-book__progress{font-size:.8em;margin:.2em 0 0}
.sticker-book__nav{align-items:center;display:flex;gap:.5em;justify-content:center;margin:.75em 0}
.sticker-book__nav button{background:#fff8e8;border:2px solid #bd9e76;border-radius:999px;color:inherit;min-height:2.75em;min-width:2.75em}
.sticker-book__nav button:focus-visible,.sticker-card:focus-visible{outline:3px solid #4b7d72;outline-offset:2px}
.sticker-book__pages{position:relative}.sticker-page[hidden]{display:none}.sticker-page__heading{text-align:center}
.sticker-page__grid{display:grid;gap:.65em;grid-template-columns:repeat(3,minmax(0,1fr));list-style:none;margin:0;padding:0}
.sticker-card{align-items:center;background:#fffaf0;border:2px solid #ddc59d;border-radius:1em;color:inherit;display:flex;flex-direction:column;gap:.28em;min-height:8.7em;padding:.55em;position:relative;text-align:center;width:100%}
.sticker-card[data-locked="true"]{background:#ebe5dc;border-style:dashed;color:#766c63}
.sticker-card__image,.sticker-card__silhouette{align-items:center;border-radius:50%;display:flex;height:3.35em;justify-content:center;width:3.35em}
.sticker-card__image{object-fit:contain}.sticker-card__silhouette{background:#8e8881;color:#cbc6bf;filter:grayscale(1);font-size:1.5em}
.sticker-card__title{font-size:.82em;font-weight:700}.sticker-card__meta,.sticker-card__hint{font-size:.67em;line-height:1.25}
.sticker-card__hint{margin:0}.sticker-card__new{background:#a94358;border-radius:999px;color:white;font-size:.6em;font-weight:800;padding:.2em .45em;position:absolute;right:.35em;top:.35em}
.sticker-card__rarity{font-size:.62em;font-weight:700;letter-spacing:.04em;text-transform:uppercase}
@media (max-width:340px){.sticker-page__grid{gap:.4em}.sticker-card{padding:.35em}}
`;

interface StickerBookUiCopy {
  readonly previous: string;
  readonly next: string;
  readonly page: (current: number, total: number) => string;
  readonly locked: string;
  readonly unlocked: string;
  readonly newBadge: string;
  readonly progress: (current: number, target: number) => string;
  readonly collectedAt: (date: string) => string;
  readonly imageAlt: (title: string, rarity: string) => string;
  readonly lockedAlt: (hint: string, progress: string, rarity: string) => string;
  readonly rarity: Readonly<Record<AchievementRarity, string>>;
}

const BOOK_COPY: Readonly<Record<AppLanguage, StickerBookUiCopy>> = {
  en: {
    previous: "Previous sticker page",
    next: "Next sticker page",
    page: (current, total) => `Page ${current} of ${total}`,
    locked: "Locked",
    unlocked: "Collected",
    newBadge: "New",
    progress: (current, target) => `Progress ${current} of ${target}`,
    collectedAt: (date) => `Collected ${date}`,
    imageAlt: (title, rarity) => `${title} sticker, ${rarity} rarity`,
    lockedAlt: (hint, progress, rarity) => `Locked sticker. ${hint} ${progress}. ${rarity} rarity.`,
    rarity: {
      common: "Common",
      uncommon: "Uncommon",
      rare: "Rare",
      legendary: "Legendary",
    },
  },
  de: {
    previous: "Vorherige Stickerseite",
    next: "Nächste Stickerseite",
    page: (current, total) => `Seite ${current} von ${total}`,
    locked: "Gesperrt",
    unlocked: "Gesammelt",
    newBadge: "Neu",
    progress: (current, target) => `Fortschritt ${current} von ${target}`,
    collectedAt: (date) => `Gesammelt am ${date}`,
    imageAlt: (title, rarity) => `${title}-Sticker, Seltenheit ${rarity}`,
    lockedAlt: (hint, progress, rarity) => `Gesperrter Sticker. ${hint} ${progress}. Seltenheit ${rarity}.`,
    rarity: {
      common: "Gewöhnlich",
      uncommon: "Ungewöhnlich",
      rare: "Selten",
      legendary: "Legendär",
    },
  },
};

export type StickerImageResolver = (id: StickerId) => string | null | undefined;

export type StickerImageManifestEntry =
  | string
  | {
      readonly src?: string;
      readonly url?: string;
      readonly image?: string;
    };

export type StickerImageManifest = Readonly<Partial<Record<StickerId, StickerImageManifestEntry>>>;

/** Adapts the frozen data manifest without coupling the component to its loader. */
export function stickerImageResolverFromManifest(
  manifest: StickerImageManifest,
): StickerImageResolver {
  return (id) => {
    const entry = manifest[id];
    if (typeof entry === "string") return entry;
    return entry?.src ?? entry?.url ?? entry?.image ?? null;
  };
}

interface FrozenStickerAsset {
  readonly runtime: { readonly path: string };
  readonly alt: Readonly<Record<AppLanguage, string>>;
}

function isFrozenStickerId(value: string): value is StickerId {
  return (STICKER_IDS as readonly string[]).includes(value);
}

const FROZEN_ASSETS_BY_ID: ReadonlyMap<StickerId, FrozenStickerAsset> = new Map(
  stickerAssetManifest.stickers.flatMap((entry) => {
    if (!isFrozenStickerId(entry.id)) return [];
    return [[entry.id, {
      runtime: entry.runtime,
      alt: entry.alt,
    }] as const];
  }),
);

if (FROZEN_ASSETS_BY_ID.size !== STICKER_IDS.length) {
  throw new Error("The sticker image manifest must cover all 36 frozen sticker IDs");
}

function publicAssetUrl(path: string): string {
  return path.startsWith("public/") ? `/${path.slice("public/".length)}` : path;
}

/** Default resolver for the generated, offline runtime WebP manifest. */
export const manifestStickerImage: StickerImageResolver = (id) => {
  const path = FROZEN_ASSETS_BY_ID.get(id)?.runtime.path;
  return path ? publicAssetUrl(path) : null;
};

export interface StickerBookOptions {
  readonly host: HTMLElement;
  readonly state: CanonicalSaveState;
  readonly catalog?: LanguageCatalog;
  readonly imageFor?: StickerImageResolver;
  readonly initialPage?: StickerPageId;
  readonly uiScale?: number;
  readonly reducedMotion?: boolean;
  readonly onStickerSeen?: (id: StickerId) => void;
  readonly onPageChanged?: (page: StickerPageId) => void;
}

export interface StickerBook {
  readonly root: HTMLElement;
  readonly page: StickerPageId;
  showPage(page: StickerPageId): void;
  update(state: CanonicalSaveState, catalog?: LanguageCatalog): void;
  dispose(): void;
}

function acquireStyles(document: Document): () => void {
  styleUsers += 1;
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = STYLES;
    document.head.append(style);
  }
  return () => {
    styleUsers = Math.max(0, styleUsers - 1);
    if (styleUsers === 0) document.getElementById(STYLE_ID)?.remove();
  };
}

function hashId(id: string): number {
  let hash = 2166136261;
  for (const character of id) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** Temporary, local fallback used only when a manifest image is absent or fails. */
export function proceduralStickerPlaceholder(definition: StickerDefinition): string {
  const hue = hashId(definition.id) % 360;
  const icon = definition.icon
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160"><circle cx="80" cy="80" r="72" fill="hsl(${hue} 62% 86%)" stroke="hsl(${hue} 42% 43%)" stroke-width="8"/><circle cx="80" cy="80" r="56" fill="hsl(${hue} 72% 94%)"/><text x="80" y="101" text-anchor="middle" font-size="62" font-family="system-ui,sans-serif">${icon}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function safeScale(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 1;
  return Math.min(1.35, Math.max(0.85, value));
}

function localizedDate(timestamp: number, language: AppLanguage): string {
  return new Intl.DateTimeFormat(language === "de" ? "de-DE" : "en-US", {
    dateStyle: "medium",
  }).format(new Date(timestamp));
}

function pageIndex(page: StickerPageId): number {
  return STICKER_PAGE_IDS.indexOf(page);
}

export function pageForKeyboard(
  page: StickerPageId,
  key: string,
): StickerPageId | null {
  const index = pageIndex(page);
  if (key === "ArrowLeft" || key === "PageUp") {
    return STICKER_PAGE_IDS[Math.max(0, index - 1)] ?? null;
  }
  if (key === "ArrowRight" || key === "PageDown") {
    return STICKER_PAGE_IDS[Math.min(STICKER_PAGE_IDS.length - 1, index + 1)] ?? null;
  }
  if (key === "Home") return STICKER_PAGE_IDS[0] ?? null;
  if (key === "End") return STICKER_PAGE_IDS.at(-1) ?? null;
  return null;
}

export function pageForSwipe(
  page: StickerPageId,
  deltaX: number,
): StickerPageId | null {
  if (Math.abs(deltaX) < SWIPE_DISTANCE) return null;
  return pageForKeyboard(page, deltaX < 0 ? "ArrowRight" : "ArrowLeft");
}

export function createStickerBook(options: StickerBookOptions): StickerBook {
  const document = options.host.ownerDocument;
  const releaseStyles = acquireStyles(document);
  const root = document.createElement("section");
  root.className = "sticker-book";
  root.setAttribute("role", "region");
  root.setAttribute("aria-roledescription", "sticker book");
  root.setAttribute(
    "data-reduced-motion",
    String(options.reducedMotion ?? options.state.settings.reducedMotion),
  );
  root.style.setProperty(
    "--sticker-ui-scale",
    String(safeScale(options.uiScale ?? options.state.settings.uiScale)),
  );
  root.tabIndex = 0;

  const header = document.createElement("header");
  header.className = "sticker-book__header";
  const headingGroup = document.createElement("div");
  const title = document.createElement("h2");
  title.className = "sticker-book__title";
  title.id = `sticker-book-title-${nextBookInstance}`;
  nextBookInstance += 1;
  const totalProgress = document.createElement("p");
  totalProgress.className = "sticker-book__progress";
  totalProgress.setAttribute("aria-live", "polite");
  headingGroup.append(title, totalProgress);
  header.append(headingGroup);
  root.setAttribute("aria-labelledby", title.id);

  const nav = document.createElement("nav");
  nav.className = "sticker-book__nav";
  const previous = document.createElement("button");
  previous.type = "button";
  previous.textContent = "‹";
  const pageStatus = document.createElement("span");
  pageStatus.setAttribute("aria-live", "polite");
  const next = document.createElement("button");
  next.type = "button";
  next.textContent = "›";
  nav.append(previous, pageStatus, next);

  const pagesRoot = document.createElement("div");
  pagesRoot.className = "sticker-book__pages";
  root.append(header, nav, pagesRoot);
  options.host.append(root);

  let state = options.state;
  let catalog = options.catalog ?? activeCatalog();
  let currentPage = options.initialPage && STICKER_PAGE_IDS.includes(options.initialPage)
    ? options.initialPage
    : STICKER_PAGE_IDS[0];
  let disposed = false;
  let pointerStartX: number | null = null;

  const renderCard = (definition: StickerDefinition): HTMLElement => {
    const achievement = ACHIEVEMENTS_BY_ID.get(definition.id);
    if (!achievement) throw new Error(`Missing achievement for ${definition.id}`);
    const copy = BOOK_COPY[catalog.language];
    const stickerCopy = catalog.stickers[definition.id];
    const progress = achievementProgress(state, achievement);
    const unlockedAt = state.stickers.unlocked[definition.id];
    const unlocked = unlockedAt !== undefined;
    const rarity = copy.rarity[achievement.rarity];
    const progressText = copy.progress(progress.current, progress.target);
    const manifestAlt = FROZEN_ASSETS_BY_ID.get(definition.id)?.alt[catalog.language] ?? "";
    const imageAlt = manifestAlt.length > 0
      ? `${copy.imageAlt(stickerCopy.title, rarity)}. ${manifestAlt}`
      : copy.imageAlt(stickerCopy.title, rarity);

    const card = document.createElement("button");
    card.type = "button";
    card.className = "sticker-card";
    card.setAttribute("data-sticker-id", definition.id);
    card.setAttribute("data-locked", String(!unlocked));
    card.setAttribute(
      "aria-label",
      unlocked
        ? `${copy.unlocked}. ${imageAlt}. ${copy.collectedAt(localizedDate(unlockedAt, catalog.language))}.`
        : copy.lockedAlt(achievement.hint[catalog.language], progressText, rarity),
    );

    if (unlocked) {
      const image = document.createElement("img");
      image.className = "sticker-card__image";
      image.setAttribute("alt", imageAlt);
      const fallback = proceduralStickerPlaceholder(definition);
      const manifestImage = (options.imageFor ?? manifestStickerImage)(definition.id);
      image.setAttribute("src", manifestImage && manifestImage.length > 0 ? manifestImage : fallback);
      if (!manifestImage) image.setAttribute("data-procedural-placeholder", "true");
      const onImageError = (): void => {
        if (image.getAttribute("data-procedural-placeholder") === "true") return;
        image.setAttribute("data-procedural-placeholder", "true");
        image.setAttribute("src", fallback);
      };
      image.addEventListener("error", onImageError, { once: true });
      card.append(image);
    } else {
      const silhouette = document.createElement("span");
      silhouette.className = "sticker-card__silhouette";
      silhouette.setAttribute("aria-hidden", "true");
      silhouette.textContent = definition.icon;
      card.append(silhouette);
    }

    if (unlocked && isStickerNew(state, definition.id)) {
      const badge = document.createElement("span");
      badge.className = "sticker-card__new";
      badge.textContent = copy.newBadge;
      badge.setAttribute("aria-label", copy.newBadge);
      card.append(badge);
    }

    const name = document.createElement("span");
    name.className = "sticker-card__title";
    name.textContent = unlocked ? stickerCopy.title : copy.locked;
    const rarityLabel = document.createElement("span");
    rarityLabel.className = "sticker-card__rarity";
    rarityLabel.textContent = rarity;
    const hint = document.createElement("p");
    hint.className = "sticker-card__hint";
    hint.textContent = unlocked ? stickerCopy.description : achievement.hint[catalog.language];
    const meta = document.createElement("span");
    meta.className = "sticker-card__meta";
    meta.textContent = unlocked
      ? copy.collectedAt(localizedDate(unlockedAt, catalog.language))
      : progressText;
    card.append(name, rarityLabel, hint, meta);
    if (unlocked) {
      card.addEventListener("click", () => {
        options.onStickerSeen?.(definition.id);
      });
    }
    return card;
  };

  const updateVisiblePage = (): void => {
    const copy = BOOK_COPY[catalog.language];
    const index = pageIndex(currentPage);
    pageStatus.textContent = copy.page(index + 1, STICKER_PAGE_IDS.length);
    previous.setAttribute("aria-label", copy.previous);
    next.setAttribute("aria-label", copy.next);
    previous.setAttribute("aria-disabled", String(index === 0));
    next.setAttribute("aria-disabled", String(index === STICKER_PAGE_IDS.length - 1));
    for (const [pageNumber, page] of STICKER_PAGE_IDS.entries()) {
      const section = document.getElementById(`sticker-page-${page}`);
      if (!section) continue;
      const visible = page === currentPage;
      section.hidden = !visible;
      section.setAttribute("aria-hidden", String(!visible));
      if (visible) section.setAttribute("aria-current", "page");
      else section.removeAttribute("aria-current");
      if (pageNumber === index) section.setAttribute("data-active", "true");
      else section.removeAttribute("data-active");
    }
  };

  const render = (): void => {
    const copy = BOOK_COPY[catalog.language];
    title.textContent = catalog.strings.stickers.title;
    const unlockedCount = Object.keys(state.stickers.unlocked).length;
    totalProgress.textContent = catalog.strings.stickers.progress(
      unlockedCount,
      STICKER_PAGE_IDS.length * 9,
    );
    root.setAttribute("aria-label", catalog.strings.stickers.subtitle);
    pagesRoot.replaceChildren();
    for (const page of STICKER_PAGE_IDS) {
      const section = document.createElement("section");
      section.className = "sticker-page";
      section.id = `sticker-page-${page}`;
      const pageHeading = document.createElement("h3");
      pageHeading.className = "sticker-page__heading";
      pageHeading.textContent = catalog.stickerPages[page];
      const pageUnlocked = stickersOnPage(page)
        .filter(({ id }) => state.stickers.unlocked[id] !== undefined)
        .length;
      const pageProgress = catalog.strings.stickers.progress(pageUnlocked, 9);
      const pageProgressLabel = document.createElement("p");
      pageProgressLabel.className = "sticker-book__progress";
      pageProgressLabel.textContent = pageProgress;
      section.setAttribute(
        "aria-label",
        `${catalog.stickerPages[page]}. ${copy.page(pageIndex(page) + 1, STICKER_PAGE_IDS.length)}. ${pageProgress}`,
      );
      const grid = document.createElement("div");
      grid.className = "sticker-page__grid";
      grid.setAttribute("role", "list");
      for (const definition of stickersOnPage(page)) {
        const cell = document.createElement("div");
        cell.setAttribute("role", "listitem");
        cell.append(renderCard(definition));
        grid.append(cell);
      }
      section.append(pageHeading, pageProgressLabel, grid);
      pagesRoot.append(section);
    }
    updateVisiblePage();
  };

  const showPage = (page: StickerPageId): void => {
    if (disposed || page === currentPage || !STICKER_PAGE_IDS.includes(page)) return;
    currentPage = page;
    updateVisiblePage();
    options.onPageChanged?.(page);
  };
  const showPrevious = (): void => {
    const page = pageForKeyboard(currentPage, "ArrowLeft");
    if (page) showPage(page);
  };
  const showNext = (): void => {
    const page = pageForKeyboard(currentPage, "ArrowRight");
    if (page) showPage(page);
  };
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.defaultPrevented) return;
    const page = pageForKeyboard(currentPage, event.key);
    if (!page) return;
    event.preventDefault();
    showPage(page);
  };
  const onPointerDown = (event: PointerEvent): void => {
    if (event.isPrimary === false) return;
    pointerStartX = event.clientX;
  };
  const onPointerUp = (event: PointerEvent): void => {
    if (pointerStartX === null || event.isPrimary === false) return;
    const page = pageForSwipe(currentPage, event.clientX - pointerStartX);
    pointerStartX = null;
    if (page) showPage(page);
  };
  const clearPointer = (): void => {
    pointerStartX = null;
  };

  previous.addEventListener("click", showPrevious);
  next.addEventListener("click", showNext);
  root.addEventListener("keydown", onKeyDown);
  root.addEventListener("pointerdown", onPointerDown);
  root.addEventListener("pointerup", onPointerUp);
  root.addEventListener("pointercancel", clearPointer);
  render();

  return {
    root,
    get page() {
      return currentPage;
    },
    showPage,
    update(nextState: CanonicalSaveState, nextCatalog: LanguageCatalog = activeCatalog()): void {
      if (disposed) return;
      state = nextState;
      catalog = nextCatalog;
      if (options.uiScale === undefined) {
        root.style.setProperty("--sticker-ui-scale", String(safeScale(nextState.settings.uiScale)));
      }
      if (options.reducedMotion === undefined) {
        root.setAttribute("data-reduced-motion", String(nextState.settings.reducedMotion));
      }
      render();
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      previous.removeEventListener("click", showPrevious);
      next.removeEventListener("click", showNext);
      root.removeEventListener("keydown", onKeyDown);
      root.removeEventListener("pointerdown", onPointerDown);
      root.removeEventListener("pointerup", onPointerUp);
      root.removeEventListener("pointercancel", clearPointer);
      root.remove();
      releaseStyles();
    },
  };
}
