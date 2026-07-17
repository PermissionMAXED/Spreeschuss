import type {
  MinigameContext,
  MinigameFactory,
  MinigameModule,
  MinigamePayout,
  MinigameRunId,
} from "../../core/contracts/minigame";
import type { HapticPattern } from "../../core/contracts/platform";
import type { MinigameStubDefinition } from "../stub";
import {
  beginGarden,
  createGardenState,
  finishGarden,
  pauseGarden,
  resumeGarden,
  tapGardenSlot,
  updateGarden,
  type GardenActor,
  type GardenDifficulty,
  type GardenState,
} from "./model";
import "./style.css";

const TITLE = "Garden Moles";
const INSTRUCTIONS = "Tap carrot-stealing moles, spare baby bunnies, and catch gold for a frenzy.";
type SharedAudioAction = "hit" | "miss" | "combo" | "countdown" | "go" | "win" | "lose" | "score";

type GardenContext = MinigameContext & {
  readonly audio?: { emit(action: SharedAudioAction, value?: number): void };
  readonly haptics?: { impact(pattern: HapticPattern): void };
  readonly reducedMotion?: boolean;
  readonly bestScore?: number;
};

const EMPTY_PAYOUT: MinigamePayout = { score: 0, coins: 0, xp: 0 };

const TUTORIAL = [
  {
    icon: "🥕",
    title: "Guard the patch",
    copy: "Tap the moles before they escape with Gooby’s carrots. Quick streaks are worth more!",
  },
  {
    icon: "🐰",
    title: "Friends, not foes",
    copy: "Baby bunnies only want to say hello. Spare them—three mistaken taps end the round.",
  },
  {
    icon: "✨",
    title: "Golden frenzy",
    copy: "Catch a golden mole for seven seconds of all-mole mayhem and double points.",
  },
] as const;

const DIFFICULTY_LABELS: Readonly<Record<GardenDifficulty, string>> = {
  gentle: "Gentle",
  bouncy: "Bouncy",
  rascal: "Rascal",
};

function actorPresentation(actor: GardenActor | undefined): {
  readonly glyph: string;
  readonly label: string;
  readonly className: string;
} {
  if (!actor) return { glyph: "", label: "Empty garden hole", className: "" };
  if (actor.revealAt > actor.age) {
    return { glyph: "⋯", label: "Rustling garden hole", className: " is-rustling" };
  }
  switch (actor.kind) {
    case "mole":
      return { glyph: "🐹", label: "Carrot-stealing mole", className: " has-mole" };
    case "bunny":
      return { glyph: "🐰", label: "Baby bunny—do not tap", className: " has-bunny" };
    case "golden":
      return { glyph: "★", label: "Golden mole", className: " has-golden" };
  }
}

export class GardenMolesMinigame implements MinigameModule {
  readonly id = "garden-moles";
  readonly title = TITLE;
  readonly instructions = INSTRUCTIONS;

  private context: GardenContext | null = null;
  private host: HTMLElement | null = null;
  private state: GardenState = createGardenState("gentle");
  private runId: MinigameRunId | null = null;
  private difficulty: GardenDifficulty = "gentle";
  private tutorialPage = 0;
  private bestScore = 0;
  private previousBest = 0;
  private actionsTaken = 0;
  private quitEarly = false;
  private resultVisible = false;
  private finished = false;
  private cleanup: Array<() => void> = [];

  mount(context: MinigameContext): void {
    this.dispose();
    this.context = context;
    this.bestScore = context.lifecycle?.persistedBest ?? this.context.bestScore ?? 0;
    this.previousBest = this.bestScore;
    this.finished = false;
    const host = context.mount.ownerDocument.createElement("section");
    host.className = "gm-game";
    host.classList.toggle("gm-reduced-motion", this.context.reducedMotion === true);
    host.setAttribute("aria-label", TITLE);
    host.setAttribute("tabindex", "-1");
    host.innerHTML = `
      <div class="gm-sky" aria-hidden="true"><span>☁</span><span>☁</span></div>
      <header class="gm-topbar">
        <div class="gm-stat gm-time"><small>TIME</small><strong data-gm="time">1:15</strong></div>
        <div class="gm-score"><small>SCORE</small><strong data-gm="score">0</strong><span data-gm="best">BEST 0</span></div>
        <button class="gm-icon-button" data-action="pause" aria-label="Pause game">Ⅱ</button>
      </header>
      <div class="gm-status-row">
        <span data-gm="hearts" aria-label="Three hearts">♥ ♥ ♥</span>
        <span data-gm="combo">READY</span>
      </div>
      <div class="gm-banner" data-gm="banner">Protect the carrot patch!</div>
      <div class="gm-patch" role="group" aria-label="Nine garden holes">
        ${Array.from({ length: 9 }, (_, slot) => `
          <button class="gm-hole" data-slot="${slot}" aria-label="Empty garden hole" aria-keyshortcuts="${slot + 1}">
            <span class="gm-dirt" aria-hidden="true"></span>
            <span class="gm-actor" aria-hidden="true"></span>
            <span class="gm-carrot" aria-hidden="true">♢</span>
          </button>
        `).join("")}
      </div>
      <footer class="gm-footer"><span>🥕 TAP OR KEYS 1–9</span><span data-gm="difficulty">GENTLE</span></footer>
      <div class="gm-frenzy" data-gm="frenzy" aria-hidden="true"></div>
      <div class="gm-overlay" data-gm="overlay"></div>
      <div class="gm-float-layer" data-gm="float-layer" aria-hidden="true"></div>
    `;
    context.mount.replaceChildren(host);
    this.host = host;
    this.listen(host, "click", this.onClick);
    this.listen(host, "keydown", this.onKeyDown);
    this.showTutorial();
    this.render();
  }

