import type { MinigamePayout } from "../../core/contracts/minigame";
import type { RandomSource } from "../../core/contracts/rng";

export type FishingDifficulty = "relaxed" | "ripple" | "legend";
export type FishRarity = "common" | "uncommon" | "rare" | "epic" | "legendary";

/** Every species pulls on the line with one of these signature patterns. */
export type PullPattern = "steady" | "zigzag" | "thump" | "feint";

export type FishSpeciesId =
  | "minnow"
  | "bluegill"
  | "prism-trout"
  | "bass"
  | "moonback-catfish"
  | "sturgeon"
  | "golden-koi";

export interface FishSpecies {
  readonly id: FishSpeciesId;
  readonly name: string;
  readonly icon: string;
  readonly rarity: FishRarity;
  readonly pullPattern: PullPattern;
  readonly baseWeightKg: number;
  readonly weightVarianceKg: number;
  readonly surgeAmplitude: number;
  readonly surgeFrequency: number;
  readonly pulsePeriod: number;
  readonly pulseStrength: number;
  readonly greenWidth: number;
}

/** Ordered by rarity so the roster reads from everyday catch to legend. */
export const FISH_SPECIES: readonly FishSpecies[] = [
  {
    id: "minnow",
    name: "Silver Minnow",
    icon: "🐟",
    rarity: "common",
    pullPattern: "steady",
    baseWeightKg: 0.18,
    weightVarianceKg: 0.09,
    surgeAmplitude: 0.035,
    surgeFrequency: 2.2,
    pulsePeriod: 4.8,
    pulseStrength: 0.025,
    greenWidth: 0.28,
  },
  {
    id: "bluegill",
    name: "Bluegill",
    icon: "🐠",
    rarity: "uncommon",
    pullPattern: "steady",
    baseWeightKg: 0.72,
    weightVarianceKg: 0.3,
    surgeAmplitude: 0.07,
    surgeFrequency: 2.8,
    pulsePeriod: 3.9,
    pulseStrength: 0.045,
    greenWidth: 0.24,
  },
  {
    id: "prism-trout",
    name: "Prism Trout",
    icon: "🎏",
    rarity: "rare",
    pullPattern: "zigzag",
    baseWeightKg: 1.6,
    weightVarianceKg: 0.6,
    surgeAmplitude: 0.09,
    surgeFrequency: 3.1,
    pulsePeriod: 3.4,
    pulseStrength: 0.06,
    greenWidth: 0.22,
  },
  {
    id: "bass",
    name: "Mossback Bass",
    icon: "🐟",
    rarity: "rare",
    pullPattern: "steady",
    baseWeightKg: 2.1,
    weightVarianceKg: 0.8,
    surgeAmplitude: 0.11,
    surgeFrequency: 3.6,
    pulsePeriod: 3.1,
    pulseStrength: 0.075,
    greenWidth: 0.21,
  },
  {
    id: "moonback-catfish",
    name: "Moonback Catfish",
    icon: "🐋",
    rarity: "epic",
    pullPattern: "thump",
    baseWeightKg: 4.6,
    weightVarianceKg: 1.7,
    surgeAmplitude: 0.125,
    surgeFrequency: 1.7,
    pulsePeriod: 2.7,
    pulseStrength: 0.105,
    greenWidth: 0.19,
  },
  {
    id: "sturgeon",
    name: "Ancient Sturgeon",
    icon: "🐡",
    rarity: "epic",
    pullPattern: "steady",
    baseWeightKg: 5.4,
    weightVarianceKg: 1.9,
    surgeAmplitude: 0.145,
    surgeFrequency: 2.1,
    pulsePeriod: 2.45,
    pulseStrength: 0.12,
    greenWidth: 0.18,
  },
  {
    id: "golden-koi",
    name: "Golden Koi",
    icon: "🐠",
    rarity: "legendary",
    pullPattern: "feint",
    baseWeightKg: 8.2,
    weightVarianceKg: 2.8,
    surgeAmplitude: 0.17,
    surgeFrequency: 4.4,
    pulsePeriod: 1.9,
    pulseStrength: 0.14,
    greenWidth: 0.15,
  },
] as const;

