import type { RandomSource } from "../../core/contracts/rng";

export type FishingDifficulty = "relaxed" | "ripple" | "legend";
export type FishRarity = "common" | "uncommon" | "rare" | "epic" | "legendary";

export interface FishSpecies {
  readonly id: "minnow" | "bluegill" | "bass" | "sturgeon" | "golden-koi";
  readonly name: string;
  readonly icon: string;
  readonly rarity: FishRarity;
  readonly baseWeightKg: number;
  readonly weightVarianceKg: number;
  readonly surgeAmplitude: number;
  readonly surgeFrequency: number;
  readonly pulsePeriod: number;
  readonly pulseStrength: number;
  readonly greenWidth: number;
}

export const FISH_SPECIES: readonly FishSpecies[] = [
  {
    id: "minnow",
    name: "Silver Minnow",
    icon: "🐟",
    rarity: "common",
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
    baseWeightKg: 0.72,
    weightVarianceKg: 0.3,
    surgeAmplitude: 0.07,
    surgeFrequency: 2.8,
    pulsePeriod: 3.9,
    pulseStrength: 0.045,
    greenWidth: 0.24,
  },
  {
    id: "bass",
    name: "Mossback Bass",
    icon: "🐟",
    rarity: "rare",
    baseWeightKg: 2.1,
    weightVarianceKg: 0.8,
    surgeAmplitude: 0.11,
    surgeFrequency: 3.6,
    pulsePeriod: 3.1,
    pulseStrength: 0.075,
    greenWidth: 0.21,
  },
  {
    id: "sturgeon",
    name: "Ancient Sturgeon",
    icon: "🐡",
    rarity: "epic",
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
    baseWeightKg: 8.2,
    weightVarianceKg: 2.8,
    surgeAmplitude: 0.17,
    surgeFrequency: 4.4,
    pulsePeriod: 1.9,
    pulseStrength: 0.14,
    greenWidth: 0.15,
  },
] as const;

const RARITY_WEIGHTS: Readonly<Record<FishingDifficulty, readonly number[]>> = {
  relaxed: [58, 28, 11, 2.5, 0.5],
  ripple: [43, 30, 19, 6, 2],
  legend: [30, 28, 25, 12, 5],
};

const DIFFICULTY_FORCE: Readonly<Record<FishingDifficulty, number>> = {
  relaxed: 0.88,
  ripple: 1,
  legend: 1.14,
};

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

export function chooseSpecies(rng: RandomSource, difficulty: FishingDifficulty): FishSpecies {
  const weights = RARITY_WEIGHTS[difficulty];
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let sample = rng.next() * total;
  for (let index = 0; index < FISH_SPECIES.length; index += 1) {
    sample -= weights[index] ?? 0;
    if (sample < 0) return FISH_SPECIES[index] as FishSpecies;
  }
  return FISH_SPECIES[FISH_SPECIES.length - 1] as FishSpecies;
}

export function surgeAt(species: FishSpecies, elapsedSeconds: number, phase: number): number {
  const wave = Math.sin(elapsedSeconds * species.surgeFrequency + phase) * species.surgeAmplitude;
  const pulsePosition = (elapsedSeconds + phase * 0.17) % species.pulsePeriod;
  const pulse = pulsePosition < 0.32 ? species.pulseStrength * (1 - pulsePosition / 0.32) : 0;
  const goldenFeint =
    species.id === "golden-koi" ? Math.sin(elapsedSeconds * 9.2 + phase * 2) * 0.045 : 0;
  return wave + pulse + goldenFeint;
}

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
  const raw = tension + (reelForce + surge) * DIFFICULTY_FORCE[difficulty] * deltaSeconds;
  return {
    tension: Math.max(0, Math.min(1, raw)),
    snapped: raw >= 1,
    slack: raw <= 0,
  };
}

export class FishingFight {
  private elapsed = 0;
  private fightProgress = 0;
  private lineTension = 0.44;
  private slackSeconds = 0;
  private outcome: "fighting" | "caught" | "escaped" = "fighting";

  public constructor(
    public readonly species: FishSpecies,
    public readonly phase: number,
    private readonly difficulty: FishingDifficulty,
  ) {}

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
      const rarityBoost = 1 + FISH_SPECIES.indexOf(this.species) * 0.08;
      this.fightProgress = Math.min(1, this.fightProgress + deltaSeconds * 0.24 * rarityBoost);
    } else if (holding && !inBand) {
      this.fightProgress = Math.max(0, this.fightProgress - deltaSeconds * 0.045);
    }

    this.slackSeconds = next.slack ? this.slackSeconds + deltaSeconds : 0;
    if (next.snapped || this.slackSeconds > 1.05) this.outcome = "escaped";
    else if (this.fightProgress >= 1) this.outcome = "caught";
  }
}

export class PondFishingRound {
  readonly durationSeconds = 90;
  readonly catches: CaughtFish[] = [];
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
    public readonly difficulty: FishingDifficulty,
    private readonly rng: RandomSource,
  ) {
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
    this.biteDelay = 0.65 + this.rng.next() * 1.8;
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
    const speciesIndex = FISH_SPECIES.indexOf(shadow.species);
    const weight =
      shadow.species.baseWeightKg + this.rng.next() * shadow.species.weightVarianceKg;
    const score = Math.round(weight * 100) * (speciesIndex + 1);
    this.catches.push({ species: shadow.species, weightKg: weight, score });
    this.weightTotal += weight;
    this.scoreTotal += score;
    this.currentPhase = "caught";
    this.phaseSeconds = 0;
    this.reeling = false;
  }

  private refreshShadows(): void {
    this.pondShadows = Array.from({ length: 5 }, (_, index) => {
      const species = chooseSpecies(this.rng, this.difficulty);
      return {
        id: `shadow-${index}-${Math.floor(this.remaining * 10)}`,
        x: 0.14 + this.rng.next() * 0.72,
        y: 0.18 + this.rng.next() * 0.52,
        size: 0.65 + FISH_SPECIES.indexOf(species) * 0.11 + this.rng.next() * 0.18,
        species,
        phase: this.rng.next() * Math.PI * 2,
      };
    });
  }
}
