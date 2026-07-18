export const MEASUREMENT_TRIALS = 3;
export const MAX_CALIBRATION_COHORTS = 2;
export const DEFAULT_CALIBRATION_OPTIONS = Object.freeze({
  minimumSamples: 120,
  expectedTrials: MEASUREMENT_TRIALS,
  maxFpsRelativeRange: 0.2,
  maxP95RelativeRange: 0.35,
});
export const DEFAULT_WARMUP_OPTIONS = Object.freeze({
  minimumSamples: 120,
  requiredStableObservations: 3,
  expectedQuality: "low",
  minimumPrograms: 1,
  maxFpsDriftRatio: 0.2,
  maxP95DriftRatio: 0.35,
});

function finitePositive(value) {
  return Number.isFinite(value) && value > 0;
}

function relativeDrift(left, right) {
  if (left === right) return 0;
  return Math.abs(left - right) / Math.max(Math.abs(left), Math.abs(right), Number.EPSILON);
}

function relativeRange(values, center) {
  return (Math.max(...values) - Math.min(...values))
    / Math.max(Math.abs(center), Number.EPSILON);
}

function validateWarmupOptions(options) {
  if (!Number.isInteger(options.minimumSamples) || options.minimumSamples <= 0) {
    throw new RangeError("Warmup minimumSamples must be a positive integer");
  }
  if (
    !Number.isInteger(options.requiredStableObservations)
    || options.requiredStableObservations < 2
  ) {
    throw new RangeError("Warmup requires at least two stable observations");
  }
}

export function createWarmupState() {
  return {
    ready: false,
    stableObservations: 0,
    lastObservation: null,
    reason: "warmup has not been observed",
  };
}

export function advanceWarmupState(
  state,
  observation,
  overrides = {},
) {
  const options = { ...DEFAULT_WARMUP_OPTIONS, ...overrides };
  validateWarmupOptions(options);
  const reasons = [];
  if (!observation.networkIdle) reasons.push("network is active");
  if (!observation.appReady) reasons.push("application is not ready");
  if (typeof observation.runtimeKey !== "string" || observation.runtimeKey.length === 0) {
    reasons.push("runtime state is unavailable");
  }
  if (observation.quality !== options.expectedQuality) {
    reasons.push(`quality is ${String(observation.quality)}, expected ${options.expectedQuality}`);
  }
  if (!Number.isInteger(observation.programs) || observation.programs < options.minimumPrograms) {
    reasons.push(`renderer has ${String(observation.programs)} programs`);
  }
  if (!Number.isInteger(observation.samples) || observation.samples < options.minimumSamples) {
    reasons.push(`only ${String(observation.samples)}/${options.minimumSamples} warmup samples`);
  }
  if (!finitePositive(observation.fps)) reasons.push("warmup FPS is not positive and finite");
  if (!finitePositive(observation.p95Ms)) reasons.push("warmup p95 is not positive and finite");

  if (reasons.length > 0) {
    return {
      ready: false,
      stableObservations: 0,
      lastObservation: null,
      reason: reasons.join("; "),
    };
  }

  const previous = state.lastObservation;
  const stable = previous !== null
    && previous.runtimeKey === observation.runtimeKey
    && previous.quality === observation.quality
    && previous.programs === observation.programs
    && relativeDrift(previous.fps, observation.fps) <= options.maxFpsDriftRatio
    && relativeDrift(previous.p95Ms, observation.p95Ms) <= options.maxP95DriftRatio;
  const stableObservations = stable ? state.stableObservations + 1 : 1;
  return {
    ready: stableObservations >= options.requiredStableObservations,
    stableObservations,
    lastObservation: { ...observation },
    reason: stable
      ? `${stableObservations}/${options.requiredStableObservations} stable observations`
      : "establishing a new stable renderer baseline",
  };
}

function requireFiniteMetric(value, label) {
  if (!Number.isFinite(value)) throw new TypeError(`${label} must be finite`);
  return value;
}

export function median(values, label = "values") {
  if (!Array.isArray(values) || values.length < 3 || values.length % 2 === 0) {
    throw new RangeError(`${label} must contain an odd number of at least three values`);
  }
  const ordered = values
    .map((value) => requireFiniteMetric(value, label))
    .toSorted((left, right) => left - right);
  return ordered[Math.floor(ordered.length / 2)];
}

