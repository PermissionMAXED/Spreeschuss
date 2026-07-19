import { copyFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, devices } from "@playwright/test";
import {
  DEFAULT_CALIBRATION_OPTIONS,
  MAX_CALIBRATION_COHORTS,
  MEASUREMENT_TRIALS,
  advanceWarmupState,
  assertNormalizedTimingLimits,
  assertTimingLimits,
  createWarmupState,
  normalizedSustainedSlowProbeIsRejected,
  runCalibrationCohorts,
  runWithDiagnosticReport,
  summarizePerformanceTrials,
  sustainedSlowProbeIsRejected,
} from "../../src/perf/audit-methodology.mjs";
import { analyzeLeakSeries } from "../../src/perf/leak-math.mjs";
import { probeServerIdentity } from "../../src/perf/audit-runner.mjs";
import {
  CALIBRATION_PAGE_PATH,
  CALIBRATION_VIEWPORT,
  CALIBRATION_WORKLOAD,
} from "../../src/perf/calibration-workload.mjs";

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
const cpuThrottleRate = Number.parseFloat(process.env.GOOBY_PERF_CPU_THROTTLE_RATE ?? "1");
if (!Number.isFinite(cpuThrottleRate) || cpuThrottleRate < 1 || cpuThrottleRate > 20) {
  throw new RangeError("GOOBY_PERF_CPU_THROTTLE_RATE must be between 1 and 20");
}
const calibrationJitterMode = process.env.GOOBY_PERF_CALIBRATION_JITTER ?? "none";
if (!["none", "first-cohort", "both-cohorts"].includes(calibrationJitterMode)) {
  throw new RangeError(
    "GOOBY_PERF_CALIBRATION_JITTER must be none, first-cohort, or both-cohorts",
  );
}
const baseHost = new URL(baseUrl).host;
await mkdir(artifacts, { recursive: true });

