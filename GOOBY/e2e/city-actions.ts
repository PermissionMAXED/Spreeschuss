import type { Page } from "@playwright/test";

type CityPoint = readonly [number, number];
type CityPhase = "destination-board" | "driving-outbound" | "arrived" | "driving-home";

interface CityRuntime {
  readonly cityPhase: CityPhase | null;
  readonly cityCar: {
    readonly position: CityPoint;
    readonly headingRadians: number;
  } | null;
  readonly cityRoute: readonly CityPoint[] | null;
}

async function cityRuntime(page: Page): Promise<CityRuntime> {
  return page.evaluate(() => window.__gooby.runtime()) as Promise<CityRuntime>;
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
    for (const key of [...keys].reverse()) await page.keyboard.up(key);
  }
}

export async function driveCityLeg(
  page: Page,
  targetPhase: "arrived" | "destination-board",
): Promise<void> {
  let waypoint = 1;
  for (let attempt = 0; attempt < 320; attempt += 1) {
    const runtime = await cityRuntime(page);
    if (runtime.cityPhase === targetPhase) return;
    if (
      (runtime.cityPhase !== "driving-outbound" && runtime.cityPhase !== "driving-home")
      || !runtime.cityCar
      || !runtime.cityRoute
    ) {
      throw new Error(`City route stopped before ${targetPhase}: ${JSON.stringify(runtime)}`);
    }

    const route = runtime.cityRoute;
    while (waypoint < route.length - 1) {
      const point = route[waypoint];
      if (!point || Math.hypot(
        point[0] - runtime.cityCar.position[0],
        point[1] - runtime.cityCar.position[1],
      ) > 3.5) {
        break;
      }
      waypoint += 1;
    }
    const target = route[Math.min(waypoint, route.length - 1)];
    if (!target) throw new Error("Active city route has no target waypoint");
    const dx = target[0] - runtime.cityCar.position[0];
    const dz = target[1] - runtime.cityCar.position[1];
    const desired = Math.atan2(dx, dz);
    const error = headingDelta(runtime.cityCar.headingRadians, desired);
    if (Math.abs(error) < 0.1) {
      await page.waitForTimeout(75);
      continue;
    }

    const duration = Math.min(550, Math.max(90, Math.abs(error) * 390));
    await holdKeys(page, [error > 0 ? "a" : "d"], duration);
  }
  throw new Error(`Held keyboard driving did not reach ${targetPhase}: ${JSON.stringify(await cityRuntime(page))}`);
}
