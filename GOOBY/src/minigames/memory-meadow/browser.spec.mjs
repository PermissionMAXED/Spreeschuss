import { expect, test } from "@playwright/test";

const MEADOW_MODULE = "/src/minigames/memory-meadow/index.ts";

async function installGame(page, seed, bestScore = 0) {
  await page.goto("/src/minigames/memory-meadow/harness.html");
  await page.evaluate(
    async ({ seed: randomSeed, initialBest }) => {
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

      const gameModule = await import("/src/minigames/memory-meadow/index.ts");
      const { SeededRng } = await import("/src/core/contracts/rng.ts");
      const { createMinigameLifecycle } = await import("/src/core/contracts/minigame.ts");
      const game = gameModule.createMemoryMeadow();
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
        reducedMotion: true,
        finish: (payout) => payouts.push(payout),
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
        shadow: () => document.querySelector("[data-minigame]").shadowRoot,
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
    { seed, initialBest: bestScore },
  );
}

const advance = (page, seconds) =>
  page.evaluate((duration) => window.__minigamePackTest.advance(duration), seconds);

const stopLoop = (page) => page.evaluate(() => window.__minigamePackTest.stopLoop());

/** Clicks every card of the next `groups` unmatched symbol groups, riding out breezes. */
const matchGroups = (page, groups) =>
  page.evaluate((groupCount) => {
    const harness = window.__minigamePackTest;
    const round = Reflect.get(harness.game, "round");
    for (let matched = 0; matched < groupCount; matched += 1) {
      if (round.isBusy) harness.advance(1.6);
      const next = round.board.find(({ matched: done }) => !done);
      if (next === undefined) break;
      const group = round.board.filter(
        ({ symbol, matched: done }) => symbol === next.symbol && !done,
      );
      for (const card of group) {
        harness.shadow().querySelector(`[data-card-id="${card.id}"]`)?.click();
      }
    }
  }, groups);

test("Moonlit Meadow lays out a 4x4 board and grows a glowing serene streak", async ({ page }) => {
  await installGame(page, 77);
  await page.getByRole("button", { name: "Skip tutorial" }).click();
  await page.getByRole("button", { name: /Moonlit Meadow/u }).click();
  await expect(page.locator('[data-difficulty="3"]')).toContainText("4×4");
  await page.getByRole("button", { name: "Start matching" }).click();
  await stopLoop(page);

  await expect(page.locator("[data-card-id]")).toHaveCount(16);
  expect(
    await page.evaluate(() =>
      window.__minigamePackTest.shadow().querySelector(".board").style.gridTemplateColumns,
    ),
  ).toBe("repeat(4, 1fr)");

  await matchGroups(page, 1);
  await expect(page.locator('[data-stat="serene"]')).toHaveText("×1");
  await expect(page.locator(".stat.serene")).not.toHaveClass(/glow/u);

  await matchGroups(page, 1);
  await expect(page.locator('[data-stat="serene"]')).toHaveText("×2");
  await expect(page.locator(".stat.serene")).toHaveClass(/glow/u);
  await expect(page.locator(".toast")).toContainText("Serene streak ×2");
  expect(
    await page.evaluate(() => window.__minigamePackTest.audioEvents.map(([action]) => action)),
  ).toContain("combo");
});

test("the dandelion breeze reveals cards one by one on its deterministic schedule", async ({ page }) => {
  await installGame(page, 33);
  await page.getByRole("button", { name: "Skip tutorial" }).click();
  await page.getByRole("button", { name: "Start matching" }).click();
  await stopLoop(page);
  await expect(page.locator("[data-card-id]")).toHaveCount(12);

  // Matching half the six pairs arms the breeze; the third match starts it.
  await matchGroups(page, 3);
  await expect(page.locator(".toast")).toContainText("Dandelion breeze");
  await expect(page.locator(".shuffle")).toBeVisible();

  const revealedCount = () =>
    page.evaluate(
      () => window.__minigamePackTest.shadow().querySelectorAll(".card.is-up:not(.matched)").length,
    );
  const schedule = await page.evaluate(() =>
    Reflect.get(window.__minigamePackTest.game, "round").breezeEvents.map(
      ({ cardId, atSeconds }) => ({ cardId, atSeconds }),
    ),
  );
  expect(schedule).toHaveLength(6);
  expect(schedule[0].atSeconds).toBe(0);
  expect(await revealedCount()).toBe(1);

  await advance(page, 0.15);
  expect(await revealedCount()).toBe(2);
  await advance(page, 0.15);
  expect(await revealedCount()).toBe(3);

  // Once the peek ends every unmatched card is concealed again in new spots.
  await advance(page, 1.2);
  expect(await revealedCount()).toBe(0);
  await expect(page.locator(".shuffle")).toBeHidden();
  await expect(page.locator("[data-card-id]")).toHaveCount(12);
});

test("quitting the meadow is unpaid while a solved meadow settles exactly once", async ({ page }) => {
  await installGame(page, 91, 400);
  await page.getByRole("button", { name: "Skip tutorial" }).click();
  await page.getByRole("button", { name: "Start matching" }).click();
  await page.getByRole("button", { name: "Pause game" }).click();
  await page.getByRole("button", { name: "Quit without reward" }).click();
  expect(
    await page.evaluate(() => ({
      settlements: window.__minigamePackTest.settlements.size,
      events: window.__minigamePackTest.feedbackEvents.map(({ kind }) => kind),
    })),
  ).toEqual({ settlements: 0, events: ["run-began", "run-exited"] });

  await page.getByRole("button", { name: "Start matching" }).click();
  await stopLoop(page);
  await matchGroups(page, 6);
  await expect(page.getByRole("heading", { name: "Meadow in bloom!" })).toBeVisible();
  await expect(page.locator(".serene-bonus")).toContainText("serene bonus");

  const outcome = await page.evaluate(() => {
    const harness = window.__minigamePackTest;
    const receipt = [...harness.settlements.values()][0];
    return {
      settlements: harness.settlements.size,
      events: harness.feedbackEvents.map(({ kind }) => kind),
      payoutMatches:
        JSON.stringify(receipt?.payout) === JSON.stringify(harness.game.payout()),
      coins: receipt?.payout.coins,
    };
  });
  expect(outcome.settlements).toBe(1);
  expect(outcome.events).toEqual(["run-began", "run-exited", "run-began", "run-completed"]);
  expect(outcome.payoutMatches).toBe(true);
  await expect(
    page.getByRole("button", { name: `Collect ${outcome.coins} coins` }),
  ).toBeVisible();
});
