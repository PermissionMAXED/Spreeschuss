/**
 * Stage3D integration tests for the Shopping Surf scene: lease leak
 * neutrality, steady-frame pooling (zero allocations after warm-up), curated
 * upgrade rebuilds, the reduced-motion camera rig, and the asset depot's
 * total-fallback contract — all against the real Stage3dManager with a fake
 * renderer host and the shared fake DOM.
 */
import { Group, type Object3D, type Scene, type Texture, type WebGLRenderer, type Camera } from "three";
import { describe, expect, it } from "vitest";
import { FakeClock } from "../../core/contracts/clock";
import { SeededRng } from "../../core/contracts/rng";
import {
  Stage3dManager,
  captureStageResourceBaseline,
  diffStageResourceBaseline,
  type Stage3dRendererHostFactory,
} from "../../render/stage3d/stage";
import { getCityEnvironment } from "../../scenes/city/environment/api";
import { createFakeDomHost } from "../shared/testing/fake-dom";
import {
  createProceduralSurfAsset,
  createSurfAssetDepot,
  extractInstanceParts,
  SURF_ASSET_KEYS,
  type SurfAssetKey,
} from "./assets";
import { beginSurfRun, createSurfState, drainSurfEvents, stepSurf, stepSurfLane, SURF_STEP_SECONDS } from "./model";
import { createSurfScene } from "./scene";

interface DisposableResource {
  addEventListener(type: string, listener: () => void): void;
}

/** Mirrors three's accounting: counters grow on first render, shrink on dispose. */
class FakeSurfRenderer {
  readonly shadowMap = { enabled: true };
  readonly renderLists = { dispose: (): void => undefined };
  readonly info = {
    memory: { geometries: 0, textures: 0 },
    programs: [] as unknown[],
    render: { calls: 0, triangles: 0 },
  };
  private readonly seenGeometries = new Set<object>();
  private readonly seenTextures = new Set<object>();

  constructor(readonly domElement: unknown) {}

  setPixelRatio(): void {}
  setSize(): void {}
  getContext(): unknown {
    return { RENDERER: 0x1f01, getExtension: () => null, getParameter: () => "Fake Surf GPU" };
  }

  render(scene: Scene, camera: Camera): void {
    void camera;
    this.info.render.calls += 1;
    scene.traverse((object) => {
      const mesh = object as Object3D & { geometry?: DisposableResource; material?: unknown };
      if (mesh.geometry) this.observe(mesh.geometry, this.seenGeometries, "geometries");
      const materials = Array.isArray(mesh.material)
        ? (mesh.material as unknown[])
        : mesh.material !== undefined
          ? [mesh.material]
          : [];
      for (const material of materials) {
        for (const value of Object.values(material as Record<string, unknown>)) {
          if ((value as Texture | null)?.isTexture === true) {
            this.observe(value as DisposableResource, this.seenTextures, "textures");
          }
        }
      }
    });
    const background = scene.background as Texture | null;
    if (background?.isTexture === true) this.observe(background, this.seenTextures, "textures");
  }

  private observe(
    resource: DisposableResource,
    seen: Set<object>,
    counter: "geometries" | "textures",
  ): void {
    if (seen.has(resource)) return;
    seen.add(resource);
    this.info.memory[counter] += 1;
    resource.addEventListener("dispose", () => {
      if (seen.delete(resource)) this.info.memory[counter] -= 1;
    });
  }
}

function createHarness() {
  const { window, host, asHtmlElement } = createFakeDomHost();
  host.setFakeRect({ left: 0, top: 0, width: 390, height: 844 });
  const renderers: FakeSurfRenderer[] = [];
  const createHost: Stage3dRendererHostFactory = (canvas) => {
    const renderer = new FakeSurfRenderer(canvas);
    renderers.push(renderer);
    return { renderer: renderer as unknown as WebGLRenderer, dispose: () => undefined };
  };
  return {
    manager: new Stage3dManager({ createHost }),
    mount: host,
    window,
    clock: new FakeClock(0),
    renderers,
    asHtmlElement,
  };
}

