import type {
  MinigameContext,
  MinigameFactory,
  MinigameManifest,
  MinigameModule,
  MinigamePayout,
} from "../../core/contracts/minigame";
import { validateMinigameManifest } from "../../core/contracts/minigame";
import type { MinigameStubDefinition } from "../stub";
import {
  activeOneWays,
  beginDelivery,
  CITY_STOPS,
  createDeliveryState,
  DELIVERY_SHORTCUT,
  pauseDelivery,
  resumeDelivery,
  setDeliveryInput,
  updateDelivery,
  type CityPoint,
  type DeliveryDifficulty,
  type DeliveryState,
  type OneWay,
  type TrafficCar,
} from "./model";
import {
  createDeliverySettlement,
  type DeliverySettlement,
} from "./settlement";
import "./style.css";

/** Final launch manifest in the frozen CP1 shape, localized in both languages. */
export const manifest: MinigameManifest = validateMinigameManifest({
  id: "delivery-dash",
  title: { en: "Delivery Dash", de: "Lieferflitzer" },
  instructions: {
    en: "Steer through town and deliver every cozy parcel.",
    de: "Steuere durch die Stadt und liefere jedes gemütliche Paket aus.",
  },
  icon: "▣",
  category: "action",
  stage3d: false,
  unlockLevel: 5,
  audioCues: ["go", "hit", "miss", "combo", "countdown", "score", "lose", "win"],
  tutorial: [
    {
      icon: "📦",
      title: { en: "Pick up, then deliver", de: "Abholen, dann liefern" },
      body: {
        en: "Follow the pulsing parcel pin, then drive the package to its matching doorstep.",
        de: "Folge der pulsierenden Paketnadel und fahre das Paket dann zur passenden Haustür.",
      },
    },
    {
      icon: "⏱",
      title: { en: "Build timed chains", de: "Bilde Serien auf Zeit" },
      body: {
        en: "Each drop opens a visible chain window. Express routes have the tightest links and biggest rewards.",
        de: "Jede Lieferung öffnet ein sichtbares Serienfenster. Expressrouten sind knapp und besonders wertvoll.",
      },
    },
    {
      icon: "⚡",
      title: { en: "Risk the shortcut", de: "Riskiere die Abkürzung" },
      body: {
        en: "The striped diagonal alley is faster, but rough cobbles cost time if you stay too long.",
        de: "Die gestreifte diagonale Gasse ist schneller, doch langes Fahren auf Kopfsteinpflaster kostet Zeit.",
      },
    },
    {
      icon: "📣",
      title: { en: "Listen for traffic", de: "Hör auf den Verkehr" },
      body: {
        en: "Nearby cars honk before crossing. Hold WASD, arrows, or a touch direction to keep steering.",
        de: "Nahe Autos hupen vor dem Kreuzen. Halte WASD, Pfeile oder eine Touch-Richtung zum Lenken.",
      },
    },
  ],
});

const TITLE = manifest.title.en;
const INSTRUCTIONS = manifest.instructions.en;
const WORLD_SIZE = 100;

interface DashParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  readonly color: string;
}

interface SharedFeedbackContext extends MinigameContext {
  readonly audio?: {
    emit(action: "hit" | "miss" | "combo" | "countdown" | "go" | "win" | "lose" | "score", value?: number): void;
  };
  readonly haptics?: {
    impact(pattern: "light" | "medium" | "success" | "warning"): void;
  };
  readonly reducedMotion?: boolean;
}

const DIFFICULTIES: Readonly<Record<DeliveryDifficulty, { readonly title: string; readonly note: string }>> = {
  sunday: { title: "Sunday Drive", note: "Light traffic · relaxed timers" },
  rush: { title: "Town Rush", note: "Busy lanes · one-ways ramp up" },
  express: { title: "Bunny Express", note: "Tight clocks · one-ways active" },
};

export class DeliveryDashMinigame implements MinigameModule {
  readonly id = "delivery-dash";
  readonly title = TITLE;
  readonly instructions = INSTRUCTIONS;

