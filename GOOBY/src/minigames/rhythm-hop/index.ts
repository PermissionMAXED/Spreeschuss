import type {
  MinigameContext,
  MinigameModule,
  MinigamePayout,
  MinigameRunId,
} from "../../core/contracts/minigame";
import type { HapticPattern } from "../../core/contracts/platform";
import type { MinigameStubDefinition } from "../stub";
import { RHYTHM_BEATMAPS } from "./beatmaps";
import {
  RhythmBeatCueTransport,
  RhythmSession,
  rhythmPayout,
  type JudgmentEvent,
  type RhythmDifficulty,
  type RhythmJudgment,
  type RhythmLane,
  type RhythmSongId,
} from "./model";
import { RHYTHM_HOP_STYLES } from "./styles";

export const definition = {
  id: "rhythm-hop",
  title: "Rhythm Hop",
  instructions: "Hop across three lanes when each beat reaches Gooby.",
} as const satisfies MinigameStubDefinition;

type RhythmScreen = "tutorial" | "select" | "playing" | "results";
type SharedAudioAction = "hit" | "miss" | "combo" | "countdown" | "go" | "win" | "lose" | "score";

type RhythmContext = MinigameContext & {
  readonly audio?: { emit(action: SharedAudioAction, value?: number): void };
  readonly haptics?: { impact(pattern: HapticPattern): void };
  readonly reducedMotion?: boolean;
  readonly bestScore?: number;
};

const EMPTY_PAYOUT: MinigamePayout = { score: 0, coins: 0, xp: 0 };

const SONG_ORDER: readonly RhythmSongId[] = [
  "carrot-bounce",
  "puddle-pop",
  "moonhop-magic",
  "firefly-waltz",
  "dewdrop-derby",
];

export class RhythmHop implements MinigameModule {
  readonly id = definition.id;
  readonly title = definition.title;
  readonly instructions = definition.instructions;

  private context: RhythmContext | null = null;
  private root: HTMLElement | null = null;
  private shadow: ShadowRoot | null = null;
  private session: RhythmSession | null = null;
  private beatTransport: RhythmBeatCueTransport | null = null;
  private runId: MinigameRunId | null = null;
  private screen: RhythmScreen = "tutorial";
  private songId: RhythmSongId = "carrot-bounce";
  private difficulty: RhythmDifficulty = "easy";
  private tutorialPage = 0;
  private lane: RhythmLane = 1;
  private running = false;
  private paused = false;
  private finished = false;
  private feedback: RhythmJudgment | "ready" = "ready";
  private feedbackSeconds = 0;
  private wobbleUntilMs = 0;
  private highScore = 0;
  private previousBest = 0;
  private actionsTaken = 0;
  private completedSong = false;
  private finalScore = 0;
  private finalSparkles = 0;
  private finalPerfects = 0;
  private finalGoods = 0;
  private finalMisses = 0;
  private finalBestCombo = 0;
  private readonly heldKeys = new Map<string, RhythmLane>();
  private readonly heldPointers = new Map<number, RhythmLane>();
  private readonly laneHoldCounts: [number, number, number] = [0, 0, 0];

  private readonly handleClick = (event: Event): void => {
    this.onClick(event);
  };
  private readonly handleKeyDown = (event: Event): void => {
    this.onKeyDown(event as KeyboardEvent);
  };
  private readonly handleKeyUp = (event: Event): void => {
    this.onKeyUp(event as KeyboardEvent);
  };
  private readonly handlePointerDown = (event: Event): void => {
    this.onPointerDown(event as PointerEvent);
  };
  private readonly handlePointerUp = (event: Event): void => {
    this.onPointerUp(event as PointerEvent);
  };

  mount(context: MinigameContext): void {
    this.dispose();
    this.context = context;
    this.highScore = context.lifecycle?.persistedBest
      ?? this.context.bestScore
      ?? 0;
    this.previousBest = this.highScore;
    const root = context.mount.ownerDocument.createElement("section");
    root.setAttribute("aria-label", "Rhythm Hop");
    root.setAttribute("tabindex", "0");
    root.dataset.reducedMotion = String(this.context.reducedMotion === true);
    root.dataset.minigame = this.id;
    this.root = root;
    this.shadow = root.attachShadow({ mode: "open" });
    this.shadow.addEventListener("click", this.handleClick);
    this.shadow.addEventListener("pointerdown", this.handlePointerDown);
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
    if (this.screen !== "playing" || this.session?.state !== "playing") return;
    this.session.pause();
    this.running = false;
    this.paused = true;
    this.render();
  }

