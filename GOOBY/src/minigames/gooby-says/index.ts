import type { MinigameSoundAction } from "../../audio/contracts";
import type {
  MinigameContext,
  MinigameLifecycle,
  MinigameManifest,
  MinigameModule,
  MinigamePayout,
  MinigameSettlementReceipt,
} from "../../core/contracts/minigame";
import { validateMinigameManifest } from "../../core/contracts/minigame";
import type { MinigameStubDefinition } from "../stub";
import { MinigameRunSession } from "../carrot-catch/run-session";
import { PauseGate } from "../shared";
import {
  POSE_IDS,
  extendPoseSequence,
  goobySaysPayout,
  isPoseId,
  roundRuleFor,
  shuffledPoseColors,
  verifyPoseInput,
  type PoseRoundRule,
  type PoseId,
  type SaysDifficulty,
} from "./logic";

export const manifest: MinigameManifest = validateMinigameManifest({
  id: "gooby-says",
  title: { en: "Gooby Says", de: "Gooby sagt" },
  instructions: {
    en: "Remember Gooby’s gestures and repeat the sequence.",
    de: "Merke dir Goobys Gesten und wiederhole die Reihenfolge.",
  },
  icon: "♪",
  category: "puzzle",
  stage3d: false,
  unlockLevel: 3,
  audioCues: ["go", "hit", "miss", "combo", "countdown", "score", "lose", "win"],
  tutorial: [
    {
      icon: "♪",
      title: { en: "Watch eight poses", de: "Sieh acht Posen" },
      body: {
        en: "Watch and listen, then repeat Gooby’s growing sequence with taps or keys 1–8.",
        de: "Sieh und hör zu, dann wiederhole Goobys wachsende Folge per Tippen oder mit den Tasten 1–8.",
      },
    },
    {
      icon: "↔",
      title: { en: "Expert opposites", de: "Gegenteile für Profis" },
      body: {
        en: "Expert mode clearly announces opposite rounds: answer every shown pose with its paired opposite.",
        de: "Der Profimodus kündigt Gegenrunden klar an: Antworte auf jede gezeigte Pose mit ihrem Gegenstück.",
      },
    },
    {
      icon: "♡",
      title: { en: "Practice freely", de: "Übe frei" },
      body: {
        en: "Practice uses the full game but never pays coins or XP and never changes your best.",
        de: "Im Üben spielst du das ganze Spiel, erhältst aber keine Münzen oder EP und änderst deinen Rekord nicht.",
      },
    },
  ],
});

export const definition = {
  id: manifest.id,
  title: manifest.title.en,
  instructions: manifest.instructions.en,
  create: (): MinigameModule => new GoobySaysGame(),
} as const satisfies MinigameStubDefinition & { readonly create: () => MinigameModule };

type Phase = "unmounted" | "tutorial" | "running" | "paused" | "ended" | "disposed";
type PlayMode =
  | "announce"
  | "challenge"
  | "opposite"
  | "playback-on"
  | "playback-gap"
  | "input"
  | "round-complete"
  | "mistake";

const DEFAULT_COLORS: Readonly<Record<PoseId, number>> = {
  wave: 0,
  hop: 1,
  wiggle: 2,
  clap: 3,
  freeze: 4,
  stretch: 5,
  curl: 6,
  stomp: 7,
};
const COLORS = [
  "#ff738d",
  "#56cfa6",
  "#6eaff7",
  "#a982ef",
  "#f2a64e",
  "#58c3cc",
  "#ec77ba",
  "#8ebf55",
] as const;
const POSE_COPY: Readonly<Record<PoseId, { readonly icon: string; readonly title: string; readonly subtitle: string }>> = {
  wave: { icon: "ʕ•ᴥ•ʔﾉ", title: "WAVE", subtitle: "Hello!" },
  hop: { icon: "↟ ʕ•ᴥ•ʔ", title: "HOP", subtitle: "Boing!" },
  wiggle: { icon: "≈ʕ•ᴥ•ʔ≈", title: "WIGGLE", subtitle: "Shimmy!" },
  clap: { icon: "👏ʕ•ᴥ•ʔ👏", title: "CLAP", subtitle: "Clap!" },
  freeze: { icon: "❄ ʕ•ᴥ•ʔ", title: "FREEZE", subtitle: "Still!" },
  stretch: { icon: "↔ ʕ•ᴥ•ʔ ↔", title: "STRETCH", subtitle: "Wide!" },
  curl: { icon: "◖ʕ•ᴥ•ʔ◗", title: "CURL", subtitle: "Small!" },
  stomp: { icon: "↓ ʕ•ᴥ•ʔ ↓", title: "STOMP", subtitle: "Boom!" },
};

