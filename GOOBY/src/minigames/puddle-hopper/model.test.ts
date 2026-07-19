import { describe, expect, it } from "vitest";
import { SeededRng } from "../../core/contracts/rng";
import {
  PUDDLE_GOOD_WINDOW_MS,
  PUDDLE_LEAD_IN_MS,
  PUDDLE_PERFECT_WINDOW_MS,
  PuddleRound,
  createPuddleBeats,
  judgeHopOffset,
} from "./model";

describe("Puddle Hopper rhythm model", () => {
  it("judges signed perfect/good windows at their exact boundaries", () => {
    expect(judgeHopOffset(-PUDDLE_PERFECT_WINDOW_MS)).toBe("perfect");
    expect(judgeHopOffset(PUDDLE_PERFECT_WINDOW_MS)).toBe("perfect");
    expect(judgeHopOffset(PUDDLE_PERFECT_WINDOW_MS + 1)).toBe("good");
    expect(judgeHopOffset(-PUDDLE_GOOD_WINDOW_MS)).toBe("good");
    expect(judgeHopOffset(PUDDLE_GOOD_WINDOW_MS)).toBe("good");
    expect(judgeHopOffset(PUDDLE_GOOD_WINDOW_MS + 1)).toBe("miss");
    expect(judgeHopOffset(Number.NaN)).toBe("miss");
  });

  it("keeps every dry target outside its named repeating splash pattern", () => {
    const beats = createPuddleBeats(new SeededRng(17), 200);
    expect(beats).toHaveLength(200);
    for (const beat of beats) {
      expect(beat.hazards).not.toContain(beat.target);
      expect(new Set(beat.hazards).size).toBe(beat.hazards.length);
      expect(beat.hazards.length).toBeGreaterThanOrEqual(3);
    }
  });

  it("tracks distance, accuracy, misses, and an explicitly raised shield", () => {
    const round = new PuddleRound(new SeededRng(42), 2);
    const first = round.beats[0];
    const second = round.beats[1];
    expect(first).toBeDefined();
    expect(second).toBeDefined();

    round.update(PUDDLE_LEAD_IN_MS / 1_000);
    expect(round.hop(first?.target ?? 0).outcome).toBe("perfect");
    expect(round.distance).toBe(1);
    expect(round.accuracy).toBe(1);

    round.update(((second?.atMs ?? 0) - round.timeMs) / 1_000);
    expect(round.activateUmbrella()).toBe(true);
    expect(round.hop(second?.hazards[0] ?? 0).outcome).toBe("shielded");
    expect(round.umbrellas).toBe(1);
    expect(round.splashes).toBe(0);
    expect(round.distance).toBe(1);
    expect(round.accuracy).toBe(0.5);
  });

  it("auto-misses expired beats once and produces bounded rewards", () => {
    const round = new PuddleRound(new SeededRng(9), 1);
    round.update((PUDDLE_LEAD_IN_MS + PUDDLE_GOOD_WINDOW_MS + 1) / 1_000);
    round.update(10);
    expect(round.finished).toBe(true);
    expect(round.misses).toBe(1);
    expect(round.attempts).toBe(1);
    expect(round.accuracy).toBe(0);
    expect(round.payout()).toEqual({ score: 0, coins: 0, xp: 0 });
  });
});
