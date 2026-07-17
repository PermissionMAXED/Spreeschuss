import type { GameScene, SceneContext, SceneId } from "./contracts/scenes";

export type SceneFactory = () => GameScene;

export class SceneManager {
  private current: GameScene | null = null;
  private transition = Promise.resolve();

  constructor(
    private readonly registry: ReadonlyMap<SceneId, SceneFactory>,
    private context: SceneContext,
  ) {}

  get activeId(): SceneId | null {
    return this.current?.id ?? null;
  }

  goTo(id: SceneId): Promise<void> {
    this.transition = this.transition.then(async () => {
      const factory = this.registry.get(id);
      if (!factory) throw new Error(`Scene is not registered: ${id}`);
      const previous = this.current;
      this.current = null;
      if (previous) {
        await previous.exit();
        previous.dispose();
      }
      const next = factory();
      try {
        await next.enter(this.context);
        this.current = next;
      } catch (error) {
        next.dispose();
        throw error;
      }
    });
    return this.transition;
  }

  update(deltaSeconds: number): void {
    this.current?.update(deltaSeconds);
  }

  resize(context: SceneContext): void {
    this.context = context;
    this.current?.resize(context);
  }

  async dispose(): Promise<void> {
    await this.transition;
    if (!this.current) return;
    await this.current.exit();
    this.current.dispose();
    this.current = null;
  }
}
