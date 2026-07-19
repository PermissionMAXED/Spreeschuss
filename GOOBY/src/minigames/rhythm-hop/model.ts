import type { Clock } from "../../core/contracts/clock";
import type { MinigamePayout } from "../../core/contracts/minigame";
import type { RhythmChartFile } from "./songs/format";

export type RhythmLane = 0 | 1 | 2;
export type RhythmDifficulty = "easy" | "hard";
export type RhythmSongId =
  | "carrot-bounce"
  | "puddle-pop"
  | "moonhop-magic"
  | "firefly-waltz"
  | "dewdrop-derby";
export type RhythmJudgment = "sparkle" | "perfect" | "good" | "miss";

export interface BeatNote {
  readonly id: string;
  readonly timeMs: number;
  readonly lane: RhythmLane;
  /** Positive for hold notes: keep the lane held until `timeMs + holdMs`. */
  readonly holdMs?: number;
}

export interface RhythmBeatmap {
  readonly songId: RhythmSongId;
  readonly title: string;
  readonly subtitle: string;
  readonly icon: string;
  readonly bpm: number;
  readonly difficulty: RhythmDifficulty;
  readonly audioOffsetMs: number;
  readonly durationMs: number;
  readonly notes: readonly BeatNote[];
}

export type HoldPhase = "started" | "completed" | "broken";

export interface JudgmentEvent {
  readonly judgment: RhythmJudgment;
  readonly offsetMs: number | null;
  readonly noteId: string | null;
  readonly lane: RhythmLane;
  readonly combo: number;
  readonly score: number;
  /** Present only for hold-note events. */
  readonly hold?: HoldPhase;
}

export const JUDGMENT_WINDOWS: Readonly<
  Record<
    RhythmDifficulty,
    { readonly sparkleMs: number; readonly perfectMs: number; readonly goodMs: number }
  >
> = {
  easy: { sparkleMs: 32, perfectMs: 70, goodMs: 150 },
  hard: { sparkleMs: 26, perfectMs: 55, goodMs: 115 },
};

export const JUDGMENT_SCORES: Readonly<Record<Exclude<RhythmJudgment, "miss">, number>> = {
  sparkle: 1_350,
  perfect: 1_000,
  good: 600,
};

/** Flat bonus for riding a hold note all the way to its tail. */
export const HOLD_COMPLETE_SCORE = 700;

interface SongDefinition {
  readonly id: RhythmSongId;
  readonly title: string;
  readonly subtitle: string;
  readonly icon: string;
  readonly bpm: number;
  readonly audioOffsetMs: number;
  readonly bars: number;
  readonly pattern: readonly RhythmLane[];
}

const SONGS: readonly SongDefinition[] = [
  {
    id: "carrot-bounce",
    title: "Carrot Bounce",
    subtitle: "Sunny garden groove",
    icon: "🥕",
    bpm: 96,
    audioOffsetMs: 1_800,
    bars: 8,
    pattern: [0, 1, 2, 1, 0, 2, 1, 2],
  },
  {
    id: "puddle-pop",
    title: "Puddle Pop",
    subtitle: "Splashy stepping beat",
    icon: "💧",
    bpm: 120,
    audioOffsetMs: 1_800,
    bars: 10,
    pattern: [1, 0, 1, 2, 2, 1, 0, 2],
  },
  {
    id: "moonhop-magic",
    title: "Moonhop Magic",
    subtitle: "Twinkling night sprint",
    icon: "🌙",
    bpm: 138,
    audioOffsetMs: 1_800,
    bars: 11,
    pattern: [0, 2, 1, 0, 1, 2, 0, 1],
  },
] as const;

function makeBeatmap(song: SongDefinition, difficulty: RhythmDifficulty): RhythmBeatmap {
  const beatMs = 60_000 / song.bpm;
  const notes: BeatNote[] = [];
  const totalBeats = song.bars * 4;
  const startMs = song.audioOffsetMs;
  const spacing = difficulty === "easy" ? 2 : 1;

  for (let beat = 0; beat < totalBeats; beat += spacing) {
    const patternIndex = difficulty === "easy" ? beat / 2 : beat;
    const lane = song.pattern[patternIndex % song.pattern.length] as RhythmLane;
    notes.push({
      id: `${song.id}-${difficulty}-${beat}-a`,
      timeMs: Math.round(startMs + beat * beatMs),
      lane,
    });

    if (difficulty === "hard" && beat % 4 === 3) {
      const extraLane = ((lane + 2) % 3) as RhythmLane;
      notes.push({
        id: `${song.id}-${difficulty}-${beat}-b`,
        timeMs: Math.round(startMs + beat * beatMs + beatMs / 2),
        lane: extraLane,
      });
    }
  }

  notes.sort((first, second) => first.timeMs - second.timeMs);
  const lastNote = notes.at(-1);
  return {
    songId: song.id,
    title: song.title,
    subtitle: song.subtitle,
    icon: song.icon,
    bpm: song.bpm,
    difficulty,
    audioOffsetMs: song.audioOffsetMs,
    durationMs: Math.round((lastNote?.timeMs ?? startMs) + 1_600),
    notes,
  };
}

