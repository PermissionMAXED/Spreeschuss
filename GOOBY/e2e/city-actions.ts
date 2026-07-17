import type { Page } from "@playwright/test";

type CityPoint = readonly [number, number];
type CityPhase = "destination-board" | "driving-outbound" | "arrived" | "driving-home";

export const CITY_LEG_TIMEOUT_MS = 70_000;
export const CITY_PROGRESS_TIMEOUT_MS = 30_000;
export const CITY_MAX_STEER_HOLD_MS = 250;

const CITY_ROUTE_LOOKAHEAD = 32;
const CITY_PROGRESS_EPSILON = 0.45;
const CITY_STUCK_RECOVERY_MS = 1_500;
const CITY_BRAKE_COOLDOWN_MS = 550;

interface CityRuntime {
  readonly cityPhase: CityPhase | null;
  readonly cityCar: {
    readonly position: CityPoint;
    readonly headingRadians: number;
  } | null;
  readonly cityRoute: readonly CityPoint[] | null;
}

interface RouteProgress {
  readonly distanceAlongRoute: number;
  readonly distanceFromRoute: number;
  readonly distanceToNextTurn: number | null;
  readonly remainingDistance: number;
  readonly routeLength: number;
}

async function cityRuntime(page: Page, deadline: number): Promise<CityRuntime> {
  const remainingMs = deadline - performance.now();
  if (remainingMs <= 0) throw new Error("Held keyboard driving exceeded its leg timeout");
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      page.evaluate(() => window.__gooby.runtime()) as Promise<CityRuntime>,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error("Held keyboard driving exceeded its leg timeout")),
          remainingMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function headingDelta(from: number, to: number): number {
  let delta = to - from;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}

async function holdKeys(page: Page, keys: readonly string[], durationMs: number): Promise<void> {
  for (const key of keys) await page.keyboard.down(key);
  try {
    await page.waitForTimeout(durationMs);
  } finally {
    for (const key of [...keys].reverse()) {
      await page.keyboard.up(key).catch(() => undefined);
    }
  }
}

function cityRouteProgress(position: CityPoint, route: readonly CityPoint[]): RouteProgress {
  let routeLength = 0;
  let traversed = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  let bestAlong = 0;
  let bestSegmentEnd = 0;
  let bestSegmentIndex = 1;
  for (let index = 1; index < route.length; index += 1) {
    const from = route[index - 1];
    const to = route[index];
    if (!from || !to) continue;
    const dx = to[0] - from[0];
    const dz = to[1] - from[1];
    const segmentLength = Math.hypot(dx, dz);
    routeLength += segmentLength;
    const projection = segmentLength === 0
      ? 0
      : Math.max(
          0,
          Math.min(
            1,
            ((position[0] - from[0]) * dx + (position[1] - from[1]) * dz)
              / (segmentLength * segmentLength),
          ),
        );
    const projected: CityPoint = [
      from[0] + dx * projection,
      from[1] + dz * projection,
    ];
    const distance = Math.hypot(position[0] - projected[0], position[1] - projected[1]);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestAlong = traversed + segmentLength * projection;
      bestSegmentEnd = traversed + segmentLength;
      bestSegmentIndex = index;
    }
    traversed += segmentLength;
  }
  return {
    distanceAlongRoute: bestAlong,
    distanceFromRoute: bestDistance,
    distanceToNextTurn: bestSegmentIndex < route.length - 1
      ? Math.max(0, bestSegmentEnd - bestAlong)
      : null,
    remainingDistance: Math.max(0, routeLength - bestAlong) + bestDistance,
    routeLength,
  };
}

function cityRouteTarget(
  route: readonly CityPoint[],
  distanceAlongRoute: number,
): CityPoint {
  let remaining = distanceAlongRoute;
  for (let index = 1; index < route.length; index += 1) {
    const from = route[index - 1];
    const to = route[index];
    if (!from || !to) continue;
    const segmentLength = Math.hypot(to[0] - from[0], to[1] - from[1]);
    if (remaining <= segmentLength || index === route.length - 1) {
      const ratio = segmentLength === 0 ? 0 : Math.min(1, remaining / segmentLength);
      return [
        from[0] + (to[0] - from[0]) * ratio,
        from[1] + (to[1] - from[1]) * ratio,
      ];
    }
    remaining -= segmentLength;
  }
  const target = route.at(-1);
  if (!target) throw new Error("Active city route has no target waypoint");
  return target;
}

