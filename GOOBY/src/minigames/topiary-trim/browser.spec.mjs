import { expect, test } from "@playwright/test";

async function installGame(page, seed = 18) {
  await page.goto("/src/minigames/topiary-trim/harness.html");
  await page.evaluate(async (randomSeed) => {
    document.body.replaceChildren();
    Object.assign(document.body.style, { margin: "0", width: "100vw", height: "100vh", overflow: "hidden" });
    const mount = document.createElement("main");
    Object.assign(mount.style, { position: "relative", width: "100%", height: "100%" });
    document.body.append(mount);
    const { createMinigame } = await import("/src/minigames/topiary-trim/index.ts");
    const { SeededRng } = await import("/src/core/contracts/rng.ts");
    const { createMinigameLifecycle } = await import("/src/core/contracts/minigame.ts");
    const game = createMinigame();
    const settlements = new Map();
    const events = [];
    const audio = [];
    let now = 2_000;
    const lifecycle = createMinigameLifecycle(
      game.id,
      { now: () => now },
      {
        getBestScore: () => 0,
        getSettlement: (runId) => settlements.get(runId) ?? null,
        settle: (receipt) => {
          settlements.set(receipt.runId, receipt);
          return receipt;
        },
      },
      { emit: (event) => events.push(event) },
    );
    game.mount({
      clock: { now: () => now },
      rng: new SeededRng(randomSeed),
      mount,
      lifecycle,
      reducedMotion: true,
      audio: { emit: (cue, value) => audio.push([cue, value]) },
      haptics: { impact: () => {} },
      finish: () => {},
    });
    game.start();
    window.__topiaryTest = {
      game,
      settlements,
      events,
      audio,
      advance(seconds) {
        let remaining = seconds;
        while (remaining > 0.000_001) {
          const step = Math.min(0.05, remaining);
          remaining -= step;
          now += step * 1_000;
          game.update(step);
        }
      },
      perfectCurrentBush() {
        const round = Reflect.get(game, "round");
        round.current.set(round.target);
        game.update(0);
      },
    };
  }, seed);
}

async function finishTutorial(page) {
  const next = page.getByRole("button", { name: "Next" });
  while (await next.isVisible()) await next.click();
  await page.getByRole("button", { name: "Start round" }).click();
}

async function advance(page, seconds) {
  await page.evaluate((value) => window.__topiaryTest.advance(value), seconds);
}

test("real shears and limited preview lead through three IoU settlements", async ({ page }) => {
  await installGame(page);
  await expect(page.locator("[data-minigame='topiary-trim'][data-ak-reduced='true']")).toHaveCount(1);
  await finishTutorial(page);
  await page.getByRole("button", { name: "Start trimming" }).click();
  await advance(page, 3.1);

  await page.getByRole("button", { name: /Leaf-blower preview/u }).click();
  await expect(page.locator("[data-tt='previews']")).toContainText("1 previews left");
  const before = await page.evaluate(() => {
    const round = Reflect.get(window.__topiaryTest.game, "round");
    return round.current.reduce((sum, cell) => sum + cell, 0);
  });
  const outside = await page.evaluate(() => {
    const round = Reflect.get(window.__topiaryTest.game, "round");
    const index = round.current.findIndex((cell, at) => cell && !round.target[at]);
    return { x: (index % 64 + 0.5) / 64, y: (Math.floor(index / 64) + 0.5) / 64 };
  });
  const box = await page.locator(".tt-canvas").boundingBox();
  if (!box) throw new Error("topiary canvas did not render");
  await page.mouse.click(box.x + outside.x * box.width, box.y + outside.y * box.height);
  const after = await page.evaluate(() => {
    const round = Reflect.get(window.__topiaryTest.game, "round");
    return round.current.reduce((sum, cell) => sum + cell, 0);
  });
  expect(after).toBeLessThan(before);

  for (let bush = 0; bush < 3; bush += 1) {
    await page.evaluate(() => window.__topiaryTest.perfectCurrentBush());
    await expect(page.locator("[data-tt='percent']")).toContainText("100%");
    await page.getByRole("button", { name: /Inspect this bush/u }).click();
  }
  await expect(page.getByRole("button", { name: "Collect rewards" })).toBeVisible();
  const outcome = await page.evaluate(() => ({
    settlements: window.__topiaryTest.settlements.size,
    events: window.__topiaryTest.events.map(({ kind }) => kind),
    payout: window.__topiaryTest.game.payout(),
    cues: window.__topiaryTest.audio.map(([cue]) => cue),
  }));
  expect(outcome.settlements).toBe(1);
  expect(outcome.events).toEqual(["run-began", "run-completed"]);
  expect(outcome.payout.score).toBeGreaterThan(1_000);
  expect(outcome.cues).toContain("hit");
  expect(outcome.cues).toContain("win");
});

test("pause freezes the leaf-blower preview and quit stays unpaid", async ({ page }) => {
  await installGame(page, 2);
  await finishTutorial(page);
  await page.getByRole("button", { name: "Start trimming" }).click();
  await advance(page, 3.1);
  await page.getByRole("button", { name: /Leaf-blower preview/u }).click();
  const before = await page.evaluate(() => Reflect.get(window.__topiaryTest.game, "round").previewRemaining);
  await page.getByRole("button", { name: "Pause" }).click();
  await advance(page, 2);
  expect(await page.evaluate(() => Reflect.get(window.__topiaryTest.game, "round").previewRemaining)).toBe(before);
  await page.getByRole("button", { name: "Quit without reward" }).click();
  expect(await page.evaluate(() => window.__topiaryTest.settlements.size)).toBe(0);
});
