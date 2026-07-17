import type { EventBus, GameEvents } from "../core/contracts/events";
import type { HapticPattern, HapticsPort } from "../core/contracts/platform";
import type { AudioEvents } from "../audio/contracts";

export const POLISH_HAPTIC_PATTERNS = ["light", "success", "warning", "tension", "combo"] as const;
export type PolishHapticPattern = (typeof POLISH_HAPTIC_PATTERNS)[number];

export interface HapticPulse {
  readonly atMs: number;
  readonly impact: HapticPattern;
}

export const HAPTIC_PATTERNS: Readonly<Record<PolishHapticPattern, readonly HapticPulse[]>> = {
  light: [{ atMs: 0, impact: "light" }],
  success: [
    { atMs: 0, impact: "light" },
    { atMs: 70, impact: "success" },
  ],
  warning: [
    { atMs: 0, impact: "warning" },
    { atMs: 145, impact: "medium" },
  ],
  tension: [
    { atMs: 0, impact: "light" },
    { atMs: 105, impact: "light" },
    { atMs: 190, impact: "medium" },
    { atMs: 255, impact: "medium" },
  ],
  combo: [
    { atMs: 0, impact: "light" },
    { atMs: 55, impact: "medium" },
    { atMs: 105, impact: "success" },
  ],
};

export interface HapticScheduler {
  schedule(delayMs: number, callback: () => void): unknown;
  cancel(token: unknown): void;
}

class TimerHapticScheduler implements HapticScheduler {
  schedule(delayMs: number, callback: () => void): unknown {
    return setTimeout(callback, delayMs);
  }

  cancel(token: unknown): void {
    clearTimeout(token as ReturnType<typeof setTimeout>);
  }
}

/** Browser fallback intentionally does nothing; web play never requires vibration permission. */
export class NoopWebHaptics implements HapticsPort {
  impact(pattern: HapticPattern): Promise<void> {
    void pattern;
    return Promise.resolve();
  }
}

export function hapticForAudioEvent<Key extends keyof AudioEvents>(
  event: Key,
  payload: AudioEvents[Key],
): PolishHapticPattern | null {
  if (event === "audio:ui") {
    const action = (payload as AudioEvents["audio:ui"]).action;
    if (action === "denied") return "warning";
    if (action === "confirm") return "success";
    return action === "tap" || action === "open" || action === "close" || action === "back" ? "light" : null;
  }
  if (event === "audio:gooby") {
    const action = (payload as AudioEvents["audio:gooby"]).action;
    if (action === "feed" || action === "bathe" || action === "wake") return "success";
    if (action === "tickle") return "combo";
    return "light";
  }
  if (event === "audio:economy") {
    return (payload as AudioEvents["audio:economy"]).action === "purchase" ? "success" : "light";
  }
  if (event === "audio:car") {
    const action = (payload as AudioEvents["audio:car"]).action;
    if (action === "recovery") return "warning";
    if (action === "skid") return "tension";
    if (action === "pickup") return "success";
    return action === "brake" || action === "engine-start" ? "light" : null;
  }
  if (event === "audio:minigame") {
    const action = (payload as AudioEvents["audio:minigame"]).action;
    if (action === "combo") return "combo";
    if (action === "miss" || action === "lose") return "warning";
    if (action === "win" || action === "go") return "success";
    if (action === "countdown") return "tension";
    return action === "hit" || action === "score" ? "light" : null;
  }
  return null;
}

export class HapticDirector {
  private readonly pending: unknown[] = [];
  private readonly removeListeners: Array<() => void> = [];
  private muted = false;

  constructor(
    private readonly driver: HapticsPort = new NoopWebHaptics(),
    private readonly scheduler: HapticScheduler = new TimerHapticScheduler(),
  ) {}

  get isMuted(): boolean {
    return this.muted;
  }

  play(pattern: PolishHapticPattern): void {
    if (this.muted) return;
    this.cancelPending();
    for (const pulse of HAPTIC_PATTERNS[pattern]) {
      if (pulse.atMs === 0) {
        void this.driver.impact(pulse.impact).catch(() => undefined);
      } else {
        this.pending.push(this.scheduler.schedule(pulse.atMs, () => {
          if (!this.muted) void this.driver.impact(pulse.impact).catch(() => undefined);
        }));
      }
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (muted) this.cancelPending();
  }

  bindAudioEvents(bus: EventBus<AudioEvents>): () => void {
    const removers = [
      bus.on("audio:ui", (payload) => this.playMapped("audio:ui", payload)),
      bus.on("audio:gooby", (payload) => this.playMapped("audio:gooby", payload)),
      bus.on("audio:economy", (payload) => this.playMapped("audio:economy", payload)),
      bus.on("audio:car", (payload) => this.playMapped("audio:car", payload)),
      bus.on("audio:minigame", (payload) => this.playMapped("audio:minigame", payload)),
      bus.on("audio:mute", ({ muted }) => this.setMuted(muted)),
    ];
    this.removeListeners.push(...removers);
    return () => this.remove(removers);
  }

  bindGameEvents(bus: EventBus<GameEvents>): () => void {
    const removers = [
      bus.on("gooby:reaction", ({ kind }) => {
        const pattern: PolishHapticPattern =
          kind === "feed" || kind === "wake" ? "success" : kind === "tickle" ? "combo" : "light";
        this.play(pattern);
      }),
    ];
    this.removeListeners.push(...removers);
    return () => this.remove(removers);
  }

  dispose(): void {
    this.cancelPending();
    for (const remove of this.removeListeners) remove();
    this.removeListeners.length = 0;
  }

  private playMapped<Key extends keyof AudioEvents>(event: Key, payload: AudioEvents[Key]): void {
    const pattern = hapticForAudioEvent(event, payload);
    if (pattern) this.play(pattern);
  }

  private cancelPending(): void {
    for (const token of this.pending) this.scheduler.cancel(token);
    this.pending.length = 0;
  }

  private remove(removers: readonly (() => void)[]): void {
    for (const remove of removers) {
      remove();
      const index = this.removeListeners.indexOf(remove);
      if (index >= 0) this.removeListeners.splice(index, 1);
    }
  }
}
