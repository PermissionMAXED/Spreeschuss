/**
 * Cloud Bounce 2D-canvas fallback — the complete game view without WebGL.
 *
 * When the shared Stage3D lease is unavailable (no WebGL, or another lease
 * is active) the module renders every gameplay signal on a plain canvas:
 * altitude-shifted sky, deterministic twinkle stars, wind bands with arrow
 * streaks, all four cloud kinds (fading clouds dissolve with a dashed
 * outline, springs carry a pad), bonus stars, and the bouncing hero. The
 * same smoothed view focus as the Stage3D scene keeps both views framed
 * identically; reduced motion snaps the focus and freezes twinkle/drift.
 *
 * The view owns only its canvas and resize listener; `dispose()` restores
 * the mount DOM exactly.
 */
import {
  CLOUD_WIND_HEIGHT,
  CLOUD_WIND_INTERVAL,
  cloudWindBandBottom,
  cloudWindDirection,
  cloudWindStrength,
  type CloudSlot,
  type CloudState,
} from "./model";

export interface CloudFallbackOptions {
  readonly mount: HTMLElement;
  readonly reducedMotion: boolean;
}

export interface CloudFallback {
  readonly canvas: HTMLCanvasElement;
  render(state: CloudState, dtSeconds: number): void;
  resize(): void;
  dispose(): void;
}

const MAX_PIXEL_RATIO = 2;
/** Altitude units visible per view height; matches the Stage3D framing. */
const VIEW_UNITS = 1.55;
/** The view focus sits at this fraction of the canvas height. */
const FOCUS_LINE = 0.52;
const FOCUS_STIFFNESS = 6;
const DECOR_STARS = 26;

/** Deterministic per-item hash so decor never re-rolls between frames. */
function unitHash(index: number, salt: number): number {
  let value = (index * 0x9e3779b1 + salt * 0x85ebca6b) >>> 0;
  value = Math.imul(value ^ (value >>> 15), value | 1) >>> 0;
  return ((value ^ (value >>> 13)) >>> 0) / 4_294_967_296;
}

function mixChannel(low: number, high: number, t: number): number {
  return Math.round(low + (high - low) * t);
}

