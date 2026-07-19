import { expect, test } from "@playwright/test";

test("real keyboard and pointer input dig, expose flood cues, and settle once", async ({ page }) => {
  await page.goto("/src/minigames/burrow-dig/harness.html");
  const next = page.locator(".ak-overlay:not([hidden]) .ak-button-primary");
  await next.click();
  await next.click();
  await next.click();

  const game = page.locator(".burrow-dig");
  await expect(game).toHaveAttribute("data-phase", "running");
  await page.keyboard.press("ArrowDown");
  let current = page.locator('.bd-cell[data-current="true"]');
  await expect(current).toHaveAttribute("data-row", "1");
  await expect(page.locator("[data-bd-energy]")).not.toContainText("26/26");

  const row = Number(await current.getAttribute("data-row"));
  const column = Number(await current.getAttribute("data-column"));
  const previousIndex = await current.getAttribute("data-bd-cell");
  const candidates = [
    [row + 1, column],
    [row, column + 1],
    [row, column - 1],
    [row - 1, column],
  ];
  let pointerTarget = null;
  for (const [candidateRow, candidateColumn] of candidates) {
    const candidate = page.locator(
      `.bd-cell[data-row="${candidateRow}"][data-column="${candidateColumn}"]:not([data-kind="rock"]):not([data-flood="flooded"])`,
    );
    if (await candidate.count()) {
      pointerTarget = candidate;
      break;
    }
  }
  expect(pointerTarget).not.toBeNull();
  if (pointerTarget === null) throw new Error("Expected one pointer-reachable dig tile");
  await pointerTarget.click();
  current = page.locator('.bd-cell[data-current="true"]');
  await expect(current).not.toHaveAttribute("data-bd-cell", previousIndex ?? "");
  await expect(page.locator("[data-bd-turn]")).toContainText("TURN 2");

  const warningOrSource = page.locator(
    '.bd-cell[data-flood="warning"], .bd-cell[data-kind="water-source"]',
  );
  await expect(warningOrSource.first()).toBeVisible();

  await page.keyboard.press("p");
  await page.getByRole("button", { name: "Finish & collect" }).click();
  await expect(page.locator("body")).toHaveAttribute("data-settlements", "1");
  await page.keyboard.press("Enter");
  await expect(page.locator("body")).toHaveAttribute("data-settlements", "1");

  const tileBox = await page.locator(".bd-cell").first().boundingBox();
  expect(tileBox?.width ?? 0).toBeGreaterThanOrEqual(44);
  expect(tileBox?.height ?? 0).toBeGreaterThanOrEqual(44);
});