const RARITY_RANKS: Readonly<Record<FishRarity, number>> = {
  common: 0,
  uncommon: 1,
  rare: 2,
  epic: 3,
  legendary: 4,
};

/** Rarity rank 0 (common) through 4 (legendary); drives fight and score scaling. */
export function rarityRank(species: FishSpecies): number {
  return RARITY_RANKS[species.rarity];
}

export type TackleId = "everyday-float" | "feather-lure" | "deep-sinker";
export const TACKLE_IDS: readonly TackleId[] = [
  "everyday-float",
  "feather-lure",
  "deep-sinker",
];

export interface TackleInfo {
  readonly id: TackleId;
  readonly name: string;
  readonly icon: string;
  readonly copy: string;
  /** Multiplier applied to the deterministic bite delay roll. */
  readonly biteDelayFactor: number;
}

export const TACKLE_INFO: Readonly<Record<TackleId, TackleInfo>> = {
  "everyday-float": {
    id: "everyday-float",
    name: "Everyday Float",
    icon: "🎈",
    copy: "Balanced pond odds",
    biteDelayFactor: 1,
  },
  "feather-lure": {
    id: "feather-lure",
    name: "Feather Lure",
    icon: "🪶",
    copy: "Quick bites · favors darting fish",
    biteDelayFactor: 0.75,
  },
  "deep-sinker": {
    id: "deep-sinker",
    name: "Deep Sinker",
    icon: "🪨",
    copy: "Slow bites · favors heavy fish",
    biteDelayFactor: 1.3,
  },
};

export type PondStockPhase = "day" | "night";

/**
 * The pond stock follows the injected clock: hours 6–17 read as day, the rest
 * as night. Derived arithmetically from epoch milliseconds so no wall-clock or
 * timezone API is ever consulted.
 */
export function pondStockPhaseAt(epochMs: number): PondStockPhase {
  if (!Number.isFinite(epochMs)) throw new RangeError("Pond clock reading must be finite");
  const hour = Math.floor(epochMs / 3_600_000) % 24;
  return hour >= 6 && hour < 18 ? "day" : "night";
}

/** Base stock weights per difficulty, aligned with `FISH_SPECIES` order. */
const BASE_STOCK: Readonly<Record<FishingDifficulty, readonly number[]>> = {
  relaxed: [58, 28, 7, 11, 4, 2.5, 0.5],
  ripple: [43, 30, 12, 19, 7, 6, 2],
  legend: [30, 28, 14, 25, 10, 12, 5],
};

const PHASE_FACTORS: Readonly<
  Record<PondStockPhase, Partial<Record<FishSpeciesId, number>>>
> = {
  day: { "prism-trout": 1.3, "moonback-catfish": 0 },
  night: { minnow: 0.85, "prism-trout": 0.35, "moonback-catfish": 1.35, "golden-koi": 1.4 },
};

const TACKLE_FACTORS: Readonly<Record<TackleId, Partial<Record<FishSpeciesId, number>>>> = {
  "everyday-float": {},
  "feather-lure": {
    minnow: 1.15,
    bluegill: 1.25,
    "prism-trout": 1.8,
    bass: 1.15,
    "moonback-catfish": 0.6,
    sturgeon: 0.55,
    "golden-koi": 0.7,
  },
  "deep-sinker": {
    minnow: 0.5,
    bluegill: 0.75,
    "prism-trout": 0.6,
    bass: 1.1,
    "moonback-catfish": 1.6,
    sturgeon: 1.7,
    "golden-koi": 1.5,
  },
};

/** Effective stock weights for one pond setup, aligned with `FISH_SPECIES`. */
export function stockWeights(
  difficulty: FishingDifficulty,
  tackle: TackleId = "everyday-float",
  phase: PondStockPhase = "day",
): readonly number[] {
  return FISH_SPECIES.map((species, index) => {
    const base = BASE_STOCK[difficulty][index] ?? 0;
    const phaseFactor = PHASE_FACTORS[phase][species.id] ?? 1;
    const tackleFactor = TACKLE_FACTORS[tackle][species.id] ?? 1;
    return base * phaseFactor * tackleFactor;
  });
}

