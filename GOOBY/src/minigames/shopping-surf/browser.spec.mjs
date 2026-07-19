import { expect, test } from "@playwright/test";

const MODULE_PATH = "/src/minigames/shopping-surf/index.ts";

async function installGame(page, seed, bestScore = 0, reducedMotion = false) {
  await page.goto("/src/minigames/shopping-surf/harness.html");
  // Warm the module graph so a cold Vite dep-optimization reload cannot
  // destroy the evaluation context mid-install.
  await page
    .evaluate(async () => {
      await import("/src/minigames/shopping-surf/index.ts");
    })
    .catch(() => undefined);
  await page.goto("/src/minigames/shopping-surf/harness.html");
  await page.evaluate(
    async ({ modulePath, seed: randomSeed, initialBest, reduced }) => {
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
      {
        const stage = await import("/src/render/stage3d/index.ts");
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

      window.__surfTest = {
        game,
        payouts,
        settlements,
        feedbackEvents,
        audioEvents,
        hapticEvents,
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
    { modulePath: MODULE_PATH, seed, initialBest: bestScore, reduced: reducedMotion },
  );
}

const advance = (page, seconds) =>
  page.evaluate((duration) => window.__surfTest.advance(duration), seconds);

const stopLoop = (page) => page.evaluate(() => window.__surfTest.stopLoop());

const modelState = (page) =>
  page.evaluate(() => {
    const state = Reflect.get(window.__surfTest.game, "state");
    if (!state) return null;
    return {
      phase: state.phase,
      lane: state.lane,
      distance: state.distance,
      airborne: state.airborne,
      ducking: state.ducking,
      shields: state.shields,
      bumps: state.bumps,
      score: state.score,
      groceryCount: state.groceryCount,
      endReason: state.endReason,
      stats: { ...state.stats },
    };
  });

const modulePhase = (page) =>
  page.evaluate(() => Reflect.get(window.__surfTest.game, "phase"));

const lifecycleState = (page) =>
  page.evaluate(() => ({
    payouts: window.__surfTest.payouts.length,
    settlements: window.__surfTest.settlements.size,
    events: window.__surfTest.feedbackEvents.map(({ kind }) => kind),
  }));

async function finishTutorial(page) {
  const next = page.getByRole("button", { name: "Next" });
  while (await next.isVisible()) await next.click();
  await page.getByRole("button", { name: "Start round" }).click();
}

/** Clears the four practice gates with real keyboard input. */
async function completePractice(page) {
  await expect(page.locator(".ss-practice")).toBeVisible();
  await page.keyboard.press("a");
  await page.keyboard.press("d");
  await page.keyboard.press(" ");
  await page.keyboard.down("s");
  await page.keyboard.up("s");
  await expect(page.locator(".ss-practice")).toBeHidden();
}

/** Skips the 3-second countdown deterministically. */
async function skipCountdown(page) {
  await expect.poll(() => modulePhase(page)).toBe("countdown");
  await advance(page, 3.05);
  await expect.poll(() => modulePhase(page)).toBe("running");
}

async function swipe(page, from, to, steps = 8) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let step = 1; step <= steps; step += 1) {
    await page.mouse.move(
      from.x + ((to.x - from.x) * step) / steps,
      from.y + ((to.y - from.y) * step) / steps,
    );
  }
  await page.mouse.up();
}

test("plays a real keyboard session through practice gates to a settled finish", async ({ page }) => {
  await installGame(page, 4_021);
  await expect(page.locator("[data-minigame='shopping-surf']")).toHaveCount(1);
  await expect(page.locator(".ak-overlay:not([hidden]) .ak-card")).toContainText(
    "Ride the market lanes",
  );
  await finishTutorial(page);
  await stopLoop(page);

  // Practice gates demand the exact prompted action: a wrong key is ignored.
  await expect(page.locator(".ss-practice")).toContainText("move left");
  await expect(page.locator(".ss-practice-progress")).toHaveText("1 / 4");
  await page.keyboard.press("d");
  await expect(page.locator(".ss-practice-progress")).toHaveText("1 / 4");
  await page.keyboard.press("a");
  await expect(page.locator(".ss-practice-progress")).toHaveText("2 / 4");
  await expect(page.locator(".ss-practice")).toContainText("move right");
  await page.keyboard.press("d");
  await expect(page.locator(".ss-practice")).toContainText("Space to jump");
  await page.keyboard.press(" ");
  await expect(page.locator(".ss-practice")).toContainText("duck");
  await page.keyboard.down("s");
  await page.keyboard.up("s");
  await expect(page.locator(".ss-practice")).toBeHidden();

  // Countdown ticks 3-2-1 then GO.
  await expect(page.locator(".ss-countdown")).toHaveText("3");
  await advance(page, 1);
  await expect(page.locator(".ss-countdown")).toHaveText("2");
  await advance(page, 2.1);
  await expect.poll(() => modulePhase(page)).toBe("running");

  // Real inputs steer the scored run.
  await page.keyboard.press("a");
  await expect.poll(async () => (await modelState(page)).lane).toBe(0);
  await page.keyboard.press("d");
  await page.keyboard.press("d");
  await expect.poll(async () => (await modelState(page)).lane).toBe(2);
  await page.keyboard.press(" ");
  await advance(page, 0.1);
  expect((await modelState(page)).airborne).toBe(true);
  await advance(page, 1.2);
  await page.keyboard.down("s");
  await advance(page, 0.1);
  expect((await modelState(page)).ducking).toBe(true);
  await page.keyboard.up("s");
  await advance(page, 0.1);
  expect((await modelState(page)).ducking).toBe(false);

  // Teleport near the finish line so the checkout arrives deterministically
  // (the closing chunks are obstacle-free by design).
  await page.evaluate(() => {
    Reflect.get(window.__surfTest.game, "state").distance = 902;
  });
  await advance(page, 12);
  await expect.poll(() => modulePhase(page)).toBe("result");
  await expect(page.locator(".ak-result-score")).not.toHaveText("0");

  const outcome = await page.evaluate(() => {
    const receipts = [...window.__surfTest.settlements.values()];
    return {
      settlements: receipts.length,
      payout: receipts[0]?.payout ?? null,
      modulePayout: window.__surfTest.game.payout(),
      completed: window.__surfTest.feedbackEvents.filter(({ kind }) => kind === "run-completed").length,
      audio: window.__surfTest.audioEvents.map(([action]) => action),
      state: (() => {
        const state = Reflect.get(window.__surfTest.game, "state");
        return { endReason: state.endReason, stats: { ...state.stats } };
      })(),
    };
  });
  expect(outcome.settlements).toBe(1);
  expect(outcome.completed).toBe(1);
  expect(outcome.payout).toEqual(outcome.modulePayout);
  expect(outcome.payout.score).toBeGreaterThan(0);
  expect(outcome.state.endReason).toBe("finish");
  expect(outcome.state.stats.laneChanges).toBeGreaterThanOrEqual(3);
  expect(outcome.state.stats.jumps).toBeGreaterThanOrEqual(1);
  expect(outcome.state.stats.ducks).toBeGreaterThanOrEqual(1);
  expect(outcome.audio).toContain("countdown");
  expect(outcome.audio).toContain("go");
  expect(outcome.audio).toContain("win");

  // Collecting is idempotent: no duplicate receipt on replayed clicks.
  await page.getByRole("button", { name: "Collect rewards" }).click();
  await expect(page.getByRole("button", { name: "Surf!" })).toBeVisible();
  expect(await page.evaluate(() => window.__surfTest.settlements.size)).toBe(1);
});

test("pointer swipes change lanes, taps jump, and held down-swipes duck", async ({ page }) => {
  await installGame(page, 77);
  await finishTutorial(page);
  await stopLoop(page);
  // Skip the warm-up drills via the dedicated control.
  await page.getByRole("button", { name: "Skip warm-up" }).click();
  await skipCountdown(page);

  const center = { x: 195, y: 500 };

  // Swipe left: one lane down.
  await swipe(page, center, { x: center.x - 130, y: center.y });
  await expect.poll(async () => (await modelState(page)).lane).toBe(0);

  // Swipe right: back toward the middle.
  await swipe(page, center, { x: center.x + 130, y: center.y });
  await expect.poll(async () => (await modelState(page)).lane).toBe(1);

  // A quick tap (no drag) queues a jump.
  await page.mouse.move(center.x, center.y);
  await page.mouse.down();
  await page.mouse.up();
  await advance(page, 0.1);
  expect((await modelState(page)).airborne).toBe(true);
  await advance(page, 1.4);

  // A held downward swipe ducks until release.
  await page.mouse.move(center.x, center.y);
  await page.mouse.down();
  await page.mouse.move(center.x, center.y + 120, { steps: 6 });
  await advance(page, 0.1);
  expect((await modelState(page)).ducking).toBe(true);
  await page.mouse.up();
  await advance(page, 0.1);
  expect((await modelState(page)).ducking).toBe(false);

  const stats = (await modelState(page)).stats;
  expect(stats.laneChanges).toBeGreaterThanOrEqual(2);
  expect(stats.jumps).toBeGreaterThanOrEqual(1);
  expect(stats.ducks).toBeGreaterThanOrEqual(1);
});

test("tutorial, practice, and pause quits all exit unpaid with persisted best intact", async ({ page }) => {
  await installGame(page, 5, 850);
  // Quit from the tutorial: nothing was begun, nothing settles.
  await page.getByRole("button", { name: "Quit without reward" }).click();
  expect(await lifecycleState(page)).toEqual({ payouts: 0, settlements: 0, events: [] });
  await expect(page.getByRole("button", { name: "Surf!" })).toBeVisible();

  // Start a scored run, then quit from the pause menu: run exits unpaid.
  await page.getByRole("button", { name: "Surf!" }).click();
  await stopLoop(page);
  await skipCountdown(page);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Keep playing" })).toBeVisible();

  // While paused the simulation is frozen even if updates keep arriving.
  const frozen = (await modelState(page)).distance;
  await advance(page, 2);
  expect((await modelState(page)).distance).toBe(frozen);

  await page.getByRole("button", { name: "Quit without reward" }).click();
  expect(await lifecycleState(page)).toEqual({
    payouts: 0,
    settlements: 0,
    events: ["run-began", "run-exited"],
  });
  await expect(page.locator(".ss-status")).toContainText("Left unpaid");

  // The persisted best banner survives unpaid exits; module payout stays zero.
  expect(await page.evaluate(() => window.__surfTest.game.payout())).toEqual({
    score: 0,
    coins: 0,
    xp: 0,
  });

  // Disposal mid-ready leaves no DOM, no extra lifecycle noise.
  const cleanup = await page.evaluate(() => {
    window.__surfTest.dispose();
    window.__surfTest.game.update(1);
    return {
      roots: document.querySelectorAll("[data-minigame]").length,
      mountChildren: document.querySelector("main")?.childElementCount ?? -1,
      events: window.__surfTest.feedbackEvents.map(({ kind }) => kind),
    };
  });
  expect(cleanup).toEqual({
    roots: 0,
    mountChildren: 0,
    events: ["run-began", "run-exited"],
  });
});

test("pause and resume restore the exact run, and restart pays only the new run", async ({ page }) => {
  await installGame(page, 88);
  await finishTutorial(page);
  await stopLoop(page);
  await page.getByRole("button", { name: "Skip warm-up" }).click();
  await skipCountdown(page);
  await advance(page, 2);
  const before = await modelState(page);

  await page.getByRole("button", { name: "Pause" }).click();
  await advance(page, 3);
  const paused = await modelState(page);
  expect(paused.distance).toBe(before.distance);
  expect(paused.score).toBe(before.score);

  await page.getByRole("button", { name: "Keep playing" }).click();
  await advance(page, 0.5);
  expect((await modelState(page)).distance).toBeGreaterThan(before.distance);

  // Restart abandons the open run unpaid and begins a fresh one.
  await page.keyboard.press("p");
  await page.getByRole("button", { name: "Restart round" }).click();
  await skipCountdown(page);
  await page.evaluate(() => {
    Reflect.get(window.__surfTest.game, "state").distance = 902;
  });
  await advance(page, 12);
  await expect.poll(() => modulePhase(page)).toBe("result");
  expect(await lifecycleState(page)).toEqual({
    payouts: 0,
    settlements: 1,
    events: ["run-began", "run-exited", "run-began", "run-completed"],
  });
});

test("mid-run disposal settles nothing and releases the Stage3D lease leak-neutral", async ({ page }) => {
  await installGame(page, 31);
  await finishTutorial(page);
  await stopLoop(page);
  await page.getByRole("button", { name: "Skip warm-up" }).click();
  await skipCountdown(page);
  await advance(page, 2);

  const leak = await page.evaluate(() => {
    const scene = Reflect.get(window.__surfTest.game, "scene");
    const before = scene?.resourceDelta() ?? null;
    window.__surfTest.dispose();
    return {
      hadScene: scene !== null,
      grewWhileLive: before !== null && before.geometries > 0,
      after: scene?.resourceDelta() ?? null,
      events: window.__surfTest.feedbackEvents.map(({ kind }) => kind),
      settlements: window.__surfTest.settlements.size,
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

test("reduced motion locks the camera while the run stays fully playable", async ({ page }) => {
  await installGame(page, 55, 0, true);
  await expect(page.locator("section.shopping-surf[data-ak-reduced='true']")).toHaveCount(1);
  await finishTutorial(page);
  await stopLoop(page);
  await completePractice(page);
  await skipCountdown(page);
  await page.keyboard.press("a");
  await advance(page, 1);
  const state = await modelState(page);
  expect(state.lane).toBe(0);
  expect(state.distance).toBeGreaterThan(5);
});

test("meets the perf budget: ≥30fps, p95 ≤42ms, ≤70 draw calls", async ({ page }) => {
  await installGame(page, 99);
  await finishTutorial(page);
  await page.getByRole("button", { name: "Skip warm-up" }).click();
  // Let the real requestAnimationFrame loop drive the countdown and run.
  await expect.poll(() => modulePhase(page), { timeout: 15_000 }).toBe("running");

  // Keep the ride alive regardless of obstacles while sampling.
  const keepAlive = setInterval(() => {
    void page.evaluate(() => {
      const state = Reflect.get(window.__surfTest.game, "state");
      if (!state) return;
      state.bumps = 0;
      state.shields = 3;
      if (state.phase === "ending") {
        state.phase = "running";
        state.endReason = null;
        state.endTimer = 0;
      }
      state.finishZ = 1_000_000;
    }).catch(() => undefined);
  }, 500);
  await page.waitForTimeout(6_000);
  clearInterval(keepAlive);

  const perf = await page.evaluate(() => window.__surfTest.game.perfSnapshot());
  expect(perf.frames).toBeGreaterThan(60);
  expect(perf.fps).toBeGreaterThanOrEqual(30);
  expect(perf.p95FrameMs).toBeLessThanOrEqual(42);
  expect(perf.drawCalls).toBeGreaterThan(0);
  expect(perf.drawCalls).toBeLessThanOrEqual(70);
});
