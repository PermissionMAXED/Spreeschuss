import { describe, expect, it } from "vitest";
import { ArcadeCountdown, type CountdownEvent } from "./countdown";
import { FixedStepAccumulator } from "./fixed-step";
import { PauseGate } from "./pause-gate";

describe("pause gate", () => {
  it("passes deltas through while running and swallows them while paused", () => {
    const gate = new PauseGate();
    expect(gate.filter(0.016)).toBe(0.016);
    expect(gate.pause()).toBe(true);
    expect(gate.pause()).toBe(false);
    expect(gate.filter(0.016)).toBe(0);
    expect(gate.resume()).toBe(true);
    expect(gate.resume()).toBe(false);
    expect(gate.filter(0.016)).toBe(0.016);
    expect(gate.pauseCount).toBe(1);
    expect(gate.resumeCount).toBe(1);
    expect(() => gate.filter(-1)).toThrow(RangeError);
  });

  it("notifies listeners on transitions and clears them on dispose", () => {
    const gate = new PauseGate();
    const seen: string[] = [];
    const unsubscribe = gate.onChange((event) => seen.push(event.kind));
    gate.pause();
    gate.resume();
    unsubscribe();
    gate.pause();
    expect(seen).toEqual(["paused", "resumed"]);
    const disposedSeen: string[] = [];
    gate.onChange((event) => disposedSeen.push(event.kind));
    gate.dispose();
    gate.resume();
    expect(disposedSeen).toEqual([]);
  });

  it("restores simulation state exactly across a pause of any length", () => {
    const events: string[] = [];
    const feedback = (event: CountdownEvent): void => {
      events.push(event.kind === "tick" ? String(event.value) : "go");
    };

    const runRound = (pauseAtFrame: number | null, pausedFrames: number): {
      readonly position: number;
      readonly steps: number;
      readonly events: string[];
    } => {
      events.length = 0;
      const gate = new PauseGate();
      const accumulator = new FixedStepAccumulator({ stepSeconds: 1 / 120 });
      const countdown = new ArcadeCountdown({ seconds: 3, feedback });
      countdown.start();
      let position = 0;
      const frameSeconds = 1 / 60;
      let activeFrames = 0;
      let frame = 0;
      while (activeFrames < 600) {
        if (pauseAtFrame !== null && frame === pauseAtFrame) {
          gate.pause();
          for (let idle = 0; idle < pausedFrames; idle += 1) {
            const dt = gate.filter(frameSeconds);
            countdown.update(dt);
            accumulator.advance(dt, () => {
              position += 1;
            });
          }
          gate.resume();
        }
        const dt = gate.filter(frameSeconds);
        countdown.update(dt);
        accumulator.advance(dt, (stepDt) => {
          position += (5 - position) * 0.9 * stepDt;
        });
        activeFrames += 1;
        frame += 1;
      }
      return { position, steps: accumulator.stepCount, events: [...events] };
    };

    const uninterrupted = runRound(null, 0);
    const shortPause = runRound(120, 30);
    const longPause = runRound(120, 100_000);

    expect(shortPause.steps).toBe(uninterrupted.steps);
    expect(longPause.steps).toBe(uninterrupted.steps);
    // Bit-exact: the paused frames contributed zero simulated time.
    expect(shortPause.position).toBe(uninterrupted.position);
    expect(longPause.position).toBe(uninterrupted.position);
    expect(shortPause.events).toEqual(uninterrupted.events);
    expect(longPause.events).toEqual(uninterrupted.events);
  });
});