const MAIN_SCENE_SAMPLES = 120;
const QUALITY_TIER_SAMPLES = 60;
const WARMUP_OBSERVATION_MS = 1_100;
const WARMUP_TIMEOUT_MS = 45_000;
const NETWORK_IDLE_MS = 750;
// Fixed representative Three.js calibration workload: same WebGLRenderer
// profile, viewport, and scene-graph scheduling shape as the audited Home
// scene at low quality. The workload constants are frozen in
// src/perf/calibration-workload.mjs and asserted by unit tests and on every
// rendered calibration frame.
const THREE_CALIBRATION = Object.freeze({
  page: CALIBRATION_PAGE_PATH,
  width: CALIBRATION_VIEWPORT.width,
  height: CALIBRATION_VIEWPORT.height,
  pixelRatio: CALIBRATION_VIEWPORT.pixelRatio,
  warmupSamples: 120,
  samplesPerTrial: 120,
  trials: MEASUREMENT_TRIALS,
  drawCallsPerFrame: CALIBRATION_WORKLOAD.drawCallsPerFrame,
  trianglesPerFrame: CALIBRATION_WORKLOAD.trianglesPerFrame,
  materialFamilies: CALIBRATION_WORKLOAD.materialFamilies,
  timeoutMs: 30_000,
});
const LEAK_CYCLES = 8;
const LEAK_MINIMUM_SAMPLES = LEAK_CYCLES + 1;
const PERF_LIMITS = {
  "home:living-room": {
    samples: MAIN_SCENE_SAMPLES,
    timing: {
      swiftshader: {
        minimumCalibrationRatio: 0.75,
        minimumP95CalibrationRatio: (1_000 / 60) / 28,
        absoluteMinFps: 30,
        referenceAbsoluteLimits: { minFps: 45, maxP95Ms: 28 },
      },
      hardware: { minFps: 50, maxP95Ms: 24 },
    },
    maxDrawCallsP95: 125,
    maxTrianglesP95: 20_000,
  },
  "city:destination-board": {
    samples: MAIN_SCENE_SAMPLES,
    timing: {
      swiftshader: {
        minimumCalibrationRatio: 7 / 15,
        minimumP95CalibrationRatio: (1_000 / 60) / 42,
        absoluteMinFps: 20,
        referenceAbsoluteLimits: { minFps: 28, maxP95Ms: 42 },
      },
      hardware: { minFps: 45, maxP95Ms: 28 },
    },
    maxDrawCallsP95: 48,
    maxTrianglesP95: 16_000,
  },
  "city:driving": {
    samples: MAIN_SCENE_SAMPLES,
    timing: {
      swiftshader: {
        minimumCalibrationRatio: 0.4,
        minimumP95CalibrationRatio: (1_000 / 60) / 50,
        absoluteMinFps: 18,
        referenceAbsoluteLimits: { minFps: 24, maxP95Ms: 50 },
      },
      hardware: { minFps: 42, maxP95Ms: 30 },
    },
    maxDrawCallsP95: 64,
    maxTrianglesP95: 22_000,
  },
  "shop:fluff-salon:try-on": {
    samples: MAIN_SCENE_SAMPLES,
    timing: {
      swiftshader: {
        minimumCalibrationRatio: 0.4,
        minimumP95CalibrationRatio: (1_000 / 60) / 65,
        absoluteMinFps: 18,
        referenceAbsoluteLimits: { minFps: 24, maxP95Ms: 65 },
      },
      hardware: { minFps: 42, maxP95Ms: 30 },
    },
    maxDrawCallsP95: 100,
    maxTrianglesP95: 21_000,
  },
  "minigame:delivery-dash:express": {
    samples: MAIN_SCENE_SAMPLES,
    timing: {
      swiftshader: {
        minimumCalibrationRatio: 0.8,
        minimumP95CalibrationRatio: (1_000 / 60) / 25,
        absoluteMinFps: 30,
        referenceAbsoluteLimits: { minFps: 48, maxP95Ms: 25 },
      },
      hardware: { minFps: 52, maxP95Ms: 22 },
    },
    maxDrawCallsP95: 1,
    maxTrianglesP95: 1,
  },
  "minigame:pond-fishing:legend": {
    samples: MAIN_SCENE_SAMPLES,
    timing: {
      swiftshader: {
        minimumCalibrationRatio: 0.8,
        minimumP95CalibrationRatio: (1_000 / 60) / 25,
        absoluteMinFps: 30,
        referenceAbsoluteLimits: { minFps: 48, maxP95Ms: 25 },
      },
      hardware: { minFps: 52, maxP95Ms: 22 },
    },
    maxDrawCallsP95: 1,
    maxTrianglesP95: 1,
  },
  "minigame:rhythm-hop:hard": {
    samples: MAIN_SCENE_SAMPLES,
    timing: {
      swiftshader: {
        minimumCalibrationRatio: 0.8,
        minimumP95CalibrationRatio: (1_000 / 60) / 25,
        absoluteMinFps: 30,
        referenceAbsoluteLimits: { minFps: 48, maxP95Ms: 25 },
      },
      hardware: { minFps: 52, maxP95Ms: 22 },
    },
    maxDrawCallsP95: 1,
    maxTrianglesP95: 1,
  },
  "minigame:cake-atelier:orders": {
    samples: MAIN_SCENE_SAMPLES,
    timing: {
      swiftshader: {
        minimumCalibrationRatio: 0.8,
        minimumP95CalibrationRatio: (1_000 / 60) / 25,
        absoluteMinFps: 30,
        referenceAbsoluteLimits: { minFps: 48, maxP95Ms: 25 },
      },
      hardware: { minFps: 52, maxP95Ms: 22 },
    },
    maxDrawCallsP95: 1,
    maxTrianglesP95: 1,
  },
  // Cloud Bounce renders through the shared Stage3D lease inside the app
  // loop; the main-renderer probe sees its frame timing but not its draw
  // calls, which are asserted separately in the module harness budget.
  "minigame:cloud-bounce:run": {
    samples: MAIN_SCENE_SAMPLES,
    timing: {
      swiftshader: {
        minimumCalibrationRatio: 0.5,
        minimumP95CalibrationRatio: (1_000 / 60) / 42,
        absoluteMinFps: 20,
        referenceAbsoluteLimits: { minFps: 30, maxP95Ms: 42 },
      },
      hardware: { minFps: 45, maxP95Ms: 28 },
    },
    maxDrawCallsP95: 1,
    maxTrianglesP95: 1,
  },
  "minigame:honey-drizzle:round": {
    samples: MAIN_SCENE_SAMPLES,
    timing: {
      swiftshader: {
        minimumCalibrationRatio: 0.8,
        minimumP95CalibrationRatio: (1_000 / 60) / 25,
        absoluteMinFps: 30,
        referenceAbsoluteLimits: { minFps: 48, maxP95Ms: 25 },
      },
      hardware: { minFps: 52, maxP95Ms: 22 },
    },
    maxDrawCallsP95: 1,
    maxTrianglesP95: 1,
  },
};
// Shopping Surf renders through its own Stage3D lease renderer, which the
// in-app probe (main renderer only) cannot see. The audit measures the live
// module in its harness with the real rAF loop and asserts the specialist
// budget: ≥30 FPS, p95 ≤42ms, ≤70 draw calls, and a leak-neutral lease.
const SURF_MODULE_BUDGET = Object.freeze({
  harnessPage: "/src/minigames/shopping-surf/harness.html",
  minSampledFrames: 60,
  minFps: 30,
  maxP95FrameMs: 42,
  maxDrawCalls: 70,
  sampleWindowMs: 6_000,
});
// Cloud Bounce is the same case: its pooled sky renders through a Stage3D
// lease that the in-app probe cannot see, so the audit measures the live
// module in its harness and asserts the specialist budget (≥30 FPS, p95
// ≤42ms, ≤70 draw calls) plus a leak-neutral lease release.
const CLOUD_MODULE_BUDGET = Object.freeze({
  harnessPage: "/src/minigames/cloud-bounce/harness.html",
  modulePath: "/src/minigames/cloud-bounce/index.ts",
  minSampledFrames: 60,
  minFps: 30,
  maxP95FrameMs: 42,
  maxDrawCalls: 70,
  sampleWindowMs: 6_000,
});
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
  const network = {
    inFlight: new Set(),
    lastActivityAt: performance.now(),
  };
  page.on("request", (request) => {
    if (request.resourceType() === "websocket") return;
    network.inFlight.add(request);
    network.lastActivityAt = performance.now();
  });
  const finishRequest = (request) => {
    if (!network.inFlight.delete(request)) return;
    network.lastActivityAt = performance.now();
  };
  page.on("requestfinished", finishRequest);
  page.on("requestfailed", finishRequest);
  return network;
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

function networkIsIdle(network) {
  return network.inFlight.size === 0
    && performance.now() - network.lastActivityAt >= NETWORK_IDLE_MS;
}

async function waitForNetworkIdle(page, network, label) {
  await page.waitForLoadState("networkidle");
  const deadline = performance.now() + 20_000;
  while (!networkIsIdle(network)) {
    invariant(
      performance.now() < deadline,
      `${label}: network did not become idle (${network.inFlight.size} requests remain)`,
    );
    await page.waitForTimeout(100);
  }
}

async function readWarmupObservation(page, network) {
  const observation = await page.evaluate(() => {
    const snapshot = window.__gooby.perf.snapshot();
    const runtime = window.__gooby.runtime();
    return {
      appReady: document.querySelector("#app")?.dataset.ready === "true",
      runtimeKey: JSON.stringify([
        runtime.sceneId,
        runtime.cityPhase,
        runtime.activeMinigame,
        runtime.minigameRoots,
      ]),
      quality: snapshot.quality.active,
      programs: snapshot.resources.current.programs,
      samples: snapshot.frame.samples,
      fps: snapshot.frame.fps,
      p95Ms: snapshot.frame.p95Ms,
    };
  });
  return {
    ...observation,
    networkIdle: networkIsIdle(network),
  };
}

