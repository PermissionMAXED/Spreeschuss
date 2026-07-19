import type {
  MinigameContext,
  MinigameManifest,
  MinigameModule,
  MinigamePayout,
} from "../../core/contracts/minigame";
import { validateMinigameManifest } from "../../core/contracts/minigame";
import type { HapticPattern } from "../../core/contracts/platform";
import { activeCatalog, EN_CATALOG, localizedText, pickLocalized } from "../../i18n";
import {
  ArcadeCountdown,
  createArcadeHud,
  createResultScreen,
  createTutorialOverlay,
  PauseGate,
  type ArcadeHud,
  type ResultScreen,
  type TutorialOverlay,
} from "../shared";
import type { MinigameStubDefinition } from "../stub";
import {
  SCALE_ROUND_COUNT,
  SCALE_WEIGHT_BLOCKS,
  addScaleWeight,
  clearScaleWeights,
  createScaleSession,
  estimateWeight,
  removeScaleWeight,
  scalePayout,
  stepScaleSession,
  submitScaleEstimate,
  type ScaleSession,
  type ScaleWeight,
  type WeightGrade,
} from "./logic";
import { createMarketSettlement, type MarketSettlement } from "./settlement";

export const manifest: MinigameManifest = validateMinigameManifest({
  id: "market-scales",
  title: localizedText((catalog) => catalog.minigames["market-scales"].title),
  instructions: localizedText((catalog) => catalog.minigames["market-scales"].instructions),
  icon: EN_CATALOG.minigames["market-scales"].icon,
  category: "puzzle",
  stage3d: false,
  unlockLevel: 1,
  audioCues: ["countdown", "go", "hit", "miss", "combo", "score", "win"],
  tutorial: [
    {
      icon: "🍎",
      title: { en: "Read the produce", de: "Schau dir die Waren an" },
      body: {
        en: "Produce sits on the left pan. Add gram blocks to the right pan until your estimate balances it.",
        de: "Waren liegen links. Lege Grammgewichte rechts auf, bis deine Schätzung die Waage ausgleicht.",
      },
    },
    {
      icon: "25g",
      title: { en: "Build an estimate", de: "Baue deine Schätzung" },
      body: {
        en: "Tap weights or use keys 1–5. Remove a block, clear the pan, then press Space to weigh.",
        de: "Tippe Gewichte oder nutze 1–5. Entferne Gewichte, leere die Schale und drücke Leertaste zum Wiegen.",
      },
    },
    {
      icon: "✦",
      title: { en: "Hints fade to expert", de: "Von Tipps zum Profi" },
      body: {
        en: "The first three baskets show a range. Expert baskets hide it; precise balances build a streak.",
        de: "Die ersten drei Körbe zeigen einen Bereich. Profikörbe verbergen ihn; präzises Wiegen baut eine Serie auf.",
      },
    },
  ],
});

export const definition: MinigameStubDefinition = {
  id: manifest.id,
  title: manifest.title.en,
  instructions: manifest.instructions.en,
};

type SoundAction = "hit" | "miss" | "combo" | "countdown" | "go" | "win" | "lose" | "score";
type MarketContext = MinigameContext & {
  readonly audio?: { emit(action: SoundAction, value?: number): void };
  readonly haptics?: { impact(pattern: HapticPattern): void };
  readonly bestScore?: number;
  readonly reducedMotion?: boolean;
};
type Phase = "boot" | "tutorial" | "ready" | "countdown" | "playing" | "paused" | "result" | "disposed";
type Copy = { readonly en: string; readonly de: string };