export function createCloudFallback(options: CloudFallbackOptions): CloudFallback {
  const document = options.mount.ownerDocument;
  const view = document.defaultView;
  const reducedMotion = options.reducedMotion;
  const canvas = document.createElement("canvas");
  canvas.className = "cb-canvas";
  canvas.style.display = "block";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  options.mount.append(canvas);
  const context = canvas.getContext("2d");

  let width = 1;
  let height = 1;
  let ratio = 1;
  let viewFocus = 0;

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

  const screenX = (x: number): number => x * width;
  const screenY = (y: number): number =>
    height * FOCUS_LINE - ((y - viewFocus) * height) / VIEW_UNITS;

  const drawSky = (ctx: CanvasRenderingContext2D, time: number): void => {
    const altitude = Math.max(0, Math.min(1, viewFocus / 14));
    const top = `rgb(${mixChannel(120, 34, altitude)},${mixChannel(190, 62, altitude)},${mixChannel(238, 148, altitude)})`;
    const bottom = `rgb(${mixChannel(178, 84, altitude)},${mixChannel(224, 120, altitude)},${mixChannel(248, 196, altitude)})`;
    const sky = ctx.createLinearGradient(0, 0, 0, height);
    sky.addColorStop(0, top);
    sky.addColorStop(1, bottom);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, height);

    // Decorative high-altitude stars fade in as Gooby climbs.
    if (altitude > 0.15) {
      ctx.fillStyle = "#fdf6e0";
      for (let index = 0; index < DECOR_STARS; index += 1) {
        const x = unitHash(index, 1) * width;
        const y = unitHash(index, 2) * height * 0.7;
        const twinkle = reducedMotion
          ? 1
          : 0.65 + 0.35 * Math.sin(time * 1.6 + unitHash(index, 3) * Math.PI * 2);
        ctx.globalAlpha = (altitude - 0.15) * 0.9 * twinkle;
        const size = 1 + unitHash(index, 4) * 1.6;
        ctx.fillRect(x, y, size, size);
      }
      ctx.globalAlpha = 1;
    }
  };

  const drawWind = (ctx: CanvasRenderingContext2D, time: number): void => {
    const from = Math.max(
      0,
      Math.floor((viewFocus - VIEW_UNITS - cloudWindBandBottom(0)) / CLOUD_WIND_INTERVAL),
    );
    for (let index = from; index < from + 3; index += 1) {
      const bottom = cloudWindBandBottom(index);
      if (bottom > viewFocus + VIEW_UNITS) break;
      if (bottom + CLOUD_WIND_HEIGHT < viewFocus - VIEW_UNITS) continue;
      const direction = cloudWindDirection(index);
      const topPx = screenY(bottom + CLOUD_WIND_HEIGHT);
      const heightPx = (CLOUD_WIND_HEIGHT * height) / VIEW_UNITS;
      ctx.fillStyle = direction > 0 ? "rgba(214,240,255,0.22)" : "rgba(240,225,255,0.22)";
      ctx.fillRect(0, topPx, width, heightPx);

      // Arrow streaks: direction is shape-coded, never color alone.
      const drift = reducedMotion ? 0 : time * cloudWindStrength(index) * direction * 0.42;
      ctx.strokeStyle = "rgba(255,255,255,0.75)";
      ctx.fillStyle = "rgba(255,255,255,0.75)";
      ctx.lineWidth = 2;
      for (let streak = 0; streak < 4; streak += 1) {
        const phase = unitHash(index * 4 + streak, 11);
        const cycle = (((phase + drift) % 1) + 1) % 1;
        const x = cycle * width;
        const y = topPx + heightPx * (0.2 + unitHash(index * 4 + streak, 23) * 0.6);
        const span = width * 0.08;
        ctx.beginPath();
        ctx.moveTo(x - (span / 2) * direction, y);
        ctx.lineTo(x + (span / 2) * direction, y);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x + (span / 2 + 7) * direction, y);
        ctx.lineTo(x + (span / 2 - 2) * direction, y - 5);
        ctx.lineTo(x + (span / 2 - 2) * direction, y + 5);
        ctx.closePath();
        ctx.fill();
      }
    }
  };

  const drawCloud = (ctx: CanvasRenderingContext2D, cloud: CloudSlot): void => {
    const x = screenX(cloud.x);
    const y = screenY(cloud.y);
    const rx = cloud.halfWidth * width;
    const dissolve = cloud.kind === "fading" ? Math.max(0.15, cloud.fade) : 1;
    const ry = rx * 0.42 * dissolve;

    ctx.globalAlpha = cloud.kind === "fading" && cloud.bounced ? Math.max(0.2, cloud.fade) : 1;
    ctx.fillStyle = cloud.kind === "moving"
      ? "#dcecff"
      : cloud.kind === "fading"
        ? "#ece2f7"
        : cloud.kind === "spring"
          ? "#fff3d3"
          : "#ffffff";
    ctx.beginPath();
    ctx.ellipse(x, y + ry * 0.4, rx * dissolve, ry, 0, 0, Math.PI * 2);
    ctx.ellipse(x - rx * 0.5 * dissolve, y + ry * 0.6, rx * 0.5 * dissolve, ry * 0.7, 0, 0, Math.PI * 2);
    ctx.ellipse(x + rx * 0.5 * dissolve, y + ry * 0.6, rx * 0.5 * dissolve, ry * 0.7, 0, 0, Math.PI * 2);
    ctx.fill();

    if (cloud.kind === "fading") {
      // Dashed rim: one-bounce clouds read as fragile without color.
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = "#b39ecd";
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.ellipse(x, y + ry * 0.4, rx * dissolve, ry, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    } else if (cloud.kind === "spring") {
      ctx.fillStyle = "#f07a5f";
      const padWidth = rx * 0.7;
      ctx.fillRect(x - padWidth / 2, y - ry * 0.9, padWidth, Math.max(3, ry * 0.28));
    }
    ctx.globalAlpha = 1;
  };

  const drawStar = (
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    time: number,
    twinkle: number,
  ): void => {
    const pulse = reducedMotion ? 1 : 0.85 + 0.15 * Math.sin(time * 3 + twinkle);
    const size = width * 0.022 * pulse;
    ctx.fillStyle = "#f6c343";
    ctx.strokeStyle = "#a97b16";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(x, y - size);
    ctx.lineTo(x + size * 0.6, y);
    ctx.lineTo(x, y + size);
    ctx.lineTo(x - size * 0.6, y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  };

  const drawHero = (ctx: CanvasRenderingContext2D, state: CloudState): void => {
    const x = screenX(state.x);
    const y = screenY(state.y);
    const size = width * 0.045;
    const stretch = reducedMotion
      ? 1
      : Math.max(0.85, Math.min(1.18, 1 + state.vy * 0.05));

    ctx.fillStyle = "#f5efe6";
    ctx.strokeStyle = "#c9bda8";
    ctx.lineWidth = 2;
    // Ears first so the head overlaps their roots.
    for (const side of [-1, 1] as const) {
      ctx.beginPath();
      ctx.ellipse(
        x + side * size * 0.34,
        y - size * (1.5 * stretch),
        size * 0.22,
        size * 0.62 * stretch,
        side * 0.12,
        0,
        Math.PI * 2,
      );
      ctx.fill();
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.ellipse(x, y - size * 0.5, size * (2 - stretch) * 0.62, size * 0.78 * stretch, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // Face dots.
    ctx.fillStyle = "#3c3630";
    ctx.beginPath();
    ctx.arc(x - size * 0.2, y - size * 0.6, 1.8, 0, Math.PI * 2);
    ctx.arc(x + size * 0.2, y - size * 0.6, 1.8, 0, Math.PI * 2);
    ctx.fill();
  };

  return {
    canvas,
    render(state: CloudState, dtSeconds: number): void {
      if (!context) return;
      if (reducedMotion || dtSeconds <= 0) {
        if (reducedMotion) viewFocus = state.cameraY;
      } else {
        viewFocus += (state.cameraY - viewFocus) * (1 - Math.exp(-FOCUS_STIFFNESS * dtSeconds));
      }
      const ctx = context;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      drawSky(ctx, state.time);
      drawWind(ctx, state.time);
      for (const cloud of state.clouds) {
        if (!cloud.active) continue;
        if (Math.abs(cloud.y - viewFocus) > VIEW_UNITS) continue;
        drawCloud(ctx, cloud);
      }
      for (const star of state.starSlots) {
        if (!star.active) continue;
        if (Math.abs(star.y - viewFocus) > VIEW_UNITS) continue;
        drawStar(ctx, screenX(star.x), screenY(star.y), state.time, star.twinkle);
      }
      drawHero(ctx, state);
    },
    resize,
    dispose(): void {
      view?.removeEventListener("resize", onResize);
      canvas.remove();
    },
  };
}
