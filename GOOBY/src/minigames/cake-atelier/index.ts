/**
 * Gooby Cake Atelier — the complete specialist build.
 *
 * A 2.5D bakery counter: three bunny customers queue up with escalating
 * cake orders (flavor, one-to-three layers, a frosting style, and two-to-four
 * original toppings). Each order walks batter → stop-needle bake → drag-stack
 * → held-swipe frosting (≥90% coverage) → decoration placement → serve, and
 * scores quality + speed + combo. A free-decorate sandbox bakes without
 * scores or rewards. The shared Arcade Kit provides the HUD, tutorial,
 * pause gate, and result screen; the curated `food.cake` hero renders
 * through a leak-neutral Stage3D lease during serve celebrations.
 */
import type {
  MinigameContext,
  MinigameManifest,
  MinigameModule,
  MinigamePayout,
  MinigameRunId,
  MinigameSettlementReceipt,
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
  acquireArcadeKitStyles,
  type ArcadeHud,
  type ResultScreen,
  type TutorialOverlay,
} from "../shared";
import type { MinigameStubDefinition } from "../stub";
import { createCakeHeroShowcase, type CakeHeroShowcase } from "./hero3d";
import {
  AtelierSession,
  CAKE_FLAVORS,
  CUSTOMER_NAMES,
  DECORATION_CUES,
  DECORATION_KINDS,
  FLAVOR_CUES,
  FROSTING_STYLES,
  FROSTING_CUES,
  FROST_REQUIRED_COVERAGE,
  type CakeFlavor,
  type DecorationKind,
  type FrostingStyle,
  type StepFeedback,
} from "./logic";
import { drawAtelier, type CakeGeometry } from "./view";

export const manifest: MinigameManifest = validateMinigameManifest({
  id: "cake-atelier",
  title: localizedText((catalog) => catalog.minigames["cake-atelier"].title),
  instructions: localizedText((catalog) => catalog.minigames["cake-atelier"].instructions),
  icon: EN_CATALOG.minigames["cake-atelier"].icon,
  category: "skill",
  stage3d: false,
  unlockLevel: 1,
  audioCues: ["countdown", "go", "hit", "miss", "combo", "score", "win"],
  tutorial: [
    {
      icon: "🧾",
      title: { en: "Read the ticket", de: "Lies die Bestellkarte" },
      body: {
        en: "Each bunny orders a batter, one to three layers, a frosting, and toppings. The ticket lists everything.",
        de: "Jede Kundschaft bestellt einen Teig, ein bis drei Schichten, eine Glasur und Toppings. Die Karte zeigt alles.",
      },
    },
    {
      icon: "⏲",
      title: { en: "Bake fluffy layers", de: "Backe fluffige Schichten" },
      body: {
        en: "Stop the oven needle inside the notched zone for perfect fluff — once for every layer.",
        de: "Stoppe die Ofennadel in der markierten Zone für perfekten Fluff — einmal pro Schicht.",
      },
    },
    {
      icon: "🎂",
      title: { en: "Stack, then frost", de: "Stapeln, dann glasieren" },
      body: {
        en: "Drag each layer over the plate and release. Then hold and swipe to frost at least 90% of the cake.",
        de: "Ziehe jede Schicht über den Teller und lass los. Halte danach gedrückt und streiche, bis mindestens 90 % glasiert sind.",
      },
    },
    {
      icon: "✦",
      title: { en: "Decorate and serve", de: "Dekoriere und serviere" },
      body: {
        en: "Place every ordered topping and serve quickly. Great steps chain a combo for bonus points.",
        de: "Setze alle bestellten Toppings und serviere zügig. Starke Schritte bauen eine Combo für Bonuspunkte auf.",
      },
    },
  ],
});

export const definition: MinigameStubDefinition = {
  id: manifest.id,
  title: manifest.title.en,
  instructions: manifest.instructions.en,
};

type LocalizedCopy = { readonly en: string; readonly de: string };

const COPY = {
  menuKicker: { en: "Choose your shift", de: "Wähle deine Schicht" },
  takeOrders: { en: "Take orders", de: "Bestellungen backen" },
  takeOrdersNote: { en: "3 customers · scored", de: "3 Kundschaft · mit Punkten" },
  freeBake: { en: "Free decorate", de: "Frei dekorieren" },
  freeBakeNote: { en: "Sandbox · no rewards", de: "Sandbox · keine Belohnung" },
  howToPlay: { en: "How to play", de: "So wird gespielt" },
  flavorHint: { en: "Pick the batter the ticket asks for", de: "Wähle den Teig von der Bestellkarte" },
  flavorHintSandbox: { en: "Pick any batter you like", de: "Wähle irgendeinen Teig" },
  bakeHint: { en: "Stop the needle in the notched fluff zone", de: "Stoppe die Nadel in der markierten Fluff-Zone" },
  stackHint: { en: "Drag the layer over the plate and release — or use ← → and Space", de: "Ziehe die Schicht über den Teller und lass los — oder nutze ← → und die Leertaste" },
  frostPickHint: { en: "Load the piping bag the ticket asks for", de: "Wähle den Spritzbeutel von der Bestellkarte" },
  frostHint: { en: "Hold and swipe across the cake — cover at least 90%", de: "Halte gedrückt und streiche über die Torte — mindestens 90 % bedecken" },
  decorateHint: { en: "Place every ordered topping, then serve", de: "Setze alle bestellten Toppings, dann servieren" },
  sandboxDecorateHint: { en: "Decorate freely, then show it off", de: "Dekoriere frei und präsentiere dein Werk" },
  stopNeedle: { en: "Stop the needle", de: "Nadel stoppen" },
  dropLayer: { en: "Drop layer", de: "Schicht fallen lassen" },
  doneFrosting: { en: "Done frosting", de: "Glasur fertig" },
  serveCake: { en: "Serve the cake", de: "Torte servieren" },
  showOff: { en: "Show it off", de: "Präsentieren" },
  nextCustomer: { en: "Next customer", de: "Nächste Kundschaft" },
  seeResults: { en: "See results", de: "Ergebnis ansehen" },
  bakeAnother: { en: "Bake another", de: "Noch eine backen" },
  backToMenu: { en: "Back to menu", de: "Zurück zum Menü" },
  orderServed: { en: "Order served!", de: "Bestellung serviert!" },
  showpiece: { en: "Atelier showpiece", de: "Atelier-Schaustück" },
  heroCaption: { en: "Fresh from the atelier oven", de: "Frisch aus dem Atelier-Ofen" },
  perfectFluff: { en: "Perfect fluff!", de: "Perfekter Fluff!" },
  goodFluff: { en: "Nice bake", de: "Gut gebacken" },
  flatBake: { en: "A little flat…", de: "Etwas flach…" },
  wrongFlavor: { en: "That is not the ordered batter", de: "Das ist nicht der bestellte Teig" },
  perfectDrop: { en: "Perfect drop!", de: "Perfekt gestapelt!" },
  goodDrop: { en: "Solid stack", de: "Stabil gestapelt" },
  sloppyDrop: { en: "It slid…", de: "Verrutscht…" },
  wrongFrosting: { en: "The ticket asks for a different frosting", de: "Die Karte verlangt eine andere Glasur" },
  coverageReady: { en: "Coverage reached — finish frosting!", de: "Abdeckung erreicht — Glasur abschließen!" },
  wrongTopping: { en: "That topping was not ordered", de: "Dieses Topping war nicht bestellt" },
  toppingPlaced: { en: "Topping placed", de: "Topping gesetzt" },
  alreadyPlaced: { en: "That topping is already on the cake", de: "Dieses Topping liegt schon auf der Torte" },
  leftUnpaid: { en: "Left unpaid — no rewards collected", de: "Ohne Belohnung verlassen — nichts gesammelt" },
  quality: { en: "Quality", de: "Qualität" },
  speed: { en: "Speed", de: "Tempo" },
  combo: { en: "Combo", de: "Combo" },
  coverage: { en: "Coverage", de: "Abdeckung" },
  flavorLabel: { en: "Flavor", de: "Geschmack" },
  layersLabel: { en: "Layers", de: "Schichten" },
  frostingLabel: { en: "Frosting", de: "Glasur" },
  toppingsLabel: { en: "Toppings", de: "Toppings" },
  freeBakeChip: { en: "Free bake", de: "Freies Backen" },
  customersServed: { en: "customers served", de: "Kundschaft bedient" },
  ordered: { en: "ordered", de: "bestellt" },
  keyboardHint: { en: "Keys: 1–6 select · ← → move · Space act · P pause", de: "Tasten: 1–6 wählen · ← → bewegen · Leertaste aktion · P Pause" },
} as const satisfies Readonly<Record<string, LocalizedCopy>>;

