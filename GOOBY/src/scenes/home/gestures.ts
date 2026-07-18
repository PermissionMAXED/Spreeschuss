export type BellyGestureKind = "belly-rub" | "tickle" | "none";

export interface BellyGesturePoint {
  readonly x: number;
  readonly y: number;
}

export interface BellyGestureMetrics {
  readonly samples: number;
  readonly pathLength: number;
  readonly directDistance: number;
  readonly maximumSegment: number;
  readonly angularTravel: number;
  readonly normalizedPath: number;
  readonly normalizedMaximumSegment: number;
}

const distance = (left: BellyGesturePoint, right: BellyGesturePoint): number =>
  Math.hypot(right.x - left.x, right.y - left.y);

const angleBetween = (
  first: BellyGesturePoint,
  middle: BellyGesturePoint,
  last: BellyGesturePoint,
): number => {
  const ax = middle.x - first.x;
  const ay = middle.y - first.y;
  const bx = last.x - middle.x;
  const by = last.y - middle.y;
  const magnitude = Math.hypot(ax, ay) * Math.hypot(bx, by);
  if (magnitude < 0.0001) return 0;
  return Math.abs(Math.atan2(ax * by - ay * bx, ax * bx + ay * by));
};

export function measureBellyGesture(
  points: readonly BellyGesturePoint[],
  bellyScale: number,
): BellyGestureMetrics {
  const scale = Math.max(32, bellyScale);
  let pathLength = 0;
  let maximumSegment = 0;
  let angularTravel = 0;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const point = points[index];
    if (!previous || !point) continue;
    const segment = distance(previous, point);
    pathLength += segment;
    maximumSegment = Math.max(maximumSegment, segment);
    const beforePrevious = points[index - 2];
    if (beforePrevious) angularTravel += angleBetween(beforePrevious, previous, point);
  }
  const first = points[0];
  const last = points.at(-1);
  const directDistance = first && last ? distance(first, last) : 0;
  return {
    samples: points.length,
    pathLength,
    directDistance,
    maximumSegment,
    angularTravel,
    normalizedPath: pathLength / scale,
    normalizedMaximumSegment: maximumSegment / scale,
  };
}

/**
 * Classifies in belly-relative units, keeping the same feel on phones, tablets,
 * and accessibility-scaled layouts. A rub is either a rounded path or a
 * deliberate sequence of short drag segments; a tickle is a quick, sharp move.
 */
export function classifyBellyGesture(
  points: readonly BellyGesturePoint[],
  durationMs: number,
  bellyScale: number,
): BellyGestureKind {
  const metrics = measureBellyGesture(points, bellyScale);
  const circular =
    metrics.samples >= 5 &&
    metrics.normalizedPath >= 0.46 &&
    metrics.normalizedMaximumSegment <= 0.34 &&
    metrics.angularTravel >= 1.15;
  const deliberateSlowDrag =
    metrics.samples >= 4 &&
    metrics.normalizedPath >= 0.38 &&
    metrics.normalizedMaximumSegment <= 0.24 &&
    (durationMs >= 240 || metrics.samples >= 6);
  if (circular || deliberateSlowDrag) return "belly-rub";

  const quick = durationMs <= 0 || durationMs < 360;
  if (
    quick &&
    metrics.normalizedPath >= 0.18 &&
    (
      metrics.normalizedMaximumSegment >= 0.17 ||
      (metrics.samples <= 3 && metrics.normalizedPath >= 0.28)
    )
  ) {
    return "tickle";
  }
  return "none";
}

export class BellyGestureTracker {
  private points: BellyGesturePoint[] = [];
  private scale = 100;

  get active(): boolean {
    return this.points.length > 0;
  }

  get sampleCount(): number {
    return this.points.length;
  }

  begin(point: BellyGesturePoint, bellyScale: number): void {
    this.points = [point];
    this.scale = Math.max(32, bellyScale);
  }

  move(point: BellyGesturePoint): BellyGestureMetrics {
    const previous = this.points.at(-1);
    if (!previous || distance(previous, point) >= 1.5) this.points.push(point);
    return measureBellyGesture(this.points, this.scale);
  }

  classify(durationMs: number): BellyGestureKind {
    return classifyBellyGesture(this.points, durationMs, this.scale);
  }

  reset(): void {
    this.points = [];
  }
}
