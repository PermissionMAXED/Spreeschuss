import assert from "node:assert/strict";
import test from "node:test";
import { createMinigameLifecycle } from "../../core/contracts/minigame.ts";
import {
  CLOUD_COIN_CAP,
  CLOUD_XP_CAP,
  cloudPayout,
  createCloudSettlement,
} from "./settlement.ts";

function harness({ best = 0, withLifecycle = true } = {}) {
  const settlements = new Map();
  const bestScores = new Map([["cloud-bounce", best]]);
  const events = [];
  const finishes = [];
  let now = 7_000;
  const clock = { now: () => now };
  const lifecycle = withLifecycle
    ? createMinigameLifecycle(
      "cloud-bounce",
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
  assert.deepEqual(cloudPayout(0, 0), { score: 0, coins: 0, xp: 0 });
  assert.deepEqual(cloudPayout(-40, -2), { score: 0, coins: 0, xp: 0 });
  assert.deepEqual(cloudPayout(Number.NaN, Number.NaN), { score: 0, coins: 0, xp: 0 });
  const mid = cloudPayout(280, 4);
  assert.deepEqual(mid, { score: 280, coins: 24, xp: 52 });
  const capped = cloudPayout(100_000, 60);
  assert.equal(capped.coins, CLOUD_COIN_CAP);
  assert.equal(capped.xp, CLOUD_XP_CAP);
  assert.equal(cloudPayout(281.9, 3.7).score, 281);
});

test("a scored run settles exactly once through the lifecycle", () => {
  const { context, settlements, events, finishes } = harness();
  const settlement = createCloudSettlement(context);
  assert.equal(settlement.runActive, false);
  settlement.begin();
  assert.equal(settlement.runActive, true);
  assert.equal(settlement.settled, false);

  const best = settlement.complete(cloudPayout(320, 5));
  assert.equal(best, 320);
  assert.equal(settlement.settled, true);
  assert.equal(settlement.runActive, false);
  assert.equal(settlements.size, 1);
  assert.deepEqual(events, ["run-began", "run-completed"]);
  assert.equal(finishes.length, 0);
  assert.deepEqual([...settlements.values()][0].payout, cloudPayout(320, 5));

  // A second complete is inert: nothing new settles, nothing pays twice.
  assert.equal(settlement.complete(cloudPayout(999, 9)), null);
  assert.equal(settlements.size, 1);
  assert.deepEqual(events, ["run-began", "run-completed"]);
});

test("exits never pay, and exit after settle stays silent", () => {
  const { context, settlements, events } = harness();
  const settlement = createCloudSettlement(context);

  // Exit without ever beginning: nothing to close, no run events at all.
  assert.equal(settlement.exitUnpaid(), false);
  assert.deepEqual(events, []);

  settlement.begin();
  assert.equal(settlement.exitUnpaid(), true);
  assert.equal(settlements.size, 0);
  assert.deepEqual(events, ["run-began", "run-exited"]);

  // Completing the abandoned run pays nothing.
  assert.equal(settlement.complete(cloudPayout(140, 2)), null);
  assert.equal(settlements.size, 0);
});

test("restarting an open run abandons it before opening the next", () => {
  const { context, settlements, events } = harness();
  const settlement = createCloudSettlement(context);
  settlement.begin();
  settlement.begin();
  assert.deepEqual(events, ["run-began", "run-exited", "run-began"]);
  assert.equal(settlement.complete(cloudPayout(70, 1)), 70);
  assert.equal(settlements.size, 1);
});

test("persistedBest tracks the lifecycle best across settles", () => {
  const { context } = harness({ best: 200 });
  const settlement = createCloudSettlement(context);
  assert.equal(settlement.persistedBest, 200);
  settlement.begin();
  settlement.complete(cloudPayout(80, 0));
  assert.equal(settlement.persistedBest, 200, "lower scores never lower the best");
  settlement.begin();
  assert.equal(settlement.complete(cloudPayout(500, 3)), 500);
  assert.equal(settlement.persistedBest, 500);
  assert.equal(settlement.receipt?.bestScore, 500);
});

test("without a lifecycle the wrapper falls back to context.finish", () => {
  const { context, finishes, events } = harness({ best: 55, withLifecycle: false });
  const settlement = createCloudSettlement(context);
  settlement.begin();
  assert.equal(settlement.complete(cloudPayout(40, 1)), 55);
  assert.deepEqual(finishes, [cloudPayout(40, 1)]);
  assert.deepEqual(events, []);
  // Double-complete still pays only once.
  assert.equal(settlement.complete(cloudPayout(600, 6)), null);
  assert.equal(finishes.length, 1);
});
