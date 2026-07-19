/**
 * Stage3D integration tests for the Cloud Bounce scene: lease leak
 * neutrality, steady-frame instanced pooling (zero renderer growth after
 * warm-up), the reduced-motion focus snap, and perf counters — all against
 * the real Stage3dManager with a fake renderer host and the shared fake DOM.
 */
import { type Camera, type Object3D, type Scene, type Texture, type WebGLRenderer } from "three";
import { describe, expect, it } from "vitest";
import { FakeClock } from "../../core/contracts/clock";
import { SeededRng } from "../../core/contracts/rng";
import {
  Stage3dManager,
  captureStageResourceBaseline,
  diffStageResourceBaseline,
  type Stage3dRendererHostFactory,
} from "../../render/stage3d/stage";
import { createFakeDomHost } from "../shared/testing/fake-dom";
import {
  beginCloudRun,
  CLOUD_STEP_SECONDS,
  createCloudState,
  drainCloudEvents,
  setCloudDrift,
  stepCloud,
} from "./model";
import { createCloudScene } from "./scene";

interface DisposableResource {
  addEventListener(type: string, listener: () => void): void;
}

/** Mirrors three's accounting: counters grow on first render, shrink on dispose. */
class FakeCloudRenderer {
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
    return { RENDERER: 0x1f01, getExtension: () => null, getParameter: () => "Fake Cloud GPU" };
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
  const renderers: FakeCloudRenderer[] = [];
  const createHost: Stage3dRendererHostFactory = (canvas) => {
    const renderer = new FakeCloudRenderer(canvas);
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

function cloudSceneOn(
  harness: ReturnType<typeof createHarness>,
  options: { reducedMotion?: boolean } = {},
) {
  return createCloudScene({
    mount: harness.asHtmlElement(harness.mount),
    clock: harness.clock,
    reducedMotion: options.reducedMotion === true,
    acquire: (mount, stageOptions) => harness.manager.acquire(mount, stageOptions),
  });
}

function liveState(seed = 5) {
  const state = createCloudState(new SeededRng(seed));
  beginCloudRun(state);
  return state;
}

function advance(state: ReturnType<typeof liveState>, seconds: number): void {
  const steps = Math.round(seconds / CLOUD_STEP_SECONDS);
  for (let index = 0; index < steps; index += 1) {
    stepCloud(state, CLOUD_STEP_SECONDS);
    drainCloudEvents(state, () => undefined);
  }
}

describe("cloud bounce stage3d lease", () => {
  it("releases leak-neutral after a played stretch of sky", () => {
    const harness = createHarness();
    const scene = cloudSceneOn(harness);
    const renderer = harness.renderers[0];
    if (!renderer) throw new Error("expected a fake renderer");
    const baseline = captureStageResourceBaseline(renderer as unknown as WebGLRenderer);
    expect(baseline).toEqual({ geometries: 0, textures: 0, programs: 0 });

    const state = liveState();
    for (let frame = 0; frame < 120; frame += 1) {
      // Keep the climb honest: hop the model up so pools recycle heavily.
      if (frame % 40 === 20 && state.phase === "running") {
        state.vy = 3;
        setCloudDrift(state, frame % 80 === 20 ? 1 : -1);
      }
      advance(state, 1 / 30);
      scene.render(state, 1 / 30);
    }
    expect(state.bestY).toBeGreaterThan(2);
    expect(renderer.info.memory.geometries).toBeGreaterThan(0);
    expect(scene.perf().drawCalls).toBeGreaterThan(0);
    expect(scene.active).toBe(true);
    expect(scene.canvas).not.toBeNull();
    expect(scene.resourceDelta()).not.toBeNull();

    scene.dispose();
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
      const scene = cloudSceneOn(harness, { reducedMotion: round % 2 === 0 });
      const state = liveState(round + 1);
      advance(state, 0.5);
      scene.render(state, 1 / 30);
      scene.dispose();
      expect(harness.mount.childNodes).toHaveLength(0);
      expect(harness.window.listenerCount()).toBe(0);
    }
    expect(harness.renderers).toHaveLength(1);
    const renderer = harness.renderers[0];
    expect(renderer?.info.memory).toEqual({ geometries: 0, textures: 0 });
  });

  it("allocates nothing on the steady frame path after warm-up", () => {
    const harness = createHarness();
    const scene = cloudSceneOn(harness);
    const renderer = harness.renderers[0];
    if (!renderer) throw new Error("expected a fake renderer");
    const state = liveState(9);
    scene.render(state, 1 / 30); // Warm-up frame uploads every pool once.
    const warm = { ...renderer.info.memory };

    for (let frame = 0; frame < 300; frame += 1) {
      // Periodic super-leaps drive generation, recycling, wind bands and
      // fading clouds through the instanced pools.
      if (frame % 50 === 25 && state.phase === "running") state.vy = 3;
      advance(state, 1 / 30);
      scene.render(state, 1 / 30);
    }
    // Instanced pools recycle in place: no new geometries or textures ever
    // enter the renderer while cloud slots recycle underneath.
    expect(renderer.info.memory).toEqual(warm);
    expect(state.bestY).toBeGreaterThan(4);
    scene.dispose();
  });

  it("snaps the view focus under reduced motion and eases it otherwise", () => {
    const harness = createHarness();
    const snap = cloudSceneOn(harness, { reducedMotion: true });
    const state = liveState(4);
    advance(state, 0.5);
    state.vy = 3;
    advance(state, 0.8);
    expect(state.cameraY).toBeGreaterThan(1);
    snap.render(state, 1 / 30);
    expect(snap.focusY()).toBe(state.cameraY);
    snap.dispose();

    // The eased focus lags the same jump, then converges over time.
    const eased = cloudSceneOn(harness, { reducedMotion: false });
    eased.render(state, 1 / 30);
    expect(eased.focusY()).toBeLessThan(state.cameraY);
    for (let frame = 0; frame < 90; frame += 1) eased.render(state, 1 / 30);
    expect(Math.abs(eased.focusY() - state.cameraY)).toBeLessThan(0.02);
    eased.dispose();
  });

  it("reports draw call and triangle counters through perf()", () => {
    const harness = createHarness();
    const scene = cloudSceneOn(harness);
    expect(scene.perf()).toEqual({ drawCalls: 0, triangles: 0 });
    const state = liveState(2);
    advance(state, 0.2);
    scene.render(state, 1 / 30);
    expect(scene.perf().drawCalls).toBeGreaterThan(0);
    scene.dispose();
    expect(scene.canvas).toBeNull();
  });
});