  private context: SharedFeedbackContext | null = null;
  private host: HTMLElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private state: DeliveryState | null = null;
  private difficulty: DeliveryDifficulty = "sunday";
  private tutorialPage = 0;
  private bestScore = 0;
  private finished = false;
  private settlement: DeliverySettlement | null = null;
  private pressedKeys = new Set<string>();
  private touchDirection: { readonly pointerId: number; readonly direction: string } | null = null;
  private particles: DashParticle[] = [];
  private shakeRemaining = 0;
  private deliveryFeedbackRemaining = 0;
  private cleanup: Array<() => void> = [];

  mount(context: MinigameContext): void {
    this.dispose();
    this.context = context;
    this.settlement = createDeliverySettlement(context);
    this.bestScore = this.settlement.persistedBest;
    this.finished = false;
    const host = context.mount.ownerDocument.createElement("section");
    host.className = "dd-game";
    host.classList.toggle("dd-reduced-motion", this.context.reducedMotion === true);
    host.setAttribute("aria-label", TITLE);
    host.setAttribute("tabindex", "-1");
    host.innerHTML = `
      <header class="dd-topbar">
        <div class="dd-time"><small>SHIFT</small><strong data-dd="time">1:02</strong></div>
        <div class="dd-score"><small>SCORE</small><strong data-dd="score">0</strong><span data-dd="best">BEST 0</span></div>
        <button class="dd-icon-button" data-action="pause" aria-label="Pause game">Ⅱ</button>
      </header>
      <div class="dd-mission" role="status" aria-live="polite">
        <div class="dd-parcel-icon" data-dd="parcel-icon">📦</div>
        <div><small data-dd="mission-label">PICK UP</small><b data-dd="mission">Find the parcel</b></div>
        <strong data-dd="parcel-time">24s</strong>
      </div>
      <div class="dd-map-wrap">
        <canvas class="dd-canvas" data-dd="canvas" aria-label="Top-down city delivery map"></canvas>
        <div class="dd-chain" data-dd="chain">CHAIN ×0</div>
        <div class="dd-wrong-way" data-dd="wrong-way">↶ ONE WAY</div>
        <div class="dd-honk" data-dd="honk">HONK!</div>
      </div>
      <div class="dd-callout" data-dd="message" role="status" aria-live="polite">Follow the parcel pin!</div>
      <div class="dd-controls" aria-label="Drive controls">
        <button data-direction="up" aria-label="Drive up" aria-keyshortcuts="ArrowUp W">▲</button>
        <button data-direction="left" aria-label="Drive left" aria-keyshortcuts="ArrowLeft A">◀</button>
        <span class="dd-wheel" aria-hidden="true">●</span>
        <button data-direction="right" aria-label="Drive right" aria-keyshortcuts="ArrowRight D">▶</button>
        <button data-direction="down" aria-label="Drive down" aria-keyshortcuts="ArrowDown S">▼</button>
      </div>
      <footer class="dd-footer"><span>WASD / ARROWS</span><span data-dd="difficulty">SUNDAY DRIVE</span></footer>
      <div class="dd-overlay" data-dd="overlay"></div>
    `;
    context.mount.replaceChildren(host);
    this.host = host;
    this.canvas = host.querySelector<HTMLCanvasElement>("[data-dd='canvas']");
    this.listen(host, "click", this.onClick);
    this.listen(host, "pointerdown", this.onDirectionDown);
    this.listen(host, "pointerup", this.onDirectionUp);
    this.listen(host, "pointercancel", this.onDirectionUp);
    const document = context.mount.ownerDocument;
    document.addEventListener("keydown", this.onKeyDown);
    document.addEventListener("keyup", this.onKeyUp);
    const view = document.defaultView;
    view?.addEventListener("blur", this.onInputBlur);
    document.addEventListener("visibilitychange", this.onVisibilityChange);
    this.cleanup.push(
      () => document.removeEventListener("keydown", this.onKeyDown),
      () => document.removeEventListener("keyup", this.onKeyUp),
      () => view?.removeEventListener("blur", this.onInputBlur),
      () => document.removeEventListener("visibilitychange", this.onVisibilityChange),
    );
    this.showTutorial();
    this.render();
  }

