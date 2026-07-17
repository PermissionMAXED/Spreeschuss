import { HOME_ZONE_IDS, type HomeZoneId } from "../src/core/contracts/scenes";
import { SLEEP_DURATION_MS } from "../src/core/contracts/simulation";
import { expect, test, type Page } from "./fixtures";

async function waitForApp(page: Page): Promise<void> {
  await expect(page.locator("#app")).toHaveAttribute("data-ready", "true");
}

async function freshStart(page: Page): Promise<void> {
  await page.addInitScript(() => {
    if (sessionStorage.getItem("e2e-fresh-start")) return;
    localStorage.clear();
    sessionStorage.setItem("e2e-fresh-start", "true");
  });
  await page.goto("/");
  await waitForApp(page);
}

async function completeOnboarding(page: Page): Promise<void> {
  const onboarding = page.getByTestId("onboarding");
  if (!(await onboarding.isVisible())) return;
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
}

async function openPanel(
  page: Page,
  panel: "places" | "play" | "wardrobe" | "items" | "settings",
): Promise<void> {
  await page.locator(`.tab-bar [data-panel="${panel}"]`).click();
  await expect(page.locator(".sheet")).toBeVisible();
}

async function navigateHome(page: Page, zone: HomeZoneId): Promise<void> {
  await openPanel(page, "places");
  await page.getByTestId(`home-zone-${zone}`).click();
  await expect.poll(async () => page.evaluate(() => window.__gooby.runtime().sceneId))
    .toBe(`home:${zone}`);
}

test("recovers corrupt save and UI storage without leaving the normal route", async ({ page }) => {
  await page.addInitScript(() => {
    if (sessionStorage.getItem("e2e-corrupt-seeded")) return;
    sessionStorage.setItem("e2e-corrupt-seeded", "true");
    localStorage.setItem("gooby.save.v2", "{ definitely-not-json");
    localStorage.setItem("gooby.ui.v1", "{ broken-ui");
  });
  await page.goto("/");
  await waitForApp(page);

  await expect(page.locator(".toast")).toContainText("repaired with a fresh save");
  expect(await page.evaluate(() => window.__gooby.snapshot())).toMatchObject({
    version: 2,
    profile: { name: "Gooby", onboardingComplete: false },
    economy: { coins: 40, xp: 0, level: 1 },
    inventory: { carrot: 3 },
  });

  await completeOnboarding(page);
  await openPanel(page, "settings");
  await expect(page.getByRole("switch")).toHaveCount(4);
  await expect(page.locator('[data-preference="notifications"]')).toHaveAttribute("aria-checked", "true");
});

test("migrates a legacy browser save once and reloads the committed v2 state", async ({ page }) => {
  await page.addInitScript(() => {
    if (sessionStorage.getItem("e2e-v1-seeded")) return;
    sessionStorage.setItem("e2e-v1-seeded", "true");
    const now = 1_700_000_000_000;
    localStorage.setItem("gooby.save.v2", JSON.stringify({
      revision: 7,
      payload: {
        version: 1,
        name: "Legacy Bun",
        onboardingComplete: true,
        createdAt: now - 10_000,
        lastSeenAt: now,
        needs: { hunger: 51, energy: 62, hygiene: 73, fun: 84 },
        coins: 99,
        xp: 425,
        carrots: 8,
      },
    }));
  });
  await page.goto("/");
  await waitForApp(page);
  await expect(page.getByTestId("onboarding")).toBeHidden();
  expect(await page.evaluate(() => window.__gooby.snapshot())).toMatchObject({
    version: 2,
    profile: { name: "Legacy Bun", onboardingComplete: true },
    economy: { coins: 99, xp: 425, level: 3 },
    inventory: { carrot: 8 },
  });

  await page.evaluate(() => window.__gooby.test?.flushSave());
  const persisted = await page.evaluate(() => {
    const raw = localStorage.getItem("gooby.save.v2");
    return raw ? JSON.parse(raw) as { revision: number; payload: { version: number } } : null;
  });
  expect(persisted?.revision).toBeGreaterThan(7);
  expect(persisted?.payload.version).toBe(2);

  await page.reload();
  await waitForApp(page);
  expect(await page.evaluate(() => window.__gooby.snapshot()?.profile.name)).toBe("Legacy Bun");
});

test("starts and wakes sleep when the web Notification API is unavailable", async ({ page }) => {
  await page.addInitScript(() => {
    Reflect.deleteProperty(window, "Notification");
  });
  await freshStart(page);
  await completeOnboarding(page);

  await page.getByTestId("sleep").click();
  await page.getByRole("button", { name: "Start sleep" }).click();
  await expect(page.locator(".sleep-overlay")).toBeVisible();
  const sleep = await page.evaluate(() => window.__gooby.snapshot()?.simulation.sleep);
  expect((sleep?.completesAt ?? 0) - (sleep?.startedAt ?? 0)).toBe(SLEEP_DURATION_MS);

  await page.getByRole("button", { name: "Wake gently" }).click();
  await expect(page.locator(".sleep-overlay")).toBeHidden();
  expect(await page.evaluate(() => window.__gooby.snapshot()?.simulation.sleep)).toBeNull();
});

