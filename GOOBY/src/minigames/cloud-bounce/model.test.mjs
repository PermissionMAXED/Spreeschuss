import assert from "node:assert/strict";
import test from "node:test";
import { SeededRng } from "../../core/contracts/rng.ts";
import {
  beginCloudRun,
  CLOUD_BOUNCE_VELOCITY,
  CLOUD_DRIFT_SPEED,
  CLOUD_FADE_SECONDS,
  CLOUD_FALL_DROP,
  CLOUD_GEN_AHEAD,
  CLOUD_PLAYER_RADIUS,
  CLOUD_POOL_CAPACITY,
  CLOUD_SPRING_VELOCITY,
  CLOUD_STAR_SCORE,
  CLOUD_STEP_SECONDS,
  CLOUD_WIND_FIRST,
  CLOUD_WIND_HEIGHT,
  CLOUD_WIND_INTERVAL,
  cloudDifficulty,
  cloudIsSolid,
  cloudWindBandAt,
  cloudWindBandBottom,
  cloudWindDirection,
  cloudWindStrength,
  createCloudState,
  drainCloudEvents,
  setCloudDrift,
  STAR_POOL_CAPACITY,
  stepCloud,
} from "./model.ts";

/** Steps for a duration, draining events into the returned list. */
function run(state, seconds, onStep) {
  const events = [];
  const steps = Math.round(seconds / CLOUD_STEP_SECONDS);
  for (let index = 0; index < steps; index += 1) {
    onStep?.(state, index);
    stepCloud(state, CLOUD_STEP_SECONDS);
    drainCloudEvents(state, (kind, value) => events.push({ kind, value }));
  }
  return events;
}

/** A launched run with every generated cloud cleared except one custom pad. */
function isolatedState(pad = {}, seed = 5) {
  const state = createCloudState(new SeededRng(seed));
  beginCloudRun(state);
  for (const cloud of state.clouds) cloud.active = false;
  for (const star of state.starSlots) star.active = false;
  const cloud = state.clouds[0];
  Object.assign(cloud, {
    active: true,
    kind: "static",
    x: 0.5,
    anchorX: 0.5,
    y: 0,
    halfWidth: 0.3,
    amplitude: 0,
    speed: 0,
    cloudPhase: 0,
    fade: 1,
    bounced: false,
    ...pad,
  });
  return { state, cloud };
}

test("creation fills the fixed pools and seeds a reachable sky", () => {
  const state = createCloudState(new SeededRng(1));
  assert.equal(state.clouds.length, CLOUD_POOL_CAPACITY);
  assert.equal(state.starSlots.length, STAR_POOL_CAPACITY);
  assert.ok(state.nextSpawnY >= CLOUD_GEN_AHEAD);
  const active = state.clouds.filter((cloud) => cloud.active);
  assert.ok(active.length > 5, "the opening sky is populated");
  // Every consecutive gap stays clearable by a normal bounce (apex ≈ 0.5).
  const sorted = active.map((cloud) => cloud.y).sort((a, b) => a - b);
  for (let index = 1; index < sorted.length; index += 1) {
    assert.ok(sorted[index] - sorted[index - 1] < 0.5);
  }
  assert.equal(state.phase, "ready");
  assert.equal(cloudDifficulty(0), 0);
  assert.equal(cloudDifficulty(999), 1);
});

test("identical seeds and drift scripts stay bit-identical", () => {
  const script = (state, index) => {
    if (index === 60) setCloudDrift(state, 1);
    if (index === 180) setCloudDrift(state, -0.6);
    if (index === 300) setCloudDrift(state, 0);
  };
  const first = createCloudState(new SeededRng(33));
  const second = createCloudState(new SeededRng(33));
  beginCloudRun(first);
  beginCloudRun(second);
  run(first, 8, script);
  run(second, 8, script);
  assert.deepEqual(JSON.parse(JSON.stringify(first)), JSON.parse(JSON.stringify(second)));
});

test("different seeds lay out different skies", () => {
  const key = (seed) => {
    const state = createCloudState(new SeededRng(seed));
    return JSON.stringify(state.clouds);
  };
  assert.notEqual(key(1), key(2));
});

