import { AUDIO_BUSES, type AudioBus } from "../core/contracts/audio";
import type { Economy } from "../core/contracts/economy";
import type { LanguageSetting } from "../core/contracts/i18n";
import type { QuietHours } from "../core/contracts/platform";
import type { MinigamePayout } from "../core/contracts/minigame";
import type { CanonicalSaveState } from "../core/contracts/save";
import type { HomeZoneId, MinigameId, ShopId } from "../core/contracts/scenes";
import { HOME_ZONE_IDS } from "../core/contracts/scenes";
import { NEED_KEYS, SLEEP_DURATION_MS, type Needs } from "../core/contracts/simulation";
import { STICKER_DEFINITIONS, type StickerId } from "../core/contracts/stickers";
import {
  COSMETIC_CATALOG,
  COSMETIC_EQUIP_SLOTS,
  FOOD_CATALOG,
  FURNITURE_CATALOG,
  getCatalogItemCopy,
  type CosmeticEquipSlot,
  type CosmeticSlot,
} from "../data/catalog";
import { AUDIO_SOURCE_CREDITS, AUDIO_LICENSE_NOTICE_PATH } from "../data/credits";
import { HOME_ZONE_BLUEPRINTS } from "../data/home";
import {
  activeCatalog,
  applyLanguageSetting,
  getActiveLanguage,
  onLanguageChanged,
  type AppStrings,
} from "../i18n";
import {
  manifestStickerImage,
  proceduralStickerPlaceholder,
  createStickerBook,
  type StickerBook,
} from "../stickers/book";
import { StickerCelebrationQueue } from "../stickers/celebrations";
import {
  DevUnlockTracker,
  GAME_CATEGORY_IDS,
  MINIGAME_CARDS,
  DEFAULT_UI_QUIET_HOURS,
  OnboardingProgress,
  UI_SCALE_PRESETS,
  UiModel,
  clampUiScaleInput,
  formatCountdown,
  formatQuietHour,
  formatUiScale,
  gamesInCategory,
  getLevelProgress,
  paginate,
  parseQuietHourValue,
  percentToVolume,
  quietHoursPresentation,
  uiExtraCopy,
  volumeToPercent,
  type PanelId,
  type PreferenceKey,
  type UiExtraCopy,
} from "./model";

export interface UiActions {
  feedback(action: "tap" | "confirm" | "back" | "open" | "close" | "denied"): void;
  pet(): void;
  feed(): void;
  consumeFood(itemId: string): void;
  bathe(): void;
  sleep(): void;
  confirmSleep(): void;
  wake(): void;
  navigateHome(zone: HomeZoneId): void;
  openCity(): void;
  startMinigame(game: MinigameId): void;
  pauseMinigame(): void;
  resumeMinigame(): void;
  exitMinigame(): void;
  equipCosmetic(slot: CosmeticSlot, itemId: string | null): boolean;
  placeFurniture(itemId: string): boolean;
  moveDecor(direction: "left" | "right" | "forward" | "back"): boolean;
  rotateDecor(): boolean;
  removeDecor(): boolean;
  preferenceChanged(key: PreferenceKey, enabled: boolean): void;
  quietHoursChanged(quietHours: QuietHours | null): void;
  onboardingComplete(): void;
  clearLocalData(): void;
  /**
   * Optional CP2 settings actions. When the app shell does not provide them
   * yet, the UI falls back to the dev/test debug surface so persistence keeps
   * working in development while remaining a no-op in production shells.
   */
  setUiScale?(scale: number): void;
  setBusVolume?(bus: AudioBus, volume: number): void;
  setLanguage?(setting: LanguageSetting): void;
  setDevWorkshopUnlocked?(unlocked: boolean): void;
  markStickerSeen?(id: StickerId): void;
}

export type SceneChrome =
  | { readonly kind: "home"; readonly label?: string }
  | { readonly kind: "city"; readonly phase: "board" | "driving" | "shop"; readonly destination?: ShopId }
  | { readonly kind: "minigame"; readonly title: string };

const WARDROBE_PAGE_SIZE = 6;
const TOAST_VISIBLE_MS = 2_200;
const TOAST_GAP_MS = 260;

interface NavItem {
  readonly id: PanelId;
  readonly label: string;
  readonly icon: string;
}

function navItems(strings: AppStrings): readonly NavItem[] {
  return [
    { id: "places", label: strings.nav.Places, icon: "⌂" },
    { id: "play", label: strings.nav.Play, icon: "◆" },
    { id: "wardrobe", label: strings.nav.Wardrobe, icon: "♧" },
    { id: "items", label: strings.nav.Items, icon: "▣" },
    { id: "stickers", label: strings.stickers.title, icon: "✿" },
    { id: "settings", label: strings.nav.Settings, icon: "⚙" },
  ];
}

const QUIET_HOUR_OPTIONS = Array.from({ length: 24 }, (_, hour) => {
  const value = formatQuietHour(hour);
  return { hour, value };
});

const SLOT_ICONS: Readonly<Record<CosmeticEquipSlot, string>> = {
  head: "☀",
  ears: "❀",
  neck: "⌁",
  back: "♧",
  face: "◡",
  paws: "✿",
};

const HOME_ZONE_ICONS: Readonly<Record<HomeZoneId, string>> = {
  "living-room": "⌂",
  kitchen: "♨",
  bathroom: "◌",
  bedroom: "☾",
  garden: "❀",
};

const DEV_AUDIO_CUES: Readonly<Record<AudioBus, "tap" | "confirm" | "back" | "open" | "close">> = {
  master: "confirm",
  music: "open",
  sfx: "tap",
  ui: "confirm",
  voice: "back",
};

/** The dev/test-only debug hooks installed by the app shell (absent in production). */
function goobyTestHooks(): Window["__gooby"]["test"] | undefined {
  if (typeof window === "undefined") return undefined;
  return window.__gooby?.test;
}

