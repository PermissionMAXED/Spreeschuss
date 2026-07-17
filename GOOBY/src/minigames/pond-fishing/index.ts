import type {
  MinigameContext,
  MinigameModule,
  MinigamePayout,
  MinigameRunId,
} from "../../core/contracts/minigame";
import type { HapticPattern } from "../../core/contracts/platform";
import type { MinigameStubDefinition } from "../stub";
import {
  FISH_SPECIES,
  PondFishingRound,
  type FishingDifficulty,
  type PondPhase,
} from "./model";
import { POND_FISHING_STYLES } from "./styles";

export const definition = {
  id: "pond-fishing",
  title: "Pond Fishing",
  instructions: "Cast to a shadow, hook the bite, and balance line tension.",
} as const satisfies MinigameStubDefinition;

type FishingScreen = "tutorial" | "select" | "playing" | "results";
type SharedAudioAction = "hit" | "miss" | "combo" | "countdown" | "go" | "win" | "lose" | "score";

type FishingContext = MinigameContext & {
  readonly audio?: { emit(action: SharedAudioAction, value?: number): void };
  readonly haptics?: { impact(pattern: HapticPattern): void };
  readonly reducedMotion?: boolean;
  readonly bestScore?: number;
};

const EMPTY_PAYOUT: MinigamePayout = { score: 0, coins: 0, xp: 0 };

const DIFFICULTY_COPY: Readonly<
  Record<FishingDifficulty, { readonly icon: string; readonly title: string; readonly copy: string }>
> = {
  relaxed: { icon: "🌤️", title: "Lazy Lilypad", copy: "Gentle fish · wide green band" },
  ripple: { icon: "🌊", title: "Ripple Run", copy: "Mixed rarities · lively surges" },
  legend: { icon: "✨", title: "Koi Quest", copy: "Big fish · strongest golden-koi odds" },
};

export class PondFishing implements MinigameModule {
  readonly id = definition.id;
  readonly title = definition.title;
  readonly instructions = definition.instructions;

  private context: FishingContext | null = null;
  private root: HTMLElement | null = null;
  private shadow: ShadowRoot | null = null;
  private round: PondFishingRound | null = null;
  private runId: MinigameRunId | null = null;
  private screen: FishingScreen = "tutorial";
  private difficulty: FishingDifficulty = "relaxed";
  private tutorialPage = 0;
  private running = false;
  private paused = false;
  private finished = false;
  private dragging = false;
  private dragPointer = -1;
  private dragCapture: HTMLElement | null = null;
  private castX = 0.5;
  private castY = 0.55;
  private lastPhase: PondPhase = "aiming";
  private lastShownSecond = -1;
  private highScore = 0;
  private previousBest = 0;
  private actionsTaken = 0;
  private completedRound = false;
  private finalScore = 0;
  private finalWeight = 0;
  private finalCatchCount = 0;

  private readonly handleClick = (event: Event): void => {
    this.onClick(event);
  };
  private readonly handlePointerDown = (event: Event): void => {
    this.onPointerDown(event as PointerEvent);
  };
  private readonly handlePointerMove = (event: Event): void => {
    this.onPointerMove(event as PointerEvent);
  };
  private readonly handlePointerUp = (event: Event): void => {
    this.onPointerUp(event as PointerEvent);
  };
  private readonly handleKeyDown = (event: Event): void => {
    this.onKeyDown(event as KeyboardEvent);
  };
  private readonly handleKeyUp = (event: Event): void => {
    this.onKeyUp(event as KeyboardEvent);
  };

