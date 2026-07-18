import { clampBusVolume, type AudioBus } from "../core/contracts/audio";
import { grantReward, levelForXp } from "../core/contracts/economy";
import type { LanguageSetting } from "../core/contracts/i18n";
import type {
  MinigameSettlementReceipt,
} from "../core/contracts/minigame";
import {
  SaveStateSchema,
  UI_SCALE_DEFAULT,
  UI_SCALE_MAX,
  UI_SCALE_MIN,
  type CanonicalSaveState,
  type SaveState,
} from "../core/contracts/save";
import type { QuietHours } from "../core/contracts/platform";
import { MINIGAME_IDS, type MinigameId } from "../core/contracts/scenes";
import {
  catchUpOffline,
  startSleep,
  wakeEarly,
} from "../core/contracts/simulation";
import type { StickerId } from "../core/contracts/stickers";
import { CATALOG_BY_ID, COSMETIC_EQUIP_SLOTS } from "../data/catalog";
import { markAllUnlockedStickersSeen, markStickerSeen } from "../stickers/progression";
import type { UiPersistedState } from "../ui/model";
import type { ReplayableSaveReducer } from "./save-coordinator";

const INTERNAL_INVENTORY_PREFIX = "__";
const SETTLED_RUN_PREFIX = "__minigame.settled.v1|";
const TRAVEL_SNAPSHOT_PREFIX = "__city.travel.v1|";
const HARVEST_DAY_KEY = "__home.harvest.day";
const HARVEST_COUNT_KEY = "__home.harvest.count";
const HARVEST_RECEIPT_PREFIX = "__home.harvest.receipt.v1|";
const DAILY_HARVEST_QUOTA = 3;

interface HarvestLedger {
  readonly day: number | null;
  readonly count: number;
}

interface HarvestOperation {
  readonly day: number;
  readonly grants: number;
  readonly receiptKey: string;
}

function harvestLedger(state: CanonicalSaveState): HarvestLedger {
  const canonicalDay = state.dailyHarvest.day ?? -1;
  const legacyDay = state.inventory[HARVEST_DAY_KEY] ?? -1;
  const day = Math.max(canonicalDay, legacyDay);
  if (day < 0) return { day: null, count: 0 };
  const canonicalCount = canonicalDay === day ? state.dailyHarvest.count : 0;
  const legacyCount = legacyDay === day ? (state.inventory[HARVEST_COUNT_KEY] ?? 0) : 0;
  return { day, count: Math.max(canonicalCount, legacyCount) };
}

function harvestReceiptId(): string {
  const crypto = globalThis.crypto;
  if (crypto && typeof crypto.randomUUID === "function") {
    try {
      return crypto.randomUUID();
    } catch {
      // Restricted webviews can expose crypto while rejecting randomUUID.
    }
  }
  return Array.from({ length: 4 }, () =>
    Math.floor(Math.random() * 0x1_0000_0000).toString(36).padStart(7, "0")).join("");
}

function semanticHarvestOperation(
  before: CanonicalSaveState,
  next: CanonicalSaveState,
): HarvestOperation | null {
  const previous = harvestLedger(before);
  const proposed = harvestLedger(next);
  if (proposed.day === null) return null;
  const previousDay = previous.day ?? -1;
  const countIncrease = proposed.day > previousDay
    ? proposed.count
    : proposed.day === previous.day
      ? proposed.count - previous.count
      : 0;
  const carrotIncrease = (next.inventory.carrot ?? 0) - (before.inventory.carrot ?? 0);
  const grants = Math.min(Math.max(0, countIncrease), Math.max(0, carrotIncrease));
  if (grants === 0) return null;
  const receiptId = harvestReceiptId();
  return {
    day: proposed.day,
    grants,
    receiptKey: `${HARVEST_RECEIPT_PREFIX}${proposed.day}|${grants}|${receiptId}`,
  };
}

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function ownedEquipped(
  state: CanonicalSaveState,
  equipped: Readonly<Record<string, string>>,
): Record<string, string> {
  const valid: Record<string, string> = {};
  for (const slot of COSMETIC_EQUIP_SLOTS) {
    const itemId = equipped[slot];
    if (!itemId) continue;
    const item = CATALOG_BY_ID.get(itemId);
    const owned = state.inventory[itemId] ?? 0;
    if (owned > 0 && item?.kind === "cosmetic" && item.slot === slot) valid[slot] = itemId;
  }
  return valid;
}

