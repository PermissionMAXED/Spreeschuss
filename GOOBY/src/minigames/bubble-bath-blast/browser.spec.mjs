import { expect, test } from "@playwright/test";

const BUBBLE_MODULE = "/src/minigames/bubble-bath-blast/index.ts";
const VEGGIE_MODULE = "/src/minigames/veggie-sort/index.ts";

async function installGame(page, modulePath, factoryName, seed, bestScore = 0) {
  await page.goto("/src/minigames/bubble-bath-blast/harness.html");
  await page.evaluate(
    async ({ modulePath: path, factoryName: factory, seed: randomSeed, initialBest }) => {
      document.body.replaceChildren();
      Object.assign(document.body.style, {
        margin: "0",
        width: "100vw",
        height: "100vh",
        overflow: "hidden",
      });
      const mount = document.createElement("main");
      Object.assign(mount.style, { width: "100%", height: "100%" });
      document.body.append(mount);

      const gameModule = await import(path);
      const { SeededRng } = await import("/src/core/contracts/rng.ts");
      const { createMinigameLifecycle } = await import("/src/core/contracts/minigame.ts");
      const game = gameModule[factory]();
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
      const runId = lifecycle.beginRun();

      game.mount({
        clock,
        rng: new SeededRng(randomSeed),
        mount,
        lifecycle,
        audio: { emit: (action, value) => audioEvents.push([action, value]) },
        haptics: { impact: (pattern) => hapticEvents.push(pattern) },
        bestScore: initialBest,
        reducedMotion: true,
        finish: (payout) => {
          payouts.push(payout);
          lifecycle.completeRun(runId, payout);
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

      window.__minigamePackTest = {
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
    { modulePath, factoryName, seed, initialBest: bestScore },
  );
}

const advance = (page, seconds) =>
  page.evaluate((duration) => window.__minigamePackTest.advance(duration), seconds);

async function stopLoop(page) {
  await page.evaluate(() => window.__minigamePackTest.stopLoop());
}

async function configureBubbleField(page, bubbles) {
  await page.evaluate((nextBubbles) => {
    const game = window.__minigamePackTest.game;
    Reflect.set(game, "bubbles", nextBubbles);
    Reflect.get(game, "renderBubbles").call(game);
  }, bubbles);
}

async function configureVeggie(page, statePatch, item) {
  await page.evaluate(({ patch, currentItem }) => {
    const game = window.__minigamePackTest.game;
    Reflect.set(game, "state", { ...Reflect.get(game, "state"), ...patch });
    Reflect.set(game, "currentItem", currentItem);
    Reflect.set(game, "inputLocked", 0);
    Reflect.set(game, "transition", null);
    Reflect.get(game, "render").call(game);
  }, { patch: statePatch, currentItem: item });
}

async function verifyDisposal(page, expectedFinishes = 1) {
  const result = await page.evaluate(() => {
    const harness = window.__minigamePackTest;
    const finishes = harness.payouts.length;
    harness.dispose();
    harness.game.update(10);
    return {
      finishes,
      roots: document.querySelectorAll("[data-minigame]").length,
      mountChildren: document.querySelector("main")?.childElementCount ?? -1,
      pendingTimers: Reflect.get(harness.game, "scheduled")?.size ?? 0,
    };
  });
  expect(result).toEqual({
    finishes: expectedFinishes,
    roots: 0,
    mountChildren: 0,
    pendingTimers: 0,
  });
}

test("Bubble keeps a real 120ms touch stable and pops the same-symbol chain", async ({ page, context }) => {
  await installGame(page, BUBBLE_MODULE, "createBubbleBathBlast", 41);
  await page.getByRole("button", { name: "START SPLASHING" }).click();
  await configureBubbleField(page, [
    {
      id: 101,
      kind: "bubble",
      color: "coral",
      symbol: "star",
      x: 50,
      y: 45,
      radius: 7,
      speed: 0,
      bornAt: 1_000_000,
    },
    {
      id: 102,
      kind: "bubble",
      color: "mint",
      symbol: "star",
      x: 60,
      y: 45,
      radius: 7,
      speed: 0,
      bornAt: 1_000_000,
    },
  ]);

  const bubble = page.locator('[data-bubble="101"]');
  const bounds = await bubble.boundingBox();
  if (!bounds) throw new Error("Bubble did not render");
  await bubble.evaluate((element) => { window.__heldBubble = element; });
  const cdp = await context.newCDPSession(page);
  const point = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] });
  await page.waitForTimeout(120);
  await expect.poll(() => page.evaluate(() => (
    window.__heldBubble === document.querySelector('[data-bubble="101"]')
  ))).toBe(true);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });

  await expect(page.locator("[data-score]")).toHaveText("70");
  await expect(bubble).toHaveCount(0);
  await expect(page.locator('[data-bubble="102"]')).toHaveCount(0);
  expect(await page.evaluate(() => window.__minigamePackTest.audioEvents.map(([action]) => action))).toContain("hit");
});