const COPY = {
  start: { en: "Open the stall", de: "Marktstand öffnen" },
  ready: { en: "Market stall", de: "Marktstand" },
  round: { en: "Customer", de: "Kundschaft" },
  guided: { en: "Hint", de: "Tipp" },
  expert: { en: "EXPERT · NO RANGE", de: "PROFI · OHNE BEREICH" },
  add: { en: "Add", de: "Hinzufügen" },
  remove: { en: "Remove", de: "Entfernen" },
  clear: { en: "Clear pan", de: "Schale leeren" },
  weigh: { en: "Weigh it", de: "Wiegen" },
  estimate: { en: "Your estimate", de: "Deine Schätzung" },
  target: { en: "Actual", de: "Tatsächlich" },
  perfect: { en: "Perfect balance!", de: "Perfektes Gleichgewicht!" },
  close: { en: "So close!", de: "Ganz nah dran!" },
  miss: { en: "A useful market estimate.", de: "Eine hilfreiche Marktschätzung." },
  gramError: { en: "g off", de: "g daneben" },
  keys: { en: "1–5 add · Backspace remove · C clear · Space weigh · P pause", de: "1–5 hinzufügen · Rücktaste entfernen · C leeren · Leertaste wiegen · P Pause" },
  detail: { en: "perfect · best precision streak", de: "perfekt · beste Präzisionsserie" },
  unpaid: { en: "Stall closed — no rewards.", de: "Stand geschlossen — keine Belohnung." },
} as const satisfies Readonly<Record<string, Copy>>;

type CopyKey = keyof typeof COPY;
const text = (key: CopyKey): string => pickLocalized(COPY[key]);
const EMPTY_PAYOUT: MinigamePayout = { score: 0, coins: 0, xp: 0 };

export class MarketScalesGame implements MinigameModule {
  readonly id = manifest.id;
  private context: MarketContext | null = null;
  private root: HTMLElement | null = null;
  private hud: ArcadeHud | null = null;
  private tutorial: TutorialOverlay | null = null;
  private results: ResultScreen | null = null;
  private settlement: MarketSettlement | null = null;
  private session: ScaleSession | null = null;
  private countdown: ArcadeCountdown | null = null;
  private readonly pauseGate = new PauseGate();
  private readonly cleanup: Array<() => void> = [];
  private phase: Phase = "boot";
  private pausedFrom: "countdown" | "playing" | null = null;
  private settledPayout: MinigamePayout | null = null;
  private best = 0;

  get title(): string {
    return pickLocalized(manifest.title);
  }

  get instructions(): string {
    return pickLocalized(manifest.instructions);
  }

  private get reducedMotion(): boolean {
    return this.context?.reducedMotion === true;
  }

  mount(context: MinigameContext): void {
    if (this.phase !== "boot" && this.phase !== "disposed") this.dispose();
    this.context = context;
    this.settlement = createMarketSettlement(context);
    this.best = this.settlement.persistedBest;
    const root = context.mount.ownerDocument.createElement("section");
    root.className = "market-scales";
    root.dataset.minigame = this.id;
    root.tabIndex = 0;
    root.setAttribute("aria-label", this.title);
    if (this.reducedMotion) root.dataset.akReduced = "true";
    root.innerHTML = `
      <style>${MARKET_CSS}</style>
      <div class="ms-bg" aria-hidden="true"><i></i><i></i><i></i></div>
      <main class="ms-stage">
        <div class="ms-round">
          <strong data-ms="round">${text("round")} 1/${SCALE_ROUND_COUNT}</strong>
          <span data-ms="mode">${text("guided")}</span>
        </div>
        <div class="ms-hint" data-ms="hint" role="status"></div>
        <div class="ms-scale" data-ms="scale">
          <div class="ms-beam" data-ms="beam">
            <i class="ms-chain left"></i><i class="ms-chain right"></i>
            <div class="ms-pan left" data-ms="produce"></div>
            <div class="ms-pan right" data-ms="loaded"></div>
          </div>
          <div class="ms-pivot">◇<i></i></div>
        </div>
        <div class="ms-estimate"><span>${text("estimate")}</span><strong data-ms="estimate">0 g</strong></div>
        <div class="ms-blocks" data-ms="blocks"></div>
        <div class="ms-actions">
          <button type="button" data-ms-action="clear">${text("clear")}</button>
          <button type="button" class="primary" data-ms-action="weigh">${text("weigh")}</button>
        </div>
        <div class="ms-status" data-ms="status" role="status" aria-live="polite"></div>
      </main>
      <p class="ms-keys">${text("keys")}</p>
      <div class="ms-countdown" data-ms="countdown" hidden></div>
      <div class="ak-overlay ms-panel" data-ms="panel" role="dialog" aria-modal="true" hidden></div>
    `;
    context.mount.replaceChildren(root);
    this.root = root;
    this.hud = createArcadeHud({
      host: root,
      initialBest: this.best,
      reducedMotion: this.reducedMotion,
      onPause: () => {
        this.pause();
      },
    });
    this.tutorial = createTutorialOverlay({
      host: root,
      steps: manifest.tutorial,
      reducedMotion: this.reducedMotion,
      onStart: () => {
        this.beginCountdown();
      },
      onExitWithoutReward: () => {
        this.exitUnpaid();
      },
    });
    this.results = createResultScreen({
      host: root,
      reducedMotion: this.reducedMotion,
      hooks: {
        onCollect: () => {
          this.showReadyPanel();
        },
        onPlayAgain: () => {
          this.beginCountdown();
        },
      },
    });
    root.addEventListener("click", this.onClick);
    root.addEventListener("keydown", this.onKeyDown);
    this.cleanup.push(() => root.removeEventListener("click", this.onClick));
    this.cleanup.push(() => root.removeEventListener("keydown", this.onKeyDown));
    this.phase = "tutorial";
  }

