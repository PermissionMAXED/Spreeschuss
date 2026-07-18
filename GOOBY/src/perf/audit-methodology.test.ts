import { describe, expect, it } from "vitest";
import {
  advanceWarmupState,
  assertTimingLimits,
  createWarmupState,
  sustainedSlowProbeIsRejected,
  summarizePerformanceTrials,
  type AuditSnapshot,
  type WarmupObservation,
} from "./audit-methodology.mjs";

const stableObservation: WarmupObservation = {
  networkIdle: true,
  appReady: true,
  runtimeKey: "home:living-room|none|none",
  quality: "low",
  programs: 3,
  samples: 120,
  fps: 58.8,
  p95Ms: 17.2,
};

function snapshot(
  fps: number,
  p95Ms: number,
  drawCallsP95: number,
  trianglesP95: number,
  samples = 120,
): AuditSnapshot {
  return {
    marker: fps,
    frame: {
      fps,
      averageMs: 1_000 / fps,
      p95Ms,
      samples,
    },
    render: {
      drawCalls: drawCallsP95 - 1,
      drawCallsP95,
      triangles: trianglesP95 - 10,
      trianglesP95,
    },
  };
}

describe("performance audit warmup gate", () => {
  it("requires repeated stable network, runtime, shader, and timing observations", () => {
    let state = createWarmupState();
    state = advanceWarmupState(state, stableObservation);
    expect(state).toMatchObject({ ready: false, stableObservations: 1 });

    state = advanceWarmupState(state, { ...stableObservation, samples: 180, fps: 59.1 });
    expect(state).toMatchObject({ ready: false, stableObservations: 2 });

    state = advanceWarmupState(state, { ...stableObservation, samples: 240, fps: 58.9 });
    expect(state).toMatchObject({ ready: true, stableObservations: 3 });
  });

  it("restarts settling after network activity, shader compilation, or timing drift", () => {
    let state = advanceWarmupState(createWarmupState(), stableObservation);
    state = advanceWarmupState(state, { ...stableObservation, samples: 180 });
    state = advanceWarmupState(state, {
      ...stableObservation,
      networkIdle: false,
      samples: 200,
    });
    expect(state).toMatchObject({ ready: false, stableObservations: 0 });

    state = advanceWarmupState(state, { ...stableObservation, programs: 4, samples: 220 });
    state = advanceWarmupState(state, { ...stableObservation, programs: 5, samples: 240 });
    expect(state).toMatchObject({ ready: false, stableObservations: 1 });

    state = advanceWarmupState(state, {
      ...stableObservation,
      programs: 5,
      samples: 260,
      fps: 30,
      p95Ms: 33.4,
    });
    expect(state).toMatchObject({ ready: false, stableObservations: 1 });
  });

  it("does not mistake a stable sustained slowdown for a warmup blocker", () => {
    const slow = { ...stableObservation, fps: 30, p95Ms: 33.4 };
    let state = createWarmupState();
    for (let index = 0; index < 3; index += 1) {
      state = advanceWarmupState(state, {
        ...slow,
        samples: slow.samples + index * 30,
      });
    }
    expect(state.ready).toBe(true);
  });
});

describe("performance audit repeat trials", () => {
  it("uses median timing but the maximum draw and triangle work budgets", () => {
    const summary = summarizePerformanceTrials([
      snapshot(29, 40, 104, 16_100),
      snapshot(59, 17.4, 105, 16_226),
      snapshot(58, 17.9, 103, 16_000),
    ], 120);

    expect(summary.snapshot.frame).toMatchObject({
      fps: 58,
      p95Ms: 17.9,
      samples: 120,
    });
    expect(summary.snapshot.render).toMatchObject({
      drawCallsP95: 105,
      trianglesP95: 16_226,
    });
    expect(summary).toMatchObject({
      trialCount: 3,
      timingAggregation: "median",
      workBudgetAggregation: "maximum",
    });
  });

  it("rejects a sample deficit in any trial", () => {
    expect(() => summarizePerformanceTrials([
      snapshot(59, 17, 105, 16_226),
      snapshot(59, 17, 105, 16_226, 119),
      snapshot(59, 17, 105, 16_226),
    ], 120)).toThrow(/trial 2 has 119\/120 samples/u);
  });

  it("still fails a synthetic sustained 30 FPS probe after median aggregation", () => {
    const timing = { minFps: 45, maxP95Ms: 28 };
    expect(sustainedSlowProbeIsRejected(timing, 120, 30)).toBe(true);

    const slowSummary = summarizePerformanceTrials([
      snapshot(30, 33.4, 105, 16_226),
      snapshot(30, 33.4, 105, 16_226),
      snapshot(30, 33.4, 105, 16_226),
    ], 120);
    expect(() =>
      assertTimingLimits("home:living-room", slowSummary.snapshot, timing)
    ).toThrow(/30\.0 FPS is below 45/u);
  });
});
