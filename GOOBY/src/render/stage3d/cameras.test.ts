import { Object3D, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import {
  STAGE3D_DEFAULT_FOV,
  STAGE3D_PORTRAIT_ASPECT,
  createStageCameraRig,
  createStagePortraitCamera,
} from "./cameras";

describe("stage3d portrait cameras", () => {
  it("creates a portrait camera with the shared framing defaults", () => {
    const camera = createStagePortraitCamera();
    expect(camera.aspect).toBeCloseTo(STAGE3D_PORTRAIT_ASPECT, 12);
    expect(camera.fov).toBe(STAGE3D_DEFAULT_FOV);
    const custom = createStagePortraitCamera({ kind: "portrait-fixed", fov: 50 });
    expect(custom.fov).toBe(50);
  });

  it("pins the fixed rig to its framing on both snap and update", () => {
    const camera = createStagePortraitCamera();
    const rig = createStageCameraRig({
      kind: "portrait-fixed",
      position: { x: 1, y: 6, z: 9 },
      lookAt: { x: 0, y: 1, z: 0 },
    });
    rig.snap(camera, null);
    const snapped = camera.position.clone();
    const orientation = camera.quaternion.clone();
    camera.position.set(50, 50, 50);
    rig.update(camera, null, 1 / 60);
    expect(camera.position.equals(snapped)).toBe(true);
    // acos near 1 loses precision, so allow a hair above float epsilon.
    expect(camera.quaternion.angleTo(orientation)).toBeLessThan(1e-6);
    expect(snapped.x).toBe(1);
    expect(snapped.y).toBe(6);
    expect(snapped.z).toBe(9);
  });

  it("chases a target deterministically for identical delta sequences", () => {
    const run = (): Vector3 => {
      const camera = createStagePortraitCamera();
      const rig = createStageCameraRig({ kind: "portrait-chase", stiffness: 5 });
      const target = new Object3D();
      rig.snap(camera, target);
      for (let frame = 0; frame < 90; frame += 1) {
        target.position.set(Math.sin(frame / 9) * 3, 0, -frame * 0.2);
        rig.update(camera, target, 1 / 60);
      }
      return camera.position.clone();
    };
    const first = run();
    const second = run();
    expect(first.equals(second)).toBe(true);
  });

  it("converges partition-consistently thanks to exponential damping", () => {
    const chaseTo = (stepSeconds: number, steps: number): Vector3 => {
      const camera = createStagePortraitCamera();
      const rig = createStageCameraRig({
        kind: "portrait-chase",
        offset: { x: 0, y: 2, z: 5 },
        stiffness: 4,
      });
      const target = new Object3D();
      target.position.set(6, 0, -10);
      target.updateMatrixWorld(true);
      camera.position.set(0, 0, 0);
      for (let step = 0; step < steps; step += 1) rig.update(camera, target, stepSeconds);
      return camera.position.clone();
    };
    const coarse = chaseTo(1 / 30, 60);
    const fine = chaseTo(1 / 120, 240);
    expect(coarse.distanceTo(fine)).toBeLessThan(1e-9);

    const target = new Object3D();
    target.position.set(6, 0, -10);
    const camera = createStagePortraitCamera();
    const rig = createStageCameraRig({ kind: "portrait-chase", offset: { x: 0, y: 2, z: 5 }, stiffness: 4 });
    rig.snap(camera, target);
    expect(camera.position.x).toBeCloseTo(6, 12);
    expect(camera.position.y).toBeCloseTo(2, 12);
    expect(camera.position.z).toBeCloseTo(-5, 12);
    expect(coarse.distanceTo(camera.position)).toBeLessThan(0.01);
  });

  it("approaches the target monotonically and honors the look-ahead focus", () => {
    const camera = createStagePortraitCamera();
    const rig = createStageCameraRig({
      kind: "portrait-chase",
      offset: { x: 0, y: 0, z: 4 },
      lookAhead: { x: 0, y: 0, z: -8 },
      stiffness: 6,
    });
    const target = new Object3D();
    target.position.set(0, 0, -20);
    target.updateMatrixWorld(true);
    camera.position.set(0, 0, 30);
    let previousDistance = Number.POSITIVE_INFINITY;
    for (let frame = 0; frame < 120; frame += 1) {
      rig.update(camera, target, 1 / 60);
      const distance = camera.position.distanceTo(new Vector3(0, 0, -16));
      expect(distance).toBeLessThanOrEqual(previousDistance + 1e-12);
      previousDistance = distance;
    }
    // Camera looks toward the look-ahead point (negative z from its pose).
    const forward = new Vector3();
    camera.getWorldDirection(forward);
    expect(forward.z).toBeLessThan(0);
    expect(() => rig.update(camera, target, -1)).toThrow(RangeError);
    expect(() =>
      createStageCameraRig({ kind: "portrait-chase", stiffness: 0 }),
    ).toThrow(RangeError);
  });
});