export function summarizePerformanceTrials(
  snapshots,
  minimumSamples,
  expectedTrials = MEASUREMENT_TRIALS,
) {
  if (
    !Number.isInteger(expectedTrials)
    || expectedTrials < 3
    || expectedTrials % 2 === 0
    || snapshots.length !== expectedTrials
  ) {
    throw new RangeError(
      `Performance measurements require exactly ${expectedTrials} odd repeat trials`,
    );
  }
  if (!Number.isInteger(minimumSamples) || minimumSamples <= 0) {
    throw new RangeError("Performance minimumSamples must be a positive integer");
  }

  const sampleCounts = snapshots.map((snapshot, index) => {
    const samples = snapshot?.frame?.samples;
    if (!Number.isInteger(samples) || samples < minimumSamples) {
      throw new RangeError(
        `Performance trial ${index + 1} has ${String(samples)}/${minimumSamples} samples`,
      );
    }
    return samples;
  });
  const frameFps = snapshots.map((snapshot) =>
    requireFiniteMetric(snapshot.frame.fps, "trial FPS"));
  const medianFps = median(frameFps, "trial FPS");
  const representativeIndex = frameFps.indexOf(medianFps);
  const representative = snapshots[representativeIndex];
  const drawCallsP95 = snapshots.map((snapshot) =>
    requireFiniteMetric(snapshot.render.drawCallsP95, "trial draw calls p95"));
  const trianglesP95 = snapshots.map((snapshot) =>
    requireFiniteMetric(snapshot.render.trianglesP95, "trial triangles p95"));

  return {
    snapshot: {
      ...representative,
      frame: {
        ...representative.frame,
        fps: medianFps,
        averageMs: median(
          snapshots.map((snapshot) => snapshot.frame.averageMs),
          "trial average frame time",
        ),
        p95Ms: median(
          snapshots.map((snapshot) => snapshot.frame.p95Ms),
          "trial p95 frame time",
        ),
        samples: Math.min(...sampleCounts),
      },
      render: {
        ...representative.render,
        drawCalls: median(
          snapshots.map((snapshot) => snapshot.render.drawCalls),
          "trial draw calls",
        ),
        drawCallsP95: Math.max(...drawCallsP95),
        triangles: median(
          snapshots.map((snapshot) => snapshot.render.triangles),
          "trial triangles",
        ),
        trianglesP95: Math.max(...trianglesP95),
      },
    },
    trialCount: snapshots.length,
    samplesPerTrial: sampleCounts,
    timingAggregation: "median",
    workBudgetAggregation: "maximum",
  };
}

function resolveCalibrationOptions(overrides) {
  const options = { ...DEFAULT_CALIBRATION_OPTIONS, ...overrides };
  if (
    !Number.isInteger(options.expectedTrials)
    || options.expectedTrials < 3
    || options.expectedTrials % 2 === 0
  ) {
    throw new RangeError(
      "Calibration expectedTrials must be an odd integer of at least three",
    );
  }
  if (!Number.isInteger(options.minimumSamples) || options.minimumSamples <= 0) {
    throw new RangeError("Calibration minimumSamples must be a positive integer");
  }
  for (const [name, limit] of [
    ["FPS relative range", options.maxFpsRelativeRange],
    ["p95 relative range", options.maxP95RelativeRange],
  ]) {
    if (!finitePositive(limit)) {
      throw new RangeError(`Calibration maximum ${name} must be positive and finite`);
    }
  }
  return options;
}

function summarizeCalibrationMetrics(trials, options) {
  if (!Array.isArray(trials) || trials.length !== options.expectedTrials) {
    throw new RangeError(
      `Calibration requires exactly ${String(options.expectedTrials)} odd repeat trials`,
    );
  }

  const sampleCounts = trials.map((trial, index) => {
    const samples = trial?.samples;
    if (!Number.isInteger(samples) || samples < options.minimumSamples) {
      throw new RangeError(
        `Calibration trial ${index + 1} has ${String(samples)}/${options.minimumSamples} samples`,
      );
    }
    return samples;
  });
  const fpsValues = trials.map((trial) =>
    requireFiniteMetric(trial.fps, "calibration FPS"));
  const p95Values = trials.map((trial) =>
    requireFiniteMetric(trial.p95Ms, "calibration p95"));
  if (!fpsValues.every(finitePositive) || !p95Values.every(finitePositive)) {
    throw new RangeError("Calibration timing metrics must be positive");
  }

  const fps = median(fpsValues, "calibration FPS");
  const p95Ms = median(p95Values, "calibration p95");
  const fpsRelativeRange = relativeRange(fpsValues, fps);
  const p95RelativeRange = relativeRange(p95Values, p95Ms);

  return {
    fps,
    p95Ms,
    samples: Math.min(...sampleCounts),
    trialCount: trials.length,
    samplesPerTrial: sampleCounts,
    fpsRelativeRange,
    p95RelativeRange,
    timingAggregation: "median",
  };
}

