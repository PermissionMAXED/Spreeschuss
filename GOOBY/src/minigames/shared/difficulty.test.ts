import { describe, expect, it } from "vitest";
import { createDifficultyRamp, type DifficultyRampShape } from "./difficulty";

const SHAPES: readonly DifficultyRampShape[] = ["linear", "smoothstep", "ease-out"];

describe("difficulty ramp", () => {
  it("is monotonically non-decreasing and clamped for every shape", () => {
    for (const shape of SHAPES) {
      const ramp = createDifficultyRamp({
        rampSeconds: 90,
        startIntensity: 0.2,
        maxIntensity: 0.95,
        shape,
      });
      let previous = Number.NEGATIVE_INFINITY;
      for (let tick = 0; tick <= 2_000; tick += 1) {
        const elapsed = (tick / 2_000) * 140 - 10;
        const intensity = ramp.intensityAt(elapsed);
        expect(intensity).toBeGreaterThanOrEqual(previous);
        expect(intensity).toBeGreaterThanOrEqual(0.2);
        expect(intensity).toBeLessThanOrEqual(0.95);
        previous = intensity;
      }
      expect(ramp.intensityAt(0)).toBeCloseTo(0.2, 12);
      expect(ramp.intensityAt(90)).toBeCloseTo(0.95, 12);
      expect(ramp.intensityAt(10_000)).toBeCloseTo(0.95, 12);
      expect(ramp.intensityAt(-5)).toBeCloseTo(0.2, 12);
    }
  });

  it("maps intensity onto gameplay values and integer stages monotonically", () => {
    const ramp = createDifficultyRamp({ rampSeconds: 60, shape: "smoothstep" });
    expect(ramp.valueAt(0, 1.5, 4)).toBeCloseTo(1.5, 12);
    expect(ramp.valueAt(60, 1.5, 4)).toBeCloseTo(4, 12);
    // Reversed bounds ramp downward — e.g. spawn interval shrinking over time.
    expect(ramp.valueAt(60, 2, 0.5)).toBeCloseTo(0.5, 12);
    let previousStage = 0;
    for (let elapsed = 0; elapsed <= 120; elapsed += 0.25) {
      const stage = ramp.stageAt(elapsed, 5);
      expect(stage).toBeGreaterThanOrEqual(previousStage);
      expect(stage).toBeLessThanOrEqual(4);
      previousStage = stage;
    }
    expect(ramp.stageAt(0, 5)).toBe(0);
    expect(ramp.stageAt(1_000, 5)).toBe(4);
  });

  it("handles a flat ramp (start equals ceiling) without dividing by zero", () => {
    const ramp = createDifficultyRamp({ rampSeconds: 30, startIntensity: 0.5, maxIntensity: 0.5 });
    expect(ramp.intensityAt(0)).toBe(0.5);
    expect(ramp.intensityAt(15)).toBe(0.5);
    expect(ramp.valueAt(0, 2, 6)).toBe(6);
    expect(ramp.stageAt(0, 3)).toBe(2);
  });

  it("rejects invalid configuration and queries", () => {
    expect(() => createDifficultyRamp({ rampSeconds: 0 })).toThrow(RangeError);
    expect(() => createDifficultyRamp({ rampSeconds: Number.NaN })).toThrow(RangeError);
    expect(() =>
      createDifficultyRamp({ rampSeconds: 10, startIntensity: 1, maxIntensity: 0 }),
    ).toThrow(RangeError);
    const ramp = createDifficultyRamp({ rampSeconds: 10 });
    expect(() => ramp.intensityAt(Number.NaN)).toThrow(RangeError);
    expect(() => ramp.stageAt(5, 0)).toThrow(RangeError);
    expect(() => ramp.valueAt(5, Number.NaN, 1)).toThrow(RangeError);
  });
});
