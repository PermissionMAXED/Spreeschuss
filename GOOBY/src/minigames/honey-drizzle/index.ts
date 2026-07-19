import {
  validateMinigameManifest,
  type MinigameAudioCue,
  type MinigameContext,
  type MinigameManifest,
  type MinigameModule,
  type MinigamePayout,
} from "../../core/contracts/minigame";
import type { HapticPattern } from "../../core/contracts/platform";
import { activeCatalog, EN_CATALOG, localizedText, pickLocalized } from "../../i18n";
import {
  acquireArcadeKitStyles,
  ArcadeCountdown,
  createArcadeHud,
  createResultScreen,
  createTutorialOverlay,
  PauseGate,
  type ArcadeHud,
  type ResultScreen,
  type TutorialOverlay,
} from "../shared";
import type { MinigameStubDefinition } from "../stub";
import {
  HONEY_GAP_RADIUS,
  HONEY_GRID_HEIGHT,
  HONEY_GRID_WIDTH,
  HONEY_REQUIRED_COVERAGE,
  HoneyDrizzleRound,
  type HoneyPoint,
} from "./logic";
import { createHoneySettlement, type HoneySettlement } from "./settlement";

export const manifest: MinigameManifest = validateMinigameManifest({
  id: "honey-drizzle",
  title: localizedText((catalog) => catalog.minigames["honey-drizzle"].title),
  instructions: localizedText((catalog) => catalog.minigames["honey-drizzle"].instructions),
  icon: EN_CATALOG.minigames["honey-drizzle"].icon,
  category: "skill",
  stage3d: false,
  unlockLevel: 1,
  audioCues: ["countdown", "go", "hit", "miss", "combo", "score", "win"],
  tutorial: [
    {
      icon: "🍯",
      title: { en: "Hold the honey stream", de: "Halte den Honigstrahl" },
      body: {
        en: "Press and hold, then guide the stream along the pale toast corridor. Release whenever you need to reposition.",
        de: "Drücke und halte, dann führe den Strahl durch den hellen Toastweg. Lass los, wenn du neu ansetzen möchtest.",
      },
    },
    {
      icon: "〰",
      title: { en: "Find the cozy speed", de: "Finde das gemütliche Tempo" },
      body: {
        en: "Rush and the line becomes patchy; linger and honey pools into a flood. A steady sweep gives even coverage.",
        de: "Zu schnell wird die Linie lückenhaft, zu langsam bildet sich eine Pfütze. Ein ruhiger Zug deckt gleichmäßig.",
      },
    },
    {
      icon: "🐝",
      title: { en: "Mind the moving gap", de: "Achte auf die wandernde Lücke" },
      body: {
        en: "The bee warning marks a moving no-drizzle gap. Lift the stream while the bee crosses the corridor.",
        de: "Die Bienenwarnung markiert eine wandernde Honigpause. Hebe den Strahl an, während die Biene den Weg kreuzt.",
      },
    },
    {
      icon: "♡",
      title: { en: "Cover, don't spill", de: "Bedecken, nicht kleckern" },
      body: {
        en: "Finish three toast trails with broad coverage, few spills, and no sticky floods for a cozy score.",
        de: "Fülle drei Toastwege mit guter Abdeckung, wenig Kleckern und ohne Honigflut für eine gemütliche Wertung.",
      },
    },
  ],
});

export const definition: MinigameStubDefinition = {
  id: manifest.id,
  title: manifest.title.en,
  instructions: manifest.instructions.en,
};

type Phase = "boot" | "tutorial" | "ready" | "countdown" | "playing" | "paused" | "result" | "disposed";
type SharedContext = MinigameContext & {
  readonly audio?: { emit(action: MinigameAudioCue, value?: number): void };
  readonly haptics?: { impact(pattern: HapticPattern): void };
  readonly reducedMotion?: boolean;
  readonly bestScore?: number;
};

