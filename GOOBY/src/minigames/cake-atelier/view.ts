/**
 * Cake Atelier 2.5D canvas painter.
 *
 * Pure drawing: every function reads an immutable snapshot assembled by the
 * module and paints one frame onto a 2D canvas — no state, no timers, no
 * session mutation. The 2.5D look comes from drawing each sponge layer as a
 * shaded side wall plus an elliptical top face, with the plate, oven gauge,
 * piping nozzle, and decoration ghost sharing the same projection.
 */
import type {
  CakeFlavor,
  DecorationKind,
  FrostingStyle,
  PlacedDecoration,
  StackedLayer,
  SwingingLayer,
} from "./logic";
import { DECORATION_CUES, FLUFF_PERFECT_ZONE } from "./logic";

export interface AtelierViewSnapshot {
  readonly phase: "flavor" | "bake" | "stack" | "frost" | "decorate" | "serve" | "done";
  readonly flavor: CakeFlavor | null;
  readonly orderFlavor: CakeFlavor;
  readonly stacked: readonly StackedLayer[];
  readonly totalLayers: number;
  readonly swinging: SwingingLayer | null;
  readonly needle: number;
  readonly bakedCount: number;
  readonly frostStyle: FrostingStyle | null;
  readonly frostCells: readonly boolean[];
  readonly coverage: number;
  readonly nozzleX: number;
  readonly frostingHeld: boolean;
  readonly decorations: readonly PlacedDecoration[];
  readonly ghost: { readonly kind: DecorationKind; readonly x: number; readonly y: number } | null;
  readonly wobblePhase: number;
  readonly stability: number;
  readonly reducedMotion: boolean;
  readonly celebrating: boolean;
}

export interface CakeGeometry {
  /** Cake face bounds in canvas pixels, used for pointer hit mapping. */
  readonly faceLeft: number;
  readonly faceRight: number;
  readonly faceTop: number;
  readonly faceBottom: number;
  /** Top-ellipse bounds for decoration placement. */
  readonly topCenterX: number;
  readonly topCenterY: number;
  readonly topRadiusX: number;
  readonly topRadiusY: number;
}

export const FLAVOR_FILL: Readonly<Record<CakeFlavor, { readonly side: string; readonly top: string; readonly crumb: string }>> = {
  "clover-vanilla": { side: "#f3e2b8", top: "#fdf3d4", crumb: "#e8d19a" },
  "carrot-honey": { side: "#eeab5e", top: "#f8c988", crumb: "#d99648" },
  "acorn-cocoa": { side: "#8a5a3b", top: "#a5714d", crumb: "#74482c" },
};

export const FROSTING_FILL: Readonly<Record<FrostingStyle, { readonly base: string; readonly shade: string }>> = {
  "cream-swirl": { base: "#fff3e2", shade: "#f2ddc2" },
  "berry-glaze": { base: "#f6a8bc", shade: "#e2839d" },
  "mint-drizzle": { base: "#b4e7cd", shade: "#8fd0b1" },
};

const LAYER_BASE_WIDTH = 0.54;
const LAYER_SHRINK = 0.84;
const LAYER_BASE_HEIGHT = 0.075;
const EL_RATIO = 0.3;

interface LayerBox {
  readonly centerX: number;
  readonly width: number;
  readonly top: number;
  readonly height: number;
}

function roundedSide(
  ctx: CanvasRenderingContext2D,
  box: LayerBox,
  radiusY: number,
): void {
  const left = box.centerX - box.width / 2;
  const right = box.centerX + box.width / 2;
  ctx.beginPath();
  ctx.moveTo(left, box.top);
  ctx.lineTo(left, box.top + box.height);
  ctx.ellipse(box.centerX, box.top + box.height, box.width / 2, radiusY, 0, Math.PI, 0, true);
  ctx.lineTo(right, box.top);
  ctx.closePath();
}

function layerBoxes(
  width: number,
  height: number,
  stacked: readonly StackedLayer[],
  wobbleOffset: number,
): LayerBox[] {
  const plateY = height * 0.86;
  const boxes: LayerBox[] = [];
  let top = plateY;
  for (const [index, layer] of stacked.entries()) {
    const layerWidth = width * LAYER_BASE_WIDTH * LAYER_SHRINK ** index;
    const layerHeight = height * LAYER_BASE_HEIGHT * layer.heightScale;
    top -= layerHeight;
    boxes.push({
      centerX: width / 2 + layer.offset * width + wobbleOffset * (index + 1),
      width: layerWidth,
      top,
      height: layerHeight,
    });
  }
  return boxes;
}

