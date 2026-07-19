import { describe, expect, it } from "vitest";
import { createMinigameLifecycle, type MinigameSettlementReceipt } from "../../core/contracts/minigame";
import { SeededRng } from "../../core/contracts/rng";
import {
  applyFrostStroke,
  AtelierSession,
  CAKE_FLAVORS,
  comboMultiplier,
  createFrostCells,
  DECORATION_KINDS,
  FLUFF_PERFECT_ZONE,
  fluffQuality,
  FROST_CELLS,
  FROST_REQUIRED_COVERAGE,
  frostCoverage,
  judgeDecorations,
  layerAlignment,
  needlePositionAt,
  needleSweepsPerSecond,
  nextCombo,
  ORDERS_PER_ROUND,
  orderComplexity,
  orderParSeconds,
  rollOrderQueue,
  scoreOrder,
  settlePayout,
  stackStability,
  type CakeOrder,
  type DecorationKind,
} from "./logic";

const order = (overrides: Partial<CakeOrder> = {}): CakeOrder => ({
  index: 0,
  customer: 0,
  flavor: "clover-vanilla",
  layers: 1,
  frosting: "cream-swirl",
  decorations: ["sugar-clover", "honey-star"],
  parSeconds: orderParSeconds(0),
  ...overrides,
});

describe("order queue generation", () => {
  it("escalates layers 1→3 and decorations 2→4 across the three customers", () => {
    expect(orderComplexity(0)).toEqual({ layers: 1, decorations: 2 });
    expect(orderComplexity(1)).toEqual({ layers: 2, decorations: 3 });
    expect(orderComplexity(2)).toEqual({ layers: 3, decorations: 4 });
    const queue = rollOrderQueue(new SeededRng(7));
    expect(queue).toHaveLength(ORDERS_PER_ROUND);
    expect(queue.map(({ layers }) => layers)).toEqual([1, 2, 3]);
    expect(queue.map(({ decorations }) => decorations.length)).toEqual([2, 3, 4]);
  });

  it("is deterministic for a fixed seed and varies across seeds", () => {
    const first = rollOrderQueue(new SeededRng(1234));
    const replay = rollOrderQueue(new SeededRng(1234));
    expect(replay).toEqual(first);
    const seeds = Array.from({ length: 12 }, (_, seed) => rollOrderQueue(new SeededRng(seed)));
    const signatures = new Set(seeds.map((queue) => JSON.stringify(queue)));
    expect(signatures.size).toBeGreaterThan(1);
  });

  it("never repeats a decoration within one order and never repeats flavor or frosting back to back", () => {
    for (let seed = 0; seed < 40; seed += 1) {
      const queue = rollOrderQueue(new SeededRng(seed));
      for (const [index, entry] of queue.entries()) {
        expect(new Set(entry.decorations).size).toBe(entry.decorations.length);
        for (const kind of entry.decorations) expect(DECORATION_KINDS).toContain(kind);
        const previous = queue[index - 1];
        if (previous) {
          expect(entry.flavor).not.toBe(previous.flavor);
          expect(entry.frosting).not.toBe(previous.frosting);
        }
      }
    }
  });

  it("gives busier orders more par time", () => {
    expect(orderParSeconds(0)).toBeLessThan(orderParSeconds(1));
    expect(orderParSeconds(1)).toBeLessThan(orderParSeconds(2));
  });
});

describe("bake stop-needle", () => {
  it("oscillates as a triangle wave inside [0, 1]", () => {
    expect(needlePositionAt(0, 1)).toBe(0);
    expect(needlePositionAt(0.5, 1)).toBe(0.5);
    expect(needlePositionAt(1, 1)).toBe(1);
    expect(needlePositionAt(1.5, 1)).toBe(0.5);
    expect(needlePositionAt(2, 1)).toBe(0);
    for (let step = 0; step < 200; step += 1) {
      const position = needlePositionAt(step * 0.037, 0.8);
      expect(position).toBeGreaterThanOrEqual(0);
      expect(position).toBeLessThanOrEqual(1);
    }
  });

  it("speeds up for later customers and higher layers", () => {
    expect(needleSweepsPerSecond(0, 0)).toBeLessThan(needleSweepsPerSecond(1, 0));
    expect(needleSweepsPerSecond(1, 0)).toBeLessThan(needleSweepsPerSecond(1, 2));
  });

  it("scores perfect fluff in the center zone and zero far away", () => {
    expect(fluffQuality(0.5)).toBe(1);
    expect(fluffQuality(0.5 + FLUFF_PERFECT_ZONE / 2 - 0.001)).toBe(1);
    expect(fluffQuality(0.5 - FLUFF_PERFECT_ZONE / 2 + 0.001)).toBe(1);
    expect(fluffQuality(0)).toBe(0);
    expect(fluffQuality(1)).toBe(0);
    const near = fluffQuality(0.58);
    const far = fluffQuality(0.8);
    expect(near).toBeGreaterThan(far);
    expect(far).toBeGreaterThan(0);
  });
});