test("Bubble rubber duck scores in untimed Zen and settles half rewards", async ({ page }) => {
  await installGame(page, BUBBLE_MODULE, "createBubbleBathBlast", 45);
  await page.getByRole("button", { name: /ZEN · NO TIMER/u }).click();
  await stopLoop(page);
  await configureBubbleField(page, [{
    id: 103,
    kind: "duck",
    color: "sun",
    symbol: "sun",
    x: 50,
    y: 45,
    radius: 7,
    speed: 0,
    bornAt: 1_000_000,
  }]);

  await page.getByRole("button", { name: "Rubber duck bonus, 500 points" }).click();
  await expect(page.locator("[data-time]")).toHaveText("∞ ZEN");
  await expect(page.locator("[data-score]")).toHaveText("500");
  expect(await page.evaluate(() => window.__minigamePackTest.game.payout())).toEqual({
    score: 500,
    coins: 1,
    xp: 2,
  });
  await page.getByRole("button", { name: "Pause" }).click();
  await page.getByRole("button", { name: "QUIT & KEEP SCORE" }).click();
  await expect(page.locator("[data-result-reward]")).toContainText("Zen half payout");
  expect(await page.evaluate(() => window.__minigamePackTest.settlements.size)).toBe(1);
});

test("Bubble renders redundant shape, pattern, visible label, and accessible label cues", async ({ page }) => {
  await installGame(page, BUBBLE_MODULE, "createBubbleBathBlast", 42);
  await page.getByRole("button", { name: "START SPLASHING" }).click();
  await stopLoop(page);
  const colors = ["coral", "sun", "mint", "sky", "grape"];
  await configureBubbleField(page, colors.map((color, index) => ({
    id: index + 201,
    kind: "bubble",
    color,
    x: 12 + index * 19,
    y: 40,
    radius: 6,
    speed: 0,
    bornAt: 1_000_000,
  })));

  await expect(page.locator("[data-shape]")).toHaveCount(5);
  expect(new Set(await page.locator("[data-shape]").evaluateAll((nodes) =>
    nodes.map((node) => node.dataset.shape)))).toHaveProperty("size", 5);
  expect(new Set(await page.locator("[data-pattern]").evaluateAll((nodes) =>
    nodes.map((node) => node.dataset.pattern)))).toHaveProperty("size", 5);
  await expect(page.locator(".bubble-label")).toHaveCount(5);
  for (const bubble of await page.locator("[data-cue]").all()) {
    await expect(bubble).toHaveAttribute("aria-label", /bubble, .* pattern/u);
  }
});

