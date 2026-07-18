import {
  validateMinigameManifest,
  type LocalizedText,
  type MinigameAudioCue,
  type MinigameCategory,
  type MinigameContext,
  type MinigameManifest,
  type MinigameModule,
  type MinigamePayout,
  type MinigameRunId,
  type MinigameTutorialStep,
} from "../core/contracts/minigame";
import type { HapticPattern } from "../core/contracts/platform";
import type { RandomSource } from "../core/contracts/rng";
import type { MinigameId } from "../core/contracts/scenes";
import { activeCatalog, localizedText, pickLocalized, EN_CATALOG } from "../i18n";

export interface MinigameStubDefinition {
  readonly id: MinigameId;
  readonly title: string;
  readonly instructions: string;
}

/** Original compile-green placeholder, retained for contract compatibility. */
export class SpecialistMinigameStub implements MinigameModule {
  private host: HTMLElement | null = null;
  private running = false;
  private score = 0;

  constructor(private readonly definition: MinigameStubDefinition) {}

  get id(): MinigameId {
    return this.definition.id;
  }

  get title(): string {
    return this.definition.title;
  }

  get instructions(): string {
    return this.definition.instructions;
  }

  mount(context: MinigameContext): void {
    this.host = document.createElement("section");
    this.host.className = "minigame-stub";
    this.host.textContent = `${this.title} — specialist module reserved`;
    context.mount.replaceChildren(this.host);
  }

  start(): void {
    this.running = true;
  }

  pause(): void {
    this.running = false;
  }

  resume(): void {
    this.running = true;
  }

  update(deltaSeconds: number): void {
    if (this.running) this.score += deltaSeconds * 10;
  }

  payout(): MinigamePayout {
    const score = Math.floor(this.score);
    return { score, coins: Math.floor(score / 20), xp: Math.floor(score / 10) };
  }

  dispose(): void {
    this.host?.remove();
    this.host = null;
    this.running = false;
  }
}

/** Declarative spec each CP1 expansion module feeds into `cpStubManifest`. */
export interface CpStubManifestSpec {
  readonly id: MinigameId;
  readonly category: MinigameCategory;
  readonly audioCues: readonly MinigameAudioCue[];
  readonly tutorial: readonly MinigameTutorialStep[];
  readonly unlockLevel?: number;
}

/**
 * Builds a validated manifest for a CP1 checkpoint stub. Title, instructions,
 * and icon come from the typed language catalogs so manifest strings stay in
 * parity with the rest of the UI; the dev marker records stub provenance.
 */
export function cpStubManifest(spec: CpStubManifestSpec): MinigameManifest {
  return validateMinigameManifest({
    id: spec.id,
    title: localizedText((catalog) => catalog.minigames[spec.id].title),
    instructions: localizedText((catalog) => catalog.minigames[spec.id].instructions),
    icon: EN_CATALOG.minigames[spec.id].icon,
    category: spec.category,
    stage3d: false,
    tutorial: spec.tutorial,
    audioCues: spec.audioCues,
    unlockLevel: spec.unlockLevel ?? 1,
    dev: { cpStub: true, checkpoint: "CP1" },
  });
}

type SharedAudioAction = MinigameAudioCue;

type PlayableStubContext = MinigameContext & {
  readonly audio?: { emit(action: SharedAudioAction, value?: number): void };
  readonly haptics?: { impact(pattern: HapticPattern): void };
  readonly reducedMotion?: boolean;
  readonly bestScore?: number;
};

/**
 * Theme for the shared CP1 pad-chase round: one glowing target hops between
 * pads, hazards must be left alone, and quick catches build a streak.
 */
export interface CpStubTheme {
  readonly id: MinigameId;
  readonly padGlyph: string;
  readonly targetGlyph: string;
  readonly hazardGlyph: string;
  readonly targetLabel: LocalizedText;
  readonly hazardLabel: LocalizedText;
  readonly padLabel: LocalizedText;
  readonly accent: string;
  readonly backdrop: string;
  readonly roundSeconds?: number;
  readonly targetLifetimeSeconds?: number;
  readonly hazardChance?: number;
}

export const CP_STUB_PAD_COUNT = 9;
const DEFAULT_ROUND_SECONDS = 45;
const DEFAULT_TARGET_LIFETIME = 1.9;
const DEFAULT_HAZARD_CHANCE = 0.22;
const EMPTY_PAYOUT: MinigamePayout = { score: 0, coins: 0, xp: 0 };
const STYLE_ELEMENT_ID = "cp-stub-minigame-style";

