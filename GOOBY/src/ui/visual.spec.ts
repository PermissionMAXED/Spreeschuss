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

async function contrastRatio(page: Page, selector: string, background: string): Promise<number> {
  return page.locator(selector).first().evaluate((element, backgroundHex) => {
    const channels = (value: string): readonly [number, number, number] => {
      if (value.startsWith("#")) {
        const hex = value.slice(1);
        return [
          Number.parseInt(hex.slice(0, 2), 16),
          Number.parseInt(hex.slice(2, 4), 16),
          Number.parseInt(hex.slice(4, 6), 16),
        ];
      }
      const match = value.match(/\d+(?:\.\d+)?/gu) ?? [];
      return [Number(match[0]), Number(match[1]), Number(match[2])];
    };
    const luminance = (rgb: readonly number[]): number =>
      rgb.map((channel) => {
        const normalized = channel / 255;
        return normalized <= 0.04045
          ? normalized / 12.92
          : ((normalized + 0.055) / 1.055) ** 2.4;
      }).reduce((sum, channel, index) =>
        sum + channel * ([0.2126, 0.7152, 0.0722][index] ?? 0), 0);
    const foreground = luminance(channels(getComputedStyle(element).color));
    const backdrop = luminance(channels(backgroundHex));
    return (Math.max(foreground, backdrop) + 0.05) /
      (Math.min(foreground, backdrop) + 0.05);
  }, background);
}

async function exerciseSurfaces(page: Page, viewportName: string, capture: boolean): Promise<void> {
  await assertPanelLayout(page, "places");
  await expect(page.locator('[data-ui-action="home-zone"]')).toHaveCount(5);
  await expect(page.getByTestId("open-city-board")).toBeVisible();
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
  await expect(page.locator(".wardrobe-slot")).toHaveCount(4);
  await expect(page.locator('[data-ui-action="wardrobe-preview"][data-item]')).toHaveCount(0);
  if (capture && viewportName === "iphone-se") {
    await page.waitForTimeout(2_500);
    await page.screenshot({ path: "/opt/cursor/artifacts/sol_ui_wardrobe_se_v3.png" });
  }
  await closePanel(page);

  await assertPanelLayout(page, "items");
  await page.getByRole("tab", { name: "Furniture" }).click();
  await expect(page.locator(".empty-state")).toContainText("Cloud Boutique");
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
  await video?.saveAs("/opt/cursor/artifacts/gooby_cozy_burrow_canonical_ui_walkthrough.webm");
}

test("records the portrait UI walkthrough", async ({ browser }) => {
  await recordWalkthrough(browser);
});