test("the run launches and auto-bounces off clouds while falling only", () => {
  const { state } = isolatedState();
  assert.equal(state.vy, CLOUD_BOUNCE_VELOCITY);
  const events = run(state, 3);
  const bounces = events.filter((event) => event.kind === "bounce");
  assert.ok(bounces.length >= 2, "keeps re-bouncing off the pad");
  assert.equal(state.phase, "running");
  assert.ok(state.bestY > 0.4, "the first arc gains altitude");
  // Bounces reset the fall: the player never sits below the pad.
  assert.ok(state.y > -0.05);
});

test("held drift accelerates toward the target and clamps at the edges", () => {
  const { state } = isolatedState({ halfWidth: 0.6 });
  setCloudDrift(state, 5);
  assert.equal(state.drift, 1, "drift clamps to [-1, 1]");
  setCloudDrift(state, Number.NaN);
  assert.equal(state.drift, 0, "non-finite drift releases the steer");

  setCloudDrift(state, 1);
  run(state, 0.5);
  assert.ok(Math.abs(state.vx - CLOUD_DRIFT_SPEED) < 0.01, "vx reaches the drift speed");
  assert.ok(state.x > 0.6);
  run(state, 2);
  assert.equal(state.x, 1 - CLOUD_PLAYER_RADIUS, "clamped at the right edge");
  setCloudDrift(state, -1);
  run(state, 3);
  assert.equal(state.x, CLOUD_PLAYER_RADIUS, "clamped at the left edge");
});

test("spring clouds launch much higher and emit the spring event", () => {
  const { state } = isolatedState({ kind: "spring" });
  // The launch arc lands at ~1.1 s; the spring arc tops out ~0.87 s later.
  const events = run(state, 2.2);
  assert.ok(events.some((event) => event.kind === "spring"));
  assert.ok(state.stats.springs >= 1);
  const apex = CLOUD_SPRING_VELOCITY ** 2 / (2 * 3.4);
  assert.ok(state.bestY > apex * 0.9, "spring apex clears double a normal hop");
});

test("fading clouds carry one bounce, dissolve, and then the player falls", () => {
  const { state, cloud } = isolatedState({ kind: "fading" });
  // First arc: up and back down onto the fading pad.
  const events = run(state, 1.2);
  assert.ok(events.some((event) => event.kind === "fade"));
  assert.equal(cloud.bounced, true);
  assert.equal(cloudIsSolid(cloud), false, "a bounced fading cloud is no longer solid");
  assert.equal(state.stats.fades, 1);

  const dissolve = run(state, CLOUD_FADE_SECONDS + 0.1);
  assert.equal(cloud.active, false, "the cloud dissolves away");
  const tail = [...dissolve, ...run(state, 3)];
  assert.equal(state.phase, "finished");
  assert.equal(state.endReason, "fall");
  const fall = tail.find((event) => event.kind === "fall");
  assert.ok(fall, "the fall event fires");
  assert.ok(tail.some((event) => event.kind === "finished"));
  // Steps and inputs after the finish are inert.
  const snapshot = JSON.stringify(state);
  stepCloud(state, CLOUD_STEP_SECONDS);
  assert.equal(JSON.stringify(state), snapshot);
});

test("moving clouds sweep on an exact deterministic sine", () => {
  const { state, cloud } = isolatedState({
    kind: "moving",
    amplitude: 0.1,
    speed: 1.3,
    cloudPhase: 0.7,
  });
  run(state, 0.5);
  const expected = 0.5 + Math.sin(state.time * 1.3 + 0.7) * 0.1;
  assert.ok(Math.abs(cloud.x - expected) < 1e-12);
});

