export type Gesture =
  | { readonly type: "tap"; readonly x: number; readonly y: number }
  | { readonly type: "double-tap"; readonly x: number; readonly y: number }
  | { readonly type: "press-start"; readonly x: number; readonly y: number }
  | { readonly type: "press-move"; readonly x: number; readonly y: number; readonly dx: number; readonly dy: number }
  | { readonly type: "press-end"; readonly x: number; readonly y: number; readonly durationMs: number }
  | { readonly type: "swipe"; readonly x: number; readonly y: number; readonly dx: number; readonly dy: number };

export type GestureHandler = (gesture: Gesture) => void;

export interface InputPort {
  subscribe(handler: GestureHandler): () => void;
  setEnabled(enabled: boolean): void;
  dispose(): void;
}

export interface DriveControls {
  readonly steering: number;
  readonly braking: boolean;
  readonly steeringHeld: boolean;
  readonly brakeHeld: boolean;
}
