import assert from "node:assert/strict";
import test from "node:test";
import { SeededRng } from "../../core/contracts/rng.ts";
import {
  auditSurfCourse,
  beginSurfRun,
  createSurfPractice,
  createSurfState,
  drainSurfEvents,
  queueSurfJump,
  setSurfDuck,
  setSurfTargetLane,
  stepSurf,
  stepSurfLane,
  SURF_BASE_SPEED,
  SURF_CHUNK_LENGTH,
  SURF_CLEAR_LANE_WINDOW,
  SURF_COIN_SCORE,
  SURF_COURSE_LENGTH,
  SURF_FINISH_BONUS,
  SURF_GENTLE_END_SECONDS,
  SURF_GROCERY_LIST_SIZE,
  SURF_GROCERY_SCORE,
  SURF_LANE_COUNT,
  SURF_LIST_BONUS,
  SURF_MAX_MULTIPLIER,
  SURF_MAX_SPEED,
  SURF_NEAR_MISS_SCORE,
  SURF_PRACTICE_STEPS,
  SURF_RAMP_LANDING_GAP,
  SURF_SAME_LANE_OBSTACLE_GAP,
  SURF_SHIELD_BONUS,
  SURF_SHIELD_COUNT,
  SURF_STEP_SECONDS,
  SURF_TRICK_SCORE,
  surfLaneX,
  surfPayout,
  surfPracticeCurrent,
  surfPracticePerform,
} from "./model.ts";

/** Obstacle-free controlled course for collision micro-tests. */
function cleanState(seed = 7) {
  const state = createSurfState(new SeededRng(seed), {
    practice: true,
    courseLength: 10_000,
  });
  beginSurfRun(state);
  return state;
}

/** Injects one entity into whichever live chunk covers z. */
function inject(state, kind, lane, z, groceryIndex = -1) {
  const chunk = state.chunks.find(
    (candidate) => z >= candidate.startZ && z < candidate.startZ + SURF_CHUNK_LENGTH,
  );
  assert.ok(chunk, `no live chunk covers z=${z}`);
  const entity = chunk.entities[chunk.entityCount];
  assert.ok(entity, "chunk entity capacity exhausted");
  entity.kind = kind;
  entity.lane = lane;
  entity.z = z;
  entity.resolved = false;
  entity.nearMissed = false;
  entity.groceryIndex = groceryIndex;
  chunk.entityCount += 1;
  return entity;
}

/** Steps for a duration, draining events into the returned list. */
function run(state, seconds, onStep) {
  const events = [];
  const steps = Math.round(seconds / SURF_STEP_SECONDS);
  for (let index = 0; index < steps; index += 1) {
    onStep?.(state, index);
    stepSurf(state, SURF_STEP_SECONDS);
    drainSurfEvents(state, (kind, value) => events.push({ kind, value }));
  }
  return events;
}

test("equal seeds and step sequences replay bit-identically", () => {
  const first = createSurfState(new SeededRng(1234));
  const second = createSurfState(new SeededRng(1234));
  beginSurfRun(first);
  beginSurfRun(second);
  for (let index = 0; index < 2_400; index += 1) {
    if (index % 240 === 120) {
      stepSurfLane(first, index % 480 === 120 ? -1 : 1);
      stepSurfLane(second, index % 480 === 120 ? -1 : 1);
    }
    if (index % 300 === 60) {
      queueSurfJump(first);
      queueSurfJump(second);
    }
    setSurfDuck(first, index % 500 < 120);
    setSurfDuck(second, index % 500 < 120);
    stepSurf(first, SURF_STEP_SECONDS);
    stepSurf(second, SURF_STEP_SECONDS);
    drainSurfEvents(first, () => {});
    drainSurfEvents(second, () => {});
  }
  assert.deepEqual(first, second);
  assert.ok(first.distance > 150);
});

