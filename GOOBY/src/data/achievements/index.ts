import {
  STICKER_IDS,
  STICKERS_BY_ID,
  type StickerId,
  type StickerPageId,
} from "../../core/contracts/stickers";
import type { LocalizedText } from "../../core/contracts/minigame";

export type AchievementRarity = "common" | "uncommon" | "rare" | "legendary";

export type AchievementMetric =
  | "care.pet"
  | "care.feed"
  | "care.bath"
  | "care.full-sleep"
  | "care.gentle-wake"
  | "care.harvest"
  | "care.outfit"
  | "care.decor"
  | "progression.level"
  | "city.outbound-trips"
  | "city.visited-shops"
  | "city.smooth-drive"
  | "purchase.carrot-market"
  | "purchase.cloud-boutique"
  | "purchase.fluff-salon"
  | "city.return-trips"
  | "purchase.visited-shops"
  | "games.rounds"
  | "games.new-best"
  | "games.distinct"
  | "dreams.completed"
  | "dreams.distinct-days"
  | "dreams.night-owl"
  | "dreams.early-bird"
  | "dreams.starry-night"
  | "seasons.spring"
  | "seasons.summer"
  | "seasons.autumn"
  | "seasons.winter";

export interface AchievementDefinition {
  /** Achievement IDs intentionally equal their one-to-one sticker IDs. */
  readonly id: StickerId;
  readonly stickerId: StickerId;
  readonly page: StickerPageId;
  readonly metric: AchievementMetric;
  readonly target: number;
  readonly rarity: AchievementRarity;
  readonly hint: LocalizedText;
}

type DefinitionInput = Omit<AchievementDefinition, "stickerId" | "page">;

function achievement(input: DefinitionInput): AchievementDefinition {
  const sticker = STICKERS_BY_ID.get(input.id);
  if (!sticker) throw new Error(`Achievement references unknown sticker ${input.id}`);
  return Object.freeze({
    ...input,
    stickerId: input.id,
    page: sticker.page,
  });
}

