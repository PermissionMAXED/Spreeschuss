import type {
  MinigameContext,
  MinigameModule,
  MinigamePayout,
} from "../../core/contracts/minigame";
import type { MinigameStubDefinition } from "../stub";
import {
  RHYTHM_BEATMAPS,
  RhythmSession,
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

const SONG_ORDER: readonly RhythmSongId[] = [
  "carrot-bounce",
  "puddle-pop",
  "moonhop-magic",
];

export class RhythmHop implements MinigameModule {
  readonly id = definition.id;
  readonly title = definition.title;
  readonly instructions = definition.instructions;

  private context: MinigameContext | null = null;
  private root: HTMLElement | null = null;
  private shadow: ShadowRoot | null = null;
  private session: RhythmSession | null = null;
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
  private finalScore = 0;
  private finalPerfects = 0;
  private finalGoods = 0;
  private finalMisses = 0;
  private finalBestCombo = 0;

  private readonly handleClick = (event: Event): void => {
    this.onClick(event);
  };
  private readonly handleKeyDown = (event: Event): void => {
    this.onKeyDown(event as KeyboardEvent);
  };

  mount(context: MinigameContext): void {
    this.dispose();
    this.context = context;
    const root = context.mount.ownerDocument.createElement("section");
    root.setAttribute("aria-label", "Rhythm Hop");
    root.setAttribute("tabindex", "0");
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
    this.render();
    this.root?.focus();
  }

  update(deltaSeconds: number): void {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) {
      throw new RangeError("Rhythm Hop delta must be finite and non-negative");
    }
    if (!this.running || this.session === null) return;
    const misses = this.session.update();
    for (const miss of misses) this.applyJudgment(miss);
    if (this.session.state === "ended") {
      this.showResults();
      return;
    }
    if (this.feedbackSeconds > 0) {
      this.feedbackSeconds -= deltaSeconds;
      if (this.feedbackSeconds <= 0) this.shadow?.querySelector(".judgment")?.classList.remove("show");
    }
    this.updateTrack();
  }

  payout(): MinigamePayout {
    const score = this.screen === "results" ? this.finalScore : (this.session?.score ?? 0);
    const bestCombo =
      this.screen === "results" ? this.finalBestCombo : (this.session?.bestCombo ?? 0);
    return {
      score,
      coins: Math.floor(score / 3_500) + Math.floor(bestCombo / 8) + 3,
      xp: Math.max(0, Math.floor(score / 180)),
    };
  }

  dispose(): void {
    this.shadow?.removeEventListener("click", this.handleClick);
    this.root?.removeEventListener("keydown", this.handleKeyDown);
    this.root?.remove();
    this.context = null;
    this.root = null;
    this.shadow = null;
    this.session = null;
    this.running = false;
    this.paused = false;
    this.feedbackSeconds = 0;
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
      if (song === "carrot-bounce" || song === "puddle-pop" || song === "moonhop-magic") {
        this.songId = song;
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
      this.finishOnce();
      return;
    }
    if (action === "lane") {
      const lane = Number(button.dataset.lane);
      if (lane === 0 || lane === 1 || lane === 2) this.hitLane(lane);
    }
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (event.repeat) return;
    const key = event.key.toLowerCase();
    const lane =
      key === "arrowleft" || key === "a" || key === "1"
        ? 0
        : key === "arrowdown" || key === "s" || key === "2"
          ? 1
          : key === "arrowright" || key === "d" || key === "3"
            ? 2
            : null;
    if (lane === null) return;
    event.preventDefault();
    this.hitLane(lane);
  }

  private hitLane(lane: RhythmLane): void {
    if (!this.running || this.session === null) return;
    this.lane = lane;
    const event = this.session.input(lane);
    this.applyJudgment(event);
    const note = event.noteId === null ? null : this.shadow?.querySelector(`[data-note-id="${event.noteId}"]`);
    note?.remove();
    this.updateTrack();
  }

  private applyJudgment(event: JudgmentEvent): void {
    this.feedback = event.judgment;
    this.feedbackSeconds = 0.55;
    if (event.judgment === "miss") {
      const context = this.requireMounted();
      this.wobbleUntilMs = context.clock.now() + 360;
    }
    const judgment = this.shadow?.querySelector<HTMLElement>(".judgment");
    if (judgment !== null && judgment !== undefined) {
      judgment.className = `judgment ${event.judgment} show`;
      judgment.textContent =
        event.judgment === "perfect" ? "PERFECT!" : event.judgment === "good" ? "GOOD!" : "MISS";
    }
    const combo = this.shadow?.querySelector<HTMLElement>(".combo-pop");
    if (combo !== null && combo !== undefined) combo.textContent = event.combo >= 2 ? `${event.combo}× COMBO` : "";
    const note = event.noteId === null ? null : this.shadow?.querySelector(`[data-note-id="${event.noteId}"]`);
    note?.remove();
  }

  private beginSong(): void {
    const context = this.requireMounted();
    this.session = new RhythmSession(RHYTHM_BEATMAPS[this.songId][this.difficulty], context.clock);
    this.session.start();
    this.screen = "playing";
    this.running = true;
    this.paused = false;
    this.finished = false;
    this.lane = 1;
    this.feedback = "ready";
    this.feedbackSeconds = 0;
    this.wobbleUntilMs = 0;
    this.render();
    this.root?.focus();
  }

  private showResults(): void {
    if (this.session === null || this.screen === "results") return;
    this.running = false;
    this.finalScore = this.session.score;
    this.finalPerfects = this.session.perfects;
    this.finalGoods = this.session.goods;
    this.finalMisses = this.session.misses;
    this.finalBestCombo = this.session.bestCombo;
    this.highScore = Math.max(this.highScore, this.finalScore);
    this.screen = "results";
    this.render();
  }

  private finishOnce(): void {
    if (this.finished) return;
    this.finished = true;
    this.running = false;
    this.context?.finish(this.payout());
  }

  private requireMounted(): MinigameContext {
    if (this.context === null) throw new Error("Rhythm Hop must be mounted before use");
    return this.context;
  }

  private render(): void {
    if (this.shadow === null) return;
    this.shadow.innerHTML = `<style>${RHYTHM_HOP_STYLES}</style>${this.renderGame()}`;
    if (this.screen === "playing" && !this.paused) this.updateTrack();
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
            .filter((note) => session?.isJudged(note.id) !== true)
            .map(
              (note) =>
                `<div class="note ${beatmap.difficulty}" data-note-id="${note.id}" data-time="${note.timeMs}" style="--lane:${note.lane};--note-y:110%">${beatmap.icon}</div>`,
            )
            .join("")}
          <div class="gooby" style="--lane:${this.lane}" aria-label="Gooby in lane ${this.lane + 1}"></div>
        </section>
        <div class="judgment ${this.feedback}"></div><div class="combo-pop"></div>
        <div class="progress"><i data-stat="progress" style="--progress:${progress}%"></i></div>
        <section class="controls" aria-label="Lane controls">
          <button class="lane-button" data-action="lane" data-lane="0">←<small>LEFT · A</small></button>
          <button class="lane-button" data-action="lane" data-lane="1">↓<small>MIDDLE · S</small></button>
          <button class="lane-button" data-action="lane" data-lane="2">→<small>RIGHT · D</small></button>
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
          <div class="mascot">🐰🎵</div><h2>Beat paused</h2><p>The audio clock and every note are frozen right on beat.</p>
          <button class="primary" data-action="resume">Resume the groove</button>
          <button class="secondary" data-action="quit">Quit &amp; collect</button>
        </section></div>`;
    }
    return "";
  }

  private renderTutorial(): string {
    const pages = [
      { icon: "🎵", title: "Follow the beat", copy: "Notes glide down three moonlit lanes. Watch the glowing HOP line near Gooby.", tip: "Each song uses timestamped notes ready for an audio clock." },
      { icon: "🐰", title: "Hop lanes", copy: "Tap the lane buttons or use A/S/D and arrow keys as a note reaches Gooby.", tip: "Gooby hops instantly and wobbles after a miss." },
      { icon: "✨", title: "Build a combo", copy: "Perfect hits are closest to the beat, Good hits are near it, and Misses reset your combo.", tip: "Hard mode has tighter windows and off-beat notes." },
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
        <div class="mascot">🐰🎧</div><h2>Choose your groove</h2><p>Three complete songs, each with two hand-tuned beatmaps.</p>
        <div class="songs">
          ${SONG_ORDER.map((songId) => {
            const song = RHYTHM_BEATMAPS[songId].easy;
            return `<button class="song ${songId === this.songId ? "selected" : ""}" data-action="song" data-song="${songId}">
              <em>${song.icon}</em><span><b>${song.title}</b><small>${song.subtitle} · ${song.bpm} BPM</small></span><strong>${Math.ceil(song.durationMs / 1000)}s</strong>
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
    const total = this.finalPerfects + this.finalGoods + this.finalMisses;
    const accuracy = total === 0 ? 0 : (this.finalPerfects + this.finalGoods * 0.65) / total;
    const grade = accuracy >= 0.95 ? "S" : accuracy >= 0.84 ? "A" : accuracy >= 0.7 ? "B" : accuracy >= 0.5 ? "C" : "D";
    const isBest = this.finalScore >= this.highScore;
    return `
      <div class="overlay"><section class="panel">
        <div class="mascot">🐰✨</div><h2>Song complete!</h2><div class="grade">${grade}</div>
        <div class="result-score">${this.finalScore.toLocaleString()} pts</div>
        <div class="result-grid">
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
      const difference = time - now;
      note.hidden = difference < -180 || difference > 2_200;
      const ratio = Math.max(0, Math.min(1, difference / 2_200));
      note.style.setProperty("--note-y", `${83 + ratio * usableHeight}px`);
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
}

export function createRhythmHop(): MinigameModule {
  return new RhythmHop();
}
