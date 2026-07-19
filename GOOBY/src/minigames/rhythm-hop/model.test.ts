import { describe, expect, it } from "vitest";
import { FakeClock } from "../../core/contracts/clock";
import { RHYTHM_BEATMAPS, RHYTHM_CHART_FILES } from "./beatmaps";
import {
  HOLD_COMPLETE_SCORE,
  JUDGMENT_SCORES,
  JUDGMENT_WINDOWS,
  RhythmBeatCueTransport,
  RhythmSession,
  compileChartFile,
  rhythmPayout,
  type RhythmBeatmap,
  type RhythmSongId,
} from "./model";

describe("Rhythm Hop beatmaps and judgment", () => {
  it("provides five songs with two valid audio-clock charts each", () => {
    const songIds = Object.keys(RHYTHM_BEATMAPS) as RhythmSongId[];
    expect(songIds).toHaveLength(5);
    expect(songIds).toContain("firefly-waltz");
    expect(songIds).toContain("dewdrop-derby");
    for (const songId of songIds) {
      for (const difficulty of ["easy", "hard"] as const) {
        const map = RHYTHM_BEATMAPS[songId][difficulty];
        expect(map.notes.length).toBeGreaterThan(10);
        expect(new Set(map.notes.map(({ id }) => id)).size).toBe(map.notes.length);
        expect(map.notes.every(({ lane }) => lane >= 0 && lane <= 2)).toBe(true);
        expect(map.notes.every((note, index) => index === 0 || note.timeMs >= (map.notes[index - 1]?.timeMs ?? 0))).toBe(true);
        expect(map.durationMs).toBeGreaterThan(map.notes.at(-1)?.timeMs ?? 0);
        expect(map.audioOffsetMs).toBe(1_800);
        expect(map.notes[0]?.timeMs).toBe(map.audioOffsetMs);
      }
    }
  });

  it("compiles the file-backed charts deterministically with hold notes", () => {
    expect(RHYTHM_CHART_FILES.map(({ id }) => id)).toEqual(["firefly-waltz", "dewdrop-derby"]);
    for (const file of RHYTHM_CHART_FILES) {
      for (const difficulty of ["easy", "hard"] as const) {
        const compiled = compileChartFile(file, difficulty);
        expect(compiled).toEqual(compileChartFile(file, difficulty));
        expect(compiled).toEqual(RHYTHM_BEATMAPS[file.id as RhythmSongId][difficulty]);
        const holds = compiled.notes.filter(({ holdMs }) => holdMs !== undefined);
        expect(holds.length).toBeGreaterThan(2);
        for (const hold of holds) expect(hold.holdMs).toBeGreaterThan(0);
        // Every hold tail ends inside the song, never past its duration.
        for (const hold of holds) {
          expect(hold.timeMs + (hold.holdMs ?? 0)).toBeLessThan(compiled.durationMs);
        }
      }
    }
    const procedural = RHYTHM_BEATMAPS["carrot-bounce"].hard;
    expect(procedural.notes.every(({ holdMs }) => holdMs === undefined)).toBe(true);
  });

  it("judges sparkle, perfect, good, and miss at deterministic signed windows", () => {
    const map = RHYTHM_BEATMAPS["carrot-bounce"].easy;
    const note = map.notes[0];
    expect(note).toBeDefined();
    const windows = JUDGMENT_WINDOWS.easy;

    const sparkleClock = new FakeClock(5_000);
    const sparkle = new RhythmSession(map, sparkleClock);
    sparkle.start();
    sparkleClock.advance((note?.timeMs ?? 0) + windows.sparkleMs);
    expect(sparkle.input(note?.lane ?? 0)).toMatchObject({
      judgment: "sparkle",
      offsetMs: windows.sparkleMs,
      combo: 1,
      score: JUDGMENT_SCORES.sparkle,
    });
    expect(sparkle.sparkles).toBe(1);

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

  it("completes a hold ridden to its tail and breaks one dropped early", () => {
    const map = RHYTHM_BEATMAPS["firefly-waltz"].easy;
    const hold = map.notes.find(({ holdMs }) => holdMs !== undefined);
    expect(hold).toBeDefined();
    const tailMs = (hold?.timeMs ?? 0) + (hold?.holdMs ?? 0);

    const rideClock = new FakeClock(0);
    const ride = new RhythmSession(map, rideClock);
    ride.start();
    rideClock.advance(hold?.timeMs ?? 0);
    const started = ride.input(hold?.lane ?? 0);
    expect(started).toMatchObject({ judgment: "sparkle", hold: "started", noteId: hold?.id });
    expect(ride.isHoldActive(hold?.id ?? "")).toBe(true);
    expect(ride.heldLanes).toEqual([hold?.lane]);
    const scoreAtHead = ride.score;
    rideClock.advance((hold?.holdMs ?? 0) + 1);
    const completed = ride.update().find(({ noteId }) => noteId === hold?.id);
    expect(completed).toMatchObject({ judgment: "perfect", hold: "completed", combo: 2 });
    expect(ride.score).toBe(scoreAtHead + HOLD_COMPLETE_SCORE);
    expect(ride.holdsCompleted).toBe(1);
    expect(ride.isHoldActive(hold?.id ?? "")).toBe(false);

    const dropClock = new FakeClock(0);
    const drop = new RhythmSession(map, dropClock);
    drop.start();
    dropClock.advance(hold?.timeMs ?? 0);
    expect(drop.input(hold?.lane ?? 0).hold).toBe("started");
    dropClock.advance((hold?.holdMs ?? 0) / 2 - JUDGMENT_WINDOWS.easy.goodMs);
    const broken = drop.release(hold?.lane ?? 0);
    expect(broken).toMatchObject({ judgment: "miss", hold: "broken", noteId: hold?.id, combo: 0 });
    expect(drop.holdsBroken).toBe(1);
    expect(drop.misses).toBe(1);

    const lateClock = new FakeClock(0);
    const late = new RhythmSession(map, lateClock);
    late.start();
    lateClock.advance(hold?.timeMs ?? 0);
    expect(late.input(hold?.lane ?? 0).hold).toBe("started");
    lateClock.advance(tailMs - (hold?.timeMs ?? 0) - JUDGMENT_WINDOWS.easy.goodMs + 1);
    expect(late.release(hold?.lane ?? 0)).toMatchObject({ judgment: "perfect", hold: "completed" });
    expect(late.holdsCompleted).toBe(1);
  });

  it("misses an untouched hold head and counts it as a broken hold", () => {
    const map = RHYTHM_BEATMAPS["dewdrop-derby"].easy;
    const hold = map.notes.find(({ holdMs }) => holdMs !== undefined);
    expect(hold).toBeDefined();
    const clock = new FakeClock(0);
    const session = new RhythmSession(map, clock);
    session.start();
    clock.advance((hold?.timeMs ?? 0) + JUDGMENT_WINDOWS.easy.goodMs + 1);
    const events = session.update();
    const headMiss = events.find(({ noteId }) => noteId === hold?.id);
    expect(headMiss).toMatchObject({ judgment: "miss", hold: "broken" });
    expect(session.holdsBroken).toBe(1);
  });

  it("freezes the audio clock, notes, combo, and held notes while paused", () => {
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
    expect(session.input(first?.lane ?? 0).judgment).toBe("sparkle");
    expect(session.combo).toBe(1);
  });

  it("keeps a hold frozen across a pause and completes it on the same clock", () => {
    const map = RHYTHM_BEATMAPS["firefly-waltz"].easy;
    const hold = map.notes.find(({ holdMs }) => holdMs !== undefined);
    expect(hold).toBeDefined();
    const clock = new FakeClock(0);
    const session = new RhythmSession(map, clock);
    session.start();
    clock.advance(hold?.timeMs ?? 0);
    expect(session.input(hold?.lane ?? 0).hold).toBe("started");

    clock.advance((hold?.holdMs ?? 0) / 4);
    session.pause();
    const frozenAt = session.songTimeMs;
    clock.advance(60_000);
    expect(session.songTimeMs).toBe(frozenAt);
    expect(session.update()).toEqual([]);
    expect(session.isHoldActive(hold?.id ?? "")).toBe(true);
    // Releases are ignored while the audio clock is frozen.
    expect(session.release(hold?.lane ?? 0)).toBeNull();
    expect(session.isHoldActive(hold?.id ?? "")).toBe(true);

    session.resume();
    expect(session.songTimeMs).toBe(frozenAt);
    clock.advance((hold?.timeMs ?? 0) + (hold?.holdMs ?? 0) - frozenAt + 1);
    const completed = session.update().find(({ noteId }) => noteId === hold?.id);
    expect(completed).toMatchObject({ judgment: "perfect", hold: "completed" });
    expect(session.holdsCompleted).toBe(1);
    expect(session.holdsBroken).toBe(0);
  });

  it("emits procedural beat cues at the chart BPM and audio offset", () => {
    const map: RhythmBeatmap = {
      ...RHYTHM_BEATMAPS["puddle-pop"].easy,
      bpm: 120,
      audioOffsetMs: 375,
      durationMs: 2_000,
      notes: [],
    };
    const clock = new FakeClock(1_000);
    const session = new RhythmSession(map, clock);
    const transport = new RhythmBeatCueTransport(map);
    session.start();

    clock.advance(374);
    expect(transport.drain(session)).toEqual([]);
    clock.advance(1);
    expect(transport.drain(session)).toEqual([
      { beatIndex: 0, timeMs: 375, accent: true },
    ]);
    clock.advance(499);
    expect(transport.drain(session)).toEqual([]);
    clock.advance(1);
    expect(transport.drain(session)).toEqual([
      { beatIndex: 1, timeMs: 875, accent: false },
    ]);
  });

  it("resumes beat transport from the exact frozen point without stale cues", () => {
    const map = RHYTHM_BEATMAPS["carrot-bounce"].easy;
    const clock = new FakeClock(0);
    const session = new RhythmSession(map, clock);
    const transport = new RhythmBeatCueTransport(map);
    const beatDurationMs = 60_000 / map.bpm;
    session.start();
    clock.advance(map.audioOffsetMs);
    expect(transport.drain(session).map(({ beatIndex }) => beatIndex)).toEqual([0]);

    clock.advance(beatDurationMs - 10);
    session.pause();
    const frozenAt = session.songTimeMs;
    clock.advance(30_000);
    expect(session.songTimeMs).toBe(frozenAt);
    expect(transport.drain(session)).toEqual([]);

    session.resume();
    expect(session.songTimeMs).toBe(frozenAt);
    expect(transport.drain(session)).toEqual([]);
    clock.advance(10);
    expect(transport.drain(session)).toEqual([
      {
        beatIndex: 1,
        timeMs: map.audioOffsetMs + beatDurationMs,
        accent: false,
      },
    ]);
  });

  it("keeps the payout mapping stable and unpaid at zero", () => {
    expect(rhythmPayout(0, 0)).toEqual({ score: 0, coins: 3, xp: 0 });
    expect(rhythmPayout(35_000, 24)).toEqual({ score: 35_000, coins: 16, xp: 194 });
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
    expect(session.input(note.lane).judgment).toBe("sparkle");
  }
}
