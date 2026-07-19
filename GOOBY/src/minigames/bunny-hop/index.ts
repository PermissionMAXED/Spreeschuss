import type { MinigameSoundAction } from "../../audio/contracts";
import type {
  MinigameContext,
  MinigameLifecycle,
  MinigameManifest,
  MinigameModule,
  MinigamePayout,
} from "../../core/contracts/minigame";
import { validateMinigameManifest } from "../../core/contracts/minigame";
import { SeededRng } from "../../core/contracts/rng";
import type { MinigameStubDefinition } from "../stub";
import { MinigameRunSession } from "../carrot-catch/run-session";
import {
  BUNNY_VIEW_HEIGHT,
  BUNNY_WORLD_WIDTH,
  BunnyHopSimulation,
  bunnyHopPayout,
  type BunnyHopEvent,
  type BunnyHopVariant,
} from "./logic";

/** Final launch manifest in the frozen CP1 shape, localized in both languages. */
export const manifest: MinigameManifest = validateMinigameManifest({
  id: "bunny-hop",
  title: { en: "Bunny Hop", de: "Hasenhüpfer" },
  instructions: {
    en: "Steer every automatic bounce and climb from the meadow into space.",
    de: "Steuere jeden automatischen Sprung und klettere von der Wiese bis ins Weltall.",
  },
  icon: "🐾",
  category: "action",
  stage3d: false,
  unlockLevel: 1,
  audioCues: ["go", "hit", "combo", "score", "lose", "win"],
  tutorial: [
    {
      icon: "🐾",
      title: { en: "Steer the bounce", de: "Steuere den Sprung" },
      body: {
        en: "Gooby bounces automatically. Touch either side or hold the arrow keys to steer; edges wrap.",
        de: "Gooby springt automatisch. Berühre eine Seite oder halte die Pfeiltasten zum Steuern; die Ränder gehen ineinander über.",
      },
    },
    {
      icon: "🪶",
      title: { en: "Feather double jump", de: "Feder-Doppelsprung" },
      body: {
        en: "Collect feathers, then tap the feather button or press Space while falling to bounce again mid-air.",
        de: "Sammle Federn und tippe den Federknopf oder drücke die Leertaste im Fall, um mitten in der Luft erneut zu springen.",
      },
    },
    {
      icon: "🐦",
      title: { en: "Coyote landings", de: "Faire Landefenster" },
      body: {
        en: "Barely missed an edge? Steer back within a heartbeat and the landing still counts.",
        de: "Knapp an einer Kante vorbei? Steuere blitzschnell zurück und die Landung zählt trotzdem.",
      },
    },
    {
      icon: "🌙",
      title: { en: "Firefly nights", de: "Glühwürmchen-Nächte" },
      body: {
        en: "Every third climb happens at night, guided by gentle fireflies.",
        de: "Jeder dritte Aufstieg findet nachts statt, begleitet von sanften Glühwürmchen.",
      },
    },
  ],
});

function steeringKey(key: string): "left" | "right" | null {
  const lowered = key.toLowerCase();
  if (lowered === "arrowleft" || lowered === "a") return "left";
  if (lowered === "arrowright" || lowered === "d") return "right";
  return null;
}

function isJumpKey(key: string): boolean {
  const lowered = key.toLowerCase();
  return lowered === " " || lowered === "arrowup" || lowered === "w";
}

interface InjectedMinigameContext extends MinigameContext {
  readonly lifecycle: MinigameLifecycle;
  readonly audio?: {
    emit(action: MinigameSoundAction, value?: number): void;
  };
  readonly reducedMotion?: boolean;
}

