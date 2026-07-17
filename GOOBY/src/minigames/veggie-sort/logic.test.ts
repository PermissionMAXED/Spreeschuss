import { describe, expect, it } from "vitest";
import {
  INITIAL_SORT_STATE,
  activateReverseFrenzy,
  applySort,
  expectedSortDirection,
  type SortItem,
} from "./logic";

const carrot: SortItem = {
  id: "carrot",
  label: "Carrot",
  emoji: "🥕",
  category: "vegetable",
};
const apple: SortItem = {
  id: "apple",
  label: "Apple",
  emoji: "🍎",
  category: "fruit",
};
const sock: SortItem = {
  id: "sock",
  label: "Sock",
  emoji: "🧦",
  category: "nonfood",
};

describe("Veggie Sort rules", () => {
  it("sorts vegetables left, fruit right, and non-food up", () => {
    expect(applySort(INITIAL_SORT_STATE, carrot, "left").correct).toBe(true);
    expect(applySort(INITIAL_SORT_STATE, apple, "right").correct).toBe(true);
    expect(applySort(INITIAL_SORT_STATE, sock, "up").correct).toBe(true);
  });

  it("reverses only fruit and vegetable directions during frenzy", () => {
    const frenzy = activateReverseFrenzy(INITIAL_SORT_STATE, 2);
    expect(expectedSortDirection("vegetable", true)).toBe("right");
    expect(expectedSortDirection("fruit", true)).toBe("left");
    expect(expectedSortDirection("nonfood", true)).toBe("up");

    const first = applySort(frenzy, carrot, "right");
    expect(first).toMatchObject({ correct: true, reverseFrenzy: true, frenzyRemaining: 1 });
    const second = applySort(first, apple, "left");
    expect(second).toMatchObject({ correct: true, reverseFrenzy: false, frenzyRemaining: 0 });
  });

  it("ends exactly on the third mistake and resets the streak", () => {
    const first = applySort({ ...INITIAL_SORT_STATE, streak: 7, multiplier: 2 }, carrot, "right");
    const second = applySort(first, apple, "left");
    const third = applySort(second, sock, "left");

    expect(first).toMatchObject({ mistakes: 1, streak: 0, multiplier: 1, ended: false });
    expect(second).toMatchObject({ mistakes: 2, ended: false });
    expect(third).toMatchObject({ mistakes: 3, ended: true });
  });

  it("ramps the streak multiplier every four correct sorts", () => {
    let state = { ...INITIAL_SORT_STATE };
    for (let index = 0; index < 4; index += 1) state = applySort(state, carrot, "left");
    expect(state).toMatchObject({ streak: 4, multiplier: 2, score: 500 });
  });
});
