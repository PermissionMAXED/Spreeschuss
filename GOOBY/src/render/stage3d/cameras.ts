/**
 * Portrait camera rigs for the shared Stage3D lease.
 *
 * Two rigs cover the minigame roster: a fixed portrait framing and a damped
 * chase rig that follows a target. Both are pure functions of the camera, the
 * target pose, and the frame delta — the chase damping factor
 * `1 - e^(-stiffness·dt)` composes multiplicatively across frame partitions,
 * so any subdivision of the same total time converges to the same pose.
 */
import { PerspectiveCamera, Vector3, type Object3D } from "three";

export const STAGE3D_PORTRAIT_ASPECT = 9 / 16;
export const STAGE3D_DEFAULT_FOV = 36;

export interface StageVector {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export type StageCameraRigSpec =
  | {
      readonly kind: "portrait-fixed";
      readonly position?: StageVector;
      readonly lookAt?: StageVector;
      readonly fov?: number;
    }
  | {
      readonly kind: "portrait-chase";
      /** Camera offset from the target, in the target's local space. */
      readonly offset?: StageVector;
      /** Look-at point offset from the target position (world axes). */
      readonly lookAhead?: StageVector;
      /** Damping stiffness per second; higher snaps faster. */
      readonly stiffness?: number;
      readonly fov?: number;
    };

export interface StageCameraRig {
  readonly spec: StageCameraRigSpec;
  /** Instantly places the camera at its converged pose for the target. */
  snap(camera: PerspectiveCamera, target: Object3D | null): void;
  /** Advances the rig one frame; deterministic for a given dt sequence. */
  update(camera: PerspectiveCamera, target: Object3D | null, dtSeconds: number): void;
}

const FIXED_DEFAULT_POSITION: StageVector = { x: 0, y: 5.2, z: 8.4 };
const FIXED_DEFAULT_LOOK_AT: StageVector = { x: 0, y: 0.6, z: 0 };
const CHASE_DEFAULT_OFFSET: StageVector = { x: 0, y: 3.4, z: 6.2 };
const CHASE_DEFAULT_LOOK_AHEAD: StageVector = { x: 0, y: 0.8, z: -2.4 };
const CHASE_DEFAULT_STIFFNESS = 6;

function toVector3(vector: StageVector, into: Vector3): Vector3 {
  return into.set(vector.x, vector.y, vector.z);
}

export function createStagePortraitCamera(spec?: StageCameraRigSpec): PerspectiveCamera {
  const fov = spec?.fov ?? STAGE3D_DEFAULT_FOV;
  const camera = new PerspectiveCamera(fov, STAGE3D_PORTRAIT_ASPECT, 0.1, 120);
  return camera;
}

export function createStageCameraRig(spec: StageCameraRigSpec): StageCameraRig {
  if (spec.kind === "portrait-fixed") {
    const position = spec.position ?? FIXED_DEFAULT_POSITION;
    const lookAt = spec.lookAt ?? FIXED_DEFAULT_LOOK_AT;
    const scratch = new Vector3();
    const apply = (camera: PerspectiveCamera): void => {
      camera.position.set(position.x, position.y, position.z);
      camera.lookAt(toVector3(lookAt, scratch));
    };
    return {
      spec,
      snap: apply,
      update: apply,
    };
  }

  const offset = spec.offset ?? CHASE_DEFAULT_OFFSET;
  const lookAhead = spec.lookAhead ?? CHASE_DEFAULT_LOOK_AHEAD;
  const stiffness = spec.stiffness ?? CHASE_DEFAULT_STIFFNESS;
  if (!Number.isFinite(stiffness) || stiffness <= 0) {
    throw new RangeError("Chase rig stiffness must be finite and positive");
  }
  const desired = new Vector3();
  const focus = new Vector3();

  const desiredPose = (target: Object3D | null): void => {
    if (target) {
      // Deterministic regardless of render order: refresh the world matrix
      // instead of relying on the last renderer pass having done it.
      target.updateWorldMatrix(true, false);
      desired.set(offset.x, offset.y, offset.z);
      target.localToWorld(desired);
      focus.set(
        target.position.x + lookAhead.x,
        target.position.y + lookAhead.y,
        target.position.z + lookAhead.z,
      );
    } else {
      desired.set(offset.x, offset.y, offset.z);
      focus.set(lookAhead.x, lookAhead.y, lookAhead.z);
    }
  };

  return {
    spec,
    snap(camera, target): void {
      desiredPose(target);
      camera.position.copy(desired);
      camera.lookAt(focus);
    },
    update(camera, target, dtSeconds): void {
      if (!Number.isFinite(dtSeconds) || dtSeconds < 0) {
        throw new RangeError("Camera rig delta must be finite and non-negative");
      }
      desiredPose(target);
      const blend = 1 - Math.exp(-stiffness * dtSeconds);
      camera.position.lerp(desired, blend);
      camera.lookAt(focus);
    },
  };
}