export interface StockOdds {
  readonly species: FishSpecies;
  /** Exact percentage of the stock; zero means not stocked right now. */
  readonly percent: number;
}

/**
 * The transparent pre-run odds table: the exact distribution `chooseSpecies`
 * samples from, expressed as percentages that sum to 100.
 */
export function stockOdds(
  difficulty: FishingDifficulty,
  tackle: TackleId = "everyday-float",
  phase: PondStockPhase = "day",
): readonly StockOdds[] {
  const weights = stockWeights(difficulty, tackle, phase);
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (total <= 0) throw new Error("Pond stock must contain at least one species");
  return FISH_SPECIES.map((species, index) => ({
    species,
    percent: ((weights[index] ?? 0) / total) * 100,
  }));
}

export function chooseSpecies(
  rng: RandomSource,
  difficulty: FishingDifficulty,
  tackle: TackleId = "everyday-float",
  phase: PondStockPhase = "day",
): FishSpecies {
  const weights = stockWeights(difficulty, tackle, phase);
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let sample = rng.next() * total;
  let lastStocked: FishSpecies | null = null;
  for (let index = 0; index < FISH_SPECIES.length; index += 1) {
    const weight = weights[index] ?? 0;
    if (weight <= 0) continue;
    lastStocked = FISH_SPECIES[index] as FishSpecies;
    sample -= weight;
    if (sample < 0) return lastStocked;
  }
  if (lastStocked === null) throw new Error("Pond stock must contain at least one species");
  return lastStocked;
}

function triangleWave(position: number): number {
  const cycle = position - Math.floor(position);
  return Math.abs(cycle * 4 - 2) - 1;
}

/**
 * Signature line pull for a species at a moment in its fight. Deterministic in
 * `(species, elapsedSeconds, phase)`, so every pattern is unit-testable.
 */
export function surgeAt(species: FishSpecies, elapsedSeconds: number, phase: number): number {
  const wave = Math.sin(elapsedSeconds * species.surgeFrequency + phase) * species.surgeAmplitude;
  const pulsePosition = (elapsedSeconds + phase * 0.17) % species.pulsePeriod;
  const pulse = pulsePosition < 0.32 ? species.pulseStrength * (1 - pulsePosition / 0.32) : 0;

  let signature = 0;
  if (species.pullPattern === "feint") {
    signature = Math.sin(elapsedSeconds * 9.2 + phase * 2) * 0.045;
  } else if (species.pullPattern === "zigzag") {
    signature = triangleWave(elapsedSeconds * 0.9 + phase * 0.21) * 0.055;
  } else if (species.pullPattern === "thump") {
    // A second delayed thump each period: the double heartbeat of the catfish.
    const echoPosition =
      (elapsedSeconds + phase * 0.17 + species.pulsePeriod / 2) % species.pulsePeriod;
    signature = echoPosition < 0.32 ? species.pulseStrength * 0.8 * (1 - echoPosition / 0.32) : 0;
  }
  return wave + pulse + signature;
}

const RARITY_WEIGHTS_FORCE: Readonly<Record<FishingDifficulty, number>> = {
  relaxed: 0.88,
  ripple: 1,
  legend: 1.14,
};

export interface TensionStep {
  readonly tension: number;
  readonly snapped: boolean;
  readonly slack: boolean;
}

export function stepTension(
  tension: number,
  holding: boolean,
  surge: number,
  deltaSeconds: number,
  difficulty: FishingDifficulty,
): TensionStep {
  if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) {
    throw new RangeError("Fishing delta must be finite and non-negative");
  }
  const reelForce = holding ? 0.29 : -0.24;
  const raw = tension + (reelForce + surge) * RARITY_WEIGHTS_FORCE[difficulty] * deltaSeconds;
  return {
    tension: Math.max(0, Math.min(1, raw)),
    snapped: raw >= 1,
    slack: raw <= 0,
  };
}

