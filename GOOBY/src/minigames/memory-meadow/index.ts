import type {
  MinigameContext,
  MinigameModule,
  MinigamePayout,
  MinigameRunId,
} from "../../core/contracts/minigame";
import type { HapticPattern } from "../../core/contracts/platform";
import type { MinigameStubDefinition } from "../stub";
import {
  MEADOW_CONFIGS,
  MemoryMeadowRound,
  type MeadowDifficulty,
  type MeadowResult,
} from "./model";
import { MEMORY_MEADOW_STYLES } from "./styles";

export const definition = {
  id: "memory-meadow",
  title: "Memory Meadow",
  instructions: "Match every flower pair and every glowing trio before the meadow clock runs out.",
} as const satisfies MinigameStubDefinition;

type MeadowScreen = "tutorial" | "select" | "playing" | "results";
type SharedAudioAction = "hit" | "miss" | "combo" | "countdown" | "go" | "win" | "lose" | "score";

type MeadowContext = MinigameContext & {
  readonly audio?: { emit(action: SharedAudioAction, value?: number): void };
  readonly haptics?: { impact(pattern: HapticPattern): void };
  readonly reducedMotion?: boolean;
  readonly bestScore?: number;
};

const EMPTY_PAYOUT: MinigamePayout = { score: 0, coins: 0, xp: 0 };

const DIFFICULTY_LABELS: Readonly<Record<MeadowDifficulty, string>> = {
  1: "Sunny Patch",
  2: "Breezy Field",
  3: "Moonlit Meadow",
};

const DIFFICULTY_ICONS: Readonly<Record<MeadowDifficulty, string>> = {
  1: "🌤️",
  2: "🌬️",
  3: "🌙",
};

export class MemoryMeadow implements MinigameModule {
  readonly id = definition.id;
  readonly title = definition.title;
  readonly instructions = definition.instructions;

  private context: MeadowContext | null = null;
  private root: HTMLElement | null = null;
  private shadow: ShadowRoot | null = null;
  private screen: MeadowScreen = "tutorial";
  private difficulty: MeadowDifficulty = 1;
  private round: MemoryMeadowRound | null = null;
  private runId: MinigameRunId | null = null;
  private finalResult: MeadowResult | null = null;
  private tutorialPage = 0;
  private running = false;
  private paused = false;
  private finished = false;
  private highScore = 0;
  private previousBest = 0;
  private toast = "";
  private toastSeconds = 0;
  private lastShownSecond = -1;
  private readonly handleClick = (event: Event): void => {
    this.onClick(event);
  };
  private readonly handleKeyDown = (event: Event): void => {
    this.onKeyDown(event as KeyboardEvent);
  };

  mount(context: MinigameContext): void {
    this.dispose();
    this.context = context;
    this.highScore = context.lifecycle?.persistedBest
      ?? this.context.bestScore
      ?? 0;
    this.previousBest = this.highScore;
    const root = context.mount.ownerDocument.createElement("section");
    root.setAttribute("aria-label", "Memory Meadow");
    root.setAttribute("tabindex", "-1");
    root.dataset.reducedMotion = String(this.context.reducedMotion === true);
    root.dataset.minigame = this.id;
    this.root = root;
    this.shadow = root.attachShadow({ mode: "open" });
    this.shadow.addEventListener("click", this.handleClick);
    root.addEventListener("keydown", this.handleKeyDown);
    context.mount.replaceChildren(root);
    this.render();
  }

  start(): void {
    this.requireMounted();
    this.screen = "tutorial";
    this.tutorialPage = 0;
    this.running = false;
    this.paused = false;
    this.finished = false;
    this.render();
  }

  pause(): void {
    if (this.screen !== "playing" || this.round?.isComplete === true) return;
    this.paused = true;
    this.running = false;
    this.render();
  }

  resume(): void {
    if (this.screen !== "playing" || !this.paused) return;
    this.paused = false;
    this.running = true;
    this.render();
  }

