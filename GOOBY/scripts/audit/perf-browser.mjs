import { mkdir, copyFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, devices } from "@playwright/test";

const baseUrl = process.env.GOOBY_URL ?? "http://127.0.0.1:5173";
const artifacts = process.env.GOOBY_ARTIFACTS ?? "/opt/cursor/artifacts";
const artifactSuffix = process.env.GOOBY_ARTIFACT_SUFFIX
  ? `_${process.env.GOOBY_ARTIFACT_SUFFIX.replaceAll(/[^a-z0-9_-]/giu, "-")}`
  : "";
const artifactFile = (name, extension) => path.join(artifacts, `${name}${artifactSuffix}.${extension}`);
const reportPath = process.env.GOOBY_PERF_REPORT ?? artifactFile("gooby_perf_report", "json");
await mkdir(artifacts, { recursive: true });

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

async function waitForApp(page) {
  await page.locator("#app").waitFor({ state: "visible" });
  await page.waitForFunction(() => document.querySelector("#app")?.dataset.ready === "true");
  await page.waitForFunction(() => Boolean(window.__gooby?.perf?.snapshot));
  await page.waitForFunction(() => Boolean(window.__gooby?.perf?.controls));
}

async function completeOnboarding(page) {
  const onboarding = page.getByTestId("onboarding");
  if (!(await onboarding.isVisible())) return;
  await onboarding.getByRole("button", { name: "Meet Gooby" }).click();
  const canvas = page.locator("#game-canvas");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Game canvas has no layout box");
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.51);
  await page.getByTestId("feed").click();
  await onboarding.getByRole("button", { name: "Welcome home" }).click();
  await onboarding.waitFor({ state: "hidden" });
}

async function measure(page, label, settleMs = 2_200) {
  await page.evaluate(() => window.__gooby.perf.controls.resetRollingMetrics());
  await page.waitForTimeout(settleMs);
  const snapshot = await page.evaluate(() => window.__gooby.perf.snapshot());
  return { label, snapshot };
}

async function openPanel(page, panel) {
  await page.locator(`.tab-bar [data-panel="${panel}"]`).click();
  await page.locator(".sheet").waitFor({ state: "visible" });
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  ...devices["iPhone 13"],
  browserName: "chromium",
});
const page = await context.newPage();
const externalRequests = [];
const pageErrors = [];
page.on("pageerror", (error) => pageErrors.push(error.message));
page.on("request", (request) => {
  const requestUrl = new URL(request.url());
  if ((requestUrl.protocol === "http:" || requestUrl.protocol === "https:")
    && requestUrl.origin !== new URL(baseUrl).origin) {
    externalRequests.push(requestUrl.href);
  }
});

await page.goto(`${baseUrl}/?perf=1`);
await page.evaluate(() => localStorage.clear());
await page.reload();
await waitForApp(page);
await completeOnboarding(page);

const measurements = [];
measurements.push(await measure(page, "home:living-room"));

await openPanel(page, "places");
await page.getByTestId("open-city-board").click();
await page.waitForFunction(() => window.__gooby.runtime().sceneId === "city:drive");
measurements.push(await measure(page, "city:destination-board", 3_000));

const tierMeasurements = {};
const qualityApplication = {};
const expectedQuality = {
  low: { pixelRatio: 1, shadows: false, cameraFar: 76, particleDensity: 0.4 },
  mid: { pixelRatio: 1.5, shadows: true, cameraFar: 110, particleDensity: 0.7 },
  high: { pixelRatio: 2, shadows: true, cameraFar: 120, particleDensity: 1 },
};
for (const tier of ["low", "mid", "high"]) {
  await page.evaluate((value) => window.__gooby.perf.controls.setQuality(value), tier);
  const snapshot = (await measure(page, `city:${tier}`, 1_100)).snapshot;
  const applied = await page.evaluate(() => ({
    documentTier: document.documentElement.dataset.quality,
    particleDensity: Number.parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue("--gooby-particle-density"),
    ),
    runtimeTier: window.__gooby.runtime().renderer.qualityTier,
    fogEnabled: window.__gooby.runtime().renderer.fogEnabled,
  }));
  const expected = expectedQuality[tier];
  invariant(snapshot.quality.active === tier, `${tier}: quality runtime did not activate`);
  invariant(snapshot.quality.appliedPixelRatio === expected.pixelRatio, `${tier}: pixel ratio was not applied`);
  invariant(snapshot.quality.shadowsEnabled === expected.shadows, `${tier}: shadow setting was not applied`);
  invariant(snapshot.quality.cameraFar === expected.cameraFar, `${tier}: camera distance was not applied`);
  invariant(applied.documentTier === tier && applied.runtimeTier === tier, `${tier}: renderer/DOM quality labels disagree`);
  invariant(applied.particleDensity === expected.particleDensity, `${tier}: particle density was not applied`);
  invariant(applied.fogEnabled === false, `${tier}: quality runtime injected fog into the city`);
  tierMeasurements[tier] = snapshot;
  qualityApplication[tier] = applied;
}
await page.screenshot({
  path: artifactFile("gooby_perf_forced_high", "png"),
  fullPage: true,
});