interface InjectedMinigameContext extends MinigameContext {
  readonly lifecycle: MinigameLifecycle;
  readonly audio?: {
    emit(action: MinigameSoundAction, value?: number): void;
  };
  readonly reducedMotion?: boolean;
}

export class GoobySaysGame implements MinigameModule {
  readonly id = definition.id;
  readonly title = definition.title;
  readonly instructions = definition.instructions;

  private context: MinigameContext | null = null;
  private root: HTMLElement | null = null;
  private abortController: AbortController | null = null;
  private session: MinigameRunSession | null = null;
  private injected: InjectedMinigameContext | null = null;
  private readonly scheduled = new Set<number>();
  private phase: Phase = "unmounted";
  private mode: PlayMode = "announce";
  private sequence: readonly PoseId[] = [];
  private round = 0;
  private completedRounds = 0;
  private inputIndex = 0;
  private playbackIndex = 0;
  private modeTimer = 0;
  private activePose: PoseId | null = null;
  private colorMap: Readonly<Record<PoseId, number>> = DEFAULT_COLORS;
  private score = 0;
  private best = 0;
  private finished = false;
  private difficulty: SaysDifficulty = 2;
  private roundRule: PoseRoundRule = "normal";
  private practice = false;
  private readonly pauseGate = new PauseGate();

  mount(context: MinigameContext): void {
    if (this.phase !== "unmounted" && this.phase !== "disposed") this.dispose();
    if (!context.lifecycle) throw new Error("Gooby Says requires the minigame lifecycle");
    this.context = context;
    this.injected = context as InjectedMinigameContext;
    this.session = new MinigameRunSession(context.lifecycle);
    this.best = this.session.persistedBest;
    this.finished = false;
    this.abortController = new AbortController();
    const root = document.createElement("section");
    root.className = "gooby-says";
    root.classList.toggle("reduced-motion", this.injected.reducedMotion === true);
    root.dataset.minigame = this.id;
    root.tabIndex = 0;
    root.innerHTML = this.markup();
    root.addEventListener("click", this.onClick, { signal: this.abortController.signal });
    root.addEventListener("keydown", this.onKeyDown, { signal: this.abortController.signal });
    context.mount.replaceChildren(root);
    this.root = root;
    this.phase = "tutorial";
    this.render();
  }

  start(): void {
    if (this.phase === "unmounted" || this.phase === "disposed") return;
    this.phase = "tutorial";
    this.showPanel("tutorial");
  }

  pause(): void {
    if (this.phase !== "running") return;
    this.pauseGate.pause();
    this.phase = "paused";
    this.showPanel("pause");
  }

  resume(): void {
    if (this.phase !== "paused") return;
    this.pauseGate.resume();
    this.phase = "running";
    this.showPanel(null);
  }

  update(deltaSeconds: number): void {
    if (this.phase !== "running" || !this.context || !this.root) return;
    const requested = Math.min(0.1, Math.max(0, Number.isFinite(deltaSeconds) ? deltaSeconds : 0));
    const delta = this.pauseGate.filter(requested);
    this.root.dataset.clock = String(this.context.clock.now());
    if (this.mode === "input") return;
    this.modeTimer = Math.max(0, this.modeTimer - delta);
    if (this.modeTimer > 0) return;

    if (this.mode === "announce" || this.mode === "challenge" || this.mode === "opposite") {
      this.startPlaybackCue(0);
      return;
    }
    if (this.mode === "playback-on") {
      this.activePose = null;
      this.mode = "playback-gap";
      this.modeTimer = Math.max(0.11, 0.22 - this.round * 0.006);
      this.render();
      return;
    }
    if (this.mode === "playback-gap") {
      const nextIndex = this.playbackIndex + 1;
      if (nextIndex < this.sequence.length) {
        this.startPlaybackCue(nextIndex);
      } else {
        this.mode = "input";
        this.inputIndex = 0;
        this.flash("YOUR TURN!", "turn");
        this.render();
      }
      return;
    }
    if (this.mode === "round-complete") {
      this.beginNextRound();
      return;
    }
    if (this.mode === "mistake") this.finishGame();
  }

  payout(): MinigamePayout {
    return goobySaysPayout(this.score, this.completedRounds, this.practice);
  }

