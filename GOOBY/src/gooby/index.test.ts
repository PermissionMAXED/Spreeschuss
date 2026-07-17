import {
  BoxGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Texture,
} from "three";
import { describe, expect, it } from "vitest";
import type {
  AssetKey,
  AssetLoader,
  AssetValue,
  LoadedAsset,
} from "../core/contracts/assets";
import { deriveCareMood } from "../data/emotions";
import {
  CHARACTER_TRIANGLE_BUDGET,
  COSMETIC_ATTACHMENTS,
  COSMETIC_SOCKETS,
  ProceduralGooby,
  countCharacterTriangles,
} from ".";
import type { BufferGeometry, Material, Object3D } from "three";

interface PendingLoad {
  readonly key: AssetKey;
  resolve(value: Object3D): void;
  reject(reason: Error): void;
}

class DeferredAssetLoader implements AssetLoader {
  readonly pending: PendingLoad[] = [];

  load<T extends AssetValue = AssetValue>(key: AssetKey): Promise<LoadedAsset<T>> {
    return new Promise((resolve, reject) => {
      this.pending.push({
        key,
        resolve: (value) => {
          resolve({ key, value: value as T, source: "procedural" });
        },
        reject,
      });
    });
  }

  preload(): Promise<readonly LoadedAsset[]> {
    return Promise.resolve([]);
  }

  dispose(): void {
    // The actor does not own injected loaders.
  }
}

const cosmetic = (withTexture = false): {
  readonly root: Group;
  readonly geometry: BoxGeometry;
  readonly material: MeshStandardMaterial;
  readonly texture: Texture | null;
} => {
  const root = new Group();
  const geometry = new BoxGeometry(0.2, 0.2, 0.2);
  const material = new MeshStandardMaterial();
  const texture = withTexture ? new Texture() : null;
  material.map = texture;
  root.add(new Mesh(geometry, material));
  return { root, geometry, material, texture };
};

describe("care mood derivation", () => {
  it("covers every needs-driven mood at explicit thresholds", () => {
    expect(deriveCareMood({ hunger: 96, energy: 96, hygiene: 96, fun: 96 })).toBe("ecstatic");
    expect(deriveCareMood({ hunger: 72, energy: 72, hygiene: 72, fun: 72 })).toBe("happy");
    expect(deriveCareMood({ hunger: 55, energy: 55, hygiene: 55, fun: 55 })).toBe("content");
    expect(deriveCareMood({ hunger: 34, energy: 70, hygiene: 70, fun: 70 })).toBe("hungry");
    expect(deriveCareMood({ hunger: 70, energy: 34, hygiene: 70, fun: 70 })).toBe("sleepy");
    expect(deriveCareMood({ hunger: 70, energy: 70, hygiene: 34, fun: 70 })).toBe("dirty");
    expect(deriveCareMood({ hunger: 70, energy: 70, hygiene: 70, fun: 34 })).toBe("bored");
    expect(deriveCareMood({ hunger: 19, energy: 19, hygiene: 70, fun: 70 })).toBe("sad");
  });

  it("uses recovery bands to prevent boundary flicker", () => {
    expect(deriveCareMood({ hunger: 36, energy: 75, hygiene: 75, fun: 75 }, "hungry")).toBe("hungry");
    expect(deriveCareMood({ hunger: 45, energy: 75, hygiene: 75, fun: 75 }, "hungry")).toBe("content");
    expect(deriveCareMood({ hunger: 28, energy: 28, hygiene: 75, fun: 75 }, "sad")).toBe("sad");
    expect(deriveCareMood({ hunger: 29, energy: 29, hygiene: 75, fun: 75 }, "sad")).toBe("hungry");
    expect(deriveCareMood({ hunger: 82, energy: 88, hygiene: 88, fun: 88 }, "ecstatic")).toBe("ecstatic");
    expect(deriveCareMood({ hunger: 79, energy: 88, hygiene: 88, fun: 88 }, "ecstatic")).toBe("happy");
  });
});

