import {
  validateMinigameManifest,
  type MinigameAudioCue,
  type MinigameContext,
  type MinigameManifest,
  type MinigameModule,
  type MinigamePayout,
} from "../../core/contracts/minigame";
import type { HapticPattern } from "../../core/contracts/platform";
import { activeCatalog, EN_CATALOG, localizedText, pickLocalized } from "../../i18n";
import {
  acquireArcadeKitStyles,
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
  SnailMailRound,
  type ConveyorLetter,
  type DeliveryGesture,
  type MailColor,
  type MailStamp,
  type MailSymbol,
} from "./logic";
import { createSnailMailSettlement, type SnailMailSettlement } from "./settlement";

export const manifest: MinigameManifest = validateMinigameManifest({
  id: "snail-mail",
  title: localizedText((catalog) => catalog.minigames["snail-mail"].title),
  instructions: localizedText((catalog) => catalog.minigames["snail-mail"].instructions),
  icon: EN_CATALOG.minigames["snail-mail"].icon,
  category: "puzzle",
  stage3d: false,
  unlockLevel: 1,
  audioCues: ["countdown", "go", "hit", "miss", "combo", "score", "win"],
  tutorial: [
    {
      icon: "✉",
      title: { en: "Read all three clues", de: "Lies alle drei Hinweise" },
      body: {
        en: "Match every letter by color, symbol, and stamp. The clues repeat as words and shapes, so color is never the only signal.",
        de: "Ordne jeden Brief nach Farbe, Symbol und Marke zu. Wörter und Formen wiederholen die Hinweise – Farbe ist nie das einzige Signal.",
      },
    },
    {
      icon: "↗",
      title: { en: "Drag or flick", de: "Ziehen oder schnippen" },
      body: {
        en: "Drag a letter onto its mailbox, or flick it toward the right slot before the conveyor carries it away.",
        de: "Ziehe einen Brief auf seinen Kasten oder schnippe ihn in das richtige Fach, bevor das Band ihn wegträgt.",
      },
    },
    {
      icon: "📦",
      title: { en: "Handle parcels carefully", de: "Pakete vorsichtig behandeln" },
      body: {
        en: "Striped parcels cannot be flicked. Double-tap them to hand-deliver them safely.",
        de: "Gestreifte Pakete dürfen nicht geschnippt werden. Tippe sie doppelt an, um sie sicher zuzustellen.",
      },
    },
    {
      icon: "🐌",
      title: { en: "Keep a cozy pace", de: "Bleib gemütlich im Takt" },
      body: {
        en: "The belt gently speeds up and grows from three to five routes. Clean deliveries build an express streak.",
        de: "Das Band wird sanft schneller und wächst von drei auf fünf Wege. Saubere Lieferungen bauen eine Express-Serie auf.",
      },
    },
  ],
});

export const definition: MinigameStubDefinition = {
  id: manifest.id,
  title: manifest.title.en,
  instructions: manifest.instructions.en,
};

type Phase = "boot" | "tutorial" | "ready" | "countdown" | "playing" | "paused" | "result" | "disposed";
type SharedContext = MinigameContext & {
  readonly audio?: { emit(action: MinigameAudioCue, value?: number): void };
  readonly haptics?: { impact(pattern: HapticPattern): void };
  readonly reducedMotion?: boolean;
  readonly bestScore?: number;
};

const EMPTY_PAYOUT: MinigamePayout = { score: 0, coins: 0, xp: 0 };
const COLOR_HEX: Readonly<Record<MailColor, string>> = {
  rose: "#d9788c",
  blue: "#6b9ed8",
  gold: "#d6a735",
  green: "#69a66f",
  violet: "#987bc1",
};
const SYMBOL_GLYPH: Readonly<Record<MailSymbol, string>> = {
  moon: "☾",
  star: "★",
  leaf: "♧",
  heart: "♥",
  acorn: "♠",
};
const STAMP_GLYPH: Readonly<Record<MailStamp, string>> = {
  snail: "🐌",
  clover: "☘",
  berry: "●",
  cloud: "☁",
  carrot: "🥕",
};

