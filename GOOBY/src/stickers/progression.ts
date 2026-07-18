import { grantReward } from "../core/contracts/economy";
import {
  SaveStateSchema,
  type CanonicalSaveState,
} from "../core/contracts/save";
import {
  STICKER_PAGE_IDS,
  stickersOnPage,
  type StickerId,
  type StickerPageId,
} from "../core/contracts/stickers";
import type { MinigameId, ShopId } from "../core/contracts/scenes";
import {
  ACHIEVEMENT_DEFINITIONS,
  type AchievementDefinition,
  type AchievementMetric,
} from "../data/achievements";

const LEDGER_PREFIX = "__achievement.v1";
const DAY_MS = 24 * 60 * 60 * 1_000;

export interface AchievementSignalBase {
  /** Captured by the real gameplay action; never read from the wall clock here. */
  readonly occurredAt: number;
  /** Local calendar month, 1–12. UTC is the deterministic fallback. */
  readonly localMonth?: number;
}

export type AchievementSignal =
  | (AchievementSignalBase & {
      readonly type: "care:pet-completed" | "care:feed-completed" | "care:bath-completed";
    })
  | (AchievementSignalBase & {
      readonly type: "care:sleep-started";
      readonly sleepId: string;
      readonly localHour: number;
    })
  | (AchievementSignalBase & {
      readonly type: "care:sleep-completed";
      readonly sleepId: string;
      readonly startedLocalHour: number;
    })
  | (AchievementSignalBase & {
      readonly type: "care:wake-completed";
      readonly sleepId: string;
      readonly localHour: number;
      readonly gentle: boolean;
      readonly early: boolean;
    })
  | (AchievementSignalBase & {
      readonly type: "care:harvest-completed";
      readonly harvestId: string;
      readonly harvested: boolean;
    })
  | (AchievementSignalBase & {
      readonly type: "care:outfit-equipped";
      readonly actionId: string;
      readonly itemId: string;
      readonly owned: boolean;
    })
  | (AchievementSignalBase & {
      readonly type: "care:decor-placed";
      readonly placementId: string;
      readonly itemId: string;
      readonly placed: boolean;
    })
  | (AchievementSignalBase & {
      readonly type: "progression:level-changed";
      readonly level: number;
    })
  | (AchievementSignalBase & {
      readonly type: "city:leg-completed";
      readonly tripId: string;
      readonly leg: "outbound" | "home";
      readonly shopId: ShopId;
      readonly recoveries: number;
    })
  | (AchievementSignalBase & {
      readonly type: "shop:purchase-completed";
      readonly requestId: string;
      readonly shopId: ShopId;
      readonly itemId: string;
      readonly status: "purchased";
    })
  | (AchievementSignalBase & {
      readonly type: "minigame:run-settled";
      readonly runId: string;
      readonly minigameId: MinigameId;
      readonly score: number;
      readonly previousBest: number;
    });

export interface AchievementProgress {
  readonly current: number;
  readonly target: number;
  readonly complete: boolean;
}

export interface StickerPageReward {
  readonly page: StickerPageId;
  readonly coins: number;
}

export const STICKER_PAGE_REWARDS: Readonly<Record<StickerPageId, number>> = Object.freeze({
  "home-life": 50,
  "city-days": 50,
  "game-medals": 50,
  "dreams-seasons": 50,
});

export interface AchievementUpdate {
  readonly state: CanonicalSaveState;
  readonly newlyUnlocked: readonly StickerId[];
  readonly pageRewards: readonly StickerPageReward[];
  readonly duplicate: boolean;
}

function ledgerKey(kind: string, ...parts: readonly string[]): string {
  return [LEDGER_PREFIX, kind, ...parts].join("|");
}

function metricKey(metric: AchievementMetric): string {
  return ledgerKey("metric", metric);
}

function memberKey(metric: AchievementMetric, member: string): string {
  return ledgerKey("member", metric, encodeURIComponent(member));
}

function eventKey(signal: AchievementSignal): string | null {
  switch (signal.type) {
    case "care:sleep-started":
    case "care:sleep-completed":
    case "care:wake-completed":
      return ledgerKey("event", signal.type, encodeURIComponent(signal.sleepId));
    case "care:harvest-completed":
      return ledgerKey("event", signal.type, encodeURIComponent(signal.harvestId));
    case "care:outfit-equipped":
      return ledgerKey("event", signal.type, encodeURIComponent(signal.actionId));
    case "care:decor-placed":
      return ledgerKey("event", signal.type, encodeURIComponent(signal.placementId));
    case "city:leg-completed":
      return ledgerKey("event", signal.type, signal.leg, encodeURIComponent(signal.tripId));
    case "shop:purchase-completed":
      return ledgerKey("event", signal.type, encodeURIComponent(signal.requestId));
    case "minigame:run-settled":
      return ledgerKey("event", signal.type, encodeURIComponent(signal.runId));
    case "care:pet-completed":
    case "care:feed-completed":
    case "care:bath-completed":
    case "progression:level-changed":
      return null;
  }
}