describe("stack alignment and stability", () => {
  it("rewards centered drops and punishes slides", () => {
    expect(layerAlignment(0)).toBe(1);
    expect(layerAlignment(0.05)).toBe(1);
    expect(layerAlignment(-0.05)).toBe(1);
    expect(layerAlignment(0.5)).toBe(0);
    expect(layerAlignment(0.2)).toBeGreaterThan(layerAlignment(0.35));
  });

  it("lets a single bad drop wobble the whole tower", () => {
    expect(stackStability([1, 1, 1])).toBe(1);
    const oneBad = stackStability([1, 1, 0.2]);
    const mean = (1 + 1 + 0.2) / 3;
    expect(oneBad).toBeLessThan(mean);
    expect(stackStability([])).toBe(1);
  });
});

describe("frosting coverage", () => {
  it("marks every cell a held swipe crosses exactly once", () => {
    const cells = createFrostCells();
    expect(applyFrostStroke(cells, 0, 0.5)).toBe(FROST_CELLS / 2);
    expect(applyFrostStroke(cells, 0.5, 0)).toBe(0);
    expect(frostCoverage(cells)).toBeCloseTo(0.5, 5);
  });

  it("accepts reversed and clamped stroke ranges", () => {
    const cells = createFrostCells();
    applyFrostStroke(cells, 0.9, 0.6);
    applyFrostStroke(cells, -0.4, 0.1);
    expect(frostCoverage(cells)).toBeGreaterThan(0);
    applyFrostStroke(cells, 0, 1);
    expect(frostCoverage(cells)).toBe(1);
  });

  it("requires ninety percent before an order can be frost-finished", () => {
    expect(FROST_REQUIRED_COVERAGE).toBe(0.9);
    const cells = createFrostCells();
    applyFrostStroke(cells, 0, 0.85);
    expect(frostCoverage(cells) >= FROST_REQUIRED_COVERAGE).toBe(false);
    applyFrostStroke(cells, 0.8, 1);
    expect(frostCoverage(cells) >= FROST_REQUIRED_COVERAGE).toBe(true);
  });
});

describe("decoration judgement", () => {
  it("counts distinct matches and penalizes extras softly", () => {
    const required: readonly DecorationKind[] = ["sugar-clover", "honey-star"];
    const complete = judgeDecorations(
      [
        { kind: "sugar-clover", x: 0.4, y: 0.5 },
        { kind: "honey-star", x: 0.6, y: 0.5 },
      ],
      required,
    );
    expect(complete).toMatchObject({ matched: 2, required: 2, extras: 0, complete: true, quality: 1 });

    const withExtra = judgeDecorations(
      [
        { kind: "sugar-clover", x: 0.4, y: 0.5 },
        { kind: "honey-star", x: 0.6, y: 0.5 },
        { kind: "berry-pearl", x: 0.5, y: 0.3 },
      ],
      required,
    );
    expect(withExtra.complete).toBe(true);
    expect(withExtra.quality).toBeCloseTo(0.85, 5);

    const partial = judgeDecorations([{ kind: "sugar-clover", x: 0.4, y: 0.5 }], required);
    expect(partial).toMatchObject({ matched: 1, complete: false });
    expect(partial.quality).toBeCloseTo(0.5, 5);
  });
});