export function classifyCalibrationTrials(
  trials,
  overrides = {},
) {
  const options = resolveCalibrationOptions(overrides);
  const summary = summarizeCalibrationMetrics(trials, options);
  const reasons = [];
  if (summary.fpsRelativeRange > options.maxFpsRelativeRange) {
    reasons.push(
      `Calibration FPS variance ${(summary.fpsRelativeRange * 100).toFixed(1)}% exceeds `
        + `${(options.maxFpsRelativeRange * 100).toFixed(1)}%`,
    );
  }
  if (summary.p95RelativeRange > options.maxP95RelativeRange) {
    reasons.push(
      `Calibration p95 variance ${(summary.p95RelativeRange * 100).toFixed(1)}% exceeds `
        + `${(options.maxP95RelativeRange * 100).toFixed(1)}%`,
    );
  }
  const status = reasons.length === 0 ? "stable" : "unstable";
  return {
    status,
    summary,
    reason: status === "stable"
      ? `within ${(options.maxFpsRelativeRange * 100).toFixed(1)}% FPS and `
        + `${(options.maxP95RelativeRange * 100).toFixed(1)}% p95 variance limits`
      : reasons.join("; "),
  };
}

export function summarizeCalibrationTrials(
  trials,
  overrides = {},
) {
  const classification = classifyCalibrationTrials(trials, overrides);
  if (classification.status === "unstable") {
    throw new Error(classification.reason);
  }
  return classification.summary;
}

export async function runCalibrationCohorts(
  collectCohort,
  overrides = {},
) {
  if (typeof collectCohort !== "function") {
    throw new TypeError("Calibration cohort collector must be a function");
  }
  const attempts = [];
  for (let attempt = 1; attempt <= MAX_CALIBRATION_COHORTS; attempt += 1) {
    const cohort = await collectCohort(attempt);
    if (cohort === null || typeof cohort !== "object" || !Array.isArray(cohort.trials)) {
      throw new TypeError(`Calibration cohort ${attempt} must include a trials array`);
    }
    const classification = classifyCalibrationTrials(cohort.trials, overrides);
    attempts.push({
      attempt,
      status: classification.status,
      reason: classification.reason,
      usedForGating: classification.status === "stable",
      summary: classification.summary,
      cohort,
    });
    if (classification.status === "stable") {
      const retried = attempt > 1;
      return {
        status: "passed",
        attempts,
        selectedAttempt: attempt,
        summary: classification.summary,
        reason: retried
          ? `Attempt 1 was discarded for gating (${attempts[0].reason}); `
            + `attempt ${attempt} was stable`
          : "Attempt 1 was stable; no retry required",
      };
    }
  }
  return {
    status: "failed",
    attempts,
    selectedAttempt: null,
    summary: null,
    reason: `Calibration remained unstable across ${MAX_CALIBRATION_COHORTS} `
      + `independent cohorts (${attempts
        .map(({ attempt, reason }) => `attempt ${attempt}: ${reason}`)
        .join("; ")})`,
  };
}

export function assertTimingLimits(label, snapshot, timing) {
  if (snapshot.frame.fps < timing.minFps) {
    throw new Error(
      `${label}: ${snapshot.frame.fps.toFixed(1)} FPS is below ${timing.minFps}`,
    );
  }
  if (snapshot.frame.p95Ms > timing.maxP95Ms) {
    throw new Error(
      `${label}: ${snapshot.frame.p95Ms.toFixed(1)}ms p95 exceeds ${timing.maxP95Ms}ms`,
    );
  }
}

