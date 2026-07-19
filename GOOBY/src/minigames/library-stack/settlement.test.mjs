import assert from "node:assert/strict";
import test from "node:test";
import { createMinigameLifecycle } from "../../core/contracts/minigame.ts";
import { createLibrarySettlement } from "./settlement.ts";

function harness() {
  const receipts = new Map();
  const events = [];
  const finishes = [];
  let best = 0;
  const lifecycle = createMinigameLifecycle(
    "library-stack",
    { now: () => 30_000 + events.length },
    {
      getBestScore: () => best,
      getSettlement: (id) => receipts.get(id) ?? null,
      settle: (receipt) => {
        receipts.set(receipt.runId, receipt);
        best = receipt.bestScore;
        return receipt;
      },
    },
    { emit: (event) => events.push(event.kind) },
  );
  return {
    context: {
      clock: { now: () => 0 },
      rng: { next: () => 0.5, int: () => 0, pick: (items) => items[0] },
      mount: null,
      lifecycle,
      finish: (payout) => finishes.push(payout),
    },
    receipts,
    events,
    finishes,
  };
}

test("a completed library tower settles once with its exact payout", () => {
  const { context, receipts, events, finishes } = harness();
  const settlement = createLibrarySettlement(context);
  settlement.begin();
  const payout = { score: 2_400, coins: 22, xp: 48 };
  assert.equal(settlement.complete(payout), payout.score);
  assert.equal(settlement.complete({ score: 1, coins: 1, xp: 1 }), null);
  assert.equal(receipts.size, 1);
  assert.deepEqual([...receipts.values()][0].payout, payout);
  assert.deepEqual(events, ["run-began", "run-completed"]);
  assert.equal(finishes.length, 0);
});

test("tutorial and pause quits abandon the run without payout", () => {
  const { context, receipts, events } = harness();
  const settlement = createLibrarySettlement(context);
  assert.equal(settlement.exitUnpaid(), false);
  settlement.begin();
  assert.equal(settlement.exitUnpaid(), true);
  assert.equal(settlement.exitUnpaid(), false);
  assert.equal(receipts.size, 0);
  assert.deepEqual(events, ["run-began", "run-exited"]);
});

test("restart exits the stale run before the replacement settles", () => {
  const { context, receipts, events } = harness();
  const settlement = createLibrarySettlement(context);
  settlement.begin();
  settlement.begin();
  settlement.complete({ score: 500, coins: 4, xp: 10 });
  assert.equal(receipts.size, 1);
  assert.deepEqual(events, ["run-began", "run-exited", "run-began", "run-completed"]);
});
