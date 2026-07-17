export interface LeakMetricLimit {
  readonly maxSlope: number;
  readonly maxFinalGrowth: number;
  readonly maxPeakGrowth: number;
}

export interface LeakMetricResult {
  readonly baseline: number;
  readonly final: number;
  readonly finalGrowth: number;
  readonly peakGrowth: number;
  readonly slope: number;
  readonly limit: LeakMetricLimit;
  readonly withinLimit: boolean;
}

export interface LeakAnalysis {
  readonly sampleCount: number;
  readonly metrics: Readonly<Record<string, LeakMetricResult>>;
  readonly failures: readonly string[];
  readonly passed: boolean;
}

export function linearSlope(values: readonly number[]): number;
export function analyzeLeakSeries(
  samples: readonly Readonly<Record<string, number>>[],
  limits: Readonly<Record<string, LeakMetricLimit>>,
  minimumSamples?: number,
): LeakAnalysis;