/** Score and coins for a settled pond run; quitting early never reaches this. */
export function pondPayout(
  score: number,
  catchCount: number,
  legendaryCount: number,
): MinigamePayout {
  return {
    score,
    coins: catchCount * 3 + Math.floor(score / 400) + legendaryCount * 12,
    xp: Math.max(0, Math.floor(score / 65)),
  };
}

export class FishingFight {
  public readonly species: FishSpecies;
  public readonly phase: number;
  private readonly difficulty: FishingDifficulty;
  private elapsed = 0;
  private fightProgress = 0;
  private lineTension = 0.44;
  private slackSeconds = 0;
  private outcome: "fighting" | "caught" | "escaped" = "fighting";

  public constructor(species: FishSpecies, phase: number, difficulty: FishingDifficulty) {
    this.species = species;
    this.phase = phase;
    this.difficulty = difficulty;
  }

  get tension(): number {
    return this.lineTension;
  }

  get progress(): number {
    return this.fightProgress;
  }

  get status(): "fighting" | "caught" | "escaped" {
    return this.outcome;
  }

  get greenBand(): readonly [number, number] {
    const drift = Math.sin(this.elapsed * 0.72 + this.phase) * 0.055;
    const center = 0.52 + drift;
    return [center - this.species.greenWidth / 2, center + this.species.greenWidth / 2];
  }

  get surge(): number {
    return surgeAt(this.species, this.elapsed, this.phase);
  }

  update(deltaSeconds: number, holding: boolean): void {
    if (this.outcome !== "fighting") return;
    this.elapsed += deltaSeconds;
    const next = stepTension(this.lineTension, holding, this.surge, deltaSeconds, this.difficulty);
    this.lineTension = next.tension;
    const [greenStart, greenEnd] = this.greenBand;
    const inBand = this.lineTension >= greenStart && this.lineTension <= greenEnd;

    if (holding && inBand) {
      const rarityBoost = 1 + rarityRank(this.species) * 0.08;
      this.fightProgress = Math.min(1, this.fightProgress + deltaSeconds * 0.24 * rarityBoost);
    } else if (holding && !inBand) {
      this.fightProgress = Math.max(0, this.fightProgress - deltaSeconds * 0.045);
    }

    this.slackSeconds = next.slack ? this.slackSeconds + deltaSeconds : 0;
    if (next.snapped || this.slackSeconds > 1.05) this.outcome = "escaped";
    else if (this.fightProgress >= 1) this.outcome = "caught";
  }
}

export interface PondShadow {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly size: number;
  readonly species: FishSpecies;
  readonly phase: number;
}

export interface CaughtFish {
  readonly species: FishSpecies;
  readonly weightKg: number;
  readonly score: number;
}

export type PondPhase = "aiming" | "waiting" | "bite" | "fighting" | "caught" | "escaped" | "ended";

export interface PondRoundOptions {
  readonly tackle?: TackleId;
  readonly stockPhase?: PondStockPhase;
}

export class PondFishingRound {
  readonly durationSeconds = 90;
  readonly catches: CaughtFish[] = [];
  public readonly difficulty: FishingDifficulty;
  public readonly tackle: TackleId;
  public readonly stockPhase: PondStockPhase;
  private readonly rng: RandomSource;
  private pondShadows: PondShadow[] = [];
  private currentPhase: PondPhase = "aiming";
  private activeShadow: PondShadow | null = null;
  private fightState: FishingFight | null = null;
  private remaining = this.durationSeconds;
  private phaseSeconds = 0;
  private biteDelay = 0;
  private reeling = false;
  private weightTotal = 0;
  private scoreTotal = 0;

  public constructor(
    difficulty: FishingDifficulty,
    rng: RandomSource,
    options: PondRoundOptions = {},
  ) {
    this.difficulty = difficulty;
    this.rng = rng;
    this.tackle = options.tackle ?? "everyday-float";
    this.stockPhase = options.stockPhase ?? "day";
    this.refreshShadows();
  }

  get phase(): PondPhase {
    return this.currentPhase;
  }

  get shadows(): readonly PondShadow[] {
    return this.pondShadows;
  }

  get fight(): FishingFight | null {
    return this.fightState;
  }

  get remainingSeconds(): number {
    return this.remaining;
  }

