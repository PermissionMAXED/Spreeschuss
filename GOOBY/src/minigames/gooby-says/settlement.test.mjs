import assert from "node:assert/strict";
import test from "node:test";
import { createMinigameLifecycle } from "../../core/contracts/minigame.ts";
import { goobySaysPayout } from "./logic.ts";

function createHarness() {
  const receipts = new Map();
  const events = [];
  let now = 10_000;
  const lifecycle = createMinigameLifecycle(
    "gooby-says",
    { now: () => now },
    {
      getBestScore: () => Math.max(0, ...Array.from(receipts.values(), ({ bestScore }) => bestScore)),
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

test("Gooby Says settles a rewarded run at most once", () => {
  const harness = createHarness();
  const runId = harness.begin();
  const payout = goobySaysPayout(2_400, 5, false);
  const first = harness.lifecycle.completeRun(runId, payout);
  const replay = harness.lifecycle.completeRun(runId, { score: 9_999, coins: 99, xp: 99 });

  assert.equal(harness.receipts.size, 1);
  assert.equal(first, replay);
  assert.deepEqual(harness.events.map(({ kind }) => kind), ["run-began", "run-completed"]);
});

test("practice is unpaid and never opens a lifecycle run", () => {
  const harness = createHarness();
  const payout = goobySaysPayout(2_400, 5, true);

  assert.deepEqual(payout, { score: 2_400, coins: 0, xp: 0 });
  assert.equal(harness.receipts.size, 0);
  assert.deepEqual(harness.events, []);
});
