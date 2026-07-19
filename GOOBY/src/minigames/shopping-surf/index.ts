/**
 * Gooby Shopping Surf — the complete specialist build.
 *
 * A portrait 3-lane cart-surf through Gooby City's market streets, rendered
 * on the shared Stage3D lease (instanced pooled chunks, curated GLBs with
 * total procedural fallback, reduced-motion camera). Swipes or held A/D
 * change lanes, a tap or Space jumps, swipe-down or S ducks. The run chases
 * Gooby's six-item shopping list through coins, ramps, tricks and
 * near-misses; three bump shields absorb mistakes before the run eases to a
 * gentle stop. Controls and state are fully self-contained — nothing is
 * shared with the normal city driving stack.
 *
 * The pure fixed-step model lives in `model.ts`; this module wires it to the
 * Arcade Kit chrome (tutorial with real-input practice gates, HUD, pause
 * gate, results) and settles each scored run exactly once through the
 * injected lifecycle. Exits never pay.
 */
import type {
  MinigameContext,
  MinigameManifest,
  MinigameModule,
  MinigamePayout,
} from "../../core/contracts/minigame";
import { validateMinigameManifest } from "../../core/contracts/minigame";
import type { HapticPattern } from "../../core/contracts/platform";
import { activeCatalog, EN_CATALOG, localizedText, pickLocalized } from "../../i18n";
import { getCityEnvironment } from "../../scenes/city/environment/api";
import {
  acquireArcadeKitStyles,
  ArcadeCountdown,
  createArcadeHud,
  createArcadeInput,
  createResultScreen,
  createTutorialOverlay,
  FixedStepAccumulator,
  PauseGate,
  type ArcadeHud,
  type ArcadeInput,
  type ResultScreen,
  type TutorialOverlay,
} from "../shared";
import type { MinigameStubDefinition } from "../stub";
import { createSurfAssetDepot, type SurfAssetDepot } from "./assets";
import {
  beginSurfRun,
  createSurfPractice,
  createSurfState,
  drainSurfEvents,
  queueSurfJump,
  setSurfDuck,
  stepSurf,
  stepSurfLane,
  SURF_GROCERY_LIST_SIZE,
  SURF_PRACTICE_STEPS,
  SURF_SHIELD_COUNT,
  SURF_STEP_SECONDS,
  surfPayout,
  surfPracticeCurrent,
  surfPracticePerform,
  type SurfEventKind,
  type SurfPracticeState,
  type SurfState,
} from "./model";
import { createSurfScene, type SurfScene } from "./scene";
import { createSurfSettlement, type SurfSettlement } from "./settlement";
import {
  createSurfChrome,
  SURF_CSS,
  SURF_GROCERIES,
  surfCopy,
  type SurfChrome,
} from "./ui";

export const manifest: MinigameManifest = validateMinigameManifest({
  id: "shopping-surf",
  title: localizedText((catalog) => catalog.minigames["shopping-surf"].title),
  instructions: localizedText((catalog) => catalog.minigames["shopping-surf"].instructions),
  icon: EN_CATALOG.minigames["shopping-surf"].icon,
  category: "action",
  stage3d: false,
  unlockLevel: 1,
  audioCues: ["countdown", "go", "hit", "miss", "combo", "score", "win", "lose"],
  tutorial: [
    {
      icon: "🛒",
      title: { en: "Ride the market lanes", de: "Reite die Marktspuren" },
      body: {
        en: "Gooby surfs a cart down three lanes. Swipe or hold A/D (or ←/→) to change lanes.",
        de: "Gooby surft mit dem Wagen über drei Spuren. Wische oder halte A/D (oder ←/→), um die Spur zu wechseln.",
      },
    },
    {
      icon: "⤴",
      title: { en: "Jump and duck", de: "Springen und ducken" },
      body: {
        en: "Tap or press Space to jump crates. Swipe down or hold S (or ↓) to duck under banners.",
        de: "Tippe oder drücke die Leertaste, um über Kisten zu springen. Wische nach unten oder halte S (oder ↓), um dich unter Bannern zu ducken.",
      },
    },
    {
      icon: "🧾",
      title: { en: "Fill Gooby's list", de: "Fülle Goobys Zettel" },
      body: {
        en: "Grab the six listed groceries and every coin. Ramps launch tricks — chain pickups for a combo.",
        de: "Sammle die sechs Waren vom Zettel und jede Münze. Rampen starten Tricks — verkette Funde für eine Combo.",
      },
    },
    {
      icon: "🛡",
      title: { en: "Three bump shields", de: "Drei Stoßschützer" },
      body: {
        en: "Hitting an obstacle costs one shield. After the third bump the cart rolls gently to a stop.",
        de: "Ein Zusammenstoß kostet einen Schutz. Nach dem dritten Rums rollt der Wagen sanft aus.",
      },
    },
  ],
});

