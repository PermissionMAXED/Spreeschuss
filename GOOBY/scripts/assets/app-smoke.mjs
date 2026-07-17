import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "@playwright/test";

const url = process.env.GOOBY_URL ?? "http://127.0.0.1:5173";
const artifactRoot = process.env.GOOBY_ARTIFACT_DIR ?? "/opt/cursor/artifacts";
const screenshotPath = resolve(artifactRoot, "gooby_asset_runtime_city_20260717.png");
const videoPath = resolve(artifactRoot, "gooby_asset_runtime_city_20260717.webm");
const manifest = JSON.parse(await readFile(resolve(import.meta.dirname, "../../assets/manifest.json"), "utf8"));
const expectedAssetRequests = manifest.packs
  .flatMap((pack) => pack.files)
  .map((file) => `/${file.path}`)
  .sort();
await mkdir(artifactRoot, { recursive: true });
const videoRoot = await mkdtemp(join(tmpdir(), "gooby-asset-smoke-"));
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  recordVideo: { dir: videoRoot, size: { width: 390, height: 844 } },
});
const page = await context.newPage();
const runtimeAssetRequests = new Set();
const externalRequests = new Set();
const browserErrors = [];
let passed = false;
try {
  page.on("request", (request) => {
    const requestUrl = new URL(request.url());
    if (requestUrl.pathname.startsWith("/assets/vendor/")) runtimeAssetRequests.add(requestUrl.pathname);
    if (
      (requestUrl.protocol === "http:" || requestUrl.protocol === "https:")
      && !["127.0.0.1", "localhost"].includes(requestUrl.hostname)
    ) {
      externalRequests.add(request.url());
    }
  });
  page.on("console", (message) => {
    const value = message.text();
    if (
      message.type() === "error"
      && !value.includes("frame-ancestors' is ignored when delivered via a <meta> element")
    ) {
      browserErrors.push(value);
    }
  });
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("requestfailed", (request) => {
    browserErrors.push(`${request.url()}: ${request.failure()?.errorText ?? "failed"}`);
  });
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

  await page.getByRole("tab", { name: "Places" }).click();
  await page.getByTestId("open-city-board").click();
  await page.waitForFunction(() => window.__gooby.runtime().sceneId === "city:drive");
  await page.getByTestId("destination-carrot-market").waitFor();
  await page.waitForTimeout(300);

  const actualAssetRequests = [...runtimeAssetRequests].sort();
  if (JSON.stringify(actualAssetRequests) !== JSON.stringify(expectedAssetRequests)) {
    throw new Error(
      `Runtime asset requests differ from the curated manifest: `
      + `${JSON.stringify({ expectedAssetRequests, actualAssetRequests })}`,
    );
  }
  if (externalRequests.size > 0) {
    throw new Error(`External runtime requests detected: ${[...externalRequests].join(", ")}`);
  }
  if (browserErrors.length > 0) throw new Error(`Browser errors:\n${browserErrors.join("\n")}`);
  await page.screenshot({ path: screenshotPath });
  console.log(JSON.stringify({
    onboarding: state.profile.onboardingComplete,
    carrots: state.inventory.carrot,
    xp: state.economy.xp,
    fun: Number(state.simulation.needs.fun.toFixed(2)),
    full: Number(state.simulation.needs.hunger.toFixed(2)),
    curatedAssetRequests: actualAssetRequests,
    externalRequests: externalRequests.size,
  }));
  passed = true;
} finally {
  const video = page.video();
  await context.close();
  if (passed && video) await video.saveAs(videoPath);
  await browser.close();
  await rm(videoRoot, { recursive: true, force: true });
}

if (passed) {
  console.log(`Screenshot: ${screenshotPath}`);
  console.log(`Video: ${videoPath}`);
}
