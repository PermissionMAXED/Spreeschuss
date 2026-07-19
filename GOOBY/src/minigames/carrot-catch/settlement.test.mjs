import assert from "node:assert/strict";
import test from "node:test";
import { createMinigameLifecycle } from "../../core/contracts/minigame.ts";
import { MinigameRunSession } from "./run-session.ts";
import { carrotCatchPayout } from "./logic.ts";
import { bunnyHopPayout } from "../bunny-hop/logic.ts";
import { pancakePeakPayout } from "../pancake-peak/logic.ts";

function createHarness(minigameId) {
  const receipts = new Map();
  const events = [];
  let now = 50_000;
  const lifecycle = createMinigameLifecycle(
    minigameId,
    { now: () => (now += 1) },
    {
      getBestScore: () =>
        Math.max(0, ...Array.from(receipts.values(), ({ bestScore }) => bestScore)),
      getSettlement: (runId) => receipts.get(runId) ?? null,
      settle: (receipt) => {
        const previous = receipts.get(receipt.runId);
        if (previous) return previous;
        receipts.set(receipt.runId, receipt);
        return receipt;
      },
    },
    { emit: (event) => events.push(event) },
  );
  return { receipts, events, lifecycle, session: new MinigameRunSession(lifecycle) };
}

const trio = [
  { id: "carrot-catch", payout: () => carrotCatchPayout(1_840, 12) },
  { id: "bunny-hop", payout: () => bunnyHopPayout(2_150, 2_600, 9) },
  { id: "pancake-peak", payout: () => pancakePeakPayout(760, 14, 4) },
];

for (const { id, payout } of trio) {
  test(`${id} settles a rewarded run exactly once`, () => {
    const harness = createHarness(id);
    harness.session.begin();
    harness.session.markAction();
    const first = harness.session.complete(payout());
    const replay = harness.session.complete({ score: 999_999, coins: 999, xp: 999 });

    assert.equal(harness.receipts.size, 1);
    assert.equal(first, replay);
    assert.deepEqual(first.payout, payout());
    assert.deepEqual(
      harness.events.map(({ kind }) => kind),
      ["run-began", "run-completed"],
    );
  });

  test(`${id} zero-action quits stay unpaid`, () => {
    const harness = createHarness(id);
    harness.session.begin();
    const receipt = harness.session.quit(payout());

    assert.equal(receipt, null);
    assert.equal(harness.receipts.size, 0);
    assert.deepEqual(
      harness.events.map(({ kind }) => kind),
      ["run-began", "run-exited"],
    );
  });

  test(`${id} quits after a real action settle the honest payout`, () => {
    const harness = createHarness(id);
    harness.session.begin();
    harness.session.markAction();
    const receipt = harness.session.quit(payout());

    assert.notEqual(receipt, null);
    assert.deepEqual(receipt.payout, payout());
    assert.equal(harness.receipts.size, 1);
  });
}

test("payout curves are pure, clamped, and never negative", () => {
  assert.deepEqual(carrotCatchPayout(-50, -3), carrotCatchPayout(-50, -3));
  for (const payout of [
    carrotCatchPayout(0, 0),
    bunnyHopPayout(-10, 0, 0),
    pancakePeakPayout(0, 0, 0),
  ]) {
    assert.ok(payout.score >= 0);
    assert.ok(payout.coins >= 0);
    assert.ok(payout.xp >= 0);
  }
  assert.ok(bunnyHopPayout(10_000_000, 1_000_000, 9_999).coins <= 120);
  assert.ok(bunnyHopPayout(10_000_000, 1_000_000, 9_999).xp <= 250);
  assert.ok(pancakePeakPayout(10_000_000, 9_999, 9_999).coins <= 130);
  assert.ok(pancakePeakPayout(10_000_000, 9_999, 9_999).xp <= 260);
});