test("course generation is deterministic per seed and differs across seeds", () => {
  const one = auditSurfCourse(new SeededRng(9), SURF_COURSE_LENGTH).entities;
  const two = auditSurfCourse(new SeededRng(9), SURF_COURSE_LENGTH).entities;
  const other = auditSurfCourse(new SeededRng(10), SURF_COURSE_LENGTH).entities;
  assert.deepEqual(one, two);
  assert.notDeepEqual(one, other);
});

test("property: no impossible obstacle chains across 120 seeded courses", () => {
  const isBlocking = (kind) => kind === "crate" || kind === "banner";
  const isObstacle = (kind) => isBlocking(kind) || kind === "ramp";
  for (let seed = 1; seed <= 120; seed += 1) {
    const { entities } = auditSurfCourse(new SeededRng(seed), SURF_COURSE_LENGTH);
    const obstacles = entities.filter((entity) => isObstacle(entity.kind));
    const blocking = obstacles.filter((entity) => isBlocking(entity.kind));

    // Same-lane action gap: after any obstacle the next crate/banner in that
    // lane leaves room to recover (ramps demand the full landing gap).
    for (const later of blocking) {
      for (const earlier of obstacles) {
        if (earlier === later || earlier.lane !== later.lane) continue;
        const gap = later.z - earlier.z;
        const need = earlier.kind === "ramp"
          ? SURF_RAMP_LANDING_GAP
          : SURF_SAME_LANE_OBSTACLE_GAP;
        assert.ok(
          gap <= 0 || gap >= need,
          `seed ${seed}: ${earlier.kind}@${earlier.z} lane ${earlier.lane} then ${later.kind}@${later.z} (gap ${gap.toFixed(2)} < ${need})`,
        );
      }
    }

    // Escape lane: every clear-lane window keeps at least one lane free.
    for (const anchor of blocking) {
      const lanesBlocked = new Set();
      for (const other of blocking) {
        if (Math.abs(other.z - anchor.z) <= SURF_CLEAR_LANE_WINDOW / 2) {
          lanesBlocked.add(other.lane);
        }
      }
      assert.ok(
        lanesBlocked.size < SURF_LANE_COUNT,
        `seed ${seed}: all lanes blocked near z=${anchor.z}`,
      );
    }

    // The warm-up stretch stays obstacle-free.
    for (const entity of obstacles) {
      assert.ok(entity.z >= 2 * SURF_CHUNK_LENGTH, `seed ${seed}: obstacle in warm-up at ${entity.z}`);
    }

    // Exactly the six list groceries appear, each collectible: no blocking
    // obstacle shares the lane window and no ramp launches the cart over it.
    const groceries = entities.filter((entity) => entity.kind === "grocery");
    assert.deepEqual(
      groceries.map((grocery) => grocery.groceryIndex).sort((a, b) => a - b),
      [0, 1, 2, 3, 4, 5],
      `seed ${seed}: grocery indices wrong`,
    );
    for (const grocery of groceries) {
      for (const obstacle of obstacles) {
        if (obstacle.lane !== grocery.lane) continue;
        if (isBlocking(obstacle.kind)) {
          assert.ok(
            Math.abs(obstacle.z - grocery.z) >= SURF_CLEAR_LANE_WINDOW / 2,
            `seed ${seed}: grocery@${grocery.z} blocked by ${obstacle.kind}@${obstacle.z}`,
          );
        } else if (grocery.z > obstacle.z) {
          assert.ok(
            grocery.z - obstacle.z >= SURF_RAMP_LANDING_GAP,
            `seed ${seed}: grocery@${grocery.z} inside ramp flight from ${obstacle.z}`,
          );
        }
      }
    }
  }
});

test("crate bump costs a shield, grants invulnerability, and resets the combo", () => {
  const state = cleanState();
  inject(state, "coin", 1, 4);
  inject(state, "crate", 1, 10);
  inject(state, "crate", 1, 13); // Inside the invulnerability window.
  const events = run(state, 2);
  assert.equal(state.bumps, 1);
  assert.equal(state.shields, SURF_SHIELD_COUNT - 1);
  assert.equal(state.multiplier, 1);
  assert.equal(state.combo, 0);
  assert.equal(events.filter(({ kind }) => kind === "bump").length, 1);
  assert.equal(events.find(({ kind }) => kind === "bump")?.value, SURF_SHIELD_COUNT - 1);
});

