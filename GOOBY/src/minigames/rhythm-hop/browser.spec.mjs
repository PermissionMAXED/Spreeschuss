import { expect, test } from "@playwright/test";

async function installGame(page, seed) {
  await page.goto("/src/minigames/rhythm-hop/harness.html");
  await page.evaluate(
    async ({ seed: randomSeed }) => {
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

      const gameModule = await import("/src/minigames/rhythm-hop/index.ts");
      const { SeededRng } = await import("/src/core/contracts/rng.ts");
      const { createMinigameLifecycle } = await import("/src/core/contracts/minigame.ts");
      const game = gameModule.createRhythmHop();
      const payouts = [];
      const settlements = new Map();
      const bestScores = new Map([[game.id, 0]]);
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
        session: () => Reflect.get(game, "session"),
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
    { seed },
  );
}

const advance = (page, seconds) =>
  page.evaluate((duration) => window.__minigamePackTest.advance(duration), seconds);

const stopLoop = (page) => page.evaluate(() => window.__minigamePackTest.stopLoop());

test("the song select lists five songs and the file-backed hold charts render hold tails", async ({ page }) => {
  await installGame(page, 5);
  await page.getByRole("button", { name: "Skip tutorial" }).click();

  await expect(page.locator(".song")).toHaveCount(5);
  const fireflyButton = page.locator('[data-song="firefly-waltz"]');
  const dewdropButton = page.locator('[data-song="dewdrop-derby"]');
  await expect(fireflyButton).toContainText("Firefly Waltz");
  await expect(fireflyButton).toContainText("holds");
  await expect(dewdropButton).toContainText("Dewdrop Derby");
  await expect(dewdropButton).toContainText("holds");

  await fireflyButton.click();
  await page.getByRole("button", { name: "Start hopping" }).click();
  await stopLoop(page);
  await expect(page.locator(".note.hold")).toHaveCount(4);
  const holdLengths = await page.evaluate(() =>
    [...window.__minigamePackTest.shadow().querySelectorAll(".note.hold")].map((note) =>
      Number(note.dataset.hold),
    ),
  );
  for (const holdMs of holdLengths) expect(holdMs).toBeGreaterThan(1_000);
});

test("a dead-center tap sparkles and a ridden hold completes on the audio clock", async ({ page }) => {
  await installGame(page, 8);
  await page.getByRole("button", { name: "Skip tutorial" }).click();
  await page.locator('[data-song="firefly-waltz"]').click();
  await page.getByRole("button", { name: "Start hopping" }).click();
  await stopLoop(page);

  // First chart note: beat 0, middle lane, exactly at the 1.8s audio offset.
  await advance(page, 1.8);
  await page.locator('[data-lane="1"]').click();
  await expect(page.locator(".judgment")).toHaveText("SPARKLE!");
  await expect(page.locator(".judgment")).toHaveClass(/sparkle/u);

  // Ride the first hold note (left lane) from its head to its tail.
  const hold = await page.evaluate(() => {
    const harness = window.__minigamePackTest;
    const session = harness.session();
    const holdNote = session.beatmap.notes.find(({ holdMs }) => holdMs !== undefined);
    harness.advance((holdNote.timeMs - session.songTimeMs) / 1_000);
    return holdNote;
  });
  await page.keyboard.down("a");
  await expect(page.locator(".judgment")).toHaveText("SPARKLE!");
  await expect(page.locator(".note.holding")).toHaveCount(1);
  await advance(page, hold.holdMs / 1_000 + 0.05);
  await expect(page.locator(".judgment")).toHaveText("HOLD!");
  await page.keyboard.up("a");

  expect(
    await page.evaluate(() => {
      const session = window.__minigamePackTest.session();
      return {
        sparkles: session.sparkles,
        holdsCompleted: session.holdsCompleted,
        holdsBroken: session.holdsBroken,
      };
    }),
  ).toEqual({ sparkles: 2, holdsCompleted: 1, holdsBroken: 0 });
  expect(
    await page.evaluate(() => window.__minigamePackTest.audioEvents.map(([action]) => action)),
  ).toContain("score");
});

test("pausing freezes the audio clock, quitting is unpaid, and finishing settles once", async ({ page }) => {
  await installGame(page, 13);
  await page.getByRole("button", { name: "Skip tutorial" }).click();
  await page.getByRole("button", { name: "Start hopping" }).click();
  await page.getByRole("button", { name: "Pause song" }).click();
  await expect(page.getByRole("heading", { name: "Beat paused" })).toBeVisible();
  await page.getByRole("button", { name: "Quit without reward" }).click();
  expect(
    await page.evaluate(() => ({
      settlements: window.__minigamePackTest.settlements.size,
      events: window.__minigamePackTest.feedbackEvents.map(({ kind }) => kind),
    })),
  ).toEqual({ settlements: 0, events: ["run-began", "run-exited"] });

  await page.getByRole("button", { name: "Start hopping" }).click();
  await stopLoop(page);
  await advance(page, 1.8);
  await page.locator('[data-lane="1"]').click();
  await page.getByRole("button", { name: "Pause song" }).click();
  const frozenAt = await page.evaluate(() => window.__minigamePackTest.session().songTimeMs);
  await advance(page, 5);
  expect(await page.evaluate(() => window.__minigamePackTest.session().songTimeMs)).toBe(frozenAt);
  await page.getByRole("button", { name: "Resume the groove" }).click();
  expect(await page.evaluate(() => window.__minigamePackTest.session().songTimeMs)).toBe(frozenAt);

  await page.getByRole("button", { name: "Pause song" }).click();
  await page.getByRole("button", { name: "Finish & collect" }).click();
  await expect(page.locator(".result-grid .sparkle-cell")).toBeVisible();
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
