import { describe, expect, it } from "vitest";
import { validateMinigameManifest } from "../../core/contracts/minigame";
import { manifest } from "./index";

describe("Library Stack manifest", () => {
  it("is final, bilingual, and uses the shared audio cue contract", () => {
    expect(validateMinigameManifest(manifest)).toBe(manifest);
    expect("dev" in manifest).toBe(false);
    expect(manifest.title.en).toBeTruthy();
    expect(manifest.title.de).toBeTruthy();
    expect(manifest.instructions.en).toBeTruthy();
    expect(manifest.instructions.de).toBeTruthy();
    expect(manifest.audioCues).toEqual([
      "countdown",
      "go",
      "hit",
      "miss",
      "combo",
      "score",
      "win",
    ]);
  });
});