test("supports keyboard onboarding, trapped modals, semantic tabs, and reduced motion", async ({ page }) => {
  const cspConnectErrors: string[] = [];
  page.on("console", (message) => {
    if (/refused to connect|connect-src/iu.test(message.text())) {
      cspConnectErrors.push(message.text());
    }
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await freshStart(page);
  await expect(page).toHaveTitle("Gooby’s Cozy Burrow");
  await expect(page.locator('meta[name="application-name"]')).toHaveAttribute(
    "content",
    "Gooby’s Cozy Burrow",
  );
  await expect(page.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute(
    "content",
    "Gooby’s Cozy Burrow",
  );
  expect(cspConnectErrors).toEqual([]);

  const onboarding = page.getByTestId("onboarding");
  await onboarding.getByRole("button", { name: "Meet Gooby" }).focus();
  await page.keyboard.press("Enter");
  await expect.poll(async () => page.evaluate(() => window.__gooby.runtime().audio.unlocked)).toBe(true);
  await onboarding.getByRole("button", { name: "Pet Gooby" }).focus();
  await page.keyboard.press("Enter");
  await expect(onboarding.getByText("Share a snack")).toBeVisible();
  await onboarding.getByRole("button", { name: "Feed" }).focus();
  await page.keyboard.press("Enter");
  await onboarding.getByRole("button", { name: "Welcome home" }).focus();
  await page.keyboard.press("Enter");
  await expect(onboarding).toBeHidden();

  const places = page.getByRole("tab", { name: "Places" });
  await places.focus();
  await page.keyboard.press("ArrowRight");
  const play = page.getByRole("tab", { name: "Play" });
  await expect(play).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Escape");
  await expect(page.locator(".sheet")).toBeHidden();
  await expect(play).toBeFocused();

  await page.getByTestId("sleep").focus();
  await page.keyboard.press("Enter");
  const sleepDialog = page.getByRole("dialog", { name: "Want a wake-up note?" });
  await expect(sleepDialog).toBeVisible();
  const first = sleepDialog.getByRole("button", { name: "Close" });
  const last = sleepDialog.getByRole("button", { name: "Maybe later" });
  await first.focus();
  await page.keyboard.press("Shift+Tab");
  await expect(last).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(sleepDialog).toBeHidden();
  await expect(page.getByTestId("sleep")).toBeFocused();
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Start sleep" }).click();
  await expect.poll(async () => page.evaluate(() => window.__gooby.runtime().audio.theme)).toBe("lullaby");
  await page.getByRole("button", { name: "Wake gently" }).click();
  await expect.poll(async () => page.evaluate(() => window.__gooby.runtime().audio.theme)).toBe("home-cozy");
  await page.getByRole("button", { name: "Let’s go" }).click();

  await page.getByRole("tab", { name: "Items" }).click();
  const foodTab = page.getByRole("tab", { name: "Food" });
  await foodTab.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "Furniture" })).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Escape");

  await page.getByRole("tab", { name: "Settings" }).click();
  await expect(page.getByText(/Kenney assets released under CC0/u)).toBeVisible();
  await page.getByRole("switch", { name: /Sound/u }).click();
  await expect.poll(async () => page.evaluate(() => window.__gooby.runtime().audio)).toMatchObject({
    muted: true,
    hapticsMuted: false,
  });
  await page.getByRole("switch", { name: /Haptics/u }).click();
  await expect.poll(async () => page.evaluate(() => window.__gooby.runtime().audio.hapticsMuted)).toBe(true);
  await page.getByRole("switch", { name: /Reduce motion/u }).click();
  await expect(page.locator("#app")).toHaveClass(/reduce-motion/u);
  await page.screenshot({ path: "/opt/cursor/artifacts/gooby_cozy_burrow_accessible_settings_390.png" });
  await page.getByRole("button", { name: "Clear local play data" }).click();
  await expect(page.getByRole("dialog", { name: "Grown-ups: clear local data?" })).toBeVisible();
  await page.keyboard.press("Escape");
  const targetFailures = await page.locator(".sheet").evaluate((sheet) =>
    [...sheet.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")]
      .filter((button) => button.getClientRects().length > 0)
      .filter((button) => {
        const rect = button.getBoundingClientRect();
        return rect.width < 43.5 || rect.height < 43.5;
      })
      .map((button) => button.textContent?.trim() ?? "unnamed"));
  expect(targetFailures).toEqual([]);
  expect(cspConnectErrors).toEqual([]);
});

test("persists accessible quiet hours and defers the actual sleep notification timer", async ({ page }) => {
  const fixedNow = new Date(2026, 0, 2, 21, 30, 0, 0).getTime();
  await page.addInitScript(({ now, longDelay }) => {
    Object.defineProperty(Date, "now", {
      configurable: true,
      value: () => now,
    });
    const probe = { delays: [] as number[] };
    const nativeSetTimeout = window.setTimeout.bind(window);
    window.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
      if ((timeout ?? 0) >= longDelay) probe.delays.push(timeout ?? 0);
      return nativeSetTimeout(handler, timeout, ...args);
    }) as typeof window.setTimeout;
    Object.defineProperty(window, "__quietHoursProbe", { configurable: true, value: probe });
    class NotificationProbe {
      static permission: NotificationPermission = "granted";
      static requestPermission(): Promise<NotificationPermission> {
        return Promise.resolve("granted");
      }
    }
    Object.defineProperty(window, "Notification", {
      configurable: true,
      value: NotificationProbe,
    });
  }, { now: fixedNow, longDelay: 60 * 60 * 1_000 });
  await page.setViewportSize({ width: 390, height: 844 });
  await freshStart(page);
  await completeOnboarding(page);

  await page.getByRole("tab", { name: "Settings" }).click();
  const toggle = page.getByRole("checkbox", { name: /Quiet hours/u });
  const start = page.getByRole("combobox", { name: "Quiet hours start time" });
  const end = page.getByRole("combobox", { name: "Quiet hours end time" });
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await expect(start).toBeDisabled();
  await expect(start).toHaveValue("21:00");
  await expect(end).toHaveValue("08:00");

  await toggle.focus();
  await page.keyboard.press("Space");
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await expect(start).toBeDisabled();
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await start.selectOption("22:00");
  await end.selectOption("07:00");
  await expect.poll(async () => page.evaluate(() =>
    window.__gooby.snapshot()?.notificationPolicy?.quietHours)).toEqual({
    startHour: 22,
    endHour: 7,
  });
  await page.evaluate(() => window.__gooby.test?.flushSave());
  await page.reload();
  await expect(page.locator("#app")).toHaveAttribute("data-ready", "true");

  await page.getByRole("tab", { name: "Settings" }).click();
  await expect(page.getByRole("checkbox", { name: /Quiet hours/u }))
    .toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("combobox", { name: "Quiet hours start time" }))
    .toHaveValue("22:00");
  await expect(page.getByRole("combobox", { name: "Quiet hours end time" }))
    .toHaveValue("07:00");
  await page.getByRole("combobox", { name: "Quiet hours start time" }).selectOption("21:00");
  await page.getByRole("combobox", { name: "Quiet hours end time" }).selectOption("08:00");
  await expect(page.locator("#quiet-hours-status")).toContainText("Quiet now");
  await expect(page.getByText(/Runs overnight from 21:00 to 08:00/u)).toBeVisible();
  await page.waitForTimeout(2_500);
  await page.screenshot({ path: "/opt/cursor/artifacts/gooby_quiet_hours_settings_390_final.png" });

  const controlBounds = await page.locator(".quiet-hours-times select").evaluateAll((controls) =>
    controls.map((control) => {
      const rect = control.getBoundingClientRect();
      return {
        height: rect.height,
        left: rect.left,
        right: rect.right,
        viewportWidth: window.innerWidth,
      };
    }));
  expect(controlBounds.every(({ height, left, right, viewportWidth }) =>
    height >= 44 && left >= 0 && right <= viewportWidth)).toBe(true);

  await closePanel(page);
  await page.getByTestId("sleep").click();
  await page.getByRole("button", { name: "Start sleep" }).click();
  await expect(page.locator(".sleep-overlay")).toBeVisible();
  await expect.poll(async () => page.evaluate(() =>
    (window as unknown as { __quietHoursProbe: { delays: number[] } })
      .__quietHoursProbe.delays.length)).toBe(1);

  const scheduled = await page.evaluate(() => {
    const state = window.__gooby.snapshot();
    const sleep = state?.simulation.sleep;
    const delay = (window as unknown as { __quietHoursProbe: { delays: number[] } })
      .__quietHoursProbe.delays[0] ?? -1;
    if (!sleep) throw new Error("Expected active sleep");
    const expectedDelivery = new Date(sleep.completesAt);
    expectedDelivery.setHours(8, 0, 0, 0);
    if (expectedDelivery.getTime() <= sleep.completesAt) {
      expectedDelivery.setDate(expectedDelivery.getDate() + 1);
    }
    return {
      sleepDuration: sleep.completesAt - sleep.startedAt,
      policy: state?.notificationPolicy,
      delay,
      expectedDelay: expectedDelivery.getTime() - sleep.startedAt,
    };
  });
  expect(scheduled.sleepDuration).toBe(30 * 60 * 1_000);
  expect(scheduled.policy).toEqual({
    quietHours: { startHour: 21, endHour: 8 },
    suppressWhenForeground: true,
  });
  expect(Math.abs(scheduled.delay - scheduled.expectedDelay)).toBeLessThan(1_000);
});

