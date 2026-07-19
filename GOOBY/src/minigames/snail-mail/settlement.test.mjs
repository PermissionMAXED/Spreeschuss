import assert from "node:assert/strict";
import test from "node:test";
import { createSnailMailSettlement } from "./settlement.ts";

function contextHarness() {
  const events = [];
  const completed = [];
  let sequence = 0;
  const lifecycle = {
    feedback: { emit: () => {} },
    persistedBest: 240,
    beginRun() {
      sequence += 1;
      events.push(`begin:${sequence}`);
      return `snail:${sequence}`;
    },
    completeRun(runId, payout) {
      completed.push({ runId, payout });
      events.push(`complete:${runId}`);
      return {
        runId,
        minigameId: "snail-mail",
        payout,
        bestScore: Math.max(240, payout.score),
        completedAt: 1_000,
      };
    },
    exit() {
      events.push("exit");
    },
  };
  return {
    events,
    completed,
    context: {
      lifecycle,
      clock: { now: () => 1_000 },
      rng: { next: () => 0, int: (low) => low, pick: (items) => items[0] },
      mount: {},
      finish: (payout) => completed.push({ runId: "fallback", payout }),
    },
  };
}

test("settlement pays a run exactly once and preserves persisted best", () => {
  const harness = contextHarness();
  const settlement = createSnailMailSettlement(harness.context);
  assert.equal(settlement.persistedBest, 240);
  settlement.begin();
  assert.equal(settlement.active, true);
  const payout = { score: 480, coins: 12, xp: 24 };
  assert.deepEqual(settlement.complete(payout), payout);
  assert.equal(settlement.complete(payout), null);
  assert.equal(harness.completed.length, 1);
  assert.equal(settlement.persistedBest, 480);
  assert.deepEqual(harness.events, ["begin:1", "complete:snail:1"]);
});

test("restart and unpaid exit abandon runs without settlement", () => {
  const harness = contextHarness();
  const settlement = createSnailMailSettlement(harness.context);
  settlement.begin();
  settlement.begin();
  assert.equal(settlement.exitUnpaid(), true);
  assert.equal(settlement.exitUnpaid(), false);
  assert.equal(harness.completed.length, 0);
  assert.deepEqual(harness.events, ["begin:1", "exit", "begin:2", "exit"]);
});
