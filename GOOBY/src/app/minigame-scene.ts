import type { Clock } from "../core/contracts/clock";
import {
  createMinigameLifecycle,
  type MinigameFeedback,
  type MinigameFeedbackEvent,
  type MinigameLifecycle,
  type MinigameModule,
  type MinigamePayout,
  type MinigameRunId,
  type MinigameSettlementPersistence,
  type MinigameSettlementReceipt,
} from "../core/contracts/minigame";
import type { HapticPattern } from "../core/contracts/platform";
import type { RandomSource } from "../core/contracts/rng";
import type {
  GameScene,
  SceneContext,
} from "../core/contracts/scenes";

export interface SharedMinigameServices {
  readonly feedback: MinigameFeedback;
  readonly audio: {
    emit(action: "hit" | "miss" | "combo" | "countdown" | "go" | "win" | "lose" | "score", value?: number): void;
  };
  readonly haptics: {
    impact(pattern: HapticPattern): void;
  };
  readonly bestScore: number;
  readonly reducedMotion: boolean;
}

export interface MinigameSceneOptions {
  readonly persistence: MinigameSettlementPersistence;
  readonly feedback: MinigameFeedback;
  readonly audio: SharedMinigameServices["audio"];
  readonly haptics: SharedMinigameServices["haptics"];
  readonly reducedMotion: boolean;
  readonly onSettled: (receipt: MinigameSettlementReceipt) => void | Promise<void>;
  readonly advanceClock?: (durationMs: number) => void;
}

export class MinigameScene implements GameScene {
  readonly id;
  readonly lifecycle: MinigameLifecycle;
  private mounted = false;
  private finished = false;
  private disposed = false;
  private runId: MinigameRunId | null = null;

  constructor(
    readonly module: MinigameModule,
    private readonly mountPoint: HTMLElement,
    private readonly clock: Clock,
    private readonly rng: RandomSource,
    private readonly options: MinigameSceneOptions,
  ) {
    this.id = `minigame:${module.id}` as const;
    this.lifecycle = createMinigameLifecycle(
      module.id,
      clock,
      options.persistence,
      {
        emit: (event) => {
          options.feedback.emit(event);
          if (event.kind === "run-completed") this.handleCompleted(event);
        },
      },
    );
  }

  async enter(context: SceneContext): Promise<void> {
    void context;
    if (this.disposed) throw new Error(`Cannot enter disposed minigame: ${this.module.id}`);
    this.mountPoint.hidden = false;
    this.beginRun();
    const shared: SharedMinigameServices = {
      feedback: this.lifecycle.feedback,
      audio: this.options.audio,
      haptics: this.options.haptics,
      bestScore: this.lifecycle.persistedBest,
      reducedMotion: this.options.reducedMotion,
    };
    const minigameContext = {
      clock: this.clock,
      rng: this.rng,
      mount: this.mountPoint,
      lifecycle: this.lifecycle,
      finish: (payout: MinigamePayout) => {
        if (this.disposed) return;
        this.completeRun(payout);
      },
      ...shared,
    };
    await this.module.mount(minigameContext);
    const root = this.mountPoint.firstElementChild;
    if (!(root instanceof HTMLElement)) {
      throw new Error(`Minigame ${this.module.id} did not mount a root element`);
    }
    root.dataset.minigame = this.module.id;
    this.mounted = true;
    this.module.start();
  }

  beginRun(): MinigameRunId {
    if (this.disposed) throw new Error(`Cannot begin a disposed minigame: ${this.module.id}`);
    this.finished = false;
    this.runId = this.lifecycle.beginRun();
    return this.runId;
  }

  completeRun(payout: MinigamePayout): MinigameSettlementReceipt {
    if (!this.runId) throw new Error("Cannot complete a minigame before beginning its run");
    return this.lifecycle.completeRun(this.runId, payout);
  }

  update(deltaSeconds: number): void {
    if (this.mounted && !this.disposed) this.module.update(deltaSeconds);
  }

  resize(context: SceneContext): void {
    void context;
  }

  exit(): void {
    this.lifecycle.exit();
    if (this.mounted && !this.finished) this.module.pause();
  }

  pause(): void {
    if (this.mounted && !this.finished) this.module.pause();
  }

  resume(): void {
    if (this.mounted && !this.finished) this.module.resume();
  }

  advanceForTest(durationMs: number): void {
    if (!Number.isFinite(durationMs) || durationMs < 0) {
      throw new RangeError("Minigame test advance must be finite and non-negative");
    }
    let remaining = durationMs;
    while (remaining > 0 && !this.disposed && !this.finished) {
      const step = Math.min(50, remaining);
      this.options.advanceClock?.(step);
      this.module.update(step / 1_000);
      remaining -= step;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.lifecycle.exit();
    this.module.dispose();
    this.mountPoint.replaceChildren();
    this.mountPoint.hidden = true;
    this.mounted = false;
  }

  private handleCompleted(event: Extract<MinigameFeedbackEvent, { readonly kind: "run-completed" }>): void {
    if (this.finished || this.disposed) return;
    this.finished = true;
    this.module.pause();
    void Promise.resolve(this.options.onSettled(event.receipt));
  }
}
