import type { DriveControls } from "../../core/contracts/input";

export type DriveControlRegion = "steer-left" | "steer-right" | "brake";
export type CityDriveKey =
  | "ArrowLeft"
  | "ArrowRight"
  | "ArrowDown"
  | "KeyA"
  | "KeyD"
  | "KeyS"
  | "Space";

export interface NormalizedHitRegion {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export const CITY_HUD_RESERVED_REGIONS: readonly NormalizedHitRegion[] = [
  { x: 0, y: 0, width: 1, height: 0.3 },
  { x: 0, y: 0.85, width: 1, height: 0.15 },
] as const;

export const CITY_CONTROL_HIT_REGIONS: Readonly<Record<DriveControlRegion, NormalizedHitRegion>> = {
  "steer-left": { x: 0.05, y: 0.65, width: 0.25, height: 0.17 },
  brake: { x: 0.38, y: 0.65, width: 0.24, height: 0.17 },
  "steer-right": { x: 0.7, y: 0.65, width: 0.25, height: 0.17 },
} as const;

export function hitRegionsOverlap(a: NormalizedHitRegion, b: NormalizedHitRegion): boolean {
  return a.x < b.x + b.width
    && a.x + a.width > b.x
    && a.y < b.y + b.height
    && a.y + a.height > b.y;
}

interface HeldPointer {
  readonly region: DriveControlRegion;
  readonly magnitude: number;
}

export class DriveControlState {
  private readonly pointers = new Map<number, HeldPointer>();
  private readonly keys = new Set<CityDriveKey>();

  /**
   * Registers or updates a held pointer. `magnitude` carries the analog touch
   * position within a steer button (1 = full lock); the default keeps digital
   * taps at full strength.
   */
  press(pointerId: number, region: DriveControlRegion, magnitude = 1): DriveControls {
    this.pointers.set(pointerId, {
      region,
      magnitude: Math.max(0, Math.min(1, magnitude)),
    });
    return this.controls;
  }

  release(pointerId: number): DriveControls {
    this.pointers.delete(pointerId);
    return this.controls;
  }

  pressKey(code: string): DriveControls {
    if (isCityDriveKey(code)) this.keys.add(code);
    return this.controls;
  }

  releaseKey(code: string): DriveControls {
    if (isCityDriveKey(code)) this.keys.delete(code);
    return this.controls;
  }

  releaseAll(): DriveControls {
    this.pointers.clear();
    this.keys.clear();
    return this.controls;
  }

  get controls(): DriveControls {
    let left = this.keys.has("ArrowLeft") || this.keys.has("KeyA") ? 1 : 0;
    let right = this.keys.has("ArrowRight") || this.keys.has("KeyD") ? 1 : 0;
    let brake = this.keys.has("ArrowDown") || this.keys.has("KeyS") || this.keys.has("Space");
    for (const held of this.pointers.values()) {
      if (held.region === "steer-left") left = Math.max(left, held.magnitude);
      else if (held.region === "steer-right") right = Math.max(right, held.magnitude);
      else brake = true;
    }
    return {
      steering: Math.max(-1, Math.min(1, left - right)),
      braking: brake,
      steeringHeld: left > 0 || right > 0,
      brakeHeld: brake,
    };
  }
}

export function isCityDriveKey(code: string): code is CityDriveKey {
  return code === "ArrowLeft"
    || code === "ArrowRight"
    || code === "ArrowDown"
    || code === "KeyA"
    || code === "KeyD"
    || code === "KeyS"
    || code === "Space";
}

/**
 * Analog magnitude for a steer press: touches near the button's inner edge
 * (toward the brake) steer gently, the center and outer half give full lock.
 */
export function analogSteerMagnitude(
  region: DriveControlRegion,
  buttonLeft: number,
  buttonWidth: number,
  pointerX: number,
): number {
  if (region === "brake" || buttonWidth <= 0) return 1;
  const across = Math.max(0, Math.min(1, (pointerX - buttonLeft) / buttonWidth));
  const outward = region === "steer-left" ? 1 - across : across;
  return Math.max(0.35, Math.min(1, 0.35 + outward * 1.3));
}

export class CityPointerControls {
  private readonly state = new DriveControlState();
  private readonly disposers: Array<() => void> = [];
  private enabled = false;
  private readonly heldRegions = new Map<number, DriveControlRegion>();

