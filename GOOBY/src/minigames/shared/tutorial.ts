/**
 * Manifest-driven tutorial overlay.
 *
 * Renders the two-to-four localized steps declared in a minigame manifest,
 * navigable with both pointer (≥44 px buttons) and keyboard (arrows, Enter,
 * Space, Escape). The overlay always offers an unpaid exit: leaving from the
 * tutorial never begins or settles a run — the host wires the exit hook to
 * `lifecycle.exit()` or its scene-close action.
 */
import {
  MINIGAME_TUTORIAL_MAX_STEPS,
  MINIGAME_TUTORIAL_MIN_STEPS,
  type MinigameTutorialStep,
} from "../../core/contracts/minigame";
import { activeCatalog, pickLocalized } from "../../i18n";
import { acquireArcadeKitStyles } from "./styles";

export interface TutorialOverlayOptions {
  readonly host: HTMLElement;
  /** Steps straight from a validated `MinigameManifest.tutorial`. */
  readonly steps: readonly MinigameTutorialStep[];
  /** Fired when the player finishes the last step and starts the round. */
  readonly onStart: () => void;
  /** Unpaid exit: fired on Escape or the quit button; never settles a run. */
  readonly onExitWithoutReward: () => void;
  readonly reducedMotion?: boolean;
}

export interface TutorialOverlay {
  readonly root: HTMLElement;
  readonly stepIndex: number;
  readonly visible: boolean;
  open(): void;
  next(): void;
  back(): void;
  close(): void;
  dispose(): void;
}

export function createTutorialOverlay(options: TutorialOverlayOptions): TutorialOverlay {
  const { steps } = options;
  if (
    steps.length < MINIGAME_TUTORIAL_MIN_STEPS ||
    steps.length > MINIGAME_TUTORIAL_MAX_STEPS
  ) {
    throw new RangeError(
      `Tutorial overlays require ${MINIGAME_TUTORIAL_MIN_STEPS} to ${MINIGAME_TUTORIAL_MAX_STEPS} manifest steps`,
    );
  }
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
  const icon = document.createElement("div");
  icon.className = "ak-card-icon";
  icon.setAttribute("aria-hidden", "true");
  const title = document.createElement("h2");
  const body = document.createElement("p");
  // Non-color progress: numeric "step x of y" text next to the dots.
  const progressText = document.createElement("span");
  progressText.className = "ak-progress-text";
  const dots = document.createElement("div");
  dots.className = "ak-dots";
  dots.setAttribute("aria-hidden", "true");
  const dotElements: HTMLElement[] = [];
  for (let index = 0; index < steps.length; index += 1) {
    const dot = document.createElement("i");
    dots.append(dot);
    dotElements.push(dot);
  }
  const backButton = document.createElement("button");
  backButton.type = "button";
  backButton.className = "ak-button ak-button-secondary";
  const nextButton = document.createElement("button");
  nextButton.type = "button";
  nextButton.className = "ak-button ak-button-primary";
  const exitButton = document.createElement("button");
  exitButton.type = "button";
  exitButton.className = "ak-button ak-button-quiet";

  card.append(kicker);
  card.append(icon);
  card.append(title);
  card.append(body);
  card.append(progressText);
  card.append(dots);
  card.append(backButton);
  card.append(nextButton);
  card.append(exitButton);
  root.append(card);
  options.host.append(root);

  let stepIndex = 0;
  let disposed = false;

  const render = (): void => {
    const strings = activeCatalog().strings.minigameCommon;
    const step = steps[stepIndex];
    if (!step) return;
    kicker.textContent = strings.howToPlay;
    icon.textContent = step.icon;
    title.textContent = pickLocalized(step.title);
    body.textContent = pickLocalized(step.body);
    progressText.textContent = `${stepIndex + 1} / ${steps.length}`;
    for (const [index, dot] of dotElements.entries()) {
      dot.setAttribute("data-ak-active", index === stepIndex ? "true" : "false");
    }
    backButton.textContent = strings.back;
    backButton.hidden = stepIndex === 0;
    nextButton.textContent = stepIndex === steps.length - 1 ? strings.start : strings.next;
    exitButton.textContent = strings.quitNoReward;
  };

  const advance = (): void => {
    if (stepIndex < steps.length - 1) {
      stepIndex += 1;
      render();
      nextButton.focus();
      return;
    }
    root.hidden = true;
    options.onStart();
  };

  const retreat = (): void => {
    if (stepIndex === 0) return;
    stepIndex -= 1;
    render();
    nextButton.focus();
  };

  const exitUnpaid = (): void => {
    root.hidden = true;
    options.onExitWithoutReward();
  };

  const handleNext = (): void => {
    advance();
  };
  const handleBack = (): void => {
    retreat();
  };
  const handleExit = (): void => {
    exitUnpaid();
  };
  const handleKeyDown = (event: KeyboardEvent): void => {
    if (root.hidden || event.repeat) return;
    if (event.key === "ArrowRight" || event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      advance();
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      retreat();
    } else if (event.key === "Escape") {
      event.preventDefault();
      exitUnpaid();
    }
  };
  const keyListener: EventListener = (event) => {
    handleKeyDown(event as KeyboardEvent);
  };

  nextButton.addEventListener("click", handleNext);
  backButton.addEventListener("click", handleBack);
  exitButton.addEventListener("click", handleExit);
  root.addEventListener("keydown", keyListener);

  return {
    root,
    get stepIndex() {
      return stepIndex;
    },
    get visible() {
      return !root.hidden;
    },
    open(): void {
      if (disposed) throw new Error("Tutorial overlay was disposed");
      stepIndex = 0;
      render();
      root.hidden = false;
      nextButton.focus();
    },
    next: advance,
    back: retreat,
    close(): void {
      root.hidden = true;
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      nextButton.removeEventListener("click", handleNext);
      backButton.removeEventListener("click", handleBack);
      exitButton.removeEventListener("click", handleExit);
      root.removeEventListener("keydown", keyListener);
      root.remove();
      releaseStyles();
    },
  };
}