test("wind bands sit at fixed altitudes with alternating capped strength", () => {
  assert.equal(cloudWindBandAt(CLOUD_WIND_FIRST - 0.01), -1);
  assert.equal(cloudWindBandAt(CLOUD_WIND_FIRST + 0.01), 0);
  assert.equal(cloudWindBandAt(CLOUD_WIND_FIRST + CLOUD_WIND_HEIGHT + 0.05), -1);
  assert.equal(cloudWindBandAt(CLOUD_WIND_FIRST + CLOUD_WIND_INTERVAL + 0.1), 1);
  assert.equal(cloudWindBandBottom(2), CLOUD_WIND_FIRST + 2 * CLOUD_WIND_INTERVAL);
  assert.equal(cloudWindDirection(0), 1);
  assert.equal(cloudWindDirection(1), -1);
  assert.ok(cloudWindStrength(1) > cloudWindStrength(0));
  assert.ok(cloudWindStrength(99) <= 0.5);
});

test("a wind band pushes the player and announces itself once", () => {
  const { state } = isolatedState();
  state.y = CLOUD_WIND_FIRST + 0.05;
  state.bestY = state.y;
  state.cameraY = state.y;
  state.vy = 1;
  const events = run(state, 0.3);
  const winds = events.filter((event) => event.kind === "wind");
  assert.equal(winds.length, 1, "entering the band announces once");
  assert.equal(winds[0].value, 1, "band zero blows east");
  assert.ok(state.x > 0.5, "the east wind pushed the player right");
});

test("stars collect on touch and pay their bonus into the score", () => {
  const { state } = isolatedState();
  const star = state.starSlots[0];
  star.active = true;
  star.x = 0.5;
  star.y = 0.05;
  const events = run(state, 0.5);
  assert.ok(events.some((event) => event.kind === "star"));
  assert.equal(star.active, false);
  assert.equal(state.starCount, 1);
  assert.equal(state.score, Math.floor(state.bestY * 20) + CLOUD_STAR_SCORE);
  assert.equal(state.stats.stars, 1);
});

test("milestones fire as the climb crosses each 25 m threshold", () => {
  const state = createCloudState(new SeededRng(9));
  beginCloudRun(state);
  state.vy = 5; // One deterministic super-leap through 25 m.
  const events = run(state, 2);
  const milestones = events.filter((event) => event.kind === "milestone");
  assert.equal(milestones.length, 1);
  assert.ok(milestones[0].value >= 25);
  assert.ok(state.stats.meters >= 25);
});

test("cloud and star pools recycle in place while the sky climbs", () => {
  const state = createCloudState(new SeededRng(4));
  beginCloudRun(state);
  const spawnedBefore = state.spawnCount;
  // Repeated super-leaps force heavy generation through the recycler.
  run(state, 12, (current, index) => {
    if (index % 60 === 0 && current.phase === "running") {
      current.vy = 4;
      current.y = current.bestY;
    }
  });
  assert.equal(state.clouds.length, CLOUD_POOL_CAPACITY, "the pool never grows");
  assert.equal(state.starSlots.length, STAR_POOL_CAPACITY);
  assert.ok(state.spawnCount > spawnedBefore + 20, "the recycler kept spawning");
  assert.ok(state.bestY > 5);
  for (const cloud of state.clouds) {
    if (!cloud.active) continue;
    assert.ok(cloud.y <= state.nextSpawnY, "active clouds stay inside the frontier");
  }
});

test("the fall line tracks the camera, which never descends", () => {
  const { state } = isolatedState();
  run(state, 1.2);
  const camera = state.cameraY;
  assert.ok(camera > 0.4);
  // Remove the pad mid-flight: the player falls out and the camera holds.
  for (const cloud of state.clouds) cloud.active = false;
  run(state, 3);
  assert.equal(state.cameraY, camera);
  assert.equal(state.phase, "finished");
  assert.ok(state.y <= camera - CLOUD_FALL_DROP);
});

test("inputs outside the running phase are inert", () => {
  const state = createCloudState(new SeededRng(7));
  const before = JSON.stringify(state);
  stepCloud(state, CLOUD_STEP_SECONDS);
  assert.equal(JSON.stringify(state), before, "ready states never advance");
  beginCloudRun(state);
  assert.equal(state.phase, "running");
  beginCloudRun(state);
  assert.equal(state.stats.bounces, 1, "re-begin while running is ignored");
});