  update(deltaSeconds: number): void {
    if (!this.running || this.round === null) return;
    const wasBusy = this.round.isBusy;
    this.round.update(deltaSeconds);

    if (this.toastSeconds > 0) {
      this.toastSeconds -= deltaSeconds;
      if (this.toastSeconds <= 0) {
        this.shadow?.querySelector(".toast")?.classList.remove("show");
      }
    }

    if (this.round.isComplete || this.round.isOutOfTime) {
      this.showResults();
      return;
    }

    if (wasBusy && !this.round.isBusy) {
      this.render();
      return;
    }

    const shownSecond = Math.ceil(this.round.remainingSeconds);
    if (shownSecond !== this.lastShownSecond) {
      this.lastShownSecond = shownSecond;
      this.updateHud();
    }
  }

  payout(): MinigamePayout {
    const result = this.finalResult ?? this.round?.result();
    if (result === undefined || this.round?.isComplete !== true) return EMPTY_PAYOUT;
    return {
      score: result.score,
      coins: result.stars * 6 + this.difficulty * 3,
      xp: Math.max(1, Math.floor(result.score / 90)),
    };
  }

  dispose(): void {
    this.context?.lifecycle?.exit();
    this.shadow?.removeEventListener("click", this.handleClick);
    this.root?.removeEventListener("keydown", this.handleKeyDown);
    this.root?.remove();
    this.context = null;
    this.root = null;
    this.shadow = null;
    this.round = null;
    this.runId = null;
    this.finalResult = null;
    this.running = false;
    this.paused = false;
    this.toast = "";
    this.toastSeconds = 0;
  }

  private onClick(event: Event): void {
    const documentView = this.root?.ownerDocument.defaultView;
    if (documentView === null || documentView === undefined || !(event.target instanceof documentView.Element)) {
      return;
    }
    const button = event.target.closest<HTMLButtonElement>("button[data-action]");
    if (button === null) return;
    const action = button.dataset.action;

    if (action === "tutorial-next") {
      if (this.tutorialPage < 2) this.tutorialPage += 1;
      else this.screen = "select";
      this.render();
      return;
    }
    if (action === "tutorial-skip") {
      this.screen = "select";
      this.render();
      return;
    }
    if (action === "difficulty") {
      const value = Number(button.dataset.difficulty);
      if (value === 1 || value === 2 || value === 3) this.difficulty = value;
      this.render();
      return;
    }
    if (action === "play" || action === "retry") {
      this.beginRound();
      return;
    }
    if (action === "pause") {
      this.pause();
      return;
    }
    if (action === "resume") {
      this.resume();
      return;
    }
    if (action === "quit") {
      this.abandonRun();
      return;
    }
    if (action === "done") {
      return;
    }
    if (action === "card") {
      this.flipCard(button.dataset.cardId ?? "");
    }
  }

  private beginRound(): void {
    const context = this.requireMounted();
    this.runId = context.lifecycle?.beginRun() ?? null;
    this.previousBest = context.lifecycle?.persistedBest ?? context.bestScore ?? this.highScore;
    this.highScore = this.previousBest;
    this.round = new MemoryMeadowRound(this.difficulty, context.rng);
    this.screen = "playing";
    this.finalResult = null;
    this.running = true;
    this.paused = false;
    this.finished = false;
    this.lastShownSecond = -1;
    this.toast = "Find the matching blooms!";
    this.toastSeconds = 1.25;
    this.render();
  }

  private flipCard(cardId: string): void {
    if (!this.running || this.round === null) return;
    const result = this.round.flip(cardId);
    if (!result.accepted) return;
    if (result.waitingForTrio) {
      this.toast = "A special trio needs one more!";
      this.toastSeconds = 1;
    } else if (result.match) {
      this.toast = result.completed ? "Meadow complete!" : "Bloom-tastic match!";
      this.toastSeconds = 0.9;
    } else {
      this.toast = "Almost — watch them closely!";
      this.toastSeconds = 0.8;
    }
    if (result.match) {
      this.context?.audio?.emit("combo", this.round.matchedGroups);
      this.context?.haptics?.impact("success");
    } else if (this.round.isBusy) {
      this.context?.audio?.emit("miss");
      this.context?.haptics?.impact("warning");
    } else {
      this.context?.audio?.emit("hit");
      this.context?.haptics?.impact("light");
    }
    if (result.shuffleReady) {
      this.round.beginDandelionShuffle();
      this.context?.audio?.emit("countdown");
      this.toast = "Dandelion breeze! Remember the new spots!";
      this.toastSeconds = 1.35;
    }
    this.render();
    if (result.completed) this.showResults();
  }

