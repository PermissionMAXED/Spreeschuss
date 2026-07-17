import assert from "node:assert/strict";
import test from "node:test";
import { SeededRng } from "../../core/contracts/rng.ts";
import {
  activeOneWays,
  applyTrafficCollision,
  beginDelivery,
  completeDelivery,
  createDeliveryState,
  isWrongWay,
  updateDelivery,
} from "./model.ts";

test("delivery clocks count down deterministically", () => {
  const first = createDeliveryState("rush", new SeededRng(42));
  const second = createDeliveryState("rush", new SeededRng(42));
  beginDelivery(first);
  beginDelivery(second);
  updateDelivery(first, 1, new SeededRng(9));
  updateDelivery(second, 1, new SeededRng(9));
  assert.deepEqual(first, second);
  assert.ok(Math.abs(first.remaining - 55.25) < 0.001);
  assert.ok(Math.abs(first.parcel.deadline - 18.25) < 0.001);
});

test("on-time chains extend the shift clock and increase rewards", () => {
  const state = createDeliveryState("sunday", new SeededRng(12));
  const rng = new SeededRng(81);
  state.remaining = 30;
  state.parcel.deadline = 10;
  const first = completeDelivery(state, rng);
  const afterFirst = state.remaining;
  state.parcel.deadline = 10;
  const second = completeDelivery(state, rng);
  assert.equal(state.chain, 2);
  assert.equal(state.bestChain, 2);
  assert.equal(state.totalBonusTime, first.timeAdded + second.timeAdded);
  assert.equal(state.bestTimeBonus, second.timeAdded);
  assert.equal(state.bestDeliveryPoints, second.points);
  assert.ok(first.timeAdded > 0);
  assert.ok(second.timeAdded > first.timeAdded);
  assert.ok(state.remaining > afterFirst);
  assert.ok(second.points > first.points);
});

test("one-way rules activate by tier and detect opposing travel", () => {
  const state = createDeliveryState("express", new SeededRng(5));
  const oneWays = activeOneWays(state);
  assert.ok(oneWays.length > 0);
  state.car.x = 75;
  state.car.y = 18;
  state.car.vx = -8;
  state.car.vy = 0;
  assert.equal(isWrongWay(state.car, oneWays), true);
  state.car.vx = 8;
  assert.equal(isWrongWay(state.car, oneWays), false);
});

test("traffic collisions are cozy, penalize time, and have cooldown", () => {
  const state = createDeliveryState("sunday", new SeededRng(6));
  const traffic = state.traffic[0];
  assert.ok(traffic);
  traffic.x = state.car.x;
  traffic.y = state.car.y;
  const before = state.remaining;
  assert.equal(applyTrafficCollision(state, traffic), true);
  assert.equal(state.remaining, before - 2.5);
  assert.equal(state.bumpCount, 1);
  assert.equal(applyTrafficCollision(state, traffic), false);
  assert.equal(state.bumpCount, 1);
});

test("traffic never spawns on the player or either parcel stop", () => {
  const state = createDeliveryState("express", new SeededRng(28));
  const forbidden = [state.car, state.parcel.pickup, state.parcel.destination];
  for (const traffic of state.traffic) {
    assert.ok(forbidden.every((point) =>
      Math.hypot(traffic.x - point.x, traffic.y - point.y) >= 7));
  }

  state.deliveries = 2;
  completeDelivery(state, new SeededRng(91));
  const added = state.traffic.at(-1);
  assert.ok(added);
  assert.ok([state.car, state.parcel.pickup, state.parcel.destination].every((point) =>
    Math.hypot(added.x - point.x, added.y - point.y) >= 7));
});
