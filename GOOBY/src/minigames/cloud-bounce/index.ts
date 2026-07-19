/**
 * Gooby Cloud Bounce — the complete specialist build.
 *
 * A portrait sky-hopper on the shared Stage3D lease (pooled instanced cloud
 * puffs, spring pads, stars and wind-band arrows) with a full 2D-canvas
 * fallback when no lease is available. Gooby auto-bounces; the player only
 * drifts sideways with a held drag or held arrow keys. Static, moving,
 * fading and spring clouds mix with bonus stars and altitude wind bands; the
 * run ends only by falling out of the sky.
 *
 * The pure fixed-step model lives in `model.ts`; this module wires it to the
 * Arcade Kit chrome (tutorial, HUD, pause gate, results) and settles each
 * scored run exactly once through the injected lifecycle. Exits never pay.
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
import {
  acquireArcadeKitStyles,
  ArcadeCountdown,
  createArcadeHud,
  createResultScreen,
  createTutorialOverlay,
  FixedStepAccumulator,
  PauseGate,
  type ArcadeHud,
  type ResultScreen,
  type TutorialOverlay,
} from "../shared";
import type { MinigameStubDefinition } from "../stub";
import { createCloudFallback, type CloudFallback } from "./fallback";
import {
  beginCloudRun,
  CLOUD_STEP_SECONDS,
  createCloudState,
  drainCloudEvents,
  setCloudDrift,
  stepCloud,
  type CloudEventKind,
  type CloudState,
} from "./model";
import { createCloudScene, type CloudScene } from "./scene";
import { cloudPayout, createCloudSettlement, type CloudSettlement } from "./settlement";

export const manifest: MinigameManifest = validateMinigameManifest({
  id: "cloud-bounce",
  title: localizedText((catalog) => catalog.minigames["cloud-bounce"].title),
  instructions: localizedText((catalog) => catalog.minigames["cloud-bounce"].instructions),
  icon: EN_CATALOG.minigames["cloud-bounce"].icon,
  category: "action",
  stage3d: false,
  unlockLevel: 1,
  audioCues: ["countdown", "go", "hit", "miss", "combo", "score", "win", "lose"],
  tutorial: [
    {
      icon: "☁",
      title: { en: "Bounce and drift", de: "Hüpfen und driften" },
      body: {
        en: "Gooby bounces on his own. Hold and drag left or right (or hold ←/→) to drift through the sky.",
        de: "Gooby hüpft von selbst. Halte und ziehe nach links oder rechts (oder halte ←/→), um durch den Himmel zu driften.",
      },
    },
    {
      icon: "🌀",
      title: { en: "Read the clouds", de: "Lies die Wolken" },
      body: {
        en: "Blue clouds drift sideways, wispy ones vanish after a single bounce, and coral pads spring you extra high.",
        de: "Blaue Wolken ziehen zur Seite, zarte lösen sich nach einem Hüpfer auf, und Korallen-Polster schleudern dich extra hoch.",
      },
    },
    {
      icon: "⭐",
      title: { en: "Stars and wind", de: "Sterne und Wind" },
      body: {
        en: "Grab stars for bonus points and lean against the arrow wind bands. Fall below the clouds and the run ends.",
        de: "Sammle Sterne für Bonuspunkte und stemme dich gegen die Pfeil-Windbänder. Fällst du unter die Wolken, endet der Lauf.",
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
  | "countdown"
  | "running"
  | "paused"
  | "result"
  | "ready"
  | "disposed";

type SoundAction = "hit" | "miss" | "combo" | "countdown" | "go" | "win" | "lose" | "score";

type CloudContext = MinigameContext & {
  readonly audio?: { emit(action: SoundAction, value?: number): void };
  readonly haptics?: { impact(pattern: HapticPattern): void };
  readonly bestScore?: number;
  readonly reducedMotion?: boolean;
};

export interface CloudPerfSnapshot {
  readonly frames: number;
  readonly fps: number;
  readonly p95FrameMs: number;
  readonly drawCalls: number;
  readonly triangles: number;
}

interface CloudCopyEntry {
  readonly en: string;
  readonly de: string;
}

const COPY = {
  height: { en: "Height", de: "Höhe" },
  stars: { en: "Stars", de: "Sterne" },
  keysHint: {
    en: "Hold and drag to drift · hold ←/→ or A/D · P pauses",
    de: "Halten und ziehen zum Driften · ←/→ oder A/D halten · P pausiert",
  },
  start: { en: "Bounce!", de: "Hüpf los!" },
  springToast: { en: "Boing! Spring cloud", de: "Boing! Sprungwolke" },
  starToast: { en: "Star", de: "Stern" },
  windEastToast: { en: "Wind blows east →", de: "Wind weht nach Osten →" },
  windWestToast: { en: "← Wind blows west", de: "← Wind weht nach Westen" },
  milestoneToast: { en: "m high!", de: "m hoch!" },
  fallToast: { en: "Fell through the clouds", de: "Durch die Wolken gefallen" },
  fallbackNote: {
    en: "Simple sky view (3D unavailable) — same game, full controls.",
    de: "Einfache Himmelsansicht (3D nicht verfügbar) — gleiches Spiel, volle Steuerung.",
  },
  leftUnpaid: { en: "Left without reward", de: "Ohne Belohnung verlassen" },
  heightDetail: { en: "high", de: "hoch" },
  starsDetail: { en: "stars", de: "Sterne" },
  bounceDetail: { en: "bounces", de: "Hüpfer" },
} as const satisfies Record<string, CloudCopyEntry>;

function copy(key: keyof typeof COPY): string {
  return pickLocalized(COPY[key]);
}

const CB_CSS = `
.cloud-bounce{position:absolute;inset:0;overflow:hidden;background:#8fd0f2;font-family:inherit;touch-action:none;user-select:none;-webkit-user-select:none}
.cb-stage{position:absolute;inset:0}
.cb-stage canvas{position:absolute;inset:0}
.cb-chrome{position:absolute;z-index:15;top:calc(64px + env(safe-area-inset-top));left:max(10px,env(safe-area-inset-left));right:max(10px,env(safe-area-inset-right));display:flex;gap:8px;align-items:center;pointer-events:none}
.cb-pill{display:flex;align-items:center;gap:6px;min-height:28px;padding:4px 10px;border-radius:12px;background:rgba(20,38,66,.62);color:#f2f8ff;font-size:12px;font-weight:800;letter-spacing:.04em}
.cb-status{position:absolute;z-index:15;left:0;right:0;bottom:calc(14px + env(safe-area-inset-bottom));text-align:center;color:#173a5c;font-size:12px;font-weight:700;letter-spacing:.03em;opacity:.9;pointer-events:none;padding:0 16px}
.cb-toast{position:absolute;z-index:16;top:32%;left:50%;transform:translateX(-50%);padding:8px 16px;border-radius:999px;background:rgba(255,255,255,.94);color:#1d4568;font-size:14px;font-weight:900;pointer-events:none;transition:opacity .25s ease}
.cb-toast[hidden]{display:none}
.cb-countdown{position:absolute;z-index:16;top:40%;left:50%;transform:translate(-50%,-50%);color:#12406b;font-size:64px;font-weight:900;text-shadow:0 4px 24px rgba(255,255,255,.6);pointer-events:none}
.cb-countdown[hidden]{display:none}
.cloud-bounce[data-ak-reduced="true"] .cb-toast{transition:none}
@media (prefers-reduced-motion: reduce){.cloud-bounce .cb-toast{transition:none}}
`;

const EMPTY_PAYOUT: MinigamePayout = { score: 0, coins: 0, xp: 0 };
const MAX_FRAME_SECONDS = 0.25;
const TOAST_SECONDS = 1.6;
/** A drag across this fraction of the stage width means full drift. */
const DRAG_FULL_DRIFT_FRACTION = 0.3;
const PERF_SAMPLE_CAP = 360;

