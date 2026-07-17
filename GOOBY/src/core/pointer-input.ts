import type { Clock } from "./contracts/clock";
import type { Gesture, GestureHandler, InputPort } from "./contracts/input";

interface PointerStart {
  readonly x: number;
  readonly y: number;
  readonly at: number;
}

export class PointerInput implements InputPort {
  private readonly handlers = new Set<GestureHandler>();
  private readonly starts = new Map<number, PointerStart>();
  private enabled = true;
  private lastTapAt = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly target: HTMLElement,
    private readonly clock: Clock,
  ) {
    target.addEventListener("pointerdown", this.onPointerDown);
    target.addEventListener("pointermove", this.onPointerMove);
    target.addEventListener("pointerup", this.onPointerUp);
    target.addEventListener("pointercancel", this.onPointerCancel);
  }

  subscribe(handler: GestureHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.starts.clear();
  }

  private emit(gesture: Gesture): void {
    for (const handler of this.handlers) handler(gesture);
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (!this.enabled) return;
    event.preventDefault();
    this.target.setPointerCapture(event.pointerId);
    const start = { x: event.clientX, y: event.clientY, at: this.clock.now() };
    this.starts.set(event.pointerId, start);
    this.emit({ type: "press-start", x: start.x, y: start.y });
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    const start = this.starts.get(event.pointerId);
    if (!this.enabled || !start) return;
    event.preventDefault();
    this.emit({
      type: "press-move",
      x: event.clientX,
      y: event.clientY,
      dx: event.clientX - start.x,
      dy: event.clientY - start.y,
    });
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    const start = this.starts.get(event.pointerId);
    if (!this.enabled || !start) return;
    event.preventDefault();
    this.starts.delete(event.pointerId);
    const now = this.clock.now();
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    const distance = Math.hypot(dx, dy);
    const durationMs = now - start.at;
    this.emit({ type: "press-end", x: event.clientX, y: event.clientY, durationMs });
    if (distance > 40) {
      this.emit({ type: "swipe", x: event.clientX, y: event.clientY, dx, dy });
      return;
    }
    const doubleTap = now - this.lastTapAt < 320;
    this.lastTapAt = now;
    this.emit({ type: doubleTap ? "double-tap" : "tap", x: event.clientX, y: event.clientY });
  };

  private readonly onPointerCancel = (event: PointerEvent): void => {
    this.starts.delete(event.pointerId);
  };

  dispose(): void {
    this.target.removeEventListener("pointerdown", this.onPointerDown);
    this.target.removeEventListener("pointermove", this.onPointerMove);
    this.target.removeEventListener("pointerup", this.onPointerUp);
    this.target.removeEventListener("pointercancel", this.onPointerCancel);
    this.handlers.clear();
    this.starts.clear();
  }
}
