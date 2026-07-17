import type { RandomSource } from "../../core/contracts/rng";

export const POSE_IDS = ["wave", "hop", "wiggle", "clap"] as const;
export type PoseId = (typeof POSE_IDS)[number];

export type SequenceCheck =
  | { readonly status: "continue"; readonly nextIndex: number }
  | { readonly status: "round-complete"; readonly nextIndex: number }
  | { readonly status: "mistake"; readonly nextIndex: number; readonly expected: PoseId };

export function extendPoseSequence(
  sequence: readonly PoseId[],
  rng: RandomSource,
): readonly PoseId[] {
  let choices: readonly PoseId[] = POSE_IDS;
  const previous = sequence.at(-1);
  const beforePrevious = sequence.at(-2);
  if (previous && previous === beforePrevious) {
    choices = POSE_IDS.filter((pose) => pose !== previous);
  }
  return [...sequence, rng.pick(choices)];
}

export function verifyPoseInput(
  sequence: readonly PoseId[],
  inputIndex: number,
  pose: PoseId,
): SequenceCheck {
  const expected = sequence[inputIndex];
  if (!expected) throw new RangeError("Input index is outside the sequence");
  if (pose !== expected) return { status: "mistake", nextIndex: inputIndex, expected };
  const nextIndex = inputIndex + 1;
  return nextIndex === sequence.length
    ? { status: "round-complete", nextIndex }
    : { status: "continue", nextIndex };
}

export function shuffledPoseColors(
  rng: RandomSource,
  previous: Readonly<Record<PoseId, number>> = { wave: 0, hop: 1, wiggle: 2, clap: 3 },
): Readonly<Record<PoseId, number>> {
  const values = [0, 1, 2, 3];
  for (let index = values.length - 1; index > 0; index -= 1) {
    const selected = rng.int(0, index + 1);
    const temporary = values[index];
    values[index] = values[selected] as number;
    values[selected] = temporary as number;
  }
  if (POSE_IDS.every((pose, index) => values[index] === previous[pose])) {
    values.push(values.shift() as number);
  }
  return {
    wave: values[0] as number,
    hop: values[1] as number,
    wiggle: values[2] as number,
    clap: values[3] as number,
  };
}
