import { expect, test } from "@playwright/test";

const MODULE_PATH = "/src/minigames/firefly-lantern/index.ts";
const HARNESS_PATH = "/src/minigames/firefly-lantern/harness.html";

async function installGame(page, seed, bestScore = 0, reducedMotion = false) {
  await page.goto(HARNESS_PATH);
  // Warm the module graph so a cold Vite dep-optimization reload cannot
  // destroy the evaluation context mid-install.
  await page
    .evaluate(async () => {
      await import("/src/minigames/firefly-lantern/index.ts");
    })
    .catch(() => undefined);
  await page.goto(HARNESS_PATH);
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

      window.__flTest = {
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
  page.evaluate((duration) => window.__flTest.advance(duration), seconds);

const stopLoop = (page) => page.evaluate(() => window.__flTest.stopLoop());

const modelState = (page) =>
  page.evaluate(() => {
    const state = Reflect.get(window.__flTest.game, "state");
    if (!state) return null;
    return {
      phase: state.phase,
      round: state.round,
      ink: state.ink,
      score: state.score,
      strokes: state.strokes.length,
      banked: state.bankedThisRound,
      convoy: state.convoyChain,
      bestConvoy: state.bestConvoy,
      timeLeft: state.timeLeft,
      stats: { ...state.stats },
    };
  });

const modulePhase = (page) =>
  page.evaluate(() => Reflect.get(window.__flTest.game, "phase"));

const lifecycleState = (page) =>
  page.evaluate(() => ({
    payouts: window.__flTest.payouts.length,
    settlements: window.__flTest.settlements.size,
    events: window.__flTest.feedbackEvents.map(({ kind }) => kind),
  }));

async function finishTutorial(page) {
  const next = page.getByRole("button", { name: "Next" });
  while (await next.isVisible()) await next.click();
  await page.getByRole("button", { name: "Start round" }).click();
}

/** Skips the 3-second countdown plus the round intro deterministically. */
async function skipToPlaying(page) {
  await expect.poll(() => modulePhase(page)).toBe("countdown");
  await advance(page, 3.05);
  await expect.poll(() => modulePhase(page)).toBe("running");
  await advance(page, 1.7);
  await expect.poll(async () => (await modelState(page)).phase).toBe("playing");
}

/** Draws a real held-pointer stroke through the given viewport points. */
async function paintStroke(page, points, steps = 6) {
  const [first, ...rest] = points;
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  let previous = first;
  for (const point of rest) {
    for (let step = 1; step <= steps; step += 1) {
      await page.mouse.move(
        previous.x + ((point.x - previous.x) * step) / steps,
        previous.y + ((point.y - previous.y) * step) / steps,
      );
    }
    previous = point;
  }
  await page.mouse.up();
}

/** Teleports every airborne firefly next to the lantern so it banks. */
const bankAllFireflies = (page) =>
  page.evaluate(() => {
    const state = Reflect.get(window.__flTest.game, "state");
    for (const firefly of state.fireflies) {
      if (firefly.mode === "banked" || firefly.mode === "lost") continue;
      firefly.x = state.lanternX;
      firefly.y = state.lanternY + 0.08;
      firefly.mode = "lantern";
    }
  });

test("paints real pointer strokes, banks a convoy, and settles a five-round run", async ({ page }) => {
  await installGame(page, 4_021);
  await expect(page.locator("[data-minigame='firefly-lantern']")).toHaveCount(1);
  await expect(page.locator(".ak-overlay:not([hidden]) .ak-card")).toContainText(
    "Paint a light path",
  );
  // Stop the live loop first: from here every frame comes from advance().
  await stopLoop(page);
  await finishTutorial(page);

  // Countdown ticks 3-2-1 then GO, then the round intro plays.
  await expect(page.locator(".fl-countdown")).toHaveText("3");
  await advance(page, 1);
  await expect(page.locator(".fl-countdown")).toHaveText("2");
  await advance(page, 2.1);
  await expect.poll(() => modulePhase(page)).toBe("running");
  await advance(page, 1.7);
  await expect.poll(async () => (await modelState(page)).phase).toBe("playing");

  // A real held-pointer drag paints a glowing path and drains ink.
  const before = await modelState(page);
  expect(before.strokes).toBe(0);
  await paintStroke(page, [
    { x: 60, y: 730 },
    { x: 200, y: 700 },
    { x: 330, y: 730 },
  ]);
  const painted = await modelState(page);
  expect(painted.stats.strokes).toBeGreaterThanOrEqual(1);
  expect(painted.strokes).toBeGreaterThanOrEqual(1);
  expect(painted.ink).toBeLessThan(before.ink);
  expect(painted.stats.paintedLength).toBeGreaterThan(0.1);

  // Ink regenerates on its own while nobody paints.
  await advance(page, 2);
  expect((await modelState(page)).ink).toBeGreaterThan(painted.ink);

  // Keyboard path: arrows steer the brush, held Space paints.
  await page.keyboard.down("ArrowLeft");
  await page.keyboard.down(" ");
  await advance(page, 0.6);
  await page.keyboard.up(" ");
  await page.keyboard.up("ArrowLeft");
  expect((await modelState(page)).stats.strokes).toBeGreaterThanOrEqual(2);

  // Round 1 clears with a banked convoy (teleported next to the lantern).
  await bankAllFireflies(page);
  await advance(page, 1.5);
  const cleared = await modelState(page);
  expect(cleared.stats.banked).toBe(3);
  expect(cleared.bestConvoy).toBeGreaterThanOrEqual(2);
  expect(cleared.score).toBeGreaterThan(0);
  await expect.poll(async () => (await modelState(page)).phase).toBe("clear");

  // Rounds 2-5: bank everything as soon as each round starts playing.
  for (let round = 1; round < 5; round += 1) {
    await advance(page, 3.5);
    await expect.poll(async () => (await modelState(page)).phase).toBe("playing");
    expect((await modelState(page)).round).toBe(round);
    await bankAllFireflies(page);
    await advance(page, 1.5);
  }
  await advance(page, 2);
  await expect.poll(() => modulePhase(page)).toBe("result");
  await expect(page.locator(".ak-result-score")).not.toHaveText("0");

  const outcome = await page.evaluate(() => {
    const receipts = [...window.__flTest.settlements.values()];
    return {
      settlements: receipts.length,
      payout: receipts[0]?.payout ?? null,
      modulePayout: window.__flTest.game.payout(),
      completed: window.__flTest.feedbackEvents.filter(({ kind }) => kind === "run-completed").length,
      audio: window.__flTest.audioEvents.map(([action]) => action),
    };
  });
  expect(outcome.settlements).toBe(1);
  expect(outcome.completed).toBe(1);
  expect(outcome.payout).toEqual(outcome.modulePayout);
  expect(outcome.payout.score).toBeGreaterThan(100);
  expect(outcome.audio).toContain("countdown");
  expect(outcome.audio).toContain("go");
  expect(outcome.audio).toContain("combo");
  expect(outcome.audio).toContain("win");

  // Collecting is idempotent: no duplicate receipt on replayed clicks.
  await page.getByRole("button", { name: "Collect rewards" }).click();
  await expect(page.getByRole("button", { name: "Start round" })).toBeVisible();
  expect(await page.evaluate(() => window.__flTest.settlements.size)).toBe(1);
});

test("brambles block strokes and empty ink refuses to paint", async ({ page }) => {
  await installGame(page, 77);
  await stopLoop(page);
  await finishTutorial(page);
  await skipToPlaying(page);

  // Drag straight into the first bramble: the stroke is cut and toasts.
  const target = await page.evaluate(() => {
    const state = Reflect.get(window.__flTest.game, "state");
    const bramble = state.obstacles[0];
    return { x: bramble.x, y: bramble.y };
  });
  const from = { x: target.x * 390, y: 844 * 0.9 };
  await paintStroke(page, [from, { x: target.x * 390, y: target.y * 844 }], 20);
  await advance(page, 0.05); // One frame drains the model events into the UI.
  await expect(page.locator(".fl-toast")).toContainText("Brambles block the ink");
  const blocked = await modelState(page);
  expect(blocked.stats.strokes).toBeGreaterThanOrEqual(1);

  // With the pot forced empty, new strokes are refused and toast.
  await page.evaluate(() => {
    Reflect.get(window.__flTest.game, "state").ink = 0.01;
  });
  await paintStroke(page, [
    { x: 80, y: 730 },
    { x: 200, y: 730 },
  ]);
  await advance(page, 0.05);
  await expect(page.locator(".fl-toast")).toContainText("Ink is empty");
  const starved = await modelState(page);
  await advance(page, 3);
  expect((await modelState(page)).ink).toBeGreaterThan(starved.ink);
});

test("tutorial and pause quits both exit unpaid with persisted best intact", async ({ page }) => {
  await installGame(page, 5, 850);
  // Quit from the tutorial: nothing was begun, nothing settles.
  await page.getByRole("button", { name: "Quit without reward" }).click();
  expect(await lifecycleState(page)).toEqual({ payouts: 0, settlements: 0, events: [] });
  await expect(page.getByRole("button", { name: "Start round" })).toBeVisible();

  // Start a scored run, then quit from the pause menu: run exits unpaid.
  await stopLoop(page);
  await page.getByRole("button", { name: "Start round" }).click();
  await skipToPlaying(page);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Keep playing" })).toBeVisible();

  // While paused the simulation is frozen even if updates keep arriving.
  const frozen = (await modelState(page)).timeLeft;
  await advance(page, 2);
  expect((await modelState(page)).timeLeft).toBe(frozen);

  await page.getByRole("button", { name: "Quit without reward" }).click();
  expect(await lifecycleState(page)).toEqual({
    payouts: 0,
    settlements: 0,
    events: ["run-began", "run-exited"],
  });
  await expect(page.locator(".fl-status")).toContainText("Left without reward");
  expect(await page.evaluate(() => window.__flTest.game.payout())).toEqual({
    score: 0,
    coins: 0,
    xp: 0,
  });

  // Disposal mid-ready leaves no DOM, no extra lifecycle noise.
  const cleanup = await page.evaluate(() => {
    window.__flTest.dispose();
    window.__flTest.game.update(1);
    return {
      roots: document.querySelectorAll("[data-minigame]").length,
      mountChildren: document.querySelector("main")?.childElementCount ?? -1,
      events: window.__flTest.feedbackEvents.map(({ kind }) => kind),
    };
  });
  expect(cleanup).toEqual({
    roots: 0,
    mountChildren: 0,
    events: ["run-began", "run-exited"],
  });
});

test("pause and resume restore the run, and restart pays only the new run", async ({ page }) => {
  await installGame(page, 88);
  await stopLoop(page);
  await finishTutorial(page);
  await skipToPlaying(page);
  await advance(page, 2);
  const before = await modelState(page);

  await page.getByRole("button", { name: "Pause" }).click();
  await advance(page, 3);
  const paused = await modelState(page);
  expect(paused.timeLeft).toBe(before.timeLeft);
  expect(paused.score).toBe(before.score);

  await page.getByRole("button", { name: "Keep playing" }).click();
  await advance(page, 0.5);
  expect((await modelState(page)).timeLeft).toBeLessThan(before.timeLeft);

  // Restart abandons the open run unpaid and begins a fresh one.
  await page.keyboard.press("p");
  await page.getByRole("button", { name: "Restart round" }).click();
  await skipToPlaying(page);
  for (let round = 0; round < 5; round += 1) {
    await bankAllFireflies(page);
    await advance(page, 5);
  }
  await expect.poll(() => modulePhase(page)).toBe("result");
  expect(await lifecycleState(page)).toEqual({
    payouts: 0,
    settlements: 1,
    events: ["run-began", "run-exited", "run-began", "run-completed"],
  });
});

test("reduced motion keeps the dusk meadow fully playable", async ({ page }) => {
  await installGame(page, 55, 0, true);
  await expect(page.locator("section.firefly-lantern[data-ak-reduced='true']")).toHaveCount(1);
  await stopLoop(page);
  await finishTutorial(page);
  await skipToPlaying(page);
  await paintStroke(page, [
    { x: 80, y: 730 },
    { x: 300, y: 700 },
  ]);
  const state = await modelState(page);
  expect(state.stats.strokes).toBeGreaterThanOrEqual(1);
  await bankAllFireflies(page);
  await advance(page, 1.5);
  expect((await modelState(page)).stats.banked).toBe(3);
});
