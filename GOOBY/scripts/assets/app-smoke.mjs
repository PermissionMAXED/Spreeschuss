import { chromium } from "@playwright/test";

const url = process.env.GOOBY_URL ?? "http://127.0.0.1:5173";
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(url);
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });
  await page.locator("#app[data-ready=true]").waitFor();

  const onboarding = page.getByTestId("onboarding");
  await onboarding.getByRole("button", { name: "Meet Gooby" }).click();
  const canvas = page.locator("canvas");
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error("Game canvas has no layout bounds");
  for (const yRatio of [0.43, 0.51, 0.59]) {
    await page.mouse.click(bounds.x + bounds.width * 0.5, bounds.y + bounds.height * yRatio);
    await page.waitForTimeout(150);
  }
  await page.getByText("Share a snack").waitFor();
  await page.getByTestId("feed").click();
  await onboarding.getByRole("button", { name: "Welcome home" }).click();
  await page.waitForTimeout(250);

  const state = await page.evaluate(() => window.__gooby.snapshot());
  if (!state?.profile.onboardingComplete || state.inventory.carrot !== 2 || state.economy.xp !== 10) {
    throw new Error(`Unexpected core-flow state: ${JSON.stringify(state)}`);
  }
  console.log(JSON.stringify({
    onboarding: state.profile.onboardingComplete,
    carrots: state.inventory.carrot,
    xp: state.economy.xp,
    fun: Number(state.simulation.needs.fun.toFixed(2)),
    full: Number(state.simulation.needs.hunger.toFixed(2)),
  }));
} finally {
  await browser.close();
}
