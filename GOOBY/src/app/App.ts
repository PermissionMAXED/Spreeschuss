import { GoobyAudioSystem, type AudioEvents, type MusicZone } from "../audio";
import { AUDIO_BUSES, type AudioBus } from "../core/contracts/audio";
import { FakeClock, RealClock, type Clock } from "../core/contracts/clock";
import { grantReward } from "../core/contracts/economy";
import { EventBus, type GameEvents } from "../core/contracts/events";
import { isLanguageSetting, type LanguageSetting } from "../core/contracts/i18n";
import type { Gesture } from "../core/contracts/input";
import type {
  MinigameSettlementReceipt,
} from "../core/contracts/minigame";
import { SeededRng } from "../core/contracts/rng";
import {
  loadSave,
  SaveStateSchema,
  UI_SCALE_DEFAULT,
  type CanonicalSaveState,
  type SaveState,
} from "../core/contracts/save";
import type {
  HomeZoneId,
  MinigameId,
  SceneContext,
  SceneId,
  ShopId,
} from "../core/contracts/scenes";
import {
  HOME_ZONE_IDS,
  MINIGAME_IDS,
  SHOP_IDS,
} from "../core/contracts/scenes";
import {
  advanceSimulation,
  catchUpOffline,
  startSleep,
} from "../core/contracts/simulation";
import { applyLanguageSetting } from "../i18n";
import { createPlatform, configureNativeShell } from "../core/platform";
import { PointerInput } from "../core/pointer-input";
import { SceneManager, type SceneFactory } from "../core/scene-manager";
import { CATALOG_BY_ID, type CosmeticSlot } from "../data/catalog";
import { HOME_GRID_SIZE, HOME_ZONE_BLUEPRINTS } from "../data/home";
import { FxDirector, type FxEvents } from "../fx/director";
import { DomFx } from "../fx";
import { HapticDirector } from "../haptics";
import { MINIGAME_REGISTRY } from "../minigames/registry";
import { PerformanceProbe } from "../perf";
import { createRuntimeAssetLoader } from "../render/assets";
import { ResourceTracker, GameRenderer } from "../render/renderer";
import {
  CityRouteMachine,
  createCityDriveScene,
  type CityTravelSnapshot,
} from "../scenes/city";
import type { CityDriveScene } from "../scenes/city";
import {
  Bathroom,
  createHomeZone,
  type HomeEvent,
  type HomeZoneScene,
} from "../scenes/home";
import {
  ShopVisitHistory,
  createShopScene,
  issueCityShopArrival,
  type CityShopArrival,
} from "../scenes/shops";
import { GameUI, type UiActions } from "../ui";
import {
  readLegacyUiState,
  removeLegacyUiState,
  type PreferenceKey,
} from "../ui/model";
import { MinigameScene } from "./minigame-scene";
import {
  createSleepCompletionNotification,
  SLEEP_NOTIFICATION_ID,
} from "./notification-policy";
import { ReplayableSaveCoordinator, type ReplayableSaveReducer } from "./save-coordinator";
import {
  beginSleepReducer,
  catchUpOfflineReducer,
  consumeFoodReducer,
  migrateLegacyUiReducer,
  reconcileExternalState,
  sanitizeCanonicalUi,
  savedTravelSnapshot,
  setBusVolumeReducer,
  setDevWorkshopUnlockedReducer,
  setLanguageReducer,
  setQuietHoursReducer,
  settlementReceiptForRun,
  settleMinigameReducer,
  setUiScaleReducer,
  wakeReducer,
  withTravelSnapshotReducer,
} from "./state-reducers";

interface RuntimeDebugSnapshot {
  readonly sceneId: SceneId | null;
  readonly cityPhase: string | null;
  readonly cityCar: {
    readonly position: readonly [number, number];
    readonly headingRadians: number;
  } | null;
  readonly cityRoute: readonly (readonly [number, number])[] | null;
  readonly sceneChildren: number;
  readonly activeMinigame: MinigameId | null;
  readonly minigameRoots: number;
  readonly disposed: boolean;
  readonly audio: {
    readonly unlocked: boolean;
    readonly theme: string | null;
    readonly muted: boolean;
    readonly hapticsMuted: boolean;
  };
  readonly renderer: {
    readonly geometries: number;
    readonly textures: number;
    readonly drawCalls: number;
    readonly fogEnabled: boolean;
    readonly qualityTier: string | null;
  };
}

interface GoobyDebugSurface {
  readonly version: 1;
  snapshot(): SaveState | null;
  performance(): ReturnType<PerformanceProbe["snapshot"]>;
  runtime(): RuntimeDebugSnapshot;
  test?: {
    advanceTime(durationMs: number): void;
    advanceMinigameTime(durationMs: number): void;
    grantProgressionXp(xp: number): void;
    completeCityLeg(): void;
    feed(): void;
    sleep(): void;
    wake(): void;
    setUiScale(scale: number): void;
    setVolume(bus: string, volume: number): void;
    setLanguage(setting: string): void;
    setDevWorkshopUnlocked(unlocked: boolean): void;
    flushSave(): Promise<void>;
    clearSave(): Promise<void>;
    dispose(): Promise<void>;
  };
}

declare global {
  interface Window {
    __gooby: GoobyDebugSurface;
  }
}

const CITY_VISIT_PREFIX = "__city.visited.v1|";

function cityVisitKey(shop: ShopId): string {
  return `${CITY_VISIT_PREFIX}${shop}`;
}

function visitedShops(state: CanonicalSaveState): readonly ShopId[] {
  return state.travel.visitedShops;
}