/**
 * Compiles an authored chart file into a frozen beatmap. Pure and
 * deterministic: the same file always yields the identical beatmap.
 */
export function compileChartFile(
  file: RhythmChartFile,
  difficulty: RhythmDifficulty,
): RhythmBeatmap {
  const beatMs = 60_000 / file.bpm;
  const specs = difficulty === "easy" ? file.easy : file.hard;
  const notes: BeatNote[] = specs.map((spec, index) => {
    const timeMs = Math.round(file.audioOffsetMs + spec.beat * beatMs);
    const base = {
      id: `${file.id}-${difficulty}-n${index}`,
      timeMs,
      lane: spec.lane,
    };
    return spec.holdBeats === undefined
      ? base
      : { ...base, holdMs: Math.round(spec.holdBeats * beatMs) };
  });
  notes.sort((first, second) => first.timeMs - second.timeMs);
  const lastEndMs = notes.reduce(
    (end, note) => Math.max(end, note.timeMs + (note.holdMs ?? 0)),
    file.audioOffsetMs,
  );
  return {
    songId: file.id as RhythmSongId,
    title: file.title,
    subtitle: file.subtitle,
    icon: file.icon,
    bpm: file.bpm,
    difficulty,
    audioOffsetMs: file.audioOffsetMs,
    durationMs: Math.round(lastEndMs + 1_600),
    notes,
  };
}

export type ProceduralSongId = "carrot-bounce" | "puddle-pop" | "moonhop-magic";

/**
 * The three procedural songs. The full five-song catalog (including the two
 * file-backed charts under `songs/`) is assembled in `beatmaps.ts`; this
 * module stays free of runtime imports so the strip-types specialist test
 * runner can load it directly.
 */
export const PROCEDURAL_BEATMAPS: Readonly<
  Record<ProceduralSongId, Readonly<Record<RhythmDifficulty, RhythmBeatmap>>>
> = Object.fromEntries(
  SONGS.map((song) => [
    song.id,
    {
      easy: makeBeatmap(song, "easy"),
      hard: makeBeatmap(song, "hard"),
    },
  ]),
) as Record<ProceduralSongId, Record<RhythmDifficulty, RhythmBeatmap>>;

export interface RhythmBeatCue {
  readonly beatIndex: number;
  readonly timeMs: number;
  readonly accent: boolean;
}

/** Score and coins for a settled song; quitting an untouched run pays nothing. */
export function rhythmPayout(score: number, bestCombo: number): MinigamePayout {
  return {
    score,
    coins: Math.floor(score / 3_500) + Math.floor(bestCombo / 8) + 3,
    xp: Math.max(0, Math.floor(score / 180)),
  };
}

interface ActiveHold {
  readonly note: BeatNote;
  readonly headJudgment: RhythmJudgment;
}

export class RhythmSession {
  public readonly beatmap: RhythmBeatmap;
  private readonly clock: Clock;
  private readonly judged = new Set<string>();
  private readonly activeHolds = new Map<RhythmLane, ActiveHold>();
  private startTimeMs = 0;
  private pausedAtMs: number | null = null;
  private totalPausedMs = 0;
  private sessionState: "ready" | "playing" | "paused" | "ended" = "ready";
  private currentCombo = 0;
  private bestComboCount = 0;
  private scoreTotal = 0;
  private sparkleCount = 0;
  private perfectCount = 0;
  private goodCount = 0;
  private missCount = 0;
  private holdsCompletedCount = 0;
  private holdsBrokenCount = 0;

  constructor(beatmap: RhythmBeatmap, clock: Clock) {
    this.beatmap = beatmap;
    this.clock = clock;
  }

  get state(): "ready" | "playing" | "paused" | "ended" {
    return this.sessionState;
  }