const definitions: readonly DefinitionInput[] = [
  {
    id: "sticker.care.first-pet",
    metric: "care.pet",
    target: 1,
    rarity: "common",
    hint: { en: "Give Gooby a gentle pat.", de: "Streichle Gooby ganz sanft." },
  },
  {
    id: "sticker.care.first-feed",
    metric: "care.feed",
    target: 1,
    rarity: "common",
    hint: { en: "Share a snack with Gooby.", de: "Teile einen Snack mit Gooby." },
  },
  {
    id: "sticker.care.first-bath",
    metric: "care.bath",
    target: 1,
    rarity: "common",
    hint: { en: "Finish a bubbly bath.", de: "Beende ein sprudelndes Bad." },
  },
  {
    id: "sticker.care.full-night-sleep",
    metric: "care.full-sleep",
    target: 1,
    rarity: "uncommon",
    hint: { en: "Let a full sleep finish.", de: "Lass einen ganzen Schlaf enden." },
  },
  {
    id: "sticker.care.gentle-wake",
    metric: "care.gentle-wake",
    target: 1,
    rarity: "common",
    hint: { en: "Wake Gooby gently before sleep ends.", de: "Wecke Gooby vor Schlafende sanft." },
  },
  {
    id: "sticker.care.garden-harvest",
    metric: "care.harvest",
    target: 1,
    rarity: "common",
    hint: { en: "Harvest a garden carrot.", de: "Ernte eine Gartenkarotte." },
  },
  {
    id: "sticker.care.wardrobe-first-outfit",
    metric: "care.outfit",
    target: 1,
    rarity: "uncommon",
    hint: { en: "Equip an owned outfit.", de: "Ziehe ein eigenes Outfit an." },
  },
  {
    id: "sticker.care.decorated-room",
    metric: "care.decor",
    target: 1,
    rarity: "uncommon",
    hint: { en: "Place owned furniture at home.", de: "Stelle ein eigenes Möbelstück auf." },
  },
  {
    id: "sticker.care.level-five",
    metric: "progression.level",
    target: 5,
    rarity: "rare",
    hint: { en: "Reach level five.", de: "Erreiche Stufe fünf." },
  },
  {
    id: "sticker.city.first-trip",
    metric: "city.outbound-trips",
    target: 1,
    rarity: "common",
    hint: { en: "Complete a drive to a city shop.", de: "Beende eine Fahrt zu einem Stadtladen." },
  },
  {
    id: "sticker.city.all-shops",
    metric: "city.visited-shops",
    target: 3,
    rarity: "rare",
    hint: { en: "Drive to all three city shops.", de: "Fahre zu allen drei Stadtläden." },
  },
  {
    id: "sticker.city.smooth-driver",
    metric: "city.smooth-drive",
    target: 1,
    rarity: "uncommon",
    hint: { en: "Finish a drive without a recovery.", de: "Beende eine Fahrt ohne Bergung." },
  },
  {
    id: "sticker.city.market-day",
    metric: "purchase.carrot-market",
    target: 1,
    rarity: "common",
    hint: { en: "Buy something at the Carrot Market.", de: "Kaufe etwas auf dem Karottenmarkt." },
  },
  {
    id: "sticker.city.boutique-day",
    metric: "purchase.cloud-boutique",
    target: 1,
    rarity: "common",
    hint: { en: "Buy something at the Cloud Boutique.", de: "Kaufe etwas in der Wolkenboutique." },
  },
  {
    id: "sticker.city.salon-day",
    metric: "purchase.fluff-salon",
    target: 1,
    rarity: "common",
    hint: { en: "Buy something at the Fluff Salon.", de: "Kaufe etwas im Flauschsalon." },
  },
  {
    id: "sticker.city.first-return",
    metric: "city.return-trips",
    target: 1,
    rarity: "common",
    hint: { en: "Complete a drive back home.", de: "Beende eine Heimfahrt." },
  },
  {
    id: "sticker.city.five-trips",
    metric: "city.return-trips",
    target: 5,
    rarity: "rare",
    hint: { en: "Complete five drives back home.", de: "Beende fünf Heimfahrten." },
  },
  {
    id: "sticker.city.souvenir-spree",
    metric: "purchase.visited-shops",
    target: 3,
    rarity: "legendary",
    hint: { en: "Make a purchase in every city shop.", de: "Kaufe in jedem Stadtladen etwas." },
  },
  {
    id: "sticker.games.first-round",
    metric: "games.rounds",
    target: 1,
    rarity: "common",
    hint: { en: "Finish and settle one minigame round.", de: "Beende und verbuche eine Minispielrunde." },
  },
  {
    id: "sticker.games.new-best",
    metric: "games.new-best",
    target: 1,
    rarity: "uncommon",
    hint: { en: "Beat a score from an earlier round.", de: "Übertriff ein Ergebnis aus einer früheren Runde." },
  },
  {
    id: "sticker.games.three-games",
    metric: "games.distinct",
    target: 3,
    rarity: "common",
    hint: { en: "Settle three different minigames.", de: "Verbuche drei verschiedene Minispiele." },
  },
  {
    id: "sticker.games.six-games",
    metric: "games.distinct",
    target: 6,
    rarity: "uncommon",
    hint: { en: "Settle six different minigames.", de: "Verbuche sechs verschiedene Minispiele." },
  },
  {
    id: "sticker.games.twelve-games",
    metric: "games.distinct",
    target: 12,
    rarity: "rare",
    hint: { en: "Settle twelve different minigames.", de: "Verbuche zwölf verschiedene Minispiele." },
  },
  {
    id: "sticker.games.all-games",
    metric: "games.distinct",
    target: 24,
    rarity: "legendary",
    hint: { en: "Settle every minigame in the arcade.", de: "Verbuche jedes Minispiel in der Spielhalle." },
  },
  {
    id: "sticker.games.ten-rounds",
    metric: "games.rounds",
    target: 10,
    rarity: "uncommon",
    hint: { en: "Settle ten minigame rounds.", de: "Verbuche zehn Minispielrunden." },
  },
  {
    id: "sticker.games.fifty-rounds",
    metric: "games.rounds",
    target: 50,
    rarity: "rare",
    hint: { en: "Settle fifty minigame rounds.", de: "Verbuche fünfzig Minispielrunden." },
  },
  {
    id: "sticker.games.hundred-rounds",
    metric: "games.rounds",
    target: 100,
    rarity: "legendary",
    hint: { en: "Settle one hundred minigame rounds.", de: "Verbuche einhundert Minispielrunden." },
  },
  {
    id: "sticker.dreams.first-dream",
    metric: "dreams.completed",
    target: 1,
    rarity: "common",
    hint: { en: "Complete a full sleep.", de: "Beende einen ganzen Schlaf." },
  },
  {
    id: "sticker.dreams.dream-week",
    metric: "dreams.distinct-days",
    target: 7,
    rarity: "rare",
    hint: { en: "Complete sleep on seven different days.", de: "Beende Schlaf an sieben verschiedenen Tagen." },
  },
  {
    id: "sticker.dreams.night-owl",
    metric: "dreams.night-owl",
    target: 1,
    rarity: "uncommon",
    hint: { en: "Start sleep between 10 PM and 4 AM.", de: "Beginne Schlaf zwischen 22 und 4 Uhr." },
  },
  {
    id: "sticker.dreams.early-bird",
    metric: "dreams.early-bird",
    target: 1,
    rarity: "uncommon",
    hint: { en: "Wake Gooby between 5 and 8 AM.", de: "Wecke Gooby zwischen 5 und 8 Uhr." },
  },
  {
    id: "sticker.dreams.starry-night",
    metric: "dreams.starry-night",
    target: 1,
    rarity: "rare",
    hint: { en: "Complete a sleep that began at night.", de: "Beende einen Schlaf, der nachts begann." },
  },
  {
    id: "sticker.seasons.spring-bloom",
    metric: "seasons.spring",
    target: 1,
    rarity: "uncommon",
    hint: { en: "Care, travel, or play during spring.", de: "Kümmere dich, reise oder spiele im Frühling." },
  },
  {
    id: "sticker.seasons.summer-sun",
    metric: "seasons.summer",
    target: 1,
    rarity: "uncommon",
    hint: { en: "Care, travel, or play during summer.", de: "Kümmere dich, reise oder spiele im Sommer." },
  },
  {
    id: "sticker.seasons.autumn-leaf",
    metric: "seasons.autumn",
    target: 1,
    rarity: "uncommon",
    hint: { en: "Care, travel, or play during autumn.", de: "Kümmere dich, reise oder spiele im Herbst." },
  },
  {
    id: "sticker.seasons.winter-frost",
    metric: "seasons.winter",
    target: 1,
    rarity: "uncommon",
    hint: { en: "Care, travel, or play during winter.", de: "Kümmere dich, reise oder spiele im Winter." },
  },
];

export const ACHIEVEMENT_DEFINITIONS: readonly AchievementDefinition[] = Object.freeze(
  definitions.map(achievement),
);

export const ACHIEVEMENTS_BY_ID: ReadonlyMap<StickerId, AchievementDefinition> = new Map(
  ACHIEVEMENT_DEFINITIONS.map((definition) => [definition.id, definition]),
);

if (
  ACHIEVEMENT_DEFINITIONS.length !== STICKER_IDS.length ||
  ACHIEVEMENTS_BY_ID.size !== STICKER_IDS.length ||
  STICKER_IDS.some((id, index) => ACHIEVEMENT_DEFINITIONS[index]?.id !== id)
) {
  throw new Error("Achievements must map one-to-one, in order, to all 36 frozen stickers");
}
