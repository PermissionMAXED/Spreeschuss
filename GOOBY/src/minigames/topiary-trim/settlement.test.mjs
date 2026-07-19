import assert from "node:assert/strict";
import test from "node:test";
import { createTopiarySettlement } from "./settlement.ts";

test("topiary settlement is replay-safe and unpaid exits never finish", () => {
  const events = [];
  const receipts = [];
  let run = 0;
  const context = {
    clock: { now: () => 0 },
    rng: { next: () => 0, int: (low) => low, pick: (items) => items[0] },
    mount: {},
    finish: (payout) => receipts.push(payout),
    lifecycle: {
      feedback: { emit: () => {} },
      persistedBest: 120,
      beginRun: () => {
        run += 1;
        events.push(`begin:${run}`);
        return `topiary:${run}`;
      },
      completeRun: (runId, payout) => {
        events.push(`complete:${runId}`);
        receipts.push(payout);
        return {
          runId,
          minigameId: "topiary-trim",
          payout,
          bestScore: Math.max(120, payout.score),
          completedAt: 1,
        };
      },
      exit: () => events.push("exit"),
    },
  };
  const settlement = createTopiarySettlement(context);
  settlement.begin();
  const payout = { score: 900, coins: 20, xp: 40 };
  assert.deepEqual(settlement.complete(payout), payout);
  assert.equal(settlement.complete(payout), null);
  assert.equal(receipts.length, 1);
  assert.equal(settlement.persistedBest, 900);
  settlement.begin();
  assert.equal(settlement.exitUnpaid(), true);
  assert.equal(settlement.exitUnpaid(), false);
  assert.equal(receipts.length, 1);
  assert.deepEqual(events, ["begin:1", "complete:topiary:1", "begin:2", "exit"]);
});
