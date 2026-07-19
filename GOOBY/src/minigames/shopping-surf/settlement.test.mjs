import assert from "node:assert/strict";
import test from "node:test";
import { createMinigameLifecycle } from "../../core/contracts/minigame.ts";
import { createSurfSettlement } from "./settlement.ts";

function harness({ best = 0, withLifecycle = true } = {}) {
  const settlements = new Map();
  const bestScores = new Map([["shopping-surf", best]]);
  const events = [];
  const finishes = [];
  let now = 5_000;
  const clock = { now: () => now };
  const lifecycle = withLifecycle
    ? createMinigameLifecycle(
      "shopping-surf",
      clock,
      {
        getBestScore: (id) => bestScores.get(id) ?? 0,
        getSettlement: (runId) => settlements.get(runId) ?? null,
        settle: (receipt) => {
          const previous = settlements.get(receipt.runId);
          if (previous) return previous;
          settlements.set(receipt.runId, receipt);
          bestScores.set(receipt.minigameId, receipt.bestScore);
          return receipt;
        },
      },
      { emit: (event) => events.push(event.kind) },
    )
    : undefined;
  const context = {
    clock,
    rng: { next: () => 0.5, int: () => 0, pick: (items) => items[0] },
    mount: null,
    ...(lifecycle ? { lifecycle } : {}),
    bestScore: best,
    finish: (payout) => finishes.push(payout),
  };
  return {
    context,
    settlements,
    events,
    finishes,
    advanceClock: (ms) => {
      now += ms;
    },
  };
}

test("a scored run settles exactly once through the lifecycle", () => {
  const { context, settlements, events, finishes } = harness();
  const settlement = createSurfSettlement(context);
  assert.equal(settlement.runActive, false);
  settlement.begin();
  assert.equal(settlement.runActive, true);
  assert.equal(settlement.settled, false);

  const best = settlement.complete({ score: 1_500, coins: 12, xp: 30 });
  assert.equal(best, 1_500);
  assert.equal(settlement.settled, true);
  assert.equal(settlement.runActive, false);
  assert.equal(settlements.size, 1);
  assert.deepEqual(events, ["run-began", "run-completed"]);
  assert.equal(finishes.length, 0);
  assert.deepEqual([...settlements.values()][0].payout, { score: 1_500, coins: 12, xp: 30 });

  // A second complete is inert: nothing new settles, nothing pays twice.
  assert.equal(settlement.complete({ score: 9_999, coins: 1, xp: 1 }), null);
  assert.equal(settlements.size, 1);
  assert.deepEqual(events, ["run-began", "run-completed"]);
});

test("exits never pay, and exit after settle stays silent", () => {
  const { context, settlements, events } = harness();
  const settlement = createSurfSettlement(context);

  // Exit without ever beginning: nothing to close, no run events at all.
  assert.equal(settlement.exitUnpaid(), false);
  assert.deepEqual(events, []);

  // Begin then abandon (tutorial/practice/pause-quit paths).
  settlement.begin();
  assert.equal(settlement.exitUnpaid(), true);
  assert.equal(settlements.size, 0);
  assert.deepEqual(events, ["run-began", "run-exited"]);

  // Completing an abandoned run must not settle.
  assert.equal(settlement.complete({ score: 500, coins: 1, xp: 1 }), null);
  assert.equal(settlements.size, 0);

  // Settle a real run, then the dispose-path exit must not re-pay or re-exit.
  settlement.begin();
  settlement.complete({ score: 700, coins: 4, xp: 10 });
  assert.equal(settlement.exitUnpaid(), false);
  assert.equal(settlements.size, 1);
  assert.deepEqual(events, ["run-began", "run-exited", "run-began", "run-completed"]);
});

test("restarting an open run abandons it before paying the new one", () => {
  const { context, settlements, events, advanceClock } = harness();
  const settlement = createSurfSettlement(context);
  settlement.begin();
  advanceClock(1_000);
  settlement.begin(); // Pause-menu restart while a run is open.
  assert.deepEqual(events, ["run-began", "run-exited", "run-began"]);
  settlement.complete({ score: 300, coins: 2, xp: 4 });
  assert.equal(settlements.size, 1);
  assert.deepEqual(
    events,
    ["run-began", "run-exited", "run-began", "run-completed"],
  );
});

test("persisted best tracks receipts and never regresses", () => {
  const { context } = harness({ best: 900 });
  const settlement = createSurfSettlement(context);
  assert.equal(settlement.persistedBest, 900);
  settlement.begin();
  assert.equal(settlement.complete({ score: 400, coins: 2, xp: 5 }), 900);
  assert.equal(settlement.persistedBest, 900);
  settlement.begin();
  assert.equal(settlement.complete({ score: 1_200, coins: 8, xp: 17 }), 1_200);
  assert.equal(settlement.persistedBest, 1_200);
  assert.equal(settlement.receipt?.bestScore, 1_200);
});

test("without a lifecycle the legacy finish port pays exactly once", () => {
  const { context, finishes } = harness({ best: 250, withLifecycle: false });
  const settlement = createSurfSettlement(context);
  assert.equal(settlement.persistedBest, 250);
  settlement.begin();
  const best = settlement.complete({ score: 800, coins: 5, xp: 11 });
  assert.equal(best, 800);
  assert.deepEqual(finishes, [{ score: 800, coins: 5, xp: 11 }]);
  assert.equal(settlement.complete({ score: 900, coins: 1, xp: 1 }), null);
  assert.equal(finishes.length, 1);

  // Unpaid exit without a lifecycle is also safe.
  settlement.begin();
  assert.equal(settlement.exitUnpaid(), true);
  assert.equal(finishes.length, 1);
});
