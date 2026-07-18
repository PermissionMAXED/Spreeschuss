import { xpRequiredForLevel, type Economy } from "../core/contracts/economy";
import type { AppLanguage } from "../core/contracts/i18n";
import { isDuringQuietHours, type QuietHours } from "../core/contracts/platform";
import {
  UI_SCALE_MAX,
  UI_SCALE_MIN,
} from "../core/contracts/save";
import {
  MINIGAME_IDS,
  type MinigameId,
  type NormalUiDestination,
  type ShopId,
} from "../core/contracts/scenes";
import type { Needs } from "../core/contracts/simulation";
import {
  CATALOG_BY_ID,
  COSMETIC_EQUIP_SLOTS,
  type CosmeticEquipSlot,
} from "../data/catalog";
import { MINIGAME_COPY } from "../data/strings";

export type PanelId = "places" | "play" | "wardrobe" | "items" | "stickers" | "settings";
export type WardrobeSlot = CosmeticEquipSlot;
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
  readonly quietHours?: QuietHours | null;
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
export const DEFAULT_UI_QUIET_HOURS: Readonly<QuietHours> = Object.freeze({
  startHour: 21,
  endHour: 8,
});

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
  for (const slot of COSMETIC_EQUIP_SLOTS) {
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

function parseQuietHours(value: unknown): QuietHours | null | undefined {
  if (value === null) return null;
  if (typeof value !== "object" || value === null) return undefined;
  const candidate = value as Partial<Record<keyof QuietHours, unknown>>;
  return typeof candidate.startHour === "number"
      && Number.isInteger(candidate.startHour)
      && candidate.startHour >= 0
      && candidate.startHour <= 23
      && typeof candidate.endHour === "number"
      && Number.isInteger(candidate.endHour)
      && candidate.endHour >= 0
      && candidate.endHour <= 23
    ? {
        startHour: candidate.startHour,
        endHour: candidate.endHour,
      }
    : undefined;
}

export function parseUiState(raw: string | null): UiPersistedState {
  if (!raw) return structuredClone(DEFAULT_STATE);
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return structuredClone(DEFAULT_STATE);
    const candidate = parsed as Partial<Record<keyof UiPersistedState, unknown>>;
    const quietHours = parseQuietHours(candidate.quietHours);
    return {
      version: 1,
      equipped: parseEquipped(candidate.equipped),
      preferences: parsePreferences(candidate.preferences),
      ...(quietHours !== undefined ? { quietHours } : {}),
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

export function formatQuietHour(hour: number): string {
  return `${hour.toString().padStart(2, "0")}:00`;
}

export function parseQuietHourValue(value: string): number | null {
  const match = /^([01]\d|2[0-3]):00$/u.exec(value);
  return match?.[1] === undefined ? null : Number(match[1]);
}

export function quietHoursPresentation(
  quietHours: QuietHours | null,
  at: number,
): {
  readonly bounds: Readonly<QuietHours>;
  readonly enabled: boolean;
  readonly quietNow: boolean;
  readonly explanation: string;
  readonly status: string;
} {
  const bounds = quietHours ?? DEFAULT_UI_QUIET_HOURS;
  if (!quietHours) {
    return {
      bounds,
      enabled: false,
      quietNow: false,
      explanation: "Enable quiet hours to defer reminders during your chosen daily interval.",
      status: "Off — reminders may arrive at any time.",
    };
  }
  if (bounds.startHour === bounds.endHour) {
    return {
      bounds,
      enabled: true,
      quietNow: false,
      explanation: "Start and end match, so no reminders are deferred.",
      status: "On, but inactive — matching times create no quiet interval.",
    };
  }
  const start = formatQuietHour(bounds.startHour);
  const end = formatQuietHour(bounds.endHour);
  const quietNow = isDuringQuietHours(at, bounds);
  return {
    bounds,
    enabled: true,
    quietNow,
    explanation: bounds.startHour > bounds.endHour
      ? `Runs overnight from ${start} to ${end}. Reminders due then wait until ${end}.`
      : `Runs daily from ${start} to ${end}. Reminders due then wait until ${end}.`,
    status: quietNow
      ? `Quiet now — reminders wait until ${end}.`
      : `Not quiet now — the next quiet interval starts at ${start}.`,
  };
}

/** Frozen presentation grouping of the 24 minigames into four hub categories. */
export const GAME_CATEGORY_IDS = ["reflex", "puzzle", "rhythm", "errand"] as const;
export type GameCategoryId = (typeof GAME_CATEGORY_IDS)[number];

export const GAME_CATEGORY_BY_GAME: Readonly<Record<MinigameId, GameCategoryId>> = Object.freeze({
  "carrot-catch": "reflex",
  "bunny-hop": "reflex",
  "pancake-peak": "errand",
  "bubble-bath-blast": "reflex",
  "veggie-sort": "puzzle",
  "gooby-says": "puzzle",
  "garden-moles": "reflex",
  "carrot-cannon": "reflex",
  "delivery-dash": "errand",
  "memory-meadow": "puzzle",
  "pond-fishing": "errand",
  "rhythm-hop": "rhythm",
  "cake-atelier": "errand",
  "shopping-surf": "errand",
  "picnic-packer": "puzzle",
  "firefly-lantern": "rhythm",
  "puddle-hopper": "reflex",
  "market-scales": "puzzle",
  "burrow-dig": "reflex",
  "cloud-bounce": "reflex",
  "snail-mail": "errand",
  "topiary-trim": "rhythm",
  "honey-drizzle": "rhythm",
  "library-stack": "puzzle",
});

export function gamesInCategory(category: GameCategoryId): readonly MinigameCard[] {
  return MINIGAME_CARDS.filter((card) => GAME_CATEGORY_BY_GAME[card.id] === category);
}

/** Preset stops offered alongside the free slider; bounds match the contract. */
export const UI_SCALE_PRESETS = [0.85, 1, 1.15, 1.35] as const;

export function formatUiScale(scale: number): string {
  return `${Math.round(scale * 100)}%`;
}

export function clampUiScaleInput(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(UI_SCALE_MAX, Math.max(UI_SCALE_MIN, value));
}

/** Converts a canonical 0–1 bus volume into the 0–100 slider percentage. */
export function volumeToPercent(volume: number): number {
  if (!Number.isFinite(volume)) return 100;
  return Math.round(Math.min(1, Math.max(0, volume)) * 100);
}

/** Converts a 0–100 slider percentage into the canonical 0–1 bus volume. */
export function percentToVolume(percent: number): number {
  if (!Number.isFinite(percent)) return 1;
  return Math.min(1, Math.max(0, percent / 100));
}

export interface PageSlice<T> {
  readonly items: readonly T[];
  readonly page: number;
  readonly pages: number;
}

/** Clamped, zero-based paging used by the 48-item wardrobe lists. */
export function paginate<T>(
  items: readonly T[],
  page: number,
  perPage: number,
): PageSlice<T> {
  const safePerPage = Math.max(1, Math.floor(perPage));
  const pages = Math.max(1, Math.ceil(items.length / safePerPage));
  const safePage = Math.min(Math.max(0, Math.floor(page)), pages - 1);
  const start = safePage * safePerPage;
  return { items: items.slice(start, start + safePerPage), page: safePage, pages };
}

export const DEV_UNLOCK_TAPS = 7;
export const DEV_UNLOCK_WINDOW_MS = 10_000;

/**
 * Hidden developer-workshop unlock: exactly seven taps on the "Automatic"
 * language option inside a sliding ten-second window. Six taps, or taps
 * spread wider than the window, never unlock.
 */
export class DevUnlockTracker {
  private taps: number[] = [];

  tap(now: number): boolean {
    this.taps = this.taps.filter((at) => now - at < DEV_UNLOCK_WINDOW_MS);
    this.taps.push(now);
    if (this.taps.length >= DEV_UNLOCK_TAPS) {
      this.taps = [];
      return true;
    }
    return false;
  }

  get count(): number {
    return this.taps.length;
  }

  reset(): void {
    this.taps = [];
  }
}

/**
 * UI-only copy that is not part of the frozen CP1 `AppStrings` surface.
 * Kept bilingual here so the runtime language switch covers every new
 * CP2 surface without touching the read-only i18n catalogs.
 */
export interface UiExtraCopy {
  readonly categories: Readonly<Record<GameCategoryId, string>>;
  readonly wardrobeSlots: Readonly<Record<CosmeticEquipSlot, string>>;
  readonly page: (current: number, total: number) => string;
  readonly previousPage: string;
  readonly nextPage: string;
  readonly lockedItem: string;
  readonly carrotsWord: string;
  readonly mutedNote: string;
  readonly volumeValue: (label: string, percent: number) => string;
  readonly devUnlocked: string;
  readonly stickerUnlocked: (title: string) => string;
  readonly pageReward: (page: string, coins: number) => string;
  readonly dev: {
    readonly open: string;
    readonly back: string;
    readonly sceneJump: string;
    readonly audioTests: string;
    readonly cueFor: (bus: string) => string;
    readonly fpsOverlay: string;
    readonly fpsShow: string;
    readonly fpsHide: string;
    readonly stickerPreview: string;
    readonly licenses: string;
    readonly cheats: string;
    readonly cheatsUnavailable: string;
    readonly grantXp: string;
    readonly advanceHour: string;
  };
}

export const UI_EXTRA_COPY: Readonly<Record<AppLanguage, UiExtraCopy>> = Object.freeze({
  en: {
    categories: {
      reflex: "Quick reflexes",
      puzzle: "Puzzles & sorting",
      rhythm: "Rhythm & timing",
      errand: "Errands & adventures",
    },
    wardrobeSlots: {
      head: "Head",
      ears: "Ears",
      neck: "Neck",
      back: "Back",
      face: "Face",
      paws: "Paws",
    },
    page: (current, total) => `Page ${current} of ${total}`,
    previousPage: "Previous page",
    nextPage: "Next page",
    lockedItem: "Locked",
    carrotsWord: "carrots",
    mutedNote: "Sound is off — levels are kept and used again when sound returns.",
    volumeValue: (label, percent) => `${label} volume, ${percent} percent`,
    devUnlocked: "Developer workshop unlocked",
    stickerUnlocked: (title) => `New sticker: ${title}`,
    pageReward: (page, coins) => `${page} complete! +${coins} coins`,
    dev: {
      open: "Open developer workshop",
      back: "Back to settings",
      sceneJump: "Scene jump",
      audioTests: "Audio bus tests",
      cueFor: (bus) => `Play ${bus} cue`,
      fpsOverlay: "FPS overlay",
      fpsShow: "Show FPS overlay",
      fpsHide: "Hide FPS overlay",
      stickerPreview: "Sticker previews",
      licenses: "Licenses",
      cheats: "Mutation cheats",
      cheatsUnavailable: "Cheats are available only in development and test builds.",
      grantXp: "Grant 200 XP",
      advanceHour: "Advance time 1 hour",
    },
  },
  de: {
    categories: {
      reflex: "Schnelle Reflexe",
      puzzle: "Rätsel & Sortieren",
      rhythm: "Rhythmus & Timing",
      errand: "Besorgungen & Abenteuer",
    },
    wardrobeSlots: {
      head: "Kopf",
      ears: "Ohren",
      neck: "Hals",
      back: "Rücken",
      face: "Gesicht",
      paws: "Pfoten",
    },
    page: (current, total) => `Seite ${current} von ${total}`,
    previousPage: "Vorherige Seite",
    nextPage: "Nächste Seite",
    lockedItem: "Gesperrt",
    carrotsWord: "Karotten",
    mutedNote: "Ton ist aus — die Pegel bleiben erhalten und gelten wieder, sobald der Ton an ist.",
    volumeValue: (label, percent) => `Lautstärke ${label}, ${percent} Prozent`,
    devUnlocked: "Entwicklerwerkstatt freigeschaltet",
    stickerUnlocked: (title) => `Neuer Sticker: ${title}`,
    pageReward: (page, coins) => `${page} vollständig! +${coins} Münzen`,
    dev: {
      open: "Entwicklerwerkstatt öffnen",
      back: "Zurück zu den Einstellungen",
      sceneJump: "Szenenwechsel",
      audioTests: "Audio-Bus-Tests",
      cueFor: (bus) => `${bus}-Klang abspielen`,
      fpsOverlay: "FPS-Anzeige",
      fpsShow: "FPS-Anzeige einblenden",
      fpsHide: "FPS-Anzeige ausblenden",
      stickerPreview: "Sticker-Vorschau",
      licenses: "Lizenzen",
      cheats: "Mutations-Cheats",
      cheatsUnavailable: "Cheats gibt es nur in Entwicklungs- und Testversionen.",
      grantXp: "200 XP vergeben",
      advanceHour: "Zeit 1 Stunde vorstellen",
    },
  },
});

export function uiExtraCopy(language: AppLanguage): UiExtraCopy {
  return UI_EXTRA_COPY[language];
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
