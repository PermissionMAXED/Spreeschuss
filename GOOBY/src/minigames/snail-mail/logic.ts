import type { MinigamePayout } from "../../core/contracts/minigame";
import type { RandomSource } from "../../core/contracts/rng";

export const MAIL_COLORS = ["rose", "blue", "gold", "green", "violet"] as const;
export const MAIL_SYMBOLS = ["moon", "star", "leaf", "heart", "acorn"] as const;
export const MAIL_STAMPS = ["snail", "clover", "berry", "cloud", "carrot"] as const;

export type MailColor = (typeof MAIL_COLORS)[number];
export type MailSymbol = (typeof MAIL_SYMBOLS)[number];
export type MailStamp = (typeof MAIL_STAMPS)[number];
export type DeliveryGesture = "drag" | "flick" | "double-tap";
export type DeliveryOutcome = "delivered" | "wrong-box" | "careful-required" | "missing";

export interface MailCode {
  readonly color: MailColor;
  readonly symbol: MailSymbol;
  readonly stamp: MailStamp;
}

export interface Mailbox extends MailCode {
  readonly index: number;
}

export interface ConveyorLetter extends MailCode {
  readonly id: number;
  readonly mailbox: number;
  readonly careful: boolean;
  progress: number;
}

export interface MailEvent {
  readonly kind: "spawn" | "delivered" | "wrong-box" | "missed";
  readonly value: number;
}

export interface SnailMailSnapshot {
  readonly elapsed: number;
  readonly remaining: number;
  readonly mailboxCount: number;
  readonly delivered: number;
  readonly missed: number;
  readonly streak: number;
  readonly bestStreak: number;
  readonly score: number;
  readonly speed: number;
}

export const SNAIL_MAIL_ROUND_SECONDS = 45;
export const SNAIL_MAIL_MAX_LETTERS = 4;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function mailboxCountAt(elapsedSeconds: number): number {
  if (elapsedSeconds >= 30) return 5;
  if (elapsedSeconds >= 15) return 4;
  return 3;
}

export function conveyorSpeedAt(elapsedSeconds: number): number {
  return 0.105 + clamp(elapsedSeconds / SNAIL_MAIL_ROUND_SECONDS, 0, 1) * 0.095;
}

export function spawnIntervalAt(elapsedSeconds: number): number {
  return 1.55 - clamp(elapsedSeconds / SNAIL_MAIL_ROUND_SECONDS, 0, 1) * 0.65;
}

export function codesMatch(letter: MailCode, mailbox: MailCode): boolean {
  return (
    letter.color === mailbox.color
    && letter.symbol === mailbox.symbol
    && letter.stamp === mailbox.stamp
  );
}

export class SnailMailRound {
  readonly mailboxes: Mailbox[] = [];
  readonly letters: ConveyorLetter[] = [];
  readonly events: MailEvent[] = [];

  private readonly rng: RandomSource;
  private elapsedSeconds = 0;
  private nextSpawnSeconds = 0.25;
  private nextLetterId = 1;
  private deliveredCount = 0;
  private missedCount = 0;
  private currentStreak = 0;
  private longestStreak = 0;
  private roundScore = 0;
  private ended = false;

  constructor(rng: RandomSource) {
    this.rng = rng;
    this.ensureMailboxes(3);
  }

  get finished(): boolean {
    return this.ended;
  }

  get remaining(): number {
    return Math.max(0, SNAIL_MAIL_ROUND_SECONDS - this.elapsedSeconds);
  }

  get elapsed(): number {
    return this.elapsedSeconds;
  }

  get score(): number {
    return this.roundScore;
  }

  get streak(): number {
    return this.currentStreak;
  }

  get bestStreak(): number {
    return this.longestStreak;
  }

  get delivered(): number {
    return this.deliveredCount;
  }

  get missed(): number {
    return this.missedCount;
  }

  update(deltaSeconds: number): void {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) {
      throw new RangeError("Snail Mail delta must be finite and non-negative");
    }
    if (this.ended) return;

