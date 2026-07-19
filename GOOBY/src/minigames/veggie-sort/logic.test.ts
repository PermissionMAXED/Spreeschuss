import { describe, expect, it } from "vitest";
import {
  INITIAL_SORT_STATE,
  acceptedSortDirections,
  activateReverseFrenzy,
  applySort,
  conveyorSpeedAt,
  expectedSortDirection,
  sortWindowAt,
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

  it("accepts either destination for a two-category mixed crate", () => {
    const mixed: SortItem = {
      id: "mixed",
      label: "Veg + Fruit",
      emoji: "🥕🍎",
      category: "vegetable",
      categories: ["vegetable", "fruit"],
    };

    expect(acceptedSortDirections(mixed, false)).toEqual(["left", "right"]);
    expect(applySort(INITIAL_SORT_STATE, mixed, "left").correct).toBe(true);
    expect(applySort(INITIAL_SORT_STATE, mixed, "right").correct).toBe(true);
    expect(applySort(INITIAL_SORT_STATE, mixed, "up")).toMatchObject({
      correct: false,
      gentleMisdrop: true,
      mistakes: 1,
    });
  });

  it("awards a market star every five uninterrupted correct sorts", () => {
    let state = { ...INITIAL_SORT_STATE };
    for (let index = 0; index < 5; index += 1) state = applySort(state, carrot, "left");

    expect(state).toMatchObject({ streak: 5, marketStars: 1, score: 950 });
  });

  it("uses a monotonic bounded conveyor curve based only on active time", () => {
    expect(conveyorSpeedAt(0)).toBe(1);
    expect(conveyorSpeedAt(35)).toBeGreaterThan(conveyorSpeedAt(10));
    expect(conveyorSpeedAt(10_000)).toBe(2.2);
    expect(sortWindowAt(35)).toBeLessThan(sortWindowAt(0));
    expect(sortWindowAt(10_000)).toBeCloseTo(4.6 / 2.2);
  });
});