  get totalWeightKg(): number {
    return this.weightTotal;
  }

  get score(): number {
    return this.scoreTotal;
  }

  get activeFish(): FishSpecies | null {
    return this.activeShadow?.species ?? null;
  }

  get activeTarget(): PondShadow | null {
    return this.activeShadow;
  }

  castAt(x: number, y: number): PondShadow | null {
    if (this.currentPhase !== "aiming") return null;
    const shadow =
      [...this.pondShadows]
        .map((candidate) => ({
          candidate,
          distance: Math.hypot(candidate.x - x, candidate.y - y),
        }))
        .filter(({ candidate, distance }) => distance <= 0.1 + candidate.size * 0.07)
        .sort((first, second) => first.distance - second.distance)[0]?.candidate ?? null;

    if (shadow === null) {
      this.currentPhase = "escaped";
      this.phaseSeconds = 0;
      return null;
    }
    this.activeShadow = shadow;
    this.currentPhase = "waiting";
    this.phaseSeconds = 0;
    this.biteDelay = (0.65 + this.rng.next() * 1.8) * TACKLE_INFO[this.tackle].biteDelayFactor;
    return shadow;
  }

  hook(): boolean {
    if (this.currentPhase !== "bite" || this.activeShadow === null) return false;
    this.fightState = new FishingFight(
      this.activeShadow.species,
      this.activeShadow.phase,
      this.difficulty,
    );
    this.currentPhase = "fighting";
    this.phaseSeconds = 0;
    return true;
  }

  setReeling(holding: boolean): void {
    this.reeling = holding;
  }

  update(deltaSeconds: number): void {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) {
      throw new RangeError("Pond Fishing delta must be finite and non-negative");
    }
    if (this.currentPhase === "ended") return;
    this.remaining = Math.max(0, this.remaining - deltaSeconds);
    this.phaseSeconds += deltaSeconds;
    if (this.remaining <= 0) {
      this.currentPhase = "ended";
      this.reeling = false;
      return;
    }

    if (this.currentPhase === "waiting" && this.phaseSeconds >= this.biteDelay) {
      this.currentPhase = "bite";
      this.phaseSeconds = 0;
      return;
    }
    if (this.currentPhase === "bite" && this.phaseSeconds > 0.95) {
      this.currentPhase = "escaped";
      this.phaseSeconds = 0;
      return;
    }
    if (this.currentPhase === "fighting" && this.fightState !== null) {
      this.fightState.update(deltaSeconds, this.reeling);
      if (this.fightState.status === "caught") this.landFish();
      else if (this.fightState.status === "escaped") {
        this.currentPhase = "escaped";
        this.phaseSeconds = 0;
        this.reeling = false;
      }
      return;
    }
    if ((this.currentPhase === "caught" || this.currentPhase === "escaped") && this.phaseSeconds >= 1.05) {
      this.currentPhase = "aiming";
      this.activeShadow = null;
      this.fightState = null;
      this.phaseSeconds = 0;
      this.refreshShadows();
    }
  }

  private landFish(): void {
    const shadow = this.activeShadow;
    if (shadow === null) return;
    const weight =
      shadow.species.baseWeightKg + this.rng.next() * shadow.species.weightVarianceKg;
    const score = Math.round(weight * 100) * (rarityRank(shadow.species) + 1);
    this.catches.push({ species: shadow.species, weightKg: weight, score });
    this.weightTotal += weight;
    this.scoreTotal += score;
    this.currentPhase = "caught";
    this.phaseSeconds = 0;
    this.reeling = false;
  }

  private refreshShadows(): void {
    this.pondShadows = Array.from({ length: 5 }, (_, index) => {
      const species = chooseSpecies(this.rng, this.difficulty, this.tackle, this.stockPhase);
      return {
        id: `shadow-${index}-${Math.floor(this.remaining * 10)}`,
        x: 0.14 + this.rng.next() * 0.72,
        y: 0.18 + this.rng.next() * 0.52,
        size: 0.65 + rarityRank(species) * 0.11 + this.rng.next() * 0.18,
        species,
        phase: this.rng.next() * Math.PI * 2,
      };
    });
  }
}
