import { afterEach, describe, expect, it } from "vitest";
import type { MinigameTutorialStep } from "../../core/contracts/minigame";
import { setActiveLanguage } from "../../i18n";
import { createArcadeHud, formatArcadeTimer } from "./hud";
import { createResultScreen } from "./results";
import { ARCADE_KIT_STYLE_ID } from "./styles";
import { createTutorialOverlay } from "./tutorial";
import { createFakeDomHost, type FakeElement } from "./testing/fake-dom";

const TUTORIAL_STEPS: readonly MinigameTutorialStep[] = [
  {
    icon: "🥕",
    title: { en: "Catch things", de: "Fange Dinge" },
    body: { en: "Move under the falling treats.", de: "Bewege dich unter die fallenden Leckereien." },
  },
  {
    icon: "✦",
    title: { en: "Build streaks", de: "Baue Serien auf" },
    body: { en: "Chain catches for bonus points.", de: "Verkette Fänge für Bonuspunkte." },
  },
  {
    icon: "⏱",
    title: { en: "Beat the clock", de: "Schlage die Uhr" },
    body: { en: "The round ends when time is up.", de: "Die Runde endet, wenn die Zeit abläuft." },
  },
];

function findByClass(root: FakeElement, className: string): FakeElement | null {
  if (root.classList.contains(className)) return root;
  for (const child of root.childNodes) {
    const found = findByClass(child, className);
    if (found) return found;
  }
  return null;
}

afterEach(() => {
  setActiveLanguage("en");
});

describe("arcade HUD", () => {
  it("renders localized score/combo/timer/best, updates values, and re-labels on language switch", () => {
    const { document, host, asHtmlElement } = createFakeDomHost();
    let paused = 0;
    const hud = createArcadeHud({
      host: asHtmlElement(host),
      initialBest: 1_234,
      onPause: () => {
        paused += 1;
      },
    });

    const root = host.childNodes[0];
    expect(root?.classList.contains("ak-hud")).toBe(true);
    const labels = root ? collectTexts(root, "small") : [];
    expect(labels).toEqual(["Time", "Score", "Streak", "Best"]);

    hud.setScore(1500);
    hud.setCombo(7);
    hud.setTimer(83);
    hud.setBest(2_000);
    const values = root ? collectTexts(root, "strong") : [];
    expect(values).toEqual(["1:23", (1_500).toLocaleString(), "7×", (2_000).toLocaleString()]);

    setActiveLanguage("de");
    const germanLabels = root ? collectTexts(root, "small") : [];
    expect(germanLabels).toEqual(["Zeit", "Punkte", "Serie", "Bestwert"]);

    const pauseButton = findByClass(root as FakeElement, "ak-hud-pause");
    expect(pauseButton?.getAttribute("aria-label")).toBe("Pause");
    pauseButton?.dispatch("click");
    expect(paused).toBe(1);

    expect(document.getElementById(ARCADE_KIT_STYLE_ID)).not.toBeNull();
    hud.dispose();
    hud.dispose();
    expect(host.childNodes).toHaveLength(0);
    expect(document.getElementById(ARCADE_KIT_STYLE_ID)).toBeNull();
    // Disposed HUDs must not react to later language switches.
    setActiveLanguage("en");
  });

  it("marks combo emphasis with a non-color signal and shares one style element", () => {
    const { document, host, asHtmlElement } = createFakeDomHost();
    const first = createArcadeHud({ host: asHtmlElement(host) });
    const second = createArcadeHud({ host: asHtmlElement(host) });
    const style = document.getElementById(ARCADE_KIT_STYLE_ID);
    expect(style?.getAttribute("data-ak-refs")).toBe("2");

    const root = host.childNodes[0] as FakeElement;
    const comboStat = root.childNodes[2] as FakeElement;
    first.setCombo(1);
    expect(comboStat.getAttribute("data-ak-emphasis")).toBe("false");
    first.setCombo(4);
    expect(comboStat.getAttribute("data-ak-emphasis")).toBe("true");
    expect(comboStat.childNodes[1]?.textContent).toBe("4×");

    first.dispose();
    expect(document.getElementById(ARCADE_KIT_STYLE_ID)?.getAttribute("data-ak-refs")).toBe("1");
    second.dispose();
    expect(document.getElementById(ARCADE_KIT_STYLE_ID)).toBeNull();
  });

  it("formats timers as m:ss", () => {
    expect(formatArcadeTimer(0)).toBe("0:00");
    expect(formatArcadeTimer(9.2)).toBe("0:10");
    expect(formatArcadeTimer(65)).toBe("1:05");
    expect(formatArcadeTimer(-3)).toBe("0:00");
  });
});

