import { describe, expect, it } from "vitest";
import { SeededRng } from "../../core/contracts/rng";
import {
  OPPOSITE_POSE,
  POSE_IDS,
  extendPoseSequence,
  goobySaysPayout,
  posesForDifficulty,
  roundRuleFor,
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
    expect(Object.values(first).sort()).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(first).not.toEqual({
      wave: 0,
      hop: 1,
      wiggle: 2,
      clap: 3,
      freeze: 4,
      stretch: 5,
      curl: 6,
      stomp: 7,
    });
  });

  it("exposes eight distinct poses and scales the active set by difficulty", () => {
    expect(POSE_IDS).toHaveLength(8);
    expect(new Set(POSE_IDS).size).toBe(8);
    expect(posesForDifficulty(1)).toHaveLength(4);
    expect(posesForDifficulty(2)).toHaveLength(6);
    expect(posesForDifficulty(3)).toEqual(POSE_IDS);
  });

  it("uses explicit symmetric opposites only on expert every-third rounds", () => {
    for (const pose of POSE_IDS) expect(OPPOSITE_POSE[OPPOSITE_POSE[pose]]).toBe(pose);
    expect(roundRuleFor(2, 3)).toBe("normal");
    expect(roundRuleFor(3, 2)).toBe("normal");
    expect(roundRuleFor(3, 3)).toBe("opposite");

    expect(verifyPoseInput(["hop"], 0, "stomp", "opposite")).toEqual({
      status: "round-complete",
      nextIndex: 1,
    });
    expect(verifyPoseInput(["hop"], 0, "hop", "opposite")).toEqual({
      status: "mistake",
      nextIndex: 0,
      expected: "stomp",
    });
  });

  it("keeps practice scores visible while making settlement rewards zero", () => {
    expect(goobySaysPayout(2_400, 5, true)).toEqual({
      score: 2_400,
      coins: 0,
      xp: 0,
    });
    expect(goobySaysPayout(2_400, 5, false)).toEqual({
      score: 2_400,
      coins: 10,
      xp: 23,
    });
  });
});
