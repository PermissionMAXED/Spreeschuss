import type {
  MinigameContext,
  MinigameManifest,
  MinigameModule,
  MinigamePayout,
} from "../../core/contracts/minigame";
import { validateMinigameManifest } from "../../core/contracts/minigame";
import type { HapticPattern } from "../../core/contracts/platform";
import type { MinigameStubDefinition } from "../stub";
import { createDifficultyRamp, PauseGate } from "../shared";
import {
  BUBBLE_CUES,
  BUBBLE_COLORS,
  BUBBLE_SYMBOLS,
  bubblePayout,
  bubbleSymbol,
  resolveBubbleTap,
  type BubbleColor,
  type BubbleMode,
  type BubblePlayfield,
  type BubbleScoreState,
  type BubbleSymbol,
} from "./logic";

export const manifest: MinigameManifest = validateMinigameManifest({
  id: "bubble-bath-blast",
  title: { en: "Bubble Bath Blast", de: "Schaumbad-Spaß" },
  instructions: {
    en: "Pop matching bubbles and keep Gooby squeaky clean.",
    de: "Zerplatze passende Blasen und halte Gooby blitzsauber.",
  },
  icon: "◌",
  category: "care",
  stage3d: false,
  unlockLevel: 2,
  audioCues: ["go", "hit", "miss", "combo", "score", "win"],
  tutorial: [
    {
      icon: "♥",
      title: { en: "Match every cue", de: "Achte auf jedes Zeichen" },
      body: {
        en: "Tap a touching chain with the same symbol. Color, shape, label, and pattern repeat the match.",
        de: "Tippe eine berührende Kette mit demselben Symbol. Farbe, Form, Name und Muster zeigen die gleiche Gruppe.",
      },
    },
    {
      icon: "🦆",
      title: { en: "Catch the bath duck", de: "Fange die Badeente" },
      body: {
        en: "Rubber ducks grant 500 bonus points. Soap blocks break the streak and cost four seconds.",
        de: "Badeenten bringen 500 Bonuspunkte. Seifenblöcke beenden die Serie und kosten vier Sekunden.",
      },
    },
    {
      icon: "∞",
      title: { en: "Relax in Zen", de: "Entspanne im Zen-Modus" },
      body: {
        en: "Zen has no timer and pays half rewards, so you can practice chains at your own pace.",
        de: "Zen hat keine Uhr und zahlt halbe Belohnungen, damit du Ketten in Ruhe üben kannst.",
      },
    },
  ],
});

export const definition = {
  id: manifest.id,
  title: manifest.title.en,
  instructions: manifest.instructions.en,
  create: (): MinigameModule => new BubbleBathBlastGame(),
} as const satisfies MinigameStubDefinition & { readonly create: () => MinigameModule };

type Phase = "unmounted" | "tutorial" | "running" | "paused" | "ended" | "disposed";

interface RisingBubble {
  id: number;
  kind: "bubble" | "soap" | "duck";
  color: BubbleColor;
  symbol: BubbleSymbol;
  x: number;
  y: number;
  radius: number;
  speed: number;
  bornAt: number;
}

const GAME_SECONDS = 80;
const bubbleDifficulty = createDifficultyRamp({
  rampSeconds: GAME_SECONDS,
  startIntensity: 0,
  maxIntensity: 1,
  shape: "smoothstep",
});

type MinigameSoundAction = "hit" | "miss" | "combo" | "countdown" | "go" | "win" | "lose" | "score";

type BubbleContext = MinigameContext & {
  readonly audio?: { emit(action: MinigameSoundAction, value?: number): void };
  readonly haptics?: { impact(pattern: HapticPattern): void };
  readonly bestScore?: number;
  readonly reducedMotion?: boolean;
};

const colorValue: Readonly<Record<BubbleColor, string>> = {
  coral: "#ff718d",
  sun: "#ffd657",
  mint: "#62dfbd",
  sky: "#5bbcf6",
  grape: "#a987f4",
};

export class BubbleBathBlastGame implements MinigameModule {
  readonly id = definition.id;
  readonly title = definition.title;
  readonly instructions = definition.instructions;

  private context: BubbleContext | null = null;
  private root: HTMLElement | null = null;
  private abortController: AbortController | null = null;
  private readonly scheduled = new Set<number>();
  private readonly bubbleElements = new Map<number, HTMLButtonElement>();
  private phase: Phase = "unmounted";
  private bubbles: RisingBubble[] = [];
  private nextId = 1;
  private remaining = GAME_SECONDS;
  private spawnAccumulator = 0;
  private renderAccumulator = 0;
  private runStartedAt = 0;
  private best = 0;
  private actionsTaken = 0;
  private mode: BubbleMode = "splash";
  private elapsed = 0;
  private readonly pauseGate = new PauseGate();
  private scoreState: BubbleScoreState = {
    score: 0,
    stars: 0,
    combo: 0,
    timePenalty: 0,
  };
  private finished = false;