export class GoobyApp {
  private readonly realClock = new RealClock();
  private readonly fakeClock: FakeClock | null;
  private readonly clock: Clock;
  private readonly platform;
  private readonly ui: GameUI;
  private readonly renderer: GameRenderer;
  private readonly tracker = new ResourceTracker();
  private readonly input: PointerInput;
  private readonly fx: DomFx;
  private readonly fxDirector: FxDirector;
  private readonly hapticDirector: HapticDirector;
  private readonly audio: GoobyAudioSystem;
  private readonly gameEvents = new EventBus<GameEvents>();
  private readonly audioEvents = new EventBus<AudioEvents>();
  private readonly fxEvents = new EventBus<FxEvents>();
  private readonly assetLoader = createRuntimeAssetLoader();
  private readonly perf = new PerformanceProbe();
  private readonly rng = new SeededRng(0x60b1cafe);
  private readonly sceneManager: SceneManager;
  private readonly removeDirectors: Array<() => void> = [];
  private cityController = new CityRouteMachine();
  private visitHistory = new ShopVisitHistory();
  private activeHome: HomeZoneScene | null = null;
  private activeCity: CityDriveScene | null = null;
  private activeMinigame: MinigameScene | null = null;
  private pendingArrival: CityShopArrival | null = null;
  private state: CanonicalSaveState | null = null;
  private saveCoordinator: ReplayableSaveCoordinator | null = null;
  private frame = 0;
  private previousFrameAt = performance.now();
  private previousInteractionAt = Number.NEGATIVE_INFINITY;
  private lastHudRefreshAt = Number.NEGATIVE_INFINITY;
  private particleDensity = 1;
  private readonly settlementCommits = new Map<string, Promise<void>>();
  private readonly settlementNewBest = new Map<string, boolean>();
  private removeNativeListener: () => void = () => undefined;
  private currentMusicZone: MusicZone = "home:living-room";
  private cityTripActive = false;
  private previousCityPhase = "destination-board";
  private minigameFinishing = false;
  private audioUnlockInstalled = false;
  private disposed = false;
  /** Sleep sessions (keyed by startedAt) whose wake feedback already fired. */
  private lastSettledSleepStart: number | null = null;

  constructor(private readonly mount: HTMLElement) {
    this.fakeClock = import.meta.env.DEV || import.meta.env.MODE === "test"
      ? new FakeClock(this.realClock.now())
      : null;
    this.clock = this.fakeClock ?? this.realClock;
    this.platform = createPlatform(this.clock);
    const actions: UiActions = {
      feedback: (action) => {
        void this.ensureAudio().then(() => this.audioEvents.emit("audio:ui", { action }));
      },
      pet: () => this.keyboardPet(),
      feed: () => this.feed(),
      consumeFood: (itemId) => this.consumeFood(itemId),
      bathe: () => this.bathe(),
      sleep: () => this.sleep(),
      confirmSleep: () => this.confirmSleep(),
      wake: () => this.wake(),
      navigateHome: (zone) => {
        void this.navigateHome(zone);
      },
      openCity: () => {
        void this.openCity();
      },
      startMinigame: (game) => {
        void this.startMinigame(game);
      },
      pauseMinigame: () => this.activeMinigame?.pause(),
      resumeMinigame: () => this.activeMinigame?.resume(),
      exitMinigame: () => {
        void this.exitMinigame();
      },
      equipCosmetic: (slot, itemId) => this.equipCosmetic(slot, itemId),
      placeFurniture: (itemId) => this.placeFurniture(itemId),
      moveDecor: (direction) => this.moveDecor(direction),
      rotateDecor: () => this.rotateDecor(),
      removeDecor: () => this.removeDecor(),
      preferenceChanged: (key, enabled) => this.preferenceChanged(key, enabled),
      quietHoursChanged: (quietHours) => this.quietHoursChanged(quietHours),
      onboardingComplete: () => this.completeOnboarding(),
      clearLocalData: () => {
        void this.clearLocalData();
      },
    };
    this.ui = new GameUI(mount, actions);
    this.renderer = new GameRenderer(this.ui.canvas);
    this.input = new PointerInput(this.ui.canvas, this.clock);
    this.fx = new DomFx(this.ui.fxLayer, { clock: this.clock, rng: this.rng });
    this.perf.connectRenderer(this.renderer);
    this.removeDirectors.push(this.perf.onQualityChange(({ particleDensity }) => {
      this.particleDensity = particleDensity;
      this.applyFxPreference();
    }));
    this.fxDirector = new FxDirector(
      this.fx,
      () => this.ui.canvas.clientWidth / 2,
      () => this.ui.canvas.clientHeight / 2,
    );
    this.hapticDirector = new HapticDirector(this.platform.haptics);
    this.audio = new GoobyAudioSystem(this.clock, this.rng);
    this.removeDirectors.push(
      this.audio.bind(this.audioEvents, this.gameEvents),
      this.fxDirector.bindFxEvents(this.fxEvents),
      this.fxDirector.bindAudioEvents(this.audioEvents),
      this.hapticDirector.bindAudioEvents(this.audioEvents),
      this.hapticDirector.bindGameEvents(this.gameEvents),
    );
    this.sceneManager = new SceneManager(this.createSceneRegistry(), this.sceneContext());
    this.installAudioUnlock();
  }