test("records the quiet-hours controls walkthrough", async ({ browser }) => {
  const setupContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const setupPage = await setupContext.newPage();
  await freshStart(setupPage);
  await completeOnboarding(setupPage);
  await setupPage.evaluate(() => window.__gooby.test?.flushSave());
  const storageState = await setupContext.storageState();
  await setupContext.close();

  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    storageState,
    recordVideo: { dir: "/tmp/gooby-quiet-hours-video", size: { width: 390, height: 844 } },
  });
  await context.addInitScript((now) => {
    Object.defineProperty(Date, "now", {
      configurable: true,
      value: () => now,
    });
  }, new Date(2026, 0, 2, 21, 30, 0, 0).getTime());
  const page = await context.newPage();
  await page.goto("/");
  await expect(page.locator("#app")).toHaveAttribute("data-ready", "true");
  await page.getByRole("tab", { name: "Settings" }).click();
  await page.getByRole("checkbox", { name: /Quiet hours/u }).click();
  await page.getByRole("combobox", { name: "Quiet hours start time" }).selectOption("21:00");
  await page.getByRole("combobox", { name: "Quiet hours end time" }).selectOption("08:00");
  await expect(page.locator("#quiet-hours-status")).toContainText("Quiet now");
  await page.waitForTimeout(2_700);
  const video = page.video();
  await context.close();
  await video?.saveAs("/opt/cursor/artifacts/gooby_quiet_hours_controls_walkthrough.webm");
});