const COPY = {
  ready: { en: "Route ready", de: "Route bereit" },
  start: { en: "Start deliveries", de: "Zustellungen starten" },
  replay: { en: "How to play", de: "So wird gespielt" },
  dragHint: { en: "Drag or flick each letter to its matching mailbox", de: "Ziehe oder schnippe jeden Brief zum passenden Briefkasten" },
  careful: { en: "Careful parcel — double-tap", de: "Vorsichtspaket – doppelt tippen" },
  wrong: { en: "Check color + symbol + stamp", de: "Prüfe Farbe + Symbol + Marke" },
  delivered: { en: "Delivered!", de: "Zugestellt!" },
  missed: { en: "The snail will circle back", de: "Die Schnecke kommt noch einmal vorbei" },
  paused: { en: "Mail cart parked", de: "Postwagen geparkt" },
  leftUnpaid: { en: "Route left without rewards", de: "Route ohne Belohnung verlassen" },
  deliveredLabel: { en: "delivered", de: "zugestellt" },
} as const;

function copy(key: keyof typeof COPY): string {
  return pickLocalized(COPY[key]);
}

interface DragState {
  readonly pointerId: number;
  readonly letterId: number;
  readonly startX: number;
  readonly startY: number;
  element: HTMLElement;
}

export class SnailMailGame implements MinigameModule {
  readonly id = manifest.id;

  private context: SharedContext | null = null;
  private root: HTMLElement | null = null;
  private hud: ArcadeHud | null = null;
  private tutorial: TutorialOverlay | null = null;
  private result: ResultScreen | null = null;
  private settlement: SnailMailSettlement | null = null;
  private round: SnailMailRound | null = null;
  private countdown: ArcadeCountdown | null = null;
  private readonly pauseGate = new PauseGate();
  private releaseStyles: (() => void) | null = null;
  private readonly cleanup: Array<() => void> = [];
  private phase: Phase = "boot";
  private pausedFrom: "playing" | "countdown" = "playing";
  private settledPayout: MinigamePayout | null = null;
  private best = 0;
  private drag: DragState | null = null;
  private lastTap: { readonly id: number; readonly elapsed: number } | null = null;

  get title(): string {
    return pickLocalized(manifest.title);
  }

  get instructions(): string {
    return pickLocalized(manifest.instructions);
  }

  mount(context: MinigameContext): void {
    if (this.phase !== "boot" && this.phase !== "disposed") this.dispose();
    this.context = context;
    this.settlement = createSnailMailSettlement(context);
    this.best = this.settlement.persistedBest;
    const document = context.mount.ownerDocument;
    this.releaseStyles = acquireArcadeKitStyles(document);
    const root = document.createElement("section");
    root.className = "snail-mail";
    root.dataset.minigame = this.id;
    root.tabIndex = 0;
    root.setAttribute("aria-label", this.title);
    if (this.context.reducedMotion === true) root.dataset.akReduced = "true";
    root.innerHTML = `
      <style>${SNAIL_CSS}</style>
      <div class="sm-scene">
        <div class="sm-sky" aria-hidden="true"><span>☁</span><b>🐌</b><span>☁</span></div>
        <p class="sm-hint" data-sm="hint">${copy("dragHint")}</p>
        <div class="sm-belt" data-sm="belt" aria-label="${copy("dragHint")}">
          <div class="sm-belt-lines" aria-hidden="true"></div>
          <div class="sm-letters" data-sm="letters"></div>
        </div>
        <div class="sm-boxes" data-sm="boxes" role="list"></div>
        <div class="sm-countdown" data-sm="countdown" hidden aria-hidden="true"></div>
        <div class="sm-status" data-sm="status" role="status" aria-live="polite"></div>
      </div>
      <div class="ak-overlay sm-panel" data-sm="panel" role="dialog" aria-modal="true" hidden></div>
    `;
    context.mount.replaceChildren(root);
    this.root = root;
    this.hud = createArcadeHud({
      host: root,
      initialBest: this.best,
      reducedMotion: this.context.reducedMotion === true,
      onPause: () => this.pause(),
    });
    this.tutorial = createTutorialOverlay({
      host: root,
      steps: manifest.tutorial,
      reducedMotion: this.context.reducedMotion === true,
      onStart: () => this.showReady(),
      onExitWithoutReward: () => this.showReady(copy("leftUnpaid")),
    });
    this.result = createResultScreen({
      host: root,
      reducedMotion: this.context.reducedMotion === true,
      hooks: {
        onCollect: () => this.showReady(),
        onPlayAgain: () => this.beginRound(),
      },
    });
    this.listen(root, "click", (event) => this.onClick(event));
    this.listen(root, "dblclick", (event) => this.onDoubleClick(event));
    this.listen(root, "keydown", (event) => this.onKeyDown(event));
    this.listen(root, "pointerdown", (event) => this.onPointerDown(event));
    this.listen(root, "pointermove", (event) => this.onPointerMove(event));
    this.listen(root, "pointerup", (event) => this.onPointerEnd(event));
    this.listen(root, "pointercancel", (event) => this.onPointerEnd(event));
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
    this.drag = null;
    this.showPausePanel();
  }