test("a well-timed jump clears the crate and scores the near-miss", () => {
  const state = cleanState();
  inject(state, "crate", 1, 12);
  let jumped = false;
  const events = run(state, 2.4, (live) => {
    if (!jumped && live.distance >= 9.4) {
      jumped = true;
      queueSurfJump(live);
    }
  });
  assert.equal(state.bumps, 0);
  assert.equal(state.stats.jumps, 1);
  assert.equal(state.stats.nearMisses, 1);
  assert.ok(events.some(({ kind }) => kind === "jump"));
  assert.equal(
    events.find(({ kind }) => kind === "near-miss")?.value,
    SURF_NEAR_MISS_SCORE,
  );
});

test("ducking clears banners; standing tall bumps into them", () => {
  const ducked = cleanState();
  inject(ducked, "banner", 1, 10);
  setSurfDuck(ducked, true);
  run(ducked, 2);
  assert.equal(ducked.bumps, 0);
  assert.equal(ducked.stats.ducks, 1);
  assert.equal(ducked.stats.nearMisses, 1);

  const upright = cleanState();
  inject(upright, "banner", 1, 10);
  run(upright, 2);
  assert.equal(upright.bumps, 1);
});

test("jumping into a banner is not a clear — ducks must be grounded", () => {
  const state = cleanState();
  inject(state, "banner", 1, 12);
  let jumped = false;
  setSurfDuck(state, true);
  run(state, 2.4, (live) => {
    // Jump so the cart is airborne (duck suppressed) inside the banner window.
    if (!jumped && live.distance >= 9.4) {
      jumped = true;
      queueSurfJump(live);
    }
  });
  assert.equal(state.bumps, 1);
});

test("ramps launch, a mid-air jump input lands a trick, and the landing gap holds", () => {
  const state = cleanState();
  inject(state, "ramp", 1, 10);
  let queued = false;
  const events = run(state, 3, (live) => {
    if (live.rampLaunched && !queued) {
      queued = true;
      queueSurfJump(live);
    }
  });
  assert.equal(state.bumps, 0);
  assert.equal(state.stats.tricks, 1);
  assert.equal(
    events.find(({ kind }) => kind === "trick")?.value,
    SURF_TRICK_SCORE,
  );
  // The whole ramp flight fits inside the enforced landing gap.
  assert.ok(state.y === 0 && !state.airborne);
  const flight = (2 * 10.6) / 27 * SURF_MAX_SPEED;
  assert.ok(flight < SURF_RAMP_LANDING_GAP);
});

test("coins and groceries collect, chain combos, and complete the list", () => {
  const state = cleanState();
  for (let index = 0; index < 5; index += 1) inject(state, "coin", 1, 6 + index * 3);
  for (let item = 0; item < SURF_GROCERY_LIST_SIZE; item += 1) {
    inject(state, "grocery", 1, 24 + item * 3, item);
  }
  const events = run(state, 5);
  assert.equal(state.stats.coins, 5);
  assert.equal(state.groceryCount, SURF_GROCERY_LIST_SIZE);
  assert.equal(state.listComplete, true);
  assert.deepEqual([...state.groceries], [true, true, true, true, true, true]);
  assert.ok(state.multiplier >= 2);
  assert.ok(state.multiplier <= SURF_MAX_MULTIPLIER);
  assert.ok(events.some(({ kind }) => kind === "combo"));
  assert.equal(events.filter(({ kind }) => kind === "grocery").length, SURF_GROCERY_LIST_SIZE);
  assert.equal(
    events.find(({ kind }) => kind === "list-complete")?.value,
    SURF_LIST_BONUS,
  );
  const expectedBase = 5 * SURF_COIN_SCORE + SURF_GROCERY_LIST_SIZE * SURF_GROCERY_SCORE + SURF_LIST_BONUS;
  assert.ok(state.score > expectedBase); // Multipliers and distance only add.
});