test("Bubble uses persisted best, exits a tutorial unpaid, and settles terminal state once", async ({ page }) => {
  await installGame(page, BUBBLE_MODULE, "createBubbleBathBlast", 43, 900);
  await expect(page.locator("[data-result-best]")).toContainText("Best 0");
  await page.getByRole("button", { name: "LEAVE THE BATH" }).click();
  expect(await page.evaluate(() => ({
    payouts: window.__minigamePackTest.payouts.length,
    settlements: window.__minigamePackTest.settlements.size,
    events: window.__minigamePackTest.feedbackEvents.map(({ kind }) => kind),
  }))).toEqual({ payouts: 0, settlements: 0, events: ["run-began", "run-exited"] });
  await expect(page.locator("[data-result-reward]")).toHaveText("No rewards collected");
  await verifyDisposal(page, 0);

  await installGame(page, BUBBLE_MODULE, "createBubbleBathBlast", 44, 900);
  await page.getByRole("button", { name: "START SPLASHING" }).click();
  await stopLoop(page);
  await page.evaluate(() => {
    const game = window.__minigamePackTest.game;
    Reflect.set(game, "scoreState", { score: 1_200, stars: 2, combo: 3, timePenalty: 0 });
    Reflect.set(game, "remaining", 0.01);
  });
  await advance(page, 0.02);
  await expect(page.locator("[data-result-best]")).toContainText("Best 1,200");
  await page.getByRole("button", { name: "SPLASH AGAIN" }).click();
  await advance(page, 1);
  expect(await page.evaluate(() => ({
    phase: Reflect.get(window.__minigamePackTest.game, "phase"),
    payouts: window.__minigamePackTest.payouts.length,
    settlements: window.__minigamePackTest.settlements.size,
    completed: window.__minigamePackTest.feedbackEvents.filter(({ kind }) => kind === "run-completed").length,
  }))).toEqual({ phase: "ended", payouts: 1, settlements: 1, completed: 1 });
});

const carrot = { id: "carrot", label: "Carrot", emoji: "🥕", category: "vegetable" };

test("Veggie resumes correct and wrong feedback transitions exactly once", async ({ page }) => {
  for (const scenario of [
    { state: { mistakes: 0 }, direction: "left", expectedCorrect: true },
    { state: { mistakes: 0 }, direction: "right", expectedCorrect: false },
  ]) {
    await installGame(page, VEGGIE_MODULE, "createVeggieSort", scenario.expectedCorrect ? 51 : 52);
    await page.getByRole("button", { name: "CLOCK IN" }).click();
    await stopLoop(page);
    await configureVeggie(page, scenario.state, carrot);
    await page.locator(`[data-direction="${scenario.direction}"]`).click();
    await page.evaluate(() => window.__minigamePackTest.game.pause());
    const paused = await page.evaluate(() => ({
      transition: { ...Reflect.get(window.__minigamePackTest.game, "transition") },
      item: Reflect.get(window.__minigamePackTest.game, "currentItem"),
    }));
    await page.waitForTimeout(450);
    expect(await page.evaluate(() => ({
      transition: { ...Reflect.get(window.__minigamePackTest.game, "transition") },
      item: Reflect.get(window.__minigamePackTest.game, "currentItem"),
    }))).toEqual(paused);

    await page.evaluate(() => window.__minigamePackTest.game.resume());
    await advance(page, 0.34);
    const spawnedId = await page.evaluate(() => Reflect.get(window.__minigamePackTest.game, "currentItem")?.id);
    expect(spawnedId).toBeTruthy();
    await advance(page, 0.2);
    expect(await page.evaluate(() => ({
      item: Reflect.get(window.__minigamePackTest.game, "currentItem")?.id,
      transition: Reflect.get(window.__minigamePackTest.game, "transition"),
      correct: Reflect.get(window.__minigamePackTest.game, "state").totalCorrect,
      mistakes: Reflect.get(window.__minigamePackTest.game, "state").mistakes,
    }))).toEqual({
      item: spawnedId,
      transition: null,
      correct: scenario.expectedCorrect ? 1 : 0,
      mistakes: scenario.expectedCorrect ? 0 : 1,
    });
  }
});

