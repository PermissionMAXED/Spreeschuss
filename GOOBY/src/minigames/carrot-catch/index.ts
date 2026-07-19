import type {
  MinigameContext,
  MinigameLifecycle,
  MinigameManifest,
  MinigameModule,
  MinigamePayout,
} from "../../core/contracts/minigame";
import { validateMinigameManifest } from "../../core/contracts/minigame";
import { SeededRng } from "../../core/contracts/rng";
import type { MinigameSoundAction } from "../../audio/contracts";
import type { MinigameStubDefinition } from "../stub";
import {
  BASKET_HALF_WIDTH,
  CarrotCatchSimulation,
  carrotCatchPayout,
  type CatchEvent,
} from "./logic";
import { MinigameRunSession } from "./run-session";

/** Final launch manifest in the frozen CP1 shape, localized in both languages. */
export const manifest: MinigameManifest = validateMinigameManifest({
  id: "carrot-catch",
  title: { en: "Carrot Catch", de: "Karottenfangen" },
  instructions: {
    en: "Catch the sweetest carrots before they touch the grass.",
    de: "Fange die süßesten Karotten, bevor sie das Gras berühren.",
  },
  icon: "🥕",
  category: "action",
  stage3d: false,
  unlockLevel: 1,
  audioCues: ["go", "hit", "miss", "combo", "countdown", "score", "win"],
  tutorial: [
    {
      icon: "🥕",
      title: { en: "Catch the carrots", de: "Fange die Karotten" },
      body: {
        en: "Slide or steer with the arrow keys to guide the basket under every falling carrot.",
        de: "Wische oder steuere mit den Pfeiltasten, um den Korb unter jede fallende Karotte zu lenken.",
      },
    },
    {
      icon: "✨",
      title: { en: "Golden frenzy", de: "Goldener Rausch" },
      body: {
        en: "Every 20 clean catches opens a golden frenzy that doubles every point you earn.",
        de: "Alle 20 sauberen Fänge beginnt ein goldener Rausch, der jeden Punkt verdoppelt.",
      },
    },
    {
      icon: "☂",
      title: { en: "Umbrella basket", de: "Schirmkorb" },
      body: {
        en: "Catch an umbrella to open a wide basket for six forgiving seconds.",
        de: "Fange einen Schirm und öffne für sechs großzügige Sekunden einen breiten Korb.",
      },
    },
    {
      icon: "🌬",
      title: { en: "Mind the wind", de: "Achte auf den Wind" },
      body: {
        en: "Late in the run, marked gusts push carrots sideways. Watch the wind arrows.",
        de: "Spät im Lauf schieben angekündigte Böen die Karotten zur Seite. Achte auf die Windpfeile.",
      },
    },
  ],
});

interface InjectedMinigameContext extends MinigameContext {
  readonly lifecycle: MinigameLifecycle;
  readonly audio?: {
    emit(action: MinigameSoundAction, value?: number): void;
  };
  readonly reducedMotion?: boolean;
}

