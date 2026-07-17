import type { MinigameContext, MinigameModule, MinigamePayout } from "../core/contracts/minigame";
import type { MinigameId } from "../core/contracts/scenes";

export interface MinigameStubDefinition {
  readonly id: MinigameId;
  readonly title: string;
  readonly instructions: string;
}

export class SpecialistMinigameStub implements MinigameModule {
  private host: HTMLElement | null = null;
  private running = false;
  private score = 0;

  constructor(private readonly definition: MinigameStubDefinition) {}

  get id(): MinigameId {
    return this.definition.id;
  }

  get title(): string {
    return this.definition.title;
  }

  get instructions(): string {
    return this.definition.instructions;
  }

  mount(context: MinigameContext): void {
    this.host = document.createElement("section");
    this.host.className = "minigame-stub";
    this.host.textContent = `${this.title} — specialist module reserved`;
    context.mount.replaceChildren(this.host);
  }

  start(): void {
    this.running = true;
  }

  pause(): void {
    this.running = false;
  }

  resume(): void {
    this.running = true;
  }

  update(deltaSeconds: number): void {
    if (this.running) this.score += deltaSeconds * 10;
  }

  payout(): MinigamePayout {
    const score = Math.floor(this.score);
    return { score, coins: Math.floor(score / 20), xp: Math.floor(score / 10) };
  }

  dispose(): void {
    this.host?.remove();
    this.host = null;
    this.running = false;
  }
}
