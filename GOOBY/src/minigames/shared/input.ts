/**
 * Held-input controller for arcade minigames.
 *
 * One surface unifies three input paradigms so every game gets parity across
 * touch, keyboard, and adaptive switch hardware:
 *
 * - **Touch stick** — a held pointer acts as a virtual stick: the axis is the
 *   clamped drag distance from the touch origin, released back to zero on
 *   pointer up/cancel.
 * - **Lanes** — the surface divides into N vertical lanes; a held pointer
 *   presses the lane under it, digits `1..N` and arrow keys press lanes from
 *   the keyboard.
 * - **Action/switch** — Space and Enter press the primary action, which is
 *   exactly what single-button adaptive switch devices emit.
 *
 * Held state is authoritative and lifecycle-safe: window blur, document
 * hiding, `setEnabled(false)` (the pause-gate integration point), and dispose
 * all release everything and notify subscribers. Dispose restores the surface
 * attributes, class, and every listener to their pre-mount baseline.
 */
import { acquireArcadeKitStyles } from "./styles";

export type ArcadeInputSource = "pointer" | "keyboard";

export type ArcadeHeldClearReason = "disabled" | "blur" | "hidden" | "manual" | "dispose";

export type ArcadeInputEvent =
  | { readonly kind: "lane-pressed"; readonly lane: number; readonly source: ArcadeInputSource }
  | { readonly kind: "lane-released"; readonly lane: number; readonly source: ArcadeInputSource }
  | {
      readonly kind: "axis-changed";
      readonly x: number;
      readonly y: number;
      readonly source: ArcadeInputSource;
    }
  | { readonly kind: "action-pressed"; readonly source: ArcadeInputSource }
  | { readonly kind: "action-released"; readonly source: ArcadeInputSource }
  | { readonly kind: "held-cleared"; readonly reason: ArcadeHeldClearReason };

export type ArcadeInputListener = (event: ArcadeInputEvent) => void;

export interface ArcadeInputState {
  /** Horizontal stick axis in [-1, 1]. */
  readonly axisX: number;
  /** Vertical stick axis in [-1, 1]; positive points down-screen. */
  readonly axisY: number;
  /** Most recently pressed lane, or null before any press. */
  readonly lane: number | null;
  readonly laneHeld: boolean;
  readonly actionHeld: boolean;
}

export interface ArcadeInputOptions {
  readonly surface: HTMLElement;
  /** Number of vertical lanes across the surface. Defaults to 3. */
  readonly lanes?: number;
  /** Drag distance in px that maps to |axis| = 1. Defaults to 96. */
  readonly stickRadiusPx?: number;
  /** Stick values below this magnitude read as zero. Defaults to 0.12. */
  readonly deadZone?: number;
}

export interface ArcadeInput {
  readonly state: ArcadeInputState;
  readonly enabled: boolean;
  subscribe(listener: ArcadeInputListener): () => void;
  /** Disabling (e.g. while paused) releases all held input immediately. */
  setEnabled(enabled: boolean): void;
  clearHeld(): void;
  dispose(): void;
}

const DEFAULT_LANES = 3;
const DEFAULT_STICK_RADIUS_PX = 96;
const DEFAULT_DEAD_ZONE = 0.12;

type AxisKey = "left" | "right" | "up" | "down";

interface KeyBinding {
  readonly axis?: AxisKey;
  readonly lane?: "first" | "middle" | "last";
  readonly action?: true;
}

const KEY_BINDINGS: Readonly<Record<string, KeyBinding>> = {
  arrowleft: { axis: "left", lane: "first" },
  a: { axis: "left", lane: "first" },
  arrowright: { axis: "right", lane: "last" },
  d: { axis: "right", lane: "last" },
  arrowup: { axis: "up" },
  w: { axis: "up" },
  arrowdown: { axis: "down", lane: "middle" },
  s: { axis: "down", lane: "middle" },
  " ": { action: true },
  enter: { action: true },
};

function applyDeadZone(value: number, deadZone: number): number {
  return Math.abs(value) < deadZone ? 0 : Math.max(-1, Math.min(1, value));
}

