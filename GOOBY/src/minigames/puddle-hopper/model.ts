import type { MinigamePayout } from "../../core/contracts/minigame";
import type { RandomSource } from "../../core/contracts/rng";

export const PUDDLE_GRID_SIZE = 9;
export const PUDDLE_BEAT_MS = 680;
export const PUDDLE_LEAD_IN_MS = 900;
export const PUDDLE_BEAT_COUNT = 30;
export const PUDDLE_PERFECT_WINDOW_MS = 85;
export const PUDDLE_GOOD_WINDOW_MS = 180;
export const PUDDLE_STARTING_UMBRELLAS = 2;

export type HopTiming = "perfect" | "good" | "miss";
export type HopOutcome = HopTiming | "splash" | "shielded" | "idle";

export interface PuddleBeat {
  readonly index: number;
  readonly atMs: number;
  readonly target: number;
  readonly hazards: readonly number[];
  readonly pattern: "diagonal" | "corners" | "cross" | "checker";
}

export interface HopResult {
  readonly outcome: HopOutcome;
  readonly offsetMs: number | null;
  readonly beatIndex: number | null;
}

const SPLASH_PATTERNS = [
  { pattern: "diagonal", cells: [0, 4, 8] },
  { pattern: "corners", cells: [0, 2, 6, 8] },
  { pattern: "cross", cells: [1, 3, 5, 7] },
  { pattern: "checker", cells: [0, 2, 4, 6, 8] },
] as const;

export function judgeHopOffset(offsetMs: number): HopTiming {
  if (!Number.isFinite(offsetMs)) return "miss";
  const distance = Math.abs(offsetMs);
  if (distance <= PUDDLE_PERFECT_WINDOW_MS) return "perfect";
  if (distance <= PUDDLE_GOOD_WINDOW_MS) return "good";
  return "miss";
}

export function createPuddleBeats(
  rng: RandomSource,
  count = PUDDLE_BEAT_COUNT,
): readonly PuddleBeat[] {
  const beats: PuddleBeat[] = [];
  let previousTarget = 7;
  for (let index = 0; index < count; index += 1) {
    const selected = SPLASH_PATTERNS[index % SPLASH_PATTERNS.length] ?? SPLASH_PATTERNS[0];
    const hazards = [...selected.cells];
    const safe = Array.from({ length: PUDDLE_GRID_SIZE }, (_, tile) => tile).filter(
      (tile) => !hazards.includes(tile as never) && tile !== previousTarget,
    );
    const target = safe.length > 0 ? safe[rng.int(0, safe.length)] ?? 4 : previousTarget;
    beats.push({
      index,
      atMs: PUDDLE_LEAD_IN_MS + index * PUDDLE_BEAT_MS,
      target,
      hazards,
      pattern: selected.pattern,
    });
    previousTarget = target;
  }
  return beats;
}

export class PuddleRound {
  readonly beats: readonly PuddleBeat[];
  private elapsedMs = 0;
  private nextBeatIndex = 0;
  private judgedBeatIndex = -1;
  private scoreTotal = 0;
  private comboTotal = 0;
  private bestComboTotal = 0;
  private distanceTotal = 0;
  private attemptsTotal = 0;
  private accurateTotal = 0;
  private perfectTotal = 0;
  private goodTotal = 0;
  private missTotal = 0;
  private splashTotal = 0;
  private umbrellaTotal = PUDDLE_STARTING_UMBRELLAS;
  private umbrellaRaised = false;
  private ended = false;

  constructor(rng: RandomSource, count = PUDDLE_BEAT_COUNT) {
    this.beats = createPuddleBeats(rng, count);
  }

  get timeMs(): number {
    return this.elapsedMs;
  }

  get score(): number {
    return this.scoreTotal;
  }

  get combo(): number {
    return this.comboTotal;
  }

  get bestCombo(): number {
    return this.bestComboTotal;
  }

  get distance(): number {
    return this.distanceTotal;
  }

  get attempts(): number {
    return this.attemptsTotal;
  }

  get accuracy(): number {
    return this.attemptsTotal === 0 ? 1 : this.accurateTotal / this.attemptsTotal;
  }

  get perfects(): number {
    return this.perfectTotal;
  }

  get goods(): number {
    return this.goodTotal;
  }

  get misses(): number {
    return this.missTotal;
  }

  get splashes(): number {
    return this.splashTotal;
  }

  get umbrellas(): number {
    return this.umbrellaTotal;
  }

  get umbrellaActive(): boolean {
    return this.umbrellaRaised;
  }

  get finished(): boolean {
    return this.ended;
  }

