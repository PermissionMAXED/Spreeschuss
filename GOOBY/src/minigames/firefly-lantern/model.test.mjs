import assert from "node:assert/strict";
import test from "node:test";
import { SeededRng } from "../../core/contracts/rng.ts";
import {
  beginFireflyRun,
  beginFireflyStroke,
  createFireflyState,
  drainFireflyEvents,
  endFireflyStroke,
  extendFireflyStroke,
  FIREFLY_ATTRACT_RADIUS,
  FIREFLY_BANK_SCORE,
  FIREFLY_CLEAR_SECONDS,
  FIREFLY_CONVOY_STEP_SCORE,
  FIREFLY_CONVOY_WINDOW_SECONDS,
  FIREFLY_INK_COST_PER_LENGTH,
  FIREFLY_INK_MAX,
  FIREFLY_INK_REGEN_PER_SECOND,
  FIREFLY_INK_START_COST,
  FIREFLY_INK_START_MIN,
  FIREFLY_INTRO_SECONDS,
  FIREFLY_PATH_POINT_SPACING,
  FIREFLY_ROUND_COUNT,
  FIREFLY_ROUND_SECONDS,
  FIREFLY_STEP_SECONDS,
  fireflyCountForRound,
  LANTERN_BANK_RADIUS,
  obstacleCountForRound,
  stepFirefly,
} from "./model.ts";

/** Steps for a duration, draining events into the returned list. */
function run(state, seconds, onStep) {
  const events = [];
  const steps = Math.round(seconds / FIREFLY_STEP_SECONDS);
  for (let index = 0; index < steps; index += 1) {
    onStep?.(state, index);
    stepFirefly(state, FIREFLY_STEP_SECONDS);
    drainFireflyEvents(state, (kind, value) => events.push({ kind, value }));
  }
  return events;
}

/** Fresh state advanced through the intro into round one's playing phase. */
function playingState(seed = 11) {
  const state = createFireflyState(new SeededRng(seed));
  beginFireflyRun(state);
  run(state, FIREFLY_INTRO_SECONDS + FIREFLY_STEP_SECONDS);
  assert.equal(state.phase, "playing");
  return state;
}

/** Finds a field point at least `margin` clear of every obstacle. */
function clearPoint(state, margin = 0.05) {
  for (let y = 0.55; y <= 0.9; y += 0.02) {
    for (let x = 0.1; x <= 0.9; x += 0.02) {
      let clear = true;
      for (const obstacle of state.obstacles) {
        if (Math.hypot(x - obstacle.x, y - obstacle.y) < obstacle.radius + margin) {
          clear = false;
          break;
        }
      }
      if (clear) return { x, y };
    }
  }
  assert.fail("no clear point found");
  return { x: 0.5, y: 0.8 };
}

test("round layouts scale firefly and bramble counts across five rounds", () => {
  assert.equal(fireflyCountForRound(0), 3);
  assert.equal(fireflyCountForRound(4), 7);
  assert.equal(obstacleCountForRound(0), 2);
  assert.equal(obstacleCountForRound(4), 6);
  const state = playingState();
  assert.equal(state.fireflies.length, 3);
  assert.equal(state.obstacles.length, 2);
  assert.equal(state.timeLeft, FIREFLY_ROUND_SECONDS);
  assert.equal(state.ink, FIREFLY_INK_MAX);
});

test("identical seeds and input scripts stay bit-identical across partitions", () => {
  const script = (state, index) => {
    if (state.phase !== "playing") return;
    if (index === 120) beginFireflyStroke(state, 0.2, 0.85);
    if (index > 120 && index < 220) {
      extendFireflyStroke(state, 0.2 + (index - 120) * 0.004, 0.85 - (index - 120) * 0.003);
    }
    if (index === 220) endFireflyStroke(state);
  };
  const first = createFireflyState(new SeededRng(99));
  const second = createFireflyState(new SeededRng(99));
  beginFireflyRun(first);
  beginFireflyRun(second);
  run(first, 8, script);
  run(second, 8, script);
  assert.deepEqual(JSON.parse(JSON.stringify(first)), JSON.parse(JSON.stringify(second)));
});

test("different seeds produce different layouts", () => {
  const first = playingState(1);
  const second = playingState(2);
  const key = (state) =>
    JSON.stringify([state.lanternX, state.lanternY, state.obstacles, state.fireflies]);
  assert.notEqual(key(first), key(second));
});

