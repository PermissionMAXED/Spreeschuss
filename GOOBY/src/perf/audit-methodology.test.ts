import { describe, expect, it } from "vitest";
import {
  advanceWarmupState,
  assertNormalizedTimingLimits,
  assertTimingLimits,
  createWarmupState,
  normalizedSustainedSlowProbeIsRejected,
  runCalibrationCohorts,
  runWithDiagnosticReport,
  sustainedSlowProbeIsRejected,
  summarizeCalibrationTrials,
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

describe("raw WebGL runner calibration", () => {
  const calibration = { fps: 60, p95Ms: 16.7 };
  const stableCohort = {
    marker: "stable",
    warmup: { fps: 60, p95Ms: 16.8, samples: 120 },
    trials: [
      { fps: 59, p95Ms: 17.1, samples: 120 },
      { fps: 61, p95Ms: 16.7, samples: 121 },
      { fps: 60, p95Ms: 16.9, samples: 120 },
    ],
  };
  const schedulerJitterCohort = {
    marker: "scheduler-jitter",
    warmup: { fps: 60, p95Ms: 16.8, samples: 120 },
    trials: [
      { fps: 60, p95Ms: 16.8, samples: 120 },
      { fps: 56.6, p95Ms: 33.4, samples: 120 },
      { fps: 59.9, p95Ms: 16.7, samples: 120 },
    ],
  };
  const normalizedHomeLimit = {
    minimumCalibrationRatio: 0.75,
    minimumP95CalibrationRatio: (1_000 / 60) / 28,
    absoluteMinFps: 30,
  };

  it("uses stable median FPS and p95 calibration timing", () => {
    const summary = summarizeCalibrationTrials([
      { fps: 59, p95Ms: 17.1, samples: 120 },
      { fps: 61, p95Ms: 16.7, samples: 121 },
      { fps: 60, p95Ms: 16.9, samples: 120 },
    ]);

    expect(summary).toMatchObject({
      fps: 60,
      p95Ms: 16.9,
      samples: 120,
      trialCount: 3,
      samplesPerTrial: [120, 121, 120],
      timingAggregation: "median",
    });
    expect(summary.fpsRelativeRange).toBeCloseTo(2 / 60);
    expect(summary.p95RelativeRange).toBeCloseTo(0.4 / 16.9);
  });

  it("rejects unstable FPS or p95 variance", () => {
    expect(() => summarizeCalibrationTrials([
      { fps: 60, p95Ms: 16.7, samples: 120 },
      { fps: 40, p95Ms: 16.7, samples: 120 },
      { fps: 60, p95Ms: 16.7, samples: 120 },
    ])).toThrow(/FPS variance 33\.3% exceeds 20\.0%/u);

    expect(() => summarizeCalibrationTrials([
      { fps: 60, p95Ms: 16.7, samples: 120 },
      { fps: 60, p95Ms: 28, samples: 120 },
      { fps: 60, p95Ms: 16.7, samples: 120 },
    ])).toThrow(/p95 variance 67\.7% exceeds 35\.0%/u);
  });

  it("rejects a sample deficit in any calibration trial", () => {
    expect(() => summarizeCalibrationTrials([
      { fps: 60, p95Ms: 16.7, samples: 120 },
      { fps: 60, p95Ms: 16.7, samples: 119 },
      { fps: 60, p95Ms: 16.7, samples: 120 },
    ])).toThrow(/Calibration trial 2 has 119\/120 samples/u);
  });

  it("discards one unstable cohort and gates only on a fresh stable cohort", async () => {
    const cohorts = [schedulerJitterCohort, stableCohort];
    const result = await runCalibrationCohorts(() => cohorts.shift()!);
    const firstAttempt = result.attempts[0]!;
    const secondAttempt = result.attempts[1]!;

    expect(result.status).toBe("passed");
    expect(result.attempts).toHaveLength(2);
    expect(firstAttempt).toMatchObject({
      attempt: 1,
      status: "unstable",
      usedForGating: false,
      cohort: schedulerJitterCohort,
    });
    expect(firstAttempt.reason).toMatch(/p95 variance 99\.4% exceeds 35\.0%/u);
    expect(secondAttempt).toMatchObject({
      attempt: 2,
      status: "stable",
      usedForGating: true,
      cohort: stableCohort,
    });
    expect(result.selectedAttempt).toBe(2);
    expect(result.summary).toBe(secondAttempt.summary);
    expect(result.summary).not.toBe(firstAttempt.summary);
    expect(result.reason).toMatch(/Attempt 1 was discarded for gating/u);
  });

  it("fails after exactly two independent unstable cohorts", async () => {
    let collected = 0;
    const result = await runCalibrationCohorts(() => {
      collected += 1;
      return {
        ...schedulerJitterCohort,
        marker: `scheduler-jitter-${collected}`,
      };
    });

    expect(collected).toBe(2);
    expect(result).toMatchObject({
      status: "failed",
      selectedAttempt: null,
      summary: null,
    });
    expect(result.attempts).toHaveLength(2);
    expect(result.attempts.every((attempt) =>
      attempt.status === "unstable" && !attempt.usedForGating)).toBe(true);
    expect(result.reason).toMatch(
      /remained unstable across 2 independent cohorts \(attempt 1: .*; attempt 2:/u,
    );
  });

  it("does not collect a second cohort when the first is stable", async () => {
    let collected = 0;
    const result = await runCalibrationCohorts(() => {
      collected += 1;
      return stableCohort;
    });

    expect(collected).toBe(1);
    expect(result).toMatchObject({
      status: "passed",
      selectedAttempt: 1,
      reason: "Attempt 1 was stable; no retry required",
    });
    expect(result.attempts).toHaveLength(1);
  });

  it("does not convert a scene gate failure into a calibration retry", async () => {
    let collected = 0;
    const result = await runCalibrationCohorts(() => {
      collected += 1;
      return stableCohort;
    });
    expect(result.status).toBe("passed");

    expect(() => assertNormalizedTimingLimits(
      "home",
      snapshot(44, 21, 105, 16_226),
      normalizedHomeLimit,
      result.summary!,
    )).toThrow(/FPS throughput ratio 0\.733 is below 0\.750/u);
    expect(collected).toBe(1);
    expect(result.attempts).toHaveLength(1);
  });

  it("passes and fails scenes by calibration-relative FPS and p95 throughput", () => {
    expect(() => assertNormalizedTimingLimits(
      "home",
      snapshot(46, 21, 105, 16_226),
      normalizedHomeLimit,
      calibration,
    )).not.toThrow();
    expect(() => assertNormalizedTimingLimits(
      "home",
      snapshot(44, 21, 105, 16_226),
      normalizedHomeLimit,
      calibration,
    )).toThrow(/FPS throughput ratio 0\.733 is below 0\.750/u);
    expect(() => assertNormalizedTimingLimits(
      "home",
      snapshot(46, 29, 105, 16_226),
      normalizedHomeLimit,
      calibration,
    )).toThrow(/p95 throughput ratio 0\.576 is below 0\.595/u);
    expect(() => assertNormalizedTimingLimits(
      "home",
      snapshot(29.9, 20, 105, 16_226),
      normalizedHomeLimit,
      { fps: 35, p95Ms: 20 },
    )).toThrow(/absolute safety floor/u);
  });

  it("rejects sustained 30 FPS against a 60 FPS calibration", () => {
    expect(normalizedSustainedSlowProbeIsRejected(
      normalizedHomeLimit,
      calibration,
      120,
      30,
    )).toBe(true);
  });
});

describe("performance diagnostic persistence", () => {
  it("writes diagnostics before propagating an audit failure", async () => {
    const events: string[] = [];
    const failure = new Error("scene gate failed");

    await expect(runWithDiagnosticReport(
      () => {
        events.push("audit");
        return Promise.reject(failure);
      },
      (receivedFailure) => {
        events.push("report");
        expect(receivedFailure).toBe(failure);
        return Promise.resolve();
      },
    )).rejects.toBe(failure);
    expect(events).toEqual(["audit", "report"]);
  });
});
