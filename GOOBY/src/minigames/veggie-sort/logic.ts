export type SortCategory = "vegetable" | "fruit" | "nonfood";
export type SortDirection = "left" | "right" | "up";

export interface SortItem {
  readonly id: string;
  readonly label: string;
  readonly emoji: string;
  readonly category: SortCategory;
}

export interface SortState {
  readonly score: number;
  readonly streak: number;
  readonly multiplier: number;
  readonly mistakes: number;
  readonly totalCorrect: number;
  readonly reverseFrenzy: boolean;
  readonly frenzyRemaining: number;
}

export interface SortResult extends SortState {
  readonly correct: boolean;
  readonly expected: SortDirection;
  readonly ended: boolean;
}

export const INITIAL_SORT_STATE: SortState = {
  score: 0,
  streak: 0,
  multiplier: 1,
  mistakes: 0,
  totalCorrect: 0,
  reverseFrenzy: false,
  frenzyRemaining: 0,
};

export function expectedSortDirection(
  category: SortCategory,
  reverseFrenzy: boolean,
): SortDirection {
  if (category === "nonfood") return "up";
  if (reverseFrenzy) return category === "vegetable" ? "right" : "left";
  return category === "vegetable" ? "left" : "right";
}

export function activateReverseFrenzy(state: SortState, itemCount = 6): SortState {
  if (!Number.isInteger(itemCount) || itemCount <= 0) {
    throw new RangeError("Reverse frenzy needs at least one item");
  }
  return { ...state, reverseFrenzy: true, frenzyRemaining: itemCount };
}

export function applySort(
  state: SortState,
  item: SortItem,
  direction: SortDirection | null,
): SortResult {
  const expected = expectedSortDirection(item.category, state.reverseFrenzy);
  const correct = direction === expected;
  if (!correct) {
    const mistakes = Math.min(3, state.mistakes + 1);
    return {
      ...state,
      score: Math.max(0, state.score - 40),
      streak: 0,
      multiplier: 1,
      mistakes,
      correct: false,
      expected,
      ended: mistakes >= 3,
    };
  }

  const streak = state.streak + 1;
  const multiplier = Math.min(5, 1 + Math.floor(streak / 4));
  const frenzyRemaining = state.reverseFrenzy
    ? Math.max(0, state.frenzyRemaining - 1)
    : 0;

  return {
    ...state,
    score: state.score + 100 * multiplier,
    streak,
    multiplier,
    totalCorrect: state.totalCorrect + 1,
    reverseFrenzy: frenzyRemaining > 0,
    frenzyRemaining,
    correct: true,
    expected,
    ended: false,
  };
}
