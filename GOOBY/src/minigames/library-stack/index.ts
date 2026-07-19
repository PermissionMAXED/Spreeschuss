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
  LIBRARY_BOOK_COUNT,
  averageNeatness,
  createLibrarySession,
  deterministicWobble,
  dropLibraryBook,
  evaluateStack,
  libraryPayout,
  stepLibrarySession,
  type LibrarySession,
  type StackBook,
} from "./logic";
import { createLibrarySettlement, type LibrarySettlement } from "./settlement";

export const manifest: MinigameManifest = validateMinigameManifest({
  id: "library-stack",
  title: localizedText((catalog) => catalog.minigames["library-stack"].title),
  instructions: localizedText((catalog) => catalog.minigames["library-stack"].instructions),
  icon: EN_CATALOG.minigames["library-stack"].icon,
  category: "skill",
  stage3d: false,
  unlockLevel: 1,
  audioCues: ["countdown", "go", "hit", "miss", "combo", "score", "win"],
  tutorial: [
    {
      icon: "📕",
      title: { en: "Drop each story", de: "Lass jedes Buch fallen" },
      body: {
        en: "Tap or drag the moving book over the shelf, then release. Space drops it from the keyboard.",
        de: "Tippe oder ziehe das bewegte Buch über das Regal und lass los. Leertaste lässt es per Tastatur fallen.",
      },
    },
    {
      icon: "⌖",
      title: { en: "Mind the center", de: "Achte auf den Schwerpunkt" },
      body: {
        en: "Every book changes the tower’s center of mass. Centered drops stay neat and wobble less.",
        de: "Jedes Buch verändert den Schwerpunkt. Mittige Ablagen bleiben ordentlich und wackeln weniger.",
      },
    },
    {
      icon: "★",
      title: { en: "Catch bonus stories", de: "Fange Bonusgeschichten" },
      body: {
        en: "Golden bonus books score extra. A miss lands safely in Gooby’s cozy beanbag instead of ending the round.",
        de: "Goldene Bonusbücher punkten extra. Ein Fehlwurf landet sicher in Goobys Sitzsack, statt die Runde zu beenden.",
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
type LibraryContext = MinigameContext & {
  readonly audio?: { emit(action: SoundAction, value?: number): void };
  readonly haptics?: { impact(pattern: HapticPattern): void };
  readonly bestScore?: number;
  readonly reducedMotion?: boolean;
};
type Phase = "boot" | "tutorial" | "ready" | "countdown" | "playing" | "paused" | "result" | "disposed";
type Copy = { readonly en: string; readonly de: string };

const COPY = {
  start: { en: "Start stacking", de: "Stapel starten" },
  ready: { en: "Cozy library", de: "Gemütliche Bibliothek" },
  books: { en: "Books", de: "Bücher" },
  neatness: { en: "Neatness", de: "Ordnung" },
  bonus: { en: "Bonus books", de: "Bonusbücher" },
  drop: { en: "Drop book", de: "Buch fallen lassen" },
  moving: { en: "Moving book — tap a shelf position or press Space", de: "Bewegtes Buch — tippe eine Regalposition oder drücke Leertaste" },
  tidy: { en: "Tidy landing!", de: "Ordentlich gelandet!" },
  bonusLanded: { en: "Golden bonus story!", de: "Goldene Bonusgeschichte!" },
  caught: { en: "Soft beanbag catch — tower saved!", de: "Sanft im Sitzsack gelandet — Turm gerettet!" },
  keys: { en: "← → nudge · Space drop · P pause", de: "← → verschieben · Leertaste fallen · P Pause" },
  detail: { en: "high · neatness · bonus", de: "hoch · Ordnung · Bonus" },
  unpaid: { en: "Library closed — no rewards.", de: "Bibliothek geschlossen — keine Belohnung." },
} as const satisfies Readonly<Record<string, Copy>>;

type CopyKey = keyof typeof COPY;
const text = (key: CopyKey): string => pickLocalized(COPY[key]);
const EMPTY_PAYOUT: MinigamePayout = { score: 0, coins: 0, xp: 0 };

const BOOK_CUES = [
  { title: { en: "Moon Rabbits", de: "Mondhasen" }, color: "#d96875", glyph: "☾" },
  { title: { en: "Clover Tales", de: "Kleegeschichten" }, color: "#70a765", glyph: "♣" },
  { title: { en: "Berry Atlas", de: "Beerenatlas" }, color: "#9867ad", glyph: "●" },
  { title: { en: "Tiny Gardens", de: "Kleine Gärten" }, color: "#5b9d91", glyph: "❀" },
  { title: { en: "Cloud Cookbook", de: "Wolkenkochbuch" }, color: "#6d94c4", glyph: "☁" },
  { title: { en: "Acorn Almanac", de: "Eichelalmanach" }, color: "#b78150", glyph: "♢" },
  { title: { en: "Carrot Comets", de: "Karottenkometen" }, color: "#df8b4f", glyph: "✦" },
  { title: { en: "Burrow Ballads", de: "Bauballaden" }, color: "#c66d92", glyph: "♪" },
] as const;

export class LibraryStackGame implements MinigameModule {
  readonly id = manifest.id;
  private context: LibraryContext | null = null;
  private root: HTMLElement | null = null;
  private hud: ArcadeHud | null = null;
  private tutorial: TutorialOverlay | null = null;
  private results: ResultScreen | null = null;
  private settlement: LibrarySettlement | null = null;
  private session: LibrarySession | null = null;
  private countdown: ArcadeCountdown | null = null;
  private readonly pauseGate = new PauseGate();
  private readonly cleanup: Array<() => void> = [];
  private phase: Phase = "boot";
  private pausedFrom: "countdown" | "playing" | null = null;
  private settledPayout: MinigamePayout | null = null;
  private best = 0;
  private pointerId: number | null = null;
  private manualX: number | null = null;

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
    this.settlement = createLibrarySettlement(context);
    this.best = this.settlement.persistedBest;
    const root = context.mount.ownerDocument.createElement("section");
    root.className = "library-stack";
    root.dataset.minigame = this.id;
    root.tabIndex = 0;
    root.setAttribute("aria-label", this.title);
    if (this.reducedMotion) root.dataset.akReduced = "true";
    root.innerHTML = `
      <style>${LIBRARY_CSS}</style>
      <div class="ls-room" aria-hidden="true"><i></i><i></i><i></i></div>
      <main class="ls-stage">
        <div class="ls-meta">
          <span><small>${text("books")}</small><strong data-ls="books">0/${LIBRARY_BOOK_COUNT}</strong></span>
          <span><small>${text("neatness")}</small><strong data-ls="neatness">—</strong></span>
          <span><small>${text("bonus")}</small><strong data-ls="bonus">★ 0</strong></span>
        </div>
        <div class="ls-playfield" data-ls="playfield" role="button" aria-label="${text("moving")}">
          <div class="ls-current" data-ls="current"></div>
          <div class="ls-tower" data-ls="tower"></div>
          <div class="ls-shelf"></div>
          <div class="ls-beanbag left">☁</div><div class="ls-beanbag right">☁</div>
          <div class="ls-com" data-ls="com" aria-hidden="true">⌖</div>
        </div>
        <button type="button" class="ls-drop" data-ls-action="drop" aria-keyshortcuts="Space">${text("drop")}</button>
        <div class="ls-status" data-ls="status" role="status" aria-live="polite">${text("moving")}</div>
      </main>
      <p class="ls-keys">${text("keys")}</p>
      <div class="ls-countdown" data-ls="countdown" hidden></div>
      <div class="ak-overlay ls-panel" data-ls="panel" role="dialog" aria-modal="true" hidden></div>
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
    if (this.phase === "tutorial") this.tutorial?.open();
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
    const requested = Math.min(0.25, Math.max(0, Number.isFinite(deltaSeconds) ? deltaSeconds : 0));
    const delta = this.pauseGate.filter(requested);
    if (this.phase === "countdown") {
      this.countdown?.update(delta);
      return;
    }
    if (this.phase !== "playing" || !this.session) return;
    stepLibrarySession(this.session, delta);
    if (this.manualX !== null) this.session.movingX = this.manualX;
    this.hud?.setTimer(this.session.remainingSeconds);
    this.renderMotion();
    if (this.session.finished) this.finish();
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
    this.session = createLibrarySession(this.context.rng);
    this.settledPayout = null;
    this.best = this.settlement.persistedBest;
    this.manualX = null;
    this.pauseGate.resume();
    this.phase = "countdown";
    this.render();
    const counter = this.root?.querySelector<HTMLElement>("[data-ls='countdown']");
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
    const payout = libraryPayout(this.session);
    const previousBest = this.settlement.persistedBest;
    this.settledPayout = payout;
    const best = this.settlement.complete(payout);
    this.best = Math.max(previousBest, best ?? payout.score);
    this.hud?.setBest(this.best);
    this.emit("win", payout.score, "success");
    this.phase = "result";
    this.results?.show({
      score: payout.score,
      best: this.best,
      newBest: payout.score > previousBest,
      detail: `${this.session.books.length} ${text("detail")} ${Math.round(averageNeatness(this.session) * 100)}% · ★ ${this.session.bonusBooks}`,
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
        <div class="ak-card-icon" aria-hidden="true">📚</div>
        <h2>${this.title}</h2>
        ${notice ? `<p>${notice}</p>` : ""}
        <button class="ak-button ak-button-primary" data-ls-action="start">${text("start")}</button>
        <button class="ak-button ak-button-quiet" data-ls-action="tutorial">${strings.howToPlay}</button>
      </div>
    `;
    panel.querySelector<HTMLButtonElement>("[data-ls-action='start']")?.focus();
  }

  private showPausePanel(): void {
    const panel = this.panel();
    if (!panel) return;
    const strings = activeCatalog().strings.minigameCommon;
    panel.hidden = false;
    panel.innerHTML = `
      <div class="ak-card">
        <span class="ak-kicker">${strings.paused}</span>
        <div class="ak-card-icon" aria-hidden="true">📚</div>
        <h2>${strings.paused}</h2>
        <button class="ak-button ak-button-primary" data-ls-action="resume">${strings.resume}</button>
        <button class="ak-button ak-button-secondary" data-ls-action="restart">${strings.restart}</button>
        <button class="ak-button ak-button-quiet" data-ls-action="quit">${strings.quitNoReward}</button>
      </div>
    `;
    panel.querySelector<HTMLButtonElement>("[data-ls-action='resume']")?.focus();
  }

  private panel(): HTMLElement | null {
    return this.root?.querySelector<HTMLElement>("[data-ls='panel']") ?? null;
  }

  private hidePanel(): void {
    const panel = this.panel();
    if (!panel) return;
    panel.hidden = true;
    panel.replaceChildren();
  }

  private readonly onClick = (event: MouseEvent): void => {
    const target = event.target instanceof Element
      ? event.target.closest<HTMLElement>("[data-ls-action]")
      : null;
    if (!target) return;
    switch (target.dataset.lsAction) {
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
      case "drop":
        this.drop();
        break;
      default:
        break;
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
    if (key === "arrowleft" || key === "a") {
      event.preventDefault();
      this.manualX = Math.max(0, (this.manualX ?? this.session.movingX) - 0.04);
      this.session.movingX = this.manualX;
      this.renderMotion();
    } else if (key === "arrowright" || key === "d") {
      event.preventDefault();
      this.manualX = Math.min(1, (this.manualX ?? this.session.movingX) + 0.04);
      this.session.movingX = this.manualX;
      this.renderMotion();
    } else if (key === " " || key === "enter") {
      event.preventDefault();
      this.drop();
    }
  };

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (this.phase !== "playing" || !(event.target instanceof Element)) return;
    const playfield = event.target.closest<HTMLElement>("[data-ls='playfield']");
    if (!playfield) return;
    this.pointerId = event.pointerId;
    this.updatePointerX(event);
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (event.pointerId === this.pointerId) this.updatePointerX(event);
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (event.pointerId !== this.pointerId) return;
    this.updatePointerX(event);
    this.pointerId = null;
    this.drop();
  };

  private readonly onPointerCancel = (): void => {
    this.pointerId = null;
    this.manualX = null;
  };

  private updatePointerX(event: PointerEvent): void {
    const playfield = this.root?.querySelector<HTMLElement>("[data-ls='playfield']");
    const rect = playfield?.getBoundingClientRect();
    if (!rect || !this.session) return;
    this.manualX = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    this.session.movingX = this.manualX;
    this.renderMotion();
  }

  private drop(): void {
    if (!this.session || !this.context || this.phase !== "playing") return;
    const result = dropLibraryBook(this.session, this.context.rng, this.manualX ?? this.session.movingX);
    this.manualX = null;
    if (!result) return;
    if (result.caught) {
      this.status(text("caught"), "caught");
      this.emit("miss", this.session.caught, "warning");
    } else {
      this.status(result.bonus ? text("bonusLanded") : text("tidy"), result.bonus ? "bonus" : "tidy");
      this.emit(result.bonus ? "combo" : "hit", this.session.neatStreak, result.bonus ? "success" : "light");
    }
    this.render();
    if (this.session.finished) this.finish();
  }

  private render(): void {
    const root = this.root;
    const session = this.session;
    if (!root || !session) return;
    const books = root.querySelector<HTMLElement>("[data-ls='books']");
    if (books) books.textContent = `${session.attempts}/${LIBRARY_BOOK_COUNT}`;
    const neatness = root.querySelector<HTMLElement>("[data-ls='neatness']");
    if (neatness) neatness.textContent = session.books.length > 0 ? `${Math.round(averageNeatness(session) * 100)}%` : "—";
    const bonus = root.querySelector<HTMLElement>("[data-ls='bonus']");
    if (bonus) bonus.textContent = `★ ${session.bonusBooks}`;
    const tower = root.querySelector<HTMLElement>("[data-ls='tower']");
    if (tower) tower.innerHTML = session.books.map((book, index) => this.bookMarkup(book, index)).join("");
    this.hud?.setScore(session.score);
    this.hud?.setCombo(session.neatStreak);
    this.hud?.setBest(Math.max(this.best, session.score));
    this.hud?.setTimer(session.remainingSeconds);
    this.renderMotion();
  }

  private renderMotion(): void {
    const root = this.root;
    const session = this.session;
    if (!root || !session) return;
    const current = root.querySelector<HTMLElement>("[data-ls='current']");
    if (current) {
      const cue = BOOK_CUES[session.current.kind] ?? BOOK_CUES[0];
      current.style.left = `${session.movingX * 100}%`;
      current.style.width = `${session.current.width * 100}%`;
      current.style.setProperty("--book", session.current.bonus ? "#e6ba42" : cue.color);
      current.innerHTML = `<span>${session.current.bonus ? "★" : cue.glyph}</span><small>${pickLocalized(cue.title)}</small>`;
      current.classList.toggle("bonus", session.current.bonus);
    }
    const tower = root.querySelector<HTMLElement>("[data-ls='tower']");
    if (tower) tower.style.transform = `rotate(${this.reducedMotion ? 0 : deterministicWobble(session)}deg)`;
    const com = root.querySelector<HTMLElement>("[data-ls='com']");
    if (com) {
      const stability = evaluateStack(session.books);
      com.style.left = `${stability.centerOfMass * 100}%`;
      com.hidden = session.books.length === 0;
    }
  }

  private bookMarkup(book: StackBook, index: number): string {
    const cue = BOOK_CUES[book.kind] ?? BOOK_CUES[0];
    const bottom = this.session?.books.slice(0, index).reduce((sum, entry) => sum + entry.height * 380, 0) ?? 0;
    return `
      <div class="ls-book${book.bonus ? " bonus" : ""}" style="left:${book.x * 100}%;bottom:${bottom}px;width:${book.width * 100}%;height:${Math.max(18, book.height * 380)}px;--book:${book.bonus ? "#e6ba42" : cue.color}" title="${pickLocalized(cue.title)}">
        <span>${book.bonus ? "★" : cue.glyph}</span><small>${pickLocalized(cue.title)}</small>
      </div>
    `;
  }

  private status(message: string, kind: "tidy" | "bonus" | "caught"): void {
    const status = this.root?.querySelector<HTMLElement>("[data-ls='status']");
    if (!status) return;
    status.textContent = message;
    status.className = `ls-status ${kind}`;
  }

  private emit(action: SoundAction, value?: number, haptic?: HapticPattern): void {
    this.context?.audio?.emit(action, value);
    if (haptic) this.context?.haptics?.impact(haptic);
  }
}

export const createMinigame = (): MinigameModule => new LibraryStackGame();

const LIBRARY_CSS = `
  .library-stack{position:relative;isolation:isolate;width:100%;height:100%;min-height:620px;overflow:hidden;color:#41374b;background:#d8c9ec;font-family:Nunito,ui-rounded,"Arial Rounded MT Bold",system-ui,sans-serif;touch-action:none;user-select:none}.library-stack *{box-sizing:border-box}.library-stack button{min-width:44px;min-height:44px;font:inherit}.library-stack button:focus-visible{outline:3px solid #41374b;outline-offset:3px}
  .ls-room{position:absolute;inset:0;background:linear-gradient(#eee6f7 0 76%,#ae876e 76%)}.ls-room:before{content:"";position:absolute;inset:0 0 24%;background:repeating-linear-gradient(90deg,#9a6c8840 0 3px,transparent 3px 70px),repeating-linear-gradient(#9a6c8840 0 3px,transparent 3px 82px)}.ls-room>i{position:absolute;top:18%;width:73px;height:150px;border:8px solid #7b5949;border-radius:7px;background:repeating-linear-gradient(#8ab16b 0 22px,#d89a66 22px 44px,#738fbd 44px 66px);box-shadow:0 10px #6c4c3e}.ls-room>i:nth-child(1){left:-25px}.ls-room>i:nth-child(2){right:-22px}.ls-room>i:nth-child(3){left:44%;top:9%;width:46px;height:58px;border-color:#c3935d;background:#fff3d0}
  .ls-stage{position:absolute;z-index:2;inset:72px 10px 33px;display:grid;grid-template-rows:auto minmax(360px,1fr) auto auto;gap:7px}.ls-meta{display:grid;grid-template-columns:repeat(3,1fr);gap:7px}.ls-meta>span{display:grid;place-content:center;min-height:46px;border:3px solid #fff;border-radius:14px;text-align:center;background:#fff9efe8;box-shadow:0 4px #7358653b}.ls-meta small{font-size:8px;font-weight:1000;letter-spacing:.08em;color:#897084}.ls-meta strong{font-size:15px}
  .ls-playfield{position:relative;overflow:hidden;border:4px solid #fff8;border-radius:25px;background:linear-gradient(#f8f0ff88,#fff7eec4);box-shadow:inset 0 -18px #7e5b47,0 8px #66505a44;cursor:crosshair}.ls-current{position:absolute;z-index:9;top:25px;transform:translateX(-50%);display:flex;align-items:center;justify-content:space-between;height:37px;padding:3px 8px;border:3px solid #fff;border-radius:7px;color:#fff;background:var(--book);box-shadow:0 5px #55435855;transition:left .04s linear}.ls-current.bonus{color:#5c431f;box-shadow:0 0 22px #f5d35f}.ls-current span{font-size:17px}.ls-current small{overflow:hidden;font-size:7px;font-weight:1000;white-space:nowrap}.ls-tower{position:absolute;z-index:5;left:8%;right:8%;bottom:46px;height:calc(100% - 78px);transform-origin:50% 100%;transition:transform .05s linear}.ls-book{position:absolute;transform:translateX(-50%);display:flex;align-items:center;justify-content:space-between;min-height:18px;padding:2px 7px;border:3px solid #fff9;border-radius:5px;color:#fff;background:var(--book);box-shadow:0 3px #4e3d4c55}.ls-book.bonus{color:#58411d;box-shadow:0 0 13px #f7d75b}.ls-book span{font-size:12px}.ls-book small{overflow:hidden;font-size:6px;font-weight:1000;white-space:nowrap}.ls-shelf{position:absolute;z-index:4;left:6%;right:6%;bottom:34px;height:18px;border:4px solid #fff7;border-radius:8px;background:#795644;box-shadow:0 10px #5b3d31}.ls-beanbag{position:absolute;z-index:3;bottom:27px;width:83px;height:53px;border:4px solid #fff8;border-radius:50%;color:#fff;text-align:center;background:#d77d89;font-size:36px}.ls-beanbag.left{left:-23px;transform:rotate(10deg)}.ls-beanbag.right{right:-23px;transform:rotate(-10deg);background:#7aa797}.ls-com{position:absolute;z-index:8;bottom:51px;transform:translateX(-50%);color:#4a344c;font-size:21px;text-shadow:0 0 5px #fff}.ls-com[hidden]{display:none}
  .ls-drop{border:3px solid #fff;border-radius:15px;color:#fff;background:#8a68af;box-shadow:0 5px #61457f;font-weight:1000;cursor:pointer}.ls-status{min-height:24px;text-align:center;font-size:11px;font-weight:1000}.ls-status.tidy{color:#467b52}.ls-status.bonus{color:#9a6a16}.ls-status.caught{color:#a74f61}.ls-keys{position:absolute;z-index:3;left:5px;right:5px;bottom:max(5px,env(safe-area-inset-bottom));margin:0;text-align:center;color:#5e4f68;font-size:8px;font-weight:900}.ls-countdown{position:absolute;z-index:45;left:50%;top:43%;transform:translate(-50%,-50%);display:grid;place-items:center;width:108px;height:108px;border:6px solid #fff;border-radius:50%;color:#fff;background:#8b68ad;box-shadow:0 12px 30px #4b355f66;font-size:46px;font-weight:1000}.ls-countdown[hidden],.ls-panel[hidden]{display:none}
  .library-stack[data-ak-reduced="true"] .ls-current,.library-stack[data-ak-reduced="true"] .ls-tower{transition:none}.library-stack[data-ak-reduced="true"] *{animation-duration:.001ms!important}@media(prefers-reduced-motion:reduce){.library-stack *{animation-duration:.001ms!important;transition-duration:.001ms!important}}@media(max-height:700px){.library-stack{min-height:500px}.ls-stage{inset:65px 8px 27px;grid-template-rows:auto minmax(300px,1fr) auto auto}.ls-current{top:12px}.ls-tower{height:calc(100% - 60px)}}
`;
