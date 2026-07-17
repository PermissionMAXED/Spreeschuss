export type HapticPattern = "light" | "medium" | "success" | "warning";

export interface AudioPort {
  readonly unlocked: boolean;
  unlock(): Promise<void>;
  play(effect: "happy" | "munch" | "sleep" | "wake" | "tap"): void;
  setMuted(muted: boolean): void;
  dispose(): void;
}

export interface HapticsPort {
  impact(pattern: HapticPattern): Promise<void>;
}

export interface QuietHours {
  /** Local wall-clock hour, inclusive. */
  readonly startHour: number;
  /** Local wall-clock hour, exclusive. */
  readonly endHour: number;
}

export interface NotificationPolicy {
  readonly quietHours: QuietHours | null;
  readonly suppressWhenForeground: boolean;
}

export const DEFAULT_NOTIFICATION_POLICY: Readonly<NotificationPolicy> = {
  quietHours: null,
  suppressWhenForeground: true,
};

export interface NotificationRequest {
  readonly id: number;
  readonly title: string;
  readonly body: string;
  readonly at: number;
  readonly policy?: NotificationPolicy;
}

function validateQuietHours(quietHours: QuietHours): void {
  if (
    !Number.isInteger(quietHours.startHour) ||
    quietHours.startHour < 0 ||
    quietHours.startHour > 23 ||
    !Number.isInteger(quietHours.endHour) ||
    quietHours.endHour < 0 ||
    quietHours.endHour > 23
  ) {
    throw new RangeError("Quiet-hour boundaries must be integer local hours from 0 through 23");
  }
}

export function isDuringQuietHours(at: number, quietHours: QuietHours): boolean {
  if (!Number.isFinite(at)) throw new RangeError("Notification time must be finite");
  validateQuietHours(quietHours);
  if (quietHours.startHour === quietHours.endHour) return false;
  const date = new Date(at);
  const localHour = date.getHours() +
    date.getMinutes() / 60 +
    date.getSeconds() / 3_600 +
    date.getMilliseconds() / 3_600_000;
  return quietHours.startHour < quietHours.endHour
    ? localHour >= quietHours.startHour && localHour < quietHours.endHour
    : localHour >= quietHours.startHour || localHour < quietHours.endHour;
}

/** Defers a notification in quiet hours to the next exclusive end boundary. */
export function nextAllowedNotificationTime(at: number, quietHours: QuietHours | null): number {
  if (!quietHours || !isDuringQuietHours(at, quietHours)) return at;
  const next = new Date(at);
  next.setHours(quietHours.endHour, 0, 0, 0);
  if (next.getTime() <= at) next.setDate(next.getDate() + 1);
  return next.getTime();
}

export function shouldSuppressNotification(
  policy: NotificationPolicy | undefined,
  isForeground: boolean,
): boolean {
  return policy?.suppressWhenForeground === true && isForeground;
}

export interface NotificationsPort {
  requestPermission(): Promise<boolean>;
  schedule(request: NotificationRequest): Promise<void>;
  cancel(id: number): Promise<void>;
  setForeground(isForeground: boolean): void;
}

export interface SaveRecord {
  readonly revision: number;
  readonly payload: unknown;
}

/** Implementations must compare and commit as one logical operation. */
export interface SavePort {
  load(): Promise<SaveRecord | null>;
  commit(expectedRevision: number, payload: unknown): Promise<SaveRecord>;
  clear(): Promise<void>;
}

export interface PlatformPorts {
  readonly audio: AudioPort;
  readonly haptics: HapticsPort;
  readonly notifications: NotificationsPort;
  readonly save: SavePort;
  readonly kind: "web" | "ios";
}