function homeZoneLabel(strings: AppStrings, zone: HomeZoneId): string {
  if (zone === "living-room") return strings.places.livingRoom;
  if (zone === "kitchen") return strings.places.kitchen;
  if (zone === "bathroom") return strings.places.bathroom;
  if (zone === "bedroom") return strings.places.bedroom;
  return strings.places.garden;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function avatarMarkup(
  equipped: Readonly<Partial<Record<CosmeticEquipSlot, string>>>,
  previewLabel: string,
): string {
  return `
    <div class="outfit-preview" aria-label="${previewLabel}">
      <div class="preview-halo"></div>
      <div class="preview-gooby">
        <i class="preview-ear left"></i><i class="preview-ear right"></i>
        <i class="preview-face"></i>
        <i class="outfit-layer outfit-head ${equipped.head ?? "none"}"></i>
        <i class="outfit-layer outfit-ears ${equipped.ears ?? "none"}"></i>
        <i class="outfit-layer outfit-neck ${equipped.neck ?? "none"}"></i>
        <i class="outfit-layer outfit-body ${equipped.back ?? "none"}"></i>
        <i class="outfit-layer outfit-face-slot ${equipped.face ?? "none"}"></i>
        <i class="outfit-layer outfit-paws ${equipped.paws ?? "none"}"></i>
      </div>
      <span>${previewLabel}</span>
    </div>
  `;
}

export class GameUI {
  readonly canvas: HTMLCanvasElement;
  readonly fxLayer: HTMLElement;
  private readonly toastElement: HTMLElement;
  private readonly sleepOverlay: HTMLElement;
  private readonly sleepCountdown: HTMLElement;
  private readonly sleepProgress: HTMLElement;
  private inventoryCount: HTMLElement;
  private readonly sheet: HTMLElement;
  private readonly sheetBody: HTMLElement;
  private readonly modal: HTMLElement;
  private readonly modalBody: HTMLElement;
  private readonly onboarding: HTMLElement;
  private readonly onboardingProgress = new OnboardingProgress();
  private readonly model: UiModel;
  private currentPanel: PanelId | null = null;
  private selectedGame: MinigameId | null = null;
  private itemsTab: "food" | "furniture" = "food";
  private wardrobeDraft: Partial<Record<CosmeticEquipSlot, string>> = {};
  private equippedCosmetics: Partial<Record<CosmeticEquipSlot, string>> = {};
  private wardrobePages: Partial<Record<CosmeticEquipSlot, number>> = {};
  private lastInventory: Readonly<Record<string, number>> = {};
  private lastNeeds: Needs | null = null;
  private lastEconomy: Economy = { coins: 0, xp: 0, level: 1 };
  private lastCarrots = 0;
  private lastNow = 0;
  private wasSleeping: boolean | null = null;
  private lastSleepSecond = -1;
  private selectedDecor: string | null = null;
  private panelOpener: HTMLElement | null = null;
  private modalOpener: HTMLElement | null = null;
  /** True until the freshly opened modal has been painted once. */
  private modalClickGuard = false;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly toastQueue: string[] = [];
  private toastActive = false;
  /** True while the visible toast came from the FIFO queue and must not be stomped. */
  private toastSticky = false;
  private lastCanonical: CanonicalSaveState | null = null;
  private languageSetting: LanguageSetting = "auto";
  private uiScale = 1;
  private volumes: Partial<Record<AudioBus, number>> = {};
  private muted = false;
  private devWorkshopUnlocked = false;
  private devView = false;
  private readonly devUnlock = new DevUnlockTracker();
  private stickerBook: StickerBook | null = null;
  private readonly celebrations = new StickerCelebrationQueue();
  private fpsOverlay: HTMLElement | null = null;
  private fpsTimer: ReturnType<typeof setInterval> | null = null;
  private readonly removeLanguageListener: () => void;

  constructor(
    private readonly root: HTMLElement,
    private readonly actions: UiActions,
  ) {
    this.model = new UiModel();
    const strings = this.strings;
    const extra = this.extra;
    root.innerHTML = `
      <main class="game-shell">
        <canvas id="game-canvas" aria-label="${strings.home}" tabindex="0"></canvas>
        <div class="sun-glow" aria-hidden="true"></div>

        <header class="hud">
          <section class="status-card glass" aria-label="${strings.appName}">
            <button class="scene-chip" data-ui-action="living-room">
              <span class="scene-icon">⌂</span>
              <span><small data-app-name>${strings.appName}</small><b data-scene-label>${strings.home}</b></span>
            </button>
            <div class="economy">
              <span class="economy-chip coins" aria-label="Coins"><i>●</i><b data-coins>0</b></span>
              <span class="economy-chip xp" aria-label="XP"><i>✦</i><b data-xp>0</b></span>
              <span class="level-chip"><small data-level-label>${strings.levelShort}</small><b data-level>1</b></span>
            </div>
          </section>
          <div class="xp-track" aria-hidden="true"><i data-xp-progress></i></div>
          <section class="needs-card glass" aria-label="Needs">
            ${NEED_KEYS.map((key) => {
              const need = strings.needs[key];
              return `
                <div class="need need-${need.shape}" data-need="${key}">
                  <span class="need-icon"><i>${need.icon}</i></span>
                  <div class="need-copy">
                    <span><b>${need.label}</b><em data-need-value>0</em></span>
                    <div class="meter" role="meter" aria-label="${need.label}" aria-valuemin="0" aria-valuemax="100"><i></i></div>
                  </div>
                </div>`;
            }).join("")}
          </section>
        </header>

        <div class="interaction-hint glass">♡&nbsp; Tap or stroke Gooby</div>

        <section class="sleep-overlay" hidden aria-live="polite">
          <div class="sleep-stars" aria-hidden="true"><i>✦</i><b>☾</b><i>·</i></div>
          <span class="sleep-eyebrow">${strings.sleep.remaining}</span>
          <strong data-sleep-title>${strings.sleep.title}</strong>
          <span class="sleep-countdown" data-sleep-countdown>30:00</span>
          <div class="sleep-progress" aria-hidden="true"><i data-sleep-progress></i></div>
          <p data-sleep-body>${strings.sleep.body}</p>
          <button class="secondary-button" data-ui-action="wake">${strings.actions.wake}</button>
          <small data-sleep-note>${strings.sleep.earlyWakeNote}</small>
        </section>

        <div class="scene-chrome" hidden data-scene-chrome></div>
        <div class="fx-layer" aria-hidden="true"></div>
        <div class="toast" role="status" aria-live="polite"></div>

        <section class="bottom-ui">
          <div class="quick-actions">
            <button class="action-button feed-button" data-ui-action="feed" data-testid="feed">
              <span class="action-icon">🥕</span>
              <span><b>${strings.actions.feed}</b><small><i data-carrots>0</i> ${extra.carrotsWord}</small></span>
            </button>
            <button class="action-button sleep-button" data-ui-action="sleep" data-testid="sleep">
              <span class="action-icon">☾</span>
              <span><b>${strings.actions.sleep}</b><small>${strings.actions.sleepHint}</small></span>
            </button>
            <button class="action-button bathe-button" data-ui-action="bathe" data-testid="bathe" hidden>
              <span class="action-icon">◌</span>
              <span><b>Bathe</b><small>Scrub with bubbles</small></span>
            </button>
          </div>
          <nav class="tab-bar glass" aria-label="Main" role="tablist">
            ${navItems(strings).map(({ id, label, icon }, index) => `
              <button id="main-tab-${id}" data-panel="${id}" aria-label="${label}" role="tab"
                aria-controls="main-tabpanel" aria-selected="false" tabindex="${index === 0 ? "0" : "-1"}">
                <span>${icon}</span><small>${label}</small>
              </button>`).join("")}
          </nav>
        </section>

        <div class="sheet-backdrop" data-ui-action="close-panel" hidden></div>
        <section class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title" hidden>
          <div class="sheet-handle" aria-hidden="true"></div>
          <div class="sheet-body" data-sheet-body id="main-tabpanel" role="tabpanel"></div>
        </section>

        <div class="modal-backdrop" hidden>
          <section class="modal-card glass" role="dialog" aria-modal="true" aria-labelledby="modal-title" data-modal-body></section>
        </div>

        <section class="onboarding" data-testid="onboarding" role="dialog" aria-modal="true" aria-label="Meet Gooby" hidden>
          <div class="onboarding-intro">
            <div class="welcome-sky" aria-hidden="true"><i>✦</i><i>☁</i><i>·</i></div>
            <div class="onboarding-art" aria-hidden="true">
              <span class="mini-ear one"></span><span class="mini-ear two"></span>
              <div class="mini-gooby"><i></i><b>♥</b></div>
            </div>
            <div class="onboarding-copy">
              <span class="eyebrow">${strings.onboarding.eyebrow}</span>
              <h1>${strings.onboarding.introTitle}</h1>
              <p>${strings.onboarding.introBody}</p>
            </div>
            <button class="primary-button" data-ui-action="onboarding-next">${strings.onboarding.introAction}</button>
          </div>
          <div class="coach-card glass" hidden data-coach-card></div>
        </section>
        <div class="minigame-mount" data-minigame-mount hidden></div>
      </main>
    `;

    this.canvas = root.querySelector<HTMLCanvasElement>("#game-canvas") as HTMLCanvasElement;
    this.fxLayer = root.querySelector<HTMLElement>(".fx-layer") as HTMLElement;
    this.toastElement = root.querySelector<HTMLElement>(".toast") as HTMLElement;
    this.sleepOverlay = root.querySelector<HTMLElement>(".sleep-overlay") as HTMLElement;
    this.sleepCountdown = root.querySelector<HTMLElement>("[data-sleep-countdown]") as HTMLElement;
    this.sleepProgress = root.querySelector<HTMLElement>("[data-sleep-progress]") as HTMLElement;
    this.inventoryCount = root.querySelector<HTMLElement>("[data-carrots]") as HTMLElement;
    this.sheet = root.querySelector<HTMLElement>(".sheet") as HTMLElement;
    this.sheetBody = root.querySelector<HTMLElement>("[data-sheet-body]") as HTMLElement;
    this.modal = root.querySelector<HTMLElement>(".modal-backdrop") as HTMLElement;
    this.modalBody = root.querySelector<HTMLElement>("[data-modal-body]") as HTMLElement;
    this.onboarding = root.querySelector<HTMLElement>(".onboarding") as HTMLElement;
    this.root.addEventListener("click", this.handleClick);
    this.root.addEventListener("change", this.handleChange);
    this.root.addEventListener("input", this.handleInput);
    this.root.addEventListener("keydown", this.handleKeyDown);
    this.removeLanguageListener = onLanguageChanged(() => this.refreshLanguage());
    this.applyPreferences();
  }

  private get strings(): AppStrings {
    return activeCatalog().strings;
  }

  private get extra(): UiExtraCopy {
    return uiExtraCopy(getActiveLanguage());
  }

  syncCanonical(state: CanonicalSaveState, now = this.lastNow): void {
    this.lastNow = now;
    this.lastCanonical = state;
    this.languageSetting = state.settings.language;
    this.uiScale = state.settings.uiScale;
    this.volumes = { ...state.settings.volumes };
    this.muted = state.settings.muted;
    this.devWorkshopUnlocked = state.devWorkshop.unlocked || this.devWorkshopUnlocked;
    this.applyUiScale(this.uiScale);
    this.model.replacePersisted({
      version: 1,
      equipped: state.ui.equipped,
      highScores: state.ui.highScores,
      sleepRationaleSeen: state.ui.sleepRationaleSeen,
      quietHours: state.notificationPolicy.quietHours,
      preferences: {
        audio: !state.settings.muted,
        haptics: state.settings.haptics,
        reducedMotion: state.settings.reducedMotion,
        notifications: state.settings.notifications,
      },
    });
    this.equippedCosmetics = { ...state.ui.equipped };
    if (this.currentPanel !== "wardrobe") this.wardrobeDraft = { ...state.ui.equipped };
    this.applyPreferences();
    this.stickerBook?.update(state);
    this.celebrations.enqueueUnseen(state);
    this.drainCelebrations();
  }

  update(
    needs: Needs,
    economy: Economy,
    inventory: Readonly<Record<string, number>>,
    equipped: Readonly<Partial<Record<CosmeticEquipSlot, string>>> = {},
    now = this.lastNow,
  ): void {
    this.lastNow = now;
    const carrots = inventory.carrot ?? 0;
    const previousNeeds = this.lastNeeds;
    const previousEconomy = this.lastEconomy;
    const levelChanged = this.lastEconomy.level !== economy.level;
    const carrotsChanged = this.lastCarrots !== carrots;
    this.lastNeeds = { ...needs };
    this.lastEconomy = economy;
    this.lastCarrots = carrots;
    this.lastInventory = inventory;
    this.equippedCosmetics = { ...equipped };
    if (this.currentPanel !== "wardrobe") this.wardrobeDraft = { ...equipped };
    for (const key of NEED_KEYS) {
      if (previousNeeds && Math.round(previousNeeds[key]) === Math.round(needs[key])) continue;
      const need = this.root.querySelector<HTMLElement>(`[data-need="${key}"]`);
      const meter = need?.querySelector<HTMLElement>(".meter i");
      const value = need?.querySelector<HTMLElement>("[data-need-value]");
      const rounded = Math.round(needs[key]);
      if (meter) meter.style.width = `${needs[key]}%`;
      if (value) value.textContent = rounded.toString();
      need?.querySelector(".meter")?.setAttribute("aria-valuenow", rounded.toString());
      need?.classList.toggle("is-low", needs[key] < 30);
    }
    if (previousEconomy.coins !== economy.coins) this.setText("[data-coins]", economy.coins.toString());
    if (previousEconomy.xp !== economy.xp) this.setText("[data-xp]", economy.xp.toString());
    if (previousEconomy.level !== economy.level) this.setText("[data-level]", economy.level.toString());
    if (previousEconomy.xp !== economy.xp || previousEconomy.level !== economy.level) {
      const xpProgress = this.root.querySelector<HTMLElement>("[data-xp-progress]");
      if (xpProgress) xpProgress.style.width = `${getLevelProgress(economy) * 100}%`;
    }
    if (carrotsChanged) this.inventoryCount.textContent = carrots.toString();
    if (!this.onboarding.hidden) {
      const previous = this.onboardingProgress.currentStep;
      this.onboardingProgress.observe(needs, carrots);
      if (previous !== this.onboardingProgress.currentStep) this.renderOnboarding();
    }
    if ((this.currentPanel === "play" && levelChanged) || (this.currentPanel === "items" && carrotsChanged)) {
      this.renderPanel();
    }
    if (this.currentPanel === "settings") this.refreshQuietHoursStatus();
  }

  showOnboarding(): void {
    if (this.lastNeeds) this.onboardingProgress.begin(this.lastNeeds, this.lastCarrots);
    this.onboarding.hidden = false;
    this.root.classList.add("is-onboarding");
    this.renderOnboarding();
    this.updateInert();
    requestAnimationFrame(() => this.onboarding.querySelector<HTMLElement>("button")?.focus());
  }

  setSleeping(sleeping: boolean, remainingMs = 0): void {
    const second = Math.max(0, Math.ceil(remainingMs / 1_000));
    if (this.wasSleeping !== sleeping) {
      this.sleepOverlay.hidden = !sleeping;
      this.root.classList.toggle("is-sleeping", sleeping);
      if (sleeping) {
        this.closeModal();
        const wake = this.sleepOverlay.querySelector<HTMLButtonElement>('[data-ui-action="wake"]');
        if (wake) wake.disabled = false;
      }
      if (this.wasSleeping === true && !sleeping) this.showWakeCelebration();
    }
    if (sleeping && this.lastSleepSecond !== second) {
      this.sleepCountdown.textContent = formatCountdown(remainingMs);
      this.sleepProgress.style.width = `${Math.max(0, Math.min(1, 1 - remainingMs / SLEEP_DURATION_MS)) * 100}%`;
      this.lastSleepSecond = second;
    }
    this.wasSleeping = sleeping;
  }

  setSceneChrome(scene: SceneChrome): void {
    const strings = this.strings;
    const chrome = this.root.querySelector<HTMLElement>("[data-scene-chrome]");
    const sceneLabel = this.root.querySelector<HTMLElement>("[data-scene-label]");
    if (!chrome || !sceneLabel) return;
    this.root.dataset.scene = scene.kind;
    chrome.hidden = scene.kind === "home";
    if (scene.kind === "home") {
      sceneLabel.textContent = scene.label ?? strings.home;
      const bath = this.root.querySelector<HTMLButtonElement>("[data-ui-action='bathe']");
      if (bath) bath.hidden = scene.label !== HOME_ZONE_BLUEPRINTS.bathroom.title;
      return;
    }
    const bath = this.root.querySelector<HTMLButtonElement>("[data-ui-action='bathe']");
    if (bath) bath.hidden = true;
    if (scene.kind === "city") {
      const destination = scene.destination
        ? activeCatalog().shops[scene.destination].title
        : strings.chrome.town;
      sceneLabel.textContent = strings.chrome.town;
      chrome.innerHTML = `
        <span><i>⌁</i>${scene.phase === "driving" ? `${strings.chrome.driving} ${destination}` : destination}</span>
      `;
      return;
    }
    sceneLabel.textContent = strings.chrome.minigame;
    chrome.innerHTML = `
      <span><i>◆</i>${scene.title}</span>
      <button data-ui-action="pause">${strings.chrome.pause}</button>
    `;
  }

  showResults(
    gameId: MinigameId,
    payout: MinigamePayout,
    result: { readonly isNewBest: boolean; readonly best: number },
  ): void {
    const strings = this.strings;
    const game = activeCatalog().minigames[gameId];
    this.openModal(`
      <div class="result-burst" aria-hidden="true">✦</div>
      <span class="modal-eyebrow">${strings.results.eyebrow}</span>
      <h2>${result.isNewBest ? strings.newBest : strings.results.title}</h2>
      <p>${game.title}</p>
      <div class="payout-grid">
        <span><i>◆</i><b>${payout.score.toLocaleString()}</b><small>${strings.results.score}</small></span>
        <span><i>●</i><b>+${payout.coins}</b><small>${strings.results.coins}</small></span>
        <span><i>✦</i><b>+${payout.xp}</b><small>${strings.results.xp}</small></span>
      </div>
      <div class="modal-actions">
        <button class="secondary-button" data-ui-action="results-done">${strings.results.done}</button>
        <button class="primary-button compact" data-ui-action="results-again" data-game="${gameId}">${strings.results.again}</button>
      </div>
    `);
  }

  get minigameMount(): HTMLElement {
    return this.root.querySelector<HTMLElement>("[data-minigame-mount]") as HTMLElement;
  }

  get equipped(): Readonly<Partial<Record<CosmeticEquipSlot, string>>> {
    return this.model.persisted.equipped;
  }

  get preferences(): Readonly<ReturnType<typeof this.preferenceSnapshot>> {
    return this.preferenceSnapshot();
  }

  setMinigameVisible(visible: boolean): void {
    this.minigameMount.hidden = !visible;
    if (!visible) this.minigameMount.replaceChildren();
  }

  closeTransientUi(): void {
    this.closePanel();
    this.closeModal();
  }

  /**
   * Action feedback: the newest message replaces the visible plain toast right
   * away. Queued celebration toasts are never stomped; feedback that arrives
   * while one is on screen lines up behind it.
   */
  toast(message: string): void {
    if (this.toastActive && this.toastSticky) {
      if (this.toastQueue.at(-1) !== message) this.toastQueue.push(message);
      return;
    }
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastActive = true;
    this.toastSticky = false;
    this.showToastNow(message);
  }

  /** FIFO celebration toasts: every message is shown fully, in order. */
  queueToast(message: string): void {
    this.toastQueue.push(message);
    this.pumpToasts();
  }

  dispose(): void {
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.stopFpsOverlay();
    this.disposeStickerBook();
    this.removeLanguageListener();
    this.root.removeEventListener("click", this.handleClick);
    this.root.removeEventListener("change", this.handleChange);
    this.root.removeEventListener("input", this.handleInput);
    this.root.removeEventListener("keydown", this.handleKeyDown);
    this.root.replaceChildren();
  }

  private pumpToasts(): void {
    if (this.toastActive) return;
    const message = this.toastQueue.shift();
    if (message === undefined) return;
    this.toastActive = true;
    this.toastSticky = true;
    this.showToastNow(message);
  }

  private showToastNow(message: string): void {
    this.toastElement.textContent = message;
    this.toastElement.classList.remove("show");
    requestAnimationFrame(() => this.toastElement.classList.add("show"));
    this.toastTimer = setTimeout(() => {
      this.toastElement.classList.remove("show");
      this.toastTimer = setTimeout(() => {
        this.toastActive = false;
        this.toastSticky = false;
        this.pumpToasts();
      }, TOAST_GAP_MS);
    }, TOAST_VISIBLE_MS);
  }

  private drainCelebrations(): void {
    const state = this.lastCanonical;
    if (!state) return;
    const catalog = activeCatalog();
    for (let next = this.celebrations.next(); next; next = this.celebrations.next()) {
      if (next.kind === "sticker") {
        this.queueToast(this.extra.stickerUnlocked(catalog.stickers[next.stickerId].title));
        this.actions.markStickerSeen?.(next.stickerId);
      } else {
        this.queueToast(this.extra.pageReward(catalog.stickerPages[next.page], next.coins));
      }
      this.celebrations.dismiss(state, this.lastNow);
    }
  }

  /** Publishes the persisted scale so rem-based sizing tracks it everywhere. */
  private applyUiScale(scale: number): void {
    const value = String(clampUiScaleInput(scale));
    document.documentElement.style.setProperty("--gooby-ui-scale", value);
    this.root.style.setProperty("--gooby-ui-scale", value);
  }

  private persistUiScale(scale: number): void {
    const clamped = clampUiScaleInput(scale);
    this.uiScale = clamped;
    this.applyUiScale(clamped);
    if (this.actions.setUiScale) this.actions.setUiScale(clamped);
    else goobyTestHooks()?.setUiScale(clamped);
  }

  private persistBusVolume(bus: AudioBus, volume: number): void {
    this.volumes = { ...this.volumes, [bus]: volume };
    if (this.actions.setBusVolume) this.actions.setBusVolume(bus, volume);
    else goobyTestHooks()?.setVolume(bus, volume);
    // Sample cue so the new level is audible right away.
    this.actions.feedback("confirm");
  }

  private setLanguage(setting: LanguageSetting): void {
    this.languageSetting = setting;
    if (this.actions.setLanguage) this.actions.setLanguage(setting);
    else goobyTestHooks()?.setLanguage(setting);
    const locales = typeof navigator === "undefined" ? [] : navigator.languages ?? [];
    applyLanguageSetting(setting, locales);
  }

  private unlockDevWorkshop(): void {
    if (!this.devWorkshopUnlocked) {
      this.devWorkshopUnlocked = true;
      if (this.actions.setDevWorkshopUnlocked) this.actions.setDevWorkshopUnlocked(true);
      else goobyTestHooks()?.setDevWorkshopUnlocked(true);
    }
    this.queueToast(this.extra.devUnlocked);
  }

  private readonly handleClick = (event: MouseEvent): void => {
    const button = (event.target as Element).closest<HTMLButtonElement>("button");
    if (!button) return;
    if (this.modalClickGuard && button.closest("[data-modal-body]")) return;
    this.actions.feedback("tap");
    const panel = button.dataset.panel as PanelId | undefined;
    if (panel) {
      this.openPanel(panel);
      return;
    }

    const action = button.dataset.uiAction;
    if (!action) return;
    if (action === "close-panel") {
      this.closePanel();
    } else if (action === "feed") {
      this.actions.feed();
    } else if (action === "consume-food") {
      this.actions.consumeFood(button.dataset.item ?? "");
    } else if (action === "onboarding-pet") {
      this.actions.pet();
    } else if (action === "onboarding-feed") {
      this.actions.feed();
    } else if (action === "bathe") {
      this.actions.bathe();
    } else if (action === "sleep") {
      this.requestSleep();
    } else if (action === "wake") {
      // A second tap on a stale wake button must never fire another wake.
      if (button.disabled) return;
      button.disabled = true;
      this.actions.wake();
    } else if (action === "onboarding-next") {
      this.onboardingProgress.leaveIntro();
      this.renderOnboarding();
    } else if (action === "onboarding-complete") {
      if (this.onboardingProgress.complete()) {
        this.onboarding.hidden = true;
        this.root.classList.remove("is-onboarding");
        this.updateInert();
        this.actions.onboardingComplete();
      }
    } else if (action === "living-room") {
      const decision = this.model.requestLivingRoom(this.strings.places.returnBlocked);
      if (!decision.allowed && decision.message) this.toast(decision.message);
      else this.actions.navigateHome("living-room");
    } else if (action === "home-zone") {
      const decision = this.model.requestLivingRoom(this.strings.places.returnBlocked);
      if (!decision.allowed && decision.message) this.toast(decision.message);
      else {
        this.closePanel();
        this.actions.navigateHome(button.dataset.zone as HomeZoneId);
      }
    } else if (action === "city-board") {
      this.closePanel();
      this.actions.openCity();
    } else if (action === "select-game") {
      this.selectedGame = (button.dataset.game || null) as MinigameId | null;
      this.renderPanel();
    } else if (action === "start-game" || action === "results-again") {
      const game = button.dataset.game as MinigameId;
      this.selectedGame = game;
      this.closeModal();
      this.closePanel();
      this.actions.startMinigame(game);
    } else if (action === "results-done" || action === "close-modal") {
      this.closeModal();
      if (action === "results-done") this.actions.exitMinigame();
    } else if (action === "wardrobe-preview") {
      const slot = button.dataset.slot as CosmeticEquipSlot;
      const item = button.dataset.item;
      if (item) this.wardrobeDraft[slot] = item;
      else delete this.wardrobeDraft[slot];
      this.renderPanel();
    } else if (action === "wardrobe-page") {
      const slot = button.dataset.slot as CosmeticEquipSlot;
      const delta = button.dataset.direction === "prev" ? -1 : 1;
      this.wardrobePages[slot] = Math.max(0, (this.wardrobePages[slot] ?? 0) + delta);
      this.renderPanel();
      this.sheet.querySelector<HTMLElement>(
        `[data-ui-action="wardrobe-page"][data-slot="${slot}"][data-direction="${button.dataset.direction}"]`,
      )?.focus();
    } else if (action === "wardrobe-equip") {
      const slot = button.dataset.slot as CosmeticEquipSlot;
      const itemId = this.wardrobeDraft[slot] ?? null;
      if (!this.actions.equipCosmetic(slot as CosmeticSlot, itemId)) {
        this.actions.feedback("denied");
        this.wardrobeDraft = { ...this.equippedCosmetics };
        this.renderPanel();
        return;
      }
      this.equippedCosmetics = { ...this.model.persisted.equipped };
      this.renderPanel();
      this.toast(this.strings.toasts.outfitSaved);
    } else if (action === "items-tab") {
      this.itemsTab = button.dataset.tab === "furniture" ? "furniture" : "food";
      this.renderPanel();
      this.sheet.querySelector<HTMLElement>(`[data-tab="${this.itemsTab}"]`)?.focus();
    } else if (action === "place-item") {
      const item = button.dataset.item ?? "";
      if (this.actions.placeFurniture(item)) {
        this.selectedDecor = item;
        this.renderPanel();
      } else {
        this.actions.feedback("denied");
      }
    } else if (action === "move-decor") {
      if (!this.actions.moveDecor(button.dataset.direction as "left" | "right" | "forward" | "back")) {
        this.actions.feedback("denied");
      }
    } else if (action === "rotate-decor") {
      if (!this.actions.rotateDecor()) this.actions.feedback("denied");
    } else if (action === "remove-decor") {
      if (this.actions.removeDecor()) {
        this.selectedDecor = null;
        this.renderPanel();
      } else {
        this.actions.feedback("denied");
      }
    } else if (action === "toggle-setting") {
      const key = button.dataset.preference as PreferenceKey;
      const enabled = !this.model.persisted.preferences[key];
      this.actions.preferenceChanged(key, enabled);
      this.applyPreferences();
      this.renderPanel();
      this.toast(this.strings.toasts.settingSaved);
    } else if (action === "scale-preset") {
      this.persistUiScale(Number(button.dataset.scale));
      this.actions.feedback("confirm");
      this.renderPanel();
    } else if (action === "set-language") {
      const setting = button.dataset.language as LanguageSetting;
      if (setting === "auto" && this.devUnlock.tap(this.lastNow)) this.unlockDevWorkshop();
      this.setLanguage(setting);
      this.renderPanel();
    } else if (action === "open-dev-workshop") {
      this.devView = true;
      this.renderPanel();
      requestAnimationFrame(() => this.sheet.querySelector<HTMLElement>("button")?.focus());
    } else if (action === "dev-back") {
      this.devView = false;
      this.renderPanel();
    } else if (action === "dev-scene") {
      const zone = button.dataset.zone as HomeZoneId | undefined;
      this.closePanel();
      if (zone) this.actions.navigateHome(zone);
      else this.actions.openCity();
    } else if (action === "dev-audio") {
      const bus = button.dataset.bus as AudioBus;
      this.actions.feedback(DEV_AUDIO_CUES[bus] ?? "confirm");
    } else if (action === "dev-fps") {
      this.toggleFpsOverlay();
      this.renderPanel();
    } else if (action === "dev-grant-xp") {
      // Compile-time gate: mutation cheats are stripped from production bundles.
      if (import.meta.env.DEV || import.meta.env.MODE === "test") goobyTestHooks()?.grantProgressionXp(200);
    } else if (action === "dev-advance-time") {
      if (import.meta.env.DEV || import.meta.env.MODE === "test") goobyTestHooks()?.advanceTime(60 * 60 * 1_000);
    } else if (action === "toggle-quiet-hours") {
      const quietHours = this.model.persisted.quietHours
        ? null
        : { ...DEFAULT_UI_QUIET_HOURS };
      this.actions.quietHoursChanged(quietHours);
      this.renderPanel();
      this.toast("Quiet hours saved");
    } else if (action === "sleep-confirm") {
      this.closeModal();
      this.actions.confirmSleep();
    } else if (action === "wake-celebration") {
      this.closeModal();
    } else if (action === "pause") {
      this.actions.pauseMinigame();
      this.openModal(`
        <h2 id="modal-title">Adventure paused</h2>
        <p>Your run is safe until you continue. Leaving never grants a reward.</p>
        <div class="modal-actions stacked">
          <button class="primary-button compact" data-ui-action="resume-game">Continue</button>
          <button class="text-button" data-ui-action="exit-game">Leave without reward</button>
        </div>
      `);
    } else if (action === "resume-game") {
      this.closeModal();
      this.actions.resumeMinigame();
    } else if (action === "exit-game") {
      this.closeModal();
      this.actions.exitMinigame();
    } else if (action === "clear-data") {
      this.openModal(`
        <h2 id="modal-title">${this.strings.settings.clearDataTitle}</h2>
        <p>${this.strings.settings.clearDataBody}</p>
        <div class="modal-actions stacked">
          <button class="danger-button" data-ui-action="clear-data-confirm">${this.strings.settings.clearDataConfirm}</button>
          <button class="text-button" data-ui-action="close-modal">${this.strings.sleep.rationaleLater}</button>
        </div>
      `);
    } else if (action === "clear-data-confirm") {
      this.actions.clearLocalData();
    }
  };

  private readonly handleChange = (event: Event): void => {
    const target = event.target as Element;
    const volumeInput = target.closest<HTMLInputElement>("input[data-volume-bus]");
    if (volumeInput) {
      const bus = volumeInput.dataset.volumeBus as AudioBus;
      if ((AUDIO_BUSES as readonly string[]).includes(bus)) {
        this.persistBusVolume(bus, percentToVolume(Number(volumeInput.value)));
        this.refreshVolumeOutput(bus, Number(volumeInput.value));
      }
      return;
    }
    const scaleInput = target.closest<HTMLInputElement>("input[data-ui-scale]");
    if (scaleInput) {
      this.persistUiScale(Number(scaleInput.value));
      this.actions.feedback("confirm");
      this.refreshScaleControls();
      return;
    }
    const select = target.closest<HTMLSelectElement>("select[data-quiet-hour]");
    if (!select) return;
    const hour = parseQuietHourValue(select.value);
    if (hour === null) {
      this.actions.feedback("denied");
      this.renderPanel();
      return;
    }
    const current = this.model.persisted.quietHours ?? DEFAULT_UI_QUIET_HOURS;
    const next: QuietHours = select.dataset.quietHour === "start"
      ? { ...current, startHour: hour }
      : { ...current, endHour: hour };
    this.actions.quietHoursChanged(next);
    this.renderPanel();
    this.toast("Quiet hours saved");
  };

  /** Live (pre-commit) feedback while range sliders are being dragged. */
  private readonly handleInput = (event: Event): void => {
    const target = event.target as Element;
    const volumeInput = target.closest<HTMLInputElement>("input[data-volume-bus]");
    if (volumeInput) {
      const bus = volumeInput.dataset.volumeBus as AudioBus;
      this.refreshVolumeOutput(bus, Number(volumeInput.value));
      return;
    }
    const scaleInput = target.closest<HTMLInputElement>("input[data-ui-scale]");
    if (scaleInput) {
      this.applyUiScale(Number(scaleInput.value));
      this.refreshScaleControls(Number(scaleInput.value));
    }
  };

  private refreshVolumeOutput(bus: AudioBus, percent: number): void {
    const output = this.sheetBody.querySelector<HTMLElement>(`[data-volume-value="${bus}"]`);
    if (output) output.textContent = `${Math.round(percent)}%`;
  }

  private refreshScaleControls(scale = this.uiScale): void {
    const clamped = clampUiScaleInput(scale);
    const output = this.sheetBody.querySelector<HTMLElement>("[data-ui-scale-value]");
    if (output) output.textContent = formatUiScale(clamped);
    for (const preset of this.sheetBody.querySelectorAll<HTMLButtonElement>('[data-ui-action="scale-preset"]')) {
      const active = Math.abs(Number(preset.dataset.scale) - clamped) < 0.005;
      preset.classList.toggle("active", active);
      preset.setAttribute("aria-pressed", String(active));
    }
  }

  private openPanel(panel: PanelId): void {
    if (!this.currentPanel) {
      this.panelOpener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }
    if (this.currentPanel !== panel) this.devView = false;
    this.currentPanel = panel;
    this.sheet.hidden = false;
    const backdrop = this.root.querySelector<HTMLElement>(".sheet-backdrop");
    if (backdrop) backdrop.hidden = false;
    this.root.classList.add("has-sheet");
    for (const navButton of this.root.querySelectorAll<HTMLElement>("[data-panel]")) {
      const selected = navButton.dataset.panel === panel;
      navButton.classList.toggle("active", selected);
      navButton.setAttribute("aria-selected", selected.toString());
      navButton.tabIndex = selected ? 0 : -1;
    }
    const tab = this.root.querySelector<HTMLElement>(`[data-panel="${panel}"]`);
    if (tab) this.sheetBody.setAttribute("aria-labelledby", tab.id);
    this.renderPanel();
    this.updateInert();
    requestAnimationFrame(() => this.sheet.querySelector<HTMLElement>("button")?.focus());
  }

  private closePanel(): void {
    const opener = this.panelOpener;
    this.currentPanel = null;
    this.devView = false;
    this.disposeStickerBook();
    this.sheet.hidden = true;
    const backdrop = this.root.querySelector<HTMLElement>(".sheet-backdrop");
    if (backdrop) backdrop.hidden = true;
    this.root.classList.remove("has-sheet");
    for (const navButton of this.root.querySelectorAll<HTMLElement>("[data-panel]")) {
      navButton.classList.remove("active");
      navButton.setAttribute("aria-selected", "false");
    }
    this.panelOpener = null;
    this.updateInert();
    requestAnimationFrame(() => opener?.isConnected && opener.focus());
  }

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Escape") {
      if (!this.modal.hidden) {
        event.preventDefault();
        const resumesPausedGame = this.modalBody.querySelector(
          '[data-ui-action="resume-game"]',
        ) !== null;
        this.closeModal();
        if (resumesPausedGame) this.actions.resumeMinigame();
      } else if (!this.sheet.hidden) {
        event.preventDefault();
        if (this.devView) {
          this.devView = false;
          this.renderPanel();
        } else {
          this.closePanel();
        }
      }
      return;
    }

    const target = event.target as HTMLElement;
    if (
      (event.key === "Enter" || event.key === " ")
      && target === this.canvas
      && this.onboardingProgress.currentStep === "pet"
    ) {
      event.preventDefault();
      this.actions.pet();
      return;
    }

    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      const tabs = target.closest(".tab-bar")
        ? [...this.root.querySelectorAll<HTMLButtonElement>(".tab-bar [role='tab']")]
        : target.closest(".segmented-control")
          ? [...this.root.querySelectorAll<HTMLButtonElement>(".segmented-control [role='tab']")]
          : [];
      const current = tabs.indexOf(target as HTMLButtonElement);
      if (current >= 0 && tabs.length > 0) {
        event.preventDefault();
        const offset = event.key === "ArrowRight" ? 1 : -1;
        const next = tabs[(current + offset + tabs.length) % tabs.length];
        next?.focus();
        next?.click();
        return;
      }
    }

    if (event.key !== "Tab") return;
    const layer = !this.modal.hidden
      ? this.modalBody
      : !this.sheet.hidden
        ? this.sheet
        : !this.onboarding.hidden && this.onboardingProgress.currentStep === "intro"
          ? this.onboarding
          : null;
    if (!layer) return;
    const focusable = [...layer.querySelectorAll<HTMLElement>(
      'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
    )].filter((element) => element.getClientRects().length > 0);
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  private updateInert(): void {
    const shell = this.root.querySelector<HTMLElement>(".game-shell");
    if (!shell) return;
    const active = !this.modal.hidden
      ? this.modal
      : !this.sheet.hidden
        ? this.sheet
        : !this.onboarding.hidden && this.onboardingProgress.currentStep === "intro"
          ? this.onboarding
          : null;
    for (const child of shell.children) {
      if (!(child instanceof HTMLElement)) continue;
      child.inert = active !== null && child !== active;
    }
    if (!this.modal.hidden) this.sheet.inert = true;
  }

  private panelHeader(title: string, subtitle: string): string {
    const strings = this.strings;
    return `
      <header class="sheet-header">
        <div>
          <span class="sheet-eyebrow">${strings.appName}</span>
          <h2 id="sheet-title">${title}</h2>
          <p>${subtitle}</p>
        </div>
        <button class="icon-button" data-ui-action="close-panel" aria-label="${strings.close}">×</button>
      </header>
    `;
  }

  private renderPanel(): void {
    if (!this.currentPanel) return;
    if (this.currentPanel !== "stickers") this.disposeStickerBook();
    if (this.currentPanel === "places") this.renderPlaces();
    else if (this.currentPanel === "play") this.renderPlay();
    else if (this.currentPanel === "wardrobe") this.renderWardrobe();
    else if (this.currentPanel === "items") this.renderItems();
    else if (this.currentPanel === "stickers") this.renderStickers();
    else if (this.devView) this.renderDevWorkshop();
    else this.renderSettings();
  }

  private renderPlaces(): void {
    const strings = this.strings;
    this.sheetBody.innerHTML = `
      ${this.panelHeader(strings.places.title, strings.places.subtitle)}
      <div class="sheet-content">
        <section class="panel-section">
          <h3>${strings.places.homeGroup}</h3>
          <div class="destination-list" aria-label="${strings.places.homeGroup}">
            ${HOME_ZONE_IDS.map((zone) => {
              const home = HOME_ZONE_BLUEPRINTS[zone];
              return `
                <button class="destination-card" data-ui-action="home-zone" data-zone="${zone}" data-testid="home-zone-${zone}">
                  <span class="destination-icon">${HOME_ZONE_ICONS[zone]}</span>
                  <span><b>${homeZoneLabel(strings, zone)}</b><small>${zone === "living-room" ? strings.places.livingRoomHint : home.subtitle}</small></span><i>›</i>
                </button>`;
            }).join("")}
          </div>
        </section>
        <section class="panel-section city-board">
          <div class="section-heading">
            <div><h3>${strings.places.cityGroup}</h3><p>${strings.places.boardBody}</p></div>
            <span class="tiny-car" aria-hidden="true">◒</span>
          </div>
          <button class="place-card home-card" data-ui-action="city-board" data-testid="open-city-board">
            <span class="place-icon home">◒</span>
            <span><b>${strings.places.boardTitle}</b><small>${strings.actions.chooseDestination}</small></span><i>›</i>
          </button>
          <p class="route-note"><i>⌁</i>${strings.places.travelNote}</p>
        </section>
      </div>
    `;
  }

  private renderPlay(): void {
    const strings = this.strings;
    const extra = this.extra;
    const minigames = activeCatalog().minigames;
    if (this.selectedGame) {
      const game = MINIGAME_CARDS.find((entry) => entry.id === this.selectedGame);
      if (game) {
        const copy = minigames[game.id];
        const unlocked = this.lastEconomy.level >= game.unlockLevel;
        const best = this.model.persisted.highScores[game.id] ?? 0;
        this.sheetBody.innerHTML = `
          ${this.panelHeader(strings.play.title, strings.play.subtitle)}
          <div class="sheet-content game-detail">
            <button class="text-button" data-ui-action="select-game" data-game="">‹ ${strings.back}</button>
            <div class="game-hero game-${game.id}">
              <span>${game.icon}</span><i>✦</i><i>·</i>
            </div>
            <span class="game-level">${unlocked ? `${strings.levelShort} ${game.unlockLevel}` : strings.locked}</span>
            <h3>${copy.title}</h3>
            <p>${copy.instructions}</p>
            <div class="game-best"><span>◆</span><b>${best ? strings.play.best(best) : strings.play.noScore}</b></div>
            <small class="reward-note">${strings.play.rewardPreview}</small>
            <button class="primary-button" data-ui-action="start-game" data-game="${game.id}" ${unlocked ? "" : "disabled"}>
              ${unlocked ? strings.actions.play : strings.play.unlockAt(game.unlockLevel)}
            </button>
          </div>
        `;
        return;
      }
      this.selectedGame = null;
    }
    this.sheetBody.innerHTML = `
      ${this.panelHeader(strings.play.title, strings.play.subtitle)}
      <div class="sheet-content">
        ${GAME_CATEGORY_IDS.map((category) => `
          <section class="panel-section game-category">
            <h3>${extra.categories[category]}</h3>
            <div class="game-grid">
              ${gamesInCategory(category).map((game) => {
                const copy = minigames[game.id];
                const unlocked = this.lastEconomy.level >= game.unlockLevel;
                const best = this.model.persisted.highScores[game.id] ?? 0;
                return `
                  <button class="game-card ${unlocked ? "" : "locked"}" data-ui-action="select-game" data-game="${game.id}">
                    <span class="game-card-icon">${game.icon}</span>
                    <span class="game-card-copy"><b>${copy.title}</b><small>${unlocked ? (best ? strings.play.best(best) : strings.play.noScore) : strings.play.unlockAt(game.unlockLevel)}</small></span>
                    <i>${unlocked ? "›" : "⌑"}</i>
                  </button>
                `;
              }).join("")}
            </div>
          </section>
        `).join("")}
      </div>
    `;
  }

  private renderWardrobe(): void {
    const strings = this.strings;
    const extra = this.extra;
    this.sheetBody.innerHTML = `
      ${this.panelHeader(strings.wardrobe.title, strings.wardrobe.subtitle)}
      <div class="sheet-content wardrobe-content">
        ${avatarMarkup(this.wardrobeDraft, strings.wardrobe.preview)}
        <h3>${strings.wardrobe.slots}</h3>
        ${COSMETIC_EQUIP_SLOTS.map((slot) => {
          const ownedCount = (itemId: string): number => this.lastInventory[itemId] ?? 0;
          const items = [...COSMETIC_CATALOG.filter((item) => item.slot === slot)]
            .sort((a, b) => Number(ownedCount(b.id) > 0) - Number(ownedCount(a.id) > 0));
          const slice = paginate(items, this.wardrobePages[slot] ?? 0, WARDROBE_PAGE_SIZE);
          this.wardrobePages[slot] = slice.page;
          const equipped = this.equippedCosmetics[slot];
          const selected = this.wardrobeDraft[slot];
          return `
            <section class="wardrobe-slot" data-wardrobe-slot="${slot}">
              <div class="slot-title"><span>${SLOT_ICONS[slot]}</span><b>${extra.wardrobeSlots[slot]}</b></div>
              <div class="wardrobe-options">
                <button class="${selected === undefined ? "selected" : ""}" data-ui-action="wardrobe-preview" data-slot="${slot}">
                  <i>·</i><small>${strings.wardrobe.none}</small>${selected === undefined ? '<span class="selection-mark">✓</span>' : ""}
                </button>
                ${slice.items.map((item) => {
                  const name = escapeHtml(getCatalogItemCopy(item).name);
                  if (ownedCount(item.id) <= 0) {
                    return `
                      <button class="is-locked" disabled data-locked-item="${item.id}" aria-label="${name}, ${extra.lockedItem}">
                        <i>⌑</i><small>${name}</small>
                      </button>
                    `;
                  }
                  return `
                    <button class="${selected === item.id ? "selected" : ""}" data-ui-action="wardrobe-preview" data-slot="${slot}" data-item="${item.id}">
                      <i>${SLOT_ICONS[slot]}</i><small>${name}</small>${selected === item.id ? '<span class="selection-mark">✓</span>' : ""}
                    </button>
                  `;
                }).join("")}
              </div>
              ${slice.pages > 1 ? `
                <div class="wardrobe-pager">
                  <button data-ui-action="wardrobe-page" data-slot="${slot}" data-direction="prev"
                    aria-label="${extra.previousPage}" ${slice.page === 0 ? "disabled" : ""}>‹</button>
                  <span aria-live="polite">${extra.page(slice.page + 1, slice.pages)}</span>
                  <button data-ui-action="wardrobe-page" data-slot="${slot}" data-direction="next"
                    aria-label="${extra.nextPage}" ${slice.page >= slice.pages - 1 ? "disabled" : ""}>›</button>
                </div>
              ` : ""}
              <button class="equip-button" data-ui-action="wardrobe-equip" data-slot="${slot}" ${selected === equipped ? "disabled" : ""}>
                ${selected === equipped ? `✓ ${strings.actions.equipped}` : strings.actions.equip}
              </button>
            </section>
          `;
        }).join("")}
      </div>
    `;
  }

  private renderItems(): void {
    const strings = this.strings;
    this.sheetBody.innerHTML = `
      ${this.panelHeader(strings.items.title, strings.items.subtitle)}
      <div class="segmented-control" role="tablist" aria-label="${strings.items.title}">
        <button id="items-tab-food" class="${this.itemsTab === "food" ? "active" : ""}" data-ui-action="items-tab" data-tab="food"
          role="tab" aria-controls="items-tabpanel" aria-selected="${this.itemsTab === "food"}" tabindex="${this.itemsTab === "food" ? "0" : "-1"}">${strings.items.food}</button>
        <button id="items-tab-furniture" class="${this.itemsTab === "furniture" ? "active" : ""}" data-ui-action="items-tab" data-tab="furniture"
          role="tab" aria-controls="items-tabpanel" aria-selected="${this.itemsTab === "furniture"}" tabindex="${this.itemsTab === "furniture" ? "0" : "-1"}">${strings.items.furniture}</button>
      </div>
      <div class="sheet-content" id="items-tabpanel" role="tabpanel" aria-labelledby="items-tab-${this.itemsTab}">
        ${this.itemsTab === "food" ? `
          <div class="inventory-list">
            <article class="inventory-card">
              <span class="inventory-art carrot-art">🥕</span>
              <div><b>${strings.items.carrot}</b><p>${strings.items.carrotBody}</p><small>${strings.items.owned(this.lastCarrots)}</small></div>
              <button class="mini-action" data-ui-action="feed" ${this.lastCarrots <= 0 ? "disabled" : ""}>${strings.actions.feed}</button>
            </article>
            ${FOOD_CATALOG.map((item) => {
              const copy = getCatalogItemCopy(item);
              const count = this.lastInventory[item.id] ?? 0;
              return `
                <article class="inventory-card" data-catalog-food="${item.id}">
                  <span class="inventory-art food-art">◇</span>
                  <div><b>${escapeHtml(copy.name)}</b><p>${escapeHtml(copy.description)}</p><small>${strings.items.owned(count)} · +${item.hunger} ${strings.needs.hunger.label}</small></div>
                  <button class="mini-action" data-ui-action="consume-food" data-item="${item.id}" ${count <= 0 ? "disabled" : ""}>${strings.actions.feed}</button>
                </article>`;
            }).join("")}
          </div>
        ` : `
          <div class="inventory-list">
            ${FURNITURE_CATALOG.map((item) => {
              const copy = getCatalogItemCopy(item);
              const count = this.lastInventory[item.id] ?? 0;
              return `
                <article class="inventory-card ${this.selectedDecor === item.id ? "is-selected" : ""} ${count <= 0 ? "is-unowned" : ""}" data-catalog-decor="${item.id}">
                  <span class="inventory-art furniture-art">▱</span>
                  <div><b>${escapeHtml(copy.name)}</b><small>${strings.items.owned(count)}</small></div>
                  <button class="mini-action" data-ui-action="place-item" data-item="${item.id}" ${count <= 0 ? "disabled" : ""}>${strings.actions.place}</button>
                </article>
              `;
            }).join("")}
            ${this.selectedDecor ? `
              <section class="decor-controls" aria-label="${strings.items.decorControls}">
                <b>${strings.items.decorControls}</b>
                <div class="decor-move-grid">
                  <button data-ui-action="move-decor" data-direction="forward" aria-label="${strings.items.moveForward}">↑</button>
                  <button data-ui-action="move-decor" data-direction="left" aria-label="${strings.items.moveLeft}">←</button>
                  <button data-ui-action="move-decor" data-direction="back" aria-label="${strings.items.moveBack}">↓</button>
                  <button data-ui-action="move-decor" data-direction="right" aria-label="${strings.items.moveRight}">→</button>
                </div>
                <button class="secondary-button" data-ui-action="rotate-decor">${strings.items.rotate}</button>
                <button class="danger-button" data-ui-action="remove-decor">${strings.items.remove}</button>
              </section>
            ` : ""}
          </div>
        `}
      </div>
    `;
  }

  private renderStickers(): void {
    const strings = this.strings;
    this.disposeStickerBook();
    this.sheetBody.innerHTML = `
      ${this.panelHeader(strings.stickers.title, strings.stickers.subtitle)}
      <div class="sheet-content stickers-content">
        <div data-sticker-book-host></div>
        <p class="route-note"><i>✦</i>${strings.stickers.lockedHint}</p>
      </div>
    `;
    const host = this.sheetBody.querySelector<HTMLElement>("[data-sticker-book-host]");
    const state = this.lastCanonical;
    if (!host || !state) return;
    this.stickerBook = createStickerBook({
      host,
      state,
      onStickerSeen: (id) => {
        this.actions.markStickerSeen?.(id);
      },
    });
  }

  private disposeStickerBook(): void {
    this.stickerBook?.dispose();
    this.stickerBook = null;
  }

  private renderSettings(): void {
    const strings = this.strings;
    const extra = this.extra;
    const preferences = this.model.persisted.preferences;
    const quietHours = quietHoursPresentation(
      this.model.persisted.quietHours ?? null,
      this.lastNow,
    );
    const rows: readonly [PreferenceKey, string, string, string][] = [
      ["audio", "♪", strings.settings.audio, strings.settings.audioBody],
      ["haptics", "⌁", strings.settings.haptics, strings.settings.hapticsBody],
      ["reducedMotion", "◐", strings.settings.motion, strings.settings.motionBody],
      ["notifications", "♢", strings.settings.notifications, strings.settings.notificationsBody],
    ];
    const volumeRows: readonly [AudioBus, string][] = [
      ["master", strings.settings.volumeMaster],
      ["music", strings.settings.volumeMusic],
      ["sfx", strings.settings.volumeSfx],
      ["ui", strings.settings.volumeUi],
      ["voice", strings.settings.volumeVoice],
    ];
    const languageRows: readonly [LanguageSetting, string][] = [
      ["auto", strings.settings.languageAuto],
      ["en", strings.settings.languageEnglish],
      ["de", strings.settings.languageGerman],
    ];
    this.sheetBody.innerHTML = `
      ${this.panelHeader(strings.settings.title, strings.settings.subtitle)}
      <div class="sheet-content settings-content">
        <div class="settings-list">
          ${rows.map(([key, icon, label, body]) => `
            <button class="setting-row" data-ui-action="toggle-setting" data-preference="${key}" role="switch" aria-checked="${preferences[key]}">
              <span class="setting-icon">${icon}</span>
              <span><b>${label}</b><small>${body}</small></span>
              <i class="toggle ${preferences[key] ? "on" : ""}"><em></em></i>
            </button>
          `).join("")}
        </div>
        <section class="settings-group" aria-labelledby="ui-scale-heading">
          <div class="group-heading">
            <span class="setting-icon">◲</span>
            <span><b id="ui-scale-heading">${strings.settings.uiScale}</b><small>${strings.settings.uiScaleBody}</small></span>
            <output class="group-value" data-ui-scale-value>${formatUiScale(this.uiScale)}</output>
          </div>
          <div class="scale-presets" role="group" aria-label="${strings.settings.uiScale}">
            ${UI_SCALE_PRESETS.map((preset) => {
              const active = Math.abs(preset - this.uiScale) < 0.005;
              return `<button class="scale-chip ${active ? "active" : ""}" data-ui-action="scale-preset" data-scale="${preset}" aria-pressed="${active}">${formatUiScale(preset)}</button>`;
            }).join("")}
          </div>
          <input class="settings-slider" type="range" data-ui-scale min="0.85" max="1.35" step="0.05"
            value="${this.uiScale}" aria-label="${strings.settings.uiScale}">
        </section>
        <section class="settings-group" aria-labelledby="volumes-heading">
          <div class="group-heading">
            <span class="setting-icon">♫</span>
            <span><b id="volumes-heading">${strings.settings.volumes}</b><small>${strings.settings.volumesBody}</small></span>
          </div>
          ${this.muted ? `<p class="muted-note">${extra.mutedNote}</p>` : ""}
          ${volumeRows.map(([bus, label]) => {
            const percent = volumeToPercent(this.volumes[bus] ?? 1);
            return `
              <label class="volume-row">
                <span><b>${label}</b><output data-volume-value="${bus}">${percent}%</output></span>
                <input class="settings-slider" type="range" data-volume-bus="${bus}" min="0" max="100" step="1"
                  value="${percent}" aria-label="${extra.volumeValue(label, percent)}">
              </label>
            `;
          }).join("")}
        </section>
        <section class="settings-group" aria-labelledby="language-heading">
          <div class="group-heading">
            <span class="setting-icon">✎</span>
            <span><b id="language-heading">${strings.settings.language}</b><small>${strings.settings.languageBody}</small></span>
          </div>
          <div class="language-options" role="radiogroup" aria-label="${strings.settings.language}">
            ${languageRows.map(([setting, label]) => `
              <button class="language-chip ${this.languageSetting === setting ? "active" : ""}" data-ui-action="set-language"
                data-language="${setting}" role="radio" aria-checked="${this.languageSetting === setting}">${label}</button>
            `).join("")}
          </div>
        </section>
        ${this.devWorkshopUnlocked ? `
          <section class="settings-group dev-workshop-card" aria-labelledby="dev-workshop-heading">
            <div class="group-heading">
              <span class="setting-icon">⚒</span>
              <span><b id="dev-workshop-heading">${strings.settings.devWorkshop}</b><small>${strings.settings.devWorkshopBody}</small></span>
            </div>
            <button class="secondary-button" data-ui-action="open-dev-workshop">${extra.dev.open}</button>
          </section>
        ` : ""}
        <section class="quiet-hours-card" aria-labelledby="quiet-hours-heading">
          <button class="quiet-hours-switch" data-ui-action="toggle-quiet-hours" role="checkbox"
            aria-checked="${quietHours.enabled}" aria-describedby="quiet-hours-explanation quiet-hours-status">
            <span class="setting-icon">☾</span>
            <span><b id="quiet-hours-heading">Quiet hours</b><small>Delay non-urgent sleep reminders</small></span>
            <i class="toggle ${quietHours.enabled ? "on" : ""}"><em></em></i>
          </button>
          <div class="quiet-hours-times" aria-label="Quiet hours schedule">
            <label>
              <span>Start time</span>
              <select data-quiet-hour="start" aria-label="Quiet hours start time" ${quietHours.enabled ? "" : "disabled"}>
                ${QUIET_HOUR_OPTIONS.map(({ hour, value }) =>
                  `<option value="${value}" ${hour === quietHours.bounds.startHour ? "selected" : ""}>${value}</option>`).join("")}
              </select>
            </label>
            <span aria-hidden="true">→</span>
            <label>
              <span>End time</span>
              <select data-quiet-hour="end" aria-label="Quiet hours end time" ${quietHours.enabled ? "" : "disabled"}>
                ${QUIET_HOUR_OPTIONS.map(({ hour, value }) =>
                  `<option value="${value}" ${hour === quietHours.bounds.endHour ? "selected" : ""}>${value}</option>`).join("")}
              </select>
            </label>
          </div>
          <p id="quiet-hours-explanation">${quietHours.explanation}</p>
          <p class="quiet-hours-semantics">Overnight intervals continue into the next morning. Matching start and end means no quiet interval.</p>
          <strong id="quiet-hours-status" class="quiet-hours-status ${quietHours.quietNow ? "is-quiet" : ""}" role="status" aria-live="polite">${quietHours.status}</strong>
        </section>
        <article class="info-card">
          <span>♡</span><div><h3>${strings.settings.privacy}</h3><p>${strings.settings.privacyBody}</p></div>
        </article>
        <article class="info-card">
          <span>✦</span><div><h3>${strings.settings.credits}</h3><p>${strings.settings.creditsBody}</p></div>
        </article>
        <button class="parental-action" data-ui-action="clear-data">${strings.settings.clearData}</button>
      </div>
    `;
  }

  private renderDevWorkshop(): void {
    const strings = this.strings;
    const extra = this.extra;
    const catalog = activeCatalog();
    const cheats = goobyTestHooks();
    this.sheetBody.innerHTML = `
      ${this.panelHeader(strings.settings.devWorkshop, strings.settings.devWorkshopBody)}
      <div class="sheet-content settings-content dev-workshop">
        <button class="text-button" data-ui-action="dev-back">‹ ${extra.dev.back}</button>
        <section class="settings-group" aria-label="${extra.dev.sceneJump}">
          <h3>${extra.dev.sceneJump}</h3>
          <div class="dev-grid">
            ${HOME_ZONE_IDS.map((zone) => `
              <button class="scale-chip" data-ui-action="dev-scene" data-zone="${zone}">${HOME_ZONE_ICONS[zone]} ${homeZoneLabel(strings, zone)}</button>
            `).join("")}
            <button class="scale-chip" data-ui-action="dev-scene">◒ ${strings.places.cityGroup}</button>
          </div>
        </section>
        <section class="settings-group" aria-label="${extra.dev.audioTests}">
          <h3>${extra.dev.audioTests}</h3>
          <div class="dev-grid">
            ${AUDIO_BUSES.map((bus) => `
              <button class="scale-chip" data-ui-action="dev-audio" data-bus="${bus}" aria-label="${extra.dev.cueFor(bus)}">♪ ${bus}</button>
            `).join("")}
          </div>
        </section>
        <section class="settings-group" aria-label="${extra.dev.fpsOverlay}">
          <h3>${extra.dev.fpsOverlay}</h3>
          <button class="secondary-button" data-ui-action="dev-fps" aria-pressed="${this.fpsTimer !== null}">
            ${this.fpsTimer !== null ? extra.dev.fpsHide : extra.dev.fpsShow}
          </button>
        </section>
        <section class="settings-group" aria-label="${extra.dev.stickerPreview}">
          <h3>${extra.dev.stickerPreview}</h3>
          <div class="dev-sticker-grid">
            ${STICKER_DEFINITIONS.map((definition) => {
              const title = escapeHtml(catalog.stickers[definition.id].title);
              const image = manifestStickerImage(definition.id) ?? proceduralStickerPlaceholder(definition);
              return `<figure><img src="${image}" alt="${title}" loading="lazy"><figcaption>${title}</figcaption></figure>`;
            }).join("")}
          </div>
        </section>
        <section class="settings-group" aria-label="${extra.dev.licenses}">
          <h3>${extra.dev.licenses}</h3>
          <ul class="dev-license-list">
            ${AUDIO_SOURCE_CREDITS.map((credit) =>
              `<li><b>${escapeHtml(credit.title)}</b> — ${escapeHtml(credit.author)} · ${escapeHtml(credit.licenseText)}</li>`).join("")}
            <li>${escapeHtml(AUDIO_LICENSE_NOTICE_PATH)}</li>
          </ul>
        </section>
        <section class="settings-group" aria-label="${extra.dev.cheats}">
          <h3>${extra.dev.cheats}</h3>
          ${cheats ? `
            <div class="dev-grid">
              <button class="scale-chip" data-ui-action="dev-grant-xp">${extra.dev.grantXp}</button>
              <button class="scale-chip" data-ui-action="dev-advance-time">${extra.dev.advanceHour}</button>
            </div>
          ` : `<p class="muted-note">${extra.dev.cheatsUnavailable}</p>`}
        </section>
      </div>
    `;
  }

  private toggleFpsOverlay(): void {
    if (this.fpsTimer !== null) {
      this.stopFpsOverlay();
      return;
    }
    const shell = this.root.querySelector<HTMLElement>(".game-shell");
    if (!shell) return;
    const overlay = document.createElement("div");
    overlay.className = "fps-overlay";
    overlay.setAttribute("role", "status");
    overlay.setAttribute("aria-live", "off");
    overlay.textContent = "FPS —";
    shell.append(overlay);
    this.fpsOverlay = overlay;
    this.fpsTimer = setInterval(() => {
      const fps = typeof window === "undefined"
        ? null
        : window.__gooby?.performance().frame.fps ?? null;
      overlay.textContent = fps === null || !Number.isFinite(fps)
        ? "FPS —"
        : `FPS ${Math.round(fps)}`;
    }, 500);
  }

  private stopFpsOverlay(): void {
    if (this.fpsTimer !== null) clearInterval(this.fpsTimer);
    this.fpsTimer = null;
    this.fpsOverlay?.remove();
    this.fpsOverlay = null;
  }

  private refreshQuietHoursStatus(): void {
    const presentation = quietHoursPresentation(
      this.model.persisted.quietHours ?? null,
      this.lastNow,
    );
    const status = this.sheetBody.querySelector<HTMLElement>("#quiet-hours-status");
    if (!status) return;
    status.textContent = presentation.status;
    status.classList.toggle("is-quiet", presentation.quietNow);
  }

  /** Re-labels the static chrome after a runtime language switch. */
  private refreshLanguage(): void {
    const strings = this.strings;
    const extra = this.extra;
    this.canvas.setAttribute("aria-label", strings.home);
    this.setText("[data-app-name]", strings.appName);
    this.setText("[data-level-label]", strings.levelShort);
    for (const key of NEED_KEYS) {
      const need = this.root.querySelector<HTMLElement>(`[data-need="${key}"]`);
      const label = need?.querySelector<HTMLElement>(".need-copy b");
      if (label) label.textContent = strings.needs[key].label;
      need?.querySelector(".meter")?.setAttribute("aria-label", strings.needs[key].label);
    }
    const feed = this.root.querySelector<HTMLElement>('[data-testid="feed"]');
    const feedLabel = feed?.querySelector<HTMLElement>("b");
    if (feedLabel) feedLabel.textContent = strings.actions.feed;
    const feedSmall = feed?.querySelector<HTMLElement>("small");
    if (feedSmall) {
      feedSmall.innerHTML = `<i data-carrots>${this.lastCarrots}</i> ${extra.carrotsWord}`;
      this.inventoryCount = this.root.querySelector<HTMLElement>("[data-carrots]") as HTMLElement;
    }
    const sleep = this.root.querySelector<HTMLElement>('[data-testid="sleep"]');
    const sleepLabel = sleep?.querySelector<HTMLElement>("b");
    if (sleepLabel) sleepLabel.textContent = strings.actions.sleep;
    const sleepSmall = sleep?.querySelector<HTMLElement>("small");
    if (sleepSmall) sleepSmall.textContent = strings.actions.sleepHint;
    this.setText(".sleep-eyebrow", strings.sleep.remaining);
    this.setText("[data-sleep-title]", strings.sleep.title);
    this.setText("[data-sleep-body]", strings.sleep.body);
    this.setText('.sleep-overlay [data-ui-action="wake"]', strings.actions.wake);
    this.setText("[data-sleep-note]", strings.sleep.earlyWakeNote);
    for (const item of navItems(strings)) {
      const tab = this.root.querySelector<HTMLElement>(`[data-panel="${item.id}"]`);
      if (!tab) continue;
      tab.setAttribute("aria-label", item.label);
      const label = tab.querySelector<HTMLElement>("small");
      if (label) label.textContent = item.label;
    }
    const intro = this.onboarding.querySelector<HTMLElement>(".onboarding-copy");
    const eyebrow = intro?.querySelector<HTMLElement>(".eyebrow");
    if (eyebrow) eyebrow.textContent = strings.onboarding.eyebrow;
    const introTitle = intro?.querySelector<HTMLElement>("h1");
    if (introTitle) introTitle.textContent = strings.onboarding.introTitle;
    const introBody = intro?.querySelector<HTMLElement>("p");
    if (introBody) introBody.textContent = strings.onboarding.introBody;
    this.setText('[data-ui-action="onboarding-next"]', strings.onboarding.introAction);
    if (!this.onboarding.hidden) this.renderOnboarding();
    if (this.currentPanel) this.renderPanel();
    const state = this.lastCanonical;
    if (state) this.stickerBook?.update(state, activeCatalog());
  }

  private renderOnboarding(): void {
    const strings = this.strings;
    const intro = this.onboarding.querySelector<HTMLElement>(".onboarding-intro");
    const coach = this.onboarding.querySelector<HTMLElement>("[data-coach-card]");
    if (!intro || !coach) return;
    const step = this.onboardingProgress.currentStep;
    intro.hidden = step !== "intro";
    coach.hidden = step === "intro" || step === "complete";
    this.onboarding.classList.toggle("is-coaching", step !== "intro");
    if (step === "pet") {
      coach.innerHTML = `
        <span class="coach-step">1 / 3</span>
        <i class="coach-icon">♡</i>
        <div><b>${strings.onboarding.petTitle}</b><p>${strings.onboarding.petBody}</p><small>${strings.onboarding.petHint}</small>
          <button class="coach-action" data-ui-action="onboarding-pet">${strings.onboarding.petAction}</button></div>
      `;
    } else if (step === "feed") {
      coach.innerHTML = `
        <span class="coach-step">2 / 3</span>
        <i class="coach-icon">🥕</i>
        <div><b>${strings.onboarding.feedTitle}</b><p>${strings.onboarding.feedBody}</p><small>${strings.onboarding.feedHint}</small>
          <button class="coach-action" data-ui-action="onboarding-feed">${strings.actions.feed}</button></div>
      `;
    } else if (step === "meters") {
      coach.innerHTML = `
        <span class="coach-step">3 / 3</span>
        <i class="coach-icon">✦</i>
        <div><b>${strings.onboarding.metersTitle}</b><p>${strings.onboarding.metersBody}</p>
          <button class="primary-button compact" data-ui-action="onboarding-complete">${strings.onboarding.metersAction}</button>
        </div>
      `;
    }
    this.updateInert();
  }

  private requestSleep(): void {
    const strings = this.strings;
    if (this.model.persisted.sleepRationaleSeen) {
      this.actions.sleep();
      return;
    }
    this.openModal(`
      <button class="modal-close" data-ui-action="close-modal" aria-label="${strings.close}">×</button>
      <div class="notification-art" aria-hidden="true"><i>☾</i><span>♢</span></div>
      <h2>${strings.sleep.rationaleTitle}</h2>
      <p>${strings.sleep.rationaleBody}</p>
      <div class="modal-actions stacked">
        <button class="primary-button compact" data-ui-action="sleep-confirm">${strings.sleep.rationaleAccept}</button>
        <button class="text-button" data-ui-action="close-modal">${strings.sleep.rationaleLater}</button>
      </div>
    `);
  }

  private showWakeCelebration(): void {
    const strings = this.strings;
    this.openModal(`
      <div class="wake-art" aria-hidden="true"><i>☀</i><b>♡</b><span>✦</span></div>
      <h2>${strings.sleep.celebrationTitle}</h2>
      <p>${strings.sleep.celebrationBody}</p>
      <button class="primary-button compact" data-ui-action="wake-celebration">${strings.sleep.celebrationAction}</button>
    `);
  }

  private openModal(content: string): void {
    // Disabling the tapped opener (e.g. the wake button) drops focus onto
    // <body>; treat that as "no opener" so closing falls back to the canvas.
    const active = document.activeElement;
    this.modalOpener = active instanceof HTMLElement && active !== document.body ? active : null;
    this.modalBody.innerHTML = content;
    const heading = this.modalBody.querySelector<HTMLElement>("h2");
    if (heading && !heading.id) heading.id = "modal-title";
    this.modal.hidden = false;
    // Swallow clicks that began before the modal was painted (e.g. the second
    // tap of a double tap on the wake button that opened this modal).
    this.modalClickGuard = true;
    this.updateInert();
    requestAnimationFrame(() => {
      this.modalClickGuard = false;
      this.modalBody.querySelector<HTMLElement>("button")?.focus();
    });
  }

  private closeModal(): void {
    if (this.modal.hidden) return;
    const opener = this.modalOpener;
    this.modal.hidden = true;
    this.modalBody.replaceChildren();
    this.modalOpener = null;
    this.updateInert();
    requestAnimationFrame(() => {
      // Restore focus to the opener; if it went away (e.g. the wake button
      // inside the now-hidden sleep overlay), fall back to the game canvas.
      if (opener?.isConnected && opener.getClientRects().length > 0 && !opener.closest("[hidden]")) {
        opener.focus();
      } else {
        this.canvas.focus();
      }
    });
  }

  private applyPreferences(): void {
    const preferences = this.model.persisted.preferences;
    this.root.classList.toggle("reduce-motion", preferences.reducedMotion);
    this.root.dataset.audio = preferences.audio ? "on" : "off";
    this.root.dataset.haptics = preferences.haptics ? "on" : "off";
  }

  private preferenceSnapshot(): {
    readonly audio: boolean;
    readonly haptics: boolean;
    readonly reducedMotion: boolean;
    readonly notifications: boolean;
  } {
    return { ...this.model.persisted.preferences };
  }

  private setText(selector: string, value: string): void {
    const element = this.root.querySelector<HTMLElement>(selector);
    if (element) element.textContent = value;
  }
}