  async boot(): Promise<void> {
    const loaded = await loadSave(this.platform.save, this.clock.now());
    this.state = loaded.state;
    this.saveCoordinator = new ReplayableSaveCoordinator(
      this.platform.save,
      () => this.clock.now(),
      loaded.state,
      loaded.revision,
      (state, reason) => this.installState(state, reason === "optimistic"),
    );
    this.ui.syncCanonical(loaded.state, this.clock.now());
    const setupCommits: Promise<void>[] = [];
    const bootNow = this.clock.now();
    const caughtUp = catchUpOffline(loaded.state.simulation, bootNow);
    if (caughtUp !== loaded.state.simulation) {
      setupCommits.push(this.applyReducer(catchUpOfflineReducer(bootNow)));
    }
    if (loaded.recovered) setupCommits.push(this.applyReducer((state) => state));

    const storage = typeof localStorage === "undefined" ? undefined : localStorage;
    const legacyUi = readLegacyUiState(storage);
    let legacyMigration: Promise<void> | null = null;
    if (legacyUi) {
      legacyMigration = this.applyReducer(migrateLegacyUiReducer(legacyUi));
      setupCommits.push(legacyMigration);
    }
    const legacyVisits = SHOP_IDS.filter((shop) => (this.requireState().inventory[cityVisitKey(shop)] ?? 0) > 0);
    if (legacyVisits.length > 0) {
      setupCommits.push(this.applyReducer((state) => {
        const inventory = { ...state.inventory };
        for (const shop of SHOP_IDS) delete inventory[cityVisitKey(shop)];
        return SaveStateSchema.parse({
          ...state,
          inventory,
          travel: {
            ...state.travel,
            visitedShops: [...new Set([...state.travel.visitedShops, ...legacyVisits])],
          },
        });
      }));
    }
    const sanitized = sanitizeCanonicalUi(this.requireState());
    if (sanitized !== this.state) setupCommits.push(this.applyReducer(sanitizeCanonicalUi));
    await Promise.all(setupCommits);
    if (legacyMigration) removeLegacyUiState(storage);

    const visits = visitedShops(this.state);
    this.cityController = new CityRouteMachine(visits, savedTravelSnapshot(this.state));
    this.visitHistory = new ShopVisitHistory();
    for (const shop of visits) this.visitHistory.leaveForTown(shop);
    this.audioEvents.emit("audio:mute", { muted: this.state.settings.muted });
    this.platform.audio.setMuted(this.state.settings.muted);
    this.hapticDirector.setMuted(!this.state.settings.haptics);
    this.platform.notifications.setForeground(true);
    this.applyUiScalePreference();
    this.applyLanguagePreference();
    this.applyFxPreference();
    this.refreshUi();
    this.updateSleepUi();
    if (!this.state.profile.onboardingComplete) this.ui.showOnboarding();
    if (loaded.recovered) this.toast("Your cozy home was repaired with a fresh save.");

    this.renderer.resize();
    const restoredPhase = this.cityController.state.phase;
    const restoreCity = restoredPhase !== "destination-board";
    this.cityTripActive = restoreCity;
    await this.goToScene(restoreCity ? "city:drive" : "home:living-room");
    if (this.state.simulation.sleep) this.audio.sounds.setZone("lullaby");
    this.input.subscribe(this.handleGesture);
    window.addEventListener("resize", this.resize);
    document.addEventListener("visibilitychange", this.onVisibilityChange);
    window.addEventListener("pagehide", this.onPageHide);
    this.removeNativeListener = await configureNativeShell({
      onBackground: () => {
        this.platform.notifications.setForeground(false);
        void this.persist();
      },
      onForeground: () => {
        this.platform.notifications.setForeground(true);
        this.resumeSimulation();
      },
    });
    this.installDebugSurface();
    this.previousFrameAt = performance.now();
    this.frame = requestAnimationFrame(this.loop);
    this.mount.dataset.ready = "true";
  }

  private createSceneRegistry(): ReadonlyMap<SceneId, SceneFactory> {
    const registry = new Map<SceneId, SceneFactory>();
    for (const zone of HOME_ZONE_IDS) {
      registry.set(`home:${zone}`, () => {
        const scene = createHomeZone(zone, this.renderer, this.tracker, {
          clock: this.clock,
          assetLoader: this.assetLoader,
          readSave: () => this.state,
          writeSave: (state) => this.acceptState(state),
          onEvent: (event) => this.handleHomeEvent(event),
        });
        scene.equipCatalogCosmetics(this.requireState().ui.equipped);
        this.activeHome = scene;
        return scene;
      });
    }
    registry.set("city:drive", () => {
      const scene = createCityDriveScene({
        renderer: this.renderer,
        mount: this.mount,
        controller: this.cityController,
        assetLoader: this.assetLoader,
        economy: this.requireState().economy,
        onEconomyChanged: (economy) => {
          this.acceptState({ ...this.requireState(), economy });
        },
        onStateChanged: (state) => this.handleCityState(state.phase, state.phase === "driving-outbound" ? state.selected : undefined),
        onEnterShop: (shop, activeScene) => {
          void this.enterShop(shop, activeScene);
        },
        onCoinsCollected: (count) => {
          this.audioEvents.emit("audio:economy", { action: "coin", amount: count });
        },
        onBoost: () => {
          this.audioEvents.emit("audio:car", { action: "pickup", intensity: 1 });
        },
        onTravelSnapshotChanged: (snapshot) => this.saveTravelSnapshot(snapshot),
      });
      this.activeCity = scene;
      return scene;
    });
    for (const shop of SHOP_IDS) {
      registry.set(`shop:${shop}`, () => {
        const arrival = this.pendingArrival;
        if (!arrival || arrival.shopId !== shop) {
          throw new Error(`Shop ${shop} requires its matching city arrival`);
        }
        this.pendingArrival = null;
        const scene = createShopScene(shop, arrival, {
          renderer: this.renderer,
          mount: this.mount,
          getState: () => this.requireState(),
          setState: (state) => this.acceptState(state),
          visitHistory: this.visitHistory,
          equippedCosmetics: this.requireState().ui.equipped,
          onTryOnChanged: (equipped) => {
            this.activeHome?.equipCatalogCosmetics(equipped);
          },
          onTownExit: async () => this.returnToCity(shop),
          onMessage: (message) => this.toast(message),
        });
        return scene;
      });
    }
    for (const game of MINIGAME_IDS) {
      registry.set(`minigame:${game}`, () => {
        const factory = MINIGAME_REGISTRY.get(game);
        if (!factory) throw new Error(`Missing minigame factory: ${game}`);
        const scene = new MinigameScene(
          factory(),
          this.ui.minigameMount,
          this.clock,
          this.rng,
          {
            persistence: {
              getBestScore: (id) => this.requireState().ui.highScores[id] ?? 0,
              getSettlement: (runId) =>
                settlementReceiptForRun(this.requireState(), runId),
              settle: (receipt) => this.settleMinigame(receipt),
            },
            audio: {
              emit: (action, value) => {
                this.audioEvents.emit("audio:minigame", {
                  action,
                  ...(action === "combo" && value !== undefined ? { combo: value } : {}),
                  ...(action === "score" && value !== undefined ? { score: value } : {}),
                });
              },
            },
            haptics: {
              impact: (pattern) => {
                void this.platform.haptics.impact(pattern).catch(() => undefined);
              },
            },
            hapticsEnabled: () => this.requireState().settings.haptics,
            reducedMotion: this.requireState().settings.reducedMotion,
            onSettled: (receipt) => this.finishMinigame(game, receipt),
            ...(this.fakeClock
              ? { advanceClock: (durationMs: number) => this.fakeClock?.advance(durationMs) }
              : {}),
          },
        );
        this.activeMinigame = scene;
        return scene;
      });
    }
    return registry;
  }

