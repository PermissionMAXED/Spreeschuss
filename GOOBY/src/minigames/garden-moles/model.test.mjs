import assert from "node:assert/strict";
import test from "node:test";
import { SeededRng } from "../../core/contracts/rng.ts";
import {
  beginGarden,
  createGardenState,
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

test("garden tempo ramps but always finishes at seventy-five seconds", () => {
  const state = createGardenState("bouncy");
  const rng = new SeededRng(19);
  beginGarden(state);
  for (let second = 0; second < 75; second += 1) updateGarden(state, 1, rng);
  assert.equal(state.phase, "finished");
  assert.equal(state.remaining, 0);
});
