import { describe, expect, it } from "vitest";
import { SeededRng } from "../../core/contracts/rng";
import { DE_CATALOG, EN_CATALOG } from "../../i18n";
import { manifest } from "./index";
import {
  beginCloudRun,
  CLOUD_STEP_SECONDS,
  createCloudState,
  drainCloudEvents,
  setCloudDrift,
  stepCloud,
  type CloudState,
} from "./model";
import { CLOUD_COIN_CAP, CLOUD_XP_CAP, cloudPayout } from "./settlement";

function run(
  state: CloudState,
  seconds: number,
  onStep?: (state: CloudState, index: number) => void,
): string[] {
  const kinds: string[] = [];
  const steps = Math.round(seconds / CLOUD_STEP_SECONDS);
  for (let index = 0; index < steps; index += 1) {
    onStep?.(state, index);
    stepCloud(state, CLOUD_STEP_SECONDS);
    drainCloudEvents(state, (kind) => kinds.push(kind));
  }
  return kinds;
}

describe("cloud bounce manifest", () => {
  it("ships a final localized manifest with tutorial and audio cues", () => {
    expect(manifest.id).toBe("cloud-bounce");
    expect(manifest.stage3d).toBe(false);
    expect(manifest.title.en).toBe(EN_CATALOG.minigames["cloud-bounce"].title);
    expect(manifest.title.de).toBe(DE_CATALOG.minigames["cloud-bounce"].title);
    expect(manifest.instructions.en).toBe(EN_CATALOG.minigames["cloud-bounce"].instructions);
    expect(manifest.instructions.de).toBe(DE_CATALOG.minigames["cloud-bounce"].instructions);
    expect(manifest.tutorial).toHaveLength(3);
    for (const step of manifest.tutorial ?? []) {
      expect(step.title.en).not.toBe(step.title.de);
      expect(step.body.en.length).toBeGreaterThan(10);
      expect(step.body.de.length).toBeGreaterThan(10);
    }
    expect(manifest.audioCues).toContain("combo");
    expect(manifest.audioCues).toContain("lose");
  });
});

describe("cloud bounce model in vitest", () => {
  it("replays the same seed and drift script to an identical state", () => {
    const script = (state: CloudState, index: number): void => {
      if (index === 45) setCloudDrift(state, -1);
      if (index === 150) setCloudDrift(state, 0.8);
      if (index === 260) setCloudDrift(state, 0);
    };
    const first = createCloudState(new SeededRng(21));
    const second = createCloudState(new SeededRng(21));
    beginCloudRun(first);
    beginCloudRun(second);
    run(first, 6, script);
    run(second, 6, script);
    expect(JSON.parse(JSON.stringify(first))).toEqual(JSON.parse(JSON.stringify(second)));
  });

  it("ends the run exactly once, only by falling", () => {
    const state = createCloudState(new SeededRng(6));
    beginCloudRun(state);
    const kinds = run(state, 2, (current, index) => {
      // Cut every cloud away mid-flight so the player must fall out.
      if (index === 30) for (const cloud of current.clouds) cloud.active = false;
    });
    expect(state.phase).toBe("finished");
    expect(state.endReason).toBe("fall");
    expect(kinds.filter((kind) => kind === "fall")).toHaveLength(1);
    expect(kinds.filter((kind) => kind === "finished")).toHaveLength(1);
  });
});

describe("cloud bounce payout", () => {
  it("clamps coins and xp and floors the score", () => {
    expect(cloudPayout(0, 0)).toEqual({ score: 0, coins: 0, xp: 0 });
    expect(cloudPayout(280, 4)).toEqual({ score: 280, coins: 24, xp: 52 });
    expect(cloudPayout(1_000_000, 99).coins).toBe(CLOUD_COIN_CAP);
    expect(cloudPayout(1_000_000, 99).xp).toBe(CLOUD_XP_CAP);
    expect(cloudPayout(-10, -1)).toEqual({ score: 0, coins: 0, xp: 0 });
  });
});