  get songTimeMs(): number {
    if (this.sessionState === "ready") return 0;
    const currentTime = this.pausedAtMs ?? this.clock.now();
    return Math.max(0, currentTime - this.startTimeMs - this.totalPausedMs);
  }

  get combo(): number {
    return this.currentCombo;
  }

  get bestCombo(): number {
    return this.bestComboCount;
  }

  get score(): number {
    return this.scoreTotal;
  }

  get sparkles(): number {
    return this.sparkleCount;
  }

  get perfects(): number {
    return this.perfectCount;
  }

  get goods(): number {
    return this.goodCount;
  }

  get misses(): number {
    return this.missCount;
  }

  get holdsCompleted(): number {
    return this.holdsCompletedCount;
  }

  get holdsBroken(): number {
    return this.holdsBrokenCount;
  }

  get judgedCount(): number {
    return this.judged.size;
  }

  start(): void {
    if (this.sessionState !== "ready") return;
    this.startTimeMs = this.clock.now();
    this.sessionState = "playing";
  }

  pause(): void {
    if (this.sessionState !== "playing") return;
    this.pausedAtMs = this.clock.now();
    this.sessionState = "paused";
  }

  resume(): void {
    if (this.sessionState !== "paused" || this.pausedAtMs === null) return;
    this.totalPausedMs += this.clock.now() - this.pausedAtMs;
    this.pausedAtMs = null;
    this.sessionState = "playing";
  }

  update(): JudgmentEvent[] {
    if (this.sessionState !== "playing") return [];
    const songTime = this.songTimeMs;
    const windows = JUDGMENT_WINDOWS[this.beatmap.difficulty];
    const events: JudgmentEvent[] = [];

    // Holds whose tail has passed while still held auto-complete on the beat.
    for (const [lane, hold] of [...this.activeHolds]) {
      const tailMs = hold.note.timeMs + (hold.note.holdMs ?? 0);
      if (songTime >= tailMs) {
        this.activeHolds.delete(lane);
        events.push(this.completeHold(hold.note, songTime - tailMs));
      }
    }

    for (const note of this.beatmap.notes) {
      if (this.judged.has(note.id)) continue;
      if (note.timeMs >= songTime - windows.goodMs) break;
      this.judged.add(note.id);
      this.currentCombo = 0;
      this.missCount += 1;
      if (note.holdMs !== undefined) this.holdsBrokenCount += 1;
      events.push({
        judgment: "miss",
        offsetMs: songTime - note.timeMs,
        noteId: note.id,
        lane: note.lane,
        combo: this.currentCombo,
        score: this.scoreTotal,
        ...(note.holdMs !== undefined ? { hold: "broken" as const } : {}),
      });
    }
    if (songTime >= this.beatmap.durationMs) this.sessionState = "ended";
    return events;
  }

  input(lane: RhythmLane): JudgmentEvent {
    if (this.sessionState !== "playing") {
      return {
        judgment: "miss",
        offsetMs: null,
        noteId: null,
        lane,
        combo: this.currentCombo,
        score: this.scoreTotal,
      };
    }
    const time = this.songTimeMs;
    const windows = JUDGMENT_WINDOWS[this.beatmap.difficulty];
    let nearest: BeatNote | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;

    for (const note of this.beatmap.notes) {
      if (this.judged.has(note.id) || note.lane !== lane) continue;
      const distance = Math.abs(note.timeMs - time);
      if (distance < nearestDistance) {
        nearest = note;
        nearestDistance = distance;
      }
      if (note.timeMs > time + windows.goodMs) break;
    }

    if (nearest === null || nearestDistance > windows.goodMs) {
      this.currentCombo = 0;
      this.missCount += 1;
      return {
        judgment: "miss",
        offsetMs: null,
        noteId: null,
        lane,
        combo: 0,
        score: this.scoreTotal,
      };
    }

    this.judged.add(nearest.id);
    const offset = time - nearest.timeMs;
    const judgment: RhythmJudgment =
      Math.abs(offset) <= windows.sparkleMs
        ? "sparkle"
        : Math.abs(offset) <= windows.perfectMs
          ? "perfect"
          : "good";
    this.currentCombo += 1;
    this.bestComboCount = Math.max(this.bestComboCount, this.currentCombo);
    const comboBonus = Math.min(500, Math.floor(this.currentCombo / 5) * 50);
    this.scoreTotal += JUDGMENT_SCORES[judgment] + comboBonus;
    if (judgment === "sparkle") this.sparkleCount += 1;
    else if (judgment === "perfect") this.perfectCount += 1;
    else this.goodCount += 1;

    const isHold = nearest.holdMs !== undefined && nearest.holdMs > 0;
    if (isHold) this.activeHolds.set(lane, { note: nearest, headJudgment: judgment });
    return {
      judgment,
      offsetMs: offset,
      noteId: nearest.id,
      lane,
      combo: this.currentCombo,
      score: this.scoreTotal,
      ...(isHold ? { hold: "started" as const } : {}),
    };
  }