  private sceneContext(): SceneContext {
    return {
      viewport: {
        width: Math.max(1, this.ui.canvas.clientWidth),
        height: Math.max(1, this.ui.canvas.clientHeight),
        pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
      },
    };
  }

  private readonly resize = (): void => {
    this.renderer.resize();
    this.sceneManager.resize(this.sceneContext());
  };

  private readonly loop = (frameAt: number): void => {
    const frameMs = Math.min(100, Math.max(0, frameAt - this.previousFrameAt));
    this.previousFrameAt = frameAt;
    if (this.fakeClock) this.fakeClock.advance(frameMs);
    this.perf.sample(frameMs);
    this.tick(frameMs / 1_000);
    this.frame = requestAnimationFrame(this.loop);
  };

  private tick(deltaSeconds: number): void {
    if (!this.state || this.disposed) return;
    const sleepingSince = this.state.simulation.sleep?.startedAt ?? null;
    this.state = {
      ...this.state,
      simulation: advanceSimulation(this.state.simulation, this.clock.now()),
    };
    this.saveCoordinator?.replaceLocalState(this.state);
    this.completeSleepIfNeeded(sleepingSince);
    this.activeHome?.gooby.updateNeeds(this.state.simulation.needs);
    this.sceneManager.update(deltaSeconds);
    this.renderer.render();
    this.updateSleepUi();
    if (this.clock.now() - this.lastHudRefreshAt >= 250) {
      this.lastHudRefreshAt = this.clock.now();
      this.refreshUi();
    }
  }

  private readonly handleGesture = (gesture: Gesture): void => {
    if (!this.state || this.state.simulation.sleep) return;
    if (gesture.type === "press-start") {
      void this.ensureAudio();
    }
    if (!this.sceneManager.activeId?.startsWith("home:") || !this.activeHome) return;
    if (gesture.type === "press-move") {
      if (
        Math.hypot(gesture.dx, gesture.dy) > 22 &&
        this.clock.now() - this.previousInteractionAt > 280 &&
        this.activeHome.hitGooby(gesture.x, gesture.y)
      ) {
        this.react("tickle", gesture.x, gesture.y);
        return;
      }
    } else if (gesture.type === "tap" && this.activeHome.hitGooby(gesture.x, gesture.y)) {
      this.react("pet", gesture.x, gesture.y);
      return;
    } else if (gesture.type === "double-tap" && this.activeHome.hitGooby(gesture.x, gesture.y)) {
      this.react("poke", gesture.x, gesture.y);
      return;
    }
    this.activeHome.handleGesture(gesture);
  };

  private react(reaction: "pet" | "tickle" | "poke", x: number, y: number): void {
    this.previousInteractionAt = this.clock.now();
    this.activeHome?.react(reaction);
    this.fxEvents.emit("fx:burst", {
      kind: reaction === "tickle" ? "sparkles" : reaction === "poke" ? "stars" : "hearts",
      x,
      y,
      count: reaction === "tickle" ? 9 : 5,
    });
    this.emitGooby(reaction);
    this.refreshUi();
  }

  private keyboardPet(): void {
    if (!this.activeHome || this.state?.simulation.sleep) return;
    this.previousInteractionAt = this.clock.now();
    this.activeHome.react("pet");
    this.emitGooby("pet");
    this.refreshUi();
  }

  private feed(): void {
    this.consumeInventoryFood("carrot", 22, 10, "Sunny carrot");
  }

  private consumeFood(itemId: string): void {
    const item = CATALOG_BY_ID.get(itemId);
    if (item?.kind !== "food") {
      this.audioEvents.emit("audio:ui", { action: "denied" });
      return;
    }
    this.consumeInventoryFood(item.id, item.hunger, item.xp, item.name);
  }

  private consumeInventoryFood(itemId: string, hunger: number, xp: number, label: string): void {
    if (!this.state) return;
    void this.ensureAudio();
    if (this.state.simulation.sleep) {
      this.toast("Shh… Gooby is dreaming.");
      return;
    }
    if ((this.state.inventory[itemId] ?? 0) <= 0) {
      this.toast(`No ${label.toLocaleLowerCase()} left—visit the market soon!`);
      return;
    }
    void this.applyReducer(consumeFoodReducer(itemId, hunger, xp, this.clock.now()));
    this.activeHome?.react("feed");
    this.fxEvents.emit("fx:burst", {
      kind: "crumbs",
      x: this.ui.canvas.clientWidth / 2,
      y: this.ui.canvas.clientHeight * 0.55,
      count: 8,
    });
    this.emitGooby("feed");
    this.toast(`Crunch! Full +${hunger} · XP +${xp}`);
  }

  private bathe(): void {
    if (!this.state || !(this.activeHome instanceof Bathroom)) {
      this.toast("The bubble bath is in the Bathroom.");
      return;
    }
    this.activeHome.fillTub();
    this.activeHome.scrub(1);
    this.activeHome.gooby.react("bathe");
    this.audioEvents.emit("audio:gooby", { action: "bathe" });
    this.refreshUi();
  }

  private sleep(): void {
    this.beginSleep(false);
  }

  private confirmSleep(): void {
    this.beginSleep(true);
  }