  start(): void {
    if (this.phase === "tutorial") this.tutorial?.open();
  }

  pause(): void {
    if (this.phase !== "playing" && this.phase !== "countdown") return;
    this.pausedFrom = this.phase;
    this.phase = "paused";
    this.pauseGate.pause();
    this.showPausePanel();
  }

  resume(): void {
    if (this.phase !== "paused") return;
    this.phase = this.pausedFrom ?? "playing";
    this.pausedFrom = null;
    this.pauseGate.resume();
    this.hidePanel();
    this.root?.focus();
  }

  update(deltaSeconds: number): void {
    const requested = Math.min(0.25, Math.max(0, Number.isFinite(deltaSeconds) ? deltaSeconds : 0));
    const delta = this.pauseGate.filter(requested);
    if (this.phase === "countdown") {
      this.countdown?.update(delta);
    } else if (this.phase === "playing" && this.session) {
      stepScaleSession(this.session, delta);
      this.hud?.setTimer(this.session.elapsedSeconds);
    }
  }

  payout(): MinigamePayout {
    return this.settledPayout ?? EMPTY_PAYOUT;
  }

  dispose(): void {
    if (this.phase === "disposed") return;
    this.settlement?.exitUnpaid();
    for (const remove of this.cleanup.splice(0)) remove();
    this.hud?.dispose();
    this.tutorial?.dispose();
    this.results?.dispose();
    this.root?.remove();
    this.pauseGate.dispose();
    this.phase = "disposed";
    this.context = null;
    this.root = null;
    this.hud = null;
    this.tutorial = null;
    this.results = null;
    this.settlement = null;
    this.session = null;
    this.countdown = null;
  }

  private beginCountdown(): void {
    if (!this.context || !this.settlement) return;
    this.results?.close();
    this.hidePanel();
    this.settlement.begin();
    this.session = createScaleSession(this.context.rng);
    this.settledPayout = null;
    this.best = this.settlement.persistedBest;
    this.pauseGate.resume();
    this.phase = "countdown";
    this.render();
    const counter = this.root?.querySelector<HTMLElement>("[data-ms='countdown']");
    this.countdown = new ArcadeCountdown({
      seconds: 3,
      feedback: (event) => {
        if (counter) {
          counter.hidden = false;
          counter.textContent = event.kind === "tick"
            ? String(event.value)
            : activeCatalog().strings.minigameCommon.go;
        }
        this.emit(event.cue, event.kind === "tick" ? event.value : undefined);
        if (event.kind === "go") {
          if (counter) counter.hidden = true;
          this.phase = "playing";
          this.root?.focus();
        }
      },
    });
    this.countdown.start();
  }

