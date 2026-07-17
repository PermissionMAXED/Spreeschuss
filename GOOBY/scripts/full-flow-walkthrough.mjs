import { chromium, expect } from "@playwright/test";

const baseUrl = process.env.GOOBY_URL ?? "http://127.0.0.1:4519";
const artifactRoot = process.env.GOOBY_ARTIFACTS ?? "/opt/cursor/artifacts";
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  recordVideo: {
    dir: "/tmp/gooby-full-flow-video",
    size: { width: 390, height: 844 },
  },
});
const page = await context.newPage();
const video = page.video();
const consoleErrors = [];
const pageErrors = [];
const externalRequests = [];

page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text());
});
page.on("pageerror", (error) => pageErrors.push(error.message));
page.on("request", (request) => {
  const url = new URL(request.url());
  if (
    (url.protocol === "http:" || url.protocol === "https:")
    && url.origin !== new URL(baseUrl).origin
  ) {
    externalRequests.push(url.href);
  }
});

try {
  await page.goto(baseUrl);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator("#app")).toHaveAttribute("data-ready", "true");

  const onboarding = page.getByTestId("onboarding");
  await onboarding.getByRole("button", { name: "Meet Gooby" }).click();
  const canvasBox = await page.locator("canvas").boundingBox();
  if (!canvasBox) throw new Error("Canvas has no layout box");
  await page.mouse.click(
    canvasBox.x + canvasBox.width * 0.5,
    canvasBox.y + canvasBox.height * 0.51,
  );
  await expect(onboarding.getByText("Share a snack")).toBeVisible();
  await page.getByTestId("feed").click();
  await expect(onboarding.getByText("You did it!")).toBeVisible();
  await onboarding.getByRole("button", { name: "Welcome home" }).click();
  await expect(onboarding).toBeHidden();

  await page.locator('.tab-bar [data-panel="places"]').click();
  await page.getByTestId("home-zone-bathroom").click();
  await expect.poll(async () => page.evaluate(() => window.__gooby.runtime().sceneId))
    .toBe("home:bathroom");
  const hygieneBefore = await page.evaluate(
    () => window.__gooby.snapshot()?.simulation.needs.hygiene ?? 0,
  );
  await page.getByTestId("bathe").click();
  await expect.poll(async () =>
    page.evaluate(() => window.__gooby.snapshot()?.simulation.needs.hygiene ?? 0))
    .toBeGreaterThan(hygieneBefore);

  await page.locator('.tab-bar [data-panel="play"]').click();
  await page.locator('.game-card[data-game="carrot-catch"]').click();
  await page.locator('[data-ui-action="start-game"][data-game="carrot-catch"]').click();
  await expect(page.locator('[data-minigame="carrot-catch"]')).toBeVisible();
  const startCatch = page.getByRole("button", { name: /CATCH/u });
  if (await startCatch.isVisible()) await startCatch.click();
  await page.evaluate(() => window.__gooby.test?.advanceMinigameTime(76_000));
  await page.getByRole("button", { name: "COLLECT REWARDS" }).click();
  await expect(page.getByRole("heading", { name: /Lovely run|New best/u })).toBeVisible();
  await page.locator('[data-ui-action="results-done"]').click();
  await page.locator(".sheet").getByRole("button", { name: "Close" }).click();

  await page.getByTestId("sleep").click();
  const sleepRationale = page.getByRole("heading", { name: "Want a wake-up note?" });
  if (await sleepRationale.isVisible()) {
    await page.getByRole("button", { name: "Start sleep" }).click();
  }
  await expect(page.locator(".sleep-overlay")).toBeVisible();
  await page.evaluate(() => window.__gooby.test?.advanceTime(30 * 60 * 1_000 + 1));
  await expect(page.locator(".sleep-overlay")).toBeHidden();
  const wakeCelebration = page.locator('[data-ui-action="wake-celebration"]');
  if (await wakeCelebration.isVisible()) await wakeCelebration.click();

  await page.locator('.tab-bar [data-panel="places"]').click();
  await page.getByTestId("open-city-board").click();
  await page.getByTestId("destination-fluff-salon").click();
  await page.getByTestId("start-drive").click();
  const brake = page.getByRole("button", { name: "Hold brake" });
  await expect(brake).toBeVisible();
  const brakeBox = await brake.boundingBox();
  if (!brakeBox) throw new Error("Brake control has no layout box");
  await page.mouse.move(brakeBox.x + brakeBox.width / 2, brakeBox.y + brakeBox.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(500);
  await page.mouse.up();
  await page.evaluate(() => window.__gooby.test?.completeCityLeg());
  await page.getByTestId("enter-shop").click();
  await expect.poll(async () => page.evaluate(() => window.__gooby.runtime().sceneId))
    .toBe("shop:fluff-salon");

  const inspected = await page.evaluate(
    () => window.__gooby.test?.inspectShopItem("sunny-bucket-hat"),
  );
  if (!inspected) throw new Error("Sunny Bucket Hat was not inspectable in Fluff Salon");
  await page.locator('[data-shop-action="buy"]').click();
  await expect.poll(async () =>
    page.evaluate(() => window.__gooby.snapshot()?.inventory["sunny-bucket-hat"] ?? 0))
    .toBe(1);
  await page.getByRole("button", { name: "Return to Town" }).click();
  await expect(page.getByTestId("quick-return")).toBeHidden();
  await page.getByTestId("drive-home").click();
  await page.evaluate(() => window.__gooby.test?.completeCityLeg());
  await page.locator(".scene-chip").click();
  await expect.poll(async () => page.evaluate(() => window.__gooby.runtime().sceneId))
    .toBe("home:living-room");

  await page.locator('.tab-bar [data-panel="wardrobe"]').click();
  await page.locator(
    '[data-ui-action="wardrobe-preview"][data-item="sunny-bucket-hat"]',
  ).click();
  await page.locator('[data-ui-action="wardrobe-equip"][data-slot="head"]').click();
  await expect.poll(async () => page.evaluate(() => {
    const raw = localStorage.getItem("gooby.ui.v1");
    if (!raw) return null;
    return JSON.parse(raw).equipped?.head ?? null;
  })).toBe("sunny-bucket-hat");
  await page.screenshot({
    path: `${artifactRoot}/gooby_full_integration_equipped_390x844_v3.png`,
    animations: "disabled",
  });

  if (consoleErrors.length > 0 || pageErrors.length > 0 || externalRequests.length > 0) {
    throw new Error(JSON.stringify({ consoleErrors, pageErrors, externalRequests }));
  }

  await page.close();
  await context.close();
  if (!video) throw new Error("Playwright did not create a walkthrough video");
  await video.saveAs(`${artifactRoot}/gooby_full_integration_walkthrough_390x844_v3.webm`);
  console.log(JSON.stringify({
    viewport: "390x844",
    flow: [
      "onboarding",
      "pet",
      "feed",
      "bathe",
      "minigame-payout",
      "sleep-complete",
      "city-drive",
      "shop-purchase",
      "required-return",
      "equip",
    ],
    consoleErrors: 0,
    pageErrors: 0,
    externalRequests: 0,
  }));
} finally {
  await context.close().catch(() => undefined);
  await browser.close();
}