function seenKey(id: StickerId): string {
  return ledgerKey("seen", id);
}

function pageRewardKey(page: StickerPageId): string {
  return ledgerKey("page-reward", page);
}

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function currentMetric(
  ledger: Readonly<Record<string, number>>,
  metric: AchievementMetric,
): number {
  return finiteNonNegative(ledger[metricKey(metric)] ?? 0);
}

function setMetric(
  ledger: Record<string, number>,
  metric: AchievementMetric,
  value: number,
): void {
  ledger[metricKey(metric)] = finiteNonNegative(value);
}

function incrementMetric(ledger: Record<string, number>, metric: AchievementMetric): void {
  setMetric(ledger, metric, currentMetric(ledger, metric) + 1);
}

function addMember(
  ledger: Record<string, number>,
  metric: AchievementMetric,
  member: string,
): void {
  const key = memberKey(metric, member);
  if (ledger[key] !== undefined) return;
  ledger[key] = 1;
  incrementMetric(ledger, metric);
}

function validHour(value: number): number {
  return Number.isFinite(value) ? Math.min(23, Math.max(0, Math.floor(value))) : 12;
}

function isNightHour(hour: number): boolean {
  const safeHour = validHour(hour);
  return safeHour >= 22 || safeHour < 4;
}

function monthFor(signal: AchievementSignal): number {
  if (
    signal.localMonth !== undefined &&
    Number.isInteger(signal.localMonth) &&
    signal.localMonth >= 1 &&
    signal.localMonth <= 12
  ) {
    return signal.localMonth;
  }
  return new Date(signal.occurredAt).getUTCMonth() + 1;
}

function seasonMetric(month: number): AchievementMetric {
  if (month >= 3 && month <= 5) return "seasons.spring";
  if (month >= 6 && month <= 8) return "seasons.summer";
  if (month >= 9 && month <= 11) return "seasons.autumn";
  return "seasons.winter";
}

function isQualifyingGameplay(signal: AchievementSignal): boolean {
  switch (signal.type) {
    case "care:harvest-completed":
      return signal.harvested;
    case "care:outfit-equipped":
      return signal.owned && signal.itemId.length > 0;
    case "care:decor-placed":
      return signal.placed && signal.itemId.length > 0;
    default:
      return true;
  }
}

function applySignalToLedger(
  ledger: Record<string, number>,
  signal: AchievementSignal,
): void {
  if (isQualifyingGameplay(signal)) {
    setMetric(ledger, seasonMetric(monthFor(signal)), 1);
  }
  switch (signal.type) {
    case "care:pet-completed":
      setMetric(ledger, "care.pet", 1);
      return;
    case "care:feed-completed":
      setMetric(ledger, "care.feed", 1);
      return;
    case "care:bath-completed":
      setMetric(ledger, "care.bath", 1);
      return;
    case "care:sleep-started":
      if (isNightHour(signal.localHour)) setMetric(ledger, "dreams.night-owl", 1);
      return;
    case "care:sleep-completed":
      setMetric(ledger, "care.full-sleep", 1);
      incrementMetric(ledger, "dreams.completed");
      addMember(
        ledger,
        "dreams.distinct-days",
        Math.floor(signal.occurredAt / DAY_MS).toString(),
      );
      if (isNightHour(signal.startedLocalHour)) setMetric(ledger, "dreams.starry-night", 1);
      return;
    case "care:wake-completed":
      if (signal.gentle && signal.early) setMetric(ledger, "care.gentle-wake", 1);
      if (validHour(signal.localHour) >= 5 && validHour(signal.localHour) <= 8) {
        setMetric(ledger, "dreams.early-bird", 1);
      }
      return;
    case "care:harvest-completed":
      if (signal.harvested) setMetric(ledger, "care.harvest", 1);
      return;
    case "care:outfit-equipped":
      if (signal.owned && signal.itemId.length > 0) setMetric(ledger, "care.outfit", 1);
      return;
    case "care:decor-placed":
      if (signal.placed && signal.itemId.length > 0) setMetric(ledger, "care.decor", 1);
      return;
    case "progression:level-changed":
      setMetric(
        ledger,
        "progression.level",
        Math.max(currentMetric(ledger, "progression.level"), signal.level),
      );
      return;
    case "city:leg-completed":
      if (signal.leg === "outbound") {
        incrementMetric(ledger, "city.outbound-trips");
        addMember(ledger, "city.visited-shops", signal.shopId);
        if (finiteNonNegative(signal.recoveries) === 0) setMetric(ledger, "city.smooth-drive", 1);
      } else {
        incrementMetric(ledger, "city.return-trips");
      }
      return;
    case "shop:purchase-completed":
      setMetric(ledger, `purchase.${signal.shopId}`, 1);
      addMember(ledger, "purchase.visited-shops", signal.shopId);
      return;
    case "minigame:run-settled":
      incrementMetric(ledger, "games.rounds");
      addMember(ledger, "games.distinct", signal.minigameId);
      if (
        finiteNonNegative(signal.previousBest) > 0 &&
        finiteNonNegative(signal.score) > finiteNonNegative(signal.previousBest)
      ) {
        setMetric(ledger, "games.new-best", 1);
      }
  }
}

