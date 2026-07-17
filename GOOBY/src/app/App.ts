import { FakeClock, RealClock, type Clock } from "../core/contracts/clock";
import { grantReward } from "../core/contracts/economy";
import type { Gesture } from "../core/contracts/input";
import {
  commitSave,
  loadSave,
  type SaveState,
} from "../core/contracts/save";
import {
  advanceSimulation,
  applyNeedDelta,
  catchUpOffline,
  startSleep,
  wakeEarly,
} from "../core/contracts/simulation";
import { createPlatform, configureNativeShell } from "../core/platform";
import { PointerInput } from "../core/pointer-input";
import { DomFx } from "../fx";
import { PerformanceProbe } from "../perf";
import { ResourceTracker, GameRenderer } from "../render/renderer";
import { LivingRoom } from "../scenes/home";
import { GameUI, type UiActions } from "../ui";

interface GoobyDebugSurface {
  readonly version: 1;
  snapshot(): SaveState | null;
  performance(): ReturnType<PerformanceProbe["snapshot"]>;
  test?: {
    advanceTime(durationMs: number): void;
    feed(): void;
    sleep(): void;
    wake(): void;
    clearSave(): Promise<void>;
  };
}

declare global {
  interface Window {
    __gooby: GoobyDebugSurface;
  }
}

const SLEEP_NOTIFICATION_ID = 301;

export class GoobyApp {
  private readonly realClock = new RealClock();
  private readonly fakeClock: FakeClock | null;
  private readonly clock: Clock;
  private readonly platform;
  private readonly ui: GameUI;
  private readonly renderer: GameRenderer;
  private readonly tracker = new ResourceTracker();
  private readonly room: LivingRoom;
  private readonly input: PointerInput;
  private readonly fx: DomFx;
  private readonly perf = new PerformanceProbe();
  private state: SaveState | null = null;
  private revision = 0;
  private frame = 0;
  private previousFrameAt = performance.now();
  private previousInteractionAt = Number.NEGATIVE_INFINITY;
  private saveQueue: Promise<void> = Promise.resolve();
  private removeNativeListener: () => void = () => undefined;

  constructor(private readonly mount: HTMLElement) {
    this.fakeClock = import.meta.env.DEV || import.meta.env.MODE === "test"
      ? new FakeClock(this.realClock.now())
      : null;
    this.clock = this.fakeClock ?? this.realClock;
    this.platform = createPlatform(this.clock);
    const actions: UiActions = {
      feed: () => this.feed(),
      sleep: () => this.sleep(),
      wake: () => this.wake(),
      navigate: (label) => this.navigate(label),
      onboardingComplete: () => this.completeOnboarding(),
    };
    this.ui = new GameUI(mount, actions);
    this.renderer = new GameRenderer(this.ui.canvas);
    this.room = new LivingRoom(this.renderer, this.tracker);
    this.input = new PointerInput(this.ui.canvas, this.clock);
    this.fx = new DomFx(this.ui.fxLayer);
  }

  async boot(): Promise<void> {
    const loaded = await loadSave(this.platform.save, this.clock.now());
    this.state = {
      ...loaded.state,
      simulation: catchUpOffline(loaded.state.simulation, this.clock.now()),
    };
    this.revision = loaded.revision;
    this.platform.audio.setMuted(this.state.settings.muted);
    this.room.setSleeping(this.state.simulation.sleep !== null);
    this.ui.update(this.state.simulation.needs, this.state.economy, this.state.inventory.carrot ?? 0);
    this.updateSleepUi();
    if (!this.state.profile.onboardingComplete) this.ui.showOnboarding();
    if (loaded.recovered) this.ui.toast("Your cozy home was repaired with a fresh save.");

    this.renderer.resize();
    this.input.subscribe(this.handleGesture);
    window.addEventListener("resize", this.resize);
    document.addEventListener("visibilitychange", this.onVisibilityChange);
    window.addEventListener("pagehide", this.onPageHide);
    this.removeNativeListener = await configureNativeShell(() => {
      void this.persist();
    });
    this.installDebugSurface();
    this.frame = requestAnimationFrame(this.loop);
    this.mount.dataset.ready = "true";
    if (this.state.simulation !== loaded.state.simulation || loaded.recovered) void this.persist();
  }

  private readonly resize = (): void => {
    this.renderer.resize();
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
    if (!this.state) return;
    const wasSleeping = this.state.simulation.sleep !== null;
    this.state = {
      ...this.state,
      simulation: advanceSimulation(this.state.simulation, this.clock.now()),
    };
    if (wasSleeping && !this.state.simulation.sleep) {
      this.room.setSleeping(false);
      this.room.react("wake");
      this.platform.audio.play("wake");
      void this.platform.haptics.impact("light");
      void this.platform.notifications.cancel(SLEEP_NOTIFICATION_ID);
      void this.persist();
    }
    this.room.update(deltaSeconds);
    this.renderer.render();
    this.updateSleepUi();
  }

  private readonly handleGesture = (gesture: Gesture): void => {
    if (!this.state || this.state.simulation.sleep) return;
    if (gesture.type === "press-start") {
      void this.platform.audio.unlock();
      return;
    }
    if (gesture.type === "press-move") {
      if (Math.hypot(gesture.dx, gesture.dy) > 22 && this.clock.now() - this.previousInteractionAt > 280) {
        if (this.room.hitGooby(gesture.x, gesture.y)) this.react("tickle", gesture.x, gesture.y);
      }
      return;
    }
    if (gesture.type === "tap" && this.room.hitGooby(gesture.x, gesture.y)) {
      this.react("pet", gesture.x, gesture.y);
    } else if (gesture.type === "double-tap" && this.room.hitGooby(gesture.x, gesture.y)) {
      this.react("poke", gesture.x, gesture.y);
    }
  };