  resume(): void {
    if (this.screen !== "playing" || !this.paused || this.session === null) return;
    this.session.resume();
    this.paused = false;
    this.running = true;
    // Holds ride the frozen audio clock: any lane physically let go during the
    // pause is released now, at the exact song time where the pause began.
    for (const lane of this.session.heldLanes) {
      if (this.laneHoldCounts[lane] > 0) continue;
      const event = this.session.release(lane);
      if (event !== null) this.applyJudgment(event);
    }
    this.render();
    this.root?.focus();
  }

  update(deltaSeconds: number): void {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) {
      throw new RangeError("Rhythm Hop delta must be finite and non-negative");
    }
    if (!this.running || this.session === null) return;
    for (const cue of this.beatTransport?.drain(this.session) ?? []) {
      this.context?.audio?.emit("countdown", cue.beatIndex);
    }
    const events = this.session.update();
    for (const event of events) this.applyJudgment(event);
    if (this.session.state === "ended") {
      this.showResults(true);
      return;
    }
    if (this.feedbackSeconds > 0) {
      this.feedbackSeconds -= deltaSeconds;
      if (this.feedbackSeconds <= 0) this.shadow?.querySelector(".judgment")?.classList.remove("show");
    }
    this.updateTrack();
  }

  payout(): MinigamePayout {
    if (this.screen !== "results") return EMPTY_PAYOUT;
    return rhythmPayout(this.finalScore, this.finalBestCombo);
  }

  dispose(): void {
    this.context?.lifecycle?.exit();
    this.shadow?.removeEventListener("click", this.handleClick);
    this.shadow?.removeEventListener("pointerdown", this.handlePointerDown);
    this.shadow?.removeEventListener("pointerup", this.handlePointerUp);
    this.shadow?.removeEventListener("pointercancel", this.handlePointerUp);
    this.root?.removeEventListener("keydown", this.handleKeyDown);
    this.root?.removeEventListener("keyup", this.handleKeyUp);
    this.root?.remove();
    this.context = null;
    this.root = null;
    this.shadow = null;
    this.session = null;
    this.beatTransport = null;
    this.runId = null;
    this.running = false;
    this.paused = false;
    this.feedbackSeconds = 0;
    this.clearHeldInput();
  }

  private clearHeldInput(): void {
    this.heldKeys.clear();
    this.heldPointers.clear();
    this.laneHoldCounts[0] = 0;
    this.laneHoldCounts[1] = 0;
    this.laneHoldCounts[2] = 0;
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
    if (action === "song") {
      const song = button.dataset.song;
      if ((SONG_ORDER as readonly string[]).includes(song ?? "")) {
        this.songId = song as RhythmSongId;
      }
      this.render();
      return;
    }
    if (action === "difficulty") {
      const mode = button.dataset.difficulty;
      if (mode === "easy" || mode === "hard") this.difficulty = mode;
      this.render();
      return;
    }
    if (action === "play" || action === "retry") {
      this.beginSong();
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
    if (action === "quit" || action === "done") {
      if (action === "quit") {
        if (this.actionsTaken === 0) this.abandonRun();
        else this.showResults(false);
      }
      return;
    }
    if (action === "lane") {
      // Pointer sessions are handled by pointerdown/up for real hold support;
      // a keyboard-activated click (Enter/Space on the button) taps instead.
      if (button.dataset.pointerSession === "true") {
        delete button.dataset.pointerSession;
        return;
      }
      const lane = Number(button.dataset.lane);
      if (lane === 0 || lane === 1 || lane === 2) {
        this.pressLane(lane);
        this.releaseLane(lane);
      }
    }
  }

  private laneForKey(key: string): RhythmLane | null {
    return key === "arrowleft" || key === "a" || key === "1"
      ? 0
      : key === "arrowdown" || key === "s" || key === "2"
        ? 1
        : key === "arrowright" || key === "d" || key === "3"
          ? 2
          : null;
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (event.repeat) return;
    const key = event.key.toLowerCase();
    const lane = this.laneForKey(key);
    if (lane === null) return;
    event.preventDefault();
    if (this.heldKeys.has(key)) return;
    this.heldKeys.set(key, lane);
    this.laneHoldCounts[lane] += 1;
    this.pressLane(lane);
  }

  private onKeyUp(event: KeyboardEvent): void {
    const key = event.key.toLowerCase();
    const lane = this.heldKeys.get(key);
    if (lane === undefined) return;
    event.preventDefault();
    this.heldKeys.delete(key);
    this.laneHoldCounts[lane] = Math.max(0, this.laneHoldCounts[lane] - 1);
    if (this.laneHoldCounts[lane] === 0) this.releaseLane(lane);
  }

  private onPointerDown(event: PointerEvent): void {
    const documentView = this.root?.ownerDocument.defaultView;
    if (documentView === null || documentView === undefined || !(event.target instanceof documentView.Element)) {
      return;
    }
    const button = event.target.closest<HTMLButtonElement>('button[data-action="lane"]');
    if (button === null) return;
    const lane = Number(button.dataset.lane);
    if (lane !== 0 && lane !== 1 && lane !== 2) return;
    button.dataset.pointerSession = "true";
    try {
      button.setPointerCapture?.(event.pointerId);
    } catch {
      // Pointer capture is best-effort; synthetic pointers may not support it.
    }
    this.heldPointers.set(event.pointerId, lane);
    this.laneHoldCounts[lane] += 1;
    this.pressLane(lane);
  }

  private onPointerUp(event: PointerEvent): void {
    const lane = this.heldPointers.get(event.pointerId);
    if (lane === undefined) return;
    this.heldPointers.delete(event.pointerId);
    this.laneHoldCounts[lane] = Math.max(0, this.laneHoldCounts[lane] - 1);
    if (this.laneHoldCounts[lane] === 0) this.releaseLane(lane);
  }

  private pressLane(lane: RhythmLane): void {
    if (!this.running || this.session === null) return;
    this.actionsTaken += 1;
    this.lane = lane;
    const event = this.session.input(lane);
    this.applyJudgment(event);
    this.updateTrack();
  }

  private releaseLane(lane: RhythmLane): void {
    if (this.session === null) return;
    const event = this.session.release(lane);
    if (event !== null) this.applyJudgment(event);
    this.updateTrack();
  }

  private applyJudgment(event: JudgmentEvent): void {
    this.feedback = event.judgment;
    this.feedbackSeconds = 0.55;
    if (event.judgment === "miss") {
      const context = this.requireMounted();
      if (context.reducedMotion !== true) this.wobbleUntilMs = context.clock.now() + 360;
      context.audio?.emit("miss");
      context.haptics?.impact("warning");
    } else if (event.judgment === "sparkle") {
      this.context?.audio?.emit("score", event.combo);
      this.context?.haptics?.impact("medium");
    } else {
      this.context?.audio?.emit(
        event.combo > 0 && event.combo % 5 === 0 ? "combo" : "hit",
        event.combo,
      );
      this.context?.haptics?.impact(event.judgment === "perfect" ? "medium" : "light");
    }
    const judgment = this.shadow?.querySelector<HTMLElement>(".judgment");
    if (judgment !== null && judgment !== undefined) {
      judgment.className = `judgment ${event.judgment} show`;
      judgment.textContent =
        event.hold === "completed"
          ? "HOLD!"
          : event.judgment === "sparkle"
            ? "SPARKLE!"
            : event.judgment === "perfect"
              ? "PERFECT!"
              : event.judgment === "good"
                ? "GOOD!"
                : "MISS";
    }
    const combo = this.shadow?.querySelector<HTMLElement>(".combo-pop");
    if (combo !== null && combo !== undefined) combo.textContent = event.combo >= 2 ? `${event.combo}× COMBO` : "";
    const note = event.noteId === null ? null : this.shadow?.querySelector(`[data-note-id="${event.noteId}"]`);
    if (event.hold === "started") note?.classList.add("holding");
    else note?.remove();
  }

  private beginSong(): void {
    const context = this.requireMounted();
    this.runId = context.lifecycle?.beginRun() ?? null;
    this.previousBest = context.lifecycle?.persistedBest ?? context.bestScore ?? this.highScore;
    this.highScore = this.previousBest;
    this.session = new RhythmSession(RHYTHM_BEATMAPS[this.songId][this.difficulty], context.clock);
    this.beatTransport = new RhythmBeatCueTransport(this.session.beatmap);
    this.session.start();
    this.screen = "playing";
    this.running = true;
    this.paused = false;
    this.finished = false;
    this.lane = 1;
    this.feedback = "ready";
    this.feedbackSeconds = 0;
    this.wobbleUntilMs = 0;
    this.actionsTaken = 0;
    this.completedSong = false;
    this.clearHeldInput();
    this.render();
    this.root?.focus();
  }

  private showResults(completedSong: boolean): void {
    if (this.session === null || this.screen === "results") return;
    this.running = false;
    this.session.pause();
    this.completedSong = completedSong;
    this.finalScore = this.session.score;
    this.finalSparkles = this.session.sparkles;
    this.finalPerfects = this.session.perfects;
    this.finalGoods = this.session.goods;
    this.finalMisses = this.session.misses;
    this.finalBestCombo = this.session.bestCombo;
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
    this.highScore = Math.max(this.highScore, this.finalScore);
    context.finish(this.payout());
  }

  private abandonRun(): void {
    this.running = false;
    this.session?.pause();
    this.context?.lifecycle?.exit();
    this.runId = null;
    this.session = null;
    this.beatTransport = null;
    this.paused = false;
    this.finished = false;
    this.screen = "select";
    this.clearHeldInput();
    this.render();
  }

  private requireMounted(): RhythmContext {
    if (this.context === null) throw new Error("Rhythm Hop must be mounted before use");
    return this.context;
  }

  private render(): void {
    if (this.shadow === null) return;
    this.shadow.innerHTML = `<style>${RHYTHM_HOP_STYLES}</style>${this.renderGame()}`;
    if (this.screen === "playing" && !this.paused) this.updateTrack();
    this.focusCurrentInteraction();
  }

  private renderGame(): string {
    const beatmap = this.session?.beatmap ?? RHYTHM_BEATMAPS[this.songId][this.difficulty];
    const session = this.session;
    const songTime = session?.songTimeMs ?? 0;
    const progress = Math.min(100, (songTime / beatmap.durationMs) * 100);
    return `
      <main class="game">
        <div class="starscape"></div><div class="moon"></div>
        <header class="top">
          <button class="round-button" data-action="pause" aria-label="Pause song">Ⅱ</button>
          <div class="title"><small>${beatmap.bpm} BPM · ${beatmap.difficulty}</small><strong>${beatmap.title}</strong></div>
          <button class="round-button" data-action="pause" aria-label="Song menu">☰</button>
        </header>
        <section class="stats">
          <div class="stat"><span>Score</span><b data-stat="score">${(session?.score ?? 0).toLocaleString()}</b></div>
          <div class="stat"><span>Combo</span><b data-stat="combo">${session?.combo ?? 0}×</b></div>
          <div class="stat"><span>Best</span><b data-stat="best">${session?.bestCombo ?? 0}×</b></div>
        </section>
        <section class="track" aria-label="Three rhythm lanes">
          <div class="lane-glow" style="--lane:${this.lane}"></div>
          <div class="finish-line"></div>
          ${beatmap.notes
            .filter((note) => session?.isJudged(note.id) !== true || session?.isHoldActive(note.id) === true)
            .map(
              (note) =>
                `<div class="note ${beatmap.difficulty} ${note.holdMs !== undefined ? "hold" : ""} ${session?.isHoldActive(note.id) === true ? "holding" : ""}"
                  data-note-id="${note.id}" data-time="${note.timeMs}" data-hold="${note.holdMs ?? 0}"
                  style="--lane:${note.lane};--note-y:110%;--hold-len:0px">${beatmap.icon}</div>`,
            )
            .join("")}
          <div class="gooby" style="--lane:${this.lane}" aria-label="Gooby in lane ${this.lane + 1}"></div>
        </section>
        <div class="judgment ${this.feedback}"></div><div class="combo-pop"></div>
        <div class="progress"><i data-stat="progress" style="--progress:${progress}%"></i></div>
        <section class="controls" aria-label="Lane controls">
          <button class="lane-button" data-action="lane" data-lane="0" aria-keyshortcuts="ArrowLeft A 1">←<small>LEFT · A</small></button>
          <button class="lane-button" data-action="lane" data-lane="1" aria-keyshortcuts="ArrowDown S 2">↓<small>MIDDLE · S</small></button>
          <button class="lane-button" data-action="lane" data-lane="2" aria-keyshortcuts="ArrowRight D 3">→<small>RIGHT · D</small></button>
        </section>
        ${this.renderOverlay()}
      </main>`;
  }

  private renderOverlay(): string {
    if (this.screen === "tutorial") return this.renderTutorial();
    if (this.screen === "select") return this.renderSelection();
    if (this.screen === "results") return this.renderResults();
    if (this.paused) {
      return `
        <div class="overlay"><section class="panel" role="dialog" aria-label="Song paused">
          <div class="mascot">🐰🎵</div><h2>Beat paused</h2><p>The audio clock, every note, and even held notes are frozen right on beat.</p>
          <button class="primary" data-action="resume">Resume the groove</button>
          <button class="secondary" data-action="quit">${this.actionsTaken === 0 ? "Quit without reward" : "Finish &amp; collect"}</button>
        </section></div>`;
    }
    return "";
  }

  private renderTutorial(): string {
    const pages = [
      { icon: "🎵", title: "Follow the beat", copy: "Notes glide down three moonlit lanes. Watch the glowing HOP line near Gooby.", tip: "Each song is an authored chart riding one audio clock." },
      { icon: "🐰", title: "Hop and hold", copy: "Tap the lane buttons or use A/S/D and arrow keys. Notes with a glowing trail are holds — keep the lane held to the end of the trail.", tip: "Gooby hops instantly and wobbles after a miss." },
      { icon: "✨", title: "Sparkle the combo", copy: "Dead-center hits SPARKLE for extra points, Perfect and Good keep the combo, Misses reset it.", tip: "Hard mode has tighter windows and off-beat notes." },
    ] as const;
    const page = pages[this.tutorialPage] ?? pages[0];
    return `
      <div class="overlay"><section class="panel">
        <div class="mascot">${page.icon}</div><h2>${page.title}</h2><p>${page.copy}</p>
        <div class="tip"><em>💡</em><div><b>Rhythm tip</b><span>${page.tip}</span></div></div>
        <div class="dots">${pages.map((_, index) => `<i class="${index === this.tutorialPage ? "on" : ""}"></i>`).join("")}</div>
        <button class="primary" data-action="tutorial-next">${this.tutorialPage === 2 ? "Pick a song" : "Next tip"}</button>
        <button class="secondary" data-action="tutorial-skip">Skip tutorial</button>
      </section></div>`;
  }

  private renderSelection(): string {
    return `
      <div class="overlay"><section class="panel">
        <div class="mascot">🐰🎧</div><h2>Choose your groove</h2><p>Five complete songs, each with two hand-tuned beatmaps.</p>
        <div class="songs">
          ${SONG_ORDER.map((songId) => {
            const song = RHYTHM_BEATMAPS[songId].easy;
            const hasHolds = song.notes.some(({ holdMs }) => holdMs !== undefined);
            return `<button class="song ${songId === this.songId ? "selected" : ""}" data-action="song" data-song="${songId}">
              <em>${song.icon}</em><span><b>${song.title}</b><small>${song.subtitle} · ${song.bpm} BPM${hasHolds ? " · holds" : ""}</small></span><strong>${Math.ceil(song.durationMs / 1000)}s</strong>
            </button>`;
          }).join("")}
        </div>
        <div class="mode">
          <button data-action="difficulty" data-difficulty="easy" class="${this.difficulty === "easy" ? "selected" : ""}">COZY · ±150ms</button>
          <button data-action="difficulty" data-difficulty="hard" class="${this.difficulty === "hard" ? "selected" : ""}">HARD · ±115ms</button>
        </div>
        <button class="primary" data-action="play">Start hopping</button>
      </section></div>`;
  }

  private renderResults(): string {
    const total = this.finalSparkles + this.finalPerfects + this.finalGoods + this.finalMisses;
    const accuracy =
      total === 0
        ? 0
        : (this.finalSparkles + this.finalPerfects + this.finalGoods * 0.65) / total;
    const grade = accuracy >= 0.95 ? "S" : accuracy >= 0.84 ? "A" : accuracy >= 0.7 ? "B" : accuracy >= 0.5 ? "C" : "D";
    const isBest = this.finalScore > this.previousBest;
    return `
      <div class="overlay"><section class="panel">
        <div class="mascot">🐰✨</div><h2>${this.completedSong ? "Song complete!" : "Song wrapped up"}</h2><div class="grade">${grade}</div>
        <div class="result-score">${this.finalScore.toLocaleString()} pts</div>
        <div class="result-grid">
          <div class="sparkle-cell"><b>${this.finalSparkles}</b><span>Sparkle</span></div>
          <div><b>${this.finalPerfects}</b><span>Perfect</span></div>
          <div><b>${this.finalGoods}</b><span>Good</span></div>
          <div><b>${this.finalBestCombo}×</b><span>Best combo</span></div>
        </div>
        ${isBest ? `<div class="new-best">NEW HIGH SCORE</div>` : ""}
        <button class="primary" data-action="done">Collect ${this.payout().coins} coins</button>
        <button class="secondary" data-action="retry">Replay song</button>
      </section></div>`;
  }

  private updateTrack(): void {
    if (this.shadow === null || this.session === null) return;
    const track = this.shadow.querySelector<HTMLElement>(".track");
    if (track === null) return;
    const now = this.session.songTimeMs;
    const usableHeight = Math.max(180, track.clientHeight - 83);
    for (const note of track.querySelectorAll<HTMLElement>("[data-time]")) {
      const time = Number(note.dataset.time);
      const holdMs = Number(note.dataset.hold ?? "0");
      const holding = note.classList.contains("holding");
      const difference = time - now;
      const tailDifference = time + holdMs - now;
      note.hidden = tailDifference < -180 || difference > 2_200;
      const ratio = Math.max(0, Math.min(1, difference / 2_200));
      note.style.setProperty("--note-y", holding ? "83px" : `${83 + ratio * usableHeight}px`);
      if (holdMs > 0) {
        const remainingMs = holding ? Math.max(0, tailDifference) : holdMs;
        note.style.setProperty(
          "--hold-len",
          `${(Math.min(remainingMs, 2_200) / 2_200) * usableHeight}px`,
        );
      }
    }
    const context = this.requireMounted();
    const gooby = this.shadow.querySelector<HTMLElement>(".gooby");
    if (gooby !== null) {
      gooby.style.setProperty("--lane", String(this.lane));
      gooby.classList.toggle("wobble", context.clock.now() < this.wobbleUntilMs);
    }
    const glow = this.shadow.querySelector<HTMLElement>(".lane-glow");
    if (glow !== null) {
      glow.style.setProperty("--lane", String(this.lane));
      glow.classList.toggle("on", this.feedbackSeconds > 0 && this.feedback !== "miss");
      glow.classList.toggle("sparkle", this.feedbackSeconds > 0 && this.feedback === "sparkle");
    }
    const score = this.shadow.querySelector<HTMLElement>('[data-stat="score"]');
    const combo = this.shadow.querySelector<HTMLElement>('[data-stat="combo"]');
    const best = this.shadow.querySelector<HTMLElement>('[data-stat="best"]');
    const progress = this.shadow.querySelector<HTMLElement>('[data-stat="progress"]');
    if (score !== null) score.textContent = this.session.score.toLocaleString();
    if (combo !== null) combo.textContent = `${this.session.combo}×`;
    if (best !== null) best.textContent = `${this.session.bestCombo}×`;
    progress?.style.setProperty(
      "--progress",
      `${Math.min(100, (now / this.session.beatmap.durationMs) * 100)}%`,
    );
  }

  private focusCurrentInteraction(): void {
    if (this.shadow === null) return;
    if (this.screen === "playing" && !this.paused) {
      this.root?.focus();
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

export function createRhythmHop(): MinigameModule {
  return new RhythmHop();
}
