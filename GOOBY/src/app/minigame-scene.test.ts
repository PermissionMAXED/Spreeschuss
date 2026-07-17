import { afterEach, describe, expect, it, vi } from "vitest";
import { FakeClock } from "../core/contracts/clock";
import type {
  MinigameContext,
  MinigameFeedbackEvent,
  MinigameModule,
  MinigameSettlementReceipt,
} from "../core/contracts/minigame";
import type { HapticPattern } from "../core/contracts/platform";
import { SeededRng } from "../core/contracts/rng";
import {
  MinigameFeedbackRouter,
  MinigameScene,
} from "./minigame-scene";

type TraceEntry = `audio:${string}` | `haptic:${HapticPattern}`;

function began(runId = "bunny-hop:1000:1"): MinigameFeedbackEvent {
  return { kind: "run-began", minigameId: "bunny-hop", runId };
}

function completed(
  runId = "bunny-hop:1000:1",
  score = 42,
): MinigameFeedbackEvent {
  return {
    kind: "run-completed",
    receipt: {
      runId,
      minigameId: "bunny-hop",
      payout: { coins: 4, xp: 3, score },
      bestScore: score,
      completedAt: 1_000,
    },
  };
}

function exited(runId = "bunny-hop:1000:1"): MinigameFeedbackEvent {
  return { kind: "run-exited", minigameId: "bunny-hop", runId };
}

function createRouter(enabled = true): {
  readonly router: MinigameFeedbackRouter;
  readonly trace: TraceEntry[];
  setEnabled(value: boolean): void;
} {
  const trace: TraceEntry[] = [];
  let hapticsEnabled = enabled;
  return {
    router: new MinigameFeedbackRouter(
      { emit: (action) => trace.push(`audio:${action}`) },
      { impact: (pattern) => trace.push(`haptic:${pattern}`) },
      () => hapticsEnabled,
    ),
    trace,
    setEnabled: (value) => {
      hapticsEnabled = value;
    },
  };
}

describe("minigame event routing", () => {
  it("uses game start and one lifecycle success when no game outcome is emitted", async () => {
    const { router, trace } = createRouter();

    router.handleLifecycle(began());
    expect(trace).toEqual([]);
    router.emitAudio("go");
    router.handleLifecycle(completed());
    await Promise.resolve();

    expect(trace).toEqual(["audio:go", "audio:win"]);
  });

  it("keeps Bunny Hop loss authoritative when settlement completes later", async () => {
    const { router, trace } = createRouter();

    router.handleLifecycle(began());
    router.emitAudio("lose");
    router.handleLifecycle(completed());
    await Promise.resolve();

    expect(trace).toEqual(["audio:lose"]);
  });

  it("emits no outcome for an exited unpaid run", async () => {
    const { router, trace } = createRouter();

    router.handleLifecycle(began());
    router.handleLifecycle(exited());
    await Promise.resolve();

    expect(trace).toEqual([]);
  });

  it("routes a Rhythm miss as one audio cue and one explicit haptic", () => {
    const { router, trace } = createRouter();

    router.handleLifecycle(began("rhythm-hop:1000:1"));
    router.emitAudio("miss");
    router.impact("warning");

    expect(trace).toEqual(["audio:miss", "haptic:warning"]);
  });

  it("honors disabled haptics even when a native driver is available", () => {
    const harness = createRouter(false);

    harness.router.emitAudio("miss");
    harness.router.impact("warning");
    expect(harness.trace).toEqual(["audio:miss"]);

    harness.setEnabled(true);
    harness.router.impact("warning");
    expect(harness.trace).toEqual(["audio:miss", "haptic:warning"]);
  });

  it("deduplicates repeated terminal game cues without adding lifecycle success", async () => {
    const { router, trace } = createRouter();

    router.handleLifecycle(began());
    router.emitAudio("lose");
    router.emitAudio("lose");
    router.handleLifecycle(completed());
    await Promise.resolve();

    expect(trace).toEqual(["audio:lose"]);
  });
});

class FakeElement {
  hidden = true;
  readonly dataset: Record<string, string> = {};
  firstElementChild: FakeElement | null = null;

  replaceChildren(...children: FakeElement[]): void {
    this.firstElementChild = children[0] ?? null;
  }
}

describe("minigame scene lifecycle", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not create scene-entry feedback and still settles legacy finish calls", async () => {
    vi.stubGlobal("HTMLElement", FakeElement);
    const mount = new FakeElement();
    const receipts = new Map<string, MinigameSettlementReceipt>();
    const trace: TraceEntry[] = [];
    const captured: { finish?: MinigameContext["finish"] } = {};
    let settled: MinigameSettlementReceipt | null = null;
    const module: MinigameModule = {
      id: "bunny-hop",
      title: "Trace game",
      instructions: "Finish once",
      mount: (nextContext) => {
        captured.finish = (payout) => nextContext.finish(payout);
        (nextContext.mount as unknown as FakeElement).replaceChildren(new FakeElement());
      },
      start: () => undefined,
      pause: () => undefined,
      resume: () => undefined,
      update: () => undefined,
      payout: () => ({ coins: 2, xp: 1, score: 7 }),
      dispose: () => undefined,
    };
    const scene = new MinigameScene(
      module,
      mount as unknown as HTMLElement,
      new FakeClock(1_000),
      new SeededRng(1),
      {
        persistence: {
          getBestScore: () => 0,
          getSettlement: (runId) => receipts.get(runId) ?? null,
          settle: (receipt) => {
            receipts.set(receipt.runId, receipt);
            return receipt;
          },
        },
        audio: { emit: (action) => trace.push(`audio:${action}`) },
        haptics: { impact: (pattern) => trace.push(`haptic:${pattern}`) },
        hapticsEnabled: () => true,
        reducedMotion: false,
        onSettled: (receipt) => {
          settled = receipt;
        },
      },
    );

    await scene.enter({ viewport: { width: 390, height: 844, pixelRatio: 1 } });
    expect(trace).toEqual([]);
    expect(receipts).toHaveLength(0);

    captured.finish?.({ coins: 2, xp: 1, score: 7 });
    await Promise.resolve();

    expect(receipts).toHaveLength(1);
    expect(settled).toMatchObject({ payout: { coins: 2, xp: 1, score: 7 } });
    expect(trace).toEqual(["audio:win"]);
  });
});
