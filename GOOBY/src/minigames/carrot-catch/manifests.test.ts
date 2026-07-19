import { describe, expect, it } from "vitest";
import { validateMinigameManifest } from "../../core/contracts/minigame";
import { manifest as carrotManifest } from "./index";
import { manifest as bunnyManifest } from "../bunny-hop";
import { manifest as pancakeManifest } from "../pancake-peak";

describe("deepened arcade trio manifests", () => {
  it("ships final English and German copy without checkpoint metadata", () => {
    const manifests = [carrotManifest, bunnyManifest, pancakeManifest];
    expect(manifests.map(({ id }) => id)).toEqual([
      "carrot-catch",
      "bunny-hop",
      "pancake-peak",
    ]);
    for (const manifest of manifests) {
      expect(validateMinigameManifest(manifest)).toBe(manifest);
      expect(manifest.title.en.trim()).not.toBe("");
      expect(manifest.title.de.trim()).not.toBe("");
      expect(manifest.instructions.en.trim()).not.toBe("");
      expect(manifest.instructions.de.trim()).not.toBe("");
      expect(manifest.dev).toBeUndefined();
      expect(manifest.stage3d).toBe(false);
    }
  });

  it("documents the new mechanics in both tutorial languages", () => {
    const englishBodies = (steps: readonly { readonly body: { readonly en: string } }[]): string =>
      steps.map((step) => step.body.en).join(" ");
    const germanBodies = (steps: readonly { readonly body: { readonly de: string } }[]): string =>
      steps.map((step) => step.body.de).join(" ");

    expect(englishBodies(carrotManifest.tutorial)).toMatch(/frenzy/iu);
    expect(englishBodies(carrotManifest.tutorial)).toMatch(/umbrella/iu);
    expect(englishBodies(carrotManifest.tutorial)).toMatch(/gust/iu);
    expect(germanBodies(carrotManifest.tutorial)).toMatch(/Schirm|Regenschirm/iu);

    expect(englishBodies(bunnyManifest.tutorial)).toMatch(/feather/iu);
    expect(englishBodies(bunnyManifest.tutorial)).toMatch(/night/iu);
    expect(germanBodies(bunnyManifest.tutorial)).toMatch(/Feder/iu);

    expect(englishBodies(pancakeManifest.tutorial)).toMatch(/syrup/iu);
    expect(englishBodies(pancakeManifest.tutorial)).toMatch(/tall-tower|endless/iu);
    expect(germanBodies(pancakeManifest.tutorial)).toMatch(/Sirup/iu);
  });
});
