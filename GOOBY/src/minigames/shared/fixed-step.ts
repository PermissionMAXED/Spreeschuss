/**
 * Deterministic fixed-step simulation accumulator.
 *
 * Frame deltas from any refresh rate (30/60/120 Hz or irregular mixes) are
 * folded into an accumulator and drained as identical fixed-size steps, so a
 * simulation that only mutates state inside the step callback produces
 * bit-identical results for every partition of the same total time.
 *
 * This module is intentionally free of runtime imports so it can be loaded by
 * both Vite bundles and the node `--experimental-strip-types` specialist test
 * runner.
 */

/** Guards float drift when frame deltas are exact multiples of the step. */
const STEP_EPSILON_SECONDS = 1e-9;

export interface FixedStepOptions {
  /** Simulation step size in seconds. Defaults to 1/120 s. */
  readonly stepSeconds?: number;
  /**
   * Longest frame delta accepted per {@link FixedStepAccumulator.advance}
   * call. Larger deltas (tab switches, debugger pauses) are clamped so the
   * simulation never spirals. Defaults to 0.25 s.
   */
  readonly maxFrameSeconds?: number;
}

/** Serializable accumulator state used for exact pause/resume restores. */
export interface FixedStepSnapshot {
  readonly pendingSeconds: number;
  readonly stepCount: number;
  readonly simulatedSeconds: number;
}

export type FixedStepCallback = (stepSeconds: number, stepIndex: number) => void;

const DEFAULT_STEP_SECONDS = 1 / 120;
const DEFAULT_MAX_FRAME_SECONDS = 0.25;

function assertFiniteNonNegative(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${label} must be finite and non-negative`);
  }
}

export class FixedStepAccumulator {
  readonly stepSeconds: number;
  readonly maxFrameSeconds: number;
  private pending = 0;
  private steps = 0;

  constructor(options: FixedStepOptions = {}) {
    const step = options.stepSeconds ?? DEFAULT_STEP_SECONDS;
    const maxFrame = options.maxFrameSeconds ?? DEFAULT_MAX_FRAME_SECONDS;
    if (!Number.isFinite(step) || step <= 0) {
      throw new RangeError("Fixed step size must be finite and positive");
    }
    if (!Number.isFinite(maxFrame) || maxFrame < step) {
      throw new RangeError("Max frame seconds must be finite and at least one step");
    }
    this.stepSeconds = step;
    this.maxFrameSeconds = maxFrame;
  }

  /** Seconds accumulated but not yet drained as a full step. */
  get pendingSeconds(): number {
    return this.pending;
  }

  /** Total fixed steps executed since construction or the last reset. */
  get stepCount(): number {
    return this.steps;
  }

  /** Total simulated seconds (stepCount × stepSeconds). */
  get simulatedSeconds(): number {
    return this.steps * this.stepSeconds;
  }

  /** Interpolation fraction of the next step already accumulated, in [0, 1). */
  get alpha(): number {
    return Math.min(1, Math.max(0, this.pending / this.stepSeconds));
  }

  /**
   * Folds one rendered frame into the accumulator and runs the fixed-step
   * callback once per drained step. Returns the number of steps executed.
   */
  advance(frameSeconds: number, step: FixedStepCallback): number {
    assertFiniteNonNegative(frameSeconds, "Frame delta");
    this.pending += Math.min(frameSeconds, this.maxFrameSeconds);
    let executed = 0;
    while (this.pending >= this.stepSeconds - STEP_EPSILON_SECONDS) {
      this.pending = Math.max(0, this.pending - this.stepSeconds);
      step(this.stepSeconds, this.steps);
      this.steps += 1;
      executed += 1;
    }
    return executed;
  }

  /** Captures the exact accumulator state, e.g. right before pausing. */
  snapshot(): FixedStepSnapshot {
    return {
      pendingSeconds: this.pending,
      stepCount: this.steps,
      simulatedSeconds: this.simulatedSeconds,
    };
  }

  /** Restores a snapshot exactly; the next advance continues where it left off. */
  restore(snapshot: FixedStepSnapshot): void {
    assertFiniteNonNegative(snapshot.pendingSeconds, "Snapshot pending seconds");
    if (!Number.isInteger(snapshot.stepCount) || snapshot.stepCount < 0) {
      throw new RangeError("Snapshot step count must be a non-negative integer");
    }
    this.pending = snapshot.pendingSeconds;
    this.steps = snapshot.stepCount;
  }

  reset(): void {
    this.pending = 0;
    this.steps = 0;
  }
}