  mount(context: MinigameContext): void {
    if (this.phase !== "unmounted" && this.phase !== "disposed") this.dispose();
    const sharedContext = context as BubbleContext;
    this.context = sharedContext;
    this.best = sharedContext.lifecycle?.persistedBest ?? sharedContext.bestScore ?? 0;
    this.finished = false;
    this.abortController = new AbortController();
    const root = document.createElement("section");
    root.className = "bubble-blast";
    root.dataset.minigame = this.id;
    root.tabIndex = 0;
    if (sharedContext.reducedMotion) root.dataset.reducedMotion = "true";
    root.innerHTML = this.markup();
    root.addEventListener("click", this.onClick, { signal: this.abortController.signal });
    root.addEventListener("keydown", this.onKeyDown, { signal: this.abortController.signal });
    context.mount.replaceChildren(root);
    this.root = root;
    this.phase = "tutorial";
    this.renderHud();
  }

  start(): void {
    if (this.phase === "unmounted" || this.phase === "disposed") return;
    this.phase = "tutorial";
    this.showPanel("tutorial");
  }

  pause(): void {
    if (this.phase !== "running") return;
    this.pauseGate.pause();
    this.phase = "paused";
    this.showPanel("pause");
  }

  resume(): void {
    if (this.phase !== "paused") return;
    this.pauseGate.resume();
    this.phase = "running";
    this.showPanel(null);
    this.emitFeedback("countdown", undefined, "light");
  }

  update(deltaSeconds: number): void {
    if (this.phase !== "running" || !this.context || !this.root) return;
    const requested = Math.min(0.1, Math.max(0, Number.isFinite(deltaSeconds) ? deltaSeconds : 0));
    const delta = this.pauseGate.filter(requested);
    this.elapsed += delta;
    if (this.mode === "splash") this.remaining = Math.max(0, this.remaining - delta);
    this.spawnAccumulator += delta;
    this.renderAccumulator += delta;
    const intensity = bubbleDifficulty.intensityAt(this.elapsed);
    const spawnEvery = 0.68 - intensity * 0.36;

    while (this.spawnAccumulator >= spawnEvery) {
      this.spawnAccumulator -= spawnEvery;
      this.spawnBubble(intensity);
    }

    this.bubbles = this.bubbles
      .map((bubble) => ({ ...bubble, y: bubble.y - bubble.speed * delta }))
      .filter((bubble) => bubble.y > -12);

    if (this.renderAccumulator >= 1 / 30) {
      this.renderAccumulator = 0;
      this.root.dataset.clock = String(this.context.clock.now());
      this.renderBubbles();
      this.renderHud();
    }

    if (this.mode === "splash" && this.remaining <= 0) this.finishGame();
  }

  payout(): MinigamePayout {
    return bubblePayout(this.scoreState, this.mode);
  }

  dispose(): void {
    this.abortController?.abort();
    this.abortController = null;
    for (const timeout of this.scheduled) window.clearTimeout(timeout);
    this.scheduled.clear();
    this.bubbleElements.clear();
    this.bubbles = [];
    this.root?.remove();
    this.root = null;
    this.context = null;
    this.pauseGate.dispose();
    this.phase = "disposed";
  }

  private beginRound(mode: BubbleMode = this.mode): void {
    if (!this.context || !this.root) return;
    this.pauseGate.resume();
    this.mode = mode;
    this.bubbles = [];
    this.nextId = 1;
    this.remaining = GAME_SECONDS;
    this.spawnAccumulator = 0;
    this.renderAccumulator = 0;
    this.elapsed = 0;
    this.actionsTaken = 0;
    this.scoreState = { score: 0, stars: 0, combo: 0, timePenalty: 0 };
    this.runStartedAt = this.context.clock.now();
    this.root.dataset.startedAt = String(this.runStartedAt);
    this.root.dataset.mode = mode;
    this.finished = false;
    this.phase = "running";
    this.showPanel(null);
    this.clearBubbleElements();
    for (let index = 0; index < 7; index += 1) this.spawnBubble(0);
    this.renderBubbles();
    this.renderHud();
    this.emitFeedback("go", undefined, "success");
  }

  private spawnBubble(intensity: number): void {
    if (!this.context) return;
    const kindRoll = this.context.rng.next();
    const kind: RisingBubble["kind"] = kindRoll < 0.035
      ? "duck"
      : kindRoll < 0.115 + intensity * 0.05
        ? "soap"
        : "bubble";
    const lane = this.context.rng.int(0, 7);
    const radius = kind === "soap" ? 4.8 : kind === "duck" ? 5.7 : 5 + this.context.rng.next() * 1.25;
    const color = this.context.rng.pick(BUBBLE_COLORS);
    this.bubbles.push({
      id: this.nextId,
      kind,
      color,
      symbol: kind === "bubble"
        ? bubbleSymbol({ color })
        : this.context.rng.pick(BUBBLE_SYMBOLS),
      x: 8 + lane * 14 + (this.context.rng.next() - 0.5) * 2.4,
      y: 98 + this.context.rng.next() * 3,
      radius,
      speed: 7.2 + intensity * 5.5 + this.context.rng.next() * 2,
      bornAt: this.context.clock.now(),
    });
    this.nextId += 1;
    if (this.bubbles.length > 34) this.bubbles.shift();
  }

