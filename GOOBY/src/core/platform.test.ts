import { afterEach, describe, expect, it, vi } from "vitest";
import { FakeClock } from "./contracts/clock";
import {
  isDuringQuietHours,
  nextAllowedNotificationTime,
} from "./contracts/platform";
import {
  RevisionConflictError,
  WebNotifications,
  WebSaveAdapter,
} from "./platform";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("web save adapter", () => {
  it("allows one winner across concurrent adapter instances", async () => {
    const storage = new MemoryStorage();
    const first = new WebSaveAdapter(storage);
    const second = new WebSaveAdapter(storage);

    const results = await Promise.allSettled([
      first.commit(0, { source: "first" }),
      second.commit(0, { source: "second" }),
    ]);

    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(results.some(
      (result) => result.status === "rejected" && result.reason instanceof RevisionConflictError,
    )).toBe(true);
    await expect(first.load()).resolves.toMatchObject({ revision: 1 });
  });

  it("uses a same-origin exclusive Web Lock when the API is available", async () => {
    const requests: Array<{ name: string; mode: string | undefined }> = [];
    vi.stubGlobal("navigator", {
      locks: {
        request: <T>(
          name: string,
          options: { readonly mode?: string },
          callback: () => Promise<T>,
        ): Promise<T> => {
          requests.push({ name, mode: options.mode });
          return callback();
        },
      },
    });
    const adapter = new WebSaveAdapter(new MemoryStorage());

    await adapter.commit(0, { coins: 1 });

    expect(requests).toEqual([{ name: "gooby.save.v2.exclusive", mode: "exclusive" }]);
  });
});

describe("notification policy", () => {
  it("treats quiet-hour starts as inclusive and ends as exclusive", () => {
    const quietHours = { startHour: 22, endHour: 8 };
    const start = new Date(2026, 0, 2, 22, 0, 0, 0).getTime();
    const beforeEnd = new Date(2026, 0, 3, 7, 59, 59, 999).getTime();
    const end = new Date(2026, 0, 3, 8, 0, 0, 0).getTime();

    expect(isDuringQuietHours(start, quietHours)).toBe(true);
    expect(isDuringQuietHours(beforeEnd, quietHours)).toBe(true);
    expect(isDuringQuietHours(end, quietHours)).toBe(false);
    expect(nextAllowedNotificationTime(start, quietHours)).toBe(end);
  });

  it("suppresses web notification delivery while foregrounded", async () => {
    vi.useFakeTimers();
    let deliveries = 0;
    class FakeNotification {
      static readonly permission = "granted";

      constructor() {
        deliveries += 1;
      }
    }
    vi.stubGlobal("Notification", FakeNotification);
    const clock = new FakeClock(1_000);
    const notifications = new WebNotifications(clock);
    notifications.setForeground(true);

    await notifications.schedule({
      id: 301,
      title: "Rested",
      body: "Ready",
      at: 1_000,
      policy: {
        quietHours: null,
        suppressWhenForeground: true,
      },
    });
    await vi.runAllTimersAsync();

    expect(deliveries).toBe(0);
  });
});
