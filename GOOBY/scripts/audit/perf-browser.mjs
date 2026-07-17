import { copyFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, devices } from "@playwright/test";
import { analyzeLeakSeries } from "../../src/perf/leak-math.mjs";
import { probeServerIdentity } from "../../src/perf/audit-runner.mjs";

const baseUrl = process.env.GOOBY_URL ?? "http://127.0.0.1:5173";
const nonce = process.env.GOOBY_PERF_NONCE;
const expectedServerPid = Number.parseInt(process.env.GOOBY_PERF_SERVER_PID ?? "", 10);
if (!nonce || !Number.isInteger(expectedServerPid) || expectedServerPid <= 0) {
  throw new Error("GOOBY_PERF_NONCE and GOOBY_PERF_SERVER_PID are required");
}
const artifacts = process.env.GOOBY_ARTIFACTS ?? "/opt/cursor/artifacts";
const artifactSuffix = process.env.GOOBY_ARTIFACT_SUFFIX
  ? `_${process.env.GOOBY_ARTIFACT_SUFFIX.replaceAll(/[^a-z0-9_-]/giu, "-")}`
  : "";
const artifactFile = (name, extension) => path.join(artifacts, `${name}${artifactSuffix}.${extension}`);
const reportPath = process.env.GOOBY_PERF_REPORT ?? artifactFile("gooby_perf_report", "json");
const baseHost = new URL(baseUrl).host;
await mkdir(artifacts, { recursive: true });

const MAIN_SCENE_SAMPLES = 120;
const QUALITY_TIER_SAMPLES = 60;
const LEAK_CYCLES = 8;
const LEAK_MINIMUM_SAMPLES = LEAK_CYCLES + 1;
const PERF_LIMITS = {
  "home:living-room": {
    samples: MAIN_SCENE_SAMPLES,
    timing: {
      swiftshader: { minFps: 45, maxP95Ms: 28 },
      hardware: { minFps: 50, maxP95Ms: 24 },
    },
    maxDrawCallsP95: 125,
    maxTrianglesP95: 20_000,
  },
  "city:destination-board": {
    samples: MAIN_SCENE_SAMPLES,
    timing: {
      swiftshader: { minFps: 28, maxP95Ms: 42 },
      hardware: { minFps: 45, maxP95Ms: 28 },
    },
    maxDrawCallsP95: 48,
    maxTrianglesP95: 16_000,
  },
  "city:driving": {
    samples: MAIN_SCENE_SAMPLES,
    timing: {
      swiftshader: { minFps: 24, maxP95Ms: 50 },
      hardware: { minFps: 42, maxP95Ms: 30 },
    },
    maxDrawCallsP95: 64,
    maxTrianglesP95: 22_000,
  },
  "shop:fluff-salon:try-on": {
    samples: MAIN_SCENE_SAMPLES,
    timing: {
      swiftshader: { minFps: 24, maxP95Ms: 65 },
      hardware: { minFps: 42, maxP95Ms: 30 },
    },
    maxDrawCallsP95: 100,
    maxTrianglesP95: 21_000,
  },
  "minigame:delivery-dash:express": {
    samples: MAIN_SCENE_SAMPLES,
    timing: {
      swiftshader: { minFps: 48, maxP95Ms: 25 },
      hardware: { minFps: 52, maxP95Ms: 22 },
    },
    maxDrawCallsP95: 1,
    maxTrianglesP95: 1,
  },
  "minigame:pond-fishing:legend": {
    samples: MAIN_SCENE_SAMPLES,
    timing: {
      swiftshader: { minFps: 48, maxP95Ms: 25 },
      hardware: { minFps: 52, maxP95Ms: 22 },
    },
    maxDrawCallsP95: 1,
    maxTrianglesP95: 1,
  },
  "minigame:rhythm-hop:hard": {
    samples: MAIN_SCENE_SAMPLES,
    timing: {
      swiftshader: { minFps: 48, maxP95Ms: 25 },
      hardware: { minFps: 52, maxP95Ms: 22 },
    },
    maxDrawCallsP95: 1,
    maxTrianglesP95: 1,
  },
};
const LEAK_LIMITS = {
  geometries: { maxSlope: 0.25, maxFinalGrowth: 2, maxPeakGrowth: 4 },
  textures: { maxSlope: 0.15, maxFinalGrowth: 1, maxPeakGrowth: 2 },
  materials: { maxSlope: 0.25, maxFinalGrowth: 2, maxPeakGrowth: 4 },
  programs: { maxSlope: 0.15, maxFinalGrowth: 1, maxPeakGrowth: 2 },
  listeners: { maxSlope: 0.5, maxFinalGrowth: 4, maxPeakGrowth: 8 },
  domNodes: { maxSlope: 2, maxFinalGrowth: 12, maxPeakGrowth: 30 },
  heapBytes: {
    maxSlope: 512 * 1024,
    maxFinalGrowth: 6 * 1024 * 1024,
    maxPeakGrowth: 12 * 1024 * 1024,
  },
};
const expectedQuality = {
  low: { pixelRatio: 1, shadows: false, cameraFar: 76, particleDensity: 0.4 },
  mid: { pixelRatio: 1.5, shadows: true, cameraFar: 110, particleDensity: 0.7 },
  high: { pixelRatio: 2, shadows: true, cameraFar: 120, particleDensity: 1 },
};

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function isAuditHost(url) {
  const parsed = new URL(url);
  return !["http:", "https:", "ws:", "wss:"].includes(parsed.protocol)
    || parsed.host === baseHost;
}