test("cancels the scheduled web sleep notification on an early UI wake", async ({ page }) => {
  await page.addInitScript((minimumDelay) => {
    const probe = {
      scheduled: [] as Array<{ id: number; delay: number }>,
      clearCalls: [] as number[],
      created: [] as string[],
    };
    const tracked = new Set<number>();
    const nativeSetTimeout = window.setTimeout.bind(window);
    const nativeClearTimeout = window.clearTimeout.bind(window);
    window.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
      const id = nativeSetTimeout(handler, timeout, ...args);
      if ((timeout ?? 0) >= minimumDelay) {
        tracked.add(id);
        probe.scheduled.push({ id, delay: timeout ?? 0 });
      }
      return id;
    }) as typeof window.setTimeout;
    window.clearTimeout = ((id?: number) => {
      if (id !== undefined) probe.clearCalls.push(id);
      if (id !== undefined) tracked.delete(id);
      nativeClearTimeout(id);
    }) as typeof window.clearTimeout;
    class NotificationProbe {
      static permission: NotificationPermission = "granted";
      static requestPermission(): Promise<NotificationPermission> {
        return Promise.resolve("granted");
      }
      constructor(title: string) {
        probe.created.push(title);
      }
    }
    Object.defineProperty(window, "Notification", {
      configurable: true,
      value: NotificationProbe,
    });
    Object.defineProperty(window, "__notificationProbe", { value: probe });
  }, SLEEP_DURATION_MS - 1_000);
  await freshStart(page);
  await completeOnboarding(page);

  await page.getByTestId("sleep").click();
  await page.getByRole("button", { name: "Start sleep" }).click();
  await expect.poll(async () => page.evaluate(() =>
    (window as unknown as { __notificationProbe: { scheduled: Array<{ id: number }> } })
      .__notificationProbe.scheduled.length)).toBe(1);
  await page.getByRole("button", { name: "Wake gently" }).click();
  await expect.poll(async () => page.evaluate(() => {
    const probe = (window as unknown as {
      __notificationProbe: {
        scheduled: Array<{ id: number }>;
        clearCalls: number[];
      };
    }).__notificationProbe;
    return probe.clearCalls.includes(probe.scheduled[0]?.id ?? -1);
  })).toBe(true);
  await page.evaluate((duration) => window.__gooby.test?.advanceTime(duration), SLEEP_DURATION_MS + 1);
  expect(await page.evaluate(() =>
    (window as unknown as { __notificationProbe: { created: string[] } })
      .__notificationProbe.created)).toEqual([]);
});

test("opens every UI panel and keeps fixed controls inside phone and iPad safe bounds", async ({ page }) => {
  await freshStart(page);
  await completeOnboarding(page);

  for (const panel of ["places", "play", "wardrobe", "items", "settings"] as const) {
    await openPanel(page, panel);
    await expect(page.locator(`.tab-bar [data-panel="${panel}"]`)).toHaveClass(/active/u);
    await page.locator(".sheet").getByRole("button", { name: "Close" }).click();
    await expect(page.locator(".sheet")).toBeHidden();
  }

  const layout = await page.evaluate(() => {
    const selectors = [".scene-chip", ".hud", ".bottom-ui", ".tab-bar", "[data-testid='feed']", "[data-testid='sleep']"];
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      horizontalOverflow: document.documentElement.scrollWidth - window.innerWidth,
      boxes: selectors.map((selector) => {
        const element = document.querySelector<HTMLElement>(selector);
        if (!element) return { selector, missing: true };
        const rect = element.getBoundingClientRect();
        return {
          selector,
          missing: false,
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height,
        };
      }),
    };
  });
  expect(layout.horizontalOverflow).toBeLessThanOrEqual(0);
  for (const box of layout.boxes) {
    expect(box.missing, `${box.selector} exists`).toBe(false);
    if (
      box.missing
      || box.left === undefined
      || box.top === undefined
      || box.right === undefined
      || box.bottom === undefined
      || box.width === undefined
      || box.height === undefined
    ) continue;
    expect(box.left, `${box.selector} left edge`).toBeGreaterThanOrEqual(0);
    expect(box.top, `${box.selector} top edge`).toBeGreaterThanOrEqual(0);
    expect(box.right, `${box.selector} right edge`).toBeLessThanOrEqual(layout.viewport.width + 0.5);
    expect(box.bottom, `${box.selector} bottom edge`).toBeLessThanOrEqual(layout.viewport.height + 0.5);
    expect(box.width * box.height, `${box.selector} has a visible hit area`).toBeGreaterThan(0);
  }
});

