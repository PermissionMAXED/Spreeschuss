import { describe, expect, it } from "vitest";
import type {
  MinigameFeedback,
  MinigameLifecycle,
  MinigamePayout,
  MinigameSettlementReceipt,
} from "../../core/contracts/minigame";
import type { RandomSource } from "../../core/contracts/rng";
import bunnyHopSource from "../bunny-hop/index.ts?raw";
import goobySaysSource from "../gooby-says/index.ts?raw";
import pancakePeakSource from "../pancake-peak/index.ts?raw";
import carrotCatchSource from "./index.ts?raw";
import {
  CARROT_CATCH_DURATION_SECONDS,
  CarrotCatchSimulation,
  carrotCatchDifficulty,
  carrotCatchPayout,
  scoreCaughtItem,
} from "./logic";
import { MinigameRunSession } from "./run-session";

class FixedRng implements RandomSource {
  public next(): number {
    return 0.5;
  }

  public int(minInclusive: number, maxExclusive: number): number {
    return Math.floor((minInclusive + maxExclusive - 1) / 2);
  }

  public pick<T>(items: readonly T[]): T {
    const item = items[Math.floor(items.length / 2)];
    if (item === undefined) throw new RangeError("Expected a non-empty list");
    return item;
  }
}

class RecordingLifecycle implements MinigameLifecycle {
  public readonly feedback: MinigameFeedback = { emit: () => undefined };
  public completions = 0;
  public exits = 0;
  private sequence = 0;
  private best = 11;
  private active: string | null = null;
  private readonly receipts = new Map<string, MinigameSettlementReceipt>();

  public get persistedBest(): number {
    return this.best;
  }

  public beginRun(): string {
    this.sequence += 1;
    this.active = `run-${this.sequence}`;
    return this.active;
  }

  public completeRun(runId: string, payout: MinigamePayout): MinigameSettlementReceipt {
    const previous = this.receipts.get(runId);
    if (previous) return previous;
    if (this.active !== runId) throw new Error("inactive run");
    this.completions += 1;
    this.best = Math.max(this.best, payout.score);
    const receipt = {
      runId,
      minigameId: "carrot-catch" as const,
      payout,
      bestScore: this.best,
      completedAt: this.sequence,
    };
    this.receipts.set(runId, receipt);
    this.active = null;
    return receipt;
  }

  public exit(): void {
    if (this.active) this.exits += 1;
    this.active = null;
  }
}

function partitionedCarrotRun(fps: 30 | 60 | 120): {
  readonly snapshot: ReturnType<CarrotCatchSimulation["snapshot"]>;
  readonly eventTypes: readonly string[];
} {
  const game = new CarrotCatchSimulation(new FixedRng());
  game.moveBasket(0.5);
  for (let frame = 0; frame < CARROT_CATCH_DURATION_SECONDS * fps; frame += 1) {
    game.update(1 / fps);
  }
  return {
    snapshot: game.snapshot(),
    eventTypes: game.drainEvents().map((event) => event.type),
  };
}

describe("Carrot Catch simulation", () => {
  it("scores catches, multipliers, golden carrots, and rotten resets", () => {
    expect(scoreCaughtItem("carrot", 0)).toEqual({ points: 10, nextCombo: 1 });
    expect(scoreCaughtItem("carrot", 4)).toEqual({ points: 20, nextCombo: 5 });
    expect(scoreCaughtItem("golden", 9)).toEqual({ points: 150, nextCombo: 10 });
    expect(scoreCaughtItem("rotten", 17)).toEqual({ points: -30, nextCombo: 0 });
  });

  it("ramps spawn frequency, fall speed, and rotten chance across 75 seconds", () => {
    const opening = carrotCatchDifficulty(0);
    const finale = carrotCatchDifficulty(CARROT_CATCH_DURATION_SECONDS);
    expect(finale.spawnInterval).toBeLessThan(opening.spawnInterval);
    expect(finale.fallSpeed).toBeGreaterThan(opening.fallSpeed);
    expect(finale.rottenChance).toBeGreaterThan(opening.rottenChance);
  });

  it("launches a bonus wave every 20 clean catches and ends at 75 seconds", () => {
    const game = new CarrotCatchSimulation(new FixedRng());
    game.moveBasket(0.5);
    game.update(CARROT_CATCH_DURATION_SECONDS);
    const events = game.drainEvents();
    const snapshot = game.snapshot();
    expect(snapshot.catches).toBeGreaterThanOrEqual(20);
    expect(events.some((event) => event.type === "bonus-wave")).toBe(true);
    expect(events.at(-1)?.type).toBe("finished");
    expect(snapshot.finished).toBe(true);
    expect(snapshot.timeLeft).toBe(0);
  });

  it("keeps rewards bounded and fully disposes live entities and events", () => {
    expect(carrotCatchPayout(3_000, 60)).toEqual({ score: 3_000, coins: 94, xp: 211 });
    expect(carrotCatchPayout(100_000, 500)).toEqual({ score: 100_000, coins: 100, xp: 220 });
    const game = new CarrotCatchSimulation(new FixedRng());
    game.update(2);
    expect(game.snapshot().items.length).toBeGreaterThan(0);
    game.dispose();
    const disposed = game.snapshot();
    expect(disposed).toMatchObject({ disposed: true, finished: true });
    expect(disposed.items).toHaveLength(0);
    expect(game.drainEvents()).toHaveLength(0);
    game.update(10);
    expect(game.snapshot()).toEqual(disposed);
  });

  it("produces identical state and ordered events at 30, 60, and 120 fps", () => {
    const at30 = partitionedCarrotRun(30);
    const at60 = partitionedCarrotRun(60);
    const at120 = partitionedCarrotRun(120);
    expect(at30).toEqual(at60);
    expect(at60).toEqual(at120);
    expect(at120.eventTypes.at(-1)).toBe("finished");
  });
});

describe("owned minigame lifecycle integration", () => {
  it("exits a zero-action run unpaid and settles duplicates once before replay", () => {
    const lifecycle = new RecordingLifecycle();
    const session = new MinigameRunSession(lifecycle);
    const payout = { coins: 8, xp: 13, score: 50 };

    session.begin();
    expect(session.quit(payout)).toBeNull();
    expect(lifecycle).toMatchObject({ exits: 1, completions: 0, persistedBest: 11 });

    const firstRun = session.begin();
    session.markAction();
    const receipt = session.complete(payout);
    expect(session.complete({ coins: 999, xp: 999, score: 999 })).toBe(receipt);
    expect(lifecycle).toMatchObject({ completions: 1, persistedBest: 50 });

    const replayRun = session.begin();
    expect(replayRun).not.toBe(firstRun);
    session.markAction();
    expect(session.complete({ coins: 1, xp: 1, score: 20 })?.bestScore).toBe(50);
    expect(lifecycle.completions).toBe(2);
  });

  it("contains no private storage, audio context, vibration, or deprecated finish calls", () => {
    const forbidden = [
      ["Audio", "Context"].join(""),
      ["local", "Storage"].join(""),
      ["navigator", ".vibrate"].join(""),
      ["context", ".finish"].join(""),
    ];
    for (const source of [carrotCatchSource, pancakePeakSource, bunnyHopSource, goobySaysSource]) {
      for (const token of forbidden) expect(source).not.toContain(token);
    }
  });
});