async function guardNetwork(context, externalRequests) {
  await context.route("**/*", async (route) => {
    const url = route.request().url();
    if (isAuditHost(url)) {
      await route.continue();
      return;
    }
    externalRequests.push(url);
    await route.abort("blockedbyclient");
  });
}

function watchPage(page, pageErrors, externalRequests) {
  page.setDefaultTimeout(15_000);
  page.setDefaultNavigationTimeout(25_000);
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("websocket", (socket) => {
    if (!isAuditHost(socket.url())) externalRequests.push(socket.url());
  });
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

async function sampleSnapshot(page, label, minimumSamples, warmupMs = 1_800) {
  await page.evaluate(() => window.__gooby.perf.controls.resetRollingMetrics());
  await page.waitForTimeout(warmupMs);
  await page.evaluate(() => window.__gooby.perf.controls.resetRollingMetrics());
  await page.waitForFunction(
    (minimum) => window.__gooby.perf.snapshot().frame.samples >= minimum,
    minimumSamples,
    { timeout: 20_000 },
  );
  const snapshot = await page.evaluate(() => window.__gooby.perf.snapshot());
  invariant(
    snapshot.frame.samples >= minimumSamples,
    `${label}: only ${snapshot.frame.samples}/${minimumSamples} frame samples were recorded`,
  );
  return snapshot;
}

function assertSceneLimits(label, snapshot, rendererClass) {
  const limits = PERF_LIMITS[label];
  invariant(limits, `${label}: no performance limit is documented`);
  const timing = limits.timing[rendererClass];
  invariant(
    snapshot.frame.fps >= timing.minFps,
    `${label}: ${snapshot.frame.fps.toFixed(1)} FPS is below ${timing.minFps} (${rendererClass})`,
  );
  invariant(
    snapshot.frame.p95Ms <= timing.maxP95Ms,
    `${label}: ${snapshot.frame.p95Ms.toFixed(1)}ms p95 exceeds ${timing.maxP95Ms}ms (${rendererClass})`,
  );
  invariant(
    snapshot.render.drawCallsP95 <= limits.maxDrawCallsP95,
    `${label}: ${snapshot.render.drawCallsP95} draw calls p95 exceeds ${limits.maxDrawCallsP95}`,
  );
  invariant(
    snapshot.render.trianglesP95 <= limits.maxTrianglesP95,
    `${label}: ${snapshot.render.trianglesP95} triangles p95 exceeds ${limits.maxTrianglesP95}`,
  );
}

async function measureScene(page, label, rendererClass) {
  const limits = PERF_LIMITS[label];
  invariant(limits, `${label}: missing scene limits`);
  const snapshot = await sampleSnapshot(page, label, limits.samples);
  console.log(
    `${label}: ${snapshot.frame.fps.toFixed(1)} FPS, `
      + `${snapshot.frame.p95Ms.toFixed(1)}ms p95, `
      + `${snapshot.render.drawCallsP95} draws, `
      + `${snapshot.render.trianglesP95} triangles, `
      + `${snapshot.frame.samples} samples`,
  );
  assertSceneLimits(label, snapshot, rendererClass);
  return { label, rendererClass, limits, snapshot };
}

async function openPanel(page, panel) {
  await page.locator(`.tab-bar [data-panel="${panel}"]`).click();
  await page.locator(".sheet").waitFor({ state: "visible" });
}

async function closePanel(page) {
  if (!(await page.locator(".sheet").isVisible())) return;
  await page.locator('.sheet [data-ui-action="close-panel"]').click();
  await page.locator(".sheet").waitFor({ state: "hidden" });
}

async function goHome(page) {
  await page.locator(".scene-chip").click();
  await page.waitForFunction(() => window.__gooby.runtime().sceneId === "home:living-room");
}

async function visitHomeZone(page, zone) {
  await openPanel(page, "places");
  await page.getByTestId(`home-zone-${zone}`).click();
  await page.waitForFunction(
    (expected) => window.__gooby.runtime().sceneId === `home:${expected}`,
    zone,
  );
}

async function startMinigame(page, game) {
  await openPanel(page, "play");
  const card = page.locator(`.game-card[data-game="${game}"]`);
  if (await card.count() === 0) {
    await page.locator('[data-ui-action="select-game"][data-game=""]').click();
  }
  await card.click();
  const start = page.locator(`[data-ui-action="start-game"][data-game="${game}"]`);
  invariant(!(await start.isDisabled()), `${game}: minigame remained progression-locked`);
  await start.click();
  await page.waitForFunction(
    (expected) => window.__gooby.runtime().activeMinigame === expected,
    game,
  );
  await page.locator(`[data-minigame="${game}"]`).waitFor({ state: "visible" });
}

async function prepareMinigame(page, game) {
  const root = page.locator(`[data-minigame="${game}"]`);
  if (game === "delivery-dash") {
    for (let index = 0; index < 3; index += 1) {
      await root.locator('[data-action="tutorial-next"]').click();
    }
    await root.locator('[data-action="choose-express"]').click();
  } else if (game === "pond-fishing") {
    await root.locator('[data-action="tutorial-skip"]').click();
    await root.locator('[data-action="difficulty"][data-difficulty="legend"]').click();
    await root.locator('[data-action="play"]').click();
  } else if (game === "rhythm-hop") {
    await root.locator('[data-action="tutorial-skip"]').click();
    await root.locator('[data-action="song"][data-song="moonhop-magic"]').click();
    await root.locator('[data-action="difficulty"][data-difficulty="hard"]').click();
    await root.locator('[data-action="play"]').click();
  } else if (game === "bubble-bath-blast") {
    await root.locator('[data-action="begin"]').click();
  }
  await page.waitForTimeout(250);
}

async function exitMinigame(page) {
  await page.locator('[data-scene-chrome] [data-ui-action="pause"]')
    .evaluate((button) => button.click());
  const leave = page.locator('[data-ui-action="exit-game"]');
  await leave.waitFor({ state: "visible" });
  await leave.click();
  await page.waitForFunction(() => {
    const runtime = window.__gooby.runtime();
    return runtime.sceneId === "home:living-room"
      && runtime.activeMinigame === null
      && runtime.minigameRoots === 0;
  });
}

async function toggleCosmetic(page) {
  await openPanel(page, "wardrobe");
  await page.locator(
    '[data-ui-action="wardrobe-preview"][data-slot="head"][data-item="sunny-bucket-hat"]',
  ).click();
  await page.locator('[data-ui-action="wardrobe-equip"][data-slot="head"]').click();
  await page.waitForFunction(() =>
    window.__gooby.snapshot()?.ui.equipped.head === "sunny-bucket-hat");
  await page.locator(
    '[data-ui-action="wardrobe-preview"][data-slot="head"]:not([data-item])',
  ).click();
  await page.locator('[data-ui-action="wardrobe-equip"][data-slot="head"]').click();
  await page.waitForFunction(() => window.__gooby.snapshot()?.ui.equipped.head === undefined);
  await closePanel(page);
}

async function forceGarbageCollection(cdp) {
  try {
    await cdp.send("HeapProfiler.collectGarbage");
    return true;
  } catch {
    return false;
  }
}

async function cdpMetrics(cdp) {
  const response = await cdp.send("Performance.getMetrics");
  const metrics = Object.fromEntries(response.metrics.map(({ name, value }) => [name, value]));
  for (const name of ["JSEventListeners", "Nodes", "JSHeapUsedSize"]) {
    invariant(Number.isFinite(metrics[name]), `CDP Performance.getMetrics omitted ${name}`);
  }
  return {
    listeners: metrics.JSEventListeners,
    domNodes: metrics.Nodes,
    heapBytes: metrics.JSHeapUsedSize,
  };
}

async function leakCheckpoint(page, cdp, index) {
  await page.waitForTimeout(1_100);
  const forcedGc = await forceGarbageCollection(cdp);
  await page.waitForTimeout(150);
  const [snapshot, browserMetrics, runtime] = await Promise.all([
    page.evaluate(() => window.__gooby.perf.snapshot()),
    cdpMetrics(cdp),
    page.evaluate(() => window.__gooby.runtime()),
  ]);
  invariant(runtime.sceneId === "home:living-room", `Leak checkpoint ${index} was not in living room`);
  invariant(runtime.activeMinigame === null && runtime.minigameRoots === 0,
    `Leak checkpoint ${index} retained a mounted minigame`);
  invariant(snapshot.resources.current.heapBytes !== null,
    `Leak checkpoint ${index} has no precise page heap metric`);
  return {
    index,
    forcedGc,
    transitions: snapshot.resources.completedTransitions,
    geometries: snapshot.resources.current.geometries,
    textures: snapshot.resources.current.textures,
    materials: snapshot.resources.current.materials,
    programs: snapshot.resources.current.programs,
    ...browserMetrics,
    probeHeapBytes: snapshot.resources.current.heapBytes,
  };
}

const identityProbe = await probeServerIdentity(baseUrl, nonce);
invariant(identityProbe.ready, "Performance server was unreachable before browser launch");
invariant(
  identityProbe.identity.pid === expectedServerPid,
  `Performance server PID changed from ${expectedServerPid} to ${identityProbe.identity.pid}`,
);

const externalRequests = [];
const pageErrors = [];
let browser = null;
let context = null;
let demoContext = null;
try {
  browser = await chromium.launch({
    headless: true,
    args: ["--enable-precise-memory-info"],
  });
  context = await browser.newContext({
    ...devices["iPhone 13"],
    browserName: "chromium",
    serviceWorkers: "block",
  });
  await guardNetwork(context, externalRequests);
  const page = await context.newPage();
  watchPage(page, pageErrors, externalRequests);
  const cdp = await context.newCDPSession(page);
  await cdp.send("Performance.enable");

  await page.goto(`${baseUrl}/?perf=1`);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await waitForApp(page);
  await completeOnboarding(page);
  await page.evaluate(() => window.__gooby.perf.controls.setQuality("low"));

  const measurements = [];
  const homeSnapshot = await sampleSnapshot(
    page,
    "home:living-room",
    PERF_LIMITS["home:living-room"].samples,
  );
  const rendererClass = /swiftshader/iu.test(homeSnapshot.quality.profile.gpu)
    ? "swiftshader"
    : "hardware";
  console.log(
    `home:living-room: ${homeSnapshot.frame.fps.toFixed(1)} FPS, `
      + `${homeSnapshot.frame.p95Ms.toFixed(1)}ms p95, `
      + `${homeSnapshot.render.drawCallsP95} draws, `
      + `${homeSnapshot.render.trianglesP95} triangles, `
      + `${homeSnapshot.frame.samples} samples`,
  );
  assertSceneLimits("home:living-room", homeSnapshot, rendererClass);
  measurements.push({
    label: "home:living-room",
    rendererClass,
    limits: PERF_LIMITS["home:living-room"],
    snapshot: homeSnapshot,
  });

  await page.evaluate(() => window.__gooby.test?.grantProgressionXp(3_600));
  await page.waitForFunction(() => (window.__gooby.snapshot()?.economy.level ?? 0) >= 7);
  await openPanel(page, "places");
  await page.getByTestId("open-city-board").click();
  await page.waitForFunction(() => window.__gooby.runtime().sceneId === "city:drive");
  measurements.push(await measureScene(page, "city:destination-board", rendererClass));

  const tierMeasurements = {};
  const qualityApplication = {};
  for (const tier of ["low", "mid", "high"]) {
    await page.evaluate((value) => window.__gooby.perf.controls.setQuality(value), tier);
    const snapshot = await sampleSnapshot(
      page,
      `city:quality:${tier}`,
      QUALITY_TIER_SAMPLES,
      900,
    );
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
  await page.evaluate(() => window.__gooby.perf.controls.setQuality("low"));

  await page.getByTestId("destination-fluff-salon").click();
  await page.getByTestId("start-drive").click();
  await page.waitForFunction(() => window.__gooby.runtime().cityPhase === "driving-outbound");
  measurements.push(await measureScene(page, "city:driving", rendererClass));
  await page.evaluate(() => window.__gooby.test?.completeCityLeg());
  await page.getByTestId("enter-shop").click();
  await page.waitForFunction(() => window.__gooby.runtime().sceneId === "shop:fluff-salon");
  await page.locator('[data-shop-item="sunny-bucket-hat"]').click();
  await page.locator('[data-shop-action="buy"]').click();
  await page.waitForFunction(() =>
    window.__gooby.snapshot()?.inventory["sunny-bucket-hat"] === 1);
  await page.locator('[data-shop-action="try"]').click();
  measurements.push(await measureScene(page, "shop:fluff-salon:try-on", rendererClass));

  await page.getByRole("button", { name: "Return to Town" }).click();
  await page.waitForFunction(() => window.__gooby.runtime().cityPhase === "return-board");
  await page.getByTestId("drive-home").click();
  await page.waitForFunction(() => window.__gooby.runtime().cityPhase === "driving-home");
  await page.evaluate(() => window.__gooby.test?.completeCityLeg());
  await page.waitForFunction(() => window.__gooby.runtime().cityPhase === "destination-board");
  await goHome(page);

  const measuredGames = [
    ["delivery-dash", "minigame:delivery-dash:express"],
    ["pond-fishing", "minigame:pond-fishing:legend"],
    ["rhythm-hop", "minigame:rhythm-hop:hard"],
  ];
  for (const [game, label] of measuredGames) {
    await startMinigame(page, game);
    await prepareMinigame(page, game);
    measurements.push(await measureScene(page, label, rendererClass));
    await exitMinigame(page);
  }
  await startMinigame(page, "bubble-bath-blast");
  await prepareMinigame(page, "bubble-bath-blast");
  await exitMinigame(page);

  for (const zone of ["kitchen", "bathroom", "bedroom", "garden"]) {
    await visitHomeZone(page, zone);
    await goHome(page);
  }
  await toggleCosmetic(page);

  await forceGarbageCollection(cdp);
  await page.waitForTimeout(1_100);
  await page.evaluate(() => window.__gooby.perf.controls.markResourceBaseline());
  const leakSamples = [await leakCheckpoint(page, cdp, 0)];
  const cycleZones = ["garden", "kitchen", "bathroom", "bedroom"];
  const cycleGames = ["delivery-dash", "pond-fishing", "rhythm-hop", "bubble-bath-blast"];
  for (let index = 0; index < LEAK_CYCLES; index += 1) {
    await visitHomeZone(page, cycleZones[index % cycleZones.length]);
    await goHome(page);
    await toggleCosmetic(page);
    const game = cycleGames[index % cycleGames.length];
    await startMinigame(page, game);
    await prepareMinigame(page, game);
    await exitMinigame(page);
    leakSamples.push(await leakCheckpoint(page, cdp, index + 1));
  }

  const finalResourceSnapshot = await page.evaluate(() => window.__gooby.perf.snapshot());
  invariant(
    finalResourceSnapshot.resources.completedTransitions >= 30,
    `Expected at least 30 post-baseline transitions; received ${finalResourceSnapshot.resources.completedTransitions}`,
  );
  invariant(
    !finalResourceSnapshot.resources.likelyLeak,
    "Mixed scene/minigame/cosmetic cycles triggered the in-app resource leak heuristic",
  );
  const leakAnalysis = analyzeLeakSeries(leakSamples, LEAK_LIMITS, LEAK_MINIMUM_SAMPLES);
  invariant(leakAnalysis.passed, `Leak trend limits failed: ${leakAnalysis.failures.join("; ")}`);
  invariant(leakSamples.every(({ forcedGc }) => forcedGc), "CDP garbage collection became unavailable");

  const storageState = await context.storageState();
  await context.close();
  context = null;

  demoContext = await browser.newContext({
    ...devices["iPhone 13"],
    browserName: "chromium",
    serviceWorkers: "block",
    storageState,
    recordVideo: {
      dir: path.join(artifacts, ".gooby-perf-video"),
      size: { width: 390, height: 844 },
    },
  });
  await guardNetwork(demoContext, externalRequests);
  const demoPage = await demoContext.newPage();
  watchPage(demoPage, pageErrors, externalRequests);
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
  demoContext = null;
  if (demoVideo) {
    await copyFile(await demoVideo.path(), artifactFile("gooby_quality_governor_demo", "webm"));
  }

  const report = {
    generatedAt: new Date().toISOString(),
    device: "Playwright iPhone 13 / Chromium",
    baseUrl,
    nonce,
    serverPid: expectedServerPid,
    rendererClass,
    sampleRequirements: {
      mainScenes: MAIN_SCENE_SAMPLES,
      qualityTiers: QUALITY_TIER_SAMPLES,
      leakCheckpoints: LEAK_MINIMUM_SAMPLES,
    },
    heaviestGameRationale: [
      "Delivery Dash repaints a full-resolution 2D city canvas and traffic every frame.",
      "Pond Fishing runs the largest animated Shadow DOM water/fish surface.",
      "Rhythm Hop animates timestamped hard-mode notes across three lanes.",
    ],
    performanceLimits: PERF_LIMITS,
    measurements,
    tierMeasurements,
    qualityApplication,
    leak: {
      cycles: LEAK_CYCLES,
      postBaselineTransitions: finalResourceSnapshot.resources.completedTransitions,
      limits: LEAK_LIMITS,
      samples: leakSamples,
      analysis: leakAnalysis,
      inAppResourceSnapshot: finalResourceSnapshot.resources,
    },
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
  console.log(`Renderer: ${rendererClass}; measured scenes: ${measurements.length}`);
  console.log(`Leak cycles: ${LEAK_CYCLES}; post-baseline transitions: ${finalResourceSnapshot.resources.completedTransitions}`);
  console.log(`Governor: high -> ${governorResult} after sustained 35 FPS`);
  console.log(`External requests: ${externalRequests.length}; page errors: ${pageErrors.length}`);

  invariant(governorResult === "mid", `Governor result was ${governorResult}, expected mid`);
  invariant(externalRequests.length === 0, `Blocked external requests: ${externalRequests.join(", ")}`);
  invariant(pageErrors.length === 0, `Browser page errors: ${pageErrors.join("; ")}`);
} finally {
  await demoContext?.close().catch(() => undefined);
  await context?.close().catch(() => undefined);
  await browser?.close().catch(() => undefined);
}
