export function percentile(
  values: ArrayLike<number>,
  count: number,
  quantile: number,
  scratch = new Float64Array(Math.max(0, count)),
): number {
  const safeCount = Math.min(Math.max(0, Math.floor(count)), values.length, scratch.length);
  if (safeCount === 0) return 0;
  for (let index = 0; index < safeCount; index += 1) {
    scratch[index] = values[index] ?? 0;
  }
  const ordered = scratch.subarray(0, safeCount);
  ordered.sort();
  const normalized = Math.max(0, Math.min(1, quantile));
  const index = Math.min(safeCount - 1, Math.max(0, Math.ceil(normalized * safeCount) - 1));
  return ordered[index] ?? 0;
}

export interface ResourceMetrics {
  readonly geometries: number;
  readonly textures: number;
  readonly programs: number;
  readonly materials: number;
  readonly heapBytes: number | null;
}

export interface ResourceDiff {
  readonly geometries: number;
  readonly textures: number;
  readonly programs: number;
  readonly materials: number;
  readonly heapBytes: number | null;
}

export function diffResources(baseline: ResourceMetrics, current: ResourceMetrics): ResourceDiff {
  return {
    geometries: current.geometries - baseline.geometries,
    textures: current.textures - baseline.textures,
    programs: current.programs - baseline.programs,
    materials: current.materials - baseline.materials,
    heapBytes: baseline.heapBytes === null || current.heapBytes === null
      ? null
      : current.heapBytes - baseline.heapBytes,
  };
}

export function hasLikelyResourceLeak(diff: ResourceDiff, completedTransitions: number): boolean {
  if (completedTransitions < 5) return false;
  return diff.geometries > 2
    || diff.textures > 1
    || diff.programs > 1
    || diff.materials > 2
    || (diff.heapBytes !== null && diff.heapBytes > 8 * 1024 * 1024);
}