  private showResults(): void {
    if (this.round === null || this.screen === "results") return;
    this.running = false;
    this.paused = false;
    this.finalResult = this.round.result();
    this.screen = "results";
    this.settleTerminalResult();
    this.render();
  }

  private settleTerminalResult(): void {
    if (this.finished) return;
    this.finished = true;
    this.running = false;
    const context = this.context;
    if (context === null) return;
    if (context.lifecycle !== undefined && this.runId !== null) {
      const receipt = context.lifecycle.completeRun(this.runId, this.payout());
      this.highScore = receipt.bestScore;
      this.runId = null;
      return;
    }
    this.highScore = Math.max(this.highScore, this.finalResult?.score ?? 0);
    context.finish(this.payout());
  }

  private abandonRun(): void {
    this.running = false;
    this.context?.lifecycle?.exit();
    this.runId = null;
    this.round = null;
    this.finalResult = null;
    this.paused = false;
    this.finished = false;
    this.screen = "select";
    this.render();
  }

  private requireMounted(): MeadowContext {
    if (this.context === null) throw new Error("Memory Meadow must be mounted before use");
    return this.context;
  }

  private render(): void {
    if (this.shadow === null) return;
    const focusedCardId =
      this.shadow.activeElement instanceof HTMLElement
        ? this.shadow.activeElement.dataset.cardId
        : undefined;
    this.shadow.innerHTML = `<style>${MEMORY_MEADOW_STYLES}</style>${this.renderGame()}`;
    this.focusCurrentInteraction(focusedCardId);
  }

  private renderGame(): string {
    const round = this.round;
    const config = MEADOW_CONFIGS[this.difficulty];
    const time = round === null ? config.timeLimitSeconds : Math.ceil(round.remainingSeconds);
    const progress = round === null ? 0 : (round.matchedGroups / round.totalGroups) * 100;
    const board =
      round?.board
        .map(
          (card) => `
            <button class="card ${card.faceUp ? "is-up" : ""} ${card.matched ? "matched" : ""} ${card.kind}"
              data-action="card" data-card-id="${card.id}" aria-label="${card.faceUp ? card.symbol : "Hidden flower"}"
              ${card.matched || card.faceUp || round.isBusy || !this.running ? "disabled" : ""}>
              <span class="card-inner">
                <span class="face back"></span>
                <span class="face front">${card.symbol}</span>
              </span>
            </button>`,
        )
        .join("") ?? "";

    return `
      <main class="game">
        <div class="petals"></div>
        <header class="top">
          <button class="round-button" data-action="pause" aria-label="Pause game">Ⅱ</button>
          <div class="title"><small>Difficulty ${this.difficulty}</small><strong>Memory Meadow</strong></div>
          <button class="round-button" data-action="pause" aria-label="Game menu">☰</button>
        </header>
        <section class="stats" aria-label="Round stats">
          <div class="stat"><span>Time</span><b data-stat="time">${time}s</b></div>
          <div class="stat"><span>Moves</span><b data-stat="moves">${round?.moves ?? 0}</b></div>
          <div class="stat"><span>Blooms</span><b data-stat="matches">${round?.matchedGroups ?? 0}/${round?.totalGroups ?? config.pairGroups + config.trioGroups}</b></div>
        </section>
        <div class="progress"><i data-stat="progress" style="width:${progress}%"></i></div>
        <section class="board" style="grid-template-columns:repeat(${config.columns},1fr)" aria-label="Flower cards. Use arrow keys to move and Enter or Space to flip.">${board}</section>
        <div class="toast ${this.toastSeconds > 0 ? "show" : ""}" role="status">${this.toast}</div>
        <div class="shuffle" ${round?.isBusy === true && round.board.some(({ faceUp, matched }) => faceUp && !matched) ? "" : "hidden"}>
          <div class="dandelion">🌬️</div>
        </div>
        ${this.renderOverlay()}
      </main>`;
  }