export interface CpStubRoundOptions {
  readonly roundSeconds?: number;
  readonly targetLifetimeSeconds?: number;
  readonly hazardChance?: number;
}

export interface CpStubTarget {
  readonly pad: number;
  readonly hazard: boolean;
}

export type CpStubTapOutcome = "hit" | "combo" | "hazard" | "empty";

/**
 * Pure, deterministic round engine behind every CP1 expansion stub. It has no
 * DOM dependencies so the full catch/hazard/streak/timer/payout behavior is
 * exercisable in node-based unit tests and stays replay-safe in the browser.
 */
export class CpStubRound {
  private remainingSeconds: number;
  private spawnCooldown = 0.6;
  private activeTarget: { pad: number; hazard: boolean; ageSeconds: number } | null = null;
  private roundScore = 0;
  private currentStreak = 0;
  private longestStreak = 0;
  private tapCount = 0;

  constructor(
    private readonly rng: RandomSource,
    private readonly options: CpStubRoundOptions = {},
  ) {
    this.remainingSeconds = this.roundSeconds;
  }

  get roundSeconds(): number {
    return this.options.roundSeconds ?? DEFAULT_ROUND_SECONDS;
  }

  get targetLifetimeSeconds(): number {
    return this.options.targetLifetimeSeconds ?? DEFAULT_TARGET_LIFETIME;
  }

  get hazardChance(): number {
    return this.options.hazardChance ?? DEFAULT_HAZARD_CHANCE;
  }

  get remaining(): number {
    return this.remainingSeconds;
  }

  get score(): number {
    return this.roundScore;
  }

  get streak(): number {
    return this.currentStreak;
  }

  get bestStreak(): number {
    return this.longestStreak;
  }

  get taps(): number {
    return this.tapCount;
  }

  get finished(): boolean {
    return this.remainingSeconds <= 0;
  }

  get target(): CpStubTarget | null {
    return this.activeTarget
      ? { pad: this.activeTarget.pad, hazard: this.activeTarget.hazard }
      : null;
  }

  /** Advances the timer, expires stale targets, and spawns fresh ones. */
  update(deltaSeconds: number): void {
    if (this.finished) return;
    this.remainingSeconds = Math.max(0, this.remainingSeconds - deltaSeconds);
    if (this.finished) return;
    if (this.activeTarget) {
      this.activeTarget.ageSeconds += deltaSeconds;
      if (this.activeTarget.ageSeconds >= this.targetLifetimeSeconds) {
        if (!this.activeTarget.hazard) this.currentStreak = 0;
        this.activeTarget = null;
        this.spawnCooldown = 0.35;
      }
      return;
    }
    this.spawnCooldown -= deltaSeconds;
    if (this.spawnCooldown <= 0) {
      const pad = Math.min(CP_STUB_PAD_COUNT - 1, Math.floor(this.rng.next() * CP_STUB_PAD_COUNT));
      const hazard = this.rng.next() < this.hazardChance;
      this.activeTarget = { pad, hazard, ageSeconds: 0 };
    }
  }

  /** Resolves one pad tap: reward catches, punish hazards, break streaks. */
  tap(pad: number): CpStubTapOutcome {
    if (this.finished) return "empty";
    this.tapCount += 1;
    const target = this.activeTarget;
    if (target && target.pad === pad && !target.hazard) {
      this.currentStreak += 1;
      this.longestStreak = Math.max(this.longestStreak, this.currentStreak);
      this.roundScore += 10 + Math.min(8, this.currentStreak);
      this.activeTarget = null;
      this.spawnCooldown = 0.3;
      return this.currentStreak % 5 === 0 ? "combo" : "hit";
    }
    this.currentStreak = 0;
    if (target && target.pad === pad && target.hazard) {
      this.roundScore = Math.max(0, this.roundScore - 5);
      this.activeTarget = null;
      this.spawnCooldown = 0.45;
      return "hazard";
    }
    return "empty";
  }

  payout(): MinigamePayout {
    const score = Math.max(0, Math.floor(this.roundScore));
    return {
      score,
      coins: Math.min(40, Math.floor(score / 20)),
      xp: Math.min(90, Math.floor(score / 10) + this.longestStreak),
    };
  }
}

