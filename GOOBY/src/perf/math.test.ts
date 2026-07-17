import { describe, expect, it } from "vitest";
import { diffResources, hasLikelyResourceLeak, percentile, type ResourceMetrics } from "./math";

const baseline: ResourceMetrics = {
  geometries: 20,
  textures: 5,
  programs: 4,
  materials: 18,
  heapBytes: 24 * 1024 * 1024,
};

describe("performance math", () => {
  it("computes nearest-rank percentiles without mutating samples", () => {
    const samples = new Float64Array([16, 20, 12, 40, 18]);
    expect(percentile(samples, samples.length, 0.95)).toBe(40);
    expect([...samples]).toEqual([16, 20, 12, 40, 18]);
  });

  it("diffs all tracked resources including heap", () => {
    expect(diffResources(baseline, {
      geometries: 22,
      textures: 6,
      programs: 4,
      materials: 19,
      heapBytes: 26 * 1024 * 1024,
    })).toEqual({
      geometries: 2,
      textures: 1,
      programs: 0,
      materials: 1,
      heapBytes: 2 * 1024 * 1024,
    });
  });

  it("only reports persistent growth after enough transitions", () => {
    const diff = diffResources(baseline, {
      ...baseline,
      geometries: baseline.geometries + 3,
    });
    expect(hasLikelyResourceLeak(diff, 4)).toBe(false);
    expect(hasLikelyResourceLeak(diff, 10)).toBe(true);
  });
});
