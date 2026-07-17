import { ImpactStyle, NotificationType } from "@capacitor/haptics";
import { describe, expect, it } from "vitest";
import { FakeClock } from "../../core/contracts/clock";
import {
  NativeHapticsAdapter,
  NativeNotificationsAdapter,
  NativeSaveAdapter,
  configureNativeShell,
} from "./index";

class MemoryPreferences {
  readonly values = new Map<string, string>();
  removeOldCalls = 0;
  migrationResult = { migrated: [] as string[], existing: [] as string[] };

  get({ key }: { key: string }): Promise<{ value: string | null }> {
    return Promise.resolve({ value: this.values.get(key) ?? null });
  }

  set({ key, value }: { key: string; value: string }): Promise<void> {
    this.values.set(key, value);
    return Promise.resolve();
  }

  remove({ key }: { key: string }): Promise<void> {
    this.values.delete(key);
    return Promise.resolve();
  }

  migrate(): Promise<{ migrated: string[]; existing: string[] }> {
    return Promise.resolve(this.migrationResult);
  }

  removeOld(): Promise<void> {
    this.removeOldCalls += 1;
    return Promise.resolve();
  }
}

describe("native save adapter", () => {
  it("moves a legacy raw save into the revisioned Preferences key", async () => {
    const preferences = new MemoryPreferences();
    const legacy = { version: 1, name: "Gooby" };
    preferences.values.set("gooby.save.v1", JSON.stringify(legacy));
    preferences.migrationResult = { migrated: ["gooby.save.v1"], existing: [] };
    const adapter = new NativeSaveAdapter(preferences);

    await expect(adapter.load()).resolves.toEqual({ revision: 0, payload: legacy });
    expect(preferences.values.has("gooby.save.v1")).toBe(false);
    expect(JSON.parse(preferences.values.get("gooby.save.v2") ?? "")).toEqual({
      revision: 0,
      payload: legacy,
    });
    expect(preferences.removeOldCalls).toBe(1);
  });

  it("serializes compare-and-commit operations", async () => {
    const adapter = new NativeSaveAdapter(new MemoryPreferences());
    const first = adapter.commit(0, { coins: 1 });
    const stale = adapter.commit(0, { coins: 2 });

    await expect(first).resolves.toEqual({ revision: 1, payload: { coins: 1 } });
    await expect(stale).rejects.toThrow("Save changed since it was loaded");
    await expect(adapter.load()).resolves.toEqual({ revision: 1, payload: { coins: 1 } });
  });
});

describe("native notification adapter", () => {
  it("replaces the sleep notification at the exact completion time and cancels it", async () => {
    const events: Array<{ kind: "cancel"; id: number } | { kind: "schedule"; at: number }> = [];
    const notifications = {
      checkPermissions: () => Promise.resolve({ display: "granted" }),
      requestPermissions: () => Promise.resolve({ display: "granted" }),
      cancel: ({ notifications: descriptors }: { notifications: Array<{ id: number }> }) => {
        events.push({ kind: "cancel", id: descriptors[0]?.id ?? -1 });
        return Promise.resolve();
      },
      schedule: ({ notifications: scheduled }: {
        notifications: Array<{ schedule: { at: Date } }>;
      }) => {
        events.push({ kind: "schedule", at: scheduled[0]?.schedule.at.getTime() ?? -1 });
        return Promise.resolve({});
      },
    };
    const adapter = new NativeNotificationsAdapter(notifications, new FakeClock(1_000));

    await adapter.schedule({
      id: 301,
      title: "Gooby is rested!",
      body: "Ready to play.",
      at: 1_801_000,
    });
    await adapter.cancel(301);

    expect(events).toEqual([
      { kind: "cancel", id: 301 },
      { kind: "schedule", at: 1_801_000 },
      { kind: "cancel", id: 301 },
    ]);
  });

  it("does not re-prompt after notification permission is denied", async () => {
    let requests = 0;
    const adapter = new NativeNotificationsAdapter({
      checkPermissions: () => Promise.resolve({ display: "denied" }),
      requestPermissions: () => {
        requests += 1;
        return Promise.resolve({ display: "granted" });
      },
      cancel: () => Promise.resolve(),
      schedule: () => Promise.resolve({}),
    });

    await expect(adapter.requestPermission()).resolves.toBe(false);
    expect(requests).toBe(0);
  });

  it("does not schedule after an early wake cancels a pending permission request", async () => {
    let resolvePermission: ((value: { display: string }) => void) | undefined;
    let schedules = 0;
    const adapter = new NativeNotificationsAdapter({
      checkPermissions: () => Promise.resolve({ display: "prompt" }),
      requestPermissions: () => new Promise((resolve) => {
        resolvePermission = resolve;
      }),
      cancel: () => Promise.resolve(),
      schedule: () => {
        schedules += 1;
        return Promise.resolve({});
      },
    }, new FakeClock(1_000));

    const permission = adapter.requestPermission();
    await Promise.resolve();
    await adapter.cancel(301);
    resolvePermission?.({ display: "granted" });
    await expect(permission).resolves.toBe(true);
    await adapter.schedule({ id: 301, title: "Rested", body: "Ready", at: 1_801_000 });
    expect(schedules).toBe(0);
  });
});

describe("native haptics and lifecycle", () => {
  it("maps impacts and notification feedback to the Capacitor plugin", async () => {
    const calls: string[] = [];
    const haptics = new NativeHapticsAdapter({
      impact: ({ style }) => {
        calls.push(style);
        return Promise.resolve();
      },
      notification: ({ type }) => {
        calls.push(type);
        return Promise.resolve();
      },
    });

    await haptics.impact("light");
    await haptics.impact("medium");
    await haptics.impact("success");
    await haptics.impact("warning");
    expect(calls).toEqual([
      ImpactStyle.Light,
      ImpactStyle.Medium,
      NotificationType.Success,
      NotificationType.Warning,
    ]);
  });

  it("persists once per native background transition and removes its listener", async () => {
    const lifecycle: {
      listener?: (state: { isActive: boolean }) => void;
    } = {};
    let backgrounds = 0;
    let foregrounds = 0;
    let removals = 0;
    const cleanup = await configureNativeShell(
      {
        onBackground: () => {
          backgrounds += 1;
        },
        onForeground: () => {
          foregrounds += 1;
        },
      },
      {
        app: {
          addListener: (_event, listener) => {
            lifecycle.listener = listener;
            return Promise.resolve({
              remove: () => {
                removals += 1;
                return Promise.resolve();
              },
            });
          },
        },
        splash: { hide: () => Promise.resolve() },
        statusBar: { setStyle: () => Promise.resolve() },
      },
    );

    const listener = lifecycle.listener;
    if (!listener) throw new Error("Lifecycle listener was not installed");
    listener({ isActive: false });
    listener({ isActive: false });
    listener({ isActive: true });
    listener({ isActive: false });
    cleanup();

    expect(backgrounds).toBe(2);
    expect(foregrounds).toBe(1);
    await Promise.resolve();
    expect(removals).toBe(1);
  });
});
