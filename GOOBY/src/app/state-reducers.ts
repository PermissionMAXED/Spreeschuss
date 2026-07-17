import { grantReward, levelForXp } from "../core/contracts/economy";
import type {
  MinigameSettlementReceipt,
} from "../core/contracts/minigame";
import {
  SaveStateSchema,
  type CanonicalSaveState,
  type SaveState,
} from "../core/contracts/save";
import type { MinigameId } from "../core/contracts/scenes";
import { CATALOG_BY_ID, COSMETIC_SLOTS } from "../data/catalog";
import type { UiPersistedState } from "../ui/model";
import type { ReplayableSaveReducer } from "./save-coordinator";

const INTERNAL_INVENTORY_PREFIX = "__";
const SETTLED_RUN_PREFIX = "__minigame.settled.v1|";
const TRAVEL_SNAPSHOT_PREFIX = "__city.travel.v1|";

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function ownedEquipped(
  state: CanonicalSaveState,
  equipped: Readonly<Record<string, string>>,
): Record<string, string> {
  const valid: Record<string, string> = {};
  for (const slot of COSMETIC_SLOTS) {
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
    return SaveStateSchema.parse({
      ...state,
      settings: {
        ...state.settings,
        muted: !legacy.preferences.audio,
        haptics: legacy.preferences.haptics,
        reducedMotion: legacy.preferences.reducedMotion,
        notifications: legacy.preferences.notifications,
      },
      ui: {
        equipped: ownedEquipped(state, legacy.equipped),
        highScores,
        sleepRationaleSeen: state.ui.sleepRationaleSeen || legacy.sleepRationaleSeen,
      },
    });
  };
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
    });
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
  const coinDelta = next.economy.coins - before.economy.coins;
  const xpDelta = next.economy.xp - before.economy.xp;
  const inventoryKeys = new Set([
    ...Object.keys(before.inventory),
    ...Object.keys(next.inventory),
  ]);
  const inventoryChanges = [...inventoryKeys]
    .filter((key) => (before.inventory[key] ?? 0) !== (next.inventory[key] ?? 0))
    .map((key) => ({
      key,
      delta: (next.inventory[key] ?? 0) - (before.inventory[key] ?? 0),
      exact: next.inventory[key] ?? 0,
    }));
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
      dailyHarvest: same(before.dailyHarvest, next.dailyHarvest)
        ? state.dailyHarvest
        : next.dailyHarvest,
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
