import { xpRequiredForLevel, type Economy } from "../core/contracts/economy";
import {
  MINIGAME_IDS,
  type MinigameId,
  type NormalUiDestination,
  type ShopId,
} from "../core/contracts/scenes";
import type { Needs } from "../core/contracts/simulation";
import { CATALOG_BY_ID, COSMETIC_SLOTS, type CosmeticSlot } from "../data/catalog";
import { MINIGAME_COPY } from "../data/strings";

export type PanelId = "places" | "play" | "wardrobe" | "items" | "settings";
export type WardrobeSlot = CosmeticSlot;
export type PreferenceKey = "audio" | "haptics" | "reducedMotion" | "notifications";

export interface UiPreferences {
  readonly audio: boolean;
  readonly haptics: boolean;
  readonly reducedMotion: boolean;
  readonly notifications: boolean;
}

export interface UiPersistedState {
  readonly version: 1;
  readonly equipped: Readonly<Partial<Record<WardrobeSlot, string>>>;
  readonly preferences: UiPreferences;
  readonly highScores: Readonly<Partial<Record<MinigameId, number>>>;
  readonly sleepRationaleSeen: boolean;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

export interface MinigameCard {
  readonly id: MinigameId;
  readonly title: string;
  readonly icon: string;
  readonly instructions: string;
  readonly unlockLevel: number;
}

export interface NavigationDecision {
  readonly allowed: boolean;
  readonly destination: NormalUiDestination;
  readonly message?: string;
}

export type CityUiPhase =
  | "home"
  | "destination-board"
  | "depart-ready"
  | "driving-outbound"
  | "arrived"
  | "return-board"
  | "driving-home";

export const UI_STORAGE_KEY = "gooby.ui.v1";

const DEFAULT_STATE: UiPersistedState = {
  version: 1,
  equipped: {},
  preferences: {
    audio: true,
    haptics: true,
    reducedMotion: false,
    notifications: true,
  },
  highScores: {},
  sleepRationaleSeen: false,
};

export function createDefaultUiState(): UiPersistedState {
  return structuredClone(DEFAULT_STATE);
}

const UNLOCK_LEVELS = [1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 7] as const;

export const MINIGAME_CARDS: readonly MinigameCard[] = MINIGAME_IDS.map((id, index) => ({
  id,
  ...MINIGAME_COPY[id],
  unlockLevel: UNLOCK_LEVELS[index] ?? 1,
}));

function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

function parseEquipped(value: unknown): Partial<Record<WardrobeSlot, string>> {
  if (typeof value !== "object" || value === null) return { ...DEFAULT_STATE.equipped };
  const candidate = value as Partial<Record<WardrobeSlot, unknown>>;
  const equipped: Partial<Record<WardrobeSlot, string>> = {};
  for (const slot of COSMETIC_SLOTS) {
    const itemId = candidate[slot];
    const item = typeof itemId === "string" ? CATALOG_BY_ID.get(itemId) : null;
    if (item?.kind === "cosmetic" && item.slot === slot) equipped[slot] = item.id;
  }
  return equipped;
}

function parsePreferences(value: unknown): UiPreferences {
  if (typeof value !== "object" || value === null) return { ...DEFAULT_STATE.preferences };
  const candidate = value as Partial<Record<PreferenceKey, unknown>>;
  return {
    audio: isBoolean(candidate.audio) ? candidate.audio : DEFAULT_STATE.preferences.audio,
    haptics: isBoolean(candidate.haptics) ? candidate.haptics : DEFAULT_STATE.preferences.haptics,
    reducedMotion: isBoolean(candidate.reducedMotion)
      ? candidate.reducedMotion
      : DEFAULT_STATE.preferences.reducedMotion,
    notifications: isBoolean(candidate.notifications)
      ? candidate.notifications
      : DEFAULT_STATE.preferences.notifications,
  };
}

function parseHighScores(value: unknown): Partial<Record<MinigameId, number>> {
  if (typeof value !== "object" || value === null) return {};
  const candidate = value as Record<string, unknown>;
  const result: Partial<Record<MinigameId, number>> = {};
  for (const id of MINIGAME_IDS) {
    const score = candidate[id];
    if (typeof score === "number" && Number.isFinite(score) && score >= 0) {
      result[id] = Math.floor(score);
    }
  }
  return result;
}

export function parseUiState(raw: string | null): UiPersistedState {
  if (!raw) return structuredClone(DEFAULT_STATE);
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return structuredClone(DEFAULT_STATE);
    const candidate = parsed as Partial<Record<keyof UiPersistedState, unknown>>;
    return {
      version: 1,
      equipped: parseEquipped(candidate.equipped),
      preferences: parsePreferences(candidate.preferences),
      highScores: parseHighScores(candidate.highScores),
      sleepRationaleSeen: isBoolean(candidate.sleepRationaleSeen)
        ? candidate.sleepRationaleSeen
        : DEFAULT_STATE.sleepRationaleSeen,
    };
  } catch {
    return structuredClone(DEFAULT_STATE);
  }
}

export function readLegacyUiState(storage?: StorageLike): UiPersistedState | null {
  const raw = storage?.getItem(UI_STORAGE_KEY) ?? null;
  return raw === null ? null : parseUiState(raw);
}

