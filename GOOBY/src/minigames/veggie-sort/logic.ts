import { createDifficultyRamp } from "../shared";

export type SortCategory = "vegetable" | "fruit" | "nonfood";
export type SortDirection = "left" | "right" | "up";

export interface SortItem {
  readonly id: string;
  readonly label: string;
  readonly emoji: string;
  readonly category: SortCategory;
  /** Mixed crates accept either of exactly two represented categories. */
  readonly categories?: readonly [SortCategory, SortCategory];
}

export interface SortState {
  readonly score: number;
  readonly streak: number;
  readonly multiplier: number;
  readonly mistakes: number;
  readonly totalCorrect: number;
  readonly marketStars: number;
  readonly reverseFrenzy: boolean;
  readonly frenzyRemaining: number;
}

export interface SortResult extends SortState {
  readonly correct: boolean;
  readonly expected: SortDirection;
  readonly accepted: readonly SortDirection[];
  readonly starAwarded: boolean;
  readonly gentleMisdrop: boolean;
  readonly ended: boolean;
}

export const INITIAL_SORT_STATE: SortState = {
  score: 0,
  streak: 0,
  multiplier: 1,
  mistakes: 0,
  totalCorrect: 0,
  marketStars: 0,
  reverseFrenzy: false,
  frenzyRemaining: 0,
};

const conveyorRamp = createDifficultyRamp({
  rampSeconds: 70,
  startIntensity: 0,
  maxIntensity: 1,
  shape: "smoothstep",
});

/** Monotonic active-play speed; callers must not feed paused wall time. */
export function conveyorSpeedAt(activeSeconds: number): number {
  return conveyorRamp.valueAt(activeSeconds, 1, 2.2);
}

export function sortWindowAt(activeSeconds: number): number {
  return Math.max(2.05, 4.6 / conveyorSpeedAt(activeSeconds));
}

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

export function sortItemCategories(item: SortItem): readonly SortCategory[] {
  return item.categories ?? [item.category];
}

export function acceptedSortDirections(
  item: SortItem,
  reverseFrenzy: boolean,
): readonly SortDirection[] {
  return [...new Set(sortItemCategories(item).map(
    (category) => expectedSortDirection(category, reverseFrenzy),
  ))];
}

export function applySort(
  state: SortState,
  item: SortItem,
  direction: SortDirection | null,
): SortResult {
  const accepted = acceptedSortDirections(item, state.reverseFrenzy);
  const expected = accepted[0] ?? expectedSortDirection(item.category, state.reverseFrenzy);
  const correct = direction !== null && accepted.includes(direction);
  if (!correct) {
    const mistakes = Math.min(3, state.mistakes + 1);
    return {
      ...state,
      score: Math.max(0, state.score - 25),
      streak: 0,
      multiplier: 1,
      mistakes,
      correct: false,
      expected,
      accepted,
      starAwarded: false,
      gentleMisdrop: true,
      ended: mistakes >= 3,
    };
  }

  const streak = state.streak + 1;
  const multiplier = Math.min(5, 1 + Math.floor(streak / 4));
  const starAwarded = streak % 5 === 0;
  const frenzyRemaining = state.reverseFrenzy
    ? Math.max(0, state.frenzyRemaining - 1)
    : 0;

  return {
    ...state,
    score: state.score + 100 * multiplier + (starAwarded ? 250 : 0),
    streak,
    multiplier,
    totalCorrect: state.totalCorrect + 1,
    marketStars: state.marketStars + (starAwarded ? 1 : 0),
    reverseFrenzy: frenzyRemaining > 0,
    frenzyRemaining,
    correct: true,
    expected,
    accepted,
    starAwarded,
    gentleMisdrop: false,
    ended: false,
  };
}

export function veggiePayout(state: SortState): {
  readonly score: number;
  readonly coins: number;
  readonly xp: number;
} {
  const score = Math.max(0, Math.floor(state.score));
  return {
    score,
    coins: Math.max(1, Math.floor(score / 350) + state.marketStars),
    xp: Math.max(2, Math.floor(score / 140) + state.totalCorrect + state.marketStars * 2),
  };
}