  get remainingSeconds(): number {
    const lastBeat = this.beats.at(-1);
    const endMs = (lastBeat?.atMs ?? 0) + PUDDLE_GOOD_WINDOW_MS;
    return Math.max(0, (endMs - this.elapsedMs) / 1_000);
  }

  get activeBeat(): PuddleBeat | null {
    if (this.ended) return null;
    const beat = this.beats[this.nextBeatIndex];
    if (!beat || this.judgedBeatIndex === beat.index) return null;
    return Math.abs(this.elapsedMs - beat.atMs) <= PUDDLE_GOOD_WINDOW_MS
      ? beat
      : null;
  }

  get upcomingBeat(): PuddleBeat | null {
    if (this.ended) return null;
    return this.beats[this.nextBeatIndex] ?? null;
  }

  activateUmbrella(): boolean {
    if (this.ended || this.umbrellaRaised || this.umbrellaTotal <= 0) return false;
    this.umbrellaTotal -= 1;
    this.umbrellaRaised = true;
    return true;
  }

  update(deltaSeconds: number): HopResult[] {
    if (this.ended) return [];
    const safeDelta = Number.isFinite(deltaSeconds) ? Math.max(0, deltaSeconds) : 0;
    this.elapsedMs += safeDelta * 1_000;
    const results: HopResult[] = [];
    while (true) {
      const beat = this.beats[this.nextBeatIndex];
      if (!beat || this.elapsedMs <= beat.atMs + PUDDLE_GOOD_WINDOW_MS) break;
      if (this.judgedBeatIndex !== beat.index) {
        this.recordMiss();
        results.push({
          outcome: "miss",
          offsetMs: this.elapsedMs - beat.atMs,
          beatIndex: beat.index,
        });
      }
      this.nextBeatIndex += 1;
    }
    if (this.nextBeatIndex >= this.beats.length) this.ended = true;
    return results;
  }

  hop(tile: number): HopResult {
    if (this.ended || !Number.isInteger(tile) || tile < 0 || tile >= PUDDLE_GRID_SIZE) {
      return { outcome: "idle", offsetMs: null, beatIndex: null };
    }
    const beat = this.beats[this.nextBeatIndex];
    if (!beat || this.judgedBeatIndex === beat.index) {
      return { outcome: "idle", offsetMs: null, beatIndex: null };
    }
    const offsetMs = this.elapsedMs - beat.atMs;
    const timing = judgeHopOffset(offsetMs);
    if (timing === "miss") {
      if (this.elapsedMs < beat.atMs - PUDDLE_GOOD_WINDOW_MS) {
        return { outcome: "idle", offsetMs, beatIndex: beat.index };
      }
      this.judgedBeatIndex = beat.index;
      this.recordMiss();
      return { outcome: "miss", offsetMs, beatIndex: beat.index };
    }

    this.judgedBeatIndex = beat.index;
    this.attemptsTotal += 1;
    if (beat.hazards.includes(tile)) {
      this.comboTotal = 0;
      if (this.umbrellaRaised) {
        this.umbrellaRaised = false;
        this.scoreTotal += 20;
        return { outcome: "shielded", offsetMs, beatIndex: beat.index };
      }
      this.splashTotal += 1;
      this.missTotal += 1;
      this.scoreTotal = Math.max(0, this.scoreTotal - 40);
      return { outcome: "splash", offsetMs, beatIndex: beat.index };
    }
    if (tile !== beat.target) {
      this.recordMiss(false);
      return { outcome: "miss", offsetMs, beatIndex: beat.index };
    }

    this.accurateTotal += 1;
    this.distanceTotal += 1;
    this.comboTotal += 1;
    this.bestComboTotal = Math.max(this.bestComboTotal, this.comboTotal);
    if (timing === "perfect") {
      this.perfectTotal += 1;
      this.scoreTotal += 120 + Math.min(80, this.comboTotal * 5);
    } else {
      this.goodTotal += 1;
      this.scoreTotal += 75 + Math.min(45, this.comboTotal * 3);
    }
    return { outcome: timing, offsetMs, beatIndex: beat.index };
  }

  payout(): MinigamePayout {
    const score = Math.max(
      0,
      Math.floor(this.scoreTotal + this.distanceTotal * 20 + this.accuracy * 500),
    );
    return {
      score,
      coins: Math.min(45, Math.floor(score / 240)),
      xp: Math.min(95, Math.floor(score / 95) + this.bestComboTotal),
    };
  }

  private recordMiss(incrementAttempt = true): void {
    if (incrementAttempt) this.attemptsTotal += 1;
    this.comboTotal = 0;
    this.missTotal += 1;
  }
}
