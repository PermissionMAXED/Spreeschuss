import { Capacitor } from "@capacitor/core";
import type { Clock } from "./contracts/clock";
import type {
  HapticPattern,
  HapticsPort,
  NotificationRequest,
  NotificationsPort,
  PlatformPorts,
  SavePort,
  SaveRecord,
} from "./contracts/platform";
import { WebAudioSynth } from "./web-audio";
import {
  configureNativeShell as configureIosShell,
  createNativePlatform,
  type NativeLifecycleHandlers,
} from "../platform/native";

const SAVE_KEY = "gooby.save.v2";

export class RevisionConflictError extends Error {
  constructor() {
    super("Save changed since it was loaded");
  }
}

function parseRecord(raw: string | null): SaveRecord | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (
      typeof value === "object" &&
      value !== null &&
      "revision" in value &&
      Number.isInteger(value.revision) &&
      "payload" in value
    ) {
      return { revision: value.revision as number, payload: value.payload };
    }
  } catch {
    // Corruption is represented as an invalid payload so migration can recover.
  }
  return { revision: 0, payload: null };
}

export class WebSaveAdapter implements SavePort {
  load(): Promise<SaveRecord | null> {
    return Promise.resolve(parseRecord(localStorage.getItem(SAVE_KEY)));
  }

  async commit(expectedRevision: number, payload: unknown): Promise<SaveRecord> {
    const current = await this.load();
    if ((current?.revision ?? 0) !== expectedRevision) throw new RevisionConflictError();
    const next = { revision: expectedRevision + 1, payload };
    localStorage.setItem(SAVE_KEY, JSON.stringify(next));
    return next;
  }

  clear(): Promise<void> {
    localStorage.removeItem(SAVE_KEY);
    return Promise.resolve();
  }
}

class WebHaptics implements HapticsPort {
  impact(pattern: HapticPattern): Promise<void> {
    const duration = pattern === "light" ? 8 : pattern === "medium" ? 16 : 24;
    navigator.vibrate?.(duration);
    return Promise.resolve();
  }
}

class WebNotifications implements NotificationsPort {
  private readonly timers = new Map<number, ReturnType<typeof setTimeout>>();

  constructor(private readonly clock: Clock) {}

  async requestPermission(): Promise<boolean> {
    if (!("Notification" in window)) return false;
    return (await Notification.requestPermission()) === "granted";
  }

  async schedule(request: NotificationRequest): Promise<void> {
    await this.cancel(request.id);
    const delay = Math.max(0, request.at - this.clock.now());
    this.timers.set(
      request.id,
      setTimeout(() => {
        if (Notification.permission === "granted") new Notification(request.title, { body: request.body });
        this.timers.delete(request.id);
      }, delay),
    );
  }

  cancel(id: number): Promise<void> {
    const timer = this.timers.get(id);
    if (timer) clearTimeout(timer);
    this.timers.delete(id);
    return Promise.resolve();
  }
}

export function createPlatform(clock: Clock): PlatformPorts {
  if (Capacitor.getPlatform() === "ios") {
    return createNativePlatform(
      clock,
      new WebAudioSynth(),
      () => new RevisionConflictError(),
    );
  }
  return {
    kind: "web",
    audio: new WebAudioSynth(),
    haptics: new WebHaptics(),
    notifications: new WebNotifications(clock),
    save: new WebSaveAdapter(),
  };
}

/** Compile-checked native shell hooks; browser builds safely no-op. */
export async function configureNativeShell(handlers: NativeLifecycleHandlers): Promise<() => void> {
  return Capacitor.getPlatform() === "ios"
    ? configureIosShell(handlers)
    : () => undefined;
}
