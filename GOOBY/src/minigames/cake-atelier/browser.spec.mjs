import { expect, test } from "@playwright/test";

const MODULE_PATH = "/src/minigames/cake-atelier/index.ts";

async function installGame(page, seed, bestScore = 0) {
  await page.goto("/src/minigames/cake-atelier/harness.html");
  // Cold Vite dev servers may optimize newly discovered deps (three/addons)
  // on first import and force a page reload, destroying the evaluation
  // context. Warm the module graph up, then start from a fresh navigation.
  await page
    .evaluate(async () => {
      await import("/src/minigames/cake-atelier/index.ts");
    })
    .catch(() => undefined);
  await page.goto("/src/minigames/cake-atelier/harness.html");
  await page.evaluate(
    async ({ modulePath, seed: randomSeed, initialBest }) => {
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
      const logicModule = await import("/src/minigames/cake-atelier/logic.ts");
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
      lifecycle.beginRun();

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

      window.__atelierTest = {
        game,
        payouts,
        settlements,
        feedbackEvents,
        audioEvents,
        hapticEvents,
        flavors: logicModule.CAKE_FLAVORS,
        advance(seconds) {
          let remaining = seconds;
          while (remaining > 0.000_001) {
            const step = Math.min(0.05, remaining);
            remaining -= step;
            now += step * 1_000;
            game.update(step);
          }
        },
        dispose() {
          loopRunning = false;
          cancelAnimationFrame(frame);
          game.dispose();
        },
      };
    },
    { modulePath: MODULE_PATH, seed, initialBest: bestScore },
  );
}

const advance = (page, seconds) =>
  page.evaluate((duration) => window.__atelierTest.advance(duration), seconds);

const sessionState = (page) =>
  page.evaluate(() => {
    const session = Reflect.get(window.__atelierTest.game, "session");
    if (!session) return null;
    const order = session.currentOrder;
    return {
      phase: session.phase,
      orderIndex: session.currentOrderIndex,
      flavor: order.flavor,
      layers: order.layers,
      frosting: order.frosting,
      decorations: [...order.decorations],
      coverage: session.coverage,
      totalScore: session.totalScore,
      results: session.results.length,
      sandbox: session.sandbox,
      actions: session.actions,
    };
  });

const lifecycleState = (page) =>
  page.evaluate(() => ({
    payouts: window.__atelierTest.payouts.length,
    settlements: window.__atelierTest.settlements.size,
    events: window.__atelierTest.feedbackEvents.map(({ kind }) => kind),
  }));

async function finishTutorial(page) {
  const next = page.getByRole("button", { name: "Next" });
  while (await next.isVisible()) await next.click();
  await page.getByRole("button", { name: "Start round" }).click();
}

async function dragOnCanvas(page, fromFraction, toFraction, heightFraction = 0.45) {
  const box = await page.locator(".ca-canvas").boundingBox();
  if (!box) throw new Error("Atelier canvas did not render");
  const y = box.y + box.height * heightFraction;
  await page.mouse.move(box.x + box.width * fromFraction, y);
  await page.mouse.down();
  const steps = 12;
  for (let step = 1; step <= steps; step += 1) {
    const fraction = fromFraction + ((toFraction - fromFraction) * step) / steps;
    await page.mouse.move(box.x + box.width * fraction, y);
  }
  await page.mouse.up();
}

async function clickCanvasAt(page, xFraction, yFraction) {
  const box = await page.locator(".ca-canvas").boundingBox();
  if (!box) throw new Error("Atelier canvas did not render");
  await page.mouse.click(box.x + box.width * xFraction, box.y + box.height * yFraction);
}

/** Plays the current customer's order start to finish with real inputs. */
async function completeCurrentOrder(page, { keyboardFlavor = false } = {}) {
  const order = await sessionState(page);
  if (!order || order.phase !== "flavor") throw new Error(`Unexpected phase ${order?.phase}`);

  if (keyboardFlavor) {
    const digit = await page.evaluate(
      (flavor) => String(window.__atelierTest.flavors.indexOf(flavor) + 1),
      order.flavor,
    );
    await page.keyboard.press(digit);
  } else {
    await page.locator(`[data-ca-action="flavor:${order.flavor}"]`).click();
  }

  for (let layer = 0; layer < order.layers; layer += 1) {
    await page.getByRole("button", { name: /Stop the needle/u }).click();
  }

  for (let layer = 0; layer < order.layers; layer += 1) {
    await dragOnCanvas(page, 0.22, 0.5);
  }

  await page.locator(`[data-ca-action="frosting:${order.frosting}"]`).click();
  // A held swipe across the full cake face: coverage must reach ≥90%.
  await dragOnCanvas(page, 0.03, 0.97, 0.5);
  const done = page.locator("[data-ca='done-frosting']");
  await expect(done).toBeEnabled();
  await expect(page.locator("[data-ca='coverage-label']")).toContainText("/ 90%");
  await done.click();

  for (const [index, kind] of order.decorations.entries()) {
    await page.locator(`[data-ca-action="topping:${kind}"]`).click();
    await clickCanvasAt(page, 0.4 + index * 0.06, 0.35);
  }
  const serve = page.locator("[data-ca='serve']");
  await expect(serve).toBeEnabled();
  await serve.click();
  return order;
}