  /**
   * Ends a held lane. Releasing inside the good window before the tail (or any
   * time after it) completes the hold; letting go earlier breaks it. Releases
   * while paused are ignored — the audio clock is frozen, so the hold stays
   * exactly where it was.
   */
  release(lane: RhythmLane): JudgmentEvent | null {
    if (this.sessionState !== "playing") return null;
    const hold = this.activeHolds.get(lane);
    if (hold === undefined) return null;
    this.activeHolds.delete(lane);
    const time = this.songTimeMs;
    const windows = JUDGMENT_WINDOWS[this.beatmap.difficulty];
    const tailMs = hold.note.timeMs + (hold.note.holdMs ?? 0);
    if (time >= tailMs - windows.goodMs) {
      return this.completeHold(hold.note, time - tailMs);
    }
    this.currentCombo = 0;
    this.missCount += 1;
    this.holdsBrokenCount += 1;
    return {
      judgment: "miss",
      offsetMs: time - tailMs,
      noteId: hold.note.id,
      lane: hold.note.lane,
      combo: this.currentCombo,
      score: this.scoreTotal,
      hold: "broken",
    };
  }

  isJudged(noteId: string): boolean {
    return this.judged.has(noteId);
  }

  isHoldActive(noteId: string): boolean {
    for (const hold of this.activeHolds.values()) {
      if (hold.note.id === noteId) return true;
    }
    return false;
  }

  get heldLanes(): readonly RhythmLane[] {
    return [...this.activeHolds.keys()];
  }

  visibleNotes(lookBehindMs = 180, lookAheadMs = 2_200): readonly BeatNote[] {
    const now = this.songTimeMs;
    return this.beatmap.notes.filter(
      (note) =>
        (!this.judged.has(note.id) || this.isHoldActive(note.id)) &&
        note.timeMs + (note.holdMs ?? 0) >= now - lookBehindMs &&
        note.timeMs <= now + lookAheadMs,
    );
  }

  private completeHold(note: BeatNote, offsetMs: number): JudgmentEvent {
    this.currentCombo += 1;
    this.bestComboCount = Math.max(this.bestComboCount, this.currentCombo);
    const comboBonus = Math.min(500, Math.floor(this.currentCombo / 5) * 50);
    this.scoreTotal += HOLD_COMPLETE_SCORE + comboBonus;
    this.holdsCompletedCount += 1;
    this.perfectCount += 1;
    return {
      judgment: "perfect",
      offsetMs,
      noteId: note.id,
      lane: note.lane,
      combo: this.currentCombo,
      score: this.scoreTotal,
      hold: "completed",
    };
  }
}

/**
 * Emits each procedural beat once using the same frozen song clock as notes and
 * judgments. The transport never advances while its session is paused.
 */
export class RhythmBeatCueTransport {
  private readonly beatmap: RhythmBeatmap;
  private nextBeatIndex = 0;

  constructor(beatmap: RhythmBeatmap) {
    this.beatmap = beatmap;
  }

  drain(session: RhythmSession): readonly RhythmBeatCue[] {
    if (session.beatmap !== this.beatmap) {
      throw new Error("Rhythm beat transport must use its session beatmap");
    }
    if (session.state !== "playing") return [];

    const songTime = session.songTimeMs;
    if (songTime < this.beatmap.audioOffsetMs) return [];

    const beatDurationMs = 60_000 / this.beatmap.bpm;
    const lastDueBeat = Math.floor(
      (songTime - this.beatmap.audioOffsetMs) / beatDurationMs + Number.EPSILON,
    );
    const cues: RhythmBeatCue[] = [];
    while (this.nextBeatIndex <= lastDueBeat) {
      const timeMs = this.beatmap.audioOffsetMs + this.nextBeatIndex * beatDurationMs;
      if (timeMs > this.beatmap.durationMs) break;
      cues.push({
        beatIndex: this.nextBeatIndex,
        timeMs,
        accent: this.nextBeatIndex % 4 === 0,
      });
      this.nextBeatIndex += 1;
    }
    return cues;
  }
}
