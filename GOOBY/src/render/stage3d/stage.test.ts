import {
  BoxGeometry,
  DataTexture,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  type Camera,
  type Object3D,
  type Scene,
  type Texture,
  type WebGLRenderer,
} from "three";
import { describe, expect, it } from "vitest";
import { FakeClock } from "../../core/contracts/clock";
import {
  createFakeDomHost,
  type FakeElement,
  type FakeWindow,
} from "../../minigames/shared/testing/fake-dom";
import { QUALITY_PRESETS } from "../quality";
import {
  Stage3dManager,
  captureStageResourceBaseline,
  diffStageResourceBaseline,
  type Stage3dRendererHostFactory,
} from "./stage";

interface DisposableResource {
  addEventListener(type: string, listener: () => void): void;
}

/**
 * Emulates the parts of `WebGLRenderer` the stage and the quality runtime
 * touch, including three's real accounting model: `info.memory` counters grow
 * when resources are first rendered and shrink on their `dispose` events.
 */
class FakeStageRenderer {
  readonly shadowMap = { enabled: true };
  pixelRatio = 0;
  readonly sizes: Array<{ readonly width: number; readonly height: number }> = [];
  readonly renderCalls: Array<{ readonly scene: Scene; readonly camera: Camera }> = [];
  renderListDisposals = 0;
  readonly renderLists = {
    dispose: (): void => {
      this.renderListDisposals += 1;
    },
  };
  readonly info = {
    memory: { geometries: 0, textures: 0 },
    programs: [] as unknown[],
    render: { calls: 0, triangles: 0 },
  };
  private readonly seenGeometries = new Set<object>();
  private readonly seenTextures = new Set<object>();

  constructor(readonly domElement: unknown) {}

  setPixelRatio(ratio: number): void {
    this.pixelRatio = ratio;
  }

  setSize(width: number, height: number): void {
    this.sizes.push({ width, height });
  }

  getContext(): unknown {
    return {
      RENDERER: 0x1f01,
      getExtension: () => null,
      getParameter: () => "Fake Stage GPU",
    };
  }

