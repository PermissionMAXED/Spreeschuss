import { describe, expect, it } from "vitest";
import { SeededRng } from "../../core/contracts/rng";
import {
  extendPoseSequence,
  shuffledPoseColors,
  verifyPoseInput,
  type PoseId,
} from "./logic";

function generated(seed: number, length: number): readonly PoseId[] {
  const rng = new SeededRng(seed);
  let sequence: readonly PoseId[] = [];
  for (let index = 0; index < length; index += 1) {
    sequence = extendPoseSequence(sequence, rng);
  }
  return sequence;
}

describe("Gooby Says sequence rules", () => {
  it("generates a deterministic growing sequence without triple repeats", () => {
    const first = generated(8128, 40);
    const replay = generated(8128, 40);

    expect(first).toEqual(replay);
    expect(first).toHaveLength(40);
    for (let index = 2; index < first.length; index += 1) {
      expect(first[index] === first[index - 1] && first[index] === first[index - 2]).toBe(false);
    }
  });

  it("verifies progress, completion, and mistakes at the exact input index", () => {
    const sequence = ["wave", "hop", "clap"] as const;

    expect(verifyPoseInput(sequence, 0, "wave")).toEqual({ status: "continue", nextIndex: 1 });
    expect(verifyPoseInput(sequence, 2, "clap")).toEqual({ status: "round-complete", nextIndex: 3 });
    expect(verifyPoseInput(sequence, 1, "wiggle")).toEqual({
      status: "mistake",
      nextIndex: 1,
      expected: "hop",
    });
  });

  it("deterministically changes every unchanged color map", () => {
    const first = shuffledPoseColors(new SeededRng(3));
    const replay = shuffledPoseColors(new SeededRng(3));
    expect(first).toEqual(replay);
    expect(Object.values(first).sort()).toEqual([0, 1, 2, 3]);
    expect(first).not.toEqual({ wave: 0, hop: 1, wiggle: 2, clap: 3 });
  });
});
