import { describe, expect, it } from "vitest";
import { SeededRng, type RandomSource } from "../../core/contracts/rng";
import {
  FISH_SPECIES,
  FishingFight,
  PondFishingRound,
  chooseSpecies,
  stepTension,
  surgeAt,
  type FishSpecies,
} from "./model";

describe("Pond Fishing simulation", () => {
  it("maps rarity rolls from minnow through golden koi", () => {
    expect(chooseSpecies(new FixedRng(0), "ripple").id).toBe("minnow");
    expect(chooseSpecies(new FixedRng(0.999_999), "ripple").id).toBe("golden-koi");

    const relaxed = sampleLegendaryCount("relaxed", 5000, 77);
    const legend = sampleLegendaryCount("legend", 5000, 77);
    expect(relaxed).toBeGreaterThan(0);
    expect(legend).toBeGreaterThan(relaxed * 5);
  });

  it("gives species stable, distinct surge patterns", () => {
    const minnow = FISH_SPECIES[0] as FishSpecies;
    const koi = FISH_SPECIES[4] as FishSpecies;
    const minnowSamples = Array.from({ length: 80 }, (_, index) => surgeAt(minnow, index / 20, 0.7));
    const replay = Array.from({ length: 80 }, (_, index) => surgeAt(minnow, index / 20, 0.7));
    const koiSamples = Array.from({ length: 80 }, (_, index) => surgeAt(koi, index / 20, 0.7));
    expect(minnowSamples).toEqual(replay);
    expect(Math.max(...koiSamples.map(Math.abs))).toBeGreaterThan(
      Math.max(...minnowSamples.map(Math.abs)),
    );
    expect(new Set(koiSamples.map((sample) => sample.toFixed(4))).size).toBeGreaterThan(20);
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
    const species = FISH_SPECIES[2] as FishSpecies;
    const fight = new FishingFight(species, 1.2, "ripple");
    for (let step = 0; step < 6000 && fight.status === "fighting"; step += 1) {
      const [greenStart, greenEnd] = fight.greenBand;
      const holding = fight.tension < (greenStart + greenEnd) / 2;
      fight.update(0.01, holding);
    }
    expect(fight.status).toBe("caught");
    expect(fight.progress).toBe(1);
  });

  it("runs cast, bite, hook, fight, and timeout phases", () => {
    const round = new PondFishingRound("relaxed", new SeededRng(923));
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

function sampleLegendaryCount(
  difficulty: "relaxed" | "ripple" | "legend",
  count: number,
  seed: number,
): number {
  const rng = new SeededRng(seed);
  return Array.from({ length: count }, () => chooseSpecies(rng, difficulty)).filter(
    ({ rarity }) => rarity === "legendary",
  ).length;
}
