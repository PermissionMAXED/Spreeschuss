import { copyFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, devices } from "@playwright/test";
import {
  MEASUREMENT_TRIALS,
  advanceWarmupState,
  assertNormalizedTimingLimits,
  assertTimingLimits,
  createWarmupState,
  normalizedSustainedSlowProbeIsRejected,
  runWithDiagnosticReport,
  summarizePerformanceTrials,
  sustainedSlowProbeIsRejected,
  summarizeCalibrationTrials,
} from "../../src/perf/audit-methodology.mjs";
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
const cpuThrottleRate = Number.parseFloat(process.env.GOOBY_PERF_CPU_THROTTLE_RATE ?? "1");
if (!Number.isFinite(cpuThrottleRate) || cpuThrottleRate < 1 || cpuThrottleRate > 20) {
  throw new RangeError("GOOBY_PERF_CPU_THROTTLE_RATE must be between 1 and 20");
}
const baseHost = new URL(baseUrl).host;
await mkdir(artifacts, { recursive: true });

const MAIN_SCENE_SAMPLES = 120;
const QUALITY_TIER_SAMPLES = 60;
const WARMUP_OBSERVATION_MS = 1_100;
const WARMUP_TIMEOUT_MS = 45_000;
const NETWORK_IDLE_MS = 750;
const RAW_CALIBRATION = Object.freeze({
  width: 390,
  height: 844,
  warmupSamples: 120,
  samplesPerTrial: 120,
  trials: MEASUREMENT_TRIALS,
  drawCallsPerFrame: 105,
  trianglesPerDraw: 154,
  trianglesPerFrame: 16_170,
  cpuIterationsPerDraw: 8_000,
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

async function runRawWebGlCalibration(page) {
  const raw = await page.evaluate(async (config) => {
    const canvas = new OffscreenCanvas(config.width, config.height);
    const gl = canvas.getContext("webgl", {
      alpha: false,
      antialias: false,
      depth: false,
      desynchronized: false,
      failIfMajorPerformanceCaveat: false,
      powerPreference: "high-performance",
      preserveDrawingBuffer: false,
      stencil: false,
    });
    if (!gl) throw new Error("Raw WebGL calibration could not create a context");
    if (
      gl.drawingBufferWidth !== config.width
      || gl.drawingBufferHeight !== config.height
    ) {
      throw new Error(
        `Raw WebGL calibration buffer is ${gl.drawingBufferWidth}x`
          + `${gl.drawingBufferHeight}, expected ${config.width}x${config.height}`,
      );
    }

    const compileShader = (type, source) => {
      const shader = gl.createShader(type);
      if (!shader) throw new Error("Raw WebGL calibration could not allocate a shader");
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        throw new Error(
          `Raw WebGL calibration shader failed: ${gl.getShaderInfoLog(shader) ?? "unknown"}`,
        );
      }
      return shader;
    };
    const vertexShader = compileShader(gl.VERTEX_SHADER, `
      attribute vec2 a_position;
      uniform vec2 u_offset;
      uniform float u_phase;
      varying float v_shade;
      void main() {
        vec2 wobble = vec2(sin(u_phase), cos(u_phase)) * 0.0015;
        gl_Position = vec4(a_position + u_offset + wobble, 0.0, 1.0);
        v_shade = fract(a_position.x * 13.0 + a_position.y * 7.0 + u_phase);
      }
    `);
    const fragmentShader = compileShader(gl.FRAGMENT_SHADER, `
      precision mediump float;
      varying float v_shade;
      void main() {
        float shade = 0.35 + 0.65 * abs(sin(v_shade * 6.2831853));
        gl_FragColor = vec4(shade, 0.42 * shade, 0.18 + 0.3 * shade, 1.0);
      }
    `);
    const program = gl.createProgram();
    if (!program) throw new Error("Raw WebGL calibration could not allocate a program");
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(
        `Raw WebGL calibration program failed: ${gl.getProgramInfoLog(program) ?? "unknown"}`,
      );
    }
    gl.useProgram(program);

    const vertices = new Float32Array(config.trianglesPerDraw * 6);
    for (let triangle = 0; triangle < config.trianglesPerDraw; triangle += 1) {
      const column = triangle % 14;
      const row = Math.floor(triangle / 14);
      const centerX = -0.94 + column * (1.88 / 13);
      const centerY = -0.92 + row * (1.84 / 10);
      const width = 0.008 + (triangle % 3) * 0.001;
      const height = 0.008 + (triangle % 5) * 0.0005;
      vertices.set([
        centerX - width,
        centerY - height,
        centerX + width,
        centerY - height,
        centerX,
        centerY + height,
      ], triangle * 6);
    }
    const buffer = gl.createBuffer();
    if (!buffer) throw new Error("Raw WebGL calibration could not allocate a buffer");
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, "a_position");
    const offset = gl.getUniformLocation(program, "u_offset");
    const phase = gl.getUniformLocation(program, "u_phase");
    if (position < 0 || offset === null || phase === null) {
      throw new Error("Raw WebGL calibration shader locations are unavailable");
    }
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    gl.viewport(0, 0, config.width, config.height);
    gl.disable(gl.BLEND);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.DEPTH_TEST);

    let frame = 0;
    let cpuAccumulator = 0.123;
    const renderFrame = () => {
      gl.clearColor(0.035, 0.047, 0.064, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      for (let draw = 0; draw < config.drawCallsPerFrame; draw += 1) {
        for (let work = 0; work < config.cpuIterationsPerDraw; work += 1) {
          cpuAccumulator = Math.sin(
            cpuAccumulator + ((work + draw) % 17) * 0.000001,
          ) + 1.001;
        }
        const x = ((draw % 7) - 3) * 0.002;
        const y = ((Math.floor(draw / 7) % 5) - 2) * 0.002;
        gl.uniform2f(offset, x, y);
        gl.uniform1f(
          phase,
          ((frame * 17 + draw * 23) % 360) * (Math.PI / 180)
            + cpuAccumulator * 0.0001,
        );
        gl.drawArrays(gl.TRIANGLES, 0, config.trianglesPerDraw * 3);
      }
      gl.finish();
      frame += 1;
    };
    const summarize = (frameTimes) => {
      const ordered = frameTimes.toSorted((left, right) => left - right);
      const averageMs = frameTimes.reduce((sum, value) => sum + value, 0)
        / frameTimes.length;
      return {
        fps: 1_000 / averageMs,
        averageMs,
        p95Ms: ordered[Math.ceil(ordered.length * 0.95) - 1],
        samples: frameTimes.length,
      };
    };
    const collect = (sampleCount) => new Promise((resolve, reject) => {
      const frameTimes = [];
      let previousTimestamp = null;
      const timeout = setTimeout(() => {
        reject(new Error(
          `Raw WebGL calibration timed out at ${frameTimes.length}/${sampleCount} samples`,
        ));
      }, config.timeoutMs);
      const tick = (timestamp) => {
        renderFrame();
        if (previousTimestamp !== null) frameTimes.push(timestamp - previousTimestamp);
        previousTimestamp = timestamp;
        if (frameTimes.length >= sampleCount) {
          clearTimeout(timeout);
          resolve(summarize(frameTimes));
          return;
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });

    const warmup = await collect(config.warmupSamples);
    const trials = [];
    for (let index = 0; index < config.trials; index += 1) {
      trials.push(await collect(config.samplesPerTrial));
    }
    const rendererInfo = gl.getExtension("WEBGL_debug_renderer_info");
    const renderer = rendererInfo
      ? gl.getParameter(rendererInfo.UNMASKED_RENDERER_WEBGL)
      : gl.getParameter(gl.RENDERER);
    gl.deleteBuffer(buffer);
    gl.deleteProgram(program);
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    return {
      renderer,
      drawingBuffer: {
        width: gl.drawingBufferWidth,
        height: gl.drawingBufferHeight,
      },
      warmup,
      trials,
    };
  }, RAW_CALIBRATION);
  return {
    workload: RAW_CALIBRATION,
    ...raw,
  };
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
let calibration = {
  status: "not-started",
  workload: RAW_CALIBRATION,
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
    workload: RAW_CALIBRATION,
  };
  const rawCalibration = await runRawWebGlCalibration(page);
  calibration = {
    status: "collected",
    ...rawCalibration,
  };
  const calibrationSummary = summarizeCalibrationTrials(rawCalibration.trials, {
    minimumSamples: RAW_CALIBRATION.samplesPerTrial,
    expectedTrials: RAW_CALIBRATION.trials,
  });
  calibration = {
    ...calibration,
    status: "passed",
    summary: calibrationSummary,
  };
  console.log(
    `Raw WebGL calibration: ${calibrationSummary.fps.toFixed(1)} FPS, `
      + `${calibrationSummary.p95Ms.toFixed(1)}ms p95, `
      + `${RAW_CALIBRATION.drawCallsPerFrame} draws / `
      + `${RAW_CALIBRATION.trianglesPerFrame} triangles, `
      + `${RAW_CALIBRATION.trials}x${RAW_CALIBRATION.samplesPerTrial} samples`,
  );

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
  leakSamples.push(await leakCheckpoint(page, cdp, 0));
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
        calibrationWarmup: RAW_CALIBRATION.warmupSamples,
        calibrationPerTrial: RAW_CALIBRATION.samplesPerTrial,
        calibrationTrials: RAW_CALIBRATION.trials,
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
      ],
      performanceLimits: PERF_LIMITS,
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