  start(): void {
    if (!this.host || this.state?.phase === "playing") return;
    this.showTutorial();
  }

  pause(): void {
    if (!this.state) return;
    pauseDelivery(this.state);
    this.clearInput();
    if (this.state.phase === "paused") this.showPause();
    this.render();
  }

  resume(): void {
    if (!this.state) return;
    resumeDelivery(this.state);
    this.hideOverlay();
    this.render();
  }

  update(deltaSeconds: number): void {
    if (!this.state || !this.context || this.finished) return;
    const oldScore = this.state.score;
    const oldBumps = this.state.bumpCount;
    const oldHonks = this.state.honkCount;
    const wasFinished = this.state.phase === "finished";
    this.applyInput();
    updateDelivery(this.state, deltaSeconds, this.context.rng);
    if (this.state.score > oldScore) {
      this.deliveryBurst();
      this.deliveryFeedbackRemaining = 0.28;
      this.emitFeedback(
        this.state.chain > 1 ? "combo" : "score",
        "success",
        this.state.score - oldScore,
      );
    }
    if (this.state.bumpCount > oldBumps) {
      this.shakeRemaining = 0.32;
      this.emitFeedback("hit", "warning");
    }
    if (this.state.honkCount > oldHonks) this.emitFeedback("countdown", "light");
    this.updateEffects(deltaSeconds);
    if (!wasFinished && this.state.phase === "finished") this.completeRun();
    this.render();
  }

  payout(): MinigamePayout {
    const score = Math.max(0, Math.floor(this.state?.score ?? 0));
    const deliveries = this.state?.deliveries ?? 0;
    return {
      score,
      coins: Math.min(100, Math.floor(score / 240) + deliveries),
      xp: Math.min(200, Math.floor(score / 115) + deliveries * 3),
    };
  }

  dispose(): void {
    for (const remove of this.cleanup.splice(0)) remove();
    this.settlement?.abandon();
    this.clearInput();
    this.host?.remove();
    this.host = null;
    this.canvas = null;
    this.context = null;
    this.settlement = null;
    this.particles = [];
    this.finished = true;
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
    if (!elementType || !(target instanceof elementType)) return;
    const action = target.closest<HTMLElement>("[data-action]")?.dataset.action;
    if (!action) return;
    switch (action) {
      case "tutorial-next":
        if (this.tutorialPage < manifest.tutorial.length - 1) {
          this.tutorialPage += 1;
          this.showTutorial();
        } else {
          this.showDifficulty();
        }
        break;
      case "tutorial-back":
        this.tutorialPage = Math.max(0, this.tutorialPage - 1);
        this.showTutorial();
        break;
      case "choose-sunday":
      case "choose-rush":
      case "choose-express":
        this.difficulty = action.replace("choose-", "") as DeliveryDifficulty;
        this.startRound();
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
        this.abandonRun();
        break;
      case "collect":
        this.showDifficulty();
        break;
      default:
        break;
    }
  };

  private readonly onDirectionDown = (event: PointerEvent): void => {
    const target = event.target;
    const elementType = this.host?.ownerDocument.defaultView?.Element;
    if (!elementType || !(target instanceof elementType) || !this.state || this.state.phase !== "playing") return;
    const button = target.closest<HTMLElement>("[data-direction]");
    if (!button) return;
    event.preventDefault();
    button.setPointerCapture(event.pointerId);
    this.touchDirection = {
      pointerId: event.pointerId,
      direction: button.dataset.direction ?? "",
    };
    this.applyInput();
    button.classList.add("is-pressed");
  };

