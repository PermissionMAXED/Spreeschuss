import { expect, test, type Page } from "@playwright/test";
import {
  HOME_ZONE_IDS,
  MINIGAME_IDS,
  type MinigameId,
  type ShopId,
} from "../src/core/contracts/scenes";

async function freshStart(page: Page): Promise<void> {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator("#app")).toHaveAttribute("data-ready", "true");
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
  await onboarding.getByRole("button", { name: "Welcome home" }).click();
  await expect(onboarding).toBeHidden();
  await expect.poll(async () =>
    page.evaluate(() => window.__gooby.snapshot()?.profile.onboardingComplete)).toBe(true);
}

async function openPanel(page: Page, panel: "places" | "play" | "wardrobe" | "items"): Promise<void> {
  await page.locator(`.tab-bar [data-panel="${panel}"]`).click();
  await expect(page.locator(".sheet")).toBeVisible();
}

async function startGameFromHub(page: Page, game: MinigameId): Promise<void> {
  await openPanel(page, "play");
  await page.locator(`.game-card[data-game="${game}"]`).click();
  await page.locator(`[data-ui-action="start-game"][data-game="${game}"]`).click();
  await expect(page.locator(`[data-minigame="${game}"]`)).toBeVisible();
  await expect.poll(async () =>
    page.evaluate(() => window.__gooby.runtime().activeMinigame)).toBe(game);
}

async function openCityBoard(page: Page): Promise<void> {
  await openPanel(page, "places");
  await page.getByTestId("open-city-board").click();
  await expect(page.getByTestId("destination-carrot-market")).toBeVisible();
  await expect.poll(async () => page.evaluate(() => window.__gooby.runtime().cityPhase))
    .toBe("destination-board");
}

async function travelToShop(page: Page, shop: ShopId): Promise<void> {
  await openCityBoard(page);
  await page.getByTestId(`destination-${shop}`).click();
  await expect.poll(async () => page.evaluate(() => window.__gooby.runtime().cityPhase))
    .toBe("depart-ready");
  await page.getByTestId("start-drive").click();
  await expect(page.getByRole("button", { name: "Hold brake" })).toBeVisible();
  await expect.poll(async () => page.evaluate(() => window.__gooby.runtime().cityPhase))
    .toBe("driving-outbound");
  await page.evaluate(() => window.__gooby.test?.completeCityLeg());
  await expect(page.getByTestId("enter-shop")).toBeVisible();
  await page.getByTestId("enter-shop").click();
  await expect.poll(async () => page.evaluate(() => window.__gooby.runtime().sceneId))
    .toBe(`shop:${shop}`);
}