export function assertNormalizedTimingLimits(
  label,
  snapshot,
  timing,
  calibration,
) {
  const minimumCalibrationRatio = requireFiniteMetric(
    timing.minimumCalibrationRatio,
    "minimum calibration ratio",
  );
  const minimumP95CalibrationRatio = requireFiniteMetric(
    timing.minimumP95CalibrationRatio,
    "minimum p95 calibration ratio",
  );
  const absoluteMinFps = requireFiniteMetric(
    timing.absoluteMinFps,
    "absolute minimum FPS",
  );
  const calibrationFps = requireFiniteMetric(calibration.fps, "calibration FPS");
  const calibrationP95Ms = requireFiniteMetric(calibration.p95Ms, "calibration p95");
  const sceneFps = requireFiniteMetric(snapshot.frame.fps, "scene FPS");
  const sceneP95Ms = requireFiniteMetric(snapshot.frame.p95Ms, "scene p95");
  if (
    minimumCalibrationRatio <= 0
    || minimumCalibrationRatio > 1
    || minimumP95CalibrationRatio <= 0
    || minimumP95CalibrationRatio > 1
    || absoluteMinFps <= 0
    || ![calibrationFps, calibrationP95Ms, sceneFps, sceneP95Ms].every(finitePositive)
  ) {
    throw new RangeError("Normalized timing inputs must be positive and valid");
  }

  const fpsRatio = sceneFps / calibrationFps;
  const p95ThroughputRatio = calibrationP95Ms / sceneP95Ms;
  if (sceneFps < absoluteMinFps) {
    throw new Error(
      `${label}: ${sceneFps.toFixed(1)} FPS is below the `
        + `${absoluteMinFps.toFixed(1)} absolute safety floor`,
    );
  }
  if (fpsRatio < minimumCalibrationRatio) {
    throw new Error(
      `${label}: FPS throughput ratio ${fpsRatio.toFixed(3)} is below `
        + `${minimumCalibrationRatio.toFixed(3)} `
        + `(${sceneFps.toFixed(1)} scene / ${calibrationFps.toFixed(1)} calibration FPS)`,
    );
  }
  if (p95ThroughputRatio < minimumP95CalibrationRatio) {
    throw new Error(
      `${label}: p95 throughput ratio ${p95ThroughputRatio.toFixed(3)} is below `
        + `${minimumP95CalibrationRatio.toFixed(3)} `
        + `(${sceneP95Ms.toFixed(1)}ms scene / ${calibrationP95Ms.toFixed(1)}ms calibration)`,
    );
  }
}

export function sustainedSlowProbeIsRejected(timing, minimumSamples, fps = 30) {
  const frameMs = 1_000 / fps;
  const snapshots = Array.from({ length: MEASUREMENT_TRIALS }, () => ({
    frame: {
      fps,
      averageMs: frameMs,
      p95Ms: frameMs,
      samples: minimumSamples,
    },
    render: {
      drawCalls: 1,
      drawCallsP95: 1,
      triangles: 1,
      trianglesP95: 1,
    },
  }));
  const { snapshot } = summarizePerformanceTrials(snapshots, minimumSamples);
  try {
    assertTimingLimits("synthetic sustained-slow probe", snapshot, timing);
    return false;
  } catch {
    return true;
  }
}

export function normalizedSustainedSlowProbeIsRejected(
  timing,
  calibration,
  minimumSamples,
  fps = 30,
) {
  const frameMs = 1_000 / fps;
  const snapshots = Array.from({ length: MEASUREMENT_TRIALS }, () => ({
    frame: {
      fps,
      averageMs: frameMs,
      p95Ms: frameMs,
      samples: minimumSamples,
    },
    render: {
      drawCalls: 1,
      drawCallsP95: 1,
      triangles: 1,
      trianglesP95: 1,
    },
  }));
  const { snapshot } = summarizePerformanceTrials(snapshots, minimumSamples);
  try {
    assertNormalizedTimingLimits(
      "synthetic sustained-slow probe",
      snapshot,
      timing,
      calibration,
    );
    return false;
  } catch {
    return true;
  }
}

export async function runWithDiagnosticReport(operation, writeReport) {
  let result;
  let failure = null;
  try {
    result = await operation();
  } catch (error) {
    failure = error;
  }

  try {
    await writeReport(failure);
  } catch (reportError) {
    if (failure !== null) {
      throw new AggregateError(
        [failure, reportError],
        "Performance audit failed and its diagnostic report could not be written",
      );
    }
    throw reportError;
  }

  if (failure !== null) throw failure;
  return result;
}
