import type { Economy } from "../core/contracts/economy";
import type { MinigamePayout } from "../core/contracts/minigame";
import type { HomeZoneId, MinigameId, ShopId } from "../core/contracts/scenes";
import { NEED_KEYS, SLEEP_DURATION_MS, type Needs } from "../core/contracts/simulation";
import {
  COSMETIC_CATALOG,
  COSMETIC_SLOTS,
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
  OnboardingProgress,
  UiModel,
  formatCountdown,
  getLevelProgress,
  type PanelId,
  type PreferenceKey,
} from "./model";

export interface UiActions {
  feed(): void;
  bathe(): void;
  sleep(): void;
  wake(): void;
  navigateHome(zone: HomeZoneId): void;
  openCity(): void;
  startMinigame(game: MinigameId): void;
  pauseMinigame(): void;
  equipCosmetic(slot: CosmeticSlot, itemId: string | null): void;
  placeFurniture(itemId: string): void;
  preferenceChanged(key: PreferenceKey, enabled: boolean): void;
  onboardingComplete(): void;
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
  private wasSleeping: boolean | null = null;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly root: HTMLElement,
    private readonly actions: UiActions,
  ) {
    this.model = new UiModel(typeof localStorage === "undefined" ? undefined : localStorage);
    root.innerHTML = `
      <main class="game-shell">
        <canvas id="game-canvas" aria-label="${STRINGS.home}"></canvas>
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
          <nav class="tab-bar glass" aria-label="Main">
            ${NAV_ITEMS.map(({ id, label, icon }) => `
              <button data-panel="${id}" aria-label="${label}">
                <span>${icon}</span><small>${label}</small>
              </button>`).join("")}
          </nav>
        </section>

        <div class="sheet-backdrop" data-ui-action="close-panel" hidden></div>
        <section class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title" hidden>
          <div class="sheet-handle" aria-hidden="true"></div>
          <div class="sheet-body" data-sheet-body></div>
        </section>

        <div class="modal-backdrop" hidden>
          <section class="modal-card glass" role="dialog" aria-modal="true" data-modal-body></section>
        </div>

        <section class="onboarding" data-testid="onboarding" hidden>
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
    this.applyPreferences();
  }

  update(
    needs: Needs,
    economy: Economy,
    inventory: Readonly<Record<string, number>>,
    equipped: Readonly<Partial<Record<CosmeticSlot, string>>> = {},
  ): void {
    const carrots = inventory.carrot ?? 0;
    const levelChanged = this.lastEconomy.level !== economy.level;
    const carrotsChanged = this.lastCarrots !== carrots;
    this.lastNeeds = { ...needs };
    this.lastEconomy = economy;
    this.lastCarrots = carrots;
    this.lastInventory = inventory;
    this.equippedCosmetics = { ...equipped };
    if (this.currentPanel !== "wardrobe") this.wardrobeDraft = { ...equipped };
    for (const key of NEED_KEYS) {
      const need = this.root.querySelector<HTMLElement>(`[data-need="${key}"]`);
      const meter = need?.querySelector<HTMLElement>(".meter i");
      const value = need?.querySelector<HTMLElement>("[data-need-value]");
      const rounded = Math.round(needs[key]);
      if (meter) meter.style.width = `${needs[key]}%`;
      if (value) value.textContent = rounded.toString();
      need?.querySelector(".meter")?.setAttribute("aria-valuenow", rounded.toString());
      need?.classList.toggle("is-low", needs[key] < 30);
    }
    this.setText("[data-coins]", economy.coins.toString());
    this.setText("[data-xp]", economy.xp.toString());
    this.setText("[data-level]", economy.level.toString());
    const xpProgress = this.root.querySelector<HTMLElement>("[data-xp-progress]");
    if (xpProgress) xpProgress.style.width = `${getLevelProgress(economy) * 100}%`;
    this.inventoryCount.textContent = carrots.toString();
    if (!this.onboarding.hidden) {
      const previous = this.onboardingProgress.currentStep;
      this.onboardingProgress.observe(needs, carrots);
      if (previous !== this.onboardingProgress.currentStep) this.renderOnboarding();
    }
    if ((this.currentPanel === "play" && levelChanged) || (this.currentPanel === "items" && carrotsChanged)) {
      this.renderPanel();
    }
  }

  showOnboarding(): void {
    if (this.lastNeeds) this.onboardingProgress.begin(this.lastNeeds, this.lastCarrots);
    this.onboarding.hidden = false;
    this.root.classList.add("is-onboarding");
    this.renderOnboarding();
  }

  setSleeping(sleeping: boolean, remainingMs = 0): void {
    this.sleepOverlay.hidden = !sleeping;
    this.sleepCountdown.textContent = formatCountdown(remainingMs);
    this.sleepProgress.style.width = `${Math.max(0, Math.min(1, 1 - remainingMs / SLEEP_DURATION_MS)) * 100}%`;
    this.root.classList.toggle("is-sleeping", sleeping);
    if (sleeping) this.closeModal();
    if (this.wasSleeping === true && !sleeping) this.showWakeCelebration();
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

  showResults(gameId: MinigameId, payout: MinigamePayout): void {
    const result = this.model.recordResult(gameId, payout.score);
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
    this.root.replaceChildren();
  }

  private readonly handleClick = (event: MouseEvent): void => {
    const button = (event.target as Element).closest<HTMLButtonElement>("button");
    if (!button) return;
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
      if (action === "results-done") this.openPanel("play");
    } else if (action === "wardrobe-preview") {
      const slot = button.dataset.slot as CosmeticSlot;
      const item = button.dataset.item;
      if (item) this.wardrobeDraft[slot] = item;
      else delete this.wardrobeDraft[slot];
      this.renderPanel();
    } else if (action === "wardrobe-equip") {
      const slot = button.dataset.slot as CosmeticSlot;
      const itemId = this.wardrobeDraft[slot] ?? null;
      this.model.equip(slot, itemId);
      this.equippedCosmetics = { ...this.model.persisted.equipped };
      this.actions.equipCosmetic(slot, itemId);
      this.renderPanel();
      this.toast(STRINGS.toasts.outfitSaved);
    } else if (action === "items-tab") {
      this.itemsTab = button.dataset.tab === "furniture" ? "furniture" : "food";
      this.renderPanel();
    } else if (action === "place-item") {
      const item = button.dataset.item ?? "";
      this.closePanel();
      this.actions.placeFurniture(item);
    } else if (action === "toggle-setting") {
      const key = button.dataset.preference as PreferenceKey;
      const enabled = !this.model.persisted.preferences[key];
      this.model.setPreference(key, enabled);
      this.actions.preferenceChanged(key, enabled);
      this.applyPreferences();
      this.renderPanel();
      this.toast(STRINGS.toasts.settingSaved);
    } else if (action === "sleep-confirm") {
      this.model.markSleepRationaleSeen();
      this.closeModal();
      this.actions.sleep();
    } else if (action === "wake-celebration") {
      this.closeModal();
    } else if (action === "pause") {
      this.actions.pauseMinigame();
    }
  };

  private openPanel(panel: PanelId): void {
    this.currentPanel = panel;
    this.sheet.hidden = false;
    const backdrop = this.root.querySelector<HTMLElement>(".sheet-backdrop");
    if (backdrop) backdrop.hidden = false;
    this.root.classList.add("has-sheet");
    for (const navButton of this.root.querySelectorAll<HTMLElement>("[data-panel]")) {
      navButton.classList.toggle("active", navButton.dataset.panel === panel);
    }
    this.renderPanel();
    requestAnimationFrame(() => this.sheet.querySelector<HTMLElement>("button")?.focus());
  }

  private closePanel(): void {
    this.currentPanel = null;
    this.sheet.hidden = true;
    const backdrop = this.root.querySelector<HTMLElement>(".sheet-backdrop");
    if (backdrop) backdrop.hidden = true;
    this.root.classList.remove("has-sheet");
    for (const navButton of this.root.querySelectorAll<HTMLElement>("[data-panel]")) {
      navButton.classList.remove("active");
    }
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
                  <i>·</i><small>${STRINGS.wardrobe.none}</small>
                </button>
                ${items.map((item) => `
                  <button class="${selected === item.id ? "selected" : ""}" data-ui-action="wardrobe-preview" data-slot="${slot}" data-item="${item.id}">
                    <i>${slot === "head" ? "☀" : slot === "ears" ? "❀" : slot === "neck" ? "⌁" : "♧"}</i><small>${item.name}</small>
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
      <div class="segmented-control" role="tablist">
        <button class="${this.itemsTab === "food" ? "active" : ""}" data-ui-action="items-tab" data-tab="food" role="tab">${STRINGS.items.food}</button>
        <button class="${this.itemsTab === "furniture" ? "active" : ""}" data-ui-action="items-tab" data-tab="furniture" role="tab">${STRINGS.items.furniture}</button>
      </div>
      <div class="sheet-content">
        ${this.itemsTab === "food" ? `
          <div class="inventory-list">
            <article class="inventory-card">
              <span class="inventory-art carrot-art">🥕</span>
              <div><b>${STRINGS.items.carrot}</b><p>${STRINGS.items.carrotBody}</p><small>${STRINGS.items.owned(this.lastCarrots)}</small></div>
              <button class="mini-action" data-ui-action="feed" ${this.lastCarrots <= 0 ? "disabled" : ""}>${STRINGS.actions.feed}</button>
            </article>
          </div>
        ` : `
          <div class="inventory-list">
            ${FURNITURE_CATALOG.filter((item) => (this.lastInventory[item.id] ?? 0) > 0).map((item) => `
              <article class="inventory-card">
                <span class="inventory-art furniture-art">▱</span>
                <div><b>${item.name}</b><small>${STRINGS.items.owned(this.lastInventory[item.id] ?? 0)}</small></div>
                <button class="mini-action" data-ui-action="place-item" data-item="${item.id}">${STRINGS.actions.place}</button>
              </article>
            `).join("") || '<p class="empty-state">Find cozy furniture at Cloud Boutique.</p>'}
          </div>
        `}
      </div>
    `;
  }

  private renderSettings(): void {
    const preferences = this.model.persisted.preferences;
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
        <article class="info-card">
          <span>♡</span><div><h3>${STRINGS.settings.privacy}</h3><p>${STRINGS.settings.privacyBody}</p></div>
        </article>
        <article class="info-card">
          <span>✦</span><div><h3>${STRINGS.settings.credits}</h3><p>${STRINGS.settings.creditsBody}</p></div>
        </article>
      </div>
    `;
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
        <div><b>${STRINGS.onboarding.petTitle}</b><p>${STRINGS.onboarding.petBody}</p><small>${STRINGS.onboarding.petHint}</small></div>
      `;
    } else if (step === "feed") {
      coach.innerHTML = `
        <span class="coach-step">2 / 3</span>
        <i class="coach-icon">🥕</i>
        <div><b>${STRINGS.onboarding.feedTitle}</b><p>${STRINGS.onboarding.feedBody}</p><small>${STRINGS.onboarding.feedHint}</small></div>
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
    this.modalBody.innerHTML = content;
    this.modal.hidden = false;
    requestAnimationFrame(() => this.modalBody.querySelector<HTMLElement>("button")?.focus());
  }

  private closeModal(): void {
    this.modal.hidden = true;
    this.modalBody.replaceChildren();
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