export function sanitizeCanonicalUi(state: CanonicalSaveState): CanonicalSaveState {
  const equipped = ownedEquipped(state, state.ui.equipped);
  return same(equipped, state.ui.equipped)
    ? state
    : SaveStateSchema.parse({ ...state, ui: { ...state.ui, equipped } });
}

export function migrateLegacyUiReducer(legacy: UiPersistedState): ReplayableSaveReducer {
  return (state) => {
    const highScores: Partial<Record<MinigameId, number>> = { ...state.ui.highScores };
    for (const [id, score] of Object.entries(legacy.highScores)) {
      if (score !== undefined) {
        const game = id as MinigameId;
        highScores[game] = Math.max(highScores[game] ?? 0, score);
      }
    }
    const legacyEquipped = ownedEquipped(state, legacy.equipped);
    return SaveStateSchema.parse({
      ...state,
      settings: {
        ...state.settings,
        ...(legacy.preferences.audio ? {} : { muted: true }),
        ...(legacy.preferences.haptics ? {} : { haptics: false }),
        ...(legacy.preferences.reducedMotion ? { reducedMotion: true } : {}),
        ...(legacy.preferences.notifications ? {} : { notifications: false }),
      },
      notificationPolicy: legacy.quietHours === undefined
        ? state.notificationPolicy
        : {
            ...state.notificationPolicy,
            quietHours: legacy.quietHours,
          },
      ui: {
        equipped: ownedEquipped(state, {
          ...state.ui.equipped,
          ...legacyEquipped,
        }),
        highScores,
        sleepRationaleSeen: state.ui.sleepRationaleSeen || legacy.sleepRationaleSeen,
      },
    });
  };
}

export function setQuietHoursReducer(quietHours: QuietHours | null): ReplayableSaveReducer {
  return (state) => SaveStateSchema.parse({
    ...state,
    notificationPolicy: {
      ...state.notificationPolicy,
      quietHours,
    },
  });
}

interface MinigameStatTotals {
  readonly distinctGames: number;
  readonly totalPlays: number;
}

/**
 * The nine frozen game-medal milestones on the `game-medals` sticker page.
 * All medals except `new-best` derive purely from the post-settlement stats
 * table, so replaying the same receipt can never double-unlock a medal.
 */
function earnedGameMedals(
  totals: MinigameStatTotals,
  improvedBest: boolean,
): readonly StickerId[] {
  const medals: StickerId[] = [];
  if (totals.totalPlays >= 1) medals.push("sticker.games.first-round");
  if (improvedBest) medals.push("sticker.games.new-best");
  if (totals.distinctGames >= 3) medals.push("sticker.games.three-games");
  if (totals.distinctGames >= 6) medals.push("sticker.games.six-games");
  if (totals.distinctGames >= 12) medals.push("sticker.games.twelve-games");
  if (totals.distinctGames >= MINIGAME_IDS.length) medals.push("sticker.games.all-games");
  if (totals.totalPlays >= 10) medals.push("sticker.games.ten-rounds");
  if (totals.totalPlays >= 50) medals.push("sticker.games.fifty-rounds");
  if (totals.totalPlays >= 100) medals.push("sticker.games.hundred-rounds");
  return medals;
}