  private readonly onClick = (event: MouseEvent): void => {
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-action],[data-bubble]") : null;
    if (!target) return;
    const action = target.dataset.action;
    if (action === "begin") {
      this.beginRound("splash");
      return;
    }
    if (action === "begin-zen") {
      this.beginRound("zen");
      return;
    }
    if (action === "again") {
      if (!this.context?.lifecycle) this.beginRound(this.mode);
      return;
    }
    if (action === "pause") {
      this.pause();
      return;
    }
    if (action === "resume") {
      this.resume();
      return;
    }
    if (action === "quit") {
      if (this.phase === "tutorial" || this.actionsTaken === 0) this.abandonGame();
      else this.finishGame(true);
      return;
    }
    const bubbleId = Number(target.dataset.bubble);
    if (this.phase === "running" && Number.isInteger(bubbleId)) this.tapBubble(bubbleId, target);
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.repeat) return;
    const key = event.key.toLowerCase();
    if (key === "escape" || key === "p") {
      if (this.phase !== "running" && this.phase !== "paused") return;
      event.preventDefault();
      if (this.phase === "paused") this.resume();
      else this.pause();
      return;
    }
    if (this.phase !== "running" || !/^[1-9]$/u.test(key)) return;
    const bubble = this.bubbles[Number(key) - 1];
    const element = bubble ? this.bubbleElements.get(bubble.id) : null;
    if (!bubble || !element) return;
    event.preventDefault();
    this.tapBubble(bubble.id, element);
  };

  private tapBubble(id: number, element: HTMLElement): void {
    const tapped = this.bubbles.find((bubble) => bubble.id === id);
    if (!tapped) return;
    this.actionsTaken += 1;
    const result = resolveBubbleTap(
      this.scoreState,
      this.bubbles,
      id,
      this.playfieldDimensions(),
    );
    this.scoreState = {
      score: result.score,
      stars: result.stars,
      combo: result.combo,
      timePenalty: result.timePenalty,
    };

    if (result.soapHit) {
      this.remaining = Math.max(0, this.remaining - 4);
      this.bubbles = this.bubbles.filter((bubble) => bubble.id !== id);
      this.flashMessage("SOAP BLOCK! −4 SEC", "danger");
      this.burst(element, "#26334d", 10);
      this.emitFeedback("miss", undefined, "warning");
    } else if (result.duckBonus) {
      this.bubbles = this.bubbles.filter((bubble) => bubble.id !== id);
      this.flashMessage("RUBBER DUCK! +500", "bonus");
      this.burst(element, "#ffd64f", 18);
      this.emitFeedback("score", 500, "success");
    } else {
      const removed = new Set(result.removedIds);
      this.bubbles = this.bubbles.filter((bubble) => !removed.has(bubble.id));
      this.burst(
        element,
        tapped ? colorValue[tapped.color] : "#ffffff",
        Math.min(18, 4 + result.removedIds.length * 2),
      );
      if (result.starBurst) {
        this.flashMessage(`★ STAR BURST ×${result.removedIds.length}!`, "star");
        this.emitFeedback("combo", result.combo, "success");
      } else {
        this.emitFeedback("hit", undefined, "light");
      }
    }
    this.renderBubbles();
    this.renderHud();
  }

  private finishGame(quit = false): void {
    if (this.finished || !this.context || !this.root) return;
    this.finished = true;
    this.phase = "ended";
    const payout = this.payout();
    this.context.finish(payout);
    this.emitFeedback(quit ? "score" : "win", payout.score, quit ? "light" : "success");
    this.best = this.context.lifecycle?.persistedBest ?? Math.max(this.best, payout.score);
    const panel = this.root.querySelector<HTMLElement>('[data-panel="result"]');
    if (panel) {
      const heading = panel.querySelector("h2");
      if (heading) heading.textContent = quit ? "Bath wrapped up" : "Sparkling clean!";
      const score = panel.querySelector<HTMLElement>("[data-result-score]");
      const reward = panel.querySelector<HTMLElement>("[data-result-reward]");
      const best = panel.querySelector<HTMLElement>("[data-result-best]");
      if (score) score.textContent = payout.score.toLocaleString();
      if (reward) {
        reward.textContent = `${this.mode === "zen" ? "Zen half payout · " : ""}+${payout.coins} coins  ·  +${payout.xp} XP`;
      }
      if (best) {
        best.textContent = `Best ${this.best.toLocaleString()} · ${this.scoreState.stars} star bursts`;
      }
    }
    this.showPanel("result");
  }

  private abandonGame(): void {
    if (this.finished || !this.context || !this.root) return;
    this.finished = true;
    this.phase = "ended";
    this.context.lifecycle?.exit();
    const panel = this.root.querySelector<HTMLElement>('[data-panel="result"]');
    const heading = panel?.querySelector("h2");
    const score = panel?.querySelector<HTMLElement>("[data-result-score]");
    const reward = panel?.querySelector<HTMLElement>("[data-result-reward]");
    const best = panel?.querySelector<HTMLElement>("[data-result-best]");
    if (heading) heading.textContent = "Bath saved for later";
    if (score) score.textContent = "0";
    if (reward) reward.textContent = "No rewards collected";
    if (best) best.textContent = `Best ${this.best.toLocaleString()}`;
    this.showPanel("result");
  }

  private showPanel(name: "tutorial" | "pause" | "result" | null): void {
    if (!this.root) return;
    for (const panel of this.root.querySelectorAll<HTMLElement>("[data-panel]")) {
      panel.hidden = panel.dataset.panel !== name;
    }
  }

  private renderHud(): void {
    if (!this.root) return;
    const time = this.root.querySelector<HTMLElement>("[data-time]");
    const score = this.root.querySelector<HTMLElement>("[data-score]");
    const stars = this.root.querySelector<HTMLElement>("[data-stars]");
    const combo = this.root.querySelector<HTMLElement>("[data-combo]");
    if (time) {
      time.textContent = this.mode === "zen" ? "∞ ZEN" : `${Math.ceil(this.remaining)}s`;
      time.classList.toggle("urgent", this.mode === "splash" && this.remaining <= 10);
    }
    if (score) score.textContent = Math.floor(this.scoreState.score).toLocaleString();
    if (stars) stars.textContent = `★ ${this.scoreState.stars}`;
    if (combo) {
      combo.textContent = this.scoreState.combo > 1 ? `COMBO ×${this.scoreState.combo}` : "MAKE A CHAIN";
      combo.classList.toggle("hot", this.scoreState.combo >= 4);
    }
  }

  private renderBubbles(): void {
    if (!this.root) return;
    const layer = this.root.querySelector<HTMLElement>("[data-bubble-layer]");
    if (!layer) return;
    const playfield = this.playfieldDimensions(layer);
    const isotropicUnit = Math.min(playfield.width, playfield.height) / 100;
    const activeIds = new Set(this.bubbles.map(({ id }) => id));
    for (const [id, element] of this.bubbleElements) {
      if (activeIds.has(id)) continue;
      element.remove();
      this.bubbleElements.delete(id);
    }
    for (const bubble of this.bubbles) {
      const size = bubble.radius * 2;
      const age = this.context ? Math.max(0, this.context.clock.now() - bubble.bornAt) : 0;
      const wobble = Math.sin(age / 420 + bubble.id) * 1.3;
      let element = this.bubbleElements.get(bubble.id);
      if (!element) {
        element = this.createBubbleElement(bubble);
        this.bubbleElements.set(bubble.id, element);
        layer.append(element);
      }
      element.style.left = `${bubble.x * playfield.width / 100 + wobble * isotropicUnit}px`;
      element.style.top = `${bubble.y * playfield.height / 100}px`;
      element.style.width = `${size * isotropicUnit}px`;
      element.style.height = `${size * isotropicUnit}px`;
      if (bubble.kind === "soap" || bubble.kind === "duck") {
        continue;
      }
      const color = colorValue[bubble.color];
      const cue = BUBBLE_CUES[bubbleSymbol(bubble)];
      element.style.setProperty("--bubble", color);
      element.dataset.color = bubble.color;
      element.dataset.cue = cue.label.toLowerCase();
      element.dataset.shape = cue.shape;
      element.dataset.pattern = cue.pattern;
      element.setAttribute(
        "aria-label",
        `${bubble.color} ${cue.label} bubble, ${cue.shape} shape, ${cue.pattern} pattern`,
      );
    }
  }

  private createBubbleElement(bubble: RisingBubble): HTMLButtonElement {
    const element = document.createElement("button");
    element.type = "button";
    element.dataset.bubble = String(bubble.id);
    if (bubble.kind === "soap") {
      element.className = "soap-block";
      element.setAttribute("aria-label", "Forbidden soap block");
      const warning = document.createElement("i");
      warning.textContent = "!";
      const label = document.createElement("small");
      label.textContent = "SOAP";
      element.append(warning, label);
      return element;
    }
    if (bubble.kind === "duck") {
      element.className = "rubber-duck";
      element.setAttribute("aria-label", "Rubber duck bonus, 500 points");
      const duck = document.createElement("i");
      duck.textContent = "🦆";
      const label = document.createElement("small");
      label.textContent = "+500";
      element.append(duck, label);
      return element;
    }
    element.className = "rising-bubble";
    const cue = BUBBLE_CUES[bubbleSymbol(bubble)];
    const symbol = document.createElement("i");
    symbol.className = "bubble-cue";
    symbol.textContent = cue.glyph;
    symbol.setAttribute("aria-hidden", "true");
    const label = document.createElement("small");
    label.className = "bubble-label";
    label.textContent = cue.label;
    element.append(symbol, label);
    return element;
  }

  private clearBubbleElements(): void {
    for (const element of this.bubbleElements.values()) element.remove();
    this.bubbleElements.clear();
  }

  private playfieldDimensions(
    layer = this.root?.querySelector<HTMLElement>("[data-bubble-layer]") ?? null,
  ): BubblePlayfield {
    const bounds = layer?.getBoundingClientRect();
    return {
      width: bounds && bounds.width > 0 ? bounds.width : 100,
      height: bounds && bounds.height > 0 ? bounds.height : 100,
    };
  }

  private emitFeedback(
    action: MinigameSoundAction,
    value?: number,
    haptic?: HapticPattern,
  ): void {
    this.context?.audio?.emit(action, value);
    if (haptic) this.context?.haptics?.impact(haptic);
  }

  private flashMessage(text: string, kind: "star" | "danger" | "bonus"): void {
    if (!this.root) return;
    const message = this.root.querySelector<HTMLElement>("[data-flash]");
    if (!message) return;
    message.textContent = text;
    message.className = `bubble-flash ${kind} active`;
    this.schedule(() => {
      if (message.isConnected) message.classList.remove("active");
    }, 700);
  }

  private burst(source: HTMLElement, color: string, count: number): void {
    if (!this.root) return;
    const layer = this.root.querySelector<HTMLElement>("[data-particles]");
    if (!layer) return;
    const sourceBox = source.getBoundingClientRect();
    const rootBox = this.root.getBoundingClientRect();
    const x = sourceBox.left - rootBox.left + sourceBox.width / 2;
    const y = sourceBox.top - rootBox.top + sourceBox.height / 2;
    for (let index = 0; index < count; index += 1) {
      const particle = document.createElement("i");
      particle.className = "bubble-particle";
      const angle = (Math.PI * 2 * index) / count;
      const distance = 30 + (index % 4) * 14;
      particle.style.left = `${x}px`;
      particle.style.top = `${y}px`;
      particle.style.background = color;
      particle.style.setProperty("--tx", `${Math.cos(angle) * distance}px`);
      particle.style.setProperty("--ty", `${Math.sin(angle) * distance}px`);
      layer.append(particle);
      this.schedule(() => particle.remove(), 720);
    }
  }

  private schedule(callback: () => void, delayMs: number): void {
    const timeout = window.setTimeout(() => {
      this.scheduled.delete(timeout);
      callback();
    }, delayMs);
    this.scheduled.add(timeout);
  }

  private markup(): string {
    return `
      <style>${bubbleStyles}</style>
      <div class="bath-sky" aria-hidden="true"><i></i><i></i><i></i></div>
      <header class="bubble-hud">
        <div><small>TIME</small><strong data-time>${GAME_SECONDS}s</strong></div>
        <div class="score-pill"><small>SCORE</small><strong data-score>0</strong></div>
        <div><small>BURSTS</small><strong data-stars>★ 0</strong></div>
        <button class="round-button" data-action="pause" aria-label="Pause">Ⅱ</button>
      </header>
      <div class="combo-ribbon" data-combo>MAKE A CHAIN</div>
      <main class="bath-tub">
        <div class="tile-lines" aria-hidden="true"></div>
        <div class="gooby-bather" aria-label="Gooby enjoying a bubble bath">
          <i class="ear left"></i><i class="ear right"></i>
          <div class="gooby-face"><b></b><b></b><em>ᴗ</em></div>
        </div>
        <div class="water"><i></i><i></i><i></i><i></i></div>
        <div class="bubble-layer" data-bubble-layer></div>
        <div class="tub-front"><strong>GOOBY'S<br>BUBBLE CLUB</strong></div>
      </main>
      <div class="bubble-flash" data-flash role="status"></div>
      <div class="particle-layer" data-particles aria-hidden="true"></div>
      <section class="game-panel tutorial" data-panel="tutorial">
        <div class="panel-card">
          <span class="eyebrow">SPLASH OR ZEN</span>
          <h1>Bubble Bath<br><em>Blast!</em></h1>
          <p>Tap one bubble to pop every touching match with the <b>same symbol, color, shape, and pattern.</b></p>
          <div class="tutorial-row">
            <div><span class="chain-demo">★★★★</span><b>4+ matching stars</b><small>Color + shape + pattern</small></div>
            <div><span class="soap-demo">🦆</span><b>Duck bonus</b><small>+500 points</small></div>
          </div>
          <button class="primary" data-action="begin">START SPLASHING</button>
          <button class="secondary" data-action="begin-zen">∞ ZEN · NO TIMER · HALF REWARDS</button>
          <button class="secondary" data-action="quit">LEAVE THE BATH</button>
        </div>
      </section>
      <section class="game-panel" data-panel="pause" hidden>
        <div class="panel-card compact">
          <span class="eyebrow">TOWEL BREAK</span><h2>Paused</h2>
          <p>The bubbles will wait right here.</p>
          <button class="primary" data-action="resume">BACK TO THE BATH</button>
          <button class="secondary" data-action="quit">QUIT &amp; KEEP SCORE</button>
        </div>
      </section>
      <section class="game-panel" data-panel="result" hidden>
        <div class="panel-card compact result-card">
          <span class="result-star">★</span><h2>Sparkling clean!</h2>
          <strong class="big-score" data-result-score>0</strong><small>FINAL SCORE</small>
          <p data-result-reward>+0 coins · +0 XP</p>
          <div class="best-line" data-result-best>Best 0</div>
          <button class="primary" data-action="again">SPLASH AGAIN</button>
        </div>
      </section>
    `;
  }
}