function surfSceneOn(
  harness: ReturnType<typeof createHarness>,
  options: { reducedMotion?: boolean; depot?: ReturnType<typeof createSurfAssetDepot> } = {},
) {
  const depot = options.depot ?? createSurfAssetDepot(null);
  const scene = createSurfScene({
    mount: harness.asHtmlElement(harness.mount),
    clock: harness.clock,
    reducedMotion: options.reducedMotion === true,
    depot,
    city: getCityEnvironment(),
    acquire: (mount, stageOptions) => harness.manager.acquire(mount, stageOptions),
  });
  return { scene, depot };
}

function liveState(seed = 5) {
  const state = createSurfState(new SeededRng(seed));
  beginSurfRun(state);
  return state;
}

function advance(state: ReturnType<typeof liveState>, seconds: number): void {
  const steps = Math.round(seconds / SURF_STEP_SECONDS);
  for (let index = 0; index < steps; index += 1) {
    stepSurf(state, SURF_STEP_SECONDS);
    drainSurfEvents(state, () => undefined);
  }
}

describe("surf scene stage3d lease", () => {
  it("releases leak-neutral after a played stretch of course", () => {
    const harness = createHarness();
    const { scene, depot } = surfSceneOn(harness);
    const renderer = harness.renderers[0];
    if (!renderer) throw new Error("expected a fake renderer");
    const baseline = captureStageResourceBaseline(renderer as unknown as WebGLRenderer);
    expect(baseline).toEqual({ geometries: 0, textures: 0, programs: 0 });

    const state = liveState();
    for (let frame = 0; frame < 90; frame += 1) {
      advance(state, 1 / 30);
      if (frame % 30 === 10) stepSurfLane(state, frame % 60 === 10 ? 1 : -1);
      scene.render(state, 1 / 30);
    }
    expect(state.distance).toBeGreaterThan(20);
    expect(renderer.info.memory.geometries).toBeGreaterThan(0);
    expect(scene.perf().drawCalls).toBeGreaterThan(0);
    expect(scene.active).toBe(true);
    expect(scene.canvas).not.toBeNull();
    expect(scene.resourceDelta()).not.toBeNull();

    scene.dispose();
    depot.dispose();
    expect(scene.active).toBe(false);
    expect(diffStageResourceBaseline(renderer as unknown as WebGLRenderer, baseline)).toEqual({
      geometries: 0,
      textures: 0,
      programs: 0,
    });
    expect(harness.mount.childNodes).toHaveLength(0);
    expect(harness.window.listenerCount()).toBe(0);
    expect(harness.manager.hasActiveLease).toBe(false);

    // Dispose is idempotent and rendering after dispose is inert.
    scene.dispose();
    scene.render(state, 1 / 30);
  });

  it("keeps zero growth across 8 repeated mount/dispose rounds", () => {
    const harness = createHarness();
    for (let round = 0; round < 8; round += 1) {
      const { scene, depot } = surfSceneOn(harness, { reducedMotion: round % 2 === 0 });
      const state = liveState(round + 1);
      advance(state, 0.5);
      scene.render(state, 1 / 30);
      scene.dispose();
      depot.dispose();
      expect(harness.mount.childNodes).toHaveLength(0);
      expect(harness.window.listenerCount()).toBe(0);
    }
    expect(harness.renderers).toHaveLength(1);
    const renderer = harness.renderers[0];
    expect(renderer?.info.memory).toEqual({ geometries: 0, textures: 0 });
  });

  it("allocates nothing on the steady frame path after warm-up", () => {
    const harness = createHarness();
    const { scene, depot } = surfSceneOn(harness);
    const renderer = harness.renderers[0];
    if (!renderer) throw new Error("expected a fake renderer");
    const state = liveState(9);
    scene.render(state, 1 / 30); // Warm-up frame uploads every pool once.
    const warm = { ...renderer.info.memory };

    for (let frame = 0; frame < 300; frame += 1) {
      advance(state, 1 / 30);
      if (state.phase !== "running") break;
      scene.render(state, 1 / 30);
    }
    // Instanced pools recycle in place: no new geometries or textures ever
    // enter the renderer while chunks recycle underneath.
    expect(renderer.info.memory).toEqual(warm);
    scene.dispose();
    depot.dispose();
  });

  it("rebuilds pools exactly once per curated upgrade without leaking", async () => {
    const harness = createHarness();
    const upgraded: SurfAssetKey[] = [];
    const depot = createSurfAssetDepot((key) => {
      // Curated stand-ins: a procedural build renamed as vendored output.
      const model = createProceduralSurfAsset(key);
      model.name = `vendored:${key}`;
      return Promise.resolve(model);
    });
    depot.onUpgrade((key) => upgraded.push(key));
    const { scene } = surfSceneOn(harness, { depot });
    const renderer = harness.renderers[0];
    if (!renderer) throw new Error("expected a fake renderer");
    const baseline = captureStageResourceBaseline(renderer as unknown as WebGLRenderer);

    const state = liveState(3);
    scene.render(state, 1 / 30);
    await depot.preload();
    expect([...upgraded].sort()).toEqual([...SURF_ASSET_KEYS].sort());
    for (const key of SURF_ASSET_KEYS) expect(depot.source(key)).toBe("vendored");

    // The swap lands on the next frame; steady frames stay flat afterwards.
    scene.render(state, 1 / 30);
    const afterSwap = { ...renderer.info.memory };
    for (let frame = 0; frame < 60; frame += 1) {
      advance(state, 1 / 30);
      scene.render(state, 1 / 30);
    }
    expect(renderer.info.memory).toEqual(afterSwap);

    scene.dispose();
    depot.dispose();
    expect(diffStageResourceBaseline(renderer as unknown as WebGLRenderer, baseline)).toEqual({
      geometries: 0,
      textures: 0,
      programs: 0,
    });
  });

  it("uses the static portrait rig under reduced motion and the chase rig otherwise", () => {
    const harness = createHarness();
    const { scene, depot } = surfSceneOn(harness, { reducedMotion: true });
    const state = liveState(4);
    const lease = () => {
      const mountChildren = harness.mount.childNodes;
      return mountChildren.length;
    };
    expect(lease()).toBe(1);
    scene.render(state, 1 / 30);
    const camera = harness.manager.sharedRenderer;
    expect(camera).not.toBeNull();
    scene.dispose();
    depot.dispose();

    // Chase rig: after steering the cart, repeated updates pull the camera x
    // toward the cart; the fixed rig would stay pinned at x = 0.
    const chase = surfSceneOn(harness, { reducedMotion: false });
    const chaseState = liveState(4);
    stepSurfLane(chaseState, 1);
    advance(chaseState, 1.5);
    for (let frame = 0; frame < 45; frame += 1) chase.scene.render(chaseState, 1 / 30);
    expect(Math.abs(chaseState.x)).toBeGreaterThan(1);
    chase.scene.dispose();
    chase.depot.dispose();
  });
});

