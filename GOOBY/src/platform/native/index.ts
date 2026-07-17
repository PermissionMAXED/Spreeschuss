import { App } from "@capacitor/app";
import { Haptics, ImpactStyle, NotificationType } from "@capacitor/haptics";
import { LocalNotifications } from "@capacitor/local-notifications";
import { Preferences } from "@capacitor/preferences";
import { SplashScreen } from "@capacitor/splash-screen";
import { StatusBar, Style } from "@capacitor/status-bar";
import type { Clock } from "../../core/contracts/clock";
import {
  nextAllowedNotificationTime,
  shouldSuppressNotification,
} from "../../core/contracts/platform";
import type {
  AudioPort,
  HapticPattern,
  HapticsPort,
  NotificationRequest,
  NotificationsPort,
  PlatformPorts,
  SavePort,
  SaveRecord,
} from "../../core/contracts/platform";

const SAVE_KEY = "gooby.save.v2";
const LEGACY_SAVE_KEYS = ["gooby.save.v1", "gooby.save"] as const;

interface PreferencesClient {
  get(options: { key: string }): Promise<{ value: string | null }>;
  set(options: { key: string; value: string }): Promise<void>;
  remove(options: { key: string }): Promise<void>;
  migrate(): Promise<{ migrated: string[]; existing: string[] }>;
  removeOld(): Promise<void>;
}

interface NotificationsClient {
  checkPermissions(): Promise<{ display: string }>;
  requestPermissions(): Promise<{ display: string }>;
  schedule(options: {
    notifications: Array<{
      id: number;
      title: string;
      body: string;
      schedule: { at: Date };
    }>;
  }): Promise<unknown>;
  cancel(options: { notifications: Array<{ id: number }> }): Promise<void>;
}

interface HapticsClient {
  impact(options: { style: ImpactStyle }): Promise<void>;
  notification(options: { type: NotificationType }): Promise<void>;
}

interface ListenerHandle {
  remove(): Promise<void>;
}

interface AppClient {
  addListener(
    eventName: "appStateChange",
    listener: (state: { isActive: boolean }) => void,
  ): Promise<ListenerHandle>;
}

interface SplashClient {
  hide(): Promise<void>;
}

interface StatusBarClient {
  setStyle(options: { style: Style }): Promise<void>;
}

interface NativeShellClients {
  readonly app: AppClient;
  readonly splash: SplashClient;
  readonly statusBar: StatusBarClient;
}

export interface NativeLifecycleHandlers {
  readonly onBackground: () => void;
  readonly onForeground: () => void;
}

interface NativeSaveCoordination {
  tail: Promise<void>;
  migration: Promise<void> | null;
}

const nativeSaveCoordination = new WeakMap<PreferencesClient, NativeSaveCoordination>();

function coordinationFor(preferences: PreferencesClient): NativeSaveCoordination {
  const existing = nativeSaveCoordination.get(preferences);
  if (existing) return existing;
  const created: NativeSaveCoordination = {
    tail: Promise.resolve(),
    migration: null,
  };
  nativeSaveCoordination.set(preferences, created);
  return created;
}

function parseCurrentRecord(raw: string | null): SaveRecord | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (
      typeof value === "object" &&
      value !== null &&
      "revision" in value &&
      Number.isInteger(value.revision) &&
      (value.revision as number) >= 0 &&
      "payload" in value
    ) {
      return { revision: value.revision as number, payload: value.payload };
    }
  } catch {
    // A valid legacy key may still provide a recoverable save.
  }
  return null;
}

function parseLegacyRecord(raw: string): SaveRecord | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (
      typeof value === "object" &&
      value !== null &&
      "revision" in value &&
      Number.isInteger(value.revision) &&
      (value.revision as number) >= 0 &&
      "payload" in value
    ) {
      return { revision: value.revision as number, payload: value.payload };
    }
    return typeof value === "object" && value !== null
      ? { revision: 0, payload: value }
      : null;
  } catch {
    return null;
  }
}

export class NativeSaveAdapter implements SavePort {
  private readonly coordination: NativeSaveCoordination;

  constructor(
    private readonly preferences: PreferencesClient = Preferences,
    private readonly revisionConflict: () => Error = () => new Error("Save changed since it was loaded"),
  ) {
    this.coordination = coordinationFor(preferences);
  }

  load(): Promise<SaveRecord | null> {
    return this.serialize(() => this.loadUnlocked());
  }

  commit(expectedRevision: number, payload: unknown): Promise<SaveRecord> {
    return this.serialize(async () => {
      const current = await this.loadUnlocked();
      if ((current?.revision ?? 0) !== expectedRevision) throw this.revisionConflict();
      const next = { revision: expectedRevision + 1, payload };
      await this.preferences.set({ key: SAVE_KEY, value: JSON.stringify(next) });
      return next;
    });
  }