  mount(context: MinigameContext): void {
    this.dispose();
    this.context = context;
    this.highScore = context.lifecycle?.persistedBest
      ?? this.context.bestScore
      ?? 0;
    this.previousBest = this.highScore;
    const root = context.mount.ownerDocument.createElement("section");
    root.setAttribute("aria-label", "Pond Fishing");
    root.setAttribute("tabindex", "-1");
    root.dataset.reducedMotion = String(this.context.reducedMotion === true);
    root.dataset.minigame = this.id;
    this.root = root;
    this.shadow = root.attachShadow({ mode: "open" });
    this.shadow.addEventListener("click", this.handleClick);
    this.shadow.addEventListener("pointerdown", this.handlePointerDown);
    this.shadow.addEventListener("pointermove", this.handlePointerMove);
    this.shadow.addEventListener("pointerup", this.handlePointerUp);
    this.shadow.addEventListener("pointercancel", this.handlePointerUp);
    root.addEventListener("keydown", this.handleKeyDown);
    root.addEventListener("keyup", this.handleKeyUp);
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
    if (this.screen !== "playing") return;
    this.running = false;
    this.paused = true;
    this.round?.setReeling(false);
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
    const previousPhase = this.round.phase;
    this.round.update(deltaSeconds);
    const phase = this.round.phase;
    if (phase !== previousPhase) this.announcePhase(previousPhase, phase);
    if (phase === "ended") {
      this.showResults(true);
      return;
    }
    if (phase !== this.lastPhase) {
      this.lastPhase = phase;
      this.render();
      return;
    }
    if (phase === "fighting") this.updateTension();
    const shownSecond = Math.ceil(this.round.remainingSeconds);
    if (shownSecond !== this.lastShownSecond) {
      this.lastShownSecond = shownSecond;
      this.updateStats();
    }
  }

  payout(): MinigamePayout {
    if (this.screen !== "results") return EMPTY_PAYOUT;
    const score = this.finalScore;
    const catchCount = this.finalCatchCount;
    const legendaryBonus =
      this.round?.catches.filter(({ species }) => species.rarity === "legendary").length ?? 0;
    return {
      score,
      coins: catchCount * 3 + Math.floor(score / 400) + legendaryBonus * 12,
      xp: Math.max(0, Math.floor(score / 65)),
    };
  }

