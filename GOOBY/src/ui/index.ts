import type { Economy } from "../core/contracts/economy";
import type { QuietHours } from "../core/contracts/platform";
import type { MinigamePayout } from "../core/contracts/minigame";
import type { CanonicalSaveState } from "../core/contracts/save";
import type { HomeZoneId, MinigameId, ShopId } from "../core/contracts/scenes";
import { NEED_KEYS, SLEEP_DURATION_MS, type Needs } from "../core/contracts/simulation";
import {
  COSMETIC_CATALOG,
  COSMETIC_SLOTS,
  FOOD_CATALOG,
  FURNITURE_CATALOG,
  type CosmeticSlot,
} from "../data/catalog";
import { HOME_ZONE_BLUEPRINTS } from "../data/home";
import {
  MINIGAME_COPY,
  SHOP_COPY,
  STRINGS,
} from "../data/strings";
import {
  MINIGAME_CARDS,
  DEFAULT_UI_QUIET_HOURS,
  OnboardingProgress,
  UiModel,
  formatCountdown,
  formatQuietHour,
  getLevelProgress,
  parseQuietHourValue,
  quietHoursPresentation,
  type PanelId,
  type PreferenceKey,
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
}

export type SceneChrome =
  | { readonly kind: "home"; readonly label?: string }
  | { readonly kind: "city"; readonly phase: "board" | "driving" | "shop"; readonly destination?: ShopId }
  | { readonly kind: "minigame"; readonly title: string };

const NAV_ITEMS = [
  { id: "places", label: STRINGS.nav.Places, icon: "⌂" },
  { id: "play", label: STRINGS.nav.Play, icon: "◆" },
  { id: "wardrobe", label: STRINGS.nav.Wardrobe, icon: "♧" },
  { id: "items", label: STRINGS.nav.Items, icon: "▣" },
  { id: "settings", label: STRINGS.nav.Settings, icon: "⚙" },
] as const satisfies readonly { readonly id: PanelId; readonly label: string; readonly icon: string }[];

const QUIET_HOUR_OPTIONS = Array.from({ length: 24 }, (_, hour) => {
  const value = formatQuietHour(hour);
  return { hour, value };
});

function panelHeader(title: string, subtitle: string): string {
  return `
    <header class="sheet-header">
      <div>
        <span class="sheet-eyebrow">${STRINGS.appName}</span>
        <h2 id="sheet-title">${title}</h2>
        <p>${subtitle}</p>
      </div>
      <button class="icon-button" data-ui-action="close-panel" aria-label="${STRINGS.close}">×</button>
    </header>
  `;
}