  render(scene: Scene, camera: Camera): void {
    this.renderCalls.push({ scene, camera });
    this.info.render.calls += 1;
    scene.traverse((object) => {
      const mesh = object as Object3D & {
        geometry?: DisposableResource;
        material?: unknown;
      };
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
    if (background?.isTexture === true) {
      this.observe(background, this.seenTextures, "textures");
    }
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

interface StageHarness {
  readonly manager: Stage3dManager;
  readonly mount: FakeElement;
  readonly window: FakeWindow;
  readonly clock: FakeClock;
  readonly renderers: FakeStageRenderer[];
  readonly hostDisposals: () => number;
  readonly asHtmlElement: (element: FakeElement) => HTMLElement;
}

function createStageHarness(): StageHarness {
  const { window, host, asHtmlElement } = createFakeDomHost();
  host.setFakeRect({ left: 0, top: 0, width: 390, height: 844 });
  const renderers: FakeStageRenderer[] = [];
  let disposals = 0;
  const createHost: Stage3dRendererHostFactory = (canvas) => {
    const renderer = new FakeStageRenderer(canvas);
    renderers.push(renderer);
    return {
      renderer: renderer as unknown as WebGLRenderer,
      dispose: () => {
        disposals += 1;
      },
    };
  };
  return {
    manager: new Stage3dManager({ createHost }),
    mount: host,
    window,
    clock: new FakeClock(0),
    renderers,
    hostDisposals: () => disposals,
    asHtmlElement,
  };
}

function trackDisposals(resources: readonly DisposableResource[]): () => number {
  let disposed = 0;
  for (const resource of resources) {
    resource.addEventListener("dispose", () => {
      disposed += 1;
    });
  }
  return () => disposed;
}

function buildSceneContent(): {
  readonly meshes: Mesh[];
  readonly disposedCount: () => number;
  readonly background: DataTexture;
} {
  const sharedGeometry = new BoxGeometry(1, 1, 1);
  const texture = new DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  const texturedMaterial = new MeshStandardMaterial({ map: texture });
  const plainMaterial = new MeshBasicMaterial();
  const multiMesh = new Mesh(new BoxGeometry(2, 1, 1), [texturedMaterial, plainMaterial]);
  const simpleMesh = new Mesh(sharedGeometry, texturedMaterial);
  const childMesh = new Mesh(sharedGeometry, new MeshBasicMaterial());
  simpleMesh.add(childMesh);
  const background = new DataTexture(new Uint8Array([10, 20, 30, 255]), 1, 1);
  const disposedCount = trackDisposals([
    sharedGeometry,
    multiMesh.geometry,
    texture,
    texturedMaterial,
    plainMaterial,
    childMesh.material,
    background,
  ]);
  return { meshes: [multiMesh, simpleMesh], disposedCount, background };
}

describe("stage3d lease lifecycle", () => {
  it("releases back to geometry/material/texture/DOM/listener baselines", () => {
    const harness = createStageHarness();
    const lease = harness.manager.acquire(harness.asHtmlElement(harness.mount), {
      clock: harness.clock,
    });
    const renderer = harness.renderers[0];
    if (!renderer) throw new Error("expected a fake renderer");
    const baseline = captureStageResourceBaseline(lease.renderer);
    expect(baseline).toEqual({ geometries: 0, textures: 0, programs: 0 });
    expect(harness.mount.childNodes).toHaveLength(1);
    expect(harness.window.listenerCount("resize")).toBe(1);

    const content = buildSceneContent();
    for (const mesh of content.meshes) lease.scene.add(mesh);
    lease.scene.background = content.background;
    lease.renderOnce();
    expect(renderer.info.memory.geometries).toBe(2);
    expect(renderer.info.memory.textures).toBe(2);
    expect(renderer.renderCalls.length).toBeGreaterThan(0);

    lease.release();
    expect(lease.released).toBe(true);
    expect(content.disposedCount()).toBe(7);
    expect(lease.scene.children).toHaveLength(0);
    expect(lease.scene.background).toBeNull();
    expect(diffStageResourceBaseline(lease.renderer, baseline)).toEqual({
      geometries: 0,
      textures: 0,
      programs: 0,
    });
    expect(harness.mount.childNodes).toHaveLength(0);
    expect(harness.window.listenerCount("resize")).toBe(0);
    expect(renderer.renderListDisposals).toBe(1);
    expect(harness.hostDisposals()).toBe(0);

    lease.release();
    expect(() => lease.renderOnce()).toThrow(/released/u);
    expect(() => lease.resize()).toThrow(/released/u);
    expect(() => lease.setLoop(() => undefined)).toThrow(/released/u);
  });

  it("keeps one cached renderer across 32 repeated leases with zero growth", () => {
    const harness = createStageHarness();
    let firstCanvas: unknown = null;
    for (let cycle = 0; cycle < 32; cycle += 1) {
      const lease = harness.manager.acquire(harness.asHtmlElement(harness.mount), {
        clock: harness.clock,
      });
      firstCanvas ??= lease.canvas;
      expect(lease.canvas).toBe(firstCanvas);
      const mesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial());
      lease.scene.add(mesh);
      lease.renderOnce();
      lease.release();
      expect(harness.mount.childNodes).toHaveLength(0);
      expect(harness.window.listenerCount()).toBe(0);
      expect(harness.window.pendingFrameCount).toBe(0);
    }
    expect(harness.renderers).toHaveLength(1);
    expect(harness.hostDisposals()).toBe(0);
    const renderer = harness.renderers[0];
    expect(renderer?.info.memory).toEqual({ geometries: 0, textures: 0 });
    expect(harness.manager.hasActiveLease).toBe(false);

    harness.manager.dispose();
    expect(harness.hostDisposals()).toBe(1);
    expect(() =>
      harness.manager.acquire(harness.asHtmlElement(harness.mount), { clock: harness.clock }),
    ).toThrow(/disposed/u);
  });

  it("rejects concurrent leases until the active one is released", () => {
    const harness = createStageHarness();
    const mountElement = harness.asHtmlElement(harness.mount);
    const lease = harness.manager.acquire(mountElement, { clock: harness.clock });
    expect(() => harness.manager.acquire(mountElement, { clock: harness.clock })).toThrow(
      /already active/u,
    );
    lease.release();
    const second = harness.manager.acquire(mountElement, { clock: harness.clock });
    second.release();
  });

  it("resizes deterministically with quality-capped pixel ratios", () => {
    const harness = createStageHarness();
    const lease = harness.manager.acquire(harness.asHtmlElement(harness.mount), {
      clock: harness.clock,
      quality: "low",
    });
    const renderer = harness.renderers[0];
    if (!renderer) throw new Error("expected a fake renderer");
    expect(renderer.shadowMap.enabled).toBe(QUALITY_PRESETS.low.shadows);
    expect(lease.camera.far).toBe(QUALITY_PRESETS.low.drawDistance);

    const explicit = lease.resize({ width: 390, height: 844, pixelRatio: 3 });
    expect(explicit).toEqual({ width: 390, height: 844, pixelRatio: 1 });
    expect(lease.resize({ width: 390, height: 844, pixelRatio: 3 })).toEqual(explicit);
    expect(lease.camera.aspect).toBeCloseTo(390 / 844, 12);

    const measured = lease.resize();
    expect(measured).toEqual({ width: 390, height: 844, pixelRatio: 1 });
    lease.release();

    const highLease = harness.manager.acquire(harness.asHtmlElement(harness.mount), {
      clock: harness.clock,
      quality: "high",
    });
    expect(renderer.shadowMap.enabled).toBe(QUALITY_PRESETS.high.shadows);
    expect(highLease.camera.far).toBe(QUALITY_PRESETS.high.drawDistance);
    expect(highLease.resize({ width: 200, height: 400, pixelRatio: 3 })).toEqual({
      width: 200,
      height: 400,
      pixelRatio: 2,
    });
    // Window resizes re-measure the mount deterministically.
    harness.mount.setFakeRect({ left: 0, top: 0, width: 300, height: 500 });
    harness.window.dispatch("resize");
    expect(renderer.sizes.at(-1)).toEqual({ width: 300, height: 500 });
    highLease.release();
  });

  it("drives the loop from the injected clock and stops it on demand", () => {
    const harness = createStageHarness();
    const lease = harness.manager.acquire(harness.asHtmlElement(harness.mount), {
      clock: harness.clock,
    });
    const renderer = harness.renderers[0];
    if (!renderer) throw new Error("expected a fake renderer");
    const deltas: number[] = [];
    lease.setLoop((dt) => deltas.push(dt));
    expect(lease.looping).toBe(true);

    harness.window.flushFrames();
    harness.clock.advance(16);
    harness.window.flushFrames();
    harness.clock.advance(1_000_000);
    harness.window.flushFrames();
    expect(deltas).toEqual([0, 0.016, 0.25]);
    expect(renderer.renderCalls).toHaveLength(3);

    lease.setLoop(null);
    expect(lease.looping).toBe(false);
    expect(harness.window.pendingFrameCount).toBe(0);
    harness.window.flushFrames();
    expect(deltas).toHaveLength(3);

    // Releasing while paused (loop stopped) restores every baseline.
    lease.release();
    expect(harness.mount.childNodes).toHaveLength(0);
    expect(harness.window.listenerCount()).toBe(0);
  });

  it("stops the loop and still restores baselines when a frame callback throws", () => {
    const harness = createStageHarness();
    const lease = harness.manager.acquire(harness.asHtmlElement(harness.mount), {
      clock: harness.clock,
    });
    const content = buildSceneContent();
    for (const mesh of content.meshes) lease.scene.add(mesh);
    lease.scene.background = content.background;
    let frames = 0;
    lease.setLoop(() => {
      frames += 1;
      if (frames === 2) throw new Error("boom mid-frame");
    });
    harness.window.flushFrames();
    harness.clock.advance(16);
    expect(() => harness.window.flushFrames()).toThrow(/boom mid-frame/u);
    expect(lease.looping).toBe(false);
    expect(harness.window.pendingFrameCount).toBe(0);

    lease.release();
    expect(content.disposedCount()).toBe(7);
    expect(harness.mount.childNodes).toHaveLength(0);
    expect(harness.window.listenerCount()).toBe(0);
    expect(harness.manager.hasActiveLease).toBe(false);
  });

  it("restores DOM and listener baselines even when a disposal step throws", () => {
    const harness = createStageHarness();
    const lease = harness.manager.acquire(harness.asHtmlElement(harness.mount), {
      clock: harness.clock,
    });
    const grenade = new BoxGeometry(1, 1, 1);
    grenade.dispose = () => {
      throw new Error("gpu driver hiccup");
    };
    lease.scene.add(new Mesh(grenade, new MeshBasicMaterial()));
    lease.renderOnce();

    expect(() => lease.release()).toThrow(/gpu driver hiccup/u);
    expect(lease.released).toBe(true);
    expect(harness.mount.childNodes).toHaveLength(0);
    expect(harness.window.listenerCount()).toBe(0);
    expect(harness.manager.hasActiveLease).toBe(false);

    // The manager stays usable for the next round.
    const next = harness.manager.acquire(harness.asHtmlElement(harness.mount), {
      clock: harness.clock,
    });
    next.renderOnce();
    next.release();
    expect(harness.renderers).toHaveLength(1);
  });
});
