import { GameRenderer } from "../../render/renderer";
import { CityDriveScene, type CityDriveDebugSnapshot } from "./scene";

interface CityHarnessDebug {
  snapshot(): CityDriveDebugSnapshot;
}

declare global {
  interface Window {
    __cityHarness: CityHarnessDebug;
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
  const scene = new CityDriveScene({
    renderer,
    mount,
    onStateChanged: (state) => {
      status.textContent = state.phase.replaceAll("-", " ");
    },
    onCoinsCollected: (count) => {
      status.textContent = `Picked up ${count} city coin${count === 1 ? "" : "s"}`;
    },
    onBoost: () => {
      status.textContent = "Cozy boost!";
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
  window.__cityHarness = { snapshot: () => scene.debugSnapshot() };
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
