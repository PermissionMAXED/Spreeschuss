import { describe, expect, it } from "vitest";
import { validateMinigameManifest } from "../../core/contracts/minigame";
import { manifest as cannonManifest } from "../carrot-cannon";
import { manifest as deliveryManifest } from "../delivery-dash";
import { manifest as gardenManifest } from ".";

describe("deepened arcade trio manifests", () => {
  it("ships final localized contracts without development metadata", () => {
    const manifests = [gardenManifest, cannonManifest, deliveryManifest];
    expect(manifests.map(({ id }) => id)).toEqual([
      "garden-moles",
      "carrot-cannon",
      "delivery-dash",
    ]);
    expect(manifests.map(({ unlockLevel }) => unlockLevel)).toEqual([4, 4, 5]);

    for (const manifest of manifests) {
      expect(validateMinigameManifest(manifest)).toBe(manifest);
      expect(manifest.title.en.trim()).not.toBe("");
      expect(manifest.title.de.trim()).not.toBe("");
      expect(manifest.instructions.en.trim()).not.toBe("");
      expect(manifest.instructions.de.trim()).not.toBe("");
      expect(manifest.tutorial).toHaveLength(4);
      expect(manifest.audioCues.length).toBeGreaterThan(0);
      expect("dev" in manifest).toBe(false);
      expect(manifest.stage3d).toBe(false);
    }
  });
});
