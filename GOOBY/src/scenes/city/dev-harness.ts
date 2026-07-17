import { GameRenderer } from "../../render/renderer";
import { CityDriveScene, type CityDriveDebugSnapshot } from "./scene";
import { CityRouteMachine } from "./route-machine";
import type { CityTravelSnapshot } from "./travel-snapshot";

interface CityHarnessDebug {
  snapshot(): CityDriveDebugSnapshot;
  saveRaw(snapshot: unknown): void;
  clearSaved(): void;
  completeLeg(): void;
  pause(): void;
  exit(): void;
}

declare global {
  interface Window {
    __cityHarness: CityHarnessDebug;
  }
}

const HARNESS_TRAVEL_KEY = "gooby.city.harness.travel.v1";

interface HarnessTravelRecord {
  readonly visitedShops: ReturnType<CityRouteMachine["visitedShops"]>;
  readonly snapshot: CityTravelSnapshot;
}

function loadTravelRecord(): Partial<HarnessTravelRecord> {
  const value = localStorage.getItem(HARNESS_TRAVEL_KEY);
  if (!value) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== "object" || parsed === null) return { snapshot: parsed as CityTravelSnapshot };
    const record = parsed as Partial<HarnessTravelRecord>;
    const visitedShops = Array.isArray(record.visitedShops) ? record.visitedShops : [];
    return record.snapshot === undefined
      ? { visitedShops }
      : { visitedShops, snapshot: record.snapshot };
  } catch {
    return {};
  }
}

function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`City harness element is missing: ${selector}`);
  return element;
}

async function startHarness(): Promise<void> {
  const mount = requiredElement<HTMLElement>("#city-harness");
  const canvas = requiredElement<HTMLCanvasElement>("#city-canvas");
  const status = requiredElement<HTMLOutputElement>("#harness-status");
  const renderer = new GameRenderer(canvas, "balanced");
  const saved = loadTravelRecord();
  const controller = new CityRouteMachine(saved.visitedShops ?? [], saved.snapshot);
  const scene = new CityDriveScene({
    renderer,
    mount,
    controller,
    onStateChanged: (state) => {
      status.textContent = state.phase.replaceAll("-", " ");
    },
    onCoinsCollected: (count) => {
      status.textContent = `Picked up ${count} city coin${count === 1 ? "" : "s"}`;
    },
    onBoost: () => {
      status.textContent = "Cozy boost!";
    },
    onTravelSnapshotChanged: (snapshot) => {
      const record: HarnessTravelRecord = {
        visitedShops: controller.visitedShops(),
        snapshot,
      };
      localStorage.setItem(HARNESS_TRAVEL_KEY, JSON.stringify(record));
    },
    onEnterShop: (shop, activeScene) => {
      status.textContent = `${shop.replaceAll("-", " ")} visit complete — choose the return journey`;
      window.setTimeout(() => activeScene.completeShopVisit(), 350);
    },
  });

  const resize = (): void => {
    scene.resize({
      viewport: {
        width: canvas.clientWidth,
        height: canvas.clientHeight,
        pixelRatio: Math.min(window.devicePixelRatio || 1, 1.5),
      },
    });
  };
  await scene.enter({
    viewport: {
      width: canvas.clientWidth,
      height: canvas.clientHeight,
      pixelRatio: Math.min(window.devicePixelRatio || 1, 1.5),
    },
  });
  window.addEventListener("resize", resize);
  window.__cityHarness = {
    snapshot: () => scene.debugSnapshot(),
    saveRaw: (snapshot) => {
      localStorage.setItem(HARNESS_TRAVEL_KEY, JSON.stringify({
        visitedShops: controller.visitedShops(),
        snapshot,
      }));
    },
    clearSaved: () => localStorage.removeItem(HARNESS_TRAVEL_KEY),
    completeLeg: () => scene.completeCurrentLegForTest(),
    pause: () => scene.pause(),
    exit: () => scene.exit(),
  };
  mount.dataset.ready = "true";
  status.textContent = "Garage ready — choose a destination";

  let previous = performance.now();
  let frame = 0;
  const loop = (now: number): void => {
    const delta = Math.min(0.1, Math.max(0, (now - previous) / 1_000));
    previous = now;
    scene.update(delta);
    renderer.render();
    frame = requestAnimationFrame(loop);
  };
  frame = requestAnimationFrame(loop);

  window.addEventListener("pagehide", () => {
    cancelAnimationFrame(frame);
    window.removeEventListener("resize", resize);
    scene.dispose();
    renderer.dispose();
  }, { once: true });
}

void startHarness();