  private react(reaction: "pet" | "tickle" | "poke", x: number, y: number): void {
    this.previousInteractionAt = this.clock.now();
    this.room.react(reaction);
    this.fx.hearts(x, y, reaction === "tickle" ? 7 : 4);
    this.platform.audio.play(reaction === "poke" ? "tap" : "happy");
    void this.platform.haptics.impact(reaction === "tickle" ? "medium" : "light");
    if (!this.state) return;
    this.state = {
      ...this.state,
      simulation: applyNeedDelta(this.state.simulation, "fun", reaction === "tickle" ? 2 : 0.5),
    };
    this.refreshUi();
  }

  private feed(): void {
    if (!this.state) return;
    void this.platform.audio.unlock();
    if (this.state.simulation.sleep) {
      this.ui.toast("Shh… Gooby is dreaming.");
      return;
    }
    const carrots = this.state.inventory.carrot ?? 0;
    if (carrots <= 0) {
      this.ui.toast("No carrots left—visit the market soon!");
      return;
    }
    this.state = {
      ...this.state,
      simulation: applyNeedDelta(
        advanceSimulation(this.state.simulation, this.clock.now()),
        "hunger",
        22,
      ),
      economy: grantReward(this.state.economy, { xp: 10 }),
      inventory: { ...this.state.inventory, carrot: carrots - 1 },
    };
    this.room.react("feed");
    this.fx.hearts(this.ui.canvas.clientWidth / 2, this.ui.canvas.clientHeight * 0.55, 6);
    this.platform.audio.play("munch");
    void this.platform.haptics.impact("success");
    this.ui.toast("Crunch! Hunger +22 · XP +10");
    this.refreshUi();
    void this.persist();
  }

  private sleep(): void {
    if (!this.state) return;
    void this.platform.audio.unlock();
    if (this.state.simulation.sleep) return;
    this.state = { ...this.state, simulation: startSleep(this.state.simulation, this.clock.now()) };
    this.room.setSleeping(true);
    this.platform.audio.play("sleep");
    void this.platform.haptics.impact("light");
    const sleep = this.state.simulation.sleep;
    if (sleep) {
      void this.platform.notifications.requestPermission().then((allowed) => {
        if (allowed) {
          return this.platform.notifications.schedule({
            id: SLEEP_NOTIFICATION_ID,
            title: "Gooby is rested!",
            body: "Your fluffy friend is awake and ready to play.",
            at: sleep.completesAt,
          });
        }
        return undefined;
      });
    }
    this.updateSleepUi();
    void this.persist();
  }

  private wake(): void {
    if (!this.state?.simulation.sleep) return;
    this.state = { ...this.state, simulation: wakeEarly(this.state.simulation, this.clock.now()) };
    this.room.setSleeping(false);
    this.platform.audio.play("wake");
    void this.platform.haptics.impact("light");
    void this.platform.notifications.cancel(SLEEP_NOTIFICATION_ID);
    this.ui.toast("Good morning, sleepy bun.");
    this.updateSleepUi();
    void this.persist();
  }

  private completeOnboarding(): void {
    if (!this.state) return;
    this.state = {
      ...this.state,
      profile: { ...this.state.profile, onboardingComplete: true },
    };
    this.room.react("pet");
    this.platform.audio.play("happy");
    this.ui.toast("Gooby is happy you’re here ♥");
    void this.persist();
  }

  private navigate(label: string): void {
    const messages: Readonly<Record<string, string>> = {
      Places: "City trips always begin from the destination board.",
      Play: "Twelve playful adventures are getting ready!",
      Wardrobe: "Cloud Boutique is tailoring something soft.",
      Items: `${this.state?.inventory.carrot ?? 0} carrots in your basket.`,
      Settings: "Cozy settings are coming soon.",
    };
    this.ui.toast(messages[label] ?? "Coming soon.");
  }

  private refreshUi(): void {
    if (!this.state) return;
    this.ui.update(this.state.simulation.needs, this.state.economy, this.state.inventory.carrot ?? 0);
  }

  private updateSleepUi(): void {
    const sleep = this.state?.simulation.sleep;
    this.ui.setSleeping(Boolean(sleep), sleep ? sleep.completesAt - this.clock.now() : 0);
    this.refreshUi();
  }

  private persist(): Promise<void> {
    this.saveQueue = this.saveQueue.then(async () => {
      if (!this.state) return;
      this.revision = await commitSave(this.platform.save, this.revision, this.state);
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
    this.state = { ...this.state, simulation: catchUpOffline(this.state.simulation, this.clock.now()) };
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
    };
    if (this.fakeClock) {
      surface.test = {
        advanceTime: (durationMs) => {
          this.fakeClock?.advance(durationMs);
          this.tick(0);
        },
        feed: () => this.feed(),
        sleep: () => this.sleep(),
        wake: () => this.wake(),
        clearSave: async () => this.platform.save.clear(),
      };
    }
    window.__gooby = surface;
  }

  async dispose(): Promise<void> {
    cancelAnimationFrame(this.frame);
    window.removeEventListener("resize", this.resize);
    document.removeEventListener("visibilitychange", this.onVisibilityChange);
    window.removeEventListener("pagehide", this.onPageHide);
    await this.persist();
    this.removeNativeListener();
    this.input.dispose();
    this.fx.dispose();
    this.tracker.dispose();
    this.platform.audio.dispose();
    this.renderer.dispose();
    this.ui.dispose();
  }
}
