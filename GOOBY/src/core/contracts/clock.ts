/** Time is always expressed as Unix epoch milliseconds. */
export interface Clock {
  now(): number;
}

/** The sole production boundary allowed to read wall-clock time directly. */
export class RealClock implements Clock {
  now(): number {
    return Date.now();
  }
}

/** Deterministic clock for tests and the development debug surface. */
export class FakeClock implements Clock {
  public constructor(private value: number = 0) {}

  now(): number {
    return this.value;
  }

  set(epochMs: number): void {
    if (!Number.isFinite(epochMs)) throw new RangeError("Clock value must be finite");
    this.value = epochMs;
  }

  advance(durationMs: number): void {
    if (!Number.isFinite(durationMs) || durationMs < 0) {
      throw new RangeError("Clock can only advance by a finite, non-negative duration");
    }
    this.value += durationMs;
  }
}