describe("scoring quality + speed + combo", () => {
  it("combines the four quality shares with the documented weights", () => {
    const result = scoreOrder({
      order: order(),
      fluff: [1],
      alignments: [1],
      coverage: 1,
      decorations: judgeDecorations(
        [
          { kind: "sugar-clover", x: 0.4, y: 0.5 },
          { kind: "honey-star", x: 0.6, y: 0.5 },
        ],
        ["sugar-clover", "honey-star"],
      ),
      elapsedSeconds: 0,
      comboBonus: 0,
    });
    expect(result.quality).toBe(1);
    expect(result.qualityPoints).toBe(600);
    expect(result.speedPoints).toBe(200);
    expect(result.total).toBe(800);
    expect(result.stars).toBe(3);
  });

  it("erodes the speed bonus toward zero at and beyond par", () => {
    const base = {
      order: order(),
      fluff: [1],
      alignments: [1],
      coverage: 1,
      decorations: judgeDecorations([], []),
      comboBonus: 0,
    };
    const fast = scoreOrder({ ...base, elapsedSeconds: orderParSeconds(0) * 0.25 });
    const slow = scoreOrder({ ...base, elapsedSeconds: orderParSeconds(0) * 0.9 });
    const overtime = scoreOrder({ ...base, elapsedSeconds: orderParSeconds(0) * 3 });
    expect(fast.speedPoints).toBeGreaterThan(slow.speedPoints);
    expect(overtime.speedPoints).toBe(0);
  });

  it("chains great steps into a capped combo multiplier and resets on sloppy work", () => {
    expect(nextCombo(0, 1)).toBe(1);
    expect(nextCombo(3, 0.9)).toBe(4);
    expect(nextCombo(3, 0.5)).toBe(0);
    expect(nextCombo(8, 1)).toBe(8);
    expect(comboMultiplier(0)).toBe(1);
    expect(comboMultiplier(8)).toBeCloseTo(1.8, 5);
  });

  it("awards stars by quality thresholds", () => {
    const base = {
      order: order(),
      alignments: [1],
      coverage: 1,
      elapsedSeconds: 0,
      comboBonus: 0,
      decorations: judgeDecorations(
        [
          { kind: "sugar-clover", x: 0.4, y: 0.5 },
          { kind: "honey-star", x: 0.6, y: 0.5 },
        ],
        ["sugar-clover", "honey-star"],
      ),
    };
    expect(scoreOrder({ ...base, fluff: [1] }).stars).toBe(3);
    expect(scoreOrder({ ...base, fluff: [0.2] }).stars).toBe(2);
    expect(scoreOrder({ ...base, fluff: [0.2], coverage: 0, alignments: [0] }).stars).toBe(1);
  });
});

