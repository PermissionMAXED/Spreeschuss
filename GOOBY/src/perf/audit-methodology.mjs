export const MEASUREMENT_TRIALS = 3;
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