describe("ProceduralGooby reactions", () => {
  it("transitions through reaction phases and persistent sleep", () => {
    const actor = new ProceduralGooby();
    actor.react("pet");
    expect(actor.activeReaction).toBe("pet");
    actor.update(1.2, 1.2);
    expect(actor.reactionPhase).toBe("idle");

    actor.react("tickle");
    expect(actor.reactionPhase).toBe("tickle-1");
    actor.react("tickle");
    expect(actor.reactionPhase).toBe("tickle-2");
    actor.react("tickle");
    expect(actor.reactionPhase).toBe("tickle-3");

    actor.react("feed");
    expect(actor.reactionPhase).toBe("anticipate");
    actor.update(0.3, 1.5);
    expect(actor.reactionPhase).toBe("chew");
    actor.update(1.2, 2.7);
    expect(actor.reactionPhase).toBe("swallow");

    actor.setSleeping(true);
    expect(actor.reactionPhase).toBe("fall-asleep");
    actor.update(1.7, 4.4);
    expect(actor.reactionPhase).toBe("sleep");
    actor.setSleeping(false);
    expect(actor.reactionPhase).toBe("wake-stretch");
    actor.update(1.5, 5.9);
    expect(actor.reactionPhase).toBe("idle");
    actor.dispose();
  });

  it("gives pet, poke, bathe, celebrate, and sad distinct poses", () => {
    const actor = new ProceduralGooby();
    const rig = actor.root.getObjectByName("Gooby.animation-rig");
    if (!rig) throw new Error("Animation rig is missing");

    actor.react("pet");
    actor.update(0.45, 0.45);
    const petRotation = rig.rotation.z;
    actor.react("poke");
    actor.update(0.3, 0.75);
    const pokeRotation = rig.rotation.z;
    actor.react("bathe");
    actor.update(0.3, 1.05);
    const batheOffset = rig.position.x;
    actor.react("celebrate");
    actor.update(0.45, 1.5);
    const celebrateHeight = rig.position.y;
    actor.react("sad");
    actor.update(0.45, 1.95);
    const sadScale = rig.scale.y;

    expect(petRotation).toBeGreaterThan(0.02);
    expect(pokeRotation).toBeLessThan(-0.02);
    expect(Math.abs(batheOffset)).toBeGreaterThan(0.005);
    expect(celebrateHeight).toBeGreaterThan(0.08);
    expect(sadScale).toBeGreaterThan(1);
    actor.dispose();
  });

  it("updates layered motion without growing the scene graph or resource set", () => {
    const actor = new ProceduralGooby();
    const objects: Object3D[] = [];
    actor.root.traverse((object) => objects.push(object));
    const resources = actor.resourceCount;
    actor.react("tickle");
    actor.react("tickle");
    actor.react("tickle");
    for (let frame = 0; frame < 600; frame += 1) actor.update(1 / 60, frame / 60);
    const after: Object3D[] = [];
    actor.root.traverse((object) => after.push(object));

    expect(after).toEqual(objects);
    expect(actor.resourceCount).toBe(resources);
    actor.dispose();
  });
});