  dispose(): void {
    this.abortController?.abort();
    this.abortController = null;
    for (const timeout of this.scheduled) window.clearTimeout(timeout);
    this.scheduled.clear();
    this.session?.exit();
    this.session = null;
    this.root?.remove();
    this.root = null;
    this.context = null;
    this.injected = null;
    this.sequence = [];
    this.activePose = null;
    this.pauseGate.dispose();
    this.phase = "disposed";
  }

  private beginGame(difficulty = this.difficulty, practice = false): void {
    if (!this.context || !this.root) return;
    this.pauseGate.resume();
    this.difficulty = difficulty;
    this.practice = practice;
    if (practice) this.session?.exit();
    else this.session?.begin();
    this.sequence = [];
    this.round = 0;
    this.completedRounds = 0;
    this.inputIndex = 0;
    this.playbackIndex = 0;
    this.colorMap = DEFAULT_COLORS;
    this.roundRule = "normal";
    this.score = 0;
    this.finished = false;
    this.phase = "running";
    this.root.dataset.startedAt = String(this.context.clock.now());
    this.root.dataset.difficulty = String(difficulty);
    this.root.dataset.practice = String(practice);
    this.showPanel(null);
    this.emitFeedback("go");
    this.beginNextRound();
  }

  private beginNextRound(): void {
    if (!this.context || !this.root) return;
    this.round += 1;
    this.sequence = extendPoseSequence(this.sequence, this.context.rng, this.difficulty);
    this.roundRule = roundRuleFor(this.difficulty, this.round);
    this.inputIndex = 0;
    this.activePose = null;
    if (this.round >= 7) {
      this.colorMap = shuffledPoseColors(this.context.rng, this.colorMap);
    }
    this.mode = this.roundRule === "opposite"
      ? "opposite"
      : this.round === 7
        ? "challenge"
        : "announce";
    this.modeTimer = this.mode === "announce" ? 1.05 : 2.3;
    this.flash(
      this.roundRule === "opposite"
        ? "OPPOSITE ROUND! DO THE PAIR!"
        : this.round === 7
          ? "COLOR-SWAP CHALLENGE!"
          : `ROUND ${this.round}`,
      this.roundRule === "opposite" ? "opposite" : this.round === 7 ? "challenge" : "round",
    );
    if (this.roundRule === "opposite") {
      this.emitFeedback("score", this.round);
    } else if (this.round === 7) {
      this.emitFeedback("combo", this.completedRounds);
    }
    this.render();
  }

  private startPlaybackCue(index: number): void {
    const pose = this.sequence[index];
    if (!pose) return;
    this.playbackIndex = index;
    this.activePose = pose;
    this.mode = "playback-on";
    this.modeTimer = Math.max(0.27, 0.68 - this.round * 0.035);
    this.emitFeedback("countdown");
    this.render();
  }

  private inputPose(pose: PoseId): void {
    if (this.phase !== "running" || this.mode !== "input") return;
    this.session?.markAction();
    const result = verifyPoseInput(this.sequence, this.inputIndex, pose, this.roundRule);
    this.activePose = pose;
    this.schedule(() => {
      if (this.mode === "input" && this.activePose === pose) {
        this.activePose = null;
        this.render();
      }
    }, 180);

    if (result.status === "mistake") {
      this.mode = "mistake";
      this.modeTimer = 0.85;
      this.flash(`OOPS! GOOBY DID ${POSE_COPY[result.expected].title}`, "bad");
      this.emitFeedback("miss");
      this.render();
      return;
    }

    this.inputIndex = result.nextIndex;
    this.score += 35 * this.round;
    if (result.status === "round-complete") {
      this.completedRounds = this.round;
      this.score += 140 * this.round;
      this.mode = "round-complete";
      this.modeTimer = 1.05;
      this.activePose = null;
      this.flash(`PERFECT ROUND ${this.round}!`, "good");
      this.confetti();
      this.emitFeedback("combo", this.completedRounds);
    } else {
      this.emitFeedback("hit");
    }
    this.render();
  }

