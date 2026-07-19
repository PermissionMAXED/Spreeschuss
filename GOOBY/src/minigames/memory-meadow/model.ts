import type { MinigamePayout } from "../../core/contracts/minigame";
import type { RandomSource } from "../../core/contracts/rng";

export type MeadowDifficulty = 1 | 2 | 3;
export type MeadowCardKind = "pair" | "trio";

export interface MeadowCard {
  readonly id: string;
  readonly symbol: string;
  readonly kind: MeadowCardKind;
  readonly matched: boolean;
  readonly faceUp: boolean;
}

export interface MeadowConfig {
  readonly columns: number;
  readonly rows: number;
  readonly timeLimitSeconds: number;
  readonly parMoves: number;
  readonly pairGroups: number;
  readonly trioGroups: number;
}

export const MEADOW_CONFIGS: Readonly<Record<MeadowDifficulty, MeadowConfig>> = {
  1: {
    columns: 4,
    rows: 3,
    timeLimitSeconds: 70,
    parMoves: 9,
    pairGroups: 6,
    trioGroups: 0,
  },
  2: {
    columns: 4,
    rows: 4,
    timeLimitSeconds: 90,
    parMoves: 12,
    pairGroups: 8,
    trioGroups: 0,
  },
  3: {
    columns: 4,
    rows: 4,
    timeLimitSeconds: 95,
    parMoves: 11,
    pairGroups: 5,
    trioGroups: 2,
  },
};

const FLOWERS = ["🌻", "🌷", "🌼", "🌸", "🪻", "🌹", "🌺", "🪷", "🍀"] as const;
const SPECIALS = ["✨", "🦋"] as const;

/** The breeze peek keeps its historical length so round pacing is unchanged. */
export const BREEZE_PEEK_SECONDS = 1.35;
/** All breeze reveals land inside this span, leaving a settled look-window. */
export const BREEZE_REVEAL_SPAN_SECONDS = 0.72;
/** Score added per extra consecutive match in a serene streak. */
export const SERENE_STREAK_BONUS = 45;

/**
 * One card reveal inside the dandelion breeze. The full event list is derived
 * only from the injected RNG, so a seeded round replays the exact same reveal
 * order and timing.
 */
export interface BreezeRevealEvent {
  readonly order: number;
  readonly cardId: string;
  readonly atSeconds: number;
}

interface MutableMeadowCard {
  readonly id: string;
  readonly symbol: string;
  readonly kind: MeadowCardKind;
  matched: boolean;
  faceUp: boolean;
}

export interface FlipResult {
  readonly accepted: boolean;
  readonly match: boolean;
  readonly waitingForTrio: boolean;
  readonly completed: boolean;
  readonly shuffleReady: boolean;
}

export interface MeadowResult {
  readonly stars: 0 | 1 | 2 | 3;
  readonly score: number;
  readonly elapsedSeconds: number;
  readonly moves: number;
  readonly bestSereneStreak: number;
  readonly sereneBonus: number;
}

function shuffled<T>(values: readonly T[], rng: RandomSource): T[] {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = rng.int(0, index + 1);
    const value = result[index] as T;
    result[index] = result[swapIndex] as T;
    result[swapIndex] = value;
  }
  return result;
}

export function createMeadowBoard(difficulty: MeadowDifficulty, rng: RandomSource): MeadowCard[] {
  const config = MEADOW_CONFIGS[difficulty];
  const cards: MutableMeadowCard[] = [];

  for (let group = 0; group < config.pairGroups; group += 1) {
    const symbol = FLOWERS[group] as string;
    for (let copy = 0; copy < 2; copy += 1) {
      cards.push({
        id: `pair-${group}-${copy}`,
        symbol,
        kind: "pair",
        matched: false,
        faceUp: false,
      });
    }
  }

  for (let group = 0; group < config.trioGroups; group += 1) {
    const symbol = SPECIALS[group] as string;
    for (let copy = 0; copy < 3; copy += 1) {
      cards.push({
        id: `trio-${group}-${copy}`,
        symbol,
        kind: "trio",
        matched: false,
        faceUp: false,
      });
    }
  }

  return shuffled(cards, rng);
}

export function isValidMeadowBoard(cards: readonly MeadowCard[], difficulty: MeadowDifficulty): boolean {
  const config = MEADOW_CONFIGS[difficulty];
  if (cards.length !== config.columns * config.rows) return false;
  if (new Set(cards.map(({ id }) => id)).size !== cards.length) return false;

  const groups = new Map<string, { count: number; kind: MeadowCardKind }>();
  for (const card of cards) {
    const existing = groups.get(card.symbol);
    if (existing !== undefined && existing.kind !== card.kind) return false;
    groups.set(card.symbol, { count: (existing?.count ?? 0) + 1, kind: card.kind });
  }

  const pairs = [...groups.values()].filter(({ kind, count }) => kind === "pair" && count === 2).length;
  const trios = [...groups.values()].filter(({ kind, count }) => kind === "trio" && count === 3).length;
  return pairs === config.pairGroups && trios === config.trioGroups;
}

