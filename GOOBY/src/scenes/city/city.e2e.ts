import { expect, test, type Locator, type Page } from "@playwright/test";
import type { CityDriveDebugSnapshot } from "./scene";
import { CITY_GARAGE_POSITION, type CityPoint } from "../../data/city";
import type { CitySafeCarPose } from "./travel-snapshot";

async function snapshot(page: Page): Promise<CityDriveDebugSnapshot> {
  return page.evaluate(() => window.__cityHarness.snapshot());
}

type DrivingPhase = Extract<
  CityDriveDebugSnapshot["state"]["phase"],
  "driving-outbound" | "driving-home"
>;

const CONTROL_READY_TIMEOUT_MS = 5_000;
const CONTROL_STABLE_TOLERANCE_PX = 0.5;

type ControlBox = NonNullable<Awaited<ReturnType<Locator["boundingBox"]>>>;

function boxesAreStable(previous: ControlBox, current: ControlBox): boolean {
  return Math.abs(previous.x - current.x) <= CONTROL_STABLE_TOLERANCE_PX
    && Math.abs(previous.y - current.y) <= CONTROL_STABLE_TOLERANCE_PX
    && Math.abs(previous.width - current.width) <= CONTROL_STABLE_TOLERANCE_PX
    && Math.abs(previous.height - current.height) <= CONTROL_STABLE_TOLERANCE_PX;
}

async function visibleControlBox(control: Locator): Promise<ControlBox | null> {
  return control.evaluateAll((elements) => {
    if (elements.length !== 1) return null;
    const button = elements[0] as HTMLButtonElement;
    const style = getComputedStyle(button);
    const rect = button.getBoundingClientRect();
    const centerX = rect.x + rect.width / 2;
    const centerY = rect.y + rect.height / 2;
    const hitTarget = document.elementFromPoint(centerX, centerY);
    if (
      !button.isConnected
      || button.hidden
      || button.disabled
      || style.display === "none"
      || style.visibility !== "visible"
      || Number.parseFloat(style.opacity) <= 0
      || style.pointerEvents === "none"
      || rect.width <= 0
      || rect.height <= 0
      || centerX < 0
      || centerX > window.innerWidth
      || centerY < 0
      || centerY > window.innerHeight
      || !hitTarget
      || !button.contains(hitTarget)
    ) {
      return null;
    }
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  });
}

async function controlDiagnostics(control: Locator): Promise<unknown> {
  return control.evaluateAll((elements) => elements.map((element) => {
    const button = element as HTMLButtonElement;
    const controlsRoot = button.closest<HTMLElement>(".city-controls");
    const rect = button.getBoundingClientRect();
    const style = getComputedStyle(button);
    const rootStyle = controlsRoot ? getComputedStyle(controlsRoot) : null;
    return {
      connected: button.isConnected,
      hidden: button.hidden,
      disabled: button.disabled,
      ariaLabel: button.getAttribute("aria-label"),
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      style: {
        display: style.display,
        visibility: style.visibility,
        opacity: style.opacity,
        pointerEvents: style.pointerEvents,
      },
      controlsRoot: controlsRoot && rootStyle
        ? {
            hidden: controlsRoot.hidden,
            rectCount: controlsRoot.getClientRects().length,
            display: rootStyle.display,
            visibility: rootStyle.visibility,
            pointerEvents: rootStyle.pointerEvents,
          }
        : null,
    };
  }));
}

async function releasePointer(page: Page): Promise<void> {
  try {
    await page.mouse.up();
  } catch (error) {
    if (!page.isClosed()) throw error;
  }
}

async function holdFor(
  page: Page,
  control: Locator,
  durationMs: number,
  expectedPhase: DrivingPhase,
): Promise<boolean> {
  const deadline = performance.now() + CONTROL_READY_TIMEOUT_MS;
  let attempts = 0;
  let lastLayoutError = "not attempted";
  let candidateBox: ControlBox | null = null;
  let stableBox: ControlBox | null = null;

  while (performance.now() < deadline) {
    attempts += 1;
    const before = await snapshot(page);
    if (before.state.phase !== expectedPhase) return false;

    let box: ControlBox | null = null;
    try {
      box = await visibleControlBox(control);
      lastLayoutError = box ? "none" : "role button had no pointer-ready hit box";
    } catch (error) {
      lastLayoutError = error instanceof Error ? error.message : String(error);
    }

    const after = await snapshot(page);
    if (after.state.phase !== expectedPhase) return false;
    if (box && candidateBox && boxesAreStable(candidateBox, box)) {
      stableBox = box;
      break;
    }
    candidateBox = box;
    await page.waitForTimeout(50);
  }

  if (!stableBox) {
    const current = await snapshot(page);
    if (current.state.phase !== expectedPhase) return false;
    const diagnostics = await controlDiagnostics(control).catch((error: unknown) => ({
      error: error instanceof Error ? error.message : String(error),
    }));
    throw new Error(
      `Pointer control stayed unavailable or unstable for ${CONTROL_READY_TIMEOUT_MS}ms during ${expectedPhase}`
      + ` after ${attempts} attempts; layout=${JSON.stringify(lastLayoutError)}`
      + `; control=${JSON.stringify(diagnostics)}; snapshot=${JSON.stringify(current)}`,
    );
  }

  await page.mouse.move(stableBox.x + stableBox.width / 2, stableBox.y + stableBox.height / 2);
  await page.mouse.down();
  try {
    await page.waitForTimeout(durationMs);
  } finally {
    await releasePointer(page);
  }
  return true;
}