export const definition: MinigameStubDefinition = {
  id: manifest.id,
  title: manifest.title.en,
  instructions: manifest.instructions.en,
};

type ModulePhase =
  | "boot"
  | "tutorial"
  | "practice"
  | "countdown"
  | "running"
  | "paused"
  | "result"
  | "ready"
  | "disposed";

type SoundAction = "hit" | "miss" | "combo" | "countdown" | "go" | "win" | "lose" | "score";

type SurfContext = MinigameContext & {
  readonly audio?: { emit(action: SoundAction, value?: number): void };
  readonly haptics?: { impact(pattern: HapticPattern): void };
  readonly bestScore?: number;
  readonly reducedMotion?: boolean;
};

export interface SurfPerfSnapshot {
  readonly frames: number;
  readonly fps: number;
  readonly p95FrameMs: number;
  readonly drawCalls: number;
  readonly triangles: number;
}

const EMPTY_PAYOUT: MinigamePayout = { score: 0, coins: 0, xp: 0 };
const MAX_FRAME_SECONDS = 0.25;
const STEER_REPEAT_SECONDS = 0.24;
const TAP_JUMP_MAX_MS = 300;
const PERF_SAMPLE_CAP = 360;
const PRACTICE_COURSE_LENGTH = 100_000;

export class ShoppingSurfGame implements MinigameModule {
  readonly id = manifest.id;

  private context: SurfContext | null = null;
  private root: HTMLElement | null = null;
  private scene: SurfScene | null = null;
  private depot: SurfAssetDepot | null = null;
  private chrome: SurfChrome | null = null;
  private hud: ArcadeHud | null = null;
  private tutorial: TutorialOverlay | null = null;
  private result: ResultScreen | null = null;
  private input: ArcadeInput | null = null;
  private settlement: SurfSettlement | null = null;
  private releaseKitStyles: (() => void) | null = null;
  private readonly pauseGate = new PauseGate();
  private readonly cleanup: Array<() => void> = [];

  private phase: ModulePhase = "boot";
  private pausedFrom: Exclude<ModulePhase, "paused"> | null = null;
  private state: SurfState | null = null;
  private practice: SurfPracticeState | null = null;
  private countdown: ArcadeCountdown | null = null;
  private accumulator = new FixedStepAccumulator({
    stepSeconds: SURF_STEP_SECONDS,
    maxFrameSeconds: MAX_FRAME_SECONDS,
  });
  private settledPayout: MinigamePayout | null = null;
  private best = 0;

  // Input trackers (all reset on held-cleared / phase changes).
  private steerLatch: -1 | 0 | 1 = 0;
  private steerRepeat = 0;
  private duckHeld = false;
  private swipeUpLatched = false;
  private pointerPressAtMs: number | null = null;
  private pointerDragged = false;

  // Perf ring for the audit harness (rewritten in place, no steady allocs).
  private readonly perfSamples = new Float64Array(PERF_SAMPLE_CAP);
  private perfIndex = 0;
  private perfCount = 0;

  get title(): string {
    return pickLocalized(manifest.title);
  }

