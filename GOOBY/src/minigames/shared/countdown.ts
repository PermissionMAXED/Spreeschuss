/**
 * Pre-round countdown that advances only through injected frame deltas and
 * emits typed feedback events aligned with the shared minigame audio cues
 * (`countdown` ticks followed by exactly one `go`).
 *
 * No timers, no globals: pausing simply means not calling {@link update}, so
 * pause/resume restores are exact by construction.
 */
import type { MinigameAudioCue } from "../../core/contracts/minigame";

export type CountdownCue = Extract<MinigameAudioCue, "countdown" | "go">;

export type CountdownEvent =
  | { readonly kind: "tick"; readonly cue: "countdown"; readonly value: number }
  | { readonly kind: "go"; readonly cue: "go" };

export type CountdownFeedback = (event: CountdownEvent) => void;

export interface CountdownOptions {
  /** Whole seconds counted down before "go". Defaults to 3. */
  readonly seconds?: number;
  readonly feedback: CountdownFeedback;
}

/** Serializable countdown state used for exact pause/resume restores. */
export interface CountdownSnapshot {
  readonly elapsedSeconds: number;
  readonly emittedTicks: number;
  readonly emittedGo: boolean;
  readonly started: boolean;
}

const DEFAULT_SECONDS = 3;
const BOUNDARY_EPSILON_SECONDS = 1e-9;

export class ArcadeCountdown {
  readonly seconds: number;
  private readonly feedback: CountdownFeedback;
  private elapsed = 0;
  private emittedTicks = 0;
  private emittedGo = false;
  private startedFlag = false;

  constructor(options: CountdownOptions) {
    const seconds = options.seconds ?? DEFAULT_SECONDS;
    if (!Number.isInteger(seconds) || seconds < 1) {
      throw new RangeError("Countdown seconds must be a positive integer");
    }
    this.seconds = seconds;
    this.feedback = options.feedback;
  }

  get started(): boolean {
    return this.startedFlag;
  }

  get done(): boolean {
    return this.emittedGo;
  }

  get running(): boolean {
    return this.startedFlag && !this.emittedGo;
  }

  /** Whole seconds currently displayed, e.g. 3 → 2 → 1; 0 once "go" fired. */
  get displayValue(): number {
    if (this.emittedGo) return 0;
    if (!this.startedFlag || this.emittedTicks === 0) return this.seconds;
    return this.seconds - this.emittedTicks + 1;
  }

  get remainingSeconds(): number {
    return Math.max(0, this.seconds - this.elapsed);
  }

  /** Emits the first tick (full value) immediately. Idempotent. */
  start(): void {
    if (this.startedFlag) return;
    this.startedFlag = true;
    this.emitNextTick();
  }

  /**
   * Advances the countdown. Emits one tick per crossed whole-second boundary
   * and exactly one "go" once the full duration elapsed. Deterministic across
   * any partition of the same total time.
   */
  update(deltaSeconds: number): void {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) {
      throw new RangeError("Countdown delta must be finite and non-negative");
    }
    if (!this.startedFlag || this.emittedGo) return;
    this.elapsed += deltaSeconds;
    while (
      this.emittedTicks < this.seconds &&
      this.elapsed >= this.emittedTicks - BOUNDARY_EPSILON_SECONDS
    ) {
      this.emitNextTick();
    }
    if (this.elapsed >= this.seconds - BOUNDARY_EPSILON_SECONDS) {
      this.emittedGo = true;
      this.feedback({ kind: "go", cue: "go" });
    }
  }

  snapshot(): CountdownSnapshot {
    return {
      elapsedSeconds: this.elapsed,
      emittedTicks: this.emittedTicks,
      emittedGo: this.emittedGo,
      started: this.startedFlag,
    };
  }

  /** Restores a snapshot exactly without re-emitting past feedback. */
  restore(snapshot: CountdownSnapshot): void {
    if (!Number.isFinite(snapshot.elapsedSeconds) || snapshot.elapsedSeconds < 0) {
      throw new RangeError("Countdown snapshot elapsed must be finite and non-negative");
    }
    if (
      !Number.isInteger(snapshot.emittedTicks) ||
      snapshot.emittedTicks < 0 ||
      snapshot.emittedTicks > this.seconds
    ) {
      throw new RangeError("Countdown snapshot ticks are out of range");
    }
    this.elapsed = snapshot.elapsedSeconds;
    this.emittedTicks = snapshot.emittedTicks;
    this.emittedGo = snapshot.emittedGo;
    this.startedFlag = snapshot.started;
  }

  reset(): void {
    this.elapsed = 0;
    this.emittedTicks = 0;
    this.emittedGo = false;
    this.startedFlag = false;
  }

  private emitNextTick(): void {
    const value = this.seconds - this.emittedTicks;
    this.emittedTicks += 1;
    this.feedback({ kind: "tick", cue: "countdown", value });
  }
}