    const step = Math.min(deltaSeconds, this.remaining);
    this.elapsedSeconds += step;
    this.ensureMailboxes(mailboxCountAt(this.elapsedSeconds));
    const speed = conveyorSpeedAt(this.elapsedSeconds);
    for (let index = this.letters.length - 1; index >= 0; index -= 1) {
      const letter = this.letters[index];
      if (!letter) continue;
      letter.progress += speed * step;
      if (letter.progress >= 1) {
        this.letters.splice(index, 1);
        this.missedCount += 1;
        this.currentStreak = 0;
        this.events.push({ kind: "missed", value: letter.id });
      }
    }

    this.nextSpawnSeconds -= step;
    while (
      this.nextSpawnSeconds <= 0
      && this.letters.length < SNAIL_MAIL_MAX_LETTERS
      && this.elapsedSeconds < SNAIL_MAIL_ROUND_SECONDS
    ) {
      this.spawnLetter();
      this.nextSpawnSeconds += spawnIntervalAt(this.elapsedSeconds);
    }
    if (this.elapsedSeconds >= SNAIL_MAIL_ROUND_SECONDS) this.ended = true;
  }

  deliver(letterId: number, mailboxIndex: number, gesture: DeliveryGesture): DeliveryOutcome {
    if (this.ended) return "missing";
    const at = this.letters.findIndex((letter) => letter.id === letterId);
    const letter = this.letters[at];
    if (!letter) return "missing";
    if (letter.careful && gesture !== "double-tap") return "careful-required";
    const mailbox = this.mailboxes[mailboxIndex];
    if (!mailbox || mailbox.index !== letter.mailbox || !codesMatch(letter, mailbox)) {
      this.currentStreak = 0;
      this.roundScore = Math.max(0, this.roundScore - 8);
      this.events.push({ kind: "wrong-box", value: letter.id });
      return "wrong-box";
    }

    this.letters.splice(at, 1);
    this.deliveredCount += 1;
    this.currentStreak += 1;
    this.longestStreak = Math.max(this.longestStreak, this.currentStreak);
    const urgency = Math.round(letter.progress * 18);
    const carefulBonus = letter.careful ? 14 : 0;
    const streakBonus = Math.min(25, this.currentStreak * 2);
    this.roundScore += 30 + urgency + carefulBonus + streakBonus;
    this.events.push({ kind: "delivered", value: letter.id });
    this.nextSpawnSeconds = Math.min(this.nextSpawnSeconds, 0.22);
    return "delivered";
  }

  drainEvents(handle: (event: MailEvent) => void): void {
    for (const event of this.events) handle(event);
    this.events.length = 0;
  }

  payout(): MinigamePayout {
    const score = Math.max(0, Math.floor(this.roundScore));
    if (score === 0) return { score: 0, coins: 0, xp: 0 };
    return {
      score,
      coins: Math.min(55, Math.floor(score / 75) + this.deliveredCount),
      xp: Math.min(120, Math.floor(score / 38) + this.longestStreak * 2),
    };
  }

  snapshot(): SnailMailSnapshot {
    return {
      elapsed: this.elapsedSeconds,
      remaining: this.remaining,
      mailboxCount: this.mailboxes.length,
      delivered: this.deliveredCount,
      missed: this.missedCount,
      streak: this.currentStreak,
      bestStreak: this.longestStreak,
      score: this.roundScore,
      speed: conveyorSpeedAt(this.elapsedSeconds),
    };
  }

  private ensureMailboxes(count: number): void {
    while (this.mailboxes.length < count) {
      const index = this.mailboxes.length;
      this.mailboxes.push({
        index,
        color: MAIL_COLORS[index] as MailColor,
        symbol: MAIL_SYMBOLS[index] as MailSymbol,
        stamp: MAIL_STAMPS[index] as MailStamp,
      });
    }
  }

  private spawnLetter(): void {
    const mailbox = this.rng.int(0, this.mailboxes.length);
    const code = this.mailboxes[mailbox];
    if (!code) return;
    const id = this.nextLetterId;
    this.nextLetterId += 1;
    this.letters.push({
      id,
      mailbox,
      color: code.color,
      symbol: code.symbol,
      stamp: code.stamp,
      careful: id % 4 === 0,
      progress: 0,
    });
    this.events.push({ kind: "spawn", value: id });
  }
}
