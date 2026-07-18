import type { Locator } from "@playwright/test";
import {
  HOME_ZONE_IDS,
  MINIGAME_IDS,
  type MinigameId,
} from "../src/core/contracts/scenes";
import { expect, test, type Page } from "./fixtures";

const IPAD_VIEWPORT = { width: 820, height: 1180 } as const;

interface CityPose {
  readonly position: readonly [number, number];
  readonly headingRadians: number;
}

async function waitForApp(page: Page): Promise<void> {
  await expect(page.locator("#app")).toHaveAttribute("data-ready", "true");
}

async function freshIpadStart(page: Page): Promise<void> {
  await page.addInitScript(() => {
    if (sessionStorage.getItem("e2e-ipad-fresh-start")) return;
    localStorage.clear();
    sessionStorage.setItem("e2e-ipad-fresh-start", "true");
  });
  await page.goto("/");
  await waitForApp(page);
}

async function completeOnboardingWithRealIpadInput(page: Page): Promise<void> {
  const onboarding = page.getByTestId("onboarding");
  if (!(await onboarding.isVisible())) return;
  await onboarding.getByRole("button", { name: "Meet Gooby" }).click();
  const canvas = page.locator("canvas");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Canvas has no iPad layout box");
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.51);
  await expect(onboarding.getByText("Share a snack")).toBeVisible();
  await page.getByTestId("feed").click();
  await expect(onboarding.getByText("You did it!")).toBeVisible();
  await onboarding.getByRole("button", { name: "Welcome home" }).click();
  await expect(onboarding).toBeHidden();
}

async function openPanel(
  page: Page,
  panel: "places" | "play" | "wardrobe" | "items" | "settings",
): Promise<void> {
  await page.locator(`.tab-bar [data-panel="${panel}"]`).click();
  await expect(page.locator(".sheet")).toBeVisible();
}

async function expectInsideIpadViewport(locator: Locator, label: string): Promise<void> {
  const box = await locator.boundingBox();
  expect(box, `${label} has an iPad layout box`).not.toBeNull();
  if (!box) return;
  expect(box.x, `${label} left edge`).toBeGreaterThanOrEqual(0);
  expect(box.y, `${label} top edge`).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width, `${label} right edge`).toBeLessThanOrEqual(IPAD_VIEWPORT.width + 0.5);
  expect(box.y + box.height, `${label} bottom edge`).toBeLessThanOrEqual(IPAD_VIEWPORT.height + 0.5);
  expect(box.width * box.height, `${label} has a visible hit area`).toBeGreaterThan(0);
}

async function unlockAllGamesForMountFixture(page: Page): Promise<void> {
  await page.evaluate(() => window.__gooby.test?.grantProgressionXp(3_600));
  await expect.poll(async () => page.evaluate(() => window.__gooby.snapshot()?.economy.level))
    .toBe(7);
}

async function startGameFromHub(page: Page, game: MinigameId): Promise<void> {
  await openPanel(page, "play");
  const card = page.locator(`.game-card[data-game="${game}"]`);
  if (await card.isVisible()) await card.click();
  await page.locator(`[data-ui-action="start-game"][data-game="${game}"]`).click();
  await expect(page.locator(`[data-minigame="${game}"]`)).toBeVisible();
  await expect.poll(async () => page.evaluate(() => window.__gooby.runtime().activeMinigame))
    .toBe(game);
}

async function openCityBoard(page: Page): Promise<void> {
  await openPanel(page, "places");
  await page.getByTestId("open-city-board").click();
  await expect.poll(async () => page.evaluate(() => window.__gooby.runtime().cityPhase))
    .toBe("destination-board");
}

async function cityPose(page: Page): Promise<CityPose> {
  const pose = await page.evaluate(() => window.__gooby.runtime().cityCar);
  if (!pose) throw new Error("City car has no active pose");
  return pose;
}

function distanceBetween(
  from: readonly [number, number],
  to: readonly [number, number],
): number {
  return Math.hypot(to[0] - from[0], to[1] - from[1]);
}

function headingDelta(from: number, to: number): number {
  let delta = to - from;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}

async function completeCityLegOnlyForLayoutFixture(
  page: Page,
  targetPhase: "arrived" | "destination-board",
): Promise<void> {
  await page.evaluate(() => {
    const hooks = window.__gooby.test;
    if (!hooks) throw new Error("City layout fixture hook is unavailable");
    hooks.completeCityLeg();
  });
  await expect.poll(async () => page.evaluate(() => window.__gooby.runtime().cityPhase))
    .toBe(targetPhase);
}

