import { expect, test } from "@playwright/test";

const ARTIFACT_VIDEO = process.env.MINIGAME_VIDEO
  ?? "/opt/cursor/artifacts/sol_max_minigame_pack_full_flows.webm";
const ARTIFACT_SCREENSHOT = process.env.MINIGAME_SCREENSHOT
  ?? "/opt/cursor/artifacts/gooby_says_color_swap_challenge.png";

async function installGame(page, modulePath, factoryName, seed) {
  await page.goto("/src/minigames/bubble-bath-blast/harness.html");
  await page.evaluate(
    async ({ modulePath: path, factoryName: factory, seed: randomSeed }) => {
      document.body.innerHTML = "";
      document.body.style.margin = "0";
      document.body.style.width = "100vw";
      document.body.style.height = "100vh";
      document.body.style.overflow = "hidden";
      const mount = document.createElement("main");
      mount.style.width = "100%";
      mount.style.height = "100%";
      document.body.append(mount);

      const gameModule = await import(path);
      const { SeededRng } = await import("/src/core/contracts/rng.ts");
      const game = gameModule[factory]();
      const payouts = [];
      let now = 1_000_000;
      let previousFrame = performance.now();
      let frame = 0;
      const clock = { now: () => now };

      game.mount({
        clock,
        rng: new SeededRng(randomSeed),
        mount,
        finish: (payout) => payouts.push(payout),
      });
      game.start();

      const loop = (frameAt) => {
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
        advance(seconds) {
          const steps = Math.ceil(seconds / 0.1);
          for (let index = 0; index < steps; index += 1) {
            now += 100;
            game.update(0.1);
          }
        },
        dispose() {
          cancelAnimationFrame(frame);
          game.dispose();
        },
      };
    },
    { modulePath, factoryName, seed },
  );
}

async function advance(page, seconds) {
  await page.evaluate((duration) => window.__minigamePackTest.advance(duration), seconds);
}

async function verifyDisposal(page) {
  const result = await page.evaluate(() => {
    const harness = window.__minigamePackTest;
    const finishes = harness.payouts.length;
    harness.dispose();
    harness.game.update(10);
    return {
      finishes,
      roots: document.querySelectorAll("[data-minigame]").length,
      mountChildren: document.querySelector("main")?.childElementCount ?? -1,
      pendingTimers: Reflect.get(harness.game, "scheduled").size,
    };
  });
  expect(result).toEqual({ finishes: 1, roots: 0, mountChildren: 0, pendingTimers: 0 });
}

async function sortDirection(page) {
  return page.evaluate(() => {
    const game = window.__minigamePackTest.game;
    const item = Reflect.get(game, "currentItem");
    const state = Reflect.get(game, "state");
    if (!item) throw new Error("No active sort item");
    if (item.category === "nonfood") return "up";
    if (state.reverseFrenzy) return item.category === "vegetable" ? "right" : "left";
    return item.category === "vegetable" ? "left" : "right";
  });
}

async function advanceGoobyUntilInput(page) {
  for (let attempt = 0; attempt < 240; attempt += 1) {
    const mode = await page.evaluate(() => Reflect.get(window.__minigamePackTest.game, "mode"));
    if (mode === "input") return;
    await advance(page, 0.1);
  }
  throw new Error("Gooby Says never entered input mode");
}

