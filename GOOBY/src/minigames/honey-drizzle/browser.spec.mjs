import { expect, test } from "@playwright/test";

async function installGame(page, seed = 73) {
  await page.goto("/src/minigames/honey-drizzle/harness.html");
  await page.evaluate(async (randomSeed) => {
    document.body.replaceChildren();
    Object.assign(document.body.style, { margin: "0", width: "100vw", height: "100vh", overflow: "hidden" });
    const mount = document.createElement("main");
    Object.assign(mount.style, { position: "relative", width: "100%", height: "100%" });
    document.body.append(mount);
    const { createMinigame } = await import("/src/minigames/honey-drizzle/index.ts");
    const { SeededRng } = await import("/src/core/contracts/rng.ts");
    const { createMinigameLifecycle } = await import("/src/core/contracts/minigame.ts");
    const game = createMinigame();
    const settlements = new Map();
    const events = [];
    const audio = [];
    let now = 3_000;
    const clock = { now: () => now };
    const lifecycle = createMinigameLifecycle(
      game.id,
      clock,
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
      clock,
      rng: new SeededRng(randomSeed),
      mount,
      lifecycle,
      reducedMotion: true,
      audio: { emit: (cue, value) => audio.push([cue, value]) },
      haptics: { impact: () => {} },
      finish: () => {},
    });
    game.start();
    window.__honeyTest = {
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
      pathLanes() {
        const round = Reflect.get(game, "round");
        const lanes = [[], [], []];
        for (let column = 4; column < 60; column += 1) {
          const rows = [];
          for (let row = 0; row < 44; row += 1) {
            if (round.corridor[row * 64 + column]) rows.push(row);
          }
          if (rows.length === 0) continue;
          const choices = [
            rows[Math.min(rows.length - 1, 1)],
            rows[Math.floor(rows.length / 2)],
            rows[Math.max(0, rows.length - 2)],
          ];
          for (let lane = 0; lane < lanes.length; lane += 1) {
            lanes[lane].push({ x: (column + 0.5) / 64, y: (choices[lane] + 0.5) / 44 });
          }
        }
        return lanes;
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
  await page.evaluate((value) => window.__honeyTest.advance(value), seconds);
}

async function traceCurrentCorridor(page) {
  const box = await page.locator(".hd-canvas").boundingBox();
  if (!box) throw new Error("honey canvas did not render");
  const lanes = await page.evaluate(() => window.__honeyTest.pathLanes());
  for (const lane of lanes) {
    const first = lane[0];
    if (!first) continue;
    await page.mouse.move(box.x + first.x * box.width, box.y + first.y * box.height);
    await page.mouse.down();
    for (const point of lane) {
      await page.mouse.move(box.x + point.x * box.width, box.y + point.y * box.height);
    }
    await page.mouse.up();
  }
}

test("real held streams cover three corridors, react to the bee gap, and settle once", async ({ page }) => {
  await installGame(page);
  await expect(page.locator("[data-minigame='honey-drizzle'][data-ak-reduced='true']")).toHaveCount(1);
  await finishTutorial(page);
  await page.getByRole("button", { name: "Start drizzling" }).click();
  await advance(page, 3.1);

  for (let toast = 0; toast < 3; toast += 1) {
    await traceCurrentCorridor(page);
    await advance(page, 1.4);
    await traceCurrentCorridor(page);
    const coverage = await page.evaluate(() => Reflect.get(window.__honeyTest.game, "round").coverage);
    expect(coverage).toBeGreaterThanOrEqual(0.72);
    await page.getByRole("button", { name: "Serve this toast" }).click();
  }

  await expect(page.getByRole("button", { name: "Collect rewards" })).toBeVisible();
  const outcome = await page.evaluate(() => ({
    settlements: window.__honeyTest.settlements.size,
    events: window.__honeyTest.events.map(({ kind }) => kind),
    payout: window.__honeyTest.game.payout(),
    cues: window.__honeyTest.audio.map(([cue]) => cue),
  }));
  expect(outcome.settlements).toBe(1);
  expect(outcome.events).toEqual(["run-began", "run-completed"]);
  expect(outcome.payout.score).toBeGreaterThan(0);
  expect(outcome.cues).toContain("countdown");
  expect(outcome.cues).toContain("go");
  expect(outcome.cues).toContain("win");
});

test("real outside swipe spills, pause freezes metrics, and quit remains unpaid", async ({ page }) => {
  await installGame(page, 4);
  await finishTutorial(page);
  await page.getByRole("button", { name: "Start drizzling" }).click();
  await advance(page, 3.1);
  const box = await page.locator(".hd-canvas").boundingBox();
  if (!box) throw new Error("honey canvas did not render");
  await page.mouse.move(box.x + box.width * 0.15, box.y + box.height * 0.08);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.85, box.y + box.height * 0.08, { steps: 20 });
  await page.mouse.up();
  const before = await page.evaluate(() => Reflect.get(window.__honeyTest.game, "round").snapshot());
  expect(before.spillRatio).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Pause" }).click();
  await advance(page, 2);
  const paused = await page.evaluate(() => Reflect.get(window.__honeyTest.game, "round").snapshot());
  expect(paused).toEqual(before);
  await page.getByRole("button", { name: "Quit without reward" }).click();
  expect(await page.evaluate(() => window.__honeyTest.settlements.size)).toBe(0);
});