describe("ProceduralGooby production constraints", () => {
  it("stays within the complete rendered triangle budget", () => {
    const actor = new ProceduralGooby();
    expect(actor.triangleCount).toBe(countCharacterTriangles(actor.root));
    expect(actor.triangleCount).toBeGreaterThan(5_000);
    expect(actor.triangleCount).toBeLessThanOrEqual(CHARACTER_TRIANGLE_BUDGET);
    actor.dispose();
  });

  it("parents every socket from the authoritative descriptor, including ears", () => {
    const actor = new ProceduralGooby();
    for (const socket of COSMETIC_SOCKETS) {
      const anchor = actor.getCosmeticSocket(socket);
      const descriptor = COSMETIC_ATTACHMENTS[socket];
      expect(anchor.parent?.name).toBe(
        descriptor.parent === "head" ? "Gooby.head-rig" : "Gooby.animation-rig",
      );
      expect(anchor.position.toArray()).toEqual([...descriptor.anchorPosition]);
      expect(anchor.rotation.toArray().slice(0, 3)).toEqual([...descriptor.anchorRotation]);
    }
    actor.dispose();
  });

  it("keeps only the newest cosmetic and disposes replaced or raced assets", async () => {
    const loader = new DeferredAssetLoader();
    const actor = new ProceduralGooby({ assetLoader: loader });
    const raced = cosmetic();
    const first = cosmetic();
    const replacement = cosmetic();
    let racedDisposals = 0;
    let firstDisposals = 0;
    let replacementDisposals = 0;
    raced.geometry.addEventListener("dispose", () => racedDisposals += 1);
    raced.material.addEventListener("dispose", () => racedDisposals += 1);
    first.geometry.addEventListener("dispose", () => firstDisposals += 1);
    first.material.addEventListener("dispose", () => firstDisposals += 1);
    replacement.geometry.addEventListener("dispose", () => replacementDisposals += 1);
    replacement.material.addEventListener("dispose", () => replacementDisposals += 1);

    const racedRequest = actor.equipCosmetic("head", "icon.heart");
    const firstRequest = actor.equipCosmetic("head", "food.carrot");
    loader.pending[1]?.resolve(first.root);
    await expect(firstRequest).resolves.toBe(true);
    loader.pending[0]?.resolve(raced.root);
    await expect(racedRequest).resolves.toBe(false);
    expect(racedDisposals).toBe(2);
    expect(actor.getCosmeticKey("head")).toBe("food.carrot");

    const replacementRequest = actor.equipCosmetic("head", "icon.coin");
    loader.pending[2]?.resolve(replacement.root);
    await expect(replacementRequest).resolves.toBe(true);
    expect(firstDisposals).toBe(2);
    expect(actor.getCosmeticKey("head")).toBe("icon.coin");
    expect(replacementDisposals).toBe(0);

    actor.dispose();
    expect(replacementDisposals).toBe(2);
    expect(actor.resourceCount).toBe(0);
  });

  it("disposes a cosmetic that resolves after actor teardown", async () => {
    const loader = new DeferredAssetLoader();
    const actor = new ProceduralGooby({ assetLoader: loader });
    const late = cosmetic();
    let disposals = 0;
    late.geometry.addEventListener("dispose", () => disposals += 1);
    late.material.addEventListener("dispose", () => disposals += 1);
    const request = actor.equipCosmetic("back", "icon.heart");

    actor.dispose();
    loader.pending[0]?.resolve(late.root);
    await expect(request).resolves.toBe(false);
    expect(disposals).toBe(2);
    expect(actor.resourceCount).toBe(0);
  });

  it("keeps a constant resource count through twenty re-equips", async () => {
    const loader = new DeferredAssetLoader();
    const actor = new ProceduralGooby({ assetLoader: loader });
    const baseline = actor.resourceCount;
    let disposedResources = 0;

    for (let index = 0; index < 20; index += 1) {
      const next = cosmetic(true);
      next.geometry.addEventListener("dispose", () => disposedResources += 1);
      next.material.addEventListener("dispose", () => disposedResources += 1);
      next.texture?.addEventListener("dispose", () => disposedResources += 1);
      const request = actor.equipCosmetic("head", "icon.heart");
      loader.pending[index]?.resolve(next.root);
      await expect(request).resolves.toBe(true);
      expect(actor.resourceCount).toBe(baseline + 3);
      expect(actor.getCosmeticSocket("head").children).toHaveLength(1);
    }

    expect(disposedResources).toBe(19 * 3);
    actor.dispose();
    expect(disposedResources).toBe(20 * 3);
    expect(actor.resourceCount).toBe(0);
  });

  it("keeps the current cosmetic and resource set when a newer async load fails", async () => {
    const loader = new DeferredAssetLoader();
    const actor = new ProceduralGooby({ assetLoader: loader });
    const current = cosmetic();
    const first = actor.equipCosmetic("head", "food.carrot");
    loader.pending[0]?.resolve(current.root);
    await expect(first).resolves.toBe(true);
    const resources = actor.resourceCount;

    const failed = actor.equipCosmetic("head", "icon.coin");
    loader.pending[1]?.reject(new Error("fixture load failed"));
    await expect(failed).resolves.toBe(false);
    expect(actor.getCosmeticKey("head")).toBe("food.carrot");
    expect(actor.resourceCount).toBe(resources);
    expect(actor.getCosmeticSocket("head").children).toHaveLength(1);
    actor.dispose();
  });

  it("disposes every owned geometry and material exactly once", () => {
    const actor = new ProceduralGooby();
    const resources = new Set<BufferGeometry | Material>();
    const disposed = new Set<BufferGeometry | Material>();
    actor.root.traverse((object) => {
      const renderable = object as Object3D & {
        geometry?: BufferGeometry;
        material?: Material | Material[];
      };
      if (renderable.geometry) resources.add(renderable.geometry);
      const materials = Array.isArray(renderable.material)
        ? renderable.material
        : renderable.material
          ? [renderable.material]
          : [];
      for (const material of materials) resources.add(material);
    });
    for (const resource of resources) {
      resource.addEventListener("dispose", () => disposed.add(resource));
    }

    expect(actor.resourceCount).toBe(resources.size);
    actor.dispose();
    actor.dispose();
    expect(disposed.size).toBe(resources.size);
    expect(actor.resourceCount).toBe(0);
    expect(actor.root.children).toHaveLength(0);
  });
});
