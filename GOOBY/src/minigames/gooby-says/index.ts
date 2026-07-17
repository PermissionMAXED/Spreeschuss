import type {
  MinigameContext,
  MinigameModule,
  MinigamePayout,
} from "../../core/contracts/minigame";
import type { MinigameStubDefinition } from "../stub";
import {
  POSE_IDS,
  extendPoseSequence,
  shuffledPoseColors,
  verifyPoseInput,
  type PoseId,
} from "./logic";

export const definition = {
  id: "gooby-says",
  title: "Gooby Says",
  instructions: "Watch four pose-and-sound pads, then repeat the growing sequence.",
  create: (): MinigameModule => new GoobySaysGame(),
} as const satisfies MinigameStubDefinition & { readonly create: () => MinigameModule };

type Phase = "unmounted" | "tutorial" | "running" | "paused" | "ended" | "disposed";
type PlayMode =
  | "announce"
  | "challenge"
  | "playback-on"
  | "playback-gap"
  | "input"
  | "round-complete"
  | "mistake";

const HIGH_SCORE_KEY = "gooby:minigame:gooby-says:best";
const DEFAULT_COLORS: Readonly<Record<PoseId, number>> = { wave: 0, hop: 1, wiggle: 2, clap: 3 };
const COLORS = ["#ff738d", "#56cfa6", "#6eaff7", "#a982ef"] as const;
const POSE_COPY: Readonly<Record<PoseId, { readonly icon: string; readonly title: string; readonly subtitle: string }>> = {
  wave: { icon: "ʕ•ᴥ•ʔﾉ", title: "WAVE", subtitle: "Hello!" },
  hop: { icon: "↟ ʕ•ᴥ•ʔ", title: "HOP", subtitle: "Boing!" },
  wiggle: { icon: "≈ʕ•ᴥ•ʔ≈", title: "WIGGLE", subtitle: "Shimmy!" },
  clap: { icon: "👏ʕ•ᴥ•ʔ👏", title: "CLAP", subtitle: "Clap!" },
};

class SaysAudio {
  private context: AudioContext | null = null;

  pose(pose: PoseId): void {
    const frequency: Readonly<Record<PoseId, number>> = {
      wave: 392,
      hop: 523.25,
      wiggle: 659.25,
      clap: 783.99,
    };
    this.notes([frequency[pose]], "sine");
  }

  effect(kind: "wrong" | "round" | "challenge" | "finish"): void {
    const notes = {
      wrong: [180, 125],
      round: [523, 659, 784],
      challenge: [392, 523, 659, 784, 988],
      finish: [659, 784, 1047],
    }[kind];
    this.notes(notes, kind === "wrong" ? "square" : "triangle");
  }

  dispose(): void {
    if (this.context) void this.context.close();
    this.context = null;
  }

  private notes(notes: readonly number[], type: OscillatorType): void {
    try {
      this.context ??= new AudioContext();
      const context = this.context;
      if (context.state === "suspended") void context.resume();
      notes.forEach((frequency, index) => {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        const at = context.currentTime + index * 0.06;
        oscillator.type = type;
        oscillator.frequency.setValueAtTime(frequency, at);
        gain.gain.setValueAtTime(0.0001, at);
        gain.gain.exponentialRampToValueAtTime(0.072, at + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.17);
        oscillator.connect(gain).connect(context.destination);
        oscillator.start(at);
        oscillator.stop(at + 0.18);
      });
    } catch (error: unknown) {
      void error;
    }
  }
}

function readBest(): number {
  try {
    return Number.parseInt(localStorage.getItem(HIGH_SCORE_KEY) ?? "0", 10) || 0;
  } catch (error: unknown) {
    void error;
    return 0;
  }
}

function writeBest(score: number): void {
  try {
    localStorage.setItem(HIGH_SCORE_KEY, String(score));
  } catch (error: unknown) {
    void error;
  }
}