function headingDelta(from: number, to: number): number {
  let delta = to - from;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}

interface ReloadBoundarySnapshot {
  readonly safeCarPose: CitySafeCarPose;
  readonly collectedCoinIds: readonly string[];
}

async function reloadAtLatestSafePose(
  page: Page,
  label: string,
): Promise<{
  readonly boundary: ReloadBoundarySnapshot;
  readonly initialCarPose: CitySafeCarPose;
}> {
  const storageKey = `gooby.city.reload-boundary.${label}`;
  await page.evaluate((key) => {
    window.addEventListener("pagehide", () => {
      const current = window.__cityHarness.snapshot();
      const boundary: ReloadBoundarySnapshot = {
        safeCarPose: current.travelSnapshot.safeCarPose,
        collectedCoinIds: current.car.collectedCoinIds,
      };
      sessionStorage.setItem(key, JSON.stringify(boundary));
    }, { once: true });
  }, storageKey);
  await page.reload();
  await expect(page.locator("#city-harness")).toHaveAttribute("data-ready", "true");
  return page.evaluate((key) => {
    const serialized = sessionStorage.getItem(key);
    if (!serialized) throw new Error(`Reload boundary was not captured for ${key}`);
    return {
      boundary: JSON.parse(serialized) as ReloadBoundarySnapshot,
      initialCarPose: window.__cityHarness.initialCarPose(),
    };
  }, storageKey);
}

async function steerToward(
  page: Page,
  target: CityPoint,
  radius: number,
  stopPhase?: CityDriveDebugSnapshot["state"]["phase"],
): Promise<void> {
  const left = page.getByRole("button", { name: "Hold to steer left" });
  const right = page.getByRole("button", { name: "Hold to steer right" });
  const drivingPhase = (await snapshot(page)).state.phase;
  if (drivingPhase !== "driving-outbound" && drivingPhase !== "driving-home") {
    throw new Error(`Pointer steering started outside a driving phase: ${drivingPhase}`);
  }
  for (let attempt = 0; attempt < 260; attempt += 1) {
    const current = await snapshot(page);
    if (stopPhase && current.state.phase === stopPhase) return;
    if (current.state.phase !== drivingPhase) {
      throw new Error(
        `Pointer steering changed from ${drivingPhase} to unexpected ${current.state.phase}: ${JSON.stringify(current)}`,
      );
    }
    const dx = target[0] - current.car.position[0];
    const dz = target[1] - current.car.position[1];
    if (Math.hypot(dx, dz) <= radius) return;
    const desired = Math.atan2(dx, dz);
    const error = headingDelta(current.car.headingRadians, desired);
    if (Math.abs(error) < 0.11) {
      await page.waitForTimeout(70);
    } else {
      const held = await holdFor(
        page,
        error > 0 ? left : right,
        Math.min(650, Math.max(100, Math.abs(error) * 420)),
        drivingPhase,
      );
      if (!held) {
        const after = await snapshot(page);
        if (stopPhase && after.state.phase === stopPhase) return;
        throw new Error(
          `Steering control disappeared before ${stopPhase ?? target.join(", ")}: ${JSON.stringify(after)}`,
        );
      }
    }
  }
  throw new Error(`Pointer steering did not reach ${target.join(", ")}: ${JSON.stringify(await snapshot(page))}`);
}