export function settleMinigameReducer(
  receipt: MinigameSettlementReceipt,
): ReplayableSaveReducer {
  return (state) => {
    if (settlementReceiptForRun(state, receipt.runId)) return state;
    const previousBest = state.ui.highScores[receipt.minigameId] ?? 0;
    const bestScore = Math.max(previousBest, receipt.payout.score, receipt.bestScore);
    const persistedReceipt = { ...receipt, bestScore };
    const inventory = { ...state.inventory };
    if (state.minigameSettlement) {
      inventory[`${SETTLED_RUN_PREFIX}${JSON.stringify(state.minigameSettlement)}`] = 1;
    }
    inventory[`${SETTLED_RUN_PREFIX}${JSON.stringify(persistedReceipt)}`] = 1;
    const previousStats = state.minigameStats[receipt.minigameId]
      ?? { plays: 0, bestScore: 0, totalScore: 0, lastPlayedAt: null };
    const minigameStats = {
      ...state.minigameStats,
      [receipt.minigameId]: {
        plays: previousStats.plays + 1,
        bestScore: Math.max(previousStats.bestScore, Math.floor(receipt.payout.score)),
        totalScore: previousStats.totalScore + receipt.payout.score,
        lastPlayedAt: receipt.completedAt,
      },
    };
    const statEntries = Object.values(minigameStats);
    const medals = earnedGameMedals(
      {
        distinctGames: statEntries.length,
        totalPlays: statEntries.reduce((sum, stat) => sum + (stat?.plays ?? 0), 0),
      },
      previousStats.plays > 0 && Math.floor(receipt.payout.score) > previousStats.bestScore,
    );
    const newUnlocks = medals.filter((id) => state.stickers.unlocked[id] === undefined);
    return SaveStateSchema.parse({
      ...state,
      economy: grantReward(state.economy, {
        coins: receipt.payout.coins,
        xp: receipt.payout.xp,
      }),
      inventory,
      ui: {
        ...state.ui,
        highScores: {
          ...state.ui.highScores,
          [receipt.minigameId]: bestScore,
        },
      },
      minigameSettlement: persistedReceipt,
      minigameStats,
      stickers: newUnlocks.length === 0
        ? state.stickers
        : {
            ...state.stickers,
            unlocked: {
              ...state.stickers.unlocked,
              ...Object.fromEntries(newUnlocks.map((id) => [id, receipt.completedAt])),
            },
          },
    });
  };
}

export function clampUiScale(scale: number): number {
  if (!Number.isFinite(scale)) return UI_SCALE_DEFAULT;
  return Math.min(UI_SCALE_MAX, Math.max(UI_SCALE_MIN, scale));
}

export function setUiScaleReducer(scale: number): ReplayableSaveReducer {
  const clamped = clampUiScale(scale);
  return (state) => state.settings.uiScale === clamped
    ? state
    : SaveStateSchema.parse({
        ...state,
        settings: { ...state.settings, uiScale: clamped },
      });
}

export function setBusVolumeReducer(bus: AudioBus, volume: number): ReplayableSaveReducer {
  const clamped = clampBusVolume(volume);
  return (state) => state.settings.volumes[bus] === clamped
    ? state
    : SaveStateSchema.parse({
        ...state,
        settings: {
          ...state.settings,
          volumes: { ...state.settings.volumes, [bus]: clamped },
        },
      });
}

export function setLanguageReducer(language: LanguageSetting): ReplayableSaveReducer {
  return (state) => state.settings.language === language
    ? state
    : SaveStateSchema.parse({
        ...state,
        settings: { ...state.settings, language },
      });
}

export function setDevWorkshopUnlockedReducer(unlocked: boolean): ReplayableSaveReducer {
  return (state) => state.devWorkshop.unlocked === unlocked
    ? state
    : SaveStateSchema.parse({
        ...state,
        devWorkshop: { ...state.devWorkshop, unlocked },
      });
}

export function setDevWorkshopFlagReducer(flag: string, enabled: boolean): ReplayableSaveReducer {
  return (state) => state.devWorkshop.flags[flag] === enabled
    ? state
    : SaveStateSchema.parse({
        ...state,
        devWorkshop: {
          ...state.devWorkshop,
          flags: { ...state.devWorkshop.flags, [flag]: enabled },
        },
      });
}