function requiredElement<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Carrot Catch is missing ${selector}`);
  return element;
}

function seedFromRunId(runId: string): number {
  let seed = 0x811c9dc5;
  for (const character of runId) {
    seed ^= character.charCodeAt(0);
    seed = Math.imul(seed, 0x01000193);
  }
  return seed >>> 0;
}

/** Basket travel per second while a steering key is held (field widths). */
const KEYBOARD_BASKET_SPEED = 0.6;

function keyDirection(key: string): "left" | "right" | null {
  const lowered = key.toLowerCase();
  if (lowered === "arrowleft" || lowered === "a") return "left";
  if (lowered === "arrowright" || lowered === "d") return "right";
  return null;
}

const ITEM_MARKS: Readonly<Record<string, string>> = {
  carrot: "",
  golden: "✦",
  rotten: "✕",
  umbrella: "☂",
};

export class CarrotCatchMinigame implements MinigameModule {
  public readonly id = "carrot-catch" as const;
  public readonly title = "Carrot Catch";
  public readonly instructions = "Guide the basket, build a combo, and dodge rotten carrots for 75 seconds.";

  private context: MinigameContext | null = null;
  private root: HTMLElement | null = null;
  private field: HTMLElement | null = null;
  private itemLayer: HTMLElement | null = null;
  private effectLayer: HTMLElement | null = null;
  private simulation: CarrotCatchSimulation | null = null;
  private session: MinigameRunSession | null = null;
  private injected: InjectedMinigameContext | null = null;
  private cosmeticRng = new SeededRng(0xcca7);
  private listeners: AbortController | null = null;
  private running = false;
  private ended = false;
  private notified = false;
  private highScore = 0;
  private dangerNotified = false;
  private readonly heldKeys = new Set<"left" | "right">();

  public mount(context: MinigameContext): void {
    this.dispose();
    if (!context.lifecycle) throw new Error("Carrot Catch requires the minigame lifecycle");
    this.context = context;
    this.injected = context as InjectedMinigameContext;
    this.session = new MinigameRunSession(context.lifecycle);
    this.highScore = this.session.persistedBest;
    this.listeners = new AbortController();

    const root = context.mount.ownerDocument.createElement("section");
    root.className = "cc-game";
    root.classList.toggle("reduced-motion", this.injected.reducedMotion === true);
    root.dataset.minigame = this.id;
    root.tabIndex = 0;
    root.innerHTML = `
      <style>
        .cc-game{position:relative;width:100%;height:100%;min-height:560px;overflow:hidden;touch-action:none;user-select:none;color:#503524;background:linear-gradient(#91d9ed 0 43%,#bfe888 43% 73%,#79bd58 73%);font-family:ui-rounded,"SF Pro Rounded",system-ui,sans-serif;isolation:isolate}
        .cc-game *{box-sizing:border-box}.cc-sun{position:absolute;top:8%;right:10%;width:74px;aspect-ratio:1;border-radius:50%;background:#fff1a9;box-shadow:0 0 45px #fff4a9aa}
        .cc-cloud{position:absolute;width:120px;height:35px;border-radius:40px;background:#fff9;filter:blur(.2px)}.cc-cloud:before,.cc-cloud:after{content:"";position:absolute;border-radius:50%;background:inherit}.cc-cloud:before{width:50px;height:50px;left:18px;bottom:0}.cc-cloud:after{width:65px;height:65px;right:12px;bottom:0}.cc-cloud.one{top:19%;left:-24px}.cc-cloud.two{top:31%;right:-42px;transform:scale(.7)}
        .cc-field{position:absolute;inset:0;overflow:hidden}.cc-items,.cc-effects{position:absolute;inset:0;pointer-events:none}.cc-items{z-index:3}.cc-effects{z-index:8}
        .cc-hud{position:absolute;z-index:10;top:max(12px,env(safe-area-inset-top));left:12px;right:12px;display:grid;grid-template-columns:1fr auto 1fr;gap:8px;align-items:start}
        .cc-card{padding:8px 11px;border:1px solid #fff9;border-radius:15px;background:#fffbeedb;box-shadow:0 8px 20px #456b3b22;backdrop-filter:blur(8px)}.cc-label{display:block;color:#9a714d;font-size:8px;font-weight:900;letter-spacing:1.2px;text-transform:uppercase}.cc-value{font-size:19px;font-weight:950}.cc-score{text-align:left}.cc-time{min-width:76px;text-align:center}.cc-best{text-align:right}.cc-time.danger{color:#c94f3f;animation:cc-pulse .65s infinite alternate}
        .cc-combo{position:absolute;z-index:9;top:13%;left:50%;transform:translateX(-50%) scale(.9);padding:5px 13px;border-radius:99px;color:white;background:#e87949dd;font-size:13px;font-weight:950;opacity:0;transition:160ms}.cc-combo.show{transform:translateX(-50%) scale(1);opacity:1}.cc-wave{position:absolute;z-index:9;top:19%;left:50%;transform:translateX(-50%);padding:8px 17px;border-radius:99px;color:#7b5412;background:linear-gradient(90deg,#ffe36e,#fff4ae);box-shadow:0 5px 20px #d9a62a66;font-size:12px;font-weight:950;letter-spacing:.7px;animation:cc-wave .55s ease-in-out infinite alternate}
        .cc-wave[hidden]{display:none}.cc-drop{--x:.5;--y:0;--r:0;position:absolute;left:calc(var(--x)*100%);top:calc(var(--y)*100%);display:block;width:25px;height:54px;transform:translate(-50%,-50%) rotate(calc(var(--r)*1deg));border-radius:55% 45% 55% 45%;background:linear-gradient(90deg,#f39431,#ed6828);box-shadow:inset -5px -3px #c9471d55,0 5px 8px #5553}.cc-drop:before,.cc-drop:after{content:"";position:absolute;top:-13px;width:11px;height:22px;border-radius:90% 10% 80% 10%;background:#4eaa50}.cc-drop:before{left:3px;transform:rotate(-28deg)}.cc-drop:after{right:2px;transform:rotate(32deg)}.cc-drop b{position:absolute;top:17px;left:6px;width:10px;height:2px;border-radius:2px;background:#be4d2644;box-shadow:2px 10px #be4d2644}
        .cc-golden{background:linear-gradient(90deg,#fff480,#efb51e);filter:drop-shadow(0 0 8px #fff38d);box-shadow:inset -5px -3px #ad751455,0 0 16px #ffe35c}.cc-rotten{background:linear-gradient(90deg,#75814b,#4d5938);box-shadow:inset -5px -3px #27351f66,0 5px 8px #5553}.cc-rotten:before,.cc-rotten:after{background:#7a6a45}
        .cc-drop u{position:absolute;top:18px;left:50%;transform:translateX(-50%);color:#fff;font-size:13px;font-weight:950;font-style:normal;text-decoration:none;text-shadow:0 1px 2px #4238}.cc-umbrella{width:42px;height:46px;border-radius:50% 50% 8% 8%;background:linear-gradient(90deg,#7fc4e8,#4b8fd0);box-shadow:inset -6px -4px #2f6ea355,0 5px 8px #5553}.cc-umbrella:before,.cc-umbrella:after{content:none}.cc-umbrella u{top:8px;font-size:19px}
        .cc-basket{--x:.5;position:absolute;z-index:5;bottom:4.5%;left:calc(var(--x)*100%);width:34%;height:78px;transform:translateX(-50%);border-radius:11px 11px 35px 35px;background:repeating-linear-gradient(105deg,#bd7534 0 12px,#d9954c 12px 24px);border:7px solid #8d572a;box-shadow:inset 0 12px #f2b76b66,0 13px 18px #3f5d2f44;transition:width 220ms}.cc-basket:before{content:"";position:absolute;left:12%;right:12%;top:-42px;height:57px;border:7px solid #8d572a;border-bottom:0;border-radius:55px 55px 0 0}
        .cc-basket.wide{width:51%;border-color:#4b8fd0;box-shadow:inset 0 12px #bfe2f7aa,0 13px 18px #3f5d2f44}.cc-basket .cc-umbrella-badge{position:absolute;top:-64px;left:50%;transform:translateX(-50%);padding:2px 9px;border-radius:99px;color:#fff;background:#4b8fd0dd;font-size:11px;font-weight:950;white-space:nowrap}.cc-basket .cc-umbrella-badge[hidden]{display:none}
        .cc-wind{position:absolute;z-index:9;top:25%;left:50%;transform:translateX(-50%);padding:6px 14px;border-radius:99px;color:#274a63;background:#dff0fbe8;box-shadow:0 5px 16px #2d4c6444;font-size:12px;font-weight:950;letter-spacing:.7px}.cc-wind[hidden]{display:none}
        .cc-grass{position:absolute;z-index:2;bottom:0;width:100%;height:10%;background:linear-gradient(#69aa4b,#498f40)}.cc-grass:before{content:"";position:absolute;top:-18px;left:-2%;width:104%;height:28px;background:linear-gradient(135deg,transparent 35%,#69aa4b 36% 64%,transparent 65%) 0 0/31px 31px}
        .cc-particle{--px:50%;--py:50%;--dx:0px;position:absolute;left:var(--px);top:var(--py);color:#fff;font-size:17px;font-weight:950;text-shadow:0 2px 4px #693d;animation:cc-pop .65s ease-out forwards}.cc-particle.bad{color:#493d35}.cc-particle.gold{color:#ffe665;font-size:23px}
        .cc-controls{position:absolute;z-index:12;right:max(10px,env(safe-area-inset-right));bottom:max(10px,env(safe-area-inset-bottom));display:flex;gap:6px}.cc-icon-button{display:grid;width:44px;min-height:44px;aspect-ratio:1;place-items:center;border:1px solid #fff9;border-radius:50%;color:#604631;background:#fffbeedd;box-shadow:0 5px 14px #36552c33;font-size:17px;font-weight:900}
        .cc-overlay{position:absolute;z-index:30;inset:0;display:grid;place-items:center;padding:max(24px,env(safe-area-inset-top)) max(24px,env(safe-area-inset-right)) max(24px,env(safe-area-inset-bottom)) max(24px,env(safe-area-inset-left));background:#31544099;backdrop-filter:blur(8px)}.cc-overlay[hidden]{display:none}.cc-panel{width:min(100%,340px);padding:27px 24px 22px;border:1px solid #fff9;border-radius:27px;color:#513a2b;background:linear-gradient(145deg,#fffdf1,#ffedc7);box-shadow:0 22px 65px #253d2f66;text-align:center}.cc-panel .cc-hero{font-size:54px}.cc-panel h2{margin:7px 0 8px;font-size:27px;letter-spacing:-.7px}.cc-panel p{margin:0 0 18px;color:#795f4e;font-size:13px;line-height:1.5}.cc-tips{display:grid;gap:7px;margin:0 0 18px;text-align:left}.cc-tip{padding:8px 10px;border-radius:11px;background:#efdba077;font-size:11px;font-weight:750}.cc-main-button,.cc-quit-button{width:100%;min-height:49px;border:0;border-radius:16px;color:white;background:linear-gradient(#ee8c44,#db6238);font:900 14px inherit;box-shadow:0 9px 20px #b75b3544}.cc-quit-button{margin-top:8px;color:#795f4e;background:#e7d3b5;box-shadow:none}.cc-result{font-size:35px;font-weight:950}.cc-new-best{color:#d18319;font-size:12px;font-weight:950}
        @keyframes cc-pop{from{opacity:1;transform:translate(-50%,-50%) scale(.65)}to{opacity:0;transform:translate(calc(-50% + var(--dx)),-105px) scale(1.25)}}@keyframes cc-wave{to{transform:translateX(-50%) scale(1.06)}}@keyframes cc-pulse{to{transform:scale(1.08)}}.cc-game.reduced-motion *{animation-duration:1ms!important;transition-duration:1ms!important}@media(prefers-reduced-motion:reduce){.cc-game *{animation-duration:1ms!important;transition-duration:1ms!important}}
      </style>
      <div class="cc-field" aria-label="Carrot Catch play field">
        <div class="cc-sun"></div><div class="cc-cloud one"></div><div class="cc-cloud two"></div>
        <div class="cc-items"></div><div class="cc-grass"></div><div class="cc-basket"><span class="cc-umbrella-badge" data-umbrella hidden>☂ WIDE</span></div><div class="cc-effects"></div>
      </div>
      <header class="cc-hud">
        <div class="cc-card cc-score"><span class="cc-label">Score</span><strong class="cc-value" data-score>0</strong></div>
        <div class="cc-card cc-time"><span class="cc-label">Time</span><strong class="cc-value" data-time>75</strong></div>
        <div class="cc-card cc-best"><span class="cc-label">Best</span><strong class="cc-value" data-best>${this.highScore}</strong></div>
      </header>
      <div class="cc-combo" data-combo>×1 COMBO</div><div class="cc-wave" data-wave hidden>✨ GOLDEN FRENZY ×2 ✨</div><div class="cc-wind" data-wind hidden aria-live="polite">🌬 GUST →</div>
      <nav class="cc-controls"><button class="cc-icon-button" data-pause aria-label="Pause">Ⅱ</button><button class="cc-icon-button" data-quit aria-label="Quit">×</button></nav>
      <div class="cc-overlay" data-tutorial hidden><article class="cc-panel"><div class="cc-hero">🥕</div><span class="cc-label">75 second challenge</span><h2>Carrot Catch</h2><p>Slide anywhere — or hold the ⇦ ⇨ keys — to guide Gooby's basket. Keep clean catches flowing for bigger multipliers.</p><div class="cc-tips"><div class="cc-tip">🥕 Carrots build your combo · marked ✕ ones are rotten</div><div class="cc-tip">✨ Every 20 catches starts a GOLDEN FRENZY at ×2 points</div><div class="cc-tip">☂ Umbrellas open a wide basket for 6 seconds</div><div class="cc-tip">🌬 After 30s, announced gusts push carrots sideways</div></div><button class="cc-main-button" data-play>LET'S CATCH!</button><button class="cc-quit-button" data-tutorial-quit>QUIT TUTORIAL</button></article></div>
      <div class="cc-overlay" data-paused hidden><article class="cc-panel"><div class="cc-hero">🐰</div><h2>Basket break</h2><p>Your combo is safe. Jump back in whenever you're ready.</p><button class="cc-main-button" data-resume>RESUME</button><button class="cc-quit-button" data-pause-quit>QUIT & COLLECT</button></article></div>
      <div class="cc-overlay" data-ended hidden><article class="cc-panel"><div class="cc-hero">🏆</div><span class="cc-label">Final score</span><div class="cc-result" data-result>0</div><div class="cc-new-best" data-new-best hidden>NEW HIGH SCORE!</div><p data-summary></p><button class="cc-main-button" data-done>COLLECT REWARDS</button></article></div>
    `;
    context.mount.replaceChildren(root);
    this.root = root;
    this.field = requiredElement(root, ".cc-field");
    this.itemLayer = requiredElement(root, ".cc-items");
    this.effectLayer = requiredElement(root, ".cc-effects");
    this.bindEvents();
  }

  private bindEvents(): void {
    const root = this.root;
    const field = this.field;
    const signal = this.listeners?.signal;
    if (!root || !field || !signal) return;
    const move = (event: PointerEvent): void => {
      if (!this.running) return;
      const rect = field.getBoundingClientRect();
      this.simulation?.moveBasket((event.clientX - rect.left) / rect.width);
    };
    field.addEventListener("pointerdown", (event) => {
      this.session?.markAction();
      field.setPointerCapture(event.pointerId);
      move(event);
    }, { signal });
    field.addEventListener("pointermove", move, { signal });
    root.addEventListener("keydown", (event) => {
      const direction = keyDirection(event.key);
      if (!direction || event.repeat) return;
      event.preventDefault();
      if (this.running) this.session?.markAction();
      this.heldKeys.add(direction);
    }, { signal });
    root.addEventListener("keyup", (event) => {
      const direction = keyDirection(event.key);
      if (direction) this.heldKeys.delete(direction);
    }, { signal });
    requiredElement<HTMLButtonElement>(root, "[data-play]").addEventListener("click", () => {
      requiredElement<HTMLElement>(root, "[data-tutorial]").hidden = true;
      const runId = this.session?.begin();
      if (!runId) return;
      this.cosmeticRng = new SeededRng(seedFromRunId(runId));
      this.running = true;
      this.dangerNotified = false;
      root.focus();
      this.emitFeedback("go");
    }, { signal });
    requiredElement<HTMLButtonElement>(root, "[data-pause]").addEventListener("click", () => this.pause(), { signal });
    requiredElement<HTMLButtonElement>(root, "[data-resume]").addEventListener("click", () => this.resume(), { signal });
    for (const selector of ["[data-quit]", "[data-pause-quit]", "[data-tutorial-quit]"]) {
      requiredElement<HTMLButtonElement>(root, selector).addEventListener("click", () => this.finishRun("quit"), { signal });
    }
    requiredElement<HTMLButtonElement>(root, "[data-done]").addEventListener("click", () => this.notifyFinish(), { signal });
  }

  public start(): void {
    const context = this.context;
    const root = this.root;
    if (!context || !root) throw new Error("Mount Carrot Catch before starting");
    this.simulation?.dispose();
    this.simulation = new CarrotCatchSimulation(context.rng);
    this.ended = false;
    this.notified = false;
    this.running = false;
    this.dangerNotified = false;
    this.heldKeys.clear();
    requiredElement<HTMLElement>(root, "[data-tutorial]").hidden = false;
    requiredElement<HTMLElement>(root, "[data-paused]").hidden = true;
    requiredElement<HTMLElement>(root, "[data-ended]").hidden = true;
    this.render();
  }

  public pause(): void {
    if (!this.running || this.ended || !this.root) return;
    this.running = false;
    this.heldKeys.clear();
    requiredElement<HTMLElement>(this.root, "[data-paused]").hidden = false;
  }

  public resume(): void {
    if (this.ended || !this.simulation || !this.root) return;
    requiredElement<HTMLElement>(this.root, "[data-paused]").hidden = true;
    this.running = true;
    this.root.focus();
    this.emitFeedback("go");
  }

  public update(deltaSeconds: number): void {
    if (!this.running || this.ended || !this.simulation) {
      this.pruneParticles();
      return;
    }
    const keyboardAxis = (this.heldKeys.has("right") ? 1 : 0) - (this.heldKeys.has("left") ? 1 : 0);
    if (keyboardAxis !== 0 && Number.isFinite(deltaSeconds) && deltaSeconds > 0) {
      this.simulation.moveBasketBy(keyboardAxis * KEYBOARD_BASKET_SPEED * Math.min(0.1, deltaSeconds));
    }
    this.simulation.update(deltaSeconds);
    for (const event of this.simulation.drainEvents()) this.handleEvent(event);
    if (!this.dangerNotified && this.simulation.snapshot().timeLeft <= 10) {
      this.dangerNotified = true;
      this.emitFeedback("countdown");
    }
    this.render();
    this.pruneParticles();
  }

  private handleEvent(event: CatchEvent): void {
    if (event.type === "caught") {
      if (event.kind === "umbrella") {
        this.addParticle(event.x, event.y, "☂ WIDE!", "gold");
        this.emitFeedback("score");
        return;
      }
      const className = event.kind === "rotten" ? "bad" : event.kind === "golden" ? "gold" : "";
      this.addParticle(event.x, event.y, event.points >= 0 ? `+${event.points}` : `${event.points}`, className);
      this.emitFeedback(event.kind === "rotten" ? "miss" : event.kind === "golden" ? "combo" : "hit");
    } else if (event.type === "missed" && (event.kind === "carrot" || event.kind === "golden")) {
      this.addParticle(event.x, 0.92, "MISS", "bad");
      this.emitFeedback("miss");
    } else if (event.type === "bonus-wave") {
      this.emitFeedback("combo", this.simulation?.snapshot().combo);
    } else if (event.type === "gust") {
      this.emitFeedback("countdown");
    } else if (event.type === "finished") {
      this.finishRun("win");
    }
  }

  private addParticle(x: number, y: number, label: string, className: string): void {
    const context = this.context;
    const effectLayer = this.effectLayer;
    if (!context || !effectLayer || this.injected?.reducedMotion === true) return;
    const particle = effectLayer.ownerDocument.createElement("span");
    particle.className = `cc-particle ${className}`;
    particle.textContent = label;
    particle.dataset.expires = String(context.clock.now() + 700);
    particle.style.setProperty("--px", `${x * 100}%`);
    particle.style.setProperty("--py", `${y * 100}%`);
    particle.style.setProperty("--dx", `${(this.cosmeticRng.next() - 0.5) * 48}px`);
    effectLayer.append(particle);
  }

  private pruneParticles(): void {
    const context = this.context;
    if (!context || !this.effectLayer) return;
    for (const particle of this.effectLayer.querySelectorAll<HTMLElement>("[data-expires]")) {
      if (Number(particle.dataset.expires) <= context.clock.now()) particle.remove();
    }
  }

  private render(): void {
    const root = this.root;
    const itemLayer = this.itemLayer;
    const snapshot = this.simulation?.snapshot();
    if (!root || !itemLayer || !snapshot) return;
    requiredElement<HTMLElement>(root, "[data-score]").textContent = String(snapshot.score);
    requiredElement<HTMLElement>(root, "[data-time]").textContent = String(Math.ceil(snapshot.timeLeft));
    requiredElement<HTMLElement>(root, "[data-best]").textContent = String(Math.max(this.highScore, snapshot.score));
    const timeCard = requiredElement<HTMLElement>(root, ".cc-time");
    timeCard.classList.toggle("danger", snapshot.timeLeft <= 10);
    const combo = requiredElement<HTMLElement>(root, "[data-combo]");
    combo.textContent = `×${Math.min(5, 1 + Math.floor(snapshot.combo / 5))} · ${snapshot.combo} COMBO`;
    combo.classList.toggle("show", snapshot.combo >= 2);
    requiredElement<HTMLElement>(root, "[data-wave]").hidden = snapshot.bonusWaveSeconds <= 0;
    const wind = requiredElement<HTMLElement>(root, "[data-wind]");
    wind.hidden = Math.abs(snapshot.windX) < 0.005;
    if (!wind.hidden) {
      const arrow = snapshot.windX > 0 ? "→" : "←";
      wind.textContent = `🌬 GUST ${arrow.repeat(Math.abs(snapshot.windX) > 0.09 ? 2 : 1)}`;
    }
    const basket = requiredElement<HTMLElement>(root, ".cc-basket");
    basket.style.setProperty("--x", String(snapshot.basketX));
    basket.classList.toggle("wide", snapshot.basketHalfWidth > BASKET_HALF_WIDTH);
    const umbrellaBadge = requiredElement<HTMLElement>(root, "[data-umbrella]");
    umbrellaBadge.hidden = snapshot.umbrellaSeconds <= 0;
    if (!umbrellaBadge.hidden) umbrellaBadge.textContent = `☂ WIDE ${Math.ceil(snapshot.umbrellaSeconds)}s`;
    itemLayer.innerHTML = snapshot.items.map((item) =>
      `<i class="cc-drop cc-${item.kind}" style="--x:${item.x};--y:${item.y};--r:${item.spin}"><b></b><u>${ITEM_MARKS[item.kind] ?? ""}</u></i>`
    ).join("");
  }

  private finishRun(outcome: "win" | "quit" = "win"): void {
    if (this.ended || !this.root) return;
    this.running = false;
    this.ended = true;
    this.heldKeys.clear();
    const payout = this.payout();
    const previousBest = this.session?.persistedBest ?? this.highScore;
    const receipt = outcome === "quit"
      ? this.session?.quit(payout) ?? null
      : null;
    const rewardPending = outcome !== "quit";
    const isBest = (receipt !== null || rewardPending) && payout.score > previousBest;
    this.highScore = receipt?.bestScore ?? Math.max(previousBest, rewardPending ? payout.score : 0);
    requiredElement<HTMLElement>(this.root, "[data-paused]").hidden = true;
    requiredElement<HTMLElement>(this.root, "[data-ended]").hidden = false;
    requiredElement<HTMLElement>(this.root, "[data-result]").textContent = payout.score.toLocaleString();
    requiredElement<HTMLElement>(this.root, "[data-new-best]").hidden = !isBest;
    requiredElement<HTMLElement>(this.root, "[data-summary]").textContent =
      receipt || rewardPending
        ? `${payout.coins} coins · ${payout.xp} XP · best combo ${this.simulation?.snapshot().bestCombo ?? 0}`
        : "Run left before an action · no reward";
    if (receipt || rewardPending) this.emitFeedback("win");
  }

  private notifyFinish(): void {
    if (this.notified) return;
    if (!this.ended) this.finishRun("win");
    this.notified = true;
    const receipt = this.session?.complete(this.payout());
    if (receipt) this.highScore = receipt.bestScore;
  }

  public payout(): MinigamePayout {
    const snapshot = this.simulation?.snapshot();
    return carrotCatchPayout(snapshot?.score ?? 0, snapshot?.bestCombo ?? 0);
  }

  private emitFeedback(action: MinigameSoundAction, value?: number): void {
    this.injected?.audio?.emit(action, value);
  }

  public dispose(): void {
    this.running = false;
    this.ended = true;
    this.listeners?.abort();
    this.listeners = null;
    this.session?.exit();
    this.session = null;
    this.simulation?.dispose();
    this.simulation = null;
    this.root?.remove();
    this.root = null;
    this.field = null;
    this.itemLayer = null;
    this.effectLayer = null;
    this.injected = null;
    this.context = null;
  }
}

export const definition = {
  id: manifest.id,
  title: manifest.title.en,
  instructions: "Catch carrots for 75 seconds, chain combos, and dodge the rotten ones.",
  create: (): MinigameModule => new CarrotCatchMinigame(),
} as const satisfies MinigameStubDefinition & { readonly create: () => MinigameModule };
