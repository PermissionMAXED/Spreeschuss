/**
 * Gooby Firefly Lantern — the complete specialist build.
 *
 * A dusk-meadow painting game on a 2D canvas: the player draws glowing ink
 * paths with real pointer strokes (or the keyboard brush), fireflies latch
 * onto the paint and follow it, brambles deflect both ink and flight, ink
 * regenerates over time, and quick back-to-back lantern banks build a convoy
 * chain across five escalating rounds.
 *
 * The pure fixed-step model lives in `model.ts`; this module wires it to the
 * Arcade Kit chrome (manifest tutorial, HUD, pause gate, results) and
 * settles each scored run exactly once through the injected lifecycle.
 * Exits never pay.
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
import {
  beginFireflyRun,
  beginFireflyStroke,
  createFireflyState,
  drainFireflyEvents,
  endFireflyStroke,
  extendFireflyStroke,
  FIREFLY_ROUND_COUNT,
  FIREFLY_STEP_SECONDS,
  stepFirefly,
  type FireflyEventKind,
  type FireflyState,
} from "./model";
import { createFireflySettlement, fireflyPayout, type FireflySettlement } from "./settlement";
import { createFireflyView, type FireflyView } from "./view";

export const manifest: MinigameManifest = validateMinigameManifest({
  id: "firefly-lantern",
  title: localizedText((catalog) => catalog.minigames["firefly-lantern"].title),
  instructions: localizedText((catalog) => catalog.minigames["firefly-lantern"].instructions),
  icon: EN_CATALOG.minigames["firefly-lantern"].icon,
  category: "action",
  stage3d: false,
  unlockLevel: 1,
  audioCues: ["countdown", "go", "hit", "miss", "combo", "score", "win"],
  tutorial: [
    {
      icon: "✦",
      title: { en: "Paint a light path", de: "Male einen Lichtpfad" },
      body: {
        en: "Draw glowing ink with your finger or mouse. Fireflies latch onto the paint and follow it toward the lantern.",
        de: "Male leuchtende Tinte mit Finger oder Maus. Glühwürmchen heften sich an die Farbe und folgen ihr zur Laterne.",
      },
    },
    {
      icon: "🌿",
      title: { en: "Mind ink and brambles", de: "Achte auf Tinte und Dornen" },
      body: {
        en: "Thorny brambles block ink and deflect fireflies. Your ink pot is small but refills on its own.",
        de: "Dornige Ranken blockieren Tinte und lenken Glühwürmchen ab. Dein Tintenfass ist klein, füllt sich aber von selbst.",
      },
    },
    {
      icon: "🏮",
      title: { en: "Chain a convoy", de: "Bilde einen Konvoi" },
      body: {
        en: "Bank fireflies back-to-back for convoy bonuses. Clear all five rounds before each timer fades.",
        de: "Bringe Glühwürmchen Schlag auf Schlag heim für Konvoi-Boni. Schaffe alle fünf Runden, bevor die Zeit verglimmt.",
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

type FireflyContext = MinigameContext & {
  readonly audio?: { emit(action: SoundAction, value?: number): void };
  readonly haptics?: { impact(pattern: HapticPattern): void };
  readonly bestScore?: number;
  readonly reducedMotion?: boolean;
};

interface FireflyCopyEntry {
  readonly en: string;
  readonly de: string;
}

const COPY = {
  round: { en: "Round", de: "Runde" },
  lantern: { en: "Lantern", de: "Laterne" },
  ink: { en: "Ink", de: "Tinte" },
  keysHint: {
    en: "Draw with pointer · arrows move the brush · hold Space to paint · P pauses",
    de: "Male mit dem Zeiger · Pfeile bewegen den Pinsel · Leertaste halten zum Malen · P pausiert",
  },
  start: { en: "Light the lantern!", de: "Entzünde die Laterne!" },
  convoyToast: { en: "Convoy", de: "Konvoi" },
  clearToast: { en: "Round clear! Bonus", de: "Runde geschafft! Bonus" },
  timeoutToast: { en: "Time faded · fireflies drifted away", de: "Zeit verglommen · Glühwürmchen entflogen" },
  inkToast: { en: "Ink is empty — let it refill", de: "Tinte ist leer — lass sie nachfließen" },
  blockedToast: { en: "Brambles block the ink", de: "Dornen blockieren die Tinte" },
  leftUnpaid: { en: "Left without reward", de: "Ohne Belohnung verlassen" },
  finishDetail: { en: "banked", de: "eingefangen" },
  convoyDetail: { en: "best convoy", de: "bester Konvoi" },
  roundsDetail: { en: "rounds", de: "Runden" },
} as const satisfies Record<string, FireflyCopyEntry>;

function copy(key: keyof typeof COPY): string {
  return pickLocalized(COPY[key]);
}

const FL_CSS = `
.firefly-lantern{position:absolute;inset:0;overflow:hidden;background:#1c2140;font-family:inherit;touch-action:none;user-select:none;-webkit-user-select:none}
.fl-stage{position:absolute;inset:0}
.fl-chrome{position:absolute;z-index:15;top:calc(64px + env(safe-area-inset-top));left:max(10px,env(safe-area-inset-left));right:max(10px,env(safe-area-inset-right));display:flex;gap:8px;align-items:center;pointer-events:none}
.fl-pill{display:flex;align-items:center;gap:6px;min-height:28px;padding:4px 10px;border-radius:12px;background:rgba(24,26,48,.72);color:#f4ecd8;font-size:12px;font-weight:800;letter-spacing:.04em}
.fl-ink{flex:1;display:flex;align-items:center;gap:8px}
.fl-ink-track{position:relative;flex:1;height:10px;border-radius:6px;background:rgba(244,236,216,.18);overflow:hidden}
.fl-ink-fill{position:absolute;inset:0;transform-origin:left;background:linear-gradient(90deg,#ffd97a,#ffb45e);border-radius:6px}
.fl-status{position:absolute;z-index:15;left:0;right:0;bottom:calc(14px + env(safe-area-inset-bottom));text-align:center;color:#f4ecd8;font-size:12px;font-weight:700;letter-spacing:.03em;opacity:.85;pointer-events:none;padding:0 16px}
.fl-toast{position:absolute;z-index:16;top:32%;left:50%;transform:translateX(-50%);padding:8px 16px;border-radius:999px;background:rgba(255,214,120,.92);color:#4a3428;font-size:14px;font-weight:900;pointer-events:none;transition:opacity .25s ease}
.fl-toast[hidden]{display:none}
.fl-countdown{position:absolute;z-index:16;top:40%;left:50%;transform:translate(-50%,-50%);color:#ffe9a8;font-size:64px;font-weight:900;text-shadow:0 4px 24px rgba(0,0,0,.5);pointer-events:none}
.fl-countdown[hidden]{display:none}
.firefly-lantern[data-ak-reduced="true"] .fl-toast{transition:none}
@media (prefers-reduced-motion: reduce){.firefly-lantern .fl-toast{transition:none}}
`;

const EMPTY_PAYOUT: MinigamePayout = { score: 0, coins: 0, xp: 0 };
const MAX_FRAME_SECONDS = 0.25;
const BRUSH_SPEED = 0.55;
const TOAST_SECONDS = 1.6;

export class FireflyLanternGame implements MinigameModule {
  readonly id = manifest.id;

  private context: FireflyContext | null = null;
  private root: HTMLElement | null = null;
  private view: FireflyView | null = null;
  private hud: ArcadeHud | null = null;
  private tutorial: TutorialOverlay | null = null;
  private result: ResultScreen | null = null;
  private settlement: FireflySettlement | null = null;
  private releaseKitStyles: (() => void) | null = null;
  private readonly pauseGate = new PauseGate();
  private readonly cleanup: Array<() => void> = [];

  private phase: ModulePhase = "boot";
  private pausedFrom: Exclude<ModulePhase, "paused"> | null = null;
  private state: FireflyState | null = null;
  private countdown: ArcadeCountdown | null = null;
  private accumulator = new FixedStepAccumulator({
    stepSeconds: FIREFLY_STEP_SECONDS,
    maxFrameSeconds: MAX_FRAME_SECONDS,
  });
  private settledPayout: MinigamePayout | null = null;
  private best = 0;

  // Input trackers.
  private pointerId: number | null = null;
  private brushX = 0.5;
  private brushY = 0.6;
  private brushVisible = false;
  private brushDrawing = false;
  private readonly heldArrows = new Set<"left" | "right" | "up" | "down">();
  private spaceHeld = false;

  // Chrome references (created once per mount).
  private roundPill: HTMLElement | null = null;
  private lanternPill: HTMLElement | null = null;
  private inkFill: HTMLElement | null = null;
  private statusLine: HTMLElement | null = null;
  private toastElement: HTMLElement | null = null;
  private countdownElement: HTMLElement | null = null;
  private toastTimer = 0;

  // HUD diffing keeps steady frames free of DOM writes.
  private hudScore = -1;
  private hudCombo = -1;
  private hudTimer = -1;

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
    const shared = context as FireflyContext;
    this.context = shared;
    this.settlement = createFireflySettlement(context);
    this.best = this.settlement.persistedBest;
    this.settledPayout = null;
    const document = context.mount.ownerDocument;
    this.releaseKitStyles = acquireArcadeKitStyles(document);

    const root = document.createElement("section");
    root.className = "firefly-lantern";
    root.dataset.minigame = this.id;
    root.dataset.flPhase = "tutorial";
    root.tabIndex = 0;
    root.setAttribute("aria-label", this.title);
    if (this.reducedMotion) root.dataset.akReduced = "true";
    const style = document.createElement("style");
    style.textContent = FL_CSS;
    root.append(style);

    const stage = document.createElement("div");
    stage.className = "fl-stage";
    stage.dataset.fl = "stage";
    root.append(stage);

    const chrome = document.createElement("div");
    chrome.className = "fl-chrome";
    this.roundPill = document.createElement("span");
    this.roundPill.className = "fl-pill";
    this.roundPill.dataset.fl = "round";
    this.lanternPill = document.createElement("span");
    this.lanternPill.className = "fl-pill";
    this.lanternPill.dataset.fl = "lantern";
    const ink = document.createElement("span");
    ink.className = "fl-pill fl-ink";
    const inkLabel = document.createElement("small");
    inkLabel.textContent = copy("ink").toUpperCase();
    const inkTrack = document.createElement("span");
    inkTrack.className = "fl-ink-track";
    this.inkFill = document.createElement("span");
    this.inkFill.className = "fl-ink-fill";
    this.inkFill.dataset.fl = "ink";
    inkTrack.append(this.inkFill);
    ink.append(inkLabel);
    ink.append(inkTrack);
    chrome.append(this.roundPill);
    chrome.append(this.lanternPill);
    chrome.append(ink);
    root.append(chrome);

    this.statusLine = document.createElement("p");
    this.statusLine.className = "fl-status";
    this.statusLine.dataset.fl = "status";
    this.statusLine.setAttribute("role", "status");
    this.statusLine.setAttribute("aria-live", "polite");
    this.statusLine.textContent = copy("keysHint");
    root.append(this.statusLine);

    this.toastElement = document.createElement("div");
    this.toastElement.className = "fl-toast";
    this.toastElement.dataset.fl = "toast";
    this.toastElement.hidden = true;
    root.append(this.toastElement);

    this.countdownElement = document.createElement("div");
    this.countdownElement.className = "fl-countdown";
    this.countdownElement.dataset.fl = "countdown";
    this.countdownElement.hidden = true;
    root.append(this.countdownElement);

    context.mount.replaceChildren(root);
    this.root = root;

    this.view = createFireflyView({ mount: stage, reducedMotion: this.reducedMotion });

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
    panel.className = "ak-overlay fl-panel";
    panel.dataset.fl = "panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.hidden = true;
    root.append(panel);
    this.bindPanelActions(panel);

    this.bindPointer(this.view.canvas);
    this.bindKeyboard(root);

    // Ambient state renders the dusk meadow behind the tutorial immediately.
    this.state = createFireflyState(context.rng);
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
    this.releasePointer();
    this.heldArrows.clear();
    this.spaceHeld = false;
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
      this.renderView();
      return;
    }

    if (this.phase === "running") {
      const state = this.state;
      if (!state) return;
      this.accumulator.advance(dt, (stepSeconds) => {
        this.applyKeyboardBrush(stepSeconds);
        stepFirefly(state, stepSeconds);
      });
      drainFireflyEvents(state, (kind, value) => {
        this.onModelEvent(kind, value);
      });
      this.syncHud(state);
      this.syncChrome(state);
      if (state.phase === "finished") {
        this.finishRun();
        return;
      }
      this.renderView();
      return;
    }

    // Tutorial / ready / result / paused keep the last painted frame.
    this.renderView();
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
    this.view?.dispose();
    this.view = null;
    this.root?.remove();
    this.root = null;
    this.releaseKitStyles?.();
    this.releaseKitStyles = null;
    this.pauseGate.dispose();
    this.countdown = null;
    this.state = null;
    this.settlement = null;
    this.context = null;
    this.roundPill = null;
    this.lanternPill = null;
    this.inkFill = null;
    this.statusLine = null;
    this.toastElement = null;
    this.countdownElement = null;
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
    this.state = createFireflyState(context.rng);
    this.accumulator.reset();
    this.resetInputTrackers();
    this.best = this.settlement.persistedBest;
    this.hud?.setBest(this.best);
    this.hud?.setScore(0);
    this.hud?.setCombo(0);
    this.hud?.setTimer(0);
    this.hudScore = -1;
    this.hudCombo = -1;
    this.hudTimer = -1;
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
    beginFireflyRun(state);
    drainFireflyEvents(state, (kind, value) => {
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
    const payout = fireflyPayout(state.score, state.bestConvoy);
    const previousBest = settlement.persistedBest;
    this.settledPayout = payout;
    const bestAfter = settlement.complete(payout);
    this.best = Math.max(previousBest, bestAfter ?? payout.score);
    this.hud?.setBest(this.best);
    this.emitFeedback("win", payout.score, "success");
    this.phase = "result";
    this.setPhaseAttribute();
    const detail = `🏮 ${state.stats.banked} ${copy("finishDetail")} · ✦ ${state.bestConvoy}× ${copy("convoyDetail")} · ${FIREFLY_ROUND_COUNT}/${FIREFLY_ROUND_COUNT} ${copy("roundsDetail")}`;
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
        <div class="ak-card-icon" aria-hidden="true">🏮</div>
        <h2>${this.title}</h2>
        <button class="ak-button ak-button-primary" data-fl-action="play">${strings.start}</button>
        <button class="ak-button ak-button-quiet" data-fl-action="how-to">${strings.howToPlay}</button>
      </div>
    `;
    panel.querySelector<HTMLButtonElement>("[data-fl-action='play']")?.focus();
  }

  private showPausePanel(): void {
    const panel = this.queryPanel();
    if (!panel) return;
    const strings = activeCatalog().strings.minigameCommon;
    panel.hidden = false;
    panel.innerHTML = `
      <div class="ak-card">
        <span class="ak-kicker">${strings.paused}</span>
        <div class="ak-card-icon" aria-hidden="true">🏮</div>
        <h2>${strings.paused}</h2>
        <button class="ak-button ak-button-primary" data-fl-action="resume">${strings.resume}</button>
        <button class="ak-button ak-button-secondary" data-fl-action="restart">${strings.restart}</button>
        <button class="ak-button ak-button-quiet" data-fl-action="quit">${strings.quitNoReward}</button>
      </div>
    `;
    panel.querySelector<HTMLButtonElement>("[data-fl-action='resume']")?.focus();
  }

  private bindPanelActions(panel: HTMLElement): void {
    const onClick = (event: Event): void => {
      const target = event.target instanceof Element
        ? event.target.closest<HTMLElement>("[data-fl-action]")
        : null;
      if (!target) return;
      switch (target.dataset.flAction) {
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
    return this.root?.querySelector<HTMLElement>("[data-fl='panel']") ?? null;
  }

  private hidePanel(): void {
    const panel = this.queryPanel();
    if (!panel) return;
    panel.hidden = true;
    panel.replaceChildren();
  }

  private setPhaseAttribute(): void {
    if (this.root) this.root.dataset.flPhase = this.phase;
  }

  /* ---------------------------------------------------------------- */
  /* Input                                                             */
  /* ---------------------------------------------------------------- */

  private resetInputTrackers(): void {
    this.releasePointer();
    this.heldArrows.clear();
    this.spaceHeld = false;
    this.brushDrawing = false;
    this.brushVisible = false;
    this.brushX = 0.5;
    this.brushY = 0.6;
  }

  private releasePointer(): void {
    this.pointerId = null;
    this.brushDrawing = false;
    if (this.state) endFireflyStroke(this.state);
  }

  private bindPointer(canvas: HTMLElement): void {
    const onDown = (event: PointerEvent): void => {
      if (this.phase !== "running" || this.pointerId !== null || !this.view || !this.state) return;
      this.pointerId = event.pointerId;
      try {
        canvas.setPointerCapture?.(event.pointerId);
      } catch {
        // Capture is best-effort; synthetic pointers may not support it.
      }
      const field = this.view.toField(event.clientX, event.clientY);
      this.brushX = field.x;
      this.brushY = field.y;
      this.brushVisible = false;
      this.brushDrawing = beginFireflyStroke(this.state, field.x, field.y);
    };
    const onMove = (event: PointerEvent): void => {
      if (event.pointerId !== this.pointerId || !this.view || !this.state) return;
      const field = this.view.toField(event.clientX, event.clientY);
      this.brushX = field.x;
      this.brushY = field.y;
      if (this.brushDrawing) {
        const result = extendFireflyStroke(this.state, field.x, field.y);
        if (result === "blocked" || result === "no-ink") this.brushDrawing = false;
      }
    };
    const onEnd = (event: PointerEvent): void => {
      if (event.pointerId !== this.pointerId) return;
      this.releasePointer();
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
    canvas.addEventListener("pointerdown", downListener);
    canvas.addEventListener("pointermove", moveListener);
    canvas.addEventListener("pointerup", endListener);
    canvas.addEventListener("pointercancel", endListener);
    this.cleanup.push(() => {
      canvas.removeEventListener("pointerdown", downListener);
      canvas.removeEventListener("pointermove", moveListener);
      canvas.removeEventListener("pointerup", endListener);
      canvas.removeEventListener("pointercancel", endListener);
    });
  }

  private bindKeyboard(root: HTMLElement): void {
    const arrowFor = (key: string): "left" | "right" | "up" | "down" | null => {
      switch (key) {
        case "arrowleft":
        case "a":
          return "left";
        case "arrowright":
        case "d":
          return "right";
        case "arrowup":
        case "w":
          return "up";
        case "arrowdown":
        case "s":
          return "down";
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
      const arrow = arrowFor(key);
      if (arrow) {
        event.preventDefault();
        this.heldArrows.add(arrow);
        this.brushVisible = true;
        return;
      }
      if (key === " " && !event.repeat) {
        event.preventDefault();
        this.brushVisible = true;
        this.spaceHeld = true;
        if (this.state && this.pointerId === null) {
          this.brushDrawing = beginFireflyStroke(this.state, this.brushX, this.brushY);
        }
      }
    };
    const onKeyUp = (event: KeyboardEvent): void => {
      const key = event.key.toLowerCase();
      const arrow = arrowFor(key);
      if (arrow) this.heldArrows.delete(arrow);
      if (key === " ") {
        this.spaceHeld = false;
        if (this.pointerId === null) this.releasePointer();
      }
    };
    const onBlur = (): void => {
      this.heldArrows.clear();
      this.spaceHeld = false;
      this.releasePointer();
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

  /** Keyboard brush: arrows steer, held Space keeps painting. */
  private applyKeyboardBrush(stepSeconds: number): void {
    if (this.pointerId !== null || !this.state) return;
    const dx = (this.heldArrows.has("right") ? 1 : 0) - (this.heldArrows.has("left") ? 1 : 0);
    const dy = (this.heldArrows.has("down") ? 1 : 0) - (this.heldArrows.has("up") ? 1 : 0);
    if (dx !== 0 || dy !== 0) {
      this.brushX = Math.min(1, Math.max(0, this.brushX + dx * BRUSH_SPEED * stepSeconds));
      this.brushY = Math.min(1, Math.max(0, this.brushY + dy * BRUSH_SPEED * stepSeconds));
      this.brushVisible = true;
    }
    if (this.spaceHeld) {
      if (!this.brushDrawing) {
        this.brushDrawing = beginFireflyStroke(this.state, this.brushX, this.brushY);
      } else {
        const result = extendFireflyStroke(this.state, this.brushX, this.brushY);
        if (result === "blocked" || result === "no-ink") this.brushDrawing = false;
      }
    }
  }

  /* ---------------------------------------------------------------- */
  /* Model events → feedback                                           */
  /* ---------------------------------------------------------------- */

  private onModelEvent(kind: FireflyEventKind, value: number): void {
    switch (kind) {
      case "round-start":
        if (value > 1) this.emitFeedback("countdown");
        this.announce(`${copy("round")} ${value}/${FIREFLY_ROUND_COUNT}`);
        break;
      case "bank":
        this.emitFeedback("hit", value, "light");
        break;
      case "convoy":
        this.showToast(`${copy("convoyToast")} ×${value}`);
        this.emitFeedback("combo", value, "medium");
        break;
      case "round-clear":
        this.showToast(`${copy("clearToast")} +${value}`);
        this.emitFeedback("score", value, "success");
        break;
      case "round-timeout":
        this.showToast(copy("timeoutToast"));
        this.emitFeedback("miss", value, "warning");
        break;
      case "ink-empty":
        this.showToast(copy("inkToast"));
        this.emitFeedback("miss");
        break;
      case "path-blocked":
        this.showToast(copy("blockedToast"));
        this.context?.haptics?.impact("light");
        break;
      case "deflect":
        this.context?.haptics?.impact("light");
        break;
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

  private syncHud(state: FireflyState): void {
    const timerValue = Math.ceil(state.timeLeft);
    if (timerValue !== this.hudTimer) {
      this.hudTimer = timerValue;
      this.hud?.setTimer(state.timeLeft);
    }
    const scoreValue = Math.floor(state.score);
    if (scoreValue !== this.hudScore) {
      this.hudScore = scoreValue;
      this.hud?.setScore(scoreValue);
    }
    if (state.convoyChain !== this.hudCombo) {
      this.hudCombo = state.convoyChain;
      this.hud?.setCombo(state.convoyChain);
    }
  }

  private syncChrome(state: FireflyState): void {
    const roundText = `${copy("round").toUpperCase()} ${Math.min(FIREFLY_ROUND_COUNT, state.round + 1)}/${FIREFLY_ROUND_COUNT}`;
    if (this.roundPill && this.roundPill.textContent !== roundText) {
      this.roundPill.textContent = roundText;
    }
    const lanternText = `🏮 ${state.bankedThisRound}/${Math.max(1, state.fireflies.length)}`;
    if (this.lanternPill && this.lanternPill.textContent !== lanternText) {
      this.lanternPill.textContent = lanternText;
    }
    if (this.inkFill) {
      this.inkFill.style.transform = `scaleX(${Math.max(0, Math.min(1, state.ink)).toFixed(3)})`;
    }
  }

  private renderView(): void {
    const state = this.state;
    if (!state || !this.view) return;
    this.view.render(state, {
      x: this.brushX,
      y: this.brushY,
      visible: this.brushVisible && this.phase === "running",
      drawing: this.brushDrawing,
    });
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
}

export const createMinigame = (): MinigameModule => new FireflyLanternGame();
