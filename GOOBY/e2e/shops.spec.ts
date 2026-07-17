import { expect, test, type Page } from "./fixtures";

interface CityRuntime {
  readonly cityPhase: string | null;
  readonly cityCar: {
    readonly position: readonly [number, number];
    readonly headingRadians: number;
  } | null;
  readonly cityRoute: readonly (readonly [number, number])[] | null;
}

function headingDelta(from: number, to: number): number {
  let delta = to - from;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}

async function holdKey(page: Page, key: string, durationMs: number): Promise<void> {
  await page.keyboard.down(key);
  try {
    await page.waitForTimeout(durationMs);
  } finally {
    await page.keyboard.up(key).catch(() => undefined);
  }
}

async function driveSalonRoute(page: Page): Promise<void> {
  let waypoint = 1;
  for (let attempt = 0; attempt < 360; attempt += 1) {
    await page.waitForFunction(() => window.__gooby !== undefined);
    let runtime: CityRuntime;
    try {
      runtime = await page.evaluate(() => window.__gooby.runtime());
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        message.includes("Execution context was destroyed")
        || message.includes("reading 'runtime'")
      ) {
        await page.waitForTimeout(100);
        continue;
      }
      throw error;
    }
    if (runtime.cityPhase === "arrived") return;
    if (runtime.cityPhase !== "driving-outbound" || !runtime.cityCar || !runtime.cityRoute) {
      throw new Error(`City route stopped before the salon: ${JSON.stringify(runtime)}`);
    }
    while (waypoint < runtime.cityRoute.length - 1) {
      const point = runtime.cityRoute[waypoint];
      if (!point || Math.hypot(
        point[0] - runtime.cityCar.position[0],
        point[1] - runtime.cityCar.position[1],
      ) > 3.5) {
        break;
      }
      waypoint += 1;
    }
    const target = runtime.cityRoute[Math.min(waypoint, runtime.cityRoute.length - 1)];
    if (!target) throw new Error("Salon route has no target waypoint");
    const desired = Math.atan2(
      target[0] - runtime.cityCar.position[0],
      target[1] - runtime.cityCar.position[1],
    );
    const error = headingDelta(runtime.cityCar.headingRadians, desired);
    if (Math.abs(error) < 0.1) {
      await page.waitForTimeout(75);
      continue;
    }
    await holdKey(
      page,
      error > 0 ? "a" : "d",
      Math.min(550, Math.max(90, Math.abs(error) * 390)),
    );
  }
  throw new Error("Held keyboard driving did not reach Fluff Salon");
}

async function openSalon(page: Page): Promise<void> {
  await page.addInitScript(() => {
    if (sessionStorage.getItem("e2e-salon-fresh-start")) return;
    localStorage.clear();
    sessionStorage.setItem("e2e-salon-fresh-start", "true");
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator("#app")).toHaveAttribute("data-ready", "true");

  const onboarding = page.getByTestId("onboarding");
  await onboarding.getByRole("button", { name: "Meet Gooby" }).click();
  const canvas = page.locator("canvas");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Canvas has no layout box");
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.51);
  await expect(onboarding.getByText("Share a snack")).toBeVisible();
  await page.getByTestId("feed").click();
  await expect(onboarding.getByText("You did it!")).toBeVisible();
  await onboarding.getByRole("button", { name: "Welcome home" }).dispatchEvent("click");
  await expect(onboarding).toBeHidden();

  await page.locator('.tab-bar [data-panel="places"]').click();
  await page.getByTestId("open-city-board").click();
  await page.getByTestId("destination-fluff-salon").click();
  await page.getByTestId("start-drive").click();
  await expect.poll(async () => page.evaluate(() => window.__gooby.runtime().cityPhase))
    .toBe("driving-outbound");
  await driveSalonRoute(page);
  await page.getByTestId("enter-shop").click();
  await expect.poll(async () => page.evaluate(() => window.__gooby.runtime().sceneId))
    .toBe("shop:fluff-salon");
}

test("renders all four live cosmetic sockets on Gooby at 390×844", async ({ page }) => {
  test.slow();
  await openSalon(page);

  for (const itemId of [
    "sunny-bucket-hat",
    "clover-ear-clips",
    "gingham-neck-scarf",
    "picnic-mini-backpack",
  ]) {
    await page.locator(`.shop-catalog [data-shop-item="${itemId}"]`).click();
    await page.locator('[data-shop-action="try"]').click();
  }
  await page.locator('[data-shop-action="close"]').click();
  await expect(page.locator(".shop-inspect")).toBeHidden();
  await expect(page.locator(".toast")).not.toHaveClass(/show/u, { timeout: 5_000 });
  await expect(page.locator("canvas")).toBeVisible();
  await expect(page).toHaveScreenshot("fluff-salon-four-socket-390x844.png", {
    animations: "disabled",
    maxDiffPixelRatio: 0.03,
  });
});
