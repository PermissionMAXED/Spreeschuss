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
  createPackingSession,
  packingEfficiency,
  packingPayout,
  removePicnicPiece,
  rotateCells,
  stepPackingSession,
  trySessionPlacement,
  type PackingSession,
  type PicnicPiece,
} from "./logic";
import { createPicnicSettlement, type PicnicSettlement } from "./settlement";

export const manifest: MinigameManifest = validateMinigameManifest({
  id: "picnic-packer",
  title: localizedText((catalog) => catalog.minigames["picnic-packer"].title),
  instructions: localizedText((catalog) => catalog.minigames["picnic-packer"].instructions),
  icon: EN_CATALOG.minigames["picnic-packer"].icon,
  category: "puzzle",
  stage3d: false,
  unlockLevel: 1,
  audioCues: ["countdown", "go", "hit", "miss", "combo", "score", "win", "lose"],
  tutorial: [
    {
      icon: "🧺",
      title: { en: "Fill every square", de: "Fülle jedes Feld" },
      body: {
        en: "Drag each picnic item onto the blanket. The baskets grow from 5×5 to 7×7.",
        de: "Ziehe jedes Picknickteil auf die Decke. Die Körbe wachsen von 5×5 auf 7×7.",
      },
    },
    {
      icon: "↻",
      title: { en: "Rotate to fit", de: "Drehen und einpassen" },
      body: {
        en: "Use the rotate button or R. Arrow keys move the anchor and Space places the selected item.",
        de: "Nutze den Drehknopf oder R. Pfeiltasten bewegen den Anker, Leertaste legt das gewählte Teil ab.",
      },
    },
    {
      icon: "♥♥♥",
      title: { en: "Pack carefully", de: "Packe vorsichtig" },
      body: {
        en: "Overlaps and spills cost one of three lives. Efficient, speedy baskets score highest.",
        de: "Überlappungen und Überstand kosten eines von drei Leben. Effiziente, schnelle Körbe punkten am besten.",
      },
    },
  ],
});

export const definition: MinigameStubDefinition = {
  id: manifest.id,
  title: manifest.title.en,
  instructions: manifest.instructions.en,
};

type SoundAction = "hit" | "miss" | "combo" | "countdown" | "go" | "win" | "lose" | "score";
type PicnicContext = MinigameContext & {
  readonly audio?: { emit(action: SoundAction, value?: number): void };
  readonly haptics?: { impact(pattern: HapticPattern): void };
  readonly bestScore?: number;
  readonly reducedMotion?: boolean;
};
type Phase = "boot" | "tutorial" | "ready" | "countdown" | "playing" | "paused" | "result" | "disposed";
type Copy = { readonly en: string; readonly de: string };

const COPY = {
  start: { en: "Pack the picnic", de: "Picknick packen" },
  ready: { en: "Basket ready", de: "Korb bereit" },
  board: { en: "Basket", de: "Korb" },
  efficiency: { en: "Efficiency", de: "Effizienz" },
  lives: { en: "Care", de: "Sorgfalt" },
  rotate: { en: "Rotate item", de: "Teil drehen" },
  selected: { en: "Selected", de: "Ausgewählt" },
  packed: { en: "Packed — select to move", de: "Gepackt — zum Verschieben wählen" },
  empty: { en: "Drag here or use arrows + Space", de: "Hierher ziehen oder Pfeile + Leertaste" },
  invalid: { en: "That spills or overlaps — one life lost!", de: "Das ragt über oder überlappt — ein Leben verloren!" },
  placed: { en: "Snug fit!", de: "Passt genau!" },
  next: { en: "Basket complete — next size!", de: "Korb fertig — nächste Größe!" },
  completed: { en: "All three baskets packed!", de: "Alle drei Körbe sind gepackt!" },
  out: { en: "The basket needs a rest.", de: "Der Korb braucht eine Pause." },
  detail: { en: "baskets · efficiency", de: "Körbe · Effizienz" },
  keys: { en: "1–9 select · arrows move · R rotate · Space place · P pause", de: "1–9 wählen · Pfeile bewegen · R drehen · Leertaste legen · P Pause" },
  unpaid: { en: "Picnic left unpacked — no rewards.", de: "Picknick ungepackt verlassen — keine Belohnung." },
} as const satisfies Readonly<Record<string, Copy>>;