const STUB_CSS = `
.cps-game{position:absolute;inset:0;display:flex;flex-direction:column;gap:10px;padding:14px;box-sizing:border-box;color:#4a3428;font-family:inherit;border-radius:18px;overflow:hidden}
.cps-topbar{display:flex;align-items:center;justify-content:space-between;gap:8px}
.cps-stat{display:flex;flex-direction:column;min-width:64px;background:rgba(255,255,255,.55);border-radius:12px;padding:6px 10px}
.cps-stat small{font-size:10px;letter-spacing:.08em;opacity:.7}
.cps-stat strong{font-size:18px}
.cps-pause{border:0;border-radius:12px;padding:10px 14px;font-size:16px;background:rgba(255,255,255,.7);cursor:pointer}
.cps-banner{text-align:center;font-size:13px;min-height:18px}
.cps-grid{flex:1;display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
.cps-pad{border:0;border-radius:16px;font-size:30px;background:rgba(255,255,255,.5);cursor:pointer;transition:transform .12s ease,background .12s ease}
.cps-pad.cps-target{background:var(--cps-accent);transform:scale(1.04)}
.cps-pad.cps-hazard{background:rgba(90,90,110,.35)}
.cps-pad.cps-hit{transform:scale(.92)}
.cps-reduced .cps-pad{transition:none}
.cps-footer{display:flex;justify-content:space-between;font-size:11px;letter-spacing:.06em;opacity:.75}
.cps-overlay{position:absolute;inset:0;display:none;align-items:center;justify-content:center;background:rgba(60,40,30,.45);padding:18px;box-sizing:border-box}
.cps-overlay.cps-visible{display:flex}
.cps-card{background:#fff7ec;border-radius:18px;padding:20px;max-width:320px;width:100%;text-align:center;display:flex;flex-direction:column;gap:10px}
.cps-kicker{font-size:11px;letter-spacing:.12em;opacity:.65}
.cps-card h2{margin:0;font-size:20px}
.cps-card p{margin:0;font-size:14px;line-height:1.45}
.cps-icon{font-size:34px}
.cps-primary{border:0;border-radius:14px;padding:12px 16px;font-size:15px;font-weight:600;background:var(--cps-accent);cursor:pointer}
.cps-secondary{border:0;border-radius:14px;padding:10px 14px;font-size:14px;background:rgba(0,0,0,.08);cursor:pointer}
.cps-text{border:0;background:none;font-size:13px;opacity:.7;cursor:pointer;text-decoration:underline}
.cps-dots{display:flex;gap:6px;justify-content:center}
.cps-dots i{width:7px;height:7px;border-radius:50%;background:rgba(0,0,0,.18)}
.cps-dots i.cps-active{background:var(--cps-accent)}
`;