/** Persists the "seen" flag for an unlocked sticker; a no-op for locked or already-seen ones. */
export function markStickerSeenReducer(id: StickerId, seenAt: number): ReplayableSaveReducer {
  return (state) => markStickerSeen(state, id, seenAt);
}

/** Marks every currently unlocked sticker as seen (e.g. closing the sticker book). */
export function markAllStickersSeenReducer(seenAt: number): ReplayableSaveReducer {
  return (state) => markAllUnlockedStickersSeen(state, seenAt);
}

/**
 * Equips or clears one of the six wardrobe sockets. Unknown slots, unowned
 * items, and slot mismatches are rejected wholesale so a replay can never
 * persist an invalid outfit.
 */
export function setEquippedCosmeticReducer(
  slot: string,
  itemId: string | null,
): ReplayableSaveReducer {
  return (state) => {
    if (!(COSMETIC_EQUIP_SLOTS as readonly string[]).includes(slot)) return state;
    const equipped: Record<string, string> = { ...state.ui.equipped };
    if (itemId === null) delete equipped[slot];
    else equipped[slot] = itemId;
    const valid = ownedEquipped(state, equipped);
    if (itemId !== null && valid[slot] !== itemId) return state;
    return same(valid, state.ui.equipped)
      ? state
      : SaveStateSchema.parse({ ...state, ui: { ...state.ui, equipped: valid } });
  };
}

/** Sticker unlocks are exactly-once: an existing unlock time is never rewritten. */
export function unlockStickerReducer(id: StickerId, unlockedAt: number): ReplayableSaveReducer {
  return (state) => state.stickers.unlocked[id] !== undefined
    ? state
    : SaveStateSchema.parse({
        ...state,
        stickers: {
          ...state.stickers,
          unlocked: { ...state.stickers.unlocked, [id]: unlockedAt },
        },
      });
}

export function unlockAchievementReducer(id: string, unlockedAt: number): ReplayableSaveReducer {
  return (state) => state.achievements.unlocked[id] !== undefined
    ? state
    : SaveStateSchema.parse({
        ...state,
        achievements: {
          ...state.achievements,
          unlocked: { ...state.achievements.unlocked, [id]: unlockedAt },
        },
      });
}

export function beginSleepReducer(now: number, markRationaleSeen: boolean): ReplayableSaveReducer {
  return (state) => {
    if (state.simulation.sleep) {
      return markRationaleSeen && !state.ui.sleepRationaleSeen
        ? SaveStateSchema.parse({ ...state, ui: { ...state.ui, sleepRationaleSeen: true } })
        : state;
    }
    return SaveStateSchema.parse({
      ...state,
      simulation: startSleep(state.simulation, now),
      ui: markRationaleSeen
        ? { ...state.ui, sleepRationaleSeen: true }
        : state.ui,
    });
  };
}

/**
 * Exactly-once wake settlement. The wake time is captured when the player
 * acts, never re-read during a conflict replay, so a gentle early wake always
 * settles the identical partial-energy result: replaying after the original
 * `completesAt` can no longer inflate the outcome to a full night's rest, and
 * a second queued wake (or a replay over an already-awake winner) is a no-op.
 */
export function wakeReducer(now: number): ReplayableSaveReducer {
  return (state) => {
    if (!state.simulation.sleep) return state;
    return SaveStateSchema.parse({
      ...state,
      simulation: wakeEarly(state.simulation, now),
    });
  };
}

export function catchUpOfflineReducer(now: number): ReplayableSaveReducer {
  return (state) => {
    const simulation = catchUpOffline(state.simulation, now);
    return simulation === state.simulation
      ? state
      : SaveStateSchema.parse({ ...state, simulation });
  };
}