async function purchaseAndReturn(page: Page, shop: ShopId, itemId: string): Promise<void> {
  await travelToShop(page, shop);
  expect(await page.evaluate((id) => window.__gooby.test?.inspectShopItem(id), itemId)).toBe(true);
  const buy = page.locator('[data-shop-action="buy"]');
  await expect(buy).toBeVisible();
  await buy.click();
  await expect.poll(async () =>
    page.evaluate((id) => window.__gooby.snapshot()?.inventory[id] ?? 0, itemId)).toBe(1);
  await page.getByRole("button", { name: "Return to Town" }).click();
  await expect(page.getByTestId("drive-home")).toBeVisible();
  await expect(page.getByTestId("quick-return")).toBeHidden();
  await page.getByTestId("drive-home").click();
  await expect.poll(async () => page.evaluate(() => window.__gooby.runtime().cityPhase))
    .toBe("driving-home");
  await page.evaluate(() => window.__gooby.test?.completeCityLeg());
  await expect.poll(async () => page.evaluate(() => window.__gooby.runtime().cityPhase))
    .toBe("destination-board");
  await page.locator(".scene-chip").click();
  await expect.poll(async () => page.evaluate(() => window.__gooby.runtime().sceneId))
    .toBe("home:living-room");
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

test("completes real onboarding, all home care zones, bathing, and deterministic sleep", async ({ page }) => {
  await freshStart(page);
  await completeOnboarding(page);
  await page.reload();
  await expect(page.getByTestId("onboarding")).toBeHidden();

  for (const zone of HOME_ZONE_IDS) {
    await openPanel(page, "places");
    await page.getByTestId(`home-zone-${zone}`).click();
    await expect.poll(async () => page.evaluate(() => window.__gooby.runtime().sceneId))
      .toBe(`home:${zone}`);
  }

  await openPanel(page, "places");
  await page.getByTestId("home-zone-bathroom").click();
  const hygieneBefore = await page.evaluate(() => window.__gooby.snapshot()?.simulation.needs.hygiene ?? 0);
  await page.getByTestId("bathe").click();
  await expect.poll(async () =>
    page.evaluate(() => window.__gooby.snapshot()?.simulation.needs.hygiene ?? 0))
    .toBeGreaterThan(hygieneBefore);

  await page.getByTestId("sleep").click();
  const rationale = page.getByRole("heading", { name: "Want a wake-up note?" });
  if (await rationale.isVisible()) {
    await page.getByRole("button", { name: "Start sleep" }).click();
  }
  await expect(page.locator(".sleep-overlay")).toBeVisible();
  const sleeping = await page.evaluate(() => window.__gooby.snapshot()?.simulation.sleep);
  expect((sleeping?.completesAt ?? 0) - (sleeping?.startedAt ?? 0)).toBe(30 * 60 * 1_000);
  await page.evaluate(() => window.__gooby.test?.flushSave());
  await page.reload();
  await expect(page.locator(".sleep-overlay")).toBeVisible();
  await page.evaluate(() => window.__gooby.test?.advanceTime(30 * 60 * 1_000 + 1));
  await expect(page.locator(".sleep-overlay")).toBeHidden();
  await expect.poll(async () =>
    page.evaluate(() => window.__gooby.snapshot()?.simulation.needs.energy ?? 0))
    .toBeGreaterThan(99.9);
});

test("mounts every real minigame from the normal hub", async ({ page }) => {
  await freshStart(page);
  await completeOnboarding(page);
  await page.evaluate(() => window.__gooby.test?.grantProgressionXp(3_600));
  await expect.poll(async () => page.evaluate(() => window.__gooby.snapshot()?.economy.level)).toBe(7);
  await page.evaluate(() => window.__gooby.test?.flushSave());

  for (const game of MINIGAME_IDS) {
    await startGameFromHub(page, game);
    expect(await page.locator("[data-minigame]").count()).toBe(1);
    await page.reload();
    await expect(page.locator("#app")).toHaveAttribute("data-ready", "true");
    await expect(page.getByTestId("onboarding")).toBeHidden();
  }
});

test("completes a minigame payout and persists its high score", async ({ page }) => {
  await freshStart(page);
  await completeOnboarding(page);
  const before = await page.evaluate(() => window.__gooby.snapshot()?.economy);
  await startGameFromHub(page, "carrot-catch");
  const play = page.getByRole("button", { name: /CATCH/u });
  if (await play.isVisible()) await play.click();
  await page.evaluate(() => window.__gooby.test?.advanceMinigameTime(76_000));
  await expect(page.getByRole("button", { name: "COLLECT REWARDS" })).toBeVisible();
  await page.getByRole("button", { name: "COLLECT REWARDS" }).click();
  await expect(page.getByRole("heading", { name: /Lovely run|New best/u })).toBeVisible();
  const after = await page.evaluate(() => window.__gooby.snapshot()?.economy);
  expect(after?.coins ?? 0).toBeGreaterThan(before?.coins ?? 0);
  expect(after?.xp ?? 0).toBeGreaterThan(before?.xp ?? 0);
  expect(await page.evaluate(() => {
    const raw = localStorage.getItem("gooby.ui.v1");
    if (!raw) return false;
    const parsed = JSON.parse(raw) as { highScores?: Record<string, number> };
    return (parsed.highScores?.["carrot-catch"] ?? -1) >= 0;
  })).toBe(true);
});

test("drives to shops, buys, requires returns, equips, places, reloads, and disposes offline", async ({ page }) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const externalRequests: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("request", (request) => {
    const url = new URL(request.url());
    if ((url.protocol === "http:" || url.protocol === "https:") && url.origin !== "http://127.0.0.1:4519") {
      externalRequests.push(url.href);
    }
  });

  await freshStart(page);
  await completeOnboarding(page);
  await openCityBoard(page);
  await page.getByTestId("destination-cloud-boutique").click();
  await page.getByTestId("start-drive").click();
  await page.locator(".scene-chip").click();
  await expect(page.locator(".toast")).toContainText("Finish the return drive");
  await expect.poll(async () => page.evaluate(() => window.__gooby.runtime().cityPhase))
    .toBe("driving-outbound");
  await page.evaluate(() => window.__gooby.test?.completeCityLeg());
  await page.getByTestId("enter-shop").click();
  expect(await page.evaluate(() =>
    window.__gooby.test?.inspectShopItem("apricot-floor-cushion"))).toBe(true);
  await page.locator('[data-shop-action="buy"]').click();
  await expect.poll(async () => page.evaluate(() =>
    window.__gooby.snapshot()?.inventory["apricot-floor-cushion"] ?? 0)).toBe(1);
  await page.getByRole("button", { name: "Return to Town" }).click();
  await expect(page.getByTestId("quick-return")).toBeHidden();
  await page.getByTestId("drive-home").click();
  await page.evaluate(() => window.__gooby.test?.completeCityLeg());
  await page.locator(".scene-chip").click();
  await expect.poll(async () => page.evaluate(() => window.__gooby.runtime().sceneId))
    .toBe("home:living-room");

  await purchaseAndReturn(page, "fluff-salon", "sunny-bucket-hat");
  await openPanel(page, "wardrobe");
  await page.locator('[data-ui-action="wardrobe-preview"][data-item="sunny-bucket-hat"]').click();
  await page.locator('[data-ui-action="wardrobe-equip"][data-slot="head"]').click();
  await expect.poll(async () => page.evaluate(() => {
    const raw = localStorage.getItem("gooby.ui.v1");
    if (!raw) return null;
    return (JSON.parse(raw) as { equipped?: { head?: string } }).equipped?.head ?? null;
  })).toBe("sunny-bucket-hat");

  await page.locator(".sheet").getByRole("button", { name: "Close" }).click();
  await openPanel(page, "items");
  await page.getByRole("tab", { name: "Furniture" }).click();
  await page.locator('[data-ui-action="place-item"][data-item="apricot-floor-cushion"]').click();
  await expect.poll(async () => page.evaluate(() =>
    Object.keys(window.__gooby.snapshot()?.inventory ?? {}).some((key) =>
      key.includes("apricot-floor-cushion") && key.startsWith("__home.catalog.v1|"))))
    .toBe(true);
  await page.evaluate(() => window.__gooby.test?.flushSave());
  await page.reload();
  await expect.poll(async () => page.evaluate(() => window.__gooby.runtime().sceneId))
    .toBe("home:living-room");
  expect(await page.evaluate(() =>
    Object.keys(window.__gooby.snapshot()?.inventory ?? {}).some((key) =>
      key.includes("apricot-floor-cushion") && key.startsWith("__home.catalog.v1|")))).toBe(true);

  await startGameFromHub(page, "carrot-catch");
  await page.evaluate(() => window.__gooby.test?.dispose());
  await expect.poll(async () => page.evaluate(() => window.__gooby.runtime())).toMatchObject({
    sceneId: null,
    sceneChildren: 0,
    activeMinigame: null,
    minigameRoots: 0,
    disposed: true,
  });
  expect(externalRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
