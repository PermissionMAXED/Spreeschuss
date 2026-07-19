import {
  validateMinigameManifest,
  type MinigameContext,
  type MinigameManifest,
  type MinigameModule,
  type MinigamePayout,
  type MinigameRunId,
} from "../../core/contracts/minigame";
import type { HapticPattern } from "../../core/contracts/platform";
import { pickLocalized } from "../../i18n";
import {
  PauseGate,
  createArcadeHud,
  createResultScreen,
  createTutorialOverlay,
  type ArcadeHud,
  type ResultScreen,
  type TutorialOverlay,
} from "../shared";
import type { MinigameStubDefinition } from "../stub";
import {
  BurrowRound,
  burrowCoordinates,
  generateBurrowLevel,
  type BurrowCell,
  type DigOutcome,
} from "./model";

export const manifest: MinigameManifest = validateMinigameManifest({
  id: "burrow-dig",
  title: { en: "Burrow Dig", de: "Bau-Buddelei" },
  instructions: {
    en: "Dig where the soil sparkles to uncover buried keepsakes.",
    de: "Grabe dort, wo die Erde funkelt, und finde vergrabene Andenken.",
  },
  icon: "⛏",
  category: "puzzle",
  stage3d: false,
  unlockLevel: 1,
  audioCues: ["go", "hit", "miss", "combo", "countdown", "score", "lose", "win"],
  tutorial: [
    {
      icon: "⛏",
      title: { en: "Plan an 8×10 path", de: "Plane einen 8×10-Weg" },
      body: {
        en: "Tap an adjacent patch or use arrow keys. Soil costs one energy, thick roots cost two, and rocks block you.",
        de: "Tippe ein Nachbarfeld an oder nutze Pfeiltasten. Erde kostet eine Kraft, dicke Wurzeln zwei, Felsen blockieren.",
      },
    },
    {
      icon: "≋",
      title: { en: "Move before the flood", de: "Sei schneller als die Flut" },
      body: {
        en: "A !! warning and wave marks appear two turns before water floods a tile.",
        de: "Ein !!-Warnzeichen und Wellen erscheinen zwei Züge, bevor Wasser ein Feld flutet.",
      },
    },
    {
      icon: "✦",
      title: { en: "Find treats, spare worms", de: "Finde Leckerli, schone Würmer" },
      body: {
        en: "Sparkling treats score big, worms reduce points, and every energy left at the exit becomes a bonus.",
        de: "Funkelnde Leckerli bringen viele Punkte, Würmer kosten Punkte, und übrige Kraft wird am Ausgang zum Bonus.",
      },
    },
  ],
});

export const definition = {
  id: manifest.id,
  title: manifest.title.en,
  instructions: manifest.instructions.en,
} as const satisfies MinigameStubDefinition;

type Phase = "unmounted" | "tutorial" | "running" | "paused" | "results" | "disposed";
type SharedAudioAction = "hit" | "miss" | "combo" | "countdown" | "go" | "win" | "lose" | "score";
type BurrowContext = MinigameContext & {
  readonly audio?: { emit(action: SharedAudioAction, value?: number): void };
  readonly haptics?: { impact(pattern: HapticPattern): void };
  readonly reducedMotion?: boolean;
  readonly bestScore?: number;
};

const ROUND_SECONDS = 90;
const EMPTY_PAYOUT: MinigamePayout = { score: 0, coins: 0, xp: 0 };

export class BurrowDigGame implements MinigameModule {
  readonly id = definition.id;
  readonly title = definition.title;
  readonly instructions = definition.instructions;

  private context: BurrowContext | null = null;
  private root: HTMLElement | null = null;
  private hud: ArcadeHud | null = null;
  private tutorial: TutorialOverlay | null = null;
  private results: ResultScreen | null = null;
  private abortController: AbortController | null = null;
  private round: BurrowRound | null = null;
  private runId: MinigameRunId | null = null;
  private phase: Phase = "unmounted";
  private remainingSeconds = ROUND_SECONDS;
  private best = 0;
  private actions = 0;
  private settled = false;
  private settledPayout: MinigamePayout | null = null;
  private message = "PLAN YOUR ROUTE";
  private readonly pauseGate = new PauseGate();

