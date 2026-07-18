// Browser runtime for the Vite-served Three.js calibration page. Dev/perf
// audit only: this module is reachable solely through calibration.html,
// which the production build never emits. Loading it also warms the Vite
// dev-server module graph and the pre-bundled three dependency before the
// app itself is measured.

import { WebGLRenderer, ACESFilmicToneMapping, SRGBColorSpace } from "three";
import {
  advanceCalibrationFrame,
  buildCalibrationScene,
} from "./calibration-scene.mjs";
import {
  CALIBRATION_RENDERER_PROFILE,
  CALIBRATION_VIEWPORT,
  CALIBRATION_WORKLOAD,
} from "./calibration-workload.mjs";

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function createRenderer(canvas) {
  const profile = CALIBRATION_RENDERER_PROFILE;
  // Identical constructor options to GameRenderer at its "balanced" boot
  // quality (src/render/renderer.ts): antialias on, alpha off, depth on.
  const renderer = new WebGLRenderer({
    canvas,
    alpha: profile.alpha,
    antialias: profile.antialias,
    depth: profile.depth,
    powerPreference: profile.powerPreference,
  });
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = profile.toneMappingExposure;
  // Low-quality preset as applied to the audited Home scene.
  renderer.shadowMap.enabled = profile.shadowMapEnabled;
  renderer.setPixelRatio(CALIBRATION_VIEWPORT.pixelRatio);
  renderer.setSize(CALIBRATION_VIEWPORT.width, CALIBRATION_VIEWPORT.height, false);
  return renderer;
}

function summarize(frameTimes) {
  const ordered = frameTimes.toSorted((left, right) => left - right);
  const averageMs = frameTimes.reduce((sum, value) => sum + value, 0) / frameTimes.length;
  return {
    fps: 1_000 / averageMs,
    averageMs,
    p95Ms: ordered[Math.ceil(ordered.length * 0.95) - 1],
    samples: frameTimes.length,
  };
}

function assertWorkloadCounts(renderer) {
  const rendered = {
    drawCalls: renderer.info.render.calls,
    triangles: renderer.info.render.triangles,
    programs: renderer.info.programs?.length ?? 0,
  };
  invariant(
    rendered.drawCalls === CALIBRATION_WORKLOAD.drawCallsPerFrame,
    `Calibration frame issued ${rendered.drawCalls} draw calls, `
      + `expected ${CALIBRATION_WORKLOAD.drawCallsPerFrame}`,
  );
  invariant(
    rendered.triangles === CALIBRATION_WORKLOAD.trianglesPerFrame,
    `Calibration frame rasterized ${rendered.triangles} triangles, `
      + `expected ${CALIBRATION_WORKLOAD.trianglesPerFrame}`,
  );
  invariant(
    rendered.programs === CALIBRATION_WORKLOAD.materialFamilies,
    `Calibration renderer compiled ${rendered.programs} programs, `
      + `expected ${CALIBRATION_WORKLOAD.materialFamilies} material families`,
  );
  return rendered;
}

async function runCalibration(config) {
  invariant(
    Number.isInteger(config?.warmupSamples) && config.warmupSamples > 0
      && Number.isInteger(config?.samplesPerTrial) && config.samplesPerTrial > 0
      && Number.isInteger(config?.trials) && config.trials > 0
      && Number.isFinite(config?.timeoutMs) && config.timeoutMs > 0,
    "Calibration run config requires warmupSamples, samplesPerTrial, trials, timeoutMs",
  );
  const canvas = document.querySelector("#calibration-canvas");
  invariant(canvas instanceof HTMLCanvasElement, "Calibration canvas is missing");
  const renderer = createRenderer(canvas);
  const built = buildCalibrationScene();
  let frame = 0;
  let jitterSink = 0;

  const renderFrame = () => {
    advanceCalibrationFrame(built, frame);
    renderer.render(built.scene, built.camera);
    frame += 1;
    return assertWorkloadCounts(renderer);
  };

  const firstFrame = renderFrame();
  const gl = renderer.getContext();
  invariant(
    gl.drawingBufferWidth === CALIBRATION_VIEWPORT.width
      && gl.drawingBufferHeight === CALIBRATION_VIEWPORT.height,
    `Calibration drawing buffer is ${gl.drawingBufferWidth}x${gl.drawingBufferHeight}, `
      + `expected ${CALIBRATION_VIEWPORT.width}x${CALIBRATION_VIEWPORT.height} at DPR `
      + `${CALIBRATION_VIEWPORT.pixelRatio}`,
  );

  const collect = (sampleCount, jitter = null) => new Promise((resolve, reject) => {
    const frameTimes = [];
    const jitterFrames = new Set(jitter?.frameIndexes ?? []);
    let previousTimestamp = null;
    let settled = false;
    const timeout = setTimeout(() => {
      settled = true;
      reject(new Error(
        `Three.js calibration timed out at ${frameTimes.length}/${sampleCount} samples`,
      ));
    }, config.timeoutMs);
    const tick = (timestamp) => {
      if (settled) return;
      try {
        renderFrame();
      } catch (error) {
        settled = true;
        clearTimeout(timeout);
        reject(error);
        return;
      }
      if (previousTimestamp !== null) frameTimes.push(timestamp - previousTimestamp);
      previousTimestamp = timestamp;
      if (jitterFrames.has(frameTimes.length)) {
        const blockedUntil = performance.now() + jitter.blockMs;
        while (performance.now() < blockedUntil) {
          jitterSink += Number.EPSILON;
        }
      }
      if (frameTimes.length >= sampleCount) {
        settled = true;
        clearTimeout(timeout);
        resolve(summarize(frameTimes));
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  try {
    const warmup = await collect(config.warmupSamples);
    const trials = [];
    for (let index = 0; index < config.trials; index += 1) {
      const jitter = config.schedulerJitter?.trialIndex === index
        ? config.schedulerJitter
        : null;
      trials.push(await collect(config.samplesPerTrial, jitter));
    }
    const rendererInfo = gl.getExtension("WEBGL_debug_renderer_info");
    return {
      renderer: rendererInfo
        ? gl.getParameter(rendererInfo.UNMASKED_RENDERER_WEBGL)
        : gl.getParameter(gl.RENDERER),
      drawingBuffer: {
        width: gl.drawingBufferWidth,
        height: gl.drawingBufferHeight,
      },
      renderedWorkload: firstFrame,
      jitterSink,
      warmup,
      trials,
    };
  } finally {
    for (const geometry of built.geometries) geometry.dispose();
    for (const material of built.materials) material.dispose();
    renderer.dispose();
  }
}

window.__goobyPerfCalibration = Object.freeze({
  version: 1,
  ready: true,
  workload: CALIBRATION_WORKLOAD,
  run: runCalibration,
});
