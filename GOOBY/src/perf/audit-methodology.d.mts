export const MEASUREMENT_TRIALS: 3;

export interface WarmupOptions {
  readonly minimumSamples: number;
  readonly requiredStableObservations: number;
  readonly expectedQuality: string;
  readonly minimumPrograms: number;
  readonly maxFpsDriftRatio: number;
  readonly maxP95DriftRatio: number;
}

export interface WarmupObservation {
  readonly networkIdle: boolean;
  readonly appReady: boolean;
  readonly runtimeKey: string;
  readonly quality: string;
  readonly programs: number;
  readonly samples: number;
  readonly fps: number;
  readonly p95Ms: number;
}

export interface WarmupState {
  readonly ready: boolean;
  readonly stableObservations: number;
  readonly lastObservation: WarmupObservation | null;
  readonly reason: string;
}

export const DEFAULT_WARMUP_OPTIONS: Readonly<WarmupOptions>;
export function createWarmupState(): WarmupState;
export function advanceWarmupState(
  state: WarmupState,
  observation: WarmupObservation,
  overrides?: Partial<WarmupOptions>,
): WarmupState;

export interface AuditFrameSnapshot {
  readonly fps: number;
  readonly averageMs: number;
  readonly p95Ms: number;
  readonly samples: number;
}

export interface AuditRenderSnapshot {
  readonly drawCalls: number;
  readonly drawCallsP95: number;
  readonly triangles: number;
  readonly trianglesP95: number;
}

export interface AuditSnapshot {
  readonly frame: AuditFrameSnapshot;
  readonly render: AuditRenderSnapshot;
  readonly [key: string]: unknown;
}

export interface PerformanceTrialSummary<T extends AuditSnapshot> {
  readonly snapshot: T;
  readonly trialCount: number;
  readonly samplesPerTrial: readonly number[];
  readonly timingAggregation: "median";
  readonly workBudgetAggregation: "maximum";
}

export interface TimingLimits {
  readonly minFps: number;
  readonly maxP95Ms: number;
}

export function median(values: readonly number[], label?: string): number;
export function summarizePerformanceTrials<T extends AuditSnapshot>(
  snapshots: readonly T[],
  minimumSamples: number,
  expectedTrials?: number,
): PerformanceTrialSummary<T>;
export function assertTimingLimits(
  label: string,
  snapshot: AuditSnapshot,
  timing: TimingLimits,
): void;
export function sustainedSlowProbeIsRejected(
  timing: TimingLimits,
  minimumSamples: number,
  fps?: number,
): boolean;
