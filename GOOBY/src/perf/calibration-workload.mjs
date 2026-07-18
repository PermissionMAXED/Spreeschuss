// Frozen Three.js calibration workload. The calibration page renders this
// fixed representative scene (42 draw calls, 13,408 triangles, 4 material
// program families) through the same WebGLRenderer profile as the Home
// living room at low quality, so normalized SwiftShader ratios compare like
// workloads. Dev/perf-only: nothing in this module is reachable from the
// production entry point.

export const CALIBRATION_PAGE_PATH = "/src/perf/calibration.html";

export const CALIBRATION_VIEWPORT = Object.freeze({
  width: 390,
  height: 844,
  pixelRatio: 1,
});

// Mirrors GameRenderer construction (src/render/renderer.ts) at the
// "balanced" boot quality (antialias on, alpha off, depth on) with the low
// quality preset applied afterwards (pixel ratio 1, shadows off, camera far
// 76), which is exactly how the audited Home scene renders.
export const CALIBRATION_RENDERER_PROFILE = Object.freeze({
  alpha: false,
  antialias: true,
  depth: true,
  powerPreference: "default",
  outputColorSpace: "srgb",
  toneMapping: "aces-filmic",
  toneMappingExposure: 1.05,
  shadowMapEnabled: false,
  backgroundColor: 0xf9_d6_ae,
  cameraFov: 36,
  cameraNear: 0.1,
  cameraFar: 76,
});

export const CALIBRATION_LAYOUT = Object.freeze({
  columns: 6,
  rows: 7,
  spacingX: 0.56,
  spacingY: 0.95,
  depthLevels: 5,
  depthStepZ: 0.35,
  cameraDistance: 14.5,
  rootBobAmplitudeZ: 0.1,
});

// Generated geometry only; no textures or external assets. Triangle counts
// are asserted against the real three.js geometries by unit tests and
// against renderer.info on every calibration frame.
export const CALIBRATION_SCENE_SPEC = Object.freeze([
  Object.freeze({
    family: "standard-smooth",
    material: "MeshStandardMaterial",
    materialOptions: Object.freeze({ color: 0x8f_d4_d3, roughness: 0.62, metalness: 0.05 }),
    geometry: "SphereGeometry",
    geometryArguments: Object.freeze([0.34, 16, 12]),
    meshes: 14,
    trianglesPerMesh: 352,
  }),
  Object.freeze({
    family: "standard-flat",
    material: "MeshStandardMaterial",
    materialOptions: Object.freeze({
      color: 0xd8_9f_70,
      roughness: 0.86,
      metalness: 0,
      flatShading: true,
    }),
    geometry: "BoxGeometry",
    geometryArguments: Object.freeze([0.5, 0.5, 0.5, 4, 4, 4]),
    meshes: 12,
    trianglesPerMesh: 192,
  }),
  Object.freeze({
    family: "physical-clearcoat",
    material: "MeshPhysicalMaterial",
    materialOptions: Object.freeze({
      color: 0x55_48_4b,
      roughness: 0.35,
      metalness: 0.1,
      clearcoat: 0.4,
    }),
    geometry: "TorusGeometry",
    geometryArguments: Object.freeze([0.24, 0.1, 10, 29]),
    meshes: 8,
    trianglesPerMesh: 580,
  }),
  Object.freeze({
    family: "basic-unlit",
    material: "MeshBasicMaterial",
    materialOptions: Object.freeze({ color: 0xf4_cf_a7 }),
    geometry: "CylinderGeometry",
    geometryArguments: Object.freeze([0.22, 0.26, 0.5, 16, 5]),
    meshes: 8,
    trianglesPerMesh: 192,
  }),
]);

export function computeWorkloadTotals(spec = CALIBRATION_SCENE_SPEC) {
  let drawCallsPerFrame = 0;
  let trianglesPerFrame = 0;
  for (const family of spec) {
    if (!Number.isInteger(family.meshes) || family.meshes <= 0) {
      throw new RangeError(`${family.family}: mesh count must be a positive integer`);
    }
    if (!Number.isInteger(family.trianglesPerMesh) || family.trianglesPerMesh <= 0) {
      throw new RangeError(`${family.family}: triangles per mesh must be a positive integer`);
    }
    drawCallsPerFrame += family.meshes;
    trianglesPerFrame += family.meshes * family.trianglesPerMesh;
  }
  return {
    drawCallsPerFrame,
    trianglesPerFrame,
    materialFamilies: spec.length,
  };
}

export const CALIBRATION_WORKLOAD = Object.freeze({
  drawCallsPerFrame: 42,
  trianglesPerFrame: 13_408,
  materialFamilies: 4,
});

// Deterministic interleaved family order so consecutive draws exercise
// program/material switching the way a real mixed scene does.
export function familyAssignments(spec = CALIBRATION_SCENE_SPEC) {
  const remaining = spec.map((family) => family.meshes);
  const total = remaining.reduce((sum, value) => sum + value, 0);
  const assignments = [];
  let cursor = 0;
  while (assignments.length < total) {
    const familyIndex = cursor % spec.length;
    if (remaining[familyIndex] > 0) {
      assignments.push(familyIndex);
      remaining[familyIndex] -= 1;
    }
    cursor += 1;
  }
  return assignments;
}