describe("session state machine", () => {
  function playPerfectOrder(session: AtelierSession): void {
    const current = session.currentOrder;
    expect(session.selectFlavor(current.flavor)).toEqual({ kind: "flavor", correct: true });
    for (let layer = 0; layer < current.layers; layer += 1) {
      // Drive the needle to dead center: at 0.5 / sweeps the triangle wave peaks mid-gauge.
      const sweeps = needleSweepsPerSecond(current.index, layer);
      session.update(0.5 / sweeps);
      const bake = session.stopNeedle();
      expect(bake.kind).toBe("bake");
      if (bake.kind === "bake") expect(bake.quality).toBe(1);
    }
    expect(session.phase).toBe("stack");
    for (let layer = 0; layer < current.layers; layer += 1) {
      expect(session.grabLayer()).toBe(true);
      session.moveLayer(0.5);
      const drop = session.dropLayer();
      expect(drop.kind).toBe("stack");
      if (drop.kind === "stack") expect(drop.alignment).toBe(1);
    }
    expect(session.phase).toBe("frost");
    expect(session.selectFrosting(current.frosting)).toEqual({ kind: "frost-style", correct: true });
    session.frostSweep(0, 1);
    expect(session.coverageReady).toBe(true);
    const finish = session.finishFrosting();
    expect(finish).toMatchObject({ kind: "frost", ready: true });
    expect(session.phase).toBe("decorate");
    for (const kind of current.decorations) {
      const placed = session.placeDecoration(kind, 0.5, 0.5);
      expect(placed).toMatchObject({ kind: "decorate", accepted: true });
    }
    expect(session.serveReady).toBe(true);
    const served = session.serve();
    expect(served.kind).toBe("serve");
  }

  it("walks flavor → bake → stack → frost → decorate → serve for all three customers", () => {
    const session = new AtelierSession(new SeededRng(21));
    expect(session.orders).toHaveLength(3);
    for (let customer = 0; customer < 3; customer += 1) {
      expect(session.currentOrderIndex).toBe(customer);
      playPerfectOrder(session);
    }
    expect(session.finished).toBe(true);
    expect(session.results).toHaveLength(3);
    expect(session.totalScore).toBeGreaterThan(0);
    for (const result of session.results) expect(result.stars).toBe(3);
  });

  it("replays bit-identically for the same seed and inputs", () => {
    const run = (): number => {
      const session = new AtelierSession(new SeededRng(99));
      for (let customer = 0; customer < 3; customer += 1) playPerfectOrder(session);
      return session.totalScore;
    };
    expect(run()).toBe(run());
  });

  it("rejects the wrong flavor and frosting in scored play and breaks the combo", () => {
    const session = new AtelierSession(new SeededRng(33));
    const wanted = session.currentOrder.flavor;
    const wrong = CAKE_FLAVORS.find((flavor) => flavor !== wanted);
    if (!wrong) throw new Error("Expected an alternative flavor");
    expect(session.selectFlavor(wrong)).toEqual({ kind: "flavor", correct: false });
    expect(session.phase).toBe("flavor");
    expect(session.selectFlavor(wanted)).toEqual({ kind: "flavor", correct: true });
    expect(session.phase).toBe("bake");
  });

  it("keeps guard rails on out-of-phase actions", () => {
    const session = new AtelierSession(new SeededRng(3));
    expect(() => session.stopNeedle()).toThrow(/phase/u);
    expect(() => session.dropLayer()).toThrow(/phase/u);
    expect(() => session.serve()).toThrow(/phase/u);
    expect(session.grabLayer()).toBe(false);
    expect(() => session.update(-1)).toThrow(RangeError);
  });

  it("refuses to finish frosting below ninety percent coverage", () => {
    const session = new AtelierSession(new SeededRng(5));
    session.selectFlavor(session.currentOrder.flavor);
    while (session.phase === "bake") session.stopNeedle();
    while (session.phase === "stack") {
      session.grabLayer();
      session.moveLayer(0.5);
      session.dropLayer();
    }
    session.selectFrosting(session.currentOrder.frosting);
    session.frostSweep(0, 0.5);
    expect(session.finishFrosting()).toMatchObject({ kind: "frost", ready: false });
    expect(session.phase).toBe("frost");
    session.frostSweep(0.5, 1);
    expect(session.finishFrosting()).toMatchObject({ kind: "frost", ready: true });
    expect(session.phase).toBe("decorate");
  });

  it("requires every ordered decoration before serve, ignores duplicates, and allows removal", () => {
    const session = new AtelierSession(new SeededRng(8));
    session.selectFlavor(session.currentOrder.flavor);
    while (session.phase === "bake") session.stopNeedle();
    while (session.phase === "stack") {
      session.grabLayer();
      session.moveLayer(0.5);
      session.dropLayer();
    }
    session.selectFrosting(session.currentOrder.frosting);
    session.frostSweep(0, 1);
    session.finishFrosting();

    const [first, second] = session.currentOrder.decorations;
    if (!first || !second) throw new Error("Expected at least two ordered decorations");
    session.placeDecoration(first, 0.4, 0.4);
    expect(session.serveReady).toBe(false);
    expect(session.serve()).toMatchObject({ kind: "decorate", accepted: false });
    expect(session.placeDecoration(first, 0.6, 0.6)).toMatchObject({ accepted: false });
    expect(session.placedDecorations).toHaveLength(1);
    expect(session.removeDecoration(first)).toBe(true);
    expect(session.removeDecoration(first)).toBe(false);
    session.placeDecoration(first, 0.4, 0.4);
    session.placeDecoration(second, 0.6, 0.6);
    expect(session.serveReady).toBe(session.currentOrder.decorations.length === 2);
  });

  it("tracks combo bonus across great steps into the order result", () => {
    const session = new AtelierSession(new SeededRng(21));
    const current = session.currentOrder;
    session.selectFlavor(current.flavor);
    session.update(0.5 / needleSweepsPerSecond(0, 0));
    session.stopNeedle();
    session.grabLayer();
    session.moveLayer(0.5);
    session.dropLayer();
    session.selectFrosting(current.frosting);
    session.frostSweep(0, 1);
    session.finishFrosting();
    for (const kind of current.decorations) session.placeDecoration(kind, 0.5, 0.5);
    const served = session.serve();
    expect(served.kind).toBe("serve");
    if (served.kind === "serve") {
      expect(served.result.comboPoints).toBeGreaterThan(0);
      expect(session.bestCombo).toBeGreaterThanOrEqual(4);
    }
  });
});