function requiredElement<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Bunny Hop is missing ${selector}`);
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

export class BunnyHopMinigame implements MinigameModule {
  public readonly id = "bunny-hop" as const;
  public readonly title = "Bunny Hop";
  public readonly instructions = "Steer Gooby's automatic bounce, wrap around the edges, and climb into space.";

  private context: MinigameContext | null = null;
  private root: HTMLElement | null = null;
  private field: HTMLElement | null = null;
  private platformLayer: HTMLElement | null = null;
  private pickupLayer: HTMLElement | null = null;
  private effectLayer: HTMLElement | null = null;
  private simulation: BunnyHopSimulation | null = null;
  private session: MinigameRunSession | null = null;
  private injected: InjectedMinigameContext | null = null;
  private cosmeticRng = new SeededRng(0xb044);
  private listeners: AbortController | null = null;
  private running = false;
  private ended = false;
  private notified = false;
  private highScore = 0;
  private runsStarted = 0;
  private readonly heldKeys = new Set<"left" | "right">();

  public mount(context: MinigameContext): void {
    this.dispose();
    if (!context.lifecycle) throw new Error("Bunny Hop requires the minigame lifecycle");
    this.context = context;
    this.injected = context as InjectedMinigameContext;
    this.session = new MinigameRunSession(context.lifecycle);
    this.highScore = this.session.persistedBest;
    this.listeners = new AbortController();

    const root = context.mount.ownerDocument.createElement("section");
    root.className = "bh-game meadow";
    root.classList.toggle("reduced-motion", this.injected.reducedMotion === true);
    root.dataset.minigame = this.id;
    root.tabIndex = 0;
    root.innerHTML = `
      <style>
        .bh-game{position:relative;width:100%;height:100%;min-height:560px;overflow:hidden;touch-action:none;user-select:none;color:white;background:linear-gradient(#72cce7,#d5f2d2 70%,#7cc365);font-family:ui-rounded,"SF Pro Rounded",system-ui,sans-serif;isolation:isolate;transition:background 1s}
        .bh-game.sunset{background:linear-gradient(#514b98,#e58b88 55%,#f6c27e)}.bh-game.clouds{background:linear-gradient(#355983,#91bad0 58%,#e8f3f5)}.bh-game.space{background:radial-gradient(circle at 20% 18%,#ffffff 0 1px,transparent 2px),radial-gradient(circle at 76% 32%,#fff8ce 0 1px,transparent 2px),radial-gradient(circle at 53% 72%,#ffffff 0 1.5px,transparent 2.5px),linear-gradient(#151534,#30275f 65%,#5e5e9b);background-size:71px 83px,93px 109px,127px 91px,auto}
        .bh-game.night.meadow{background:linear-gradient(#1c2b4d,#28425a 70%,#274a33)}.bh-game.night.sunset{background:linear-gradient(#221f47,#553a5c 55%,#7a5a45)}.bh-game.night.clouds{background:linear-gradient(#131f33,#3a5470 58%,#57707e)}.bh-game.night .bh-haze{background:radial-gradient(circle at 75% 18%,#fdf6c344 0 8%,transparent 27%)}
        .bh-fireflies{position:absolute;inset:0;z-index:2;pointer-events:none;display:none}.bh-game.night .bh-fireflies{display:block}.bh-firefly{position:absolute;width:6px;height:6px;border-radius:50%;background:#ffef9e;box-shadow:0 0 12px 4px #fff09c88;animation:bh-firefly 3.2s ease-in-out infinite alternate}.bh-firefly.f1{top:22%;left:16%}.bh-firefly.f2{top:34%;left:74%;animation-delay:.9s}.bh-firefly.f3{top:56%;left:38%;animation-delay:1.7s}.bh-firefly.f4{top:68%;left:82%;animation-delay:.4s}.bh-firefly.f5{top:45%;left:8%;animation-delay:2.3s}
        .bh-game *{box-sizing:border-box}.bh-field{position:absolute;inset:0;overflow:hidden}.bh-haze{position:absolute;inset:0;background:radial-gradient(circle at 75% 18%,#fffbdc77 0 8%,transparent 27%);pointer-events:none}.bh-platforms,.bh-pickups,.bh-effects{position:absolute;inset:0;pointer-events:none}.bh-platforms{z-index:3}.bh-pickups{z-index:4}.bh-effects{z-index:9}
        .bh-platform{--x:50;--bottom:20;--w:100;position:absolute;left:calc(var(--x)*1%);bottom:calc(var(--bottom)*1%);width:calc(var(--w)*.27%);height:17px;transform:translateX(-50%);border-radius:50% 50% 34% 34%;background:linear-gradient(#8eda6e 0 38%,#795642 40%);box-shadow:inset 0 3px #c8f29f,0 6px 10px #303a4155}.bh-platform:after{content:"";position:absolute;top:12px;left:11%;right:11%;height:14px;border-radius:0 0 50% 50%;background:#8b6247}
        .bh-platform.moving{background:linear-gradient(#7bd6d3 0 38%,#476b78 40%);box-shadow:inset 0 3px #c6ffff,0 6px 10px #303a4155}.bh-platform.moving:before{content:"↔";position:absolute;left:50%;top:-5px;transform:translateX(-50%);color:#fff;font-size:12px;font-weight:950}.bh-platform.crumble{background:linear-gradient(#dfbd73 0 38%,#9a6a43 40%)}.bh-platform.crumble:before{content:"";position:absolute;top:4px;left:42%;width:2px;height:20px;background:#6d4938;transform:rotate(24deg)}.bh-platform.crumbling{animation:bh-crumble .3s both}.bh-platform.spring{background:linear-gradient(#ff9dc1 0 38%,#7b5f85 40%)}.bh-platform.spring:before{content:"";position:absolute;left:32%;right:32%;bottom:12px;height:14px;border:3px solid #f5ddea;border-top:0;transform:skewX(-23deg);box-shadow:7px 0 #f5ddea}
        .bh-bunny{--x:50;--bottom:25;position:absolute;z-index:6;left:calc(var(--x)*1%);bottom:calc(var(--bottom)*1%);width:49px;height:45px;transform:translate(-50%,0);border-radius:48% 48% 44% 44%;background:radial-gradient(circle at 34% 43%,#44342f 0 2px,transparent 3px),radial-gradient(circle at 66% 43%,#44342f 0 2px,transparent 3px),radial-gradient(ellipse at 50% 70%,#fff0d0 0 23%,transparent 25%),#f5d4a8;box-shadow:inset -7px -6px #eeb580,0 8px 10px #313a4644;transition:transform 80ms}.bh-bunny:before,.bh-bunny:after{content:"";position:absolute;z-index:-1;top:-28px;width:15px;height:38px;border-radius:60% 60% 35% 35%;background:#f4d1a4;box-shadow:inset 0 0 0 4px #eeb393}.bh-bunny:before{left:8px;transform:rotate(-12deg)}.bh-bunny:after{right:8px;transform:rotate(15deg)}.bh-bunny.falling{transform:translate(-50%,0) rotate(8deg)}.bh-tail{position:absolute;right:-8px;bottom:5px;width:16px;aspect-ratio:1;border-radius:50%;background:#fff2dc}
        .bh-pickup{--x:50;--bottom:20;position:absolute;left:calc(var(--x)*1%);bottom:calc(var(--bottom)*1%);transform:translateX(-50%);filter:drop-shadow(0 3px 5px #3b355477);animation:bh-float .8s ease-in-out infinite alternate}.bh-pickup.carrot{width:13px;height:29px;border-radius:55% 45% 55% 45%;background:#f28733}.bh-pickup.carrot:before{content:"";position:absolute;top:-8px;left:2px;width:9px;height:11px;border-radius:80% 10%;background:#64b657}.bh-pickup.star{width:28px;height:28px;background:#ffe56f;clip-path:polygon(50% 0,61% 35%,98% 35%,68% 56%,79% 93%,50% 71%,21% 93%,32% 56%,2% 35%,39% 35%)}
        .bh-pickup.feather{width:16px;height:30px;border-radius:90% 8% 90% 8%;background:linear-gradient(160deg,#eef6ff,#9fc6ee);box-shadow:inset -3px 0 #7ca9d8}.bh-pickup.feather:before{content:"";position:absolute;top:4px;bottom:4px;left:50%;width:2px;background:#6f9cc9}.bh-game.night .bh-pickup.feather{box-shadow:inset -3px 0 #7ca9d8,0 0 12px #cfe6ff}
        .bh-jump-button{position:relative;display:grid;width:52px;min-height:52px;place-items:center;border:1px solid #fff8;border-radius:50%;color:white;background:#3f5f8ccc;box-shadow:0 5px 14px #1e2f4633;font-size:20px}.bh-jump-button b{position:absolute;right:-2px;top:-2px;display:grid;width:20px;height:20px;place-items:center;border-radius:50%;background:#ffe56f;color:#4c3a17;font-size:11px;font-weight:950}.bh-jump-button[data-empty="true"]{opacity:.55}
        .bh-hud{position:absolute;z-index:12;top:max(12px,env(safe-area-inset-top));left:12px;right:12px;display:grid;grid-template-columns:1fr auto 1fr;gap:7px;align-items:start}.bh-card{padding:8px 11px;border:1px solid #fff7;border-radius:15px;background:#263d56a6;box-shadow:0 8px 20px #1f2c4933;backdrop-filter:blur(9px)}.bh-card:last-child{text-align:right}.bh-label{display:block;color:#dcecff;font-size:8px;font-weight:900;letter-spacing:1.2px;text-transform:uppercase}.bh-value{font-size:19px;font-weight:950}.bh-band{text-align:center;min-width:91px;color:#fff}.bh-combo{position:absolute;z-index:11;top:12.5%;left:50%;padding:5px 13px;transform:translateX(-50%) scale(.9);border-radius:99px;color:#563c2d;background:#fff1bde8;font-size:12px;font-weight:950;opacity:0;transition:150ms}.bh-combo.show{opacity:1;transform:translateX(-50%) scale(1)}
        .bh-controls{position:absolute;z-index:14;right:max(10px,env(safe-area-inset-right));bottom:max(10px,env(safe-area-inset-bottom));display:flex;gap:6px}.bh-icon-button{display:grid;width:44px;min-height:44px;aspect-ratio:1;place-items:center;border:1px solid #fff8;border-radius:50%;color:white;background:#263d56ad;box-shadow:0 5px 14px #1e2f4633;font-size:17px;font-weight:900}.bh-steer-hint{position:absolute;z-index:7;right:0;bottom:4%;left:0;color:#fffbbb;font-size:10px;font-weight:900;text-align:center;text-shadow:0 2px 4px #273e55;pointer-events:none;opacity:.8}
        .bh-particle{--px:50%;--py:50%;--dx:0px;position:absolute;left:var(--px);bottom:var(--py);color:#fff4a0;font-size:18px;font-weight:950;text-shadow:0 2px 5px #263d56;animation:bh-pop .7s ease-out forwards}.bh-particle.dust{color:#e7dacb;font-size:12px}
        .bh-overlay{position:absolute;z-index:30;inset:0;display:grid;place-items:center;padding:max(24px,env(safe-area-inset-top)) max(24px,env(safe-area-inset-right)) max(24px,env(safe-area-inset-bottom)) max(24px,env(safe-area-inset-left));background:#1e315099;backdrop-filter:blur(8px)}.bh-overlay[hidden]{display:none}.bh-panel{width:min(100%,340px);padding:27px 24px 22px;border:1px solid #fff8;border-radius:27px;color:#453a4f;background:linear-gradient(145deg,#fffdf3,#dff4f0);box-shadow:0 22px 65px #172b4566;text-align:center}.bh-hero{font-size:55px}.bh-panel h2{margin:7px 0 8px;font-size:27px;letter-spacing:-.7px}.bh-panel p{margin:0 0 18px;color:#675d70;font-size:13px;line-height:1.5}.bh-tips{display:grid;gap:7px;margin:0 0 18px;text-align:left}.bh-tip{padding:8px 10px;border-radius:11px;background:#cae8e4aa;font-size:11px;font-weight:750}.bh-main-button,.bh-quit-button{width:100%;min-height:49px;border:0;border-radius:16px;color:white;background:linear-gradient(#6abfc2,#477fa4);font:900 14px inherit;box-shadow:0 9px 20px #356c8644}.bh-quit-button{margin-top:8px;color:#61566a;background:#d8e4df;box-shadow:none}.bh-result{font-size:35px;font-weight:950}.bh-new-best{color:#ce862f;font-size:12px;font-weight:950}
        @keyframes bh-float{to{transform:translateX(-50%) translateY(-7px) rotate(5deg)}}@keyframes bh-pop{from{opacity:1;transform:translate(-50%,0) scale(.7)}to{opacity:0;transform:translate(calc(-50% + var(--dx)),-85px) scale(1.3)}}@keyframes bh-crumble{to{opacity:0;transform:translateX(-50%) translateY(25px) rotate(5deg)}}@keyframes bh-firefly{from{transform:translate(0,0);opacity:.5}to{transform:translate(14px,-18px);opacity:1}}.bh-game.reduced-motion *{animation-duration:1ms!important;transition-duration:1ms!important}@media(prefers-reduced-motion:reduce){.bh-game *{animation-duration:1ms!important;transition-duration:1ms!important}}
      </style>
      <div class="bh-field" aria-label="Bunny Hop play field"><div class="bh-haze"></div><div class="bh-fireflies"><i class="bh-firefly f1"></i><i class="bh-firefly f2"></i><i class="bh-firefly f3"></i><i class="bh-firefly f4"></i><i class="bh-firefly f5"></i></div><div class="bh-platforms"></div><div class="bh-pickups"></div><div class="bh-bunny"><i class="bh-tail"></i></div><div class="bh-effects"></div><div class="bh-steer-hint">TOUCH OR ⇦ ⇨ KEYS TO STEER · SPACE = FEATHER JUMP</div></div>
      <header class="bh-hud"><div class="bh-card"><span class="bh-label">Score</span><strong class="bh-value" data-score>0</strong></div><div class="bh-card bh-band"><span class="bh-label">Altitude</span><strong class="bh-value" data-height>0m</strong></div><div class="bh-card"><span class="bh-label">Best</span><strong class="bh-value" data-best>${this.highScore}</strong></div></header>
      <div class="bh-combo" data-combo>HOP ×0</div><nav class="bh-controls"><button class="bh-jump-button" data-jump aria-label="Feather double jump" data-empty="true">🪶<b data-feathers>0</b></button><button class="bh-icon-button" data-pause aria-label="Pause">Ⅱ</button><button class="bh-icon-button" data-quit aria-label="Quit">×</button></nav>
      <div class="bh-overlay" data-tutorial hidden><article class="bh-panel"><div class="bh-hero">🐰</div><span class="bh-label">Endless sky climb</span><h2>Bunny Hop</h2><p>Gooby bounces automatically. Steer in the air, wrap around either edge, and keep climbing.</p><div class="bh-tips"><div class="bh-tip">↔ Moving clouds drift underfoot</div><div class="bh-tip">🪶 Feathers store a mid-air double jump — Space or the 🪶 button</div><div class="bh-tip">🐦 Near-missed edges stay landable for a heartbeat</div><div class="bh-tip" data-night-tip>🌙 Every third climb is a firefly night flight</div></div><button class="bh-main-button" data-play>HOP TO IT!</button><button class="bh-quit-button" data-tutorial-quit>QUIT TUTORIAL</button></article></div>
      <div class="bh-overlay" data-paused hidden><article class="bh-panel"><div class="bh-hero">☁️</div><h2>Floating break</h2><p>The whole sky is holding still for you.</p><button class="bh-main-button" data-resume>RESUME</button><button class="bh-quit-button" data-pause-quit>QUIT & COLLECT</button></article></div>
      <div class="bh-overlay" data-ended hidden><article class="bh-panel"><div class="bh-hero">🌙</div><span class="bh-label">Flight score</span><div class="bh-result" data-result>0</div><div class="bh-new-best" data-new-best hidden>NEW HIGH SCORE!</div><p data-summary></p><button class="bh-main-button" data-done>COLLECT REWARDS</button></article></div>
    `;
    context.mount.replaceChildren(root);
    this.root = root;
    this.field = requiredElement(root, ".bh-field");
    this.platformLayer = requiredElement(root, ".bh-platforms");
    this.pickupLayer = requiredElement(root, ".bh-pickups");
    this.effectLayer = requiredElement(root, ".bh-effects");
    this.bindEvents();
  }

  private bindEvents(): void {
    const root = this.root;
    const field = this.field;
    const signal = this.listeners?.signal;
    if (!root || !field || !signal) return;
    const steer = (event: PointerEvent): void => {
      if (!this.running) return;
      const rect = field.getBoundingClientRect();
      this.simulation?.setSteering((event.clientX - rect.left) / rect.width);
    };
    field.addEventListener("pointerdown", (event) => {
      this.session?.markAction();
      field.setPointerCapture(event.pointerId);
      steer(event);
    }, { signal });
    field.addEventListener("pointermove", steer, { signal });
    requiredElement<HTMLButtonElement>(root, "[data-jump]").addEventListener("pointerdown", () => {
      if (!this.running) return;
      this.session?.markAction();
      this.simulation?.jump();
    }, { signal });
    root.addEventListener("keydown", (event) => {
      if (isJumpKey(event.key)) {
        event.preventDefault();
        if (!this.running || event.repeat) return;
        this.session?.markAction();
        this.simulation?.jump();
        return;
      }
      const direction = steeringKey(event.key);
      if (!direction || event.repeat) return;
      event.preventDefault();
      if (this.running) this.session?.markAction();
      this.heldKeys.add(direction);
      this.applyKeyboardSteering();
    }, { signal });
    root.addEventListener("keyup", (event) => {
      const direction = steeringKey(event.key);
      if (!direction) return;
      this.heldKeys.delete(direction);
      this.applyKeyboardSteering();
    }, { signal });
    requiredElement<HTMLButtonElement>(root, "[data-play]").addEventListener("click", () => {
      requiredElement<HTMLElement>(root, "[data-tutorial]").hidden = true;
      const runId = this.session?.begin();
      if (!runId) return;
      const context = this.context;
      if (context) {
        this.runsStarted += 1;
        this.simulation?.dispose();
        this.simulation = new BunnyHopSimulation(context.rng, this.variantForRun(this.runsStarted));
      }
      this.cosmeticRng = new SeededRng(seedFromRunId(runId));
      this.running = true;
      root.focus();
      this.render();
      this.emitFeedback("go");
    }, { signal });
    requiredElement<HTMLButtonElement>(root, "[data-pause]").addEventListener("click", () => this.pause(), { signal });
    requiredElement<HTMLButtonElement>(root, "[data-resume]").addEventListener("click", () => this.resume(), { signal });
    for (const selector of ["[data-quit]", "[data-pause-quit]", "[data-tutorial-quit]"]) {
      requiredElement<HTMLButtonElement>(root, selector).addEventListener("click", () => this.finishRun("quit"), { signal });
    }
    requiredElement<HTMLButtonElement>(root, "[data-done]").addEventListener("click", () => this.notifyFinish(), { signal });
  }

  /** Every third climb of a session is the night/firefly variant. */
  private variantForRun(runIndex: number): BunnyHopVariant {
    return runIndex % 3 === 0 ? "night" : "day";
  }

  private applyKeyboardSteering(): void {
    const axis = (this.heldKeys.has("right") ? 1 : 0) - (this.heldKeys.has("left") ? 1 : 0);
    this.simulation?.steerAxis(axis);
  }

  public start(): void {
    const context = this.context;
    const root = this.root;
    if (!context || !root) throw new Error("Mount Bunny Hop before starting");
    this.simulation?.dispose();
    this.simulation = new BunnyHopSimulation(context.rng, this.variantForRun(this.runsStarted + 1));
    this.ended = false;
    this.notified = false;
    this.running = false;
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
    this.simulation?.steerAxis(0);
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
    this.simulation.update(deltaSeconds);
    for (const event of this.simulation.drainEvents()) this.handleEvent(event);
    this.render();
    this.pruneParticles();
  }

  private handleEvent(event: BunnyHopEvent): void {
    if (event.type === "land") {
      const label = event.coyote ? "SAVED!" : event.kind === "spring" ? "BOING!" : "POOF";
      this.addParticle(event.x, event.y, label, event.coyote ? "" : "dust");
      this.emitFeedback(event.kind === "spring" ? "combo" : "hit", this.simulation?.snapshot().combo);
    } else if (event.type === "pickup") {
      this.addParticle(event.x, event.y, event.kind === "feather" ? `+${event.points} 🪶` : `+${event.points}`, "");
      this.emitFeedback(event.kind === "feather" ? "score" : "hit");
    } else if (event.type === "double-jump") {
      this.addParticle(event.x, event.y, "FEATHER!", "");
      this.emitFeedback("combo", this.simulation?.snapshot().combo);
    } else if (event.type === "band") {
      this.addParticle(BUNNY_WORLD_WIDTH / 2, this.simulation?.snapshot().bunnyY ?? event.band.length, event.band.toUpperCase(), "");
      this.emitFeedback("combo", this.simulation?.snapshot().combo);
    } else {
      this.finishRun("lose");
    }
  }

  private addParticle(worldX: number, worldY: number, label: string, className: string): void {
    const context = this.context;
    const effectLayer = this.effectLayer;
    const snapshot = this.simulation?.snapshot();
    if (!context || !effectLayer || !snapshot || this.injected?.reducedMotion === true) return;
    const particle = effectLayer.ownerDocument.createElement("span");
    particle.className = `bh-particle ${className}`;
    particle.textContent = label;
    particle.dataset.expires = String(context.clock.now() + 720);
    particle.style.setProperty("--px", `${worldX / BUNNY_WORLD_WIDTH * 100}%`);
    particle.style.setProperty("--py", `${(worldY - snapshot.cameraBottom) / BUNNY_VIEW_HEIGHT * 100}%`);
    particle.style.setProperty("--dx", `${(this.cosmeticRng.next() - 0.5) * 40}px`);
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
    const platformLayer = this.platformLayer;
    const pickupLayer = this.pickupLayer;
    const snapshot = this.simulation?.snapshot();
    if (!root || !platformLayer || !pickupLayer || !snapshot) return;
    root.classList.remove("meadow", "sunset", "clouds", "space");
    root.classList.add(snapshot.band);
    root.classList.toggle("night", snapshot.variant === "night");
    const jumpButton = requiredElement<HTMLElement>(root, "[data-jump]");
    jumpButton.dataset.empty = snapshot.featherCharges > 0 ? "false" : "true";
    requiredElement<HTMLElement>(root, "[data-feathers]").textContent = String(snapshot.featherCharges);
    requiredElement<HTMLElement>(root, "[data-score]").textContent = String(snapshot.score);
    requiredElement<HTMLElement>(root, "[data-height]").textContent = `${Math.floor(snapshot.maxHeight / 10)}m`;
    requiredElement<HTMLElement>(root, "[data-best]").textContent = String(Math.max(this.highScore, snapshot.score));
    const combo = requiredElement<HTMLElement>(root, "[data-combo]");
    combo.textContent = `${snapshot.combo} HOP STREAK`;
    combo.classList.toggle("show", snapshot.combo >= 2);
    const bunny = requiredElement<HTMLElement>(root, ".bh-bunny");
    bunny.style.setProperty("--x", String(snapshot.bunnyX / BUNNY_WORLD_WIDTH * 100));
    bunny.style.setProperty("--bottom", String((snapshot.bunnyY - snapshot.cameraBottom) / BUNNY_VIEW_HEIGHT * 100));
    bunny.classList.toggle("falling", snapshot.velocityY < 0);
    platformLayer.innerHTML = snapshot.platforms.map((platform) => {
      const bottom = (platform.y - snapshot.cameraBottom) / BUNNY_VIEW_HEIGHT * 100;
      const crumbling = platform.crumbleSeconds === null ? "" : " crumbling";
      return `<i class="bh-platform ${platform.kind}${crumbling}" style="--x:${platform.x / BUNNY_WORLD_WIDTH * 100};--bottom:${bottom};--w:${platform.width}"></i>`;
    }).join("");
    pickupLayer.innerHTML = snapshot.pickupItems.map((pickup) => {
      const bottom = (pickup.y - snapshot.cameraBottom) / BUNNY_VIEW_HEIGHT * 100;
      return `<i class="bh-pickup ${pickup.kind}" style="--x:${pickup.x / BUNNY_WORLD_WIDTH * 100};--bottom:${bottom}"></i>`;
    }).join("");
  }

  private finishRun(outcome: "win" | "lose" | "quit"): void {
    if (this.ended || !this.root) return;
    this.running = false;
    this.ended = true;
    this.heldKeys.clear();
    const payout = this.payout();
    const snapshot = this.simulation?.snapshot();
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
        ? `${Math.floor((snapshot?.maxHeight ?? 0) / 10)}m high · ${payout.coins} coins · ${payout.xp} XP`
        : "Run left before steering · no reward";
    if (receipt || rewardPending) this.emitFeedback(outcome === "lose" ? "lose" : "win");
  }

  public payout(): MinigamePayout {
    const snapshot = this.simulation?.snapshot();
    return bunnyHopPayout(snapshot?.score ?? 0, snapshot?.maxHeight ?? 0, snapshot?.pickups ?? 0);
  }

  private notifyFinish(): void {
    if (this.notified) return;
    if (!this.ended) this.finishRun("win");
    this.notified = true;
    const receipt = this.session?.complete(this.payout());
    if (receipt) this.highScore = receipt.bestScore;
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
    this.platformLayer = null;
    this.pickupLayer = null;
    this.effectLayer = null;
    this.injected = null;
    this.context = null;
  }
}

export const definition = {
  id: manifest.id,
  title: manifest.title.en,
  instructions: "Steer every automatic bounce, master special platforms, and climb into space.",
  create: (): MinigameModule => new BunnyHopMinigame(),
} as const satisfies MinigameStubDefinition & { readonly create: () => MinigameModule };
