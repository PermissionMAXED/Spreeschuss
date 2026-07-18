// Deterministic Three.js calibration scene builder. Dev/perf-only: only the
// calibration page and unit tests import this module, so it never reaches
// the production bundle. All geometry is generated; no textures or assets.

import {
  AmbientLight,
  BoxGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  SphereGeometry,
  TorusGeometry,
} from "three";
import {
  CALIBRATION_LAYOUT,
  CALIBRATION_RENDERER_PROFILE,
  CALIBRATION_SCENE_SPEC,
  CALIBRATION_VIEWPORT,
  CALIBRATION_WORKLOAD,
  computeWorkloadTotals,
  familyAssignments,
} from "./calibration-workload.mjs";

const GEOMETRY_CLASSES = {
  SphereGeometry,
  BoxGeometry,
  TorusGeometry,
  CylinderGeometry,
};
const MATERIAL_CLASSES = {
  MeshStandardMaterial,
  MeshPhysicalMaterial,
  MeshBasicMaterial,
};

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

export function buildCalibrationScene() {
  const totals = computeWorkloadTotals();
  invariant(
    totals.drawCallsPerFrame === CALIBRATION_WORKLOAD.drawCallsPerFrame
      && totals.trianglesPerFrame === CALIBRATION_WORKLOAD.trianglesPerFrame
      && totals.materialFamilies === CALIBRATION_WORKLOAD.materialFamilies,
    "Calibration scene spec does not match the frozen workload constants",
  );

  const profile = CALIBRATION_RENDERER_PROFILE;
  const layout = CALIBRATION_LAYOUT;
  const scene = new Scene();
  scene.background = new Color(profile.backgroundColor);

  const camera = new PerspectiveCamera(
    profile.cameraFov,
    CALIBRATION_VIEWPORT.width / CALIBRATION_VIEWPORT.height,
    profile.cameraNear,
    profile.cameraFar,
  );
  camera.position.set(0, 0, layout.cameraDistance);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);

  // Same light rig shape as the audited home scenes (ambient + directional).
  const ambient = new AmbientLight(0xff_f1_d9, 2.15);
  const key = new DirectionalLight(0xff_f2_d6, 2.75);
  key.position.set(3.4, 5.2, 6.5);
  scene.add(ambient, key);

  const geometries = CALIBRATION_SCENE_SPEC.map((family) => {
    const GeometryClass = GEOMETRY_CLASSES[family.geometry];
    invariant(GeometryClass, `${family.family}: unknown geometry ${family.geometry}`);
    const geometry = new GeometryClass(...family.geometryArguments);
    const triangles = (geometry.index ? geometry.index.count : geometry.attributes.position.count) / 3;
    invariant(
      triangles === family.trianglesPerMesh,
      `${family.family}: geometry has ${triangles} triangles, spec says ${family.trianglesPerMesh}`,
    );
    return geometry;
  });
  const materials = CALIBRATION_SCENE_SPEC.map((family) => {
    const MaterialClass = MATERIAL_CLASSES[family.material];
    invariant(MaterialClass, `${family.family}: unknown material ${family.material}`);
    return new MaterialClass({ ...family.materialOptions });
  });

  const root = new Group();
  root.name = "calibration-root";
  const familyGroups = CALIBRATION_SCENE_SPEC.map((family) => {
    const group = new Group();
    group.name = `calibration-family-${family.family}`;
    root.add(group);
    return group;
  });

  const assignments = familyAssignments();
  invariant(
    assignments.length === totals.drawCallsPerFrame,
    "Calibration family assignments do not cover every mesh slot",
  );
  const meshes = assignments.map((familyIndex, index) => {
    const mesh = new Mesh(geometries[familyIndex], materials[familyIndex]);
    const column = index % layout.columns;
    const row = Math.floor(index / layout.columns);
    mesh.position.set(
      (column - (layout.columns - 1) / 2) * layout.spacingX,
      (row - (layout.rows - 1) / 2) * layout.spacingY,
      ((index % layout.depthLevels) - (layout.depthLevels - 1) / 2) * layout.depthStepZ,
    );
    mesh.rotation.set((index % 9) * 0.35, (index % 11) * 0.29, 0);
    familyGroups[familyIndex].add(mesh);
    return mesh;
  });
  scene.add(root);
  scene.updateMatrixWorld(true);

  return {
    scene,
    camera,
    root,
    familyGroups,
    meshes,
    geometries,
    materials,
    totals,
  };
}

// Deterministic per-frame animation: rotates every mesh in place and bobs the
// root group so each rendered frame performs a full scene-graph traversal and
// world-matrix update, like the real game loop, without any mesh ever leaving
// the camera frustum.
export function advanceCalibrationFrame(built, frameIndex) {
  built.root.position.z =
    Math.sin(frameIndex * 0.05) * CALIBRATION_LAYOUT.rootBobAmplitudeZ;
  for (const [index, mesh] of built.meshes.entries()) {
    mesh.rotation.x = (index % 9) * 0.35 + frameIndex * (0.011 + (index % 5) * 0.002);
    mesh.rotation.y = (index % 11) * 0.29 + frameIndex * (0.017 + (index % 7) * 0.003);
  }
}
