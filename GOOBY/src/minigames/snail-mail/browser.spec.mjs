import { expect, test } from "@playwright/test";

async function installGame(page, seed = 41, reducedMotion = true) {
  await page.goto("/src/minigames/snail-mail/harness.html");
  await page.evaluate(async ({ seed: randomSeed, reduced }) => {
    document.body.replaceChildren();
    Object.assign(document.body.style, { margin: "0", width: "100vw", height: "100vh", overflow: "hidden" });
    const mount = document.createElement("main");
    Object.assign(mount.style, { position: "relative", width: "100%", height: "100%" });
    document.body.append(mount);
    const { createMinigame } = await import("/src/minigames/snail-mail/index.ts");
    const { SeededRng } = await import("/src/core/contracts/rng.ts");
    const { createMinigameLifecycle } = await import("/src/core/contracts/minigame.ts");
    const game = createMinigame();
    const settlements = new Map();
    const best = new Map([[game.id, 0]]);
    const events = [];
    const audio = [];
    let now = 1_000;
    const clock = { now: () => now };
    const lifecycle = createMinigameLifecycle(
      game.id,
      clock,
      {
        getBestScore: (id) => best.get(id) ?? 0,
        getSettlement: (runId) => settlements.get(runId) ?? null,
        settle: (receipt) => {
          const previous = settlements.get(receipt.runId);
          if (previous) return previous;
          settlements.set(receipt.runId, receipt);
          best.set(receipt.minigameId, receipt.bestScore);
          return receipt;
        },
      },
      { emit: (event) => events.push(event) },
    );
    game.mount({
      clock,
      rng: new SeededRng(randomSeed),
      mount,
      lifecycle,
      reducedMotion: reduced,
      audio: { emit: (cue, value) => audio.push([cue, value]) },
      haptics: { impact: () => {} },
      finish: () => {},
    });
    game.start();
    window.__snailTest = {
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
    };
  }, { seed, reduced: reducedMotion });
}

async function finishTutorial(page) {
  const next = page.getByRole("button", { name: "Next" });
  while (await next.isVisible()) await next.click();
  await page.getByRole("button", { name: "Start round" }).click();
}

async function advance(page, seconds) {
  await page.evaluate((value) => window.__snailTest.advance(value), seconds);
}

async function deliverFirst(page) {
  await expect.poll(() => page.locator("[data-sm-letter]").count()).toBeGreaterThan(0);
  const letter = page.locator("[data-sm-letter]").first();
  const careful = await letter.evaluate((element) => element.classList.contains("sm-careful"));
  if (careful) {
    await letter.dblclick();
    return "careful";
  }
  const mailbox = Number(await letter.getAttribute("data-mailbox"));
  const target = page.locator(`[data-sm-box="${mailbox}"]`);
  const from = await letter.boundingBox();
  const to = await target.boundingBox();
  if (!from || !to) throw new Error("letter or mailbox did not render");
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 8 });
  await page.mouse.up();
  return "drag";
}

test("real drag, flick-distance delivery, and careful double-click settle one route", async ({ page }) => {
  await installGame(page);
  await expect(page.locator("[data-minigame='snail-mail'][data-ak-reduced='true']")).toHaveCount(1);
  await finishTutorial(page);
  await page.getByRole("button", { name: "Start deliveries" }).click();
  await advance(page, 3.1);

  const gestures = [];
  for (let index = 0; index < 4; index += 1) {
    await advance(page, 0.35);
    gestures.push(await deliverFirst(page));
  }
  expect(gestures).toContain("careful");
  const live = await page.evaluate(() => {
    const round = Reflect.get(window.__snailTest.game, "round");
    return { delivered: round.delivered, streak: round.streak, score: round.score };
  });
  expect(live.delivered).toBe(4);
  expect(live.streak).toBe(4);
  expect(live.score).toBeGreaterThan(0);

  await advance(page, 46);
  await expect(page.getByRole("button", { name: "Collect rewards" })).toBeVisible();
  const outcome = await page.evaluate(() => ({
    settlements: window.__snailTest.settlements.size,
    events: window.__snailTest.events.map(({ kind }) => kind),
    cues: window.__snailTest.audio.map(([cue]) => cue),
    payout: window.__snailTest.game.payout(),
  }));
  expect(outcome.settlements).toBe(1);
  expect(outcome.events).toEqual(["run-began", "run-completed"]);
  expect(outcome.cues).toContain("countdown");
  expect(outcome.cues).toContain("go");
  expect(outcome.cues).toContain("win");
  expect(outcome.payout.score).toBeGreaterThan(0);
});

test("pause freezes the conveyor and quitting exits unpaid", async ({ page }) => {
  await installGame(page, 9);
  await finishTutorial(page);
  await page.getByRole("button", { name: "Start deliveries" }).click();
  await advance(page, 3.5);
  const before = await page.evaluate(() => Reflect.get(window.__snailTest.game, "round").snapshot());
  await page.getByRole("button", { name: "Pause" }).click();
  await advance(page, 3);
  const paused = await page.evaluate(() => Reflect.get(window.__snailTest.game, "round").snapshot());
  expect(paused).toEqual(before);
  await page.getByRole("button", { name: "Quit without reward" }).click();
  expect(await page.evaluate(() => window.__snailTest.settlements.size)).toBe(0);
  expect(await page.evaluate(() => window.__snailTest.events.map(({ kind }) => kind))).toEqual([
    "run-began",
    "run-exited",
  ]);
});
