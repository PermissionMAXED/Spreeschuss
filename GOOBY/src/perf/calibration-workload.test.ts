import { Frustum, Matrix4, Sphere } from "three";
import { describe, expect, it } from "vitest";
import {
  advanceCalibrationFrame,
  buildCalibrationScene,
} from "./calibration-scene.mjs";
import {
  CALIBRATION_PAGE_PATH,
  CALIBRATION_RENDERER_PROFILE,
  CALIBRATION_SCENE_SPEC,
  CALIBRATION_VIEWPORT,
  CALIBRATION_WORKLOAD,
  computeWorkloadTotals,
  familyAssignments,
} from "./calibration-workload.mjs";

describe("Three.js calibration workload constants", () => {
  it("freezes the exact representative workload", () => {
    expect(CALIBRATION_WORKLOAD).toEqual({
      drawCallsPerFrame: 42,
      trianglesPerFrame: 13_408,
      materialFamilies: 4,
    });
    expect(Object.isFrozen(CALIBRATION_WORKLOAD)).toBe(true);
    expect(Object.isFrozen(CALIBRATION_SCENE_SPEC)).toBe(true);
    for (const family of CALIBRATION_SCENE_SPEC) {
      expect(Object.isFrozen(family)).toBe(true);
      expect(Object.isFrozen(family.materialOptions)).toBe(true);
      expect(Object.isFrozen(family.geometryArguments)).toBe(true);
    }
    expect(Object.isFrozen(CALIBRATION_VIEWPORT)).toBe(true);
    expect(Object.isFrozen(CALIBRATION_RENDERER_PROFILE)).toBe(true);
  });

  it("derives the frozen totals from the scene spec", () => {
    expect(computeWorkloadTotals()).toEqual({
      drawCallsPerFrame: CALIBRATION_WORKLOAD.drawCallsPerFrame,
      trianglesPerFrame: CALIBRATION_WORKLOAD.trianglesPerFrame,
      materialFamilies: CALIBRATION_WORKLOAD.materialFamilies,
    });
    expect(CALIBRATION_SCENE_SPEC.map((family) => family.meshes))
      .toEqual([14, 12, 8, 8]);
    expect(CALIBRATION_SCENE_SPEC.map((family) => family.trianglesPerMesh))
      .toEqual([352, 192, 580, 192]);
  });

  it("matches the Home audit viewport and renderer profile", () => {
    expect(CALIBRATION_PAGE_PATH).toBe("/src/perf/calibration.html");
    expect(CALIBRATION_VIEWPORT).toEqual({ width: 390, height: 844, pixelRatio: 1 });
    expect(CALIBRATION_RENDERER_PROFILE).toMatchObject({
      alpha: false,
      antialias: true,
      depth: true,
      powerPreference: "default",
      toneMappingExposure: 1.05,
      shadowMapEnabled: false,
      backgroundColor: 0xf9_d6_ae,
      cameraFov: 36,
      cameraNear: 0.1,
      cameraFar: 76,
    });
  });

  it("interleaves family assignments across every mesh slot", () => {
    const assignments = familyAssignments();
    expect(assignments).toHaveLength(CALIBRATION_WORKLOAD.drawCallsPerFrame);
    const counts = CALIBRATION_SCENE_SPEC.map(() => 0);
    for (const familyIndex of assignments) {
      counts[familyIndex] = (counts[familyIndex] ?? 0) + 1;
    }
    expect(counts).toEqual(CALIBRATION_SCENE_SPEC.map((family) => family.meshes));
    expect(assignments.slice(0, 8)).toEqual([0, 1, 2, 3, 0, 1, 2, 3]);
  });
});

describe("Three.js calibration scene", () => {
  it("builds exactly 42 draw calls, 13,408 triangles, 4 material families", () => {
    const built = buildCalibrationScene();
    expect(built.meshes).toHaveLength(42);
    const triangles = built.meshes.reduce((sum, mesh) => {
      const geometry = mesh.geometry;
      const vertexCount = geometry.index?.count
        ?? geometry.attributes.position?.count
        ?? 0;
      expect(vertexCount).toBeGreaterThan(0);
      return sum + vertexCount / 3;
    }, 0);
    expect(triangles).toBe(13_408);
    expect(new Set(built.meshes.map((mesh) => mesh.material)).size).toBe(4);
    expect(built.materials).toHaveLength(4);
    expect(built.geometries).toHaveLength(4);
    expect(built.totals).toEqual(CALIBRATION_WORKLOAD);
  });

  it("uses four distinct shader program families", () => {
    const built = buildCalibrationScene();
    const programKeys = built.materials.map((material) => {
      const variant = material as { type: string; flatShading?: boolean };
      return `${variant.type}:${String(variant.flatShading ?? false)}`;
    });
    expect(new Set(programKeys).size).toBe(4);
    expect(programKeys).toEqual([
      "MeshStandardMaterial:false",
      "MeshStandardMaterial:true",
      "MeshPhysicalMaterial:false",
      "MeshBasicMaterial:false",
    ]);
  });

  it("keeps every mesh inside the camera frustum across the animation", () => {
    const built = buildCalibrationScene();
    const frustum = new Frustum();
    const projectionView = new Matrix4();
    const worldSphere = new Sphere();
    for (const frame of [0, 30, 90, 180, 360, 719]) {
      advanceCalibrationFrame(built, frame);
      built.scene.updateMatrixWorld(true);
      built.camera.updateMatrixWorld(true);
      projectionView.multiplyMatrices(
        built.camera.projectionMatrix,
        built.camera.matrixWorldInverse,
      );
      frustum.setFromProjectionMatrix(projectionView);
      for (const mesh of built.meshes) {
        const geometry = mesh.geometry;
        geometry.computeBoundingSphere();
        expect(geometry.boundingSphere).not.toBeNull();
        worldSphere.copy(geometry.boundingSphere as Sphere)
          .applyMatrix4(mesh.matrixWorld);
        expect(frustum.intersectsSphere(worldSphere)).toBe(true);
      }
    }
  });

  it("rejects a tampered scene spec through computeWorkloadTotals", () => {
    expect(() => computeWorkloadTotals([
      {
        ...CALIBRATION_SCENE_SPEC[0]!,
        meshes: 0,
      },
    ])).toThrow(/mesh count must be a positive integer/u);
    expect(() => computeWorkloadTotals([
      {
        ...CALIBRATION_SCENE_SPEC[0]!,
        trianglesPerMesh: 0.5,
      },
    ])).toThrow(/triangles per mesh must be a positive integer/u);
  });
});
