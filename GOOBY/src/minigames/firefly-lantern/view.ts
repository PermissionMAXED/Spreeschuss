/**
 * Firefly Lantern dusk canvas — a 2D-canvas painter for the pure model.
 *
 * Everything is repainted from `FireflyState` each frame: layered dusk sky,
 * deterministic twinkling stars, hill silhouettes, bramble obstacles (dark
 * fill plus thorn spokes so hazards never rely on color alone), the player's
 * glowing ink strokes (alpha fades with point age), wandering/following
 * fireflies, and the lantern with its banked-glow halo. Reduced motion
 * removes the twinkle, pulse, and glow-blur channels while keeping every
 * gameplay signal readable.
 *
 * The view owns only its canvas and resize listener; `dispose()` restores
 * the mount DOM exactly.
 */
import type {
  Firefly,
  FireflyState,
  FireflyStroke,
} from "./model";
import {
  FIREFLY_PATH_POINT_LIFETIME,
  LANTERN_BANK_RADIUS,
} from "./model";

export interface FireflyBrush {
  readonly x: number;
  readonly y: number;
  readonly visible: boolean;
  readonly drawing: boolean;
}

export interface FireflyViewOptions {
  readonly mount: HTMLElement;
  readonly reducedMotion: boolean;
}

export interface FireflyView {
  readonly canvas: HTMLCanvasElement;
  /** Maps client coordinates to normalized field coordinates. */
  toField(clientX: number, clientY: number): { x: number; y: number };
  render(state: FireflyState, brush: FireflyBrush): void;
  resize(): void;
  dispose(): void;
}

const MAX_PIXEL_RATIO = 2;
const STAR_COUNT = 46;

/** Deterministic per-star hash so the sky never re-rolls between frames. */
function starUnit(index: number, salt: number): number {
  let value = (index * 0x9e3779b1 + salt * 0x85ebca6b) >>> 0;
  value = Math.imul(value ^ (value >>> 15), value | 1) >>> 0;
  return ((value ^ (value >>> 13)) >>> 0) / 4_294_967_296;
}

