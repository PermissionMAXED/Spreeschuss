import { describe, expect, it } from "vitest";
import { AdaptiveQualityGovernor, type GovernorOptions } from "./governor";

const options: GovernorOptions = {
  downgradeBelowFps: 40,
  downgradeSustainMs: 3_000,
  upgradeAboveFps: 54,
  upgradeSustainMs: 5_000,
  cooldownMs: 4_000,
};

describe("AdaptiveQualityGovernor", () => {
  it("requires sustained low FPS before downgrading", () => {
    const governor = new AdaptiveQualityGovernor(options);
    expect(governor.update(35, 1_000, 1_000, "high", "high", null)).toBeNull();
    expect(governor.update(35, 1_000, 2_000, "high", "high", null)).toBeNull();
    expect(governor.update(35, 1_000, 3_000, "high", "high", null)).toBe("mid");
  });

  it("uses a neutral hysteresis band to reset both streaks", () => {
    const governor = new AdaptiveQualityGovernor(options);
    expect(governor.update(35, 2_000, 2_000, "high", "high", null)).toBeNull();
    expect(governor.update(47, 1_000, 3_000, "high", "high", null)).toBeNull();
    expect(governor.update(35, 2_000, 5_000, "high", "high", null)).toBeNull();
  });

  it("honors cooldown and never exceeds the detected ceiling", () => {
    const governor = new AdaptiveQualityGovernor(options);
    expect(governor.update(35, 3_000, 3_000, "high", "high", null)).toBe("mid");
    expect(governor.update(60, 5_000, 6_000, "mid", "high", null)).toBeNull();
    expect(governor.update(60, 5_000, 10_000, "mid", "high", null)).toBe("high");
    expect(governor.update(60, 5_000, 20_000, "mid", "mid", null)).toBeNull();
  });

  it("disables automatic changes while a settings override is active", () => {
    const governor = new AdaptiveQualityGovernor(options);
    expect(governor.update(20, 30_000, 30_000, "high", "high", "high")).toBeNull();
    expect(governor.update(20, 2_000, 32_000, "high", "high", null)).toBeNull();
  });
});
