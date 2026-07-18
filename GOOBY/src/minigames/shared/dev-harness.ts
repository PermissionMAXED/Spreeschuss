/**
 * Arcade Kit browser dev harness (development entry only — never bundled into
 * production; the production scan fails the build if it ever leaks).
 *
 * Wires every kit piece into one genuinely playable lane-catch round:
 * manifest tutorial with unpaid exit → typed countdown → fixed-step
 * simulation with a difficulty ramp → localized safe-area HUD → pause gate
 * with exact restore → result screen hooks, all driven by the held
 * stick/lane/switch input controller.
 */
import { RealClock } from "../../core/contracts/clock";
import type { MinigameTutorialStep } from "../../core/contracts/minigame";
import { SeededRng } from "../../core/contracts/rng";
import { ArcadeCountdown } from "./countdown";
import { createDifficultyRamp } from "./difficulty";
import { FixedStepAccumulator } from "./fixed-step";
import { createArcadeHud } from "./hud";
import { createArcadeInput } from "./input";
import { PauseGate } from "./pause-gate";
import { createResultScreen } from "./results";
import { createTutorialOverlay } from "./tutorial";

const LANES = 3;
const ROUND_SECONDS = 30;
const CATCH_WINDOW = 0.16;

const TUTORIAL_STEPS: readonly MinigameTutorialStep[] = [
  {
    icon: "🥕",
    title: { en: "Catch in three lanes", de: "Fange in drei Bahnen" },
    body: {
      en: "Treats fall down three lanes. Press a lane (tap, 1/2/3, or arrows) as one lands.",
      de: "Leckereien fallen durch drei Bahnen. Drücke eine Bahn (Tippen, 1/2/3 oder Pfeile), wenn eine landet.",
    },
  },
  {
    icon: "✦",
    title: { en: "Build a streak", de: "Baue eine Serie auf" },
    body: {
      en: "Catches chain into a streak. Misses reset it, and the pace ramps up over time.",
      de: "Fänge verketten sich zu einer Serie. Fehler setzen sie zurück, und das Tempo steigt mit der Zeit.",
    },
  },
  {
    icon: "Ⅱ",
    title: { en: "Pause anytime", de: "Pausiere jederzeit" },
    body: {
      en: "The pause button freezes the round exactly; resuming continues where you left off.",
      de: "Der Pause-Knopf friert die Runde exakt ein; beim Fortsetzen geht es genau dort weiter.",
    },
  },
];

interface FallingTarget {
  readonly lane: number;
  /** 0 at spawn, 1 at the catch line. */
  progress: number;
  speed: number;
  element: HTMLElement;
}

