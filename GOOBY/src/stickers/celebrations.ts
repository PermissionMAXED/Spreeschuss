import type { CanonicalSaveState } from "../core/contracts/save";
import {
  STICKER_IDS,
  type StickerId,
  type StickerPageId,
} from "../core/contracts/stickers";
import {
  isStickerNew,
  markStickerSeen,
  type AchievementUpdate,
} from "./progression";

export type StickerCelebration =
  | {
      readonly kind: "sticker";
      readonly stickerId: StickerId;
    }
  | {
      readonly kind: "page-reward";
      readonly page: StickerPageId;
      readonly coins: number;
    };

function celebrationKey(celebration: StickerCelebration): string {
  return celebration.kind === "sticker"
    ? `sticker|${celebration.stickerId}`
    : `page|${celebration.page}`;
}

/**
 * A presentation-only queue. Progress and economy are already persisted by
 * `processAchievementSignal`; showing or dismissing celebrations can never
 * grant currency a second time.
 */
export class StickerCelebrationQueue {
  private readonly pending: StickerCelebration[] = [];
  private readonly known = new Set<string>();
  private current: StickerCelebration | null = null;
  private gameplayResultsVisible = false;

  get length(): number {
    return this.pending.length + (this.current ? 1 : 0);
  }

  get active(): StickerCelebration | null {
    return this.current;
  }

  setGameplayResultsVisible(visible: boolean): void {
    this.gameplayResultsVisible = visible;
  }

  enqueueUpdate(update: AchievementUpdate): void {
    for (const stickerId of update.newlyUnlocked) {
      this.enqueue({ kind: "sticker", stickerId });
    }
    for (const reward of update.pageRewards) {
      this.enqueue({ kind: "page-reward", page: reward.page, coins: reward.coins });
    }
  }

  /** Restores unseen unlock celebrations after a reload, in frozen book order. */
  enqueueUnseen(state: CanonicalSaveState): void {
    for (const stickerId of STICKER_IDS) {
      if (isStickerNew(state, stickerId)) this.enqueue({ kind: "sticker", stickerId });
    }
  }

  next(): StickerCelebration | null {
    if (this.gameplayResultsVisible) return null;
    if (this.current) return this.current;
    this.current = this.pending.shift() ?? null;
    return this.current;
  }

  dismiss(state: CanonicalSaveState, seenAt: number): CanonicalSaveState {
    if (!this.current) return state;
    const dismissed = this.current;
    this.current = null;
    return dismissed.kind === "sticker"
      ? markStickerSeen(state, dismissed.stickerId, seenAt)
      : state;
  }

  clear(): void {
    this.pending.length = 0;
    this.known.clear();
    this.current = null;
  }

  private enqueue(celebration: StickerCelebration): void {
    const key = celebrationKey(celebration);
    if (this.known.has(key)) return;
    this.known.add(key);
    this.pending.push(celebration);
  }
}
