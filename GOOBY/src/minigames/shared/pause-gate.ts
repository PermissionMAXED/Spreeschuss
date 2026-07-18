/**
 * Pause gate with exact restore semantics.
 *
 * Game loops route every frame delta through {@link PauseGate.filter}; while
 * paused the gate returns zero, so accumulators, countdowns, and ramps driven
 * by those deltas freeze in place and resume bit-exactly — no wall-clock time
 * leaks into the simulation across a pause of any length.
 *
 * No timers, no globals; listeners are explicit and fully cleared on dispose.
 */

export type PauseGateEvent =
  | { readonly kind: "paused" }
  | { readonly kind: "resumed" };

export type PauseGateListener = (event: PauseGateEvent) => void;

export class PauseGate {
  private pausedFlag = false;
  private pauses = 0;
  private resumes = 0;
  private readonly listeners = new Set<PauseGateListener>();

  get paused(): boolean {
    return this.pausedFlag;
  }

  get pauseCount(): number {
    return this.pauses;
  }

  get resumeCount(): number {
    return this.resumes;
  }

  /** Returns true when the gate transitioned to paused. Idempotent. */
  pause(): boolean {
    if (this.pausedFlag) return false;
    this.pausedFlag = true;
    this.pauses += 1;
    this.emit({ kind: "paused" });
    return true;
  }

  /** Returns true when the gate transitioned to running. Idempotent. */
  resume(): boolean {
    if (!this.pausedFlag) return false;
    this.pausedFlag = false;
    this.resumes += 1;
    this.emit({ kind: "resumed" });
    return true;
  }

  /**
   * Filters a frame delta: passes it through while running, and swallows it
   * entirely while paused so downstream simulation state stays frozen.
   */
  filter(frameSeconds: number): number {
    if (!Number.isFinite(frameSeconds) || frameSeconds < 0) {
      throw new RangeError("Pause gate frame delta must be finite and non-negative");
    }
    return this.pausedFlag ? 0 : frameSeconds;
  }

  /** Subscribes to pause/resume transitions. Returns the unsubscribe. */
  onChange(listener: PauseGateListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Clears every listener; the gate itself holds no other resources. */
  dispose(): void {
    this.listeners.clear();
  }

  private emit(event: PauseGateEvent): void {
    for (const listener of [...this.listeners]) listener(event);
  }
}