  resume(): void {
    if (this.phase !== "paused") return;
    this.phase = this.pausedFrom;
    this.pauseGate.resume();
    this.hidePanel();
    this.root?.focus();
  }

  update(deltaSeconds: number): void {
    if (!this.root) return;
    const safe = Math.min(0.1, Math.max(0, Number.isFinite(deltaSeconds) ? deltaSeconds : 0));
    const dt = this.pauseGate.filter(safe);
    if (this.phase === "countdown") {
      this.countdown?.update(dt);
      return;
    }
    if (this.phase !== "playing" || !this.round) return;
    this.round.update(dt);
    this.round.drainEvents((event) => {
      if (event.kind === "missed") {
        this.feedback("miss", undefined, "warning");
        this.announce(copy("missed"));
      }
    });
    this.renderRound();
    if (this.round.finished) this.finishRound(false);
  }

  payout(): MinigamePayout {
    return this.settledPayout ?? EMPTY_PAYOUT;
  }

  dispose(): void {
    if (this.phase === "disposed") return;
    this.phase = "disposed";
    this.settlement?.exitUnpaid();
    for (const remove of this.cleanup.splice(0)) remove();
    this.hud?.dispose();
    this.tutorial?.dispose();
    this.result?.dispose();
    this.releaseStyles?.();
    this.pauseGate.dispose();
    this.root?.remove();
    this.context = null;
    this.root = null;
    this.hud = null;
    this.tutorial = null;
    this.result = null;
    this.releaseStyles = null;
    this.round = null;
    this.settlement = null;
    this.drag = null;
  }

  private showReady(message?: string): void {
    this.phase = "ready";
    this.result?.close();
    const panel = this.query("[data-sm='panel']");
    if (!panel) return;
    panel.hidden = false;
    panel.innerHTML = `
      <div class="ak-card">
        <span class="ak-kicker">${copy("ready")}</span>
        <div class="ak-card-icon" aria-hidden="true">🐌✉</div>
        <h2>${this.title}</h2>
        ${message ? `<p>${message}</p>` : ""}
        <button class="ak-button ak-button-primary" data-sm-action="start">${copy("start")}</button>
        <button class="ak-button ak-button-secondary" data-sm-action="tutorial">${copy("replay")}</button>
      </div>
    `;
    panel.querySelector<HTMLButtonElement>("[data-sm-action='start']")?.focus();
  }

  private beginRound(): void {
    const context = this.context;
    if (!context) return;
    this.result?.close();
    this.settlement?.begin();
    this.round = new SnailMailRound(context.rng);
    this.settledPayout = null;
    this.lastTap = null;
    this.hidePanel();
    this.pauseGate.resume();
    this.phase = "countdown";
    this.hud?.setScore(0);
    this.hud?.setCombo(0);
    this.hud?.setBest(this.best);
    this.renderRound();
    this.countdown = new ArcadeCountdown({
      seconds: 3,
      feedback: (event) => {
        const badge = this.query("[data-sm='countdown']");
        if (event.kind === "tick") {
          this.feedback("countdown");
          if (badge) {
            badge.hidden = false;
            badge.textContent = String(event.value);
          }
        } else {
          this.feedback("go", undefined, "light");
          if (badge) badge.hidden = true;
          this.phase = "playing";
          this.root?.focus();
        }
      },
    });
    this.countdown.start();
  }

