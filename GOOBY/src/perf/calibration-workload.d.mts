export const CALIBRATION_PAGE_PATH: "/src/perf/calibration.html";

export interface CalibrationViewport {
  readonly width: number;
  readonly height: number;
  readonly pixelRatio: number;
}
export const CALIBRATION_VIEWPORT: Readonly<CalibrationViewport>;

export interface CalibrationRendererProfile {
  readonly alpha: boolean;
  readonly antialias: boolean;
  readonly depth: boolean;
  readonly powerPreference: "default" | "high-performance" | "low-power";
  readonly outputColorSpace: string;
  readonly toneMapping: string;
  readonly toneMappingExposure: number;
  readonly shadowMapEnabled: boolean;
  readonly backgroundColor: number;
  readonly cameraFov: number;
  readonly cameraNear: number;
  readonly cameraFar: number;
}
export const CALIBRATION_RENDERER_PROFILE: Readonly<CalibrationRendererProfile>;

export interface CalibrationLayout {
  readonly columns: number;
  readonly rows: number;
  readonly spacingX: number;
  readonly spacingY: number;
  readonly depthLevels: number;
  readonly depthStepZ: number;
  readonly cameraDistance: number;
  readonly rootBobAmplitudeZ: number;
}
export const CALIBRATION_LAYOUT: Readonly<CalibrationLayout>;

export type CalibrationMaterialClass =
  | "MeshStandardMaterial"
  | "MeshPhysicalMaterial"
  | "MeshBasicMaterial";
export type CalibrationGeometryClass =
  | "SphereGeometry"
  | "BoxGeometry"
  | "TorusGeometry"
  | "CylinderGeometry";

export interface CalibrationFamilySpec {
  readonly family: string;
  readonly material: CalibrationMaterialClass;
  readonly materialOptions: Readonly<Record<string, number | boolean>>;
  readonly geometry: CalibrationGeometryClass;
  readonly geometryArguments: readonly number[];
  readonly meshes: number;
  readonly trianglesPerMesh: number;
}
export const CALIBRATION_SCENE_SPEC: readonly CalibrationFamilySpec[];

export interface CalibrationWorkloadTotals {
  readonly drawCallsPerFrame: number;
  readonly trianglesPerFrame: number;
  readonly materialFamilies: number;
}
export function computeWorkloadTotals(
  spec?: readonly CalibrationFamilySpec[],
): CalibrationWorkloadTotals;

export const CALIBRATION_WORKLOAD: Readonly<{
  readonly drawCallsPerFrame: 42;
  readonly trianglesPerFrame: 13408;
  readonly materialFamilies: 4;
}>;

export function familyAssignments(
  spec?: readonly CalibrationFamilySpec[],
): number[];