  dispose(): void {
    this.context?.lifecycle?.exit();
    this.shadow?.removeEventListener("click", this.handleClick);
    this.shadow?.removeEventListener("pointerdown", this.handlePointerDown);
    this.shadow?.removeEventListener("pointermove", this.handlePointerMove);
    this.shadow?.removeEventListener("pointerup", this.handlePointerUp);
    this.shadow?.removeEventListener("pointercancel", this.handlePointerUp);
    this.root?.removeEventListener("keydown", this.handleKeyDown);
    this.root?.removeEventListener("keyup", this.handleKeyUp);
    this.root?.remove();
    this.context = null;
    this.root = null;
    this.shadow = null;
    this.round = null;
    this.runId = null;
    this.running = false;
    this.paused = false;
    this.dragging = false;
    this.dragPointer = -1;
    this.dragCapture = null;
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
      const difficulty = button.dataset.difficulty;
      if (difficulty === "relaxed" || difficulty === "ripple" || difficulty === "legend") {
        this.difficulty = difficulty;
      }
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
      if (this.actionsTaken === 0) this.abandonRun();
      else this.showResults(false);
      return;
    }
    if (action === "shadow") {
      this.castAtShadow(button.dataset.shadowId ?? "");
      return;
    }
    if (action === "hook") {
      this.hookFish();
    }
  }

  private onPointerDown(event: PointerEvent): void {
    if (!this.running || this.round === null) return;
    const documentView = this.root?.ownerDocument.defaultView;
    if (documentView === null || documentView === undefined || !(event.target instanceof documentView.Element)) {
      return;
    }
    if (event.target.closest('[data-action="reel"]') !== null) {
      this.round.setReeling(true);
      event.target.closest<HTMLElement>('[data-action="reel"]')?.classList.add("held");
      this.context?.audio?.emit("hit");
      return;
    }
    if (this.round.phase === "bite") {
      this.hookFish();
      return;
    }
    if (this.round.phase !== "aiming") return;
    this.dragging = true;
    this.dragPointer = event.pointerId;
    if (event.target instanceof documentView.HTMLElement) {
      this.dragCapture = event.target;
      this.dragCapture.setPointerCapture(event.pointerId);
    }
    this.updateDragVisual(event);
  }

  private onPointerMove(event: PointerEvent): void {
    if (!this.dragging || event.pointerId !== this.dragPointer) return;
    this.updateDragVisual(event);
  }

  private onPointerUp(event: PointerEvent): void {
    if (this.round?.phase === "fighting") {
      this.round.setReeling(false);
      this.shadow?.querySelector('[data-action="reel"]')?.classList.remove("held");
    }
    if (!this.dragging || event.pointerId !== this.dragPointer || this.round === null) return;
    this.updateDragVisual(event);
    this.dragging = false;
    this.dragPointer = -1;
    if (this.dragCapture?.hasPointerCapture(event.pointerId) === true) {
      this.dragCapture.releasePointerCapture(event.pointerId);
    }
    this.dragCapture = null;
    this.actionsTaken += 1;
    const previousPhase = this.round.phase;
    this.round.castAt(this.castX, this.castY);
    this.announcePhase(previousPhase, this.round.phase);
    this.lastPhase = this.round.phase;
    this.render();
  }

  private updateDragVisual(event: PointerEvent): void {
    const pond = this.shadow?.querySelector<HTMLElement>(".pond");
    if (pond === null || pond === undefined) return;
    const bounds = pond.getBoundingClientRect();
    this.castX = Math.max(0.02, Math.min(0.98, (event.clientX - bounds.left) / bounds.width));
    this.castY = Math.max(0.03, Math.min(0.82, (event.clientY - bounds.top) / bounds.height));
    const bobber = this.shadow?.querySelector<HTMLElement>(".bobber");
    if (bobber !== null && bobber !== undefined) {
      bobber.hidden = false;
      bobber.style.setProperty("--cast-x", `${this.castX * 100}%`);
      bobber.style.setProperty("--cast-y", `${this.castY * 100}%`);
    }
  }

  private beginRound(): void {
    const context = this.requireMounted();
    this.runId = context.lifecycle?.beginRun() ?? null;
    this.previousBest = context.lifecycle?.persistedBest ?? context.bestScore ?? this.highScore;
    this.highScore = this.previousBest;
    this.round = new PondFishingRound(this.difficulty, context.rng);
    this.screen = "playing";
    this.running = true;
    this.paused = false;
    this.finished = false;
    this.castX = 0.5;
    this.castY = 0.55;
    this.lastPhase = this.round.phase;
    this.lastShownSecond = -1;
    this.actionsTaken = 0;
    this.completedRound = false;
    this.render();
  }

  private showResults(completedRound: boolean): void {
    if (this.round === null || this.screen === "results") return;
    this.running = false;
    this.completedRound = completedRound;
    this.finalScore = this.round.score;
    this.finalWeight = this.round.totalWeightKg;
    this.finalCatchCount = this.round.catches.length;
    this.screen = "results";
    this.settleTerminalResult();
    this.render();
  }

  private settleTerminalResult(): void {
    if (this.finished) return;
    this.finished = true;
    this.running = false;
    this.round?.setReeling(false);
    const context = this.context;
    if (context === null) return;
    if (context.lifecycle !== undefined && this.runId !== null) {
      const receipt = context.lifecycle.completeRun(this.runId, this.payout());
      this.highScore = receipt.bestScore;
      this.runId = null;
      return;
    }
    this.highScore = Math.max(this.highScore, this.finalScore);
    context.finish(this.payout());
  }

  private abandonRun(): void {
    this.running = false;
    this.round?.setReeling(false);
    this.context?.lifecycle?.exit();
    this.runId = null;
    this.round = null;
    this.paused = false;
    this.finished = false;
    this.screen = "select";
    this.render();
  }

  private requireMounted(): FishingContext {
    if (this.context === null) throw new Error("Pond Fishing must be mounted before use");
    return this.context;
  }

  private render(): void {
    if (this.shadow === null) return;
    this.shadow.innerHTML = `<style>${POND_FISHING_STYLES}</style>${this.renderGame()}`;
    this.focusCurrentInteraction();
  }

  private renderGame(): string {
    const round = this.round;
    const phase = round?.phase ?? "aiming";
    const activeShadow = round?.activeTarget;
    if (activeShadow !== null && activeShadow !== undefined) {
      this.castX = activeShadow.x;
      this.castY = activeShadow.y;
    }
    const caught = round?.catches.at(-1);
    const fight = round?.fight;
    const green = fight?.greenBand ?? [0.4, 0.64];
    const prompt = this.phasePrompt(phase);
    return `
      <main class="game ${phase}">
        <div class="sky"></div>
        <header class="top">
          <button class="round-button" data-action="pause" aria-label="Pause game">Ⅱ</button>
          <div class="title"><small>90-second pond</small><strong>Pond Fishing</strong></div>
          <button class="round-button" data-action="pause" aria-label="Game menu">☰</button>
        </header>
        <section class="stats">
          <div class="stat"><span>Time</span><b data-stat="time">${Math.ceil(round?.remainingSeconds ?? 90)}s</b></div>
          <div class="stat"><span>Catch</span><b data-stat="catch">${round?.catches.length ?? 0}</b></div>
          <div class="stat"><span>Weight</span><b data-stat="weight">${(round?.totalWeightKg ?? 0).toFixed(2)} kg</b></div>
        </section>
        <section class="pond" aria-label="Fishing pond">
          <div class="lily one"></div><div class="lily two"></div>
          ${(round?.shadows ?? [])
            .map(
              (shadow, index) =>
                `<button class="shadow" data-action="shadow" data-shadow-id="${shadow.id}" aria-label="Cast at fish shadow ${index + 1}" aria-keyshortcuts="${index + 1}" style="left:${shadow.x * 100}%;top:${shadow.y * 100}%;--angle:${Math.round(shadow.phase * 18)}deg;transform:translate(-50%,-50%) scale(${shadow.size})"></button>`,
            )
            .join("")}
          <div class="cast-line" ${phase === "aiming" && !this.dragging ? "hidden" : ""}></div>
          <div class="bobber" style="--cast-x:${this.castX * 100}%;--cast-y:${this.castY * 100}%" ${phase === "aiming" && !this.dragging ? "hidden" : ""}></div>
        </section>
        ${phase === "bite"
          ? `<button class="prompt bite" data-action="hook" aria-keyshortcuts="Enter Space">${prompt}</button>`
          : `<div class="prompt">${prompt}</div>`}
        <div class="gooby ${phase === "fighting" ? "fight" : ""}"><span>🎣</span></div>
        <section class="tension-wrap" ${phase === "fighting" ? "" : "hidden"}>
          <div class="tension-copy"><span>LINE TENSION</span><span>${fight === null || fight === undefined ? 0 : Math.round(fight.progress * 100)}% REELED</span></div>
          <div class="meter">
            <i class="green" style="--green-start:${green[0] * 100}%;--green-width:${(green[1] - green[0]) * 100}%"></i>
            <i class="needle" style="--tension:${(fight?.tension ?? 0.44) * 100}%"></i>
          </div>
          <button class="reel" data-action="reel" aria-keyshortcuts="Space R">HOLD TO REEL · RELEASE TO EASE (SPACE / R)</button>
        </section>
        <div class="catch-card" ${phase === "caught" && caught !== undefined ? "" : "hidden"}>
          <div class="fish">${caught?.species.icon ?? "🐟"}</div><b>${caught?.species.name ?? ""}</b>
          <small>${caught?.species.rarity.toUpperCase() ?? ""} · ${caught?.weightKg.toFixed(2) ?? "0"} kg · +${caught?.score ?? 0} pts</small>
        </div>
        ${this.renderOverlay()}
      </main>`;
  }

  private phasePrompt(phase: PondPhase): string {
    if (phase === "aiming") return "Drag from Gooby and release over a fish shadow";
    if (phase === "waiting") return "Shhh… watch the bobber";
    if (phase === "bite") return "BITE! TAP THE POND TO HOOK!";
    if (phase === "fighting") return "Keep the needle inside the green band";
    if (phase === "caught") return "A beautiful catch!";
    if (phase === "escaped") return "Splash! Cast again";
    return "Time at the pond is up";
  }

  private onKeyDown(event: KeyboardEvent): void {
    const key = event.key.toLowerCase();
    if (event.repeat) return;
    if (this.screen === "playing" && (key === "p" || event.key === "Escape")) {
      event.preventDefault();
      if (this.paused) this.resume();
      else this.pause();
      return;
    }
    if (!this.running || this.round === null) return;
    if (this.round.phase === "aiming" && /^[1-5]$/.test(key)) {
      event.preventDefault();
      const shadow = this.round.shadows[Number(key) - 1];
      if (shadow !== undefined) this.castAtShadow(shadow.id);
      return;
    }
    if (this.round.phase === "bite" && (key === "enter" || key === " ")) {
      event.preventDefault();
      this.hookFish();
      return;
    }
    if (this.round.phase === "fighting" && (key === "r" || key === " " || key === "enter")) {
      event.preventDefault();
      this.round.setReeling(true);
      this.shadow?.querySelector('[data-action="reel"]')?.classList.add("held");
    }
  }

  private onKeyUp(event: KeyboardEvent): void {
    const key = event.key.toLowerCase();
    if (
      this.round?.phase !== "fighting"
      || (key !== "r" && key !== " " && key !== "enter")
    ) {
      return;
    }
    event.preventDefault();
    this.round.setReeling(false);
    this.shadow?.querySelector('[data-action="reel"]')?.classList.remove("held");
  }

  private castAtShadow(shadowId: string): void {
    if (!this.running || this.round?.phase !== "aiming") return;
    const shadow = this.round.shadows.find(({ id }) => id === shadowId);
    if (shadow === undefined) return;
    this.actionsTaken += 1;
    const previousPhase = this.round.phase;
    this.round.castAt(shadow.x, shadow.y);
    this.announcePhase(previousPhase, this.round.phase);
    this.lastPhase = this.round.phase;
    this.render();
  }

  private hookFish(): void {
    if (!this.running || this.round === null) return;
    const previousPhase = this.round.phase;
    if (!this.round.hook()) return;
    this.announcePhase(previousPhase, this.round.phase);
    this.lastPhase = this.round.phase;
    this.render();
  }

  private announcePhase(previous: PondPhase, next: PondPhase): void {
    if (previous === next) return;
    if (next === "waiting") {
      this.context?.audio?.emit("hit");
      this.context?.haptics?.impact("light");
    } else if (next === "bite") {
      this.context?.audio?.emit("countdown");
      this.context?.haptics?.impact("medium");
    } else if (next === "fighting") {
      this.context?.audio?.emit("hit");
      this.context?.haptics?.impact("medium");
    } else if (next === "caught") {
      this.context?.audio?.emit("combo", this.round?.catches.length ?? 1);
      this.context?.haptics?.impact("success");
    } else if (next === "escaped") {
      this.context?.audio?.emit("miss");
      this.context?.haptics?.impact("warning");
    }
  }

  private renderOverlay(): string {
    if (this.screen === "tutorial") return this.renderTutorial();
    if (this.screen === "select") return this.renderDifficulty();
    if (this.screen === "results") return this.renderResults();
    if (this.paused) {
      return `
        <div class="overlay"><section class="panel" role="dialog" aria-label="Game paused">
          <div class="mascot">🎣</div><h2>Pond paused</h2><p>No fish will escape while you take a breather.</p>
          <button class="primary" data-action="resume">Back to the pond</button>
          <button class="secondary" data-action="quit">${this.actionsTaken === 0 ? "Quit without reward" : "Finish &amp; collect"}</button>
        </section></div>`;
    }
    return "";
  }

  private renderTutorial(): string {
    const pages = [
      { icon: "🎣", title: "Cast with care", copy: "Drag to a shadow, or Tab to one and press Enter. Number keys 1–5 cast directly.", tip: "Longer fish shadows often hide heavier catches." },
      { icon: "❗", title: "Wait for the bite", copy: "The bobber will plunge and glow. Tap it or press Enter quickly to set the hook.", tip: "Tapping early scares the fish — patience wins." },
      { icon: "🟢", title: "Balance the tension", copy: "Hold Reel, Space, or R to pull; release to ease. Keep the needle in green.", tip: "Every species has its own surge rhythm." },
    ] as const;
    const page = pages[this.tutorialPage] ?? pages[0];
    return `
      <div class="overlay"><section class="panel">
        <div class="mascot">${page.icon}</div><h2>${page.title}</h2><p>${page.copy}</p>
        <div class="tip"><em>🐰</em><div><b>Gooby's pond tip</b><span>${page.tip}</span></div></div>
        <div class="dots">${pages.map((_, index) => `<i class="${index === this.tutorialPage ? "on" : ""}"></i>`).join("")}</div>
        <button class="primary" data-action="tutorial-next">${this.tutorialPage === 2 ? "Choose a pond" : "Next tip"}</button>
        <button class="secondary" data-action="tutorial-skip">Skip tutorial</button>
      </section></div>`;
  }

  private renderDifficulty(): string {
    return `
      <div class="overlay"><section class="panel">
        <div class="mascot">🐰🎣</div><h2>Pick a fishing spot</h2><p>All ponds last 90 seconds. Braver waters hide rarer fish.</p>
        <div class="difficulty">
          ${(["relaxed", "ripple", "legend"] as const)
            .map((difficulty, index) => {
              const copy = DIFFICULTY_COPY[difficulty];
              return `<button data-action="difficulty" data-difficulty="${difficulty}" class="${difficulty === this.difficulty ? "selected" : ""}">
                <em>${copy.icon}</em><span><b>${copy.title}</b><small>${copy.copy}</small></span><strong>${"★".repeat(index + 1)}</strong>
              </button>`;
            })
            .join("")}
        </div>
        <button class="primary" data-action="play">Cast a line</button>
      </section></div>`;
  }

  private renderResults(): string {
    const isBest = this.finalScore > this.previousBest;
    const rarest = this.round?.catches.reduce(
      (best, caught) =>
        FISH_SPECIES.indexOf(caught.species) > FISH_SPECIES.indexOf(best.species) ? caught : best,
      this.round.catches[0] ?? {
        species: FISH_SPECIES[0] as (typeof FISH_SPECIES)[number],
        weightKg: 0,
        score: 0,
      },
    );
    return `
      <div class="overlay"><section class="panel">
        <div class="mascot">${rarest?.species.icon ?? "🐟"}✨</div><h2>${this.completedRound ? "Fishing basket" : "Line reeled in"}</h2>
        <p>${this.finalCatchCount} fish caught${rarest === undefined ? "" : ` · best: ${rarest.species.name}`}</p>
        <div class="result-weight">${this.finalWeight.toFixed(2)} kg</div>
        <div class="result-score">${this.finalScore.toLocaleString()} weight points</div>
        ${isBest ? `<div class="new-best">NEW HIGH SCORE</div>` : ""}
        <button class="primary" data-action="done">Collect ${this.payout().coins} coins</button>
        <button class="secondary" data-action="retry">Fish again</button>
      </section></div>`;
  }

  private updateStats(): void {
    if (this.shadow === null || this.round === null) return;
    const time = this.shadow.querySelector<HTMLElement>('[data-stat="time"]');
    const catches = this.shadow.querySelector<HTMLElement>('[data-stat="catch"]');
    const weight = this.shadow.querySelector<HTMLElement>('[data-stat="weight"]');
    if (time !== null) time.textContent = `${Math.ceil(this.round.remainingSeconds)}s`;
    if (catches !== null) catches.textContent = String(this.round.catches.length);
    if (weight !== null) weight.textContent = `${this.round.totalWeightKg.toFixed(2)} kg`;
  }

  private updateTension(): void {
    const fight = this.round?.fight;
    if (fight === null || fight === undefined || this.shadow === null) return;
    const needle = this.shadow.querySelector<HTMLElement>(".needle");
    const green = this.shadow.querySelector<HTMLElement>(".green");
    const copy = this.shadow.querySelector<HTMLElement>(".tension-copy span:last-child");
    const [greenStart, greenEnd] = fight.greenBand;
    needle?.style.setProperty("--tension", `${fight.tension * 100}%`);
    green?.style.setProperty("--green-start", `${greenStart * 100}%`);
    green?.style.setProperty("--green-width", `${(greenEnd - greenStart) * 100}%`);
    if (copy !== null) copy.textContent = `${Math.round(fight.progress * 100)}% REELED`;
  }

  private focusCurrentInteraction(): void {
    if (this.shadow === null) return;
    if (this.screen === "playing" && !this.paused) {
      const action =
        this.round?.phase === "aiming"
          ? "shadow"
          : this.round?.phase === "bite"
            ? "hook"
            : this.round?.phase === "fighting"
              ? "reel"
              : null;
      if (action !== null) {
        this.shadow.querySelector<HTMLButtonElement>(`button[data-action="${action}"]`)?.focus();
      } else {
        this.root?.focus();
      }
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

export function createPondFishing(): MinigameModule {
  return new PondFishing();
}
