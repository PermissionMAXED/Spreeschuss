import { describe, expect, it } from "vitest";
import { createArcadeInput, type ArcadeInput, type ArcadeInputEvent } from "./input";
import { ARCADE_KIT_STYLE_ID } from "./styles";
import { createFakeDomHost, type FakeDocument, type FakeElement, type FakeWindow } from "./testing/fake-dom";

interface InputHarness {
  readonly input: ArcadeInput;
  readonly surface: FakeElement;
  readonly document: FakeDocument;
  readonly window: FakeWindow;
  readonly events: string[];
}

function describeEvent(event: ArcadeInputEvent): string {
  switch (event.kind) {
    case "lane-pressed":
      return `press:${event.lane}:${event.source}`;
    case "lane-released":
      return `release:${event.lane}:${event.source}`;
    case "axis-changed":
      return `axis:${event.x.toFixed(2)},${event.y.toFixed(2)}`;
    case "action-pressed":
      return "action:down";
    case "action-released":
      return "action:up";
    case "held-cleared":
      return `cleared:${event.reason}`;
  }
}

function createHarness(lanes = 3): InputHarness {
  const { document, window, host, asHtmlElement } = createFakeDomHost();
  const surface = document.createElement("div");
  surface.setFakeRect({ left: 0, top: 0, width: 300, height: 600 });
  host.append(surface);
  const input = createArcadeInput({
    surface: asHtmlElement(surface),
    lanes,
    stickRadiusPx: 100,
    deadZone: 0.1,
  });
  const events: string[] = [];
  input.subscribe((event) => events.push(describeEvent(event)));
  return { input, surface, document, window, events };
}

