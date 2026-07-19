import assert from "node:assert/strict";
import test from "node:test";
import { SeededRng } from "../../core/contracts/rng.ts";
import {
  SCALE_ROUND_COUNT,
  addScaleWeight,
  clearScaleWeights,
  createScaleSession,
  estimateWeight,
  generateScaleChallenge,
  judgeWeight,
  removeScaleWeight,
  scalePayout,
  submitScaleEstimate,
} from "./logic.ts";

test("seeded produce weights replay exactly and hints yield to expert rounds", () => {
  for (let index = 0; index < SCALE_ROUND_COUNT; index += 1) {
    const first = generateScaleChallenge(new SeededRng(44), index);
    const replay = generateScaleChallenge(new SeededRng(44), index);
    assert.deepEqual(first, replay);
    assert.equal(first.targetGrams, first.produce.reduce((sum, item) => sum + item.grams, 0));
    assert.equal(first.produce.length, Math.min(3, 1 + Math.floor(index / 3)));
    if (index < 3) {
      assert.equal(first.expert, false);
      assert.ok(first.hint.minimum <= first.targetGrams);
      assert.ok(first.hint.maximum >= first.targetGrams);
    } else {
      assert.equal(first.expert, true);
      assert.equal(first.hint, null);
    }
  }
});

test("weight blocks add, remove, clear, and sum in grams", () => {
  const session = createScaleSession(new SeededRng(3));
  assert.equal(addScaleWeight(session, 100), true);
  assert.equal(addScaleWeight(session, 25), true);
  assert.equal(addScaleWeight(session, 200), true);
  assert.equal(estimateWeight(session.loadedWeights), 325);
  assert.equal(removeScaleWeight(session, 1), 25);
  assert.equal(estimateWeight(session.loadedWeights), 300);
  clearScaleWeights(session);
  assert.equal(estimateWeight(session.loadedWeights), 0);
  assert.equal(session.actions, 5);
});

test("precision grades use proportional tolerances and only perfects build streaks", () => {
  const challenge = {
    index: 4,
    produce: [{ id: "test", glyph: "●", grams: 400 }],
    targetGrams: 400,
    expert: true,
    hint: null,
  };
  const perfect = judgeWeight(challenge, 400, 2);
  assert.equal(perfect.grade, "perfect");
  assert.equal(perfect.streak, 3);
  const close = judgeWeight(challenge, 430, perfect.streak);
  assert.equal(close.grade, "close");
  assert.equal(close.streak, 0);
  const miss = judgeWeight(challenge, 500, 8);
  assert.equal(miss.grade, "miss");
  assert.equal(miss.streak, 0);
  assert.ok(perfect.points > close.points);
  assert.ok(close.points > miss.points);
});

test("an eight-customer perfect shift reaches expert mode and earns a balanced payout", () => {
  const rng = new SeededRng(932);
  const session = createScaleSession(rng);
  for (let round = 0; round < SCALE_ROUND_COUNT; round += 1) {
    const target = session.challenge.targetGrams;
    // Pure scoring accepts the exact gram estimate; block composition itself
    // is separately tested because produce variations are intentionally 5 g.
    session.loadedWeights = [target];
    const result = submitScaleEstimate(session, rng);
    assert.equal(result.grade, "perfect");
    assert.equal(result.streak, round + 1);
  }
  assert.equal(session.finished, true);
  assert.equal(session.completed, SCALE_ROUND_COUNT);
  assert.equal(session.perfects, SCALE_ROUND_COUNT);
  assert.equal(session.bestStreak, SCALE_ROUND_COUNT);
  const payout = scalePayout(session);
  assert.ok(payout.score > 3_000);
  assert.ok(payout.coins <= 40);
  assert.ok(payout.xp <= 90);
});

test("block count is bounded and completed sessions reject further input", () => {
  const rng = new SeededRng(19);
  const session = createScaleSession(rng);
  for (let index = 0; index < 20; index += 1) addScaleWeight(session, 25);
  assert.equal(session.loadedWeights.length, 12);
  for (let round = 0; round < SCALE_ROUND_COUNT; round += 1) submitScaleEstimate(session, rng);
  assert.equal(session.finished, true);
  assert.equal(addScaleWeight(session, 100), false);
  assert.equal(removeScaleWeight(session), null);
});
