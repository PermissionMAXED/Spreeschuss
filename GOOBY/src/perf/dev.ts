import type { QualityTier } from "../render/quality";
import type { DevPerfControls, PerfDebugApi, PerformanceSnapshot } from "./index";
import type { ResourceMetrics } from "./math";

interface DevPerformanceHost {
  snapshot(): PerformanceSnapshot;
  setQuality(tier: QualityTier | "auto"): void;
  markResourceBaseline(): ResourceMetrics;
  markTransition(): void;
  resetRollingMetrics(): void;
  simulateGovernor(start: QualityTier, fps: number, durationMs: number): QualityTier;
}

let overlay: HTMLElement | null = null;
let refreshTimer: number | null = null;

function isQualityTier(value: string | null): value is QualityTier {
  return value === "low" || value === "mid" || value === "high";
}

function stopOverlay(): void {
  overlay?.remove();
  overlay = null;
  if (refreshTimer !== null) window.clearInterval(refreshTimer);
  refreshTimer = null;
}

function renderOverlay(host: DevPerformanceHost): void {
  if (!overlay) return;
  const snapshot = host.snapshot();
  const resources = snapshot.resources.current;
  const heapMb = resources.heapBytes === null ? "n/a" : (resources.heapBytes / 1_048_576).toFixed(1);
  overlay.dataset.quality = snapshot.quality.active;
  overlay.innerHTML = [
    "<b>GOOBY PERF</b>",
    `FPS ${snapshot.frame.fps.toFixed(1)} · p95 ${snapshot.frame.p95Ms.toFixed(1)}ms`,
    `tier ${snapshot.quality.active} · detected ${snapshot.quality.detected}`,
    `draw ${snapshot.render.drawCalls.toFixed(0)} · tri ${snapshot.render.triangles.toFixed(0)}`,
    `geo ${resources.geometries} · tex ${resources.textures}`,
    `mat ${resources.materials} · prog ${resources.programs}`,
    `heap ${heapMb}MB · leak ${snapshot.resources.likelyLeak ? "YES" : "no"}`,
    '<span style="display:flex;gap:4px;margin-top:5px">',
    '<button style="pointer-events:auto" data-tier="auto">auto</button><button style="pointer-events:auto" data-tier="low">low</button>',
    '<button style="pointer-events:auto" data-tier="mid">mid</button><button style="pointer-events:auto" data-tier="high">high</button>',
    "</span>",
  ].join("\n");
}

function showOverlay(host: DevPerformanceHost): void {
  if (overlay) return;
  document.querySelector("[data-gooby-perf-overlay]")?.remove();
  const element = document.createElement("aside");
  element.dataset.goobyPerfOverlay = "true";
  element.dataset.testid = "perf-overlay";
  element.setAttribute("aria-label", "Gooby performance monitor");
  element.style.cssText = [
    "position:fixed",
    "z-index:2147483647",
    "top:max(8px,env(safe-area-inset-top))",
    "left:8px",
    "width:220px",
    "padding:9px",
    "border:1px solid #7ef0aa",
    "border-radius:8px",
    "color:#eafff1",
    "background:#07140ee6",
    "box-shadow:0 4px 20px #0008",
    "font:11px/1.35 ui-monospace,SFMono-Regular,Menlo,monospace",
    "white-space:pre",
    "pointer-events:none",
  ].join(";");
  element.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement)) return;
    const tier = target.dataset.tier;
    if (tier === "auto") host.setQuality(tier);
    else if (tier && isQualityTier(tier)) host.setQuality(tier);
    renderOverlay(host);
  });
  document.body.append(element);
  overlay = element;
  renderOverlay(host);
  refreshTimer = window.setInterval(() => {
    if (!overlay?.isConnected) {
      stopOverlay();
      return;
    }
    renderOverlay(host);
  }, 500);
}

export function installDevPerformanceTools(api: PerfDebugApi, host: DevPerformanceHost): void {
  const controls: DevPerfControls = {
    setQuality: (tier) => {
      host.setQuality(tier);
      renderOverlay(host);
    },
    showOverlay: (visible) => {
      if (visible) showOverlay(host);
      else stopOverlay();
    },
    markResourceBaseline: () => host.markResourceBaseline(),
    markTransition: () => host.markTransition(),
    resetRollingMetrics: () => host.resetRollingMetrics(),
    simulateGovernor: (start, fps, durationMs) => {
      const result = host.simulateGovernor(start, fps, durationMs);
      renderOverlay(host);
      return result;
    },
  };
  api.controls = controls;
  const parameters = new URLSearchParams(location.search);
  const tier = parameters.get("quality");
  if (isQualityTier(tier)) controls.setQuality(tier);
  if (parameters.get("perf") === "1" || parameters.get("perfOverlay") === "1") {
    controls.showOverlay(true);
  }
}
