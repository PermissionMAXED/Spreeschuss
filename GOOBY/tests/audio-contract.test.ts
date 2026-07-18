import { describe, expect, it } from "vitest";
import {
  AUDIO_BUSES,
  clampBusVolume,
  createVoiceCueRequest,
  DEFAULT_AUDIO_BUS_VOLUMES,
  effectiveBusGain,
  isAudioBus,
  VOICE_CUES,
  withBusVolume,
} from "../src/core/contracts/audio";

describe("audio bus contract", () => {
  it("fixes the five-bus topology with sensible defaults", () => {
    expect(AUDIO_BUSES).toEqual(["master", "music", "sfx", "ui", "voice"]);
    for (const bus of AUDIO_BUSES) {
      const volume = DEFAULT_AUDIO_BUS_VOLUMES[bus];
      expect(volume).toBeGreaterThanOrEqual(0);
      expect(volume).toBeLessThanOrEqual(1);
    }
    expect(DEFAULT_AUDIO_BUS_VOLUMES.master).toBe(1);
  });

  it("guards and clamps volumes", () => {
    expect(isAudioBus("music")).toBe(true);
    expect(isAudioBus("dialog")).toBe(false);
    expect(isAudioBus(3)).toBe(false);
    expect(clampBusVolume(-1)).toBe(0);
    expect(clampBusVolume(2)).toBe(1);
    expect(clampBusVolume(0.4)).toBe(0.4);
    expect(clampBusVolume(Number.NaN)).toBe(1);
  });

  it("scales every non-master bus by master", () => {
    const volumes = withBusVolume(
      withBusVolume(DEFAULT_AUDIO_BUS_VOLUMES, "master", 0.5),
      "music",
      0.8,
    );
    expect(effectiveBusGain(volumes, "music")).toBeCloseTo(0.4);
    expect(effectiveBusGain(volumes, "master")).toBe(0.5);
    expect(effectiveBusGain(withBusVolume(volumes, "master", 0), "sfx")).toBe(0);
  });

  it("keeps the voice cue vocabulary unique and buildable into requests", () => {
    expect(new Set(VOICE_CUES).size).toBe(VOICE_CUES.length);
    expect(VOICE_CUES.length).toBeGreaterThan(0);
    const request = createVoiceCueRequest("voice-greeting", 2);
    expect(request).toEqual({ cue: "voice-greeting", bus: "voice", priority: 2 });
    expect(Object.isFrozen(request)).toBe(true);
    expect(() => createVoiceCueRequest("voice-happy", Number.NaN)).toThrow(RangeError);
  });
});