export function settlementReceiptForRun(
  state: CanonicalSaveState,
  runId: string,
): MinigameSettlementReceipt | null {
  if (state.minigameSettlement?.runId === runId) return state.minigameSettlement;
  for (const key of Object.keys(state.inventory)) {
    if (!key.startsWith(SETTLED_RUN_PREFIX)) continue;
    try {
      const receipt = JSON.parse(key.slice(SETTLED_RUN_PREFIX.length)) as unknown;
      const parsed = SaveStateSchema.safeParse({ ...state, minigameSettlement: receipt });
      if (parsed.success && parsed.data.minigameSettlement?.runId === runId) {
        return parsed.data.minigameSettlement;
      }
    } catch {
      // Ignore malformed reserved keys; canonical gameplay inventory remains usable.
    }
  }
  return null;
}

export function consumeFoodReducer(
  itemId: string,
  hunger: number,
  xp: number,
  now: number,
): ReplayableSaveReducer {
  return (state) => {
    const count = state.inventory[itemId] ?? 0;
    if (count <= 0 || state.simulation.sleep) return state;
    return SaveStateSchema.parse({
      ...state,
      simulation: {
        ...state.simulation,
        needs: {
          ...state.simulation.needs,
          hunger: Math.min(100, state.simulation.needs.hunger + hunger),
        },
        lastSimulatedAt: Math.max(state.simulation.lastSimulatedAt, now),
      },
      economy: grantReward(state.economy, { xp }),
      inventory: { ...state.inventory, [itemId]: count - 1 },
    });
  };
}

/**
 * Converts a specialist-owned whole-save update into a deterministic reducer.
 * Economy and inventory use deltas so a conflict winner's unrelated progress is
 * retained; canonical policy/profile fields use only the values actually
 * changed by the specialist update.
 */
