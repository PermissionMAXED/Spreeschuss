/**
 * Stage3D browser dev harness (development entry only — never bundled into
 * production; the production scan fails the build if it ever leaks).
 *
 * Exercises the lease lifecycle against the real WebGL renderer: acquire and
 * release (repeatedly), portrait fixed/chase rigs, quality overrides,
 * clock-driven loops, pause, an intentional mid-frame exception, and a live
 * baseline readout proving geometry/texture/program counts return to their
 * pre-lease values after release.
 */
import {
  AmbientLight,
  BoxGeometry,
  DirectionalLight,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  TorusKnotGeometry,
} from "three";
import { RealClock } from "../../core/contracts/clock";
import type { QualityTier } from "../quality";
import {
  Stage3dManager,
  captureStageResourceBaseline,
  diffStageResourceBaseline,
  type Stage3dLease,
  type StageResourceBaseline,
} from "./stage";

function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Stage harness element is missing: ${selector}`);
  return element;
}

const mount = requiredElement<HTMLElement>("#stage-mount");
const stats = requiredElement<HTMLOutputElement>("#stage-stats");
const qualitySelect = requiredElement<HTMLSelectElement>("#quality");
const clock = new RealClock();
const manager = new Stage3dManager();

let lease: Stage3dLease | null = null;
let baseline: StageResourceBaseline | null = null;
let chaseRig = false;
let paused = false;
let explodeNextFrame = false;
let hero: Mesh | null = null;
let elapsed = 0;

function report(extra = ""): void {
  const renderer = manager.sharedRenderer;
  const lines = [
    `lease: ${lease === null ? "none" : lease.released ? "released" : "active"}`,
    `rig: ${chaseRig ? "portrait-chase" : "portrait-fixed"}  loop: ${lease?.looping === true ? (paused ? "paused" : "running") : "—"}`,
  ];
  if (renderer) {
    const current = captureStageResourceBaseline(renderer);
    lines.push(
      `resources now: geo ${current.geometries} tex ${current.textures} prog ${current.programs}`,
    );
    if (baseline) {
      const diff = diffStageResourceBaseline(renderer, baseline);
      lines.push(
        `vs pre-lease baseline: geo ${diff.geometries >= 0 ? "+" : ""}${diff.geometries} tex ${diff.textures >= 0 ? "+" : ""}${diff.textures} prog ${diff.programs >= 0 ? "+" : ""}${diff.programs}`,
      );
    }
  }
  if (extra) lines.push(extra);
  stats.textContent = lines.join("\n");
}

function populateScene(current: Stage3dLease): void {
  const ground = new Mesh(
    new PlaneGeometry(30, 30),
    new MeshStandardMaterial({ color: 0x7fae6a }),
  );
  ground.rotation.x = -Math.PI / 2;
  current.scene.add(ground);
  const knot = new Mesh(
    new TorusKnotGeometry(1.1, 0.34, 96, 12),
    new MeshStandardMaterial({ color: 0xf0a558 }),
  );
  knot.position.set(-2.2, 1.6, 0);
  current.scene.add(knot);
  hero = new Mesh(
    new BoxGeometry(1, 1, 1),
    new MeshStandardMaterial({ color: 0xd95d4e }),
  );
  hero.position.set(0, 0.5, 0);
  current.scene.add(hero);
  current.scene.add(new AmbientLight(0xfff2df, 0.8));
  const sun = new DirectionalLight(0xffffff, 1.4);
  sun.position.set(4, 9, 5);
  current.scene.add(sun);

  current.setLoop((dt) => {
    if (explodeNextFrame) {
      explodeNextFrame = false;
      throw new Error("harness-requested mid-frame exception");
    }
    if (paused) return;
    elapsed += dt;
    knot.rotation.y += dt * 0.9;
    if (hero) {
      hero.position.x = Math.sin(elapsed * 0.7) * 3;
      hero.position.z = Math.cos(elapsed * 0.45) * 3;
      hero.rotation.y += dt;
    }
  });
  current.setChaseTarget(chaseRig ? hero : null);
}

function acquire(): void {
  if (lease && !lease.released) {
    report("acquire refused: lease already active (expected single-lease rule)");
    return;
  }
  const renderer = manager.sharedRenderer;
  baseline = renderer ? captureStageResourceBaseline(renderer) : null;
  const quality = qualitySelect.value as QualityTier | "";
  lease = manager.acquire(mount, {
    clock,
    ...(quality === "" ? {} : { quality }),
    camera: chaseRig
      ? { kind: "portrait-chase", offset: { x: 0, y: 3.2, z: 7 }, stiffness: 5 }
      : { kind: "portrait-fixed" },
  });
  baseline ??= lease.baseline;
  paused = false;
  elapsed = 0;
  populateScene(lease);
  report("acquired; loop running");
}

function release(): void {
  if (!lease || lease.released) {
    report("nothing to release");
    return;
  }
  try {
    lease.release();
  } finally {
    hero = null;
    report("released; counts above must match the pre-lease baseline");
  }
}

requiredElement<HTMLButtonElement>("#acquire").addEventListener("click", acquire);
requiredElement<HTMLButtonElement>("#release").addEventListener("click", release);
requiredElement<HTMLButtonElement>("#cycle").addEventListener("click", () => {
  release();
  for (let index = 0; index < 10; index += 1) {
    acquire();
    if (lease) lease.renderOnce();
    release();
  }
  report("completed 10 acquire/render/release cycles on the cached renderer");
});
requiredElement<HTMLButtonElement>("#rig").addEventListener("click", () => {
  chaseRig = !chaseRig;
  if (lease && !lease.released) {
    lease.setCameraRig(
      chaseRig
        ? { kind: "portrait-chase", offset: { x: 0, y: 3.2, z: 7 }, stiffness: 5 }
        : { kind: "portrait-fixed" },
    );
    lease.setChaseTarget(chaseRig ? hero : null);
  }
  report();
});
requiredElement<HTMLButtonElement>("#pause").addEventListener("click", () => {
  paused = !paused;
  report(paused ? "frame callback idles; release still restores baselines" : "resumed");
});
requiredElement<HTMLButtonElement>("#explode").addEventListener("click", () => {
  explodeNextFrame = true;
  report("next frame throws: the loop must stop and release must stay clean");
});

setInterval(() => {
  report();
}, 1_000);
mount.dataset.ready = "true";
report("Stage3D harness ready");
