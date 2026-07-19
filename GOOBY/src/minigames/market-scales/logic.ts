import type { MinigamePayout } from "../../core/contracts/minigame";
import type { RandomSource } from "../../core/contracts/rng";

export const SCALE_ROUND_COUNT = 8;
export const SCALE_WEIGHT_BLOCKS = [25, 50, 100, 200, 500] as const;
export type ScaleWeight = (typeof SCALE_WEIGHT_BLOCKS)[number];
export type WeightGrade = "perfect" | "close" | "miss";

export interface ProduceSpec {
  readonly id: string;
  readonly glyph: string;
  readonly grams: number;
}

export const PRODUCE_SPECS: readonly ProduceSpec[] = [
  { id: "apple", glyph: "🍎", grams: 160 },
  { id: "pear", glyph: "🍐", grams: 175 },
  { id: "orange", glyph: "🍊", grams: 185 },
  { id: "carrot", glyph: "🥕", grams: 95 },
  { id: "pepper", glyph: "🫑", grams: 135 },
  { id: "eggplant", glyph: "🍆", grams: 240 },
  { id: "corn", glyph: "🌽", grams: 285 },
  { id: "berries", glyph: "🍓", grams: 125 },
] as const;

export interface WeighedProduce {
  readonly id: string;
  readonly glyph: string;
  readonly grams: number;
}

export interface ScaleChallenge {
  readonly index: number;
  readonly produce: readonly WeighedProduce[];
  readonly targetGrams: number;
  readonly expert: boolean;
  readonly hint: { readonly minimum: number; readonly maximum: number } | null;
}

export interface WeightJudgement {
  readonly grade: WeightGrade;
  readonly estimate: number;
  readonly target: number;
  readonly error: number;
  readonly percentError: number;
  readonly points: number;
  readonly streak: number;
}

export interface ScaleSession {
  challengeIndex: number;
  challenge: ScaleChallenge;
  loadedWeights: ScaleWeight[];
  score: number;
  precisionStreak: number;
  bestStreak: number;
  perfects: number;
  completed: number;
  actions: number;
  elapsedSeconds: number;
  finished: boolean;
  lastJudgement: WeightJudgement | null;
}

function challengeProduceCount(index: number): number {
  return Math.min(3, 1 + Math.floor(Math.max(0, index) / 3));
}

export function generateScaleChallenge(rng: RandomSource, index: number): ScaleChallenge {
  if (!Number.isInteger(index) || index < 0) {
    throw new RangeError("Scale challenge index must be a non-negative integer");
  }
  const produce: WeighedProduce[] = [];
  const count = challengeProduceCount(index);
  let previous = "";
  for (let item = 0; item < count; item += 1) {
    let spec = rng.pick(PRODUCE_SPECS);
    if (spec.id === previous) {
      const next = (PRODUCE_SPECS.indexOf(spec) + 1) % PRODUCE_SPECS.length;
      const alternative = PRODUCE_SPECS[next];
      if (alternative) spec = alternative;
    }
    previous = spec.id;
    const variation = rng.int(-3, 4) * 5;
    produce.push({ id: spec.id, glyph: spec.glyph, grams: Math.max(25, spec.grams + variation) });
  }
  const targetGrams = produce.reduce((total, item) => total + item.grams, 0);
  const expert = index >= 3;
  const lower = Math.floor(targetGrams / 50) * 50;
  return {
    index,
    produce,
    targetGrams,
    expert,
    hint: expert ? null : { minimum: Math.max(0, lower), maximum: lower + 50 },
  };
}

export function estimateWeight(loaded: readonly ScaleWeight[]): number {
  return loaded.reduce<number>((total, weight) => total + weight, 0);
}

export function judgeWeight(
  challenge: ScaleChallenge,
  estimate: number,
  currentStreak: number,
): WeightJudgement {
  const safeEstimate = Math.max(0, Math.floor(estimate));
  const error = Math.abs(safeEstimate - challenge.targetGrams);
  const percentError = challenge.targetGrams > 0 ? error / challenge.targetGrams : 1;
  const perfectTolerance = Math.max(12, challenge.targetGrams * 0.035);
  const closeTolerance = Math.max(30, challenge.targetGrams * 0.1);
  const grade: WeightGrade = error <= perfectTolerance
    ? "perfect"
    : error <= closeTolerance
      ? "close"
      : "miss";
  const streak = grade === "perfect" ? currentStreak + 1 : 0;
  const base = grade === "perfect" ? 360 : grade === "close" ? 190 : 45;
  const precision = grade === "perfect"
    ? Math.round(Math.max(0, 100 - percentError * 1_000))
    : grade === "close"
      ? Math.round(Math.max(0, 55 - percentError * 300))
      : 0;
  const expertMultiplier = challenge.expert ? 1.3 : 1;
  const points = Math.round((base + precision + Math.min(8, streak) * 45) * expertMultiplier);
  return {
    grade,
    estimate: safeEstimate,
    target: challenge.targetGrams,
    error,
    percentError,
    points,
    streak,
  };
}

export function createScaleSession(rng: RandomSource): ScaleSession {
  return {
    challengeIndex: 0,
    challenge: generateScaleChallenge(rng, 0),
    loadedWeights: [],
    score: 0,
    precisionStreak: 0,
    bestStreak: 0,
    perfects: 0,
    completed: 0,
    actions: 0,
    elapsedSeconds: 0,
    finished: false,
    lastJudgement: null,
  };
}

export function stepScaleSession(session: ScaleSession, deltaSeconds: number): void {
  if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) {
    throw new RangeError("Scale delta must be finite and non-negative");
  }
  if (!session.finished) session.elapsedSeconds += deltaSeconds;
}

export function addScaleWeight(session: ScaleSession, weight: ScaleWeight): boolean {
  if (session.finished || !SCALE_WEIGHT_BLOCKS.includes(weight)) return false;
  if (session.loadedWeights.length >= 12) return false;
  session.loadedWeights.push(weight);
  session.actions += 1;
  return true;
}

export function removeScaleWeight(session: ScaleSession, index = session.loadedWeights.length - 1): ScaleWeight | null {
  if (session.finished || index < 0 || index >= session.loadedWeights.length) return null;
  const [removed] = session.loadedWeights.splice(index, 1);
  session.actions += 1;
  return removed ?? null;
}

export function clearScaleWeights(session: ScaleSession): void {
  if (session.finished || session.loadedWeights.length === 0) return;
  session.loadedWeights.length = 0;
  session.actions += 1;
}

export function submitScaleEstimate(session: ScaleSession, rng: RandomSource): WeightJudgement | null {
  if (session.finished) return null;
  session.actions += 1;
  const judgement = judgeWeight(
    session.challenge,
    estimateWeight(session.loadedWeights),
    session.precisionStreak,
  );
  session.lastJudgement = judgement;
  session.score += judgement.points;
  session.precisionStreak = judgement.streak;
  session.bestStreak = Math.max(session.bestStreak, judgement.streak);
  if (judgement.grade === "perfect") session.perfects += 1;
  session.completed += 1;
  if (session.completed >= SCALE_ROUND_COUNT) {
    session.finished = true;
  } else {
    session.challengeIndex += 1;
    session.challenge = generateScaleChallenge(rng, session.challengeIndex);
    session.loadedWeights.length = 0;
  }
  return judgement;
}

export function scalePayout(session: Readonly<ScaleSession>): MinigamePayout {
  const score = Math.max(0, Math.floor(session.score));
  return {
    score,
    coins: Math.min(40, Math.floor(score / 110)),
    xp: Math.min(90, Math.floor(score / 55) + session.perfects * 2),
  };
}