  private beginSleep(markRationaleSeen: boolean): void {
    if (!this.state) return;
    void this.ensureAudio();
    if (this.state.simulation.sleep) return;
    const now = this.clock.now();
    const simulation = startSleep(this.state.simulation, now);
    void this.applyReducer(beginSleepReducer(now, markRationaleSeen));
    this.activeHome?.setSleeping(true);
    this.emitGooby("sleep");
    this.audio.sounds.setZone("lullaby");
    const sleep = simulation.sleep;
    if (sleep) this.scheduleSleepCompletionNotification(sleep.completesAt);
    this.updateSleepUi();
  }

  private wake(): void {
    const sleep = this.state?.simulation.sleep;
    if (!sleep) return;
    // Mark the session settled before feedback so the tick-side settlement
    // cannot fire a duplicate wake celebration for the same sleep.
    this.lastSettledSleepStart = sleep.startedAt;
    void this.applyReducer(wakeReducer(this.clock.now()));
    this.activeHome?.setSleeping(false);
    this.emitGooby("wake");
    this.audio.sounds.setZone(this.currentMusicZone);
    this.cancelSleepNotification();
    this.toast("Good morning, sleepy bun.");
    this.updateSleepUi();
  }

  private completeOnboarding(): void {
    if (!this.state) return;
    this.acceptState({
      ...this.state,
      profile: { ...this.state.profile, onboardingComplete: true },
    });
    this.activeHome?.react("pet");
    this.emitGooby("pet");
    this.toast("Gooby is happy you’re here ♥");
  }

  private async navigateHome(zone: HomeZoneId): Promise<void> {
    if (this.cityTripActive) {
      this.audioEvents.emit("audio:ui", { action: "denied" });
      this.toast("Finish the return drive before heading home.");
      return;
    }
    await this.goToScene(`home:${zone}`);
  }

  private async openCity(): Promise<void> {
    if (this.state?.simulation.sleep) {
      this.toast("Gooby needs to wake before a city trip.");
      return;
    }
    await this.goToScene("city:drive");
    this.handleCityState(this.cityController.state.phase);
  }

  private async startMinigame(game: MinigameId): Promise<void> {
    if (this.cityTripActive) {
      this.toast("Finish the city trip before starting an adventure.");
      return;
    }
    this.minigameFinishing = false;
    this.ui.closeTransientUi();
    await this.goToScene(`minigame:${game}`);
    this.ui.setSceneChrome({ kind: "minigame", title: this.activeMinigame?.module.title ?? game });
  }

  private settleMinigame(receipt: MinigameSettlementReceipt): MinigameSettlementReceipt {
    const existing = settlementReceiptForRun(this.requireState(), receipt.runId);
    if (existing) return existing;
    const previousBest = this.requireState().ui.highScores[receipt.minigameId] ?? 0;
    this.settlementNewBest.set(receipt.runId, receipt.payout.score > previousBest);
    const committed = this.applyReducer(settleMinigameReducer(receipt));
    this.settlementCommits.set(receipt.runId, committed);
    return settlementReceiptForRun(this.requireState(), receipt.runId) ?? receipt;
  }

  private async finishMinigame(
    game: MinigameId,
    receipt: MinigameSettlementReceipt,
  ): Promise<void> {
    if (this.minigameFinishing || !this.state) return;
    this.minigameFinishing = true;
    try {
      await (this.settlementCommits.get(receipt.runId) ?? this.persist());
      const persisted = settlementReceiptForRun(this.requireState(), receipt.runId) ?? receipt;
      this.ui.showResults(game, persisted.payout, {
        isNewBest: (this.settlementNewBest.get(receipt.runId) ?? false)
          && persisted.payout.score >= persisted.bestScore,
        best: persisted.bestScore,
      });
    } catch {
      this.minigameFinishing = false;
      this.toast("Reward save failed. Please try collecting again.");
    }
  }

  private async exitMinigame(): Promise<void> {
    if (!this.sceneManager.activeId?.startsWith("minigame:")) return;
    this.minigameFinishing = false;
    await this.goToScene("home:living-room");
  }

  private async enterShop(shop: ShopId, city: CityDriveScene): Promise<void> {
    this.pendingArrival = issueCityShopArrival(city.controller.state);
    await this.goToScene(`shop:${shop}`);
    this.ui.setSceneChrome({ kind: "city", phase: "shop", destination: shop });
  }

  private async returnToCity(shop: ShopId): Promise<void> {
    await this.goToScene("city:drive");
    this.activeCity?.completeShopVisit();
    const state = this.requireState();
    if (!state.travel.visitedShops.includes(shop)) {
      void this.applyReducer((current) => SaveStateSchema.parse({
        ...current,
        travel: {
          ...current.travel,
          visitedShops: [...new Set([...current.travel.visitedShops, shop])],
        },
      }));
    }
  }

  private saveTravelSnapshot(snapshot: CityTravelSnapshot): void {
    if (!this.state) return;
    const reducer = withTravelSnapshotReducer(snapshot);
    if (reducer(this.state) === this.state) return;
    void this.applyReducer(reducer);
  }

  private handleCityState(phase: string, selected?: ShopId): void {
    const wasDriving = this.previousCityPhase === "driving-outbound" || this.previousCityPhase === "driving-home";
    const driving = phase === "driving-outbound" || phase === "driving-home";
    if (!wasDriving && driving) this.audioEvents.emit("audio:car", { action: "engine-start", intensity: 0.7 });
    if (wasDriving && !driving) this.audioEvents.emit("audio:car", { action: "engine-stop", intensity: 0.5 });
    this.previousCityPhase = phase;
    this.cityTripActive = phase !== "destination-board" && phase !== "depart-ready";
    const state = this.cityController.state;
    const destination = selected ??
      (state.phase === "depart-ready" || state.phase === "driving-outbound" || state.phase === "arrived"
        ? state.selected
        : undefined);
    this.ui.setSceneChrome({
      kind: "city",
      phase: driving ? "driving" : "board",
      ...(destination ? { destination } : {}),
    });
  }