const EMPTY_PAYOUT: MinigamePayout = { score: 0, coins: 0, xp: 0 };
const COPY = {
  ready: { en: "Breakfast is ready", de: "Frühstück ist bereit" },
  start: { en: "Start drizzling", de: "Träufeln starten" },
  replay: { en: "How to play", de: "So wird gespielt" },
  hint: { en: "Hold and trace the cream corridor", de: "Halte und folge dem hellen Weg" },
  finish: { en: "Serve this toast", de: "Toast servieren" },
  closer: { en: "Cover a little more of the trail", de: "Bedecke noch etwas mehr vom Weg" },
  bee: { en: "Bee crossing — lift the stream!", de: "Biene kreuzt – Strahl anheben!" },
  sweet: { en: "Cozy drizzle!", de: "Gemütlich geträufelt!" },
  paused: { en: "Honey jar resting", de: "Honigglas ruht" },
  leftUnpaid: { en: "Breakfast left without rewards", de: "Frühstück ohne Belohnung verlassen" },
  coverage: { en: "Coverage", de: "Abdeckung" },
  spill: { en: "Spill", de: "Kleckern" },
  flood: { en: "Flood", de: "Flut" },
  toast: { en: "toast trails", de: "Toastwege" },
} as const;

function copy(key: keyof typeof COPY): string {
  return pickLocalized(COPY[key]);
}

export class HoneyDrizzleGame implements MinigameModule {
  readonly id = manifest.id;

  private context: SharedContext | null = null;
  private root: HTMLElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private canvasContext: CanvasRenderingContext2D | null = null;
  private hud: ArcadeHud | null = null;
  private tutorial: TutorialOverlay | null = null;
  private result: ResultScreen | null = null;
  private settlement: HoneySettlement | null = null;
  private round: HoneyDrizzleRound | null = null;
  private countdown: ArcadeCountdown | null = null;
  private releaseStyles: (() => void) | null = null;
  private readonly pauseGate = new PauseGate();
  private readonly cleanup: Array<() => void> = [];
  private phase: Phase = "boot";
  private pausedFrom: "playing" | "countdown" = "playing";
  private settledPayout: MinigamePayout | null = null;
  private best = 0;
  private activePointer: number | null = null;
  private streamHeld = false;
  private nozzle: HoneyPoint = { x: 0.08, y: 0.5 };
  private lastDrizzlePoint: HoneyPoint = { x: 0.08, y: 0.5 };
  private heldSeconds = 0;
  private elapsed = 0;
  private warningShown = false;

  get title(): string {
    return pickLocalized(manifest.title);
  }

  get instructions(): string {
    return pickLocalized(manifest.instructions);
  }