test("keeps iPad onboarding, home interactions, panels, and fixed chrome in safe bounds", async ({ page }) => {
  await freshIpadStart(page);
  expect(page.viewportSize()).toEqual(IPAD_VIEWPORT);
  await expectInsideIpadViewport(page.getByTestId("onboarding"), "onboarding dialog");
  await completeOnboardingWithRealIpadInput(page);

  for (const panel of ["places", "play", "wardrobe", "items", "settings"] as const) {
    await openPanel(page, panel);
    await expect(page.locator(`.tab-bar [data-panel="${panel}"]`)).toHaveClass(/active/u);
    await expectInsideIpadViewport(page.locator(".sheet"), `${panel} sheet`);
    await page.locator(".sheet").getByRole("button", { name: "Close" }).click();
  }

  for (const zone of HOME_ZONE_IDS) {
    await openPanel(page, "places");
    await page.getByTestId(`home-zone-${zone}`).click();
    await expect.poll(async () => page.evaluate(() => window.__gooby.runtime().sceneId))
      .toBe(`home:${zone}`);
    if (zone === "bathroom") {
      await expect(page.getByTestId("bathe")).toBeVisible();
      await page.getByTestId("bathe").click();
    }
  }

  for (const [locator, label] of [
    [page.locator(".scene-chip"), "scene chip"],
    [page.locator(".hud"), "needs HUD"],
    [page.locator(".bottom-ui"), "bottom actions"],
    [page.locator(".tab-bar"), "tab bar"],
    [page.getByTestId("feed"), "feed control"],
    [page.getByTestId("sleep"), "sleep control"],
  ] as const) {
    await expectInsideIpadViewport(locator, label);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth))
    .toBeLessThanOrEqual(0);
});

test("mounts every game on iPad with an enabled in-bounds control", async ({ page }) => {
  test.slow();
  await freshIpadStart(page);
  await completeOnboardingWithRealIpadInput(page);
  await unlockAllGamesForMountFixture(page);

  for (const game of MINIGAME_IDS) {
    await startGameFromHub(page, game);
    const root = page.locator(`[data-minigame="${game}"]`);
    await expect(root).toHaveCount(1);
    await expectInsideIpadViewport(root, `${game} root`);
    const controls = root.getByRole("button");
    expect(await controls.count(), `${game} exposes a visible control`).toBeGreaterThan(0);
    await expect(controls.first()).toBeVisible();
    await expect(controls.first()).toBeEnabled();
    await expectInsideIpadViewport(controls.first(), `${game} first control`);

    await page.reload();
    await waitForApp(page);
    await expect(page.getByTestId("onboarding")).toBeHidden();
  }
});

test("shows iPad guidance and responds to bounded held pointer, keyboard, and brake input", async ({ page }) => {
  await freshIpadStart(page);
  await completeOnboardingWithRealIpadInput(page);
  await openCityBoard(page);
  await page.getByTestId("destination-cloud-boutique").click();
  await page.getByTestId("start-drive").click();
  await expect.poll(async () => page.evaluate(() => window.__gooby.runtime().cityPhase))
    .toBe("driving-outbound");

  const distance = page.getByTestId("city-distance");
  await expect(distance).toBeVisible();
  await expect(distance).toContainText("Follow the gold arrows");
  await expect(page.locator(".city-edge-pointer")).toBeVisible();
  await expectInsideIpadViewport(distance, "city guidance");
  for (const name of ["Hold to steer left", "Hold brake", "Hold to steer right"]) {
    await expectInsideIpadViewport(page.getByRole("button", { name }), `${name} control`);
  }

  const segmentStart = await cityPose(page);
  await expect.poll(async () => distanceBetween(segmentStart.position, (await cityPose(page)).position), {
    timeout: 10_000,
  }).toBeGreaterThan(1);

  const steerLeft = page.getByRole("button", { name: "Hold to steer left" });
  const leftBox = await steerLeft.boundingBox();
  if (!leftBox) throw new Error("iPad pointer steering has no hit box");
  const beforePointerSteer = await cityPose(page);
  await page.mouse.move(leftBox.x + leftBox.width / 2, leftBox.y + leftBox.height / 2);
  await page.mouse.down();
  try {
    await expect(steerLeft).toHaveClass(/is-held/u);
    await expect.poll(async () =>
      headingDelta(beforePointerSteer.headingRadians, (await cityPose(page)).headingRadians), {
      timeout: 10_000,
    }).toBeGreaterThan(0.015);
  } finally {
    await page.mouse.up();
  }
  await expect(steerLeft).not.toHaveClass(/is-held/u);

  const brake = page.getByRole("button", { name: "Hold brake" });
  const brakeBox = await brake.boundingBox();
  if (!brakeBox) throw new Error("iPad brake has no hit box");
  await page.mouse.move(brakeBox.x + brakeBox.width / 2, brakeBox.y + brakeBox.height / 2);
  await page.mouse.down();
  let positionWhileStopped: readonly [number, number];
  try {
    await expect(brake).toHaveClass(/is-held/u);
    await page.waitForTimeout(2_200);
    positionWhileStopped = (await cityPose(page)).position;
    await page.waitForTimeout(1_000);
    const positionAfterHeldStop = (await cityPose(page)).position;
    expect(distanceBetween(positionWhileStopped, positionAfterHeldStop))
      .toBeLessThan(0.6);
  } finally {
    await page.mouse.up();
  }
  await expect(brake).not.toHaveClass(/is-held/u);
  await expect.poll(async () => distanceBetween(positionWhileStopped, (await cityPose(page)).position), {
    timeout: 10_000,
  }).toBeGreaterThan(0.75);

  const steerRight = page.getByRole("button", { name: "Hold to steer right" });
  const beforeKeyboardSteer = await cityPose(page);
  await page.keyboard.down("d");
  try {
    await expect(steerRight).toHaveClass(/is-held/u);
    await expect.poll(async () =>
      headingDelta(beforeKeyboardSteer.headingRadians, (await cityPose(page)).headingRadians), {
      timeout: 10_000,
    }).toBeLessThan(-0.015);
  } finally {
    await page.keyboard.up("d");
  }
  await expect(steerRight).not.toHaveClass(/is-held/u);

  const segmentEnd = await cityPose(page);
  const boundedDistance = distanceBetween(segmentStart.position, segmentEnd.position);
  expect(boundedDistance).toBeGreaterThan(3);
  expect(boundedDistance).toBeLessThan(90);
  expect(await page.evaluate(() => window.__gooby.runtime().cityPhase)).toBe("driving-outbound");
});

