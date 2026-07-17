export function linearSlope(values) {
  if (!Array.isArray(values) || values.length < 2) {
    throw new RangeError("Leak slope requires at least two samples");
  }
  const count = values.length;
  const meanX = (count - 1) / 2;
  const meanY = values.reduce((sum, value) => sum + value, 0) / count;
  let numerator = 0;
  let denominator = 0;
  for (let index = 0; index < count; index += 1) {
    const xDelta = index - meanX;
    numerator += xDelta * (values[index] - meanY);
    denominator += xDelta * xDelta;
  }
  return denominator === 0 ? 0 : numerator / denominator;
}

export function analyzeLeakSeries(samples, limits, minimumSamples = 8) {
  if (!Number.isInteger(minimumSamples) || minimumSamples < 2) {
    throw new RangeError("Leak analysis minimum must be an integer of at least two");
  }
  if (!Array.isArray(samples) || samples.length < minimumSamples) {
    throw new RangeError(
      `Leak analysis requires at least ${minimumSamples} samples; received ${samples?.length ?? 0}`,
    );
  }
  const metrics = {};
  const failures = [];
  for (const [name, limit] of Object.entries(limits)) {
    const values = samples.map((sample, index) => {
      const value = sample[name];
      if (!Number.isFinite(value)) {
        throw new TypeError(`Leak sample ${index} has no finite ${name} metric`);
      }
      return value;
    });
    const baseline = values[0];
    const final = values[values.length - 1];
    const finalGrowth = final - baseline;
    const peakGrowth = Math.max(...values) - baseline;
    const slope = linearSlope(values);
    const withinLimit = slope <= limit.maxSlope
      && finalGrowth <= limit.maxFinalGrowth
      && peakGrowth <= limit.maxPeakGrowth;
    metrics[name] = {
      baseline,
      final,
      finalGrowth,
      peakGrowth,
      slope,
      limit,
      withinLimit,
    };
    if (!withinLimit) {
      failures.push(
        `${name}: slope ${slope.toFixed(3)} (max ${limit.maxSlope}), `
          + `final growth ${finalGrowth} (max ${limit.maxFinalGrowth}), `
          + `peak growth ${peakGrowth} (max ${limit.maxPeakGrowth})`,
      );
    }
  }
  return {
    sampleCount: samples.length,
    metrics,
    failures,
    passed: failures.length === 0,
  };
}