await page.locator(".scene-chip").click();
await page.waitForFunction(() => window.__gooby.runtime().sceneId === "home:living-room");
await page.evaluate(() => {
  window.__gooby.perf.controls.setQuality("auto");
  window.__gooby.perf.controls.markResourceBaseline();
});
for (let index = 0; index < 10; index += 1) {
  const zone = index % 2 === 0 ? "garden" : "living-room";
  await openPanel(page, "places");
  await page.getByTestId(`home-zone-${zone}`).click();
  await page.waitForFunction((expected) => window.__gooby.runtime().sceneId === `home:${expected}`, zone);
  await page.waitForTimeout(180);
}
const transitionMeasurement = await measure(page, "home:10-transitions", 2_500);
measurements.push(transitionMeasurement);
invariant(
  transitionMeasurement.snapshot.resources.completedTransitions === 10,
  `Expected 10 app-recorded scene transitions, received ${transitionMeasurement.snapshot.resources.completedTransitions}`,
);
invariant(!transitionMeasurement.snapshot.resources.likelyLeak, "Ten scene transitions triggered the resource leak heuristic");

await page.evaluate(() => window.__gooby.test?.grantProgressionXp(3_600));
await openPanel(page, "play");
await page.locator('.game-card[data-game="delivery-dash"]').click();
await page.locator('[data-ui-action="start-game"][data-game="delivery-dash"]').click();
await page.locator('[data-minigame="delivery-dash"]').waitFor({ state: "visible" });
for (let index = 0; index < 3; index += 1) {
  await page.locator('[data-action="tutorial-next"]').click();
}
await page.locator('[data-action="choose-express"]').click();
measurements.push(await measure(page, "minigame:delivery-dash:express", 3_000));

const storageState = await context.storageState();
await context.close();

const demoContext = await browser.newContext({
  ...devices["iPhone 13"],
  browserName: "chromium",
  storageState,
  recordVideo: {
    dir: path.join(artifacts, ".gooby-perf-video"),
    size: { width: 390, height: 844 },
  },
});
const demoPage = await demoContext.newPage();
await demoPage.goto(`${baseUrl}/?perf=1&quality=high`);
await waitForApp(demoPage);
const demoVideo = demoPage.video();
for (const tier of ["high", "low", "mid", "high"]) {
  await demoPage.evaluate((value) => window.__gooby.perf.controls.setQuality(value), tier);
  await demoPage.waitForTimeout(650);
}
const governorResult = await demoPage.evaluate(() =>
  window.__gooby.perf.controls.simulateGovernor("high", 35, 7_000));
await demoPage.waitForTimeout(900);
await demoPage.screenshot({
  path: artifactFile("gooby_perf_governor_downgrade", "png"),
  fullPage: true,
});
const governorSnapshot = await demoPage.evaluate(() => window.__gooby.perf.snapshot());
await demoContext.close();
if (demoVideo) {
  await copyFile(await demoVideo.path(), artifactFile("gooby_quality_governor_demo", "webm"));
}
await browser.close();

const report = {
  generatedAt: new Date().toISOString(),
  device: "Playwright iPhone 13 / Chromium",
  baseUrl,
  heaviestGameRationale: "Delivery Dash redraws a full-resolution 2D city canvas and effects every app frame.",
  measurements,
  tierMeasurements,
  qualityApplication,
  tenTransitionResourceResult: transitionMeasurement.snapshot.resources,
  governor: {
    simulatedFps: 35,
    simulatedDurationMs: 7_000,
    start: "high",
    result: governorResult,
    snapshot: governorSnapshot,
  },
  externalRequests,
  pageErrors,
};
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(`Performance report: ${reportPath}`);
console.log(`Governor: high -> ${governorResult} after sustained 35 FPS`);
console.log(`10-transition likely leak: ${transitionMeasurement.snapshot.resources.likelyLeak}`);
console.log(`External requests: ${externalRequests.length}; page errors: ${pageErrors.length}`);
if (governorResult !== "mid" || externalRequests.length > 0 || pageErrors.length > 0) process.exitCode = 1;