test("browser-plays all three games through payout and disposal", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    recordVideo: {
      dir: "/tmp/gooby-minigame-videos",
      size: { width: 390, height: 844 },
    },
  });
  await context.routeWebSocket(/.*/u, (socket) => socket.close());
  const page = await context.newPage();
  const video = page.video();

  await installGame(
    page,
    "/src/minigames/bubble-bath-blast/index.ts",
    "createBubbleBathBlast",
    41,
  );
  await expect(page.locator("h1")).toContainText("Bubble");
  await page.getByRole("button", { name: "START SPLASHING" }).click();
  await page.locator("[data-bubble]").first().click({ force: true });
  await page.getByRole("button", { name: "Pause" }).click();
  await expect(page.locator('[data-panel="pause"]')).toBeVisible();
  await page.getByRole("button", { name: "BACK TO THE BATH" }).click();
  await advance(page, 82);
  await expect(page.locator('[data-panel="result"]')).toBeVisible();
  await expect(page.locator("[data-result-reward]")).toContainText("coins");
  await verifyDisposal(page);

  await installGame(
    page,
    "/src/minigames/veggie-sort/index.ts",
    "createVeggieSort",
    87,
  );
  await expect(page.locator("h1")).toContainText("Veggie");
  await page.getByRole("button", { name: "CLOCK IN" }).click();
  await page.getByRole("button", { name: "Pause" }).click();
  await expect(page.locator('[data-panel="pause"]')).toBeVisible();
  await page.getByRole("button", { name: "KEEP SORTING" }).click();

  for (let index = 0; index < 10; index += 1) {
    const direction = await sortDirection(page);
    await page.locator(`[data-direction="${direction}"]`).click({ force: true });
    await page.waitForTimeout(370);
  }
  await page.waitForTimeout(420);
  await expect(page.locator("[data-frenzy]")).toContainText("REVERSE-RULES FRENZY");
  await expect(page.locator("[data-rules]")).toHaveClass(/reverse/);
  await page.waitForTimeout(1_150);

  for (let index = 0; index < 6; index += 1) {
    const direction = await sortDirection(page);
    await page.locator(`[data-direction="${direction}"]`).click({ force: true });
    await page.waitForTimeout(370);
  }
  await page.waitForTimeout(1_050);

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const mistakes = await page.evaluate(() => Reflect.get(window.__minigamePackTest.game, "state").mistakes);
    if (mistakes >= 3) break;
    await page.waitForFunction(() => (
      Reflect.get(window.__minigamePackTest.game, "currentItem") !== null
      && Reflect.get(window.__minigamePackTest.game, "inputLocked") <= 0
    ));
    const correct = await sortDirection(page);
    const wrong = correct === "left" ? "right" : "left";
    await page.locator(`[data-direction="${wrong}"]`).click({ force: true });
    await page.waitForTimeout(390);
  }
  await page.waitForFunction(() => window.__minigamePackTest.payouts.length === 1);
  await expect(page.locator('[data-panel="result"]')).toBeVisible();
  await expect(page.locator("[data-result-best]")).toContainText("perfect sorts");
  await verifyDisposal(page);

  await installGame(
    page,
    "/src/minigames/gooby-says/index.ts",
    "createGoobySays",
    128,
  );
  await expect(page.locator("h1")).toContainText("Gooby");
  await page.getByRole("button", { name: "START THE SHOW" }).click();
  await page.getByRole("button", { name: "Pause" }).click();
  await expect(page.locator('[data-panel="pause"]')).toBeVisible();
  await page.getByRole("button", { name: "CONTINUE SHOW" }).click();

  for (let round = 1; round <= 6; round += 1) {
    await advanceGoobyUntilInput(page);
    const sequence = await page.evaluate(() => [...Reflect.get(window.__minigamePackTest.game, "sequence")]);
    for (const pose of sequence) {
      await page.locator(`[data-pose="${pose}"]`).click({ force: true });
    }
  }

  await advance(page, 1.2);
  await expect(page.locator("[data-challenge]")).toBeVisible();
  await expect(page.locator("[data-flash]")).toContainText("COLOR-SWAP CHALLENGE");
  await page.screenshot({ path: ARTIFACT_SCREENSHOT });
  await advanceGoobyUntilInput(page);
  const roundSeven = await page.evaluate(() => [...Reflect.get(window.__minigamePackTest.game, "sequence")]);
  for (const pose of roundSeven) {
    await page.locator(`[data-pose="${pose}"]`).click({ force: true });
  }

  await advanceGoobyUntilInput(page);
  const expected = await page.evaluate(() => Reflect.get(window.__minigamePackTest.game, "sequence")[0]);
  const wrongPose = ["wave", "hop", "wiggle", "clap"].find((pose) => pose !== expected);
  await page.locator(`[data-pose="${wrongPose}"]`).click({ force: true });
  await advance(page, 1);
  await expect(page.locator('[data-panel="result"]')).toBeVisible();
  await expect(page.locator("[data-result-best]")).toContainText("7 rounds cleared");
  await verifyDisposal(page);

  await page.close();
  await context.close();
  if (!video) throw new Error("Playwright did not create a video");
  await video.saveAs(ARTIFACT_VIDEO);
});
