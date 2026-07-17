import type { Economy } from "./economy";
import type { NeedKey, SimulationState } from "./simulation";

export interface GameEvents {
  "state:changed": { simulation: SimulationState; economy: Economy };
  "need:changed": { need: NeedKey; value: number };
  "gooby:reaction": { kind: "pet" | "tickle" | "poke" | "feed" | "sleep" | "wake" };
  "route:changed": { routeId: string };
  "save:committed": { revision: number };
  "toast": { message: string };
}

type Handler<Payload> = (payload: Payload) => void;

export class EventBus<Events extends object> {
  private readonly handlers = new Map<keyof Events, Set<Handler<Events[keyof Events]>>>();

  on<Key extends keyof Events>(event: Key, handler: Handler<Events[Key]>): () => void {
    const handlers = this.handlers.get(event) ?? new Set();
    handlers.add(handler as Handler<Events[keyof Events]>);
    this.handlers.set(event, handlers);
    return () => {
      handlers.delete(handler as Handler<Events[keyof Events]>);
    };
  }

  emit<Key extends keyof Events>(event: Key, payload: Events[Key]): void {
    for (const handler of this.handlers.get(event) ?? []) handler(payload);
  }

  clear(): void {
    this.handlers.clear();
  }
}