test("uses real held steering and brake before completing a normal outbound shop route", async ({ page }) => {
  await freshStart(page);
  await completeOnboarding(page);
  await openPanel(page, "places");
  await page.getByTestId("open-city-board").click();
  await expect.poll(async () => page.evaluate(() => window.__gooby.runtime().cityPhase))
    .toBe("destination-board");
  await expect(page.getByTestId("start-drive")).toBeHidden();

  await page.getByTestId("destination-carrot-market").click();
  await expect(page.getByTestId("destination-carrot-market")).toHaveClass(/is-selected/u);
  await expect(page.locator(".city-shop-card.is-selected")).toHaveCount(1);
  await expect.poll(async () => page.evaluate(() => window.__gooby.runtime().cityPhase))
    .toBe("depart-ready");
  await page.getByTestId("start-drive").click();
  await expect.poll(async () => page.evaluate(() => window.__gooby.runtime().cityPhase))
    .toBe("driving-outbound");
  await expect.poll(async () => page.evaluate(() => window.__gooby.runtime().sceneId))
    .toBe("city:drive");

  const distance = page.getByTestId("city-distance").locator("[data-distance]");
  await expect(page.getByTestId("city-distance")).toBeVisible();
  const initialDistance = await distance.textContent();
  const steer = page.getByRole("button", { name: "Hold to steer left" });
  await expect(steer).toBeVisible();
  const steerBox = await steer.boundingBox();
  if (!steerBox) throw new Error("Steering control has no layout box");
  await page.mouse.move(steerBox.x + steerBox.width / 2, steerBox.y + steerBox.height / 2);
  await page.mouse.down();
  try {
    await expect(steer).toHaveClass(/is-held/u);
    await expect.poll(async () => distance.textContent()).not.toBe(initialDistance);
  } finally {
    await page.mouse.up();
  }
  await expect(steer).not.toHaveClass(/is-held/u);

  const brake = page.getByRole("button", { name: "Hold brake" });
  const brakeBox = await brake.boundingBox();
  if (!brakeBox) throw new Error("Brake control has no layout box");
  await page.mouse.move(brakeBox.x + brakeBox.width / 2, brakeBox.y + brakeBox.height / 2);
  await page.mouse.down();
  await expect(brake).toHaveClass(/is-held/u);
  await page.mouse.up();
  await expect(brake).not.toHaveClass(/is-held/u);

  await page.evaluate(() => window.__gooby.test?.completeCityLeg());
  await expect(page.getByTestId("enter-shop")).toBeVisible();
  await page.getByTestId("enter-shop").click();
  await expect.poll(async () => page.evaluate(() => window.__gooby.runtime().sceneId))
    .toBe("shop:carrot-market");
  await page.locator('.shop-catalog [data-shop-item="crisp-carrot"]').click();
  await page.locator('[data-shop-action="buy"]').click();
  await expect.poll(async () =>
    page.evaluate(() => window.__gooby.snapshot()?.inventory["crisp-carrot"] ?? 0)).toBe(1);

  await page.getByRole("button", { name: "Return to Town" }).click();
  await expect(page.getByTestId("quick-return")).toBeHidden();
  await expect(page.getByText(/first visit makes the return journey/u)).toBeVisible();
  await page.getByTestId("drive-home").click();
  await page.evaluate(() => window.__gooby.test?.completeCityLeg());
  await expect.poll(async () => page.evaluate(() => window.__gooby.runtime().cityPhase))
    .toBe("destination-board");
});

test("returns to the resource baseline after ten normal-UI scene switches", async ({ page }) => {
  await freshStart(page);
  await completeOnboarding(page);
  const baseline = await page.evaluate(() => window.__gooby.runtime());
  const sequence: HomeZoneId[] = [
    "kitchen",
    "bathroom",
    "bedroom",
    "garden",
    "living-room",
    "kitchen",
    "bathroom",
    "bedroom",
    "garden",
    "living-room",
  ];

  for (const zone of sequence) {
    await navigateHome(page, zone);
    await expect(page.locator(".city-drive-overlay, .shop-layer, [data-minigame]")).toHaveCount(0);
  }
  expect(sequence).toHaveLength(10);
  expect(new Set(sequence)).toEqual(new Set(HOME_ZONE_IDS));

  const final = await page.evaluate(() => window.__gooby.runtime());
  expect(final).toMatchObject({
    sceneId: "home:living-room",
    sceneChildren: baseline.sceneChildren,
    activeMinigame: null,
    minigameRoots: 0,
    disposed: false,
  });
  expect(final.renderer.geometries).toBeLessThanOrEqual(baseline.renderer.geometries);
  expect(final.renderer.textures).toBeLessThanOrEqual(baseline.renderer.textures);
});