  mount(context: MinigameContext): void {
    if (this.phase !== "boot" && this.phase !== "disposed") this.dispose();
    this.context = context;
    this.settlement = createHoneySettlement(context);
    this.best = this.settlement.persistedBest;
    const document = context.mount.ownerDocument;
    this.releaseStyles = acquireArcadeKitStyles(document);
    const root = document.createElement("section");
    root.className = "honey-drizzle";
    root.dataset.minigame = this.id;
    root.tabIndex = 0;
    root.setAttribute("aria-label", this.title);
    if (this.context.reducedMotion === true) root.dataset.akReduced = "true";
    root.innerHTML = `
      <style>${HONEY_CSS}</style>
      <div class="hd-scene">
        <div class="hd-order"><span>🍞</span><b data-hd="toast-label">1 / 3</b><span data-hd="bee" aria-hidden="true">🐝</span></div>
        <p class="hd-hint">${copy("hint")}</p>
        <div class="hd-stage">
          <canvas class="hd-canvas" data-hd="canvas" aria-label="${copy("hint")}"></canvas>
          <div class="hd-countdown" data-hd="countdown" hidden aria-hidden="true"></div>
          <div class="hd-jar" aria-hidden="true">🍯</div>
        </div>
        <div class="hd-stats">
          <span><b>${copy("coverage")}</b><i data-hd="coverage">0%</i></span>
          <span><b>${copy("spill")}</b><i data-hd="spill">0%</i></span>
          <span><b>${copy("flood")}</b><i data-hd="flood">0%</i></span>
        </div>
        <button class="hd-finish" data-hd-action="finish">♡ ${copy("finish")}</button>
        <div class="hd-status" data-hd="status" role="status" aria-live="polite"></div>
      </div>
      <div class="ak-overlay hd-panel" data-hd="panel" role="dialog" aria-modal="true" hidden></div>
    `;
    context.mount.replaceChildren(root);
    this.root = root;
    this.canvas = root.querySelector<HTMLCanvasElement>("[data-hd='canvas']");
    this.canvasContext = this.canvas?.getContext("2d") ?? null;
    this.hud = createArcadeHud({
      host: root,
      initialBest: this.best,
      reducedMotion: this.context.reducedMotion === true,
      onPause: () => this.pause(),
    });
    this.tutorial = createTutorialOverlay({
      host: root,
      steps: manifest.tutorial,
      reducedMotion: this.context.reducedMotion === true,
      onStart: () => this.showReady(),
      onExitWithoutReward: () => this.showReady(copy("leftUnpaid")),
    });
    this.result = createResultScreen({
      host: root,
      reducedMotion: this.context.reducedMotion === true,
      hooks: {
        onCollect: () => this.showReady(),
        onPlayAgain: () => this.beginRound(),
      },
    });
    this.listen(root, "click", (event) => this.onClick(event));
    this.listen(root, "keydown", (event) => this.onKeyDown(event));
    this.listen(root, "keyup", (event) => this.onKeyUp(event));
    if (this.canvas) {
      this.listen(this.canvas, "pointerdown", (event) => this.onPointerDown(event));
      this.listen(this.canvas, "pointermove", (event) => this.onPointerMove(event));
      this.listen(this.canvas, "pointerup", (event) => this.onPointerEnd(event));
      this.listen(this.canvas, "pointercancel", (event) => this.onPointerEnd(event));
    }
    const view = document.defaultView;
    if (view) {
      const resize = (): void => this.resizeCanvas();
      const blur = (): void => this.releaseStream();
      view.addEventListener("resize", resize);
      view.addEventListener("blur", blur);
      this.cleanup.push(() => {
        view.removeEventListener("resize", resize);
        view.removeEventListener("blur", blur);
      });
    }
    this.resizeCanvas();
    this.phase = "tutorial";
  }

  start(): void {
    if (this.phase === "tutorial") this.tutorial?.open();
  }

  pause(): void {
    if (this.phase !== "playing" && this.phase !== "countdown") return;
    this.pausedFrom = this.phase;
    this.phase = "paused";
    this.pauseGate.pause();
    this.releaseStream();
    this.showPausePanel();
  }

  resume(): void {
    if (this.phase !== "paused") return;
    this.phase = this.pausedFrom;
    this.pauseGate.resume();
    this.hidePanel();
    this.root?.focus();
  }

  update(deltaSeconds: number): void {
    const safe = Math.min(0.1, Math.max(0, Number.isFinite(deltaSeconds) ? deltaSeconds : 0));
    const dt = this.pauseGate.filter(safe);
    if (this.phase === "countdown") {
      this.countdown?.update(dt);
      return;
    }
    if (this.phase !== "playing" || !this.round) return;
    this.elapsed += dt;
    this.round.update(dt);
    if (this.streamHeld) {
      this.heldSeconds += dt;
      if (this.heldSeconds >= 1 / 30) {
        const result = this.round.drizzle(this.lastDrizzlePoint, this.nozzle, this.heldSeconds);
        this.afterDrizzle(result.spill, result.flood);
        this.lastDrizzlePoint = { ...this.nozzle };
        this.heldSeconds = 0;
      }
    }
    if (this.round.beeWarning && !this.warningShown) {
      this.warningShown = true;
      this.announce(copy("bee"));
      this.feedback("miss", undefined, "warning");
    } else if (!this.round.beeWarning) {
      this.warningShown = false;
    }
    this.hud?.setTimer(this.elapsed);
    this.draw();
    this.updateStats();
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
    this.tutorial?.dispose();
    this.result?.dispose();
    this.releaseStyles?.();
    this.pauseGate.dispose();
    this.root?.remove();
    this.context = null;
    this.root = null;
    this.canvas = null;
    this.canvasContext = null;
    this.hud = null;
    this.tutorial = null;
    this.result = null;
    this.round = null;
    this.settlement = null;
    this.releaseStyles = null;
  }