test("uses explicit leg fixtures to verify iPad shop and wardrobe UI persistence", async ({ page }) => {
  await freshIpadStart(page);
  await completeOnboardingWithRealIpadInput(page);
  await openCityBoard(page);
  await page.getByTestId("destination-fluff-salon").click();
  await page.getByTestId("start-drive").click();
  await expect.poll(async () => page.evaluate(() => window.__gooby.runtime().cityPhase))
    .toBe("driving-outbound");
  await completeCityLegOnlyForLayoutFixture(page, "arrived");

  await page.getByTestId("enter-shop").click();
  await expect.poll(async () => page.evaluate(() => window.__gooby.runtime().sceneId))
    .toBe("shop:fluff-salon");
  await expectInsideIpadViewport(page.locator(".shop-catalog"), "shop catalog");
  await expectInsideIpadViewport(
    page.getByRole("button", { name: "Return to Town" }),
    "shop return control",
  );

  await page.locator('.shop-catalog [data-shop-item="sunny-bucket-hat"]').click();
  await expectInsideIpadViewport(page.locator(".shop-inspect"), "shop item inspector");
  await page.locator('[data-shop-action="try"]').click();
  await page.locator('[data-shop-action="buy"]').click();
  await expect.poll(async () =>
    page.evaluate(() => window.__gooby.snapshot()?.inventory["sunny-bucket-hat"] ?? 0))
    .toBe(1);

  await page.getByRole("button", { name: "Return to Town" }).click();
  await page.getByTestId("drive-home").click();
  await expect.poll(async () => page.evaluate(() => window.__gooby.runtime().cityPhase))
    .toBe("driving-home");
  await completeCityLegOnlyForLayoutFixture(page, "destination-board");
  await page.locator(".scene-chip").click();
  await expect.poll(async () => page.evaluate(() => window.__gooby.runtime().sceneId))
    .toBe("home:living-room");

  await openPanel(page, "wardrobe");
  const hat = page.locator(
    '[data-ui-action="wardrobe-preview"][data-item="sunny-bucket-hat"]',
  );
  await expectInsideIpadViewport(hat, "wardrobe hat option");
  await hat.click();
  await page.locator('[data-ui-action="wardrobe-equip"][data-slot="head"]').click();
  await expect.poll(async () =>
    page.evaluate(() => window.__gooby.snapshot()?.ui?.equipped?.head ?? null))
    .toBe("sunny-bucket-hat");

  await page.evaluate(() => window.__gooby.test?.flushSave());
  await page.reload();
  await waitForApp(page);
  expect(await page.evaluate(() => {
    const state = window.__gooby.snapshot();
    return {
      owned: state?.inventory["sunny-bucket-hat"],
      equipped: state?.ui?.equipped?.head,
    };
  })).toEqual({ owned: 1, equipped: "sunny-bucket-hat" });
  await openPanel(page, "wardrobe");
  await expect(hat).toHaveClass(/selected/u);
  await expect(page.locator('[data-ui-action="wardrobe-equip"][data-slot="head"]'))
    .toBeDisabled();
});