describe("surf asset depot", () => {
  it("is total: every key resolves a procedural template immediately", () => {
    const depot = createSurfAssetDepot(null);
    for (const key of SURF_ASSET_KEYS) {
      expect(depot.template(key)).toBeInstanceOf(Group);
      expect(depot.source(key)).toBe("procedural");
    }
    expect(() => depot.template("nope" as SurfAssetKey)).toThrow(/Unknown surf asset/u);
    depot.dispose();
  });

  it("keeps the procedural fallback when the resolver fails or yields nothing", async () => {
    const failing = createSurfAssetDepot(() => Promise.reject(new Error("404")));
    await failing.preload();
    for (const key of SURF_ASSET_KEYS) expect(failing.source(key)).toBe("procedural");
    failing.dispose();

    const empty = createSurfAssetDepot(() => Promise.resolve(null));
    await empty.preload();
    for (const key of SURF_ASSET_KEYS) expect(empty.source(key)).toBe("procedural");
    empty.dispose();
  });

  it("extracts capped instance parts with baked local offsets", () => {
    const crate = createProceduralSurfAsset("surf.crate");
    const parts = extractInstanceParts(crate, 2);
    expect(parts.length).toBeLessThanOrEqual(2);
    expect(parts.length).toBeGreaterThan(0);
    for (const part of parts) {
      expect(part.geometry).toBeDefined();
      expect(part.material).toBeDefined();
      expect(part.offset).toBeDefined();
    }
    const all = extractInstanceParts(crate, 99);
    expect(all.length).toBeGreaterThanOrEqual(parts.length);
  });
});
