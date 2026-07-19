import assert from "node:assert/strict";
import test from "node:test";
import { createMinigameLifecycle } from "../../core/contracts/minigame.ts";
import { createMarketSettlement } from "./settlement.ts";

function harness() {
  const receipts = new Map();
  const events = [];
  let best = 300;
  const lifecycle = createMinigameLifecycle(
    "market-scales",
    { now: () => 20_000 + events.length },
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
      finish: () => assert.fail("lifecycle path must not use legacy finish"),
    },
    receipts,
    events,
  };
}

test("market results settle exactly once", () => {
  const { context, receipts, events } = harness();
  const settlement = createMarketSettlement(context);
  settlement.begin();
  assert.equal(settlement.active, true);
  assert.equal(settlement.complete({ score: 1_200, coins: 10, xp: 22 }), 1_200);
  assert.equal(settlement.complete({ score: 4_000, coins: 40, xp: 90 }), null);
  assert.equal(receipts.size, 1);
  assert.deepEqual(events, ["run-began", "run-completed"]);
  assert.equal(settlement.persistedBest, 1_200);
});

test("restarting abandons the old estimate and pays only the replacement", () => {
  const { context, receipts, events } = harness();
  const settlement = createMarketSettlement(context);
  settlement.begin();
  settlement.begin();
  settlement.complete({ score: 700, coins: 5, xp: 12 });
  assert.equal(receipts.size, 1);
  assert.deepEqual(events, ["run-began", "run-exited", "run-began", "run-completed"]);
});

test("quit is unpaid before and after weight actions", () => {
  const { context, receipts, events } = harness();
  const settlement = createMarketSettlement(context);
  settlement.begin();
  assert.equal(settlement.exitUnpaid(), true);
  assert.equal(settlement.exitUnpaid(), false);
  assert.equal(receipts.size, 0);
  assert.deepEqual(events, ["run-began", "run-exited"]);
});
