import { describe, expect, it } from "vitest";
import { FakeClock } from "../../core/contracts/clock";
import {
  JUDGMENT_WINDOWS,
  RHYTHM_BEATMAPS,
  RhythmSession,
  type RhythmBeatmap,
  type RhythmSongId,
} from "./model";

describe("Rhythm Hop beatmaps and judgment", () => {
  it("provides three songs with two valid audio-clock charts each", () => {
    const songIds = Object.keys(RHYTHM_BEATMAPS) as RhythmSongId[];
    expect(songIds).toHaveLength(3);
    for (const songId of songIds) {
      for (const difficulty of ["easy", "hard"] as const) {
        const map = RHYTHM_BEATMAPS[songId][difficulty];
        expect(map.notes.length).toBeGreaterThan(10);
        expect(new Set(map.notes.map(({ id }) => id)).size).toBe(map.notes.length);
        expect(map.notes.every(({ lane }) => lane >= 0 && lane <= 2)).toBe(true);
        expect(map.notes.every((note, index) => index === 0 || note.timeMs >= (map.notes[index - 1]?.timeMs ?? 0))).toBe(true);
        expect(map.durationMs).toBeGreaterThan(map.notes.at(-1)?.timeMs ?? 0);
        expect(map.audioOffsetMs).toBe(0);
      }
    }
  });

  it("judges perfect, good, and miss at deterministic signed windows", () => {
    const map = RHYTHM_BEATMAPS["carrot-bounce"].easy;
    const note = map.notes[0];
    expect(note).toBeDefined();
    const windows = JUDGMENT_WINDOWS.easy;

    const perfectClock = new FakeClock(10_000);
    const perfect = new RhythmSession(map, perfectClock);
    perfect.start();
    perfectClock.advance((note?.timeMs ?? 0) - windows.perfectMs);
    expect(perfect.input(note?.lane ?? 0)).toMatchObject({
      judgment: "perfect",
      offsetMs: -windows.perfectMs,
      combo: 1,
    });

    const goodClock = new FakeClock(20_000);
    const good = new RhythmSession(map, goodClock);
    good.start();
    goodClock.advance((note?.timeMs ?? 0) + windows.perfectMs + 1);
    expect(good.input(note?.lane ?? 0)).toMatchObject({
      judgment: "good",
      offsetMs: windows.perfectMs + 1,
      combo: 1,
    });

    const missClock = new FakeClock(30_000);
    const miss = new RhythmSession(map, missClock);
    miss.start();
    missClock.advance((note?.timeMs ?? 0) + windows.goodMs + 1);
    expect(miss.update()[0]).toMatchObject({ judgment: "miss", noteId: note?.id, combo: 0 });
  });

  it("builds combo scoring and resets combo on a stray hop", () => {
    const map = RHYTHM_BEATMAPS["puddle-pop"].hard;
    const clock = new FakeClock(0);
    const session = new RhythmSession(map, clock);
    session.start();
    hitNextNotes(session, clock, map, 6);
    expect(session.combo).toBe(6);
    expect(session.bestCombo).toBe(6);
    expect(session.score).toBeGreaterThanOrEqual(6_000);

    clock.advance(250);
    const occupied = new Set(
      map.notes
        .filter(({ timeMs }) => Math.abs(timeMs - session.songTimeMs) <= JUDGMENT_WINDOWS.hard.goodMs)
        .map(({ lane }) => lane),
    );
    const emptyLane = ([0, 1, 2] as const).find((lane) => !occupied.has(lane));
    expect(emptyLane).toBeDefined();
    expect(session.input(emptyLane ?? 0).judgment).toBe("miss");
    expect(session.combo).toBe(0);
    expect(session.bestCombo).toBe(6);
    expect(session.misses).toBe(1);
  });

  it("freezes the audio clock, notes, and combo while paused", () => {
    const map = RHYTHM_BEATMAPS["moonhop-magic"].easy;
    const first = map.notes[0];
    const clock = new FakeClock(5_000);
    const session = new RhythmSession(map, clock);
    session.start();
    clock.advance(700);
    session.pause();
    const pausedAt = session.songTimeMs;
    clock.advance(25_000);
    expect(session.songTimeMs).toBe(pausedAt);
    expect(session.update()).toEqual([]);
    expect(session.judgedCount).toBe(0);

    session.resume();
    clock.advance((first?.timeMs ?? 0) - pausedAt);
    expect(session.input(first?.lane ?? 0).judgment).toBe("perfect");
    expect(session.combo).toBe(1);
  });
});

function hitNextNotes(
  session: RhythmSession,
  clock: FakeClock,
  map: RhythmBeatmap,
  count: number,
): void {
  for (const note of map.notes.slice(0, count)) {
    clock.advance(note.timeMs - session.songTimeMs);
    expect(session.input(note.lane).judgment).toBe("perfect");
  }
}
