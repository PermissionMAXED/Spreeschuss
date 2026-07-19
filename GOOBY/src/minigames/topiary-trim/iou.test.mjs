import assert from "node:assert/strict";
import test from "node:test";
import { SeededRng } from "../../core/contracts/rng.ts";
import {
  createOvergrownMask,
  rasterIoU,
  rasterizeTopiary,
  TOPIARY_BLOWER_USES,
  TOPIARY_PREVIEW_SECONDS,
  TOPIARY_RASTER_SIZE,
  TOPIARY_REQUIRED_IOU,
  TOPIARY_SHAPES,
  TopiaryRound,
  trimRasterSegment,
} from "./logic.ts";

test("raster IoU handles exact, disjoint, and partial silhouettes", () => {
  assert.equal(rasterIoU(Uint8Array.from([1, 0, 1]), Uint8Array.from([1, 0, 1])), 1);
  assert.equal(rasterIoU(Uint8Array.from([1, 0]), Uint8Array.from([0, 1])), 0);
  assert.equal(rasterIoU(Uint8Array.from([1, 1, 0]), Uint8Array.from([0, 1, 1])), 1 / 3);
  assert.throws(() => rasterIoU(Uint8Array.from([1]), Uint8Array.from([1, 0])), RangeError);
});

test("all three original silhouettes rasterize distinctly and deterministically", () => {
  const masks = TOPIARY_SHAPES.map((shape) => rasterizeTopiary(shape));
  for (const mask of masks) {
    assert.equal(mask.length, TOPIARY_RASTER_SIZE ** 2);
    const cells = mask.reduce((sum, cell) => sum + cell, 0);
    assert.ok(cells > 400);
    assert.ok(cells < mask.length * 0.7);
  }
  assert.notDeepEqual(masks[0], masks[1]);
  assert.notDeepEqual(masks[1], masks[2]);
  assert.deepEqual(rasterizeTopiary(TOPIARY_SHAPES[0]), masks[0]);
});

test("trimming outside growth improves IoU while cutting the figure records damage", () => {
  const target = rasterizeTopiary("moon-bunny");
  const current = createOvergrownMask(target);
  const before = rasterIoU(current, target);
  let outsideIndex = -1;
  let insideIndex = -1;
  for (let index = 0; index < current.length; index += 1) {
    if (outsideIndex < 0 && current[index] && !target[index]) outsideIndex = index;
    if (insideIndex < 0 && target[index]) insideIndex = index;
  }
  const point = (index) => ({
    x: (index % TOPIARY_RASTER_SIZE + 0.5) / TOPIARY_RASTER_SIZE,
    y: (Math.floor(index / TOPIARY_RASTER_SIZE) + 0.5) / TOPIARY_RASTER_SIZE,
  });
  const outside = point(outsideIndex);
  const tidy = trimRasterSegment(current, target, outside, outside, 0.006);
  assert.equal(tidy.targetDamage, 0);
  assert.ok(tidy.iou > before);
  const inside = point(insideIndex);
  const damage = trimRasterSegment(current, target, inside, inside, 0.006);
  assert.ok(damage.targetDamage > 0);
  assert.ok(damage.iou < tidy.iou);
});

function perfectTrim(round) {
  for (let index = 0; index < round.current.length; index += 1) {
    if (!round.current[index] || round.target[index]) continue;
    const point = {
      x: (index % TOPIARY_RASTER_SIZE + 0.5) / TOPIARY_RASTER_SIZE,
      y: (Math.floor(index / TOPIARY_RASTER_SIZE) + 0.5) / TOPIARY_RASTER_SIZE,
    };
    round.trim(point, point, 0.006);
  }
}

test("round requires the IoU threshold, advances three bushes, and pays cozy rewards", () => {
  const round = new TopiaryRound(new SeededRng(31));
  assert.equal(round.finishBush(), null);
  for (let bush = 0; bush < 3; bush += 1) {
    perfectTrim(round);
    assert.ok(round.iou >= TOPIARY_REQUIRED_IOU);
    const result = round.finishBush();
    assert.ok(result);
    assert.ok(result.iou > 0.98);
  }
  assert.equal(round.finished, true);
  assert.equal(round.results.length, 3);
  const payout = round.payout();
  assert.ok(payout.score > 1_000);
  assert.ok(payout.coins <= 50);
  assert.ok(payout.xp <= 110);
});

test("leaf blower preview is round-limited and expires only through injected time", () => {
  const round = new TopiaryRound(new SeededRng(9));
  assert.equal(round.previewsLeft, TOPIARY_BLOWER_USES);
  assert.equal(round.useLeafBlower(), true);
  assert.equal(round.useLeafBlower(), false);
  round.update(TOPIARY_PREVIEW_SECONDS);
  assert.equal(round.previewRemaining, 0);
  assert.equal(round.useLeafBlower(), true);
  round.update(TOPIARY_PREVIEW_SECONDS);
  assert.equal(round.useLeafBlower(), false);
  assert.equal(round.previewsLeft, 0);
});

test("same seed and trim sequence produce identical round state", () => {
  const first = new TopiaryRound(new SeededRng(5));
  const second = new TopiaryRound(new SeededRng(5));
  const strokes = [
    [{ x: 0.05, y: 0.1 }, { x: 0.9, y: 0.1 }],
    [{ x: 0.1, y: 0.9 }, { x: 0.9, y: 0.9 }],
    [{ x: 0.05, y: 0.1 }, { x: 0.05, y: 0.9 }],
  ];
  for (const [from, to] of strokes) {
    first.trim(from, to, 0.03);
    second.trim(from, to, 0.03);
  }
  assert.deepEqual(first.snapshot(), second.snapshot());
  assert.deepEqual(first.current, second.current);
});
