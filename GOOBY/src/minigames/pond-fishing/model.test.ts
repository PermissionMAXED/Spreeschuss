import { describe, expect, it } from "vitest";
import { SeededRng, type RandomSource } from "../../core/contracts/rng";
import {
  FISH_SPECIES,
  FishingFight,
  PondFishingRound,
  TACKLE_IDS,
  chooseSpecies,
  pondPayout,
  pondStockPhaseAt,
  rarityRank,
  stockOdds,
  stepTension,
  surgeAt,
  type FishSpecies,
  type FishSpeciesId,
  type FishingDifficulty,
  type PondStockPhase,
  type TackleId,
} from "./model";

function species(id: FishSpeciesId): FishSpecies {
  const found = FISH_SPECIES.find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`missing species ${id}`);
  return found;
}

describe("Pond Fishing simulation", () => {
  it("maps rarity rolls from minnow through golden koi", () => {
    expect(chooseSpecies(new FixedRng(0), "ripple").id).toBe("minnow");
    expect(chooseSpecies(new FixedRng(0.999_999), "ripple").id).toBe("golden-koi");

    const relaxed = sampleCount("relaxed", "legendary", 5000, 77);
    const legend = sampleCount("legend", "legendary", 5000, 77);
    expect(relaxed).toBeGreaterThan(0);
    expect(legend).toBeGreaterThan(relaxed * 5);
  });

  it("replays identical pull sequences from one seed", () => {
    const draw = (seed: number): readonly FishSpeciesId[] => {
      const rng = new SeededRng(seed);
      return Array.from(
        { length: 64 },
        () => chooseSpecies(rng, "legend", "deep-sinker", "night").id,
      );
    };
    expect(draw(2_026)).toEqual(draw(2_026));
    expect(draw(2_026)).not.toEqual(draw(2_027));
  });

  it("stocks the pond by the injected clock's day and night", () => {
    const noonMs = (24 * 400 + 12) * 3_600_000;
    const midnightMs = 24 * 400 * 3_600_000;
    expect(pondStockPhaseAt(noonMs)).toBe("day");
    expect(pondStockPhaseAt(midnightMs)).toBe("night");
    expect(pondStockPhaseAt(5.99 * 3_600_000)).toBe("night");
    expect(pondStockPhaseAt(6 * 3_600_000)).toBe("day");
    expect(pondStockPhaseAt(18 * 3_600_000)).toBe("night");

    // Moonback Catfish prowl only at night; Prism Trout prefer daylight.
    const dayOdds = stockOdds("ripple", "everyday-float", "day");
    const nightOdds = stockOdds("ripple", "everyday-float", "night");
    const percentOf = (odds: typeof dayOdds, id: FishSpeciesId): number =>
      odds.find((entry) => entry.species.id === id)?.percent ?? -1;
    expect(percentOf(dayOdds, "moonback-catfish")).toBe(0);
    expect(percentOf(nightOdds, "moonback-catfish")).toBeGreaterThan(0);
    expect(percentOf(dayOdds, "prism-trout")).toBeGreaterThan(
      percentOf(nightOdds, "prism-trout"),
    );
    expect(percentOf(nightOdds, "golden-koi")).toBeGreaterThan(
      percentOf(dayOdds, "golden-koi"),
    );
    expect(sampleCount("ripple", "epic", 4_000, 5, "everyday-float", "night")).toBeGreaterThan(
      sampleCount("ripple", "epic", 4_000, 5, "everyday-float", "day"),
    );
  });

  it("posts transparent pre-run odds that match the sampled distribution", () => {
    for (const difficulty of ["relaxed", "ripple", "legend"] as const) {
      for (const tackle of TACKLE_IDS) {
        for (const phase of ["day", "night"] as const) {
          const odds = stockOdds(difficulty, tackle, phase);
          expect(odds.map(({ species: entry }) => entry.id)).toEqual(
            FISH_SPECIES.map(({ id }) => id),
          );
          const total = odds.reduce((sum, { percent }) => sum + percent, 0);
          expect(total).toBeCloseTo(100, 9);
        }
      }
    }

    // Deep sinker at night: the posted koi odds hold up empirically.
    const posted =
      stockOdds("legend", "deep-sinker", "night").find(
        ({ species: entry }) => entry.id === "golden-koi",
      )?.percent ?? 0;
    const sampled =
      (sampleCount("legend", "legendary", 20_000, 11, "deep-sinker", "night") / 20_000) * 100;
    expect(Math.abs(sampled - posted)).toBeLessThan(posted * 0.2);

    // Feather lure boosts darting fish; deep sinker boosts the heavy ones.
    const featherTrout =
      stockOdds("ripple", "feather-lure", "day").find(
        ({ species: entry }) => entry.id === "prism-trout",
      )?.percent ?? 0;
    const everydayTrout =
      stockOdds("ripple", "everyday-float", "day").find(
        ({ species: entry }) => entry.id === "prism-trout",
      )?.percent ?? 0;
    expect(featherTrout).toBeGreaterThan(everydayTrout);
  });

  it("gives species stable, distinct signature pull patterns", () => {
    const minnow = species("minnow");
    const koi = species("golden-koi");
    const trout = species("prism-trout");
    const catfish = species("moonback-catfish");

    const sampleSeries = (fish: FishSpecies): number[] =>
      Array.from({ length: 160 }, (_, index) => surgeAt(fish, index / 20, 0.7));
    expect(sampleSeries(minnow)).toEqual(sampleSeries(minnow));
    expect(sampleSeries(trout)).toEqual(sampleSeries(trout));
    expect(sampleSeries(catfish)).toEqual(sampleSeries(catfish));

    const koiSamples = sampleSeries(koi);
    const minnowSamples = sampleSeries(minnow);
    expect(Math.max(...koiSamples.map(Math.abs))).toBeGreaterThan(
      Math.max(...minnowSamples.map(Math.abs)),
    );
    expect(new Set(koiSamples.map((sample) => sample.toFixed(4))).size).toBeGreaterThan(20);

    // The zigzag and thump signatures differ from a plain steady wave with
    // identical tuning numbers.
    const steadyTwin: FishSpecies = { ...trout, pullPattern: "steady" };
    expect(sampleSeries(trout)).not.toEqual(sampleSeries(steadyTwin));
    const steadyCat: FishSpecies = { ...catfish, pullPattern: "steady" };
    const catSamples = sampleSeries(catfish);
    const steadyCatSamples = sampleSeries(steadyCat);
    expect(catSamples).not.toEqual(steadyCatSamples);
    // The catfish echo thump adds an extra positive spike each period.
    const spikes = (samples: readonly number[]): number =>
      samples.filter((sample, index) => sample - (samples[index - 1] ?? sample) > 0.05).length;
    expect(spikes(catSamples)).toBeGreaterThan(spikes(steadyCatSamples));
  });

  it("raises, eases, snaps, and recovers tension deterministically", () => {
    const held = stepTension(0.5, true, 0, 0.5, "ripple");
    const released = stepTension(0.5, false, 0, 0.5, "ripple");
    expect(held.tension).toBeGreaterThan(0.5);
    expect(released.tension).toBeLessThan(0.5);
    expect(stepTension(0.98, true, 0.2, 1, "legend").snapped).toBe(true);
    expect(stepTension(0.02, false, -0.1, 1, "relaxed").slack).toBe(true);
  });

  it("lands a fish by holding and releasing around the green band", () => {
    for (const target of ["bass", "prism-trout", "moonback-catfish"] as const) {
      const fight = new FishingFight(species(target), 1.2, "ripple");
      for (let step = 0; step < 6000 && fight.status === "fighting"; step += 1) {
        const [greenStart, greenEnd] = fight.greenBand;
        const holding = fight.tension < (greenStart + greenEnd) / 2;
        fight.update(0.01, holding);
      }
      expect(fight.status).toBe("caught");
      expect(fight.progress).toBe(1);
    }
  });

  it("runs cast, bite, hook, fight, and timeout phases", () => {
    const round = new PondFishingRound("relaxed", new SeededRng(923));
    expect(round.tackle).toBe("everyday-float");
    expect(round.stockPhase).toBe("day");
    const target = round.shadows[0];
    expect(target).toBeDefined();
    expect(round.castAt(target?.x ?? 0, target?.y ?? 0)?.id).toBe(target?.id);
    for (let step = 0; step < 40 && round.phase === "waiting"; step += 1) round.update(0.1);
    expect(round.phase).toBe("bite");
    expect(round.hook()).toBe(true);
    expect(round.phase).toBe("fighting");
    round.update(90);
    expect(round.phase).toBe("ended");
  });

  it("spawns night shadows only from the night stock and honors tackle bite pace", () => {
    const night = new PondFishingRound("legend", new SeededRng(7), {
      tackle: "deep-sinker",
      stockPhase: "night",
    });
    expect(night.shadows).toHaveLength(5);
    const nightIds = new Set(
      stockOdds("legend", "deep-sinker", "night")
        .filter(({ percent }) => percent > 0)
        .map(({ species: entry }) => entry.id),
    );
    for (const shadow of night.shadows) {
      expect(nightIds.has(shadow.species.id)).toBe(true);
      expect(shadow.size).toBeGreaterThanOrEqual(0.65 + rarityRank(shadow.species) * 0.11);
    }

    const biteSeconds = (tackle: TackleId): number => {
      const round = new PondFishingRound("relaxed", new SeededRng(31), { tackle });
      const target = round.shadows[0];
      round.castAt(target?.x ?? 0, target?.y ?? 0);
      let waited = 0;
      while (round.phase === "waiting" && waited < 60) {
        round.update(0.05);
        waited += 0.05;
      }
      return waited;
    };
    expect(biteSeconds("feather-lure")).toBeLessThan(biteSeconds("deep-sinker"));
  });

  it("keeps the payout mapping stable and unpaid at zero", () => {
    expect(pondPayout(0, 0, 0)).toEqual({ score: 0, coins: 0, xp: 0 });
    expect(pondPayout(2_400, 4, 1)).toEqual({ score: 2_400, coins: 30, xp: 36 });
  });
});

class FixedRng implements RandomSource {
  constructor(private readonly value: number) {}
  next(): number {
    return this.value;
  }
  int(minInclusive: number, maxExclusive: number): number {
    return Math.floor(this.value * (maxExclusive - minInclusive)) + minInclusive;
  }
  pick<T>(items: readonly T[]): T {
    const picked = items[this.int(0, items.length)];
    if (picked === undefined) throw new RangeError("Cannot pick from an empty list");
    return picked;
  }
}

function sampleCount(
  difficulty: FishingDifficulty,
  rarity: FishSpecies["rarity"],
  count: number,
  seed: number,
  tackle: TackleId = "everyday-float",
  phase: PondStockPhase = "day",
): number {
  const rng = new SeededRng(seed);
  return Array.from({ length: count }, () => chooseSpecies(rng, difficulty, tackle, phase)).filter(
    (entry) => entry.rarity === rarity,
  ).length;
}