  private readonly onDirectionUp = (event: PointerEvent): void => {
    if (this.touchDirection?.pointerId !== event.pointerId) return;
    this.touchDirection = null;
    this.host?.querySelectorAll(".is-pressed").forEach((element) => element.classList.remove("is-pressed"));
    this.applyInput();
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (!this.state) return;
    if (event.key.toLowerCase() === "p" || event.key === "Escape") {
      if (this.state.phase !== "playing" && this.state.phase !== "paused") return;
      event.preventDefault();
      if (this.state.phase === "paused") this.resume();
      else this.pause();
      return;
    }
    if (this.state.phase !== "playing" || !this.directionForKey(event.key)) return;
    event.preventDefault();
    this.pressedKeys.add(event.key.toLowerCase());
    this.applyInput();
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    const key = event.key.toLowerCase();
    if (!this.pressedKeys.has(key)) return;
    event.preventDefault();
    this.pressedKeys.delete(key);
    this.applyInput();
  };

  private readonly onInputBlur = (): void => {
    this.clearInput();
  };

  private readonly onVisibilityChange = (): void => {
    if (this.host?.ownerDocument.visibilityState === "hidden") this.clearInput();
  };

  private directionForKey(key: string): string | null {
    const lookup: Readonly<Record<string, string>> = {
      arrowup: "up",
      arrowdown: "down",
      arrowleft: "left",
      arrowright: "right",
      w: "up",
      s: "down",
      a: "left",
      d: "right",
    };
    return lookup[key.toLowerCase()] ?? null;
  }

  private applyInput(): void {
    if (!this.state || this.state.phase !== "playing") {
      if (this.state) setDeliveryInput(this.state, 0, 0);
      return;
    }
    const directions = [
      ...Array.from(this.pressedKeys, (key) => this.directionForKey(key)),
      this.touchDirection?.direction ?? null,
    ];
    let x = 0;
    let y = 0;
    for (const direction of directions) {
      if (direction === "left") x -= 1;
      if (direction === "right") x += 1;
      if (direction === "up") y -= 1;
      if (direction === "down") y += 1;
    }
    setDeliveryInput(this.state, x, y);
  }

  private clearInput(): void {
    this.pressedKeys.clear();
    this.touchDirection = null;
    if (this.state) setDeliveryInput(this.state, 0, 0);
    this.host?.querySelectorAll(".is-pressed").forEach((element) => element.classList.remove("is-pressed"));
  }

  private startRound(): void {
    if (!this.context) return;
    this.settlement?.begin();
    this.state = createDeliveryState(this.difficulty, this.context.rng);
    beginDelivery(this.state);
    this.particles = [];
    this.shakeRemaining = 0;
    this.deliveryFeedbackRemaining = 0;
    this.clearInput();
    this.hideOverlay();
    this.render();
  }

  private showTutorial(): void {
    const pages = manifest.tutorial.map((step) => [step.icon, step.title.en, step.body.en] as const);
    const page = pages[this.tutorialPage] ?? pages[0];
    if (!page) return;
    const overlay = this.query("[data-dd='overlay']");
    if (!overlay) return;
    overlay.classList.add("is-visible");
    overlay.innerHTML = `
      <div class="dd-card">
        <span class="dd-kicker">DRIVER GUIDE · ${this.tutorialPage + 1}/${pages.length}</span>
        <div class="dd-tutorial-icon">${page[0]}</div>
        <h2>${page[1]}</h2>
        <p>${page[2]}</p>
        <div class="dd-dots">${pages.map((_, index) => `<i class="${index === this.tutorialPage ? "active" : ""}"></i>`).join("")}</div>
        <div class="dd-card-actions">
          ${this.tutorialPage > 0 ? '<button class="dd-secondary" data-action="tutorial-back">Back</button>' : ""}
          <button class="dd-primary" data-action="tutorial-next">${this.tutorialPage === pages.length - 1 ? "Choose shift" : "Next"}</button>
        </div>
      </div>
    `;
  }

  private showDifficulty(): void {
    const overlay = this.query("[data-dd='overlay']");
    if (!overlay) return;
    overlay.classList.add("is-visible");
    overlay.innerHTML = `
      <div class="dd-card">
        <span class="dd-kicker">CHOOSE A SHIFT</span>
        <h2>Where should Gooby drive?</h2>
        <div class="dd-difficulty-list">
          ${(["sunday", "rush", "express"] as const).map((difficulty, index) => `
            <button data-action="choose-${difficulty}">
              <span>${["🌤️", "🚗", "⚡"][index]}</span>
              <b>${DIFFICULTIES[difficulty].title}</b>
              <small>${DIFFICULTIES[difficulty].note}</small>
            </button>
          `).join("")}
        </div>
      </div>
    `;
  }

