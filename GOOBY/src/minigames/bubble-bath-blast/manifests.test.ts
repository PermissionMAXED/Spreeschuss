import { describe, expect, it } from "vitest";
import { validateMinigameManifest } from "../../core/contracts/minigame";
import { manifest as bubbleManifest } from "./index";
import { manifest as saysManifest } from "../gooby-says";
import { manifest as veggieManifest } from "../veggie-sort";

describe("deepened minigame manifests", () => {
  it("ships final English and German copy without checkpoint metadata", () => {
    const manifests = [bubbleManifest, veggieManifest, saysManifest];
    expect(manifests.map(({ id }) => id)).toEqual([
      "bubble-bath-blast",
      "veggie-sort",
      "gooby-says",
    ]);
    for (const manifest of manifests) {
      expect(validateMinigameManifest(manifest)).toBe(manifest);
      expect(manifest.title.en.trim()).not.toBe("");
      expect(manifest.title.de.trim()).not.toBe("");
      expect(manifest.instructions.en.trim()).not.toBe("");
      expect(manifest.instructions.de.trim()).not.toBe("");
      expect(manifest.dev).toBeUndefined();
    }
  });
});