  constructor(
    private readonly buttons: Readonly<Record<DriveControlRegion, HTMLButtonElement>>,
    private readonly onChange: (controls: DriveControls) => void,
  ) {
    for (const region of ["steer-left", "brake", "steer-right"] as const) {
      const button = buttons[region];
      const pressAt = (event: PointerEvent): void => {
        const rect = button.getBoundingClientRect();
        this.onChange(this.state.press(
          event.pointerId,
          region,
          analogSteerMagnitude(region, rect.left, rect.width, event.clientX),
        ));
        this.syncHeldClasses();
      };
      const down = (event: PointerEvent): void => {
        event.preventDefault();
        button.setPointerCapture(event.pointerId);
        this.heldRegions.set(event.pointerId, region);
        pressAt(event);
      };
      const move = (event: PointerEvent): void => {
        if (this.heldRegions.get(event.pointerId) !== region) return;
        event.preventDefault();
        pressAt(event);
      };
      const end = (event: PointerEvent): void => {
        event.preventDefault();
        this.heldRegions.delete(event.pointerId);
        this.onChange(this.state.release(event.pointerId));
        this.syncHeldClasses();
      };
      button.addEventListener("pointerdown", down);
      button.addEventListener("pointermove", move);
      button.addEventListener("pointerup", end);
      button.addEventListener("pointercancel", end);
      button.addEventListener("lostpointercapture", end);
      this.disposers.push(() => {
        button.removeEventListener("pointerdown", down);
        button.removeEventListener("pointermove", move);
        button.removeEventListener("pointerup", end);
        button.removeEventListener("pointercancel", end);
        button.removeEventListener("lostpointercapture", end);
      });
    }

    const keyDown = (event: KeyboardEvent): void => {
      if (!this.enabled || !isCityDriveKey(event.code)) return;
      event.preventDefault();
      this.onChange(this.state.pressKey(event.code));
      this.syncHeldClasses();
    };
    const keyUp = (event: KeyboardEvent): void => {
      if (!isCityDriveKey(event.code)) return;
      event.preventDefault();
      this.onChange(this.state.releaseKey(event.code));
      this.syncHeldClasses();
    };
    const release = (): void => this.releaseAll();
    const visibility = (): void => {
      if (document.visibilityState !== "visible") this.releaseAll();
    };
    window.addEventListener("keydown", keyDown);
    window.addEventListener("keyup", keyUp);
    window.addEventListener("blur", release);
    window.addEventListener("pagehide", release);
    document.addEventListener("visibilitychange", visibility);
    this.disposers.push(() => {
      window.removeEventListener("keydown", keyDown);
      window.removeEventListener("keyup", keyUp);
      window.removeEventListener("blur", release);
      window.removeEventListener("pagehide", release);
      document.removeEventListener("visibilitychange", visibility);
    });
  }

  get controls(): DriveControls {
    return this.state.controls;
  }

  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    if (!enabled) this.releaseAll();
  }

  releaseAll(): void {
    this.heldRegions.clear();
    this.onChange(this.state.releaseAll());
    this.syncHeldClasses();
  }

  dispose(): void {
    this.enabled = false;
    this.releaseAll();
    for (const dispose of this.disposers.splice(0)) dispose();
  }

  private syncHeldClasses(): void {
    const controls = this.state.controls;
    this.buttons["steer-left"].classList.toggle("is-held", controls.steeringHeld && controls.steering > 0);
    this.buttons["steer-right"].classList.toggle("is-held", controls.steeringHeld && controls.steering < 0);
    this.buttons.brake.classList.toggle("is-held", controls.brakeHeld);
  }
}
