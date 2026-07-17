import { describe, expect, it } from "vitest";
import { SeededRng } from "../src/core/contracts/rng";

describe("SeededRng", () => {
  it("replays the same stream for the same seed", () => {
    const first = new SeededRng(42);
    const second = new SeededRng(42);
    expect(Array.from({ length: 20 }, () => first.next())).toEqual(
      Array.from({ length: 20 }, () => second.next()),
    );
  });

  it("keeps integer samples inside the requested range", () => {
    const rng = new SeededRng(7);
    const samples = Array.from({ length: 100 }, () => rng.int(-2, 4));
    expect(samples.every((value) => value >= -2 && value < 4 && Number.isInteger(value))).toBe(true);
  });
});