test("combo multiplier decays back to one after the window lapses", () => {
  const state = cleanState();
  for (let index = 0; index < 6; index += 1) inject(state, "coin", 1, 5 + index * 2);
  run(state, 2.2);
  assert.ok(state.multiplier >= 2);
  run(state, 5.2);
  assert.equal(state.multiplier, 1);
  assert.equal(state.combo, 0);
});

test("three bumps end the run gently with no finish bonus", () => {
  const state = cleanState();
  inject(state, "crate", 1, 8);
  inject(state, "crate", 1, 28);
  inject(state, "crate", 1, 48);
  const events = run(state, 8);
  assert.equal(state.bumps, SURF_SHIELD_COUNT);
  assert.equal(state.shields, 0);
  assert.equal(state.endReason, "bumps");
  assert.equal(state.phase, "finished");
  assert.equal(state.speed, 0);
  assert.equal(events.find(({ kind }) => kind === "run-ended")?.value, 0);
});

test("the gentle end decelerates monotonically over its full window", () => {
  const state = cleanState();
  inject(state, "crate", 1, 6);
  inject(state, "crate", 1, 26);
  inject(state, "crate", 1, 46);
  run(state, 6, (live) => {
    if (live.phase === "ending") return;
  });
  const speeds = [];
  const fresh = cleanState(11);
  inject(fresh, "crate", 1, 6);
  inject(fresh, "crate", 1, 26);
  inject(fresh, "crate", 1, 46);
  run(fresh, 20, (live) => {
    if (live.phase === "ending") speeds.push(live.speed);
  });
  assert.ok(speeds.length >= SURF_GENTLE_END_SECONDS / SURF_STEP_SECONDS - 2);
  for (let index = 1; index < speeds.length; index += 1) {
    assert.ok(speeds[index] <= speeds[index - 1] + 1e-9);
  }
});

test("reaching the finish line pays the finish and shield bonuses", () => {
  const state = createSurfState(new SeededRng(3), { practice: true, courseLength: 40 });
  beginSurfRun(state);
  let runningScore = null;
  const events = [];
  for (let index = 0; index < Math.round(8 / SURF_STEP_SECONDS); index += 1) {
    stepSurf(state, SURF_STEP_SECONDS);
    drainSurfEvents(state, (kind, value) => events.push({ kind, value }));
    // Distance score freezes when the ending glide begins.
    if (runningScore === null && state.phase !== "running") runningScore = state.score;
  }
  assert.equal(state.phase, "finished");
  assert.equal(state.endReason, "finish");
  assert.equal(events.find(({ kind }) => kind === "run-ended")?.value, 1);
  assert.ok(runningScore !== null && runningScore > 0);
  assert.ok(
    Math.abs(state.score - (runningScore + SURF_FINISH_BONUS + SURF_SHIELD_COUNT * SURF_SHIELD_BONUS)) < 1e-6,
  );
});

test("speed ramps from base to max and never exceeds it", () => {
  const state = cleanState();
  assert.equal(state.speed, SURF_BASE_SPEED);
  let previous = 0;
  run(state, 80, (live) => {
    assert.ok(live.speed >= previous - 1e-9);
    assert.ok(live.speed <= SURF_MAX_SPEED + 1e-9);
    previous = live.speed;
  });
  assert.ok(Math.abs(state.speed - SURF_MAX_SPEED) < 1e-6);
});

test("lane stepping clamps to the outer lanes and counts changes", () => {
  const state = cleanState();
  const events = [];
  stepSurfLane(state, -1);
  stepSurfLane(state, -1);
  stepSurfLane(state, -1);
  drainSurfEvents(state, (kind, value) => events.push({ kind, value }));
  assert.equal(state.lane, 0);
  assert.equal(state.stats.laneChanges, 1);
  setSurfTargetLane(state, 99);
  assert.equal(state.lane, SURF_LANE_COUNT - 1);
  run(state, 1);
  assert.ok(Math.abs(state.x - surfLaneX(SURF_LANE_COUNT - 1)) < 1e-6);
});