  private renderOverlay(): string {
    if (this.screen === "tutorial") return this.renderTutorial();
    if (this.screen === "select") return this.renderDifficulty();
    if (this.screen === "results") return this.renderResults();
    if (this.paused) {
      return `
        <div class="overlay">
          <section class="panel" role="dialog" aria-label="Game paused">
            <div class="mascot">🌼</div><h2>Meadow paused</h2>
            <p>The flowers will stay exactly where they are.</p>
            <button class="primary" data-action="resume">Keep matching</button>
            <button class="secondary" data-action="quit">Quit without reward</button>
          </section>
        </div>`;
    }
    return "";
  }

  private renderTutorial(): string {
    const pages = [
      {
        icon: "🌻",
        title: "Welcome to the meadow",
        copy: "Turn over cards and remember each flower's hiding place.",
        tipIcon: "👆",
        tip: "Match pairs, and collect all three cards in each glowing trio.",
      },
      {
        icon: "🌬️",
        title: "Mind the breeze",
        copy: "Halfway through, a dandelion breeze reveals and shuffles every unmatched card.",
        tipIcon: "👀",
        tip: "Watch the visible flowers until the breeze settles.",
      },
      {
        icon: "✨",
        title: "Special meadow magic",
        copy: "Moonlit Meadow has glowing trios. Match all three, then earn stars with speed and few moves.",
        tipIcon: "⭐⭐⭐",
        tip: "Fast, careful rounds earn the biggest payout.",
      },
    ] as const;
    const page = pages[this.tutorialPage] ?? pages[0];
    return `
      <div class="overlay">
        <section class="panel">
          <div class="mascot">${page.icon}</div><h2>${page.title}</h2><p>${page.copy}</p>
          <div class="tip"><div class="tip-icon">${page.tipIcon}</div><div><b>Meadow tip</b><span>${page.tip}</span></div></div>
          <div class="dots">${pages.map((_, index) => `<i class="${index === this.tutorialPage ? "on" : ""}"></i>`).join("")}</div>
          <button class="primary" data-action="tutorial-next">${this.tutorialPage === 2 ? "Choose a meadow" : "Next tip"}</button>
          <button class="secondary" data-action="tutorial-skip">Skip tutorial</button>
        </section>
      </div>`;
  }

  private renderDifficulty(): string {
    return `
      <div class="overlay">
        <section class="panel">
          <div class="mascot">🐰🌸</div><h2>Choose your meadow</h2><p>Match flower pairs; Moonlit Meadow also asks you to find glowing trios.</p>
          <div class="difficulty">
            ${([1, 2, 3] as const)
              .map((level) => {
                const config = MEADOW_CONFIGS[level];
                return `<button data-action="difficulty" data-difficulty="${level}" class="${level === this.difficulty ? "selected" : ""}">
                  <em>${DIFFICULTY_ICONS[level]}</em><span><b>${DIFFICULTY_LABELS[level]}</b><small>${config.columns}×${config.rows} · ${config.timeLimitSeconds}s${level === 3 ? " · special trios" : ""}</small></span><strong>${"★".repeat(level)}</strong>
                </button>`;
              })
              .join("")}
          </div>
          <button class="primary" data-action="play">Start matching</button>
        </section>
      </div>`;
  }

