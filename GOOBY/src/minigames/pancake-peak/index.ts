import type { MinigameContext, MinigameModule, MinigamePayout } from "../../core/contracts/minigame";
import type { MinigameStubDefinition } from "../stub";
import {
  PANCAKE_WORLD_WIDTH,
  PancakePeakSimulation,
  pancakePeakPayout,
  type PancakePeakEvent,
} from "./logic";

const PANCAKE_VIEW_HEIGHT = 520;
const HIGH_SCORE_KEY = "gooby.minigame.pancake-peak.high-score.v1";
const TUTORIAL_KEY = "gooby.minigame.pancake-peak.tutorial.v1";

function requiredElement<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Pancake Peak is missing ${selector}`);
  return element;
}

class PancakeFeedback {
  private audio: AudioContext | null = null;

  public constructor(private readonly view: Window) {}

  public unlock(): void {
    const audio = this.audio ?? new AudioContext();
    this.audio = audio;
    if (audio.state === "suspended") void audio.resume().catch(() => undefined);
  }

  public play(kind: "drop" | "perfect" | "trim" | "butter" | "collapse"): void {
    this.unlock();
    const audio = this.audio;
    if (!audio) return;
    const notes = kind === "perfect"
      ? [659, 784, 988]
      : kind === "butter"
        ? [523, 659, 784, 1047]
        : kind === "collapse"
          ? [280, 220, 160, 110]
          : kind === "trim"
            ? [220]
            : [330, 390];
    notes.forEach((frequency, index) => {
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      const at = audio.currentTime + index * 0.045;
      oscillator.type = kind === "trim" || kind === "collapse" ? "triangle" : "sine";
      oscillator.frequency.setValueAtTime(frequency, at);
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.055, at + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.14);
      oscillator.connect(gain).connect(audio.destination);
      oscillator.start(at);
      oscillator.stop(at + 0.15);
    });
  }

  public haptic(pattern: "light" | "success" | "warning"): void {
    this.view.navigator.vibrate?.(pattern === "light" ? 9 : pattern === "success" ? [10, 28, 17] : [32, 30, 32]);
  }

  public dispose(): void {
    if (this.audio) void this.audio.close().catch(() => undefined);
    this.audio = null;
  }
}

export class PancakePeakMinigame implements MinigameModule {
  public readonly id = "pancake-peak" as const;
  public readonly title = "Pancake Peak";
  public readonly instructions = "Tap to drop each swinging pancake; perfect centers regrow the stack.";

  private context: MinigameContext | null = null;
  private root: HTMLElement | null = null;
  private field: HTMLElement | null = null;
  private stackLayer: HTMLElement | null = null;
  private effectLayer: HTMLElement | null = null;
  private simulation: PancakePeakSimulation | null = null;
  private feedback: PancakeFeedback | null = null;
  private listeners: AbortController | null = null;
  private running = false;
  private ended = false;
  private notified = false;
  private highScore = 0;

  public mount(context: MinigameContext): void {
    this.dispose();
    this.context = context;
    const view = context.mount.ownerDocument.defaultView;
    if (!view) throw new Error("Pancake Peak requires a browser window");
    this.feedback = new PancakeFeedback(view);
    this.highScore = this.readNumber(HIGH_SCORE_KEY);
    this.listeners = new AbortController();

    const root = context.mount.ownerDocument.createElement("section");
    root.className = "pp-game";
    root.dataset.minigame = this.id;
    root.innerHTML = `
      <style>
        .pp-game{position:relative;width:100%;height:100%;min-height:560px;overflow:hidden;touch-action:none;user-select:none;color:#55382e;background:linear-gradient(#f7d8b1 0 66%,#bd7a54 66%);font-family:ui-rounded,"SF Pro Rounded",system-ui,sans-serif;isolation:isolate}
        .pp-game *{box-sizing:border-box}.pp-wall{position:absolute;inset:0;background:linear-gradient(90deg,#d98f6c22 1px,transparent 1px),linear-gradient(#d98f6c22 1px,transparent 1px);background-size:42px 42px}.pp-window{position:absolute;top:14%;left:8%;width:32%;height:27%;border:9px solid #a8674e;border-radius:70px 70px 12px 12px;background:linear-gradient(#91d8e9,#fff3bd);box-shadow:inset 0 0 0 5px #f6d1a4,0 10px 25px #704b3b33}.pp-window:before,.pp-window:after{content:"";position:absolute;background:#a8674e}.pp-window:before{top:0;bottom:0;left:50%;width:5px}.pp-window:after{top:52%;right:0;left:0;height:5px}.pp-shelf{position:absolute;top:28%;right:6%;width:25%;height:12px;border-radius:6px;background:#925b42;box-shadow:0 8px 0 #6f4537}.pp-jar{position:absolute;right:12%;top:21%;width:35px;height:48px;border-radius:5px 5px 12px 12px;background:#fff4d7bb;border:3px solid #a96f56}.pp-jar:before{content:"FLOUR";position:absolute;top:17px;left:2px;font-size:6px;font-weight:950}
        .pp-counter{position:absolute;z-index:2;right:0;bottom:0;left:0;height:15%;background:linear-gradient(#d99b72,#b77252);border-top:10px solid #f0b589;box-shadow:0 -9px 20px #8c593533}.pp-field{position:absolute;z-index:3;inset:0;overflow:hidden}.pp-stack,.pp-effects{position:absolute;inset:0;pointer-events:none}.pp-stack{z-index:4}.pp-effects{z-index:9}
        .pp-plate{position:absolute;z-index:3;bottom:8.5%;left:50%;width:78%;height:29px;transform:translateX(-50%);border-radius:50%;background:linear-gradient(#f5fbf5,#cbdde1);box-shadow:inset 0 -7px #aabec5,0 10px 16px #67433455}.pp-pancake{--x:50;--bottom:10;--w:200;position:absolute;left:calc(var(--x)*1%);bottom:calc(var(--bottom)*1%);width:calc(var(--w)/360*100%);height:25px;transform:translateX(-50%);border:2px solid #bd6d35;border-radius:50%;background:linear-gradient(#f6bd67 0 28%,#d98641 33% 76%,#b95f30 80%);box-shadow:inset 0 4px #ffe2a2,0 4px 5px #6f422c33}.pp-pancake:before{content:"";position:absolute;top:6px;left:13%;width:12%;height:4px;border-radius:50%;background:#a9542e55;box-shadow:45px 2px #a9542e44,89px -1px #a9542e55}.pp-pancake.perfect{filter:drop-shadow(0 0 7px #fff0a7)}.pp-butter{position:absolute;z-index:2;top:-8px;left:50%;width:28px;height:14px;transform:translateX(-50%) rotate(-4deg);border-radius:3px;background:#fff08b;box-shadow:inset -4px -3px #e9c850,0 3px 4px #7e4b2f55}.pp-moving{z-index:7;filter:drop-shadow(0 7px 6px #6e483e55)}.pp-moving:after{content:"";position:absolute;top:-120px;left:50%;width:2px;height:116px;background:linear-gradient(transparent,#ffffff88)}
        .pp-hud{position:absolute;z-index:12;top:max(12px,env(safe-area-inset-top));left:12px;right:12px;display:grid;grid-template-columns:1fr auto 1fr;gap:7px;align-items:start}.pp-card{padding:8px 11px;border:1px solid #fff8;border-radius:15px;background:#fff7e8d9;box-shadow:0 8px 20px #75503b22;backdrop-filter:blur(9px)}.pp-card:last-child{text-align:right}.pp-label{display:block;color:#a16c50;font-size:8px;font-weight:900;letter-spacing:1.2px;text-transform:uppercase}.pp-value{font-size:19px;font-weight:950}.pp-level{text-align:center;min-width:84px}.pp-combo{position:absolute;z-index:11;top:12.5%;left:50%;padding:5px 13px;transform:translateX(-50%) scale(.9);border-radius:99px;color:#7d4e15;background:#fff1a7e8;font-size:12px;font-weight:950;opacity:0;transition:150ms}.pp-combo.show{opacity:1;transform:translateX(-50%) scale(1)}.pp-butter-banner{position:absolute;z-index:11;top:18%;left:50%;padding:7px 15px;transform:translateX(-50%);border-radius:99px;color:#7a5818;background:#fff4a4;box-shadow:0 6px 18px #9e6f2744;font-size:12px;font-weight:950;animation:pp-banner .55s ease-in-out infinite alternate}.pp-butter-banner[hidden]{display:none}
        .pp-controls{position:absolute;z-index:14;right:10px;bottom:max(10px,env(safe-area-inset-bottom));display:flex;gap:6px}.pp-icon-button{display:grid;width:42px;aspect-ratio:1;place-items:center;border:1px solid #fff8;border-radius:50%;color:#69493d;background:#fff7e8dc;box-shadow:0 5px 14px #70493b33;font-size:17px;font-weight:900}.pp-drop-hint{position:absolute;z-index:8;right:0;bottom:3%;left:0;color:#fff3d7;font-size:10px;font-weight:950;text-align:center;text-shadow:0 2px 4px #684433;pointer-events:none}
        .pp-particle{--px:50%;--py:50%;--dx:0px;position:absolute;left:var(--px);bottom:var(--py);color:#fff3a0;font-size:18px;font-weight:950;text-shadow:0 2px 5px #714633;animation:pp-pop .75s ease-out forwards}.pp-particle.crumb{width:18px;height:10px;border-radius:50%;color:transparent;background:#d77e3e}.pp-particle.butter{color:#fff4a4;font-size:23px}
        .pp-overlay{position:absolute;z-index:30;inset:0;display:grid;place-items:center;padding:24px;background:#69493d88;backdrop-filter:blur(8px)}.pp-overlay[hidden]{display:none}.pp-panel{width:min(100%,340px);padding:27px 24px 22px;border:1px solid #fff9;border-radius:27px;color:#543b32;background:linear-gradient(145deg,#fffdf0,#ffe0b6);box-shadow:0 22px 65px #59392f66;text-align:center}.pp-hero{font-size:55px}.pp-panel h2{margin:7px 0 8px;font-size:27px;letter-spacing:-.7px}.pp-panel p{margin:0 0 18px;color:#775c50;font-size:13px;line-height:1.5}.pp-tips{display:grid;gap:7px;margin:0 0 18px;text-align:left}.pp-tip{padding:8px 10px;border-radius:11px;background:#edc99588;font-size:11px;font-weight:750}.pp-main-button,.pp-quit-button{width:100%;min-height:49px;border:0;border-radius:16px;color:white;background:linear-gradient(#e89b51,#c96f3e);font:900 14px inherit;box-shadow:0 9px 20px #a45d3944}.pp-quit-button{margin-top:8px;color:#72584c;background:#ecd6b9;box-shadow:none}.pp-result{font-size:35px;font-weight:950}.pp-new-best{color:#c47822;font-size:12px;font-weight:950}
        @keyframes pp-pop{from{opacity:1;transform:translate(-50%,0) scale(.7)}to{opacity:0;transform:translate(calc(-50% + var(--dx)),-95px) rotate(100deg) scale(1.3)}}@keyframes pp-banner{to{transform:translateX(-50%) scale(1.07)}}@media(prefers-reduced-motion:reduce){.pp-game *{animation-duration:1ms!important;transition-duration:1ms!important}}
      </style>
      <div class="pp-wall"></div><div class="pp-window"></div><div class="pp-shelf"></div><div class="pp-jar"></div><div class="pp-counter"></div>
      <div class="pp-field" aria-label="Pancake Peak play field"><div class="pp-plate"></div><div class="pp-stack"></div><div class="pp-effects"></div><div class="pp-drop-hint">TAP ANYWHERE TO DROP</div></div>
      <header class="pp-hud"><div class="pp-card"><span class="pp-label">Score</span><strong class="pp-value" data-score>0</strong></div><div class="pp-card pp-level"><span class="pp-label">Stack</span><strong class="pp-value" data-stack>0</strong></div><div class="pp-card"><span class="pp-label">Best</span><strong class="pp-value" data-best>${this.highScore}</strong></div></header>
      <div class="pp-combo" data-combo>PERFECT ×1</div><div class="pp-butter-banner" data-butter-banner hidden>🧈 BUTTER BONUS +300</div><nav class="pp-controls"><button class="pp-icon-button" data-pause aria-label="Pause">Ⅱ</button><button class="pp-icon-button" data-quit aria-label="Quit">×</button></nav>
      <div class="pp-overlay" data-tutorial hidden><article class="pp-panel"><div class="pp-hero">🥞</div><span class="pp-label">Endless stacking challenge</span><h2>Pancake Peak</h2><p>Tap to drop each swinging pancake. The overhang is trimmed, so every miss makes your tower narrower.</p><div class="pp-tips"><div class="pp-tip">🎯 Land within 4px for a PERFECT</div><div class="pp-tip">↔ Perfect drops regrow your pancake</div><div class="pp-tip">🔥 Swing speed rises with the stack</div><div class="pp-tip">🧈 Every 10th pancake earns butter</div></div><button class="pp-main-button" data-play>START STACKING!</button></article></div>
      <div class="pp-overlay" data-paused hidden><article class="pp-panel"><div class="pp-hero">☕</div><h2>Brunch break</h2><p>Your wonderfully wobbly stack is staying put.</p><button class="pp-main-button" data-resume>RESUME</button><button class="pp-quit-button" data-pause-quit>QUIT & COLLECT</button></article></div>
      <div class="pp-overlay" data-ended hidden><article class="pp-panel"><div class="pp-hero">🍽️</div><span class="pp-label">Peak score</span><div class="pp-result" data-result>0</div><div class="pp-new-best" data-new-best hidden>NEW HIGH SCORE!</div><p data-summary></p><button class="pp-main-button" data-done>COLLECT REWARDS</button></article></div>
    `;
    context.mount.replaceChildren(root);
    this.root = root;
    this.field = requiredElement(root, ".pp-field");
    this.stackLayer = requiredElement(root, ".pp-stack");
    this.effectLayer = requiredElement(root, ".pp-effects");
    this.bindEvents();
  }

  private bindEvents(): void {
    const root = this.root;
    const field = this.field;
    const signal = this.listeners?.signal;
    if (!root || !field || !signal) return;
    field.addEventListener("pointerdown", () => {
      this.feedback?.unlock();
      if (this.running) this.simulation?.drop();
    }, { signal });
    requiredElement<HTMLButtonElement>(root, "[data-play]").addEventListener("click", () => {
      this.writeFlag(TUTORIAL_KEY);
      requiredElement<HTMLElement>(root, "[data-tutorial]").hidden = true;
      this.running = true;
      this.feedback?.play("drop");
    }, { signal });
    requiredElement<HTMLButtonElement>(root, "[data-pause]").addEventListener("click", () => this.pause(), { signal });
    requiredElement<HTMLButtonElement>(root, "[data-resume]").addEventListener("click", () => this.resume(), { signal });
    for (const selector of ["[data-quit]", "[data-pause-quit]"]) {
      requiredElement<HTMLButtonElement>(root, selector).addEventListener("click", () => this.finishRun(false), { signal });
    }
    requiredElement<HTMLButtonElement>(root, "[data-done]").addEventListener("click", () => this.notifyFinish(), { signal });
  }

  public start(): void {
    const context = this.context;
    const root = this.root;
    if (!context || !root) throw new Error("Mount Pancake Peak before starting");
    this.simulation?.dispose();
    this.simulation = new PancakePeakSimulation(context.rng);
    this.ended = false;
    this.notified = false;
    const firstPlay = !this.readFlag(TUTORIAL_KEY);
    this.running = !firstPlay;
    requiredElement<HTMLElement>(root, "[data-tutorial]").hidden = !firstPlay;
    requiredElement<HTMLElement>(root, "[data-paused]").hidden = true;
    requiredElement<HTMLElement>(root, "[data-ended]").hidden = true;
    this.render();
  }

  public pause(): void {
    if (!this.running || this.ended || !this.root) return;
    this.running = false;
    requiredElement<HTMLElement>(this.root, "[data-paused]").hidden = false;
  }

  public resume(): void {
    if (this.ended || !this.simulation || !this.root) return;
    requiredElement<HTMLElement>(this.root, "[data-paused]").hidden = true;
    this.running = true;
    this.feedback?.play("drop");
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

  private handleEvent(event: PancakePeakEvent): void {
    if (event.type === "place") {
      this.addParticle(event.layer.x, event.layer.y + 18, `+${event.points}`, "");
      this.feedback?.play("drop");
      this.feedback?.haptic("light");
    } else if (event.type === "perfect") {
      this.addParticle(event.x, event.y + 32, `PERFECT ×${event.combo}`, "");
      this.feedback?.play("perfect");
      this.feedback?.haptic("success");
    } else if (event.type === "trim") {
      for (let index = 0; index < 3; index += 1) this.addParticle(event.x, event.y, "", "crumb");
      this.feedback?.play("trim");
    } else if (event.type === "butter") {
      this.addParticle(event.x, event.y, "🧈 +300", "butter");
      const banner = this.root ? requiredElement<HTMLElement>(this.root, "[data-butter-banner]") : null;
      if (banner && this.context) {
        banner.hidden = false;
        banner.dataset.expires = String(this.context.clock.now() + 1_500);
      }
      this.feedback?.play("butter");
      this.feedback?.haptic("success");
    } else {
      this.finishRun(true);
    }
  }

  private addParticle(worldX: number, worldY: number, label: string, className: string): void {
    const context = this.context;
    const effectLayer = this.effectLayer;
    const snapshot = this.simulation?.snapshot();
    if (!context || !effectLayer || !snapshot) return;
    const particle = effectLayer.ownerDocument.createElement("span");
    particle.className = `pp-particle ${className}`;
    particle.textContent = label;
    particle.dataset.expires = String(context.clock.now() + 780);
    particle.style.setProperty("--px", `${worldX / PANCAKE_WORLD_WIDTH * 100}%`);
    particle.style.setProperty("--py", `${(worldY - snapshot.cameraBottom) / PANCAKE_VIEW_HEIGHT * 100}%`);
    particle.style.setProperty("--dx", `${(context.rng.next() - 0.5) * 70}px`);
    effectLayer.append(particle);
  }

  private pruneParticles(): void {
    const context = this.context;
    const root = this.root;
    if (!context || !this.effectLayer || !root) return;
    for (const particle of this.effectLayer.querySelectorAll<HTMLElement>("[data-expires]")) {
      if (Number(particle.dataset.expires) <= context.clock.now()) particle.remove();
    }
    const banner = requiredElement<HTMLElement>(root, "[data-butter-banner]");
    if (Number(banner.dataset.expires) <= context.clock.now()) banner.hidden = true;
  }

  private render(): void {
    const root = this.root;
    const stackLayer = this.stackLayer;
    const snapshot = this.simulation?.snapshot();
    if (!root || !stackLayer || !snapshot) return;
    requiredElement<HTMLElement>(root, "[data-score]").textContent = String(snapshot.score);
    requiredElement<HTMLElement>(root, "[data-stack]").textContent = String(snapshot.stackCount);
    requiredElement<HTMLElement>(root, "[data-best]").textContent = String(Math.max(this.highScore, snapshot.score));
    const combo = requiredElement<HTMLElement>(root, "[data-combo]");
    combo.textContent = `PERFECT ×${snapshot.combo}`;
    combo.classList.toggle("show", snapshot.combo > 0);
    const visibleLayers = snapshot.layers.filter((layer) => layer.y >= snapshot.cameraBottom - 35);
    stackLayer.innerHTML = visibleLayers.map((layer) => {
      const bottom = (layer.y - snapshot.cameraBottom) / PANCAKE_VIEW_HEIGHT * 100;
      return `<i class="pp-pancake${layer.perfect ? " perfect" : ""}" style="--x:${layer.x / PANCAKE_WORLD_WIDTH * 100};--bottom:${bottom};--w:${layer.width}">${layer.butter ? '<b class="pp-butter"></b>' : ""}</i>`;
    }).join("") + `<i class="pp-pancake pp-moving" style="--x:${snapshot.moving.x / PANCAKE_WORLD_WIDTH * 100};--bottom:${(snapshot.moving.y - snapshot.cameraBottom) / PANCAKE_VIEW_HEIGHT * 100};--w:${snapshot.moving.width}"></i>`;
  }

  private finishRun(collapsed: boolean): void {
    if (this.ended || !this.root) return;
    this.running = false;
    this.ended = true;
    const payout = this.payout();
    const snapshot = this.simulation?.snapshot();
    const isBest = payout.score > this.highScore;
    if (isBest) {
      this.highScore = payout.score;
      this.writeNumber(HIGH_SCORE_KEY, payout.score);
    }
    requiredElement<HTMLElement>(this.root, "[data-paused]").hidden = true;
    requiredElement<HTMLElement>(this.root, "[data-ended]").hidden = false;
    requiredElement<HTMLElement>(this.root, "[data-result]").textContent = payout.score.toLocaleString();
    requiredElement<HTMLElement>(this.root, "[data-new-best]").hidden = !isBest;
    requiredElement<HTMLElement>(this.root, "[data-summary]").textContent =
      `${snapshot?.stackCount ?? 0} pancakes · ${payout.coins} coins · ${payout.xp} XP`;
    this.feedback?.play(collapsed ? "collapse" : "butter");
    this.feedback?.haptic(collapsed ? "warning" : "success");
  }

  public payout(): MinigamePayout {
    const snapshot = this.simulation?.snapshot();
    return pancakePeakPayout(snapshot?.score ?? 0, snapshot?.stackCount ?? 0, snapshot?.bestCombo ?? 0);
  }

  private notifyFinish(): void {
    if (this.notified || !this.context) return;
    if (!this.ended) this.finishRun(false);
    this.notified = true;
    this.context.finish(this.payout());
  }

  private storage(): Storage | null {
    try {
      return this.root?.ownerDocument.defaultView?.localStorage ?? null;
    } catch {
      return null;
    }
  }

  private readNumber(key: string): number {
    const value = Number(this.storage()?.getItem(key));
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
  }

  private writeNumber(key: string, value: number): void {
    try {
      this.storage()?.setItem(key, String(value));
    } catch {
      // Persistence is optional in privacy-restricted browser contexts.
    }
  }

  private readFlag(key: string): boolean {
    try {
      return this.storage()?.getItem(key) === "seen";
    } catch {
      return false;
    }
  }

  private writeFlag(key: string): void {
    try {
      this.storage()?.setItem(key, "seen");
    } catch {
      // The tutorial remains safe to repeat if storage is unavailable.
    }
  }

  public dispose(): void {
    this.running = false;
    this.ended = true;
    this.listeners?.abort();
    this.listeners = null;
    this.feedback?.dispose();
    this.feedback = null;
    this.simulation?.dispose();
    this.simulation = null;
    this.root?.remove();
    this.root = null;
    this.field = null;
    this.stackLayer = null;
    this.effectLayer = null;
    this.context = null;
  }
}

export const definition = {
  id: "pancake-peak",
  title: "Pancake Peak",
  instructions: "Drop swinging pancakes, trim overhangs, and chain pixel-perfect stacks.",
  create: (): MinigameModule => new PancakePeakMinigame(),
} as const satisfies MinigameStubDefinition & { readonly create: () => MinigameModule };