export function createFireflyView(options: FireflyViewOptions): FireflyView {
  const document = options.mount.ownerDocument;
  const view = document.defaultView;
  const reducedMotion = options.reducedMotion;
  const canvas = document.createElement("canvas");
  canvas.className = "fl-canvas";
  canvas.style.display = "block";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  options.mount.append(canvas);
  const context = canvas.getContext("2d");

  let width = 1;
  let height = 1;
  let ratio = 1;

  const resize = (): void => {
    width = Math.max(1, options.mount.clientWidth);
    height = Math.max(1, options.mount.clientHeight);
    ratio = Math.min(MAX_PIXEL_RATIO, Math.max(1, view?.devicePixelRatio ?? 1));
    canvas.width = Math.floor(width * ratio);
    canvas.height = Math.floor(height * ratio);
  };
  const onResize = (): void => {
    resize();
  };
  view?.addEventListener("resize", onResize);
  resize();

  const drawSky = (ctx: CanvasRenderingContext2D, time: number): void => {
    const sky = ctx.createLinearGradient(0, 0, 0, height);
    sky.addColorStop(0, "#191d3d");
    sky.addColorStop(0.42, "#3a2f5e");
    sky.addColorStop(0.68, "#71466b");
    sky.addColorStop(0.8, "#c97b52");
    sky.addColorStop(0.84, "#2c3a35");
    sky.addColorStop(1, "#1c2b26");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, height);

    ctx.fillStyle = "#f4ecd8";
    for (let index = 0; index < STAR_COUNT; index += 1) {
      const x = starUnit(index, 1) * width;
      const y = starUnit(index, 2) * height * 0.55;
      const base = 0.35 + starUnit(index, 3) * 0.4;
      const twinkle = reducedMotion
        ? 1
        : 0.7 + 0.3 * Math.sin(time * 1.8 + starUnit(index, 4) * Math.PI * 2);
      ctx.globalAlpha = base * twinkle;
      const size = 0.8 + starUnit(index, 5) * 1.4;
      ctx.fillRect(x, y, size, size);
    }
    ctx.globalAlpha = 1;

    // Hill silhouettes framing the meadow.
    ctx.fillStyle = "#141f2b";
    ctx.beginPath();
    ctx.ellipse(width * 0.2, height * 0.86, width * 0.55, height * 0.12, 0, Math.PI, 0);
    ctx.fill();
    ctx.fillStyle = "#0f1822";
    ctx.beginPath();
    ctx.ellipse(width * 0.85, height * 0.9, width * 0.6, height * 0.14, 0, Math.PI, 0);
    ctx.fill();
  };

  const drawObstacles = (ctx: CanvasRenderingContext2D, state: FireflyState): void => {
    for (const obstacle of state.obstacles) {
      const cx = obstacle.x * width;
      const cy = obstacle.y * height;
      const rx = obstacle.radius * width;
      const ry = obstacle.radius * height;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      ctx.fillStyle = "#101720";
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#3d4a3a";
      ctx.stroke();
      // Thorn spokes: shape-coded hazard marking, never color alone.
      ctx.strokeStyle = "#55654c";
      ctx.lineWidth = 1.5;
      for (let spoke = 0; spoke < 8; spoke += 1) {
        const angle = (spoke / 8) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(angle) * rx * 0.55, cy + Math.sin(angle) * ry * 0.55);
        ctx.lineTo(cx + Math.cos(angle) * rx * 1.05, cy + Math.sin(angle) * ry * 1.05);
        ctx.stroke();
      }
    }
  };

  const drawStroke = (ctx: CanvasRenderingContext2D, stroke: FireflyStroke): void => {
    for (let index = stroke.firstAlive + 1; index < stroke.pointCount; index += 1) {
      const from = stroke.points[index - 1];
      const to = stroke.points[index];
      if (!from || !to) continue;
      const alpha = Math.max(0, 1 - to.age / FIREFLY_PATH_POINT_LIFETIME);
      ctx.globalAlpha = 0.25 + alpha * 0.75;
      ctx.beginPath();
      ctx.moveTo(from.x * width, from.y * height);
      ctx.lineTo(to.x * width, to.y * height);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  };

  const drawFirefly = (
    ctx: CanvasRenderingContext2D,
    firefly: Firefly,
    time: number,
  ): void => {
    if (firefly.mode === "banked" || firefly.mode === "lost") return;
    const x = firefly.x * width;
    const y = firefly.y * height;
    const engaged = firefly.mode === "follow" || firefly.mode === "lantern";
    const pulse = reducedMotion ? 1 : 0.85 + 0.15 * Math.sin(time * 6 + firefly.phaseA);
    const radius = (engaged ? 7 : 5) * pulse;
    const glow = ctx.createRadialGradient(x, y, 0, x, y, radius * 3);
    glow.addColorStop(0, engaged ? "rgba(255,240,170,0.95)" : "rgba(220,235,170,0.8)");
    glow.addColorStop(1, "rgba(255,230,140,0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, y, radius * 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = engaged ? "#fff3b8" : "#e8f0b0";
    ctx.beginPath();
    ctx.arc(x, y, radius * 0.55, 0, Math.PI * 2);
    ctx.fill();
  };

  const drawLantern = (ctx: CanvasRenderingContext2D, state: FireflyState): void => {
    const x = state.lanternX * width;
    const y = state.lanternY * height;
    const total = Math.max(1, state.fireflies.length);
    const fill = state.bankedThisRound / total;
    const rx = LANTERN_BANK_RADIUS * width;
    const ry = LANTERN_BANK_RADIUS * height;

    // Hanging string from the top edge.
    ctx.strokeStyle = "#c9b98a";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, y - ry);
    ctx.stroke();

    const halo = ctx.createRadialGradient(x, y, 0, x, y, rx * (2 + fill * 2.4));
    halo.addColorStop(0, `rgba(255,214,120,${0.35 + fill * 0.45})`);
    halo.addColorStop(1, "rgba(255,214,120,0)");
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(x, y, rx * (2 + fill * 2.4), 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255,196,92,${0.45 + fill * 0.5})`;
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#8a6b3a";
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(x, y - ry, rx * 0.55, ry * 0.25, 0, Math.PI, 0);
    ctx.strokeStyle = "#8a6b3a";
    ctx.stroke();

    // Banked fireflies rest inside the glass.
    ctx.fillStyle = "#fff3b8";
    for (let index = 0; index < state.bankedThisRound && index < 8; index += 1) {
      const angle = (index / 8) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(
        x + Math.cos(angle) * rx * 0.45,
        y + Math.sin(angle) * ry * 0.45,
        2.2,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
  };

  const drawBrush = (ctx: CanvasRenderingContext2D, brush: FireflyBrush): void => {
    if (!brush.visible) return;
    const x = brush.x * width;
    const y = brush.y * height;
    ctx.lineWidth = 2;
    ctx.strokeStyle = brush.drawing ? "#ffe9a8" : "rgba(255,233,168,0.6)";
    ctx.beginPath();
    ctx.arc(x, y, brush.drawing ? 9 : 12, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, 2, 0, Math.PI * 2);
    ctx.fillStyle = "#ffe9a8";
    ctx.fill();
  };

  return {
    canvas,
    toField(clientX: number, clientY: number) {
      const rect = canvas.getBoundingClientRect();
      const fieldX = (clientX - rect.left) / Math.max(1, rect.width);
      const fieldY = (clientY - rect.top) / Math.max(1, rect.height);
      return {
        x: Math.min(1, Math.max(0, fieldX)),
        y: Math.min(1, Math.max(0, fieldY)),
      };
    },
    render(state: FireflyState, brush: FireflyBrush): void {
      if (!context) return;
      const ctx = context;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      drawSky(ctx, state.time);
      drawObstacles(ctx, state);

      ctx.lineWidth = 4;
      ctx.lineCap = "round";
      ctx.strokeStyle = "#ffd97a";
      if (!reducedMotion) {
        ctx.shadowColor = "rgba(255,214,120,0.85)";
        ctx.shadowBlur = 10;
      }
      for (const stroke of state.strokes) drawStroke(ctx, stroke);
      ctx.shadowBlur = 0;

      drawLantern(ctx, state);
      for (const firefly of state.fireflies) drawFirefly(ctx, firefly, state.time);
      drawBrush(ctx, brush);
    },
    resize,
    dispose(): void {
      view?.removeEventListener("resize", onResize);
      canvas.remove();
    },
  };
}
