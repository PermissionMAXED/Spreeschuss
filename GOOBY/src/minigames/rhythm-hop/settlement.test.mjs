import assert from "node:assert/strict";
import test from "node:test";
import { createMinigameLifecycle } from "../../core/contracts/minigame.ts";
import {
  RhythmSession,
  compileChartFile,
  rhythmPayout,
} from "./model.ts";
import { DEWDROP_DERBY_CHART } from "./songs/dewdrop-derby.ts";
import { FIREFLY_WALTZ_CHART } from "./songs/firefly-waltz.ts";

const CHART_FILES = [FIREFLY_WALTZ_CHART, DEWDROP_DERBY_CHART];

// Local fake clock: core FakeClock uses a TS parameter property, which the
// strip-types specialist runner cannot load.
function makeClock(startMs = 0) {
  let value = startMs;
  return {
    now: () => value,
    advance(ms) {
      value += ms;
    },
  };
}

function createHarness() {
  const receipts = new Map();
  const events = [];
  let now = 70_000;
  const lifecycle = createMinigameLifecycle(
    "rhythm-hop",
    { now: () => now },
    {
      getBestScore: () =>
        Math.max(0, ...Array.from(receipts.values(), ({ bestScore }) => bestScore)),
      getSettlement: (runId) => receipts.get(runId) ?? null,
      settle: (receipt) => {
        receipts.set(receipt.runId, receipt);
        return receipt;
      },
    },
    { emit: (event) => events.push(event) },
  );
  return {
    receipts,
    events,
    lifecycle,
    begin() {
      now += 1;
      return lifecycle.beginRun();
    },
  };
}

test("a finished song settles exactly once for its run id", () => {
  const harness = createHarness();
  const runId = harness.begin();
  const clock = makeClock();
  const session = new RhythmSession(compileChartFile(FIREFLY_WALTZ_CHART, "easy"), clock);
  session.start();
  for (const note of session.beatmap.notes) {
    clock.advance(note.timeMs - session.songTimeMs);
    assert.notEqual(session.input(note.lane).judgment, "miss");
    if (note.holdMs !== undefined) {
      clock.advance(note.holdMs);
      session.update();
    }
  }
  clock.advance(session.beatmap.durationMs - session.songTimeMs + 1);
  session.update();
  assert.equal(session.state, "ended");
  assert.equal(session.misses, 0);
  assert.ok(session.holdsCompleted > 0);

  const payout = rhythmPayout(session.score, session.bestCombo);
  assert.ok(payout.coins > 3);
  const first = harness.lifecycle.completeRun(runId, payout);
  const replay = harness.lifecycle.completeRun(runId, { score: 1, coins: 1, xp: 1 });
  assert.equal(first, replay);
  assert.equal(harness.receipts.size, 1);
  assert.deepEqual(
    harness.events.map(({ kind }) => kind),
    ["run-began", "run-completed"],
  );
});

test("quitting a song before any hop exits unpaid", () => {
  const harness = createHarness();
  harness.begin();
  harness.lifecycle.exit();
  assert.equal(harness.receipts.size, 0);
  assert.deepEqual(
    harness.events.map(({ kind }) => kind),
    ["run-began", "run-exited"],
  );
});

test("file-backed charts compile byte-identically every time", () => {
  assert.deepEqual(
    CHART_FILES.map(({ id }) => id),
    ["firefly-waltz", "dewdrop-derby"],
  );
  for (const file of CHART_FILES) {
    for (const difficulty of ["easy", "hard"]) {
      const first = compileChartFile(file, difficulty);
      const second = compileChartFile(file, difficulty);
      assert.deepEqual(first, second);
      assert.ok(first.notes.some(({ holdMs }) => holdMs !== undefined));
      assert.deepEqual(
        [...first.notes].sort((a, b) => a.timeMs - b.timeMs),
        [...first.notes],
      );
    }
  }
});

test("the audio clock freezes held notes across pause and resume", () => {
  const clock = makeClock();
  const session = new RhythmSession(compileChartFile(DEWDROP_DERBY_CHART, "easy"), clock);
  const hold = session.beatmap.notes.find(({ holdMs }) => holdMs !== undefined);
  assert.ok(hold);
  session.start();
  clock.advance(hold.timeMs);
  assert.equal(session.input(hold.lane).hold, "started");

  clock.advance(Math.floor(hold.holdMs / 3));
  session.pause();
  const frozenAt = session.songTimeMs;
  clock.advance(120_000);
  assert.equal(session.songTimeMs, frozenAt);
  assert.deepEqual(session.update(), []);
  assert.equal(session.release(hold.lane), null);
  assert.equal(session.isHoldActive(hold.id), true);

  session.resume();
  assert.equal(session.songTimeMs, frozenAt);
  clock.advance(hold.timeMs + hold.holdMs - frozenAt + 1);
  const completed = session.update().find(({ noteId }) => noteId === hold.id);
  assert.equal(completed?.hold, "completed");
  assert.equal(session.holdsCompleted, 1);
  assert.equal(session.holdsBroken, 0);
});
