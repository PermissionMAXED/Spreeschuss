import type { Clock } from "../core/contracts/clock";
import type {
  MinigameModule,
  MinigamePayout,
} from "../core/contracts/minigame";
import type { RandomSource } from "../core/contracts/rng";
import type {
  GameScene,
  SceneContext,
} from "../core/contracts/scenes";

export class MinigameScene implements GameScene {
  readonly id;
  private mounted = false;
  private finished = false;
  private disposed = false;

  constructor(
    readonly module: MinigameModule,
    private readonly mountPoint: HTMLElement,
    private readonly clock: Clock,
    private readonly rng: RandomSource,
    private readonly onFinish: (payout: MinigamePayout) => void,
    private readonly advanceClock?: (durationMs: number) => void,
  ) {
    this.id = `minigame:${module.id}` as const;
  }

  async enter(context: SceneContext): Promise<void> {
    void context;
    if (this.disposed) throw new Error(`Cannot enter disposed minigame: ${this.module.id}`);
    this.mountPoint.hidden = false;
    await this.module.mount({
      clock: this.clock,
      rng: this.rng,
      mount: this.mountPoint,
      finish: (payout) => {
        if (this.finished || this.disposed) return;
        this.finished = true;
        this.onFinish(payout);
      },
    });
    const root = this.mountPoint.firstElementChild;
    if (!(root instanceof HTMLElement)) {
      throw new Error(`Minigame ${this.module.id} did not mount a root element`);
    }
    root.dataset.minigame = this.module.id;
    this.mounted = true;
    this.module.start();
  }

  update(deltaSeconds: number): void {
    if (this.mounted && !this.disposed) this.module.update(deltaSeconds);
  }

  resize(context: SceneContext): void {
    void context;
  }

  exit(): void {
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
      this.advanceClock?.(step);
      this.module.update(step / 1_000);
      remaining -= step;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.module.dispose();
    this.mountPoint.replaceChildren();
    this.mountPoint.hidden = true;
    this.mounted = false;
  }
}
