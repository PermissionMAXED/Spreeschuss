import type { Needs } from "../core/contracts/simulation";

export const CARE_MOODS = [
  "happy",
  "content",
  "hungry",
  "sleepy",
  "dirty",
  "bored",
  "ecstatic",
  "sad",
] as const;

export type CareMood = (typeof CARE_MOODS)[number];

export const MOOD_THRESHOLDS = {
  urgentNeed: 34,
  recoveredNeed: 45,
  sadNeed: 8,
  sadPair: 20,
  sadRecoveryNeed: 15,
  sadRecoveryPair: 29,
  happyAverage: 72,
  happyMinimum: 58,
  happyRecoveryAverage: 65,
  happyRecoveryMinimum: 50,
  ecstaticAverage: 91,
  ecstaticMinimum: 86,
  ecstaticRecoveryAverage: 86,
  ecstaticRecoveryMinimum: 80,
} as const;

const needMood = (index: number): CareMood => {
  if (index === 0) return "hungry";
  if (index === 1) return "sleepy";
  if (index === 2) return "dirty";
  return "bored";
};

const moodNeed = (mood: CareMood, needs: Needs): number => {
  if (mood === "hungry") return needs.hunger;
  if (mood === "sleepy") return needs.energy;
  if (mood === "dirty") return needs.hygiene;
  if (mood === "bored") return needs.fun;
  return Number.POSITIVE_INFINITY;
};

/**
 * Derives Gooby's visible care mood from all four needs.
 *
 * Entry and recovery thresholds intentionally differ. That dead band prevents
 * frame-to-frame mood flicker while a need meter hovers near a boundary.
 */
export function deriveCareMood(needs: Needs, previous: CareMood = "content"): CareMood {
  const hunger = needs.hunger;
  const energy = needs.energy;
  const hygiene = needs.hygiene;
  const fun = needs.fun;
  const average = (hunger + energy + hygiene + fun) * 0.25;

  let minimum = hunger;
  let minimumIndex = 0;
  if (energy < minimum) {
    minimum = energy;
    minimumIndex = 1;
  }
  if (hygiene < minimum) {
    minimum = hygiene;
    minimumIndex = 2;
  }
  if (fun < minimum) {
    minimum = fun;
    minimumIndex = 3;
  }

  const sadPairThreshold = previous === "sad"
    ? MOOD_THRESHOLDS.sadRecoveryPair
    : MOOD_THRESHOLDS.sadPair;
  const sadFloor = previous === "sad"
    ? MOOD_THRESHOLDS.sadRecoveryNeed
    : MOOD_THRESHOLDS.sadNeed;
  let distressedNeeds = 0;
  if (hunger < sadPairThreshold) distressedNeeds += 1;
  if (energy < sadPairThreshold) distressedNeeds += 1;
  if (hygiene < sadPairThreshold) distressedNeeds += 1;
  if (fun < sadPairThreshold) distressedNeeds += 1;
  if (minimum < sadFloor || distressedNeeds >= 2) return "sad";

  if (minimum <= MOOD_THRESHOLDS.urgentNeed) return needMood(minimumIndex);

  const previousNeed = moodNeed(previous, needs);
  if (previousNeed < MOOD_THRESHOLDS.recoveredNeed) return previous;

  if (previous === "ecstatic") {
    if (
      minimum >= MOOD_THRESHOLDS.ecstaticRecoveryMinimum
      && average >= MOOD_THRESHOLDS.ecstaticRecoveryAverage
    ) return "ecstatic";
  } else if (
    minimum >= MOOD_THRESHOLDS.ecstaticMinimum
    && average >= MOOD_THRESHOLDS.ecstaticAverage
  ) {
    return "ecstatic";
  }

  if (previous === "happy") {
    if (
      minimum >= MOOD_THRESHOLDS.happyRecoveryMinimum
      && average >= MOOD_THRESHOLDS.happyRecoveryAverage
    ) return "happy";
  } else if (
    minimum >= MOOD_THRESHOLDS.happyMinimum
    && average >= MOOD_THRESHOLDS.happyAverage
  ) {
    return "happy";
  }

  return "content";
}