  start(): void {
    if (!this.host || this.state.phase === "playing") return;
    this.showTutorial();
  }

  pause(): void {
    pauseGarden(this.state);
    if (this.state.phase === "paused") this.showPause();
    this.render();
  }

  resume(): void {
    resumeGarden(this.state);
    this.hideOverlay();
    this.render();
  }

  update(deltaSeconds: number): void {
    const context = this.context;
    if (!context || this.finished) return;
    const wasFinished = this.state.phase === "finished";
    updateGarden(this.state, deltaSeconds, context.rng);
    if (!wasFinished && this.state.phase === "finished") this.completeRun();
    this.render();
  }

  payout(): MinigamePayout {
    if (this.state.phase !== "finished" || !this.resultVisible) return EMPTY_PAYOUT;
    const score = Math.max(0, Math.floor(this.state.score));
    return {
      score,
      coins: Math.min(80, Math.floor(score / 275)),
      xp: Math.min(180, Math.floor(score / 120) + this.state.bestCombo * 2),
    };
  }

  dispose(): void {
    this.context?.lifecycle?.exit();
    for (const remove of this.cleanup.splice(0)) remove();
    this.host?.remove();
    this.host = null;
    this.context = null;
    this.runId = null;
    this.finished = true;
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

  private readonly onClick = (event: MouseEvent): void => {
    const target = event.target;
    const elementType = this.host?.ownerDocument.defaultView?.Element;
    if (!elementType || !(target instanceof elementType) || !this.host) return;
    const actionElement = target.closest<HTMLElement>("[data-action]");
    if (actionElement) {
      this.handleAction(actionElement.dataset.action ?? "");
      return;
    }
    const hole = target.closest<HTMLElement>("[data-slot]");
    if (!hole || this.state.phase !== "playing") return;
    this.hitSlot(Number(hole.dataset.slot), hole);
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    const key = event.key.toLowerCase();
    if (event.repeat) return;
    if (key === "p" || event.key === "Escape") {
      if (this.state.phase !== "playing" && this.state.phase !== "paused") return;
      event.preventDefault();
      if (this.state.phase === "paused") this.resume();
      else this.pause();
      return;
    }
    if (this.state.phase !== "playing" || !/^[1-9]$/.test(key)) return;
    event.preventDefault();
    const slot = Number(key) - 1;
    const hole = this.host?.querySelector<HTMLElement>(`[data-slot="${slot}"]`) ?? null;
    if (hole !== null) this.hitSlot(slot, hole);
  };

  private hitSlot(slot: number, hole: HTMLElement): void {
    this.actionsTaken += 1;
    const scoreBefore = this.state.score;
    const result = tapGardenSlot(this.state, slot);
    const gained = this.state.score - scoreBefore;
    hole.classList.remove("is-hit", "is-oops");
    void hole.offsetWidth;
    hole.classList.add(result === "bunny" ? "is-oops" : "is-hit");
    if (gained > 0 && this.context?.reducedMotion !== true) this.floatScore(hole, `+${gained}`);
    if (result === "mole") {
      this.context?.audio?.emit(
        this.state.combo > 0 && this.state.combo % 5 === 0 ? "combo" : "hit",
        this.state.combo,
      );
      this.context?.haptics?.impact(this.state.combo % 5 === 0 ? "success" : "light");
    } else if (result === "golden") {
      this.context?.audio?.emit("combo", this.state.combo);
      this.context?.haptics?.impact("success");
    } else {
      this.context?.audio?.emit("miss");
      this.context?.haptics?.impact(result === "bunny" ? "warning" : "light");
    }
    if (this.state.hearts <= 0) this.completeRun();
    this.render();
  }

  private handleAction(action: string): void {
    switch (action) {
      case "tutorial-next":
        if (this.tutorialPage < TUTORIAL.length - 1) {
          this.tutorialPage += 1;
          this.showTutorial();
        } else {
          this.showDifficulty();
        }
        break;
      case "tutorial-back":
        this.tutorialPage = Math.max(0, this.tutorialPage - 1);
        this.showTutorial();
        break;
      case "difficulty":
        this.showDifficulty();
        break;
      case "choose-gentle":
      case "choose-bouncy":
      case "choose-rascal":
        this.difficulty = action.replace("choose-", "") as GardenDifficulty;
        this.startRound();
        break;
      case "pause":
        this.pause();
        break;
      case "resume":
        this.resume();
        break;
      case "restart":
        this.startRound();
        break;
      case "quit":
        if (this.actionsTaken === 0) {
          this.abandonRun();
        } else {
          this.quitEarly = true;
          finishGarden(this.state, "Garden run wrapped up.");
          this.completeRun();
        }
        break;
      case "collect":
        this.showDifficulty();
        break;
      default:
        break;
    }
  }

  private showTutorial(): void {
    const overlay = this.query("[data-gm='overlay']");
    if (!overlay) return;
    const page = TUTORIAL[this.tutorialPage] ?? TUTORIAL[0];
    overlay.classList.add("is-visible");
    overlay.innerHTML = `
      <div class="gm-card gm-tutorial-card">
        <span class="gm-kicker">HOW TO PLAY · ${this.tutorialPage + 1}/${TUTORIAL.length}</span>
        <div class="gm-tutorial-icon" aria-hidden="true">${page.icon}</div>
        <h2>${page.title}</h2>
        <p>${page.copy}</p>
        <div class="gm-dots">${TUTORIAL.map((_, index) => `<i class="${index === this.tutorialPage ? "active" : ""}"></i>`).join("")}</div>
        <div class="gm-card-actions">
          ${this.tutorialPage > 0 ? '<button class="gm-secondary" data-action="tutorial-back">Back</button>' : ""}
          <button class="gm-primary" data-action="tutorial-next">${this.tutorialPage === TUTORIAL.length - 1 ? "Choose pace" : "Next"}</button>
        </div>
      </div>
    `;
    overlay.querySelector<HTMLButtonElement>('[data-action="tutorial-next"]')?.focus();
  }

  private showDifficulty(): void {
    const overlay = this.query("[data-gm='overlay']");
    if (!overlay) return;
    overlay.classList.add("is-visible");
    overlay.innerHTML = `
      <div class="gm-card">
        <span class="gm-kicker">CHOOSE YOUR PACE</span>
        <h2>How lively is the garden?</h2>
        <div class="gm-difficulty-list">
          <button data-action="choose-gentle"><b>🌱 Gentle</b><small>Long peeks · fewer fake-outs</small></button>
          <button data-action="choose-bouncy"><b>🐾 Bouncy</b><small>Quicker visitors · bigger scores</small></button>
          <button data-action="choose-rascal"><b>⚡ Rascal</b><small>Fast burrows · sneaky switches</small></button>
        </div>
      </div>
    `;
    overlay.querySelector<HTMLButtonElement>('[data-action="choose-gentle"]')?.focus();
  }

  private showPause(): void {
    const overlay = this.query("[data-gm='overlay']");
    if (!overlay) return;
    overlay.classList.add("is-visible");
    overlay.innerHTML = `
      <div class="gm-card">
        <span class="gm-kicker">GARDEN PAUSED</span>
        <div class="gm-pause-icon">☕</div>
        <h2>Take a cozy breather</h2>
        <p>The moles will wait right where they are.</p>
        <button class="gm-primary gm-wide" data-action="resume">Keep gardening</button>
        <button class="gm-secondary gm-wide" data-action="restart">Restart round</button>
        <button class="gm-text-button" data-action="quit">${this.actionsTaken === 0 ? "Quit without reward" : "Finish &amp; collect"}</button>
      </div>
    `;
    overlay.querySelector<HTMLButtonElement>('[data-action="resume"]')?.focus();
  }

  private completeRun(): void {
    if (this.resultVisible) return;
    this.resultVisible = true;
    const payout = this.payout();
    const context = this.context;
    if (context?.lifecycle !== undefined && this.runId !== null) {
      const receipt = context.lifecycle.completeRun(this.runId, payout);
      this.bestScore = receipt.bestScore;
      this.runId = null;
    } else {
      this.bestScore = Math.max(this.bestScore, this.state.score);
      context?.finish(payout);
    }
    this.finished = true;
    const overlay = this.query("[data-gm='overlay']");
    if (!overlay) return;
    overlay.classList.add("is-visible");
    overlay.innerHTML = `
      <div class="gm-card gm-result-card">
        <span class="gm-kicker">${this.quitEarly ? "GARDEN WRAPPED UP" : this.state.hearts > 0 ? "HARVEST SAVED!" : "BUNNY BREAK"}</span>
        <div class="gm-result-badge">🥕</div>
        <h2>${payout.score.toLocaleString()}</h2>
        <p>Best streak <b>${this.state.bestCombo}×</b> · Best score <b>${this.bestScore.toLocaleString()}</b></p>
        ${this.state.score > this.previousBest ? '<div class="gm-new-best">NEW HIGH SCORE</div>' : ""}
        <div class="gm-rewards"><span>🪙 ${payout.coins}</span><span>★ ${payout.xp} XP</span></div>
        <button class="gm-primary gm-wide" data-action="collect">Collect rewards</button>
        <button class="gm-secondary gm-wide" data-action="restart">Play again</button>
      </div>
    `;
    overlay.querySelector<HTMLButtonElement>('[data-action="restart"]')?.focus();
  }

  private hideOverlay(): void {
    const overlay = this.query("[data-gm='overlay']");
    overlay?.classList.remove("is-visible");
    if (overlay) overlay.replaceChildren();
  }

  private startRound(): void {
    const context = this.context;
    if (context === null) return;
    this.runId = context.lifecycle?.beginRun() ?? null;
    this.previousBest = context.lifecycle?.persistedBest ?? context.bestScore ?? this.bestScore;
    this.bestScore = this.previousBest;
    this.state = createGardenState(this.difficulty);
    this.resultVisible = false;
    this.finished = false;
    this.actionsTaken = 0;
    this.quitEarly = false;
    beginGarden(this.state);
    this.hideOverlay();
    this.render();
    this.host?.querySelector<HTMLButtonElement>("[data-slot]")?.focus();
  }

  private abandonRun(): void {
    this.context?.lifecycle?.exit();
    this.runId = null;
    this.finished = false;
    this.resultVisible = false;
    this.actionsTaken = 0;
    this.quitEarly = false;
    this.state = createGardenState(this.difficulty);
    this.showDifficulty();
    this.render();
  }

  private floatScore(hole: HTMLElement, text: string): void {
    const layer = this.query("[data-gm='float-layer']");
    if (!layer) return;
    const layerRect = layer.getBoundingClientRect();
    const holeRect = hole.getBoundingClientRect();
    const item = layer.ownerDocument.createElement("span");
    item.className = "gm-floating-score";
    item.textContent = text;
    item.style.left = `${holeRect.left - layerRect.left + holeRect.width / 2}px`;
    item.style.top = `${holeRect.top - layerRect.top + holeRect.height / 3}px`;
    layer.append(item);
    item.addEventListener("animationend", () => item.remove(), { once: true });
  }

  private render(): void {
    const host = this.host;
    if (!host) return;
    const seconds = Math.ceil(this.state.remaining);
    this.setText("[data-gm='time']", `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`);
    this.setText("[data-gm='score']", Math.floor(this.state.score).toLocaleString());
    this.setText(
      "[data-gm='best']",
      `BEST ${Math.floor(Math.max(this.bestScore, this.state.score)).toLocaleString()}`,
    );
    this.setText("[data-gm='hearts']", Array.from({ length: 3 }, (_, index) => index < this.state.hearts ? "♥" : "♡").join(" "));
    this.setText(
      "[data-gm='combo']",
      this.state.frenzyRemaining > 0
        ? `FRENZY ${this.state.frenzyRemaining.toFixed(1)}s`
        : this.state.combo > 1
          ? `${this.state.combo}× STREAK`
          : "CARROT WATCH",
    );
    this.setText("[data-gm='banner']", this.state.message);
    this.setText("[data-gm='difficulty']", DIFFICULTY_LABELS[this.difficulty].toUpperCase());
    host.classList.toggle("is-frenzy", this.state.frenzyRemaining > 0);
    host.classList.toggle("is-paused", this.state.phase === "paused");

    const holes = host.querySelectorAll<HTMLElement>("[data-slot]");
    for (const hole of holes) {
      const slot = Number(hole.dataset.slot);
      const actor = this.state.actors.find((candidate) => candidate.slot === slot);
      const presentation = actorPresentation(actor);
      hole.className = `gm-hole${presentation.className}`;
      hole.setAttribute("aria-label", presentation.label);
      const glyph = hole.querySelector<HTMLElement>(".gm-actor");
      if (glyph) glyph.textContent = presentation.glyph;
    }
  }

  private query(selector: string): HTMLElement | null {
    return this.host?.querySelector<HTMLElement>(selector) ?? null;
  }

  private setText(selector: string, value: string): void {
    const element = this.query(selector);
    if (element && element.textContent !== value) element.textContent = value;
  }
}

export const createMinigame: MinigameFactory = () => new GardenMolesMinigame();

export const definition = {
  id: "garden-moles",
  title: TITLE,
  instructions: INSTRUCTIONS,
} as const satisfies MinigameStubDefinition;