test("completes a full three-customer shift with real pointer + keyboard input and settles once", async ({ page }) => {
  await installGame(page, 4_242);
  await finishTutorial(page);
  await page.getByRole("button", { name: /Take orders/u }).click();
  await advance(page, 3.2);

  const first = await completeCurrentOrder(page, { keyboardFlavor: true });
  expect(first.layers).toBe(1);
  expect(first.decorations).toHaveLength(2);
  await expect(page.locator(".ca-panel")).toContainText("Order served!");
  await expect(page.locator(".ca-stars")).toBeVisible();
  await page.getByRole("button", { name: "Next customer" }).click();

  const second = await completeCurrentOrder(page);
  expect(second.layers).toBe(2);
  expect(second.decorations).toHaveLength(3);
  await page.getByRole("button", { name: "Next customer" }).click();

  const third = await completeCurrentOrder(page);
  expect(third.layers).toBe(3);
  expect(third.decorations).toHaveLength(4);
  await expect(page.locator(".ca-queue")).toContainText("★");
  await page.getByRole("button", { name: "See results" }).click();

  await expect(page.getByRole("button", { name: "Collect rewards" })).toBeVisible();
  await expect(page.locator(".ak-overlay").last()).toContainText("3/3 customers served");

  const outcome = await page.evaluate(() => {
    const receipts = [...window.__atelierTest.settlements.values()];
    return {
      settlements: receipts.length,
      payout: receipts[0]?.payout ?? null,
      modulePayout: window.__atelierTest.game.payout(),
      completed: window.__atelierTest.feedbackEvents.filter(({ kind }) => kind === "run-completed").length,
      audio: window.__atelierTest.audioEvents.map(([action]) => action),
    };
  });
  expect(outcome.settlements).toBe(1);
  expect(outcome.completed).toBe(1);
  expect(outcome.payout).toEqual(outcome.modulePayout);
  expect(outcome.payout.score).toBeGreaterThan(0);
  expect(outcome.payout.coins).toBe(Math.min(40, Math.floor(outcome.payout.score / 60)));
  expect(outcome.payout.xp).toBe(Math.min(90, Math.floor(outcome.payout.score / 30)));
  expect(outcome.audio).toContain("go");
  expect(outcome.audio).toContain("score");
  expect(outcome.audio).toContain("win");

  // Replaying the settlement is idempotent: no duplicate receipt appears.
  await page.getByRole("button", { name: "Collect rewards" }).click();
  expect(await page.evaluate(() => window.__atelierTest.settlements.size)).toBe(1);
});

test("tutorial and zero-action shifts exit unpaid", async ({ page }) => {
  await installGame(page, 7, 500);
  await page.getByRole("button", { name: "Quit without reward" }).click();
  expect(await lifecycleState(page)).toEqual({
    payouts: 0,
    settlements: 0,
    events: ["run-began", "run-exited"],
  });
  await expect(page.getByRole("button", { name: /Take orders/u })).toBeVisible();

  await page.getByRole("button", { name: /Take orders/u }).click();
  await advance(page, 3.2);
  await page.getByRole("button", { name: "Pause" }).click();
  await page.getByRole("button", { name: "Quit without reward" }).click();
  expect(await lifecycleState(page)).toEqual({
    payouts: 0,
    settlements: 0,
    events: ["run-began", "run-exited", "run-began", "run-exited"],
  });

  const cleanup = await page.evaluate(() => {
    window.__atelierTest.dispose();
    window.__atelierTest.game.update(1);
    return {
      roots: document.querySelectorAll("[data-minigame]").length,
      mountChildren: document.querySelector("main")?.childElementCount ?? -1,
    };
  });
  expect(cleanup).toEqual({ roots: 0, mountChildren: 0 });
});

test("free-decorate sandbox is unpaid and the cake hero lease releases leak-neutral", async ({ page }) => {
  await installGame(page, 99);
  await finishTutorial(page);
  await page.getByRole("button", { name: /Free decorate/u }).click();

  const sandbox = await sessionState(page);
  expect(sandbox.sandbox).toBe(true);
  // Sandbox play accepts any creative choice: pick the first flavor.
  await page.locator("[data-ca-action^='flavor:']").first().click();
  for (let layer = 0; layer < sandbox.layers; layer += 1) {
    await page.getByRole("button", { name: /Stop the needle/u }).click();
  }
  for (let layer = 0; layer < sandbox.layers; layer += 1) {
    await dragOnCanvas(page, 0.3, 0.5);
  }
  await page.locator("[data-ca-action^='frosting:']").first().click();
  await dragOnCanvas(page, 0.03, 0.97, 0.5);
  await page.locator("[data-ca='done-frosting']").click();
  await page.locator("[data-ca-action^='topping:']").first().click();
  await clickCanvasAt(page, 0.5, 0.35);
  await page.getByRole("button", { name: /Show it off/u }).click();

  // The interstitial mounts the curated food.cake hero through a Stage3D lease.
  await expect(page.locator(".ca-hero")).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => Reflect.get(window.__atelierTest.game, "hero")?.source ?? "missing"))
    .not.toBe("loading");
  const hero = await page.evaluate(() => {
    const showcase = Reflect.get(window.__atelierTest.game, "hero");
    return { active: showcase?.active ?? false, source: showcase?.source ?? "missing" };
  });
  expect(hero.active).toBe(true);
  expect(hero.source).toBe("curated");
  await expect(page.locator(".ca-hero canvas")).toHaveCount(1);

  await page.getByRole("button", { name: "Quit without reward" }).click();
  expect(await lifecycleState(page)).toEqual({
    payouts: 0,
    settlements: 0,
    events: ["run-began", "run-exited"],
  });

  // Disposing the module releases the lease and restores the renderer baseline.
  const leak = await page.evaluate(() => {
    const showcase = Reflect.get(window.__atelierTest.game, "hero");
    window.__atelierTest.dispose();
    return showcase?.resourceDelta() ?? null;
  });
  expect(leak).toEqual({ geometries: 0, textures: 0, programs: 0 });
});