function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Kit harness element is missing: ${selector}`);
  return element;
}

const stage = requiredElement<HTMLElement>("#kit-harness");
const status = requiredElement<HTMLOutputElement>("#harness-status");
const clock = new RealClock();
const rng = new SeededRng(20_260_718);

const playfield = document.createElement("div");
playfield.style.cssText =
  "position:absolute;inset:0;display:grid;grid-template-columns:repeat(3,1fr);gap:2px;padding:72px 10px 90px;box-sizing:border-box";
const laneElements: HTMLElement[] = [];
for (let lane = 0; lane < LANES; lane += 1) {
  const laneElement = document.createElement("div");
  laneElement.style.cssText =
    "position:relative;border-radius:14px;background:rgba(255,255,255,.28);overflow:hidden";
  const catchLine = document.createElement("div");
  catchLine.style.cssText =
    "position:absolute;left:6px;right:6px;bottom:9%;height:3px;border-radius:2px;background:#4a3428";
  laneElement.append(catchLine);
  playfield.append(laneElement);
  laneElements.push(laneElement);
}
stage.append(playfield);

const surface = document.createElement("div");
surface.setAttribute("aria-label", "Lane input surface");
stage.append(surface);

const feedbackLog: string[] = [];
const setStatus = (text: string): void => {
  status.textContent = text;
};

let best = 0;
let score = 0;
let combo = 0;
let bestStreak = 0;
let remaining = ROUND_SECONDS;
let elapsed = 0;
let spawnCooldown = 0.9;
let roundActive = false;
let targets: FallingTarget[] = [];

const gate = new PauseGate();
const accumulator = new FixedStepAccumulator({ stepSeconds: 1 / 120 });
const ramp = createDifficultyRamp({ rampSeconds: 24, shape: "smoothstep" });
let countdown: ArcadeCountdown | null = null;

const hud = createArcadeHud({
  host: stage,
  initialBest: best,
  onPause: () => {
    togglePause();
  },
});
hud.setTimer(ROUND_SECONDS);

const pauseCard = document.createElement("div");
pauseCard.className = "ak-overlay";
pauseCard.hidden = true;
const pauseInner = document.createElement("section");
pauseInner.className = "ak-card";
const pauseTitle = document.createElement("h2");
pauseTitle.textContent = "Paused";
const resumeButton = document.createElement("button");
resumeButton.className = "ak-button ak-button-primary";
resumeButton.type = "button";
resumeButton.textContent = "Keep playing";
resumeButton.addEventListener("click", () => {
  togglePause();
});
const finishButton = document.createElement("button");
finishButton.className = "ak-button ak-button-secondary";
finishButton.type = "button";
finishButton.textContent = "Finish & collect";
finishButton.addEventListener("click", () => {
  pauseCard.hidden = true;
  gate.resume();
  finishRound(true);
});
pauseInner.append(pauseTitle, resumeButton, finishButton);
pauseCard.append(pauseInner);
stage.append(pauseCard);

const input = createArcadeInput({ surface, lanes: LANES });
input.subscribe((event) => {
  if (event.kind === "lane-pressed" && roundActive && !gate.paused) tryCatch(event.lane);
  if (event.kind === "action-pressed") {
    // Switch access: the single action targets the lane with the lowest treat.
    const lowest = [...targets].sort((a, b) => b.progress - a.progress)[0];
    if (lowest && roundActive && !gate.paused) tryCatch(lowest.lane);
  }
  if (event.kind === "held-cleared" && event.reason !== "manual" && event.reason !== "dispose") {
    if (roundActive && !gate.paused) togglePause();
  }
});

const results = createResultScreen({
  host: stage,
  hooks: {
    onCollect: () => {
      setStatus(`Collected ${score} points. Best ${best}. Tutorial reopened.`);
      tutorial.open();
    },
    onPlayAgain: () => {
      beginCountdown();
    },
  },
});

const tutorial = createTutorialOverlay({
  host: stage,
  steps: TUTORIAL_STEPS,
  onStart: () => {
    beginCountdown();
  },
  onExitWithoutReward: () => {
    setStatus("Exited without reward — no run began, nothing was settled.");
  },
});

function togglePause(): void {
  if (!roundActive) return;
  if (gate.paused) {
    gate.resume();
    pauseCard.hidden = true;
    input.setEnabled(true);
    surface.focus();
    setStatus("Resumed exactly where the round froze.");
  } else {
    gate.pause();
    pauseCard.hidden = false;
    input.setEnabled(false);
    resumeButton.focus();
    setStatus(`Paused at ${remaining.toFixed(2)}s remaining, step ${accumulator.stepCount}.`);
  }
}

function resetRound(): void {
  for (const target of targets) target.element.remove();
  targets = [];
  score = 0;
  combo = 0;
  bestStreak = 0;
  remaining = ROUND_SECONDS;
  elapsed = 0;
  spawnCooldown = 0.9;
  accumulator.reset();
  hud.setScore(0);
  hud.setCombo(0);
  hud.setTimer(ROUND_SECONDS);
}

function beginCountdown(): void {
  resetRound();
  roundActive = false;
  countdown = new ArcadeCountdown({
    seconds: 3,
    feedback: (event) => {
      feedbackLog.push(event.kind === "tick" ? `countdown:${event.value}` : "go");
      setStatus(event.kind === "tick" ? `Ready… ${event.value}` : "Go!");
      if (event.kind === "go") {
        roundActive = true;
        surface.focus();
      }
    },
  });
  countdown.start();
}

function spawnTarget(): void {
  const lane = rng.int(0, LANES);
  const element = document.createElement("div");
  element.textContent = "🥕";
  element.style.cssText =
    "position:absolute;left:50%;top:0;transform:translate(-50%,0);font-size:30px;pointer-events:none";
  laneElements[lane]?.append(element);
  targets.push({ lane, progress: 0, speed: ramp.valueAt(elapsed, 0.32, 0.75), element });
}

function tryCatch(lane: number): void {
  const candidate = targets.find(
    (target) => target.lane === lane && Math.abs(target.progress - 0.91) <= CATCH_WINDOW,
  );
  if (candidate) {
    candidate.element.remove();
    targets = targets.filter((target) => target !== candidate);
    combo += 1;
    bestStreak = Math.max(bestStreak, combo);
    score += 10 + Math.min(10, combo);
    hud.setScore(score);
    hud.setCombo(combo);
    hud.setBest(Math.max(best, score));
  } else {
    combo = 0;
    hud.setCombo(0);
  }
}

function stepSimulation(dt: number): void {
  elapsed += dt;
  remaining = Math.max(0, remaining - dt);
  spawnCooldown -= dt;
  if (spawnCooldown <= 0) {
    spawnTarget();
    spawnCooldown = ramp.valueAt(elapsed, 1.15, 0.45);
  }
  for (const target of [...targets]) {
    target.progress += target.speed * dt;
    if (target.progress >= 1.05) {
      target.element.remove();
      targets = targets.filter((entry) => entry !== target);
      combo = 0;
      hud.setCombo(0);
    }
  }
}

function renderTargets(): void {
  for (const target of targets) {
    const laneHeight = laneElements[target.lane]?.clientHeight ?? 1;
    target.element.style.transform = `translate(-50%, ${(target.progress * 0.91 * laneHeight).toFixed(1)}px)`;
  }
}

function finishRound(quitEarly: boolean): void {
  if (!roundActive) return;
  roundActive = false;
  const newBest = score > best;
  best = Math.max(best, score);
  hud.setBest(best);
  results.show({
    score,
    best,
    newBest,
    quitEarly,
    detail: `${bestStreak}× streak`,
  });
  setStatus(quitEarly ? "Finished early from pause." : "Round complete.");
}

let lastFrameMs: number | null = null;
function frame(nowMs: number): void {
  requestAnimationFrame(frame);
  void nowMs;
  const wallMs = clock.now();
  const rawDt = lastFrameMs === null ? 0 : Math.min(0.25, (wallMs - lastFrameMs) / 1_000);
  lastFrameMs = wallMs;
  const dt = gate.filter(rawDt);
  if (countdown && !countdown.done) {
    countdown.update(dt);
    return;
  }
  if (!roundActive) return;
  accumulator.advance(dt, (stepDt) => {
    stepSimulation(stepDt);
  });
  hud.setTimer(remaining);
  renderTargets();
  if (remaining <= 0) finishRound(false);
}

stage.dataset.ready = "true";
setStatus("Arcade Kit ready — tutorial open.");
tutorial.open();
requestAnimationFrame(frame);