export class CloudBounceGame implements MinigameModule {
  readonly id = manifest.id;

  private context: CloudContext | null = null;
  private root: HTMLElement | null = null;
  private scene: CloudScene | null = null;
  private fallback: CloudFallback | null = null;
  private hud: ArcadeHud | null = null;
  private tutorial: TutorialOverlay | null = null;
  private result: ResultScreen | null = null;
  private settlement: CloudSettlement | null = null;
  private releaseKitStyles: (() => void) | null = null;
  private readonly pauseGate = new PauseGate();
  private readonly cleanup: Array<() => void> = [];

  private phase: ModulePhase = "boot";
  private pausedFrom: Exclude<ModulePhase, "paused"> | null = null;
  private state: CloudState | null = null;
  private countdown: ArcadeCountdown | null = null;
  private accumulator = new FixedStepAccumulator({
    stepSeconds: CLOUD_STEP_SECONDS,
    maxFrameSeconds: MAX_FRAME_SECONDS,
  });
  private settledPayout: MinigamePayout | null = null;
  private best = 0;

  // Input trackers.
  private pointerId: number | null = null;
  private dragOriginX = 0;
  private keyDrift: -1 | 0 | 1 = 0;
  private readonly heldKeys = new Set<"left" | "right">();

  // Chrome references (created once per mount).
  private heightPill: HTMLElement | null = null;
  private starPill: HTMLElement | null = null;
  private statusLine: HTMLElement | null = null;
  private toastElement: HTMLElement | null = null;
  private countdownElement: HTMLElement | null = null;
  private toastTimer = 0;

