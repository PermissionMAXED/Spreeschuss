import { expect, test } from "@playwright/test";

async function installGame(page, seed = 91) {
  await page.goto("/src/minigames/library-stack/harness.html");
  await page.evaluate(async (randomSeed) => {
    document.body.replaceChildren();
    Object.assign(document.body.style, { margin: "0", width: "100vw", height: "100vh", overflow: "hidden" });
    const mount = document.createElement("main");
    Object.assign(mount.style, { position: "relative", width: "100%", height: "100%" });
    document.body.append(mount);
    const { createMinigame } = await import("/src/minigames/library-stack/index.ts");
    const { SeededRng } = await import("/src/core/contracts/rng.ts");
    const { createMinigameLifecycle } = await import("/src/core/contracts/minigame.ts");
    const game = createMinigame();
    const settlements = new Map();
    const best = new Map([[game.id, 0]]);
    const events = [];
    const audio = [];
    let now = 3_000;
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
    window.__library = {
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
  await page.evaluate(() => window.__library.advance(3.1));
}

test("fifteen real pointer drops build a neat bonus tower and settle once", async ({ page }) => {
  await installGame(page);
  await finishTutorial(page);
  const playfield = page.locator("[data-ls='playfield']");
  for (let book = 0; book < 15; book += 1) await playfield.click();

  await expect(page.getByRole("button", { name: "Collect rewards" })).toBeVisible();
  const state = await page.evaluate(() => ({
    settlements: window.__library.settlements.size,
    events: window.__library.events,
    audio: window.__library.audio.map(([action]) => action),
    session: Reflect.get(window.__library.game, "session"),
    payout: window.__library.game.payout(),
  }));
  expect(state.settlements).toBe(1);
  expect(state.events).toEqual(["run-began", "run-completed"]);
  expect(state.session.books).toHaveLength(15);
  expect(state.session.caught).toBe(0);
  expect(state.session.bonusBooks).toBeGreaterThanOrEqual(3);
  expect(state.payout.score).toBeGreaterThan(4_000);
  expect(state.audio).toContain("countdown");
  expect(state.audio).toContain("go");
  expect(state.audio).toContain("combo");
  expect(state.audio).toContain("win");
});

test("beanbag catches an overhang, keyboard drops work, and quit is unpaid", async ({ page }) => {
  await installGame(page, 18);
  await finishTutorial(page);
  const playfield = page.locator("[data-ls='playfield']");
  const box = await playfield.boundingBox();
  if (!box) throw new Error("Library playfield did not render");
  await page.mouse.click(box.x + box.width - 2, box.y + box.height * 0.35);
  await expect(page.locator("[data-ls='status']")).toContainText("beanbag");
  expect(await page.evaluate(() => Reflect.get(window.__library.game, "session").caught)).toBe(1);

  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Space");
  expect(await page.evaluate(() => Reflect.get(window.__library.game, "session").books.length)).toBe(1);

  await page.getByRole("button", { name: "Pause" }).click();
  await page.getByRole("button", { name: "Quit without reward" }).click();
  const state = await page.evaluate(() => ({
    settlements: window.__library.settlements.size,
    events: window.__library.events,
  }));
  expect(state.settlements).toBe(0);
  expect(state.events).toEqual(["run-began", "run-exited"]);
  await expect(page.getByRole("button", { name: "Start stacking" })).toBeVisible();
});
