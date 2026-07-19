import { expect, test } from "@playwright/test";

const MODULE_PATH = "/src/minigames/cloud-bounce/index.ts";
const HARNESS_PATH = "/src/minigames/cloud-bounce/harness.html";

async function installGame(page, seed, options = {}) {
  const { bestScore = 0, reducedMotion = false, blockStage = false } = options;
  await page.goto(HARNESS_PATH);
  // Warm the module graph so a cold Vite dep-optimization reload cannot
  // destroy the evaluation context mid-install.
  await page
    .evaluate(async () => {
      await import("/src/minigames/cloud-bounce/index.ts");
    })
    .catch(() => undefined);
  await page.goto(HARNESS_PATH);
  await page.evaluate(
    async ({ modulePath, seed: randomSeed, initialBest, reduced, block }) => {
      document.body.replaceChildren();
      Object.assign(document.body.style, {
        margin: "0",
        width: "100vw",
        height: "100vh",
        overflow: "hidden",
      });
      const mount = document.createElement("main");
      Object.assign(mount.style, { width: "100%", height: "100%", position: "relative" });
      document.body.append(mount);

      const gameModule = await import(modulePath);
      const { SeededRng } = await import("/src/core/contracts/rng.ts");
      const { createMinigameLifecycle } = await import("/src/core/contracts/minigame.ts");

      // Warm the shared Stage3D renderer once: three.js allocates a single
      // renderer-lifetime internal texture on the first lit-material render.
      // Folding it into the pre-lease baseline keeps the per-lease resource
      // deltas (the leak assertions) exact.
      const stage = await import("/src/render/stage3d/index.ts");
      {
        const three = await import("/@id/three");
        const warm = stage.acquireStage3d(mount, { clock: { now: () => 0 } });
        warm.scene.add(new three.AmbientLight(0xffffff, 1));
        warm.scene.add(
          new three.Mesh(
            new three.BoxGeometry(1, 1, 1),
            new three.MeshStandardMaterial({ color: 0xffffff }),
          ),
        );
        warm.renderOnce();
        warm.release();
      }

      // Optionally hold the shared lease hostage so the game must fall back
      // to its full 2D-canvas view.
      let blocker = null;
      if (block) {
        const blockHost = document.createElement("div");
        Object.assign(blockHost.style, { width: "10px", height: "10px" });
        document.body.append(blockHost);
        blocker = stage.acquireStage3d(blockHost, { clock: { now: () => 0 } });
      }

      const game = gameModule.createMinigame();
      const payouts = [];
      const settlements = new Map();
      const bestScores = new Map([[game.id, initialBest]]);
      const feedbackEvents = [];
      const audioEvents = [];
      const hapticEvents = [];
      let now = 1_000_000;
      let previousFrame = performance.now();
      let frame = 0;
      let loopRunning = true;
      const clock = { now: () => now };
      const lifecycle = createMinigameLifecycle(
        game.id,
        clock,
        {
          getBestScore: (id) => bestScores.get(id) ?? 0,
          getSettlement: (runId) => settlements.get(runId) ?? null,
          settle: (receipt) => {
            const previous = settlements.get(receipt.runId);
            if (previous) return previous;
            settlements.set(receipt.runId, receipt);
            bestScores.set(receipt.minigameId, receipt.bestScore);
            return receipt;
          },
        },
        { emit: (event) => feedbackEvents.push(event) },
      );

      game.mount({
        clock,
        rng: new SeededRng(randomSeed),
        mount,
        lifecycle,
        audio: { emit: (action, value) => audioEvents.push([action, value]) },
        haptics: { impact: (pattern) => hapticEvents.push(pattern) },
        bestScore: initialBest,
        reducedMotion: reduced,
        finish: (payout) => {
          payouts.push(payout);
        },
      });
      game.start();

      const loop = (frameAt) => {
        if (!loopRunning) return;
        const delta = Math.min(0.1, Math.max(0, (frameAt - previousFrame) / 1_000));
        previousFrame = frameAt;
        now += delta * 1_000;
        game.update(delta);
        frame = requestAnimationFrame(loop);
      };
      frame = requestAnimationFrame(loop);

      window.__cbTest = {
        game,
        payouts,
        settlements,
        feedbackEvents,
        audioEvents,
        hapticEvents,
        blocker,
        advance(seconds) {
          let remaining = seconds;
          while (remaining > 0.000_001) {
            const step = Math.min(0.05, remaining);
            remaining -= step;
            now += step * 1_000;
            game.update(step);
          }
        },
        stopLoop() {
          loopRunning = false;
          cancelAnimationFrame(frame);
        },
        dispose() {
          loopRunning = false;
          cancelAnimationFrame(frame);
          game.dispose();
        },
      };
    },
    {
      modulePath: MODULE_PATH,
      seed,
      initialBest: bestScore,
      reduced: reducedMotion,
      block: blockStage,
    },
  );
}

