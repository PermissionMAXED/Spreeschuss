import assert from "node:assert/strict";
import test from "node:test";
import { createMinigameLifecycle } from "../../core/contracts/minigame.ts";
import { createDeliverySettlement } from "./settlement.ts";

function createHarness(bestScore = 0) {
  let now = 1_000;
  let runId = "";
  const receipts = new Map();
  const feedback = [];
  const lifecycle = createMinigameLifecycle(
    "delivery-dash",
    { now: () => now },
    {
      getBestScore: () =>
        Math.max(bestScore, ...Array.from(receipts.values(), (receipt) => receipt.bestScore)),
      getSettlement: (candidate) => receipts.get(candidate) ?? null,
      settle: (receipt) => {
        receipts.set(receipt.runId, receipt);
        return receipt;
      },
    },
    { emit: (event) => feedback.push(event) },
  );
  const context = {
    clock: { now: () => now },
    rng: { next: () => 0.5, pick: (values) => values[0] },
    mount: {},
    lifecycle,
    finish: (payout) => lifecycle.completeRun(runId, payout),
  };
  return {
    context,
    feedback,
    receipts,
    begin() {
      now += 1;
      runId = lifecycle.beginRun();
      return createDeliverySettlement(context);
    },
  };
}

test("tutorial and zero-action exits abandon Delivery Dash without payment", () => {
  const harness = createHarness(320);
  const settlement = harness.begin();
  assert.equal(settlement.persistedBest, 320);
  assert.equal(settlement.abandon(), true);
  assert.equal(settlement.abandon(), false);
  assert.equal(harness.receipts.size, 0);
  assert.deepEqual(harness.feedback.map((event) => event.kind), ["run-began", "run-exited"]);
});

test("completed shifts settle once before a replay begins a distinct run", () => {
  const harness = createHarness();
  const first = harness.begin();
  assert.equal(first.complete({ score: 880, coins: 7, xp: 12 }), true);
  assert.equal(first.complete({ score: 999, coins: 99, xp: 99 }), false);
  assert.equal(harness.receipts.size, 1);

  const replay = harness.begin();
  assert.equal(replay.persistedBest, 880);
  assert.equal(replay.complete({ score: 420, coins: 3, xp: 6 }), true);
  assert.equal(harness.receipts.size, 2);
  assert.equal(new Set(harness.receipts.keys()).size, 2);
});
