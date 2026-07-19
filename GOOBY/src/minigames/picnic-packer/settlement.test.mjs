import assert from "node:assert/strict";
import test from "node:test";
import { createMinigameLifecycle } from "../../core/contracts/minigame.ts";
import { createPicnicSettlement } from "./settlement.ts";

function harness(withLifecycle = true) {
  const receipts = new Map();
  const events = [];
  const finishes = [];
  let best = 120;
  const lifecycle = withLifecycle
    ? createMinigameLifecycle(
      "picnic-packer",
      { now: () => 10_000 + events.length },
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
    )
    : undefined;
  return {
    context: {
      clock: { now: () => 0 },
      rng: { next: () => 0.5, int: () => 0, pick: (items) => items[0] },
      mount: null,
      ...(lifecycle ? { lifecycle } : {}),
      bestScore: best,
      finish: (payout) => finishes.push(payout),
    },
    receipts,
    events,
    finishes,
  };
}

test("picnic settlement pays once and preserves the persisted best", () => {
  const { context, receipts, events } = harness();
  const settlement = createPicnicSettlement(context);
  assert.equal(settlement.persistedBest, 120);
  settlement.begin();
  assert.equal(settlement.complete({ score: 900, coins: 10, xp: 20 }), 900);
  assert.equal(settlement.complete({ score: 9999, coins: 40, xp: 90 }), null);
  assert.equal(receipts.size, 1);
  assert.deepEqual(events, ["run-began", "run-completed"]);
  assert.equal(settlement.persistedBest, 900);
});

test("tutorial, pause, and dispose exits remain unpaid and idempotent", () => {
  const { context, receipts, events } = harness();
  const settlement = createPicnicSettlement(context);
  assert.equal(settlement.exitUnpaid(), false);
  settlement.begin();
  assert.equal(settlement.exitUnpaid(), true);
  assert.equal(settlement.exitUnpaid(), false);
  assert.equal(receipts.size, 0);
  assert.deepEqual(events, ["run-began", "run-exited"]);
});

test("legacy finish fallback also settles at most once", () => {
  const { context, finishes } = harness(false);
  const settlement = createPicnicSettlement(context);
  settlement.begin();
  assert.equal(settlement.complete({ score: 400, coins: 4, xp: 8 }), 400);
  settlement.complete({ score: 800, coins: 8, xp: 16 });
  assert.equal(finishes.length, 1);
});
