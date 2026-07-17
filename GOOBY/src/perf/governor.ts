import type { QualityTier } from "../render/quality";

export interface GovernorOptions {
  readonly downgradeBelowFps: number;
  readonly downgradeSustainMs: number;
  readonly upgradeAboveFps: number;
  readonly upgradeSustainMs: number;
  readonly cooldownMs: number;
}

export const DEFAULT_GOVERNOR_OPTIONS: GovernorOptions = Object.freeze({
  downgradeBelowFps: 40,
  downgradeSustainMs: 6_000,
  upgradeAboveFps: 54,
  upgradeSustainMs: 30_000,
  cooldownMs: 20_000,
});

const TIER_ORDER: readonly QualityTier[] = ["low", "mid", "high"];

export function lowerTier(tier: QualityTier): QualityTier {
  const index = TIER_ORDER.indexOf(tier);
  return TIER_ORDER[Math.max(0, index - 1)] ?? "low";
}

export function higherTier(tier: QualityTier, ceiling: QualityTier): QualityTier {
  const index = TIER_ORDER.indexOf(tier);
  const ceilingIndex = TIER_ORDER.indexOf(ceiling);
  return TIER_ORDER[Math.min(ceilingIndex, index + 1)] ?? ceiling;
}

export class AdaptiveQualityGovernor {
  private lowFpsMs = 0;
  private highFpsMs = 0;
  private lastChangeAt = Number.NEGATIVE_INFINITY;

  constructor(private readonly options: GovernorOptions = DEFAULT_GOVERNOR_OPTIONS) {}

  reset(now = Number.NEGATIVE_INFINITY): void {
    this.lowFpsMs = 0;
    this.highFpsMs = 0;
    this.lastChangeAt = now;
  }

  update(
    fps: number,
    elapsedMs: number,
    now: number,
    active: QualityTier,
    ceiling: QualityTier,
    override: QualityTier | null,
  ): QualityTier | null {
    if (
      override !== null
      || !Number.isFinite(fps)
      || !Number.isFinite(elapsedMs)
      || elapsedMs <= 0
      || !Number.isFinite(now)
    ) {
      this.lowFpsMs = 0;
      this.highFpsMs = 0;
      return null;
    }
    if (now - this.lastChangeAt < this.options.cooldownMs) {
      this.lowFpsMs = 0;
      this.highFpsMs = 0;
      return null;
    }

    if (fps < this.options.downgradeBelowFps) {
      this.lowFpsMs += elapsedMs;
      this.highFpsMs = 0;
    } else if (fps > this.options.upgradeAboveFps) {
      this.highFpsMs += elapsedMs;
      this.lowFpsMs = 0;
    } else {
      this.lowFpsMs = 0;
      this.highFpsMs = 0;
    }

    if (this.lowFpsMs >= this.options.downgradeSustainMs && active !== "low") {
      this.lastChangeAt = now;
      this.lowFpsMs = 0;
      this.highFpsMs = 0;
      return lowerTier(active);
    }
    if (this.highFpsMs >= this.options.upgradeSustainMs && active !== ceiling) {
      const upgraded = higherTier(active, ceiling);
      if (upgraded !== active) {
        this.lastChangeAt = now;
        this.lowFpsMs = 0;
        this.highFpsMs = 0;
        return upgraded;
      }
    }
    return null;
  }
}