  private finishRound(quitEarly: boolean): void {
    const round = this.round;
    if (!round || this.phase === "result") return;
    const payout = round.payout();
    this.settledPayout = this.settlement?.complete(payout) ?? payout;
    this.best = Math.max(this.best, this.settlement?.receipt?.bestScore ?? payout.score);
    this.phase = "result";
    this.feedback("win", payout.score, "success");
    this.result?.show({
      score: payout.score,
      best: this.best,
      newBest: payout.score > 0 && payout.score >= this.best,
      quitEarly,
      detail: `${round.delivered} ${copy("deliveredLabel")} · ${activeCatalog().strings.minigameCommon.streak} ${round.bestStreak}×`,
    });
  }

  private exitUnpaid(): void {
    this.settlement?.exitUnpaid();
    this.round = null;
    this.showReady(copy("leftUnpaid"));
  }

  private showPausePanel(): void {
    const panel = this.query("[data-sm='panel']");
    if (!panel) return;
    const strings = activeCatalog().strings.minigameCommon;
    panel.hidden = false;
    panel.innerHTML = `
      <div class="ak-card">
        <span class="ak-kicker">${copy("paused")}</span>
        <div class="ak-card-icon" aria-hidden="true">🐌</div>
        <button class="ak-button ak-button-primary" data-sm-action="resume">${strings.resume}</button>
        <button class="ak-button ak-button-secondary" data-sm-action="restart">${strings.restart}</button>
        <button class="ak-button ak-button-quiet" data-sm-action="quit">${strings.quitNoReward}</button>
      </div>
    `;
    panel.querySelector<HTMLButtonElement>("[data-sm-action='resume']")?.focus();
  }

  private hidePanel(): void {
    const panel = this.query("[data-sm='panel']");
    if (!panel) return;
    panel.hidden = true;
    panel.replaceChildren();
  }

  private renderRound(): void {
    const round = this.round;
    if (!round) return;
    this.hud?.setTimer(round.remaining);
    this.hud?.setScore(round.score);
    this.hud?.setCombo(round.streak);
    const boxes = this.query("[data-sm='boxes']");
    if (boxes && boxes.childElementCount !== round.mailboxes.length) {
      boxes.innerHTML = round.mailboxes.map((box) => {
        const label = `${box.color} · ${box.symbol} · ${box.stamp}`;
        return `
          <div class="sm-box" role="listitem" data-sm-box="${box.index}" style="--mail-color:${COLOR_HEX[box.color]}">
            <span class="sm-box-number">${box.index + 1}</span>
            <i aria-hidden="true">${SYMBOL_GLYPH[box.symbol]}</i>
            <b>${box.color}</b>
            <small>${STAMP_GLYPH[box.stamp]} ${box.stamp}</small>
            <span class="sm-sr">${label}</span>
          </div>
        `;
      }).join("");
    }
    const letters = this.query("[data-sm='letters']");
    if (!letters) return;
    const liveIds = new Set(round.letters.map((letter) => String(letter.id)));
    for (const element of letters.querySelectorAll<HTMLElement>("[data-sm-letter]")) {
      if (!liveIds.has(element.dataset.smLetter ?? "")) element.remove();
    }
    for (const letter of round.letters) {
      let element = letters.querySelector<HTMLElement>(`[data-sm-letter="${letter.id}"]`);
      if (!element) {
        element = this.createLetterElement(letter);
        letters.append(element);
      }
      if (this.drag?.letterId !== letter.id) {
        element.style.left = `${letter.progress * 88}%`;
        element.style.transform = "";
      }
    }
  }

  private createLetterElement(letter: ConveyorLetter): HTMLElement {
    const document = this.root?.ownerDocument;
    if (!document) throw new Error("Snail Mail is not mounted");
    const button = document.createElement("button");
    button.type = "button";
    button.className = `sm-letter${letter.careful ? " sm-careful" : ""}`;
    button.dataset.smLetter = String(letter.id);
    button.dataset.mailbox = String(letter.mailbox);
    button.style.setProperty("--mail-color", COLOR_HEX[letter.color]);
    button.setAttribute(
      "aria-label",
      `${letter.careful ? `${copy("careful")}. ` : ""}${letter.color}, ${letter.symbol}, ${letter.stamp}`,
    );
    button.innerHTML = `
      <span class="sm-symbol" aria-hidden="true">${SYMBOL_GLYPH[letter.symbol]}</span>
      <b>${letter.color}</b>
      <small>${STAMP_GLYPH[letter.stamp]} ${letter.stamp}</small>
      ${letter.careful ? `<em>${copy("careful")}</em>` : ""}
    `;
    return button;
  }