/** A completed round pays out; anything else collects nothing. */
export function meadowPayout(result: MeadowResult, difficulty: MeadowDifficulty): MinigamePayout {
  if (result.stars === 0) return { score: 0, coins: 0, xp: 0 };
  return {
    score: result.score,
    coins: result.stars * 6 + difficulty * 3,
    xp: Math.max(1, Math.floor(result.score / 90)),
  };
}

export class MemoryMeadowRound {
  private cards: MutableMeadowCard[];
  private readonly selectedIds: string[] = [];
  private mismatchSeconds = 0;
  private peekSeconds = 0;
  private shuffleArmed = false;
  private shuffleUsed = false;
  private groupsMatched = 0;
  private elapsed = 0;
  private moveCount = 0;
  private streak = 0;
  private bestStreak = 0;
  private streakBonus = 0;
  private breezeRevealEvents: BreezeRevealEvent[] = [];
  private breezeRevealCursor = 0;

  public readonly difficulty: MeadowDifficulty;
  private readonly rng: RandomSource;

  public constructor(difficulty: MeadowDifficulty, rng: RandomSource) {
    this.difficulty = difficulty;
    this.rng = rng;
    this.cards = createMeadowBoard(difficulty, rng).map((card) => ({ ...card }));
  }

  get board(): readonly MeadowCard[] {
    return this.cards;
  }

  get moves(): number {
    return this.moveCount;
  }

  get elapsedSeconds(): number {
    return this.elapsed;
  }

  get remainingSeconds(): number {
    return Math.max(0, MEADOW_CONFIGS[this.difficulty].timeLimitSeconds - this.elapsed);
  }

  get matchedGroups(): number {
    return this.groupsMatched;
  }

  get totalGroups(): number {
    const config = MEADOW_CONFIGS[this.difficulty];
    return config.pairGroups + config.trioGroups;
  }

  get isBusy(): boolean {
    return this.mismatchSeconds > 0 || this.peekSeconds > 0 || this.shuffleArmed;
  }

  get isComplete(): boolean {
    return this.groupsMatched === this.totalGroups;
  }

  get isOutOfTime(): boolean {
    return this.remainingSeconds <= 0;
  }

  get shouldShuffle(): boolean {
    return this.shuffleArmed;
  }

  /** Consecutive matched groups since the last mismatch. */
  get sereneStreak(): number {
    return this.streak;
  }

  get bestSereneStreak(): number {
    return this.bestStreak;
  }

  get sereneBonus(): number {
    return this.streakBonus;
  }

  /** The reveal schedule of the most recent dandelion breeze. */
  get breezeEvents(): readonly BreezeRevealEvent[] {
    return this.breezeRevealEvents;
  }

  flip(cardId: string): FlipResult {
    const card = this.cards.find(({ id }) => id === cardId);
    if (
      card === undefined ||
      card.matched ||
      card.faceUp ||
      this.isBusy ||
      this.isComplete ||
      this.isOutOfTime
    ) {
      return {
        accepted: false,
        match: false,
        waitingForTrio: false,
        completed: this.isComplete,
        shuffleReady: this.shuffleArmed,
      };
    }

    card.faceUp = true;
    this.selectedIds.push(card.id);
    const selected = this.selectedCards();
    const first = selected[0];
    if (first === undefined) throw new Error("A flipped card must be selected");

    if (selected.some(({ symbol }) => symbol !== first.symbol)) {
      this.moveCount += 1;
      this.streak = 0;
      this.mismatchSeconds = 0.72;
      return {
        accepted: true,
        match: false,
        waitingForTrio: false,
        completed: false,
        shuffleReady: false,
      };
    }

    const required = first.kind === "trio" ? 3 : 2;
    if (selected.length < required) {
      return {
        accepted: true,
        match: false,
        waitingForTrio: first.kind === "trio" && selected.length === 2,
        completed: false,
        shuffleReady: false,
      };
    }

    for (const matchedCard of selected) {
      matchedCard.matched = true;
    }
    this.selectedIds.length = 0;
    this.moveCount += 1;
    this.groupsMatched += 1;
    this.streak += 1;
    this.bestStreak = Math.max(this.bestStreak, this.streak);
    if (this.streak >= 2) this.streakBonus += (this.streak - 1) * SERENE_STREAK_BONUS;

    const halfway = Math.ceil(this.totalGroups / 2);
    if (!this.shuffleUsed && this.groupsMatched >= halfway && !this.isComplete) {
      this.shuffleArmed = true;
    }

    return {
      accepted: true,
      match: true,
      waitingForTrio: false,
      completed: this.isComplete,
      shuffleReady: this.shuffleArmed,
    };
  }

