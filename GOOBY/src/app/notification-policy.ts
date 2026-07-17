import type {
  NotificationPolicy,
  NotificationRequest,
} from "../core/contracts/platform";

export const SLEEP_NOTIFICATION_ID = 301;

export function createSleepCompletionNotification(
  completesAt: number,
  policy: NotificationPolicy,
): NotificationRequest {
  return {
    id: SLEEP_NOTIFICATION_ID,
    title: "Gooby is rested!",
    body: "Your fluffy friend is awake and ready to play.",
    at: completesAt,
    policy,
  };
}