  private attemptDelivery(letterId: number, mailbox: number, gesture: DeliveryGesture): void {
    const outcome = this.round?.deliver(letterId, mailbox, gesture);
    if (!outcome || outcome === "missing") return;
    if (outcome === "delivered") {
      const streak = this.round?.streak ?? 0;
      this.feedback(streak > 1 ? "combo" : "hit", streak, "light");
      this.announce(copy("delivered"));
    } else {
      this.feedback("miss", undefined, "warning");
      this.announce(outcome === "careful-required" ? copy("careful") : copy("wrong"));
    }
    this.renderRound();
  }

  private onClick(event: MouseEvent): void {
    const action = event.target instanceof Element
      ? event.target.closest<HTMLElement>("[data-sm-action]")?.dataset.smAction
      : undefined;
    if (!action) return;
    if (action === "start" || action === "restart") this.beginRound();
    else if (action === "tutorial") {
      this.hidePanel();
      this.phase = "tutorial";
      this.tutorial?.open();
    } else if (action === "resume") this.resume();
    else if (action === "quit") this.exitUnpaid();
  }

  private onDoubleClick(event: MouseEvent): void {
    if (this.phase !== "playing" || !(event.target instanceof Element)) return;
    const letter = event.target.closest<HTMLElement>("[data-sm-letter]");
    if (!letter) return;
    this.attemptDelivery(
      Number(letter.dataset.smLetter),
      Number(letter.dataset.mailbox),
      "double-tap",
    );
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (event.key === "Escape" || event.key.toLowerCase() === "p") {
      event.preventDefault();
      if (this.phase === "paused") this.resume();
      else this.pause();
      return;
    }
    if (this.phase !== "playing" || !this.round) return;
    if (/^[1-5]$/u.test(event.key)) {
      event.preventDefault();
      const first = this.round.letters[0];
      if (first) this.attemptDelivery(first.id, Number(event.key) - 1, "flick");
    } else if (event.key === "Enter" || event.key === " ") {
      const first = this.round.letters[0];
      if (first?.careful) {
        event.preventDefault();
        this.attemptDelivery(first.id, first.mailbox, "double-tap");
      }
    }
  }

  private onPointerDown(event: PointerEvent): void {
    if (this.phase !== "playing" || this.drag || !(event.target instanceof Element)) return;
    const element = event.target.closest<HTMLElement>("[data-sm-letter]");
    if (!element) return;
    event.preventDefault();
    this.drag = {
      pointerId: event.pointerId,
      letterId: Number(element.dataset.smLetter),
      startX: event.clientX,
      startY: event.clientY,
      element,
    };
    try {
      element.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic pointer sources can omit capture support.
    }
  }

  private onPointerMove(event: PointerEvent): void {
    const drag = this.drag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    drag.element.style.transform = `translate(${event.clientX - drag.startX}px,${event.clientY - drag.startY}px) scale(1.05)`;
  }

  private onPointerEnd(event: PointerEvent): void {
    const drag = this.drag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    this.drag = null;
    const distance = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
    const boxes = this.query("[data-sm='boxes']");
    if (distance < 18) {
      const current = this.round?.letters.find((letter) => letter.id === drag.letterId);
      if (current?.careful) {
        if (
          this.lastTap?.id === current.id
          && (this.round?.elapsed ?? 0) - this.lastTap.elapsed <= 0.45
        ) {
          this.attemptDelivery(current.id, current.mailbox, "double-tap");
          this.lastTap = null;
        } else {
          this.lastTap = { id: current.id, elapsed: this.round?.elapsed ?? 0 };
          this.announce(copy("careful"));
        }
      }
      drag.element.style.transform = "";
      return;
    }
    const rect = boxes?.getBoundingClientRect();
    if (!rect || (this.round?.mailboxes.length ?? 0) === 0) return;
    const fraction = (event.clientX - rect.left) / Math.max(1, rect.width);
    const mailbox = Math.max(
      0,
      Math.min((this.round?.mailboxes.length ?? 1) - 1, Math.floor(fraction * (this.round?.mailboxes.length ?? 1))),
    );
    this.attemptDelivery(drag.letterId, mailbox, distance > 105 ? "flick" : "drag");
  }

