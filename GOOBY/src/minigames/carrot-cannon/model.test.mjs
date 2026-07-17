import assert from "node:assert/strict";
import test from "node:test";
import { SeededRng } from "../../core/contracts/rng.ts";
import {
  beginCannon,
  createCannonState,
  launchCarrot,
  PICNIC_CLEAR_SEQUENCE,
  predictTrajectory,
  scoreTargetHit,
  updateCannon,
} from "./model.ts";

test("trajectory is deterministic and wind bends the carrot downrange", () => {
  const calm = predictTrajectory(15, -8, 0, 16);
  const windy = predictTrajectory(15, -8, 3, 16);
  assert.deepEqual(calm, predictTrajectory(15, -8, 0, 16));
  assert.ok(calm.length > 6);
  assert.ok((windy.at(-1)?.x ?? 0) > (calm.at(-1)?.x ?? 0));
  assert.ok((calm.at(4)?.y ?? 100) < 55);
});

test("difficulty wind and target layouts replay from a seed", () => {
  const first = createCannonState("blustery", new SeededRng(991));
  const second = createCannonState("blustery", new SeededRng(991));
  assert.deepEqual(first.winds, second.winds);
  assert.deepEqual(first.targets, second.targets);
  assert.ok(first.winds.some((wind) => wind !== 0));
});

test("bounces and unique multi-hits increase target scoring", () => {
  const state = createCannonState("picnic", new SeededRng(3));
  const projectile = {
    x: 0,
    y: 0,
    vx: 10,
    vy: -2,
    rotation: 0,
    bounces: 2,
    flightTime: 0,
    hitIds: [],
    trail: [],
  };
  const first = state.targets.find((target) => target.kind === "hay");
  const second = state.targets.find((target) => target.kind === "can");
  assert.ok(first);
  assert.ok(second);
  const firstHit = scoreTargetHit(state, first, projectile);
  const secondHit = scoreTargetHit(state, second, projectile);
  assert.equal(firstHit.multiplier, 1);
  assert.equal(secondHit.multiplier, 1.5);
  assert.ok(firstHit.points > 80);
  assert.ok(secondHit.points > firstHit.points);
  assert.equal(scoreTargetHit(state, second, projectile).points, 0);
  assert.equal(state.bestMultiHit, 2);
  assert.equal(state.totalHits, 2);
  assert.equal(state.targetsCleared, 2);
  assert.equal(state.totalBounceBonus, 140);
});

test("a launched shot consumes exactly one carrot and runs through physics", () => {
  const state = createCannonState("picnic", new SeededRng(55));
  beginCannon(state);
  assert.equal(launchCarrot(state, 16, -9), true);
  assert.equal(state.shotsRemaining, 9);
  assert.equal(state.phase, "flying");
  for (let frame = 0; frame < 600 && state.phase === "flying"; frame += 1) {
    updateCannon(state, 1 / 60);
  }
  assert.equal(state.phase, "aiming");
  assert.equal(state.shotsRemaining, 9);
});

test("Picnic has visible piñata health and a deterministic full-clear sequence", () => {
  const state = createCannonState("picnic", new SeededRng(55));
  const pinata = state.targets.find((target) => target.kind === "pinata");
  assert.ok(pinata);
  assert.equal(pinata.maxHp, 2);
  assert.equal(pinata.hp, 2);
  beginCannon(state);

  for (const shot of PICNIC_CLEAR_SEQUENCE) {
    assert.equal(launchCarrot(state, shot.x, shot.y), true);
    for (let frame = 0; frame < 1_200 && state.phase === "flying"; frame += 1) {
      updateCannon(state, 1 / 120);
    }
  }

  assert.equal(state.phase, "finished");
  assert.equal(state.targets.every((target) => !target.active), true);
  assert.equal(state.targetsCleared, state.targets.length);
  assert.equal(state.totalHits, state.targets.length + 1);
  assert.equal(state.shotsRemaining, 8);
});
