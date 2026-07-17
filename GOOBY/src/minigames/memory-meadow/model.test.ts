import { describe, expect, it } from "vitest";
import { SeededRng } from "../../core/contracts/rng";
import {
  MEADOW_CONFIGS,
  MemoryMeadowRound,
  createMeadowBoard,
  isValidMeadowBoard,
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

    expect(round.beginDandelionShuffle()).toBe(true);
    expect(round.board.filter(({ matched }) => !matched).every(({ faceUp }) => faceUp)).toBe(true);
    round.update(1.36);
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

  it("awards no stars, score, or time bonus for an unfinished board", () => {
    const fresh = new MemoryMeadowRound(1, new SeededRng(12));
    expect(fresh.result()).toMatchObject({ stars: 0, score: 0, moves: 0 });

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
      expect(round.beginDandelionShuffle()).toBe(true);
      round.update(1.36);
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