const advance = (page, seconds) =>
  page.evaluate((duration) => window.__cbTest.advance(duration), seconds);

const stopLoop = (page) => page.evaluate(() => window.__cbTest.stopLoop());

const modelState = (page) =>
  page.evaluate(() => {
    const state = Reflect.get(window.__cbTest.game, "state");
    if (!state) return null;
    return {
      phase: state.phase,
      x: state.x,
      y: state.y,
      vy: state.vy,
      drift: state.drift,
      bestY: state.bestY,
      score: state.score,
      starCount: state.starCount,
      windIndex: state.windIndex,
      endReason: state.endReason,
      stats: { ...state.stats },
    };
  });

const modulePhase = (page) =>
  page.evaluate(() => Reflect.get(window.__cbTest.game, "phase"));

const lifecycleState = (page) =>
  page.evaluate(() => ({
    payouts: window.__cbTest.payouts.length,
    settlements: window.__cbTest.settlements.size,
    events: window.__cbTest.feedbackEvents.map(({ kind }) => kind),
  }));

async function finishTutorial(page) {
  const next = page.getByRole("button", { name: "Next" });
  while (await next.isVisible()) await next.click();
  await page.getByRole("button", { name: "Start round" }).click();
}

/** Skips the 3-second countdown deterministically. */
async function skipCountdown(page) {
  await expect.poll(() => modulePhase(page)).toBe("countdown");
  await advance(page, 3.05);
  await expect.poll(() => modulePhase(page)).toBe("running");
}

/** Removes every cloud so the very next descent falls out of the sky. */
const cutAllClouds = (page) =>
  page.evaluate(() => {
    const state = Reflect.get(window.__cbTest.game, "state");
    for (const cloud of state.clouds) cloud.active = false;
  });

/** Drops a bonus star straight onto the player's current position. */
const placeStarOnPlayer = (page) =>
  page.evaluate(() => {
    const state = Reflect.get(window.__cbTest.game, "state");
    const star = state.starSlots[0];
    star.active = true;
    star.x = state.x;
    star.y = state.y;
    star.twinkle = 0;
  });

test("auto-bounces, drifts on held arrows, grabs a star, and settles after the fall", async ({ page }) => {
  await installGame(page, 4_021);
  await expect(page.locator("[data-minigame='cloud-bounce']")).toHaveCount(1);
  await expect(page.locator(".ak-overlay:not([hidden]) .ak-card")).toContainText(
    "Bounce and drift",
  );
  // Stop the live loop first: from here every frame comes from advance().
  await stopLoop(page);
  await finishTutorial(page);

  // Countdown ticks 3-2-1 then GO.
  await expect(page.locator(".cb-countdown")).toHaveText("3");
  await advance(page, 1);
  await expect(page.locator(".cb-countdown")).toHaveText("2");
  await advance(page, 2.1);
  await expect.poll(() => modulePhase(page)).toBe("running");

  // Auto-bounce with no input at all: the launch pad keeps returning Gooby.
  await advance(page, 3);
  const idle = await modelState(page);
  expect(idle.stats.bounces).toBeGreaterThanOrEqual(3);
  expect(idle.bestY).toBeGreaterThan(0.4);
  expect(idle.x).toBeCloseTo(0.5, 5);

  // A held arrow key drifts continuously until released.
  await page.keyboard.down("ArrowRight");
  await advance(page, 0.05);
  expect((await modelState(page)).drift).toBe(1);
  await advance(page, 0.6);
  const drifted = await modelState(page);
  expect(drifted.x).toBeGreaterThan(idle.x + 0.2);
  await page.keyboard.up("ArrowRight");
  await advance(page, 0.05);
  expect((await modelState(page)).drift).toBe(0);

  // A star dropped in Gooby's path collects and pays into the score.
  await placeStarOnPlayer(page);
  await advance(page, 0.1);
  const starred = await modelState(page);
  expect(starred.starCount).toBe(1);
  expect(starred.score).toBeGreaterThanOrEqual(25);
  await expect(page.locator(".cb-toast")).toContainText("Star ×1");

  // Cut the sky away: the fall ends the run and settles exactly once.
  await cutAllClouds(page);
  await advance(page, 3);
  await expect.poll(() => modulePhase(page)).toBe("result");
  await expect(page.locator(".ak-result-score")).not.toHaveText("0");

  const outcome = await page.evaluate(() => {
    const receipts = [...window.__cbTest.settlements.values()];
    return {
      settlements: receipts.length,
      payout: receipts[0]?.payout ?? null,
      modulePayout: window.__cbTest.game.payout(),
      completed: window.__cbTest.feedbackEvents.filter(({ kind }) => kind === "run-completed").length,
      audio: window.__cbTest.audioEvents.map(([action]) => action),
      state: (() => {
        const state = Reflect.get(window.__cbTest.game, "state");
        return { endReason: state.endReason, stats: { ...state.stats } };
      })(),
    };
  });
  expect(outcome.settlements).toBe(1);
  expect(outcome.completed).toBe(1);
  expect(outcome.payout).toEqual(outcome.modulePayout);
  expect(outcome.payout.score).toBeGreaterThan(0);
  expect(outcome.state.endReason).toBe("fall");
  expect(outcome.audio).toContain("countdown");
  expect(outcome.audio).toContain("go");
  expect(outcome.audio).toContain("hit");
  expect(outcome.audio).toContain("score");
  expect(outcome.audio).toContain("lose");
  expect(outcome.audio).toContain("win");

  // Collecting is idempotent: no duplicate receipt on replayed clicks.
  await page.getByRole("button", { name: "Collect rewards" }).click();
  await expect(page.getByRole("button", { name: "Start round" })).toBeVisible();
  expect(await page.evaluate(() => window.__cbTest.settlements.size)).toBe(1);
});

