/**
 * Shared Arcade Kit for minigame specialists.
 *
 * Deterministic timing (fixed-step accumulator, countdown, pause gate,
 * difficulty ramp), localized safe-area chrome (HUD, tutorial, results), and
 * a held-input controller with keyboard and switch-device parity. Everything
 * is instance-scoped — no module owns mutable global state — and every
 * surface restores its DOM/listener baseline on dispose.
 */
export {
  FixedStepAccumulator,
  type FixedStepCallback,
  type FixedStepOptions,
  type FixedStepSnapshot,
} from "./fixed-step";
export {
  ArcadeCountdown,
  type CountdownCue,
  type CountdownEvent,
  type CountdownFeedback,
  type CountdownOptions,
  type CountdownSnapshot,
} from "./countdown";
export {
  PauseGate,
  type PauseGateEvent,
  type PauseGateListener,
} from "./pause-gate";
export {
  createDifficultyRamp,
  type DifficultyRamp,
  type DifficultyRampConfig,
  type DifficultyRampShape,
} from "./difficulty";
export { ARCADE_KIT_STYLE_ID, acquireArcadeKitStyles } from "./styles";
export {
  createArcadeHud,
  formatArcadeTimer,
  type ArcadeHud,
  type ArcadeHudOptions,
} from "./hud";
export {
  createTutorialOverlay,
  type TutorialOverlay,
  type TutorialOverlayOptions,
} from "./tutorial";
export {
  createResultScreen,
  type ResultScreen,
  type ResultScreenHooks,
  type ResultScreenOptions,
  type ResultSummary,
} from "./results";
export {
  createArcadeInput,
  type ArcadeHeldClearReason,
  type ArcadeInput,
  type ArcadeInputEvent,
  type ArcadeInputListener,
  type ArcadeInputOptions,
  type ArcadeInputSource,
  type ArcadeInputState,
} from "./input";