function avatarMarkup(equipped: Readonly<Partial<Record<CosmeticSlot, string>>>): string {
  return `
    <div class="outfit-preview" aria-label="${STRINGS.wardrobe.preview}">
      <div class="preview-halo"></div>
      <div class="preview-gooby">
        <i class="preview-ear left"></i><i class="preview-ear right"></i>
        <i class="preview-face"></i>
        <i class="outfit-layer outfit-head ${equipped.head ?? "none"}"></i>
        <i class="outfit-layer outfit-ears ${equipped.ears ?? "none"}"></i>
        <i class="outfit-layer outfit-neck ${equipped.neck ?? "none"}"></i>
        <i class="outfit-layer outfit-body ${equipped.back ?? "none"}"></i>
      </div>
      <span>${STRINGS.wardrobe.preview}</span>
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
  private readonly inventoryCount: HTMLElement;
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
  private wardrobeDraft: Partial<Record<CosmeticSlot, string>> = {};
  private equippedCosmetics: Partial<Record<CosmeticSlot, string>> = {};
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
  private toastTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly root: HTMLElement,
    private readonly actions: UiActions,
  ) {
    this.model = new UiModel();
    root.innerHTML = `
      <main class="game-shell">
        <canvas id="game-canvas" aria-label="${STRINGS.home}" tabindex="0"></canvas>
        <div class="sun-glow" aria-hidden="true"></div>

        <header class="hud">
          <section class="status-card glass" aria-label="${STRINGS.appName}">
            <button class="scene-chip" data-ui-action="living-room">
              <span class="scene-icon">⌂</span>
              <span><small>${STRINGS.appName}</small><b data-scene-label>${STRINGS.home}</b></span>
            </button>
            <div class="economy">
              <span class="economy-chip coins" aria-label="Coins"><i>●</i><b data-coins>0</b></span>
              <span class="economy-chip xp" aria-label="XP"><i>✦</i><b data-xp>0</b></span>
              <span class="level-chip"><small>${STRINGS.levelShort}</small><b data-level>1</b></span>
            </div>
          </section>
          <div class="xp-track" aria-hidden="true"><i data-xp-progress></i></div>
          <section class="needs-card glass" aria-label="Needs">
            ${NEED_KEYS.map((key) => {
              const need = STRINGS.needs[key];
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
          <span class="sleep-eyebrow">${STRINGS.sleep.remaining}</span>
          <strong>${STRINGS.sleep.title}</strong>
          <span class="sleep-countdown" data-sleep-countdown>30:00</span>
          <div class="sleep-progress" aria-hidden="true"><i data-sleep-progress></i></div>
          <p>${STRINGS.sleep.body}</p>
          <button class="secondary-button" data-ui-action="wake">${STRINGS.actions.wake}</button>
          <small>${STRINGS.sleep.earlyWakeNote}</small>
        </section>

        <div class="scene-chrome" hidden data-scene-chrome></div>
        <div class="fx-layer" aria-hidden="true"></div>
        <div class="toast" role="status" aria-live="polite"></div>

        <section class="bottom-ui">
          <div class="quick-actions">
            <button class="action-button feed-button" data-ui-action="feed" data-testid="feed">
              <span class="action-icon">🥕</span>
              <span><b>${STRINGS.actions.feed}</b><small><i data-carrots>0</i> carrots</small></span>
            </button>
            <button class="action-button sleep-button" data-ui-action="sleep" data-testid="sleep">
              <span class="action-icon">☾</span>
              <span><b>${STRINGS.actions.sleep}</b><small>${STRINGS.actions.sleepHint}</small></span>
            </button>
            <button class="action-button bathe-button" data-ui-action="bathe" data-testid="bathe" hidden>
              <span class="action-icon">◌</span>
              <span><b>Bathe</b><small>Scrub with bubbles</small></span>
            </button>
          </div>
          <nav class="tab-bar glass" aria-label="Main" role="tablist">
            ${NAV_ITEMS.map(({ id, label, icon }, index) => `
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
              <span class="eyebrow">${STRINGS.onboarding.eyebrow}</span>
              <h1>${STRINGS.onboarding.introTitle}</h1>
              <p>${STRINGS.onboarding.introBody}</p>
            </div>
            <button class="primary-button" data-ui-action="onboarding-next">${STRINGS.onboarding.introAction}</button>
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
    this.root.addEventListener("keydown", this.handleKeyDown);
    this.applyPreferences();
  }

  syncCanonical(state: CanonicalSaveState, now = this.lastNow): void {
    this.lastNow = now;
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
  }

  update(
    needs: Needs,
    economy: Economy,
    inventory: Readonly<Record<string, number>>,
    equipped: Readonly<Partial<Record<CosmeticSlot, string>>> = {},
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
      if (sleeping) this.closeModal();
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
    const chrome = this.root.querySelector<HTMLElement>("[data-scene-chrome]");
    const sceneLabel = this.root.querySelector<HTMLElement>("[data-scene-label]");
    if (!chrome || !sceneLabel) return;
    this.root.dataset.scene = scene.kind;
    chrome.hidden = scene.kind === "home";
    if (scene.kind === "home") {
      sceneLabel.textContent = scene.label ?? STRINGS.home;
      const bath = this.root.querySelector<HTMLButtonElement>("[data-ui-action='bathe']");
      if (bath) bath.hidden = scene.label !== HOME_ZONE_BLUEPRINTS.bathroom.title;
      return;
    }
    const bath = this.root.querySelector<HTMLButtonElement>("[data-ui-action='bathe']");
    if (bath) bath.hidden = true;
    if (scene.kind === "city") {
      const destination = scene.destination ? SHOP_COPY[scene.destination].title : STRINGS.chrome.town;
      sceneLabel.textContent = STRINGS.chrome.town;
      chrome.innerHTML = `
        <span><i>⌁</i>${scene.phase === "driving" ? `${STRINGS.chrome.driving} ${destination}` : destination}</span>
      `;
      return;
    }
    sceneLabel.textContent = STRINGS.chrome.minigame;
    chrome.innerHTML = `
      <span><i>◆</i>${scene.title}</span>
      <button data-ui-action="pause">${STRINGS.chrome.pause}</button>
    `;
  }

  showResults(
    gameId: MinigameId,
    payout: MinigamePayout,
    result: { readonly isNewBest: boolean; readonly best: number },
  ): void {
    const game = MINIGAME_COPY[gameId];
    this.openModal(`
      <div class="result-burst" aria-hidden="true">✦</div>
      <span class="modal-eyebrow">${STRINGS.results.eyebrow}</span>
      <h2>${result.isNewBest ? STRINGS.newBest : STRINGS.results.title}</h2>
      <p>${game.title}</p>
      <div class="payout-grid">
        <span><i>◆</i><b>${payout.score.toLocaleString()}</b><small>${STRINGS.results.score}</small></span>
        <span><i>●</i><b>+${payout.coins}</b><small>${STRINGS.results.coins}</small></span>
        <span><i>✦</i><b>+${payout.xp}</b><small>${STRINGS.results.xp}</small></span>
      </div>
      <div class="modal-actions">
        <button class="secondary-button" data-ui-action="results-done">${STRINGS.results.done}</button>
        <button class="primary-button compact" data-ui-action="results-again" data-game="${gameId}">${STRINGS.results.again}</button>
      </div>
    `);
  }

  get minigameMount(): HTMLElement {
    return this.root.querySelector<HTMLElement>("[data-minigame-mount]") as HTMLElement;
  }

  get equipped(): Readonly<Partial<Record<CosmeticSlot, string>>> {
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

  toast(message: string): void {
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastElement.textContent = message;
    this.toastElement.classList.remove("show");
    requestAnimationFrame(() => this.toastElement.classList.add("show"));
    this.toastTimer = setTimeout(() => this.toastElement.classList.remove("show"), 2_400);
  }

  dispose(): void {
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.root.removeEventListener("click", this.handleClick);
    this.root.removeEventListener("change", this.handleChange);
    this.root.removeEventListener("keydown", this.handleKeyDown);
    this.root.replaceChildren();
  }

  private readonly handleClick = (event: MouseEvent): void => {
    const button = (event.target as Element).closest<HTMLButtonElement>("button");
    if (!button) return;
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
      const decision = this.model.requestLivingRoom(STRINGS.places.returnBlocked);
      if (!decision.allowed && decision.message) this.toast(decision.message);
      else this.actions.navigateHome("living-room");
    } else if (action === "home-zone") {
      const decision = this.model.requestLivingRoom(STRINGS.places.returnBlocked);
      if (!decision.allowed && decision.message) this.toast(decision.message);
      else {
        this.closePanel();
        this.actions.navigateHome(button.dataset.zone as HomeZoneId);
      }
    } else if (action === "city-board") {
      this.closePanel();
      this.actions.openCity();
    } else if (action === "select-game") {
      this.selectedGame = button.dataset.game as MinigameId;
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
      const slot = button.dataset.slot as CosmeticSlot;
      const item = button.dataset.item;
      if (item) this.wardrobeDraft[slot] = item;
      else delete this.wardrobeDraft[slot];
      this.renderPanel();
    } else if (action === "wardrobe-equip") {
      const slot = button.dataset.slot as CosmeticSlot;
      const itemId = this.wardrobeDraft[slot] ?? null;
      if (!this.actions.equipCosmetic(slot, itemId)) {
        this.actions.feedback("denied");
        this.wardrobeDraft = { ...this.equippedCosmetics };
        this.renderPanel();
        return;
      }
      this.equippedCosmetics = { ...this.model.persisted.equipped };
      this.renderPanel();
      this.toast(STRINGS.toasts.outfitSaved);
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
      this.toast(STRINGS.toasts.settingSaved);
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
        <h2 id="modal-title">${STRINGS.settings.clearDataTitle}</h2>
        <p>${STRINGS.settings.clearDataBody}</p>
        <div class="modal-actions stacked">
          <button class="danger-button" data-ui-action="clear-data-confirm">${STRINGS.settings.clearDataConfirm}</button>
          <button class="text-button" data-ui-action="close-modal">${STRINGS.sleep.rationaleLater}</button>
        </div>
      `);
    } else if (action === "clear-data-confirm") {
      this.actions.clearLocalData();
    }
  };

  private readonly handleChange = (event: Event): void => {
    const select = (event.target as Element).closest<HTMLSelectElement>("select[data-quiet-hour]");
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

  private openPanel(panel: PanelId): void {
    if (!this.currentPanel) {
      this.panelOpener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }
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
        this.closePanel();
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

  private renderPanel(): void {
    if (!this.currentPanel) return;
    if (this.currentPanel === "places") this.renderPlaces();
    else if (this.currentPanel === "play") this.renderPlay();
    else if (this.currentPanel === "wardrobe") this.renderWardrobe();
    else if (this.currentPanel === "items") this.renderItems();
    else this.renderSettings();
  }

  private renderPlaces(): void {
    this.sheetBody.innerHTML = `
      ${panelHeader(STRINGS.places.title, STRINGS.places.subtitle)}
      <div class="sheet-content">
        <section class="panel-section">
          <h3>${STRINGS.places.homeGroup}</h3>
          <div class="destination-list" aria-label="${STRINGS.places.homeGroup}">
            ${(Object.keys(HOME_ZONE_BLUEPRINTS) as HomeZoneId[]).map((zone) => {
              const home = HOME_ZONE_BLUEPRINTS[zone];
              const icon = zone === "living-room" ? "⌂" : zone === "kitchen" ? "♨" : zone === "bathroom" ? "◌" : zone === "bedroom" ? "☾" : "❀";
              return `
                <button class="destination-card" data-ui-action="home-zone" data-zone="${zone}" data-testid="home-zone-${zone}">
                  <span class="destination-icon">${icon}</span>
                  <span><b>${home.title}</b><small>${home.subtitle}</small></span><i>›</i>
                </button>`;
            }).join("")}
          </div>
        </section>
        <section class="panel-section city-board">
          <div class="section-heading">
            <div><h3>${STRINGS.places.cityGroup}</h3><p>${STRINGS.places.boardBody}</p></div>
            <span class="tiny-car" aria-hidden="true">◒</span>
          </div>
          <button class="place-card home-card" data-ui-action="city-board" data-testid="open-city-board">
            <span class="place-icon home">◒</span>
            <span><b>Go to the parked car</b><small>Choose a shop at the garage board</small></span><i>›</i>
          </button>
          <p class="route-note"><i>⌁</i>${STRINGS.places.travelNote}</p>
        </section>
      </div>
    `;
  }

  private renderPlay(): void {
    if (this.selectedGame) {
      const game = MINIGAME_CARDS.find((entry) => entry.id === this.selectedGame);
      if (game) {
        const unlocked = this.lastEconomy.level >= game.unlockLevel;
        const best = this.model.persisted.highScores[game.id] ?? 0;
        this.sheetBody.innerHTML = `
          ${panelHeader(STRINGS.play.title, STRINGS.play.subtitle)}
          <div class="sheet-content game-detail">
            <button class="text-button" data-ui-action="select-game" data-game="">‹ ${STRINGS.back}</button>
            <div class="game-hero game-${game.id}">
              <span>${game.icon}</span><i>✦</i><i>·</i>
            </div>
            <span class="game-level">${unlocked ? `${STRINGS.levelShort} ${game.unlockLevel}` : STRINGS.locked}</span>
            <h3>${game.title}</h3>
            <p>${game.instructions}</p>
            <div class="game-best"><span>◆</span><b>${best ? STRINGS.play.best(best) : STRINGS.play.noScore}</b></div>
            <small class="reward-note">${STRINGS.play.rewardPreview}</small>
            <button class="primary-button" data-ui-action="start-game" data-game="${game.id}" ${unlocked ? "" : "disabled"}>
              ${unlocked ? STRINGS.actions.play : STRINGS.play.unlockAt(game.unlockLevel)}
            </button>
          </div>
        `;
        return;
      }
      this.selectedGame = null;
    }
    this.sheetBody.innerHTML = `
      ${panelHeader(STRINGS.play.title, STRINGS.play.subtitle)}
      <div class="sheet-content">
        <div class="game-grid">
          ${MINIGAME_CARDS.map((game) => {
            const unlocked = this.lastEconomy.level >= game.unlockLevel;
            const best = this.model.persisted.highScores[game.id] ?? 0;
            return `
              <button class="game-card ${unlocked ? "" : "locked"}" data-ui-action="select-game" data-game="${game.id}">
                <span class="game-card-icon">${game.icon}</span>
                <span class="game-card-copy"><b>${game.title}</b><small>${unlocked ? (best ? STRINGS.play.best(best) : STRINGS.play.noScore) : STRINGS.play.unlockAt(game.unlockLevel)}</small></span>
                <i>${unlocked ? "›" : "⌑"}</i>
              </button>
            `;
          }).join("")}
        </div>
      </div>
    `;
  }

  private renderWardrobe(): void {
    const slotLabels: Readonly<Record<CosmeticSlot, string>> = {
      head: "Head",
      ears: "Ears",
      neck: "Neck",
      back: "Back",
    };
    this.sheetBody.innerHTML = `
      ${panelHeader(STRINGS.wardrobe.title, STRINGS.wardrobe.subtitle)}
      <div class="sheet-content wardrobe-content">
        ${avatarMarkup(this.wardrobeDraft)}
        <h3>${STRINGS.wardrobe.slots}</h3>
        ${COSMETIC_SLOTS.map((slot) => {
          const items = COSMETIC_CATALOG.filter((item) =>
            item.slot === slot && (this.lastInventory[item.id] ?? 0) > 0);
          const equipped = this.equippedCosmetics[slot];
          const selected = this.wardrobeDraft[slot];
          return `
            <section class="wardrobe-slot">
              <div class="slot-title"><span>${slot === "head" ? "☀" : slot === "ears" ? "❀" : slot === "neck" ? "⌁" : "♧"}</span><b>${slotLabels[slot]}</b></div>
              <div class="wardrobe-options">
                <button class="${selected === undefined ? "selected" : ""}" data-ui-action="wardrobe-preview" data-slot="${slot}">
                  <i>·</i><small>${STRINGS.wardrobe.none}</small>${selected === undefined ? '<span class="selection-mark">✓</span>' : ""}
                </button>
                ${items.map((item) => `
                  <button class="${selected === item.id ? "selected" : ""}" data-ui-action="wardrobe-preview" data-slot="${slot}" data-item="${item.id}">
                    <i>${slot === "head" ? "☀" : slot === "ears" ? "❀" : slot === "neck" ? "⌁" : "♧"}</i><small>${item.name}</small>${selected === item.id ? '<span class="selection-mark">✓</span>' : ""}
                  </button>
                `).join("")}
              </div>
              <button class="equip-button" data-ui-action="wardrobe-equip" data-slot="${slot}" ${selected === equipped ? "disabled" : ""}>
                ${selected === equipped ? `✓ ${STRINGS.actions.equipped}` : STRINGS.actions.equip}
              </button>
            </section>
          `;
        }).join("")}
      </div>
    `;
  }

  private renderItems(): void {
    this.sheetBody.innerHTML = `
      ${panelHeader(STRINGS.items.title, STRINGS.items.subtitle)}
      <div class="segmented-control" role="tablist" aria-label="${STRINGS.items.title}">
        <button id="items-tab-food" class="${this.itemsTab === "food" ? "active" : ""}" data-ui-action="items-tab" data-tab="food"
          role="tab" aria-controls="items-tabpanel" aria-selected="${this.itemsTab === "food"}" tabindex="${this.itemsTab === "food" ? "0" : "-1"}">${STRINGS.items.food}</button>
        <button id="items-tab-furniture" class="${this.itemsTab === "furniture" ? "active" : ""}" data-ui-action="items-tab" data-tab="furniture"
          role="tab" aria-controls="items-tabpanel" aria-selected="${this.itemsTab === "furniture"}" tabindex="${this.itemsTab === "furniture" ? "0" : "-1"}">${STRINGS.items.furniture}</button>
      </div>
      <div class="sheet-content" id="items-tabpanel" role="tabpanel" aria-labelledby="items-tab-${this.itemsTab}">
        ${this.itemsTab === "food" ? `
          <div class="inventory-list">
            <article class="inventory-card">
              <span class="inventory-art carrot-art">🥕</span>
              <div><b>${STRINGS.items.carrot}</b><p>${STRINGS.items.carrotBody}</p><small>${STRINGS.items.owned(this.lastCarrots)}</small></div>
              <button class="mini-action" data-ui-action="feed" ${this.lastCarrots <= 0 ? "disabled" : ""}>${STRINGS.actions.feed}</button>
            </article>
            ${FOOD_CATALOG.map((item) => {
              const count = this.lastInventory[item.id] ?? 0;
              return `
                <article class="inventory-card" data-catalog-food="${item.id}">
                  <span class="inventory-art food-art">◇</span>
                  <div><b>${item.name}</b><p>${item.description}</p><small>${STRINGS.items.owned(count)} · +${item.hunger} Full</small></div>
                  <button class="mini-action" data-ui-action="consume-food" data-item="${item.id}" ${count <= 0 ? "disabled" : ""}>${STRINGS.actions.feed}</button>
                </article>`;
            }).join("")}
          </div>
        ` : `
          <div class="inventory-list">
            ${FURNITURE_CATALOG.filter((item) => (this.lastInventory[item.id] ?? 0) > 0).map((item) => `
              <article class="inventory-card ${this.selectedDecor === item.id ? "is-selected" : ""}" data-catalog-decor="${item.id}">
                <span class="inventory-art furniture-art">▱</span>
                <div><b>${item.name}</b><small>${STRINGS.items.owned(this.lastInventory[item.id] ?? 0)}</small></div>
                <button class="mini-action" data-ui-action="place-item" data-item="${item.id}">${STRINGS.actions.place}</button>
              </article>
            `).join("") || '<p class="empty-state">Find cozy furniture at Cloud Boutique.</p>'}
            ${this.selectedDecor ? `
              <section class="decor-controls" aria-label="${STRINGS.items.decorControls}">
                <b>${STRINGS.items.decorControls}</b>
                <div class="decor-move-grid">
                  <button data-ui-action="move-decor" data-direction="forward" aria-label="${STRINGS.items.moveForward}">↑</button>
                  <button data-ui-action="move-decor" data-direction="left" aria-label="${STRINGS.items.moveLeft}">←</button>
                  <button data-ui-action="move-decor" data-direction="back" aria-label="${STRINGS.items.moveBack}">↓</button>
                  <button data-ui-action="move-decor" data-direction="right" aria-label="${STRINGS.items.moveRight}">→</button>
                </div>
                <button class="secondary-button" data-ui-action="rotate-decor">${STRINGS.items.rotate}</button>
                <button class="danger-button" data-ui-action="remove-decor">${STRINGS.items.remove}</button>
              </section>
            ` : ""}
          </div>
        `}
      </div>
    `;
  }

  private renderSettings(): void {
    const preferences = this.model.persisted.preferences;
    const quietHours = quietHoursPresentation(
      this.model.persisted.quietHours ?? null,
      this.lastNow,
    );
    const rows: readonly [PreferenceKey, string, string, string][] = [
      ["audio", "♪", STRINGS.settings.audio, STRINGS.settings.audioBody],
      ["haptics", "⌁", STRINGS.settings.haptics, STRINGS.settings.hapticsBody],
      ["reducedMotion", "◐", STRINGS.settings.motion, STRINGS.settings.motionBody],
      ["notifications", "♢", STRINGS.settings.notifications, STRINGS.settings.notificationsBody],
    ];
    this.sheetBody.innerHTML = `
      ${panelHeader(STRINGS.settings.title, STRINGS.settings.subtitle)}
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
          <span>♡</span><div><h3>${STRINGS.settings.privacy}</h3><p>${STRINGS.settings.privacyBody}</p></div>
        </article>
        <article class="info-card">
          <span>✦</span><div><h3>${STRINGS.settings.credits}</h3><p>${STRINGS.settings.creditsBody}</p></div>
        </article>
        <button class="parental-action" data-ui-action="clear-data">${STRINGS.settings.clearData}</button>
      </div>
    `;
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

  private renderOnboarding(): void {
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
        <div><b>${STRINGS.onboarding.petTitle}</b><p>${STRINGS.onboarding.petBody}</p><small>${STRINGS.onboarding.petHint}</small>
          <button class="coach-action" data-ui-action="onboarding-pet">${STRINGS.onboarding.petAction}</button></div>
      `;
    } else if (step === "feed") {
      coach.innerHTML = `
        <span class="coach-step">2 / 3</span>
        <i class="coach-icon">🥕</i>
        <div><b>${STRINGS.onboarding.feedTitle}</b><p>${STRINGS.onboarding.feedBody}</p><small>${STRINGS.onboarding.feedHint}</small>
          <button class="coach-action" data-ui-action="onboarding-feed">${STRINGS.actions.feed}</button></div>
      `;
    } else if (step === "meters") {
      coach.innerHTML = `
        <span class="coach-step">3 / 3</span>
        <i class="coach-icon">✦</i>
        <div><b>${STRINGS.onboarding.metersTitle}</b><p>${STRINGS.onboarding.metersBody}</p>
          <button class="primary-button compact" data-ui-action="onboarding-complete">${STRINGS.onboarding.metersAction}</button>
        </div>
      `;
    }
    this.updateInert();
  }

  private requestSleep(): void {
    if (this.model.persisted.sleepRationaleSeen) {
      this.actions.sleep();
      return;
    }
    this.openModal(`
      <button class="modal-close" data-ui-action="close-modal" aria-label="${STRINGS.close}">×</button>
      <div class="notification-art" aria-hidden="true"><i>☾</i><span>♢</span></div>
      <h2>${STRINGS.sleep.rationaleTitle}</h2>
      <p>${STRINGS.sleep.rationaleBody}</p>
      <div class="modal-actions stacked">
        <button class="primary-button compact" data-ui-action="sleep-confirm">${STRINGS.sleep.rationaleAccept}</button>
        <button class="text-button" data-ui-action="close-modal">${STRINGS.sleep.rationaleLater}</button>
      </div>
    `);
  }

  private showWakeCelebration(): void {
    this.openModal(`
      <div class="wake-art" aria-hidden="true"><i>☀</i><b>♡</b><span>✦</span></div>
      <h2>${STRINGS.sleep.celebrationTitle}</h2>
      <p>${STRINGS.sleep.celebrationBody}</p>
      <button class="primary-button compact" data-ui-action="wake-celebration">${STRINGS.sleep.celebrationAction}</button>
    `);
  }

  private openModal(content: string): void {
    this.modalOpener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.modalBody.innerHTML = content;
    const heading = this.modalBody.querySelector<HTMLElement>("h2");
    if (heading && !heading.id) heading.id = "modal-title";
    this.modal.hidden = false;
    this.updateInert();
    requestAnimationFrame(() => this.modalBody.querySelector<HTMLElement>("button")?.focus());
  }

  private closeModal(): void {
    if (this.modal.hidden) return;
    const opener = this.modalOpener;
    this.modal.hidden = true;
    this.modalBody.replaceChildren();
    this.modalOpener = null;
    this.updateInert();
    requestAnimationFrame(() => opener?.isConnected && opener.focus());
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
