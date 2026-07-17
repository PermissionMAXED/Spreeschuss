import { describe, expect, it } from "vitest";
import { nextAllowedNotificationTime } from "../core/contracts/platform";
import {
  createSleepCompletionNotification,
  SLEEP_NOTIFICATION_ID,
} from "./notification-policy";

describe("sleep-completion notification policy", () => {
  it("keeps the exact sleep completion in the request and includes the canonical policy payload", () => {
    const completesAt = new Date(2026, 0, 2, 22, 0, 0, 0).getTime();
    const policy = {
      quietHours: { startHour: 21, endHour: 8 },
      suppressWhenForeground: true,
    };

    expect(createSleepCompletionNotification(completesAt, policy)).toEqual({
      id: SLEEP_NOTIFICATION_ID,
      title: "Gooby is rested!",
      body: "Your fluffy friend is awake and ready to play.",
      at: completesAt,
      policy,
    });
  });

  it("defers only delivery from the 21:00 boundary to 08:00", () => {
    const completesAt = new Date(2026, 0, 2, 21, 0, 0, 0).getTime();
    const expectedDelivery = new Date(2026, 0, 3, 8, 0, 0, 0).getTime();
    const request = createSleepCompletionNotification(completesAt, {
      quietHours: { startHour: 21, endHour: 8 },
      suppressWhenForeground: true,
    });

    expect(request.at).toBe(completesAt);
    expect(nextAllowedNotificationTime(request.at, request.policy?.quietHours ?? null))
      .toBe(expectedDelivery);
  });
});
