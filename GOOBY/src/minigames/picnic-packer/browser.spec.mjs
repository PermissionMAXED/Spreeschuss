import { expect, test } from "@playwright/test";

async function installGame(page, seed = 2026) {
  await page.goto("/src/minigames/picnic-packer/harness.html");
  await page.evaluate(async (randomSeed) => {
    document.body.replaceChildren();
    Object.assign(document.body.style, { margin: "0", width: "100vw", height: "100vh", overflow: "hidden" });
    const mount = document.createElement("main");
    Object.assign(mount.style, { position: "relative", width: "100%", height: "100%" });
    document.body.append(mount);
    const { createMinigame } = await import("/src/minigames/picnic-packer/index.ts");
    const { SeededRng } = await import("/src/core/contracts/rng.ts");
    const { createMinigameLifecycle } = await import("/src/core/contracts/minigame.ts");
    const game = createMinigame();
    const settlements = new Map();
    const best = new Map([[game.id, 0]]);
    const events = [];
    const audio = [];
    let now = 1_000;
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
    window.__picnic = {
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
  await page.evaluate(() => window.__picnic.advance(3.1));
}

async function pieceSnapshot(page) {
  return page.evaluate(() => {
    const game = window.__picnic.game;
    const session = Reflect.get(game, "session");
    const rotations = Reflect.get(game, "rotations");
    return {
      boardIndex: session.boardIndex,
      pieces: session.board.pieces.map((piece) => ({
        id: piece.id,
        x: piece.solutionX,
        y: piece.solutionY,
        rotation: rotations.get(piece.id) ?? 0,
      })),
    };
  });
}

test("drag/rotate and pointer packing completes all 5×5→7×7 baskets and settles once", async ({ page }) => {
  await installGame(page);
  await finishTutorial(page);
  await expect(page.locator(".pp-board")).toHaveAttribute("style", /--pp-size: 5/u);

  for (let board = 0; board < 3; board += 1) {
    const snapshot = await pieceSnapshot(page);
    expect(snapshot.boardIndex).toBe(board);
    for (const [index, piece] of snapshot.pieces.entries()) {
      await page.locator(`[data-pp-piece="${piece.id}"]`).click();
      for (let turn = piece.rotation; turn % 4 !== 0; turn += 1) await page.keyboard.press("r");
      const source = page.locator(`[data-pp-piece="${piece.id}"]`);
      const target = page.locator(`[data-pp-cell][data-pp-x="${piece.x}"][data-pp-y="${piece.y}"]`);
      if (board === 0 && index === 0) await source.dragTo(target);
      else await target.click();
    }
  }

  await expect(page.getByRole("button", { name: "Collect rewards" })).toBeVisible();
  const result = await page.evaluate(() => ({
    settlements: window.__picnic.settlements.size,
    events: window.__picnic.events,
    audio: window.__picnic.audio.map(([action]) => action),
    payout: window.__picnic.game.payout(),
  }));
  expect(result.settlements).toBe(1);
  expect(result.events).toEqual(["run-began", "run-completed"]);
  expect(result.payout.score).toBeGreaterThan(2_000);
  expect(result.audio).toContain("countdown");
  expect(result.audio).toContain("go");
  expect(result.audio).toContain("hit");
  expect(result.audio).toContain("combo");
  expect(result.audio).toContain("win");
});

test("keyboard placement works and pause quit remains unpaid", async ({ page }) => {
  await installGame(page, 7);
  await finishTutorial(page);
  const piece = (await pieceSnapshot(page)).pieces[0];
  await page.locator(`[data-pp-piece="${piece.id}"]`).click();
  for (let turn = piece.rotation; turn % 4 !== 0; turn += 1) await page.keyboard.press("r");
  for (let x = 0; x < piece.x; x += 1) await page.keyboard.press("ArrowRight");
  for (let y = 0; y < piece.y; y += 1) await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Space");
  expect(await page.evaluate(() => Reflect.get(window.__picnic.game, "session").score)).toBeGreaterThan(0);

  await page.getByRole("button", { name: "Pause" }).click();
  await page.getByRole("button", { name: "Quit without reward" }).click();
  const state = await page.evaluate(() => ({
    settlements: window.__picnic.settlements.size,
    events: window.__picnic.events,
  }));
  expect(state.settlements).toBe(0);
  expect(state.events).toEqual(["run-began", "run-exited"]);
  await expect(page.getByRole("button", { name: "Pack the picnic" })).toBeVisible();
});
