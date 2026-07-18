/**
 * Stage3D: the shared, lease-based 3D surface for minigames.
 *
 * See `stage.ts` for the manager/lease lifecycle and `cameras.ts` for the
 * portrait fixed and chase camera rigs.
 */
export {
  STAGE3D_DEFAULT_FOV,
  STAGE3D_PORTRAIT_ASPECT,
  createStageCameraRig,
  createStagePortraitCamera,
  type StageCameraRig,
  type StageCameraRigSpec,
  type StageVector,
} from "./cameras";
export {
  Stage3dManager,
  acquireStage3d,
  captureStageResourceBaseline,
  diffStageResourceBaseline,
  disposeStage3dRuntime,
  type Stage3dLease,
  type Stage3dManagerOptions,
  type Stage3dOptions,
  type Stage3dRendererHost,
  type Stage3dRendererHostFactory,
  type StageFrameCallback,
  type StageResourceBaseline,
  type StageViewport,
  type StageViewportSize,
} from "./stage";
