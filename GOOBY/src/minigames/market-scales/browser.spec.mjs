import { expect, test } from "@playwright/test";

async function installGame(page, seed = 77) {
  await page.goto("/src/minigames/market-scales/harness.html");
  await page.evaluate(async (randomSeed) => {
    document.body.replaceChildren();
    Object.assign(document.body.style, { margin: "0", width: "100vw", height: "100vh", overflow: "hidden" });
    const mount = document.createElement("main");
    Object.assign(mount.style, { position: "relative", width: "100%", height: "100%" });
    document.body.append(mount);
    const { createMinigame } = await import("/src/minigames/market-scales/index.ts");
    const { SeededRng } = await import("/src/core/contracts/rng.ts");
    const { createMinigameLifecycle } = await import("/src/core/contracts/minigame.ts");
    const game = createMinigame();
    const settlements = new Map();
    const best = new Map([[game.id, 0]]);
    const events = [];
    const audio = [];
    let now = 2_000;
    const lifecycle = createMinigameLifecycle(
      game.id,
      { now: () => now },
      {
        getBestScore: (id) => best.get(id) ?? 0,
        getSettlement: (id) => settlements.get(id) ?? null,
        settle: (receipt) => {
          settlements.set(receipt.runId, receipt);
          best.set(receipt.minigameId, receipt.bestScore);
          return receipt;
        },
      },
      { emit: (event) => events.push(event.kind) },
    );
    game.mount({
      clock: { now: () => now },
      rng: new SeededRng(randomSeed),
      mount,
      lifecycle,
      reducedMotion: true,
      audio: { emit: (action, value) => audio.push([action, value]) },
      haptics: { impact: () => undefined },
      finish: () => undefined,
    });
    game.start();
    window.__market = {
      game,
      settlements,
      events,
      audio,
      advance(seconds) {
        let remaining = seconds;
        while (remaining > 0) {
          const step = Math.min(0.05, remaining);
          now += step * 1_000;
          game.update(step);
          remaining -= step;
        }
      },
    };
  }, seed);
}

async function finishTutorial(page) {
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Start round" }).click();
  await page.evaluate(() => window.__market.advance(3.1));
}

async function targetWeight(page) {
  return page.evaluate(() => Reflect.get(window.__market.game, "session").challenge.targetGrams);
}

async function loadNearestEstimate(page, keyboard) {
  const target = await targetWeight(page);
  let remaining = Math.round(target / 25) * 25;
  const blocks = [
    [500, "5"],
    [200, "4"],
    [100, "3"],
    [50, "2"],
    [25, "1"],
  ];
  for (const [weight, key] of blocks) {
    while (remaining >= weight) {
      if (keyboard) await page.keyboard.press(key);
      else await page.locator(`[data-ms-weight="${weight}"]`).click();
      remaining -= weight;
    }
  }
}

test("guided hints become expert weighing and an eight-round precision streak settles once", async ({ page }) => {
  await installGame(page);
  await finishTutorial(page);
  for (let round = 0; round < 8; round += 1) {
    if (round < 3) await expect(page.locator("[data-ms='hint']")).toContainText("Hint:");
    else await expect(page.locator("[data-ms='mode']")).toContainText("EXPERT");
    await loadNearestEstimate(page, round === 0);
    if (round === 0) {
      await expect(page.locator("[data-ms='estimate']")).not.toHaveText("0 g");
      await page.keyboard.press("Space");
    } else {
      await page.getByRole("button", { name: "Weigh it" }).click();
    }
  }
  await expect(page.getByRole("button", { name: "Collect rewards" })).toBeVisible();
  const state = await page.evaluate(() => ({
    settlements: window.__market.settlements.size,
    events: window.__market.events,
    audio: window.__market.audio.map(([action]) => action),
    session: Reflect.get(window.__market.game, "session"),
    payout: window.__market.game.payout(),
  }));
  expect(state.settlements).toBe(1);
  expect(state.events).toEqual(["run-began", "run-completed"]);
  expect(state.session.perfects).toBe(8);
  expect(state.session.bestStreak).toBe(8);
  expect(state.payout.score).toBeGreaterThan(3_000);
  expect(state.audio).toContain("countdown");
  expect(state.audio).toContain("go");
  expect(state.audio).toContain("combo");
  expect(state.audio).toContain("win");
});

test("pointer weight removal, clear, pause, and unpaid quit are accessible", async ({ page }) => {
  await installGame(page, 12);
  await finishTutorial(page);
  await page.locator('[data-ms-weight="100"]').click();
  await page.locator('[data-ms-weight="50"]').click();
  await expect(page.locator("[data-ms='estimate']")).toHaveText("150 g");
  await page.getByRole("button", { name: "Remove 100 g" }).click();
  await expect(page.locator("[data-ms='estimate']")).toHaveText("50 g");
  await page.getByRole("button", { name: "Clear pan" }).click();
  await expect(page.locator("[data-ms='estimate']")).toHaveText("0 g");
  await page.getByRole("button", { name: "Pause" }).click();
  await page.getByRole("button", { name: "Quit without reward" }).click();
  const state = await page.evaluate(() => ({
    settlements: window.__market.settlements.size,
    events: window.__market.events,
  }));
  expect(state.settlements).toBe(0);
  expect(state.events).toEqual(["run-began", "run-exited"]);
  await expect(page.getByRole("button", { name: "Open the stall" })).toBeVisible();
});