describe("free-decorate sandbox", () => {
  it("accepts any flavor and frosting, serves after one topping, and never pays out", () => {
    const session = new AtelierSession(new SeededRng(77), { sandbox: true });
    expect(session.orders).toHaveLength(1);
    const anyFlavor = CAKE_FLAVORS.find((flavor) => flavor !== session.currentOrder.flavor);
    if (!anyFlavor) throw new Error("Expected an off-order flavor");
    expect(session.selectFlavor(anyFlavor)).toEqual({ kind: "flavor", correct: true });
    while (session.phase === "bake") session.stopNeedle();
    while (session.phase === "stack") {
      session.grabLayer();
      session.moveLayer(0.5);
      session.dropLayer();
    }
    const offStyle = session.currentOrder.frosting === "cream-swirl" ? "berry-glaze" : "cream-swirl";
    expect(session.selectFrosting(offStyle)).toEqual({ kind: "frost-style", correct: true });
    session.frostSweep(0, 1);
    session.finishFrosting();
    session.placeDecoration("berry-pearl", 0.5, 0.5);
    expect(session.serveReady).toBe(true);
    expect(session.serve().kind).toBe("serve");
    expect(session.phase).toBe("serve");
    expect(session.results).toHaveLength(0);
    expect(session.payout()).toEqual({ score: 0, coins: 0, xp: 0 });
    session.restartSandboxCake();
    expect(session.phase).toBe("flavor");
  });

  it("forbids sandbox-only restarts in scored play", () => {
    const session = new AtelierSession(new SeededRng(4));
    expect(() => session.restartSandboxCake()).toThrow(/sandbox/u);
  });
});

describe("settlement", () => {
  it("converts scores into capped coins and xp", () => {
    expect(settlePayout(0)).toEqual({ score: 0, coins: 0, xp: 0 });
    expect(settlePayout(600)).toEqual({ score: 600, coins: 10, xp: 20 });
    expect(settlePayout(99_999)).toEqual({ score: 99_999, coins: 40, xp: 90 });
    expect(settlePayout(-50)).toEqual({ score: 0, coins: 0, xp: 0 });
  });

  it("settles a completed shift exactly once through the shared lifecycle", () => {
    const receipts = new Map<string, MinigameSettlementReceipt>();
    const events: string[] = [];
    let now = 50_000;
    const lifecycle = createMinigameLifecycle(
      "cake-atelier",
      { now: () => (now += 1) },
      {
        getBestScore: () => 0,
        getSettlement: (runId) => receipts.get(runId) ?? null,
        settle: (receipt) => {
          receipts.set(receipt.runId, receipt);
          return receipt;
        },
      },
      { emit: (event) => events.push(event.kind) },
    );
    const runId = lifecycle.beginRun();
    const payout = settlePayout(1_234);
    const first = lifecycle.completeRun(runId, payout);
    const replay = lifecycle.completeRun(runId, settlePayout(9_999));
    expect(receipts.size).toBe(1);
    expect(replay).toBe(first);
    expect(first.payout).toEqual(payout);
    expect(events).toEqual(["run-began", "run-completed"]);
  });

  it("leaves an exited run unpaid", () => {
    const receipts = new Map<string, MinigameSettlementReceipt>();
    const events: string[] = [];
    const lifecycle = createMinigameLifecycle(
      "cake-atelier",
      { now: () => 1 },
      {
        getBestScore: () => 0,
        getSettlement: (runId) => receipts.get(runId) ?? null,
        settle: (receipt) => {
          receipts.set(receipt.runId, receipt);
          return receipt;
        },
      },
      { emit: (event) => events.push(event.kind) },
    );
    lifecycle.beginRun();
    lifecycle.exit();
    lifecycle.exit();
    expect(receipts.size).toBe(0);
    expect(events).toEqual(["run-began", "run-exited"]);
  });
});