  private finish(): void {
    if (!this.session || !this.settlement || this.phase === "result") return;
    const payout = scalePayout(this.session);
    const previousBest = this.settlement.persistedBest;
    this.settledPayout = payout;
    const best = this.settlement.complete(payout);
    this.best = Math.max(previousBest, best ?? payout.score);
    this.hud?.setBest(this.best);
    this.emit("win", payout.score, "success");
    this.phase = "result";
    this.results?.show({
      score: payout.score,
      best: this.best,
      newBest: payout.score > previousBest,
      detail: `${this.session.perfects}/${SCALE_ROUND_COUNT} ${text("detail")} ${this.session.bestStreak}×`,
    });
  }

  private exitUnpaid(): void {
    this.settlement?.exitUnpaid();
    this.settledPayout = null;
    this.showReadyPanel(text("unpaid"));
  }

  private showReadyPanel(notice = ""): void {
    this.phase = "ready";
    const panel = this.panel();
    if (!panel) return;
    const strings = activeCatalog().strings.minigameCommon;
    panel.hidden = false;
    panel.innerHTML = `
      <div class="ak-card">
        <span class="ak-kicker">${text("ready")}</span>
        <div class="ak-card-icon" aria-hidden="true">⚖</div>
        <h2>${this.title}</h2>
        ${notice ? `<p>${notice}</p>` : ""}
        <button class="ak-button ak-button-primary" data-ms-action="start">${text("start")}</button>
        <button class="ak-button ak-button-quiet" data-ms-action="tutorial">${strings.howToPlay}</button>
      </div>
    `;
    panel.querySelector<HTMLButtonElement>("[data-ms-action='start']")?.focus();
  }

  private showPausePanel(): void {
    const panel = this.panel();
    if (!panel) return;
    const strings = activeCatalog().strings.minigameCommon;
    panel.hidden = false;
    panel.innerHTML = `
      <div class="ak-card">
        <span class="ak-kicker">${strings.paused}</span>
        <div class="ak-card-icon" aria-hidden="true">⚖</div>
        <h2>${strings.paused}</h2>
        <button class="ak-button ak-button-primary" data-ms-action="resume">${strings.resume}</button>
        <button class="ak-button ak-button-secondary" data-ms-action="restart">${strings.restart}</button>
        <button class="ak-button ak-button-quiet" data-ms-action="quit">${strings.quitNoReward}</button>
      </div>
    `;
    panel.querySelector<HTMLButtonElement>("[data-ms-action='resume']")?.focus();
  }

  private panel(): HTMLElement | null {
    return this.root?.querySelector<HTMLElement>("[data-ms='panel']") ?? null;
  }

  private hidePanel(): void {
    const panel = this.panel();
    if (!panel) return;
    panel.hidden = true;
    panel.replaceChildren();
  }