  // HUD diffing keeps steady frames free of DOM writes.
  private hudScore = -1;
  private hudCombo = -1;
  private hudTimer = -1;
  private hudMeters = -1;
  private hudStars = -1;

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
    const shared = context as CloudContext;
    this.context = shared;
    this.settlement = createCloudSettlement(context);
    this.best = this.settlement.persistedBest;
    this.settledPayout = null;
    const document = context.mount.ownerDocument;
    this.releaseKitStyles = acquireArcadeKitStyles(document);

    const root = document.createElement("section");
    root.className = "cloud-bounce";
    root.dataset.minigame = this.id;
    root.dataset.cbPhase = "tutorial";
    root.tabIndex = 0;
    root.setAttribute("aria-label", this.title);
    if (this.reducedMotion) root.dataset.akReduced = "true";
    const style = document.createElement("style");
    style.textContent = CB_CSS;
    root.append(style);

    const stage = document.createElement("div");
    stage.className = "cb-stage";
    stage.dataset.cb = "stage";
    root.append(stage);

    const chrome = document.createElement("div");
    chrome.className = "cb-chrome";
    this.heightPill = document.createElement("span");
    this.heightPill.className = "cb-pill";
    this.heightPill.dataset.cb = "height";
    this.starPill = document.createElement("span");
    this.starPill.className = "cb-pill";
    this.starPill.dataset.cb = "stars";
    chrome.append(this.heightPill);
    chrome.append(this.starPill);
    root.append(chrome);

    this.statusLine = document.createElement("p");
    this.statusLine.className = "cb-status";
    this.statusLine.dataset.cb = "status";
    this.statusLine.setAttribute("role", "status");
    this.statusLine.setAttribute("aria-live", "polite");
    this.statusLine.textContent = copy("keysHint");
    root.append(this.statusLine);

    this.toastElement = document.createElement("div");
    this.toastElement.className = "cb-toast";
    this.toastElement.dataset.cb = "toast";
    this.toastElement.hidden = true;
    root.append(this.toastElement);

    this.countdownElement = document.createElement("div");
    this.countdownElement.className = "cb-countdown";
    this.countdownElement.dataset.cb = "countdown";
    this.countdownElement.hidden = true;
    root.append(this.countdownElement);

    context.mount.replaceChildren(root);
    this.root = root;