type CopyKey = keyof typeof COPY;

function copy(key: CopyKey): string {
  return pickLocalized(COPY[key]);
}

type ModulePhase =
  | "boot"
  | "tutorial"
  | "menu"
  | "countdown"
  | "playing"
  | "paused"
  | "interstitial"
  | "result"
  | "disposed";

type InterstitialKind = "next" | "results" | "sandbox";

type SoundAction = "hit" | "miss" | "combo" | "countdown" | "go" | "win" | "lose" | "score";

type AtelierContext = MinigameContext & {
  readonly audio?: { emit(action: SoundAction, value?: number): void };
  readonly haptics?: { impact(pattern: HapticPattern): void };
  readonly bestScore?: number;
  readonly reducedMotion?: boolean;
};

const EMPTY_PAYOUT: MinigamePayout = { score: 0, coins: 0, xp: 0 };
const MAX_FRAME_SECONDS = 0.1;
const KEY_NUDGE_PER_SECOND = 0.7;
const KEY_NOZZLE_PER_SECOND = 0.6;

export class CakeAtelierGame implements MinigameModule {
  readonly id = manifest.id;

  private context: AtelierContext | null = null;
  private root: HTMLElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private canvas2d: CanvasRenderingContext2D | null = null;
  private hud: ArcadeHud | null = null;
  private tutorial: TutorialOverlay | null = null;
  private result: ResultScreen | null = null;
  private hero: CakeHeroShowcase | null = null;
  private releaseKitStyles: (() => void) | null = null;
  private readonly pauseGate = new PauseGate();
  private readonly cleanup: Array<() => void> = [];

  private phase: ModulePhase = "boot";
  private pausedFrom: Exclude<ModulePhase, "paused"> | null = null;
  private session: AtelierSession | null = null;
  private mode: "orders" | "sandbox" | null = null;
  private countdown: ArcadeCountdown | null = null;
  private runId: MinigameRunId | null = null;
  private receipt: MinigameSettlementReceipt | null = null;
  private settledPayout: MinigamePayout | null = null;
  private best = 0;
  private lastServed: { readonly stars: number; readonly points: number; readonly quality: number; readonly speed: number; readonly combo: number } | null = null;

  private geometry: CakeGeometry | null = null;
  private wobblePhase = 0;
  private renderedControlsFor = "";
  private activePointer: number | null = null;
  private frostStrokeX: number | null = null;
  private heldAxisX = 0;
  private heldAxisY = 0;
  private readonly heldKeys = new Set<string>();
  private selectedTopping: DecorationKind | null = null;
  private ghostX = 0.5;
  private ghostY = 0.5;
  private wasCoverageReady = false;
  private celebrationSeconds = 0;

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
    const shared = context as AtelierContext;
    this.context = shared;
    this.best = shared.lifecycle?.persistedBest ?? shared.bestScore ?? 0;
    const document = context.mount.ownerDocument;
    this.releaseKitStyles = acquireArcadeKitStyles(document);

    const root = document.createElement("section");
    root.className = "cake-atelier";
    root.dataset.minigame = this.id;
    root.tabIndex = 0;
    root.setAttribute("aria-label", this.title);
    if (this.reducedMotion) root.dataset.akReduced = "true";
    root.innerHTML = `
      <style>${ATELIER_CSS}</style>
      <div class="ca-scene">
        <div class="ca-queue" data-ca="queue"></div>
        <div class="ca-ticket" data-ca="ticket" hidden></div>
        <div class="ca-canvas-wrap">
          <canvas class="ca-canvas" data-ca="canvas"></canvas>
          <div class="ca-countdown" data-ca="countdown" hidden aria-hidden="true"></div>
        </div>
        <div class="ca-status" role="status" aria-live="polite" data-ca="status"></div>
        <div class="ca-controls" data-ca="controls"></div>
      </div>
      <div class="ak-overlay ca-panel" data-ca="panel" role="dialog" aria-modal="true" hidden></div>
    `;
    context.mount.replaceChildren(root);
    this.root = root;