function ensureStyles(document: Document): void {
  if (document.getElementById(STYLE_ELEMENT_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ELEMENT_ID;
  style.textContent = STUB_CSS;
  document.head.append(style);
}

/**
 * A genuinely playable minimal round: catch the themed target as it hops
 * between nine pads, avoid the themed hazard, and build streaks for bonus
 * points. Real input, deterministic RNG placement, replay-safe settlement.
 */
export class CpPlayableStubMinigame implements MinigameModule {
  private context: PlayableStubContext | null = null;
  private host: HTMLElement | null = null;
  private runId: MinigameRunId | null = null;
  private phase: "tutorial" | "playing" | "paused" | "finished" = "tutorial";
  private tutorialPage = 0;
  private round: CpStubRound | null = null;
  private bestScore = 0;
  private settled = false;
  private readonly cleanup: Array<() => void> = [];

  constructor(
    private readonly manifest: MinigameManifest,
    private readonly theme: CpStubTheme,
  ) {}

  get id(): MinigameId {
    return this.manifest.id;
  }

  get title(): string {
    return pickLocalized(this.manifest.title);
  }

  get instructions(): string {
    return pickLocalized(this.manifest.instructions);
  }

  private get roundSeconds(): number {
    return this.theme.roundSeconds ?? DEFAULT_ROUND_SECONDS;
  }

  mount(context: MinigameContext): void {
    this.dispose();
    this.context = context;
    this.settled = false;
    this.bestScore = context.lifecycle?.persistedBest ?? this.context.bestScore ?? 0;
    const document = context.mount.ownerDocument;
    ensureStyles(document);
    const host = document.createElement("section");
    host.className = "cps-game";
    host.classList.toggle("cps-reduced", this.context.reducedMotion === true);
    host.style.setProperty("--cps-accent", this.theme.accent);
    host.style.background = this.theme.backdrop;
    host.setAttribute("aria-label", this.title);
    host.setAttribute("tabindex", "-1");
    const strings = activeCatalog().strings.minigameCommon;
    host.innerHTML = `
      <header class="cps-topbar">
        <div class="cps-stat"><small>${strings.time.toUpperCase()}</small><strong data-cps="time">0:${String(this.roundSeconds).padStart(2, "0")}</strong></div>
        <div class="cps-stat"><small>${strings.score.toUpperCase()}</small><strong data-cps="score">0</strong></div>
        <button class="cps-pause" data-cps-action="pause" aria-label="${strings.pause}">Ⅱ</button>
      </header>
      <div class="cps-banner" data-cps="banner">${this.instructions}</div>
      <div class="cps-grid" role="group">
        ${Array.from({ length: CP_STUB_PAD_COUNT }, (_, pad) => `
          <button class="cps-pad" data-cps-pad="${pad}" aria-keyshortcuts="${pad + 1}" aria-label="${pickLocalized(this.theme.padLabel)}">${this.theme.padGlyph}</button>
        `).join("")}
      </div>
      <footer class="cps-footer"><span>${strings.keyboardHint}</span><span data-cps="best">${strings.best.toUpperCase()} ${this.bestScore.toLocaleString()}</span></footer>
      <div class="cps-overlay" data-cps="overlay"></div>
    `;
    context.mount.replaceChildren(host);
    this.host = host;
    this.listen(host, "click", this.onClick);
    this.listen(host, "keydown", this.onKeyDown);
    this.phase = "tutorial";
    this.tutorialPage = 0;
    this.showTutorial();
  }

  start(): void {
    if (!this.host || this.phase === "playing") return;
    if (this.phase === "tutorial") this.showTutorial();
  }

  pause(): void {
    if (this.phase !== "playing") return;
    this.phase = "paused";
    this.showPause();
  }

  resume(): void {
    if (this.phase !== "paused") return;
    this.phase = "playing";
    this.hideOverlay();
  }

  update(deltaSeconds: number): void {
    if (this.phase !== "playing" || !this.context || !this.round) return;
    this.round.update(deltaSeconds);
    if (this.round.finished) {
      this.finishRound(false);
      return;
    }
    this.render();
  }

  payout(): MinigamePayout {
    if (this.phase !== "finished" || !this.round) return EMPTY_PAYOUT;
    return this.round.payout();
  }

  dispose(): void {
    this.context?.lifecycle?.exit();
    for (const remove of this.cleanup.splice(0)) remove();
    this.host?.remove();
    this.host = null;
    this.context = null;
    this.runId = null;
    this.phase = "finished";
  }

  private listen<K extends keyof HTMLElementEventMap>(
    target: HTMLElement,
    type: K,
    listener: (event: HTMLElementEventMap[K]) => void,
  ): void {
    const wrapped: EventListener = (event) => listener(event as HTMLElementEventMap[K]);
    target.addEventListener(type, wrapped);
    this.cleanup.push(() => target.removeEventListener(type, wrapped));
  }

  private readonly onClick = (event: MouseEvent): void => {
    const target = event.target;
    const elementType = this.host?.ownerDocument.defaultView?.Element;
    if (!elementType || !(target instanceof elementType) || !this.host) return;
    const action = target.closest<HTMLElement>("[data-cps-action]");
    if (action) {
      this.handleAction(action.dataset.cpsAction ?? "");
      return;
    }
    const pad = target.closest<HTMLElement>("[data-cps-pad]");
    if (pad && this.phase === "playing") this.tapPad(Number(pad.dataset.cpsPad), pad);
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.repeat) return;
    const key = event.key.toLowerCase();
    if (key === "p" || event.key === "Escape") {
      if (this.phase === "playing") {
        event.preventDefault();
        this.pause();
      } else if (this.phase === "paused") {
        event.preventDefault();
        this.resume();
      }
      return;
    }
    if (this.phase !== "playing" || !/^[1-9]$/u.test(key)) return;
    event.preventDefault();
    const pad = Number(key) - 1;
    const element = this.host?.querySelector<HTMLElement>(`[data-cps-pad="${pad}"]`) ?? null;
    if (element) this.tapPad(pad, element);
  };

  private tapPad(pad: number, element: HTMLElement): void {
    if (!this.round) return;
    element.classList.remove("cps-hit");
    void element.offsetWidth;
    element.classList.add("cps-hit");
    const outcome = this.round.tap(pad);
    if (outcome === "hit" || outcome === "combo") {
      this.context?.audio?.emit(outcome === "combo" ? "combo" : "hit", this.round.streak);
      this.context?.haptics?.impact(outcome === "combo" ? "success" : "light");
    } else {
      this.context?.audio?.emit("miss");
      this.context?.haptics?.impact("light");
    }
    this.render();
  }

  private handleAction(action: string): void {
    const strings = activeCatalog().strings.minigameCommon;
    switch (action) {
      case "tutorial-next":
        if (this.tutorialPage < this.manifest.tutorial.length - 1) {
          this.tutorialPage += 1;
          this.showTutorial();
        } else {
          this.startRound();
        }
        break;
      case "tutorial-back":
        this.tutorialPage = Math.max(0, this.tutorialPage - 1);
        this.showTutorial();
        break;
      case "pause":
        this.pause();
        break;
      case "resume":
        this.resume();
        break;
      case "restart":
        this.startRound();
        break;
      case "quit":
        if ((this.round?.taps ?? 0) === 0) {
          this.abandonRun();
        } else {
          this.finishRound(true);
        }
        break;
      case "collect":
        this.showBanner(strings.roundOver);
        break;
      default:
        break;
    }
  }

  private startRound(): void {
    const context = this.context;
    if (!context) return;
    this.runId = context.lifecycle?.beginRun() ?? null;
    this.bestScore = context.lifecycle?.persistedBest ?? context.bestScore ?? this.bestScore;
    this.phase = "playing";
    this.round = new CpStubRound(context.rng, {
      ...(this.theme.roundSeconds !== undefined ? { roundSeconds: this.theme.roundSeconds } : {}),
      ...(this.theme.targetLifetimeSeconds !== undefined
        ? { targetLifetimeSeconds: this.theme.targetLifetimeSeconds }
        : {}),
      ...(this.theme.hazardChance !== undefined ? { hazardChance: this.theme.hazardChance } : {}),
    });
    this.settled = false;
    this.hideOverlay();
    this.context?.audio?.emit("go");
    this.render();
    this.host?.querySelector<HTMLButtonElement>("[data-cps-pad]")?.focus();
  }

  private abandonRun(): void {
    this.context?.lifecycle?.exit();
    this.runId = null;
    this.round = null;
    this.phase = "tutorial";
    this.tutorialPage = 0;
    this.showTutorial();
  }

  private finishRound(quitEarly: boolean): void {
    if (this.phase === "finished" || this.settled || !this.round) return;
    this.phase = "finished";
    this.settled = true;
    const payout = this.round.payout();
    const context = this.context;
    if (context?.lifecycle !== undefined && this.runId !== null) {
      const receipt = context.lifecycle.completeRun(this.runId, payout);
      this.bestScore = receipt.bestScore;
      this.runId = null;
    } else {
      this.bestScore = Math.max(this.bestScore, payout.score);
      context?.finish(payout);
    }
    this.showResult(payout, quitEarly);
  }

  private showTutorial(): void {
    const overlay = this.query("[data-cps='overlay']");
    if (!overlay) return;
    const strings = activeCatalog().strings.minigameCommon;
    const step = this.manifest.tutorial[this.tutorialPage] ?? this.manifest.tutorial[0];
    if (!step) return;
    overlay.classList.add("cps-visible");
    overlay.innerHTML = `
      <div class="cps-card">
        <span class="cps-kicker">${strings.howToPlay.toUpperCase()} · ${this.tutorialPage + 1}/${this.manifest.tutorial.length}</span>
        <div class="cps-icon" aria-hidden="true">${step.icon}</div>
        <h2>${pickLocalized(step.title)}</h2>
        <p>${pickLocalized(step.body)}</p>
        <div class="cps-dots">${this.manifest.tutorial.map((_, index) => `<i class="${index === this.tutorialPage ? "cps-active" : ""}"></i>`).join("")}</div>
        ${this.tutorialPage > 0 ? `<button class="cps-secondary" data-cps-action="tutorial-back">${strings.back}</button>` : ""}
        <button class="cps-primary" data-cps-action="tutorial-next">${this.tutorialPage === this.manifest.tutorial.length - 1 ? strings.start : strings.next}</button>
      </div>
    `;
    overlay.querySelector<HTMLButtonElement>("[data-cps-action='tutorial-next']")?.focus();
  }

  private showPause(): void {
    const overlay = this.query("[data-cps='overlay']");
    if (!overlay) return;
    const strings = activeCatalog().strings.minigameCommon;
    overlay.classList.add("cps-visible");
    overlay.innerHTML = `
      <div class="cps-card">
        <span class="cps-kicker">${strings.paused.toUpperCase()}</span>
        <div class="cps-icon" aria-hidden="true">${this.theme.targetGlyph}</div>
        <h2>${strings.paused}</h2>
        <button class="cps-primary" data-cps-action="resume">${strings.resume}</button>
        <button class="cps-secondary" data-cps-action="restart">${strings.restart}</button>
        <button class="cps-text" data-cps-action="quit">${(this.round?.taps ?? 0) === 0 ? strings.quitNoReward : strings.finishAndCollect}</button>
      </div>
    `;
    overlay.querySelector<HTMLButtonElement>("[data-cps-action='resume']")?.focus();
  }

  private showResult(payout: MinigamePayout, quitEarly: boolean): void {
    const overlay = this.query("[data-cps='overlay']");
    if (!overlay) return;
    const strings = activeCatalog().strings.minigameCommon;
    overlay.classList.add("cps-visible");
    overlay.innerHTML = `
      <div class="cps-card">
        <span class="cps-kicker">${(quitEarly ? strings.finishAndCollect : strings.roundOver).toUpperCase()}</span>
        <div class="cps-icon" aria-hidden="true">${this.theme.targetGlyph}</div>
        <h2>${payout.score.toLocaleString()}</h2>
        <p>${strings.streak} <b>${this.round?.bestStreak ?? 0}×</b> · ${strings.best} <b>${this.bestScore.toLocaleString()}</b></p>
        <button class="cps-primary" data-cps-action="collect">${strings.collect}</button>
        <button class="cps-secondary" data-cps-action="restart">${strings.playAgain}</button>
      </div>
    `;
    overlay.querySelector<HTMLButtonElement>("[data-cps-action='collect']")?.focus();
  }

  private hideOverlay(): void {
    const overlay = this.query("[data-cps='overlay']");
    overlay?.classList.remove("cps-visible");
    if (overlay) overlay.replaceChildren();
  }

  private showBanner(text: string): void {
    const banner = this.query("[data-cps='banner']");
    if (banner) banner.textContent = text;
  }

  private render(): void {
    const host = this.host;
    const round = this.round;
    if (!host || !round) return;
    const strings = activeCatalog().strings.minigameCommon;
    const seconds = Math.ceil(round.remaining);
    this.setText("[data-cps='time']", `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`);
    this.setText("[data-cps='score']", Math.floor(round.score).toLocaleString());
    this.setText(
      "[data-cps='best']",
      `${strings.best.toUpperCase()} ${Math.floor(Math.max(this.bestScore, round.score)).toLocaleString()}`,
    );
    this.setText(
      "[data-cps='banner']",
      round.streak > 1 ? `${round.streak}× ${strings.streak}` : this.instructions,
    );
    const target = round.target;
    for (const pad of host.querySelectorAll<HTMLElement>("[data-cps-pad]")) {
      const index = Number(pad.dataset.cpsPad);
      const isTarget = target?.pad === index && !target.hazard;
      const isHazard = target?.pad === index && target.hazard === true;
      pad.classList.toggle("cps-target", isTarget);
      pad.classList.toggle("cps-hazard", isHazard);
      const glyph = isTarget
        ? this.theme.targetGlyph
        : isHazard
          ? this.theme.hazardGlyph
          : this.theme.padGlyph;
      if (pad.textContent !== glyph) pad.textContent = glyph;
      pad.setAttribute(
        "aria-label",
        isTarget
          ? pickLocalized(this.theme.targetLabel)
          : isHazard
            ? pickLocalized(this.theme.hazardLabel)
            : pickLocalized(this.theme.padLabel),
      );
    }
  }

  private query(selector: string): HTMLElement | null {
    return this.host?.querySelector<HTMLElement>(selector) ?? null;
  }

  private setText(selector: string, value: string): void {
    const element = this.query(selector);
    if (element && element.textContent !== value) element.textContent = value;
  }
}

/** Builds the definition/factory pair every CP1 expansion module exports. */
export function createCpStubModule(
  manifest: MinigameManifest,
  theme: CpStubTheme,
): {
  readonly definition: MinigameStubDefinition;
  readonly createMinigame: () => MinigameModule;
} {
  if (manifest.id !== theme.id) {
    throw new Error(`CP stub theme ${theme.id} does not match manifest ${manifest.id}`);
  }
  return {
    definition: {
      id: manifest.id,
      title: manifest.title.en,
      instructions: manifest.instructions.en,
    },
    createMinigame: () => new CpPlayableStubMinigame(manifest, theme),
  };
}