  mount(context: MinigameContext): void {
    if (this.phase !== "unmounted" && this.phase !== "disposed") this.dispose();
    this.context = context;
    this.best = context.lifecycle?.persistedBest ?? this.context.bestScore ?? 0;
    this.abortController = new AbortController();
    const root = context.mount.ownerDocument.createElement("section");
    root.className = "burrow-dig";
    root.dataset.minigame = this.id;
    root.dataset.phase = "tutorial";
    root.dataset.akReduced = String(this.context.reducedMotion === true);
    root.tabIndex = 0;
    root.setAttribute("aria-label", pickLocalized(manifest.title));
    root.innerHTML = this.markup();
    root.addEventListener("click", this.onClick, { signal: this.abortController.signal });
    root.addEventListener("keydown", this.onKeyDown, { signal: this.abortController.signal });
    context.mount.replaceChildren(root);
    this.root = root;
    this.hud = createArcadeHud({
      host: root,
      initialBest: this.best,
      reducedMotion: this.context.reducedMotion === true,
      onPause: () => {
        this.pause();
      },
    });
    this.tutorial = createTutorialOverlay({
      host: root,
      steps: manifest.tutorial,
      reducedMotion: this.context.reducedMotion === true,
      onStart: () => {
        this.beginRound();
      },
      onExitWithoutReward: () => {
        this.context?.lifecycle?.exit();
        this.phase = "tutorial";
      },
    });
    this.results = createResultScreen({
      host: root,
      reducedMotion: this.context.reducedMotion === true,
      hooks: {
        onCollect: () => {
          this.phase = "results";
        },
        onPlayAgain: () => {
          this.beginRound();
        },
      },
    });
    this.hud.setPauseVisible(false);
    this.phase = "tutorial";
  }

  start(): void {
    if (!this.root || this.phase === "disposed") return;
    this.phase = "tutorial";
    this.root.dataset.phase = this.phase;
    this.tutorial?.open();
  }

  pause(): void {
    if (this.phase !== "running") return;
    this.phase = "paused";
    this.pauseGate.pause();
    this.showPause(true);
  }

  resume(): void {
    if (this.phase !== "paused") return;
    this.phase = "running";
    this.pauseGate.resume();
    this.showPause(false);
    this.root?.focus();
  }

  update(deltaSeconds: number): void {
    if (this.phase !== "running" || !this.round) return;
    const requested = Math.min(0.1, Math.max(0, Number.isFinite(deltaSeconds) ? deltaSeconds : 0));
    const delta = this.pauseGate.filter(requested);
    this.remainingSeconds = Math.max(0, this.remainingSeconds - delta);
    this.hud?.setTimer(this.remainingSeconds);
    if (this.remainingSeconds <= 0) this.finishRound(false);
  }

  payout(): MinigamePayout {
    return this.settledPayout ?? EMPTY_PAYOUT;
  }

  dispose(): void {
    if (this.phase === "disposed") return;
    this.context?.lifecycle?.exit();
    this.abortController?.abort();
    this.abortController = null;
    this.hud?.dispose();
    this.hud = null;
    this.tutorial?.dispose();
    this.tutorial = null;
    this.results?.dispose();
    this.results = null;
    this.root?.remove();
    this.root = null;
    this.round = null;
    this.runId = null;
    this.context = null;
    this.pauseGate.dispose();
    this.phase = "disposed";
  }

  private beginRound(): void {
    if (!this.context || !this.root) return;
    this.context.lifecycle?.exit();
    this.runId = this.context.lifecycle?.beginRun() ?? null;
    const seed = this.context.rng.int(0, 2_147_483_647);
    this.round = new BurrowRound(generateBurrowLevel(seed));
    this.best = this.context.lifecycle?.persistedBest ?? this.context.bestScore ?? this.best;
    this.remainingSeconds = ROUND_SECONDS;
    this.actions = 0;
    this.settled = false;
    this.settledPayout = null;
    this.message = "DIG TO THE EXIT ↓";
    this.phase = "running";
    this.pauseGate.resume();
    this.results?.close();
    this.hud?.setPauseVisible(true);
    this.hud?.setBest(this.best);
    this.hud?.setTimer(this.remainingSeconds);
    this.emitFeedback("go", undefined, "success");
    this.render();
    this.root.focus();
  }

  private dig(row: number, column: number): void {
    if (this.phase !== "running" || !this.round) return;
    const result = this.round.dig(row, column);
    if (result.outcome === "invalid" || result.outcome === "finished") {
      this.message = result.outcome === "invalid" ? "CHOOSE AN ADJACENT TILE" : this.message;
      this.render();
      return;
    }
    this.actions += 1;
    this.message = this.outcomeText(result.outcome);
    if (result.outcome === "treat") {
      this.emitFeedback("combo", this.round.treats, "success");
    } else if (result.outcome === "soil" || result.outcome === "root" || result.outcome === "exit") {
      this.emitFeedback(result.outcome === "exit" ? "win" : "hit", this.round.energy, "light");
    } else {
      this.emitFeedback("miss", undefined, "warning");
    }
    this.render();
    if (this.round.finished) this.finishRound(false);
  }

