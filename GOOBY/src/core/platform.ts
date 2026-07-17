import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { Haptics, ImpactStyle, NotificationType } from "@capacitor/haptics";
import { LocalNotifications } from "@capacitor/local-notifications";
import { Preferences } from "@capacitor/preferences";
import { SplashScreen } from "@capacitor/splash-screen";
import { StatusBar, Style } from "@capacitor/status-bar";
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

class NativeSaveAdapter implements SavePort {
  async load(): Promise<SaveRecord | null> {
    return parseRecord((await Preferences.get({ key: SAVE_KEY })).value);
  }

  async commit(expectedRevision: number, payload: unknown): Promise<SaveRecord> {
    const current = await this.load();
    if ((current?.revision ?? 0) !== expectedRevision) throw new RevisionConflictError();
    const next = { revision: expectedRevision + 1, payload };
    await Preferences.set({ key: SAVE_KEY, value: JSON.stringify(next) });
    return next;
  }

  async clear(): Promise<void> {
    await Preferences.remove({ key: SAVE_KEY });
  }
}

class WebHaptics implements HapticsPort {
  impact(pattern: HapticPattern): Promise<void> {
    const duration = pattern === "light" ? 8 : pattern === "medium" ? 16 : 24;
    navigator.vibrate?.(duration);
    return Promise.resolve();
  }
}

class NativeHaptics implements HapticsPort {
  async impact(pattern: HapticPattern): Promise<void> {
    if (pattern === "success" || pattern === "warning") {
      await Haptics.notification({ type: pattern === "success" ? NotificationType.Success : NotificationType.Warning });
      return;
    }
    await Haptics.impact({ style: pattern === "light" ? ImpactStyle.Light : ImpactStyle.Medium });
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

class NativeNotifications implements NotificationsPort {
  async requestPermission(): Promise<boolean> {
    return (await LocalNotifications.requestPermissions()).display === "granted";
  }

  async schedule(request: NotificationRequest): Promise<void> {
    await LocalNotifications.schedule({
      notifications: [{ id: request.id, title: request.title, body: request.body, schedule: { at: new Date(request.at) } }],
    });
  }

  async cancel(id: number): Promise<void> {
    await LocalNotifications.cancel({ notifications: [{ id }] });
  }
}

export function createPlatform(clock: Clock): PlatformPorts {
  const native = Capacitor.isNativePlatform();
  return {
    kind: native ? "ios" : "web",
    audio: new WebAudioSynth(),
    haptics: native ? new NativeHaptics() : new WebHaptics(),
    notifications: native ? new NativeNotifications() : new WebNotifications(clock),
    save: native ? new NativeSaveAdapter() : new WebSaveAdapter(),
  };
}

/** Compile-checked native shell hooks; browser builds safely no-op. */
export async function configureNativeShell(onBackground: () => void): Promise<() => void> {
  if (!Capacitor.isNativePlatform()) return () => undefined;
  await Promise.all([
    SplashScreen.hide(),
    StatusBar.setStyle({ style: Style.Light }),
    StatusBar.setBackgroundColor({ color: "#F5B973" }),
  ]);
  const listener = await App.addListener("appStateChange", ({ isActive }) => {
    if (!isActive) onBackground();
  });
  return () => {
    void listener.remove();
  };
}
