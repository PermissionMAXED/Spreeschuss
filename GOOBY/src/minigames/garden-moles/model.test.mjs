import assert from "node:assert/strict";
import test from "node:test";
import { SeededRng } from "../../core/contracts/rng.ts";
import {
  ARMORED_BONK_SECONDS,
  beginGardenBonk,
  beginGarden,
  createGardenState,
  finishGarden,
  GARDEN_EXPANDED_SLOTS,
  GARDEN_EXPANSION_AT,
  releaseGardenBonk,
  spawnGardenActor,
  tapGardenSlot,
  updateGarden,
} from "./model.ts";

test("garden spawns replay deterministically from the injected RNG", () => {
  const first = createGardenState("rascal");
  const second = createGardenState("rascal");
  const firstRng = new SeededRng(412);
  const secondRng = new SeededRng(412);
  beginGarden(first);
  beginGarden(second);

  updateGarden(first, 3.5, firstRng);
  updateGarden(second, 3.5, secondRng);

  assert.deepEqual(first, second);
  assert.ok(first.actors.every((actor) => actor.slot >= 0 && actor.slot < 9));
  assert.equal(new Set(first.actors.map((actor) => actor.slot)).size, first.actors.length);
});

test("garden replay is frame-partition invariant at 30, 60, and 120 Hz", () => {
  const run = (hz) => {
    const state = createGardenState("rascal");
    const rng = new SeededRng(913);
    beginGarden(state);
    for (let frame = 0; frame < hz * 6; frame += 1) updateGarden(state, 1 / hz, rng);
    return state;
  };
  assert.deepEqual(run(30), run(120));
  assert.deepEqual(run(60), run(120));
});

test("three bunny taps consume three hearts and end the round", () => {
  const state = createGardenState("gentle");
  const rng = new SeededRng(8);
  beginGarden(state);

  for (let heart = 2; heart >= 0; heart -= 1) {
    spawnGardenActor(state, rng, "bunny", heart);
    assert.equal(tapGardenSlot(state, heart), "bunny");
    assert.equal(state.hearts, heart);
  }

  assert.equal(state.phase, "finished");
});

test("golden frenzy forces mole spawns and doubles mole points", () => {
  const state = createGardenState("gentle");
  const rng = new SeededRng(77);
  beginGarden(state);
  spawnGardenActor(state, rng, "golden", 0);
  spawnGardenActor(state, rng, "bunny", 4);
  assert.equal(tapGardenSlot(state, 0), "golden");
  assert.equal(state.frenzyRemaining, 7);
  assert.ok(state.actors.every((actor) => actor.kind === "mole"));

  const spawned = spawnGardenActor(state, rng);
  assert.equal(spawned?.kind, "mole");
  const scoreBefore = state.score;
  assert.equal(tapGardenSlot(state, spawned?.slot ?? -1), "mole");
  assert.ok(state.score - scoreBefore >= 200);
});

test("flowerpot decoys break the streak and apply their score penalty", () => {
  const state = createGardenState("gentle");
  const rng = new SeededRng(117);
  beginGarden(state);
  const mole = spawnGardenActor(state, rng, "mole", 0);
  assert.equal(tapGardenSlot(state, mole?.slot ?? -1), "mole");
  const scoreBefore = state.score;
  spawnGardenActor(state, rng, "flowerpot", 1);
  assert.equal(tapGardenSlot(state, 1), "flowerpot");
  assert.ok(state.score < scoreBefore);
  assert.equal(state.combo, 0);
  assert.equal(state.flowerpotPenalties, 1);
});

test("armored moles require a real held charge before they clear", () => {
  const state = createGardenState("gentle");
  const rng = new SeededRng(221);
  beginGarden(state);
  const armored = spawnGardenActor(state, rng, "armored", 2);
  assert.ok(armored);
  assert.equal(beginGardenBonk(state, 2), true);
  updateGarden(state, ARMORED_BONK_SECONDS / 2, rng);
  assert.equal(releaseGardenBonk(state), "armored");
  assert.equal(state.actors.some(({ id }) => id === armored.id), true);

  assert.equal(beginGardenBonk(state, 2), true);
  updateGarden(state, ARMORED_BONK_SECONDS + 0.01, rng);
  assert.equal(releaseGardenBonk(state), "armored");
  assert.equal(state.actors.some(({ id }) => id === armored.id), false);
  assert.equal(state.armoredCleared, 1);
});

test("the final garden row opens deterministically late in the round", () => {
  const state = createGardenState("gentle");
  const rng = new SeededRng(311);
  beginGarden(state);
  for (let second = 0; second < GARDEN_EXPANSION_AT; second += 1) updateGarden(state, 1, rng);
  assert.equal(state.gridSize, GARDEN_EXPANDED_SLOTS);
  state.actors = [];
  const lateActor = spawnGardenActor(state, rng, "mole", GARDEN_EXPANDED_SLOTS - 1);
  assert.equal(lateActor?.slot, GARDEN_EXPANDED_SLOTS - 1);
});

test("garden tempo ramps but always finishes at seventy-five seconds", () => {
  const state = createGardenState("bouncy");
  const rng = new SeededRng(19);
  beginGarden(state);
  for (let second = 0; second < 75; second += 1) updateGarden(state, 1, rng);
  assert.equal(state.phase, "finished");
  assert.equal(state.remaining, 0);
});

test("ending an active garden run freezes its earned terminal score", () => {
  const state = createGardenState("gentle");
  const rng = new SeededRng(91);
  beginGarden(state);
  const mole = spawnGardenActor(state, rng, "mole", 2);
  updateGarden(state, 0.25, rng);
  assert.equal(tapGardenSlot(state, mole?.slot ?? -1), "mole");
  const earned = state.score;

  finishGarden(state, "Garden run wrapped up.");
  updateGarden(state, 10, rng);

  assert.equal(state.phase, "finished");
  assert.equal(state.score, earned);
  assert.equal(state.message, "Garden run wrapped up.");
});
