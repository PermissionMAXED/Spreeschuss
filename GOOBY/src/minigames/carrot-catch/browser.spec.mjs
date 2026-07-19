import { expect, test } from "@playwright/test";

const HARNESS = "/src/minigames/carrot-catch/harness.html";

async function openGame(page, game, extra = "") {
  await page.goto(`${HARNESS}?game=${game}${extra}`);
  await expect(page.locator("#game")).toHaveAttribute("data-ready", "true");
}

const stopLoop = (page) => page.evaluate(() => window.__minigameHarness.stopLoop());

const advance = (page, seconds) =>
  page.evaluate((duration) => window.__minigameHarness.advance(duration), seconds);

const patchSimulation = (page, patch) =>
  page.evaluate((fields) => {
    const simulation = Reflect.get(window.__minigameHarness.module, "simulation");
    for (const [key, value] of Object.entries(fields)) Reflect.set(simulation, key, value);
  }, patch);

const simulationSnapshot = (page) =>
  page.evaluate(() => Reflect.get(window.__minigameHarness.module, "simulation").snapshot());

const audioActions = (page) =>
  page.evaluate(() => window.__minigameHarness.audioEvents.map(([action]) => action));

const settlementCount = (page) =>
  page.evaluate(() => window.__minigameHarness.settlements.size);

const feedbackKinds = (page) =>
  page.evaluate(() => window.__minigameHarness.feedbackEvents.map(({ kind }) => kind));

test("Carrot Catch steers with a held arrow key and cues umbrella, gusts, and glyphs", async ({ page }) => {
  await openGame(page, "carrot-catch", "&seed=11");
  await page.getByRole("button", { name: "LET'S CATCH!" }).click();

  // A physically held key steers continuously through the live rAF loop.
  const basketX = () =>
    page.evaluate(() => Number(document.querySelector(".cc-basket").style.getPropertyValue("--x")));
  expect(await basketX()).toBeCloseTo(0.5, 5);
  await page.keyboard.down("ArrowLeft");
  await page.waitForTimeout(400);
  await page.keyboard.up("ArrowLeft");
  expect(await basketX()).toBeLessThan(0.42);

  await stopLoop(page);

  // Umbrella time widens the basket and labels it without relying on color.
  await patchSimulation(page, { umbrellaSeconds: 6 });
  await advance(page, 0.02);
  await expect(page.locator(".cc-basket")).toHaveClass(/wide/u);
  await expect(page.locator("[data-umbrella]")).toBeVisible();
  await expect(page.locator("[data-umbrella]")).toContainText("WIDE");

  // Non-color glyph markers distinguish golden, rotten, and umbrella drops.
  await patchSimulation(page, {
    spawnIn: 5,
    items: [
      { id: 901, kind: "golden", x: 0.25, y: 0.3, velocity: 0, spin: 0 },
      { id: 902, kind: "rotten", x: 0.5, y: 0.3, velocity: 0, spin: 0 },
      { id: 903, kind: "umbrella", x: 0.75, y: 0.3, velocity: 0, spin: 0 },
    ],
  });
  await advance(page, 1 / 120);
  await expect(page.locator(".cc-drop.cc-golden u").first()).toHaveText("✦");
  await expect(page.locator(".cc-drop.cc-rotten u").first()).toHaveText("✕");
  await expect(page.locator(".cc-drop.cc-umbrella u").first()).toHaveText("☂");

  // Deterministic wind starts at the higher level with an announced pill.
  await page.evaluate(() => {
    const harness = window.__minigameHarness;
    const simulation = Reflect.get(harness.module, "simulation");
    harness.advance(Math.max(0, 30.6 - simulation.snapshot().elapsed));
  });
  await expect(page.locator("[data-wind]")).toBeVisible();
  await expect(page.locator("[data-wind]")).toContainText("GUST");
  expect(await audioActions(page)).toContain("countdown");
  expect((await simulationSnapshot(page)).windX).toBeGreaterThan(0);
});

test("Carrot Catch settles a keyboard-acted run exactly once through the real buttons", async ({ page }) => {
  await openGame(page, "carrot-catch", "&seed=12");
  await page.getByRole("button", { name: "LET'S CATCH!" }).click();
  await page.keyboard.press("ArrowRight");
  await page.getByRole("button", { name: "Pause" }).click();
  await page.getByRole("button", { name: "QUIT & COLLECT" }).click();

  await expect(page.locator("[data-summary]")).toContainText("coins");
  expect(await settlementCount(page)).toBe(1);
  expect(await feedbackKinds(page)).toEqual(["run-began", "run-completed"]);

  // The terminal collect button can never settle the same run twice.
  await page.getByRole("button", { name: "COLLECT REWARDS" }).click();
  expect(await settlementCount(page)).toBe(1);
});

