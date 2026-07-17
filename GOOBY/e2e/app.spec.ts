import { expect, test, type Page } from "@playwright/test";

async function freshStart(page: Page): Promise<void> {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator("#app")).toHaveAttribute("data-ready", "true");
}

async function finishOnboarding(page: Page): Promise<void> {
  const onboarding = page.getByTestId("onboarding");
  if (await onboarding.isVisible()) {
    await onboarding.getByRole("button").click();
    await onboarding.getByRole("button").click();
    await onboarding.getByRole("button").click();
    await expect(onboarding).toBeHidden();
  }
}

test("boots a rendered, non-black portrait game", async ({ page }) => {
  await freshStart(page);
  await expect(page.locator("canvas")).toBeVisible();
  const pixel = await page.locator("canvas").evaluate(async (canvas: HTMLCanvasElement) => {
    return new Promise<number[]>((resolve) => {
      requestAnimationFrame(() => {
        const gl = canvas.getContext("webgl2");
        if (!gl) {
          resolve([0, 0, 0, 0]);
          return;
        }
        const result = new Uint8Array(4);
        gl.readPixels(
          Math.floor(gl.drawingBufferWidth / 2),
          Math.floor(gl.drawingBufferHeight / 2),
          1,
          1,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          result,
        );
        resolve([...result]);
      });
    });
  });
  expect(pixel[3]).toBe(255);
  expect((pixel[0] ?? 0) + (pixel[1] ?? 0) + (pixel[2] ?? 0)).toBeGreaterThan(30);
});

test("completes and persists first-run onboarding", async ({ page }) => {
  await freshStart(page);
  await expect(page.getByRole("heading", { name: "Meet Gooby" })).toBeVisible();
  await finishOnboarding(page);
  await expect.poll(async () => page.evaluate(() => window.__gooby.snapshot()?.profile.onboardingComplete)).toBe(true);
  await page.reload();
  await expect(page.getByTestId("onboarding")).toBeHidden();
});

test("petting Gooby produces a visible happy reaction", async ({ page }) => {
  await freshStart(page);
  await finishOnboarding(page);
  const canvas = page.locator("canvas");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Canvas has no layout box");
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.51);
  await expect(page.locator(".heart-particle").first()).toBeVisible();
  await expect.poll(async () => page.evaluate(() => window.__gooby.snapshot()?.simulation.needs.fun)).toBeGreaterThan(70);
});

test("feeding consumes a carrot, raises hunger, grants XP, and survives reload", async ({ page }) => {
  await freshStart(page);
  await finishOnboarding(page);
  const before = await page.evaluate(() => window.__gooby.snapshot());
  await page.getByTestId("feed").click();
  await expect.poll(async () => page.evaluate(() => window.__gooby.snapshot()?.inventory.carrot)).toBe(2);
  await expect.poll(async () => page.evaluate(() => window.__gooby.snapshot()?.economy.xp)).toBe(10);
  expect((await page.evaluate(() => window.__gooby.snapshot()?.simulation.needs.hunger)) ?? 0)
    .toBeGreaterThan(before?.simulation.needs.hunger ?? 0);
  await page.reload();
  await expect.poll(async () => page.evaluate(() => window.__gooby.snapshot()?.inventory.carrot)).toBe(2);
  await expect(page.getByTestId("feed")).toContainText("2 carrots");
});

test("30-minute sleep persists across reload and completes deterministically", async ({ page }) => {
  await freshStart(page);
  await finishOnboarding(page);
  await page.getByTestId("sleep").click();
  await expect(page.locator(".sleep-overlay")).toBeVisible();
  const sleeping = await page.evaluate(() => window.__gooby.snapshot()?.simulation.sleep);
  expect((sleeping?.completesAt ?? 0) - (sleeping?.startedAt ?? 0)).toBe(30 * 60 * 1_000);
  await page.reload();
  await expect(page.locator(".sleep-overlay")).toBeVisible();
  await page.evaluate(() => window.__gooby.test?.advanceTime(30 * 60 * 1_000 + 1));
  await expect(page.locator(".sleep-overlay")).toBeHidden();
  await expect.poll(async () => page.evaluate(() => window.__gooby.snapshot()?.simulation.needs.energy)).toBeGreaterThan(99.9);
});
