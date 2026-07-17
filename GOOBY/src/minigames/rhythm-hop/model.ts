import type { Clock } from "../../core/contracts/clock";

export type RhythmLane = 0 | 1 | 2;
export type RhythmDifficulty = "easy" | "hard";
export type RhythmSongId = "carrot-bounce" | "puddle-pop" | "moonhop-magic";
export type RhythmJudgment = "perfect" | "good" | "miss";

export interface BeatNote {
  readonly id: string;
  readonly timeMs: number;
  readonly lane: RhythmLane;
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

export interface JudgmentEvent {
  readonly judgment: RhythmJudgment;
  readonly offsetMs: number | null;
  readonly noteId: string | null;
  readonly lane: RhythmLane;
  readonly combo: number;
  readonly score: number;
}

export const JUDGMENT_WINDOWS: Readonly<
  Record<RhythmDifficulty, { readonly perfectMs: number; readonly goodMs: number }>
> = {
  easy: { perfectMs: 70, goodMs: 150 },
  hard: { perfectMs: 55, goodMs: 115 },
};

interface SongDefinition {
  readonly id: RhythmSongId;
  readonly title: string;
  readonly subtitle: string;
  readonly icon: string;
  readonly bpm: number;
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
    bars: 8,
    pattern: [0, 1, 2, 1, 0, 2, 1, 2],
  },
  {
    id: "puddle-pop",
    title: "Puddle Pop",
    subtitle: "Splashy stepping beat",
    icon: "💧",
    bpm: 120,
    bars: 10,
    pattern: [1, 0, 1, 2, 2, 1, 0, 2],
  },
  {
    id: "moonhop-magic",
    title: "Moonhop Magic",
    subtitle: "Twinkling night sprint",
    icon: "🌙",
    bpm: 138,
    bars: 11,
    pattern: [0, 2, 1, 0, 1, 2, 0, 1],
  },
] as const;

function makeBeatmap(song: SongDefinition, difficulty: RhythmDifficulty): RhythmBeatmap {
  const beatMs = 60_000 / song.bpm;
  const notes: BeatNote[] = [];
  const totalBeats = song.bars * 4;
  const startMs = 1_800;
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
    audioOffsetMs: 0,
    durationMs: Math.round((lastNote?.timeMs ?? startMs) + 1_600),
    notes,
  };
}

export const RHYTHM_BEATMAPS: Readonly<
  Record<RhythmSongId, Readonly<Record<RhythmDifficulty, RhythmBeatmap>>>
> = Object.fromEntries(
  SONGS.map((song) => [
    song.id,
    {
      easy: makeBeatmap(song, "easy"),
      hard: makeBeatmap(song, "hard"),
    },
  ]),
) as Record<RhythmSongId, Record<RhythmDifficulty, RhythmBeatmap>>;

export class RhythmSession {
  private readonly judged = new Set<string>();
  private startTimeMs = 0;
  private pausedAtMs: number | null = null;
  private totalPausedMs = 0;
  private sessionState: "ready" | "playing" | "paused" | "ended" = "ready";
  private currentCombo = 0;
  private bestComboCount = 0;
  private scoreTotal = 0;
  private perfectCount = 0;
  private goodCount = 0;
  private missCount = 0;

  constructor(
    public readonly beatmap: RhythmBeatmap,
    private readonly clock: Clock,
  ) {}

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

  get perfects(): number {
    return this.perfectCount;
  }

  get goods(): number {
    return this.goodCount;
  }

  get misses(): number {
    return this.missCount;
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
    const windows = JUDGMENT_WINDOWS[this.beatmap.difficulty];
    const missed: JudgmentEvent[] = [];
    for (const note of this.beatmap.notes) {
      if (this.judged.has(note.id)) continue;
      if (note.timeMs >= this.songTimeMs - windows.goodMs) break;
      this.judged.add(note.id);
      this.currentCombo = 0;
      this.missCount += 1;
      missed.push({
        judgment: "miss",
        offsetMs: this.songTimeMs - note.timeMs,
        noteId: note.id,
        lane: note.lane,
        combo: this.currentCombo,
        score: this.scoreTotal,
      });
    }
    if (this.songTimeMs >= this.beatmap.durationMs) this.sessionState = "ended";
    return missed;
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
      Math.abs(offset) <= windows.perfectMs ? "perfect" : "good";
    this.currentCombo += 1;
    this.bestComboCount = Math.max(this.bestComboCount, this.currentCombo);
    const baseScore = judgment === "perfect" ? 1_000 : 600;
    const comboBonus = Math.min(500, Math.floor(this.currentCombo / 5) * 50);
    this.scoreTotal += baseScore + comboBonus;
    if (judgment === "perfect") this.perfectCount += 1;
    else this.goodCount += 1;
    return {
      judgment,
      offsetMs: offset,
      noteId: nearest.id,
      lane,
      combo: this.currentCombo,
      score: this.scoreTotal,
    };
  }

  isJudged(noteId: string): boolean {
    return this.judged.has(noteId);
  }

  visibleNotes(lookBehindMs = 180, lookAheadMs = 2_200): readonly BeatNote[] {
    const now = this.songTimeMs;
    return this.beatmap.notes.filter(
      (note) =>
        !this.judged.has(note.id) &&
        note.timeMs >= now - lookBehindMs &&
        note.timeMs <= now + lookAheadMs,
    );
  }
}
