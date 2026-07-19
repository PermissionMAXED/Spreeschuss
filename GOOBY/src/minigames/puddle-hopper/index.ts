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
  PUDDLE_BEAT_MS,
  PuddleRound,
  type HopOutcome,
} from "./model";

export const manifest: MinigameManifest = validateMinigameManifest({
  id: "puddle-hopper",
  title: { en: "Puddle Hopper", de: "Pfützenhüpfer" },
  instructions: {
    en: "Hop onto the dry stones and skip the splashy puddles.",
    de: "Hüpfe auf die trockenen Steine und lasse die Platschpfützen aus.",
  },
  icon: "☂",
  category: "rhythm",
  stage3d: false,
  unlockLevel: 1,
  audioCues: ["go", "hit", "miss", "combo", "countdown", "score", "win"],
  tutorial: [
    {
      icon: "♫",
      title: { en: "Hop with the rain", de: "Hüpfe mit dem Regen" },
      body: {
        en: "Tap the numbered 3×3 stone when its star reaches the bright beat ring.",
        de: "Tippe den nummerierten Stein im 3×3-Feld, wenn sein Stern den hellen Taktring erreicht.",
      },
    },
    {
      icon: "≈",
      title: { en: "Read every splash pattern", de: "Lies jedes Platschmuster" },
      body: {
        en: "Striped splash tiles are marked with waves and text. Never rely on color alone.",
        de: "Gestreifte Platschfelder tragen Wellen und Text. Verlasse dich nie nur auf Farbe.",
      },
    },
    {
      icon: "☂",
      title: { en: "Raise an umbrella", de: "Spanne den Schirm auf" },
      body: {
        en: "Press U or tap the umbrella before a risky hop. Two shields can block one splash each.",
        de: "Drücke U oder tippe den Schirm vor einem riskanten Sprung. Zwei Schilde halten je einen Platscher ab.",
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
type PuddleContext = MinigameContext & {
  readonly audio?: { emit(action: SharedAudioAction, value?: number): void };
  readonly haptics?: { impact(pattern: HapticPattern): void };
  readonly reducedMotion?: boolean;
  readonly bestScore?: number;
};

const EMPTY_PAYOUT: MinigamePayout = { score: 0, coins: 0, xp: 0 };

export class PuddleHopperGame implements MinigameModule {
  readonly id = definition.id;
  readonly title = definition.title;
  readonly instructions = definition.instructions;

  private context: PuddleContext | null = null;
  private root: HTMLElement | null = null;
  private hud: ArcadeHud | null = null;
  private tutorial: TutorialOverlay | null = null;
  private results: ResultScreen | null = null;
  private abortController: AbortController | null = null;
  private round: PuddleRound | null = null;
  private runId: MinigameRunId | null = null;
  private phase: Phase = "unmounted";
  private pausedFrom: Phase = "running";
  private best = 0;
  private actions = 0;
  private settled = false;
  private settledPayout: MinigamePayout | null = null;
  private feedbackSeconds = 0;
  private feedbackText = "";
  private readonly pauseGate = new PauseGate();

  mount(context: MinigameContext): void {
    if (this.phase !== "unmounted" && this.phase !== "disposed") this.dispose();
    this.context = context;
    this.best = context.lifecycle?.persistedBest ?? this.context.bestScore ?? 0;
    this.abortController = new AbortController();
    const root = context.mount.ownerDocument.createElement("section");
    root.className = "puddle-hopper";
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
    this.pausedFrom = this.phase;
    this.phase = "paused";
    this.pauseGate.pause();
    this.showPause(true);
  }

  resume(): void {
    if (this.phase !== "paused") return;
    this.phase = this.pausedFrom;
    this.pauseGate.resume();
    this.showPause(false);
    this.root?.focus();
  }

  update(deltaSeconds: number): void {
    if (this.phase !== "running" || !this.round) return;
    const requested = Math.min(0.1, Math.max(0, Number.isFinite(deltaSeconds) ? deltaSeconds : 0));
    const delta = this.pauseGate.filter(requested);
    for (const result of this.round.update(delta)) {
      if (result.outcome === "miss") this.emitFeedback("miss", undefined, "warning");
    }
    this.feedbackSeconds = Math.max(0, this.feedbackSeconds - delta);
    if (this.feedbackSeconds === 0) this.feedbackText = "";
    this.render();
    if (this.round.finished) this.finishRound(false);
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
    this.best = this.context.lifecycle?.persistedBest ?? this.context.bestScore ?? this.best;
    this.round = new PuddleRound(this.context.rng);
    this.actions = 0;
    this.settled = false;
    this.settledPayout = null;
    this.feedbackText = "LISTEN… FIRST HOP IN 3";
    this.feedbackSeconds = 1;
    this.phase = "running";
    this.pauseGate.resume();
    this.results?.close();
    this.hud?.setPauseVisible(true);
    this.hud?.setBest(this.best);
    this.emitFeedback("go", undefined, "success");
    this.render();
    this.root.focus();
  }

  private hop(tile: number): void {
    if (this.phase !== "running" || !this.round) return;
    const result = this.round.hop(tile);
    if (result.outcome === "idle") return;
    this.actions += 1;
    this.feedbackText = this.outcomeText(result.outcome);
    this.feedbackSeconds = 0.55;
    if (result.outcome === "perfect" || result.outcome === "good") {
      const comboCue = this.round.combo > 0 && this.round.combo % 5 === 0;
      this.emitFeedback(comboCue ? "combo" : "hit", this.round.combo, comboCue ? "success" : "light");
    } else if (result.outcome === "shielded") {
      this.emitFeedback("score", this.round.umbrellas, "medium");
    } else {
      this.emitFeedback("miss", undefined, "warning");
    }
    this.render();
  }

  private activateUmbrella(): void {
    if (this.phase !== "running" || !this.round?.activateUmbrella()) return;
    this.feedbackText = "☂ UMBRELLA READY";
    this.feedbackSeconds = 0.8;
    this.emitFeedback("countdown", this.round.umbrellas, "medium");
    this.render();
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
    this.emitFeedback("win", payout.score, "success");
    this.results?.show({
      score: this.settledPayout.score,
      best: this.best,
      newBest: this.settledPayout.score > previousBest,
      quitEarly,
      detail: `${this.round.distance} stones · ${Math.round(this.round.accuracy * 100)}% accuracy · ${this.round.perfects} perfect`,
    });
  }

  private readonly onClick = (event: MouseEvent): void => {
    const view = this.root?.ownerDocument.defaultView;
    const target = event.target;
    if (!view || !(target instanceof view.Element)) return;
    const tile = target.closest<HTMLElement>("[data-ph-tile]");
    if (tile) {
      this.hop(Number(tile.dataset.phTile));
      return;
    }
    const action = target.closest<HTMLElement>("[data-ph-action]")?.dataset.phAction;
    if (action === "umbrella") this.activateUmbrella();
    else if (action === "resume") this.resume();
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
    if (key === "u") {
      event.preventDefault();
      this.activateUmbrella();
      return;
    }
    if (this.phase !== "running" || !/^[1-9]$/u.test(key)) return;
    event.preventDefault();
    this.hop(Number(key) - 1);
  };

  private render(): void {
    if (!this.root || !this.round) return;
    const beat = this.round.upcomingBeat;
    const active = this.round.activeBeat !== null;
    this.root.dataset.phase = this.phase;
    this.root.dataset.pattern = beat?.pattern ?? "none";
    this.hud?.setTimer(this.round.remainingSeconds);
    this.hud?.setScore(this.round.score);
    this.hud?.setCombo(this.round.combo);
    this.hud?.setBest(Math.max(this.best, this.round.score));
    this.setText("[data-ph-distance]", `${this.round.distance} STONES`);
    this.setText("[data-ph-accuracy]", `${Math.round(this.round.accuracy * 100)}% ACCURACY`);
    this.setText("[data-ph-feedback]", this.feedbackText || (active ? "HOP NOW!" : "WAIT FOR THE RING"));
    this.setText(
      "[data-ph-pattern]",
      beat ? `${beat.pattern.toUpperCase()} SPLASH PATTERN · BEAT ${beat.index + 1}/${this.round.beats.length}` : "COURSE CLEAR",
    );
    const umbrella = this.root.querySelector<HTMLButtonElement>("[data-ph-action='umbrella']");
    if (umbrella) {
      umbrella.disabled = this.round.umbrellas <= 0 || this.round.umbrellaActive;
      umbrella.dataset.active = String(this.round.umbrellaActive);
      umbrella.innerHTML = `<b>☂ ${this.round.umbrellas}</b><span>${this.round.umbrellaActive ? "SHIELD RAISED" : "PRESS U · SHIELD"}</span>`;
      umbrella.setAttribute(
        "aria-label",
        this.round.umbrellaActive
          ? `Umbrella shield raised, ${this.round.umbrellas} remaining`
          : `Raise umbrella shield, ${this.round.umbrellas} remaining`,
      );
    }
    for (const tile of this.root.querySelectorAll<HTMLButtonElement>("[data-ph-tile]")) {
      const index = Number(tile.dataset.phTile);
      const hazard = beat?.hazards.includes(index) === true;
      const target = beat?.target === index;
      tile.dataset.hazard = String(hazard);
      tile.dataset.target = String(target);
      tile.dataset.active = String(active && target);
      tile.disabled = this.phase !== "running";
      tile.innerHTML = hazard
        ? `<span>≈</span><b>SPLASH</b><small>${index + 1}</small>`
        : target
          ? `<span>★</span><b>${active ? "HOP!" : "READY"}</b><small>${index + 1}</small>`
          : `<span>○</span><b>STONE</b><small>${index + 1}</small>`;
      tile.setAttribute(
        "aria-label",
        hazard
          ? `Tile ${index + 1}, splash hazard`
          : target
            ? `Tile ${index + 1}, dry target${active ? ", hop now" : ", get ready"}`
            : `Tile ${index + 1}, dry stone`,
      );
    }
  }

  private showPause(visible: boolean): void {
    const pause = this.root?.querySelector<HTMLElement>("[data-ph-pause]");
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

  private outcomeText(outcome: HopOutcome): string {
    if (outcome === "perfect") return "★ PERFECT HOP";
    if (outcome === "good") return "✓ GOOD HOP";
    if (outcome === "shielded") return "☂ SPLASH BLOCKED";
    if (outcome === "splash") return "≈ SPLASH! FOLLOW THE MARKS";
    return "× MISSED BEAT";
  }

  private markup(): string {
    const tiles = Array.from(
      { length: 9 },
      (_, index) => `<button class="ph-tile" data-ph-tile="${index}" aria-keyshortcuts="${index + 1}"><span>○</span><b>STONE</b><small>${index + 1}</small></button>`,
    ).join("");
    return `
      <style>${PUDDLE_STYLES}</style>
      <div class="ph-rain" aria-hidden="true"></div>
      <main class="ph-stage">
        <div class="ph-course-meta"><span data-ph-distance>0 STONES</span><span data-ph-accuracy>100% ACCURACY</span></div>
        <div class="ph-pattern" data-ph-pattern aria-live="polite">LISTEN FOR THE RAIN</div>
        <div class="ph-beat" aria-hidden="true"><i></i><b>♫</b></div>
        <div class="ph-grid" role="group" aria-label="Nine hopscotch tiles">${tiles}</div>
        <div class="ph-feedback" data-ph-feedback role="status">GET READY</div>
        <button class="ph-umbrella" data-ph-action="umbrella" aria-keyshortcuts="U"><b>☂ 2</b><span>PRESS U · SHIELD</span></button>
      </main>
      <section class="ak-overlay ph-pause" data-ph-pause role="dialog" aria-modal="true" hidden>
        <div class="ak-card"><span class="ak-kicker">RAIN BREAK</span><div class="ph-pause-icon">☂</div><h2>Course paused</h2><p>The rhythm and rain are frozen.</p><button class="ak-button ak-button-primary" data-ph-action="resume">Keep hopping</button><button class="ak-button ak-button-secondary" data-ph-action="finish">Finish &amp; collect</button></div>
      </section>
    `;
  }
}

export function createMinigame(): MinigameModule {
  return new PuddleHopperGame();
}

const PUDDLE_STYLES = `
.puddle-hopper{position:relative;isolation:isolate;width:100%;height:100%;min-height:620px;overflow:hidden;color:#17394b;background:linear-gradient(#8ec9d2,#d8eef0 47%,#688e78 47%);font-family:Nunito,ui-rounded,"Arial Rounded MT Bold",system-ui,sans-serif;touch-action:manipulation;user-select:none}.puddle-hopper *{box-sizing:border-box}.puddle-hopper button{min-width:44px;min-height:44px;font:inherit}.puddle-hopper button:focus-visible{outline:4px solid #fff;outline-offset:2px}
.ph-rain{position:absolute;inset:0;background:repeating-linear-gradient(105deg,transparent 0 25px,#eaffff88 26px 28px,transparent 29px 52px);background-size:150% 150%;animation:phRain .8s linear infinite;opacity:.58}.ph-stage{position:absolute;z-index:3;inset:78px 10px max(10px,env(safe-area-inset-bottom));display:flex;flex-direction:column;align-items:center;gap:8px}.ph-course-meta{display:flex;justify-content:space-between;width:100%;padding:7px 12px;border:2px solid #fff8;border-radius:13px;background:#eefcffda;font-size:11px;font-weight:1000;letter-spacing:.04em}.ph-pattern{min-height:29px;padding:7px 11px;border-radius:99px;color:#fff;background:#22566d;font-size:9px;font-weight:1000;letter-spacing:.07em;text-align:center}.ph-beat{position:relative;width:46px;height:46px;display:grid;place-items:center}.ph-beat i{position:absolute;inset:3px;border:4px solid #fff;border-radius:50%;animation:phBeat ${PUDDLE_BEAT_MS}ms ease-out infinite}.ph-beat b{z-index:1;font-size:18px}.ph-grid{width:min(100%,348px);flex:1;max-height:430px;display:grid;grid-template-columns:repeat(3,1fr);grid-template-rows:repeat(3,1fr);gap:8px;padding:10px;border:4px solid #fff9;border-radius:28px;background:#2c657568;box-shadow:0 12px 25px #1b46565c}.ph-tile{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;overflow:hidden;border:3px solid #e8fbfb;border-radius:19px;color:#214651;background:linear-gradient(#f4ffff,#b7d4ce);box-shadow:0 6px 0 #486f68;cursor:pointer;transition:transform .1s}.ph-tile:active{transform:translateY(5px);box-shadow:0 1px 0 #486f68}.ph-tile span{font-size:25px;line-height:1}.ph-tile b{font-size:9px;letter-spacing:.08em}.ph-tile small{position:absolute;right:7px;top:5px;display:grid;place-items:center;width:18px;height:18px;border:2px solid currentColor;border-radius:50%;font-size:9px;font-weight:1000}.ph-tile[data-hazard="true"]{border-style:dashed;color:#fff;background:repeating-linear-gradient(135deg,#3d7184 0 10px,#274d62 10px 20px)}.ph-tile[data-target="true"]{border-width:5px;border-style:double;background:#fff4b5}.ph-tile[data-active="true"]{box-shadow:0 0 0 5px #ffdc55,0 7px 0 #876d2e;transform:scale(1.04)}.ph-feedback{min-height:31px;padding:6px 13px;border:3px solid #fff;border-radius:11px;color:#fff;background:#214f65;font-size:14px;font-weight:1000;letter-spacing:.05em;text-align:center}.ph-umbrella{width:min(100%,300px);display:flex;align-items:center;justify-content:center;gap:12px;border:3px solid #fff;border-radius:15px;color:#fff;background:#745c9f;box-shadow:0 5px 0 #49346d;cursor:pointer}.ph-umbrella b{font-size:20px}.ph-umbrella span{font-size:10px;font-weight:1000}.ph-umbrella[data-active="true"]{color:#2f3156;background:#ffe06f;border-style:double}.ph-umbrella:disabled{opacity:.78}.ph-pause-icon{font-size:45px}
.puddle-hopper[data-ak-reduced="true"] *{animation-duration:.001ms!important;animation-iteration-count:1!important;transition-duration:.001ms!important}@media(prefers-reduced-motion:reduce){.puddle-hopper *{animation-duration:.001ms!important;animation-iteration-count:1!important;transition-duration:.001ms!important}}@keyframes phRain{to{background-position:-70px 120px}}@keyframes phBeat{0%{opacity:1;transform:scale(.25)}80%{opacity:.65}100%{opacity:0;transform:scale(1.35)}}@media(max-height:700px){.puddle-hopper{min-height:500px}.ph-stage{inset-top:68px;gap:5px}.ph-grid{padding:7px;gap:6px}.ph-beat{width:32px;height:32px}.ph-feedback{font-size:11px}.ph-umbrella{min-height:44px}}
`;
