import { expect, test } from "@playwright/test";

test("real keyboard and pointer input hop, shield, and settle once", async ({ page }) => {
  await page.goto("/src/minigames/puddle-hopper/harness.html");
  const next = page.locator(".ak-overlay:not([hidden]) .ak-button-primary");
  await next.click();
  await next.click();
  await next.click();

  const game = page.locator(".puddle-hopper");
  await expect(game).toHaveAttribute("data-phase", "running");
  const activeTarget = page.locator('.ph-tile[data-target="true"][data-active="true"]');
  await expect(activeTarget).toBeVisible({ timeout: 4_000 });
  const targetNumber = Number(await activeTarget.getAttribute("data-ph-tile")) + 1;
  await page.keyboard.press(String(targetNumber));
  await expect(page.locator("[data-ph-distance]")).toContainText("1 STONES");

  await page.keyboard.press("u");
  await expect(page.locator("[data-ph-action='umbrella']")).toHaveAttribute("data-active", "true");
  let blocked = false;
  for (let attempt = 0; attempt < 5 && !blocked; attempt += 1) {
    await expect(activeTarget).toBeVisible({ timeout: 4_000 });
    await page.locator('.ph-tile[data-hazard="true"]').first().click();
    blocked = (await page.locator("[data-ph-feedback]").textContent())?.includes("SPLASH BLOCKED") === true;
    if (!blocked) await page.waitForTimeout(240);
  }
  expect(blocked).toBe(true);

  await page.keyboard.press("p");
  await page.getByRole("button", { name: "Finish & collect" }).click();
  await expect(page.locator("body")).toHaveAttribute("data-settlements", "1");
  await page.keyboard.press("Enter");
  await expect(page.locator("body")).toHaveAttribute("data-settlements", "1");

  const tileBox = await page.locator(".ph-tile").first().boundingBox();
  expect(tileBox?.width ?? 0).toBeGreaterThanOrEqual(44);
  expect(tileBox?.height ?? 0).toBeGreaterThanOrEqual(44);
});