describe("arcade held input", () => {
  it("tracks a held touch as lane press, stick axis, and clean release", () => {
    const { input, surface, events } = createHarness();

    surface.dispatch("pointerdown", { pointerId: 7, clientX: 40, clientY: 300 });
    expect(input.state.lane).toBe(0);
    expect(input.state.laneHeld).toBe(true);
    expect(events).toEqual(["press:0:pointer"]);

    // Drag right: axis follows the drag distance and the lane under the touch.
    surface.dispatch("pointermove", { pointerId: 7, clientX: 120, clientY: 300 });
    expect(input.state.axisX).toBeCloseTo(0.8, 10);
    expect(input.state.lane).toBe(1);
    expect(events).toContain("release:0:pointer");
    expect(events).toContain("press:1:pointer");

    // Small jitters inside the dead zone read as zero.
    surface.dispatch("pointermove", { pointerId: 7, clientX: 45, clientY: 302 });
    expect(input.state.axisX).toBe(0);
    expect(input.state.axisY).toBe(0);

    surface.dispatch("pointermove", { pointerId: 7, clientX: 40, clientY: 420 });
    expect(input.state.axisY).toBeCloseTo(1, 10);

    surface.dispatch("pointerup", { pointerId: 7, clientX: 40, clientY: 420 });
    expect(input.state.laneHeld).toBe(false);
    expect(input.state.axisX).toBe(0);
    expect(input.state.axisY).toBe(0);
    input.dispose();
  });

  it("ignores foreign pointers while one touch is held", () => {
    const { input, surface } = createHarness();
    surface.dispatch("pointerdown", { pointerId: 1, clientX: 150, clientY: 10 });
    expect(input.state.lane).toBe(1);
    surface.dispatch("pointerdown", { pointerId: 2, clientX: 290, clientY: 10 });
    expect(input.state.lane).toBe(1);
    surface.dispatch("pointerup", { pointerId: 2, clientX: 290, clientY: 10 });
    expect(input.state.laneHeld).toBe(true);
    surface.dispatch("pointercancel", { pointerId: 1, clientX: 150, clientY: 10 });
    expect(input.state.laneHeld).toBe(false);
    input.dispose();
  });

  it("maps held keyboard input to axes, lanes, and the switch action", () => {
    const { input, surface, events } = createHarness();

    surface.dispatch("keydown", { key: "ArrowRight" });
    expect(input.state.axisX).toBe(1);
    expect(input.state.lane).toBe(2);
    surface.dispatch("keydown", { key: "ArrowRight", repeat: true });
    expect(events.filter((entry) => entry === "press:2:keyboard")).toHaveLength(1);

    surface.dispatch("keydown", { key: "a" });
    expect(input.state.axisX).toBe(0);
    surface.dispatch("keyup", { key: "ArrowRight" });
    expect(input.state.axisX).toBe(-1);
    surface.dispatch("keyup", { key: "a" });
    expect(input.state.axisX).toBe(0);

    surface.dispatch("keydown", { key: "2" });
    expect(input.state.lane).toBe(1);
    surface.dispatch("keyup", { key: "2" });
    expect(events).toContain("release:1:keyboard");

    // Digits outside the configured lane count are ignored.
    surface.dispatch("keydown", { key: "9" });
    expect(input.state.laneHeld).toBe(false);

    // Space and Enter are the adaptive-switch action bindings.
    surface.dispatch("keydown", { key: " " });
    expect(input.state.actionHeld).toBe(true);
    surface.dispatch("keydown", { key: "Enter" });
    surface.dispatch("keyup", { key: " " });
    expect(input.state.actionHeld).toBe(true);
    surface.dispatch("keyup", { key: "Enter" });
    expect(input.state.actionHeld).toBe(false);
    expect(events).toContain("action:down");
    expect(events).toContain("action:up");
    input.dispose();
  });

  it("clears held state on disable, window blur, and document hiding", () => {
    const { input, surface, document, window, events } = createHarness();

    surface.dispatch("keydown", { key: "ArrowLeft" });
    input.setEnabled(false);
    expect(input.state.axisX).toBe(0);
    expect(input.state.laneHeld).toBe(false);
    expect(events).toContain("cleared:disabled");
    surface.dispatch("keydown", { key: "ArrowRight" });
    expect(input.state.axisX).toBe(0);
    input.setEnabled(true);

    surface.dispatch("pointerdown", { pointerId: 3, clientX: 10, clientY: 10 });
    window.dispatch("blur");
    expect(input.state.laneHeld).toBe(false);
    expect(events).toContain("cleared:blur");

    surface.dispatch("keydown", { key: " " });
    document.visibilityState = "hidden";
    document.dispatch("visibilitychange");
    expect(input.state.actionHeld).toBe(false);
    expect(events).toContain("cleared:hidden");
    document.visibilityState = "visible";

    surface.dispatch("keydown", { key: "1" });
    input.clearHeld();
    expect(events).toContain("cleared:manual");
    input.dispose();
  });

  it("restores the surface and removes every listener on dispose", () => {
    const { input, surface, document, window, events } = createHarness();
    expect(surface.classList.contains("ak-input-surface")).toBe(true);
    expect(surface.getAttribute("tabindex")).toBe("0");
    expect(document.getElementById(ARCADE_KIT_STYLE_ID)).not.toBeNull();

    surface.dispatch("keydown", { key: "ArrowLeft" });
    input.dispose();
    expect(events).toContain("cleared:dispose");
    input.dispose();

    expect(surface.listenerCount()).toBe(0);
    expect(window.listenerCount()).toBe(0);
    expect(document.listenerCount()).toBe(0);
    expect(surface.classList.contains("ak-input-surface")).toBe(false);
    expect(surface.getAttribute("tabindex")).toBeNull();
    expect(document.getElementById(ARCADE_KIT_STYLE_ID)).toBeNull();

    surface.dispatch("keydown", { key: "ArrowLeft" });
    expect(input.state.axisX).toBe(0);
  });

  it("preserves pre-existing surface attributes and validates options", () => {
    const { document, host, asHtmlElement } = createFakeDomHost();
    const surface = document.createElement("div");
    surface.classList.add("ak-input-surface");
    surface.setAttribute("tabindex", "5");
    host.append(surface);
    const input = createArcadeInput({ surface: asHtmlElement(surface) });
    input.dispose();
    expect(surface.classList.contains("ak-input-surface")).toBe(true);
    expect(surface.getAttribute("tabindex")).toBe("5");

    expect(() => createArcadeInput({ surface: asHtmlElement(surface), lanes: 0 })).toThrow(RangeError);
    expect(() => createArcadeInput({ surface: asHtmlElement(surface), lanes: 12 })).toThrow(RangeError);
    expect(() =>
      createArcadeInput({ surface: asHtmlElement(surface), stickRadiusPx: 0 }),
    ).toThrow(RangeError);
    expect(() => createArcadeInput({ surface: asHtmlElement(surface), deadZone: 1 })).toThrow(
      RangeError,
    );
  });
});