  private readonly onClick = (event: MouseEvent): void => {
    const target = event.target instanceof Element
      ? event.target.closest<HTMLElement>("[data-ms-action],[data-ms-weight],[data-ms-remove]")
      : null;
    if (!target) return;
    const action = target.dataset.msAction;
    if (action) {
      switch (action) {
        case "start":
        case "restart":
          this.beginCountdown();
          break;
        case "tutorial":
          this.hidePanel();
          this.phase = "tutorial";
          this.tutorial?.open();
          break;
        case "resume":
          this.resume();
          break;
        case "quit":
          this.exitUnpaid();
          break;
        case "clear":
          if (this.session && this.phase === "playing") {
            clearScaleWeights(this.session);
            this.render();
          }
          break;
        case "weigh":
          this.submit();
          break;
        default:
          break;
      }
      return;
    }
    if (target.dataset.msWeight) this.addWeight(Number(target.dataset.msWeight) as ScaleWeight);
    else if (target.dataset.msRemove) this.removeWeight(Number(target.dataset.msRemove));
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.repeat) return;
    const key = event.key.toLowerCase();
    if (key === "p" || key === "escape") {
      if (this.phase === "playing" || this.phase === "countdown") {
        event.preventDefault();
        this.pause();
      } else if (this.phase === "paused") {
        event.preventDefault();
        this.resume();
      }
      return;
    }
    if (this.phase !== "playing" || !this.session) return;
    if (/^[1-5]$/u.test(key)) {
      const weight = SCALE_WEIGHT_BLOCKS[Number(key) - 1];
      if (weight) this.addWeight(weight);
    } else if (key === "backspace" || key === "delete") {
      event.preventDefault();
      this.removeWeight(this.session.loadedWeights.length - 1);
    } else if (key === "c") {
      clearScaleWeights(this.session);
      this.render();
    } else if (key === " " || key === "enter") {
      event.preventDefault();
      this.submit();
    }
  };

  private addWeight(weight: ScaleWeight): void {
    if (!this.session || this.phase !== "playing") return;
    if (addScaleWeight(this.session, weight)) {
      this.emit("score", weight);
      this.render();
    }
  }

  private removeWeight(index: number): void {
    if (!this.session || this.phase !== "playing") return;
    if (removeScaleWeight(this.session, index) !== null) {
      this.emit("score");
      this.render();
    }
  }

  private submit(): void {
    if (!this.session || !this.context || this.phase !== "playing") return;
    const judgement = submitScaleEstimate(this.session, this.context.rng);
    if (!judgement) return;
    const status = judgement.grade === "perfect"
      ? `${text("perfect")} ${judgement.error} ${text("gramError")}`
      : judgement.grade === "close"
        ? `${text("close")} ${judgement.error} ${text("gramError")}`
        : `${text("miss")} ${text("target")} ${judgement.target} g`;
    this.status(status, judgement.grade);
    this.emit(
      judgement.grade === "perfect" ? (judgement.streak >= 2 ? "combo" : "hit") : judgement.grade === "close" ? "hit" : "miss",
      judgement.streak,
      judgement.grade === "perfect" ? "success" : judgement.grade === "close" ? "light" : "warning",
    );
    this.render();
    if (this.session.finished) this.finish();
  }

  private render(): void {
    const root = this.root;
    const session = this.session;
    if (!root || !session) return;
    const challenge = session.challenge;
    const estimate = estimateWeight(session.loadedWeights);
    const round = root.querySelector<HTMLElement>("[data-ms='round']");
    if (round) round.textContent = `${text("round")} ${challenge.index + 1}/${SCALE_ROUND_COUNT}`;
    const mode = root.querySelector<HTMLElement>("[data-ms='mode']");
    if (mode) {
      mode.textContent = challenge.expert ? text("expert") : text("guided");
      mode.classList.toggle("expert", challenge.expert);
    }
    const hint = root.querySelector<HTMLElement>("[data-ms='hint']");
    if (hint) hint.textContent = challenge.hint
      ? `${text("guided")}: ${challenge.hint.minimum}–${challenge.hint.maximum} g`
      : text("expert");
    const produce = root.querySelector<HTMLElement>("[data-ms='produce']");
    if (produce) {
      produce.innerHTML = challenge.produce.map((item) => `<span title="${item.id}">${item.glyph}</span>`).join("");
    }
    const loaded = root.querySelector<HTMLElement>("[data-ms='loaded']");
    if (loaded) {
      loaded.innerHTML = session.loadedWeights.length > 0
        ? session.loadedWeights.map((weight, index) => `<button type="button" data-ms-remove="${index}" aria-label="${text("remove")} ${weight} g">${weight}<small>g</small></button>`).join("")
        : "<span class='empty'>?</span>";
    }
    const estimateLabel = root.querySelector<HTMLElement>("[data-ms='estimate']");
    if (estimateLabel) estimateLabel.textContent = `${estimate} g`;
    const beam = root.querySelector<HTMLElement>("[data-ms='beam']");
    if (beam) {
      const difference = estimate - challenge.targetGrams;
      const tilt = Math.max(-9, Math.min(9, difference / Math.max(25, challenge.targetGrams) * 22));
      beam.style.setProperty("--tilt", `${tilt.toFixed(2)}deg`);
      beam.setAttribute("aria-label", `${text("estimate")} ${estimate} g`);
    }
    const blocks = root.querySelector<HTMLElement>("[data-ms='blocks']");
    if (blocks) {
      blocks.innerHTML = SCALE_WEIGHT_BLOCKS.map((weight, index) => `
        <button type="button" data-ms-weight="${weight}" aria-keyshortcuts="${index + 1}" aria-label="${text("add")} ${weight} grams">
          <strong>${weight}</strong><small>g</small>
        </button>
      `).join("");
    }
    this.hud?.setScore(session.score);
    this.hud?.setCombo(session.precisionStreak);
    this.hud?.setBest(Math.max(this.best, session.score));
  }

  private status(message: string, grade?: WeightGrade): void {
    const status = this.root?.querySelector<HTMLElement>("[data-ms='status']");
    if (!status) return;
    status.textContent = message;
    status.className = `ms-status${grade ? ` ${grade}` : ""}`;
  }

  private emit(action: SoundAction, value?: number, haptic?: HapticPattern): void {
    this.context?.audio?.emit(action, value);
    if (haptic) this.context?.haptics?.impact(haptic);
  }
}