test("painting drains ink per length and ink regenerates over time", () => {
  const state = playingState();
  state.obstacles.length = 0;
  assert.ok(beginFireflyStroke(state, 0.2, 0.8));
  const afterStart = state.ink;
  assert.equal(afterStart, FIREFLY_INK_MAX - FIREFLY_INK_START_COST);

  assert.equal(extendFireflyStroke(state, 0.6, 0.8), "added");
  const stroke = state.strokes[0];
  const painted = (stroke.pointCount - 1) * FIREFLY_PATH_POINT_SPACING;
  assert.ok(stroke.pointCount > 20);
  const expected = afterStart - painted * FIREFLY_INK_COST_PER_LENGTH;
  assert.ok(Math.abs(state.ink - expected) < 1e-9);

  endFireflyStroke(state);
  const before = state.ink;
  run(state, 2);
  const regen = state.ink - before;
  assert.ok(Math.abs(regen - FIREFLY_INK_REGEN_PER_SECOND * 2) < 1e-6);
});

test("stroke starts are refused inside brambles and when ink is too low", () => {
  const state = playingState();
  const bramble = state.obstacles[0];
  assert.equal(beginFireflyStroke(state, bramble.x, bramble.y), false);
  const events = [];
  drainFireflyEvents(state, (kind) => events.push(kind));
  assert.ok(events.includes("path-blocked"));

  state.ink = FIREFLY_INK_START_MIN - 0.01;
  assert.equal(beginFireflyStroke(state, 0.2, 0.9), false);
  drainFireflyEvents(state, (kind) => events.push(kind));
  assert.ok(events.includes("ink-empty"));
  assert.equal(state.strokes.length, 0);
});

test("extending a stroke into a bramble cuts the stroke", () => {
  const state = playingState();
  state.obstacles.length = 0;
  state.obstacles.push({ x: 0.5, y: 0.8, radius: 0.08 });
  assert.ok(beginFireflyStroke(state, 0.3, 0.8));
  const result = extendFireflyStroke(state, 0.5, 0.8);
  assert.equal(result, "added");
  assert.equal(state.activeStrokeId, -1, "stroke ends at the bramble edge");
  const events = [];
  drainFireflyEvents(state, (kind) => events.push(kind));
  assert.ok(events.includes("path-blocked"));
  const stroke = state.strokes[0];
  const tail = stroke.points[stroke.pointCount - 1];
  assert.ok(Math.hypot(tail.x - 0.5, tail.y - 0.8) >= 0.08);
});

test("fireflies latch onto nearby paths and follow them to the head", () => {
  const state = playingState();
  state.obstacles.length = 0;
  const start = { x: 0.3, y: 0.8 };
  const firefly = state.fireflies[0];
  firefly.x = start.x;
  firefly.y = start.y + FIREFLY_ATTRACT_RADIUS * 0.5;
  state.fireflies.length = 1;

  assert.ok(beginFireflyStroke(state, start.x, start.y));
  assert.equal(extendFireflyStroke(state, 0.62, 0.8), "added");
  endFireflyStroke(state);

  run(state, 0.2);
  assert.equal(firefly.mode, "follow");
  const early = firefly.targetIndex;
  run(state, 2.2);
  assert.ok(
    firefly.mode !== "follow" || firefly.targetIndex > early,
    "firefly advances along the stroke",
  );
  assert.ok(firefly.x > start.x + 0.12, "firefly travelled toward the stroke head");
});

test("brambles deflect flying fireflies to the boundary and count stats", () => {
  const state = playingState();
  state.obstacles.length = 0;
  state.obstacles.push({ x: 0.5, y: 0.6, radius: 0.07 });
  const firefly = state.fireflies[0];
  firefly.x = 0.5;
  firefly.y = 0.6;
  firefly.mode = "wander";
  state.fireflies.length = 1;
  const events = run(state, FIREFLY_STEP_SECONDS);
  assert.ok(Math.hypot(firefly.x - 0.5, firefly.y - 0.6) >= 0.07);
  assert.equal(state.stats.deflections, 1);
  assert.ok(events.some((event) => event.kind === "deflect"));
});

