/**
 * Shared result screen with explicit settlement hooks.
 *
 * The screen itself never talks to persistence: the host settles the run
 * (`lifecycle.completeRun`) before showing the summary, then wires the
 * collect/play-again hooks to its own scene flow. Keyboard and pointer are
 * both first-class, and "new best" is announced with text and a shape glyph,
 * never color alone.
 */
import { activeCatalog } from "../../i18n";
import { acquireArcadeKitStyles } from "./styles";

export interface ResultScreenHooks {
  /** Confirms the already-settled payout and leaves the round. */
  readonly onCollect: () => void;
  /** Starts a fresh run (a new `beginRun` on the host side). */
  readonly onPlayAgain: () => void;
}

export interface ResultSummary {
  readonly score: number;
  readonly best: number;
  readonly newBest: boolean;
  /** True when the round was finished early from the pause menu. */
  readonly quitEarly?: boolean;
  /** Optional extra line, e.g. "12× streak". */
  readonly detail?: string;
}

export interface ResultScreenOptions {
  readonly host: HTMLElement;
  readonly hooks: ResultScreenHooks;
  readonly reducedMotion?: boolean;
}

export interface ResultScreen {
  readonly root: HTMLElement;
  readonly visible: boolean;
  show(summary: ResultSummary): void;
  close(): void;
  dispose(): void;
}

export function createResultScreen(options: ResultScreenOptions): ResultScreen {
  const document = options.host.ownerDocument;
  const releaseStyles = acquireArcadeKitStyles(document);

  const root = document.createElement("div");
  root.className = "ak-overlay";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  if (options.reducedMotion === true) root.setAttribute("data-ak-reduced", "true");
  root.hidden = true;

  const card = document.createElement("section");
  card.className = "ak-card";
  const kicker = document.createElement("span");
  kicker.className = "ak-kicker";
  const scoreValue = document.createElement("div");
  scoreValue.className = "ak-result-score";
  const newBestBadge = document.createElement("div");
  newBestBadge.className = "ak-result-newbest";
  const detailLine = document.createElement("p");
  const bestLine = document.createElement("p");
  const collectButton = document.createElement("button");
  collectButton.type = "button";
  collectButton.className = "ak-button ak-button-primary";
  const playAgainButton = document.createElement("button");
  playAgainButton.type = "button";
  playAgainButton.className = "ak-button ak-button-secondary";

  card.append(kicker);
  card.append(scoreValue);
  card.append(newBestBadge);
  card.append(detailLine);
  card.append(bestLine);
  card.append(collectButton);
  card.append(playAgainButton);
  root.append(card);
  options.host.append(root);

  let disposed = false;

  const handleCollect = (): void => {
    root.hidden = true;
    options.hooks.onCollect();
  };
  const handlePlayAgain = (): void => {
    root.hidden = true;
    options.hooks.onPlayAgain();
  };
  const handleKeyDown = (event: KeyboardEvent): void => {
    if (root.hidden || event.repeat) return;
    if (event.key === "Enter" || event.key === " " || event.key === "Escape") {
      event.preventDefault();
      handleCollect();
    } else if (event.key.toLowerCase() === "r") {
      event.preventDefault();
      handlePlayAgain();
    }
  };
  const keyListener: EventListener = (event) => {
    handleKeyDown(event as KeyboardEvent);
  };

  collectButton.addEventListener("click", handleCollect);
  playAgainButton.addEventListener("click", handlePlayAgain);
  root.addEventListener("keydown", keyListener);

  return {
    root,
    get visible() {
      return !root.hidden;
    },
    show(summary: ResultSummary): void {
      if (disposed) throw new Error("Result screen was disposed");
      const strings = activeCatalog().strings.minigameCommon;
      kicker.textContent = summary.quitEarly === true ? strings.finishAndCollect : strings.roundOver;
      scoreValue.textContent = Math.max(0, Math.floor(summary.score)).toLocaleString();
      newBestBadge.textContent = summary.newBest ? strings.newBest : "";
      newBestBadge.hidden = !summary.newBest;
      detailLine.textContent = summary.detail ?? "";
      detailLine.hidden = summary.detail === undefined || summary.detail.length === 0;
      bestLine.textContent = `${strings.best}: ${Math.max(0, Math.floor(summary.best)).toLocaleString()}`;
      collectButton.textContent = strings.collect;
      playAgainButton.textContent = strings.playAgain;
      root.hidden = false;
      collectButton.focus();
    },
    close(): void {
      root.hidden = true;
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      collectButton.removeEventListener("click", handleCollect);
      playAgainButton.removeEventListener("click", handlePlayAgain);
      root.removeEventListener("keydown", keyListener);
      root.remove();
      releaseStyles();
    },
  };
}
