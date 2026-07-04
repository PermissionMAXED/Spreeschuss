// Simple synchronous event bus used across all game systems.
export class EventBus {
  constructor() {
    this.listeners = new Map();
  }

  on(event, cb) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event).add(cb);
    return () => this.off(event, cb);
  }

  off(event, cb) {
    const set = this.listeners.get(event);
    if (set) set.delete(cb);
  }

  emit(event, payload) {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const cb of [...set]) {
      try {
        cb(payload);
      } catch (err) {
        console.error(`[EventBus] listener for "${event}" threw:`, err);
      }
    }
  }
}

export const bus = new EventBus();