test("Veggie pauses final settlement and reverse-frenzy boundaries without duplication", async ({ page }) => {
  await installGame(page, VEGGIE_MODULE, "createVeggieSort", 61);
  await page.getByRole("button", { name: "CLOCK IN" }).click();
  await stopLoop(page);
  await configureVeggie(page, { totalCorrect: 9, streak: 9, multiplier: 3 }, carrot);
  await page.locator('[data-direction="left"]').click();
  await page.evaluate(() => window.__minigamePackTest.game.pause());
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => ({
    reverse: Reflect.get(window.__minigamePackTest.game, "state").reverseFrenzy,
    remaining: Reflect.get(window.__minigamePackTest.game, "transition").remaining,
  }))).toEqual({ reverse: true, remaining: 0.33 });
  await expect(page.locator('[data-bin="left"]')).toContainText("FRUIT");
  await expect(page.locator('[data-bin="left"]')).toContainText("🍎");
  await expect(page.locator('[data-bin="left"]')).toHaveAttribute("aria-label", "Sort fruit left");
  await expect(page.locator('[data-bin="right"]')).toContainText("VEGGIES");
  await expect(page.locator('[data-bin="right"]')).toHaveAttribute("aria-label", "Sort vegetables right");

  await page.evaluate(() => window.__minigamePackTest.game.resume());
  await advance(page, 0.34);
  await expect(page.locator("[data-frenzy]")).toHaveClass(/active/u);
  await page.evaluate(() => window.__minigamePackTest.game.pause());
  const locked = await page.evaluate(() => Reflect.get(window.__minigamePackTest.game, "inputLocked"));
  await page.waitForTimeout(1_600);
  expect(await page.evaluate(() => Reflect.get(window.__minigamePackTest.game, "inputLocked"))).toBe(locked);
  await expect(page.locator("[data-frenzy]")).toHaveClass(/active/u);
  await page.evaluate(() => window.__minigamePackTest.game.resume());
  await advance(page, 1.5);
  await expect(page.locator("[data-frenzy]")).not.toHaveClass(/active/u);

  await configureVeggie(page, { mistakes: 2, reverseFrenzy: false, frenzyRemaining: 0 }, carrot);
  await page.locator('[data-direction="right"]').click();
  await page.evaluate(() => window.__minigamePackTest.game.pause());
  await page.waitForTimeout(650);
  expect(await page.evaluate(() => window.__minigamePackTest.payouts.length)).toBe(0);
  await page.evaluate(() => window.__minigamePackTest.game.resume());
  await advance(page, 0.49);
  expect(await page.evaluate(() => window.__minigamePackTest.payouts.length)).toBe(0);
  await advance(page, 0.02);
  await page.getByRole("button", { name: "WORK ANOTHER SHIFT" }).click();
  await advance(page, 1);
  expect(await page.evaluate(() => ({
    phase: Reflect.get(window.__minigamePackTest.game, "phase"),
    payouts: window.__minigamePackTest.payouts.length,
    settlements: window.__minigamePackTest.settlements.size,
    completed: window.__minigamePackTest.feedbackEvents.filter(({ kind }) => kind === "run-completed").length,
  }))).toEqual({ phase: "ended", payouts: 1, settlements: 1, completed: 1 });
});

test("Veggie leaves zero-action shifts unpaid and uses shared feedback", async ({ page }) => {
  await installGame(page, VEGGIE_MODULE, "createVeggieSort", 71, 700);
  await page.getByRole("button", { name: "CLOCK IN" }).click();
  await page.getByRole("button", { name: "Pause" }).click();
  await page.getByRole("button", { name: "END SHIFT" }).click();
  expect(await page.evaluate(() => ({
    payouts: window.__minigamePackTest.payouts.length,
    settlements: window.__minigamePackTest.settlements.size,
    events: window.__minigamePackTest.feedbackEvents.map(({ kind }) => kind),
    audio: window.__minigamePackTest.audioEvents.map(([action]) => action),
    haptics: window.__minigamePackTest.hapticEvents,
  }))).toEqual({
    payouts: 0,
    settlements: 0,
    events: ["run-began", "run-exited"],
    audio: ["go"],
    haptics: ["success"],
  });
  await expect(page.locator("[data-result-best]")).toHaveText("Best 700");
  await verifyDisposal(page, 0);
});
