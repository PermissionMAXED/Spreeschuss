import assert from "node:assert/strict";
import test from "node:test";
import { createMinigameLifecycle } from "../../core/contracts/minigame.ts";
import {
  createFireflySettlement,
  FIREFLY_COIN_CAP,
  FIREFLY_XP_CAP,
  fireflyPayout,
} from "./settlement.ts";

function harness({ best = 0, withLifecycle = true } = {}) {
  const settlements = new Map();
  const bestScores = new Map([["firefly-lantern", best]]);
  const events = [];
  const finishes = [];
  let now = 9_000;
  const clock = { now: () => now };
  const lifecycle = withLifecycle
    ? createMinigameLifecycle(
      "firefly-lantern",
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

test("the payout curve is clamped, integer, and never negative", () => {
  assert.deepEqual(fireflyPayout(0, 0), { score: 0, coins: 0, xp: 0 });
  assert.deepEqual(fireflyPayout(-50, -3), { score: 0, coins: 0, xp: 0 });
  assert.deepEqual(fireflyPayout(Number.NaN, Number.NaN), { score: 0, coins: 0, xp: 0 });
  const mid = fireflyPayout(240, 3);
  assert.deepEqual(mid, { score: 240, coins: 20, xp: 52 });
  const capped = fireflyPayout(100_000, 50);
  assert.equal(capped.coins, FIREFLY_COIN_CAP);
  assert.equal(capped.xp, FIREFLY_XP_CAP);
  assert.equal(fireflyPayout(241.9, 2.9).score, 241);
});

test("a scored run settles exactly once through the lifecycle", () => {
  const { context, settlements, events, finishes } = harness();
  const settlement = createFireflySettlement(context);
  assert.equal(settlement.runActive, false);
  settlement.begin();
  assert.equal(settlement.runActive, true);
  assert.equal(settlement.settled, false);

  const best = settlement.complete(fireflyPayout(300, 4));
  assert.equal(best, 300);
  assert.equal(settlement.settled, true);
  assert.equal(settlement.runActive, false);
  assert.equal(settlements.size, 1);
  assert.deepEqual(events, ["run-began", "run-completed"]);
  assert.equal(finishes.length, 0);
  assert.deepEqual([...settlements.values()][0].payout, fireflyPayout(300, 4));

  // A second complete is inert: nothing new settles, nothing pays twice.
  assert.equal(settlement.complete(fireflyPayout(999, 9)), null);
  assert.equal(settlements.size, 1);
  assert.deepEqual(events, ["run-began", "run-completed"]);
});

test("exits never pay, and exit after settle stays silent", () => {
  const { context, settlements, events } = harness();
  const settlement = createFireflySettlement(context);

  // Exit without ever beginning: nothing to close, no run events at all.
  assert.equal(settlement.exitUnpaid(), false);
  assert.deepEqual(events, []);

  settlement.begin();
  assert.equal(settlement.exitUnpaid(), true);
  assert.equal(settlements.size, 0);
  assert.deepEqual(events, ["run-began", "run-exited"]);

  // Completing the abandoned run pays nothing.
  assert.equal(settlement.complete(fireflyPayout(120, 1)), null);
  assert.equal(settlements.size, 0);
});

test("restarting an open run abandons it before opening the next", () => {
  const { context, settlements, events } = harness();
  const settlement = createFireflySettlement(context);
  settlement.begin();
  settlement.begin();
  assert.deepEqual(events, ["run-began", "run-exited", "run-began"]);
  assert.equal(settlement.complete(fireflyPayout(60, 1)), 60);
  assert.equal(settlements.size, 1);
});

test("persistedBest tracks the lifecycle best across settles", () => {
  const { context } = harness({ best: 150 });
  const settlement = createFireflySettlement(context);
  assert.equal(settlement.persistedBest, 150);
  settlement.begin();
  settlement.complete(fireflyPayout(90, 0));
  assert.equal(settlement.persistedBest, 150, "lower scores never lower the best");
  settlement.begin();
  assert.equal(settlement.complete(fireflyPayout(400, 2)), 400);
  assert.equal(settlement.persistedBest, 400);
  assert.equal(settlement.receipt?.bestScore, 400);
});

test("without a lifecycle the wrapper falls back to context.finish", () => {
  const { context, finishes, events } = harness({ best: 42, withLifecycle: false });
  const settlement = createFireflySettlement(context);
  settlement.begin();
  assert.equal(settlement.complete(fireflyPayout(30, 0)), 42);
  assert.deepEqual(finishes, [fireflyPayout(30, 0)]);
  assert.deepEqual(events, []);
  // Double-complete still pays only once.
  assert.equal(settlement.complete(fireflyPayout(500, 5)), null);
  assert.equal(finishes.length, 1);
});