  get instructions(): string {
    return pickLocalized(manifest.instructions);
  }

  private get reducedMotion(): boolean {
    return this.context?.reducedMotion === true;
  }

  mount(context: MinigameContext): void {
    if (this.phase !== "boot" && this.phase !== "disposed") this.dispose();
    const shared = context as SurfContext;
    this.context = shared;
    this.settlement = createSurfSettlement(context);
    this.best = this.settlement.persistedBest;
    this.settledPayout = null;
    const document = context.mount.ownerDocument;
    this.releaseKitStyles = acquireArcadeKitStyles(document);

    const root = document.createElement("section");
    root.className = "shopping-surf";
    root.dataset.minigame = this.id;
    root.dataset.ssPhase = "tutorial";
    root.tabIndex = 0;
    root.setAttribute("aria-label", this.title);
    if (this.reducedMotion) root.dataset.akReduced = "true";
    const style = document.createElement("style");
    style.textContent = SURF_CSS;
    root.append(style);

    const stageHost = document.createElement("div");
    stageHost.className = "ss-stage";
    stageHost.dataset.ss = "stage";
    root.append(stageHost);

    const keysHint = document.createElement("p");
    keysHint.className = "ss-keys";
    keysHint.textContent = surfCopy("keysHint");
    root.append(keysHint);

    context.mount.replaceChildren(root);
    this.root = root;

    this.chrome = createSurfChrome(root);
    this.chrome.setShields(SURF_SHIELD_COUNT, SURF_SHIELD_COUNT);

    this.hud = createArcadeHud({
      host: root,
      initialBest: this.best,
      reducedMotion: this.reducedMotion,
      onPause: () => {
        this.pause();
      },
    });
    this.tutorial = createTutorialOverlay({
      host: root,
      steps: manifest.tutorial,
      reducedMotion: this.reducedMotion,
      onStart: () => {
        this.startPractice();
      },
      onExitWithoutReward: () => {
        this.exitUnpaid();
      },
    });
    this.result = createResultScreen({
      host: root,
      reducedMotion: this.reducedMotion,
      hooks: {
        onCollect: () => {
          this.showReadyPanel();
        },
        onPlayAgain: () => {
          this.beginCountdown();
        },
      },
    });

    const panel = document.createElement("div");
    panel.className = "ak-overlay ss-panel";
    panel.dataset.ss = "panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.hidden = true;
    root.append(panel);
    // One delegated listener for the panel's whole lifetime: rebinding on
    // every show would stack handlers and re-fire actions once per stack.
    this.bindPanelActions(panel);

    // The ambient/practice course renders behind the tutorial immediately.
    this.state = createSurfState(context.rng, {
      practice: true,
      courseLength: PRACTICE_COURSE_LENGTH,
    });

    this.depot = createSurfAssetDepot();
    void this.depot.preload();
    try {
      this.scene = createSurfScene({
        mount: stageHost,
        clock: context.clock,
        reducedMotion: this.reducedMotion,
        depot: this.depot,
        city: getCityEnvironment(),
      });
    } catch {
      // No Stage3D lease (no WebGL, or another lease is active): the run
      // still plays through the chrome over a simplified CSS backdrop.
      this.scene = null;
      stageHost.classList.add("ss-stage-fallback");
      stageHost.textContent = surfCopy("stageFallback");
      this.chrome.announce(surfCopy("stageFallback"));
    }

    this.input = createArcadeInput({ surface: root, lanes: 3 });
    const unsubscribe = this.input.subscribe((event) => {
      if (event.kind === "action-pressed") this.onJumpInput();
      else if (event.kind === "axis-changed") this.onAxis(event.x, event.y, event.source);
      else if (event.kind === "lane-pressed" && event.source === "pointer") this.onPointerPress();
      else if (event.kind === "lane-released" && event.source === "pointer") this.onPointerRelease();
      else if (event.kind === "held-cleared") this.onHeldCleared();
    });
    this.cleanup.push(unsubscribe);

    // Presses that start on a button (pause, overlay/panel controls) must
    // keep native click semantics: the input kit would otherwise capture the
    // pointer to the surface, retargeting the click away from the button —
    // and a tap on a control must never double as jump input either.
    const controlProbe: EventListener = (event) => {
      const target = (event as PointerEvent).target;
      if (target instanceof Element && target.closest("button") !== null) {
        event.stopPropagation();
      }
    };
    root.addEventListener("pointerdown", controlProbe, true);
    this.cleanup.push(() => {
      root.removeEventListener("pointerdown", controlProbe, true);
    });

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.repeat) return;
      if (event.key.toLowerCase() === "p" || event.key === "Escape") {
        if (this.phase === "running" || this.phase === "countdown") {
          event.preventDefault();
          this.pause();
        } else if (this.phase === "paused") {
          event.preventDefault();
          this.resume();
        }
      }
    };
    const keyListener: EventListener = (event) => {
      onKeyDown(event as KeyboardEvent);
    };
    root.addEventListener("keydown", keyListener);
    this.cleanup.push(() => {
      root.removeEventListener("keydown", keyListener);
    });

    this.phase = "tutorial";
  }

  start(): void {
    if (!this.root || this.phase !== "tutorial") return;
    this.tutorial?.open();
    this.root.focus();
  }

  pause(): void {
    if (this.phase !== "running" && this.phase !== "countdown" && this.phase !== "practice") return;
    this.pausedFrom = this.phase;
    this.phase = "paused";
    this.setPhaseAttribute();
    this.pauseGate.pause();
    this.input?.setEnabled(false);
    this.showPausePanel();
  }

  resume(): void {
    if (this.phase !== "paused") return;
    this.phase = this.pausedFrom ?? "running";
    this.pausedFrom = null;
    this.setPhaseAttribute();
    this.pauseGate.resume();
    this.input?.setEnabled(true);
    this.hidePanel();
    this.root?.focus();
  }

  update(deltaSeconds: number): void {
    if (!this.context || !this.root) return;
    const clamped = Math.min(
      MAX_FRAME_SECONDS,
      Math.max(0, Number.isFinite(deltaSeconds) ? deltaSeconds : 0),
    );
    const dt = this.pauseGate.filter(clamped);
    this.chrome?.update(dt);

    if (this.phase === "countdown") {
      this.countdown?.update(dt);
      this.renderScene(dt);
      return;
    }

    if (this.phase === "practice" || this.phase === "running") {
      const state = this.state;
      if (!state) return;
      this.accumulator.advance(dt, (stepSeconds) => {
        this.applyHeldSteer(stepSeconds);
        stepSurf(state, stepSeconds);
      });
      drainSurfEvents(state, (kind, value) => {
        this.onModelEvent(kind, value);
      });
      if (this.phase === "running") {
        if (dt > 0) this.samplePerf(dt);
        this.hud?.setTimer(state.time);
        this.hud?.setScore(state.score);
        this.hud?.setCombo(state.combo);
        if (state.phase === "finished") {
          this.finishRun();
          return;
        }
      }
      this.renderScene(dt);
      return;
    }

    // Tutorial / ready / result / paused keep the last scene pose visible.
    this.renderScene(0);
  }

  payout(): MinigamePayout {
    return this.settledPayout ?? EMPTY_PAYOUT;
  }

  dispose(): void {
    if (this.phase === "disposed") return;
    this.phase = "disposed";
    this.settlement?.exitUnpaid();
    for (const remove of this.cleanup.splice(0)) remove();
    this.input?.dispose();
    this.input = null;
    this.hud?.dispose();
    this.hud = null;
    this.tutorial?.dispose();
    this.tutorial = null;
    this.result?.dispose();
    this.result = null;
    this.chrome?.dispose();
    this.chrome = null;
    this.scene?.dispose();
    this.scene = null;
    this.depot?.dispose();
    this.depot = null;
    this.root?.remove();
    this.root = null;
    this.releaseKitStyles?.();
    this.releaseKitStyles = null;
    this.pauseGate.dispose();
    this.countdown = null;
    this.state = null;
    this.practice = null;
    this.settlement = null;
    this.context = null;
  }

  /** Live perf counters for the audit harness (fps / p95 / draw calls). */
  perfSnapshot(): SurfPerfSnapshot {
    const count = Math.min(this.perfCount, PERF_SAMPLE_CAP);
    const samples: number[] = [];
    let total = 0;
    for (let index = 0; index < count; index += 1) {
      const value = this.perfSamples[index] ?? 0;
      samples.push(value);
      total += value;
    }
    samples.sort((a, b) => a - b);
    const p95 = samples.length > 0
      ? (samples[Math.min(samples.length - 1, Math.floor(samples.length * 0.95))] ?? 0) * 1_000
      : 0;
    const scenePerf = this.scene?.perf() ?? { drawCalls: 0, triangles: 0 };
    return {
      frames: count,
      fps: total > 0 ? count / total : 0,
      p95FrameMs: p95,
      drawCalls: scenePerf.drawCalls,
      triangles: scenePerf.triangles,
    };
  }

  /* ---------------------------------------------------------------- */
  /* Flow                                                              */
  /* ---------------------------------------------------------------- */

  private startPractice(): void {
    const context = this.context;
    if (!context || !this.state) return;
    this.hidePanel();
    this.practice = createSurfPractice();
    if (this.state.phase === "ready") beginSurfRun(this.state);
    this.phase = "practice";
    this.setPhaseAttribute();
    this.updatePracticePrompt();
    this.showPracticeSkip();
    this.root?.focus();
  }

  private updatePracticePrompt(): void {
    const practice = this.practice;
    if (!practice) return;
    const step = surfPracticeCurrent(practice);
    this.chrome?.setPractice(step, practice.index, SURF_PRACTICE_STEPS.length);
    if (step) this.chrome?.announce("");
  }

  private showPracticeSkip(): void {
    const panel = this.queryPanel();
    if (!panel) return;
    panel.hidden = false;
    panel.style.pointerEvents = "none";
    panel.style.background = "transparent";
    panel.innerHTML = `
      <button class="ak-button ak-button-quiet" data-ss-action="skip-practice"
        style="pointer-events:auto;position:absolute;top:calc(12px + env(safe-area-inset-top));left:50%;transform:translateX(-50%)">
        ${surfCopy("practiceSkip")}
      </button>
    `;
    const skip = panel.querySelector<HTMLButtonElement>("[data-ss-action='skip-practice']");
    const onSkip = (): void => {
      this.beginCountdown();
    };
    skip?.addEventListener("click", onSkip);
    this.cleanup.push(() => {
      skip?.removeEventListener("click", onSkip);
    });
  }

  private practicePerformed(action: "left" | "right" | "jump" | "duck"): void {
    const practice = this.practice;
    if (!practice || this.phase !== "practice") return;
    if (!surfPracticePerform(practice, action)) return;
    this.emitFeedback("hit", undefined, "light");
    this.updatePracticePrompt();
    if (practice.complete) {
      this.chrome?.setPractice(null, 0, SURF_PRACTICE_STEPS.length);
      this.chrome?.announce(surfCopy("practiceDone"));
      this.beginCountdown();
    }
  }

  private beginCountdown(): void {
    const context = this.context;
    if (!context || !this.settlement) return;
    this.result?.close();
    this.hidePanel();
    this.practice = null;
    this.chrome?.setPractice(null, 0, SURF_PRACTICE_STEPS.length);
    this.settlement.begin();
    this.settledPayout = null;
    this.state = createSurfState(context.rng);
    this.accumulator.reset();
    this.resetInputTrackers();
    this.perfIndex = 0;
    this.perfCount = 0;
    this.best = this.settlement.persistedBest;
    this.hud?.setBest(this.best);
    this.hud?.setScore(0);
    this.hud?.setCombo(0);
    this.hud?.setTimer(0);
    this.chrome?.setList(this.state.groceries);
    this.chrome?.setShields(SURF_SHIELD_COUNT, SURF_SHIELD_COUNT);
    this.chrome?.setMultiplier(1);
    this.phase = "countdown";
    this.setPhaseAttribute();
    this.pauseGate.resume();
    this.countdown = new ArcadeCountdown({
      seconds: 3,
      feedback: (event) => {
        if (event.kind === "tick") {
          this.emitFeedback("countdown");
          this.chrome?.setCountdown(String(event.value));
          this.chrome?.announce(`${activeCatalog().strings.minigameCommon.ready} ${event.value}`);
        } else {
          this.emitFeedback("go", undefined, "success");
          this.chrome?.setCountdown(activeCatalog().strings.minigameCommon.go);
          this.beginRunning();
        }
      },
    });
    this.countdown.start();
    this.root?.focus();
  }

  private beginRunning(): void {
    const state = this.state;
    if (!state) return;
    beginSurfRun(state);
    this.phase = "running";
    this.setPhaseAttribute();
    this.countdown = null;
    if (this.reducedMotion) this.chrome?.setCountdown(null);
    else {
      // The GO flash hides itself on the first HUD-visible toast/update.
      this.chrome?.setCountdown(null);
    }
  }

  private finishRun(): void {
    const state = this.state;
    const settlement = this.settlement;
    if (!state || !settlement) return;
    const finished = state.endReason === "finish";
    if (!finished) this.emitFeedback("lose", undefined, "warning");
    const payout = surfPayout(state);
    const previousBest = settlement.persistedBest;
    this.settledPayout = payout;
    const bestAfter = settlement.complete(payout);
    this.best = Math.max(previousBest, bestAfter ?? payout.score);
    this.hud?.setBest(this.best);
    if (finished) this.emitFeedback("win", payout.score, "success");
    this.phase = "result";
    this.setPhaseAttribute();
    const detailTitle = finished ? surfCopy("finishTitle") : surfCopy("bumpedTitle");
    const detail = `${detailTitle} · 🧾 ${state.groceryCount}/${SURF_GROCERY_LIST_SIZE} ${surfCopy("groceriesDetail")} · ✦ ${state.stats.tricks} ${surfCopy("tricksDetail")} · 🛡 ${state.shields} ${surfCopy("shieldsDetail")}`;
    this.result?.show({
      score: payout.score,
      best: this.best,
      newBest: payout.score > 0 && payout.score > previousBest,
      detail,
    });
  }

  private exitUnpaid(): void {
    this.settlement?.exitUnpaid();
    this.chrome?.announce(surfCopy("leftUnpaid"));
    this.showReadyPanel();
  }

  private showReadyPanel(): void {
    this.phase = "ready";
    this.setPhaseAttribute();
    this.practice = null;
    this.chrome?.setPractice(null, 0, SURF_PRACTICE_STEPS.length);
    this.chrome?.setCountdown(null);
    const panel = this.queryPanel();
    if (!panel) return;
    panel.hidden = false;
    panel.style.pointerEvents = "";
    panel.style.background = "";
    const strings = activeCatalog().strings.minigameCommon;
    panel.innerHTML = `
      <div class="ak-card">
        <span class="ak-kicker">${this.title}</span>
        <div class="ak-card-icon" aria-hidden="true">🛒</div>
        <h2>${this.title}</h2>
        <button class="ak-button ak-button-primary" data-ss-action="surf">${surfCopy("surfStart")}</button>
        <button class="ak-button ak-button-quiet" data-ss-action="how-to">${strings.howToPlay}</button>
      </div>
    `;
    panel.querySelector<HTMLButtonElement>("[data-ss-action='surf']")?.focus();
  }

  private showPausePanel(): void {
    const panel = this.queryPanel();
    if (!panel) return;
    const strings = activeCatalog().strings.minigameCommon;
    panel.hidden = false;
    panel.style.pointerEvents = "";
    panel.style.background = "";
    panel.innerHTML = `
      <div class="ak-card">
        <span class="ak-kicker">${strings.paused}</span>
        <div class="ak-card-icon" aria-hidden="true">🛒</div>
        <h2>${strings.paused}</h2>
        <button class="ak-button ak-button-primary" data-ss-action="resume">${strings.resume}</button>
        <button class="ak-button ak-button-secondary" data-ss-action="restart">${strings.restart}</button>
        <button class="ak-button ak-button-quiet" data-ss-action="quit">${strings.quitNoReward}</button>
      </div>
    `;
    panel.querySelector<HTMLButtonElement>("[data-ss-action='resume']")?.focus();
  }

  private bindPanelActions(panel: HTMLElement): void {
    const onClick = (event: Event): void => {
      const target = event.target instanceof Element
        ? event.target.closest<HTMLElement>("[data-ss-action]")
        : null;
      if (!target) return;
      switch (target.dataset.ssAction) {
        case "surf":
          this.beginCountdown();
          break;
        case "how-to":
          this.hidePanel();
          this.phase = "tutorial";
          this.setPhaseAttribute();
          this.tutorial?.open();
          break;
        case "resume":
          this.resume();
          break;
        case "restart":
          this.pauseGate.resume();
          this.input?.setEnabled(true);
          this.beginCountdown();
          break;
        case "quit":
          this.pauseGate.resume();
          this.input?.setEnabled(true);
          this.exitUnpaid();
          break;
        default:
          break;
      }
    };
    panel.addEventListener("click", onClick);
    this.cleanup.push(() => {
      panel.removeEventListener("click", onClick);
    });
  }

  private queryPanel(): HTMLElement | null {
    return this.root?.querySelector<HTMLElement>("[data-ss='panel']") ?? null;
  }

  private hidePanel(): void {
    const panel = this.queryPanel();
    if (!panel) return;
    panel.hidden = true;
    panel.replaceChildren();
  }

  private setPhaseAttribute(): void {
    if (this.root) this.root.dataset.ssPhase = this.phase;
  }

  /* ---------------------------------------------------------------- */
  /* Input                                                             */
  /* ---------------------------------------------------------------- */

  private resetInputTrackers(): void {
    this.steerLatch = 0;
    this.steerRepeat = 0;
    this.swipeUpLatched = false;
    this.pointerPressAtMs = null;
    this.pointerDragged = false;
    if (this.duckHeld) {
      this.duckHeld = false;
      if (this.state) setSurfDuck(this.state, false);
    }
  }

  private get inputActive(): boolean {
    return this.phase === "running" || this.phase === "practice";
  }

  private steer(direction: -1 | 1): void {
    const state = this.state;
    if (!state || !this.inputActive) return;
    stepSurfLane(state, direction);
    this.practicePerformed(direction === -1 ? "left" : "right");
  }

  private onJumpInput(): void {
    const state = this.state;
    if (!state || !this.inputActive) return;
    queueSurfJump(state);
    this.practicePerformed("jump");
  }

  private setDuckHeld(held: boolean): void {
    if (held === this.duckHeld) return;
    this.duckHeld = held;
    const state = this.state;
    if (!state || !this.inputActive) return;
    setSurfDuck(state, held);
    if (held) this.practicePerformed("duck");
  }

  private onAxis(x: number, y: number, source: "pointer" | "keyboard"): void {
    if (source === "pointer" && (Math.abs(x) >= 0.25 || Math.abs(y) >= 0.25)) {
      this.pointerDragged = true;
    }
    if (Math.abs(x) >= 0.5) {
      const direction: -1 | 1 = x > 0 ? 1 : -1;
      if (this.steerLatch !== direction) {
        this.steerLatch = direction;
        this.steerRepeat = STEER_REPEAT_SECONDS;
        this.steer(direction);
      }
    } else if (Math.abs(x) < 0.3) {
      this.steerLatch = 0;
    }

    this.setDuckHeld(y >= 0.5);
    if (y <= -0.6 && !this.swipeUpLatched) {
      this.swipeUpLatched = true;
      this.onJumpInput();
    } else if (y > -0.3) {
      this.swipeUpLatched = false;
    }
  }

  /** Held A/D (or a held side-swipe) keeps stepping lanes on a cadence. */
  private applyHeldSteer(stepSeconds: number): void {
    if (this.steerLatch === 0 || !this.inputActive) return;
    const axisX = this.input?.state.axisX ?? 0;
    if (Math.abs(axisX) < 0.5 || Math.sign(axisX) !== this.steerLatch) return;
    this.steerRepeat -= stepSeconds;
    if (this.steerRepeat <= 0) {
      this.steerRepeat = STEER_REPEAT_SECONDS;
      this.steer(this.steerLatch);
    }
  }

  private onPointerPress(): void {
    this.pointerPressAtMs = this.context?.clock.now() ?? null;
    this.pointerDragged = false;
  }

  private onPointerRelease(): void {
    const pressedAt = this.pointerPressAtMs;
    this.pointerPressAtMs = null;
    if (pressedAt === null || this.pointerDragged) return;
    const heldMs = (this.context?.clock.now() ?? pressedAt) - pressedAt;
    if (heldMs <= TAP_JUMP_MAX_MS) this.onJumpInput();
  }

  private onHeldCleared(): void {
    this.steerLatch = 0;
    this.swipeUpLatched = false;
    this.pointerPressAtMs = null;
    this.setDuckHeld(false);
  }

  /* ---------------------------------------------------------------- */
  /* Model events → feedback                                           */
  /* ---------------------------------------------------------------- */

  private onModelEvent(kind: SurfEventKind, value: number): void {
    const state = this.state;
    switch (kind) {
      case "coin":
        this.emitFeedback("hit", value, "light");
        break;
      case "grocery": {
        this.emitFeedback("score", value, "success");
        if (state) this.chrome?.setList(state.groceries);
        const grocery = SURF_GROCERIES[value];
        if (grocery) this.chrome?.showToast(`${grocery.glyph} ${pickLocalized(grocery.label)}`);
        break;
      }
      case "near-miss":
        this.chrome?.showToast(`${surfCopy("toastNearMiss")} +${value}`);
        this.emitFeedback("hit", value);
        break;
      case "trick":
        this.chrome?.showToast(`${surfCopy("toastTrick")} +${value}`);
        this.emitFeedback("combo", value, "medium");
        break;
      case "combo":
        this.chrome?.setMultiplier(value);
        this.chrome?.showToast(`${surfCopy("toastCombo")} ×${value}`);
        this.emitFeedback("combo", value);
        break;
      case "bump": {
        this.chrome?.setShields(value, SURF_SHIELD_COUNT);
        this.chrome?.setMultiplier(1);
        this.chrome?.showToast(value === 1 ? surfCopy("toastLastShield") : surfCopy("toastBump"));
        this.emitFeedback("miss", value, "warning");
        break;
      }
      case "list-complete":
        this.chrome?.showToast(surfCopy("listDone"));
        this.emitFeedback("score", value, "success");
        break;
      case "jump":
      case "duck":
        this.context?.haptics?.impact("light");
        break;
      default:
        break;
    }
  }

  private emitFeedback(action: SoundAction, value?: number, haptic?: HapticPattern): void {
    this.context?.audio?.emit(action, value);
    if (haptic) this.context?.haptics?.impact(haptic);
  }

  /* ---------------------------------------------------------------- */
  /* Rendering & perf                                                  */
  /* ---------------------------------------------------------------- */

  private renderScene(dt: number): void {
    const state = this.state;
    if (!state) return;
    this.scene?.render(state, dt);
  }

  private samplePerf(dt: number): void {
    this.perfSamples[this.perfIndex] = dt;
    this.perfIndex = (this.perfIndex + 1) % PERF_SAMPLE_CAP;
    this.perfCount += 1;
  }
}

export const createMinigame = (): MinigameModule => new ShoppingSurfGame();
