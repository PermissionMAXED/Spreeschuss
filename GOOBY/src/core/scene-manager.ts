import type { GameScene, SceneContext, SceneId } from "./contracts/scenes";

export type SceneFactory = () => GameScene;

export class SceneManager {
  private current: GameScene | null = null;
  private queueTail: Promise<void> = Promise.resolve();
  private disposalRequested = false;
  private disposal: Promise<void> | null = null;

  constructor(
    private readonly registry: ReadonlyMap<SceneId, SceneFactory>,
    private context: SceneContext,
  ) {}

  get activeId(): SceneId | null {
    return this.current?.id ?? null;
  }

  goTo(id: SceneId): Promise<void> {
    if (this.disposalRequested) {
      return this.enqueue(() => {
        throw new Error("Scene manager is disposed");
      });
    }
    return this.enqueue(() => this.transitionTo(id));
  }

  update(deltaSeconds: number): void {
    this.current?.update(deltaSeconds);
  }

  resize(context: SceneContext): void {
    this.context = context;
    this.current?.resize(context);
  }

  dispose(): Promise<void> {
    if (this.disposal) return this.disposal;
    this.disposalRequested = true;
    this.disposal = this.enqueue(async () => {
      const current = this.current;
      this.current = null;
      if (current) await this.exitAndDispose(current);
    });
    return this.disposal;
  }

  private enqueue(operation: () => void | Promise<void>): Promise<void> {
    const result = this.queueTail.then(operation);
    this.queueTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async transitionTo(id: SceneId): Promise<void> {
    const factory = this.registry.get(id);
    if (!factory) throw new Error(`Scene is not registered: ${id}`);

    const previous = this.current;
    this.current = null;
    if (previous) await this.exitAndDispose(previous);

    const next = factory();
    try {
      await next.enter(this.context);
      this.current = next;
    } catch (error) {
      try {
        next.dispose();
      } catch (disposeError) {
        throw new AggregateError(
          [error, disposeError],
          `Scene ${next.id} failed to enter and dispose`,
          { cause: disposeError },
        );
      }
      throw error;
    }
  }

  private async exitAndDispose(scene: GameScene): Promise<void> {
    let exitFailed = false;
    let exitError: unknown;
    try {
      await scene.exit();
    } catch (error) {
      exitFailed = true;
      exitError = error;
    }

    try {
      scene.dispose();
    } catch (disposeError) {
      if (exitFailed) {
        throw new AggregateError(
          [exitError, disposeError],
          `Scene ${scene.id} failed to exit and dispose`,
          { cause: disposeError },
        );
      }
      throw disposeError;
    }

    if (exitFailed) throw exitError;
  }
}