  /**
   * Starts the dandelion breeze and returns its deterministic reveal schedule.
   * Cards flip face-up one by one as `update` crosses each event time; the
   * settled board is then concealed and relocated in one deterministic step.
   */
  beginDandelionShuffle(): readonly BreezeRevealEvent[] {
    if (!this.shuffleArmed) return [];
    this.shuffleArmed = false;
    this.shuffleUsed = true;
    this.peekSeconds = BREEZE_PEEK_SECONDS;
    const hidden = this.cards.filter(({ matched }) => !matched);
    const revealOrder = shuffled(hidden, this.rng);
    const step =
      revealOrder.length > 1 ? BREEZE_REVEAL_SPAN_SECONDS / (revealOrder.length - 1) : 0;
    this.breezeRevealEvents = revealOrder.map((revealCard, index) => ({
      order: index,
      cardId: revealCard.id,
      atSeconds: Number((index * step).toFixed(4)),
    }));
    this.breezeRevealCursor = 0;
    this.applyBreezeReveals(0);
    return this.breezeRevealEvents;
  }

  update(deltaSeconds: number): void {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) {
      throw new RangeError("Memory Meadow delta must be finite and non-negative");
    }
    if (!this.isComplete && !this.isOutOfTime) this.elapsed += deltaSeconds;

    if (this.mismatchSeconds > 0) {
      this.mismatchSeconds -= deltaSeconds;
      if (this.mismatchSeconds <= 0) this.concealSelection();
    }

    if (this.peekSeconds > 0) {
      this.peekSeconds -= deltaSeconds;
      this.applyBreezeReveals(BREEZE_PEEK_SECONDS - Math.max(0, this.peekSeconds));
      if (this.peekSeconds <= 0) this.completeDandelionShuffle();
    }
  }

  result(): MeadowResult {
    const config = MEADOW_CONFIGS[this.difficulty];
    if (!this.isComplete) {
      return {
        stars: 0,
        score: 0,
        elapsedSeconds: this.elapsed,
        moves: this.moveCount,
        bestSereneStreak: this.bestStreak,
        sereneBonus: 0,
      };
    }
    const withinGoldTime = this.elapsed <= config.timeLimitSeconds * 0.68;
    const withinSilverTime = this.elapsed <= config.timeLimitSeconds * 0.9;
    let stars: 1 | 2 | 3 = 1;
    if (withinGoldTime && this.moveCount <= config.parMoves) stars = 3;
    else if (withinSilverTime && this.moveCount <= Math.ceil(config.parMoves * 1.5)) {
      stars = 2;
    }

    const speedBonus = Math.floor(this.remainingSeconds * 18);
    const moveBonus = Math.max(0, config.parMoves * 2 - this.moveCount) * 45;
    const score =
      stars * 750 + speedBonus + moveBonus + this.streakBonus + 500 + this.difficulty * 250;
    return {
      stars,
      score,
      elapsedSeconds: this.elapsed,
      moves: this.moveCount,
      bestSereneStreak: this.bestStreak,
      sereneBonus: this.streakBonus,
    };
  }

  private selectedCards(): MutableMeadowCard[] {
    return this.selectedIds.map((id) => {
      const card = this.cards.find((candidate) => candidate.id === id);
      if (card === undefined) throw new Error(`Selected card ${id} is missing`);
      return card;
    });
  }

  private concealSelection(): void {
    for (const card of this.selectedCards()) {
      if (!card.matched) card.faceUp = false;
    }
    this.selectedIds.length = 0;
    this.mismatchSeconds = 0;
  }

  private applyBreezeReveals(breezeElapsedSeconds: number): void {
    while (this.breezeRevealCursor < this.breezeRevealEvents.length) {
      const event = this.breezeRevealEvents[this.breezeRevealCursor];
      if (event === undefined || event.atSeconds > breezeElapsedSeconds + 0.000_1) return;
      const card = this.cards.find(({ id }) => id === event.cardId);
      if (card !== undefined && !card.matched) card.faceUp = true;
      this.breezeRevealCursor += 1;
    }
  }

  private completeDandelionShuffle(): void {
    this.applyBreezeReveals(Number.POSITIVE_INFINITY);
    const openSlots = this.cards
      .map((card, index) => ({ card, index }))
      .filter(({ card }) => !card.matched);
    const shuffledCards = shuffled(
      openSlots.map(({ card }) => card),
      this.rng,
    );
    const nextCards = [...this.cards];
    openSlots.forEach(({ index }, openIndex) => {
      const card = shuffledCards[openIndex];
      if (card === undefined) throw new Error("Shuffle produced an incomplete board");
      card.faceUp = false;
      nextCards[index] = card;
    });
    this.cards = nextCards;
    this.peekSeconds = 0;
  }
}
