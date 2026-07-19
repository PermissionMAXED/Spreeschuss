import { expect, test } from "@playwright/test";

// The harness clock starts at 1,000,000ms since epoch: hour zero, night stock.
const NIGHT_START_MS = 1_000_000;
const MIDDAY_MS = 12 * 3_600_000;

async function installGame(page, seed, startNowMs = NIGHT_START_MS) {
  await page.goto("/src/minigames/pond-fishing/harness.html");
  await page.evaluate(
    async ({ seed: randomSeed, startNow }) => {
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

      const gameModule = await import("/src/minigames/pond-fishing/index.ts");
      const { SeededRng } = await import("/src/core/contracts/rng.ts");
      const { createMinigameLifecycle } = await import("/src/core/contracts/minigame.ts");
      const game = gameModule.createPondFishing();
      const payouts = [];
      const settlements = new Map();
      const bestScores = new Map([[game.id, 0]]);
      const feedbackEvents = [];
      const audioEvents = [];
      const hapticEvents = [];
      let now = startNow;
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
        bestScore: 0,
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
        setNow(ms) {
          now = ms;
        },
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
    { seed, startNow: startNowMs },
  );
}

const stopLoop = (page) => page.evaluate(() => window.__minigamePackTest.stopLoop());

const oddsRows = (page) =>
  page.evaluate(() =>
    [...window.__minigamePackTest.shadow().querySelectorAll("[data-odds]")].map((cell) => ({
      species: cell.dataset.odds,
      percent: Number(cell.textContent.replace("%", "")),
    })),
  );

test("the tackle picker posts exact stock odds that follow the injected day/night clock", async ({ page }) => {
  await installGame(page, 11);
  await page.getByRole("button", { name: "Skip tutorial" }).click();

  await expect(page.locator(".odds")).toHaveAttribute("data-phase", "night");
  await expect(page.locator(".odds-title")).toContainText("Night stock");
  const nightOdds = await oddsRows(page);
  expect(nightOdds.some(({ species }) => species === "moonback-catfish")).toBe(true);
  expect(nightOdds.reduce((sum, { percent }) => sum + percent, 0)).toBeCloseTo(100, 0);

  const koiBefore = nightOdds.find(({ species }) => species === "golden-koi").percent;
  await page.getByRole("button", { name: /Deep Sinker/u }).click();
  const koiAfter = (await oddsRows(page)).find(({ species }) => species === "golden-koi").percent;
  expect(koiAfter).toBeGreaterThan(koiBefore);

  // Wind the injected clock to midday: the pond restocks for daylight.
  await page.evaluate((midday) => window.__minigamePackTest.setNow(midday), MIDDAY_MS);
  await page.getByRole("button", { name: /Everyday Float/u }).click();
  await expect(page.locator(".odds")).toHaveAttribute("data-phase", "day");
  await expect(page.locator(".odds-title")).toContainText("Day stock");
  const dayOdds = await oddsRows(page);
  expect(dayOdds.some(({ species }) => species === "moonback-catfish")).toBe(false);
  expect(dayOdds.reduce((sum, { percent }) => sum + percent, 0)).toBeCloseTo(100, 0);
});

test("casting, hooking, and reeling in the green band lands a fish and settles once", async ({ page }) => {
  await installGame(page, 21, MIDDAY_MS);
  await page.getByRole("button", { name: "Skip tutorial" }).click();
  await page.getByRole("button", { name: "Cast a line" }).click();
  await stopLoop(page);

  await expect(page.locator('[data-action="shadow"]')).toHaveCount(5);
  // Shadows drift on an endless animation, so dispatch the click directly.
  await page.locator('[data-action="shadow"]').first().dispatchEvent("click");
  expect(await page.evaluate(() => Reflect.get(window.__minigamePackTest.game, "round").phase)).toBe("waiting");

  // The bite lands within (0.65..2.45)s x tackle factor on the injected clock.
  await page.evaluate(() => {
    const harness = window.__minigamePackTest;
    const round = Reflect.get(harness.game, "round");
    for (let step = 0; step < 60 && round.phase === "waiting"; step += 1) {
      harness.advance(0.05);
    }
  });
  await expect(page.getByRole("button", { name: "BITE! TAP THE POND TO HOOK!" })).toBeVisible();
  await page.getByRole("button", { name: "BITE! TAP THE POND TO HOOK!" }).dispatchEvent("click");

  // Real pointer input drives the reel button before the scripted fight.
  const reel = page.locator('[data-action="reel"]');
  await expect(reel).toBeVisible();
  await reel.dispatchEvent("pointerdown", { pointerId: 7 });
  await expect(reel).toHaveClass(/held/u);
  await reel.dispatchEvent("pointerup", { pointerId: 7 });
  await expect(reel).not.toHaveClass(/held/u);

  const fought = await page.evaluate(() => {
    const harness = window.__minigamePackTest;
    const round = Reflect.get(harness.game, "round");
    let steps = 0;
    while (round.phase === "fighting" && steps < 1_500) {
      const fight = round.fight;
      const [greenStart, greenEnd] = fight.greenBand;
      round.setReeling(fight.tension < (greenStart + greenEnd) / 2);
      harness.advance(0.05);
      steps += 1;
    }
    return { phase: round.phase, catches: round.catches.length };
  });
  expect(fought).toEqual({ phase: "caught", catches: 1 });
  await expect(page.locator(".catch-card")).toBeVisible();
  await expect(page.locator('[data-stat="catch"]')).toHaveText("1");

  // The keyboard shortcut pauses without risking a stray pond cast.
  await page.keyboard.press("p");
  await page.getByRole("button", { name: "Finish & collect" }).click();
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
  expect(outcome.events).toEqual(["run-began", "run-completed"]);
  expect(outcome.payoutMatches).toBe(true);
  await expect(
    page.getByRole("button", { name: `Collect ${outcome.coins} coins` }),
  ).toBeVisible();
});

test("night ponds stock nocturnal shadows and quitting before a cast is unpaid", async ({ page }) => {
  await installGame(page, 31, NIGHT_START_MS);
  await page.getByRole("button", { name: "Skip tutorial" }).click();
  await page.getByRole("button", { name: /Koi Quest/u }).click();
  await page.getByRole("button", { name: "Cast a line" }).click();
  await stopLoop(page);

  const sampled = await page.evaluate(() => {
    const round = Reflect.get(window.__minigamePackTest.game, "round");
    const seen = new Set();
    for (let roll = 0; roll < 40; roll += 1) {
      Reflect.get(round, "refreshShadows").call(round);
      for (const shadow of round.shadows) seen.add(shadow.species.id);
    }
    return [...seen];
  });
  expect(sampled).toContain("moonback-catfish");

  await page.keyboard.press("p");
  await page.getByRole("button", { name: "Quit without reward" }).click();
  expect(
    await page.evaluate(() => ({
      settlements: window.__minigamePackTest.settlements.size,
      payouts: window.__minigamePackTest.payouts.length,
      events: window.__minigamePackTest.feedbackEvents.map(({ kind }) => kind),
    })),
  ).toEqual({ settlements: 0, payouts: 0, events: ["run-began", "run-exited"] });
});
