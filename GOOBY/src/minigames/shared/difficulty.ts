/**
 * Deterministic difficulty ramp.
 *
 * A ramp is a pure function of elapsed active seconds (the caller feeds time
 * that already passed the pause gate), guaranteed monotonically non-decreasing
 * and clamped at the configured ceiling. Games map the intensity onto spawn
 * rates, speeds, or lane counts with the provided helpers.
 */

export type DifficultyRampShape = "linear" | "smoothstep" | "ease-out";

export interface DifficultyRampConfig {
  /** Seconds of active play until the ramp reaches full intensity. */
  readonly rampSeconds: number;
  /** Intensity at t = 0. Defaults to 0. */
  readonly startIntensity?: number;
  /** Intensity ceiling. Defaults to 1. */
  readonly maxIntensity?: number;
  /** Interpolation shape; every shape is monotonic. Defaults to "linear". */
  readonly shape?: DifficultyRampShape;
}

export interface DifficultyRamp {
  readonly rampSeconds: number;
  readonly startIntensity: number;
  readonly maxIntensity: number;
  readonly shape: DifficultyRampShape;
  /** Intensity in [startIntensity, maxIntensity]; monotonic non-decreasing. */
  intensityAt(elapsedSeconds: number): number;
  /** Interpolates a gameplay value from `from` (start) to `to` (max). */
  valueAt(elapsedSeconds: number, from: number, to: number): number;
  /** Integer stage in [0, stages - 1]; monotonic non-decreasing. */
  stageAt(elapsedSeconds: number, stages: number): number;
}

function shapeProgress(linear: number, shape: DifficultyRampShape): number {
  if (shape === "smoothstep") return linear * linear * (3 - 2 * linear);
  if (shape === "ease-out") return 1 - (1 - linear) * (1 - linear);
  return linear;
}

export function createDifficultyRamp(config: DifficultyRampConfig): DifficultyRamp {
  const { rampSeconds } = config;
  const startIntensity = config.startIntensity ?? 0;
  const maxIntensity = config.maxIntensity ?? 1;
  const shape = config.shape ?? "linear";
  if (!Number.isFinite(rampSeconds) || rampSeconds <= 0) {
    throw new RangeError("Difficulty ramp duration must be finite and positive");
  }
  if (!Number.isFinite(startIntensity) || !Number.isFinite(maxIntensity)) {
    throw new RangeError("Difficulty ramp intensities must be finite");
  }
  if (maxIntensity < startIntensity) {
    throw new RangeError("Difficulty ramp ceiling must not be below its start intensity");
  }

  const intensityAt = (elapsedSeconds: number): number => {
    if (!Number.isFinite(elapsedSeconds)) {
      throw new RangeError("Difficulty ramp elapsed seconds must be finite");
    }
    const linear = Math.min(1, Math.max(0, elapsedSeconds / rampSeconds));
    const progress = shapeProgress(linear, shape);
    return startIntensity + (maxIntensity - startIntensity) * progress;
  };

  return Object.freeze({
    rampSeconds,
    startIntensity,
    maxIntensity,
    shape,
    intensityAt,
    valueAt(elapsedSeconds: number, from: number, to: number): number {
      if (!Number.isFinite(from) || !Number.isFinite(to)) {
        throw new RangeError("Difficulty ramp value bounds must be finite");
      }
      const span = maxIntensity - startIntensity;
      const normalized = span === 0
        ? 1
        : (intensityAt(elapsedSeconds) - startIntensity) / span;
      return from + (to - from) * normalized;
    },
    stageAt(elapsedSeconds: number, stages: number): number {
      if (!Number.isInteger(stages) || stages < 1) {
        throw new RangeError("Difficulty ramp stages must be a positive integer");
      }
      const span = maxIntensity - startIntensity;
      const normalized = span === 0
        ? 1
        : (intensityAt(elapsedSeconds) - startIntensity) / span;
      return Math.min(stages - 1, Math.floor(normalized * stages));
    },
  });
}
