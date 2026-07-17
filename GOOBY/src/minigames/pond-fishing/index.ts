import type {
  MinigameContext,
  MinigameModule,
  MinigamePayout,
} from "../../core/contracts/minigame";
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

  private context: MinigameContext | null = null;
  private root: HTMLElement | null = null;
  private shadow: ShadowRoot | null = null;
  private round: PondFishingRound | null = null;
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

  mount(context: MinigameContext): void {
    this.dispose();
    this.context = context;
    const root = context.mount.ownerDocument.createElement("section");
    root.setAttribute("aria-label", "Pond Fishing");
    root.dataset.minigame = this.id;
    this.root = root;
    this.shadow = root.attachShadow({ mode: "open" });
    this.shadow.addEventListener("click", this.handleClick);
    this.shadow.addEventListener("pointerdown", this.handlePointerDown);
    this.shadow.addEventListener("pointermove", this.handlePointerMove);
    this.shadow.addEventListener("pointerup", this.handlePointerUp);
    this.shadow.addEventListener("pointercancel", this.handlePointerUp);
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
    this.round.update(deltaSeconds);
    const phase = this.round.phase;
    if (phase === "ended") {
      this.showResults();
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
    const score = this.screen === "results" ? this.finalScore : (this.round?.score ?? 0);
    const catchCount =
      this.screen === "results" ? this.finalCatchCount : (this.round?.catches.length ?? 0);
    const legendaryBonus =
      this.round?.catches.filter(({ species }) => species.rarity === "legendary").length ?? 0;
    return {
      score,
      coins: catchCount * 3 + Math.floor(score / 400) + legendaryBonus * 12,
      xp: Math.max(0, Math.floor(score / 65)),
    };
  }

  dispose(): void {
    this.shadow?.removeEventListener("click", this.handleClick);
    this.shadow?.removeEventListener("pointerdown", this.handlePointerDown);
    this.shadow?.removeEventListener("pointermove", this.handlePointerMove);
    this.shadow?.removeEventListener("pointerup", this.handlePointerUp);
    this.shadow?.removeEventListener("pointercancel", this.handlePointerUp);
    this.root?.remove();
    this.context = null;
    this.root = null;
    this.shadow = null;
    this.round = null;
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
    if (action === "quit" || action === "done") this.finishOnce();
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
      return;
    }
    if (this.round.phase === "bite") {
      if (this.round.hook()) {
        this.lastPhase = this.round.phase;
        this.render();
      }
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
    this.round.castAt(this.castX, this.castY);
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
    this.round = new PondFishingRound(this.difficulty, context.rng);
    this.screen = "playing";
    this.running = true;
    this.paused = false;
    this.finished = false;
    this.castX = 0.5;
    this.castY = 0.55;
    this.lastPhase = this.round.phase;
    this.lastShownSecond = -1;
    this.render();
  }

  private showResults(): void {
    if (this.round === null || this.screen === "results") return;
    this.running = false;
    this.finalScore = this.round.score;
    this.finalWeight = this.round.totalWeightKg;
    this.finalCatchCount = this.round.catches.length;
    this.highScore = Math.max(this.highScore, this.finalScore);
    this.screen = "results";
    this.render();
  }

  private finishOnce(): void {
    if (this.finished) return;
    this.finished = true;
    this.running = false;
    this.round?.setReeling(false);
    this.context?.finish(this.payout());
  }

  private requireMounted(): MinigameContext {
    if (this.context === null) throw new Error("Pond Fishing must be mounted before use");
    return this.context;
  }

  private render(): void {
    if (this.shadow === null) return;
    this.shadow.innerHTML = `<style>${POND_FISHING_STYLES}</style>${this.renderGame()}`;
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
              (shadow) =>
                `<div class="shadow" style="left:${shadow.x * 100}%;top:${shadow.y * 100}%;--angle:${Math.round(shadow.phase * 18)}deg;transform:translate(-50%,-50%) scale(${shadow.size})"></div>`,
            )
            .join("")}
          <div class="cast-line" ${phase === "aiming" && !this.dragging ? "hidden" : ""}></div>
          <div class="bobber" style="--cast-x:${this.castX * 100}%;--cast-y:${this.castY * 100}%" ${phase === "aiming" && !this.dragging ? "hidden" : ""}></div>
        </section>
        <div class="prompt ${phase === "bite" ? "bite" : ""}">${prompt}</div>
        <div class="gooby ${phase === "fighting" ? "fight" : ""}"><span>🎣</span></div>
        <section class="tension-wrap" ${phase === "fighting" ? "" : "hidden"}>
          <div class="tension-copy"><span>LINE TENSION</span><span>${fight === null || fight === undefined ? 0 : Math.round(fight.progress * 100)}% REELED</span></div>
          <div class="meter">
            <i class="green" style="--green-start:${green[0] * 100}%;--green-width:${(green[1] - green[0]) * 100}%"></i>
            <i class="needle" style="--tension:${(fight?.tension ?? 0.44) * 100}%"></i>
          </div>
          <button class="reel" data-action="reel">HOLD TO REEL · RELEASE TO EASE</button>
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

  private renderOverlay(): string {
    if (this.screen === "tutorial") return this.renderTutorial();
    if (this.screen === "select") return this.renderDifficulty();
    if (this.screen === "results") return this.renderResults();
    if (this.paused) {
      return `
        <div class="overlay"><section class="panel" role="dialog" aria-label="Game paused">
          <div class="mascot">🎣</div><h2>Pond paused</h2><p>No fish will escape while you take a breather.</p>
          <button class="primary" data-action="resume">Back to the pond</button>
          <button class="secondary" data-action="quit">Quit &amp; collect</button>
        </section></div>`;
    }
    return "";
  }

  private renderTutorial(): string {
    const pages = [
      { icon: "🎣", title: "Cast with care", copy: "Drag from Gooby toward a moving shadow, then release right on top of it.", tip: "Longer fish shadows often hide heavier catches." },
      { icon: "❗", title: "Wait for the bite", copy: "The bobber will plunge and glow. Tap quickly during the bite window to set the hook.", tip: "Tapping early scares the fish — patience wins." },
      { icon: "🟢", title: "Balance the tension", copy: "Hold Reel to pull, release to ease. Keep the white needle in the moving green band.", tip: "Every species has its own surge rhythm." },
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
    const isBest = this.finalScore >= this.highScore;
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
        <div class="mascot">${rarest?.species.icon ?? "🐟"}✨</div><h2>Fishing basket</h2>
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
}

export function createPondFishing(): MinigameModule {
  return new PondFishing();
}
