import { GoobyAudioSystem, type AudioEvents, type MusicZone } from "../audio";
import { FakeClock, RealClock, type Clock } from "../core/contracts/clock";
import { grantReward } from "../core/contracts/economy";
import { EventBus, type GameEvents } from "../core/contracts/events";
import type { Gesture } from "../core/contracts/input";
import type { MinigamePayout } from "../core/contracts/minigame";
import { SeededRng } from "../core/contracts/rng";
import {
  commitSave,
  loadSave,
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
  applyNeedDelta,
  catchUpOffline,
  startSleep,
  wakeEarly,
} from "../core/contracts/simulation";
import { createPlatform, configureNativeShell } from "../core/platform";
import { PointerInput } from "../core/pointer-input";
import { SceneManager, type SceneFactory } from "../core/scene-manager";
import { CATALOG_BY_ID, type CosmeticSlot } from "../data/catalog";
import { HOME_ZONE_BLUEPRINTS } from "../data/home";
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
  type WalkableShopScene,
} from "../scenes/shops";
import { GameUI, type UiActions } from "../ui";
import type { PreferenceKey } from "../ui/model";
import { MinigameScene } from "./minigame-scene";

interface RuntimeDebugSnapshot {
  readonly sceneId: SceneId | null;
  readonly cityPhase: string | null;
  readonly sceneChildren: number;
  readonly activeMinigame: MinigameId | null;
  readonly minigameRoots: number;
  readonly disposed: boolean;
  readonly renderer: {
    readonly geometries: number;
    readonly textures: number;
    readonly drawCalls: number;
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
    inspectShopItem(itemId: string): boolean;
    feed(): void;
    sleep(): void;
    wake(): void;
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

const SLEEP_NOTIFICATION_ID = 301;
const CITY_VISIT_PREFIX = "__city.visited.v1|";

function cityVisitKey(shop: ShopId): string {
  return `${CITY_VISIT_PREFIX}${shop}`;
}

function visitedShops(state: SaveState): readonly ShopId[] {
  return SHOP_IDS.filter((shop) => (state.inventory[cityVisitKey(shop)] ?? 0) > 0);
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
  private activeShop: WalkableShopScene | null = null;
  private activeMinigame: MinigameScene | null = null;
  private pendingArrival: CityShopArrival | null = null;
  private state: SaveState | null = null;
  private revision = 0;
  private frame = 0;
  private previousFrameAt = performance.now();
  private previousInteractionAt = Number.NEGATIVE_INFINITY;
  private saveQueue: Promise<void> = Promise.resolve();
  private removeNativeListener: () => void = () => undefined;
  private currentMusicZone: MusicZone = "home:living-room";
  private cityTripActive = false;
  private previousCityPhase = "destination-board";
  private minigameFinishing = false;
  private disposed = false;

  constructor(private readonly mount: HTMLElement) {
    this.fakeClock = import.meta.env.DEV || import.meta.env.MODE === "test"
      ? new FakeClock(this.realClock.now())
      : null;
    this.clock = this.fakeClock ?? this.realClock;
    this.platform = createPlatform(this.clock);
    const actions: UiActions = {
      feed: () => this.feed(),
      bathe: () => this.bathe(),
      sleep: () => this.sleep(),
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
      equipCosmetic: (slot, itemId) => this.equipCosmetic(slot, itemId),
      placeFurniture: (itemId) => this.placeFurniture(itemId),
      preferenceChanged: (key, enabled) => this.preferenceChanged(key, enabled),
      onboardingComplete: () => this.completeOnboarding(),
    };
    this.ui = new GameUI(mount, actions);
    this.renderer = new GameRenderer(this.ui.canvas);
    this.input = new PointerInput(this.ui.canvas, this.clock);
    this.fx = new DomFx(this.ui.fxLayer, { clock: this.clock, rng: this.rng });
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
  }

  async boot(): Promise<void> {
    const loaded = await loadSave(this.platform.save, this.clock.now());
    const preferences = this.ui.preferences;
    this.state = {
      ...loaded.state,
      simulation: catchUpOffline(loaded.state.simulation, this.clock.now()),
      settings: {
        muted: !preferences.audio,
        reducedMotion: preferences.reducedMotion,
      },
    };
    this.revision = loaded.revision;
    const visits = visitedShops(this.state);
    this.cityController = new CityRouteMachine(visits);
    this.visitHistory = new ShopVisitHistory();
    for (const shop of visits) this.visitHistory.leaveForTown(shop);
    this.audioEvents.emit("audio:mute", { muted: !preferences.audio });
    this.hapticDirector.setMuted(!preferences.haptics);
    this.refreshUi();
    this.updateSleepUi();
    if (!this.state.profile.onboardingComplete) this.ui.showOnboarding();
    if (loaded.recovered) this.toast("Your cozy home was repaired with a fresh save.");

    this.renderer.resize();
    await this.goToScene("home:living-room");
    this.input.subscribe(this.handleGesture);
    window.addEventListener("resize", this.resize);
    document.addEventListener("visibilitychange", this.onVisibilityChange);
    window.addEventListener("pagehide", this.onPageHide);
    this.removeNativeListener = await configureNativeShell(() => {
      void this.persist();
    });
    this.installDebugSurface();
    this.previousFrameAt = performance.now();
    this.frame = requestAnimationFrame(this.loop);
    this.mount.dataset.ready = "true";
    if (this.state.simulation !== loaded.state.simulation || loaded.recovered) void this.persist();
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
        scene.equipCatalogCosmetics(this.ui.equipped);
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
          equippedCosmetics: this.ui.equipped,
          onTryOnChanged: (equipped) => {
            this.activeHome?.equipCatalogCosmetics(equipped);
          },
          onTownExit: async () => this.returnToCity(shop),
          onMessage: (message) => this.toast(message),
        });
        this.activeShop = scene;
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
          (payout) => {
            void this.finishMinigame(game, payout);
          },
          this.fakeClock ? (durationMs) => this.fakeClock?.advance(durationMs) : undefined,
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
    const wasSleeping = this.state.simulation.sleep !== null;
    this.state = {
      ...this.state,
      simulation: advanceSimulation(this.state.simulation, this.clock.now()),
    };
    if (wasSleeping && !this.state.simulation.sleep) {
      this.activeHome?.setSleeping(false);
      this.activeHome?.react("wake");
      this.emitGooby("wake");
      void this.platform.notifications.cancel(SLEEP_NOTIFICATION_ID);
      void this.persist();
    }
    this.activeHome?.gooby.updateNeeds(this.state.simulation.needs);
    this.sceneManager.update(deltaSeconds);
    this.renderer.render();
    this.updateSleepUi();
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

  private feed(): void {
    if (!this.state) return;
    void this.ensureAudio();
    if (this.state.simulation.sleep) {
      this.toast("Shh… Gooby is dreaming.");
      return;
    }
    const carrots = this.state.inventory.carrot ?? 0;
    if (carrots <= 0) {
      this.toast("No carrots left—visit the market soon!");
      return;
    }
    this.acceptState({
      ...this.state,
      simulation: applyNeedDelta(
        advanceSimulation(this.state.simulation, this.clock.now()),
        "hunger",
        22,
      ),
      economy: grantReward(this.state.economy, { xp: 10 }),
      inventory: { ...this.state.inventory, carrot: carrots - 1 },
    });
    this.activeHome?.react("feed");
    this.fxEvents.emit("fx:burst", {
      kind: "crumbs",
      x: this.ui.canvas.clientWidth / 2,
      y: this.ui.canvas.clientHeight * 0.55,
      count: 8,
    });
    this.emitGooby("feed");
    this.toast("Crunch! Hunger +22 · XP +10");
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
    if (!this.state) return;
    void this.ensureAudio();
    if (this.state.simulation.sleep) return;
    const simulation = startSleep(this.state.simulation, this.clock.now());
    this.acceptState({
      ...this.state,
      simulation,
    });
    this.activeHome?.setSleeping(true);
    this.emitGooby("sleep");
    const sleep = simulation.sleep;
    if (sleep && this.ui.preferences.notifications) {
      void this.platform.notifications.requestPermission().then((allowed) => {
        if (!allowed) return undefined;
        return this.platform.notifications.schedule({
          id: SLEEP_NOTIFICATION_ID,
          title: "Gooby is rested!",
          body: "Your fluffy friend is awake and ready to play.",
          at: sleep.completesAt,
        });
      });
    }
    this.updateSleepUi();
  }

  private wake(): void {
    if (!this.state?.simulation.sleep) return;
    this.acceptState({
      ...this.state,
      simulation: wakeEarly(this.state.simulation, this.clock.now()),
    });
    this.activeHome?.setSleeping(false);
    this.emitGooby("wake");
    void this.platform.notifications.cancel(SLEEP_NOTIFICATION_ID);
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
    this.audioEvents.emit("audio:minigame", { action: "go" });
  }

  private async finishMinigame(game: MinigameId, payout: MinigamePayout): Promise<void> {
    if (this.minigameFinishing || !this.state) return;
    this.minigameFinishing = true;
    this.acceptState({
      ...this.state,
      economy: grantReward(this.state.economy, {
        coins: payout.coins,
        xp: payout.xp,
      }),
    });
    this.audioEvents.emit("audio:minigame", {
      action: "win",
      score: payout.score,
    });
    await this.goToScene("home:living-room");
    this.ui.showResults(game, payout);
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
    if ((state.inventory[cityVisitKey(shop)] ?? 0) === 0) {
      this.acceptState({
        ...state,
        inventory: { ...state.inventory, [cityVisitKey(shop)]: 1 },
      });
    }
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

  private equipCosmetic(slot: CosmeticSlot, itemId: string | null): void {
    if (itemId) {
      const item = CATALOG_BY_ID.get(itemId);
      if (
        item?.kind !== "cosmetic" ||
        item.slot !== slot ||
        (this.state?.inventory[item.id] ?? 0) <= 0
      ) {
        this.audioEvents.emit("audio:ui", { action: "denied" });
        this.toast("That look needs to be purchased at Fluff Salon first.");
        return;
      }
    }
    this.activeHome?.equipCatalogCosmetics(this.ui.equipped);
    this.audioEvents.emit("audio:ui", { action: "confirm" });
    this.refreshUi();
  }

  private placeFurniture(itemId: string): void {
    if (!this.activeHome || !this.sceneManager.activeId?.startsWith("home:")) {
      this.toast("Choose a home room before placing furniture.");
      return;
    }
    if (this.activeHome.placeCatalogItem(itemId)) {
      this.audioEvents.emit("audio:ui", { action: "confirm" });
    }
  }

  private preferenceChanged(key: PreferenceKey, enabled: boolean): void {
    if (!this.state) return;
    if (key === "audio") {
      this.audioEvents.emit("audio:mute", { muted: !enabled });
      this.hapticDirector.setMuted(!this.ui.preferences.haptics);
      this.acceptState({ ...this.state, settings: { ...this.state.settings, muted: !enabled } });
    } else if (key === "haptics") {
      this.hapticDirector.setMuted(!enabled);
    } else if (key === "reducedMotion") {
      this.acceptState({ ...this.state, settings: { ...this.state.settings, reducedMotion: enabled } });
    }
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
    const previous = this.state;
    this.state = state;
    this.activeHome?.gooby.updateNeeds(state.simulation.needs);
    this.refreshUi();
    this.gameEvents.emit("state:changed", {
      simulation: state.simulation,
      economy: state.economy,
    });
    if (previous && state.economy.coins < previous.economy.coins) {
      this.audioEvents.emit("audio:economy", {
        action: "purchase",
        amount: previous.economy.coins - state.economy.coins,
      });
    }
    void this.persist();
  }

  private refreshUi(): void {
    if (!this.state) return;
    this.ui.update(
      this.state.simulation.needs,
      this.state.economy,
      this.state.inventory,
      this.ui.equipped,
    );
  }

  private updateSleepUi(): void {
    const sleep = this.state?.simulation.sleep;
    this.ui.setSleeping(Boolean(sleep), sleep ? sleep.completesAt - this.clock.now() : 0);
    this.refreshUi();
  }

  private async goToScene(id: SceneId): Promise<void> {
    this.activeHome = null;
    this.activeCity = null;
    this.activeShop = null;
    this.activeMinigame = null;
    await this.sceneManager.goTo(id);
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
  }

  private ensureAudio(): Promise<void> {
    return this.audio.start(this.currentMusicZone).catch(() => undefined);
  }

  private emitGooby(kind: GameEvents["gooby:reaction"]["kind"]): void {
    this.gameEvents.emit("gooby:reaction", { kind });
  }

  private toast(message: string): void {
    this.ui.toast(message);
    this.gameEvents.emit("toast", { message });
  }

  private requireState(): SaveState {
    if (!this.state) throw new Error("Gooby save state is not loaded");
    return this.state;
  }

  private persist(): Promise<void> {
    this.saveQueue = this.saveQueue.then(async () => {
      if (!this.state) return;
      this.revision = await commitSave(this.platform.save, this.revision, this.state);
      this.gameEvents.emit("save:committed", { revision: this.revision });
    }).catch((error: unknown) => {
      console.error("Save failed", error);
    });
    return this.saveQueue;
  }

  private readonly onVisibilityChange = (): void => {
    if (!this.state || document.visibilityState !== "visible") {
      void this.persist();
      return;
    }
    this.state = {
      ...this.state,
      simulation: catchUpOffline(this.state.simulation, this.clock.now()),
    };
    this.refreshUi();
  };

  private readonly onPageHide = (): void => {
    void this.persist();
  };

  private installDebugSurface(): void {
    const surface: GoobyDebugSurface = {
      version: 1,
      snapshot: () => this.state ? structuredClone(this.state) : null,
      performance: () => this.perf.snapshot(),
      runtime: () => ({
        sceneId: this.sceneManager.activeId,
        cityPhase: this.sceneManager.activeId === "city:drive" ? this.cityController.state.phase : null,
        sceneChildren: this.renderer.scene.children.length,
        activeMinigame: this.activeMinigame?.module.id ?? null,
        minigameRoots: this.mount.querySelectorAll("[data-minigame]").length,
        disposed: this.disposed,
        renderer: {
          geometries: this.renderer.renderer.info.memory.geometries,
          textures: this.renderer.renderer.info.memory.textures,
          drawCalls: this.renderer.renderer.info.render.calls,
        },
      }),
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
        inspectShopItem: (itemId) =>
          this.activeShop ? this.activeShop.inspectItem(itemId) !== null : false,
        feed: () => this.feed(),
        sleep: () => this.sleep(),
        wake: () => this.wake(),
        flushSave: () => this.persist(),
        clearSave: async () => this.platform.save.clear(),
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
    this.activeShop = null;
    this.activeMinigame = null;
    this.removeNativeListener();
    for (const remove of this.removeDirectors) remove();
    this.removeDirectors.length = 0;
    this.input.dispose();
    this.fxDirector.dispose();
    this.fx.dispose();
    this.hapticDirector.dispose();
    this.audio.dispose();
    this.assetLoader.dispose();
    this.tracker.dispose();
    this.platform.audio.dispose();
    this.renderer.dispose();
    this.gameEvents.clear();
    this.audioEvents.clear();
    this.fxEvents.clear();
    this.ui.dispose();
  }
}