export function removeLegacyUiState(storage?: StorageLike): void {
  try {
    storage?.removeItem?.(UI_STORAGE_KEY);
  } catch {
    // Canonical save remains authoritative if legacy storage is unavailable.
  }
}

export function formatCountdown(remainingMs: number): string {
  const seconds = Math.max(0, Math.ceil(remainingMs / 1_000));
  const minutesPart = Math.floor(seconds / 60).toString().padStart(2, "0");
  const secondsPart = (seconds % 60).toString().padStart(2, "0");
  return `${minutesPart}:${secondsPart}`;
}

export function getLevelProgress(economy: Economy): number {
  const current = xpRequiredForLevel(economy.level);
  const next = xpRequiredForLevel(economy.level + 1);
  return Math.max(0, Math.min(1, (economy.xp - current) / Math.max(1, next - current)));
}

export function shopNavigationIntent(shop: ShopId): {
  readonly destination: Extract<NormalUiDestination, { readonly kind: "city-board" }>;
  readonly selectedShop: ShopId;
} {
  return { destination: { kind: "city-board" }, selectedShop: shop };
}

export class OnboardingProgress {
  private initialNeeds: Needs | null = null;
  private initialCarrots = 0;
  private step: "intro" | "pet" | "feed" | "meters" | "complete" = "intro";

  get currentStep(): typeof this.step {
    return this.step;
  }

  begin(needs: Needs, carrots: number): void {
    this.initialNeeds = { ...needs };
    this.initialCarrots = carrots;
  }

  leaveIntro(): void {
    if (this.step === "intro") this.step = "pet";
  }

  observe(needs: Needs, carrots: number): void {
    if (!this.initialNeeds) this.begin(needs, carrots);
    if (!this.initialNeeds) return;
    if (this.step === "pet" && needs.fun > this.initialNeeds.fun) {
      this.step = "feed";
    }
    if (
      this.step === "feed" &&
      carrots < this.initialCarrots &&
      needs.hunger >= this.initialNeeds.hunger
    ) {
      this.step = "meters";
    }
  }

  complete(): boolean {
    if (this.step !== "meters") return false;
    this.step = "complete";
    return true;
  }
}

export class UiModel {
  private state: UiPersistedState;
  private selectedShop: ShopId | null = null;
  private cityPhase: CityUiPhase = "home";
  private firstTripActive = false;

  constructor(initialState: UiPersistedState = createDefaultUiState()) {
    this.state = structuredClone(initialState);
  }

  get persisted(): UiPersistedState {
    return this.state;
  }

  get city(): {
    readonly phase: CityUiPhase;
    readonly selectedShop: ShopId | null;
    readonly firstTripActive: boolean;
  } {
    return {
      phase: this.cityPhase,
      selectedShop: this.selectedShop,
      firstTripActive: this.firstTripActive,
    };
  }

  replacePersisted(state: UiPersistedState): void {
    this.state = structuredClone(state);
  }

  equip(slot: WardrobeSlot, itemId: string | null): void {
    const item = itemId ? CATALOG_BY_ID.get(itemId) : null;
    if (itemId && (item?.kind !== "cosmetic" || item.slot !== slot)) return;
    const equipped = { ...this.state.equipped };
    if (itemId) equipped[slot] = itemId;
    else delete equipped[slot];
    this.state = {
      ...this.state,
      equipped,
    };
  }

  setPreference(key: PreferenceKey, enabled: boolean): void {
    this.state = {
      ...this.state,
      preferences: { ...this.state.preferences, [key]: enabled },
    };
  }

  markSleepRationaleSeen(): void {
    if (this.state.sleepRationaleSeen) return;
    this.state = { ...this.state, sleepRationaleSeen: true };
  }

  recordResult(id: MinigameId, score: number): { readonly isNewBest: boolean; readonly best: number } {
    const safeScore = Math.max(0, Math.floor(score));
    const previous = this.state.highScores[id] ?? 0;
    const best = Math.max(previous, safeScore);
    const isNewBest = safeScore > previous;
    if (isNewBest) {
      this.state = {
        ...this.state,
        highScores: { ...this.state.highScores, [id]: best },
      };
    }
    return { isNewBest, best };
  }

  selectCityDestination(shop: ShopId): ReturnType<typeof shopNavigationIntent> {
    this.selectedShop = shop;
    this.cityPhase = "depart-ready";
    return shopNavigationIntent(shop);
  }

  beginCityTrip(): void {
    if (!this.selectedShop || this.cityPhase !== "depart-ready") return;
    this.cityPhase = "driving-outbound";
    this.firstTripActive = true;
  }

  markCityArrival(): void {
    if (this.cityPhase === "driving-outbound") this.cityPhase = "arrived";
  }

  openReturnBoard(): void {
    if (this.cityPhase === "arrived") this.cityPhase = "return-board";
  }

  beginReturnTrip(): void {
    if (this.cityPhase === "return-board") this.cityPhase = "driving-home";
  }

  completeReturnTrip(): void {
    if (this.cityPhase !== "driving-home") return;
    this.cityPhase = "home";
    this.firstTripActive = false;
    this.selectedShop = null;
  }

  requestLivingRoom(message: string): NavigationDecision {
    if (this.firstTripActive) {
      return {
        allowed: false,
        destination: { kind: "home", zone: "living-room" },
        message,
      };
    }
    return { allowed: true, destination: { kind: "home", zone: "living-room" } };
  }
}
