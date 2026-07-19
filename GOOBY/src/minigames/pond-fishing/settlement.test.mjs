import assert from "node:assert/strict";
import test from "node:test";
import { createMinigameLifecycle } from "../../core/contracts/minigame.ts";
import { SeededRng } from "../../core/contracts/rng.ts";
import {
  FISH_SPECIES,
  chooseSpecies,
  pondPayout,
  pondStockPhaseAt,
  stockOdds,
} from "./model.ts";

function createHarness() {
  const receipts = new Map();
  const events = [];
  let now = 90_000;
  const lifecycle = createMinigameLifecycle(
    "pond-fishing",
    { now: () => now },
    {
      getBestScore: () =>
        Math.max(0, ...Array.from(receipts.values(), ({ bestScore }) => bestScore)),
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

test("a fished-out pond settles exactly once for its run id", () => {
  const harness = createHarness();
  const runId = harness.begin();
  const payout = pondPayout(3_150, 6, 1);
  const first = harness.lifecycle.completeRun(runId, payout);
  const replay = harness.lifecycle.completeRun(runId, { score: 1, coins: 1, xp: 1 });
  assert.equal(first, replay);
  assert.equal(harness.receipts.size, 1);
  assert.deepEqual(
    harness.events.map(({ kind }) => kind),
    ["run-began", "run-completed"],
  );
});

test("quitting the pond before any cast exits unpaid", () => {
  const harness = createHarness();
  harness.begin();
  assert.deepEqual(pondPayout(0, 0, 0), { score: 0, coins: 0, xp: 0 });
  harness.lifecycle.exit();
  assert.equal(harness.receipts.size, 0);
  assert.deepEqual(
    harness.events.map(({ kind }) => kind),
    ["run-began", "run-exited"],
  );
});

test("seeded pulls replay identically and follow the posted stock", () => {
  const pulls = (seed) => {
    const rng = new SeededRng(seed);
    return Array.from({ length: 48 }, () => chooseSpecies(rng, "legend", "feather-lure", "night").id);
  };
  assert.deepEqual(pulls(404), pulls(404));

  const stocked = new Set(
    stockOdds("legend", "feather-lure", "night")
      .filter(({ percent }) => percent > 0)
      .map(({ species }) => species.id),
  );
  for (const id of pulls(404)) assert.ok(stocked.has(id));
});

test("the clock-injected stock swaps nocturnal and diurnal species", () => {
  assert.equal(pondStockPhaseAt(12 * 3_600_000), "day");
  assert.equal(pondStockPhaseAt(23 * 3_600_000), "night");
  const dayIds = new Set(
    stockOdds("ripple", "everyday-float", "day")
      .filter(({ percent }) => percent > 0)
      .map(({ species }) => species.id),
  );
  const nightIds = new Set(
    stockOdds("ripple", "everyday-float", "night")
      .filter(({ percent }) => percent > 0)
      .map(({ species }) => species.id),
  );
  assert.ok(!dayIds.has("moonback-catfish"));
  assert.ok(nightIds.has("moonback-catfish"));
  assert.equal(FISH_SPECIES.filter(({ rarity }) => rarity === "legendary").length, 1);
});
