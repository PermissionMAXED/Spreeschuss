export const NEED_KEYS = ["hunger", "energy", "hygiene", "fun"] as const;
export type NeedKey = (typeof NEED_KEYS)[number];
export type Needs = Record<NeedKey, number>;

export const NEED_MIN = 0;
export const NEED_MAX = 100;
export const OFFLINE_NEED_FLOOR = 15;
export const SLEEP_DURATION_MS = 30 * 60 * 1_000;

export interface SleepState {
  readonly startedAt: number;
  readonly completesAt: number;
}

export interface SimulationState {
  readonly needs: Needs;
  readonly lastSimulatedAt: number;
  readonly sleep: SleepState | null;
}

const AWAKE_DECAY_PER_HOUR: Readonly<Needs> = {
  hunger: 4,
  energy: 3,
  hygiene: 2,
  fun: 3.5,
};

const SLEEP_DECAY_PER_HOUR: Readonly<Omit<Needs, "energy">> = {
  hunger: 2,
  hygiene: 1,
  fun: 0.5,
};

export function clampNeed(value: number): number {
  return Math.max(NEED_MIN, Math.min(NEED_MAX, value));
}

export function createSimulation(now: number): SimulationState {
  return {
    needs: { hunger: 78, energy: 74, hygiene: 82, fun: 70 },
    lastSimulatedAt: now,
    sleep: null,
  };
}

function decayNeed(value: number, amount: number, floor: number): number {
  return clampNeed(Math.max(Math.min(value, floor), value - amount));
}

function decayAwake(needs: Needs, elapsedMs: number, floor: number): Needs {
  const hours = elapsedMs / 3_600_000;
  return Object.fromEntries(
    NEED_KEYS.map((key) => [
      key,
      decayNeed(needs[key], AWAKE_DECAY_PER_HOUR[key] * hours, floor),
    ]),
  ) as unknown as Needs;
}

function advanceSleeping(
  needs: Needs,
  elapsedMs: number,
  sleep: SleepState,
  from: number,
  floor: number,
): Needs {
  const hours = elapsedMs / 3_600_000;
  const progressBefore = Math.max(0, (from - sleep.startedAt) / SLEEP_DURATION_MS);
  const progressAfter = Math.min(1, (from + elapsedMs - sleep.startedAt) / SLEEP_DURATION_MS);
  const energy = needs.energy + (NEED_MAX - needs.energy) * ((progressAfter - progressBefore) / (1 - progressBefore || 1));
  return {
    hunger: decayNeed(needs.hunger, SLEEP_DECAY_PER_HOUR.hunger * hours, floor),
    energy: clampNeed(energy),
    hygiene: decayNeed(needs.hygiene, SLEEP_DECAY_PER_HOUR.hygiene * hours, floor),
    fun: decayNeed(needs.fun, SLEEP_DECAY_PER_HOUR.fun * hours, floor),
  };
}

function rebaseForClockRollback(state: SimulationState, targetTime: number): SimulationState {
  const rollbackMs = state.lastSimulatedAt - targetTime;
  return {
    ...state,
    lastSimulatedAt: targetTime,
    sleep: state.sleep
      ? {
          startedAt: state.sleep.startedAt - rollbackMs,
          completesAt: state.sleep.completesAt - rollbackMs,
        }
      : null,
  };
}

/**
 * Advances simulation without side effects. Splitting an interval into adjacent calls
 * yields the same result (within floating-point precision) as one call.
 */
export function advanceSimulation(
  state: SimulationState,
  targetTime: number,
  options: { offline?: boolean } = {},
): SimulationState {
  if (!Number.isFinite(targetTime)) throw new RangeError("Simulation target time must be finite");
  if (targetTime < state.lastSimulatedAt) return rebaseForClockRollback(state, targetTime);
  if (targetTime === state.lastSimulatedAt) return state;
  const floor = options.offline === true ? OFFLINE_NEED_FLOOR : NEED_MIN;
  let cursor = state.lastSimulatedAt;
  let needs = { ...state.needs };
  let sleep = state.sleep;

  if (sleep && cursor < sleep.completesAt) {
    const sleepEnd = Math.min(targetTime, sleep.completesAt);
    needs = advanceSleeping(needs, sleepEnd - cursor, sleep, cursor, floor);
    cursor = sleepEnd;
    if (cursor >= sleep.completesAt) {
      needs.energy = NEED_MAX;
      sleep = null;
    }
  }

  if (cursor < targetTime) needs = decayAwake(needs, targetTime - cursor, floor);

  return { needs, sleep, lastSimulatedAt: targetTime };
}

export function catchUpOffline(state: SimulationState, now: number): SimulationState {
  return advanceSimulation(state, now, { offline: true });
}

export function startSleep(state: SimulationState, now: number): SimulationState {
  const current = advanceSimulation(state, now);
  if (current.sleep) return current;
  return {
    ...current,
    sleep: { startedAt: now, completesAt: now + SLEEP_DURATION_MS },
  };
}

export function wakeEarly(state: SimulationState, now: number): SimulationState {
  const current = advanceSimulation(state, now);
  return current.sleep ? { ...current, sleep: null } : current;
}

export function completeSleep(state: SimulationState): SimulationState {
  return state.sleep ? advanceSimulation(state, state.sleep.completesAt) : state;
}

export function applyNeedDelta(state: SimulationState, key: NeedKey, amount: number): SimulationState {
  return { ...state, needs: { ...state.needs, [key]: clampNeed(state.needs[key] + amount) } };
}