test("a held pointer drag drifts by offset and releases back to neutral", async ({ page }) => {
  await installGame(page, 77);
  await stopLoop(page);
  await finishTutorial(page);
  await skipCountdown(page);

  const center = { x: 195, y: 500 };
  await page.mouse.move(center.x, center.y);
  await page.mouse.down();
  await page.mouse.move(center.x + 130, center.y, { steps: 8 });
  await advance(page, 0.05);
  expect((await modelState(page)).drift).toBe(1);

  const before = await modelState(page);
  await advance(page, 0.5);
  expect((await modelState(page)).x).toBeGreaterThan(before.x + 0.15);

  // Dragging back through the origin flips the drift sign while still held.
  await page.mouse.move(center.x - 130, center.y, { steps: 8 });
  await advance(page, 0.05);
  expect((await modelState(page)).drift).toBe(-1);

  await page.mouse.up();
  await advance(page, 0.05);
  expect((await modelState(page)).drift).toBe(0);
});

test("tutorial and pause quits both exit unpaid with persisted best intact", async ({ page }) => {
  await installGame(page, 5, { bestScore: 850 });
  // Quit from the tutorial: nothing was begun, nothing settles.
  await page.getByRole("button", { name: "Quit without reward" }).click();
  expect(await lifecycleState(page)).toEqual({ payouts: 0, settlements: 0, events: [] });
  await expect(page.getByRole("button", { name: "Start round" })).toBeVisible();

  // Start a scored run, then quit from the pause menu: run exits unpaid.
  await stopLoop(page);
  await page.getByRole("button", { name: "Start round" }).click();
  await skipCountdown(page);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Keep playing" })).toBeVisible();

  // While paused the simulation is frozen even if updates keep arriving.
  const frozen = (await modelState(page)).y;
  await advance(page, 2);
  expect((await modelState(page)).y).toBe(frozen);

  await page.getByRole("button", { name: "Quit without reward" }).click();
  expect(await lifecycleState(page)).toEqual({
    payouts: 0,
    settlements: 0,
    events: ["run-began", "run-exited"],
  });
  await expect(page.locator(".cb-status")).toContainText("Left without reward");
  expect(await page.evaluate(() => window.__cbTest.game.payout())).toEqual({
    score: 0,
    coins: 0,
    xp: 0,
  });
});

test("pause and resume restore the run, and restart pays only the new run", async ({ page }) => {
  await installGame(page, 88);
  await stopLoop(page);
  await finishTutorial(page);
  await skipCountdown(page);
  await advance(page, 1);
  const before = await modelState(page);

  await page.getByRole("button", { name: "Pause" }).click();
  await advance(page, 3);
  const paused = await modelState(page);
  expect(paused.y).toBe(before.y);
  expect(paused.stats.bounces).toBe(before.stats.bounces);

  await page.getByRole("button", { name: "Keep playing" }).click();
  await advance(page, 1.2);
  expect((await modelState(page)).stats.bounces).toBeGreaterThan(before.stats.bounces);

  // Restart abandons the open run unpaid and begins a fresh one.
  await page.keyboard.press("p");
  await page.getByRole("button", { name: "Restart round" }).click();
  await skipCountdown(page);
  await cutAllClouds(page);
  await advance(page, 3);
  await expect.poll(() => modulePhase(page)).toBe("result");
  expect(await lifecycleState(page)).toEqual({
    payouts: 0,
    settlements: 1,
    events: ["run-began", "run-exited", "run-began", "run-completed"],
  });
});