export const createBubbleBathBlast = (): MinigameModule => new BubbleBathBlastGame();

const bubbleStyles = `
  .bubble-blast{position:relative;isolation:isolate;width:100%;height:100%;min-height:620px;overflow:hidden;color:#23334c;background:linear-gradient(#d8f7ff 0 58%,#91def0 58% 100%);font-family:Nunito,ui-rounded,"Arial Rounded MT Bold",system-ui,sans-serif;touch-action:manipulation;user-select:none}
  .bubble-blast *{box-sizing:border-box}.bubble-blast button{min-width:44px;min-height:44px;font:inherit}.bubble-blast button:focus-visible{outline:3px solid #23334c;outline-offset:3px}
  .bath-sky{position:absolute;inset:0;background:radial-gradient(circle at 78% 10%,#fff9 0 8%,transparent 8.5%),linear-gradient(135deg,#d9f9ff,#b8edfa)}
  .bath-sky>i{position:absolute;width:28px;height:28px;border-radius:50%;border:3px solid #fff9;animation:ambientFloat 5s ease-in-out infinite}.bath-sky>i:nth-child(1){left:9%;top:19%}.bath-sky>i:nth-child(2){right:12%;top:32%;animation-delay:-2s}.bath-sky>i:nth-child(3){left:21%;top:43%;width:16px;height:16px;animation-delay:-3s}
  .bubble-hud{position:absolute;z-index:12;top:max(14px,env(safe-area-inset-top));left:14px;right:14px;display:grid;grid-template-columns:1fr 1.15fr 1fr 44px;gap:7px;align-items:center}
  .bubble-hud>div{min-width:0;padding:7px 8px;text-align:center;border:2px solid #fff9;border-radius:15px;background:#ffffffc9;box-shadow:0 5px 0 #56a9be33;backdrop-filter:blur(8px)}.bubble-hud small{display:block;font-size:9px;font-weight:900;letter-spacing:.12em;color:#638599}.bubble-hud strong{display:block;font-size:18px;line-height:1.1}.bubble-hud .urgent{color:#eb3f69;animation:urgentPulse .6s infinite alternate}.score-pill{transform:translateY(4px);border-color:#ffe587!important;background:#fff8d9!important}.round-button{width:44px;height:44px;border:2px solid #fff;border-radius:50%;color:#26435a;background:#ffffffd9;box-shadow:0 5px 0 #5babc2;cursor:pointer;font-weight:1000}
  .combo-ribbon{position:absolute;z-index:10;top:92px;left:50%;transform:translateX(-50%);padding:5px 14px;border-radius:99px;color:#46798b;background:#fff9;font-size:10px;font-weight:1000;letter-spacing:.14em;transition:.2s}.combo-ribbon.hot{color:#7c5200;background:#ffe879;box-shadow:0 0 20px #ffd84a;transform:translateX(-50%) scale(1.08)}
  .bath-tub{position:absolute;inset:112px 0 0;overflow:hidden}.tile-lines{position:absolute;inset:0;background:linear-gradient(#fff3 2px,transparent 2px),linear-gradient(90deg,#fff3 2px,transparent 2px);background-size:62px 62px;mask-image:linear-gradient(#000,transparent 74%)}
  .gooby-bather{position:absolute;z-index:2;left:50%;bottom:20%;width:145px;height:148px;transform:translateX(-50%);animation:goobyBob 2.3s ease-in-out infinite}.ear{position:absolute;top:0;width:42px;height:88px;border:6px solid #f5c99e;border-radius:50% 50% 44% 44%;background:linear-gradient(90deg,#fff5df,#f4d6ad)}.ear:after{content:"";position:absolute;inset:14px 10px;border-radius:50%;background:#f5a8ae}.ear.left{left:21px;transform:rotate(-11deg)}.ear.right{right:21px;transform:rotate(13deg)}
  .gooby-face{position:absolute;left:9px;right:9px;bottom:0;height:105px;border:6px solid #eabf93;border-radius:50% 50% 44% 44%;background:radial-gradient(circle at 27% 64%,#ffb4aa 0 8%,transparent 8.5%),radial-gradient(circle at 73% 64%,#ffb4aa 0 8%,transparent 8.5%),linear-gradient(135deg,#fff9e9,#f3d3aa);box-shadow:inset -12px -9px #efc391}.gooby-face b{position:absolute;top:42%;width:11px;height:15px;border-radius:50%;background:#25304a}.gooby-face b:first-child{left:29%}.gooby-face b:nth-child(2){right:29%}.gooby-face em{position:absolute;left:50%;top:57%;transform:translateX(-50%);font-style:normal;font-weight:1000;font-size:23px}
  .water{position:absolute;z-index:3;left:-10%;right:-10%;bottom:7%;height:29%;border-radius:48% 48% 0 0;background:linear-gradient(#bff8ff,#5ccbe7);box-shadow:inset 0 13px #eaffffcc}.water i{position:absolute;width:70px;height:35px;border-radius:50%;background:#ecffff;animation:foam 3s ease-in-out infinite}.water i:nth-child(1){left:17%;top:-5%}.water i:nth-child(2){left:34%;top:5%;animation-delay:-1s}.water i:nth-child(3){right:28%;top:-2%;animation-delay:-2s}.water i:nth-child(4){right:11%;top:9%;animation-delay:-.5s}
  .tub-front{position:absolute;z-index:7;left:4%;right:4%;bottom:-4%;height:23%;border:7px solid #f2b9a6;border-radius:27px 27px 50% 50%;background:linear-gradient(#fff7f0,#ffd9cd);box-shadow:inset 0 11px #fff,0 -8px 0 #579eb5}.tub-front strong{position:absolute;right:9%;top:30%;transform:rotate(-4deg);font-size:13px;line-height:1;color:#df7890;text-align:center}
  .bubble-layer{position:absolute;z-index:6;inset:0 3% 10%}.rising-bubble,.soap-block,.rubber-duck{position:absolute;transform:translate(-50%,-50%);border:0;cursor:pointer}.rising-bubble{min-width:44px;min-height:44px;overflow:hidden;border-radius:50%;color:#23334c;background:radial-gradient(circle at 32% 24%,#fff 0 8%,#fff8 9% 15%,transparent 16%),radial-gradient(circle at 60% 70%,var(--bubble),#ffffff55);border:3px solid color-mix(in srgb,var(--bubble) 70%,white);box-shadow:inset -8px -9px 12px #2d5b7a28,0 5px 8px #408aa43d;animation:bubbleBreathe 1.5s ease-in-out infinite}.rising-bubble:active{transform:translate(-50%,-50%) scale(.82)}.rising-bubble:after{content:"";position:absolute;inset:7%;border-radius:50%;pointer-events:none;opacity:.42}.rising-bubble[data-pattern="stripes"]:after{background:repeating-linear-gradient(135deg,#fff 0 2px,transparent 2px 6px)}.rising-bubble[data-pattern="dots"]:after{background:radial-gradient(#fff 0 1.5px,transparent 2px);background-size:7px 7px}.rising-bubble[data-pattern="waves"]:after{background:repeating-radial-gradient(ellipse at 50% 120%,transparent 0 4px,#fff 5px 6px,transparent 7px 10px)}.rising-bubble[data-pattern="grid"]:after{background:linear-gradient(#fff8 1px,transparent 1px),linear-gradient(90deg,#fff8 1px,transparent 1px);background-size:7px 7px}.rising-bubble[data-pattern="rings"]:after{border:2px double #fff;background:radial-gradient(circle,transparent 0 24%,#fff8 26% 31%,transparent 33%)}.rising-bubble .bubble-cue{position:absolute;z-index:2;left:50%;top:46%;transform:translate(-50%,-50%);font-size:clamp(12px,45%,23px);line-height:1;font-style:normal;text-shadow:0 1px #fff}.rising-bubble .bubble-label{position:absolute;z-index:2;left:50%;bottom:12%;transform:translateX(-50%);font-size:clamp(5px,16%,8px);font-weight:1000;line-height:1;letter-spacing:.04em;text-transform:uppercase}
  .soap-block{min-width:32px;border:3px solid #445068;border-radius:22%;color:white;background:linear-gradient(135deg,#758198,#29374e);box-shadow:inset 4px 4px #a8b0bf,0 7px 0 #172236;transform:translate(-50%,-50%) rotate(6deg)}.soap-block i{display:block;font-size:22px;line-height:.8;font-style:normal}.soap-block small{font-size:7px;font-weight:1000}
  .rubber-duck{display:grid;place-items:center;min-width:48px;min-height:48px;border:3px solid #fff;border-radius:50%;background:#ffe981;box-shadow:0 6px 0 #d2a532}.rubber-duck i{font-size:24px;font-style:normal}.rubber-duck small{position:absolute;bottom:1px;font-size:8px;font-weight:1000;color:#745500}
  .bubble-flash{position:absolute;z-index:18;left:50%;top:27%;transform:translate(-50%,-50%) scale(.5);padding:9px 15px;border-radius:16px;opacity:0;font-size:20px;font-weight:1000;white-space:nowrap;pointer-events:none}.bubble-flash.active{animation:flashPop .7s ease-out}.bubble-flash.star{color:#7a4d00;background:#ffe76b;border:3px solid #fff}.bubble-flash.danger{color:#fff;background:#e84362;border:3px solid #fff}
  .bubble-flash.bonus{color:#624900;background:#ffe56b;border:3px solid #fff}
  .particle-layer{position:absolute;z-index:30;inset:0;pointer-events:none}.bubble-particle{position:absolute;width:10px;height:10px;border-radius:50%;animation:particleFly .7s ease-out forwards}
  .game-panel{position:absolute;z-index:40;inset:0;display:grid;place-items:center;padding:24px;background:linear-gradient(#57a8c6a8,#274a6bd4);backdrop-filter:blur(5px)}.game-panel[hidden]{display:none}.panel-card{width:min(100%,410px);padding:26px 22px 22px;border:4px solid #fff;border-radius:30px;text-align:center;background:linear-gradient(#fff,#eefcff);box-shadow:0 14px 0 #356b85,0 22px 50px #1a3d5d66;animation:panelIn .35s cubic-bezier(.2,1.45,.35,1)}.panel-card.compact{padding-top:32px}.eyebrow{display:inline-block;padding:5px 10px;border-radius:99px;color:#1f718b;background:#c9f5ff;font-size:10px;font-weight:1000;letter-spacing:.13em}.panel-card h1{margin:10px 0 9px;font-size:42px;line-height:.84;letter-spacing:-.06em;color:#284461;text-shadow:0 3px #fff}.panel-card h1 em{color:#ed6b93;font-style:normal}.panel-card h2{margin:8px 0;font-size:34px;color:#294762}.panel-card p{margin:11px auto 18px;max-width:320px;line-height:1.35;color:#526d7f}.tutorial-row{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:20px}.tutorial-row>div{padding:12px 7px;border-radius:18px;background:#e9f9fb}.tutorial-row b,.tutorial-row small{display:block}.tutorial-row b{font-size:12px}.tutorial-row small{font-size:10px;color:#6d8797}.chain-demo{display:block;margin:3px;color:#ee6f95;font-size:20px;letter-spacing:-5px}.soap-demo{display:grid;place-items:center;width:31px;height:31px;margin:0 auto 4px;border-radius:7px;color:white;background:#344159;font-weight:1000;transform:rotate(5deg)}
  .primary,.secondary{width:100%;min-height:52px;border-radius:17px;font-weight:1000;letter-spacing:.04em;cursor:pointer}.primary{border:0;color:#fff;background:linear-gradient(#ff88a6,#ed5e84);box-shadow:0 6px 0 #bd3e68}.primary:active{transform:translateY(4px);box-shadow:0 2px 0 #bd3e68}.secondary{margin-top:12px;border:2px solid #b7d6df;color:#46697c;background:#fff}.result-star{display:grid;place-items:center;width:72px;height:72px;margin:-62px auto 10px;border:5px solid #fff;border-radius:50%;color:#fff;background:#ffd552;box-shadow:0 6px 0 #d6a728;font-size:40px}.big-score{display:block;color:#ed6489;font-size:48px;line-height:1}.result-card>small{font-size:10px;font-weight:1000;letter-spacing:.15em;color:#7b94a0}.best-line{margin:0 0 18px;padding:10px;border-radius:12px;background:#e7f7fa;font-size:12px;font-weight:900;color:#4e7385}
  @keyframes ambientFloat{50%{transform:translateY(-16px)}}@keyframes goobyBob{50%{transform:translate(-50%,7px) rotate(1deg)}}@keyframes foam{50%{transform:translateX(12px) scale(1.08)}}@keyframes bubbleBreathe{50%{scale:1.045}}@keyframes urgentPulse{to{transform:scale(1.16)}}@keyframes flashPop{0%{opacity:0;transform:translate(-50%,-50%) scale(.4)}25%{opacity:1;transform:translate(-50%,-50%) scale(1.1)}75%{opacity:1}100%{opacity:0;transform:translate(-50%,-85%) scale(1)}}@keyframes particleFly{to{opacity:0;transform:translate(var(--tx),var(--ty)) scale(.2)}}@keyframes panelIn{from{opacity:0;transform:scale(.82) translateY(20px)}}
  .bubble-blast[data-reduced-motion="true"] *{animation-duration:.001ms!important;animation-iteration-count:1!important;transition-duration:.001ms!important}@media(prefers-reduced-motion:reduce){.bubble-blast *{animation-duration:.001ms!important;animation-iteration-count:1!important;transition-duration:.001ms!important}}
  @media (max-height:700px){.bubble-blast{min-height:500px}.bubble-hud{top:8px}.bath-tub{inset:92px 0 0}.combo-ribbon{top:70px}.panel-card{padding:18px}.panel-card h1{font-size:35px}.tutorial-row{margin-bottom:13px}}
`;