export function reconcileExternalState(
  before: CanonicalSaveState,
  proposed: SaveState,
): ReplayableSaveReducer {
  const next = SaveStateSchema.parse(proposed);
  const harvest = semanticHarvestOperation(before, next);
  const coinDelta = next.economy.coins - before.economy.coins;
  const xpDelta = next.economy.xp - before.economy.xp;
  const inventoryKeys = new Set([
    ...Object.keys(before.inventory),
    ...Object.keys(next.inventory),
  ]);
  const inventoryChanges = [...inventoryKeys]
    .filter((key) => key !== HARVEST_DAY_KEY && key !== HARVEST_COUNT_KEY)
    .filter((key) => (before.inventory[key] ?? 0) !== (next.inventory[key] ?? 0))
    .map((key) => ({
      key,
      delta: (next.inventory[key] ?? 0) - (before.inventory[key] ?? 0)
        - (key === "carrot" ? (harvest?.grants ?? 0) : 0),
      exact: next.inventory[key] ?? 0,
    }))
    .filter(({ delta }) => delta !== 0);
  const needDeltas = Object.fromEntries(
    (["hunger", "energy", "hygiene", "fun"] as const).map((key) => [
      key,
      next.simulation.needs[key] - before.simulation.needs[key],
    ]),
  ) as Record<keyof CanonicalSaveState["simulation"]["needs"], number>;

  return (state) => {
    const inventory = { ...state.inventory };
    for (const change of inventoryChanges) {
      const value = change.key.startsWith(INTERNAL_INVENTORY_PREFIX)
        ? change.exact
        : Math.max(0, (inventory[change.key] ?? 0) + change.delta);
      if (value === 0 && change.exact === 0) delete inventory[change.key];
      else inventory[change.key] = value;
    }
    let dailyHarvest = state.dailyHarvest;
    if (harvest) {
      const current = harvestLedger(state);
      let day = current.day;
      let count = current.count;
      if ((inventory[harvest.receiptKey] ?? 0) === 0) {
        if (day === null || harvest.day > day) {
          day = harvest.day;
          count = 0;
        }
        if (day === harvest.day) {
          const granted = Math.min(harvest.grants, Math.max(0, DAILY_HARVEST_QUOTA - count));
          inventory.carrot = (inventory.carrot ?? 0) + granted;
          count += granted;
        }
        inventory[harvest.receiptKey] = 1;
      }
      if (day !== null) {
        dailyHarvest = { day, count };
        inventory[HARVEST_DAY_KEY] = day;
        inventory[HARVEST_COUNT_KEY] = count;
      }
    }
    const xp = Math.max(0, state.economy.xp + xpDelta);
    const simulationChanged = !same(before.simulation, next.simulation);
    const simulation = simulationChanged
      ? {
          ...state.simulation,
          needs: {
            hunger: Math.max(0, Math.min(100, state.simulation.needs.hunger + needDeltas.hunger)),
            energy: Math.max(0, Math.min(100, state.simulation.needs.energy + needDeltas.energy)),
            hygiene: Math.max(0, Math.min(100, state.simulation.needs.hygiene + needDeltas.hygiene)),
            fun: Math.max(0, Math.min(100, state.simulation.needs.fun + needDeltas.fun)),
          },
          lastSimulatedAt: Math.max(state.simulation.lastSimulatedAt, next.simulation.lastSimulatedAt),
          sleep: same(before.simulation.sleep, next.simulation.sleep)
            ? state.simulation.sleep
            : next.simulation.sleep,
        }
      : state.simulation;
    return SaveStateSchema.parse({
      ...state,
      profile: same(before.profile, next.profile) ? state.profile : next.profile,
      simulation,
      economy: {
        coins: Math.max(0, state.economy.coins + coinDelta),
        xp,
        level: levelForXp(xp),
      },
      inventory,
      settings: same(before.settings, next.settings) ? state.settings : next.settings,
      ui: same(before.ui, next.ui) ? state.ui : next.ui,
      travel: same(before.travel, next.travel) ? state.travel : next.travel,
      dailyHarvest,
      notificationPolicy: same(before.notificationPolicy, next.notificationPolicy)
        ? state.notificationPolicy
        : next.notificationPolicy,
      minigameSettlement: same(before.minigameSettlement, next.minigameSettlement)
        ? state.minigameSettlement
        : next.minigameSettlement,
    });
  };
}

export function withTravelSnapshotReducer(snapshot: unknown): ReplayableSaveReducer {
  return (state) => {
    if (same(savedTravelSnapshot(state), snapshot)) return state;
    const inventory = { ...state.inventory };
    for (const key of Object.keys(inventory)) {
      if (key.startsWith(TRAVEL_SNAPSHOT_PREFIX)) delete inventory[key];
    }

    // Prefer the typed travel field as soon as the canonical schema exposes it.
    // The internal inventory entry keeps current v2 saves native/web portable in
    // older contract builds without introducing a second persistence store.
    const candidate = {
      ...state,
      inventory,
      travel: {
        ...state.travel,
        snapshot,
      },
    };
    const parsed = SaveStateSchema.safeParse(candidate);
    if (parsed.success && same(savedTravelSnapshot(parsed.data), snapshot)) return parsed.data;

    const serialized = JSON.stringify(snapshot);
    if (serialized === undefined) return state;
    inventory[`${TRAVEL_SNAPSHOT_PREFIX}${serialized}`] = 1;
    return SaveStateSchema.parse({ ...state, inventory });
  };
}

export function savedTravelSnapshot(state: CanonicalSaveState): unknown {
  const travel = state.travel as CanonicalSaveState["travel"] & { readonly snapshot?: unknown };
  if (travel.snapshot !== undefined) return travel.snapshot;
  const key = Object.keys(state.inventory)
    .find((candidate) => candidate.startsWith(TRAVEL_SNAPSHOT_PREFIX));
  if (!key) return undefined;
  try {
    return JSON.parse(key.slice(TRAVEL_SNAPSHOT_PREFIX.length)) as unknown;
  } catch {
    return undefined;
  }
}
