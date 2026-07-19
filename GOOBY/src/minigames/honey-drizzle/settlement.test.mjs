import assert from "node:assert/strict";
import test from "node:test";
import { createHoneySettlement } from "./settlement.ts";

test("honey settlement completes once and abandons restarts unpaid", () => {
  const events = [];
  const paid = [];
  let sequence = 0;
  const context = {
    clock: { now: () => 0 },
    rng: { next: () => 0, int: (low) => low, pick: (items) => items[0] },
    mount: {},
    finish: (payout) => paid.push(payout),
    lifecycle: {
      feedback: { emit: () => {} },
      persistedBest: 300,
      beginRun: () => {
        sequence += 1;
        events.push(`begin:${sequence}`);
        return `honey:${sequence}`;
      },
      completeRun: (runId, payout) => {
        events.push(`complete:${runId}`);
        paid.push(payout);
        return {
          runId,
          minigameId: "honey-drizzle",
          payout,
          bestScore: Math.max(300, payout.score),
          completedAt: 2,
        };
      },
      exit: () => events.push("exit"),
    },
  };
  const settlement = createHoneySettlement(context);
  settlement.begin();
  settlement.begin();
  assert.deepEqual(events, ["begin:1", "exit", "begin:2"]);
  const payout = { score: 1_200, coins: 25, xp: 50 };
  assert.deepEqual(settlement.complete(payout), payout);
  assert.equal(settlement.complete(payout), null);
  assert.equal(paid.length, 1);
  assert.equal(settlement.persistedBest, 1_200);
  settlement.begin();
  assert.equal(settlement.exitUnpaid(), true);
  assert.equal(paid.length, 1);
});