  private move(direction: "up" | "down" | "left" | "right"): void {
    if (!this.round) return;
    const position = burrowCoordinates(this.round.position, this.round.level.columns);
    const target = {
      up: [position.row - 1, position.column],
      down: [position.row + 1, position.column],
      left: [position.row, position.column - 1],
      right: [position.row, position.column + 1],
    }[direction];
    this.dig(target[0] ?? -1, target[1] ?? -1);
  }

  private finishRound(quitEarly: boolean): void {
    if (this.settled || !this.round || !this.context) return;
    this.settled = true;
    const payout = this.round.payout();
    const previousBest = this.best;
    if (this.actions === 0 && quitEarly) {
      this.context.lifecycle?.exit();
      this.runId = null;
      this.settledPayout = EMPTY_PAYOUT;
    } else {
      this.settledPayout = payout;
      if (this.context.lifecycle && this.runId) {
        const receipt = this.context.lifecycle.completeRun(this.runId, payout);
        this.best = receipt.bestScore;
        this.runId = null;
      } else {
        this.context.finish(payout);
        this.best = Math.max(this.best, payout.score);
      }
    }
    this.phase = "results";
    this.root?.setAttribute("data-phase", this.phase);
    this.hud?.setPauseVisible(false);
    this.hud?.setBest(this.best);
    this.showPause(false);
    const reachedExit = this.round.reason === "exit";
    this.emitFeedback(reachedExit ? "win" : "lose", payout.score, reachedExit ? "success" : "warning");
    this.results?.show({
      score: this.settledPayout.score,
      best: this.best,
      newBest: this.settledPayout.score > previousBest,
      quitEarly,
      detail: `${this.round.treats} treats · ${this.round.energy} energy left · ${this.round.wormsDisturbed} worms disturbed`,
    });
  }

