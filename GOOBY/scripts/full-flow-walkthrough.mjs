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

function headingDelta(from, to) {
  let delta = to - from;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}

async function holdControl(control, durationMs) {
  const box = await control.boundingBox();
  if (!box) throw new Error("City control has no layout box");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  try {
    await page.waitForTimeout(durationMs);
  } finally {
    await page.mouse.up();
  }
}

async function steerToward(target, radius, stopPhase) {
  const left = page.getByRole("button", { name: "Hold to steer left" });
  const right = page.getByRole("button", { name: "Hold to steer right" });
  for (let attempt = 0; attempt < 320; attempt += 1) {
    const runtime = await page.evaluate(() => window.__gooby.runtime());
    if (stopPhase && runtime.cityPhase === stopPhase) return;
    if (!runtime.cityCar) throw new Error("City car is unavailable while driving");
    const dx = target[0] - runtime.cityCar.position[0];
    const dz = target[1] - runtime.cityCar.position[1];
    if (Math.hypot(dx, dz) <= radius) return;
    const error = headingDelta(runtime.cityCar.headingRadians, Math.atan2(dx, dz));
    if (Math.abs(error) < 0.11) {
      await page.waitForTimeout(70);
    } else {
      await holdControl(
        error > 0 ? left : right,
        Math.min(650, Math.max(100, Math.abs(error) * 420)),
      );
    }
  }
  throw new Error(`Pointer steering did not reach ${target.join(", ")}`);
}

async function driveCurrentRoute(stopPhase) {
  const route = await page.evaluate(() => window.__gooby.runtime().cityRoute);
  if (!route || route.length < 2) throw new Error("Active city route is unavailable");
  const firstTarget = route[1];
  await steerToward(firstTarget, 11);
  await holdControl(page.getByRole("button", { name: "Hold brake" }), 650);
  for (let index = 1; index < route.length; index += 1) {
    await steerToward(route[index], 3, index === route.length - 1 ? stopPhase : undefined);
  }
  await expect.poll(async () => page.evaluate(() => window.__gooby.runtime().cityPhase), {
    timeout: 25_000,
  }).toBe(stopPhase);
}

async function purchaseThroughNormalRoute(shop, itemId) {
  await page.locator('.tab-bar [data-panel="places"]').click();
  await page.getByTestId("open-city-board").click();
  await page.getByTestId(`destination-${shop}`).click();
  await page.getByTestId("start-drive").click();
  await driveCurrentRoute("arrived");
  await page.getByTestId("enter-shop").click();
  await expect.poll(async () => page.evaluate(() => window.__gooby.runtime().sceneId))
    .toBe(`shop:${shop}`);
  await page.locator(`.shop-catalog [data-shop-item="${itemId}"]`).click();
  await page.locator('[data-shop-action="buy"]').click();
  await expect.poll(async () =>
    page.evaluate((id) => window.__gooby.snapshot()?.inventory[id] ?? 0, itemId)).toBe(1);
  await page.getByRole("button", { name: "Return to Town" }).click();
  await expect(page.getByTestId("quick-return")).toBeHidden();
  await page.getByTestId("drive-home").click();
  await driveCurrentRoute("destination-board");
  await page.locator(".scene-chip").click();
  await expect.poll(async () => page.evaluate(() => window.__gooby.runtime().sceneId))
    .toBe("home:living-room");
}

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
  const game = page.locator('[data-minigame="carrot-catch"]');
  const gameBox = await game.boundingBox();
  if (!gameBox) throw new Error("Carrot Catch has no layout box");
  for (let step = 0; step < 24; step += 1) {
    await page.mouse.move(
      gameBox.x + gameBox.width * (0.2 + (step % 5) * 0.15),
      gameBox.y + gameBox.height * 0.76,
      { steps: 4 },
    );
    await page.waitForTimeout(120);
  }
  await page.getByRole("button", { name: "Quit", exact: true }).click();
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

  await purchaseThroughNormalRoute("cloud-boutique", "apricot-floor-cushion");
  await purchaseThroughNormalRoute("fluff-salon", "sunny-bucket-hat");

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
  await page.locator(".sheet").getByRole("button", { name: "Close" }).click();
  await page.locator('.tab-bar [data-panel="items"]').click();
  await page.getByRole("tab", { name: "Furniture" }).click();
  await page.locator('[data-ui-action="place-item"][data-item="apricot-floor-cushion"]').click();
  await expect.poll(async () => page.evaluate(() =>
    Object.keys(window.__gooby.snapshot()?.inventory ?? {}).some((key) =>
      key.startsWith("__home.catalog.v1|") && key.includes("apricot-floor-cushion")))).toBe(true);
  await page.waitForTimeout(500);
  await page.reload();
  await expect(page.locator("#app")).toHaveAttribute("data-ready", "true");
  await expect.poll(async () => page.evaluate(() =>
    Object.keys(window.__gooby.snapshot()?.inventory ?? {}).some((key) =>
      key.startsWith("__home.catalog.v1|") && key.includes("apricot-floor-cushion")))).toBe(true);
  await page.locator('.tab-bar [data-panel="wardrobe"]').click();
  await expect(page.locator(
    '[data-ui-action="wardrobe-preview"][data-item="sunny-bucket-hat"]',
  )).toHaveClass(/selected/u);
  await page.screenshot({
    path: `${artifactRoot}/gooby_release_candidate_equipped_390x844.png`,
    animations: "disabled",
  });

  if (consoleErrors.length > 0 || pageErrors.length > 0 || externalRequests.length > 0) {
    throw new Error(JSON.stringify({ consoleErrors, pageErrors, externalRequests }));
  }

  await page.close();
  await context.close();
  if (!video) throw new Error("Playwright did not create a walkthrough video");
  await video.saveAs(`${artifactRoot}/gooby_release_candidate_walkthrough_390x844.webm`);
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
      "place",
      "reload",
    ],
    consoleErrors: 0,
    pageErrors: 0,
    externalRequests: 0,
  }));
} finally {
  await context.close().catch(() => undefined);
  await browser.close();
}