  private showReady(message?: string): void {
    this.phase = "ready";
    this.result?.close();
    const panel = this.query("[data-hd='panel']");
    if (!panel) return;
    panel.hidden = false;
    panel.innerHTML = `<div class="ak-card"><span class="ak-kicker">${copy("ready")}</span>
      <div class="ak-card-icon" aria-hidden="true">🍯🍞</div><h2>${this.title}</h2>
      ${message ? `<p>${message}</p>` : ""}
      <button class="ak-button ak-button-primary" data-hd-action="start">${copy("start")}</button>
      <button class="ak-button ak-button-secondary" data-hd-action="tutorial">${copy("replay")}</button></div>`;
    panel.querySelector<HTMLButtonElement>("[data-hd-action='start']")?.focus();
  }

  private beginRound(): void {
    if (!this.context) return;
    this.result?.close();
    this.settlement?.begin();
    this.round = new HoneyDrizzleRound(this.context.rng);
    this.settledPayout = null;
    this.elapsed = 0;
    this.warningShown = false;
    this.nozzle = { x: 0.08, y: 0.5 };
    this.lastDrizzlePoint = { ...this.nozzle };
    this.hidePanel();
    this.pauseGate.resume();
    this.phase = "countdown";
    this.hud?.setScore(0);
    this.hud?.setCombo(0);
    this.draw();
    this.updateStats();
    this.countdown = new ArcadeCountdown({
      seconds: 3,
      feedback: (event) => {
        const badge = this.query("[data-hd='countdown']");
        if (event.kind === "tick") {
          this.feedback("countdown");
          if (badge) {
            badge.hidden = false;
            badge.textContent = String(event.value);
          }
        } else {
          this.feedback("go", undefined, "light");
          if (badge) badge.hidden = true;
          this.phase = "playing";
          this.root?.focus();
        }
      },
    });
    this.countdown.start();
  }

  private serveToast(): void {
    const round = this.round;
    if (!round || this.phase !== "playing") return;
    this.releaseStream();
    const result = round.finishToast();
    if (!result) {
      this.feedback("miss", undefined, "warning");
      this.announce(`${copy("closer")} · ${Math.round(round.coverage * 100)}%`);
      return;
    }
    this.feedback(round.finished ? "score" : "combo", result.score, "success");
    this.announce(`${copy("sweet")} ${Math.round(result.coverage * 100)}%`);
    this.hud?.setScore(round.score);
    this.hud?.setCombo(round.results.length);
    this.nozzle = { x: 0.08, y: 0.5 };
    this.lastDrizzlePoint = { ...this.nozzle };
    this.elapsed = 0;
    this.warningShown = false;
    if (round.finished) this.finishRound();
    else {
      this.draw();
      this.updateStats();
    }
  }

  private finishRound(): void {
    const round = this.round;
    if (!round || this.phase === "result") return;
    const payout = round.payout();
    this.settledPayout = this.settlement?.complete(payout) ?? payout;
    this.best = Math.max(this.best, this.settlement?.receipt?.bestScore ?? payout.score);
    this.phase = "result";
    this.feedback("win", payout.score, "success");
    const coverage = round.results.reduce((sum, result) => sum + result.coverage, 0) / Math.max(1, round.results.length);
    this.result?.show({
      score: payout.score,
      best: this.best,
      newBest: payout.score > 0 && payout.score >= this.best,
      detail: `${round.results.length}/3 ${copy("toast")} · ${copy("coverage")} ${Math.round(coverage * 100)}%`,
    });
  }

