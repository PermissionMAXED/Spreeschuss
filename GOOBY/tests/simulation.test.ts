import { describe, expect, it } from "vitest";
import {
  OFFLINE_NEED_FLOOR,
  SLEEP_DURATION_MS,
  advanceSimulation,
  catchUpOffline,
  completeSleep,
  createSimulation,
  startSleep,
  wakeEarly,
} from "../src/core/contracts/simulation";

describe("simulation", () => {
  it("is equivalent when elapsed time is split", () => {
    const initial = createSimulation(1_000);
    const whole = advanceSimulation(initial, 7_201_000);
    const split = advanceSimulation(advanceSimulation(initial, 3_601_000), 7_201_000);
    expect(split.needs).toEqual(whole.needs);
    expect(split.lastSimulatedAt).toBe(whole.lastSimulatedAt);
  });

  it("uses a real 30 minute sleep and completes with full energy", () => {
    const initial = { ...createSimulation(2_000), needs: { hunger: 70, energy: 20, hygiene: 70, fun: 70 } };
    const sleeping = startSleep(initial, 2_000);
    expect(sleeping.sleep?.completesAt).toBe(2_000 + SLEEP_DURATION_MS);
    const halfway = advanceSimulation(sleeping, 2_000 + SLEEP_DURATION_MS / 2);
    expect(halfway.needs.energy).toBeCloseTo(60);
    expect(halfway.sleep).not.toBeNull();
    const completed = completeSleep(halfway);
    expect(completed.needs.energy).toBe(100);
    expect(completed.sleep).toBeNull();
  });

  it("is split-equivalent across sleep completion", () => {
    const initial = {
      ...createSimulation(5_000),
      needs: { hunger: 62, energy: 12, hygiene: 81, fun: 55 },
    };
    const sleeping = startSleep(initial, 5_000);
    const target = 5_000 + SLEEP_DURATION_MS + 15 * 60 * 1_000;
    const whole = advanceSimulation(sleeping, target);
    const split = advanceSimulation(
      advanceSimulation(sleeping, 5_000 + SLEEP_DURATION_MS / 2),
      target,
    );
    for (const key of ["hunger", "energy", "hygiene", "fun"] as const) {
      expect(split.needs[key]).toBeCloseTo(whole.needs[key], 10);
    }
    expect(split.sleep).toBeNull();
  });

  it("preserves partial sleep energy on a gentle early wake", () => {
    const sleeping = startSleep(
      { ...createSimulation(10_000), needs: { hunger: 70, energy: 10, hygiene: 70, fun: 70 } },
      10_000,
    );
    const awake = wakeEarly(sleeping, 10_000 + SLEEP_DURATION_MS / 3);
    expect(awake.sleep).toBeNull();
    expect(awake.needs.energy).toBeCloseTo(40);
  });

  it("never decays offline needs below the floor", () => {
    const initial = {
      ...createSimulation(0),
      needs: { hunger: 16, energy: 16, hygiene: 16, fun: 16 },
    };
    const caughtUp = catchUpOffline(initial, 30 * 24 * 60 * 60 * 1_000);
    expect(Object.values(caughtUp.needs).every((value) => value >= OFFLINE_NEED_FLOOR)).toBe(true);
  });
});