test("real pointer-held steering drives outbound and completes the required return", async ({ page }) => {
  test.setTimeout(240_000);

  await page.goto("/src/scenes/city/dev-harness.html");
  await expect(page.locator("#city-harness")).toHaveAttribute("data-ready", "true");

  await page.getByTestId("destination-carrot-market").click();
  await expect.poll(async () => (await snapshot(page)).state).toMatchObject({
    phase: "depart-ready",
    car: "parked",
    selected: "carrot-market",
  });
  expect((await snapshot(page)).car.speed).toBe(0);

  await page.getByTestId("start-drive").click();
  await expect.poll(async () => (await snapshot(page)).car.position[1], { timeout: 25_000 })
    .toBeLessThan(-31);
  expect(await holdFor(
    page,
    page.getByRole("button", { name: "Hold brake" }),
    750,
    "driving-outbound",
  )).toBe(true);
  await steerToward(page, [-18, -44], 3, "arrived");
  await expect.poll(async () => (await snapshot(page)).state.phase).toBe("arrived");
  await expect(page.getByTestId("enter-shop")).toBeVisible();

  await page.getByTestId("enter-shop").click();
  await expect.poll(async () => (await snapshot(page)).state.phase).toBe("return-board");
  await expect(page.getByTestId("quick-return")).toBeHidden();
  await expect(page.getByText(/first visit makes the return journey/u)).toBeVisible();
  await page.getByTestId("drive-home").click();

  await steerToward(page, [0, -44], 3);
  expect(await holdFor(
    page,
    page.getByRole("button", { name: "Hold brake" }),
    600,
    "driving-home",
  )).toBe(true);
  await steerToward(page, CITY_GARAGE_POSITION, 3, "destination-board");
  await expect.poll(async () => (await snapshot(page)).state.phase, { timeout: 25_000 })
    .toBe("destination-board");
  const finished = await snapshot(page);
  expect(finished.car.position).toEqual([0, 52]);
  expect(finished.state).toEqual({ phase: "destination-board", car: "parked", selected: null });
  await page.screenshot({
    path: "/opt/cursor/artifacts/gooby_city_return_complete.png",
    animations: "disabled",
  });

  const video = page.video();
  await page.close();
  await video?.saveAs("/opt/cursor/artifacts/gooby_city_pointer_drive_outbound_return.webm");
});

test("renders the fog-free city route, hold controls, and gold guidance", async ({ page }) => {
  await page.goto("/src/scenes/city/dev-harness.html");
  await expect(page.locator("#city-harness")).toHaveAttribute("data-ready", "true");
  await page.getByTestId("destination-carrot-market").click();
  await page.getByTestId("start-drive").click();
  await expect.poll(async () => (await snapshot(page)).car.position[1], { timeout: 15_000 })
    .toBeLessThan(38);
  await expect(page.getByTestId("city-distance")).toBeVisible();
  await expect(page.getByRole("button", { name: "Hold brake" })).toBeVisible();
  await page.screenshot({
    path: "/opt/cursor/artifacts/gooby_city_drive_guidance.png",
    animations: "disabled",
  });
});

test("reloads outbound and required-return travel without changing the honest phase", async ({ page }) => {
  await page.goto("/src/scenes/city/dev-harness.html");
  await expect(page.locator("#city-harness")).toHaveAttribute("data-ready", "true");
  await page.getByTestId("destination-carrot-market").click();
  await page.getByTestId("start-drive").click();
  await expect.poll(async () => (await snapshot(page)).car.position[1], { timeout: 15_000 })
    .toBeLessThan(39);
  await expect.poll(async () => (await snapshot(page)).travelSnapshot.collectedRouteState.coinIds)
    .toContain("coin-garage");

  const outboundReload = await reloadAtLatestSafePose(page, "outbound");
  const outboundAfterReload = await snapshot(page);
  expect(outboundAfterReload.state).toMatchObject({
    phase: "driving-outbound",
    selected: "carrot-market",
  });
  expect(distance2dForTest(
    outboundReload.initialCarPose.position,
    outboundReload.boundary.safeCarPose.position,
  )).toBeLessThan(0.001);
  expect(Math.abs(headingDelta(
    outboundReload.initialCarPose.headingRadians,
    outboundReload.boundary.safeCarPose.headingRadians,
  ))).toBeLessThan(0.001);
  for (const coinId of outboundReload.boundary.collectedCoinIds) {
    expect(outboundAfterReload.car.collectedCoinIds).toContain(coinId);
  }

  await page.evaluate(() => window.__cityHarness.completeLeg());
  await expect.poll(async () => (await snapshot(page)).state.phase).toBe("arrived");
  await page.getByTestId("enter-shop").click();
  await expect.poll(async () => (await snapshot(page)).state.phase).toBe("return-board");
  const returnBoardReload = await reloadAtLatestSafePose(page, "return-board");
  expect((await snapshot(page)).state).toMatchObject({
    phase: "return-board",
    visited: "carrot-market",
    returnRequired: true,
  });
  expect(distance2dForTest(
    returnBoardReload.initialCarPose.position,
    returnBoardReload.boundary.safeCarPose.position,
  )).toBeLessThan(0.001);
  await expect(page.getByTestId("quick-return")).toBeHidden();

  await page.getByTestId("drive-home").click();
  await expect.poll(async () => (await snapshot(page)).car.position[0]).toBeGreaterThan(-16);
  await expect.poll(async () => (await snapshot(page)).travelSnapshot.safeCarPose.position[0])
    .toBeGreaterThan(-17);
  const homeReload = await reloadAtLatestSafePose(page, "driving-home");
  expect((await snapshot(page)).state).toMatchObject({
    phase: "driving-home",
    visited: "carrot-market",
  });
  expect(distance2dForTest(
    homeReload.initialCarPose.position,
    homeReload.boundary.safeCarPose.position,
  )).toBeLessThan(0.001);
});