async function warmScene(page, network, label, minimumSamples, expectedQuality = "low") {
  const startedAt = performance.now();
  await waitForNetworkIdle(page, network, label);
  await page.evaluate(() => window.__gooby.perf.controls.resetRollingMetrics());
  await page.waitForFunction(
    (minimum) => window.__gooby.perf.snapshot().frame.samples >= minimum,
    minimumSamples,
    { timeout: WARMUP_TIMEOUT_MS },
  );
  let state = createWarmupState();
  const observations = [];
  const deadline = performance.now() + WARMUP_TIMEOUT_MS;
  while (!state.ready) {
    await waitForNetworkIdle(page, network, label);
    const observation = await readWarmupObservation(page, network);
    observations.push(observation);
    state = advanceWarmupState(state, observation, { minimumSamples, expectedQuality });
    if (state.ready) break;
    invariant(
      performance.now() < deadline,
      `${label}: renderer/JIT warmup did not stabilize: ${state.reason}`,
    );
    await page.waitForTimeout(WARMUP_OBSERVATION_MS);
  }
  const final = observations.at(-1);
  console.log(
    `${label}: warm after ${((performance.now() - startedAt) / 1_000).toFixed(1)}s, `
      + `${final.samples} frames, ${final.programs} programs, `
      + `${final.fps.toFixed(1)} FPS`,
  );
  return {
    label,
    durationMs: performance.now() - startedAt,
    observations,
    stableObservations: state.stableObservations,
  };
}

async function runThreeCalibration(page, attempt) {
  const injectSchedulerJitter = calibrationJitterMode === "both-cohorts"
    || (calibrationJitterMode === "first-cohort" && attempt === 1);
  // 40ms exceeds two 60Hz vsync intervals, so the burst forces missed frames
  // even when the calibration renders with headroom; 20ms could be absorbed
  // by the compositor without moving requestAnimationFrame timestamps.
  const schedulerJitter = injectSchedulerJitter
    ? {
        trialIndex: 1,
        frameIndexes: [8, 24, 40, 56, 72, 88, 104],
        blockMs: 40,
      }
    : null;
  const runConfig = {
    warmupSamples: THREE_CALIBRATION.warmupSamples,
    samplesPerTrial: THREE_CALIBRATION.samplesPerTrial,
    trials: THREE_CALIBRATION.trials,
    timeoutMs: THREE_CALIBRATION.timeoutMs,
    schedulerJitter,
  };
  // A fresh navigation per cohort guarantees an independent WebGL context,
  // renderer, warmup, and trials; it also warms the Vite module graph and
  // pre-bundled three dependency before the app itself loads.
  await page.goto(
    `${baseUrl}${THREE_CALIBRATION.page}?cohort=${attempt}`,
    { waitUntil: "networkidle" },
  );
  await page.waitForFunction(() => window.__goobyPerfCalibration?.ready === true);
  const run = await page.evaluate(
    (config) => window.__goobyPerfCalibration.run(config),
    runConfig,
  );
  invariant(
    run.renderedWorkload.drawCalls === THREE_CALIBRATION.drawCallsPerFrame,
    `Calibration cohort ${attempt} rendered ${run.renderedWorkload.drawCalls} draw calls, `
      + `expected ${THREE_CALIBRATION.drawCallsPerFrame}`,
  );
  invariant(
    run.renderedWorkload.triangles === THREE_CALIBRATION.trianglesPerFrame,
    `Calibration cohort ${attempt} rendered ${run.renderedWorkload.triangles} triangles, `
      + `expected ${THREE_CALIBRATION.trianglesPerFrame}`,
  );
  invariant(
    run.renderedWorkload.programs === THREE_CALIBRATION.materialFamilies,
    `Calibration cohort ${attempt} compiled ${run.renderedWorkload.programs} programs, `
      + `expected ${THREE_CALIBRATION.materialFamilies}`,
  );
  invariant(
    run.drawingBuffer.width === THREE_CALIBRATION.width
      && run.drawingBuffer.height === THREE_CALIBRATION.height,
    `Calibration cohort ${attempt} drawing buffer is `
      + `${run.drawingBuffer.width}x${run.drawingBuffer.height}, expected `
      + `${THREE_CALIBRATION.width}x${THREE_CALIBRATION.height}`,
  );
  return {
    attempt,
    workload: THREE_CALIBRATION,
    schedulerJitter,
    ...run,
  };
}