function collectTexts(root: FakeElement, tag: string): string[] {
  const texts: string[] = [];
  const walk = (element: FakeElement): void => {
    if (element.tagName === tag.toUpperCase() && element.textContent) texts.push(element.textContent);
    for (const child of element.childNodes) walk(child);
  };
  walk(root);
  return texts;
}

describe("tutorial overlay", () => {
  it("walks manifest steps with pointer and keyboard, then starts the round", () => {
    const { host, asHtmlElement } = createFakeDomHost();
    let started = 0;
    let exited = 0;
    const overlay = createTutorialOverlay({
      host: asHtmlElement(host),
      steps: TUTORIAL_STEPS,
      onStart: () => {
        started += 1;
      },
      onExitWithoutReward: () => {
        exited += 1;
      },
    });
    overlay.open();
    expect(overlay.visible).toBe(true);
    expect(overlay.stepIndex).toBe(0);

    const root = host.childNodes[0] as FakeElement;
    const progress = findByClass(root, "ak-progress-text");
    expect(progress?.textContent).toBe("1 / 3");

    const next = findByClass(root, "ak-button-primary");
    next?.dispatch("click");
    expect(overlay.stepIndex).toBe(1);
    expect(progress?.textContent).toBe("2 / 3");

    root.dispatch("keydown", { key: "ArrowRight" });
    expect(overlay.stepIndex).toBe(2);
    expect(next?.textContent).toBe("Start round");

    root.dispatch("keydown", { key: "ArrowLeft" });
    expect(overlay.stepIndex).toBe(1);
    const back = findByClass(root, "ak-button-secondary");
    back?.dispatch("click");
    expect(overlay.stepIndex).toBe(0);
    expect(back?.hidden).toBe(true);

    root.dispatch("keydown", { key: "Enter" });
    root.dispatch("keydown", { key: "Enter" });
    root.dispatch("keydown", { key: "Enter" });
    expect(started).toBe(1);
    expect(exited).toBe(0);
    expect(overlay.visible).toBe(false);
    overlay.dispose();
  });

  it("always offers the unpaid exit via Escape and the quit button", () => {
    const { host, asHtmlElement } = createFakeDomHost();
    let started = 0;
    let exited = 0;
    const overlay = createTutorialOverlay({
      host: asHtmlElement(host),
      steps: TUTORIAL_STEPS.slice(0, 2),
      onStart: () => {
        started += 1;
      },
      onExitWithoutReward: () => {
        exited += 1;
      },
    });
    overlay.open();
    const root = host.childNodes[0] as FakeElement;
    root.dispatch("keydown", { key: "Escape" });
    expect(exited).toBe(1);
    expect(started).toBe(0);
    expect(overlay.visible).toBe(false);

    overlay.open();
    const quit = findByClass(root, "ak-button-quiet");
    expect(quit?.textContent).toBe("Quit without reward");
    quit?.dispatch("click");
    expect(exited).toBe(2);
    expect(started).toBe(0);
    overlay.dispose();
    expect(host.childNodes).toHaveLength(0);
  });

  it("enforces the manifest step contract and cleans up listeners on dispose", () => {
    const { host, asHtmlElement } = createFakeDomHost();
    const hooks = { onStart: () => undefined, onExitWithoutReward: () => undefined };
    expect(() =>
      createTutorialOverlay({ host: asHtmlElement(host), steps: TUTORIAL_STEPS.slice(0, 1), ...hooks }),
    ).toThrow(RangeError);
    expect(() =>
      createTutorialOverlay({
        host: asHtmlElement(host),
        steps: [...TUTORIAL_STEPS, ...TUTORIAL_STEPS],
        ...hooks,
      }),
    ).toThrow(RangeError);

    let exited = 0;
    const overlay = createTutorialOverlay({
      host: asHtmlElement(host),
      steps: TUTORIAL_STEPS,
      onStart: () => undefined,
      onExitWithoutReward: () => {
        exited += 1;
      },
    });
    overlay.open();
    const root = host.childNodes[0] as FakeElement;
    overlay.dispose();
    expect(root.listenerCount()).toBe(0);
    root.dispatch("keydown", { key: "Escape" });
    expect(exited).toBe(0);
    expect(() => overlay.open()).toThrow(/disposed/u);
  });
});