test("invalid travel recovers to the safe garage board", async ({ page }) => {
  await page.goto("/src/scenes/city/dev-harness.html");
  await expect(page.locator("#city-harness")).toHaveAttribute("data-ready", "true");
  await page.evaluate(() => window.__cityHarness.saveRaw({
    phase: "driving-home",
    destination: null,
    visitedShop: "carrot-market",
    returnRequired: true,
    safeCarPose: { position: [900, -900], headingRadians: Number.NaN },
    collectedRouteState: { coinIds: ["not-a-city-coin"] },
  }));
  await page.reload();
  await expect(page.locator("#city-harness")).toHaveAttribute("data-ready", "true");
  const recovered = await snapshot(page);
  expect(recovered.state).toEqual({ phase: "destination-board", car: "parked", selected: null });
  expect(recovered.car.position).toEqual(CITY_GARAGE_POSITION);
});

test("composes real held keyboard and pointer inputs and clears them on lifecycle pauses", async ({ page }) => {
  await page.goto("/src/scenes/city/dev-harness.html");
  await expect(page.locator("#city-harness")).toHaveAttribute("data-ready", "true");
  await page.getByTestId("destination-carrot-market").click();
  await page.getByTestId("start-drive").click();

  await page.keyboard.down("a");
  await expect.poll(async () => {
    const state = (await snapshot(page)).state;
    return state.phase === "driving-outbound" ? state.controls.steering : 0;
  }).toBe(1);
  const brake = page.getByRole("button", { name: "Hold brake" });
  const brakeBox = await brake.boundingBox();
  if (!brakeBox) throw new Error("Brake control has no pointer hit box");
  await page.mouse.move(brakeBox.x + brakeBox.width / 2, brakeBox.y + brakeBox.height / 2);
  await page.mouse.down();
  await expect.poll(async () => {
    const state = (await snapshot(page)).state;
    return state.phase === "driving-outbound" ? state.controls : null;
  }).toMatchObject({ steering: 1, steeringHeld: true, braking: true, brakeHeld: true });
  await page.keyboard.up("a");
  await expect.poll(async () => {
    const state = (await snapshot(page)).state;
    return state.phase === "driving-outbound" ? state.controls : null;
  }).toMatchObject({ steering: 0, braking: true });

  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await expect.poll(async () => {
    const state = (await snapshot(page)).state;
    return state.phase === "driving-outbound" ? state.controls : null;
  }).toEqual({ steering: 0, braking: false, steeringHeld: false, brakeHeld: false });
  await page.mouse.up();

  await page.keyboard.down("d");
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect.poll(async () => {
    const state = (await snapshot(page)).state;
    return state.phase === "driving-outbound" ? state.controls : null;
  }).toEqual({ steering: 0, braking: false, steeringHeld: false, brakeHeld: false });
  await page.keyboard.up("d");
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  });

  await page.keyboard.down("d");
  await page.evaluate(() => window.__cityHarness.pause());
  await expect.poll(async () => {
    const state = (await snapshot(page)).state;
    return state.phase === "driving-outbound" ? state.controls : null;
  }).toEqual({ steering: 0, braking: false, steeringHeld: false, brakeHeld: false });
  await page.keyboard.up("d");

  await page.keyboard.down("a");
  await page.evaluate(() => window.__cityHarness.exit());
  const exited = await snapshot(page);
  expect(exited.state).toMatchObject({
    phase: "driving-outbound",
    controls: { steering: 0, braking: false, steeringHeld: false, brakeHeld: false },
  });
  await page.keyboard.up("a");
});

test("keeps the parked camera clear of the garage wall and stays within draw budget", async ({ page }) => {
  await page.goto("/src/scenes/city/dev-harness.html");
  await expect(page.locator("#city-harness")).toHaveAttribute("data-ready", "true");
  await expect.poll(async () => (await snapshot(page)).worldStats?.drawCalls ?? 0).toBeGreaterThan(0);
  const city = await snapshot(page);
  expect(city.worldStats?.drawCalls).toBeLessThanOrEqual(city.worldStats?.targetDrawCalls ?? 0);
  expect(city.cameraPosition[2]).toBeLessThan(59.15);
  expect(city.cameraPosition[0]).toBeGreaterThan(2);
  await page.screenshot({
    path: "/opt/cursor/artifacts/gooby_city_parked_camera_budget.png",
    animations: "disabled",
  });
});

function distance2dForTest(a: CityPoint, b: CityPoint): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}
