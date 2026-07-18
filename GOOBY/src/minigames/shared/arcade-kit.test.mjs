import assert from "node:assert/strict";
import test from "node:test";
import { ArcadeCountdown } from "./countdown.ts";
import { createDifficultyRamp } from "./difficulty.ts";
import { FixedStepAccumulator } from "./fixed-step.ts";
import { PauseGate } from "./pause-gate.ts";

function runPartition(frameSeconds, frames) {
  const accumulator = new FixedStepAccumulator({ stepSeconds: 1 / 120 });
  let position = 0;
  for (let frame = 0; frame < frames; frame += 1) {
    accumulator.advance(frameSeconds, (dt) => {
      position += (10 - position) * 0.35 * dt;
    });
  }
  return { position, steps: accumulator.stepCount };
}

test("fixed-step partitions at 30/60/120 Hz stay bit-identical", () => {
  const at30 = runPartition(1 / 30, 90);
  const at60 = runPartition(1 / 60, 180);
  const at120 = runPartition(1 / 120, 360);
  assert.equal(at30.steps, 360);
  assert.equal(at60.steps, 360);
  assert.equal(at120.steps, 360);
  assert.equal(at30.position, at120.position);
  assert.equal(at60.position, at120.position);
});

test("countdown emits typed countdown cues and one go for every partition", () => {
  const run = (frameSeconds, frames) => {
    const events = [];
    const countdown = new ArcadeCountdown({
      seconds: 3,
      feedback: (event) => events.push(event.kind === "tick" ? `${event.cue}:${event.value}` : event.cue),
    });
    countdown.start();
    for (let frame = 0; frame < frames; frame += 1) countdown.update(frameSeconds);
    return events;
  };
  const expected = ["countdown:3", "countdown:2", "countdown:1", "go"];
  assert.deepEqual(run(1 / 30, 120), expected);
  assert.deepEqual(run(1 / 60, 240), expected);
  assert.deepEqual(run(1 / 120, 480), expected);
});

test("pause gate freezes and restores simulation state exactly", () => {
  const play = (pausedFrames) => {
    const gate = new PauseGate();
    const accumulator = new FixedStepAccumulator({ stepSeconds: 1 / 120 });
    let position = 0;
    const frame = (dt) => {
      accumulator.advance(gate.filter(dt), (stepDt) => {
        position += (4 - position) * 1.2 * stepDt;
      });
    };
    for (let index = 0; index < 60; index += 1) frame(1 / 60);
    gate.pause();
    for (let index = 0; index < pausedFrames; index += 1) frame(1 / 60);
    gate.resume();
    for (let index = 0; index < 60; index += 1) frame(1 / 60);
    return { position, steps: accumulator.stepCount };
  };
  const control = play(0);
  const paused = play(10_000);
  assert.equal(paused.steps, control.steps);
  assert.equal(paused.position, control.position);
});

test("difficulty ramp is monotonic, clamped, and shape-stable", () => {
  for (const shape of ["linear", "smoothstep", "ease-out"]) {
    const ramp = createDifficultyRamp({
      rampSeconds: 45,
      startIntensity: 0.1,
      maxIntensity: 0.9,
      shape,
    });
    let previous = -Infinity;
    for (let tick = 0; tick <= 500; tick += 1) {
      const intensity = ramp.intensityAt((tick / 500) * 90);
      assert.ok(intensity >= previous, `${shape} must not decrease`);
      assert.ok(intensity >= 0.1 && intensity <= 0.9, `${shape} must stay clamped`);
      previous = intensity;
    }
    assert.equal(ramp.intensityAt(1_000), 0.9);
  }
});
