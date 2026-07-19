import { describe, expect, it } from "vitest";
import { SeededRng } from "../../core/contracts/rng";
import {
  BREEZE_PEEK_SECONDS,
  BREEZE_REVEAL_SPAN_SECONDS,
  MEADOW_CONFIGS,
  MemoryMeadowRound,
  SERENE_STREAK_BONUS,
  createMeadowBoard,
  isValidMeadowBoard,
  meadowPayout,
  type MeadowDifficulty,
} from "./model";

describe("Memory Meadow board", () => {
  it.each([1, 2, 3] as const)("builds a valid deterministic tier-%i board", (difficulty) => {
    const first = createMeadowBoard(difficulty, new SeededRng(2026));
    const replay = createMeadowBoard(difficulty, new SeededRng(2026));
    expect(first).toEqual(replay);
    expect(first).toHaveLength(
      MEADOW_CONFIGS[difficulty].columns * MEADOW_CONFIGS[difficulty].rows,
    );
    expect(isValidMeadowBoard(first, difficulty)).toBe(true);
  });

  it("keeps the hard tier on a portrait-friendly 4x4 board with two trios", () => {
    const hard = MEADOW_CONFIGS[3];
    expect(hard.columns).toBe(4);
    expect(hard.rows).toBe(4);
    expect(hard.trioGroups).toBe(2);
    expect(hard.pairGroups * 2 + hard.trioGroups * 3).toBe(16);
    expect(createMeadowBoard(3, new SeededRng(9))).toHaveLength(16);
  });

  it("reveals breeze cards on a deterministic staggered schedule", () => {
    const playToBreeze = (seed: number): MemoryMeadowRound => {
      const round = new MemoryMeadowRound(1, new SeededRng(seed));
      const symbols = [...new Set(round.board.map(({ symbol }) => symbol))].slice(0, 3);
      for (const symbol of symbols) {
        const cards = round.board.filter((card) => card.symbol === symbol);
        expect(round.flip(cards[0]?.id ?? "").accepted).toBe(true);
        expect(round.flip(cards[1]?.id ?? "").match).toBe(true);
      }
      expect(round.shouldShuffle).toBe(true);
      return round;
    };

    const round = playToBreeze(84);
    const replay = playToBreeze(84);
    const events = round.beginDandelionShuffle();
    expect(events).toEqual(replay.beginDandelionShuffle());
    expect(events.map(({ order }) => order)).toEqual(events.map((_, index) => index));
    expect(new Set(events.map(({ cardId }) => cardId)).size).toBe(events.length);
    expect(events).toHaveLength(round.board.filter(({ matched }) => !matched).length);
    expect(events[0]?.atSeconds).toBe(0);
    expect(events.at(-1)?.atSeconds).toBeCloseTo(BREEZE_REVEAL_SPAN_SECONDS, 3);
    expect(round.breezeEvents).toEqual(events);

    // Only the first reveal fires immediately; the rest land as time passes.
    const faceUpIds = (): string[] =>
      round.board.filter(({ faceUp, matched }) => faceUp && !matched).map(({ id }) => id);
    expect(faceUpIds()).toEqual([events[0]?.cardId]);
    const half = events.filter(({ atSeconds }) => atSeconds <= BREEZE_REVEAL_SPAN_SECONDS / 2);
    round.update(BREEZE_REVEAL_SPAN_SECONDS / 2 + 0.001);
    expect([...faceUpIds()].sort()).toEqual(half.map(({ cardId }) => cardId).sort());
    round.update(BREEZE_REVEAL_SPAN_SECONDS / 2);
    expect(round.board.filter(({ matched }) => !matched).every(({ faceUp }) => faceUp)).toBe(true);
  });

  it("keeps matched slots fixed while visibly shuffling unmatched cards", () => {
    const round = new MemoryMeadowRound(1, new SeededRng(84));
    const symbols = [...new Set(round.board.map(({ symbol }) => symbol))].slice(0, 3);
    for (const symbol of symbols) {
      const cards = round.board.filter((card) => card.symbol === symbol);
      expect(round.flip(cards[0]?.id ?? "").accepted).toBe(true);
      expect(round.flip(cards[1]?.id ?? "").match).toBe(true);
    }

    expect(round.shouldShuffle).toBe(true);
    const before = round.board.map(({ id }) => id);
    const matchedSlots = round.board
      .map((card, index) => ({ card, index }))
      .filter(({ card }) => card.matched)
      .map(({ index }) => index);

    expect(round.beginDandelionShuffle().length).toBeGreaterThan(0);
    round.update(BREEZE_REVEAL_SPAN_SECONDS + 0.01);
    expect(round.board.filter(({ matched }) => !matched).every(({ faceUp }) => faceUp)).toBe(true);
    round.update(BREEZE_PEEK_SECONDS);
    const after = round.board.map(({ id }) => id);

    expect(after).not.toEqual(before);
    for (const index of matchedSlots) expect(after[index]).toBe(before[index]);
    expect(round.board.filter(({ matched }) => !matched).every(({ faceUp }) => !faceUp)).toBe(true);
    expect(isValidMeadowBoard(round.board, 1)).toBe(true);
  });

  it("requires all three special cards and supports a complete tier-3 win", () => {
    const round = new MemoryMeadowRound(3, new SeededRng(431));
    const trioSymbol = round.board.find(({ kind }) => kind === "trio")?.symbol;
    expect(trioSymbol).toBeDefined();
    const trio = round.board.filter(({ symbol }) => symbol === trioSymbol);
    expect(round.flip(trio[0]?.id ?? "").waitingForTrio).toBe(false);
    expect(round.flip(trio[1]?.id ?? "").waitingForTrio).toBe(true);
    expect(round.matchedGroups).toBe(0);
    expect(round.flip(trio[2]?.id ?? "").match).toBe(true);
    expect(round.matchedGroups).toBe(1);

    solveRound(round, 3);
    expect(round.isComplete).toBe(true);
    expect(round.matchedGroups).toBe(round.totalGroups);
    expect(round.result().stars).toBe(3);
  });

  it("grows a serene streak on clean matches and resets it on a mismatch", () => {
    const round = new MemoryMeadowRound(1, new SeededRng(311));
    const symbols = [...new Set(round.board.map(({ symbol }) => symbol))];
    const matchSymbol = (symbol: string): void => {
      const cards = round.board.filter((card) => card.symbol === symbol && !card.matched);
      for (const card of cards) round.flip(card.id);
    };

    matchSymbol(symbols[0] ?? "");
    matchSymbol(symbols[1] ?? "");
    expect(round.sereneStreak).toBe(2);
    expect(round.bestSereneStreak).toBe(2);
    expect(round.sereneBonus).toBe(SERENE_STREAK_BONUS);

    // A deliberate mismatch breaks the calm.
    const first = round.board.find(({ matched, faceUp }) => !matched && !faceUp);
    const other = round.board.find(
      ({ matched, faceUp, symbol }) => !matched && !faceUp && symbol !== first?.symbol,
    );
    expect(round.flip(first?.id ?? "").accepted).toBe(true);
    expect(round.flip(other?.id ?? "").match).toBe(false);
    expect(round.sereneStreak).toBe(0);
    expect(round.bestSereneStreak).toBe(2);
    expect(round.sereneBonus).toBe(SERENE_STREAK_BONUS);
  });

  it("adds the serene bonus to a winning score and reports it in the result", () => {
    const flawless = new MemoryMeadowRound(1, new SeededRng(77));
    solveRound(flawless, 1);
    const result = flawless.result();
    expect(result.bestSereneStreak).toBe(flawless.totalGroups);
    expect(result.sereneBonus).toBe(
      SERENE_STREAK_BONUS * ((flawless.totalGroups * (flawless.totalGroups - 1)) / 2),
    );
    expect(result.score).toBeGreaterThan(0);
    const payout = meadowPayout(result, 1);
    expect(payout.score).toBe(result.score);
    expect(payout.coins).toBe(result.stars * 6 + 3);
  });

  it("awards no stars, score, or time bonus for an unfinished board", () => {
    const fresh = new MemoryMeadowRound(1, new SeededRng(12));
    expect(fresh.result()).toMatchObject({ stars: 0, score: 0, moves: 0, sereneBonus: 0 });
    expect(meadowPayout(fresh.result(), 1)).toEqual({ score: 0, coins: 0, xp: 0 });

    const timedOut = new MemoryMeadowRound(1, new SeededRng(12));
    const first = timedOut.board[0];
    const group = timedOut.board.filter(({ symbol }) => symbol === first?.symbol);
    for (const card of group) timedOut.flip(card.id);
    expect(timedOut.matchedGroups).toBe(1);
    timedOut.update(MEADOW_CONFIGS[1].timeLimitSeconds + 1);
    expect(timedOut.isOutOfTime).toBe(true);
    expect(timedOut.result()).toMatchObject({ stars: 0, score: 0 });
  });
});

function solveRound(round: MemoryMeadowRound, difficulty: MeadowDifficulty): void {
  const config = MEADOW_CONFIGS[difficulty];
  while (!round.isComplete) {
    if (round.shouldShuffle) {
      expect(round.beginDandelionShuffle().length).toBeGreaterThan(0);
      round.update(BREEZE_PEEK_SECONDS + 0.01);
    }
    const next = round.board.find(({ matched }) => !matched);
    if (next === undefined) break;
    const group = round.board.filter(({ symbol, matched }) => symbol === next.symbol && !matched);
    const expectedSize = next.kind === "trio" ? 3 : 2;
    expect(group).toHaveLength(expectedSize);
    for (const card of group) round.flip(card.id);
  }
  expect(round.moves).toBe(config.pairGroups + config.trioGroups);
}
