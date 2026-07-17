import { expect, test, type Locator, type Page } from "@playwright/test";
import type { CityDriveDebugSnapshot } from "./scene";
import { CITY_GARAGE_POSITION, type CityPoint } from "../../data/city";

async function snapshot(page: Page): Promise<CityDriveDebugSnapshot> {
  return page.evaluate(() => window.__cityHarness.snapshot());
}

async function holdFor(page: Page, control: Locator, durationMs: number): Promise<boolean> {
  const box = await control.boundingBox();
  if (!box) return false;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  try {
    await page.waitForTimeout(durationMs);
  } finally {
    await page.mouse.up();
  }
  return true;
}

function headingDelta(from: number, to: number): number {
  let delta = to - from;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}

async function steerToward(
  page: Page,
  target: CityPoint,
  radius: number,
  stopPhase?: CityDriveDebugSnapshot["state"]["phase"],
): Promise<void> {
  const left = page.getByRole("button", { name: "Hold to steer left" });
  const right = page.getByRole("button", { name: "Hold to steer right" });
  for (let attempt = 0; attempt < 260; attempt += 1) {
    const current = await snapshot(page);
    if (stopPhase && current.state.phase === stopPhase) return;
    const dx = target[0] - current.car.position[0];
    const dz = target[1] - current.car.position[1];
    if (Math.hypot(dx, dz) <= radius) return;
    const desired = Math.atan2(dx, dz);
    const error = headingDelta(current.car.headingRadians, desired);
    if (Math.abs(error) < 0.11) {
      await page.waitForTimeout(70);
    } else {
      const held = await holdFor(
        page,
        error > 0 ? left : right,
        Math.min(650, Math.max(100, Math.abs(error) * 420)),
      );
      if (!held && stopPhase && (await snapshot(page)).state.phase === stopPhase) return;
    }
  }
  throw new Error(`Pointer steering did not reach ${target.join(", ")}: ${JSON.stringify(await snapshot(page))}`);
}

test("real pointer-held steering drives outbound and completes the required return", async ({ page }) => {
  await page.goto("/src/scenes/city/dev-harness.html");
  await expect(page.locator("#city-harness")).toHaveAttribute("data-ready", "true");

  await page.getByTestId("destination-carrot-market").click();
  await expect.poll(async () => (await snapshot(page)).state).toMatchObject({
    phase: "depart-ready",
    car: "parked",
    selected: "carrot-market",
  });
  expect((await snapshot(page)).car.speed).toBe(0);

  await page.getByTestId("start-drive").click();
  await expect.poll(async () => (await snapshot(page)).car.position[1], { timeout: 25_000 })
    .toBeLessThan(-31);
  expect(await holdFor(page, page.getByRole("button", { name: "Hold brake" }), 750)).toBe(true);
  await steerToward(page, [-18, -44], 3, "arrived");
  await expect.poll(async () => (await snapshot(page)).state.phase).toBe("arrived");
  await expect(page.getByTestId("enter-shop")).toBeVisible();

  await page.getByTestId("enter-shop").click();
  await expect.poll(async () => (await snapshot(page)).state.phase).toBe("return-board");
  await expect(page.getByTestId("quick-return")).toBeHidden();
  await expect(page.getByText(/first visit makes the return journey/u)).toBeVisible();
  await page.getByTestId("drive-home").click();

  await steerToward(page, [0, -44], 3);
  expect(await holdFor(page, page.getByRole("button", { name: "Hold brake" }), 600)).toBe(true);
  await steerToward(page, CITY_GARAGE_POSITION, 3, "destination-board");
  await expect.poll(async () => (await snapshot(page)).state.phase, { timeout: 25_000 })
    .toBe("destination-board");
  const finished = await snapshot(page);
  expect(finished.car.position).toEqual([0, 52]);
  expect(finished.state).toEqual({ phase: "destination-board", car: "parked", selected: null });
  await page.screenshot({
    path: "/opt/cursor/artifacts/gooby_city_return_complete.png",
    animations: "disabled",
  });

  const video = page.video();
  await page.close();
  await video?.saveAs("/opt/cursor/artifacts/gooby_city_pointer_drive_outbound_return.webm");
});

test("renders the fog-free city route, hold controls, and gold guidance", async ({ page }) => {
  await page.goto("/src/scenes/city/dev-harness.html");
  await expect(page.locator("#city-harness")).toHaveAttribute("data-ready", "true");
  await page.getByTestId("destination-carrot-market").click();
  await page.getByTestId("start-drive").click();
  await expect.poll(async () => (await snapshot(page)).car.position[1], { timeout: 15_000 })
    .toBeLessThan(38);
  await expect(page.getByTestId("city-distance")).toBeVisible();
  await expect(page.getByRole("button", { name: "Hold brake" })).toBeVisible();
  await page.screenshot({
    path: "/opt/cursor/artifacts/gooby_city_drive_guidance.png",
    animations: "disabled",
  });
});