  private equipCosmetic(slot: CosmeticSlot, itemId: string | null): boolean {
    if (itemId) {
      const item = CATALOG_BY_ID.get(itemId);
      if (
        item?.kind !== "cosmetic" ||
        item.slot !== slot ||
        (this.state?.inventory[item.id] ?? 0) <= 0
      ) {
        this.audioEvents.emit("audio:ui", { action: "denied" });
        this.toast("That look needs to be purchased at Fluff Salon first.");
        return false;
      }
    }
    void this.applyReducer((state) => {
      const equipped = { ...state.ui.equipped };
      if (itemId) {
        const item = CATALOG_BY_ID.get(itemId);
        if (item?.kind !== "cosmetic" || item.slot !== slot || (state.inventory[itemId] ?? 0) <= 0) {
          return state;
        }
        equipped[slot] = itemId;
      } else {
        delete equipped[slot];
      }
      return SaveStateSchema.parse({
        ...state,
        ui: { ...state.ui, equipped },
      });
    });
    this.activeHome?.equipCatalogCosmetics(this.requireState().ui.equipped);
    this.audioEvents.emit("audio:ui", { action: "confirm" });
    this.refreshUi();
    return true;
  }

  private placeFurniture(itemId: string): boolean {
    if (!this.activeHome || !this.sceneManager.activeId?.startsWith("home:")) {
      this.toast("Choose a home room before placing furniture.");
      return false;
    }
    if (this.activeHome.placeCatalogItem(itemId)) {
      this.audioEvents.emit("audio:ui", { action: "confirm" });
      return true;
    }
    return false;
  }

  private moveDecor(direction: "left" | "right" | "forward" | "back"): boolean {
    const home = this.activeHome;
    const selected = home?.getSelectedDecor();
    const placement = selected?.instanceId
      ? home?.getDecorPlacements().find(({ instanceId }) => instanceId === selected.instanceId)
      : null;
    if (!home || !placement) return false;
    const x = placement.gridX * HOME_GRID_SIZE
      + (direction === "left" ? -HOME_GRID_SIZE : direction === "right" ? HOME_GRID_SIZE : 0);
    const z = placement.gridZ * HOME_GRID_SIZE
      + (direction === "forward" ? -HOME_GRID_SIZE : direction === "back" ? HOME_GRID_SIZE : 0);
    const moved = home.moveSelectedDecor({ x, z });
    if (moved.valid) this.audioEvents.emit("audio:ui", { action: "confirm" });
    return moved.valid;
  }

  private rotateDecor(): boolean {
    const rotated = this.activeHome?.rotateSelectedDecor();
    if (rotated?.valid) this.audioEvents.emit("audio:ui", { action: "confirm" });
    return rotated?.valid ?? false;
  }

  private removeDecor(): boolean {
    const removed = this.activeHome?.removeSelectedDecor() ?? false;
    if (removed) this.audioEvents.emit("audio:ui", { action: "confirm" });
    return removed;
  }

  private preferenceChanged(key: PreferenceKey, enabled: boolean): void {
    if (!this.state) return;
    if (key === "audio" && !enabled) this.audioEvents.emit("audio:ui", { action: "confirm" });
    void this.applyReducer((state) => SaveStateSchema.parse({
      ...state,
      settings: {
        ...state.settings,
        ...(key === "audio" ? { muted: !enabled } : {}),
        ...(key === "haptics" ? { haptics: enabled } : {}),
        ...(key === "reducedMotion" ? { reducedMotion: enabled } : {}),
        ...(key === "notifications" ? { notifications: enabled } : {}),
      },
    }));
    if (key === "audio") {
      this.audioEvents.emit("audio:mute", { muted: !enabled });
      this.platform.audio.setMuted(!enabled);
      if (enabled) {
        void this.ensureAudio();
        this.audioEvents.emit("audio:ui", { action: "confirm" });
      }
    } else if (key === "haptics") {
      this.hapticDirector.setMuted(!enabled);
      if (enabled) this.audioEvents.emit("audio:ui", { action: "confirm" });
    } else if (key === "reducedMotion") {
      this.applyFxPreference();
      this.audioEvents.emit("audio:ui", { action: "confirm" });
    } else if (key === "notifications") {
      if (!enabled) this.cancelSleepNotification();
      else if (this.state.simulation.sleep) {
        this.scheduleSleepCompletionNotification(this.state.simulation.sleep.completesAt);
      }
      this.audioEvents.emit("audio:ui", { action: "confirm" });
    }
  }

  /** Publishes the persisted UI scale as a CSS variable on the app root. */
  private applyUiScalePreference(): void {
    const scale = this.state?.settings.uiScale ?? UI_SCALE_DEFAULT;
    this.mount.style.setProperty("--gooby-ui-scale", String(scale));
  }

  private applyLanguagePreference(): void {
    const locales = typeof navigator === "undefined" ? [] : navigator.languages ?? [];
    applyLanguageSetting(this.state?.settings.language ?? "auto", locales);
  }

  private setUiScale(scale: number): void {
    void this.applyReducer(setUiScaleReducer(scale));
    this.applyUiScalePreference();
  }

  private setBusVolume(bus: AudioBus, volume: number): void {
    void this.applyReducer(setBusVolumeReducer(bus, volume));
  }

  private setLanguageSetting(setting: LanguageSetting): void {
    void this.applyReducer(setLanguageReducer(setting));
    this.applyLanguagePreference();
  }

  private setDevWorkshopUnlocked(unlocked: boolean): void {
    void this.applyReducer(setDevWorkshopUnlockedReducer(unlocked));
  }

  private quietHoursChanged(quietHours: Parameters<typeof setQuietHoursReducer>[0]): void {
    if (!this.state) return;
    const completesAt = this.state.simulation.sleep?.completesAt;
    void this.applyReducer(setQuietHoursReducer(quietHours));
    if (completesAt && this.requireState().settings.notifications) {
      this.scheduleSleepCompletionNotification(completesAt);
    }
    this.audioEvents.emit("audio:ui", { action: "confirm" });
  }

