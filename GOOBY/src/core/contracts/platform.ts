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

export interface NotificationRequest {
  readonly id: number;
  readonly title: string;
  readonly body: string;
  readonly at: number;
}

export interface NotificationsPort {
  requestPermission(): Promise<boolean>;
  schedule(request: NotificationRequest): Promise<void>;
  cancel(id: number): Promise<void>;
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
