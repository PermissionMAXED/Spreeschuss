import { describe, expect, it } from "vitest";
import { EventBus } from "../core/contracts/events";
import type { HapticPattern, HapticsPort } from "../core/contracts/platform";
import type { AudioEvents } from "../audio/contracts";
import {
  HAPTIC_PATTERNS,
  HapticDirector,
  NoopWebHaptics,
  POLISH_HAPTIC_PATTERNS,
  hapticForAudioEvent,
  type HapticScheduler,
} from "./index";

class SpyHaptics implements HapticsPort {
  readonly impacts: HapticPattern[] = [];

  impact(pattern: HapticPattern): Promise<void> {
    this.impacts.push(pattern);
    return Promise.resolve();
  }
}

interface ScheduledTask {
  readonly delayMs: number;
  readonly callback: () => void;
  cancelled: boolean;
}

class ManualScheduler implements HapticScheduler {
  readonly tasks: ScheduledTask[] = [];

  schedule(delayMs: number, callback: () => void): unknown {
    const task = { delayMs, callback, cancelled: false };
    this.tasks.push(task);
    return task;
  }

  cancel(token: unknown): void {
    (token as ScheduledTask).cancelled = true;
  }

  runAll(): void {
    this.tasks.sort((left, right) => left.delayMs - right.delayMs);
    for (const task of this.tasks) if (!task.cancelled) task.callback();
  }
}

describe("haptic patterns", () => {
  it("defines complete, non-empty light/success/warning/tension/combo patterns", () => {
    expect(Object.keys(HAPTIC_PATTERNS).sort()).toEqual([...POLISH_HAPTIC_PATTERNS].sort());
    for (const pattern of POLISH_HAPTIC_PATTERNS) {
      expect(HAPTIC_PATTERNS[pattern].length, pattern).toBeGreaterThan(0);
      expect(HAPTIC_PATTERNS[pattern][0]?.atMs, pattern).toBe(0);
    }
  });

  it("plays timed pulses and cancels outstanding tension when muted", () => {
    const driver = new SpyHaptics();
    const scheduler = new ManualScheduler();
    const director = new HapticDirector(driver, scheduler);

    director.play("combo");
    scheduler.runAll();
    expect(driver.impacts).toEqual(["light", "medium", "success"]);

    director.play("tension");
    director.setMuted(true);
    scheduler.runAll();
    expect(driver.impacts.at(-1)).toBe("light");
    director.play("warning");
    expect(driver.impacts.at(-1)).toBe("light");
  });

  it("provides a resolving no-op browser fallback", async () => {
    await expect(new NoopWebHaptics().impact("success")).resolves.toBeUndefined();
  });
});

describe("event-driven haptics", () => {
  it("maps care, economy, driving, and all minigame feedback", () => {
    expect(hapticForAudioEvent("audio:gooby", { action: "tickle" })).toBe("combo");
    expect(hapticForAudioEvent("audio:gooby", { action: "bathe" })).toBe("success");
    expect(hapticForAudioEvent("audio:economy", { action: "purchase" })).toBe("success");
    expect(hapticForAudioEvent("audio:car", { action: "skid" })).toBe("tension");
    expect(hapticForAudioEvent("audio:car", { action: "engine-loop" })).toBeNull();
    expect(hapticForAudioEvent("audio:minigame", { action: "hit" })).toBe("light");
    expect(hapticForAudioEvent("audio:minigame", { action: "miss" })).toBe("warning");
    expect(hapticForAudioEvent("audio:minigame", { action: "combo", combo: 5 })).toBe("combo");
    expect(hapticForAudioEvent("audio:minigame", { action: "win" })).toBe("success");
  });

  it("binds typed events and honors shared mute transitions", () => {
    const driver = new SpyHaptics();
    const scheduler = new ManualScheduler();
    const director = new HapticDirector(driver, scheduler);
    const events = new EventBus<AudioEvents>();
    director.bindAudioEvents(events);

    events.emit("audio:ui", { action: "tap" });
    events.emit("audio:mute", { muted: true });
    events.emit("audio:minigame", { action: "win", score: 12 });
    events.emit("audio:mute", { muted: false });
    events.emit("audio:economy", { action: "coin", amount: 4 });
    expect(driver.impacts).toEqual(["light", "light"]);
  });
});
