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
  TOPIARY_RASTER_SIZE,
  TOPIARY_REQUIRED_IOU,
  TopiaryRound,
  type RasterPoint,
  type TopiaryShape,
} from "./logic";
import { createTopiarySettlement, type TopiarySettlement } from "./settlement";

export const manifest: MinigameManifest = validateMinigameManifest({
  id: "topiary-trim",
  title: localizedText((catalog) => catalog.minigames["topiary-trim"].title),
  instructions: localizedText((catalog) => catalog.minigames["topiary-trim"].instructions),
  icon: EN_CATALOG.minigames["topiary-trim"].icon,
  category: "skill",
  stage3d: false,
  unlockLevel: 1,
  audioCues: ["countdown", "go", "hit", "miss", "combo", "score", "win"],
  tutorial: [
    {
      icon: "✂",
      title: { en: "Swipe the shears", de: "Wische mit der Schere" },
      body: {
        en: "Hold and swipe around the bush to trim away leaves. Every swipe cuts the real raster silhouette.",
        de: "Halte gedrückt und wische um den Busch, um Blätter zu schneiden. Jeder Wisch schneidet die echte Raster-Silhouette.",
      },
    },
    {
      icon: "▣",
      title: { en: "Match the clipping card", de: "Triff die Schnittvorlage" },
      body: {
        en: "Shape three original garden figures. The hidden overlap score compares your bush with the card, pixel by pixel.",
        de: "Forme drei eigene Gartenfiguren. Die verborgene Überlappung vergleicht Busch und Vorlage Pixel für Pixel.",
      },
    },
    {
      icon: "🍃",
      title: { en: "Use two gentle previews", de: "Nutze zwei sanfte Vorschauen" },
      body: {
        en: "The leaf blower reveals the target edge for a moment. Only two previews are available for the whole round.",
        de: "Der Laubbläser zeigt kurz die Zielkante. Für die ganze Runde gibt es nur zwei Vorschauen.",
      },
    },
    {
      icon: "♡",
      title: { en: "Preserve the leafy heart", de: "Bewahre das grüne Herz" },
      body: {
        en: "Trim the overgrowth, not the figure. A clear match with little inner damage earns the coziest score.",
        de: "Schneide den Wildwuchs, nicht die Figur. Eine klare Form mit wenig Innenschaden bringt die gemütlichste Wertung.",
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
const SHAPE_COPY: Readonly<Record<TopiaryShape, { readonly en: string; readonly de: string }>> = {
  "moon-bunny": { en: "Moon Bunny", de: "Mondhase" },
  "garden-snail": { en: "Garden Snail", de: "Gartenschnecke" },
  "tea-bird": { en: "Tea Bird", de: "Teegarten-Vogel" },
};
const COPY = {
  ready: { en: "Garden shift", de: "Gartenschicht" },
  start: { en: "Start trimming", de: "Schnitt beginnen" },
  replay: { en: "How to play", de: "So wird gespielt" },
  hint: { en: "Hold and swipe the shears around the silhouette", de: "Halte und wische mit der Schere um die Silhouette" },
  finish: { en: "Inspect this bush", de: "Busch prüfen" },
  blower: { en: "Leaf-blower preview", de: "Laubbläser-Vorschau" },
  previews: { en: "previews left", de: "Vorschauen übrig" },
  closer: { en: "A little closer — trim the fuzzy outer leaves", de: "Fast – schneide noch die flauschigen Außenblätter" },
  accepted: { en: "Lovely silhouette!", de: "Wunderschöne Silhouette!" },
  paused: { en: "Shears resting", de: "Schere ruht" },
  leftUnpaid: { en: "Garden left without rewards", de: "Garten ohne Belohnung verlassen" },
  bushes: { en: "bushes shaped", de: "Büsche geformt" },
} as const;

function copy(key: keyof typeof COPY): string {
  return pickLocalized(COPY[key]);
}

export class TopiaryTrimGame implements MinigameModule {
  readonly id = manifest.id;

  private context: SharedContext | null = null;
  private root: HTMLElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private canvasContext: CanvasRenderingContext2D | null = null;
  private rasterCanvas: HTMLCanvasElement | null = null;
  private rasterContext: CanvasRenderingContext2D | null = null;
  private hud: ArcadeHud | null = null;
  private tutorial: TutorialOverlay | null = null;
  private result: ResultScreen | null = null;
  private settlement: TopiarySettlement | null = null;
  private round: TopiaryRound | null = null;
  private countdown: ArcadeCountdown | null = null;
  private releaseStyles: (() => void) | null = null;
  private readonly pauseGate = new PauseGate();
  private readonly cleanup: Array<() => void> = [];
  private phase: Phase = "boot";
  private pausedFrom: "playing" | "countdown" = "playing";
  private settledPayout: MinigamePayout | null = null;
  private best = 0;
  private activePointer: number | null = null;
  private lastPoint: RasterPoint | null = null;
  private elapsed = 0;

  get title(): string {
    return pickLocalized(manifest.title);
  }

  get instructions(): string {
    return pickLocalized(manifest.instructions);
  }

  mount(context: MinigameContext): void {
    if (this.phase !== "boot" && this.phase !== "disposed") this.dispose();
    this.context = context;
    this.settlement = createTopiarySettlement(context);
    this.best = this.settlement.persistedBest;
    const document = context.mount.ownerDocument;
    this.releaseStyles = acquireArcadeKitStyles(document);
    const root = document.createElement("section");
    root.className = "topiary-trim";
    root.dataset.minigame = this.id;
    root.tabIndex = 0;
    root.setAttribute("aria-label", this.title);
    if (this.context.reducedMotion === true) root.dataset.akReduced = "true";
    root.innerHTML = `
      <style>${TOPIARY_CSS}</style>
      <div class="tt-scene">
        <div class="tt-card"><small>CLIPPING CARD · 1 / 3</small><canvas data-tt="card" width="64" height="64"></canvas><b data-tt="shape"></b></div>
        <p class="tt-hint">${copy("hint")}</p>
        <div class="tt-stage">
          <canvas class="tt-canvas" data-tt="canvas" aria-label="${copy("hint")}"></canvas>
          <div class="tt-countdown" data-tt="countdown" hidden aria-hidden="true"></div>
        </div>
        <div class="tt-meter" aria-label="silhouette match"><i data-tt="meter"></i><span data-tt="percent">0%</span></div>
        <div class="tt-controls">
          <button data-tt-action="blower" class="tt-secondary">🍃 ${copy("blower")} · <span data-tt="previews">2</span></button>
          <button data-tt-action="finish" class="tt-primary">✂ ${copy("finish")}</button>
        </div>
        <div class="tt-status" data-tt="status" role="status" aria-live="polite"></div>
      </div>
      <div class="ak-overlay tt-panel" data-tt="panel" role="dialog" aria-modal="true" hidden></div>
    `;
    context.mount.replaceChildren(root);
    this.root = root;
    this.canvas = root.querySelector<HTMLCanvasElement>("[data-tt='canvas']");
    this.canvasContext = this.canvas?.getContext("2d") ?? null;
    this.rasterCanvas = document.createElement("canvas");
    this.rasterCanvas.width = TOPIARY_RASTER_SIZE;
    this.rasterCanvas.height = TOPIARY_RASTER_SIZE;
    this.rasterContext = this.rasterCanvas.getContext("2d");
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
    if (this.canvas) {
      this.listen(this.canvas, "pointerdown", (event) => this.onPointerDown(event));
      this.listen(this.canvas, "pointermove", (event) => this.onPointerMove(event));
      this.listen(this.canvas, "pointerup", (event) => this.onPointerEnd(event));
      this.listen(this.canvas, "pointercancel", (event) => this.onPointerEnd(event));
    }
    const view = document.defaultView;
    if (view) {
      const resize = (): void => this.resizeCanvas();
      view.addEventListener("resize", resize);
      this.cleanup.push(() => view.removeEventListener("resize", resize));
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
    this.clearPointer();
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
    this.hud?.setTimer(this.elapsed);
    this.draw();
    this.updateControls();
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
    this.rasterCanvas = null;
    this.rasterContext = null;
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
    const panel = this.query("[data-tt='panel']");
    if (!panel) return;
    panel.hidden = false;
    panel.innerHTML = `
      <div class="ak-card"><span class="ak-kicker">${copy("ready")}</span>
        <div class="ak-card-icon" aria-hidden="true">✂🌿</div><h2>${this.title}</h2>
        ${message ? `<p>${message}</p>` : ""}
        <button class="ak-button ak-button-primary" data-tt-action="start">${copy("start")}</button>
        <button class="ak-button ak-button-secondary" data-tt-action="tutorial">${copy("replay")}</button>
      </div>`;
    panel.querySelector<HTMLButtonElement>("[data-tt-action='start']")?.focus();
  }

  private beginRound(): void {
    if (!this.context) return;
    this.result?.close();
    this.settlement?.begin();
    this.round = new TopiaryRound(this.context.rng);
    this.settledPayout = null;
    this.elapsed = 0;
    this.hidePanel();
    this.pauseGate.resume();
    this.phase = "countdown";
    this.hud?.setScore(0);
    this.hud?.setCombo(0);
    this.draw();
    this.updateControls();
    this.countdown = new ArcadeCountdown({
      seconds: 3,
      feedback: (event) => {
        const badge = this.query("[data-tt='countdown']");
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

  private inspectBush(): void {
    const round = this.round;
    if (!round || this.phase !== "playing") return;
    const result = round.finishBush();
    if (!result) {
      this.feedback("miss", undefined, "warning");
      this.announce(`${copy("closer")} · ${Math.round(round.iou * 100)}%`);
      return;
    }
    this.feedback(round.finished ? "score" : "combo", result.score, "success");
    this.announce(`${copy("accepted")} ${Math.round(result.iou * 100)}%`);
    this.hud?.setScore(round.score);
    this.hud?.setCombo(round.results.length);
    if (round.finished) {
      this.finishRound();
    } else {
      this.draw();
      this.updateControls();
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
    const average = round.results.reduce((sum, result) => sum + result.iou, 0) / Math.max(1, round.results.length);
    this.result?.show({
      score: payout.score,
      best: this.best,
      newBest: payout.score > 0 && payout.score >= this.best,
      detail: `${round.results.length}/3 ${copy("bushes")} · IoU ${Math.round(average * 100)}%`,
    });
  }

  private useBlower(): void {
    if (this.phase !== "playing" || !this.round?.useLeafBlower()) return;
    this.feedback("hit", this.round.previewsLeft, "light");
    this.updateControls();
    this.draw();
  }

  private draw(): void {
    const round = this.round;
    const canvas = this.canvas;
    const context = this.canvasContext;
    const raster = this.rasterContext;
    const rasterCanvas = this.rasterCanvas;
    if (!round || !canvas || !context || !raster || !rasterCanvas) return;
    const image = raster.createImageData(TOPIARY_RASTER_SIZE, TOPIARY_RASTER_SIZE);
    for (let index = 0; index < round.current.length; index += 1) {
      if ((round.current[index] ?? 0) === 0) continue;
      const offset = index * 4;
      image.data[offset] = 65;
      image.data[offset + 1] = 132;
      image.data[offset + 2] = 72;
      image.data[offset + 3] = 255;
    }
    raster.clearRect(0, 0, TOPIARY_RASTER_SIZE, TOPIARY_RASTER_SIZE);
    raster.putImageData(image, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
    const gradient = context.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, "#dff0cf");
    gradient.addColorStop(1, "#a8cf8a");
    context.fillStyle = gradient;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.imageSmoothingEnabled = true;
    context.drawImage(rasterCanvas, 0, 0, canvas.width, canvas.height);
    if (round.previewRemaining > 0) {
      context.save();
      context.globalAlpha = this.context?.reducedMotion === true ? 0.8 : 0.5 + Math.sin(this.elapsed * 8) * 0.2;
      context.strokeStyle = "#fff3a6";
      context.lineWidth = 4;
      this.traceTarget(context, round.target, canvas.width, canvas.height);
      context.stroke();
      context.restore();
    }
    context.font = `${Math.max(22, canvas.width * 0.08)}px sans-serif`;
    context.fillText("✂", canvas.width * 0.05, canvas.height * 0.12);
    this.drawCard(round.target);
  }

  private traceTarget(
    context: CanvasRenderingContext2D,
    target: Uint8Array,
    width: number,
    height: number,
  ): void {
    context.beginPath();
    const size = TOPIARY_RASTER_SIZE;
    for (let row = 1; row < size - 1; row += 1) {
      for (let column = 1; column < size - 1; column += 1) {
        const index = row * size + column;
        if ((target[index] ?? 0) === 0) continue;
        if (
          (target[index - 1] ?? 0) === 0
          || (target[index + 1] ?? 0) === 0
          || (target[index - size] ?? 0) === 0
          || (target[index + size] ?? 0) === 0
        ) {
          context.rect(column / size * width, row / size * height, Math.max(1, width / size), Math.max(1, height / size));
        }
      }
    }
  }

  private drawCard(target: Uint8Array): void {
    const card = this.query<HTMLCanvasElement>("[data-tt='card']");
    const context = card?.getContext("2d");
    const round = this.round;
    if (!card || !context || !round) return;
    const image = context.createImageData(TOPIARY_RASTER_SIZE, TOPIARY_RASTER_SIZE);
    for (let index = 0; index < target.length; index += 1) {
      if ((target[index] ?? 0) === 0) continue;
      const offset = index * 4;
      image.data[offset] = 48;
      image.data[offset + 1] = 91;
      image.data[offset + 2] = 52;
      image.data[offset + 3] = 255;
    }
    context.clearRect(0, 0, card.width, card.height);
    context.putImageData(image, 0, 0);
    const label = this.query("[data-tt='shape']");
    if (label) label.textContent = pickLocalized(SHAPE_COPY[round.shape]);
    const small = card.previousElementSibling;
    if (small) small.textContent = `CLIPPING CARD · ${Math.min(3, round.bushIndex + 1)} / 3`;
  }

  private updateControls(): void {
    const round = this.round;
    if (!round) return;
    const percent = Math.round(round.iou * 100);
    const meter = this.query("[data-tt='meter']");
    const label = this.query("[data-tt='percent']");
    const previews = this.query("[data-tt='previews']");
    const blower = this.query<HTMLButtonElement>("[data-tt-action='blower']");
    if (meter) meter.style.width = `${percent}%`;
    if (label) label.textContent = `${percent}% / ${Math.round(TOPIARY_REQUIRED_IOU * 100)}%`;
    if (previews) previews.textContent = `${round.previewsLeft} ${copy("previews")}`;
    if (blower) blower.disabled = round.previewsLeft <= 0 || round.previewRemaining > 0;
  }

  private onClick(event: MouseEvent): void {
    const action = event.target instanceof Element
      ? event.target.closest<HTMLElement>("[data-tt-action]")?.dataset.ttAction
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
    } else if (action === "blower") this.useBlower();
    else if (action === "finish") this.inspectBush();
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (event.key === "Escape" || event.key.toLowerCase() === "p") {
      event.preventDefault();
      if (this.phase === "paused") this.resume();
      else this.pause();
    } else if (this.phase === "playing" && event.key.toLowerCase() === "b") {
      event.preventDefault();
      this.useBlower();
    } else if (this.phase === "playing" && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      this.inspectBush();
    }
  }

  private onPointerDown(event: PointerEvent): void {
    if (this.phase !== "playing" || this.activePointer !== null) return;
    event.preventDefault();
    this.activePointer = event.pointerId;
    this.lastPoint = this.canvasPoint(event);
    try {
      this.canvas?.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic pointers may not implement capture.
    }
    if (this.lastPoint) this.applyTrim(this.lastPoint, this.lastPoint);
  }

  private onPointerMove(event: PointerEvent): void {
    if (this.activePointer !== event.pointerId || !this.lastPoint) return;
    const next = this.canvasPoint(event);
    this.applyTrim(this.lastPoint, next);
    this.lastPoint = next;
  }

  private onPointerEnd(event: PointerEvent): void {
    if (this.activePointer !== event.pointerId) return;
    this.clearPointer();
  }

  private applyTrim(from: RasterPoint, to: RasterPoint): void {
    const result = this.round?.trim(from, to, 0.032);
    if (!result || result.removed === 0) return;
    this.feedback(result.targetDamage > 0 ? "miss" : "hit", result.removed, result.targetDamage > 0 ? "warning" : "light");
    this.draw();
    this.updateControls();
  }

  private canvasPoint(event: PointerEvent): RasterPoint {
    const rect = this.canvas?.getBoundingClientRect();
    if (!rect) return { x: 0.5, y: 0.5 };
    return {
      x: Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width))),
      y: Math.max(0, Math.min(1, (event.clientY - rect.top) / Math.max(1, rect.height))),
    };
  }

  private clearPointer(): void {
    this.activePointer = null;
    this.lastPoint = null;
  }

  private resizeCanvas(): void {
    const canvas = this.canvas;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(240, Math.floor(rect.width) || 340);
    canvas.height = Math.max(240, Math.floor(rect.height) || 360);
    this.draw();
  }

  private showPausePanel(): void {
    const panel = this.query("[data-tt='panel']");
    if (!panel) return;
    const strings = activeCatalog().strings.minigameCommon;
    panel.hidden = false;
    panel.innerHTML = `<div class="ak-card"><span class="ak-kicker">${copy("paused")}</span>
      <div class="ak-card-icon" aria-hidden="true">✂</div>
      <button class="ak-button ak-button-primary" data-tt-action="resume">${strings.resume}</button>
      <button class="ak-button ak-button-secondary" data-tt-action="restart">${strings.restart}</button>
      <button class="ak-button ak-button-quiet" data-tt-action="quit">${strings.quitNoReward}</button></div>`;
  }

  private hidePanel(): void {
    const panel = this.query("[data-tt='panel']");
    if (!panel) return;
    panel.hidden = true;
    panel.replaceChildren();
  }

  private feedback(cue: MinigameAudioCue, value?: number, haptic?: HapticPattern): void {
    this.context?.audio?.emit(cue, value);
    if (haptic) this.context?.haptics?.impact(haptic);
  }

  private announce(text: string): void {
    const status = this.query("[data-tt='status']");
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

export const createMinigame = (): MinigameModule => new TopiaryTrimGame();

const TOPIARY_CSS = `
.topiary-trim{position:absolute;inset:0;overflow:hidden;border-radius:18px;background:linear-gradient(#e8f4dc,#bddb9d);color:#304b2e;font-family:inherit;touch-action:none;user-select:none;-webkit-user-select:none}
.topiary-trim *{box-sizing:border-box}.topiary-trim button{font:inherit}.topiary-trim:focus-visible{outline:3px solid #263e25;outline-offset:-3px}
.tt-scene{position:absolute;inset:0;display:flex;flex-direction:column;gap:6px;padding:calc(61px + env(safe-area-inset-top)) 10px calc(10px + env(safe-area-inset-bottom))}
.topiary-trim .ak-hud{right:max(92px,calc(8px + env(safe-area-inset-right)))}
.tt-card{position:absolute;z-index:3;top:calc(66px + env(safe-area-inset-top));left:14px;width:91px;padding:5px;border:2px solid #54754b;border-radius:11px;background:#fffbe9;box-shadow:0 3px 8px #49633b55;text-align:center;pointer-events:none}
.tt-card small{display:block;font-size:7px;font-weight:900;letter-spacing:.06em}.tt-card canvas{display:block;width:58px;height:58px;margin:auto}.tt-card b{display:block;font-size:9px}
.tt-hint{margin:0 0 0 100px;min-height:35px;text-align:center;font-size:11px;font-weight:800}
.tt-stage{position:relative;flex:1;min-height:260px;overflow:hidden;border:4px solid #6d875a;border-radius:50% 50% 18% 18%;background:#b8d89d;box-shadow:inset 0 -16px #89aa70}
.tt-canvas{display:block;width:100%;height:100%;cursor:crosshair;touch-action:none}
.tt-countdown{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:72px;font-weight:900;color:#304b2e;text-shadow:0 4px #fff;pointer-events:none}
.tt-meter{position:relative;height:20px;border:2px solid #54754b;border-radius:99px;background:#eaf1df;overflow:hidden}.tt-meter i{position:absolute;inset:0 auto 0 0;width:0;background:#7fb66e}.tt-meter span{position:absolute;inset:0;text-align:center;font-size:11px;line-height:16px;font-weight:900}
.tt-controls{display:flex;gap:7px}.tt-controls button{min-height:46px;border:0;border-radius:13px;padding:7px;font-size:12px;font-weight:900}.tt-controls button:focus-visible{outline:3px solid #263e25;outline-offset:2px}.tt-controls button:disabled{opacity:.45}.tt-secondary{flex:1;background:#eaf5df;color:#304b2e}.tt-primary{flex:1;background:#efcc67;color:#3d341d}
.tt-status{min-height:18px;text-align:center;font-size:12px;font-weight:900}.tt-panel .ak-card h2{margin:0}
[data-ak-reduced='true'] *{animation:none!important;transition:none!important}
@media(max-height:700px){.tt-scene{padding-top:calc(55px + env(safe-area-inset-top))}.tt-card{top:calc(58px + env(safe-area-inset-top));width:78px}.tt-card canvas{width:48px;height:48px}.tt-hint{margin-left:82px}.tt-stage{min-height:200px}}
`;
