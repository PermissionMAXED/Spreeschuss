import type {
  BufferGeometry,
  Group,
  Material,
  Mesh,
  PerspectiveCamera,
  Scene,
} from "three";
import type { CalibrationWorkloadTotals } from "./calibration-workload.mjs";

export interface BuiltCalibrationScene {
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
  readonly root: Group;
  readonly familyGroups: readonly Group[];
  readonly meshes: readonly Mesh[];
  readonly geometries: readonly BufferGeometry[];
  readonly materials: readonly Material[];
  readonly totals: CalibrationWorkloadTotals;
}

export function buildCalibrationScene(): BuiltCalibrationScene;
export function advanceCalibrationFrame(
  built: BuiltCalibrationScene,
  frameIndex: number,
): void;