  private readonly onClick = (event: MouseEvent): void => {
    const view = this.root?.ownerDocument.defaultView;
    const target = event.target;
    if (!view || !(target instanceof view.Element)) return;
    const tile = target.closest<HTMLElement>("[data-bd-cell]");
    if (tile) {
      this.dig(Number(tile.dataset.row), Number(tile.dataset.column));
      return;
    }
    const action = target.closest<HTMLElement>("[data-bd-action]")?.dataset.bdAction;
    if (action === "resume") this.resume();
    else if (action === "finish") this.finishRound(true);
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.repeat) return;
    const key = event.key.toLowerCase();
    if (key === "escape" || key === "p") {
      if (this.phase === "running") {
        event.preventDefault();
        this.pause();
      } else if (this.phase === "paused") {
        event.preventDefault();
        this.resume();
      }
      return;
    }
    if (this.phase !== "running") return;
    const direction = {
      arrowup: "up",
      w: "up",
      arrowdown: "down",
      s: "down",
      arrowleft: "left",
      a: "left",
      arrowright: "right",
      d: "right",
    }[key] as "up" | "down" | "left" | "right" | undefined;
    if (!direction) return;
    event.preventDefault();
    this.move(direction);
  };

  private render(): void {
    if (!this.root || !this.round) return;
    const level = this.round.level;
    this.root.dataset.phase = this.phase;
    this.root.dataset.seed = String(level.seed);
    this.hud?.setScore(this.round.score);
    this.hud?.setCombo(this.round.treats);
    this.hud?.setBest(Math.max(this.best, this.round.payout().score));
    this.setText("[data-bd-energy]", `⛏ ${this.round.energy}/${level.initialEnergy} ENERGY`);
    this.setText("[data-bd-turn]", `TURN ${this.round.turns}`);
    this.setText("[data-bd-message]", this.message);
    for (const tile of this.root.querySelectorAll<HTMLButtonElement>("[data-bd-cell]")) {
      const index = Number(tile.dataset.bdCell);
      const cell = level.cells[index];
      if (!cell) continue;
      const flood = this.round.floodState(index);
      const current = index === this.round.position;
      const dug = this.round.isDug(index);
      tile.dataset.kind = cell.kind;
      tile.dataset.flood = flood;
      tile.dataset.current = String(current);
      tile.dataset.dug = String(dug);
      tile.disabled = this.phase !== "running";
      const visual = this.cellVisual(cell, flood, current, dug);
      tile.innerHTML = `<span>${visual.icon}</span><b>${visual.label}</b>`;
      tile.setAttribute("aria-label", visual.accessible);
    }
  }

  private cellVisual(
    cell: BurrowCell,
    flood: "dry" | "warning" | "flooded",
    current: boolean,
    dug: boolean,
  ): { readonly icon: string; readonly label: string; readonly accessible: string } {
    if (current) return { icon: "●", label: "YOU", accessible: `Current tunnel at row ${cell.row + 1}, column ${cell.column + 1}` };
    if (flood === "flooded") return { icon: "≋", label: "FLOOD", accessible: `Flooded tile at row ${cell.row + 1}, column ${cell.column + 1}` };
    const warning = flood === "warning" ? "!! " : "";
    const content: Record<BurrowCell["kind"], readonly [string, string]> = {
      soil: ["▒", dug ? "TUNNEL" : "SOIL"],
      tunnel: ["○", "START"],
      rock: ["◆", "ROCK"],
      root: ["╫", "ROOTS"],
      worm: ["〰", "WORM"],
      treat: ["✦", "TREAT"],
      "water-source": ["≋", "WATER"],
      exit: ["▽", "EXIT"],
    };
    const [icon, label] = content[cell.kind];
    return {
      icon: flood === "warning" ? `!!${icon}` : icon,
      label: `${warning}${label}`,
      accessible: `${flood === "warning" ? "Flood warning, " : ""}${label.toLowerCase()} at row ${cell.row + 1}, column ${cell.column + 1}`,
    };
  }

  private showPause(visible: boolean): void {
    const pause = this.root?.querySelector<HTMLElement>("[data-bd-pause]");
    if (pause) pause.hidden = !visible;
  }

  private setText(selector: string, value: string): void {
    const element = this.root?.querySelector<HTMLElement>(selector);
    if (element && element.textContent !== value) element.textContent = value;
  }

  private emitFeedback(action: SharedAudioAction, value?: number, haptic?: HapticPattern): void {
    this.context?.audio?.emit(action, value);
    if (haptic) this.context?.haptics?.impact(haptic);
  }

  private outcomeText(outcome: DigOutcome): string {
    if (outcome === "treat") return "✦ TREAT FOUND +250";
    if (outcome === "worm") return "〰 WORM! GENTLY MOVE ON";
    if (outcome === "root") return "╫ THICK ROOT · 2 ENERGY";
    if (outcome === "rock") return "◆ ROCK BLOCKED THE WAY";
    if (outcome === "flooded") return "≋ WATER BLOCKED THAT TILE";
    if (outcome === "exit") return "▽ EXIT REACHED · LEFTOVER BONUS!";
    if (outcome === "tired") return "⛏ SHOVEL ENERGY EMPTY";
    return "✓ TUNNEL DUG";
  }

  private markup(): string {
    const cells = Array.from(
      { length: 80 },
      (_, index) => {
        const row = Math.floor(index / 8);
        const column = index % 8;
        return `<button class="bd-cell" data-bd-cell="${index}" data-row="${row}" data-column="${column}"><span>▒</span><b>SOIL</b></button>`;
      },
    ).join("");
    return `
      <style>${BURROW_STYLES}</style>
      <div class="bd-earth" aria-hidden="true"></div>
      <main class="bd-stage">
        <div class="bd-tools"><span data-bd-energy>⛏ 26/26 ENERGY</span><span data-bd-turn>TURN 0</span></div>
        <div class="bd-legend" aria-label="Map legend"><span>◆ ROCK</span><span>╫ ROOT 2</span><span>〰 WORM</span><span>!!≋ FLOOD SOON</span></div>
        <div class="bd-grid" role="grid" aria-label="Eight column by ten row burrow">${cells}</div>
        <div class="bd-message" data-bd-message role="status">PLAN YOUR ROUTE</div>
        <div class="bd-keyhint">TAP ADJACENT SOIL · ARROWS / WASD</div>
      </main>
      <section class="ak-overlay bd-pause" data-bd-pause role="dialog" aria-modal="true" hidden>
        <div class="ak-card"><span class="ak-kicker">DIG BREAK</span><div class="bd-pause-icon">⛏</div><h2>Burrow paused</h2><p>The water and timer are frozen.</p><button class="ak-button ak-button-primary" data-bd-action="resume">Keep digging</button><button class="ak-button ak-button-secondary" data-bd-action="finish">Finish &amp; collect</button></div>
      </section>
    `;
  }
}