  private showPause(): void {
    const overlay = this.query("[data-dd='overlay']");
    if (!overlay) return;
    overlay.classList.add("is-visible");
    overlay.innerHTML = `
      <div class="dd-card">
        <span class="dd-kicker">SHIFT PAUSED</span>
        <div class="dd-tutorial-icon">🅿️</div>
        <h2>Parked safely</h2>
        <p>Parcel clocks and traffic are waiting too.</p>
        <button class="dd-primary dd-wide" data-action="resume">Continue shift</button>
        <button class="dd-secondary dd-wide" data-action="restart">Restart shift</button>
        <button class="dd-text-button" data-action="quit">Quit without reward</button>
      </div>
    `;
  }

  private completeRun(): void {
    if (!this.state || this.settlement?.closed) return;
    this.clearInput();
    const payout = this.payout();
    this.finished = true;
    this.settlement?.complete(payout);
    this.bestScore = Math.max(this.bestScore, this.settlement?.persistedBest ?? 0, this.state.score);
    this.context?.audio?.emit("win", payout.score);
    const overlay = this.query("[data-dd='overlay']");
    if (!overlay) return;
    overlay.classList.add("is-visible");
    overlay.innerHTML = `
      <div class="dd-card dd-result-card">
        <span class="dd-kicker">SHIFT COMPLETE</span>
        <div class="dd-result-stamp">✓</div>
        <h2>${payout.score.toLocaleString()}</h2>
        <p>${this.state.deliveries} deliveries · best chain ${this.state.bestChain}× · ${this.state.honkCount} traffic honks</p>
        <div class="dd-rewards"><span>🪙 ${payout.coins}</span><span>★ ${payout.xp} XP</span></div>
        <button class="dd-primary dd-wide" data-action="collect">Collect rewards</button>
        <button class="dd-secondary dd-wide" data-action="restart">Drive again</button>
      </div>
    `;
  }

  private abandonRun(): void {
    this.settlement?.abandon();
    this.clearInput();
    this.state = null;
    this.finished = false;
    this.particles = [];
    this.showDifficulty();
    this.render();
  }

  private hideOverlay(): void {
    const overlay = this.query("[data-dd='overlay']");
    overlay?.classList.remove("is-visible");
    if (overlay) overlay.replaceChildren();
  }

  private deliveryBurst(): void {
    if (!this.state || !this.context) return;
    if (this.context.reducedMotion === true) return;
    const colors = ["#f3c94e", "#ed7960", "#72ad7b", "#6aa5c4", "#fff4c9"] as const;
    for (let index = 0; index < 20; index += 1) {
      const angle = this.context.rng.next() * Math.PI * 2;
      const speed = 6 + this.context.rng.next() * 12;
      this.particles.push({
        x: this.state.car.x,
        y: this.state.car.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0.7 + this.context.rng.next() * 0.55,
        color: this.context.rng.pick(colors),
      });
    }
  }

  private updateEffects(deltaSeconds: number): void {
    const step = Math.min(0.1, Math.max(0, deltaSeconds));
    this.shakeRemaining = Math.max(0, this.shakeRemaining - step);
    this.deliveryFeedbackRemaining = Math.max(0, this.deliveryFeedbackRemaining - step);
    for (const particle of this.particles) {
      particle.life -= step;
      particle.x += particle.vx * step;
      particle.y += particle.vy * step;
      particle.vx *= 0.96;
      particle.vy *= 0.96;
    }
    this.particles = this.particles.filter((particle) => particle.life > 0);
  }