export async function driveCityLeg(
  page: Page,
  targetPhase: "arrived" | "destination-board",
): Promise<void> {
  const deadline = performance.now() + CITY_LEG_TIMEOUT_MS;
  let progressDeadline = performance.now() + CITY_PROGRESS_TIMEOUT_MS;
  let bestRemaining = Number.POSITIVE_INFINITY;
  let lastProgressAt = performance.now();
  let recoveryAttempts = 0;
  let lastBrakeAt = Number.NEGATIVE_INFINITY;
  let lastRuntime: CityRuntime | null = null;

  while (performance.now() < deadline) {
    const runtime = await cityRuntime(page, deadline);
    lastRuntime = runtime;
    if (runtime.cityPhase === targetPhase) return;
    if (
      (runtime.cityPhase !== "driving-outbound" && runtime.cityPhase !== "driving-home")
      || !runtime.cityCar
      || !runtime.cityRoute
    ) {
      throw new Error(`City route stopped before ${targetPhase}: ${JSON.stringify(runtime)}`);
    }

    const route = runtime.cityRoute;
    if (route.length < 2) throw new Error("Active city route has fewer than two waypoints");
    const now = performance.now();
    const progress = cityRouteProgress(runtime.cityCar.position, route);
    if (progress.remainingDistance < bestRemaining - CITY_PROGRESS_EPSILON) {
      bestRemaining = progress.remainingDistance;
      lastProgressAt = now;
      progressDeadline = Math.min(deadline, now + CITY_PROGRESS_TIMEOUT_MS);
      recoveryAttempts = 0;
    }
    if (now >= progressDeadline) {
      throw new Error(
        `Held keyboard driving made no route progress before ${targetPhase}: ${JSON.stringify(runtime)}`,
      );
    }

    const stuck = now - lastProgressAt >= CITY_STUCK_RECOVERY_MS;
    const distanceAlongRemaining = progress.routeLength - progress.distanceAlongRoute;
    const lookahead = distanceAlongRemaining < 12
      ? distanceAlongRemaining
      : progress.distanceFromRoute > 3
        ? 0
        : stuck
          ? CITY_ROUTE_LOOKAHEAD * 1.5
          : CITY_ROUTE_LOOKAHEAD;
    const target = cityRouteTarget(
      route,
      Math.min(progress.routeLength, progress.distanceAlongRoute + lookahead),
    );
    const dx = target[0] - runtime.cityCar.position[0];
    const dz = target[1] - runtime.cityCar.position[1];
    const desired = Math.atan2(dx, dz);
    const error = headingDelta(runtime.cityCar.headingRadians, desired);

    if (stuck) {
      recoveryAttempts += 1;
      lastProgressAt = now;
      const recoveryKey = Math.abs(error) >= 0.075
        ? error > 0 ? "a" : "d"
        : recoveryAttempts % 2 === 0 ? "a" : "d";
      await holdKeys(page, [recoveryKey], CITY_MAX_STEER_HOLD_MS);
      await page.waitForTimeout(220);
      continue;
    }

    if (Math.abs(error) < 0.075) {
      await page.waitForTimeout(55);
      continue;
    }

    const duration = Math.min(
      CITY_MAX_STEER_HOLD_MS,
      Math.max(80, Math.abs(error) * 160),
    );
    const routeEnd = route.at(-1);
    const distanceToEnd = routeEnd
      ? Math.hypot(
          routeEnd[0] - runtime.cityCar.position[0],
          routeEnd[1] - runtime.cityCar.position[1],
        )
      : Number.POSITIVE_INFINITY;
    const approachingTurn = progress.distanceToNextTurn !== null
      && progress.distanceToNextTurn < CITY_ROUTE_LOOKAHEAD
      && Math.abs(error) > 0.1;
    const brakeForCorrection = now - lastBrakeAt >= CITY_BRAKE_COOLDOWN_MS
      && (
        approachingTurn
        || Math.abs(error) > 0.45
        || progress.distanceFromRoute > 3
        || distanceToEnd < 16
      );
    await holdKeys(
      page,
      brakeForCorrection
        ? [error > 0 ? "a" : "d", "Space"]
        : [error > 0 ? "a" : "d"],
      duration,
    );
    if (brakeForCorrection) lastBrakeAt = now;
  }
  throw new Error(
    `Held keyboard driving did not reach ${targetPhase} within ${CITY_LEG_TIMEOUT_MS}ms: ${JSON.stringify(lastRuntime)}`,
  );
}