    this.canvas = root.querySelector<HTMLCanvasElement>("[data-ca='canvas']");
    this.canvas2d = this.canvas?.getContext("2d") ?? null;

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
        this.showMenu();
      },
      onExitWithoutReward: () => {
        this.exitUnpaid();
      },
    });
    this.result = createResultScreen({
      host: root,
      reducedMotion: this.reducedMotion,
      hooks: {
        onCollect: () => {
          this.showMenu();
        },
        onPlayAgain: () => {
          this.startOrders();
        },
      },
    });

    this.listen(root, "click", (event) => {
      this.onClick(event);
    });
    this.listen(root, "keydown", (event) => {
      this.onKeyDown(event);
    });
    this.listen(root, "keyup", (event) => {
      this.onKeyUp(event);
    });
    if (this.canvas) {
      this.listen(this.canvas, "pointerdown", (event) => {
        this.onPointerDown(event);
      });
      this.listen(this.canvas, "pointermove", (event) => {
        this.onPointerMove(event);
      });
      this.listen(this.canvas, "pointerup", (event) => {
        this.onPointerEnd(event);
      });
      this.listen(this.canvas, "pointercancel", (event) => {
        this.onPointerEnd(event);
      });
    }
    const view = document.defaultView;
    if (view) {
      const onBlur = (): void => {
        this.clearHeldInput();
      };
      const onResize = (): void => {
        this.resizeCanvas();
      };
      view.addEventListener("blur", onBlur);
      view.addEventListener("resize", onResize);
      this.cleanup.push(() => {
        view.removeEventListener("blur", onBlur);
        view.removeEventListener("resize", onResize);
      });
      const onVisibility = (): void => {
        if (document.visibilityState === "hidden") this.clearHeldInput();
      };
      document.addEventListener("visibilitychange", onVisibility);
      this.cleanup.push(() => {
        document.removeEventListener("visibilitychange", onVisibility);
      });
    }

    this.phase = "tutorial";
    this.resizeCanvas();
    this.renderQueue();
    this.drawFrame();
  }

  start(): void {
    if (!this.root || this.phase !== "tutorial") return;
    this.tutorial?.open();
  }

  pause(): void {
    if (this.phase !== "playing" && this.phase !== "countdown") return;
    this.pausedFrom = this.phase;
    this.phase = "paused";
    this.pauseGate.pause();
    this.clearHeldInput();
    this.hero?.setPaused(true);
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
    if (!this.context || !this.root) return;
    const clamped = Math.min(
      MAX_FRAME_SECONDS,
      Math.max(0, Number.isFinite(deltaSeconds) ? deltaSeconds : 0),
    );
    const dt = this.pauseGate.filter(clamped);
    if (this.phase === "countdown") {
      this.countdown?.update(dt);
      this.drawFrame();
      return;
    }
    if (this.phase === "interstitial") {
      this.wobblePhase += dt;
      return;
    }
    if (this.phase !== "playing" || !this.session) return;

    this.session.update(dt);
    this.wobblePhase += dt;
    if (this.celebrationSeconds > 0) this.celebrationSeconds -= dt;
    this.applyHeldKeys(dt);
    this.updateHud();
    this.updateLiveControls();
    this.drawFrame();
  }

  payout(): MinigamePayout {
    return this.settledPayout ?? EMPTY_PAYOUT;
  }

  dispose(): void {
    if (this.phase === "disposed") return;
    this.phase = "disposed";
    this.context?.lifecycle?.exit();
    for (const remove of this.cleanup.splice(0)) remove();
    this.hero?.dispose();
    this.hero = null;
    this.hud?.dispose();
    this.hud = null;
    this.tutorial?.dispose();
    this.tutorial = null;
    this.result?.dispose();
    this.result = null;
    this.root?.remove();
    this.root = null;
    this.canvas = null;
    this.canvas2d = null;
    this.releaseKitStyles?.();
    this.releaseKitStyles = null;
    this.pauseGate.dispose();
    this.session = null;
    this.countdown = null;
    this.context = null;
    this.runId = null;
  }

  /* ---------------------------------------------------------------- */
  /* Flow                                                              */
  /* ---------------------------------------------------------------- */

  private showMenu(): void {
    this.phase = "menu";
    this.session = null;
    this.mode = null;
    this.countdown = null;
    this.lastServed = null;
    this.renderedControlsFor = "";
    this.hud?.setTimer(0);
    this.hud?.setCombo(0);
    this.hud?.setScore(0);
    this.hud?.setBest(this.best);
    this.renderQueue();
    this.renderTicket();
    this.setControls("");
    const panel = this.query("[data-ca='panel']");
    if (!panel) return;
    panel.hidden = false;
    panel.innerHTML = `
      <div class="ak-card">
        <span class="ak-kicker">${copy("menuKicker")}</span>
        <div class="ak-card-icon" aria-hidden="true">🍰</div>
        <h2>${this.title}</h2>
        <button class="ak-button ak-button-primary" data-ca-action="mode-orders">
          ${copy("takeOrders")}<small class="ca-note">${copy("takeOrdersNote")}</small>
        </button>
        <button class="ak-button ak-button-secondary" data-ca-action="mode-sandbox">
          ${copy("freeBake")}<small class="ca-note">${copy("freeBakeNote")}</small>
        </button>
        <button class="ak-button ak-button-quiet" data-ca-action="replay-tutorial">${copy("howToPlay")}</button>
      </div>
    `;
    panel.querySelector<HTMLButtonElement>("[data-ca-action='mode-orders']")?.focus();
  }

  private startOrders(): void {
    const context = this.context;
    if (!context) return;
    this.result?.close();
    this.session = new AtelierSession(context.rng);
    this.mode = "orders";
    this.receipt = null;
    this.settledPayout = null;
    this.lastServed = null;
    this.runId = context.lifecycle?.beginRun() ?? null;
    this.best = context.lifecycle?.persistedBest ?? this.best;
    this.hud?.setBest(this.best);
    this.hud?.setScore(0);
    this.hud?.setCombo(0);
    this.hidePanel();
    this.resetOrderUi();
    this.renderQueue();
    this.renderTicket();
    this.phase = "countdown";
    this.pauseGate.resume();
    this.countdown = new ArcadeCountdown({
      seconds: 3,
      feedback: (event) => {
        const badge = this.query("[data-ca='countdown']");
        if (event.kind === "tick") {
          this.emitFeedback("countdown");
          if (badge) {
            badge.hidden = false;
            badge.textContent = String(event.value);
          }
          this.announce(`${activeCatalog().strings.minigameCommon.ready} ${event.value}`);
        } else {
          this.emitFeedback("go", undefined, "success");
          if (badge) {
            badge.textContent = activeCatalog().strings.minigameCommon.go;
          }
          this.beginPlaying();
        }
      },
    });
    this.countdown.start();
    this.root?.focus();
  }

  private startSandbox(): void {
    const context = this.context;
    if (!context) return;
    this.session = new AtelierSession(context.rng, { sandbox: true });
    this.mode = "sandbox";
    this.lastServed = null;
    this.hidePanel();
    this.resetOrderUi();
    this.renderQueue();
    this.renderTicket();
    this.phase = "playing";
    this.pauseGate.resume();
    this.emitFeedback("go", undefined, "light");
    this.announce(copy("freeBakeNote"));
    this.renderControls();
    this.root?.focus();
  }

  private beginPlaying(): void {
    this.phase = "playing";
    const badge = this.query("[data-ca='countdown']");
    if (badge) {
      // The GO flash stays visible for the first beat, then hides itself on
      // the next control render.
      badge.hidden = this.reducedMotion;
    }
    this.renderControls();
    this.root?.focus();
  }

  private resetOrderUi(): void {
    this.renderedControlsFor = "";
    this.selectedTopping = null;
    this.ghostX = 0.5;
    this.ghostY = 0.5;
    this.wasCoverageReady = false;
    this.frostStrokeX = null;
    this.activePointer = null;
    this.celebrationSeconds = 0;
  }

  private exitUnpaid(): void {
    this.context?.lifecycle?.exit();
    this.runId = null;
    this.session = null;
    this.announce(copy("leftUnpaid"));
    this.showMenu();
  }

  private settleShift(): void {
    const session = this.session;
    const context = this.context;
    if (!session || !context || this.settledPayout) return;
    const payout = session.payout();
    this.settledPayout = payout;
    if (context.lifecycle && this.runId !== null) {
      this.receipt = context.lifecycle.completeRun(this.runId, payout);
      this.best = this.receipt.bestScore;
      this.runId = null;
    } else {
      this.best = Math.max(this.best, payout.score);
      context.finish(payout);
    }
    this.hud?.setBest(this.best);
    this.emitFeedback("win", payout.score, "success");
  }

  private showResultScreen(quitEarly: boolean): void {
    const session = this.session;
    const payout = this.settledPayout ?? EMPTY_PAYOUT;
    this.phase = "result";
    this.hidePanel();
    const served = session?.results.length ?? 0;
    const detail = `${served}/3 ${copy("customersServed")} · ${activeCatalog().strings.minigameCommon.streak} ${session?.bestCombo ?? 0}×`;
    this.result?.show({
      score: payout.score,
      best: this.best,
      newBest: payout.score > 0 && payout.score >= this.best,
      quitEarly,
      detail,
    });
  }

  private showInterstitial(kind: InterstitialKind): void {
    this.phase = "interstitial";
    const panel = this.query("[data-ca='panel']");
    if (!panel) return;
    const served = this.lastServed;
    const stars = served ? "★".repeat(served.stars) + "☆".repeat(3 - served.stars) : "★★★";
    const heading = kind === "sandbox" ? copy("showpiece") : copy("orderServed");
    const breakdown = served && kind !== "sandbox"
      ? `<p class="ca-breakdown">${copy("quality")} <b>${served.quality}</b> · ${copy("speed")} <b>${served.speed}</b> · ${copy("combo")} <b>${served.combo}</b></p>`
      : `<p class="ca-breakdown">${copy("freeBakeNote")}</p>`;
    const actionLabel = kind === "next"
      ? copy("nextCustomer")
      : kind === "results"
        ? copy("seeResults")
        : copy("bakeAnother");
    panel.hidden = false;
    panel.innerHTML = `
      <div class="ak-card">
        <span class="ak-kicker">${heading}</span>
        <div class="ca-stars" aria-label="${served?.stars ?? 3} / 3">${stars}</div>
        ${served && kind !== "sandbox" ? `<div class="ak-result-score">+${served.points.toLocaleString()}</div>` : ""}
        ${breakdown}
        <div class="ca-hero" data-ca="hero"></div>
        <small class="ca-hero-caption">${copy("heroCaption")}</small>
        <button class="ak-button ak-button-primary" data-ca-action="interstitial-${kind}">${actionLabel}</button>
        ${kind === "sandbox" ? `<button class="ak-button ak-button-quiet" data-ca-action="sandbox-exit">${activeCatalog().strings.minigameCommon.quitNoReward}</button>` : ""}
      </div>
    `;
    this.mountHero(panel.querySelector<HTMLElement>("[data-ca='hero']"));
    panel.querySelector<HTMLButtonElement>(`[data-ca-action='interstitial-${kind}']`)?.focus();
  }

  private mountHero(heroHost: HTMLElement | null): void {
    const context = this.context;
    if (!heroHost || !context) return;
    if (!this.hero) {
      this.hero = createCakeHeroShowcase({
        mount: heroHost,
        clock: context.clock,
        reducedMotion: this.reducedMotion,
      });
      try {
        this.hero.show();
      } catch {
        // A Stage3D lease can be unavailable (no WebGL in the environment or
        // another lease still active). The showcase is decorative: fall back
        // to a flat emoji hero instead of failing the round flow.
        heroHost.classList.add("ca-hero-fallback");
        heroHost.textContent = "🎂";
      }
    } else {
      // Re-parent the lease canvas into the freshly rendered card.
      const existing = this.heroCanvas();
      if (existing) heroHost.append(existing);
      else {
        heroHost.classList.add("ca-hero-fallback");
        heroHost.textContent = "🎂";
      }
    }
    this.hero?.setPaused(false);
  }

  private heroCanvas(): HTMLCanvasElement | null {
    if (!this.hero?.active) return null;
    // The lease canvas keeps living between interstitials; find it wherever
    // the previous card left it.
    return this.root?.ownerDocument.querySelector<HTMLCanvasElement>(".ca-hero canvas")
      ?? this.detachedHeroCanvas;
  }

  private detachedHeroCanvas: HTMLCanvasElement | null = null;

  private hidePanel(): void {
    const panel = this.query("[data-ca='panel']");
    if (!panel) return;
    const heroCanvas = panel.querySelector<HTMLCanvasElement>(".ca-hero canvas");
    if (heroCanvas) this.detachedHeroCanvas = heroCanvas;
    this.hero?.setPaused(true);
    panel.hidden = true;
    panel.replaceChildren();
  }

  private showPausePanel(): void {
    const panel = this.query("[data-ca='panel']");
    if (!panel || !this.session) return;
    const strings = activeCatalog().strings.minigameCommon;
    const quitLabel = this.mode === "orders" && this.session.actions > 0
      ? strings.finishAndCollect
      : strings.quitNoReward;
    panel.hidden = false;
    panel.innerHTML = `
      <div class="ak-card">
        <span class="ak-kicker">${strings.paused}</span>
        <div class="ak-card-icon" aria-hidden="true">🍰</div>
        <h2>${strings.paused}</h2>
        <button class="ak-button ak-button-primary" data-ca-action="resume">${strings.resume}</button>
        ${this.mode === "orders" ? `<button class="ak-button ak-button-secondary" data-ca-action="restart">${strings.restart}</button>` : ""}
        <button class="ak-button ak-button-quiet" data-ca-action="quit">${quitLabel}</button>
      </div>
    `;
    panel.querySelector<HTMLButtonElement>("[data-ca-action='resume']")?.focus();
  }

  private handleQuitFromPause(): void {
    const session = this.session;
    if (!session) {
      this.exitUnpaid();
      return;
    }
    if (this.mode === "sandbox" || session.actions === 0) {
      this.pauseGate.resume();
      this.exitUnpaid();
      return;
    }
    // Finish & collect: settle whatever orders are already served.
    this.pauseGate.resume();
    this.settleShift();
    this.showResultScreen(true);
  }

  /* ---------------------------------------------------------------- */
  /* Gameplay input                                                    */
  /* ---------------------------------------------------------------- */

  private onClick(event: MouseEvent): void {
    const target = event.target instanceof Element
      ? event.target.closest<HTMLElement>("[data-ca-action]")
      : null;
    if (!target) return;
    const action = target.dataset.caAction ?? "";
    switch (action) {
      case "mode-orders":
        this.startOrders();
        break;
      case "mode-sandbox":
        this.startSandbox();
        break;
      case "replay-tutorial":
        this.hidePanel();
        this.phase = "tutorial";
        this.tutorial?.open();
        break;
      case "resume":
        this.resume();
        break;
      case "restart":
        this.pauseGate.resume();
        this.startOrders();
        break;
      case "quit":
        this.handleQuitFromPause();
        break;
      case "sandbox-exit":
        this.exitUnpaid();
        break;
      case "interstitial-next":
        this.continueAfterServe();
        break;
      case "interstitial-results":
        this.settleShift();
        this.showResultScreen(false);
        break;
      case "interstitial-sandbox":
        this.restartSandbox();
        break;
      case "stop-needle":
        this.handleStopNeedle();
        break;
      case "drop-layer":
        this.handleDrop();
        break;
      case "done-frosting":
        this.handleFinishFrosting();
        break;
      case "serve":
        this.handleServe();
        break;
      default:
        if (action.startsWith("flavor:")) this.handleFlavor(action.slice(7) as CakeFlavor);
        else if (action.startsWith("frosting:")) this.handleFrostingPick(action.slice(9) as FrostingStyle);
        else if (action.startsWith("topping:")) this.handleToppingSelect(action.slice(8) as DecorationKind);
        break;
    }
  }

  private onKeyDown(event: KeyboardEvent): void {
    const key = event.key;
    const lower = key.toLowerCase();
    if (lower === "p" || key === "Escape") {
      if (this.phase === "playing" || this.phase === "countdown") {
        event.preventDefault();
        this.pause();
        return;
      }
      if (this.phase === "paused") {
        event.preventDefault();
        this.resume();
        return;
      }
      return;
    }
    if (this.phase !== "playing" || !this.session) return;
    const target = event.target;
    const targetIsControl = target instanceof Element && target.closest("button") !== null;
    if (key === "ArrowLeft" || key === "ArrowRight" || key === "ArrowUp" || key === "ArrowDown") {
      event.preventDefault();
      this.heldKeys.add(key);
      this.recomputeHeldAxis();
      return;
    }
    if ((key === " " || key === "Enter") && !targetIsControl) {
      event.preventDefault();
      if (event.repeat) return;
      this.primaryAction();
      return;
    }
    if (/^[1-6]$/u.test(key) && !event.repeat) {
      event.preventDefault();
      this.digitShortcut(Number(key) - 1);
    }
  }

  private onKeyUp(event: KeyboardEvent): void {
    if (this.heldKeys.delete(event.key)) this.recomputeHeldAxis();
  }

  private recomputeHeldAxis(): void {
    this.heldAxisX = (this.heldKeys.has("ArrowRight") ? 1 : 0) - (this.heldKeys.has("ArrowLeft") ? 1 : 0);
    this.heldAxisY = (this.heldKeys.has("ArrowDown") ? 1 : 0) - (this.heldKeys.has("ArrowUp") ? 1 : 0);
  }

  private clearHeldInput(): void {
    this.heldKeys.clear();
    this.heldAxisX = 0;
    this.heldAxisY = 0;
    this.activePointer = null;
    this.frostStrokeX = null;
    const session = this.session;
    if (session?.phase === "stack" && session.swingingLayer?.held) {
      // Losing focus mid-drag releases the layer where it was.
      this.handleDrop();
    }
  }

  private applyHeldKeys(dt: number): void {
    const session = this.session;
    if (!session || dt <= 0) return;
    if (session.phase === "stack" && this.heldAxisX !== 0) {
      const layer = session.swingingLayer;
      if (layer) {
        if (!layer.held) session.grabLayer();
        session.moveLayer(layer.x + this.heldAxisX * KEY_NUDGE_PER_SECOND * dt);
      }
    } else if (session.phase === "frost" && session.frostStyle !== null && this.heldAxisX !== 0) {
      const from = session.nozzlePosition;
      const to = Math.max(0, Math.min(1, from + this.heldAxisX * KEY_NOZZLE_PER_SECOND * dt));
      const feedback = session.frostSweep(from, to);
      this.afterFrostSweep(feedback);
    } else if (session.phase === "decorate" && (this.heldAxisX !== 0 || this.heldAxisY !== 0)) {
      this.ghostX = Math.max(0, Math.min(1, this.ghostX + this.heldAxisX * dt * 0.9));
      this.ghostY = Math.max(0, Math.min(1, this.ghostY + this.heldAxisY * dt * 0.9));
    }
  }

  private primaryAction(): void {
    const session = this.session;
    if (!session) return;
    switch (session.phase) {
      case "bake":
        this.handleStopNeedle();
        break;
      case "stack":
        this.handleDrop();
        break;
      case "frost":
        this.handleFinishFrosting();
        break;
      case "decorate":
        if (this.selectedTopping) {
          this.placeTopping(this.selectedTopping, this.ghostX, this.ghostY);
        } else if (session.serveReady) {
          this.handleServe();
        }
        break;
      default:
        break;
    }
  }

  private digitShortcut(index: number): void {
    const session = this.session;
    if (!session) return;
    if (session.phase === "flavor") {
      const flavor = CAKE_FLAVORS[index];
      if (flavor) this.handleFlavor(flavor);
      return;
    }
    if (session.phase === "frost" && session.frostStyle === null) {
      const style = FROSTING_STYLES[index];
      if (style) this.handleFrostingPick(style);
      return;
    }
    if (session.phase === "decorate") {
      const kind = DECORATION_KINDS[index];
      if (kind) this.handleToppingSelect(kind);
    }
  }

  private onPointerDown(event: PointerEvent): void {
    if (this.phase !== "playing" || !this.session || this.activePointer !== null) return;
    this.activePointer = event.pointerId;
    try {
      this.canvas?.setPointerCapture?.(event.pointerId);
    } catch {
      // Synthetic pointers may not support capture; drags still work.
    }
    const session = this.session;
    const point = this.canvasPoint(event);
    if (session.phase === "bake") {
      this.handleStopNeedle();
      return;
    }
    if (session.phase === "stack") {
      if (session.grabLayer()) session.moveLayer(point.x);
      return;
    }
    if (session.phase === "frost" && session.frostStyle !== null) {
      const faceX = this.faceX(point.px);
      this.frostStrokeX = faceX;
      this.afterFrostSweep(session.frostSweep(faceX, faceX));
      return;
    }
    if (session.phase === "decorate" && this.selectedTopping) {
      const top = this.topPoint(point.px, point.py);
      this.placeTopping(this.selectedTopping, top.x, top.y);
    }
  }

  private onPointerMove(event: PointerEvent): void {
    if (event.pointerId !== this.activePointer || !this.session) return;
    const session = this.session;
    const point = this.canvasPoint(event);
    if (session.phase === "stack" && session.swingingLayer?.held) {
      session.moveLayer(point.x);
      return;
    }
    if (session.phase === "frost" && this.frostStrokeX !== null) {
      const faceX = this.faceX(point.px);
      this.afterFrostSweep(session.frostSweep(this.frostStrokeX, faceX));
      this.frostStrokeX = faceX;
    }
  }

  private onPointerEnd(event: PointerEvent): void {
    if (event.pointerId !== this.activePointer) return;
    this.activePointer = null;
    this.frostStrokeX = null;
    const session = this.session;
    if (session?.phase === "stack" && session.swingingLayer?.held) {
      this.handleDrop();
    }
  }

  private canvasPoint(event: PointerEvent): { x: number; y: number; px: number; py: number } {
    const canvas = this.canvas;
    if (!canvas) return { x: 0.5, y: 0.5, px: 0, py: 0 };
    const rect = canvas.getBoundingClientRect();
    const px = ((event.clientX - rect.left) / Math.max(1, rect.width)) * canvas.width;
    const py = ((event.clientY - rect.top) / Math.max(1, rect.height)) * canvas.height;
    return {
      x: Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width))),
      y: Math.max(0, Math.min(1, (event.clientY - rect.top) / Math.max(1, rect.height))),
      px,
      py,
    };
  }

  private faceX(px: number): number {
    const geometry = this.geometry;
    if (!geometry) return 0.5;
    const span = Math.max(1, geometry.faceRight - geometry.faceLeft);
    return Math.max(0, Math.min(1, (px - geometry.faceLeft) / span));
  }

  private topPoint(px: number, py: number): { x: number; y: number } {
    const geometry = this.geometry;
    if (!geometry) return { x: 0.5, y: 0.5 };
    return {
      x: Math.max(0, Math.min(1, (px - (geometry.topCenterX - geometry.topRadiusX)) / Math.max(1, geometry.topRadiusX * 2))),
      y: Math.max(0, Math.min(1, (py - (geometry.topCenterY - geometry.topRadiusY * 1.6)) / Math.max(1, geometry.topRadiusY * 3.2))),
    };
  }

  /* ---------------------------------------------------------------- */
  /* Step handlers                                                     */
  /* ---------------------------------------------------------------- */

  private handleFlavor(flavor: CakeFlavor): void {
    const session = this.sessionInPhase("flavor");
    if (!session) return;
    const feedback = session.selectFlavor(flavor);
    if (feedback.kind !== "flavor") return;
    if (feedback.correct) {
      this.emitFeedback("hit", undefined, "light");
      this.announce(pickLocalized(FLAVOR_CUES[flavor].label));
    } else {
      this.emitFeedback("miss", undefined, "warning");
      this.announce(copy("wrongFlavor"));
    }
    this.renderTicket();
    this.renderControls();
  }

  private handleStopNeedle(): void {
    const session = this.sessionInPhase("bake");
    if (!session) return;
    const feedback = session.stopNeedle();
    if (feedback.kind !== "bake") return;
    const percent = Math.round(feedback.quality * 100);
    if (feedback.quality >= 0.99) this.announce(`${copy("perfectFluff")} ${percent}%`);
    else if (feedback.quality >= 0.6) this.announce(`${copy("goodFluff")} · ${percent}%`);
    else this.announce(`${copy("flatBake")} ${percent}%`);
    this.emitStepFeedback(feedback.quality, feedback.combo);
    this.renderTicket();
    this.renderControls();
  }

  private handleDrop(): void {
    const session = this.sessionInPhase("stack");
    if (!session || !session.swingingLayer) return;
    const feedback = session.dropLayer();
    if (feedback.kind !== "stack") return;
    const percent = Math.round(feedback.alignment * 100);
    if (feedback.alignment >= 0.99) this.announce(`${copy("perfectDrop")} ${percent}%`);
    else if (feedback.alignment >= 0.6) this.announce(`${copy("goodDrop")} · ${percent}%`);
    else this.announce(`${copy("sloppyDrop")} ${percent}%`);
    this.emitStepFeedback(feedback.alignment, feedback.combo);
    this.renderTicket();
    this.renderControls();
  }

  private handleFrostingPick(style: FrostingStyle): void {
    const session = this.sessionInPhase("frost");
    if (!session) return;
    const feedback = session.selectFrosting(style);
    if (feedback.kind !== "frost-style") return;
    if (feedback.correct) {
      this.emitFeedback("hit", undefined, "light");
      this.announce(pickLocalized(FROSTING_CUES[style].label));
    } else {
      this.emitFeedback("miss", undefined, "warning");
      this.announce(copy("wrongFrosting"));
    }
    this.renderTicket();
    this.renderControls();
  }

  private afterFrostSweep(feedback: StepFeedback): void {
    if (feedback.kind !== "frost") return;
    if (feedback.ready && !this.wasCoverageReady) {
      this.wasCoverageReady = true;
      this.emitFeedback("hit", undefined, "light");
      this.announce(copy("coverageReady"));
      this.renderControls();
    }
  }

  private handleFinishFrosting(): void {
    const session = this.sessionInPhase("frost");
    if (!session) return;
    const feedback = session.finishFrosting();
    if (feedback.kind !== "frost" || !feedback.ready) return;
    this.emitStepFeedback(feedback.coverage, session.combo);
    this.announce(`${copy("coverage")} ${Math.round(feedback.coverage * 100)}%`);
    this.selectedTopping = null;
    this.renderTicket();
    this.renderControls();
  }

  private handleToppingSelect(kind: DecorationKind): void {
    const session = this.sessionInPhase("decorate");
    if (!session) return;
    this.selectedTopping = kind;
    this.announce(pickLocalized(DECORATION_CUES[kind].label));
    this.renderControls();
  }

  private placeTopping(kind: DecorationKind, x: number, y: number): void {
    const session = this.sessionInPhase("decorate");
    if (!session) return;
    const feedback = session.placeDecoration(kind, x, y);
    if (feedback.kind !== "decorate") return;
    if (!feedback.accepted) {
      this.announce(copy("alreadyPlaced"));
      return;
    }
    const wanted = session.currentOrder.decorations.includes(kind) || session.sandbox;
    if (wanted) {
      this.emitFeedback("hit", undefined, "light");
      this.announce(`${copy("toppingPlaced")}: ${pickLocalized(DECORATION_CUES[kind].label)}`);
    } else {
      this.emitFeedback("miss", undefined, "warning");
      this.announce(copy("wrongTopping"));
    }
    this.selectedTopping = null;
    this.renderTicket();
    this.renderControls();
  }

  private handleServe(): void {
    const session = this.session;
    if (!session || session.phase !== "decorate" || !session.serveReady) return;
    const feedback = session.serve();
    if (feedback.kind !== "serve") return;
    this.emitFeedback("score", feedback.result.total, "success");
    this.announce(copy("orderServed"));
    this.lastServed = {
      stars: feedback.result.stars,
      points: feedback.result.total,
      quality: feedback.result.qualityPoints,
      speed: feedback.result.speedPoints,
      combo: feedback.result.comboPoints,
    };
    this.hud?.setScore(session.totalScore);
    this.renderQueue();
    if (this.mode === "sandbox") {
      this.showInterstitial("sandbox");
      return;
    }
    // Settlement happens when the results screen is opened (matching the
    // other specialists), so the serve celebration stays visible first.
    this.showInterstitial(session.finished ? "results" : "next");
  }

  private continueAfterServe(): void {
    this.hidePanel();
    this.resetOrderUi();
    this.phase = "playing";
    this.renderQueue();
    this.renderTicket();
    this.renderControls();
    this.root?.focus();
  }

  private restartSandbox(): void {
    const session = this.session;
    if (!session?.sandbox) return;
    session.restartSandboxCake();
    this.hidePanel();
    this.resetOrderUi();
    this.phase = "playing";
    this.renderTicket();
    this.renderControls();
    this.root?.focus();
  }

  private sessionInPhase(phase: "flavor" | "bake" | "stack" | "frost" | "decorate"): AtelierSession | null {
    const session = this.session;
    if (this.phase !== "playing" || !session || session.phase !== phase) return null;
    return session;
  }

  private emitStepFeedback(quality: number, combo: number): void {
    if (combo >= 2) {
      this.emitFeedback("combo", combo, "success");
    } else if (quality >= 0.5) {
      this.emitFeedback("hit", undefined, "light");
    } else {
      this.emitFeedback("miss", undefined, "warning");
    }
    if (quality >= 0.99) this.celebrationSeconds = 0.8;
    this.hud?.setCombo(this.session?.combo ?? 0);
  }

  private emitFeedback(action: SoundAction, value?: number, haptic?: HapticPattern): void {
    this.context?.audio?.emit(action, value);
    if (haptic) this.context?.haptics?.impact(haptic);
  }

  /* ---------------------------------------------------------------- */
  /* Rendering                                                         */
  /* ---------------------------------------------------------------- */

  private resizeCanvas(): void {
    const canvas = this.canvas;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(200, Math.floor(rect.width) || 320);
    const height = Math.max(200, Math.floor(rect.height) || 300);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
  }

  private drawFrame(): void {
    const ctx = this.canvas2d;
    const canvas = this.canvas;
    const session = this.session;
    if (!ctx || !canvas) return;
    if (!session) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }
    const stability = session.stackedLayers.length > 0
      ? session.stackedLayers.reduce((worst, layer) => Math.min(worst, layer.alignment), 1)
      : 1;
    this.geometry = drawAtelier(ctx, canvas.width, canvas.height, {
      phase: session.phase,
      flavor: session.selectedFlavor,
      orderFlavor: session.currentOrder.flavor,
      stacked: session.stackedLayers,
      totalLayers: session.currentOrder.layers,
      swinging: session.swingingLayer,
      needle: session.phase === "bake" ? session.needlePosition : 0.5,
      bakedCount: session.bakedLayerCount,
      frostStyle: session.frostStyle,
      frostCells: session.frostCells,
      coverage: session.coverage,
      nozzleX: session.nozzlePosition,
      frostingHeld: this.frostStrokeX !== null || this.heldAxisX !== 0,
      decorations: session.placedDecorations,
      ghost: session.phase === "decorate" && this.selectedTopping
        ? { kind: this.selectedTopping, x: this.ghostX, y: this.ghostY }
        : null,
      wobblePhase: this.wobblePhase,
      stability,
      reducedMotion: this.reducedMotion,
      celebrating: this.celebrationSeconds > 0,
    });
  }

  private updateHud(): void {
    const session = this.session;
    if (!session) return;
    if (this.mode === "orders") {
      this.hud?.setTimer(Math.max(0, session.currentOrder.parSeconds - session.elapsedSeconds));
    } else {
      this.hud?.setTimer(session.elapsedSeconds);
    }
  }

  private renderQueue(): void {
    const queueHost = this.query("[data-ca='queue']");
    if (!queueHost) return;
    const session = this.session;
    if (!session) {
      queueHost.replaceChildren();
      return;
    }
    if (session.sandbox) {
      queueHost.innerHTML = `<span class="ca-chip ca-chip-current">🧁 ${copy("freeBakeChip")}</span>`;
      return;
    }
    queueHost.innerHTML = session.orders
      .map((order, index) => {
        const customer = CUSTOMER_NAMES[order.customer] ?? CUSTOMER_NAMES[0];
        const name = pickLocalized({ en: customer.en, de: customer.de });
        const result = session.results[index];
        const state = result ? "done" : index === session.currentOrderIndex ? "current" : "waiting";
        const suffix = result ? ` ${"★".repeat(result.stars)}` : "";
        return `<span class="ca-chip ca-chip-${state}" data-ca-queue="${state}">${customer.glyph} ${name}${suffix}</span>`;
      })
      .join("");
  }

  private renderTicket(): void {
    const ticket = this.query("[data-ca='ticket']");
    if (!ticket) return;
    const session = this.session;
    if (!session) {
      ticket.hidden = true;
      return;
    }
    ticket.hidden = false;
    const order = session.currentOrder;
    const flavorDone = session.selectedFlavor !== null;
    const frostingDone = session.frostStyle !== null && (session.phase === "decorate" || session.phase === "serve" || session.coverageReady);
    const layerPips = Array.from({ length: order.layers }, (_, index) =>
      index < session.stackedLayers.length ? "●" : index < session.bakedLayerCount ? "◐" : "○").join(" ");
    const toppings = order.decorations
      .map((kind) => {
        const placed = session.placedDecorations.some((decoration) => decoration.kind === kind);
        return `<span class="ca-ticket-chip${placed ? " ca-done" : ""}">${placed ? "✓ " : ""}${DECORATION_CUES[kind].glyph} ${pickLocalized(DECORATION_CUES[kind].label)}</span>`;
      })
      .join("");
    ticket.innerHTML = `
      <span class="ca-ticket-chip${flavorDone ? " ca-done" : ""}"><b>${copy("flavorLabel")}</b> ${flavorDone ? "✓ " : ""}${FLAVOR_CUES[order.flavor].glyph} ${pickLocalized(FLAVOR_CUES[order.flavor].label)}</span>
      <span class="ca-ticket-chip"><b>${copy("layersLabel")}</b> ${layerPips}</span>
      <span class="ca-ticket-chip${frostingDone ? " ca-done" : ""}"><b>${copy("frostingLabel")}</b> ${frostingDone ? "✓ " : ""}${FROSTING_CUES[order.frosting].glyph} ${pickLocalized(FROSTING_CUES[order.frosting].label)}</span>
      <span class="ca-ticket-toppings"><b>${copy("toppingsLabel")}</b> ${toppings}</span>
    `;
  }

  private setControls(html: string): void {
    const controls = this.query("[data-ca='controls']");
    if (!controls) return;
    controls.innerHTML = html;
    // Re-rendering removes any focused control button, dropping focus to
    // <body> and silencing the root's key handlers. Recapture it so pointer
    // and keyboard input stay interchangeable mid-order.
    const active = controls.ownerDocument.activeElement;
    if (this.phase === "playing" && (active === null || active === controls.ownerDocument.body)) {
      this.root?.focus();
    }
  }

  private renderControls(): void {
    const session = this.session;
    if (!session) {
      this.setControls("");
      return;
    }
    const badge = this.query("[data-ca='countdown']");
    if (badge && this.phase === "playing") badge.hidden = true;
    const key = `${session.phase}:${session.frostStyle ?? ""}:${session.bakedLayerCount}:${this.selectedTopping ?? ""}:${session.placedDecorations.length}:${this.wasCoverageReady}`;
    if (key === this.renderedControlsFor) return;
    this.renderedControlsFor = key;

    if (session.phase === "flavor") {
      this.setControls(`
        <p class="ca-hint">${session.sandbox ? copy("flavorHintSandbox") : copy("flavorHint")}</p>
        <div class="ca-row">
          ${CAKE_FLAVORS.map((flavor, index) => `
            <button class="ca-option" data-ca-action="flavor:${flavor}" aria-keyshortcuts="${index + 1}">
              <i aria-hidden="true">${FLAVOR_CUES[flavor].glyph}</i><b>${pickLocalized(FLAVOR_CUES[flavor].label)}</b>
            </button>
          `).join("")}
        </div>
      `);
      return;
    }
    if (session.phase === "bake") {
      this.setControls(`
        <p class="ca-hint">${copy("bakeHint")}</p>
        <div class="ca-row">
          <button class="ca-primary" data-ca-action="stop-needle">⏱ ${copy("stopNeedle")}</button>
        </div>
      `);
      return;
    }
    if (session.phase === "stack") {
      this.setControls(`
        <p class="ca-hint">${copy("stackHint")}</p>
        <div class="ca-row">
          <button class="ca-primary" data-ca-action="drop-layer">⬇ ${copy("dropLayer")}</button>
        </div>
      `);
      return;
    }
    if (session.phase === "frost") {
      if (session.frostStyle === null) {
        this.setControls(`
          <p class="ca-hint">${copy("frostPickHint")}</p>
          <div class="ca-row">
            ${FROSTING_STYLES.map((style, index) => `
              <button class="ca-option" data-ca-action="frosting:${style}" aria-keyshortcuts="${index + 1}">
                <i aria-hidden="true">${FROSTING_CUES[style].glyph}</i><b>${pickLocalized(FROSTING_CUES[style].label)}</b>
              </button>
            `).join("")}
          </div>
        `);
      } else {
        this.setControls(`
          <p class="ca-hint">${copy("frostHint")}</p>
          <div class="ca-row ca-frost-row">
            <span class="ca-meter" data-ca="coverage-meter"><i data-ca="coverage-fill"></i></span>
            <span class="ca-meter-label" data-ca="coverage-label">0%</span>
            <button class="ca-primary" data-ca-action="done-frosting" data-ca="done-frosting" disabled>✓ ${copy("doneFrosting")}</button>
          </div>
        `);
        this.updateLiveControls();
      }
      return;
    }
    if (session.phase === "decorate") {
      const order = session.currentOrder;
      this.setControls(`
        <p class="ca-hint">${session.sandbox ? copy("sandboxDecorateHint") : copy("decorateHint")}</p>
        <div class="ca-tray">
          ${DECORATION_KINDS.map((kind, index) => {
            const wanted = order.decorations.includes(kind);
            const placed = session.placedDecorations.some((decoration) => decoration.kind === kind);
            const selected = this.selectedTopping === kind;
            return `
              <button class="ca-topping${wanted ? " ca-wanted" : ""}${selected ? " ca-selected" : ""}"
                data-ca-action="topping:${kind}" aria-keyshortcuts="${index + 1}" aria-pressed="${selected}"
                aria-label="${pickLocalized(DECORATION_CUES[kind].label)}${wanted ? ` (${copy("ordered")})` : ""}">
                <i aria-hidden="true">${DECORATION_CUES[kind].glyph}</i>
                <b>${pickLocalized(DECORATION_CUES[kind].label)}</b>
                <small>${placed ? "✓" : wanted && !session.sandbox ? copy("ordered") : "&nbsp;"}</small>
              </button>
            `;
          }).join("")}
        </div>
        <div class="ca-row">
          <button class="ca-primary" data-ca-action="serve" data-ca="serve" ${session.serveReady ? "" : "disabled"}>
            🎂 ${session.sandbox ? copy("showOff") : copy("serveCake")}
          </button>
        </div>
        <p class="ca-keys">${copy("keyboardHint")}</p>
      `);
      return;
    }
    this.setControls("");
  }

  private updateLiveControls(): void {
    const session = this.session;
    if (!session || session.phase !== "frost" || session.frostStyle === null) return;
    const fill = this.query("[data-ca='coverage-fill']");
    const label = this.query("[data-ca='coverage-label']");
    const done = this.query<HTMLButtonElement>("[data-ca='done-frosting']");
    const percent = Math.round(session.coverage * 100);
    if (fill) fill.style.width = `${percent}%`;
    if (label) label.textContent = `${percent}% / ${Math.round(FROST_REQUIRED_COVERAGE * 100)}%`;
    if (done) done.disabled = !session.coverageReady;
  }

  private announce(text: string): void {
    const status = this.query("[data-ca='status']");
    if (status && status.textContent !== text) status.textContent = text;
  }

  private query<T extends HTMLElement = HTMLElement>(selector: string): T | null {
    return this.root?.querySelector<T>(selector) ?? null;
  }

  private listen<K extends keyof HTMLElementEventMap>(
    target: HTMLElement,
    type: K,
    listener: (event: HTMLElementEventMap[K]) => void,
  ): void {
    const wrapped: EventListener = (event) => {
      listener(event as HTMLElementEventMap[K]);
    };
    target.addEventListener(type, wrapped);
    this.cleanup.push(() => {
      target.removeEventListener(type, wrapped);
    });
  }
}

