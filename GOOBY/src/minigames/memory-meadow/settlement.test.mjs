import assert from "node:assert/strict";
import test from "node:test";
import { createMinigameLifecycle } from "../../core/contracts/minigame.ts";
import { SeededRng } from "../../core/contracts/rng.ts";
import {
  BREEZE_PEEK_SECONDS,
  MEADOW_CONFIGS,
  MemoryMeadowRound,
  meadowPayout,
} from "./model.ts";

function createHarness() {
  const receipts = new Map();
  const events = [];
  let now = 40_000;
  const lifecycle = createMinigameLifecycle(
    "memory-meadow",
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

function solve(round) {
  while (!round.isComplete) {
    if (round.shouldShuffle) {
      assert.ok(round.beginDandelionShuffle().length > 0);
      round.update(BREEZE_PEEK_SECONDS + 0.01);
    }
    const next = round.board.find(({ matched }) => !matched);
    if (next === undefined) break;
    const group = round.board.filter(
      ({ symbol, matched }) => symbol === next.symbol && !matched,
    );
    for (const card of group) round.flip(card.id);
  }
}

test("a completed meadow settles exactly once for its run id", () => {
  const harness = createHarness();
  const runId = harness.begin();
  const round = new MemoryMeadowRound(3, new SeededRng(2_026));
  solve(round);
  const result = round.result();
  assert.ok(result.stars >= 1);
  const payout = meadowPayout(result, 3);
  assert.ok(payout.coins > 0);

  const first = harness.lifecycle.completeRun(runId, payout);
  const replay = harness.lifecycle.completeRun(runId, { score: 9_999, coins: 99, xp: 99 });
  assert.equal(first, replay);
  assert.equal(harness.receipts.size, 1);
  assert.deepEqual(
    harness.events.map(({ kind }) => kind),
    ["run-began", "run-completed"],
  );
});

test("quitting a meadow run exits unpaid and never settles", () => {
  const harness = createHarness();
  harness.begin();
  const abandoned = new MemoryMeadowRound(2, new SeededRng(5));
  assert.deepEqual(meadowPayout(abandoned.result(), 2), { score: 0, coins: 0, xp: 0 });
  harness.lifecycle.exit();
  assert.equal(harness.receipts.size, 0);
  assert.deepEqual(
    harness.events.map(({ kind }) => kind),
    ["run-began", "run-exited"],
  );
});

test("breeze reveal events replay byte-identically from the same seed", () => {
  const play = (seed) => {
    const round = new MemoryMeadowRound(1, new SeededRng(seed));
    const halfway = Math.ceil(round.totalGroups / 2);
    const symbols = [...new Set(round.board.map(({ symbol }) => symbol))].slice(0, halfway);
    for (const symbol of symbols) {
      for (const card of round.board.filter((candidate) => candidate.symbol === symbol)) {
        round.flip(card.id);
      }
    }
    const events = round.beginDandelionShuffle();
    round.update(BREEZE_PEEK_SECONDS + 0.01);
    return { events, board: round.board.map(({ id }) => id) };
  };
  assert.deepEqual(play(913), play(913));
  assert.notDeepEqual(play(913).board, play(914).board);
});

test("hard tier stays 4x4 and the payout maps stars to coins", () => {
  assert.equal(MEADOW_CONFIGS[3].columns * MEADOW_CONFIGS[3].rows, 16);
  const paid = meadowPayout(
    { stars: 3, score: 3_600, elapsedSeconds: 30, moves: 7, bestSereneStreak: 7, sereneBonus: 945 },
    3,
  );
  assert.deepEqual(paid, { score: 3_600, coins: 27, xp: 40 });
});
