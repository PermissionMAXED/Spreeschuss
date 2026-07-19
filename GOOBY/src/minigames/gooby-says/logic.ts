import type { RandomSource } from "../../core/contracts/rng";

export const POSE_IDS = [
  "wave",
  "hop",
  "wiggle",
  "clap",
  "freeze",
  "stretch",
  "curl",
  "stomp",
] as const;
export type PoseId = (typeof POSE_IDS)[number];
export type SaysDifficulty = 1 | 2 | 3;
export type PoseRoundRule = "normal" | "opposite";

export const OPPOSITE_POSE: Readonly<Record<PoseId, PoseId>> = {
  wave: "clap",
  clap: "wave",
  hop: "stomp",
  stomp: "hop",
  wiggle: "freeze",
  freeze: "wiggle",
  stretch: "curl",
  curl: "stretch",
};

export function isPoseId(value: string): value is PoseId {
  return (POSE_IDS as readonly string[]).includes(value);
}

export type SequenceCheck =
  | { readonly status: "continue"; readonly nextIndex: number }
  | { readonly status: "round-complete"; readonly nextIndex: number }
  | { readonly status: "mistake"; readonly nextIndex: number; readonly expected: PoseId };

export function extendPoseSequence(
  sequence: readonly PoseId[],
  rng: RandomSource,
  difficulty: SaysDifficulty = 3,
): readonly PoseId[] {
  let choices: readonly PoseId[] = posesForDifficulty(difficulty);
  const previous = sequence.at(-1);
  const beforePrevious = sequence.at(-2);
  if (previous && previous === beforePrevious) {
    choices = POSE_IDS.filter((pose) => pose !== previous);
  }
  return [...sequence, rng.pick(choices)];
}

export function posesForDifficulty(difficulty: SaysDifficulty): readonly PoseId[] {
  if (difficulty === 1) return POSE_IDS.slice(0, 4);
  if (difficulty === 2) return POSE_IDS.slice(0, 6);
  return POSE_IDS;
}

/** Expert difficulty makes every third round an explicitly announced opposite round. */
export function roundRuleFor(difficulty: SaysDifficulty, round: number): PoseRoundRule {
  return difficulty >= 3 && Number.isInteger(round) && round > 0 && round % 3 === 0
    ? "opposite"
    : "normal";
}

export function expectedPoseForRule(pose: PoseId, rule: PoseRoundRule): PoseId {
  return rule === "opposite" ? OPPOSITE_POSE[pose] : pose;
}

export function goobySaysPayout(
  requestedScore: number,
  completedRounds: number,
  practice: boolean,
): { readonly score: number; readonly coins: number; readonly xp: number } {
  const score = Math.max(0, Math.floor(requestedScore));
  if (practice) return { score, coins: 0, xp: 0 };
  const rounds = Math.max(0, Math.floor(completedRounds));
  return {
    score,
    coins: Math.max(1, Math.floor(score / 420) + rounds),
    xp: Math.max(2, Math.floor(score / 180) + rounds * 2),
  };
}

export function verifyPoseInput(
  sequence: readonly PoseId[],
  inputIndex: number,
  pose: PoseId,
  rule: PoseRoundRule = "normal",
): SequenceCheck {
  const source = sequence[inputIndex];
  if (!source) throw new RangeError("Input index is outside the sequence");
  const expected = expectedPoseForRule(source, rule);
  if (pose !== expected) return { status: "mistake", nextIndex: inputIndex, expected };
  const nextIndex = inputIndex + 1;
  return nextIndex === sequence.length
    ? { status: "round-complete", nextIndex }
    : { status: "continue", nextIndex };
}

export function shuffledPoseColors(
  rng: RandomSource,
  previous: Readonly<Record<PoseId, number>> = {
    wave: 0,
    hop: 1,
    wiggle: 2,
    clap: 3,
    freeze: 4,
    stretch: 5,
    curl: 6,
    stomp: 7,
  },
): Readonly<Record<PoseId, number>> {
  const values = POSE_IDS.map((_, index) => index);
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
    wave: values[0] ?? 0,
    hop: values[1] ?? 1,
    wiggle: values[2] ?? 2,
    clap: values[3] ?? 3,
    freeze: values[4] ?? 4,
    stretch: values[5] ?? 5,
    curl: values[6] ?? 6,
    stomp: values[7] ?? 7,
  };
}