describe("result screen", () => {
  it("shows the settled summary and fires collect/play-again hooks", () => {
    const { host, asHtmlElement } = createFakeDomHost();
    const calls: string[] = [];
    const screen = createResultScreen({
      host: asHtmlElement(host),
      hooks: {
        onCollect: () => calls.push("collect"),
        onPlayAgain: () => calls.push("again"),
      },
    });
    expect(screen.visible).toBe(false);
    screen.show({ score: 4_321, best: 5_000, newBest: false, detail: "12× streak" });
    expect(screen.visible).toBe(true);

    const root = host.childNodes[0] as FakeElement;
    expect(findByClass(root, "ak-result-score")?.textContent).toBe((4_321).toLocaleString());
    expect(findByClass(root, "ak-result-newbest")?.hidden).toBe(true);
    expect(findByClass(root, "ak-kicker")?.textContent).toBe("Round complete!");

    findByClass(root, "ak-button-primary")?.dispatch("click");
    expect(calls).toEqual(["collect"]);
    expect(screen.visible).toBe(false);

    screen.show({ score: 6_000, best: 6_000, newBest: true, quitEarly: true });
    expect(findByClass(root, "ak-result-newbest")?.hidden).toBe(false);
    expect(findByClass(root, "ak-result-newbest")?.textContent).toBe("NEW HIGH SCORE");
    expect(findByClass(root, "ak-kicker")?.textContent).toBe("Finish & collect");
    findByClass(root, "ak-button-secondary")?.dispatch("click");
    expect(calls).toEqual(["collect", "again"]);
    screen.dispose();
  });

  it("supports keyboard collection and restores the DOM on dispose", () => {
    const { document, host, asHtmlElement } = createFakeDomHost();
    const calls: string[] = [];
    const screen = createResultScreen({
      host: asHtmlElement(host),
      hooks: {
        onCollect: () => calls.push("collect"),
        onPlayAgain: () => calls.push("again"),
      },
    });
    screen.show({ score: 10, best: 10, newBest: true });
    const root = host.childNodes[0] as FakeElement;
    root.dispatch("keydown", { key: "Enter" });
    expect(calls).toEqual(["collect"]);

    screen.show({ score: 11, best: 11, newBest: true });
    root.dispatch("keydown", { key: "r" });
    expect(calls).toEqual(["collect", "again"]);

    screen.dispose();
    expect(host.childNodes).toHaveLength(0);
    expect(root.listenerCount()).toBe(0);
    expect(document.getElementById(ARCADE_KIT_STYLE_ID)).toBeNull();
    expect(() => screen.show({ score: 1, best: 1, newBest: false })).toThrow(/disposed/u);
  });
});