export function createArcadeInput(options: ArcadeInputOptions): ArcadeInput {
  const surface = options.surface;
  const lanes = options.lanes ?? DEFAULT_LANES;
  const stickRadiusPx = options.stickRadiusPx ?? DEFAULT_STICK_RADIUS_PX;
  const deadZone = options.deadZone ?? DEFAULT_DEAD_ZONE;
  if (!Number.isInteger(lanes) || lanes < 1 || lanes > 9) {
    throw new RangeError("Arcade input lanes must be an integer from 1 through 9");
  }
  if (!Number.isFinite(stickRadiusPx) || stickRadiusPx <= 0) {
    throw new RangeError("Arcade input stick radius must be finite and positive");
  }
  if (!Number.isFinite(deadZone) || deadZone < 0 || deadZone >= 1) {
    throw new RangeError("Arcade input dead zone must be in [0, 1)");
  }

  const document = surface.ownerDocument;
  const view = document.defaultView;
  const releaseStyles = acquireArcadeKitStyles(document);

  // Surface baseline captured for exact restore on dispose.
  const hadSurfaceClass = surface.classList.contains("ak-input-surface");
  const previousTabIndex = surface.getAttribute("tabindex");
  surface.classList.add("ak-input-surface");
  if (previousTabIndex === null) surface.setAttribute("tabindex", "0");

  const listeners = new Set<ArcadeInputListener>();
  let enabled = true;
  let disposed = false;

  let axisX = 0;
  let axisY = 0;
  let lane: number | null = null;
  let actionHeld = false;

  let activePointerId: number | null = null;
  let pointerOriginX = 0;
  let pointerOriginY = 0;
  let pointerStickX = 0;
  let pointerStickY = 0;
  let pointerLane: number | null = null;
  const heldAxisKeys = new Set<AxisKey>();
  const heldKeyboardLanes = new Set<number>();
  let keyboardActionKeys = 0;

  const emit = (event: ArcadeInputEvent): void => {
    for (const listener of [...listeners]) listener(event);
  };

  const laneHeld = (): boolean => pointerLane !== null || heldKeyboardLanes.size > 0;

  const recomputeAxis = (source: ArcadeInputSource): void => {
    let x: number;
    let y: number;
    if (activePointerId !== null) {
      x = applyDeadZone(pointerStickX, deadZone);
      y = applyDeadZone(pointerStickY, deadZone);
    } else {
      x = (heldAxisKeys.has("right") ? 1 : 0) - (heldAxisKeys.has("left") ? 1 : 0);
      y = (heldAxisKeys.has("down") ? 1 : 0) - (heldAxisKeys.has("up") ? 1 : 0);
    }
    if (x !== axisX || y !== axisY) {
      axisX = x;
      axisY = y;
      emit({ kind: "axis-changed", x, y, source });
    }
  };

  const laneForBinding = (binding: KeyBinding["lane"]): number => {
    if (binding === "first") return 0;
    if (binding === "last") return lanes - 1;
    return Math.floor((lanes - 1) / 2);
  };

  const laneAtClientX = (clientX: number): number => {
    const rect = surface.getBoundingClientRect();
    const width = Math.max(1, rect.width);
    const ratio = (clientX - rect.left) / width;
    return Math.min(lanes - 1, Math.max(0, Math.floor(ratio * lanes)));
  };

  const pressLane = (nextLane: number, source: ArcadeInputSource): void => {
    lane = nextLane;
    emit({ kind: "lane-pressed", lane: nextLane, source });
  };

  const releaseLane = (releasedLane: number, source: ArcadeInputSource): void => {
    emit({ kind: "lane-released", lane: releasedLane, source });
  };

  const clearHeld = (reason: ArcadeHeldClearReason): void => {
    const hadHeld =
      activePointerId !== null ||
      heldAxisKeys.size > 0 ||
      heldKeyboardLanes.size > 0 ||
      keyboardActionKeys > 0 ||
      actionHeld ||
      axisX !== 0 ||
      axisY !== 0;
    if (pointerLane !== null) {
      releaseLane(pointerLane, "pointer");
      pointerLane = null;
    }
    for (const heldLane of [...heldKeyboardLanes]) releaseLane(heldLane, "keyboard");
    activePointerId = null;
    pointerStickX = 0;
    pointerStickY = 0;
    heldAxisKeys.clear();
    heldKeyboardLanes.clear();
    keyboardActionKeys = 0;
    if (actionHeld) {
      actionHeld = false;
      emit({ kind: "action-released", source: "keyboard" });
    }
    if (axisX !== 0 || axisY !== 0) {
      axisX = 0;
      axisY = 0;
      emit({ kind: "axis-changed", x: 0, y: 0, source: "pointer" });
    }
    if (hadHeld) emit({ kind: "held-cleared", reason });
  };

  const onPointerDown = (event: PointerEvent): void => {
    if (!enabled || activePointerId !== null) return;
    activePointerId = event.pointerId;
    pointerOriginX = event.clientX;
    pointerOriginY = event.clientY;
    pointerStickX = 0;
    pointerStickY = 0;
    try {
      surface.setPointerCapture?.(event.pointerId);
    } catch {
      // Capture is best-effort; synthetic pointers may not support it.
    }
    pointerLane = laneAtClientX(event.clientX);
    pressLane(pointerLane, "pointer");
    recomputeAxis("pointer");
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (!enabled || event.pointerId !== activePointerId) return;
    pointerStickX = (event.clientX - pointerOriginX) / stickRadiusPx;
    pointerStickY = (event.clientY - pointerOriginY) / stickRadiusPx;
    const nextLane = laneAtClientX(event.clientX);
    if (pointerLane !== null && nextLane !== pointerLane) {
      releaseLane(pointerLane, "pointer");
      pointerLane = nextLane;
      pressLane(nextLane, "pointer");
    }
    recomputeAxis("pointer");
  };

  const onPointerEnd = (event: PointerEvent): void => {
    if (event.pointerId !== activePointerId) return;
    activePointerId = null;
    pointerStickX = 0;
    pointerStickY = 0;
    if (pointerLane !== null) {
      releaseLane(pointerLane, "pointer");
      pointerLane = null;
    }
    recomputeAxis("pointer");
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (!enabled || event.repeat) return;
    const key = event.key.toLowerCase();
    if (/^[1-9]$/u.test(key)) {
      const digitLane = Number(key) - 1;
      if (digitLane >= lanes) return;
      event.preventDefault();
      if (!heldKeyboardLanes.has(digitLane)) {
        heldKeyboardLanes.add(digitLane);
        pressLane(digitLane, "keyboard");
      }
      return;
    }
    const binding = KEY_BINDINGS[key];
    if (!binding) return;
    event.preventDefault();
    if (binding.action) {
      keyboardActionKeys += 1;
      if (!actionHeld) {
        actionHeld = true;
        emit({ kind: "action-pressed", source: "keyboard" });
      }
      return;
    }
    if (binding.axis) heldAxisKeys.add(binding.axis);
    if (binding.lane !== undefined) {
      const boundLane = laneForBinding(binding.lane);
      if (!heldKeyboardLanes.has(boundLane)) {
        heldKeyboardLanes.add(boundLane);
        pressLane(boundLane, "keyboard");
      }
    }
    recomputeAxis("keyboard");
  };

  const onKeyUp = (event: KeyboardEvent): void => {
    const key = event.key.toLowerCase();
    if (/^[1-9]$/u.test(key)) {
      const digitLane = Number(key) - 1;
      if (heldKeyboardLanes.delete(digitLane)) releaseLane(digitLane, "keyboard");
      return;
    }
    const binding = KEY_BINDINGS[key];
    if (!binding) return;
    if (binding.action) {
      keyboardActionKeys = Math.max(0, keyboardActionKeys - 1);
      if (keyboardActionKeys === 0 && actionHeld) {
        actionHeld = false;
        emit({ kind: "action-released", source: "keyboard" });
      }
      return;
    }
    if (binding.axis) heldAxisKeys.delete(binding.axis);
    if (binding.lane !== undefined) {
      const boundLane = laneForBinding(binding.lane);
      if (heldKeyboardLanes.delete(boundLane)) releaseLane(boundLane, "keyboard");
    }
    recomputeAxis("keyboard");
  };

  const onBlur = (): void => {
    clearHeld("blur");
  };
  const onVisibilityChange = (): void => {
    if (document.visibilityState === "hidden") clearHeld("hidden");
  };

  const pointerDownListener: EventListener = (event) => {
    onPointerDown(event as PointerEvent);
  };
  const pointerMoveListener: EventListener = (event) => {
    onPointerMove(event as PointerEvent);
  };
  const pointerEndListener: EventListener = (event) => {
    onPointerEnd(event as PointerEvent);
  };
  const keyDownListener: EventListener = (event) => {
    onKeyDown(event as KeyboardEvent);
  };
  const keyUpListener: EventListener = (event) => {
    onKeyUp(event as KeyboardEvent);
  };

  surface.addEventListener("pointerdown", pointerDownListener);
  surface.addEventListener("pointermove", pointerMoveListener);
  surface.addEventListener("pointerup", pointerEndListener);
  surface.addEventListener("pointercancel", pointerEndListener);
  surface.addEventListener("keydown", keyDownListener);
  surface.addEventListener("keyup", keyUpListener);
  view?.addEventListener("blur", onBlur);
  document.addEventListener("visibilitychange", onVisibilityChange);

  return {
    get state(): ArcadeInputState {
      return { axisX, axisY, lane, laneHeld: laneHeld(), actionHeld };
    },
    get enabled(): boolean {
      return enabled;
    },
    subscribe(listener: ArcadeInputListener): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setEnabled(next: boolean): void {
      if (enabled === next) return;
      enabled = next;
      if (!next) clearHeld("disabled");
    },
    clearHeld(): void {
      clearHeld("manual");
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      clearHeld("dispose");
      surface.removeEventListener("pointerdown", pointerDownListener);
      surface.removeEventListener("pointermove", pointerMoveListener);
      surface.removeEventListener("pointerup", pointerEndListener);
      surface.removeEventListener("pointercancel", pointerEndListener);
      surface.removeEventListener("keydown", keyDownListener);
      surface.removeEventListener("keyup", keyUpListener);
      view?.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      listeners.clear();
      if (!hadSurfaceClass) surface.classList.remove("ak-input-surface");
      if (previousTabIndex === null) surface.removeAttribute("tabindex");
      else surface.setAttribute("tabindex", previousTabIndex);
      releaseStyles();
    },
  };
}
