import { describe, expect, it } from "vitest";
import { SeededRng } from "../../core/contracts/rng";
import { DE_CATALOG, EN_CATALOG } from "../../i18n";
import { manifest } from "./index";
import {
  beginFireflyRun,
  beginFireflyStroke,
  createFireflyState,
  drainFireflyEvents,
  endFireflyStroke,
  extendFireflyStroke,
  FIREFLY_INTRO_SECONDS,
  FIREFLY_ROUND_COUNT,
  FIREFLY_STEP_SECONDS,
  stepFirefly,
  type FireflyState,
} from "./model";
import { FIREFLY_COIN_CAP, FIREFLY_XP_CAP, fireflyPayout } from "./settlement";

function run(
  state: FireflyState,
  seconds: number,
  onStep?: (state: FireflyState, index: number) => void,
): string[] {
  const kinds: string[] = [];
  const steps = Math.round(seconds / FIREFLY_STEP_SECONDS);
  for (let index = 0; index < steps; index += 1) {
    onStep?.(state, index);
    stepFirefly(state, FIREFLY_STEP_SECONDS);
    drainFireflyEvents(state, (kind) => kinds.push(kind));
  }
  return kinds;
}

describe("firefly lantern manifest", () => {
  it("ships a final localized manifest with tutorial and audio cues", () => {
    expect(manifest.id).toBe("firefly-lantern");
    expect(manifest.stage3d).toBe(false);
    expect(manifest.title.en).toBe(EN_CATALOG.minigames["firefly-lantern"].title);
    expect(manifest.title.de).toBe(DE_CATALOG.minigames["firefly-lantern"].title);
    expect(manifest.instructions.en).toBe(EN_CATALOG.minigames["firefly-lantern"].instructions);
    expect(manifest.instructions.de).toBe(DE_CATALOG.minigames["firefly-lantern"].instructions);
    expect(manifest.tutorial).toHaveLength(3);
    for (const step of manifest.tutorial ?? []) {
      expect(step.title.en).not.toBe(step.title.de);
      expect(step.body.en.length).toBeGreaterThan(10);
      expect(step.body.de.length).toBeGreaterThan(10);
    }
    expect(manifest.audioCues).toContain("combo");
    expect(manifest.audioCues).toContain("win");
  });
});

describe("firefly lantern model in vitest", () => {
  it("replays the same seed and script to an identical state", () => {
    const script = (state: FireflyState, index: number): void => {
      if (state.phase !== "playing") return;
      if (index === 110) beginFireflyStroke(state, 0.25, 0.82);
      if (index > 110 && index < 200) {
        extendFireflyStroke(state, 0.25 + (index - 110) * 0.004, 0.82);
      }
      if (index === 200) endFireflyStroke(state);
    };
    const first = createFireflyState(new SeededRng(7));
    const second = createFireflyState(new SeededRng(7));
    beginFireflyRun(first);
    beginFireflyRun(second);
    run(first, 6, script);
    run(second, 6, script);
    expect(JSON.parse(JSON.stringify(first))).toEqual(JSON.parse(JSON.stringify(second)));
  });

  it("plays five rounds and finishes exactly once", () => {
    const state = createFireflyState(new SeededRng(3));
    beginFireflyRun(state);
    const kinds: string[] = [];
    // Fast-forward each round by forcing the timer once playing starts.
    kinds.push(
      ...run(state, (FIREFLY_INTRO_SECONDS + 4.2) * FIREFLY_ROUND_COUNT + 2, (current) => {
        if (current.phase === "playing" && current.timeLeft > 1) {
          current.timeLeft = FIREFLY_STEP_SECONDS;
        }
      }),
    );
    expect(state.phase).toBe("finished");
    expect(kinds.filter((kind) => kind === "round-start")).toHaveLength(FIREFLY_ROUND_COUNT);
    expect(kinds.filter((kind) => kind === "finished")).toHaveLength(1);
  });
});

describe("firefly lantern payout", () => {
  it("clamps coins and xp and floors the score", () => {
    expect(fireflyPayout(0, 0)).toEqual({ score: 0, coins: 0, xp: 0 });
    expect(fireflyPayout(240, 3)).toEqual({ score: 240, coins: 20, xp: 52 });
    expect(fireflyPayout(1_000_000, 99).coins).toBe(FIREFLY_COIN_CAP);
    expect(fireflyPayout(1_000_000, 99).xp).toBe(FIREFLY_XP_CAP);
    expect(fireflyPayout(-10, -1)).toEqual({ score: 0, coins: 0, xp: 0 });
  });
});
