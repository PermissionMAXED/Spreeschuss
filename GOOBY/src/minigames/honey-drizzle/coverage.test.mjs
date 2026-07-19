import assert from "node:assert/strict";
import test from "node:test";
import { SeededRng } from "../../core/contracts/rng.ts";
import {
  createToastCorridor,
  HONEY_GRID_HEIGHT,
  HONEY_GRID_WIDTH,
  HONEY_REQUIRED_COVERAGE,
  HoneyDrizzleRound,
  honeyCoverage,
  honeyFloodRatio,
} from "./logic.ts";

function pointFor(index) {
  return {
    x: (index % HONEY_GRID_WIDTH + 0.5) / HONEY_GRID_WIDTH,
    y: (Math.floor(index / HONEY_GRID_WIDTH) + 0.5) / HONEY_GRID_HEIGHT,
  };
}

function fillCorridor(round) {
  for (let pass = 0; pass < 3 && round.coverage < 0.99; pass += 1) {
    for (let index = 0; index < round.corridor.length; index += 1) {
      if (!round.corridor[index] || round.deposits[index] >= 0.34) continue;
      const point = pointFor(index);
      round.drizzle(point, point, 0.03);
    }
    round.update(0.7);
  }
}

test("coverage and flood metrics count only target corridor cells", () => {
  const corridor = Uint8Array.from([1, 1, 0, 1]);
  const deposits = Float32Array.from([0.5, 0.2, 9, 1.5]);
  assert.equal(honeyCoverage(corridor, deposits), 2 / 3);
  assert.ok(Math.abs(honeyFloodRatio(corridor, deposits) - 1 / 6) < 1e-6);
  assert.throws(() => honeyCoverage(corridor, Float32Array.from([1])), RangeError);
});

test("three toast corridors are deterministic and distinct", () => {
  const first = createToastCorridor(0);
  const second = createToastCorridor(1);
  const third = createToastCorridor(2);
  assert.equal(first.length, HONEY_GRID_WIDTH * HONEY_GRID_HEIGHT);
  assert.notDeepEqual(first, second);
  assert.notDeepEqual(second, third);
  assert.deepEqual(createToastCorridor(0), first);
});

test("steady movement covers more than a rushed sweep", () => {
  const rushed = new HoneyDrizzleRound(new SeededRng(20));
  const steady = new HoneyDrizzleRound(new SeededRng(20));
  const from = { x: 0.08, y: 0.5 };
  const to = { x: 0.92, y: 0.5 };
  const fast = rushed.drizzle(from, to, 0.04);
  const cozy = steady.drizzle(from, to, 1.05);
  assert.ok(fast.speed > cozy.speed);
  assert.ok(steady.coverage > rushed.coverage);
  assert.ok(cozy.covered > fast.covered);
});

test("lingering floods while leaving the corridor spills", () => {
  const round = new HoneyDrizzleRound(new SeededRng(2));
  const gap = round.gap;
  const centerIndex = round.corridor.findIndex((cell, index) => {
    if (!cell) return false;
    const point = pointFor(index);
    return Math.hypot(point.x - gap.x, point.y - gap.y) > 0.15;
  });
  const center = pointFor(centerIndex);
  for (let index = 0; index < 5; index += 1) round.drizzle(center, center, 0.35);
  assert.ok(round.floodRatio > 0);
  const outside = round.drizzle({ x: 0.2, y: 0.05 }, { x: 0.8, y: 0.05 }, 0.8);
  assert.ok(outside.spill > 0);
  assert.ok(round.spillRatio > 0);
});

test("moving gap and warning advance only through injected time", () => {
  const round = new HoneyDrizzleRound(new SeededRng(11));
  const before = round.gap;
  const warning = round.beeWarning;
  round.update(1.2);
  assert.notDeepEqual(round.gap, before);
  let changed = round.beeWarning !== warning;
  for (let index = 0; index < 10 && !changed; index += 1) {
    round.update(0.4);
    changed = round.beeWarning !== warning;
  }
  assert.equal(changed, true);
});

test("three well-covered toasts settle a deterministic cozy payout", () => {
  const first = new HoneyDrizzleRound(new SeededRng(42));
  const second = new HoneyDrizzleRound(new SeededRng(42));
  for (let toast = 0; toast < 3; toast += 1) {
    fillCorridor(first);
    fillCorridor(second);
    assert.ok(first.coverage >= HONEY_REQUIRED_COVERAGE);
    assert.deepEqual(first.snapshot(), second.snapshot());
    assert.ok(first.finishToast());
    assert.ok(second.finishToast());
  }
  assert.equal(first.finished, true);
  assert.equal(first.results.length, 3);
  assert.deepEqual(first.results, second.results);
  assert.deepEqual(first.payout(), second.payout());
  assert.ok(first.payout().score > 0);
  assert.ok(first.payout().coins <= 52);
  assert.ok(first.payout().xp <= 115);
});

test("toast cannot be served before the coverage threshold", () => {
  const round = new HoneyDrizzleRound(new SeededRng(1));
  assert.equal(round.finishToast(), null);
  fillCorridor(round);
  assert.ok(round.coverage >= HONEY_REQUIRED_COVERAGE);
  assert.ok(round.finishToast());
});