  private readonly onClick = (event: MouseEvent): void => {
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-action],[data-pose]") : null;
    if (!target) return;
    const action = target.dataset.action;
    if (action === "begin" || action === "again") {
      this.beginGame();
      return;
    }
    if (action === "begin-gentle") {
      this.beginGame(1);
      return;
    }
    if (action === "begin-expert") {
      this.beginGame(3);
      return;
    }
    if (action === "begin-practice") {
      this.beginGame(3, true);
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
      this.finishGame("quit");
      return;
    }
    const pose = target.dataset.pose;
    if (pose && isPoseId(pose)) {
      this.inputPose(pose);
    }
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.repeat) return;
    const key = event.key.toLowerCase();
    if (key === "escape" || key === "p") {
      if (this.phase !== "running" && this.phase !== "paused") return;
      event.preventDefault();
      if (this.phase === "paused") this.resume();
      else this.pause();
      return;
    }
    if (this.phase !== "running" || this.mode !== "input" || !/^[1-8]$/u.test(key)) return;
    const pose = POSE_IDS[Number(key) - 1];
    if (!pose) return;
    event.preventDefault();
    this.inputPose(pose);
  };

  private finishGame(outcome: "win" | "lose" | "quit" = "lose"): void {
    if (this.finished || !this.context || !this.root) return;
    this.finished = true;
    this.phase = "ended";
    this.activePose = null;
    const payout = this.payout();
    const previousBest = this.session?.persistedBest ?? this.best;
    let receipt: MinigameSettlementReceipt | null = null;
    if (this.practice) {
      this.session?.exit();
    } else {
      receipt = outcome === "quit"
        ? this.session?.quit(payout) ?? null
        : this.session?.complete(payout) ?? null;
    }
    this.best = receipt?.bestScore ?? previousBest;
    const panel = this.root.querySelector<HTMLElement>('[data-panel="result"]');
    const title = panel?.querySelector("h2");
    const score = panel?.querySelector<HTMLElement>("[data-result-score]");
    const reward = panel?.querySelector<HTMLElement>("[data-result-reward]");
    const best = panel?.querySelector<HTMLElement>("[data-result-best]");
    if (title) title.textContent = outcome === "quit" ? "Show wrapped!" : "What a memory!";
    if (score) score.textContent = payout.score.toLocaleString();
    if (reward) {
      reward.textContent = this.practice
        ? "Practice complete · no coins or XP"
        : receipt
        ? `+${payout.coins} coins  ·  +${payout.xp} XP`
        : "No poses entered · no reward";
    }
    if (best) best.textContent = `Best ${this.best.toLocaleString()} · ${this.completedRounds} rounds cleared`;
    this.showPanel("result");
    if (receipt || this.practice) this.emitFeedback(outcome === "lose" ? "lose" : "win");
  }

  private render(): void {
    if (!this.root) return;
    const round = this.root.querySelector<HTMLElement>("[data-round]");
    const score = this.root.querySelector<HTMLElement>("[data-score]");
    const status = this.root.querySelector<HTMLElement>("[data-status]");
    const dots = this.root.querySelector<HTMLElement>("[data-sequence]");
    const challenge = this.root.querySelector<HTMLElement>("[data-challenge]");
    const opposite = this.root.querySelector<HTMLElement>("[data-opposite]");
    if (round) round.textContent = String(this.round);
    if (score) score.textContent = Math.floor(this.score).toLocaleString();
    if (status) {
      status.textContent = this.mode === "input"
        ? `${this.roundRule === "opposite" ? "DO OPPOSITES" : "YOUR TURN"} · ${this.inputIndex}/${this.sequence.length}`
        : this.mode.startsWith("playback")
          ? `WATCH GOOBY · ${this.playbackIndex + 1}/${this.sequence.length}`
          : this.mode === "challenge"
            ? "COLORS ARE SWAPPING!"
            : this.mode === "opposite"
              ? "OPPOSITE ROUND!"
            : "GET READY";
      status.classList.toggle("your-turn", this.mode === "input");
    }
    if (dots) {
      const visible = this.sequence.slice(-12);
      dots.innerHTML = visible.map((_, index) => {
        const sequenceIndex = Math.max(0, this.sequence.length - 12) + index;
        const complete = this.mode === "input" && sequenceIndex < this.inputIndex;
        const active = this.mode === "playback-on" && sequenceIndex === this.playbackIndex;
        return `<i class="${complete ? "complete" : ""} ${active ? "active" : ""}"></i>`;
      }).join("");
    }
    if (challenge) challenge.hidden = this.round < 7;
    if (opposite) opposite.hidden = this.roundRule !== "opposite";
    for (const pose of POSE_IDS) {
      const pad = this.root.querySelector<HTMLElement>(`[data-pose="${pose}"]`);
      if (!pad) continue;
      pad.style.setProperty("--pad-color", COLORS[this.colorMap[pose]] ?? COLORS[0]);
      pad.classList.toggle("active", this.activePose === pose);
      pad.classList.toggle("locked", this.mode !== "input" && this.mode !== "playback-on");
      pad.setAttribute("aria-label", `${POSE_COPY[pose].title} pose`);
      pad.setAttribute("aria-keyshortcuts", String(POSE_IDS.indexOf(pose) + 1));
    }
  }

  private showPanel(name: "tutorial" | "pause" | "result" | null): void {
    if (!this.root) return;
    for (const panel of this.root.querySelectorAll<HTMLElement>("[data-panel]")) {
      panel.hidden = panel.dataset.panel !== name;
    }
  }

  private flash(
    text: string,
    kind: "round" | "challenge" | "opposite" | "turn" | "good" | "bad",
  ): void {
    if (!this.root) return;
    const flash = this.root.querySelector<HTMLElement>("[data-flash]");
    if (!flash) return;
    flash.textContent = text;
    flash.className = `says-flash ${kind} active`;
    this.schedule(
      () => flash.classList.remove("active"),
      kind === "challenge" || kind === "opposite" ? 2_100 : 760,
    );
  }

  private confetti(): void {
    if (!this.root || this.injected?.reducedMotion === true) return;
    const layer = this.root.querySelector<HTMLElement>("[data-particles]");
    if (!layer) return;
    for (let index = 0; index < 24; index += 1) {
      const particle = document.createElement("i");
      particle.style.background = COLORS[index % COLORS.length] ?? COLORS[0];
      particle.style.setProperty("--x", `${(index % 2 === 0 ? -1 : 1) * (35 + (index % 7) * 23)}px`);
      particle.style.setProperty("--y", `${-65 - (index % 6) * 23}px`);
      particle.style.setProperty("--r", `${index * 47}deg`);
      layer.append(particle);
      this.schedule(() => particle.remove(), 950);
    }
  }

  private schedule(callback: () => void, delayMs: number): void {
    const timeout = window.setTimeout(() => {
      this.scheduled.delete(timeout);
      callback();
    }, delayMs);
    this.scheduled.add(timeout);
  }

  private emitFeedback(action: MinigameSoundAction, value?: number): void {
    this.injected?.audio?.emit(action, value);
  }

  private markup(): string {
    const pads = POSE_IDS.map((pose) => {
      const copy = POSE_COPY[pose];
      return `<button class="pose-pad ${pose}" data-pose="${pose}" style="--pad-color:${COLORS[DEFAULT_COLORS[pose]]}"><span>${copy.icon}</span><strong>${copy.title}</strong><small>${copy.subtitle}</small><i></i></button>`;
    }).join("");
    return `
      <style>${saysStyles}</style>
      <div class="stage-bg" aria-hidden="true"><i></i><i></i><i></i></div>
      <header class="says-hud">
        <div><small>ROUND</small><strong data-round>0</strong></div>
        <div class="status-pill" data-status>GET READY</div>
        <div><small>SCORE</small><strong data-score>0</strong></div>
        <button class="pause-button" data-action="pause" aria-label="Pause">Ⅱ</button>
      </header>
      <div class="challenge-ribbon" data-challenge hidden>⚡ COLOR-SWAP CHALLENGE · FOLLOW POSES + SOUNDS ⚡</div>
      <div class="opposite-ribbon" data-opposite hidden>↔ OPPOSITE ROUND · ANSWER WITH THE PAIRED POSE ↔</div>
      <main class="says-stage">
        <div class="marquee"><b>G</b><b>O</b><b>O</b><b>B</b><b>Y</b><span>SAYS!</span></div>
        <div class="sequence-dots" data-sequence aria-label="Sequence progress"></div>
        <div class="pad-grid">${pads}</div>
        <div class="stage-lights" aria-hidden="true"><i></i><i></i><i></i></div>
      </main>
      <div class="says-flash" data-flash role="status"></div>
      <div class="says-particles" data-particles aria-hidden="true"></div>
      <section class="says-panel" data-panel="tutorial">
        <div class="panel-card">
          <span class="eyebrow">MEMORY SHOWTIME</span><h1>Gooby<br><em>Says!</em></h1>
          <p>Watch Gooby perform, listen to each note, then repeat with eight clear pose icons.</p>
          <div class="pose-tutorial">
            ${POSE_IDS.map((pose) => `<div><span>${POSE_COPY[pose].icon}</span><b>${POSE_COPY[pose].title}</b></div>`).join("")}
          </div>
          <div class="swap-tip"><b>EXPERT: OPPOSITES!</b><span>Every third round has a unique banner and asks for paired opposite poses.</span></div>
          <button class="primary" data-action="begin">START THE SHOW · 6 POSES</button>
          <div class="mode-buttons"><button data-action="begin-gentle">GENTLE · 4</button><button data-action="begin-expert">EXPERT · 8 + OPPOSITES</button></div>
          <button class="secondary" data-action="begin-practice">PRACTICE · 8 · NO REWARDS</button>
          <button class="secondary" data-action="quit">QUIT TUTORIAL</button>
        </div>
      </section>
      <section class="says-panel" data-panel="pause" hidden>
        <div class="panel-card compact"><span class="eyebrow">INTERMISSION</span><h2>Paused</h2><p>Your sequence is safe.</p><button class="primary" data-action="resume">CONTINUE SHOW</button><button class="secondary" data-action="quit">LEAVE THE STAGE</button></div>
      </section>
      <section class="says-panel" data-panel="result" hidden>
        <div class="panel-card compact result"><span class="memory-medal">★</span><h2>What a memory!</h2><strong class="big-score" data-result-score>0</strong><small>FINAL SCORE</small><p data-result-reward>+0 coins · +0 XP</p><div class="best-line" data-result-best>Best 0</div><button class="primary" data-action="again">ENCORE!</button></div>
      </section>
    `;
  }
}