  private draw(): void {
    const round = this.round;
    const canvas = this.canvas;
    const context = this.canvasContext;
    if (!round || !canvas || !context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    const marginX = canvas.width * 0.04;
    const marginY = canvas.height * 0.05;
    const toastWidth = canvas.width - marginX * 2;
    const toastHeight = canvas.height - marginY * 2;
    context.fillStyle = "#8e5b31";
    context.beginPath();
    context.roundRect(marginX, marginY, toastWidth, toastHeight, 28);
    context.fill();
    context.fillStyle = "#f2c77e";
    context.beginPath();
    context.roundRect(marginX + 7, marginY + 7, toastWidth - 14, toastHeight - 14, 23);
    context.fill();
    const cellWidth = canvas.width / HONEY_GRID_WIDTH;
    const cellHeight = canvas.height / HONEY_GRID_HEIGHT;
    for (let row = 0; row < HONEY_GRID_HEIGHT; row += 1) {
      for (let column = 0; column < HONEY_GRID_WIDTH; column += 1) {
        const index = row * HONEY_GRID_WIDTH + column;
        const target = (round.corridor[index] ?? 0) > 0;
        const amount = round.deposits[index] ?? 0;
        if (target && amount < 0.34) {
          context.fillStyle = "rgba(255,250,220,.48)";
          context.fillRect(column * cellWidth, row * cellHeight, cellWidth + 0.5, cellHeight + 0.5);
        }
        if (amount > 0) {
          context.fillStyle = amount > 1
            ? "rgba(177,105,13,.92)"
            : `rgba(238,173,32,${Math.min(0.9, 0.35 + amount * 0.45)})`;
          context.fillRect(column * cellWidth, row * cellHeight, cellWidth + 1, cellHeight + 1);
        }
      }
    }
    const gap = round.gap;
    context.save();
    context.setLineDash([5, 4]);
    context.lineWidth = 3;
    context.strokeStyle = round.beeWarning ? "#8c3f32" : "#6e582a";
    context.beginPath();
    context.arc(gap.x * canvas.width, gap.y * canvas.height, HONEY_GAP_RADIUS * canvas.width, 0, Math.PI * 2);
    context.stroke();
    context.restore();
    context.font = `${Math.max(22, canvas.width * 0.075)}px sans-serif`;
    context.fillText("🐝", gap.x * canvas.width - 13, gap.y * canvas.height + 9);
    context.fillStyle = "#8a5b1e";
    context.beginPath();
    context.arc(this.nozzle.x * canvas.width, this.nozzle.y * canvas.height, this.streamHeld ? 7 : 4, 0, Math.PI * 2);
    context.fill();
  }

  private updateStats(): void {
    const round = this.round;
    if (!round) return;
    const coverage = Math.round(round.coverage * 100);
    const spill = Math.round(round.spillRatio * 100);
    const flood = Math.round(round.floodRatio * 100);
    const coverageElement = this.query("[data-hd='coverage']");
    const spillElement = this.query("[data-hd='spill']");
    const floodElement = this.query("[data-hd='flood']");
    const toast = this.query("[data-hd='toast-label']");
    const bee = this.query("[data-hd='bee']");
    if (coverageElement) coverageElement.textContent = `${coverage}% / ${Math.round(HONEY_REQUIRED_COVERAGE * 100)}%`;
    if (spillElement) spillElement.textContent = `${spill}%`;
    if (floodElement) floodElement.textContent = `${flood}%`;
    if (toast) toast.textContent = `${Math.min(3, round.toastIndex + 1)} / 3`;
    if (bee) bee.dataset.warning = round.beeWarning ? "true" : "false";
  }

  private afterDrizzle(spill: number, flood: number): void {
    if (spill > 0.1 || flood > 0.1) this.feedback("miss", spill + flood, "warning");
    else this.feedback("hit", undefined, "light");
    this.draw();
    this.updateStats();
  }

  private onClick(event: MouseEvent): void {
    const action = event.target instanceof Element
      ? event.target.closest<HTMLElement>("[data-hd-action]")?.dataset.hdAction
      : undefined;
    if (!action) return;
    if (action === "start" || action === "restart") this.beginRound();
    else if (action === "tutorial") {
      this.hidePanel();
      this.phase = "tutorial";
      this.tutorial?.open();
    } else if (action === "resume") this.resume();
    else if (action === "quit") {
      this.settlement?.exitUnpaid();
      this.round = null;
      this.showReady(copy("leftUnpaid"));
    } else if (action === "finish") this.serveToast();
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (event.key === "Escape" || event.key.toLowerCase() === "p") {
      event.preventDefault();
      if (this.phase === "paused") this.resume();
      else this.pause();
      return;
    }
    if (this.phase !== "playing") return;
    if (event.key === " ") {
      event.preventDefault();
      if (!this.streamHeld) {
        this.streamHeld = true;
        this.lastDrizzlePoint = { ...this.nozzle };
      }
      return;
    }
    const nudge = 0.025;
    let next: HoneyPoint;
    if (event.key === "ArrowLeft") next = { x: this.nozzle.x - nudge, y: this.nozzle.y };
    else if (event.key === "ArrowRight") next = { x: this.nozzle.x + nudge, y: this.nozzle.y };
    else if (event.key === "ArrowUp") next = { x: this.nozzle.x, y: this.nozzle.y - nudge };
    else if (event.key === "ArrowDown") next = { x: this.nozzle.x, y: this.nozzle.y + nudge };
    else if (event.key === "Enter") {
      event.preventDefault();
      this.serveToast();
      return;
    } else return;
    event.preventDefault();
    this.nozzle = { x: Math.max(0, Math.min(1, next.x)), y: Math.max(0, Math.min(1, next.y)) };
    this.draw();
  }

  private onKeyUp(event: KeyboardEvent): void {
    if (event.key === " ") this.releaseStream();
  }

  private onPointerDown(event: PointerEvent): void {
    if (this.phase !== "playing" || this.activePointer !== null) return;
    event.preventDefault();
    this.activePointer = event.pointerId;
    this.nozzle = this.canvasPoint(event);
    this.lastDrizzlePoint = { ...this.nozzle };
    this.streamHeld = true;
    this.heldSeconds = 0;
    try {
      this.canvas?.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic pointers may not implement capture.
    }
  }

  private onPointerMove(event: PointerEvent): void {
    if (this.activePointer !== event.pointerId) return;
    const next = this.canvasPoint(event);
    const duration = Math.max(1 / 60, this.heldSeconds);
    const result = this.round?.drizzle(this.lastDrizzlePoint, next, duration);
    this.nozzle = next;
    this.lastDrizzlePoint = { ...next };
    this.heldSeconds = 0;
    if (result) this.afterDrizzle(result.spill, result.flood);
  }

  private onPointerEnd(event: PointerEvent): void {
    if (this.activePointer !== event.pointerId) return;
    this.releaseStream();
  }

  private releaseStream(): void {
    this.activePointer = null;
    this.streamHeld = false;
    this.heldSeconds = 0;
  }

  private canvasPoint(event: PointerEvent): HoneyPoint {
    const rect = this.canvas?.getBoundingClientRect();
    if (!rect) return { x: 0.5, y: 0.5 };
    return {
      x: Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width))),
      y: Math.max(0, Math.min(1, (event.clientY - rect.top) / Math.max(1, rect.height))),
    };
  }

  private resizeCanvas(): void {
    const canvas = this.canvas;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(240, Math.floor(rect.width) || 340);
    canvas.height = Math.max(230, Math.floor(rect.height) || 350);
    this.draw();
  }

  private showPausePanel(): void {
    const panel = this.query("[data-hd='panel']");
    if (!panel) return;
    const strings = activeCatalog().strings.minigameCommon;
    panel.hidden = false;
    panel.innerHTML = `<div class="ak-card"><span class="ak-kicker">${copy("paused")}</span>
      <div class="ak-card-icon" aria-hidden="true">🍯</div>
      <button class="ak-button ak-button-primary" data-hd-action="resume">${strings.resume}</button>
      <button class="ak-button ak-button-secondary" data-hd-action="restart">${strings.restart}</button>
      <button class="ak-button ak-button-quiet" data-hd-action="quit">${strings.quitNoReward}</button></div>`;
  }

  private hidePanel(): void {
    const panel = this.query("[data-hd='panel']");
    if (!panel) return;
    panel.hidden = true;
    panel.replaceChildren();
  }

  private feedback(cue: MinigameAudioCue, value?: number, haptic?: HapticPattern): void {
    this.context?.audio?.emit(cue, value);
    if (haptic) this.context?.haptics?.impact(haptic);
  }

  private announce(text: string): void {
    const status = this.query("[data-hd='status']");
    if (status) status.textContent = text;
  }

  private query<T extends HTMLElement = HTMLElement>(selector: string): T | null {
    return this.root?.querySelector<T>(selector) ?? null;
  }

  private listen<K extends keyof HTMLElementEventMap>(
    target: HTMLElement,
    type: K,
    listener: (event: HTMLElementEventMap[K]) => void,
  ): void {
    const wrapped: EventListener = (event) => listener(event as HTMLElementEventMap[K]);
    target.addEventListener(type, wrapped);
    this.cleanup.push(() => target.removeEventListener(type, wrapped));
  }
}