export function createMinigame(): MinigameModule {
  return new BurrowDigGame();
}

const BURROW_STYLES = `
.burrow-dig{position:relative;isolation:isolate;width:100%;height:100%;min-height:620px;overflow:hidden;color:#4d3524;background:#806044;font-family:Nunito,ui-rounded,"Arial Rounded MT Bold",system-ui,sans-serif;touch-action:manipulation;user-select:none}.burrow-dig *{box-sizing:border-box}.burrow-dig button{min-width:44px;min-height:44px;font:inherit}.burrow-dig button:focus-visible{outline:4px solid #fff;outline-offset:1px}.bd-earth{position:absolute;inset:0;background:radial-gradient(circle at 15% 14%,#d9b981 0 2px,transparent 3px),radial-gradient(circle at 80% 30%,#5e4332 0 3px,transparent 4px),repeating-linear-gradient(#a87c55 0 42px,#956b4d 43px 45px);background-size:43px 47px,61px 59px,100% 45px}.bd-stage{position:absolute;z-index:2;inset:77px 7px max(8px,env(safe-area-inset-bottom));display:flex;flex-direction:column;align-items:center;gap:6px}.bd-tools{display:flex;justify-content:space-between;width:100%;min-height:38px;padding:9px 12px;border:3px solid #f5dfb5;border-radius:13px;color:#fff8df;background:#513a2ce8;font-size:11px;font-weight:1000}.bd-legend{display:flex;justify-content:center;gap:5px;width:100%;font-size:7px;font-weight:1000}.bd-legend span{padding:4px 5px;border:1px solid #f7e7c5;border-radius:6px;background:#f5dfb5}.bd-grid{width:min(100%,378px);flex:1;display:grid;grid-template-columns:repeat(8,minmax(44px,1fr));grid-template-rows:repeat(10,minmax(44px,1fr));gap:2px;padding:4px;overflow:auto;border:4px solid #f3d69e;border-radius:17px;background:#5f4435;box-shadow:0 10px 22px #3a281f88}.bd-cell{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:1px;border:2px solid #c69b6c;border-radius:8px;color:#4b3527;background:repeating-linear-gradient(45deg,#d6ad7c 0 7px,#c79969 7px 14px);cursor:pointer}.bd-cell span{font-size:14px;font-weight:1000;line-height:1}.bd-cell b{font-size:6px;letter-spacing:.02em}.bd-cell[data-kind="rock"]{color:#fff;background:repeating-linear-gradient(135deg,#665f5b 0 7px,#4b4745 7px 14px);border-style:double}.bd-cell[data-kind="root"]{background:repeating-linear-gradient(90deg,#c58f5f 0 4px,#6f4a2c 4px 7px)}.bd-cell[data-kind="worm"]{background:#e5c99b;border-style:dashed}.bd-cell[data-kind="treat"]{background:#fff0a9;border-style:double}.bd-cell[data-kind="exit"]{color:#fff;background:#47765d}.bd-cell[data-kind="water-source"],.bd-cell[data-flood="flooded"]{color:#fff;background:repeating-linear-gradient(0deg,#357c93 0 6px,#55a5b4 6px 12px)}.bd-cell[data-flood="warning"]{border:4px dashed #fff2a8;box-shadow:inset 0 0 0 2px #573b28}.bd-cell[data-current="true"]{color:#fff;background:#ce704c;border:4px double #fff;box-shadow:0 0 0 2px #5d3827}.bd-cell[data-dug="true"]:not([data-current="true"]){background:#6d4b35;color:#fff4d6}.bd-message{min-height:33px;padding:7px 12px;border:3px solid #fff0cc;border-radius:11px;color:#fff;background:#553b2be8;font-size:12px;font-weight:1000;text-align:center}.bd-keyhint{font-size:8px;font-weight:1000;letter-spacing:.08em;color:#fff4da}.bd-pause-icon{font-size:45px}
.burrow-dig[data-ak-reduced="true"] *{animation-duration:.001ms!important;animation-iteration-count:1!important;transition-duration:.001ms!important}@media(prefers-reduced-motion:reduce){.burrow-dig *{animation-duration:.001ms!important;animation-iteration-count:1!important;transition-duration:.001ms!important}}@media(max-height:700px){.burrow-dig{min-height:500px}.bd-stage{inset:68px 5px 5px}.bd-tools{min-height:32px;padding:6px}.bd-legend{display:none}.bd-grid{grid-template-columns:repeat(8,44px);grid-template-rows:repeat(10,44px);max-height:455px}.bd-message{font-size:10px}}
`;
