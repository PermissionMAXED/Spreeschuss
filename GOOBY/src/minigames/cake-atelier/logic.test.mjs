import assert from "node:assert/strict";
import test from "node:test";
import { createMinigameLifecycle } from "../../core/contracts/minigame.ts";
import { SeededRng } from "../../core/contracts/rng.ts";
import {
  AtelierSession,
  FROST_REQUIRED_COVERAGE,
  needleSweepsPerSecond,
  ORDERS_PER_ROUND,
  rollOrderQueue,
  settlePayout,
} from "./logic.ts";

/** Plays one order perfectly: centered needle stops, centered drops, full frosting. */
function playPerfectOrder(session) {
  const order = session.currentOrder;
  session.selectFlavor(order.flavor);
  for (let layer = 0; layer < order.layers; layer += 1) {
    session.update(0.5 / needleSweepsPerSecond(order.index, layer));
    session.stopNeedle();
  }
  for (let layer = 0; layer < order.layers; layer += 1) {
    session.grabLayer();
    session.moveLayer(0.5);
    session.dropLayer();
  }
  session.selectFrosting(order.frosting);
  session.frostSweep(0, 1);
  session.finishFrosting();
  for (const kind of order.decorations) session.placeDecoration(kind, 0.5, 0.5);
  return session.serve();
}

function createSettlementHarness() {
  const receipts = new Map();
  const events = [];
  let now = 40_000;
  const lifecycle = createMinigameLifecycle(
    "cake-atelier",
    { now: () => (now += 1) },
    {
      getBestScore: () =>
        Math.max(0, ...Array.from(receipts.values(), ({ bestScore }) => bestScore)),
      getSettlement: (runId) => receipts.get(runId) ?? null,
      settle: (receipt) => {
        receipts.set(receipt.runId, receipt);
        return receipt;
      },
    },
    { emit: (event) => events.push(event.kind) },
  );
  return { receipts, events, lifecycle };
}

test("order queues escalate 1→3 layers and 2→4 decorations deterministically", () => {
  const queue = rollOrderQueue(new SeededRng(2_024));
  assert.equal(queue.length, ORDERS_PER_ROUND);
  assert.deepEqual(queue.map(({ layers }) => layers), [1, 2, 3]);
  assert.deepEqual(queue.map(({ decorations }) => decorations.length), [2, 3, 4]);
  assert.deepEqual(rollOrderQueue(new SeededRng(2_024)), queue);
});

test("a perfect three-customer shift replays to the same score", () => {
  const play = () => {
    const session = new AtelierSession(new SeededRng(451));
    for (let customer = 0; customer < ORDERS_PER_ROUND; customer += 1) {
      const served = playPerfectOrder(session);
      assert.equal(served.kind, "serve");
    }
    assert.equal(session.finished, true);
    return session.totalScore;
  };
  const first = play();
  assert.equal(play(), first);
  assert.ok(first > 0);
});

test("frost coverage gates serve readiness at ninety percent", () => {
  const session = new AtelierSession(new SeededRng(9));
  session.selectFlavor(session.currentOrder.flavor);
  while (session.phase === "bake") session.stopNeedle();
  while (session.phase === "stack") {
    session.grabLayer();
    session.moveLayer(0.5);
    session.dropLayer();
  }
  session.selectFrosting(session.currentOrder.frosting);
  session.frostSweep(0, FROST_REQUIRED_COVERAGE - 0.05);
  assert.equal(session.coverageReady, false);
  assert.equal(session.finishFrosting().ready, false);
  assert.equal(session.phase, "frost");
  session.frostSweep(FROST_REQUIRED_COVERAGE - 0.05, 1);
  assert.equal(session.coverageReady, true);
  assert.equal(session.finishFrosting().ready, true);
  assert.equal(session.phase, "decorate");
});

test("a finished shift settles exactly once and replays the same receipt", () => {
  const harness = createSettlementHarness();
  const session = new AtelierSession(new SeededRng(88));
  for (let customer = 0; customer < ORDERS_PER_ROUND; customer += 1) playPerfectOrder(session);
  const runId = harness.lifecycle.beginRun();
  const payout = session.payout();
  assert.deepEqual(payout, settlePayout(session.totalScore));
  const first = harness.lifecycle.completeRun(runId, payout);
  const replay = harness.lifecycle.completeRun(runId, { score: 1, coins: 1, xp: 1 });
  assert.equal(first, replay);
  assert.equal(harness.receipts.size, 1);
  assert.deepEqual(harness.events, ["run-began", "run-completed"]);
});

test("sandbox shifts stay unpaid and exits never settle", () => {
  const harness = createSettlementHarness();
  const session = new AtelierSession(new SeededRng(3), { sandbox: true });
  assert.equal(session.orders.length, 1);
  playPerfectOrder(session);
  assert.deepEqual(session.payout(), { score: 0, coins: 0, xp: 0 });
  harness.lifecycle.beginRun();
  harness.lifecycle.exit();
  assert.equal(harness.receipts.size, 0);
  assert.deepEqual(harness.events, ["run-began", "run-exited"]);
});