function vibrate(pattern: readonly number[]): void {
  if (typeof navigator.vibrate === "function") navigator.vibrate(pattern);
}

export class GoobySaysGame implements MinigameModule {
  readonly id = definition.id;
  readonly title = definition.title;
  readonly instructions = definition.instructions;

  private context: MinigameContext | null = null;
  private root: HTMLElement | null = null;
  private abortController: AbortController | null = null;
  private readonly audio = new SaysAudio();
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

  mount(context: MinigameContext): void {
    if (this.phase !== "unmounted" && this.phase !== "disposed") this.dispose();
    this.context = context;
    this.best = readBest();
    this.abortController = new AbortController();
    const root = document.createElement("section");
    root.className = "gooby-says";
    root.dataset.minigame = this.id;
    root.innerHTML = this.markup();
    root.addEventListener("click", this.onClick, { signal: this.abortController.signal });
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
    this.phase = "paused";
    this.showPanel("pause");
  }

  resume(): void {
    if (this.phase !== "paused") return;
    this.phase = "running";
    this.showPanel(null);
  }

  update(deltaSeconds: number): void {
    if (this.phase !== "running" || !this.context || !this.root) return;
    const delta = Math.min(0.1, Math.max(0, Number.isFinite(deltaSeconds) ? deltaSeconds : 0));
    this.root.dataset.clock = String(this.context.clock.now());
    if (this.mode === "input") return;
    this.modeTimer = Math.max(0, this.modeTimer - delta);
    if (this.modeTimer > 0) return;

    if (this.mode === "announce" || this.mode === "challenge") {
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
    const score = Math.floor(this.score);
    return {
      score,
      coins: Math.max(1, Math.floor(score / 420) + this.completedRounds),
      xp: Math.max(2, Math.floor(score / 180) + this.completedRounds * 2),
    };
  }

  dispose(): void {
    this.abortController?.abort();
    this.abortController = null;
    for (const timeout of this.scheduled) window.clearTimeout(timeout);
    this.scheduled.clear();
    this.audio.dispose();
    this.root?.remove();
    this.root = null;
    this.context = null;
    this.sequence = [];
    this.activePose = null;
    this.phase = "disposed";
  }

  private beginGame(): void {
    if (!this.context || !this.root) return;
    this.sequence = [];
    this.round = 0;
    this.completedRounds = 0;
    this.inputIndex = 0;
    this.playbackIndex = 0;
    this.colorMap = DEFAULT_COLORS;
    this.score = 0;
    this.finished = false;
    this.phase = "running";
    this.root.dataset.startedAt = String(this.context.clock.now());
    this.showPanel(null);
    this.beginNextRound();
  }

  private beginNextRound(): void {
    if (!this.context || !this.root) return;
    this.round += 1;
    this.sequence = extendPoseSequence(this.sequence, this.context.rng);
    this.inputIndex = 0;
    this.activePose = null;
    if (this.round >= 7) {
      this.colorMap = shuffledPoseColors(this.context.rng, this.colorMap);
    }
    this.mode = this.round === 7 ? "challenge" : "announce";
    this.modeTimer = this.round === 7 ? 2.3 : 1.05;
    this.flash(
      this.round === 7 ? "COLOR-SWAP CHALLENGE!" : `ROUND ${this.round}`,
      this.round === 7 ? "challenge" : "round",
    );
    if (this.round === 7) {
      this.audio.effect("challenge");
      vibrate([25, 25, 25, 25, 70]);
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
    this.audio.pose(pose);
    this.render();
  }

  private inputPose(pose: PoseId): void {
    if (this.phase !== "running" || this.mode !== "input") return;
    const result = verifyPoseInput(this.sequence, this.inputIndex, pose);
    this.activePose = pose;
    this.audio.pose(pose);
    vibrate([14]);
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
      this.audio.effect("wrong");
      vibrate([90, 40, 90]);
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
      this.audio.effect("round");
      vibrate([18, 20, 18, 20, 55]);
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
    if (action === "pause") {
      this.pause();
      return;
    }
    if (action === "resume") {
      this.resume();
      return;
    }
    if (action === "quit") {
      this.finishGame(true);
      return;
    }
    const pose = target.dataset.pose;
    if (pose === "wave" || pose === "hop" || pose === "wiggle" || pose === "clap") {
      this.inputPose(pose);
    }
  };

  private finishGame(quit = false): void {
    if (this.finished || !this.context || !this.root) return;
    this.finished = true;
    this.phase = "ended";
    this.activePose = null;
    const payout = this.payout();
    if (payout.score > this.best) {
      this.best = payout.score;
      writeBest(this.best);
    }
    const panel = this.root.querySelector<HTMLElement>('[data-panel="result"]');
    const title = panel?.querySelector("h2");
    const score = panel?.querySelector<HTMLElement>("[data-result-score]");
    const reward = panel?.querySelector<HTMLElement>("[data-result-reward]");
    const best = panel?.querySelector<HTMLElement>("[data-result-best]");
    if (title) title.textContent = quit ? "Show wrapped!" : "What a memory!";
    if (score) score.textContent = payout.score.toLocaleString();
    if (reward) reward.textContent = `+${payout.coins} coins  ·  +${payout.xp} XP`;
    if (best) best.textContent = `Best ${this.best.toLocaleString()} · ${this.completedRounds} rounds cleared`;
    this.showPanel("result");
    this.audio.effect("finish");
    vibrate([30, 25, 80]);
    this.context.finish(payout);
  }

  private render(): void {
    if (!this.root) return;
    const round = this.root.querySelector<HTMLElement>("[data-round]");
    const score = this.root.querySelector<HTMLElement>("[data-score]");
    const status = this.root.querySelector<HTMLElement>("[data-status]");
    const dots = this.root.querySelector<HTMLElement>("[data-sequence]");
    const challenge = this.root.querySelector<HTMLElement>("[data-challenge]");
    if (round) round.textContent = String(this.round);
    if (score) score.textContent = Math.floor(this.score).toLocaleString();
    if (status) {
      status.textContent = this.mode === "input"
        ? `YOUR TURN · ${this.inputIndex}/${this.sequence.length}`
        : this.mode.startsWith("playback")
          ? `WATCH GOOBY · ${this.playbackIndex + 1}/${this.sequence.length}`
          : this.mode === "challenge"
            ? "COLORS ARE SWAPPING!"
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
    for (const pose of POSE_IDS) {
      const pad = this.root.querySelector<HTMLElement>(`[data-pose="${pose}"]`);
      if (!pad) continue;
      pad.style.setProperty("--pad-color", COLORS[this.colorMap[pose]] ?? COLORS[0]);
      pad.classList.toggle("active", this.activePose === pose);
      pad.classList.toggle("locked", this.mode !== "input" && this.mode !== "playback-on");
    }
  }

  private showPanel(name: "tutorial" | "pause" | "result" | null): void {
    if (!this.root) return;
    for (const panel of this.root.querySelectorAll<HTMLElement>("[data-panel]")) {
      panel.hidden = panel.dataset.panel !== name;
    }
  }

  private flash(text: string, kind: "round" | "challenge" | "turn" | "good" | "bad"): void {
    if (!this.root) return;
    const flash = this.root.querySelector<HTMLElement>("[data-flash]");
    if (!flash) return;
    flash.textContent = text;
    flash.className = `says-flash ${kind} active`;
    this.schedule(() => flash.classList.remove("active"), kind === "challenge" ? 2_100 : 760);
  }

  private confetti(): void {
    if (!this.root) return;
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
          <p>Watch Gooby perform, listen to each note, then tap the same pose sequence.</p>
          <div class="pose-tutorial">
            <div><span>ʕ•ᴥ•ʔﾉ</span><b>WAVE</b></div><div><span>↟ ʕ•ᴥ•ʔ</span><b>HOP</b></div><div><span>≈ʕ•ᴥ•ʔ≈</span><b>WIGGLE</b></div><div><span>👏</span><b>CLAP</b></div>
          </div>
          <div class="swap-tip"><b>ROUND 7: COLOR SWAP!</b><span>Pad colors shuffle. Trust the pose and sound.</span></div>
          <button class="primary" data-action="begin">START THE SHOW</button>
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
  .gooby-says{position:relative;isolation:isolate;width:100%;height:100%;min-height:620px;overflow:hidden;color:#33314b;background:#31285d;font-family:Nunito,ui-rounded,"Arial Rounded MT Bold",system-ui,sans-serif;touch-action:manipulation;user-select:none}.gooby-says *{box-sizing:border-box}.gooby-says button{font:inherit}
  .stage-bg{position:absolute;inset:0;background:radial-gradient(circle at 50% 38%,#7555a9 0 5%,transparent 36%),linear-gradient(#32265c 0 64%,#19172c 64%)}.stage-bg:before,.stage-bg:after{content:"";position:absolute;top:0;width:34%;height:75%;background:linear-gradient(90deg,#b74073,#722a64);clip-path:polygon(0 0,100% 0,70% 100%,0 88%)}.stage-bg:before{left:0}.stage-bg:after{right:0;transform:scaleX(-1)}.stage-bg>i{position:absolute;top:-12%;width:17%;height:70%;background:linear-gradient(#fff0,#ffeaa966);clip-path:polygon(40% 0,60% 0,100% 100%,0 100%);transform-origin:top;animation:lightSweep 4s ease-in-out infinite}.stage-bg>i:nth-child(1){left:10%;transform:rotate(15deg)}.stage-bg>i:nth-child(2){left:42%;animation-delay:-1.5s}.stage-bg>i:nth-child(3){right:8%;transform:rotate(-15deg);animation-delay:-3s}
  .says-hud{position:absolute;z-index:18;top:max(12px,env(safe-area-inset-top));left:12px;right:12px;display:grid;grid-template-columns:65px 1fr 78px 42px;gap:7px;align-items:center}.says-hud>div{height:44px;display:grid;place-content:center;text-align:center;border:2px solid #ffffff55;border-radius:14px;color:#fff;background:#201a41cc;box-shadow:0 5px 0 #15102c}.says-hud small{display:block;color:#cdbbea;font-size:8px;font-weight:1000;letter-spacing:.13em}.says-hud strong{font-size:19px}.status-pill{padding:0 4px;color:#e4dff5!important;font-size:10px;font-weight:1000;letter-spacing:.05em}.status-pill.your-turn{color:#332d39!important;background:#ffe875!important;box-shadow:0 5px 0 #bf9639}.pause-button{width:42px;height:42px;border:2px solid #fff7;border-radius:50%;color:#fff;background:#211a44;box-shadow:0 4px 0 #120d2c;font-weight:1000;cursor:pointer}
  .challenge-ribbon{position:absolute;z-index:17;top:67px;left:0;right:0;padding:7px;text-align:center;color:#4b316b;background:#ffe66f;border-block:2px solid #fff;font-size:9px;font-weight:1000;letter-spacing:.06em;animation:challengeGlow .7s infinite alternate}.challenge-ribbon[hidden]{display:none}
  .says-stage{position:absolute;inset:74px 0 0}.marquee{position:absolute;left:50%;top:2%;transform:translateX(-50%);display:flex;align-items:center;gap:2px;padding:5px 14px 5px 8px;border:3px solid #ffe794;border-radius:18px;background:#241c4d;box-shadow:0 0 25px #ffdf7b66;white-space:nowrap}.marquee b{display:grid;place-items:center;width:25px;height:29px;border-radius:8px;color:#fff;background:#e85980;font-size:17px}.marquee b:nth-child(2){background:#61cba6}.marquee b:nth-child(3){background:#6cb3f7}.marquee b:nth-child(4){background:#a985e9}.marquee b:nth-child(5){background:#ef9a52}.marquee span{margin-left:4px;color:#ffe58c;font-size:13px;font-weight:1000}
  .sequence-dots{position:absolute;z-index:4;left:50%;top:13%;transform:translateX(-50%);display:flex;justify-content:center;gap:5px;width:90%}.sequence-dots i{width:8px;height:8px;border:2px solid #d8c9f0;border-radius:50%;background:#332757;transition:.15s}.sequence-dots i.active{transform:scale(1.45);background:#fff;box-shadow:0 0 12px #fff}.sequence-dots i.complete{border-color:#ffe56c;background:#ffe56c}
  .pad-grid{position:absolute;z-index:7;left:6%;right:6%;top:18%;bottom:7%;display:grid;grid-template-columns:1fr 1fr;gap:13px}.pose-pad{position:relative;overflow:hidden;border:5px solid #ffffffc9;border-radius:29px;color:#fff;background:linear-gradient(145deg,color-mix(in srgb,var(--pad-color) 75%,white),var(--pad-color));box-shadow:inset -10px -12px #31245b28,0 9px 0 color-mix(in srgb,var(--pad-color) 57%,#2e2450),0 16px 25px #17102f77;cursor:pointer;transition:transform .13s,filter .13s}.pose-pad:active,.pose-pad.active{transform:translateY(6px) scale(.96);filter:brightness(1.35);box-shadow:inset 0 0 35px #fff,0 3px 0 color-mix(in srgb,var(--pad-color) 57%,#2e2450),0 0 34px var(--pad-color)}.pose-pad.active:after{content:"";position:absolute;inset:0;border-radius:inherit;background:#fff;animation:padFlash .35s ease-out}.pose-pad.locked{cursor:default}.pose-pad>span,.pose-pad>strong,.pose-pad>small{position:relative;z-index:2;display:block}.pose-pad>span{font-size:25px;white-space:nowrap;filter:drop-shadow(0 3px #35285f44);animation:poseIdle 2s ease-in-out infinite}.pose-pad>strong{margin-top:7px;font-size:19px;letter-spacing:.07em;text-shadow:0 2px #45315b66}.pose-pad>small{font-size:10px;font-weight:900;opacity:.82}.pose-pad>i{position:absolute;right:-20px;bottom:-25px;width:85px;height:85px;border:10px solid #fff3;border-radius:50%}.pose-pad.hop>span{animation-delay:-.5s}.pose-pad.wiggle>span{animation-delay:-1s}.pose-pad.clap>span{animation-delay:-1.5s}
  .stage-lights{position:absolute;z-index:2;inset:auto 0 0;height:22px;background:#ffe8a5}.stage-lights i{display:inline-block;width:33%;height:100%;border-radius:50%;background:#fff6d7;box-shadow:0 0 28px #ffeaa5}
  .says-flash{position:absolute;z-index:27;left:50%;top:33%;transform:translate(-50%,-50%) scale(.5);padding:9px 14px;border:3px solid #fff;border-radius:14px;opacity:0;color:#fff;background:#5b48a1;font-size:20px;font-weight:1000;white-space:nowrap;pointer-events:none}.says-flash.active{animation:flash .75s ease-out}.says-flash.challenge{color:#43325e;background:#ffe165}.says-flash.good{background:#54b880}.says-flash.bad{background:#e34d69}.says-flash.turn{color:#45345e;background:#fff}.says-particles{position:absolute;z-index:28;left:50%;top:48%;pointer-events:none}.says-particles i{position:absolute;width:11px;height:17px;border-radius:3px;animation:confetti .9s ease-out forwards}
  .says-panel{position:absolute;z-index:50;inset:0;display:grid;place-items:center;padding:22px;background:#17112ebf;backdrop-filter:blur(6px)}.says-panel[hidden]{display:none}.panel-card{width:min(100%,410px);padding:25px 20px 21px;border:4px solid #fff;border-radius:30px;text-align:center;background:linear-gradient(#fff,#f3ebff);box-shadow:0 14px 0 #261b53,0 25px 55px #100b236e;animation:panelIn .35s cubic-bezier(.2,1.4,.4,1)}.panel-card.compact{padding-top:32px}.eyebrow{display:inline-block;padding:5px 10px;border-radius:99px;color:#5e4588;background:#eadcff;font-size:9px;font-weight:1000;letter-spacing:.13em}.panel-card h1{margin:8px 0;font-size:44px;line-height:.82;letter-spacing:-.06em;color:#4e3c82}.panel-card h1 em{color:#e3547c;font-style:normal}.panel-card h2{margin:7px;color:#4b3c6b;font-size:33px}.panel-card p{margin:9px auto 15px;max-width:320px;color:#716886;line-height:1.35}.pose-tutorial{display:grid;grid-template-columns:1fr 1fr;gap:7px}.pose-tutorial>div{padding:8px 3px;border-radius:13px;background:#fff}.pose-tutorial span,.pose-tutorial b{display:block}.pose-tutorial span{height:24px;font-size:13px}.pose-tutorial b{font-size:9px;color:#735b99}.swap-tip{display:flex;align-items:center;gap:8px;margin:12px 0;padding:9px;border-radius:12px;text-align:left;background:#ffe77f}.swap-tip b{font-size:9px;color:#7b3b74}.swap-tip span{font-size:9px;color:#66543b}.primary,.secondary{width:100%;min-height:50px;border-radius:16px;font-weight:1000;letter-spacing:.04em;cursor:pointer}.primary{border:0;color:#fff;background:linear-gradient(#a77be3,#7954bd);box-shadow:0 6px 0 #503681}.primary:active{transform:translateY(4px);box-shadow:0 2px 0 #503681}.secondary{margin-top:11px;border:2px solid #cdbce7;color:#67547d;background:#fff}.memory-medal{display:grid;place-items:center;width:70px;height:70px;margin:-63px auto 8px;border:5px solid #fff;border-radius:50%;color:#4f3977;background:#ffe16d;box-shadow:0 7px #bd9435;font-size:38px}.big-score{display:block;color:#e1547b;font-size:48px;line-height:1}.result>small{font-size:9px;font-weight:1000;letter-spacing:.15em;color:#9383a8}.best-line{margin:0 0 17px;padding:10px;border-radius:12px;background:#eee5fb;font-size:11px;font-weight:900;color:#66567b}
  @keyframes lightSweep{50%{transform:rotate(17deg)}}@keyframes challengeGlow{to{box-shadow:0 0 25px #ffe86e}}@keyframes poseIdle{50%{transform:translateY(-6px) rotate(2deg)}}@keyframes padFlash{from{opacity:.75}to{opacity:0}}@keyframes flash{0%{opacity:0;transform:translate(-50%,-50%) scale(.5)}22%{opacity:1;transform:translate(-50%,-50%) scale(1.1)}78%{opacity:1}100%{opacity:0;transform:translate(-50%,-85%)}}@keyframes confetti{to{opacity:0;transform:translate(var(--x),var(--y)) rotate(var(--r))}}@keyframes panelIn{from{opacity:0;transform:scale(.82) translateY(20px)}}
  @media(max-height:700px){.gooby-says{min-height:500px}.says-hud{top:7px}.says-stage{inset:58px 0 0}.marquee{top:1%}.pad-grid{top:17%;bottom:4%;gap:9px}.pose-pad{border-radius:22px}.pose-pad>span{font-size:20px}.panel-card{padding:17px}.panel-card h1{font-size:35px}}
`;