  private handleHomeEvent(event: HomeEvent): void {
    if (event.type === "home:navigate" && event.destination.kind === "home") {
      void this.navigateHome(event.destination.zone);
    } else if (event.type === "minigame:selected") {
      void this.startMinigame(event.game);
    } else if (event.type === "toast") {
      this.toast(event.message);
    } else if (event.type === "need:changed") {
      this.gameEvents.emit("need:changed", {
        need: event.need,
        value: event.value,
      });
      this.refreshUi();
    }
  }

  private acceptState(state: SaveState): void {
    if (!this.state) return;
    void this.applyReducer(reconcileExternalState(this.state, state));
  }

  private applyReducer(reducer: ReplayableSaveReducer): Promise<void> {
    const coordinator = this.saveCoordinator;
    if (!coordinator) throw new Error("Cannot mutate before the canonical save coordinator is ready");
    const committed = coordinator.apply(reducer);
    void committed.catch((error: unknown) => {
      console.error("Save failed", error);
    });
    return committed;
  }

  private installState(state: CanonicalSaveState, emitFeedback: boolean): void {
    const previous = this.state;
    this.state = state;
    this.ui.syncCanonical(state, this.clock.now());
    this.activeHome?.gooby.updateNeeds(state.simulation.needs);
    if (previous && JSON.stringify(previous.ui.equipped) !== JSON.stringify(state.ui.equipped)) {
      this.activeHome?.equipCatalogCosmetics(state.ui.equipped);
    }
    if (previous && previous.settings.uiScale !== state.settings.uiScale) {
      this.applyUiScalePreference();
    }
    if (previous && previous.settings.language !== state.settings.language) {
      this.applyLanguagePreference();
    }
    this.refreshUi();
    this.gameEvents.emit("state:changed", {
      simulation: state.simulation,
      economy: state.economy,
    });
    if (emitFeedback && previous && state.economy.coins < previous.economy.coins) {
      this.audioEvents.emit("audio:economy", {
        action: "purchase",
        amount: previous.economy.coins - state.economy.coins,
      });
    }
  }

  private refreshUi(): void {
    if (!this.state) return;
    this.ui.update(
      this.state.simulation.needs,
      this.state.economy,
      this.state.inventory,
      this.state.ui.equipped,
      this.clock.now(),
    );
  }

  private updateSleepUi(): void {
    const sleep = this.state?.simulation.sleep;
    this.ui.setSleeping(Boolean(sleep), sleep ? sleep.completesAt - this.clock.now() : 0);
  }

  private async goToScene(id: SceneId): Promise<void> {
    this.activeHome = null;
    this.activeCity = null;
    this.activeMinigame = null;
    await this.sceneManager.goTo(id);
    this.perf.markTransition();
    this.gameEvents.emit("route:changed", { routeId: id });
    this.setMusicZone(id);
    if (id.startsWith("home:")) {
      const zone = id.slice("home:".length) as HomeZoneId;
      this.ui.setMinigameVisible(false);
      this.ui.setSceneChrome({ kind: "home", label: HOME_ZONE_BLUEPRINTS[zone].title });
      const home = this.activeHome as HomeZoneScene | null;
      home?.gooby.updateNeeds(this.requireState().simulation.needs);
    }
  }

  private setMusicZone(id: SceneId): void {
    const zone: MusicZone = id === "city:drive"
      ? "city"
      : id.startsWith("home:")
        ? id
        : id.startsWith("shop:")
          ? id
          : id;
    this.currentMusicZone = zone;
    this.audio.sounds.setZone(this.state?.simulation.sleep ? "lullaby" : zone);
  }

  private async ensureAudio(): Promise<void> {
    await Promise.all([
      this.audio.engine.unlock(),
      this.platform.audio.unlock(),
    ]).catch(() => undefined);
    this.audio.sounds.setZone(this.state?.simulation.sleep ? "lullaby" : this.currentMusicZone);
  }

  private emitGooby(kind: GameEvents["gooby:reaction"]["kind"]): void {
    this.gameEvents.emit("gooby:reaction", { kind });
  }

  private toast(message: string): void {
    this.ui.toast(message);
    this.gameEvents.emit("toast", { message });
  }

  private requireState(): CanonicalSaveState {
    if (!this.state) throw new Error("Gooby save state is not loaded");
    return this.state;
  }

  private persist(): Promise<void> {
    if (!this.saveCoordinator) return Promise.resolve();
    return this.applyReducer((state) => state).then(() => {
      this.gameEvents.emit("save:committed", { revision: this.saveCoordinator?.revision ?? 0 });
    });
  }

  private readonly onVisibilityChange = (): void => {
    if (document.visibilityState !== "visible") {
      this.platform.notifications.setForeground(false);
      void this.persist();
      return;
    }
    this.platform.notifications.setForeground(true);
    this.resumeSimulation();
  };

  private readonly onPageHide = (): void => {
    void this.persist();
  };