test("consumes catalog food and exposes selected decor place, move, rotate, and remove controls", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await freshStart(page);
  await completeOnboarding(page);
  await page.evaluate(() => {
    const raw = localStorage.getItem("gooby.save.v2");
    if (!raw) throw new Error("Expected canonical save");
    const record = JSON.parse(raw) as {
      revision: number;
      payload: { inventory: Record<string, number> };
    };
    record.payload.inventory["crisp-carrot"] = 1;
    record.payload.inventory["apricot-floor-cushion"] = 1;
    localStorage.setItem("gooby.save.v2", JSON.stringify(record));
  });
  await page.reload();
  await expect(page.locator("#app")).toHaveAttribute("data-ready", "true");

  await page.getByRole("tab", { name: "Items" }).click();
  await expect(page.locator("[data-catalog-food]")).toHaveCount(16);
  await page.locator('[data-ui-action="consume-food"][data-item="crisp-carrot"]').click();
  await expect.poll(async () => page.evaluate(() =>
    window.__gooby.snapshot()?.inventory["crisp-carrot"])).toBe(0);

  await page.getByRole("tab", { name: "Furniture" }).click();
  await page.locator('[data-ui-action="place-item"][data-item="apricot-floor-cushion"]').click();
  const controls = page.getByRole("region", { name: "Selected decor controls" });
  await expect(controls).toBeVisible();
  await expect(controls.getByRole("button", { name: "Move decor left" })).toBeVisible();
  await page.screenshot({ path: "/opt/cursor/artifacts/gooby_cozy_burrow_decor_controls_390.png" });
  await controls.getByRole("button", { name: "Rotate" }).click();
  await controls.getByRole("button", { name: "Remove" }).click();
  await expect(controls).toBeHidden();
  await expect.poll(async () => page.evaluate(() =>
    Object.keys(window.__gooby.snapshot()?.inventory ?? {}).some((key) =>
      key.startsWith("__home.catalog.v1|") && key.includes("apricot-floor-cushion")))).toBe(false);
});

test("keeps compact navigation and panel copy at AA contrast", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await freshStart(page);
  await completeOnboarding(page);
  await page.getByRole("tab", { name: "Items" }).click();

  expect(await contrastRatio(page, '[data-panel="items"]', "#f3d3b8")).toBeGreaterThanOrEqual(4.5);
  expect(await contrastRatio(page, ".sheet-header p", "#ffffff")).toBeGreaterThanOrEqual(4.5);
  expect(await contrastRatio(page, '.segmented-control [role="tab"]:not(.active)', "#eee3d9"))
    .toBeGreaterThanOrEqual(4.5);
  expect(await contrastRatio(page, ".inventory-card p", "#ffffff")).toBeGreaterThanOrEqual(4.5);

  await closePanel(page);
  await page.getByRole("tab", { name: "Settings" }).click();
  expect(await contrastRatio(page, ".setting-row small", "#ffffff")).toBeGreaterThanOrEqual(4.5);
  expect(await contrastRatio(page, ".info-card p", "#fbf4e9")).toBeGreaterThanOrEqual(4.5);
});