export const createMinigame = (): MinigameModule => new HoneyDrizzleGame();

const HONEY_CSS = `
.honey-drizzle{position:absolute;inset:0;overflow:hidden;border-radius:18px;background:linear-gradient(#fff1c8,#f4cf7e);color:#5b3b20;font-family:inherit;touch-action:none;user-select:none;-webkit-user-select:none}
.honey-drizzle *{box-sizing:border-box}.honey-drizzle button{font:inherit}.honey-drizzle:focus-visible{outline:3px solid #5b3b20;outline-offset:-3px}
.hd-scene{position:absolute;inset:0;display:flex;flex-direction:column;gap:6px;padding:calc(61px + env(safe-area-inset-top)) 10px calc(10px + env(safe-area-inset-bottom))}
.honey-drizzle .ak-hud{right:max(92px,calc(8px + env(safe-area-inset-right)))}
.hd-order{display:flex;align-items:center;justify-content:center;gap:12px;height:31px;font-size:20px}.hd-order b{font-size:12px;padding:4px 11px;border-radius:99px;background:#fff9e5}.hd-order [data-warning='true']{filter:drop-shadow(0 0 5px #d34a35);transform:scale(1.16)}
.hd-hint{margin:0;text-align:center;font-size:12px;font-weight:900}.hd-stage{position:relative;flex:1;min-height:280px;overflow:hidden;border-radius:24px;background:#d99b45;box-shadow:inset 0 0 0 4px #8d5b31}
.hd-canvas{display:block;width:100%;height:100%;cursor:crosshair;touch-action:none}.hd-countdown{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:72px;font-weight:900;text-shadow:0 4px #fff;pointer-events:none}.hd-jar{position:absolute;right:8px;top:8px;font-size:34px;filter:drop-shadow(0 3px #fff)}
.hd-stats{display:grid;grid-template-columns:1.5fr 1fr 1fr;gap:5px}.hd-stats span{display:flex;flex-direction:column;padding:5px;border-radius:10px;background:#fff5d7;text-align:center}.hd-stats b{font-size:9px;text-transform:uppercase}.hd-stats i{font-style:normal;font-size:11px;font-weight:900}
.hd-finish{min-height:46px;border:0;border-radius:13px;background:#d98f25;color:#3f2918;font-size:14px;font-weight:900}.hd-finish:focus-visible{outline:3px solid #5b3b20;outline-offset:2px}.hd-status{min-height:18px;text-align:center;font-size:12px;font-weight:900}.hd-panel .ak-card h2{margin:0}
[data-ak-reduced='true'] *{animation:none!important;transition:none!important}
@media(max-height:700px){.hd-scene{padding-top:calc(55px + env(safe-area-inset-top))}.hd-stage{min-height:210px}.hd-order{height:22px}}
`;
