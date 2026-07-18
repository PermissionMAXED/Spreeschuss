/**
 * Localized, safe-area aware arcade HUD: score, combo/streak, round timer and
 * persisted best, plus the shared ≥44 px pause control.
 *
 * The HUD keeps direct references to every element it creates (no selector
 * queries), announces score changes politely to assistive tech, re-labels
 * itself on live language switches, and fully restores the DOM (including the
 * shared stylesheet reference) on dispose.
 */
import { activeCatalog, onLanguageChanged } from "../../i18n";
import { acquireArcadeKitStyles } from "./styles";

export interface ArcadeHudOptions {
  /** Element the HUD bar is appended to (usually the minigame root). */
  readonly host: HTMLElement;
  readonly initialBest?: number;
  readonly reducedMotion?: boolean;
  /** Invoked by the pause button; the game owns the actual pause gate. */
  readonly onPause?: () => void;
}

export interface ArcadeHud {
  readonly root: HTMLElement;
  setScore(score: number): void;
  setCombo(combo: number): void;
  /** Remaining round time in seconds; rendered as m:ss. */
  setTimer(remainingSeconds: number): void;
  setBest(best: number): void;
  setPauseVisible(visible: boolean): void;
  dispose(): void;
}

interface HudStat {
  readonly root: HTMLElement;
  readonly label: HTMLElement;
  readonly value: HTMLElement;
}

export function formatArcadeTimer(remainingSeconds: number): string {
  const clamped = Math.max(0, Math.ceil(remainingSeconds));
  const minutes = Math.floor(clamped / 60);
  const seconds = clamped % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function createArcadeHud(options: ArcadeHudOptions): ArcadeHud {
  const document = options.host.ownerDocument;
  const releaseStyles = acquireArcadeKitStyles(document);

  const root = document.createElement("header");
  root.className = "ak-hud";
  if (options.reducedMotion === true) root.setAttribute("data-ak-reduced", "true");

  const createStat = (): HudStat => {
    const statRoot = document.createElement("div");
    statRoot.className = "ak-hud-stat";
    const label = document.createElement("small");
    const value = document.createElement("strong");
    statRoot.append(label);
    statRoot.append(value);
    root.append(statRoot);
    return { root: statRoot, label, value };
  };

  const timer = createStat();
  const score = createStat();
  score.root.setAttribute("role", "status");
  score.root.setAttribute("aria-live", "polite");
  const combo = createStat();
  const best = createStat();

  const spacer = document.createElement("div");
  spacer.className = "ak-hud-spacer";
  root.append(spacer);

  const pauseButton = document.createElement("button");
  pauseButton.className = "ak-hud-pause";
  pauseButton.type = "button";
  pauseButton.textContent = "Ⅱ";
  root.append(pauseButton);

  const applyStrings = (): void => {
    const strings = activeCatalog().strings.minigameCommon;
    timer.label.textContent = strings.time;
    score.label.textContent = strings.score;
    combo.label.textContent = strings.streak;
    best.label.textContent = strings.best;
    pauseButton.setAttribute("aria-label", strings.pause);
  };
  applyStrings();
  const unsubscribeLanguage = onLanguageChanged(applyStrings);

  const handlePause = (): void => {
    options.onPause?.();
  };
  pauseButton.addEventListener("click", handlePause);

  timer.value.textContent = formatArcadeTimer(0);
  score.value.textContent = "0";
  combo.value.textContent = "0×";
  best.value.textContent = Math.max(0, Math.floor(options.initialBest ?? 0)).toLocaleString();

  options.host.append(root);

  let disposed = false;
  return {
    root,
    setScore(value: number): void {
      score.value.textContent = Math.max(0, Math.floor(value)).toLocaleString();
    },
    setCombo(value: number): void {
      const safe = Math.max(0, Math.floor(value));
      combo.value.textContent = `${safe}×`;
      // Emphasis is non-color: larger size plus underline via the stylesheet.
      combo.root.setAttribute("data-ak-emphasis", safe >= 2 ? "true" : "false");
    },
    setTimer(remainingSeconds: number): void {
      timer.value.textContent = formatArcadeTimer(remainingSeconds);
    },
    setBest(value: number): void {
      best.value.textContent = Math.max(0, Math.floor(value)).toLocaleString();
    },
    setPauseVisible(visible: boolean): void {
      pauseButton.hidden = !visible;
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      unsubscribeLanguage();
      pauseButton.removeEventListener("click", handlePause);
      root.remove();
      releaseStyles();
    },
  };
}
