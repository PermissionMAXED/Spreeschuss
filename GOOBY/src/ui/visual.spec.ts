import { expect, test, type Browser, type Page } from "@playwright/test";

const VIEWPORTS = [
  { name: "iphone-se", width: 375, height: 667 },
  { name: "iphone-portrait", width: 390, height: 844 },
  { name: "ipad-portrait", width: 820, height: 1180 },
] as const;

async function freshStart(page: Page): Promise<void> {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator("#app")).toHaveAttribute("data-ready", "true");
}

async function completeOnboarding(page: Page): Promise<void> {
  const onboarding = page.getByTestId("onboarding");
  await onboarding.getByRole("button", { name: "Meet Gooby" }).click();
  const canvas = page.locator("canvas");
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Canvas has no layout box");
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.51);
  await expect(onboarding.getByText("Share a snack")).toBeVisible();
  await page.getByTestId("feed").click();
  await expect(onboarding.getByText("You did it!")).toBeVisible();
  await onboarding.getByRole("button", { name: "Welcome home" }).click();
  await expect(onboarding).toBeHidden();
}

async function assertPanelLayout(page: Page, panel: string): Promise<void> {
  const button = page.locator(`[data-panel="${panel}"]`).last();
  await button.click();
  const sheet = page.locator(".sheet");
  await expect(sheet).toBeVisible();
  const layout = await page.evaluate(() => {
    const shell = document.querySelector<HTMLElement>(".game-shell");
    const sheetElement = document.querySelector<HTMLElement>(".sheet");
    if (!shell || !sheetElement) return { shellOverflow: true, sheetOverflow: true, clippedTargets: ["missing shell"] };
    const clippedTargets = [...sheetElement.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")]
      .filter((target) => target.getClientRects().length > 0)
      .filter((target) => {
        const rect = target.getBoundingClientRect();
        return rect.width < 43.5 || rect.height < 43.5 || rect.left < -0.5 || rect.right > window.innerWidth + 0.5;
      })
      .map((target) => {
        const rect = target.getBoundingClientRect();
        return `${target.dataset.uiAction ?? target.textContent?.trim() ?? "button"}:${rect.width}x${rect.height}`;
      });
    return {
      shellOverflow: shell.scrollWidth > shell.clientWidth,
      sheetOverflow: sheetElement.scrollWidth > sheetElement.clientWidth,
      clippedTargets,
    };
  });
  expect(layout).toEqual({ shellOverflow: false, sheetOverflow: false, clippedTargets: [] });
}

async function closePanel(page: Page): Promise<void> {
  await page.locator(".sheet").getByRole("button", { name: "Close" }).click();
  await expect(page.locator(".sheet")).toBeHidden();
}

async function exerciseSurfaces(page: Page, viewportName: string, capture: boolean): Promise<void> {
  await assertPanelLayout(page, "places");
  await page.locator('[data-ui-action="select-shop"]').first().click();
  await expect(page.getByText("Destination selected")).toBeVisible();
  if (capture && viewportName === "ipad-portrait") {
    await page.screenshot({ path: "/opt/cursor/artifacts/sol_ui_places_ipad_final.png" });
  }
  await closePanel(page);

  await assertPanelLayout(page, "play");
  await expect(page.locator(".game-card")).toHaveCount(12);
  if (capture && viewportName === "iphone-portrait") {
    await page.screenshot({ path: "/opt/cursor/artifacts/sol_ui_games_390_final.png" });
  }
  await closePanel(page);

  await assertPanelLayout(page, "wardrobe");
  await page.locator('[data-slot="head"][data-item="sunhat"]').click();
  await page.locator('[data-ui-action="wardrobe-equip"][data-slot="head"]').click();
  await expect(page.locator(".preview-gooby .sunhat")).toBeVisible();
  if (capture && viewportName === "iphone-se") {
    await page.waitForTimeout(2_500);
    await page.screenshot({ path: "/opt/cursor/artifacts/sol_ui_wardrobe_se_v3.png" });
  }
  await closePanel(page);

  await assertPanelLayout(page, "items");
  await page.getByRole("tab", { name: "Furniture" }).click();
  await expect(page.locator(".inventory-card")).toHaveCount(4);
  if (capture && viewportName === "iphone-portrait") {
    await page.screenshot({ path: "/opt/cursor/artifacts/sol_ui_items_390_final.png" });
  }
  await closePanel(page);

  await assertPanelLayout(page, "settings");
  await page.getByRole("switch", { name: /Reduce motion/ }).click();
  await expect(page.getByRole("switch", { name: /Reduce motion/ })).toHaveAttribute("aria-checked", "true");
  if (capture && viewportName === "ipad-portrait") {
    await page.waitForTimeout(2_500);
    await page.screenshot({ path: "/opt/cursor/artifacts/sol_ui_settings_ipad_final.png" });
  }
  await closePanel(page);
}

for (const viewport of VIEWPORTS) {
  test(`fits all surfaces at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await freshStart(page);
    if (viewport.name === "iphone-se") {
      await page.screenshot({ path: "/opt/cursor/artifacts/sol_ui_onboarding_se_v3.png" });
    }
    await completeOnboarding(page);
    await page.waitForTimeout(2_500);
    await page.screenshot({ path: `/opt/cursor/artifacts/sol_ui_home_${viewport.width}x${viewport.height}_v3.png` });
    await exerciseSurfaces(page, viewport.name, true);

    await page.getByTestId("sleep").click();
    await expect(page.getByRole("heading", { name: "Want a wake-up note?" })).toBeVisible();
    await page.getByRole("button", { name: "Start sleep" }).click();
    await expect(page.locator(".sleep-overlay")).toBeVisible();
    if (viewport.name === "iphone-portrait") {
      await page.waitForTimeout(2_500);
      await page.screenshot({ path: "/opt/cursor/artifacts/sol_ui_sleep_390_final.png" });
    }
    await page.getByRole("button", { name: "Wake gently" }).click();
    await expect(page.getByRole("heading", { name: "Good morning!" })).toBeVisible();
    await page.getByRole("button", { name: "Let’s go" }).click();
  });
}

async function recordWalkthrough(browser: Browser): Promise<void> {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    recordVideo: { dir: "/tmp/gooby-ui-video", size: { width: 390, height: 844 } },
  });
  const page = await context.newPage();
  await freshStart(page);
  await completeOnboarding(page);
  await exerciseSurfaces(page, "walkthrough", false);
  await page.getByTestId("sleep").click();
  await page.getByRole("button", { name: "Start sleep" }).click();
  await expect(page.locator(".sleep-overlay")).toBeVisible();
  await page.waitForTimeout(700);
  await page.getByRole("button", { name: "Wake gently" }).click();
  await expect(page.getByRole("heading", { name: "Good morning!" })).toBeVisible();
  const video = page.video();
  await context.close();
  await video?.saveAs("/opt/cursor/artifacts/sol_ui_portrait_walkthrough_v2.webm");
}

test("records the portrait UI walkthrough", async ({ browser }) => {
  await recordWalkthrough(browser);
});