  private installDebugSurface(): void {
    const surface: GoobyDebugSurface = {
      version: 1,
      snapshot: () => this.state ? structuredClone(this.state) : null,
      performance: () => this.perf.snapshot(),
      runtime: () => {
        const city = this.activeCity?.debugSnapshot() ?? null;
        return {
          sceneId: this.sceneManager.activeId,
          cityPhase: this.sceneManager.activeId === "city:drive" ? this.cityController.state.phase : null,
          cityCar: city
            ? {
                position: city.car.position,
                headingRadians: city.car.headingRadians,
              }
            : null,
          cityRoute: city?.activeRoute ?? null,
          sceneChildren: this.renderer.scene.children.length,
          activeMinigame: this.activeMinigame?.module.id ?? null,
          minigameRoots: this.mount.querySelectorAll("[data-minigame]").length,
          disposed: this.disposed,
          audio: {
            unlocked: this.audio.engine.unlocked,
            theme: this.audio.music.currentTheme,
            muted: this.audio.sounds.isMuted,
            hapticsMuted: this.hapticDirector.isMuted,
          },
          renderer: {
            geometries: this.renderer.renderer.info.memory.geometries,
            textures: this.renderer.renderer.info.memory.textures,
            drawCalls: this.renderer.renderer.info.render.calls,
            fogEnabled: this.renderer.scene.fog !== null,
            qualityTier: typeof this.renderer.scene.userData.goobyQualityTier === "string"
              ? this.renderer.scene.userData.goobyQualityTier
              : null,
          },
        };
      },
    };
    if (import.meta.env.DEV || import.meta.env.MODE === "test") {
      surface.test = {
        advanceTime: (durationMs) => {
          this.fakeClock?.advance(durationMs);
          this.tick(0);
        },
        advanceMinigameTime: (durationMs) => this.activeMinigame?.advanceForTest(durationMs),
        grantProgressionXp: (xp) => {
          const state = this.requireState();
          this.acceptState({ ...state, economy: grantReward(state.economy, { xp }) });
        },
        completeCityLeg: () => this.activeCity?.completeCurrentLegForTest(),
        feed: () => this.feed(),
        sleep: () => this.sleep(),
        wake: () => this.wake(),
        setUiScale: (scale) => this.setUiScale(scale),
        setVolume: (bus, volume) => {
          if ((AUDIO_BUSES as readonly string[]).includes(bus)) {
            this.setBusVolume(bus as AudioBus, volume);
          }
        },
        setLanguage: (setting) => {
          if (isLanguageSetting(setting)) this.setLanguageSetting(setting);
        },
        setDevWorkshopUnlocked: (unlocked) => this.setDevWorkshopUnlocked(unlocked),
        flushSave: () => this.persist(),
        clearSave: async () => {
          await this.saveCoordinator?.clear();
        },
        dispose: async () => this.dispose(),
      };
    }
    window.__gooby = surface;
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    window.removeEventListener("resize", this.resize);
    document.removeEventListener("visibilitychange", this.onVisibilityChange);
    window.removeEventListener("pagehide", this.onPageHide);
    await this.persist();
    await this.sceneManager.dispose();
    this.activeHome = null;
    this.activeCity = null;
    this.activeMinigame = null;
    this.removeNativeListener();
    for (const remove of this.removeDirectors) remove();
    this.removeDirectors.length = 0;
    this.input.dispose();
    this.removeAudioUnlock();
    this.fxDirector.dispose();
    this.fx.dispose();
    this.hapticDirector.dispose();
    this.audio.dispose();
    this.assetLoader.dispose();
    this.tracker.dispose();
    this.platform.audio.dispose();
    this.perf.dispose();
    this.renderer.dispose();
    this.gameEvents.clear();
    this.audioEvents.clear();
    this.fxEvents.clear();
    this.ui.dispose();
  }

  private resumeSimulation(): void {
    if (!this.state || this.disposed) return;
    const sleepingSince = this.state.simulation.sleep?.startedAt ?? null;
    const next = SaveStateSchema.parse({
      ...this.state,
      simulation: catchUpOffline(this.state.simulation, this.clock.now()),
    });
    this.state = next;
    this.saveCoordinator?.replaceLocalState(next);
    this.completeSleepIfNeeded(sleepingSince);
    this.activeHome?.gooby.updateNeeds(this.state.simulation.needs);
    this.updateSleepUi();
  }

  /**
   * Settles a finished sleep session exactly once. Sessions are keyed by their
   * start time, so a save rollback or conflict replay that briefly reinstalls
   * the sleeping state can never fire the wake celebration a second time.
   */
  private completeSleepIfNeeded(sleepingSince: number | null): void {
    if (sleepingSince === null || this.state?.simulation.sleep) return;
    if (this.lastSettledSleepStart === sleepingSince) return;
    this.lastSettledSleepStart = sleepingSince;
    this.activeHome?.setSleeping(false);
    this.activeHome?.react("wake");
    this.emitGooby("wake");
    this.audio.sounds.setZone(this.currentMusicZone);
    this.cancelSleepNotification();
    void this.persist();
  }

  private cancelSleepNotification(): void {
    void this.platform.notifications.cancel(SLEEP_NOTIFICATION_ID).catch(() => undefined);
  }

  private scheduleSleepCompletionNotification(completesAt: number): void {
    if (!this.requireState().settings.notifications) return;
    void this.platform.notifications.requestPermission().then((allowed) => {
      if (!allowed || this.state?.simulation.sleep?.completesAt !== completesAt) return undefined;
      return this.platform.notifications.schedule(createSleepCompletionNotification(
        completesAt,
        this.requireState().notificationPolicy,
      ));
    }).catch(() => undefined);
  }

  private readonly unlockFromRoot = (): void => {
    void this.ensureAudio();
  };

  private installAudioUnlock(): void {
    if (this.audioUnlockInstalled) return;
    this.audioUnlockInstalled = true;
    this.mount.addEventListener("pointerdown", this.unlockFromRoot, true);
    this.mount.addEventListener("keydown", this.unlockFromRoot, true);
  }

  private removeAudioUnlock(): void {
    if (!this.audioUnlockInstalled) return;
    this.audioUnlockInstalled = false;
    this.mount.removeEventListener("pointerdown", this.unlockFromRoot, true);
    this.mount.removeEventListener("keydown", this.unlockFromRoot, true);
  }

  private applyFxPreference(): void {
    const reduced = this.state?.settings.reducedMotion ?? false;
    this.fx.setDensity(reduced ? 0.25 : this.particleDensity);
    if (reduced) this.fx.clear();
  }

  private async clearLocalData(): Promise<void> {
    try {
      await this.saveCoordinator?.clear();
      if (typeof localStorage !== "undefined") removeLegacyUiState(localStorage);
      window.location.reload();
    } catch {
      this.toast("Local data could not be cleared. Please try again.");
    }
  }
}