test("Bunny Hop double-jumps on a real Space press and flies a firefly night on run three", async ({ page }) => {
  await openGame(page, "bunny-hop", "&seed=21");
  await page.getByRole("button", { name: "HOP TO IT!" }).click();
  await expect(page.locator(".bh-game")).not.toHaveClass(/night/u);
  await expect(page.locator(".bh-fireflies")).toBeHidden();
  await stopLoop(page);

  // Stored feathers light up the HUD button with a count, not just color.
  await patchSimulation(page, { featherCharges: 2 });
  await advance(page, 0.02);
  await expect(page.locator("[data-jump]")).toHaveAttribute("data-empty", "false");
  await expect(page.locator("[data-feathers]")).toHaveText("2");

  await page.evaluate(() => {
    const harness = window.__minigameHarness;
    const simulation = Reflect.get(harness.module, "simulation");
    for (let step = 0; step < 200 && simulation.snapshot().velocityY >= -40; step += 1) {
      harness.advance(0.03);
    }
  });
  expect((await simulationSnapshot(page)).velocityY).toBeLessThan(0);

  await page.keyboard.press("Space");
  await advance(page, 0.02);
  const afterJump = await simulationSnapshot(page);
  expect(afterJump.doubleJumps).toBe(1);
  expect(afterJump.featherCharges).toBe(1);
  await expect(page.locator("[data-feathers]")).toHaveText("1");
  expect(await audioActions(page)).toContain("combo");

  // Quitting the acted run settles once; two more starts reach night mode.
  await page.getByRole("button", { name: "Quit" }).click();
  expect(await settlementCount(page)).toBe(1);

  await page.evaluate(() => window.__minigameHarness.module.start());
  await page.getByRole("button", { name: "HOP TO IT!" }).click();
  await expect(page.locator(".bh-game")).not.toHaveClass(/night/u);
  await page.getByRole("button", { name: "Quit" }).click();

  await page.evaluate(() => window.__minigameHarness.module.start());
  await page.getByRole("button", { name: "HOP TO IT!" }).click();
  await expect(page.locator(".bh-game")).toHaveClass(/night/u);
  await expect(page.locator(".bh-fireflies")).toBeVisible();
  // The zero-action second run stayed unpaid.
  expect(await settlementCount(page)).toBe(1);
});

test("Pancake Peak drops with Space, pays the syrup window, and tips a lopsided tower", async ({ page }) => {
  await openGame(page, "pancake-peak", "&seed=31&best=350");

  // A persisted best of 300+ advertises the endless tall-tower tier.
  await expect(page.locator("[data-endless]")).toBeVisible();
  await expect(page.locator("[data-endless]")).toContainText("TALL-TOWER");
  await expect(page.locator("[data-best]")).toHaveText("350");

  await page.getByRole("button", { name: "START STACKING!" }).click();
  await stopLoop(page);

  await page.keyboard.press("Space");
  await advance(page, 0.02);
  await expect(page.locator("[data-stack]")).toHaveText("1");
  expect(await audioActions(page)).toContain("hit");

  // Advance the fixed clock into the announced syrup window and drop there.
  await page.evaluate(() => {
    const harness = window.__minigameHarness;
    const simulation = Reflect.get(harness.module, "simulation");
    harness.advance(Math.max(0, 5.4 - simulation.snapshot().elapsed));
  });
  await expect(page.locator("[data-syrup]")).toBeVisible();
  await expect(page.locator("[data-syrup]")).toContainText("SYRUP");
  const scoreBefore = Number(await page.locator("[data-score]").textContent());
  await page.keyboard.press("Space");
  await advance(page, 0.02);
  const scoreAfter = Number(await page.locator("[data-score]").textContent());
  expect(scoreAfter - scoreBefore).toBeGreaterThanOrEqual(40);
  expect(await audioActions(page)).toContain("score");

  // Past 25 layers the endless tier shows its faster, bonus-paying pill.
  await patchSimulation(page, { stackCount: 25 });
  await advance(page, 0.02);
  await expect(page.locator("[data-tier]")).toBeVisible();
  await expect(page.locator("[data-tier]")).toContainText("TALL TOWER");

  // A real tap that shifts the center of mass past the base tips the tower.
  await patchSimulation(page, {
    stackCount: 3,
    layers: [
      { id: 0, x: 180, y: 56, width: 60, perfect: false, butter: false },
      { id: 1, x: 205, y: 80, width: 60, perfect: false, butter: false },
      { id: 2, x: 230, y: 104, width: 60, perfect: false, butter: false },
    ],
    moving: { x: 255, y: 160, width: 60, direction: 1 },
  });
  await page.locator(".pp-field").click({ position: { x: 195, y: 500 } });
  await advance(page, 0.02);
  await expect(page.locator("[data-ended]")).toBeVisible();
  await expect(page.locator("[data-summary]")).toContainText("tipped over");
  expect(await audioActions(page)).toContain("lose");

  await page.getByRole("button", { name: "COLLECT REWARDS" }).click();
  expect(await settlementCount(page)).toBe(1);
});