test("banking pays the base score and convoy chains pay stacked bonuses", () => {
  const state = playingState();
  state.obstacles.length = 0;
  const [first, second, third] = state.fireflies;
  // Stagger three fireflies so each banks inside the convoy window.
  first.x = state.lanternX;
  first.y = state.lanternY + LANTERN_BANK_RADIUS + 0.02;
  second.x = state.lanternX;
  second.y = state.lanternY + LANTERN_BANK_RADIUS + 0.06;
  third.x = state.lanternX;
  third.y = state.lanternY + LANTERN_BANK_RADIUS + 0.1;

  const events = run(state, 1.5);
  const banks = events.filter((event) => event.kind === "bank");
  const convoys = events.filter((event) => event.kind === "convoy");
  assert.equal(banks.length, 3);
  assert.equal(state.bestConvoy, 3);
  assert.equal(convoys.at(-1)?.value, 3);
  const expected =
    FIREFLY_BANK_SCORE * 3 + FIREFLY_CONVOY_STEP_SCORE * 1 + FIREFLY_CONVOY_STEP_SCORE * 2;
  // All three banked -> the round cleared and added its time bonus on top.
  assert.ok(state.score >= expected);
  assert.equal(state.bankedThisRound, 3);
  assert.equal(state.phase, "clear");
  assert.ok(events.some((event) => event.kind === "round-clear"));
});

test("the convoy chain expires outside the bank window", () => {
  const state = playingState();
  state.obstacles.length = 0;
  const firefly = state.fireflies[0];
  firefly.x = state.lanternX;
  firefly.y = state.lanternY + LANTERN_BANK_RADIUS + 0.02;
  run(state, 1);
  assert.equal(state.convoyChain, 1);
  run(state, FIREFLY_CONVOY_WINDOW_SECONDS + 0.5);
  assert.equal(state.convoyChain, 0);
  assert.equal(state.bestConvoy, 1);
});

test("timeouts lose the stragglers and the fifth clear finishes the session", () => {
  const state = playingState();
  const kinds = [];
  // Force every round to time out immediately.
  for (let round = 0; round < FIREFLY_ROUND_COUNT; round += 1) {
    assert.equal(state.phase, "playing");
    state.timeLeft = FIREFLY_STEP_SECONDS;
    kinds.push(...run(state, FIREFLY_STEP_SECONDS * 2).map((event) => event.kind));
    assert.equal(state.phase, "clear");
    kinds.push(
      ...run(state, FIREFLY_CLEAR_SECONDS + FIREFLY_INTRO_SECONDS + 0.2).map(
        (event) => event.kind,
      ),
    );
  }
  assert.equal(state.phase, "finished");
  assert.equal(kinds.filter((kind) => kind === "round-timeout").length, FIREFLY_ROUND_COUNT);
  assert.equal(kinds.filter((kind) => kind === "finished").length, 1);
  assert.equal(state.round, FIREFLY_ROUND_COUNT - 1);
  assert.ok(state.stats.lost >= 3);
  // Steps after the finish are inert.
  const snapshot = JSON.stringify(state);
  stepFirefly(state, FIREFLY_STEP_SECONDS);
  assert.equal(JSON.stringify(state), snapshot);
});

test("later rounds spawn more fireflies and brambles", () => {
  const state = playingState();
  state.timeLeft = FIREFLY_STEP_SECONDS;
  run(state, FIREFLY_STEP_SECONDS * 2 + FIREFLY_CLEAR_SECONDS + FIREFLY_INTRO_SECONDS + 0.2);
  assert.equal(state.phase, "playing");
  assert.equal(state.round, 1);
  assert.equal(state.fireflies.length, 4);
  assert.equal(state.obstacles.length, 3);
});

test("input calls outside the playing phase are inert", () => {
  const state = createFireflyState(new SeededRng(5));
  assert.equal(beginFireflyStroke(state, 0.5, 0.5), false);
  assert.equal(extendFireflyStroke(state, 0.6, 0.5), "idle");
  beginFireflyRun(state);
  assert.equal(state.phase, "intro");
  assert.equal(beginFireflyStroke(state, 0.5, 0.5), false);
  const point = clearPoint(state);
  run(state, FIREFLY_INTRO_SECONDS + FIREFLY_STEP_SECONDS);
  assert.equal(beginFireflyStroke(state, point.x, point.y), true);
});