type CopyKey = keyof typeof COPY;
const text = (key: CopyKey): string => pickLocalized(COPY[key]);

const ITEM_CUES = [
  { glyph: "🥪", name: { en: "Sandwich", de: "Sandwich" }, color: "#f3bd6c" },
  { glyph: "🍓", name: { en: "Berries", de: "Beeren" }, color: "#ed7182" },
  { glyph: "🧀", name: { en: "Cheese", de: "Käse" }, color: "#f4d45d" },
  { glyph: "🍇", name: { en: "Grapes", de: "Trauben" }, color: "#9d75d8" },
  { glyph: "🥕", name: { en: "Carrots", de: "Karotten" }, color: "#e99353" },
  { glyph: "🥨", name: { en: "Pretzel", de: "Brezel" }, color: "#c98b57" },
  { glyph: "🧃", name: { en: "Juice", de: "Saft" }, color: "#66b7ad" },
  { glyph: "🍎", name: { en: "Apples", de: "Äpfel" }, color: "#db6470" },
] as const;

const EMPTY_PAYOUT: MinigamePayout = { score: 0, coins: 0, xp: 0 };

export class PicnicPackerGame implements MinigameModule {
  readonly id = manifest.id;
  private context: PicnicContext | null = null;
  private root: HTMLElement | null = null;
  private hud: ArcadeHud | null = null;
  private tutorial: TutorialOverlay | null = null;
  private results: ResultScreen | null = null;
  private settlement: PicnicSettlement | null = null;
  private session: PackingSession | null = null;
  private countdown: ArcadeCountdown | null = null;
  private readonly pauseGate = new PauseGate();
  private readonly cleanup: Array<() => void> = [];
  private phase: Phase = "boot";
  private pausedFrom: "countdown" | "playing" | null = null;
  private best = 0;
  private settledPayout: MinigamePayout | null = null;
  private selectedPieceId: string | null = null;
  private cursorX = 0;
  private cursorY = 0;
  private renderedBoardSize = 0;
  private readonly rotations = new Map<string, number>();
  private dragPieceId: string | null = null;
  private dragPointerId: number | null = null;
  private dragMoved = false;
  private suppressClick = false;

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
    this.context = context;
    this.settlement = createPicnicSettlement(context);
    this.best = this.settlement.persistedBest;
    const root = context.mount.ownerDocument.createElement("section");
    root.className = "picnic-packer";
    root.dataset.minigame = this.id;
    root.tabIndex = 0;
    root.setAttribute("aria-label", this.title);
    if (this.reducedMotion) root.dataset.akReduced = "true";
    root.innerHTML = `
      <style>${PICNIC_CSS}</style>
      <div class="pp-bg" aria-hidden="true"></div>
      <main class="pp-stage">
        <div class="pp-meta">
          <strong data-pp="board-label">${text("board")} 1 · 5×5</strong>
          <span data-pp="efficiency">${text("efficiency")} 0%</span>
          <span class="pp-lives" data-pp="lives" aria-label="${text("lives")}">♥♥♥</span>
        </div>
        <div class="pp-board" data-pp="board" role="grid" aria-label="${text("empty")}"></div>
        <div class="pp-status" data-pp="status" role="status" aria-live="polite">${text("empty")}</div>
        <div class="pp-tools">
          <button type="button" data-pp-action="rotate" aria-keyshortcuts="R">↻ ${text("rotate")}</button>
        </div>
        <div class="pp-tray" data-pp="tray" aria-label="${this.instructions}"></div>
      </main>
      <p class="pp-keys">${text("keys")}</p>
      <div class="pp-countdown" data-pp="countdown" hidden></div>
      <div class="ak-overlay pp-panel" data-pp="panel" role="dialog" aria-modal="true" hidden></div>
    `;
    context.mount.replaceChildren(root);
    this.root = root;
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
    this.results = createResultScreen({
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
    root.addEventListener("click", this.onClick);
    root.addEventListener("keydown", this.onKeyDown);
    root.addEventListener("pointerdown", this.onPointerDown);
    root.addEventListener("pointermove", this.onPointerMove);
    root.addEventListener("pointerup", this.onPointerUp);
    root.addEventListener("pointercancel", this.onPointerCancel);
    this.cleanup.push(() => root.removeEventListener("click", this.onClick));
    this.cleanup.push(() => root.removeEventListener("keydown", this.onKeyDown));
    this.cleanup.push(() => root.removeEventListener("pointerdown", this.onPointerDown));
    this.cleanup.push(() => root.removeEventListener("pointermove", this.onPointerMove));
    this.cleanup.push(() => root.removeEventListener("pointerup", this.onPointerUp));
    this.cleanup.push(() => root.removeEventListener("pointercancel", this.onPointerCancel));
    this.phase = "tutorial";
  }

  start(): void {
    if (!this.root || this.phase !== "tutorial") return;
    this.tutorial?.open();
  }

  pause(): void {
    if (this.phase !== "playing" && this.phase !== "countdown") return;
    this.pausedFrom = this.phase;
    this.phase = "paused";
    this.pauseGate.pause();
    this.showPausePanel();
  }

  resume(): void {
    if (this.phase !== "paused") return;
    this.phase = this.pausedFrom ?? "playing";
    this.pausedFrom = null;
    this.pauseGate.resume();
    this.hidePanel();
    this.root?.focus();
  }

  update(deltaSeconds: number): void {
    if (!this.root) return;
    const requested = Math.min(0.25, Math.max(0, Number.isFinite(deltaSeconds) ? deltaSeconds : 0));
    const delta = this.pauseGate.filter(requested);
    if (this.phase === "countdown") {
      this.countdown?.update(delta);
      return;
    }
    if (this.phase !== "playing" || !this.session) return;
    stepPackingSession(this.session, delta);
    this.hud?.setTimer(this.session.boardElapsedSeconds);
  }

  payout(): MinigamePayout {
    return this.settledPayout ?? EMPTY_PAYOUT;
  }

  dispose(): void {
    if (this.phase === "disposed") return;
    this.settlement?.exitUnpaid();
    for (const remove of this.cleanup.splice(0)) remove();
    this.hud?.dispose();
    this.tutorial?.dispose();
    this.results?.dispose();
    this.root?.remove();
    this.pauseGate.dispose();
    this.phase = "disposed";
    this.context = null;
    this.root = null;
    this.hud = null;
    this.tutorial = null;
    this.results = null;
    this.settlement = null;
    this.session = null;
    this.countdown = null;
  }

  private beginCountdown(): void {
    if (!this.context || !this.settlement) return;
    this.results?.close();
    this.hidePanel();
    this.settlement.begin();
    this.best = this.settlement.persistedBest;
    this.session = createPackingSession(this.context.rng);
    this.settledPayout = null;
    this.renderedBoardSize = 0;
    this.rotations.clear();
    this.selectedPieceId = null;
    this.pauseGate.resume();
    this.phase = "countdown";
    this.render();
    const counter = this.root?.querySelector<HTMLElement>("[data-pp='countdown']");
    this.countdown = new ArcadeCountdown({
      seconds: 3,
      feedback: (event) => {
        if (counter) {
          counter.hidden = false;
          counter.textContent = event.kind === "tick"
            ? String(event.value)
            : activeCatalog().strings.minigameCommon.go;
        }
        this.emit(event.cue, event.kind === "tick" ? event.value : undefined);
        if (event.kind === "go") {
          if (counter) counter.hidden = true;
          this.phase = "playing";
          this.root?.focus();
        }
      },
    });
    this.countdown.start();
  }

  private finish(): void {
    if (!this.session || !this.settlement || this.phase === "result") return;
    const payout = packingPayout(this.session);
    const previousBest = this.settlement.persistedBest;
    this.settledPayout = payout;
    const best = this.settlement.complete(payout);
    this.best = Math.max(previousBest, best ?? payout.score);
    this.phase = "result";
    this.hud?.setBest(this.best);
    this.emit(this.session.completedBoards === 3 ? "win" : "lose", payout.score);
    this.results?.show({
      score: payout.score,
      best: this.best,
      newBest: payout.score > previousBest,
      detail: `${this.session.completedBoards}/3 ${text("detail")} ${Math.round(packingEfficiency(this.session.board) * 100)}%`,
    });
  }

  private exitUnpaid(): void {
    this.settlement?.exitUnpaid();
    this.settledPayout = null;
    this.showReadyPanel(text("unpaid"));
  }

  private showReadyPanel(notice = ""): void {
    this.phase = "ready";
    const panel = this.panel();
    if (!panel) return;
    const strings = activeCatalog().strings.minigameCommon;
    panel.hidden = false;
    panel.innerHTML = `
      <div class="ak-card">
        <span class="ak-kicker">${text("ready")}</span>
        <div class="ak-card-icon" aria-hidden="true">🧺</div>
        <h2>${this.title}</h2>
        ${notice ? `<p>${notice}</p>` : ""}
        <button class="ak-button ak-button-primary" data-pp-action="start">${text("start")}</button>
        <button class="ak-button ak-button-quiet" data-pp-action="tutorial">${strings.howToPlay}</button>
      </div>
    `;
    panel.querySelector<HTMLButtonElement>("[data-pp-action='start']")?.focus();
  }

  private showPausePanel(): void {
    const panel = this.panel();
    if (!panel) return;
    const strings = activeCatalog().strings.minigameCommon;
    panel.hidden = false;
    panel.innerHTML = `
      <div class="ak-card">
        <span class="ak-kicker">${strings.paused}</span>
        <div class="ak-card-icon" aria-hidden="true">🧺</div>
        <h2>${strings.paused}</h2>
        <button class="ak-button ak-button-primary" data-pp-action="resume">${strings.resume}</button>
        <button class="ak-button ak-button-secondary" data-pp-action="restart">${strings.restart}</button>
        <button class="ak-button ak-button-quiet" data-pp-action="quit">${strings.quitNoReward}</button>
      </div>
    `;
    panel.querySelector<HTMLButtonElement>("[data-pp-action='resume']")?.focus();
  }

  private panel(): HTMLElement | null {
    return this.root?.querySelector<HTMLElement>("[data-pp='panel']") ?? null;
  }

  private hidePanel(): void {
    const panel = this.panel();
    if (!panel) return;
    panel.hidden = true;
    panel.replaceChildren();
  }

  private readonly onClick = (event: MouseEvent): void => {
    if (this.suppressClick) {
      this.suppressClick = false;
      return;
    }
    const target = event.target instanceof Element
      ? event.target.closest<HTMLElement>("[data-pp-action],[data-pp-piece],[data-pp-cell]")
      : null;
    if (!target) return;
    const action = target.dataset.ppAction;
    if (action) {
      switch (action) {
        case "start":
        case "restart":
          this.beginCountdown();
          break;
        case "tutorial":
          this.hidePanel();
          this.phase = "tutorial";
          this.tutorial?.open();
          break;
        case "resume":
          this.resume();
          break;
        case "quit":
          this.exitUnpaid();
          break;
        case "rotate":
          this.rotateSelected();
          break;
        default:
          break;
      }
      return;
    }
    const pieceId = target.dataset.ppPiece;
    if (pieceId) {
      this.selectPiece(pieceId, true);
      return;
    }
    if (target.dataset.ppCell !== undefined && this.phase === "playing") {
      this.placeSelected(Number(target.dataset.ppX), Number(target.dataset.ppY));
    }
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.repeat) return;
    const key = event.key.toLowerCase();
    if (key === "p" || key === "escape") {
      if (this.phase === "playing" || this.phase === "countdown") {
        event.preventDefault();
        this.pause();
      } else if (this.phase === "paused") {
        event.preventDefault();
        this.resume();
      }
      return;
    }
    if (this.phase !== "playing" || !this.session) return;
    if (/^[1-9]$/u.test(key)) {
      const piece = this.session.board.pieces[Number(key) - 1];
      if (piece) {
        event.preventDefault();
        this.selectPiece(piece.id, false);
      }
      return;
    }
    if (key === "r") {
      event.preventDefault();
      this.rotateSelected();
      return;
    }
    if (key === "arrowleft" || key === "a") this.cursorX -= 1;
    else if (key === "arrowright" || key === "d") this.cursorX += 1;
    else if (key === "arrowup" || key === "w") this.cursorY -= 1;
    else if (key === "arrowdown" || key === "s") this.cursorY += 1;
    else if (key === " " || key === "enter") {
      event.preventDefault();
      this.placeSelected(this.cursorX, this.cursorY);
      return;
    } else return;
    event.preventDefault();
    this.cursorX = Math.max(0, Math.min(this.session.board.size - 1, this.cursorX));
    this.cursorY = Math.max(0, Math.min(this.session.board.size - 1, this.cursorY));
    this.renderCursor();
  };

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (this.phase !== "playing" || !(event.target instanceof Element)) return;
    const piece = event.target.closest<HTMLElement>("[data-pp-piece]");
    if (!piece?.dataset.ppPiece) return;
    this.selectedPieceId = piece.dataset.ppPiece;
    this.dragPieceId = piece.dataset.ppPiece;
    this.dragPointerId = event.pointerId;
    this.dragMoved = false;
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (event.pointerId === this.dragPointerId) this.dragMoved = true;
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (event.pointerId !== this.dragPointerId || !this.dragPieceId || !this.root) return;
    if (this.dragMoved) {
      const board = this.root.querySelector<HTMLElement>("[data-pp='board']");
      const rect = board?.getBoundingClientRect();
      if (rect && event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom) {
        const size = this.session?.board.size ?? 1;
        const x = Math.min(size - 1, Math.max(0, Math.floor(((event.clientX - rect.left) / rect.width) * size)));
        const y = Math.min(size - 1, Math.max(0, Math.floor(((event.clientY - rect.top) / rect.height) * size)));
        this.selectedPieceId = this.dragPieceId;
        this.placeSelected(x, y);
        this.suppressClick = true;
        this.root.ownerDocument.defaultView?.setTimeout(() => {
          this.suppressClick = false;
        }, 0);
      }
    }
    this.clearDrag();
  };

  private readonly onPointerCancel = (): void => {
    this.clearDrag();
  };

  private clearDrag(): void {
    this.dragPieceId = null;
    this.dragPointerId = null;
    this.dragMoved = false;
  }

  private selectPiece(pieceId: string, removePlaced: boolean): void {
    if (!this.session) return;
    if (removePlaced && this.session.board.placements.some((placement) => placement.pieceId === pieceId)) {
      this.session.board = removePicnicPiece(this.session.board, pieceId);
    }
    this.selectedPieceId = pieceId;
    this.render();
    this.root?.focus();
  }

  private rotateSelected(): void {
    if (!this.selectedPieceId || !this.session) return;
    const current = this.rotations.get(this.selectedPieceId) ?? 0;
    this.rotations.set(this.selectedPieceId, (current + 1) % 4);
    this.emit("score");
    this.render();
    this.root?.focus();
  }

  private placeSelected(x: number, y: number): void {
    const session = this.session;
    const context = this.context;
    const pieceId = this.selectedPieceId;
    if (!session || !context || !pieceId || this.phase !== "playing") return;
    const previousBoard = session.boardIndex;
    const outcome = trySessionPlacement(
      session,
      context.rng,
      pieceId,
      x,
      y,
      this.rotations.get(pieceId) ?? 0,
    );
    if (outcome.kind === "invalid") {
      this.emit("miss", undefined, "warning");
      this.status(text("invalid"));
    } else {
      this.emit(outcome.completed ? "combo" : "hit", session.completedBoards, "light");
      this.status(outcome.completed ? (session.finished ? text("completed") : text("next")) : text("placed"));
    }
    if (session.finished) {
      this.render();
      this.finish();
      return;
    }
    if (session.boardIndex !== previousBoard) this.renderedBoardSize = 0;
    this.selectFirstAvailable();
    this.render();
  }

  private selectFirstAvailable(): void {
    const board = this.session?.board;
    if (!board) return;
    const placed = new Set(board.placements.map((placement) => placement.pieceId));
    this.selectedPieceId = board.pieces.find((piece) => !placed.has(piece.id))?.id ?? board.pieces[0]?.id ?? null;
  }

  private render(): void {
    const root = this.root;
    const session = this.session;
    if (!root || !session) return;
    if (this.renderedBoardSize !== session.board.size) {
      this.renderedBoardSize = session.board.size;
      this.rotations.clear();
      for (const piece of session.board.pieces) this.rotations.set(piece.id, piece.initialRotation);
      this.cursorX = 0;
      this.cursorY = 0;
      this.selectFirstAvailable();
    }
    const board = root.querySelector<HTMLElement>("[data-pp='board']");
    if (board) {
      board.style.setProperty("--pp-size", String(session.board.size));
      const occupancy = new Map<string, PicnicPiece>();
      for (const placement of session.board.placements) {
        const piece = session.board.pieces.find((candidate) => candidate.id === placement.pieceId);
        if (!piece) continue;
        for (const cell of placement.cells) occupancy.set(`${cell.x},${cell.y}`, piece);
      }
      board.innerHTML = Array.from({ length: session.board.size * session.board.size }, (_, index) => {
        const x = index % session.board.size;
        const y = Math.floor(index / session.board.size);
        const piece = occupancy.get(`${x},${y}`);
        const cue = piece ? ITEM_CUES[piece.kind] : undefined;
        return `<button type="button" role="gridcell" class="pp-cell${piece ? " filled" : ""}${x === this.cursorX && y === this.cursorY ? " cursor" : ""}" data-pp-cell data-pp-x="${x}" data-pp-y="${y}" style="${cue ? `--piece:${cue.color}` : ""}" aria-label="${piece && cue ? pickLocalized(cue.name) : `${text("empty")} ${x + 1}, ${y + 1}`}">${cue?.glyph ?? ""}</button>`;
      }).join("");
    }
    const tray = root.querySelector<HTMLElement>("[data-pp='tray']");
    if (tray) {
      const placed = new Set(session.board.placements.map((placement) => placement.pieceId));
      tray.innerHTML = session.board.pieces.map((piece, index) => this.pieceMarkup(piece, index, placed.has(piece.id))).join("");
    }
    const boardLabel = root.querySelector<HTMLElement>("[data-pp='board-label']");
    if (boardLabel) boardLabel.textContent = `${text("board")} ${session.boardIndex + 1}/3 · ${session.board.size}×${session.board.size}`;
    const efficiency = root.querySelector<HTMLElement>("[data-pp='efficiency']");
    if (efficiency) efficiency.textContent = `${text("efficiency")} ${Math.round(packingEfficiency(session.board) * 100)}%`;
    const lives = root.querySelector<HTMLElement>("[data-pp='lives']");
    if (lives) {
      lives.innerHTML = Array.from({ length: 3 }, (_, index) => `<i class="${index >= session.lives ? "lost" : ""}">♥</i>`).join("");
    }
    this.hud?.setScore(session.score);
    this.hud?.setCombo(session.completedBoards);
    this.hud?.setBest(Math.max(this.best, session.score));
  }

  private pieceMarkup(piece: PicnicPiece, index: number, packed: boolean): string {
    const rotation = this.rotations.get(piece.id) ?? piece.initialRotation;
    const cells = rotateCells(piece.cells, rotation);
    const maxX = Math.max(...cells.map((cell) => cell.x));
    const maxY = Math.max(...cells.map((cell) => cell.y));
    const cellSet = new Set(cells.map((cell) => `${cell.x},${cell.y}`));
    const cue = ITEM_CUES[piece.kind] ?? ITEM_CUES[0];
    const cellsMarkup = Array.from({ length: (maxX + 1) * (maxY + 1) }, (_, cellIndex) => {
      const x = cellIndex % (maxX + 1);
      const y = Math.floor(cellIndex / (maxX + 1));
      const filled = cellSet.has(`${x},${y}`);
      return `<i class="${filled ? "shape" : ""}">${filled ? cue.glyph : ""}</i>`;
    }).join("");
    return `
      <button type="button" class="pp-piece${this.selectedPieceId === piece.id ? " selected" : ""}${packed ? " packed" : ""}"
        data-pp-piece="${piece.id}" aria-keyshortcuts="${index < 9 ? index + 1 : ""}"
        aria-label="${pickLocalized(cue.name)}. ${packed ? text("packed") : text("selected")}" style="--piece:${cue.color}">
        <span class="pp-shape" style="--shape-cols:${maxX + 1}">${cellsMarkup}</span>
        <small>${index + 1}</small>
      </button>
    `;
  }

  private renderCursor(): void {
    for (const cell of this.root?.querySelectorAll<HTMLElement>("[data-pp-cell]") ?? []) {
      cell.classList.toggle("cursor", Number(cell.dataset.ppX) === this.cursorX && Number(cell.dataset.ppY) === this.cursorY);
    }
  }

  private status(message: string): void {
    const status = this.root?.querySelector<HTMLElement>("[data-pp='status']");
    if (status) status.textContent = message;
  }

  private emit(action: SoundAction, value?: number, haptic?: HapticPattern): void {
    this.context?.audio?.emit(action, value);
    if (haptic) this.context?.haptics?.impact(haptic);
  }
}

