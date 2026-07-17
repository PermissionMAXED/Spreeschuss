import type { MinigameContext, MinigameModule, MinigamePayout } from "../../core/contracts/minigame";
import type { MinigameStubDefinition } from "../stub";
import {
  CarrotCatchSimulation,
  carrotCatchPayout,
  type CatchEvent,
} from "./logic";

const HIGH_SCORE_KEY = "gooby.minigame.carrot-catch.high-score.v1";
const TUTORIAL_KEY = "gooby.minigame.carrot-catch.tutorial.v1";

function requiredElement<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Carrot Catch is missing ${selector}`);
  return element;
}

class CarrotFeedback {
  private audio: AudioContext | null = null;

  public constructor(private readonly view: Window) {}

  public unlock(): void {
    const audio = this.audio ?? new AudioContext();
    this.audio = audio;
    if (audio.state === "suspended") void audio.resume().catch(() => undefined);
  }

  public play(kind: "catch" | "golden" | "rotten" | "wave" | "finish"): void {
    this.unlock();
    const audio = this.audio;
    if (!audio) return;
    const notes = kind === "golden" || kind === "wave"
      ? [659, 880, 1047]
      : kind === "rotten"
        ? [180, 125]
        : kind === "finish"
          ? [523, 659, 784]
          : [440, 587];
    notes.forEach((frequency, index) => {
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      const at = audio.currentTime + index * 0.055;
      oscillator.type = kind === "rotten" ? "sawtooth" : "sine";
      oscillator.frequency.setValueAtTime(frequency, at);
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.055, at + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.13);
      oscillator.connect(gain).connect(audio.destination);
      oscillator.start(at);
      oscillator.stop(at + 0.14);
    });
  }

  public haptic(pattern: "light" | "success" | "warning"): void {
    const duration = pattern === "light" ? 8 : pattern === "success" ? [10, 35, 18] : [25, 25, 25];
    this.view.navigator.vibrate?.(duration);
  }

  public dispose(): void {
    if (this.audio) void this.audio.close().catch(() => undefined);
    this.audio = null;
  }
}

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
  private feedback: CarrotFeedback | null = null;
  private listeners: AbortController | null = null;
  private running = false;
  private ended = false;
  private notified = false;
  private highScore = 0;

  public mount(context: MinigameContext): void {
    this.dispose();
    this.context = context;
    const view = context.mount.ownerDocument.defaultView;
    if (!view) throw new Error("Carrot Catch requires a browser window");
    this.feedback = new CarrotFeedback(view);
    this.highScore = this.readNumber(HIGH_SCORE_KEY);
    this.listeners = new AbortController();

    const root = context.mount.ownerDocument.createElement("section");
    root.className = "cc-game";
    root.dataset.minigame = this.id;
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
        .cc-basket{--x:.5;position:absolute;z-index:5;bottom:4.5%;left:calc(var(--x)*100%);width:34%;height:78px;transform:translateX(-50%);border-radius:11px 11px 35px 35px;background:repeating-linear-gradient(105deg,#bd7534 0 12px,#d9954c 12px 24px);border:7px solid #8d572a;box-shadow:inset 0 12px #f2b76b66,0 13px 18px #3f5d2f44}.cc-basket:before{content:"";position:absolute;left:12%;right:12%;top:-42px;height:57px;border:7px solid #8d572a;border-bottom:0;border-radius:55px 55px 0 0}
        .cc-grass{position:absolute;z-index:2;bottom:0;width:100%;height:10%;background:linear-gradient(#69aa4b,#498f40)}.cc-grass:before{content:"";position:absolute;top:-18px;left:-2%;width:104%;height:28px;background:linear-gradient(135deg,transparent 35%,#69aa4b 36% 64%,transparent 65%) 0 0/31px 31px}
        .cc-particle{--px:50%;--py:50%;--dx:0px;position:absolute;left:var(--px);top:var(--py);color:#fff;font-size:17px;font-weight:950;text-shadow:0 2px 4px #693d;animation:cc-pop .65s ease-out forwards}.cc-particle.bad{color:#493d35}.cc-particle.gold{color:#ffe665;font-size:23px}
        .cc-controls{position:absolute;z-index:12;right:10px;bottom:max(10px,env(safe-area-inset-bottom));display:flex;gap:6px}.cc-icon-button{display:grid;width:42px;aspect-ratio:1;place-items:center;border:1px solid #fff9;border-radius:50%;color:#604631;background:#fffbeedd;box-shadow:0 5px 14px #36552c33;font-size:17px;font-weight:900}
        .cc-overlay{position:absolute;z-index:30;inset:0;display:grid;place-items:center;padding:24px;background:#31544099;backdrop-filter:blur(8px)}.cc-overlay[hidden]{display:none}.cc-panel{width:min(100%,340px);padding:27px 24px 22px;border:1px solid #fff9;border-radius:27px;color:#513a2b;background:linear-gradient(145deg,#fffdf1,#ffedc7);box-shadow:0 22px 65px #253d2f66;text-align:center}.cc-panel .cc-hero{font-size:54px}.cc-panel h2{margin:7px 0 8px;font-size:27px;letter-spacing:-.7px}.cc-panel p{margin:0 0 18px;color:#795f4e;font-size:13px;line-height:1.5}.cc-tips{display:grid;gap:7px;margin:0 0 18px;text-align:left}.cc-tip{padding:8px 10px;border-radius:11px;background:#efdba077;font-size:11px;font-weight:750}.cc-main-button,.cc-quit-button{width:100%;min-height:49px;border:0;border-radius:16px;color:white;background:linear-gradient(#ee8c44,#db6238);font:900 14px inherit;box-shadow:0 9px 20px #b75b3544}.cc-quit-button{margin-top:8px;color:#795f4e;background:#e7d3b5;box-shadow:none}.cc-result{font-size:35px;font-weight:950}.cc-new-best{color:#d18319;font-size:12px;font-weight:950}
        @keyframes cc-pop{from{opacity:1;transform:translate(-50%,-50%) scale(.65)}to{opacity:0;transform:translate(calc(-50% + var(--dx)),-105px) scale(1.25)}}@keyframes cc-wave{to{transform:translateX(-50%) scale(1.06)}}@keyframes cc-pulse{to{transform:scale(1.08)}}@media(prefers-reduced-motion:reduce){.cc-game *{animation-duration:1ms!important;transition-duration:1ms!important}}
      </style>
      <div class="cc-field" aria-label="Carrot Catch play field">
        <div class="cc-sun"></div><div class="cc-cloud one"></div><div class="cc-cloud two"></div>
        <div class="cc-items"></div><div class="cc-grass"></div><div class="cc-basket"></div><div class="cc-effects"></div>
      </div>
      <header class="cc-hud">
        <div class="cc-card cc-score"><span class="cc-label">Score</span><strong class="cc-value" data-score>0</strong></div>
        <div class="cc-card cc-time"><span class="cc-label">Time</span><strong class="cc-value" data-time>75</strong></div>
        <div class="cc-card cc-best"><span class="cc-label">Best</span><strong class="cc-value" data-best>${this.highScore}</strong></div>
      </header>
      <div class="cc-combo" data-combo>×1 COMBO</div><div class="cc-wave" data-wave hidden>✨ GOLDEN RUSH ✨</div>
      <nav class="cc-controls"><button class="cc-icon-button" data-pause aria-label="Pause">Ⅱ</button><button class="cc-icon-button" data-quit aria-label="Quit">×</button></nav>
      <div class="cc-overlay" data-tutorial hidden><article class="cc-panel"><div class="cc-hero">🥕</div><span class="cc-label">75 second challenge</span><h2>Carrot Catch</h2><p>Slide anywhere to guide Gooby's basket. Keep clean catches flowing for bigger multipliers.</p><div class="cc-tips"><div class="cc-tip">🥕 Carrots build your combo</div><div class="cc-tip">✨ Golden carrots score 5×</div><div class="cc-tip">🟢 Rotten carrots break the streak</div><div class="cc-tip">⚡ Every 20 catches starts a Golden Rush</div></div><button class="cc-main-button" data-play>LET'S CATCH!</button></article></div>
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
      this.feedback?.unlock();
      field.setPointerCapture(event.pointerId);
      move(event);
    }, { signal });
    field.addEventListener("pointermove", move, { signal });
    requiredElement<HTMLButtonElement>(root, "[data-play]").addEventListener("click", () => {
      this.writeFlag(TUTORIAL_KEY);
      requiredElement<HTMLElement>(root, "[data-tutorial]").hidden = true;
      this.running = true;
      this.feedback?.play("wave");
    }, { signal });
    requiredElement<HTMLButtonElement>(root, "[data-pause]").addEventListener("click", () => this.pause(), { signal });
    requiredElement<HTMLButtonElement>(root, "[data-resume]").addEventListener("click", () => this.resume(), { signal });
    for (const selector of ["[data-quit]", "[data-pause-quit]"]) {
      requiredElement<HTMLButtonElement>(root, selector).addEventListener("click", () => this.finishRun(), { signal });
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
    this.feedback?.play("catch");
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

  private handleEvent(event: CatchEvent): void {
    if (event.type === "caught") {
      const className = event.kind === "rotten" ? "bad" : event.kind === "golden" ? "gold" : "";
      this.addParticle(event.x, event.y, event.points >= 0 ? `+${event.points}` : `${event.points}`, className);
      this.feedback?.play(event.kind === "golden" ? "golden" : event.kind === "rotten" ? "rotten" : "catch");
      this.feedback?.haptic(event.kind === "rotten" ? "warning" : event.kind === "golden" ? "success" : "light");
    } else if (event.type === "missed" && event.kind !== "rotten") {
      this.addParticle(event.x, 0.92, "MISS", "bad");
    } else if (event.type === "bonus-wave") {
      this.feedback?.play("wave");
      this.feedback?.haptic("success");
    } else if (event.type === "finished") {
      this.finishRun();
    }
  }

  private addParticle(x: number, y: number, label: string, className: string): void {
    const context = this.context;
    const effectLayer = this.effectLayer;
    if (!context || !effectLayer) return;
    const particle = effectLayer.ownerDocument.createElement("span");
    particle.className = `cc-particle ${className}`;
    particle.textContent = label;
    particle.dataset.expires = String(context.clock.now() + 700);
    particle.style.setProperty("--px", `${x * 100}%`);
    particle.style.setProperty("--py", `${y * 100}%`);
    particle.style.setProperty("--dx", `${(context.rng.next() - 0.5) * 48}px`);
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
    requiredElement<HTMLElement>(root, ".cc-basket").style.setProperty("--x", String(snapshot.basketX));
    itemLayer.innerHTML = snapshot.items.map((item) =>
      `<i class="cc-drop cc-${item.kind}" style="--x:${item.x};--y:${item.y};--r:${item.spin}"><b></b></i>`
    ).join("");
  }

  private finishRun(): void {
    if (this.ended || !this.root) return;
    this.running = false;
    this.ended = true;
    const payout = this.payout();
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
      `${payout.coins} coins · ${payout.xp} XP · best combo ${this.simulation?.snapshot().bestCombo ?? 0}`;
    this.feedback?.play("finish");
    this.feedback?.haptic("success");
  }

  private notifyFinish(): void {
    if (this.notified || !this.context) return;
    if (!this.ended) this.finishRun();
    this.notified = true;
    this.context.finish(this.payout());
  }

  public payout(): MinigamePayout {
    const snapshot = this.simulation?.snapshot();
    return carrotCatchPayout(snapshot?.score ?? 0, snapshot?.bestCombo ?? 0);
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
    this.itemLayer = null;
    this.effectLayer = null;
    this.context = null;
  }
}

export const definition = {
  id: "carrot-catch",
  title: "Carrot Catch",
  instructions: "Catch carrots for 75 seconds, chain combos, and dodge the rotten ones.",
  create: (): MinigameModule => new CarrotCatchMinigame(),
} as const satisfies MinigameStubDefinition & { readonly create: () => MinigameModule };