export const createMinigame = (): MinigameModule => new MarketScalesGame();

const MARKET_CSS = `
  .market-scales{position:relative;isolation:isolate;width:100%;height:100%;min-height:620px;overflow:hidden;color:#3e352c;background:#f5dfaa;font-family:Nunito,ui-rounded,"Arial Rounded MT Bold",system-ui,sans-serif;touch-action:manipulation;user-select:none}.market-scales *{box-sizing:border-box}.market-scales button{min-width:44px;min-height:44px;font:inherit}.market-scales button:focus-visible{outline:3px solid #3e352c;outline-offset:3px}
  .ms-bg{position:absolute;inset:0;background:linear-gradient(#fff0ca 0 57%,#c99965 57%)}.ms-bg:before{content:"";position:absolute;inset:0 0 43%;background:linear-gradient(90deg,#d57b5f22 3px,transparent 3px),linear-gradient(#d57b5f22 3px,transparent 3px);background-size:54px 42px}.ms-bg>i{position:absolute;top:13%;width:82px;height:105px;border:8px solid #fff8;border-radius:15px;background:#91bd75;box-shadow:0 8px #6b8457}.ms-bg>i:nth-child(1){left:-25px}.ms-bg>i:nth-child(2){right:-20px;background:#d97b6f}.ms-bg>i:nth-child(3){left:38%;top:8%;width:24%;height:28px;background:#f4c85e}
  .ms-stage{position:absolute;z-index:2;inset:72px 10px 32px;display:grid;grid-template-rows:auto auto minmax(255px,1fr) auto auto auto auto;gap:7px}.ms-round{display:flex;align-items:center;justify-content:space-between;padding:7px 12px;border:3px solid #fff;border-radius:15px;background:#fff9e8e8;box-shadow:0 4px #91674544}.ms-round strong{font-size:13px}.ms-round span{padding:4px 8px;border-radius:99px;color:#536d45;background:#d7efb1;font-size:9px;font-weight:1000}.ms-round span.expert{color:#fff;background:#a24e6b}.ms-hint{min-height:26px;text-align:center;color:#76583c;font-size:11px;font-weight:1000}
  .ms-scale{position:relative;align-self:center;height:250px}.ms-pivot{position:absolute;left:50%;bottom:15px;transform:translateX(-50%);width:76px;height:145px;color:#b27946;font-size:53px;text-align:center}.ms-pivot i{position:absolute;left:50%;bottom:0;transform:translateX(-50%);width:95px;height:25px;border-radius:50% 50% 8px 8px;background:#8c603f;box-shadow:0 8px #68462f}.ms-beam{position:absolute;z-index:2;left:7%;right:7%;top:66px;height:17px;border:4px solid #fff7;border-radius:99px;background:#a97143;box-shadow:0 5px #6e4931;transform:rotate(var(--tilt,0deg));transition:transform .34s cubic-bezier(.2,.9,.3,1);transform-origin:center}.ms-chain{position:absolute;top:10px;width:3px;height:80px;background:repeating-linear-gradient(#765032 0 7px,transparent 7px 12px)}.ms-chain.left{left:12%}.ms-chain.right{right:12%}.ms-pan{position:absolute;top:75px;display:flex;align-items:end;justify-content:center;gap:3px;width:41%;min-height:82px;padding:8px;border-bottom:10px solid #9d6a43;border-radius:0 0 55% 55%;background:#fff3cf99;transform:rotate(calc(var(--tilt,0deg) * -1));overflow:hidden}.ms-pan.left{left:-8%}.ms-pan.right{right:-8%}.ms-pan>span{font-size:38px;filter:drop-shadow(0 4px #7e593344)}.ms-pan .empty{font-size:40px;color:#9c8062}.ms-pan button{min-width:40px!important;min-height:40px!important;padding:3px;border:3px solid #fff;border-radius:9px;color:#fff;background:#738897;font-size:11px;font-weight:1000}.ms-pan button small{display:block;font-size:7px}
  .ms-estimate{display:flex;justify-content:space-between;align-items:center;padding:7px 13px;border-radius:13px;background:#fff7e7d9;font-size:11px}.ms-estimate strong{font-size:20px}.ms-blocks{display:grid;grid-template-columns:repeat(5,1fr);gap:6px}.ms-blocks button{padding:3px;border:3px solid #fff;border-radius:13px;color:#fff;background:linear-gradient(#7e93a0,#617783);box-shadow:0 4px #455a65;cursor:pointer}.ms-blocks strong,.ms-blocks small{display:block}.ms-blocks strong{font-size:16px}.ms-blocks small{font-size:8px}.ms-actions{display:grid;grid-template-columns:1fr 1.4fr;gap:8px}.ms-actions button{border:3px solid #fff;border-radius:14px;color:#6f573f;background:#fff9e9;box-shadow:0 4px #9c7350;font-weight:1000;cursor:pointer}.ms-actions .primary{color:#fff;background:#6fab68;box-shadow:0 4px #4a7d48}.ms-status{min-height:23px;text-align:center;font-size:11px;font-weight:1000}.ms-status.perfect{color:#397c45}.ms-status.close{color:#a96920}.ms-status.miss{color:#a74755}
  .ms-keys{position:absolute;z-index:3;left:5px;right:5px;bottom:max(5px,env(safe-area-inset-bottom));margin:0;text-align:center;color:#604b39;font-size:8px;font-weight:900}.ms-countdown{position:absolute;z-index:45;left:50%;top:43%;transform:translate(-50%,-50%);display:grid;place-items:center;width:108px;height:108px;border:6px solid #fff;border-radius:50%;color:#fff;background:#a55d70;box-shadow:0 12px 30px #57324866;font-size:46px;font-weight:1000}.ms-countdown[hidden],.ms-panel[hidden]{display:none}
  .market-scales[data-ak-reduced="true"] .ms-beam{transition:none}.market-scales[data-ak-reduced="true"] *{animation-duration:.001ms!important}@media(prefers-reduced-motion:reduce){.market-scales *{animation-duration:.001ms!important;transition-duration:.001ms!important}}@media(max-height:700px){.market-scales{min-height:500px}.ms-stage{inset:65px 8px 26px;grid-template-rows:auto auto minmax(190px,1fr) auto auto auto auto}.ms-scale{height:190px}.ms-beam{top:47px}.ms-chain{height:58px}.ms-pan{top:54px;min-height:66px}.ms-pivot{height:112px}.ms-pan>span{font-size:30px}}
`;