async function measureSurfModuleBudget(page) {
  const budget = SURF_MODULE_BUDGET;
  await page.goto(`${baseUrl}${budget.harnessPage}`, { waitUntil: "networkidle" });
  // Warm the module graph so a cold Vite dep-optimization reload cannot
  // destroy the evaluation context mid-install.
  await page
    .evaluate(async () => {
      await import("/src/minigames/shopping-surf/index.ts");
    })
    .catch(() => undefined);
  await page.goto(`${baseUrl}${budget.harnessPage}`, { waitUntil: "networkidle" });
  await page.evaluate(async () => {
    document.body.replaceChildren();
    Object.assign(document.body.style, {
      margin: "0",
      width: "100vw",
      height: "100vh",
      overflow: "hidden",
    });
    const mount = document.createElement("main");
    Object.assign(mount.style, { width: "100%", height: "100%", position: "relative" });
    document.body.append(mount);

    const gameModule = await import("/src/minigames/shopping-surf/index.ts");
    const { SeededRng } = await import("/src/core/contracts/rng.ts");
    const { createMinigameLifecycle } = await import("/src/core/contracts/minigame.ts");

    // Warm the shared Stage3D renderer once: three.js allocates a single
    // renderer-lifetime internal texture on the first lit-material render.
    // Folding it into the pre-lease baseline keeps the lease deltas exact.
    {
      const stage = await import("/src/render/stage3d/index.ts");
      const three = await import("/@id/three");
      const warm = stage.acquireStage3d(mount, { clock: { now: () => 0 } });
      warm.scene.add(new three.AmbientLight(0xffffff, 1));
      warm.scene.add(
        new three.Mesh(
          new three.BoxGeometry(1, 1, 1),
          new three.MeshStandardMaterial({ color: 0xffffff }),
        ),
      );
      warm.renderOnce();
      warm.release();
    }

    const game = gameModule.createMinigame();
    const settlements = new Map();
    let now = 1_000_000;
    let previousFrame = performance.now();
    let frame = 0;
    let loopRunning = true;
    const clock = { now: () => now };
    const lifecycle = createMinigameLifecycle(
      game.id,
      clock,
      {
        getBestScore: () => 0,
        getSettlement: (runId) => settlements.get(runId) ?? null,
        settle: (receipt) => {
          const previous = settlements.get(receipt.runId);
          if (previous) return previous;
          settlements.set(receipt.runId, receipt);
          return receipt;
        },
      },
      { emit: () => undefined },
    );

    game.mount({
      clock,
      rng: new SeededRng(4_519),
      mount,
      lifecycle,
      audio: { emit: () => undefined },
      haptics: { impact: () => undefined },
      bestScore: 0,
      reducedMotion: false,
      finish: () => undefined,
    });
    game.start();

    const loop = (frameAt) => {
      if (!loopRunning) return;
      const delta = Math.min(0.1, Math.max(0, (frameAt - previousFrame) / 1_000));
      previousFrame = frameAt;
      now += delta * 1_000;
      game.update(delta);
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    window.__surfPerfAudit = {
      game,
      dispose() {
        loopRunning = false;
        cancelAnimationFrame(frame);
        game.dispose();
      },
    };
  });

  const next = page.getByRole("button", { name: "Next" });
  while (await next.isVisible()) await next.click();
  await page.getByRole("button", { name: "Start round" }).click();
  await page.getByRole("button", { name: "Skip warm-up" }).click();
  await page.waitForFunction(
    () => Reflect.get(window.__surfPerfAudit.game, "phase") === "running",
    undefined,
    { timeout: 15_000 },
  );

  // Keep the ride alive regardless of obstacles while sampling.
  const keepAlive = setInterval(() => {
    void page.evaluate(() => {
      const state = Reflect.get(window.__surfPerfAudit.game, "state");
      if (!state) return;
      state.bumps = 0;
      state.shields = 3;
      if (state.phase === "ending") {
        state.phase = "running";
        state.endReason = null;
        state.endTimer = 0;
      }
      state.finishZ = 1_000_000;
    }).catch(() => undefined);
  }, 500);
  await page.waitForTimeout(budget.sampleWindowMs);
  clearInterval(keepAlive);

  const outcome = await page.evaluate(() => {
    const scene = Reflect.get(window.__surfPerfAudit.game, "scene");
    const perf = window.__surfPerfAudit.game.perfSnapshot();
    const liveDelta = scene?.resourceDelta() ?? null;
    window.__surfPerfAudit.dispose();
    return {
      perf,
      hadScene: scene !== null,
      liveDelta,
      releasedDelta: scene?.resourceDelta() ?? null,
    };
  });
  invariant(outcome.hadScene, "Surf module budget: the Stage3D scene never mounted");
  invariant(
    outcome.perf.frames > budget.minSampledFrames,
    `Surf module budget: only ${outcome.perf.frames} frames were sampled`
      + ` (minimum ${budget.minSampledFrames})`,
  );
  invariant(
    outcome.perf.fps >= budget.minFps,
    `Surf module budget: ${outcome.perf.fps.toFixed(1)} FPS is below ${budget.minFps}`,
  );
  invariant(
    outcome.perf.p95FrameMs <= budget.maxP95FrameMs,
    `Surf module budget: ${outcome.perf.p95FrameMs.toFixed(1)}ms p95 exceeds ${budget.maxP95FrameMs}ms`,
  );
  invariant(
    outcome.perf.drawCalls > 0 && outcome.perf.drawCalls <= budget.maxDrawCalls,
    `Surf module budget: ${outcome.perf.drawCalls} draw calls outside (0, ${budget.maxDrawCalls}]`,
  );
  invariant(
    outcome.liveDelta !== null && outcome.liveDelta.geometries > 0,
    "Surf module budget: the live scene never allocated tracked resources",
  );
  invariant(
    outcome.releasedDelta !== null
      && outcome.releasedDelta.geometries === 0
      && outcome.releasedDelta.textures === 0
      && outcome.releasedDelta.programs === 0,
    `Surf module budget: lease release left ${JSON.stringify(outcome.releasedDelta)}`,
  );
  console.log(
    `Surf module budget: ${outcome.perf.fps.toFixed(1)} FPS, `
      + `${outcome.perf.p95FrameMs.toFixed(1)}ms p95, `
      + `${outcome.perf.drawCalls} draws, ${outcome.perf.triangles} triangles, `
      + `${outcome.perf.frames} frames; lease released leak-neutral`,
  );
  return { budget, ...outcome };
}

async function measureCloudModuleBudget(page) {
  const budget = CLOUD_MODULE_BUDGET;
  await page.goto(`${baseUrl}${budget.harnessPage}`, { waitUntil: "networkidle" });
  // Warm the module graph so a cold Vite dep-optimization reload cannot
  // destroy the evaluation context mid-install.
  await page
    .evaluate(async (modulePath) => {
      await import(modulePath);
    }, budget.modulePath)
    .catch(() => undefined);
  await page.goto(`${baseUrl}${budget.harnessPage}`, { waitUntil: "networkidle" });
  await page.evaluate(async (modulePath) => {
    document.body.replaceChildren();
    Object.assign(document.body.style, {
      margin: "0",
      width: "100vw",
      height: "100vh",
      overflow: "hidden",
    });
    const mount = document.createElement("main");
    Object.assign(mount.style, { width: "100%", height: "100%", position: "relative" });
    document.body.append(mount);

    const gameModule = await import(modulePath);
    const { SeededRng } = await import("/src/core/contracts/rng.ts");
    const { createMinigameLifecycle } = await import("/src/core/contracts/minigame.ts");

    // Warm the shared Stage3D renderer once: three.js allocates a single
    // renderer-lifetime internal texture on the first lit-material render.
    // Folding it into the pre-lease baseline keeps the lease deltas exact.
    {
      const stage = await import("/src/render/stage3d/index.ts");
      const three = await import("/@id/three");
      const warm = stage.acquireStage3d(mount, { clock: { now: () => 0 } });
      warm.scene.add(new three.AmbientLight(0xffffff, 1));
      warm.scene.add(
        new three.Mesh(
          new three.BoxGeometry(1, 1, 1),
          new three.MeshStandardMaterial({ color: 0xffffff }),
        ),
      );
      warm.renderOnce();
      warm.release();
    }

    const game = gameModule.createMinigame();
    const settlements = new Map();
    let now = 1_000_000;
    let previousFrame = performance.now();
    let frame = 0;
    let loopRunning = true;
    const clock = { now: () => now };
    const lifecycle = createMinigameLifecycle(
      game.id,
      clock,
      {
        getBestScore: () => 0,
        getSettlement: (runId) => settlements.get(runId) ?? null,
        settle: (receipt) => {
          const previous = settlements.get(receipt.runId);
          if (previous) return previous;
          settlements.set(receipt.runId, receipt);
          return receipt;
        },
      },
      { emit: () => undefined },
    );

    game.mount({
      clock,
      rng: new SeededRng(4_520),
      mount,
      lifecycle,
      audio: { emit: () => undefined },
      haptics: { impact: () => undefined },
      bestScore: 0,
      reducedMotion: false,
      finish: () => undefined,
    });
    game.start();

    const loop = (frameAt) => {
      if (!loopRunning) return;
      const delta = Math.min(0.1, Math.max(0, (frameAt - previousFrame) / 1_000));
      previousFrame = frameAt;
      now += delta * 1_000;
      game.update(delta);
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    window.__cloudPerfAudit = {
      game,
      dispose() {
        loopRunning = false;
        cancelAnimationFrame(frame);
        game.dispose();
      },
    };
  }, budget.modulePath);

  const next = page.getByRole("button", { name: "Next" });
  while (await next.isVisible()) await next.click();
  await page.getByRole("button", { name: "Start round" }).click();
  await page.waitForFunction(
    () => Reflect.get(window.__cloudPerfAudit.game, "phase") === "running",
    undefined,
    { timeout: 15_000 },
  );

  // Keep the climb alive while sampling: periodic updrafts prevent the fall.
  const keepAlive = setInterval(() => {
    void page.evaluate(() => {
      const state = Reflect.get(window.__cloudPerfAudit.game, "state");
      if (!state || state.phase !== "running") return;
      state.vy = 3;
    }).catch(() => undefined);
  }, 400);
  await page.waitForTimeout(budget.sampleWindowMs);
  clearInterval(keepAlive);

  const outcome = await page.evaluate(() => {
    const scene = Reflect.get(window.__cloudPerfAudit.game, "scene");
    const perf = window.__cloudPerfAudit.game.perfSnapshot();
    const liveDelta = scene?.resourceDelta() ?? null;
    window.__cloudPerfAudit.dispose();
    return {
      perf,
      hadScene: scene !== null,
      liveDelta,
      releasedDelta: scene?.resourceDelta() ?? null,
    };
  });
  invariant(outcome.hadScene, "Cloud module budget: the Stage3D scene never mounted");
  invariant(
    outcome.perf.frames > budget.minSampledFrames,
    `Cloud module budget: only ${outcome.perf.frames} frames were sampled`
      + ` (minimum ${budget.minSampledFrames})`,
  );
  invariant(
    outcome.perf.fps >= budget.minFps,
    `Cloud module budget: ${outcome.perf.fps.toFixed(1)} FPS is below ${budget.minFps}`,
  );
  invariant(
    outcome.perf.p95FrameMs <= budget.maxP95FrameMs,
    `Cloud module budget: ${outcome.perf.p95FrameMs.toFixed(1)}ms p95 exceeds ${budget.maxP95FrameMs}ms`,
  );
  invariant(
    outcome.perf.drawCalls > 0 && outcome.perf.drawCalls <= budget.maxDrawCalls,
    `Cloud module budget: ${outcome.perf.drawCalls} draw calls outside (0, ${budget.maxDrawCalls}]`,
  );
  invariant(
    outcome.liveDelta !== null && outcome.liveDelta.geometries > 0,
    "Cloud module budget: the live scene never allocated tracked resources",
  );
  invariant(
    outcome.releasedDelta !== null
      && outcome.releasedDelta.geometries === 0
      && outcome.releasedDelta.textures === 0
      && outcome.releasedDelta.programs === 0,
    `Cloud module budget: lease release left ${JSON.stringify(outcome.releasedDelta)}`,
  );
  console.log(
    `Cloud module budget: ${outcome.perf.fps.toFixed(1)} FPS, `
      + `${outcome.perf.p95FrameMs.toFixed(1)}ms p95, `
      + `${outcome.perf.drawCalls} draws, ${outcome.perf.triangles} triangles, `
      + `${outcome.perf.frames} frames; lease released leak-neutral`,
  );
  return { budget, ...outcome };
}

async function collectSnapshot(page, label, minimumSamples) {
  await page.evaluate(() => window.__gooby.perf.controls.resetRollingMetrics());
  await page.waitForFunction(
    (minimum) => window.__gooby.perf.snapshot().frame.samples >= minimum,
    minimumSamples,
    { timeout: 30_000 },
  );
  const snapshot = await page.evaluate(() => window.__gooby.perf.snapshot());
  invariant(
    snapshot.frame.samples >= minimumSamples,
    `${label}: only ${snapshot.frame.samples}/${minimumSamples} frame samples were recorded`,
  );
  return snapshot;
}

function assertSceneLimits(label, snapshot, rendererClass, calibration) {
  const limits = PERF_LIMITS[label];
  invariant(limits, `${label}: no performance limit is documented`);
  const timing = limits.timing[rendererClass];
  if (rendererClass === "swiftshader") {
    assertNormalizedTimingLimits(
      `${label} (${rendererClass})`,
      snapshot,
      timing,
      calibration,
    );
  } else {
    assertTimingLimits(`${label} (${rendererClass})`, snapshot, timing);
  }
  invariant(
    snapshot.render.drawCallsP95 <= limits.maxDrawCallsP95,
    `${label}: ${snapshot.render.drawCallsP95} draw calls p95 exceeds ${limits.maxDrawCallsP95}`,
  );
  invariant(
    snapshot.render.trianglesP95 <= limits.maxTrianglesP95,
    `${label}: ${snapshot.render.trianglesP95} triangles p95 exceeds ${limits.maxTrianglesP95}`,
  );
}

async function collectSceneMeasurement(page, network, label, warmups) {
  const limits = PERF_LIMITS[label];
  invariant(limits, `${label}: missing scene limits`);
  warmups.push(await warmScene(page, network, label, limits.samples));
  const trials = [];
  for (let index = 0; index < MEASUREMENT_TRIALS; index += 1) {
    const snapshot = await collectSnapshot(page, `${label} trial ${index + 1}`, limits.samples);
    trials.push(snapshot);
    console.log(
      `${label} trial ${index + 1}/${MEASUREMENT_TRIALS}: `
        + `${snapshot.frame.fps.toFixed(1)} FPS, `
        + `${snapshot.frame.p95Ms.toFixed(1)}ms p95, `
        + `${snapshot.frame.samples} samples`,
    );
  }
  const summary = summarizePerformanceTrials(trials, limits.samples);
  const snapshot = summary.snapshot;
  console.log(
    `${label} median: ${snapshot.frame.fps.toFixed(1)} FPS, `
      + `${snapshot.frame.p95Ms.toFixed(1)}ms p95, `
      + `${snapshot.render.drawCallsP95} draws, `
      + `${snapshot.render.trianglesP95} triangles, `
      + `${snapshot.frame.samples} samples/trial`,
  );
  return { limits, snapshot, trials, summary };
}

async function measureScene(
  page,
  network,
  label,
  rendererClass,
  calibration,
  measurements,
  warmups,
) {
  const measurement = await collectSceneMeasurement(page, network, label, warmups);
  const { limits, snapshot, trials, summary } = measurement;
  const result = { label, rendererClass, limits, snapshot, trials, summary };
  measurements.push(result);
  assertSceneLimits(label, snapshot, rendererClass, calibration);
  return result;
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

/**
 * Reads the frozen registry manifest for a game from the live app module
 * graph, so tutorial navigation follows the manifest instead of fixed clicks.
 */
async function readManifestSummary(page, game) {
  return await page.evaluate(async (id) => {
    const { MINIGAME_MANIFESTS } = await import("/src/minigames/registry.ts");
    const manifest = MINIGAME_MANIFESTS.get(id);
    if (!manifest) throw new Error(`No manifest is registered for ${id}`);
    return { tutorialSteps: manifest.tutorial.length, stage3d: manifest.stage3d };
  }, game);
}

/**
 * Clicks through a shared Arcade Kit tutorial overlay with real input. The
 * overlay renders one page per manifest tutorial step and relabels the
 * primary button from "Next" to "Start round" on the final page.
 */
async function completeArcadeTutorial(root, tutorialSteps) {
  const next = root.getByRole("button", { name: "Next" });
  for (let step = 1; step < tutorialSteps; step += 1) await next.click();
  await root.getByRole("button", { name: "Start round" }).click();
}

async function prepareMinigame(page, game) {
  const root = page.locator(`[data-minigame="${game}"]`);
  const { tutorialSteps } = await readManifestSummary(page, game);
  if (game === "delivery-dash") {
    // One real click per manifest tutorial page: the final page's primary
    // button hands the flow to the shift picker.
    for (let index = 0; index < tutorialSteps; index += 1) {
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
  } else if (game === "cake-atelier") {
    await completeArcadeTutorial(root, tutorialSteps);
    await root.locator('[data-ca-action="mode-orders"]').click();
    // The Arcade Kit countdown runs about three real seconds before the
    // flavor controls (the steady scored-orders workload) appear.
    await root.locator('[data-ca-action^="flavor:"]').first()
      .waitFor({ state: "visible", timeout: 20_000 });
  } else if (game === "shopping-surf") {
    await completeArcadeTutorial(root, tutorialSteps);
    await root.getByRole("button", { name: "Skip warm-up" }).click();
    await root.locator(".ss-countdown").waitFor({ state: "visible", timeout: 15_000 });
  } else if (game === "cloud-bounce") {
    await completeArcadeTutorial(root, tutorialSteps);
    // The Arcade Kit countdown runs about three real seconds before the
    // auto-bouncing run (the steady Stage3D workload) begins.
    await page.locator(`[data-minigame="${game}"][data-cb-phase="running"]`)
      .waitFor({ state: "visible", timeout: 20_000 });
  } else if (game === "honey-drizzle") {
    await completeArcadeTutorial(root, tutorialSteps);
    await root.locator('[data-hd-action="start"]').click();
    const countdown = root.locator('[data-hd="countdown"]');
    await countdown.waitFor({ state: "visible", timeout: 15_000 });
    await countdown.waitFor({ state: "hidden", timeout: 20_000 });
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

const nominal60FpsCalibration = { fps: 60, p95Ms: 1_000 / 60 };
const sustainedSlowProbeChecks = {
  swiftshader: normalizedSustainedSlowProbeIsRejected(
    PERF_LIMITS["home:living-room"].timing.swiftshader,
    nominal60FpsCalibration,
    MAIN_SCENE_SAMPLES,
    30,
  ),
  hardware: sustainedSlowProbeIsRejected(
    PERF_LIMITS["home:living-room"].timing.hardware,
    MAIN_SCENE_SAMPLES,
    30,
  ),
};

const externalRequests = [];
const pageErrors = [];
const measurements = [];
const warmups = [];
const tierMeasurements = {};
const qualityApplication = {};
const leakSamples = [];
let identityProbe = null;
let surfModuleBudget = null;
let cloudModuleBudget = null;
let calibration = {
  status: "not-started",
  workload: THREE_CALIBRATION,
};
let rendererClass = null;
let finalResourceSnapshot = null;
let leakAnalysis = null;
let governorResult = null;
let governorSnapshot = null;
let browser = null;
let context = null;
let demoContext = null;
try {
  await runWithDiagnosticReport(async () => {
    invariant(
      Object.values(sustainedSlowProbeChecks).every(Boolean),
      "Three-trial aggregation accepted a synthetic sustained 30 FPS home probe",
    );
    console.log("Methodology self-check: sustained 30 FPS home probe rejected");

    identityProbe = await probeServerIdentity(baseUrl, nonce);
    invariant(identityProbe.ready, "Performance server was unreachable before browser launch");
    invariant(
      identityProbe.identity.pid === expectedServerPid,
      `Performance server PID changed from ${expectedServerPid} to ${identityProbe.identity.pid}`,
    );

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
  const network = watchPage(page, pageErrors, externalRequests);
  const cdp = await context.newCDPSession(page);
  await cdp.send("Performance.enable");
  if (cpuThrottleRate > 1) {
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpuThrottleRate });
  }

  calibration = {
    status: "running",
    workload: THREE_CALIBRATION,
    attempts: [],
  };
  const calibrationRun = await runCalibrationCohorts(
    (attempt) => runThreeCalibration(page, attempt),
    {
      minimumSamples: THREE_CALIBRATION.samplesPerTrial,
      expectedTrials: THREE_CALIBRATION.trials,
    },
  );
  calibration = {
    status: calibrationRun.status,
    workload: THREE_CALIBRATION,
    schedulerJitterMode: calibrationJitterMode,
    attempts: calibrationRun.attempts,
    selectedAttempt: calibrationRun.selectedAttempt,
    reason: calibrationRun.reason,
    summary: calibrationRun.summary,
  };
  for (const attempt of calibrationRun.attempts) {
    console.log(
      `Three.js calibration attempt ${attempt.attempt}: ${attempt.status}, `
        + `${attempt.summary.fps.toFixed(1)} FPS, `
        + `${attempt.summary.p95Ms.toFixed(1)}ms p95 `
        + `(${attempt.reason})`,
    );
  }
  invariant(calibrationRun.status === "passed", calibrationRun.reason);
  const calibrationSummary = calibrationRun.summary;
  console.log(
    `Three.js calibration selected attempt ${calibrationRun.selectedAttempt}: `
      + `${calibrationSummary.fps.toFixed(1)} FPS, `
      + `${calibrationSummary.p95Ms.toFixed(1)}ms p95, `
      + `${THREE_CALIBRATION.drawCallsPerFrame} draws / `
      + `${THREE_CALIBRATION.trianglesPerFrame} triangles / `
      + `${THREE_CALIBRATION.materialFamilies} program families, `
      + `${THREE_CALIBRATION.trials}x${THREE_CALIBRATION.samplesPerTrial} samples`,
  );

  surfModuleBudget = await measureSurfModuleBudget(page);
  cloudModuleBudget = await measureCloudModuleBudget(page);

  await page.goto(`${baseUrl}/?perf=1`, { waitUntil: "networkidle" });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });
  await waitForApp(page);
  await completeOnboarding(page);
  await page.evaluate(() => window.__gooby.perf.controls.setQuality("low"));

  const homeMeasurement = await collectSceneMeasurement(
    page,
    network,
    "home:living-room",
    warmups,
  );
  const homeSnapshot = homeMeasurement.snapshot;
  rendererClass = /swiftshader/iu.test(homeSnapshot.quality.profile.gpu)
    ? "swiftshader"
    : "hardware";
  measurements.push({
    label: "home:living-room",
    rendererClass,
    ...homeMeasurement,
  });
  assertSceneLimits(
    "home:living-room",
    homeSnapshot,
    rendererClass,
    calibrationSummary,
  );

  await page.evaluate(() => window.__gooby.test?.grantProgressionXp(3_600));
  await page.waitForFunction(() => (window.__gooby.snapshot()?.economy.level ?? 0) >= 7);
  await openPanel(page, "places");
  await page.getByTestId("open-city-board").click();
  await page.waitForFunction(() => window.__gooby.runtime().sceneId === "city:drive");
  await measureScene(
    page,
    network,
    "city:destination-board",
    rendererClass,
    calibrationSummary,
    measurements,
    warmups,
  );

  for (const tier of ["low", "mid", "high"]) {
    await page.evaluate((value) => window.__gooby.perf.controls.setQuality(value), tier);
    warmups.push(await warmScene(
      page,
      network,
      `city:quality:${tier}`,
      QUALITY_TIER_SAMPLES,
      tier,
    ));
    const snapshot = await collectSnapshot(page, `city:quality:${tier}`, QUALITY_TIER_SAMPLES);
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
  await measureScene(
    page,
    network,
    "city:driving",
    rendererClass,
    calibrationSummary,
    measurements,
    warmups,
  );
  await page.evaluate(() => window.__gooby.test?.completeCityLeg());
  await page.getByTestId("enter-shop").click();
  await page.waitForFunction(() => window.__gooby.runtime().sceneId === "shop:fluff-salon");
  await page.locator('[data-shop-item="sunny-bucket-hat"]').click();
  await page.locator('[data-shop-action="buy"]').click();
  await page.waitForFunction(() =>
    window.__gooby.snapshot()?.inventory["sunny-bucket-hat"] === 1);
  await page.locator('[data-shop-action="try"]').click();
  await measureScene(
    page,
    network,
    "shop:fluff-salon:try-on",
    rendererClass,
    calibrationSummary,
    measurements,
    warmups,
  );

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
    ["cake-atelier", "minigame:cake-atelier:orders"],
    ["cloud-bounce", "minigame:cloud-bounce:run"],
    ["honey-drizzle", "minigame:honey-drizzle:round"],
  ];
  for (const [game, label] of measuredGames) {
    await startMinigame(page, game);
    await prepareMinigame(page, game);
    await measureScene(
      page,
      network,
      label,
      rendererClass,
      calibrationSummary,
      measurements,
      warmups,
    );
    await exitMinigame(page);
  }
  // Warm bubble and surf once before the leak baseline: surf's first mount
  // creates the manager-cached Stage3D renderer, a deliberate one-time
  // allocation that must fold into the baseline, not the leak trend.
  // Cloud Bounce and Honey Drizzle were already warmed by their scene
  // measurements, so their one-time program/style allocations are folded too.
  for (const game of ["bubble-bath-blast", "shopping-surf"]) {
    await startMinigame(page, game);
    await prepareMinigame(page, game);
    await exitMinigame(page);
  }

  for (const zone of ["kitchen", "bathroom", "bedroom", "garden"]) {
    await visitHomeZone(page, zone);
    await goHome(page);
  }
  await toggleCosmetic(page);

  await forceGarbageCollection(cdp);
  await page.waitForTimeout(1_100);
  await page.evaluate(() => window.__gooby.perf.controls.markResourceBaseline());
  leakSamples.push(await leakCheckpoint(page, cdp, 0));
  const cycleZones = ["garden", "kitchen", "bathroom", "bedroom"];
  // Mixed DOM-canvas and Stage3D-lease games interleave through the same
  // home transitions, so the leak trend covers 2D/3D lease hand-offs. With
  // eight cycles every game below mounts and releases exactly once.
  const cycleGames = [
    "delivery-dash",
    "shopping-surf",
    "pond-fishing",
    "cloud-bounce",
    "cake-atelier",
    "rhythm-hop",
    "honey-drizzle",
    "bubble-bath-blast",
  ];
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

  finalResourceSnapshot = await page.evaluate(() => window.__gooby.perf.snapshot());
  invariant(
    finalResourceSnapshot.resources.completedTransitions >= 30,
    `Expected at least 30 post-baseline transitions; received ${finalResourceSnapshot.resources.completedTransitions}`,
  );
  invariant(
    !finalResourceSnapshot.resources.likelyLeak,
    "Mixed scene/minigame/cosmetic cycles triggered the in-app resource leak heuristic",
  );
  leakAnalysis = analyzeLeakSeries(leakSamples, LEAK_LIMITS, LEAK_MINIMUM_SAMPLES);
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
  governorResult = await demoPage.evaluate(() =>
    window.__gooby.perf.controls.simulateGovernor("high", 35, 7_000));
  await demoPage.waitForTimeout(900);
  await demoPage.screenshot({
    path: artifactFile("gooby_perf_governor_downgrade", "png"),
    fullPage: true,
  });
  governorSnapshot = await demoPage.evaluate(() => window.__gooby.perf.snapshot());
  await demoContext.close();
  demoContext = null;
  if (demoVideo) {
    await copyFile(await demoVideo.path(), artifactFile("gooby_quality_governor_demo", "webm"));
  }

  invariant(governorResult === "mid", `Governor result was ${governorResult}, expected mid`);
  invariant(externalRequests.length === 0, `Blocked external requests: ${externalRequests.join(", ")}`);
  invariant(pageErrors.length === 0, `Browser page errors: ${pageErrors.join("; ")}`);
  }, async (failure) => {
    const serializedFailure = failure === null
      ? null
      : {
          name: failure instanceof Error ? failure.name : "UnknownFailure",
          message: failure instanceof Error ? failure.message : String(failure),
          stack: failure instanceof Error ? failure.stack : undefined,
        };
    const report = {
      generatedAt: new Date().toISOString(),
      status: failure === null ? "passed" : "failed",
      failure: serializedFailure,
      device: "Playwright iPhone 13 / Chromium",
      baseUrl,
      nonce,
      serverPid: expectedServerPid,
      identityProbe,
      rendererClass,
      cpuThrottleRate,
      sampleRequirements: {
        calibrationWarmup: THREE_CALIBRATION.warmupSamples,
        calibrationPerTrial: THREE_CALIBRATION.samplesPerTrial,
        calibrationTrials: THREE_CALIBRATION.trials,
        calibrationMaxCohorts: MAX_CALIBRATION_COHORTS,
        mainScenes: MAIN_SCENE_SAMPLES,
        qualityTiers: QUALITY_TIER_SAMPLES,
        leakCheckpoints: LEAK_MINIMUM_SAMPLES,
        measurementTrials: MEASUREMENT_TRIALS,
      },
      methodology: {
        networkIdleMs: NETWORK_IDLE_MS,
        warmupObservationMs: WARMUP_OBSERVATION_MS,
        warmupTimeoutMs: WARMUP_TIMEOUT_MS,
        timingAggregation: "median of three complete trials",
        workBudgetAggregation: "maximum across three complete trials",
        calibrationCohortPolicy:
          "gate on one stable warmup-plus-three-trial cohort; discard one unstable first cohort and retry exactly once without combining trials",
        calibrationVarianceLimits: {
          maxFpsRelativeRange: DEFAULT_CALIBRATION_OPTIONS.maxFpsRelativeRange,
          maxP95RelativeRange: DEFAULT_CALIBRATION_OPTIONS.maxP95RelativeRange,
        },
        swiftShaderTimingGate:
          "fixed scene/calibration FPS and calibration/scene p95 throughput ratios, plus absolute FPS floor",
        syntheticSustained30FpsRejected: sustainedSlowProbeChecks,
        warmups,
      },
      calibration,
      heaviestGameRationale: [
        "Delivery Dash repaints a full-resolution 2D city canvas and traffic every frame.",
        "Pond Fishing runs the largest animated Shadow DOM water/fish surface.",
        "Rhythm Hop animates timestamped hard-mode notes across three lanes.",
        "Cake Atelier repaints the full 2.5D bakery counter canvas every frame in scored orders mode.",
        "Shopping Surf renders the pooled three-lane market course through its Stage3D lease; its draw-call budget is asserted against the live module harness.",
        "Cloud Bounce is the expansion's Stage3D representative: pooled instanced sky puffs render through the shared lease in-app and its draw-call budget is asserted against the live module harness.",
        "Honey Drizzle is the expansion's 2D representative: it repaints the full toast-corridor canvas with the traced honey mask every frame.",
      ],
      performanceLimits: {
        ...PERF_LIMITS,
        "minigame:shopping-surf:module": SURF_MODULE_BUDGET,
        "minigame:cloud-bounce:module": CLOUD_MODULE_BUDGET,
      },
      surfModuleBudget,
      cloudModuleBudget,
      measurements,
      tierMeasurements,
      qualityApplication,
      leak: {
        cycles: LEAK_CYCLES,
        postBaselineTransitions:
          finalResourceSnapshot?.resources?.completedTransitions ?? null,
        limits: LEAK_LIMITS,
        samples: leakSamples,
        analysis: leakAnalysis,
        inAppResourceSnapshot: finalResourceSnapshot?.resources ?? null,
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
    console.log(`Performance report: ${reportPath} (${report.status})`);
    console.log(`Renderer: ${rendererClass ?? "unknown"}; measured scenes: ${measurements.length}`);
    console.log(`Warmup gates: ${warmups.length}; measurement trials: ${MEASUREMENT_TRIALS}`);
    console.log(
      `Leak cycles: ${LEAK_CYCLES}; post-baseline transitions: `
        + `${finalResourceSnapshot?.resources?.completedTransitions ?? "incomplete"}`,
    );
    console.log(`Governor: high -> ${governorResult ?? "incomplete"} after sustained 35 FPS`);
    console.log(`External requests: ${externalRequests.length}; page errors: ${pageErrors.length}`);
  });
} finally {
  await demoContext?.close().catch(() => undefined);
  await context?.close().catch(() => undefined);
  await browser?.close().catch(() => undefined);
}
