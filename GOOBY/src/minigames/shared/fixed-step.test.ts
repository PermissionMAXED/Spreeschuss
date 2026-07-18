import { describe, expect, it } from "vitest";
import { FixedStepAccumulator } from "./fixed-step";

/** Toy simulation whose float trajectory is sensitive to step count/order. */
function createSpringSim(): { step: (dt: number) => void; readonly state: () => number } {
  let position = 0;
  let velocity = 0;
  return {
    step(dt: number): void {
      velocity += (10 - position) * 4.5 * dt;
      velocity *= 1 - 0.8 * dt;
      position += velocity * dt;
    },
    state: () => position,
  };
}

function runPartition(frameSeconds: number, frames: number): {
  readonly position: number;
  readonly steps: number;
  readonly pending: number;
} {
  const accumulator = new FixedStepAccumulator({ stepSeconds: 1 / 120 });
  const sim = createSpringSim();
  for (let frame = 0; frame < frames; frame += 1) {
    accumulator.advance(frameSeconds, (dt) => {
      sim.step(dt);
    });
  }
  return {
    position: sim.state(),
    steps: accumulator.stepCount,
    pending: accumulator.pendingSeconds,
  };
}

describe("fixed-step accumulator partition determinism", () => {
  it("produces identical simulation state for 30/60/120 Hz partitions of the same time", () => {
    const at30 = runPartition(1 / 30, 120);
    const at60 = runPartition(1 / 60, 240);
    const at120 = runPartition(1 / 120, 480);

    expect(at30.steps).toBe(480);
    expect(at60.steps).toBe(480);
    expect(at120.steps).toBe(480);
    // Same fixed step count and identical per-step float operations means the
    // trajectories are bit-identical, not merely close.
    expect(at60.position).toBe(at120.position);
    expect(at30.position).toBe(at120.position);
    expect(at30.pending).toBeLessThan(1 / 120);
  });

  it("matches an irregular mixed partition of the same total time", () => {
    const total = 4;
    const uniform = runPartition(1 / 120, total * 120);
    const accumulator = new FixedStepAccumulator({ stepSeconds: 1 / 120 });
    const sim = createSpringSim();
    const mixedFrames = [1 / 30, 1 / 120, 1 / 60, 1 / 120, 1 / 30];
    let elapsed = 0;
    let cursor = 0;
    while (elapsed < total) {
      const frame = Math.min(mixedFrames[cursor % mixedFrames.length] ?? 1 / 60, total - elapsed);
      accumulator.advance(frame, (dt) => {
        sim.step(dt);
      });
      elapsed += frame;
      cursor += 1;
    }
    expect(accumulator.stepCount).toBe(uniform.steps);
    expect(sim.state()).toBe(uniform.position);
  });

  it("carries sub-step remainders across frames without losing time", () => {
    const accumulator = new FixedStepAccumulator({ stepSeconds: 1 / 60 });
    let steps = 0;
    // 0.7 steps per frame: the accumulator should fire on frames 2, 3, 5, 7…
    const firedByFrame: number[] = [];
    for (let frame = 0; frame < 10; frame += 1) {
      const fired = accumulator.advance(0.7 / 60, () => {
        steps += 1;
      });
      firedByFrame.push(fired);
    }
    expect(steps).toBe(7);
    expect(firedByFrame).toEqual([0, 1, 1, 0, 1, 1, 0, 1, 1, 1]);
    expect(accumulator.pendingSeconds).toBeGreaterThanOrEqual(0);
    expect(accumulator.pendingSeconds).toBeLessThan(1 / 60);
  });

  it("clamps runaway frames and rejects invalid deltas", () => {
    const accumulator = new FixedStepAccumulator({ stepSeconds: 1 / 60, maxFrameSeconds: 0.25 });
    const executed = accumulator.advance(30, () => undefined);
    expect(executed).toBe(15);
    expect(() => accumulator.advance(-0.01, () => undefined)).toThrow(RangeError);
    expect(() => accumulator.advance(Number.NaN, () => undefined)).toThrow(RangeError);
    expect(() => new FixedStepAccumulator({ stepSeconds: 0 })).toThrow(RangeError);
    expect(() => new FixedStepAccumulator({ stepSeconds: 1 / 30, maxFrameSeconds: 1 / 60 })).toThrow(
      RangeError,
    );
  });

  it("restores snapshots exactly", () => {
    const control = new FixedStepAccumulator({ stepSeconds: 1 / 90 });
    const restored = new FixedStepAccumulator({ stepSeconds: 1 / 90 });
    let controlSteps = 0;
    let restoredSteps = 0;
    for (let frame = 0; frame < 7; frame += 1) {
      control.advance(0.013, () => {
        controlSteps += 1;
      });
      restored.advance(0.013, () => {
        restoredSteps += 1;
      });
    }
    const snapshot = restored.snapshot();
    restored.reset();
    expect(restored.stepCount).toBe(0);
    restored.restore(snapshot);
    for (let frame = 0; frame < 7; frame += 1) {
      control.advance(0.013, () => {
        controlSteps += 1;
      });
      restored.advance(0.013, () => {
        restoredSteps += 1;
      });
    }
    expect(restoredSteps).toBe(controlSteps);
    expect(restored.pendingSeconds).toBe(control.pendingSeconds);
    expect(restored.simulatedSeconds).toBe(control.simulatedSeconds);
    expect(() => restored.restore({ pendingSeconds: -1, stepCount: 0, simulatedSeconds: 0 })).toThrow(
      RangeError,
    );
    expect(() => restored.restore({ pendingSeconds: 0, stepCount: 1.5, simulatedSeconds: 0 })).toThrow(
      RangeError,
    );
  });

  it("reports alpha as the fraction of the next step already accumulated", () => {
    const accumulator = new FixedStepAccumulator({ stepSeconds: 0.1 });
    accumulator.advance(0.05, () => undefined);
    expect(accumulator.alpha).toBeCloseTo(0.5, 10);
    accumulator.advance(0.05, () => undefined);
    expect(accumulator.alpha).toBeCloseTo(0, 10);
  });
});
