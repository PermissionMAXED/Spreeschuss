import { describe, expect, it } from "vitest";
import { ArcadeCountdown, type CountdownEvent } from "./countdown";

function collectEvents(): { events: string[]; feedback: (event: CountdownEvent) => void } {
  const events: string[] = [];
  return {
    events,
    feedback: (event) => {
      events.push(event.kind === "tick" ? `${event.cue}:${event.value}` : event.cue);
    },
  };
}

function runCountdown(frameSeconds: number, frames: number): string[] {
  const { events, feedback } = collectEvents();
  const countdown = new ArcadeCountdown({ seconds: 3, feedback });
  countdown.start();
  for (let frame = 0; frame < frames; frame += 1) countdown.update(frameSeconds);
  return events;
}

describe("arcade countdown", () => {
  it("emits typed countdown ticks and exactly one go", () => {
    const { events, feedback } = collectEvents();
    const countdown = new ArcadeCountdown({ seconds: 3, feedback });
    expect(countdown.displayValue).toBe(3);
    countdown.start();
    expect(events).toEqual(["countdown:3"]);
    countdown.update(1);
    expect(events).toEqual(["countdown:3", "countdown:2"]);
    expect(countdown.displayValue).toBe(2);
    countdown.update(1);
    expect(events).toEqual(["countdown:3", "countdown:2", "countdown:1"]);
    countdown.update(1);
    expect(events).toEqual(["countdown:3", "countdown:2", "countdown:1", "go"]);
    expect(countdown.done).toBe(true);
    expect(countdown.displayValue).toBe(0);
    countdown.update(5);
    expect(events).toHaveLength(4);
  });

  it("is deterministic across 30/60/120 Hz partitions", () => {
    const at30 = runCountdown(1 / 30, 4 * 30);
    const at60 = runCountdown(1 / 60, 4 * 60);
    const at120 = runCountdown(1 / 120, 4 * 120);
    expect(at30).toEqual(["countdown:3", "countdown:2", "countdown:1", "go"]);
    expect(at60).toEqual(at30);
    expect(at120).toEqual(at30);
  });

  it("does not advance before start and validates inputs", () => {
    const { events, feedback } = collectEvents();
    const countdown = new ArcadeCountdown({ seconds: 2, feedback });
    countdown.update(10);
    expect(events).toEqual([]);
    expect(countdown.running).toBe(false);
    countdown.start();
    countdown.start();
    expect(events).toEqual(["countdown:2"]);
    expect(countdown.running).toBe(true);
    expect(() => countdown.update(-0.1)).toThrow(RangeError);
    expect(() => new ArcadeCountdown({ seconds: 0, feedback })).toThrow(RangeError);
    expect(() => new ArcadeCountdown({ seconds: 1.5, feedback })).toThrow(RangeError);
  });

  it("restores snapshots without replaying feedback", () => {
    const { events, feedback } = collectEvents();
    const countdown = new ArcadeCountdown({ seconds: 3, feedback });
    countdown.start();
    countdown.update(1.4);
    const snapshot = countdown.snapshot();
    const emittedBefore = events.length;
    countdown.reset();
    expect(countdown.started).toBe(false);
    countdown.restore(snapshot);
    expect(events).toHaveLength(emittedBefore);
    expect(countdown.remainingSeconds).toBeCloseTo(1.6, 10);
    countdown.update(1.6);
    expect(events.at(-1)).toBe("go");
    expect(() => countdown.restore({ ...snapshot, emittedTicks: 99 })).toThrow(RangeError);
    expect(() => countdown.restore({ ...snapshot, elapsedSeconds: -1 })).toThrow(RangeError);
  });
});
