import assert from "node:assert/strict";
import test from "node:test";
import { createMinigameLifecycle } from "../../core/contracts/minigame.ts";
import { createCannonSettlement } from "./settlement.ts";

function createHarness(bestScore = 0) {
  let now = 2_000;
  let runId = "";
  const receipts = new Map();
  const feedback = [];
  const lifecycle = createMinigameLifecycle(
    "carrot-cannon",
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
      return createCannonSettlement(context);
    },
  };
}

test("leaving Cannon before a shot exits without a settlement", () => {
  const harness = createHarness(640);
  const settlement = harness.begin();
  assert.equal(settlement.persistedBest, 640);
  assert.equal(settlement.abandon(), true);
  assert.equal(harness.receipts.size, 0);
  assert.deepEqual(harness.feedback.map((event) => event.kind), ["run-began", "run-exited"]);
});

test("a clear settles once and replay starts a separately payable run", () => {
  const harness = createHarness();
  const clear = harness.begin();
  assert.equal(clear.complete({ score: 1_450, coins: 6, xp: 15 }), true);
  assert.equal(clear.complete({ score: 9_999, coins: 90, xp: 180 }), false);
  assert.equal(harness.receipts.size, 1);

  const replay = harness.begin();
  assert.equal(replay.persistedBest, 1_450);
  assert.equal(replay.complete({ score: 900, coins: 4, xp: 9 }), true);
  assert.equal(harness.receipts.size, 2);
  assert.equal(new Set(harness.receipts.keys()).size, 2);
});

test("module-managed Cannon runs begin, settle, and ignore duplicate terminal actions", () => {
  const harness = createHarness();
  const settlement = createCannonSettlement(harness.context);
  settlement.begin();
  assert.equal(settlement.runActive, true);
  assert.equal(settlement.complete({ score: 720, coins: 3, xp: 8 }), true);
  assert.equal(settlement.complete({ score: 9_999, coins: 90, xp: 180 }), false);
  assert.equal(settlement.runActive, false);
  assert.equal(settlement.receipt?.bestScore, 720);
  assert.equal(harness.receipts.size, 1);
  assert.deepEqual(harness.feedback.map((event) => event.kind), ["run-began", "run-completed"]);
});