  private render(): void {
    const canvas = this.canvas;
    if (!canvas) return;
    this.resizeCanvas(canvas);
    const drawing = canvas.getContext("2d");
    if (!drawing) return;
    drawing.clearRect(0, 0, canvas.width, canvas.height);
    drawing.save();
    drawing.scale(canvas.width / WORLD_SIZE, canvas.height / WORLD_SIZE);
    this.drawCity(drawing);
    if (this.state) {
      this.drawShortcut(drawing);
      this.drawOneWays(drawing, activeOneWays(this.state));
      this.drawRoute(drawing);
      this.drawParcelPin(drawing);
      for (const traffic of this.state.traffic) this.drawTraffic(drawing, traffic);
      this.drawPlayer(drawing);
      this.drawParticles(drawing);
    }
    drawing.restore();

    const state = this.state;
    const seconds = Math.max(0, Math.ceil(state?.remaining ?? 62));
    this.setText("[data-dd='time']", `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`);
    this.setText("[data-dd='score']", Math.floor(state?.score ?? 0).toLocaleString());
    this.setText("[data-dd='best']", `BEST ${Math.floor(this.bestScore).toLocaleString()}`);
    this.setText("[data-dd='message']", state?.message ?? "Follow the parcel pin!");
    this.setText("[data-dd='difficulty']", DIFFICULTIES[this.difficulty].title.toUpperCase());
    this.setText(
      "[data-dd='chain']",
      state && state.chain > 0
        ? `CHAIN ×${state.chain} · ${state.chainRemaining.toFixed(1)}s`
        : "CHAIN ×0",
    );
    this.setText("[data-dd='parcel-time']", `${Math.ceil(state?.parcel.deadline ?? 24)}s`);
    this.setText("[data-dd='mission-label']", state?.parcel.carrying ? "DELIVER TO" : "PICK UP AT");
    this.setText(
      "[data-dd='mission']",
      state ? (state.parcel.carrying ? state.parcel.destination.name : state.parcel.pickup.name) : "Find the parcel",
    );
    this.setText("[data-dd='parcel-icon']", state?.parcel.carrying ? "🐰📦" : "📦");
    this.query("[data-dd='wrong-way']")?.classList.toggle("is-visible", state?.wrongWay ?? false);
    this.query("[data-dd='honk']")?.classList.toggle("is-visible", (state?.honkRemaining ?? 0) > 0);
    this.host?.classList.toggle("is-bump", this.shakeRemaining > 0);
    this.host?.classList.toggle("is-delivery", this.deliveryFeedbackRemaining > 0);
    this.host?.classList.toggle("is-shortcut", state?.inShortcut ?? false);
  }

  private emitFeedback(
    action: "hit" | "combo" | "score" | "countdown",
    pattern: "light" | "success" | "warning",
    value?: number,
  ): void {
    const shared: SharedFeedbackContext | null = this.context;
    shared?.audio?.emit(action, value);
    shared?.haptics?.impact(pattern);
  }