export function achievementProgress(
  state: CanonicalSaveState,
  definition: AchievementDefinition,
): AchievementProgress {
  const current = state.stickers.unlocked[definition.stickerId] !== undefined
    ? definition.target
    : Math.min(definition.target, currentMetric(state.achievements.unlocked, definition.metric));
  return {
    current,
    target: definition.target,
    complete: current >= definition.target,
  };
}

function grantCompletedPageRewards(
  state: CanonicalSaveState,
  unlockedAt: number,
): { readonly state: CanonicalSaveState; readonly rewards: readonly StickerPageReward[] } {
  const ledger = { ...state.achievements.unlocked };
  const rewards: StickerPageReward[] = [];
  let economy = state.economy;
  for (const page of STICKER_PAGE_IDS) {
    const complete = stickersOnPage(page)
      .every(({ id }) => state.stickers.unlocked[id] !== undefined);
    const receipt = pageRewardKey(page);
    if (!complete || ledger[receipt] !== undefined) continue;
    const coins = STICKER_PAGE_REWARDS[page];
    ledger[receipt] = unlockedAt;
    economy = grantReward(economy, { coins });
    rewards.push({ page, coins });
  }
  if (rewards.length === 0) return { state, rewards };
  return {
    state: SaveStateSchema.parse({
      ...state,
      economy,
      achievements: { unlocked: ledger },
    }),
    rewards,
  };
}

/**
 * Pure replay-safe progression reducer. Receipt-bearing gameplay signals are
 * persisted before counters move, so duplicate delivery and reload replay are
 * no-ops. One-shot signals only raise monotonic flags or a high-water level.
 */
export function processAchievementSignal(
  input: CanonicalSaveState,
  signal: AchievementSignal,
): AchievementUpdate {
  if (!Number.isFinite(signal.occurredAt)) {
    return { state: input, newlyUnlocked: [], pageRewards: [], duplicate: true };
  }
  const receipt = eventKey(signal);
  if (receipt && input.achievements.unlocked[receipt] !== undefined) {
    return { state: input, newlyUnlocked: [], pageRewards: [], duplicate: true };
  }

  const ledger = { ...input.achievements.unlocked };
  if (receipt) ledger[receipt] = signal.occurredAt;
  applySignalToLedger(ledger, signal);

  const unlocked = { ...input.stickers.unlocked };
  const newlyUnlocked: StickerId[] = [];
  for (const definition of ACHIEVEMENT_DEFINITIONS) {
    const existingUnlock = unlocked[definition.stickerId];
    if (existingUnlock !== undefined) {
      if (ledger[definition.id] === undefined) ledger[definition.id] = existingUnlock;
      continue;
    }
    const current = currentMetric(ledger, definition.metric);
    if (current < definition.target) continue;
    unlocked[definition.stickerId] = signal.occurredAt;
    ledger[definition.id] = signal.occurredAt;
    newlyUnlocked.push(definition.stickerId);
  }

  const progressed = SaveStateSchema.parse({
    ...input,
    stickers: { unlocked },
    achievements: { unlocked: ledger },
  });
  const rewarded = grantCompletedPageRewards(progressed, signal.occurredAt);
  return {
    state: rewarded.state,
    newlyUnlocked,
    pageRewards: rewarded.rewards,
    duplicate: false,
  };
}

export function achievementSignalReducer(
  signal: AchievementSignal,
): (state: CanonicalSaveState) => CanonicalSaveState {
  return (state) => processAchievementSignal(state, signal).state;
}

export function isStickerNew(state: CanonicalSaveState, id: StickerId): boolean {
  return state.stickers.unlocked[id] !== undefined &&
    state.achievements.unlocked[seenKey(id)] === undefined;
}

export function markStickerSeen(
  state: CanonicalSaveState,
  id: StickerId,
  seenAt: number,
): CanonicalSaveState {
  if (
    state.stickers.unlocked[id] === undefined ||
    state.achievements.unlocked[seenKey(id)] !== undefined ||
    !Number.isFinite(seenAt)
  ) {
    return state;
  }
  return SaveStateSchema.parse({
    ...state,
    achievements: {
      unlocked: {
        ...state.achievements.unlocked,
        [seenKey(id)]: seenAt,
      },
    },
  });
}

export function markAllUnlockedStickersSeen(
  state: CanonicalSaveState,
  seenAt: number,
): CanonicalSaveState {
  if (!Number.isFinite(seenAt)) return state;
  let next = state;
  for (const id of Object.keys(state.stickers.unlocked) as StickerId[]) {
    next = markStickerSeen(next, id, seenAt);
  }
  return next;
}

export function hasClaimedPageReward(
  state: CanonicalSaveState,
  page: StickerPageId,
): boolean {
  return state.achievements.unlocked[pageRewardKey(page)] !== undefined;
}
