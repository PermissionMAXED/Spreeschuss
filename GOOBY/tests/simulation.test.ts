import { describe, expect, it } from "vitest";
import { FakeClock } from "../src/core/contracts/clock";
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

  it("rebases a rolled-back clock without decay and resumes immediately", () => {
    const initial = createSimulation(10_000);
    const forwarded = advanceSimulation(initial, 3_610_000);
    const rolledBack = advanceSimulation(forwarded, 20_000);

    expect(rolledBack.needs).toEqual(forwarded.needs);
    expect(rolledBack.lastSimulatedAt).toBe(20_000);

    const resumed = advanceSimulation(rolledBack, 3_620_000);
    expect(resumed.needs.hunger).toBeCloseTo(forwarded.needs.hunger - 4);
    expect(resumed.lastSimulatedAt).toBe(3_620_000);
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

  it("completes at exactly 30 minutes, never one millisecond early", () => {
    const startedAt = 1_700_000_000_000;
    const sleeping = startSleep(
      { ...createSimulation(startedAt), needs: { hunger: 70, energy: 1, hygiene: 70, fun: 70 } },
      startedAt,
    );

    const early = advanceSimulation(sleeping, startedAt + SLEEP_DURATION_MS - 1);
    expect(early.sleep).toEqual({
      startedAt,
      completesAt: startedAt + SLEEP_DURATION_MS,
    });
    expect(early.needs.energy).toBeLessThan(100);

    const onTime = advanceSimulation(early, startedAt + SLEEP_DURATION_MS);
    expect(onTime.sleep).toBeNull();
    expect(onTime.needs.energy).toBe(100);
    expect(onTime.lastSimulatedAt).toBe(startedAt + SLEEP_DURATION_MS);
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

  it("preserves sleep remaining duration across a clock rollback", () => {
    const sleeping = startSleep(
      { ...createSimulation(10_000), needs: { hunger: 70, energy: 10, hygiene: 70, fun: 70 } },
      10_000,
    );
    const halfway = advanceSimulation(sleeping, 10_000 + SLEEP_DURATION_MS / 2);
    const rolledBackAt = 25_000;
    const rolledBack = advanceSimulation(halfway, rolledBackAt);

    expect(rolledBack.needs).toEqual(halfway.needs);
    expect((rolledBack.sleep?.completesAt ?? 0) - rolledBackAt).toBe(SLEEP_DURATION_MS / 2);

    const resumed = advanceSimulation(rolledBack, rolledBackAt + 1_000);
    expect(resumed.needs.energy).toBeGreaterThan(rolledBack.needs.energy);
    expect(resumed.sleep).not.toBeNull();
  });

  it("never decays offline needs below the floor", () => {
    const initial = {
      ...createSimulation(0),
      needs: { hunger: 16, energy: 16, hygiene: 16, fun: 16 },
    };
    const caughtUp = catchUpOffline(initial, 30 * 24 * 60 * 60 * 1_000);
    expect(Object.values(caughtUp.needs).every((value) => value >= OFFLINE_NEED_FLOOR)).toBe(true);
  });

  it("does not heal a need that starts below the offline floor", () => {
    const initial = {
      ...createSimulation(0),
      needs: { hunger: 4, energy: 8, hygiene: 12, fun: 14 },
    };
    const caughtUp = catchUpOffline(initial, 30 * 24 * 60 * 60 * 1_000);
    expect(caughtUp.needs).toEqual(initial.needs);
  });

  it("keeps offline floor behavior equivalent across split intervals", () => {
    const initial = {
      ...createSimulation(0),
      needs: { hunger: 16, energy: 10, hygiene: 20, fun: 14 },
    };
    const target = 48 * 60 * 60 * 1_000;
    const whole = catchUpOffline(initial, target);
    const split = catchUpOffline(catchUpOffline(initial, target / 3), target);
    expect(split.needs).toEqual(whole.needs);
  });

  it("clamps clock rollback and huge forward offline catch-up", () => {
    const clock = new FakeClock(50_000);
    const initial = createSimulation(clock.now());

    clock.set(10_000);
    const rebased = catchUpOffline(initial, clock.now());
    expect(rebased).not.toBe(initial);
    expect(rebased.needs).toEqual(initial.needs);
    expect(rebased.lastSimulatedAt).toBe(10_000);

    clock.set(50_000 + 10 * 365 * 24 * 60 * 60 * 1_000);
    const forwarded = catchUpOffline(rebased, clock.now());
    expect(forwarded.lastSimulatedAt).toBe(clock.now());
    expect(forwarded.needs).toEqual({
      hunger: OFFLINE_NEED_FLOOR,
      energy: OFFLINE_NEED_FLOOR,
      hygiene: OFFLINE_NEED_FLOOR,
      fun: OFFLINE_NEED_FLOOR,
    });
  });

  it("rejects invalid fake-clock movement without changing time", () => {
    const clock = new FakeClock(123);
    expect(() => clock.advance(-1)).toThrow(/non-negative/u);
    expect(() => clock.advance(Number.POSITIVE_INFINITY)).toThrow(/finite/u);
    expect(() => clock.set(Number.NaN)).toThrow(/finite/u);
    expect(clock.now()).toBe(123);
  });
});