test("mid-run disposal settles nothing and releases the Stage3D lease leak-neutral", async ({ page }) => {
  await installGame(page, 31);
  await stopLoop(page);
  await finishTutorial(page);
  await skipCountdown(page);
  await advance(page, 2);

  const leak = await page.evaluate(() => {
    const scene = Reflect.get(window.__cbTest.game, "scene");
    const before = scene?.resourceDelta() ?? null;
    window.__cbTest.dispose();
    return {
      hadScene: scene !== null,
      grewWhileLive: before !== null && before.geometries > 0,
      after: scene?.resourceDelta() ?? null,
      events: window.__cbTest.feedbackEvents.map(({ kind }) => kind),
      settlements: window.__cbTest.settlements.size,
      canvases: document.querySelectorAll("canvas").length,
    };
  });
  expect(leak.hadScene).toBe(true);
  expect(leak.grewWhileLive).toBe(true);
  expect(leak.after).toEqual({ geometries: 0, textures: 0, programs: 0 });
  expect(leak.events).toEqual(["run-began", "run-exited"]);
  expect(leak.settlements).toBe(0);
  expect(leak.canvases).toBe(0);
});

test("falls back to the full 2D-canvas view when no Stage3D lease is available", async ({ page }) => {
  await installGame(page, 12, { blockStage: true });
  const wiring = await page.evaluate(() => ({
    scene: Reflect.get(window.__cbTest.game, "scene") !== null,
    fallback: Reflect.get(window.__cbTest.game, "fallback") !== null,
  }));
  expect(wiring).toEqual({ scene: false, fallback: true });
  await expect(page.locator(".cb-stage canvas.cb-canvas")).toHaveCount(1);
  await expect(page.locator(".cb-status")).toContainText("Simple sky view");

  // The complete game still plays: drift, bounce, stars, fall, settlement.
  await stopLoop(page);
  await finishTutorial(page);
  await skipCountdown(page);
  await advance(page, 2.5);
  expect((await modelState(page)).stats.bounces).toBeGreaterThanOrEqual(2);
  await page.keyboard.down("a");
  await advance(page, 0.6);
  await page.keyboard.up("a");
  expect((await modelState(page)).x).toBeLessThan(0.3);
  await placeStarOnPlayer(page);
  await advance(page, 0.1);
  expect((await modelState(page)).starCount).toBe(1);
  await cutAllClouds(page);
  await advance(page, 3);
  await expect.poll(() => modulePhase(page)).toBe("result");
  expect(await lifecycleState(page)).toMatchObject({ settlements: 1 });
});

test("reduced motion keeps the sky fully playable", async ({ page }) => {
  await installGame(page, 55, { reducedMotion: true });
  await expect(page.locator("section.cloud-bounce[data-ak-reduced='true']")).toHaveCount(1);
  await stopLoop(page);
  await finishTutorial(page);
  await skipCountdown(page);
  await page.keyboard.down("ArrowRight");
  await advance(page, 1.2);
  await page.keyboard.up("ArrowRight");
  const state = await modelState(page);
  expect(state.stats.bounces).toBeGreaterThanOrEqual(1);
  expect(state.x).toBeGreaterThan(0.6);
});

test("meets the perf budget: ≥30fps, p95 ≤42ms, ≤70 draw calls", async ({ page }) => {
  await installGame(page, 99);
  await finishTutorial(page);
  // Let the real requestAnimationFrame loop drive the countdown and run.
  await expect.poll(() => modulePhase(page), { timeout: 15_000 }).toBe("running");

  // Keep the climb alive while sampling: periodic updrafts prevent the fall.
  const keepAlive = setInterval(() => {
    void page.evaluate(() => {
      const state = Reflect.get(window.__cbTest.game, "state");
      if (!state || state.phase !== "running") return;
      state.vy = 3;
    }).catch(() => undefined);
  }, 400);
  await page.waitForTimeout(6_000);
  clearInterval(keepAlive);

  const perf = await page.evaluate(() => window.__cbTest.game.perfSnapshot());
  expect(perf.frames).toBeGreaterThan(60);
  expect(perf.fps).toBeGreaterThanOrEqual(30);
  expect(perf.p95FrameMs).toBeLessThanOrEqual(42);
  expect(perf.drawCalls).toBeGreaterThan(0);
  expect(perf.drawCalls).toBeLessThanOrEqual(70);
});