export function cakeGeometry(
  width: number,
  height: number,
  stacked: readonly StackedLayer[],
): CakeGeometry {
  const boxes = layerBoxes(width, height, stacked, 0);
  const topBox = boxes[boxes.length - 1];
  const plateY = height * 0.86;
  const faceLeft = width / 2 - width * LAYER_BASE_WIDTH / 2;
  const faceRight = width / 2 + width * LAYER_BASE_WIDTH / 2;
  if (!topBox) {
    return {
      faceLeft,
      faceRight,
      faceTop: plateY - height * LAYER_BASE_HEIGHT,
      faceBottom: plateY,
      topCenterX: width / 2,
      topCenterY: plateY,
      topRadiusX: width * LAYER_BASE_WIDTH / 2,
      topRadiusY: width * LAYER_BASE_WIDTH * EL_RATIO / 2,
    };
  }
  return {
    faceLeft,
    faceRight,
    faceTop: topBox.top,
    faceBottom: plateY,
    topCenterX: topBox.centerX,
    topCenterY: topBox.top,
    topRadiusX: topBox.width / 2,
    topRadiusY: topBox.width * EL_RATIO / 2,
  };
}

function drawBackdrop(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  ctx.fillStyle = "#ffe7ef";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#ffd9e4";
  ctx.fillRect(0, height * 0.32, width, height * 0.3);
  // Counter top.
  ctx.fillStyle = "#f2c092";
  ctx.fillRect(0, height * 0.62, width, height * 0.38);
  ctx.fillStyle = "#e5ab77";
  ctx.fillRect(0, height * 0.62, width, height * 0.025);
  // Shelf shadow stripes for depth.
  ctx.fillStyle = "rgba(255,255,255,0.35)";
  for (let stripe = 0; stripe < 4; stripe += 1) {
    ctx.fillRect(width * (0.08 + stripe * 0.24), height * 0.1, width * 0.14, height * 0.016);
  }
}