  clear(): Promise<void> {
    return this.serialize(async () => {
      await this.ensureMigrated();
      await Promise.all([
        this.preferences.remove({ key: SAVE_KEY }),
        ...LEGACY_SAVE_KEYS.map((key) => this.preferences.remove({ key })),
      ]);
    });
  }

  private async loadUnlocked(): Promise<SaveRecord | null> {
    await this.ensureMigrated();
    const current = (await this.preferences.get({ key: SAVE_KEY })).value;
    const currentRecord = parseCurrentRecord(current);
    if (currentRecord) return currentRecord;

    for (const key of LEGACY_SAVE_KEYS) {
      const legacy = (await this.preferences.get({ key })).value;
      if (legacy === null) continue;
      const record = parseLegacyRecord(legacy);
      if (!record) continue;
      await this.preferences.set({ key: SAVE_KEY, value: JSON.stringify(record) });
      await this.preferences.remove({ key });
      return record;
    }
    return current === null ? null : { revision: 0, payload: null };
  }

  private ensureMigrated(): Promise<void> {
    this.coordination.migration ??= (async () => {
      const result = await this.preferences.migrate();
      if (result.migrated.length > 0 || result.existing.length > 0) {
        await this.preferences.removeOld();
      }
    })();
    return this.coordination.migration;
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.coordination.tail.then(operation, operation);
    this.coordination.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

export class NativeHapticsAdapter implements HapticsPort {
  constructor(private readonly haptics: HapticsClient = Haptics) {}

  async impact(pattern: HapticPattern): Promise<void> {
    if (pattern === "success" || pattern === "warning") {
      await this.haptics.notification({
        type: pattern === "success" ? NotificationType.Success : NotificationType.Warning,
      });
      return;
    }
    await this.haptics.impact({
      style: pattern === "light" ? ImpactStyle.Light : ImpactStyle.Medium,
    });
  }
}

export class NativeNotificationsAdapter implements NotificationsPort {
  private cancellationVersion = 0;
  private permissionVersion = 0;
  private isForeground = false;

  constructor(
    private readonly notifications: NotificationsClient = LocalNotifications,
    private readonly clock?: Clock,
  ) {}

  async requestPermission(): Promise<boolean> {
    const version = this.cancellationVersion;
    const current = await this.notifications.checkPermissions();
    const allowed = current.display === "granted"
      ? true
      : current.display === "denied"
        ? false
        : (await this.notifications.requestPermissions()).display === "granted";
    this.permissionVersion = version;
    return allowed;
  }

  async schedule(request: NotificationRequest): Promise<void> {
    if (!Number.isFinite(request.at)) throw new TypeError("Notification time must be finite");
    if (this.clock && request.at <= this.clock.now()) {
      throw new RangeError("Notification time must be in the future");
    }
    const version = this.cancellationVersion;
    if (this.permissionVersion !== version) return;
    await this.notifications.cancel({ notifications: [{ id: request.id }] });
    if (this.cancellationVersion !== version) return;
    if (shouldSuppressNotification(request.policy, this.isForeground)) return;
    const at = nextAllowedNotificationTime(request.at, request.policy?.quietHours ?? null);
    await this.notifications.schedule({
      notifications: [{
        id: request.id,
        title: request.title,
        body: request.body,
        schedule: { at: new Date(at) },
      }],
    });
  }

  async cancel(id: number): Promise<void> {
    this.cancellationVersion += 1;
    await this.notifications.cancel({ notifications: [{ id }] });
  }

  setForeground(isForeground: boolean): void {
    this.isForeground = isForeground;
  }
}

export function createNativePlatform(
  clock: Clock,
  audio: AudioPort,
  revisionConflict?: () => Error,
): PlatformPorts {
  return {
    kind: "ios",
    audio,
    haptics: new NativeHapticsAdapter(),
    notifications: new NativeNotificationsAdapter(LocalNotifications, clock),
    save: new NativeSaveAdapter(Preferences, revisionConflict),
  };
}

export async function configureNativeShell(
  handlers: NativeLifecycleHandlers,
  clients: NativeShellClients = {
    app: App,
    splash: SplashScreen,
    statusBar: StatusBar,
  },
): Promise<() => void> {
  let backgrounded = false;
  const listenerPromise = clients.app.addListener("appStateChange", ({ isActive }) => {
    if (!isActive && !backgrounded) handlers.onBackground();
    if (isActive && backgrounded) handlers.onForeground();
    backgrounded = !isActive;
  });
  const splash = clients.splash.hide().catch(() => undefined);
  const statusBar = clients.statusBar.setStyle({ style: Style.Light }).catch(() => undefined);
  const listener = await listenerPromise;
  await Promise.all([splash, statusBar]);
  return () => {
    void listener.remove();
  };
}