test("reloads active outbound and required-return travel from the canonical save", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await freshStart(page);
  await completeOnboarding(page);
  await page.getByRole("tab", { name: "Places" }).click();
  await page.getByTestId("open-city-board").click();
  await page.getByTestId("destination-cloud-boutique").click();
  await page.getByTestId("start-drive").click();
  await expect.poll(async () => page.evaluate(() => window.__gooby.runtime().cityPhase))
    .toBe("driving-outbound");
  await page.evaluate(() => window.__gooby.test?.flushSave());

  await page.reload();
  await expect(page.locator("#app")).toHaveAttribute("data-ready", "true");
  await expect.poll(async () => page.evaluate(() => window.__gooby.runtime().cityPhase))
    .toBe("driving-outbound");
  await expect.poll(async () => page.evaluate(() => window.__gooby.runtime().sceneId))
    .toBe("city:drive");

  await page.evaluate(() => window.__gooby.test?.completeCityLeg());
  await page.getByTestId("enter-shop").click();
  await expect.poll(async () => page.evaluate(() => window.__gooby.runtime().sceneId))
    .toBe("shop:cloud-boutique");
  await page.getByRole("button", { name: "Return to Town" }).click();
  await expect(page.getByTestId("quick-return")).toBeHidden();
  await page.evaluate(() => window.__gooby.test?.flushSave());

  await page.reload();
  await expect(page.locator("#app")).toHaveAttribute("data-ready", "true");
  await expect.poll(async () => page.evaluate(() => window.__gooby.runtime().cityPhase))
    .toBe("return-board");
  await expect(page.getByTestId("quick-return")).toBeHidden();
  await expect(page.getByTestId("drive-home")).toBeVisible();
});

test("settles a completed run into canonical economy, receipt, and best score before results", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await freshStart(page);
  await completeOnboarding(page);
  const before = await page.evaluate(() => window.__gooby.snapshot()?.economy);
  await page.getByRole("tab", { name: "Play" }).click();
  await page.locator('.game-card[data-game="carrot-catch"]').click();
  await page.locator('[data-ui-action="start-game"][data-game="carrot-catch"]').click();
  const start = page.getByRole("button", { name: /CATCH/u });
  if (await start.isVisible()) await start.click();
  await page.evaluate(() => window.__gooby.test?.advanceMinigameTime(76_000));
  await page.getByRole("button", { name: "COLLECT REWARDS" }).click();
  await expect(page.getByRole("heading", { name: /Lovely run|New best/u })).toBeVisible();

  const settled = await page.evaluate(() => {
    const state = window.__gooby.snapshot();
    const receipt = state?.minigameSettlement;
    return {
      economy: state?.economy,
      receipt,
      best: receipt ? state?.ui?.highScores?.[receipt.minigameId] : undefined,
      legacyUi: localStorage.getItem("gooby.ui.v1"),
    };
  });
  expect(settled.economy?.coins ?? 0).toBeGreaterThan(before?.coins ?? 0);
  expect(settled.economy?.xp ?? 0).toBeGreaterThan(before?.xp ?? 0);
  expect(settled.receipt?.minigameId).toBe("carrot-catch");
  expect(settled.best).toBe(settled.receipt?.bestScore);
  expect(settled.legacyUi).toBeNull();
  await page.evaluate(() => window.__gooby.test?.flushSave());

  await page.reload();
  await expect(page.locator("#app")).toHaveAttribute("data-ready", "true");
  expect(await page.evaluate(() => window.__gooby.snapshot()?.minigameSettlement?.runId))
    .toBe(settled.receipt?.runId);
});

test("leaves an unfinished minigame without settlement or payout", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await freshStart(page);
  await completeOnboarding(page);
  const before = await page.evaluate(() => window.__gooby.snapshot()?.economy);
  await page.getByRole("tab", { name: "Play" }).click();
  await page.locator('.game-card[data-game="carrot-catch"]').click();
  await page.locator('[data-ui-action="start-game"][data-game="carrot-catch"]').click();
  await expect.poll(async () => page.evaluate(() => window.__gooby.runtime().activeMinigame))
    .toBe("carrot-catch");
  await page.locator('[data-scene-chrome] [data-ui-action="pause"]').click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("heading", { name: "Adventure paused" })).toBeHidden();
  await page.locator('[data-scene-chrome] [data-ui-action="pause"]').click();
  await page.getByRole("button", { name: "Leave without reward" }).click();
  await expect.poll(async () => page.evaluate(() => window.__gooby.runtime().sceneId))
    .toBe("home:living-room");
  expect(await page.evaluate(() => window.__gooby.snapshot()?.economy)).toEqual(before);
  expect(await page.evaluate(() => window.__gooby.snapshot()?.minigameSettlement)).toBeNull();
});
