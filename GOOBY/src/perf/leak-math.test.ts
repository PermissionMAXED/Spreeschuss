import { describe, expect, it } from "vitest";
import { analyzeLeakSeries, linearSlope } from "./leak-math.mjs";

const limits = {
  geometries: { maxSlope: 0.25, maxFinalGrowth: 2, maxPeakGrowth: 3 },
  heapBytes: {
    maxSlope: 512 * 1024,
    maxFinalGrowth: 6 * 1024 * 1024,
    maxPeakGrowth: 8 * 1024 * 1024,
  },
} as const;

describe("performance leak trend math", () => {
  it("uses least-squares slope across every checkpoint", () => {
    expect(linearSlope([10, 12, 14, 16])).toBe(2);
    expect(linearSlope([10, 11, 9, 10])).toBeCloseTo(-0.2, 10);
  });

  it("accepts bounded post-GC noise around a same-scene baseline", () => {
    const analysis = analyzeLeakSeries([
      { geometries: 80, heapBytes: 30_000_000 },
      { geometries: 81, heapBytes: 30_500_000 },
      { geometries: 80, heapBytes: 29_900_000 },
      { geometries: 81, heapBytes: 31_000_000 },
      { geometries: 80, heapBytes: 30_100_000 },
      { geometries: 80, heapBytes: 30_300_000 },
      { geometries: 81, heapBytes: 31_200_000 },
      { geometries: 80, heapBytes: 30_200_000 },
    ], limits);

    expect(analysis.passed).toBe(true);
    expect(analysis.failures).toEqual([]);
  });

  it("fails persistent slope, final growth, and transient peak regressions", () => {
    const analysis = analyzeLeakSeries([
      { geometries: 80, heapBytes: 30_000_000 },
      { geometries: 81, heapBytes: 30_500_000 },
      { geometries: 82, heapBytes: 31_000_000 },
      { geometries: 83, heapBytes: 42_000_000 },
      { geometries: 84, heapBytes: 32_000_000 },
      { geometries: 85, heapBytes: 32_500_000 },
      { geometries: 86, heapBytes: 33_000_000 },
      { geometries: 87, heapBytes: 37_000_000 },
    ], limits);

    expect(analysis.passed).toBe(false);
    expect(analysis.metrics.geometries?.slope).toBe(1);
    expect(analysis.metrics.heapBytes?.peakGrowth).toBe(12_000_000);
    expect(analysis.failures).toHaveLength(2);
  });

  it("rejects minimum-sample deficits instead of producing a weak trend", () => {
    expect(() => analyzeLeakSeries([
      { geometries: 80, heapBytes: 30_000_000 },
      { geometries: 80, heapBytes: 30_000_000 },
    ], limits, 8)).toThrow(/requires at least 8 samples; received 2/u);
  });
});