  private renderResults(): string {
    const result = this.finalResult;
    if (result === null) return "";
    const isBest = this.round?.isComplete === true && result.score > this.previousBest;
    return `
      <div class="overlay">
        <section class="panel">
          <div class="mascot">${result.stars === 3 ? "🐰✨" : "🐰🌼"}</div>
          <h2>${this.round?.isComplete === true ? "Meadow in bloom!" : "Lovely remembering!"}</h2>
          <div class="stars">${"★".repeat(result.stars)}${"☆".repeat(3 - result.stars)}</div>
          <p>${result.moves} moves · ${Math.ceil(result.elapsedSeconds)} seconds</p>
          <div class="score">${result.score.toLocaleString()} pts</div>
          ${isBest ? `<div class="new-best">NEW HIGH SCORE</div>` : ""}
          <button class="primary" data-action="done">Collect ${this.payout().coins} coins</button>
          <button class="secondary" data-action="retry">Play again</button>
        </section>
      </div>`;
  }

  private updateHud(): void {
    if (this.round === null || this.shadow === null) return;
    const time = this.shadow.querySelector<HTMLElement>('[data-stat="time"]');
    const moves = this.shadow.querySelector<HTMLElement>('[data-stat="moves"]');
    const matches = this.shadow.querySelector<HTMLElement>('[data-stat="matches"]');
    const progress = this.shadow.querySelector<HTMLElement>('[data-stat="progress"]');
    if (time !== null) time.textContent = `${Math.ceil(this.round.remainingSeconds)}s`;
    if (moves !== null) moves.textContent = String(this.round.moves);
    if (matches !== null) matches.textContent = `${this.round.matchedGroups}/${this.round.totalGroups}`;
    if (progress !== null) progress.style.width = `${(this.round.matchedGroups / this.round.totalGroups) * 100}%`;
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (event.repeat || this.screen !== "playing") return;
    if (event.key === "Escape" || event.key.toLowerCase() === "p") {
      event.preventDefault();
      if (this.paused) this.resume();
      else this.pause();
      return;
    }
    if (this.paused || !event.key.startsWith("Arrow")) return;
    const cards = [...(this.shadow?.querySelectorAll<HTMLButtonElement>("[data-card-id]") ?? [])];
    const active = this.shadow?.activeElement;
    const currentIndex = active instanceof HTMLElement ? cards.indexOf(active as HTMLButtonElement) : -1;
    if (currentIndex < 0) return;
    const columns = MEADOW_CONFIGS[this.difficulty].columns;
    const step =
      event.key === "ArrowLeft"
        ? -1
        : event.key === "ArrowRight"
          ? 1
          : event.key === "ArrowUp"
            ? -columns
            : columns;
    const currentRow = Math.floor(currentIndex / columns);
    let nextIndex = currentIndex + step;
    let candidate = cards[nextIndex];
    while (
      candidate !== undefined
      && candidate.disabled
      && (Math.abs(step) === columns || Math.floor(nextIndex / columns) === currentRow)
    ) {
      nextIndex += step;
      candidate = cards[nextIndex];
    }
    if (
      candidate === undefined
      || candidate.disabled
      || (Math.abs(step) === 1 && Math.floor(nextIndex / columns) !== currentRow)
    ) {
      return;
    }
    event.preventDefault();
    candidate.focus();
  }

  private focusCurrentInteraction(cardId?: string): void {
    if (this.shadow === null) return;
    if (this.screen === "playing" && !this.paused) {
      const previous = cardId === undefined
        ? null
        : this.shadow.querySelector<HTMLButtonElement>(`[data-card-id="${cardId}"]`);
      const card =
        previous?.disabled === false
          ? previous
          : this.shadow.querySelector<HTMLButtonElement>("[data-card-id]:not(:disabled)");
      if (card !== null) card.focus();
      else this.root?.focus();
      return;
    }
    const action =
      this.paused
        ? "resume"
        : this.screen === "tutorial"
          ? "tutorial-next"
          : this.screen === "select"
            ? "play"
            : "done";
    this.shadow.querySelector<HTMLButtonElement>(`button[data-action="${action}"]`)?.focus();
  }
}

export function createMemoryMeadow(): MinigameModule {
  return new MemoryMeadow();
}
