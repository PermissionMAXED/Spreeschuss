import { describe, expect, it } from "vitest";
import { EXPANSION_MINIGAME_IDS } from "../src/core/contracts/scenes";
import type { RandomSource } from "../src/core/contracts/rng";
import { DE_CATALOG, EN_CATALOG } from "../src/i18n";
import { MINIGAME_MANIFESTS, MINIGAME_REGISTRY } from "../src/minigames/registry";
import { CP_STUB_PAD_COUNT, CpStubRound } from "../src/minigames/stub";

/** Deterministic RNG that replays a scripted sequence of unit floats. */
class ScriptedRng implements RandomSource {
  private cursor = 0;

  constructor(private readonly values: readonly number[]) {}

  next(): number {
    const value = this.values[this.cursor % this.values.length] ?? 0;
    this.cursor += 1;
    return value;
  }

  int(minInclusive: number, maxExclusive: number): number {
    return minInclusive + Math.floor(this.next() * (maxExclusive - minInclusive));
  }

  pick<T>(items: readonly T[]): T {
    const item = items[Math.floor(this.next() * items.length)];
    if (item === undefined) throw new RangeError("Expected a non-empty list");
    return item;
  }
}

/** Always spawns a safe (non-hazard) target on pad four. */
function safeRng(): ScriptedRng {
  return new ScriptedRng([4 / CP_STUB_PAD_COUNT, 0.99]);
}

/** Always spawns a hazard on pad four. */
function hazardRng(): ScriptedRng {
  return new ScriptedRng([4 / CP_STUB_PAD_COUNT, 0]);
}

/** Expansion flagships shipped as complete specialist builds (no stub marker). */
const SPECIALIST_EXPANSION_IDS = ["cake-atelier", "shopping-surf"] as const;

describe("CP1 expansion modules", () => {
  it("exposes a playable module and final manifest for all twelve new ids", () => {
    expect(EXPANSION_MINIGAME_IDS).toHaveLength(12);
    for (const id of EXPANSION_MINIGAME_IDS) {
      const manifest = MINIGAME_MANIFESTS.get(id);
      if ((SPECIALIST_EXPANSION_IDS as readonly string[]).includes(id)) {
        expect(manifest?.dev, `${id} shipped final and must not carry stub metadata`).toBeUndefined();
      } else {
        expect(manifest?.dev, `${id} must carry stub metadata`).toEqual({
          cpStub: true,
          checkpoint: "CP1",
        });
      }
      expect(manifest?.stage3d).toBe(false);
      expect(manifest?.unlockLevel).toBe(1);
      const module = MINIGAME_REGISTRY.get(id)?.();
      expect(module?.id).toBe(id);
      expect(module?.title).toBe(EN_CATALOG.minigames[id].title);
      expect(module?.instructions).toBe(EN_CATALOG.minigames[id].instructions);
      expect(module?.payout()).toEqual({ score: 0, coins: 0, xp: 0 });
    }
  });

  it("localizes every tutorial step differently in english and german", () => {
    for (const id of EXPANSION_MINIGAME_IDS) {
      const manifest = MINIGAME_MANIFESTS.get(id);
      expect(manifest?.title.en).toBe(EN_CATALOG.minigames[id].title);
      expect(manifest?.title.de).toBe(DE_CATALOG.minigames[id].title);
      for (const step of manifest?.tutorial ?? []) {
        expect(step.body.en).not.toBe(step.body.de);
      }
    }
  });
});

describe("CpStubRound engine", () => {
  it("spawns a target after the initial cooldown and scores a catch", () => {
    const round = new CpStubRound(safeRng());
    expect(round.target).toBeNull();
    round.update(0.7);
    expect(round.target).toEqual({ pad: 4, hazard: false });
    expect(round.tap(4)).toBe("hit");
    expect(round.score).toBe(11);
    expect(round.streak).toBe(1);
    expect(round.target).toBeNull();
  });

  it("expires an uncaught target and breaks the streak", () => {
    const round = new CpStubRound(safeRng(), { targetLifetimeSeconds: 1 });
    round.update(0.7);
    round.tap(4);
    expect(round.streak).toBe(1);
    round.update(0.35);
    expect(round.target).not.toBeNull();
    round.update(1.05);
    expect(round.target).toBeNull();
    expect(round.streak).toBe(0);
    expect(round.bestStreak).toBe(1);
  });

  it("punishes hazard taps and empty taps without going negative", () => {
    const round = new CpStubRound(hazardRng(), { hazardChance: 1 });
    round.update(0.7);
    expect(round.target).toEqual({ pad: 4, hazard: true });
    expect(round.tap(4)).toBe("hazard");
    expect(round.score).toBe(0);
    expect(round.tap(2)).toBe("empty");
    expect(round.taps).toBe(2);
    expect(round.streak).toBe(0);
  });

  it("marks every fifth consecutive catch as a combo", () => {
    const round = new CpStubRound(safeRng());
    const outcomes: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      round.update(0.7);
      outcomes.push(round.tap(4));
    }
    expect(outcomes).toEqual(["hit", "hit", "hit", "hit", "combo"]);
    expect(round.bestStreak).toBe(5);
    expect(round.score).toBe(11 + 12 + 13 + 14 + 15);
  });

  it("finishes when the round timer runs out and freezes further play", () => {
    const round = new CpStubRound(safeRng(), { roundSeconds: 2 });
    round.update(0.7);
    round.tap(4);
    round.update(5);
    expect(round.finished).toBe(true);
    expect(round.tap(4)).toBe("empty");
    const before = round.score;
    round.update(1);
    expect(round.score).toBe(before);
  });

  it("caps the payout rewards while keeping the raw score", () => {
    const round = new CpStubRound(safeRng(), { roundSeconds: 10_000 });
    for (let i = 0; i < 200; i += 1) {
      round.update(0.7);
      round.tap(4);
    }
    expect(round.score).toBeGreaterThan(2_000);
    const payout = round.payout();
    expect(payout.score).toBe(Math.floor(round.score));
    expect(payout.coins).toBe(40);
    expect(payout.xp).toBe(90);
  });

  it("keeps its behavior deterministic for identical rng scripts", () => {
    const play = (): number => {
      const round = new CpStubRound(new ScriptedRng([0.1, 0.9, 0.5, 0.3]), { roundSeconds: 30 });
      for (let i = 0; i < 40; i += 1) {
        round.update(0.5);
        const target = round.target;
        if (target && !target.hazard) round.tap(target.pad);
      }
      return round.score;
    };
    expect(play()).toBe(play());
  });
});
