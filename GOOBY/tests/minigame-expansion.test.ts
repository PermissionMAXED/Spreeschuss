import { describe, expect, it } from "vitest";
import { EXPANSION_MINIGAME_IDS, MINIGAME_IDS } from "../src/core/contracts/scenes";
import { DE_CATALOG, EN_CATALOG } from "../src/i18n";
import { MINIGAME_MANIFESTS, MINIGAME_REGISTRY } from "../src/minigames/registry";

describe("expansion minigame modules", () => {
  it("exposes a complete specialist module and final manifest for all twelve expansion ids", () => {
    expect(EXPANSION_MINIGAME_IDS).toHaveLength(12);
    for (const id of EXPANSION_MINIGAME_IDS) {
      const manifest = MINIGAME_MANIFESTS.get(id);
      expect(manifest, `missing manifest for ${id}`).toBeDefined();
      expect(manifest?.stage3d).toBe(false);
      expect(manifest?.unlockLevel).toBe(1);
      const module = MINIGAME_REGISTRY.get(id)?.();
      expect(module?.id).toBe(id);
      expect(module?.title).toBe(EN_CATALOG.minigames[id].title);
      expect(module?.instructions).toBe(EN_CATALOG.minigames[id].instructions);
      expect(module?.payout(), `${id} must not pay out before a run`).toEqual({
        score: 0,
        coins: 0,
        xp: 0,
      });
      module?.dispose();
    }
  });

  it("carries zero checkpoint stub or dev markers on any of the twenty-four manifests", () => {
    for (const id of MINIGAME_IDS) {
      const manifest = MINIGAME_MANIFESTS.get(id);
      expect(manifest, `missing manifest for ${id}`).toBeDefined();
      if (!manifest) continue;
      expect("dev" in manifest, `${id} must not carry dev metadata`).toBe(false);
      const serialized = JSON.stringify(manifest);
      expect(serialized, `${id} must not mention checkpoint stubs`).not.toMatch(/cpStub|checkpoint/u);
    }
  });

  it("localizes every tutorial step differently in english and german", () => {
    for (const id of EXPANSION_MINIGAME_IDS) {
      const manifest = MINIGAME_MANIFESTS.get(id);
      expect(manifest?.title.en).toBe(EN_CATALOG.minigames[id].title);
      expect(manifest?.title.de).toBe(DE_CATALOG.minigames[id].title);
      expect(manifest?.tutorial.length).toBeGreaterThan(0);
      for (const step of manifest?.tutorial ?? []) {
        expect(step.body.en).not.toBe(step.body.de);
      }
    }
  });
});