export const createMinigame = (): MinigameModule => new CakeAtelierGame();

const ATELIER_CSS = `
.cake-atelier{position:absolute;inset:0;display:flex;flex-direction:column;overflow:hidden;border-radius:18px;background:linear-gradient(#ffe9f2,#ffd7e6);color:#4a3428;font-family:inherit;touch-action:manipulation;user-select:none;-webkit-user-select:none}
.cake-atelier:focus-visible{outline:3px solid #4a3428;outline-offset:-3px}
.cake-atelier *{box-sizing:border-box}
.cake-atelier button{font:inherit;cursor:pointer}
.ca-scene{display:flex;flex:1;flex-direction:column;gap:6px;min-height:0;padding:calc(64px + env(safe-area-inset-top)) 10px calc(10px + env(safe-area-inset-bottom))}
.cake-atelier .ak-hud{right:max(96px,calc(10px + env(safe-area-inset-right)))}
.ca-queue{display:flex;gap:6px;flex-wrap:wrap;min-height:26px}
.ca-chip{padding:4px 10px;border-radius:99px;background:rgba(255,255,255,.55);font-size:12px;font-weight:700}
.ca-chip-current{background:#ffd97b;box-shadow:0 0 0 2px #4a3428 inset}
.ca-chip-done{background:#c9ecd3;text-decoration:none}
.ca-chip-waiting{opacity:.65}
.ca-ticket{display:flex;flex-wrap:wrap;gap:5px;padding:8px;border-radius:12px;background:rgba(255,252,240,.85);box-shadow:0 3px 10px rgba(74,52,40,.12);font-size:12px}
.ca-ticket b{font-size:10px;letter-spacing:.06em;text-transform:uppercase;opacity:.65;margin-right:3px}
.ca-ticket-chip{display:inline-flex;align-items:center;gap:2px;padding:2px 7px;border-radius:8px;background:rgba(74,52,40,.07)}
.ca-ticket-chip.ca-done{background:#c9ecd3;text-decoration:underline}
.ca-ticket-toppings{display:inline-flex;align-items:center;flex-wrap:wrap;gap:4px}
.ca-canvas-wrap{position:relative;flex:1;min-height:180px;border-radius:14px;overflow:hidden;box-shadow:inset 0 0 0 2px rgba(74,52,40,.15)}
.ca-canvas{display:block;width:100%;height:100%;touch-action:none}
.ca-countdown{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:64px;font-weight:900;color:#4a3428;text-shadow:0 3px 0 #fff;pointer-events:none}
.ca-status{min-height:18px;font-size:13px;font-weight:700;text-align:center}
.ca-controls{display:flex;flex-direction:column;gap:6px}
.ca-hint{margin:0;font-size:12px;text-align:center;opacity:.85}
.ca-keys{margin:0;font-size:10px;text-align:center;letter-spacing:.04em;opacity:.6}
.ca-row{display:flex;gap:8px;justify-content:center;align-items:stretch}
.ca-option{display:flex;flex:1;flex-direction:column;align-items:center;gap:2px;min-height:56px;padding:7px 4px;border:2px solid rgba(74,52,40,.25);border-radius:14px;background:rgba(255,252,240,.9)}
.ca-option i{font-size:20px;font-style:normal}
.ca-option b{font-size:11px}
.ca-option:focus-visible,.ca-topping:focus-visible,.ca-primary:focus-visible{outline:3px solid #4a3428;outline-offset:2px}
.ca-primary{min-height:48px;padding:10px 18px;border:0;border-radius:14px;background:#f0a558;color:#3d2417;font-size:15px;font-weight:800}
.ca-primary:disabled{opacity:.45;cursor:not-allowed}
.ca-frost-row{align-items:center}
.ca-meter{position:relative;flex:1;height:16px;border-radius:99px;background:rgba(74,52,40,.15);overflow:hidden}
.ca-meter i{position:absolute;inset:0 auto 0 0;width:0;background:#f0a558;border-radius:99px}
.ca-meter-label{min-width:72px;font-size:12px;font-weight:800;text-align:center;font-variant-numeric:tabular-nums}
.ca-tray{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}
.ca-topping{display:flex;flex-direction:column;align-items:center;gap:1px;min-height:56px;padding:5px 3px;border:2px dashed transparent;border-radius:12px;background:rgba(255,252,240,.9)}
.ca-topping i{font-size:18px;font-style:normal}
.ca-topping b{font-size:10px}
.ca-topping small{font-size:9px;letter-spacing:.06em;text-transform:uppercase;opacity:.7}
.ca-topping.ca-wanted{border-color:rgba(74,52,40,.5)}
.ca-topping.ca-selected{background:#ffd97b;box-shadow:0 0 0 2px #4a3428 inset}
.ca-panel .ak-card h2{margin:0}
.ca-note{display:block;font-size:10px;font-weight:600;letter-spacing:.05em;opacity:.75}
.ca-stars{font-size:28px;letter-spacing:4px;color:#b8860b}
.ca-breakdown{margin:0;font-size:13px}
.ca-hero{position:relative;height:150px;border-radius:14px;overflow:hidden;background:#ffe9f0}
.ca-hero canvas{display:block;width:100%!important;height:100%!important}
.ca-hero-fallback{display:flex;align-items:center;justify-content:center;font-size:56px}
.ca-hero-caption{font-size:10px;letter-spacing:.06em;text-transform:uppercase;opacity:.6}
@media (max-height:700px){.ca-scene{padding-top:calc(56px + env(safe-area-inset-top))}.ca-hero{height:110px}}
`;