test("steady-state stepping recycles chunks without allocating entities", () => {
  const state = createSurfState(new SeededRng(21));
  beginSurfRun(state);
  const entityIdentities = new Set();
  for (const chunk of state.chunks) for (const entity of chunk.entities) entityIdentities.add(entity);
  const eventsRef = state.events;
  const groceriesRef = state.groceries;
  const chunksRef = state.chunks;
  run(state, 30, (live, index) => {
    if (index % 240 === 0) stepSurfLane(live, index % 480 === 0 ? 1 : -1);
    // Keep the ride alive through bumps: this test drives recycling, not
    // dodging, so shields are re-armed to survey many chunk generations.
    live.bumps = 0;
    live.shields = SURF_SHIELD_COUNT;
    if (live.phase === "ending") {
      live.phase = "running";
      live.endReason = null;
      live.endTimer = 0;
    }
  });
  assert.ok(state.distance > 250, `distance ${state.distance}`);
  assert.ok(state.nextChunkIndex > 10);
  assert.equal(state.events, eventsRef);
  assert.equal(state.groceries, groceriesRef);
  assert.equal(state.chunks, chunksRef);
  for (const chunk of state.chunks) {
    for (const entity of chunk.entities) {
      assert.ok(entityIdentities.has(entity), "chunk recycling allocated a new entity");
    }
  }
});

test("practice courses stay empty forever and inputs remain live", () => {
  const state = cleanState();
  run(state, 20);
  for (const chunk of state.chunks) assert.equal(chunk.entityCount, 0);
  assert.equal(state.bumps, 0);
  queueSurfJump(state);
  run(state, 1);
  assert.equal(state.stats.jumps, 1);
});

test("payout floors the score and caps coins and xp", () => {
  const zero = createSurfState(new SeededRng(1));
  assert.deepEqual(surfPayout(zero), { score: 0, coins: 0, xp: 0 });

  const rich = createSurfState(new SeededRng(2));
  rich.score = 123_456.78;
  rich.groceryCount = 6;
  rich.shields = 3;
  assert.deepEqual(surfPayout(rich), { score: 123_456, coins: 60, xp: 140 });

  const modest = createSurfState(new SeededRng(3));
  modest.score = 900;
  modest.groceryCount = 2;
  modest.shields = 1;
  assert.deepEqual(surfPayout(modest), {
    score: 900,
    coins: Math.floor(900 / 150) + 4,
    xp: Math.floor(900 / 70) + 5 + 8,
  });
});

test("practice gates advance only on the prompted action", () => {
  const practice = createSurfPractice();
  assert.deepEqual(SURF_PRACTICE_STEPS, ["left", "right", "jump", "duck"]);
  assert.equal(surfPracticeCurrent(practice), "left");
  assert.equal(surfPracticePerform(practice, "jump"), false);
  assert.equal(practice.index, 0);
  assert.equal(surfPracticePerform(practice, "left"), true);
  assert.equal(surfPracticeCurrent(practice), "right");
  assert.equal(surfPracticePerform(practice, "duck"), false);
  assert.equal(surfPracticePerform(practice, "right"), true);
  assert.equal(surfPracticePerform(practice, "jump"), true);
  assert.equal(surfPracticePerform(practice, "duck"), true);
  assert.equal(practice.complete, true);
  assert.equal(surfPracticeCurrent(practice), null);
  assert.equal(surfPracticePerform(practice, "left"), false);
});

test("stepping rejects invalid deltas and ignores pre-run phases", () => {
  const state = createSurfState(new SeededRng(5));
  assert.throws(() => stepSurf(state, Number.NaN), RangeError);
  assert.throws(() => stepSurf(state, -0.01), RangeError);
  stepSurf(state, SURF_STEP_SECONDS); // "ready" is inert.
  assert.equal(state.distance, 0);
  queueSurfJump(state); // Ignored while not running.
  assert.equal(state.jumpBuffer, 0);
});
