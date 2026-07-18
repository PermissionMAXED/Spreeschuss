/**
 * CP1 sticker-book contract: exactly 36 stickers on four pages of nine, as
 * fixed by the lead sticker list. Page one keeps home-care keepsakes, page
 * two collects city moments, page three holds the nine minigame medal
 * milestones spanning the full 24-game roster, and page four gathers dream
 * and season keepsakes. IDs and page assignments are frozen; extend only by
 * appending new pages.
 */

export const STICKER_PAGE_IDS = [
  "home-life",
  "city-days",
  "game-medals",
  "dreams-seasons",
] as const;
export type StickerPageId = (typeof STICKER_PAGE_IDS)[number];

export const STICKERS_PER_PAGE = 9;

export const HOME_LIFE_STICKER_IDS = [
  "sticker.care.first-pet",
  "sticker.care.first-feed",
  "sticker.care.first-bath",
  "sticker.care.full-night-sleep",
  "sticker.care.gentle-wake",
  "sticker.care.garden-harvest",
  "sticker.care.wardrobe-first-outfit",
  "sticker.care.decorated-room",
  "sticker.care.level-five",
] as const;
export type HomeLifeStickerId = (typeof HOME_LIFE_STICKER_IDS)[number];

export const CITY_DAYS_STICKER_IDS = [
  "sticker.city.first-trip",
  "sticker.city.all-shops",
  "sticker.city.smooth-driver",
  "sticker.city.market-day",
  "sticker.city.boutique-day",
  "sticker.city.salon-day",
  "sticker.city.first-return",
  "sticker.city.five-trips",
  "sticker.city.souvenir-spree",
] as const;
export type CityDaysStickerId = (typeof CITY_DAYS_STICKER_IDS)[number];

export const GAME_MEDAL_STICKER_IDS = [
  "sticker.games.first-round",
  "sticker.games.new-best",
  "sticker.games.three-games",
  "sticker.games.six-games",
  "sticker.games.twelve-games",
  "sticker.games.all-games",
  "sticker.games.ten-rounds",
  "sticker.games.fifty-rounds",
  "sticker.games.hundred-rounds",
] as const;
export type GameMedalStickerId = (typeof GAME_MEDAL_STICKER_IDS)[number];

export const DREAMS_SEASONS_STICKER_IDS = [
  "sticker.dreams.first-dream",
  "sticker.dreams.dream-week",
  "sticker.dreams.night-owl",
  "sticker.dreams.early-bird",
  "sticker.dreams.starry-night",
  "sticker.seasons.spring-bloom",
  "sticker.seasons.summer-sun",
  "sticker.seasons.autumn-leaf",
  "sticker.seasons.winter-frost",
] as const;
export type DreamsSeasonsStickerId = (typeof DREAMS_SEASONS_STICKER_IDS)[number];

export const STICKER_IDS = [
  ...HOME_LIFE_STICKER_IDS,
  ...CITY_DAYS_STICKER_IDS,
  ...GAME_MEDAL_STICKER_IDS,
  ...DREAMS_SEASONS_STICKER_IDS,
] as const;
export type StickerId = (typeof STICKER_IDS)[number];

export interface StickerDefinition {
  readonly id: StickerId;
  readonly page: StickerPageId;
  /** Zero-based slot on its page; every page holds exactly nine stickers. */
  readonly slot: number;
  /** Language-neutral glyph; display names live in the typed i18n catalog. */
  readonly icon: string;
}

const STICKER_ICONS: Readonly<Record<StickerId, string>> = {
  "sticker.care.first-pet": "♥",
  "sticker.care.first-feed": "🥕",
  "sticker.care.first-bath": "◌",
  "sticker.care.full-night-sleep": "☾",
  "sticker.care.gentle-wake": "☀",
  "sticker.care.garden-harvest": "🌱",
  "sticker.care.wardrobe-first-outfit": "♧",
  "sticker.care.decorated-room": "▰",
  "sticker.care.level-five": "★",
  "sticker.city.first-trip": "⛟",
  "sticker.city.all-shops": "▣",
  "sticker.city.smooth-driver": "➟",
  "sticker.city.market-day": "🥬",
  "sticker.city.boutique-day": "☁",
  "sticker.city.salon-day": "✦",
  "sticker.city.first-return": "⌂",
  "sticker.city.five-trips": "▤",
  "sticker.city.souvenir-spree": "🧺",
  "sticker.games.first-round": "▶",
  "sticker.games.new-best": "✹",
  "sticker.games.three-games": "①",
  "sticker.games.six-games": "②",
  "sticker.games.twelve-games": "③",
  "sticker.games.all-games": "♛",
  "sticker.games.ten-rounds": "◍",
  "sticker.games.fifty-rounds": "◉",
  "sticker.games.hundred-rounds": "✪",
  "sticker.dreams.first-dream": "☾",
  "sticker.dreams.dream-week": "▦",
  "sticker.dreams.night-owl": "🦉",
  "sticker.dreams.early-bird": "🐦",
  "sticker.dreams.starry-night": "✨",
  "sticker.seasons.spring-bloom": "❀",
  "sticker.seasons.summer-sun": "☀",
  "sticker.seasons.autumn-leaf": "🍂",
  "sticker.seasons.winter-frost": "❄",
};

const PAGE_ID_LISTS: Readonly<Record<StickerPageId, readonly StickerId[]>> = {
  "home-life": HOME_LIFE_STICKER_IDS,
  "city-days": CITY_DAYS_STICKER_IDS,
  "game-medals": GAME_MEDAL_STICKER_IDS,
  "dreams-seasons": DREAMS_SEASONS_STICKER_IDS,
};

export const STICKER_DEFINITIONS: readonly StickerDefinition[] = Object.freeze(
  STICKER_PAGE_IDS.flatMap((page) =>
    PAGE_ID_LISTS[page].map((id, slot) => Object.freeze({
      id,
      page,
      slot,
      icon: STICKER_ICONS[id],
    })),
  ),
);

export const STICKERS_BY_ID: ReadonlyMap<StickerId, StickerDefinition> = new Map(
  STICKER_DEFINITIONS.map((definition) => [definition.id, definition]),
);

export function stickersOnPage(page: StickerPageId): readonly StickerDefinition[] {
  return STICKER_DEFINITIONS.filter((definition) => definition.page === page);
}

export function isStickerId(value: unknown): value is StickerId {
  return typeof value === "string" && STICKERS_BY_ID.has(value as StickerId);
}

/** Sticker unlock timestamps keyed by sticker ID, exactly as persisted. */
export type StickerUnlocks = Readonly<Partial<Record<StickerId, number>>>;

export const STICKER_COUNT = 36;

if (STICKER_IDS.length !== STICKER_COUNT || STICKERS_BY_ID.size !== STICKER_COUNT) {
  throw new Error("The sticker book must contain exactly 36 unique stickers");
}
if (STICKER_PAGE_IDS.length * STICKERS_PER_PAGE !== STICKER_COUNT) {
  throw new Error("The sticker book must be exactly four pages of nine stickers");
}
for (const page of STICKER_PAGE_IDS) {
  if (stickersOnPage(page).length !== STICKERS_PER_PAGE) {
    throw new Error(`Sticker page ${page} must hold exactly ${STICKERS_PER_PAGE} stickers`);
  }
}