  private feedback(cue: MinigameAudioCue, value?: number, haptic?: HapticPattern): void {
    this.context?.audio?.emit(cue, value);
    if (haptic) this.context?.haptics?.impact(haptic);
  }

  private announce(text: string): void {
    const status = this.query("[data-sm='status']");
    if (status) status.textContent = text;
  }

  private query<T extends HTMLElement = HTMLElement>(selector: string): T | null {
    return this.root?.querySelector<T>(selector) ?? null;
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
}

export const createMinigame = (): MinigameModule => new SnailMailGame();

const SNAIL_CSS = `
.snail-mail{position:absolute;inset:0;overflow:hidden;border-radius:18px;background:linear-gradient(#f9e4d6 0 44%,#cce2ae 44%);color:#4b3428;font-family:inherit;touch-action:none;user-select:none;-webkit-user-select:none}
.snail-mail *{box-sizing:border-box}.snail-mail button{font:inherit}.snail-mail:focus-visible{outline:3px solid #4b3428;outline-offset:-3px}
.sm-scene{position:absolute;inset:0;display:flex;flex-direction:column;gap:8px;padding:calc(62px + env(safe-area-inset-top)) 10px calc(12px + env(safe-area-inset-bottom))}
.snail-mail .ak-hud{right:max(92px,calc(8px + env(safe-area-inset-right)))}
.sm-sky{height:45px;display:flex;align-items:center;justify-content:space-around;font-size:28px;color:#fff}.sm-sky b{font-size:38px;filter:drop-shadow(0 3px 0 #fff)}
.sm-hint{margin:0;text-align:center;font-size:12px;font-weight:800;min-height:17px}
.sm-belt{position:relative;flex:1;min-height:190px;overflow:hidden;border:4px solid #765343;border-radius:22px;background:#d4b08b;box-shadow:inset 0 0 0 4px #ead2b4}
.sm-belt-lines{position:absolute;inset:0;background:repeating-linear-gradient(90deg,transparent 0 36px,rgba(75,52,40,.13) 36px 40px)}
.sm-letters{position:absolute;inset:0}
.sm-letter{position:absolute;top:22%;left:0;width:104px;min-height:112px;padding:9px 6px;border:4px solid var(--mail-color);border-radius:12px;background:#fffaf0;box-shadow:0 5px 0 #765343;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;cursor:grab;z-index:2}
.sm-letter:focus-visible{outline:4px solid #241a14;outline-offset:2px}.sm-letter .sm-symbol{font-size:31px;color:var(--mail-color)}.sm-letter b{text-transform:uppercase;font-size:11px}.sm-letter small{font-size:10px}.sm-letter em{font-size:9px;font-style:normal;font-weight:900;color:#8c3b43}
.sm-letter.sm-careful{background:repeating-linear-gradient(135deg,#fffaf0 0 12px,#f4e1c5 12px 20px);border-style:double;border-width:6px}
.sm-boxes{display:grid;grid-template-columns:repeat(auto-fit,minmax(58px,1fr));gap:5px;height:122px}
.sm-box{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;min-width:0;padding:5px 2px 9px;border:4px solid #5a3f31;border-top:10px solid var(--mail-color);border-radius:13px 13px 6px 6px;background:#fff6e5;box-shadow:0 4px 0 rgba(75,52,40,.3)}
.sm-box i{font-size:23px;font-style:normal;color:var(--mail-color)}.sm-box b{font-size:9px;text-transform:uppercase}.sm-box small{font-size:8px;white-space:nowrap}.sm-box-number{position:absolute;top:-9px;left:3px;width:18px;height:18px;border-radius:50%;background:#493328;color:#fff;font:800 10px/18px sans-serif;text-align:center}
.sm-countdown{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:72px;font-weight:900;text-shadow:0 4px #fff;pointer-events:none}.sm-status{min-height:19px;text-align:center;font-size:13px;font-weight:900}
.sm-panel .ak-card h2{margin:0}.sm-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}
[data-ak-reduced='true'] .sm-letter{transition:none!important}
@media(max-height:700px){.sm-scene{padding-top:calc(56px + env(safe-area-inset-top))}.sm-sky{height:28px}.sm-belt{min-height:140px}.sm-boxes{height:102px}}
`;