  private resizeCanvas(canvas: HTMLCanvasElement): void {
    const ratio = canvas.ownerDocument.defaultView?.devicePixelRatio ?? 1;
    const width = Math.max(1, Math.round(canvas.clientWidth * ratio));
    const height = Math.max(1, Math.round(canvas.clientHeight * ratio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
  }

  private drawCity(drawing: CanvasRenderingContext2D): void {
    drawing.fillStyle = "#83b66f";
    drawing.fillRect(0, 0, 100, 100);
    drawing.fillStyle = "#77847c";
    for (const road of [16, 50, 84]) {
      drawing.fillRect(road - 7, 0, 14, 100);
      drawing.fillRect(0, road - 7, 100, 14);
    }
    drawing.strokeStyle = "rgba(255,248,205,.52)";
    drawing.lineWidth = 0.45;
    drawing.setLineDash([2.2, 2.2]);
    for (const road of [16, 50, 84]) {
      drawing.beginPath();
      drawing.moveTo(road, 0);
      drawing.lineTo(road, 100);
      drawing.moveTo(0, road);
      drawing.lineTo(100, road);
      drawing.stroke();
    }
    drawing.setLineDash([]);

    const buildingColors = ["#f0b368", "#df7f69", "#7eb2b0", "#b899c5", "#e1cb78"] as const;
    let colorIndex = 0;
    const blocks = [[26, 27], [60, 27], [26, 61], [60, 61]] as const;
    for (const [x, y] of blocks) {
      drawing.fillStyle = "rgba(66,79,55,.18)";
      drawing.fillRect(x + 1.2, y + 1.8, 23, 23);
      drawing.fillStyle = buildingColors[colorIndex % buildingColors.length] ?? buildingColors[0];
      drawing.fillRect(x, y, 23, 23);
      drawing.fillStyle = "rgba(255,249,217,.82)";
      for (let wx = x + 3; wx < x + 21; wx += 6) {
        for (let wy = y + 4; wy < y + 20; wy += 7) drawing.fillRect(wx, wy, 2.5, 3);
      }
      drawing.fillStyle = "#8d5b49";
      drawing.fillRect(x + 9.5, y + 17, 4.5, 6);
      colorIndex += 1;
    }
    for (const stop of CITY_STOPS) {
      drawing.fillStyle = "#fff3c6";
      drawing.beginPath();
      drawing.arc(stop.x, stop.y, 1.15, 0, Math.PI * 2);
      drawing.fill();
    }
  }

  private drawOneWays(drawing: CanvasRenderingContext2D, roads: readonly OneWay[]): void {
    drawing.fillStyle = "rgba(255,244,189,.82)";
    drawing.font = "bold 3px sans-serif";
    drawing.textAlign = "center";
    drawing.textBaseline = "middle";
    for (const road of roads) {
      const arrow = road.direction > 0
        ? (road.orientation === "horizontal" ? "→" : "↓")
        : (road.orientation === "horizontal" ? "←" : "↑");
      const middle = (road.from + road.to) / 2;
      if (road.orientation === "horizontal") {
        drawing.fillText(arrow, middle, road.coordinate);
      } else {
        drawing.fillText(arrow, road.coordinate, middle);
      }
    }
  }

  private drawShortcut(drawing: CanvasRenderingContext2D): void {
    drawing.save();
    drawing.strokeStyle = "rgba(255,226,104,.82)";
    drawing.lineWidth = DELIVERY_SHORTCUT.width * 2;
    drawing.setLineDash([2.2, 1.5]);
    drawing.beginPath();
    drawing.moveTo(DELIVERY_SHORTCUT.from.x, DELIVERY_SHORTCUT.from.y);
    drawing.lineTo(DELIVERY_SHORTCUT.to.x, DELIVERY_SHORTCUT.to.y);
    drawing.stroke();
    drawing.strokeStyle = "rgba(139,92,57,.68)";
    drawing.lineWidth = 0.7;
    drawing.setLineDash([]);
    drawing.stroke();
    drawing.fillStyle = "#6f4e36";
    drawing.font = "bold 2.5px sans-serif";
    drawing.textAlign = "center";
    drawing.fillText("RISKY SHORTCUT", 50, 49);
    drawing.restore();
  }

  private currentTarget(): CityPoint | null {
    if (!this.state) return null;
    return this.state.parcel.carrying ? this.state.parcel.destination : this.state.parcel.pickup;
  }

  private drawRoute(drawing: CanvasRenderingContext2D): void {
    const target = this.currentTarget();
    if (!target || !this.state) return;
    drawing.strokeStyle = "rgba(255,241,137,.8)";
    drawing.lineWidth = 0.8;
    drawing.setLineDash([1.4, 1.7]);
    drawing.beginPath();
    drawing.moveTo(this.state.car.x, this.state.car.y);
    drawing.lineTo(target.x, target.y);
    drawing.stroke();
    drawing.setLineDash([]);
  }

  private drawParcelPin(drawing: CanvasRenderingContext2D): void {
    const target = this.currentTarget();
    if (!target || !this.state) return;
    const pulse = 3.5 + Math.sin(this.state.parcel.deadline * 5) * 0.6;
    drawing.fillStyle = "rgba(255,207,70,.24)";
    drawing.beginPath();
    drawing.arc(target.x, target.y, pulse, 0, Math.PI * 2);
    drawing.fill();
    drawing.fillStyle = this.state.parcel.carrying ? "#e56f5f" : "#f2c744";
    drawing.beginPath();
    drawing.arc(target.x, target.y - 1.3, 2.4, 0, Math.PI * 2);
    drawing.lineTo(target.x, target.y + 3.5);
    drawing.closePath();
    drawing.fill();
    drawing.fillStyle = "#fff9dd";
    drawing.beginPath();
    drawing.arc(target.x, target.y - 1.4, 0.8, 0, Math.PI * 2);
    drawing.fill();
  }

  private drawTraffic(drawing: CanvasRenderingContext2D, traffic: TrafficCar): void {
    const angle = Math.atan2(traffic.vy, traffic.vx);
    drawing.save();
    drawing.translate(traffic.x, traffic.y);
    drawing.rotate(angle);
    drawing.fillStyle = "rgba(44,53,48,.2)";
    drawing.fillRect(-2.5, -1.2, 5.8, 3.4);
    drawing.fillStyle = traffic.color;
    drawing.fillRect(-2.8, -1.7, 5.6, 3.4);
    drawing.fillStyle = "#d8edf0";
    drawing.fillRect(-1.2, -1.4, 2.3, 2.8);
    drawing.fillStyle = "#333b38";
    drawing.fillRect(-2, -2, 1.1, 0.5);
    drawing.fillRect(1, -2, 1.1, 0.5);
    drawing.fillRect(-2, 1.5, 1.1, 0.5);
    drawing.fillRect(1, 1.5, 1.1, 0.5);
    drawing.restore();
  }

  private drawPlayer(drawing: CanvasRenderingContext2D): void {
    if (!this.state) return;
    const car = this.state.car;
    drawing.save();
    drawing.translate(car.x, car.y);
    drawing.rotate(car.heading);
    drawing.fillStyle = "rgba(48,54,42,.25)";
    drawing.fillRect(-3.3, -1.7, 7.1, 4.5);
    drawing.fillStyle = "#ed8950";
    drawing.fillRect(-3.4, -2.1, 6.8, 4.2);
    drawing.fillStyle = "#fff4d2";
    drawing.fillRect(-1.2, -1.7, 2.5, 3.4);
    drawing.fillStyle = "#7fc2ca";
    drawing.fillRect(-0.7, -1.4, 1.4, 2.8);
    drawing.fillStyle = "#684736";
    drawing.beginPath();
    drawing.arc(-2.1, -2.1, 0.7, 0, Math.PI * 2);
    drawing.arc(2, -2.1, 0.7, 0, Math.PI * 2);
    drawing.arc(-2.1, 2.1, 0.7, 0, Math.PI * 2);
    drawing.arc(2, 2.1, 0.7, 0, Math.PI * 2);
    drawing.fill();
    if (this.state.parcel.carrying) {
      drawing.fillStyle = "#d5a54f";
      drawing.fillRect(-1.25, -3.3, 2.5, 2.2);
      drawing.strokeStyle = "#a9743f";
      drawing.lineWidth = 0.25;
      drawing.strokeRect(-1.25, -3.3, 2.5, 2.2);
    }
    drawing.restore();
  }

  private drawParticles(drawing: CanvasRenderingContext2D): void {
    for (const particle of this.particles) {
      drawing.globalAlpha = Math.min(1, particle.life * 1.5);
      drawing.fillStyle = particle.color;
      drawing.fillRect(particle.x - 0.45, particle.y - 0.45, 0.9, 0.9);
    }
    drawing.globalAlpha = 1;
  }

  private query(selector: string): HTMLElement | null {
    return this.host?.querySelector<HTMLElement>(selector) ?? null;
  }

  private setText(selector: string, value: string): void {
    const element = this.query(selector);
    if (element && element.textContent !== value) element.textContent = value;
  }
}

export const createMinigame: MinigameFactory = () => new DeliveryDashMinigame();

export const definition = {
  id: manifest.id,
  title: manifest.title.en,
  instructions: manifest.instructions.en,
} as const satisfies MinigameStubDefinition;