function drawPlate(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  const plateY = height * 0.86;
  ctx.fillStyle = "rgba(96,60,36,0.18)";
  ctx.beginPath();
  ctx.ellipse(width / 2, plateY + height * 0.028, width * 0.36, height * 0.03, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#fffdf4";
  ctx.beginPath();
  ctx.ellipse(width / 2, plateY, width * 0.34, height * 0.028, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#f0e3cc";
  ctx.beginPath();
  ctx.ellipse(width / 2, plateY, width * 0.27, height * 0.02, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawLayer(
  ctx: CanvasRenderingContext2D,
  box: LayerBox,
  flavor: CakeFlavor,
): void {
  const fill = FLAVOR_FILL[flavor];
  const radiusY = box.width * EL_RATIO / 2;
  roundedSide(ctx, box, radiusY);
  ctx.fillStyle = fill.side;
  ctx.fill();
  ctx.strokeStyle = fill.crumb;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(box.centerX, box.top, box.width / 2, radiusY, 0, 0, Math.PI * 2);
  ctx.fillStyle = fill.top;
  ctx.fill();
  ctx.strokeStyle = fill.crumb;
  ctx.stroke();
}

function drawFrosting(
  ctx: CanvasRenderingContext2D,
  boxes: readonly LayerBox[],
  snapshot: AtelierViewSnapshot,
): void {
  const style = snapshot.frostStyle;
  const topBox = boxes[boxes.length - 1];
  if (!style || !topBox) return;
  const fill = FROSTING_FILL[style];
  const radiusY = topBox.width * EL_RATIO / 2;
  const cells = snapshot.frostCells;
  const cellWidth = topBox.width / cells.length;
  ctx.save();
  roundedSide(ctx, topBox, radiusY);
  ctx.clip();
  for (const [index, covered] of cells.entries()) {
    if (!covered) continue;
    ctx.fillStyle = fill.base;
    ctx.fillRect(
      topBox.centerX - topBox.width / 2 + index * cellWidth - 0.5,
      topBox.top - radiusY - 2,
      cellWidth + 1,
      topBox.height + radiusY * 2 + 4,
    );
    // Drip scallop: a non-color texture cue for frosted columns.
    ctx.fillStyle = fill.shade;
    ctx.beginPath();
    ctx.arc(
      topBox.centerX - topBox.width / 2 + (index + 0.5) * cellWidth,
      topBox.top + topBox.height * (0.42 + (index % 3) * 0.18),
      cellWidth * 0.42,
      0,
      Math.PI,
    );
    ctx.fill();
  }
  ctx.restore();
  // Frosted share of the top face.
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(topBox.centerX, topBox.top, topBox.width / 2, radiusY, 0, 0, Math.PI * 2);
  ctx.clip();
  for (const [index, covered] of cells.entries()) {
    if (!covered) continue;
    ctx.fillStyle = fill.base;
    ctx.fillRect(
      topBox.centerX - topBox.width / 2 + index * cellWidth - 0.5,
      topBox.top - radiusY - 1,
      cellWidth + 1,
      radiusY * 2 + 2,
    );
  }
  ctx.restore();
}

function drawDecorations(
  ctx: CanvasRenderingContext2D,
  geometry: CakeGeometry,
  decorations: readonly PlacedDecoration[],
  fontPx: number,
): void {
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const decoration of decorations) {
    const x = geometry.topCenterX + (decoration.x - 0.5) * geometry.topRadiusX * 1.7;
    const y = geometry.topCenterY + (decoration.y - 0.5) * geometry.topRadiusY * 1.6;
    ctx.font = `${fontPx}px system-ui, sans-serif`;
    ctx.fillStyle = "#4a3428";
    ctx.fillText(DECORATION_CUES[decoration.kind].glyph, x, y);
  }
}

function drawGhost(
  ctx: CanvasRenderingContext2D,
  geometry: CakeGeometry,
  ghost: NonNullable<AtelierViewSnapshot["ghost"]>,
  fontPx: number,
): void {
  const x = geometry.topCenterX + (ghost.x - 0.5) * geometry.topRadiusX * 1.7;
  const y = geometry.topCenterY + (ghost.y - 0.5) * geometry.topRadiusY * 1.6;
  ctx.save();
  ctx.globalAlpha = 0.55;
  ctx.strokeStyle = "#4a3428";
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.arc(x, y, fontPx * 0.75, 0, Math.PI * 2);
  ctx.stroke();
  ctx.font = `${fontPx}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#4a3428";
  ctx.fillText(DECORATION_CUES[ghost.kind].glyph, x, y);
  ctx.restore();
}

function drawOvenGauge(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  needle: number,
  bakedCount: number,
  totalLayers: number,
): void {
  const gaugeLeft = width * 0.12;
  const gaugeWidth = width * 0.76;
  const gaugeY = height * 0.3;
  const gaugeHeight = height * 0.05;
  ctx.fillStyle = "#fff8ea";
  ctx.strokeStyle = "#4a3428";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(gaugeLeft, gaugeY, gaugeWidth, gaugeHeight, 8);
  ctx.fill();
  ctx.stroke();
  // Perfect-fluff zone: hatched band + notch (shape cue, not color-only).
  const zoneWidth = gaugeWidth * FLUFF_PERFECT_ZONE;
  const zoneLeft = gaugeLeft + gaugeWidth / 2 - zoneWidth / 2;
  ctx.fillStyle = "#ffd97b";
  ctx.fillRect(zoneLeft, gaugeY, zoneWidth, gaugeHeight);
  ctx.strokeStyle = "#4a3428";
  ctx.lineWidth = 1;
  for (let hatch = 0; hatch < 4; hatch += 1) {
    const x = zoneLeft + (zoneWidth * (hatch + 0.5)) / 4;
    ctx.beginPath();
    ctx.moveTo(x, gaugeY);
    ctx.lineTo(x, gaugeY + gaugeHeight);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(gaugeLeft + gaugeWidth / 2, gaugeY - 8);
  ctx.lineTo(gaugeLeft + gaugeWidth / 2 - 5, gaugeY - 2);
  ctx.lineTo(gaugeLeft + gaugeWidth / 2 + 5, gaugeY - 2);
  ctx.closePath();
  ctx.fillStyle = "#4a3428";
  ctx.fill();
  // Needle.
  const needleX = gaugeLeft + gaugeWidth * needle;
  ctx.strokeStyle = "#d95d4e";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(needleX, gaugeY - 6);
  ctx.lineTo(needleX, gaugeY + gaugeHeight + 6);
  ctx.stroke();
  // Layer progress pips.
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `${Math.round(height * 0.026)}px system-ui, sans-serif`;
  ctx.fillStyle = "#4a3428";
  ctx.fillText(
    `${Math.min(bakedCount + 1, totalLayers)} / ${totalLayers}`,
    gaugeLeft + gaugeWidth / 2,
    gaugeY + gaugeHeight + height * 0.03,
  );
}

function drawSwing(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  swinging: SwingingLayer,
  stackedCount: number,
  flavor: CakeFlavor,
): void {
  const layerWidth = width * LAYER_BASE_WIDTH * LAYER_SHRINK ** stackedCount;
  const layerHeight = height * LAYER_BASE_HEIGHT * swinging.heightScale;
  const box: LayerBox = {
    centerX: swinging.x * width,
    width: layerWidth,
    top: height * 0.24,
    height: layerHeight,
  };
  // Hanger strings.
  ctx.strokeStyle = "rgba(74,52,40,0.4)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(box.centerX - layerWidth * 0.3, 0);
  ctx.lineTo(box.centerX - layerWidth * 0.3, box.top);
  ctx.moveTo(box.centerX + layerWidth * 0.3, 0);
  ctx.lineTo(box.centerX + layerWidth * 0.3, box.top);
  ctx.stroke();
  drawLayer(ctx, box, flavor);
  // Drop guide onto the target center.
  ctx.setLineDash([4, 5]);
  ctx.strokeStyle = "rgba(74,52,40,0.45)";
  ctx.beginPath();
  ctx.moveTo(box.centerX, box.top + box.height);
  ctx.lineTo(box.centerX, height * 0.84);
  ctx.stroke();
  ctx.setLineDash([]);
  // Target notch at the plate center.
  ctx.beginPath();
  ctx.moveTo(width / 2, height * 0.84);
  ctx.lineTo(width / 2 - 6, height * 0.875);
  ctx.lineTo(width / 2 + 6, height * 0.875);
  ctx.closePath();
  ctx.fillStyle = "#4a3428";
  ctx.fill();
}

function drawNozzle(
  ctx: CanvasRenderingContext2D,
  geometry: CakeGeometry,
  snapshot: AtelierViewSnapshot,
  height: number,
): void {
  const style = snapshot.frostStyle;
  if (!style) return;
  const fill = FROSTING_FILL[style];
  const x = geometry.faceLeft + (geometry.faceRight - geometry.faceLeft) * snapshot.nozzleX;
  const y = geometry.faceTop - height * 0.085;
  ctx.fillStyle = "#fefbf2";
  ctx.strokeStyle = "#4a3428";
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(x - 11, y - 17);
  ctx.lineTo(x + 11, y - 17);
  ctx.lineTo(x + 4, y + 3);
  ctx.lineTo(x - 4, y + 3);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = fill.base;
  ctx.beginPath();
  ctx.arc(x, y + 7, snapshot.frostingHeld ? 6 : 3.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

/** Paints one full frame of the atelier scene. */
export function drawAtelier(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  snapshot: AtelierViewSnapshot,
): CakeGeometry {
  ctx.clearRect(0, 0, width, height);
  drawBackdrop(ctx, width, height);
  drawPlate(ctx, width, height);

  const wobble = snapshot.reducedMotion || snapshot.stability >= 0.55
    ? 0
    : Math.sin(snapshot.wobblePhase * 5) * (1 - snapshot.stability) * width * 0.008;
  const boxes = layerBoxes(width, height, snapshot.stacked, wobble);
  const flavor = snapshot.flavor ?? snapshot.orderFlavor;
  for (const box of boxes) drawLayer(ctx, box, flavor);
  drawFrosting(ctx, boxes, snapshot);
  const geometry = cakeGeometry(width, height, snapshot.stacked);
  const glyphPx = Math.max(13, Math.round(width * 0.055));
  drawDecorations(ctx, geometry, snapshot.decorations, glyphPx);
  if (snapshot.phase === "decorate" && snapshot.ghost) {
    drawGhost(ctx, geometry, snapshot.ghost, glyphPx);
  }
  if (snapshot.phase === "bake") {
    drawOvenGauge(ctx, width, height, snapshot.needle, snapshot.bakedCount, snapshot.totalLayers);
  }
  if (snapshot.phase === "stack" && snapshot.swinging) {
    drawSwing(ctx, width, height, snapshot.swinging, snapshot.stacked.length, flavor);
  }
  if (snapshot.phase === "frost") {
    drawNozzle(ctx, geometry, snapshot, height);
  }
  if (snapshot.celebrating && !snapshot.reducedMotion) {
    ctx.font = `${Math.round(width * 0.06)}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    for (let sparkle = 0; sparkle < 6; sparkle += 1) {
      const angle = snapshot.wobblePhase * 1.4 + (sparkle * Math.PI) / 3;
      ctx.fillStyle = sparkle % 2 === 0 ? "#f7b731" : "#f5a0a8";
      ctx.fillText(
        "✦",
        geometry.topCenterX + Math.cos(angle) * width * 0.24,
        geometry.faceTop - height * 0.06 + Math.sin(angle) * height * 0.045,
      );
    }
  }
  return geometry;
}
