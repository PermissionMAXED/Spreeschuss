import { Capacitor } from "@capacitor/core";
import type { Clock } from "./contracts/clock";
import {
  nextAllowedNotificationTime,
  shouldSuppressNotification,
} from "./contracts/platform";
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
const WEB_SAVE_LOCK_NAME = `${SAVE_KEY}.exclusive`;
let webSaveTail: Promise<void> = Promise.resolve();

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

function serializeWebSave<T>(operation: () => Promise<T>): Promise<T> {
  const result = webSaveTail.then(operation, operation);
  webSaveTail = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

async function withSameOriginSaveLock<T>(operation: () => Promise<T>): Promise<T> {
  const locks = globalThis.navigator?.locks;
  return locks
    ? locks.request(WEB_SAVE_LOCK_NAME, { mode: "exclusive" }, operation)
    : operation();
}

export class WebSaveAdapter implements SavePort {
  constructor(private readonly storage: Storage = localStorage) {}

  load(): Promise<SaveRecord | null> {
    return Promise.resolve(parseRecord(this.storage.getItem(SAVE_KEY)));
  }

  commit(expectedRevision: number, payload: unknown): Promise<SaveRecord> {
    return serializeWebSave(() => withSameOriginSaveLock(() => {
      const current = parseRecord(this.storage.getItem(SAVE_KEY));
      if ((current?.revision ?? 0) !== expectedRevision) {
        throw new RevisionConflictError();
      }
      const next = { revision: expectedRevision + 1, payload };
      this.storage.setItem(SAVE_KEY, JSON.stringify(next));
      return Promise.resolve(next);
    }));
  }

  clear(): Promise<void> {
    return serializeWebSave(() => withSameOriginSaveLock(() => {
      this.storage.removeItem(SAVE_KEY);
      return Promise.resolve();
    }));
  }
}

class WebHaptics implements HapticsPort {
  impact(pattern: HapticPattern): Promise<void> {
    const duration = pattern === "light" ? 8 : pattern === "medium" ? 16 : 24;
    navigator.vibrate?.(duration);
    return Promise.resolve();
  }
}

export class WebNotifications implements NotificationsPort {
  private readonly timers = new Map<number, ReturnType<typeof setTimeout>>();
  private isForeground = false;

  constructor(private readonly clock: Clock) {}

  async requestPermission(): Promise<boolean> {
    if (!("Notification" in window)) return false;
    return (await Notification.requestPermission()) === "granted";
  }

  async schedule(request: NotificationRequest): Promise<void> {
    await this.cancel(request.id);
    const at = nextAllowedNotificationTime(request.at, request.policy?.quietHours ?? null);
    const delay = Math.max(0, at - this.clock.now());
    this.timers.set(
      request.id,
      setTimeout(() => {
        if (
          Notification.permission === "granted" &&
          !shouldSuppressNotification(request.policy, this.isForeground)
        ) {
          new Notification(request.title, { body: request.body });
        }
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

  setForeground(isForeground: boolean): void {
    this.isForeground = isForeground;
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
