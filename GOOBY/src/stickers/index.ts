import {
  STICKER_COUNT,
  STICKER_DEFINITIONS,
  STICKER_PAGE_IDS,
  stickersOnPage,
  type StickerDefinition,
  type StickerId,
  type StickerPageId,
  type StickerUnlocks,
} from "../core/contracts/stickers";
import { activeCatalog, type LanguageCatalog } from "../i18n";

export {
  STICKER_COUNT,
  STICKER_DEFINITIONS,
  STICKER_PAGE_IDS,
  STICKERS_BY_ID,
  stickersOnPage,
} from "../core/contracts/stickers";
export type {
  StickerDefinition,
  StickerId,
  StickerPageId,
  StickerUnlocks,
} from "../core/contracts/stickers";

/** One renderable sticker-book cell: frozen definition plus localized copy. */
export interface StickerBookEntry {
  readonly definition: StickerDefinition;
  readonly title: string;
  readonly description: string;
  readonly unlockedAt: number | null;
}

export interface StickerBookPage {
  readonly id: StickerPageId;
  readonly title: string;
  readonly entries: readonly StickerBookEntry[];
}

export interface StickerProgress {
  readonly unlocked: number;
  readonly total: number;
}

function entryFor(
  definition: StickerDefinition,
  unlocks: StickerUnlocks,
  catalog: LanguageCatalog,
): StickerBookEntry {
  const copy = catalog.stickers[definition.id];
  return {
    definition,
    title: copy.title,
    description: copy.description,
    unlockedAt: unlocks[definition.id] ?? null,
  };
}

/** Builds the complete localized book for the persisted unlock table. */
export function stickerBookPages(
  unlocks: StickerUnlocks,
  catalog: LanguageCatalog = activeCatalog(),
): readonly StickerBookPage[] {
  return STICKER_PAGE_IDS.map((page) => ({
    id: page,
    title: catalog.stickerPages[page],
    entries: stickersOnPage(page).map((definition) => entryFor(definition, unlocks, catalog)),
  }));
}

export function stickerProgress(unlocks: StickerUnlocks): StickerProgress {
  const unlocked = STICKER_DEFINITIONS
    .filter((definition) => unlocks[definition.id] !== undefined)
    .length;
  return { unlocked, total: STICKER_COUNT };
}

/** True when the persisted table already holds an unlock time for the sticker. */
export function isStickerUnlocked(unlocks: StickerUnlocks, id: StickerId): boolean {
  return unlocks[id] !== undefined;
}