export const createGoobySays = (): MinigameModule => new GoobySaysGame();

const saysStyles = `
  .gooby-says{position:relative;isolation:isolate;width:100%;height:100%;min-height:620px;padding-bottom:env(safe-area-inset-bottom);overflow:hidden;color:#33314b;background:#31285d;font-family:Nunito,ui-rounded,"Arial Rounded MT Bold",system-ui,sans-serif;touch-action:manipulation;user-select:none}.gooby-says *{box-sizing:border-box}.gooby-says button{min-width:44px;min-height:44px;font:inherit}.gooby-says button:focus-visible{outline:3px solid #fff;outline-offset:3px}
  .stage-bg{position:absolute;inset:0;background:radial-gradient(circle at 50% 38%,#7555a9 0 5%,transparent 36%),linear-gradient(#32265c 0 64%,#19172c 64%)}.stage-bg:before,.stage-bg:after{content:"";position:absolute;top:0;width:34%;height:75%;background:linear-gradient(90deg,#b74073,#722a64);clip-path:polygon(0 0,100% 0,70% 100%,0 88%)}.stage-bg:before{left:0}.stage-bg:after{right:0;transform:scaleX(-1)}.stage-bg>i{position:absolute;top:-12%;width:17%;height:70%;background:linear-gradient(#fff0,#ffeaa966);clip-path:polygon(40% 0,60% 0,100% 100%,0 100%);transform-origin:top;animation:lightSweep 4s ease-in-out infinite}.stage-bg>i:nth-child(1){left:10%;transform:rotate(15deg)}.stage-bg>i:nth-child(2){left:42%;animation-delay:-1.5s}.stage-bg>i:nth-child(3){right:8%;transform:rotate(-15deg);animation-delay:-3s}
  .says-hud{position:absolute;z-index:18;top:max(12px,env(safe-area-inset-top));left:12px;right:12px;display:grid;grid-template-columns:65px 1fr 78px 44px;gap:7px;align-items:center}.says-hud>div{height:44px;display:grid;place-content:center;text-align:center;border:2px solid #ffffff55;border-radius:14px;color:#fff;background:#201a41cc;box-shadow:0 5px 0 #15102c}.says-hud small{display:block;color:#cdbbea;font-size:8px;font-weight:1000;letter-spacing:.13em}.says-hud strong{font-size:19px}.status-pill{padding:0 4px;color:#e4dff5!important;font-size:10px;font-weight:1000;letter-spacing:.05em}.status-pill.your-turn{color:#332d39!important;background:#ffe875!important;box-shadow:0 5px 0 #bf9639}.pause-button{width:44px;height:44px;border:2px solid #fff7;border-radius:50%;color:#fff;background:#211a44;box-shadow:0 4px 0 #120d2c;font-weight:1000;cursor:pointer}
  .challenge-ribbon{position:absolute;z-index:17;top:67px;left:0;right:0;padding:7px;text-align:center;color:#4b316b;background:#ffe66f;border-block:2px solid #fff;font-size:9px;font-weight:1000;letter-spacing:.06em;animation:challengeGlow .7s infinite alternate}.challenge-ribbon[hidden]{display:none}
  .opposite-ribbon{position:absolute;z-index:19;top:67px;left:0;right:0;padding:8px;text-align:center;color:#fff;background:#d63e6f;border-block:3px double #fff;font-size:9px;font-weight:1000;letter-spacing:.06em}.opposite-ribbon[hidden]{display:none}
  .says-stage{position:absolute;inset:74px 0 0}.marquee{position:absolute;left:50%;top:2%;transform:translateX(-50%);display:flex;align-items:center;gap:2px;padding:5px 14px 5px 8px;border:3px solid #ffe794;border-radius:18px;background:#241c4d;box-shadow:0 0 25px #ffdf7b66;white-space:nowrap}.marquee b{display:grid;place-items:center;width:25px;height:29px;border-radius:8px;color:#fff;background:#e85980;font-size:17px}.marquee b:nth-child(2){background:#61cba6}.marquee b:nth-child(3){background:#6cb3f7}.marquee b:nth-child(4){background:#a985e9}.marquee b:nth-child(5){background:#ef9a52}.marquee span{margin-left:4px;color:#ffe58c;font-size:13px;font-weight:1000}
  .sequence-dots{position:absolute;z-index:4;left:50%;top:13%;transform:translateX(-50%);display:flex;justify-content:center;gap:5px;width:90%}.sequence-dots i{width:8px;height:8px;border:2px solid #d8c9f0;border-radius:50%;background:#332757;transition:.15s}.sequence-dots i.active{transform:scale(1.45);background:#fff;box-shadow:0 0 12px #fff}.sequence-dots i.complete{border-color:#ffe56c;background:#ffe56c}
  .pad-grid{position:absolute;z-index:7;left:6%;right:6%;top:18%;bottom:7%;display:grid;grid-template-columns:1fr 1fr;grid-template-rows:repeat(4,1fr);gap:9px}.pose-pad{position:relative;overflow:hidden;border:4px solid #ffffffc9;border-radius:22px;color:#fff;background:linear-gradient(145deg,color-mix(in srgb,var(--pad-color) 75%,white),var(--pad-color));box-shadow:inset -10px -12px #31245b28,0 7px 0 color-mix(in srgb,var(--pad-color) 57%,#2e2450),0 12px 20px #17102f77;cursor:pointer;transition:transform .13s,filter .13s}.pose-pad:active,.pose-pad.active{transform:translateY(5px) scale(.97);filter:brightness(1.35);box-shadow:inset 0 0 35px #fff,0 3px 0 color-mix(in srgb,var(--pad-color) 57%,#2e2450),0 0 34px var(--pad-color)}.pose-pad.active:after{content:"";position:absolute;inset:0;border-radius:inherit;background:#fff;animation:padFlash .35s ease-out}.pose-pad.locked{cursor:default}.pose-pad>span,.pose-pad>strong,.pose-pad>small{position:relative;z-index:2;display:block}.pose-pad>span{font-size:17px;white-space:nowrap;filter:drop-shadow(0 3px #35285f44);animation:poseIdle 2s ease-in-out infinite}.pose-pad>strong{margin-top:2px;font-size:13px;letter-spacing:.07em;text-shadow:0 2px #45315b66}.pose-pad>small{font-size:8px;font-weight:900;opacity:.82}.pose-pad>i{position:absolute;right:-20px;bottom:-25px;width:85px;height:85px;border:10px solid #fff3;border-radius:50%}.pose-pad.hop>span{animation-delay:-.5s}.pose-pad.wiggle>span{animation-delay:-1s}.pose-pad.clap>span{animation-delay:-1.5s}
  .stage-lights{position:absolute;z-index:2;inset:auto 0 0;height:22px;background:#ffe8a5}.stage-lights i{display:inline-block;width:33%;height:100%;border-radius:50%;background:#fff6d7;box-shadow:0 0 28px #ffeaa5}
  .says-flash{position:absolute;z-index:27;left:50%;top:33%;transform:translate(-50%,-50%) scale(.5);padding:9px 14px;border:3px solid #fff;border-radius:14px;opacity:0;color:#fff;background:#5b48a1;font-size:20px;font-weight:1000;white-space:nowrap;pointer-events:none}.says-flash.active{animation:flash .75s ease-out}.says-flash.challenge{color:#43325e;background:#ffe165}.says-flash.opposite{background:#d53e70;border-style:double}.says-flash.good{background:#54b880}.says-flash.bad{background:#e34d69}.says-flash.turn{color:#45345e;background:#fff}.says-particles{position:absolute;z-index:28;left:50%;top:48%;pointer-events:none}.says-particles i{position:absolute;width:11px;height:17px;border-radius:3px;animation:confetti .9s ease-out forwards}
  .says-panel{position:absolute;z-index:50;inset:0;display:grid;place-items:center;padding:max(22px,env(safe-area-inset-top)) max(22px,env(safe-area-inset-right)) max(22px,env(safe-area-inset-bottom)) max(22px,env(safe-area-inset-left));background:#17112ebf;backdrop-filter:blur(6px)}.says-panel[hidden]{display:none}.panel-card{width:min(100%,410px);padding:21px 18px 18px;border:4px solid #fff;border-radius:30px;text-align:center;background:linear-gradient(#fff,#f3ebff);box-shadow:0 14px 0 #261b53,0 25px 55px #100b236e;animation:panelIn .35s cubic-bezier(.2,1.4,.4,1)}.panel-card.compact{padding-top:32px}.eyebrow{display:inline-block;padding:5px 10px;border-radius:99px;color:#5e4588;background:#eadcff;font-size:9px;font-weight:1000;letter-spacing:.13em}.panel-card h1{margin:8px 0;font-size:40px;line-height:.82;letter-spacing:-.06em;color:#4e3c82}.panel-card h1 em{color:#e3547c;font-style:normal}.panel-card h2{margin:7px;color:#4b3c6b;font-size:33px}.panel-card p{margin:7px auto 10px;max-width:320px;color:#716886;font-size:12px;line-height:1.3}.pose-tutorial{display:grid;grid-template-columns:repeat(4,1fr);gap:5px}.pose-tutorial>div{padding:5px 2px;border-radius:10px;background:#fff}.pose-tutorial span,.pose-tutorial b{display:block}.pose-tutorial span{height:20px;overflow:hidden;font-size:10px}.pose-tutorial b{font-size:7px;color:#735b99}.swap-tip{display:flex;align-items:center;gap:8px;margin:9px 0;padding:7px;border-radius:12px;text-align:left;background:#ffe77f}.swap-tip b{font-size:9px;color:#7b3b74}.swap-tip span{font-size:9px;color:#66543b}.mode-buttons{display:grid;grid-template-columns:1fr 1.5fr;gap:7px;margin-top:9px}.mode-buttons button{border:2px solid #cdbce7;border-radius:13px;color:#5d4778;background:#f8f3ff;font-size:9px;font-weight:1000}.primary,.secondary{width:100%;min-height:50px;border-radius:16px;font-weight:1000;letter-spacing:.04em;cursor:pointer}.primary{border:0;color:#fff;background:linear-gradient(#a77be3,#7954bd);box-shadow:0 6px 0 #503681}.primary:active{transform:translateY(4px);box-shadow:0 2px 0 #503681}.secondary{margin-top:9px;border:2px solid #cdbce7;color:#67547d;background:#fff}.memory-medal{display:grid;place-items:center;width:70px;height:70px;margin:-63px auto 8px;border:5px solid #fff;border-radius:50%;color:#4f3977;background:#ffe16d;box-shadow:0 7px #bd9435;font-size:38px}.big-score{display:block;color:#e1547b;font-size:48px;line-height:1}.result>small{font-size:9px;font-weight:1000;letter-spacing:.15em;color:#9383a8}.best-line{margin:0 0 17px;padding:10px;border-radius:12px;background:#eee5fb;font-size:11px;font-weight:900;color:#66567b}
  @keyframes lightSweep{50%{transform:rotate(17deg)}}@keyframes challengeGlow{to{box-shadow:0 0 25px #ffe86e}}@keyframes poseIdle{50%{transform:translateY(-6px) rotate(2deg)}}@keyframes padFlash{from{opacity:.75}to{opacity:0}}@keyframes flash{0%{opacity:0;transform:translate(-50%,-50%) scale(.5)}22%{opacity:1;transform:translate(-50%,-50%) scale(1.1)}78%{opacity:1}100%{opacity:0;transform:translate(-50%,-85%)}}@keyframes confetti{to{opacity:0;transform:translate(var(--x),var(--y)) rotate(var(--r))}}@keyframes panelIn{from{opacity:0;transform:scale(.82) translateY(20px)}}.gooby-says.reduced-motion *{animation-duration:1ms!important;transition-duration:1ms!important}@media(prefers-reduced-motion:reduce){.gooby-says *{animation-duration:1ms!important;transition-duration:1ms!important}}
  @media(max-height:700px){.gooby-says{min-height:500px}.says-hud{top:7px}.says-stage{inset:58px 0 0}.marquee{top:1%}.pad-grid{top:17%;bottom:4%;gap:9px}.pose-pad{border-radius:22px}.pose-pad>span{font-size:20px}.panel-card{padding:17px}.panel-card h1{font-size:35px}}
`;
