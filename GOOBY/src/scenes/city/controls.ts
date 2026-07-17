import type { DriveControls } from "../../core/contracts/input";

export type DriveControlRegion = "steer-left" | "steer-right" | "brake";

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

export class DriveControlState {
  private readonly pointers = new Map<number, DriveControlRegion>();

  press(pointerId: number, region: DriveControlRegion): DriveControls {
    this.pointers.set(pointerId, region);
    return this.controls;
  }

  release(pointerId: number): DriveControls {
    this.pointers.delete(pointerId);
    return this.controls;
  }

  releaseAll(): DriveControls {
    this.pointers.clear();
    return this.controls;
  }

  get controls(): DriveControls {
    const active = new Set(this.pointers.values());
    const left = active.has("steer-left");
    const right = active.has("steer-right");
    const brake = active.has("brake");
    return {
      steering: left === right ? 0 : left ? 1 : -1,
      braking: brake,
      steeringHeld: left || right,
      brakeHeld: brake,
    };
  }
}

export class CityPointerControls {
  private readonly state = new DriveControlState();
  private readonly disposers: Array<() => void> = [];

  constructor(
    buttons: Readonly<Record<DriveControlRegion, HTMLButtonElement>>,
    private readonly onChange: (controls: DriveControls) => void,
  ) {
    for (const region of ["steer-left", "brake", "steer-right"] as const) {
      const button = buttons[region];
      const down = (event: PointerEvent): void => {
        event.preventDefault();
        button.setPointerCapture(event.pointerId);
        button.classList.add("is-held");
        this.onChange(this.state.press(event.pointerId, region));
      };
      const end = (event: PointerEvent): void => {
        event.preventDefault();
        button.classList.remove("is-held");
        this.onChange(this.state.release(event.pointerId));
      };
      button.addEventListener("pointerdown", down);
      button.addEventListener("pointerup", end);
      button.addEventListener("pointercancel", end);
      button.addEventListener("lostpointercapture", end);
      this.disposers.push(() => {
        button.removeEventListener("pointerdown", down);
        button.removeEventListener("pointerup", end);
        button.removeEventListener("pointercancel", end);
        button.removeEventListener("lostpointercapture", end);
      });
    }
  }

  get controls(): DriveControls {
    return this.state.controls;
  }

  releaseAll(): void {
    this.onChange(this.state.releaseAll());
  }

  dispose(): void {
    this.releaseAll();
    for (const dispose of this.disposers.splice(0)) dispose();
  }
}