export const createMinigame = (): MinigameModule => new PicnicPackerGame();

const PICNIC_CSS = `
  .picnic-packer{position:relative;isolation:isolate;width:100%;height:100%;min-height:620px;overflow:hidden;color:#4d3d34;background:#d7edbe;font-family:Nunito,ui-rounded,"Arial Rounded MT Bold",system-ui,sans-serif;touch-action:none;user-select:none}.picnic-packer *{box-sizing:border-box}.picnic-packer button{min-width:44px;min-height:44px;font:inherit}.picnic-packer button:focus-visible{outline:3px solid #4d3d34;outline-offset:2px}
  .pp-bg{position:absolute;inset:0;background:radial-gradient(circle at 15% 16%,#fff8 0 4px,transparent 5px),radial-gradient(circle at 83% 22%,#fff8 0 5px,transparent 6px),linear-gradient(145deg,#dff2c8,#afd58e)}.pp-bg:after{content:"";position:absolute;inset:38% 3% 7%;border:8px solid #fff8;border-radius:35px;background:repeating-conic-gradient(#f6dfc5 0 25%,#e88e8a 0 50%) 0/38px 38px;box-shadow:0 16px 30px #526f3a38;transform:rotate(-1deg)}
  .pp-stage{position:absolute;z-index:2;inset:72px 9px 35px;display:grid;grid-template-rows:auto minmax(230px,1fr) auto auto minmax(95px,auto);gap:7px}.pp-meta{display:grid;grid-template-columns:1fr auto auto;align-items:center;gap:7px;padding:7px 10px;border:3px solid #fff;border-radius:15px;background:#fff7e6e8;box-shadow:0 4px #9f765544;font-size:11px}.pp-meta strong{font-size:13px}.pp-lives{display:flex;gap:2px;color:#dd5969;font-size:18px}.pp-lives i{font-style:normal}.pp-lives i.lost{color:#c8b8a6;transform:scale(.78)}
  .pp-board{align-self:center;justify-self:center;display:grid;grid-template-columns:repeat(var(--pp-size),1fr);grid-template-rows:repeat(var(--pp-size),1fr);gap:3px;width:min(82vw,342px);aspect-ratio:1;padding:8px;border:5px solid #875f3e;border-radius:22px;background:#eabf7e;box-shadow:inset 0 0 0 5px #f9dfae,0 10px #68462f55}.pp-cell{display:grid;place-items:center;min-width:0!important;min-height:0!important;padding:0;border:2px dashed #b88b5f;border-radius:7px;color:#49392f;background:#fff3d2a8;font-size:clamp(13px,4vw,22px);cursor:pointer}.pp-cell.filled{border-style:solid;border-color:#fff9;background:var(--piece);text-shadow:0 1px #fff}.pp-cell.cursor{outline:4px solid #4b7952;outline-offset:-3px}
  .pp-status{min-height:23px;padding:3px 8px;text-align:center;color:#5a4638;font-size:12px;font-weight:900}.pp-tools{display:flex;justify-content:center}.pp-tools button{border:3px solid #fff;border-radius:14px;color:#fff;background:#5e9b67;box-shadow:0 4px #3c6c45;font-weight:1000;cursor:pointer}.pp-tray{display:flex;gap:6px;overflow-x:auto;padding:5px 3px 8px;scrollbar-width:thin}.pp-piece{position:relative;flex:0 0 auto;display:grid;place-items:center;padding:5px;border:3px solid #fff;border-radius:14px;background:#fff6df;box-shadow:0 5px #98705055;cursor:grab}.pp-piece.selected{border-color:#3f7247;box-shadow:0 0 0 3px #ffef78,0 5px #98705055}.pp-piece.packed{opacity:.63}.pp-piece small{position:absolute;right:2px;bottom:0;color:#6c5948;font-size:8px;font-weight:1000}.pp-shape{display:grid;grid-template-columns:repeat(var(--shape-cols),17px);grid-auto-rows:17px}.pp-shape i{display:grid;place-items:center;font-size:10px;font-style:normal}.pp-shape i.shape{border:1px solid #fff8;border-radius:4px;background:var(--piece)}
  .pp-keys{position:absolute;z-index:3;left:8px;right:8px;bottom:max(5px,env(safe-area-inset-bottom));margin:0;text-align:center;color:#4d583c;font-size:8px;font-weight:900}.pp-countdown{position:absolute;z-index:45;left:50%;top:42%;transform:translate(-50%,-50%);display:grid;place-items:center;width:105px;height:105px;border:6px solid #fff;border-radius:50%;color:#fff;background:#e4686f;box-shadow:0 10px 25px #62342d66;font-size:48px;font-weight:1000}.pp-countdown[hidden]{display:none}.pp-panel[hidden]{display:none}
  .picnic-packer[data-ak-reduced="true"] *{animation-duration:.001ms!important;transition-duration:.001ms!important}@media(prefers-reduced-motion:reduce){.picnic-packer *{animation-duration:.001ms!important;transition-duration:.001ms!important}}@media(max-height:700px){.picnic-packer{min-height:500px}.pp-stage{inset:64px 7px 26px;grid-template-rows:auto minmax(205px,1fr) auto auto 78px}.pp-board{width:min(67vh,320px)}.pp-shape{grid-template-columns:repeat(var(--shape-cols),14px);grid-auto-rows:14px}}
`;