    try {
      this.scene = createCloudScene({
        mount: stage,
        clock: context.clock,
        reducedMotion: this.reducedMotion,
      });
    } catch {
      // No Stage3D lease (no WebGL, or another lease is active): the full
      // game still runs on the 2D-canvas fallback view.
      this.scene = null;
      this.fallback = createCloudFallback({
        mount: stage,
        reducedMotion: this.reducedMotion,
      });
      this.announce(copy("fallbackNote"));
    }

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
        this.beginCountdown();
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
    panel.className = "ak-overlay cb-panel";
    panel.dataset.cb = "panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.hidden = true;
    root.append(panel);
    this.bindPanelActions(panel);

    this.bindPointer(stage);
    this.bindKeyboard(root);

    // Ambient state renders the sky behind the tutorial immediately.
    this.state = createCloudState(context.rng);
    this.phase = "tutorial";
  }

  start(): void {
    if (!this.root || this.phase !== "tutorial") return;
    this.tutorial?.open();
    this.root.focus();
  }

  pause(): void {
    if (this.phase !== "running" && this.phase !== "countdown") return;
    this.pausedFrom = this.phase;
    this.phase = "paused";
    this.setPhaseAttribute();
    this.pauseGate.pause();
    this.resetInputTrackers();
    this.showPausePanel();
  }

  resume(): void {
    if (this.phase !== "paused") return;
    this.phase = this.pausedFrom ?? "running";
    this.pausedFrom = null;
    this.setPhaseAttribute();
    this.pauseGate.resume();
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
    this.updateToast(dt);

    if (this.phase === "countdown") {
      this.countdown?.update(dt);
      this.renderView(dt);
      return;
    }

    if (this.phase === "running") {
      const state = this.state;
      if (!state) return;
      this.accumulator.advance(dt, (stepSeconds) => {
        stepCloud(state, stepSeconds);
      });
      drainCloudEvents(state, (kind, value) => {
        this.onModelEvent(kind, value);
      });
      if (dt > 0) this.samplePerf(dt);
      this.syncHud(state);
      this.syncChrome(state);
      if (state.phase === "finished") {
        this.finishRun();
        return;
      }
      this.renderView(dt);
      return;
    }

    // Tutorial / ready / result / paused keep the last rendered frame.
    this.renderView(0);
  }

  payout(): MinigamePayout {
    return this.settledPayout ?? EMPTY_PAYOUT;
  }

  dispose(): void {
    if (this.phase === "disposed") return;
    this.phase = "disposed";
    this.settlement?.exitUnpaid();
    for (const remove of this.cleanup.splice(0)) remove();
    this.hud?.dispose();
    this.hud = null;
    this.tutorial?.dispose();
    this.tutorial = null;
    this.result?.dispose();
    this.result = null;
    this.scene?.dispose();
    this.scene = null;
    this.fallback?.dispose();
    this.fallback = null;
    this.root?.remove();
    this.root = null;
    this.releaseKitStyles?.();
    this.releaseKitStyles = null;
    this.pauseGate.dispose();
    this.countdown = null;
    this.state = null;
    this.settlement = null;
    this.context = null;
    this.heightPill = null;
    this.starPill = null;
    this.statusLine = null;
    this.toastElement = null;
    this.countdownElement = null;
  }

  /** Live perf counters for the audit harness (fps / p95 / draw calls). */
  perfSnapshot(): CloudPerfSnapshot {
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

  private beginCountdown(): void {
    const context = this.context;
    if (!context || !this.settlement) return;
    this.result?.close();
    this.hidePanel();
    this.settlement.begin();
    this.settledPayout = null;
    this.state = createCloudState(context.rng);
    this.accumulator.reset();
    this.resetInputTrackers();
    this.perfIndex = 0;
    this.perfCount = 0;
    this.best = this.settlement.persistedBest;
    this.hud?.setBest(this.best);
    this.hud?.setScore(0);
    this.hud?.setCombo(0);
    this.hud?.setTimer(0);
    this.hudScore = -1;
    this.hudCombo = -1;
    this.hudTimer = -1;
    this.hudMeters = -1;
    this.hudStars = -1;
    this.phase = "countdown";
    this.setPhaseAttribute();
    this.pauseGate.resume();
    this.countdown = new ArcadeCountdown({
      seconds: 3,
      feedback: (event) => {
        if (event.kind === "tick") {
          this.emitFeedback("countdown");
          this.setCountdownText(String(event.value));
          this.announce(`${activeCatalog().strings.minigameCommon.ready} ${event.value}`);
        } else {
          this.emitFeedback("go", undefined, "success");
          this.setCountdownText(null);
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
    beginCloudRun(state);
    drainCloudEvents(state, (kind, value) => {
      this.onModelEvent(kind, value);
    });
    this.phase = "running";
    this.setPhaseAttribute();
    this.countdown = null;
    this.announce(copy("start"));
    this.syncChrome(state);
  }

  private finishRun(): void {
    const state = this.state;
    const settlement = this.settlement;
    if (!state || !settlement) return;
    const payout = cloudPayout(state.score, state.starCount);
    const previousBest = settlement.persistedBest;
    this.settledPayout = payout;
    const bestAfter = settlement.complete(payout);
    this.best = Math.max(previousBest, bestAfter ?? payout.score);
    this.hud?.setBest(this.best);
    this.emitFeedback("win", payout.score, "success");
    this.phase = "result";
    this.setPhaseAttribute();
    const detail = `⬆ ${state.stats.meters} m ${copy("heightDetail")} · ⭐ ${state.starCount} ${copy("starsDetail")} · ☁ ${state.stats.bounces} ${copy("bounceDetail")}`;
    this.result?.show({
      score: payout.score,
      best: this.best,
      newBest: payout.score > 0 && payout.score > previousBest,
      detail,
    });
  }

  private exitUnpaid(): void {
    this.settlement?.exitUnpaid();
    this.announce(copy("leftUnpaid"));
    this.showReadyPanel();
  }

  private showReadyPanel(): void {
    this.phase = "ready";
    this.setPhaseAttribute();
    const panel = this.queryPanel();
    if (!panel) return;
    panel.hidden = false;
    const strings = activeCatalog().strings.minigameCommon;
    panel.innerHTML = `
      <div class="ak-card">
        <span class="ak-kicker">${this.title}</span>
        <div class="ak-card-icon" aria-hidden="true">☁</div>
        <h2>${this.title}</h2>
        <button class="ak-button ak-button-primary" data-cb-action="play">${strings.start}</button>
        <button class="ak-button ak-button-quiet" data-cb-action="how-to">${strings.howToPlay}</button>
      </div>
    `;
    panel.querySelector<HTMLButtonElement>("[data-cb-action='play']")?.focus();
  }

  private showPausePanel(): void {
    const panel = this.queryPanel();
    if (!panel) return;
    const strings = activeCatalog().strings.minigameCommon;
    panel.hidden = false;
    panel.innerHTML = `
      <div class="ak-card">
        <span class="ak-kicker">${strings.paused}</span>
        <div class="ak-card-icon" aria-hidden="true">☁</div>
        <h2>${strings.paused}</h2>
        <button class="ak-button ak-button-primary" data-cb-action="resume">${strings.resume}</button>
        <button class="ak-button ak-button-secondary" data-cb-action="restart">${strings.restart}</button>
        <button class="ak-button ak-button-quiet" data-cb-action="quit">${strings.quitNoReward}</button>
      </div>
    `;
    panel.querySelector<HTMLButtonElement>("[data-cb-action='resume']")?.focus();
  }

  private bindPanelActions(panel: HTMLElement): void {
    const onClick = (event: Event): void => {
      const target = event.target instanceof Element
        ? event.target.closest<HTMLElement>("[data-cb-action]")
        : null;
      if (!target) return;
      switch (target.dataset.cbAction) {
        case "play":
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
          this.beginCountdown();
          break;
        case "quit":
          this.pauseGate.resume();
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
    return this.root?.querySelector<HTMLElement>("[data-cb='panel']") ?? null;
  }

  private hidePanel(): void {
    const panel = this.queryPanel();
    if (!panel) return;
    panel.hidden = true;
    panel.replaceChildren();
  }

  private setPhaseAttribute(): void {
    if (this.root) this.root.dataset.cbPhase = this.phase;
  }

  /* ---------------------------------------------------------------- */
  /* Input                                                             */
  /* ---------------------------------------------------------------- */

  private resetInputTrackers(): void {
    this.pointerId = null;
    this.keyDrift = 0;
    this.heldKeys.clear();
    if (this.state) setCloudDrift(this.state, 0);
  }

  private applyDrift(drift: number): void {
    if (this.state && this.phase === "running") setCloudDrift(this.state, drift);
  }

  private applyKeyDrift(): void {
    const drift = (this.heldKeys.has("right") ? 1 : 0) - (this.heldKeys.has("left") ? 1 : 0);
    this.keyDrift = drift > 0 ? 1 : drift < 0 ? -1 : 0;
    if (this.pointerId === null) this.applyDrift(this.keyDrift);
  }

  private bindPointer(stage: HTMLElement): void {
    const onDown = (event: PointerEvent): void => {
      if (this.phase !== "running" || this.pointerId !== null) return;
      this.pointerId = event.pointerId;
      this.dragOriginX = event.clientX;
      try {
        stage.setPointerCapture?.(event.pointerId);
      } catch {
        // Capture is best-effort; synthetic pointers may not support it.
      }
      this.applyDrift(0);
    };
    const onMove = (event: PointerEvent): void => {
      if (event.pointerId !== this.pointerId || !this.root) return;
      const span = Math.max(1, this.root.clientWidth * DRAG_FULL_DRIFT_FRACTION);
      const drift = Math.max(-1, Math.min(1, (event.clientX - this.dragOriginX) / span));
      this.applyDrift(drift);
    };
    const onEnd = (event: PointerEvent): void => {
      if (event.pointerId !== this.pointerId) return;
      this.pointerId = null;
      // Held keys keep steering after the drag lifts.
      this.applyDrift(this.keyDrift);
    };
    const downListener: EventListener = (event) => {
      onDown(event as PointerEvent);
    };
    const moveListener: EventListener = (event) => {
      onMove(event as PointerEvent);
    };
    const endListener: EventListener = (event) => {
      onEnd(event as PointerEvent);
    };
    stage.addEventListener("pointerdown", downListener);
    stage.addEventListener("pointermove", moveListener);
    stage.addEventListener("pointerup", endListener);
    stage.addEventListener("pointercancel", endListener);
    this.cleanup.push(() => {
      stage.removeEventListener("pointerdown", downListener);
      stage.removeEventListener("pointermove", moveListener);
      stage.removeEventListener("pointerup", endListener);
      stage.removeEventListener("pointercancel", endListener);
    });
  }

  private bindKeyboard(root: HTMLElement): void {
    const sideFor = (key: string): "left" | "right" | null => {
      switch (key) {
        case "arrowleft":
        case "a":
          return "left";
        case "arrowright":
        case "d":
          return "right";
        default:
          return null;
      }
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      const key = event.key.toLowerCase();
      if (!event.repeat && (key === "p" || event.key === "Escape")) {
        if (this.phase === "running" || this.phase === "countdown") {
          event.preventDefault();
          this.pause();
          return;
        }
        if (this.phase === "paused") {
          event.preventDefault();
          this.resume();
          return;
        }
      }
      if (this.phase !== "running") return;
      const side = sideFor(key);
      if (side) {
        event.preventDefault();
        this.heldKeys.add(side);
        this.applyKeyDrift();
      }
    };
    const onKeyUp = (event: KeyboardEvent): void => {
      const side = sideFor(event.key.toLowerCase());
      if (side) {
        this.heldKeys.delete(side);
        this.applyKeyDrift();
      }
    };
    const onBlur = (): void => {
      this.resetInputTrackers();
    };
    const keyDownListener: EventListener = (event) => {
      onKeyDown(event as KeyboardEvent);
    };
    const keyUpListener: EventListener = (event) => {
      onKeyUp(event as KeyboardEvent);
    };
    const view = root.ownerDocument.defaultView;
    root.addEventListener("keydown", keyDownListener);
    root.addEventListener("keyup", keyUpListener);
    view?.addEventListener("blur", onBlur);
    this.cleanup.push(() => {
      root.removeEventListener("keydown", keyDownListener);
      root.removeEventListener("keyup", keyUpListener);
      view?.removeEventListener("blur", onBlur);
    });
  }

  /* ---------------------------------------------------------------- */
  /* Model events → feedback                                           */
  /* ---------------------------------------------------------------- */

  private onModelEvent(kind: CloudEventKind, value: number): void {
    switch (kind) {
      case "bounce":
        this.emitFeedback("hit", value);
        break;
      case "spring":
        this.showToast(copy("springToast"));
        this.emitFeedback("combo", value, "medium");
        break;
      case "star":
        this.showToast(`⭐ ${copy("starToast")} ×${value}`);
        this.emitFeedback("score", value, "light");
        break;
      case "wind":
        this.showToast(value > 0 ? copy("windEastToast") : copy("windWestToast"));
        this.announce(value > 0 ? copy("windEastToast") : copy("windWestToast"));
        break;
      case "milestone":
        this.showToast(`⬆ ${value} ${copy("milestoneToast")}`);
        this.emitFeedback("combo", value, "light");
        break;
      case "fall":
        this.showToast(copy("fallToast"));
        this.emitFeedback("lose", value, "warning");
        break;
      case "fade":
      case "finished":
      default:
        break;
    }
  }

  private emitFeedback(action: SoundAction, value?: number, haptic?: HapticPattern): void {
    this.context?.audio?.emit(action, value);
    if (haptic) this.context?.haptics?.impact(haptic);
  }

  /* ---------------------------------------------------------------- */
  /* Chrome & rendering                                                */
  /* ---------------------------------------------------------------- */

  private syncHud(state: CloudState): void {
    const timerValue = Math.ceil(state.time);
    if (timerValue !== this.hudTimer) {
      this.hudTimer = timerValue;
      this.hud?.setTimer(state.time);
    }
    if (state.score !== this.hudScore) {
      this.hudScore = state.score;
      this.hud?.setScore(state.score);
    }
    if (state.starCount !== this.hudCombo) {
      this.hudCombo = state.starCount;
      this.hud?.setCombo(state.starCount);
    }
  }

  private syncChrome(state: CloudState): void {
    if (state.stats.meters !== this.hudMeters) {
      this.hudMeters = state.stats.meters;
      if (this.heightPill) {
        this.heightPill.textContent = `⬆ ${state.stats.meters} m`;
      }
    }
    if (state.starCount !== this.hudStars) {
      this.hudStars = state.starCount;
      if (this.starPill) {
        this.starPill.textContent = `⭐ ${state.starCount}`;
      }
    }
  }

  private renderView(dt: number): void {
    const state = this.state;
    if (!state) return;
    this.scene?.render(state, dt);
    this.fallback?.render(state, dt);
  }

  private announce(text: string): void {
    if (this.statusLine && this.statusLine.textContent !== text) {
      this.statusLine.textContent = text;
    }
  }

  private setCountdownText(text: string | null): void {
    if (!this.countdownElement) return;
    this.countdownElement.hidden = text === null;
    if (text !== null) this.countdownElement.textContent = text;
  }

  private showToast(text: string): void {
    if (!this.toastElement) return;
    this.toastElement.textContent = text;
    this.toastElement.hidden = false;
    this.toastTimer = TOAST_SECONDS;
  }

  private updateToast(dt: number): void {
    if (!this.toastElement || this.toastElement.hidden) return;
    this.toastTimer -= dt;
    if (this.toastTimer <= 0) this.toastElement.hidden = true;
  }

  private samplePerf(dt: number): void {
    this.perfSamples[this.perfIndex] = dt;
    this.perfIndex = (this.perfIndex + 1) % PERF_SAMPLE_CAP;
    this.perfCount += 1;
  }
}

export const createMinigame = (): MinigameModule => new CloudBounceGame();
