import type {
  MinigameContext,
  MinigameFactory,
  MinigameModule,
  MinigamePayout,
} from "../../core/contracts/minigame";
import type { MinigameStubDefinition } from "../stub";
import {
  beginCannon,
  CANNON_FLOOR_Y,
  CANNON_ORIGIN,
  createCannonState,
  launchCarrot,
  pauseCannon,
  PICNIC_CLEAR_SEQUENCE,
  predictTrajectory,
  resumeCannon,
  updateCannon,
  type CannonDifficulty,
  type CannonPoint,
  type CannonState,
  type CannonTarget,
} from "./model";
import {
  createCannonSettlement,
  type CannonSettlement,
} from "./settlement";
import "./style.css";

const TITLE = "Carrot Cannon";
const INSTRUCTIONS = "Drag back or use the aim buttons, then fire carrots through the picnic range.";
const WORLD_WIDTH = 100;
const WORLD_HEIGHT = 70;

interface CannonParticle {
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
}

const DIFFICULTY_COPY: Readonly<Record<CannonDifficulty, { readonly label: string; readonly note: string }>> = {
  picnic: { label: "Picnic", note: "Full flight guide · calm air" },
  breezy: { label: "Breezy", note: "Wind arrows · more targets" },
  blustery: { label: "Blustery", note: "Strong gusts · tiny targets" },
};

export class CarrotCannonMinigame implements MinigameModule {
  readonly id = "carrot-cannon";
  readonly title = TITLE;
  readonly instructions = INSTRUCTIONS;

  private context: MinigameContext | null = null;
  private host: HTMLElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private state: CannonState | null = null;
  private difficulty: CannonDifficulty = "picnic";
  private tutorialPage = 0;
  private bestScore = 0;
  private dragging = false;
  private dragPoint: CannonPoint = { ...CANNON_ORIGIN };
  private aimPull: CannonPoint = { ...(PICNIC_CLEAR_SEQUENCE[0] ?? { x: 16, y: -13 }) };
  private pointerId: number | null = null;
  private particles: CannonParticle[] = [];
  private finished = false;
  private settlement: CannonSettlement | null = null;
  private hitFeedbackRemaining = 0;
  private missFeedbackRemaining = 0;
  private cleanup: Array<() => void> = [];

  mount(context: MinigameContext): void {
    this.dispose();
    this.context = context;
    this.settlement = createCannonSettlement(context);
    this.bestScore = this.settlement.persistedBest;
    this.finished = false;
    const host = context.mount.ownerDocument.createElement("section");
    host.className = "cc-game";
    host.setAttribute("aria-label", TITLE);
    host.innerHTML = `
      <header class="cc-topbar">
        <div class="cc-shot-count"><small>CARROTS</small><strong data-cc="shots">10</strong></div>
        <div class="cc-score"><small>SCORE</small><strong data-cc="score">0</strong><span data-cc="best">BEST 0</span></div>
        <button class="cc-icon-button" data-action="pause" aria-label="Pause game">Ⅱ</button>
      </header>
      <div class="cc-wind" data-cc="wind"><small>WIND</small><b>CALM</b></div>
      <canvas class="cc-canvas" data-cc="canvas" tabindex="0" aria-label="Carrot cannon picnic range" aria-describedby="cc-control-help"></canvas>
      <div class="cc-callout" data-cc="message">Drag to aim, or use the arrow controls!</div>
      <div class="cc-power" aria-hidden="true"><i data-cc="power"></i></div>
      <div class="cc-aim-controls" role="group" aria-label="Carrot cannon aim controls">
        <button data-action="aim-up" aria-label="Aim higher">▲</button>
        <button data-action="power-down" aria-label="Reduce shot power">−</button>
        <button class="cc-fire-button" data-action="fire">FIRE</button>
        <button data-action="power-up" aria-label="Increase shot power">＋</button>
        <button data-action="aim-down" aria-label="Aim lower">▼</button>
      </div>
      <p class="cc-control-help" id="cc-control-help">Arrow keys aim. Space fires. Dragging still works.</p>
      <footer class="cc-footer"><span>🥕 BOUNCES ADD BONUS</span><span data-cc="difficulty">PICNIC</span></footer>
      <div class="cc-overlay" data-cc="overlay"></div>
    `;
    context.mount.replaceChildren(host);
    this.host = host;
    this.canvas = host.querySelector<HTMLCanvasElement>("[data-cc='canvas']");
    this.listen(host, "click", this.onClick);
    if (this.canvas) {
      this.listen(this.canvas, "pointerdown", this.onPointerDown);
      this.listen(this.canvas, "pointermove", this.onPointerMove);
      this.listen(this.canvas, "pointerup", this.onPointerUp);
      this.listen(this.canvas, "pointercancel", this.onPointerCancel);
    }
    const document = context.mount.ownerDocument;
    document.addEventListener("keydown", this.onKeyDown);
    this.cleanup.push(() => document.removeEventListener("keydown", this.onKeyDown));
    this.showTutorial();
    this.render();
  }

  start(): void {
    if (!this.host || this.state?.phase === "flying" || this.state?.phase === "aiming") return;
    this.showTutorial();
  }

  pause(): void {
    if (!this.state) return;
    pauseCannon(this.state);
    this.cancelDrag();
    if (this.state.phase === "paused") this.showPause();
    this.render();
  }

  resume(): void {
    if (!this.state) return;
    resumeCannon(this.state);
    this.hideOverlay();
    this.render();
  }

  update(deltaSeconds: number): void {
    if (!this.state || this.finished) return;
    const oldScore = this.state.score;
    const oldPhase = this.state.phase;
    const wasFinished = this.state.phase === "finished";
    updateCannon(this.state, deltaSeconds);
    if (this.state.score > oldScore) {
      const points = this.state.score - oldScore;
      this.burstAtProjectile(points);
      this.hitFeedbackRemaining = 0.24;
      this.emitFeedback(
        this.state.multiHit > 1 ? "combo" : "hit",
        this.state.multiHit > 1 ? "success" : "medium",
        points,
      );
    }
    if (
      oldPhase === "flying"
      && this.state.phase !== "flying"
      && this.state.currentShotScore === 0
    ) {
      this.missFeedbackRemaining = 0.22;
      this.emitFeedback("miss", "light");
    }
    if (oldPhase === "flying" && this.state.phase === "aiming") {
      const suggested = PICNIC_CLEAR_SEQUENCE[this.state.shotNumber];
      if (this.difficulty === "picnic" && suggested) this.aimPull = { ...suggested };
    }
    this.updateParticles(deltaSeconds);
    if (!wasFinished && this.state.phase === "finished") this.completeRun();
    this.render();
  }

  payout(): MinigamePayout {
    const score = Math.max(0, Math.floor(this.state?.score ?? 0));
    const multiHit = this.state?.multiHit ?? 0;
    return {
      score,
      coins: Math.min(90, Math.floor(score / 220)),
      xp: Math.min(
        180,
        Math.floor(score / 105)
          + Math.max(multiHit, this.state?.bestMultiHit ?? 0) * 3
          + Math.floor((this.state?.totalBounceBonus ?? 0) / 70),
      ),
    };
  }

  dispose(): void {
    for (const remove of this.cleanup.splice(0)) remove();
    this.settlement?.abandon();
    this.cancelDrag();
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
        if (this.tutorialPage < 2) {
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
      case "choose-picnic":
      case "choose-breezy":
      case "choose-blustery":
        this.difficulty = action.replace("choose-", "") as CannonDifficulty;
        this.startRound();
        break;
      case "pause":
        this.pause();
        break;
      case "resume":
        this.resume();
        break;
      case "restart":
      case "quit":
      case "collect":
        break;
      case "aim-up":
        this.adjustAim(0, -1);
        break;
      case "aim-down":
        this.adjustAim(0, 1);
        break;
      case "power-down":
        this.adjustAim(-1, 0);
        break;
      case "power-up":
        this.adjustAim(1, 0);
        break;
      case "fire":
        this.fireAccessibleAim();
        break;
      default:
        break;
    }
  };

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (!this.canvas || !this.state || this.state.phase !== "aiming") return;
    const point = this.toWorld(event);
    if (Math.hypot(point.x - CANNON_ORIGIN.x, point.y - CANNON_ORIGIN.y) > 10) return;
    event.preventDefault();
    this.dragging = true;
    this.pointerId = event.pointerId;
    this.dragPoint = point;
    this.canvas.setPointerCapture(event.pointerId);
    this.render();
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (!this.dragging || event.pointerId !== this.pointerId) return;
    event.preventDefault();
    const point = this.toWorld(event);
    const dx = point.x - CANNON_ORIGIN.x;
    const dy = point.y - CANNON_ORIGIN.y;
    const length = Math.hypot(dx, dy);
    const scale = length > 18 ? 18 / length : 1;
    this.dragPoint = {
      x: CANNON_ORIGIN.x + dx * scale,
      y: CANNON_ORIGIN.y + dy * scale,
    };
    this.render();
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (!this.dragging || event.pointerId !== this.pointerId || !this.state) return;
    event.preventDefault();
    const dragX = CANNON_ORIGIN.x - this.dragPoint.x;
    const dragY = CANNON_ORIGIN.y - this.dragPoint.y;
    const shouldLaunch = Math.hypot(dragX, dragY) >= 3;
    this.cancelDrag();
    if (shouldLaunch) {
      this.aimPull = { x: dragX, y: dragY };
      launchCarrot(this.state, dragX, dragY);
    }
    this.render();
  };

  private readonly onPointerCancel = (event: PointerEvent): void => {
    if (event.pointerId === this.pointerId) this.cancelDrag();
    this.render();
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (!this.state || this.state.phase !== "aiming") return;
    const target = event.target;
    const elementType = this.host?.ownerDocument.defaultView?.HTMLElement;
    if (elementType && target instanceof elementType && target.closest("button, input, textarea, select")) return;
    const adjustments: Readonly<Record<string, readonly [number, number]>> = {
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
    };
    const adjustment = adjustments[event.key];
    if (adjustment) {
      event.preventDefault();
      this.adjustAim(adjustment[0], adjustment[1]);
    } else if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      this.fireAccessibleAim();
    }
  };

  private startRound(): void {
    if (!this.context) return;
    this.state = createCannonState(this.difficulty, this.context.rng);
    beginCannon(this.state);
    this.particles = [];
    this.hitFeedbackRemaining = 0;
    this.missFeedbackRemaining = 0;
    this.aimPull = {
      ...(this.difficulty === "picnic"
        ? PICNIC_CLEAR_SEQUENCE[0] ?? { x: 16, y: -13 }
        : { x: 15, y: -9 }),
    };
    this.cancelDrag();
    this.hideOverlay();
    this.render();
  }

  private cancelDrag(): void {
    if (this.canvas && this.pointerId !== null && this.canvas.hasPointerCapture(this.pointerId)) {
      this.canvas.releasePointerCapture(this.pointerId);
    }
    this.pointerId = null;
    this.dragging = false;
    this.dragPoint = { ...CANNON_ORIGIN };
  }

  private adjustAim(deltaPower: number, deltaHeight: number): void {
    if (!this.state || this.state.phase !== "aiming") return;
    this.aimPull = {
      x: Math.min(18, Math.max(4, this.aimPull.x + deltaPower)),
      y: Math.min(6, Math.max(-18, this.aimPull.y + deltaHeight)),
    };
    this.render();
  }

  private fireAccessibleAim(): void {
    if (!this.state || this.state.phase !== "aiming") return;
    launchCarrot(this.state, this.aimPull.x, this.aimPull.y);
    this.render();
  }

  private showTutorial(): void {
    const pages = [
      ["🥕", "Pull, aim, release", "Drag back like a slingshot, or use the arrow controls and Fire button."],
      ["↗", "Bank clever shots", "Carrots bounce off the ground and edges. A hit after a bounce earns a tasty bonus."],
      ["🎯", "Clear the picnic", "Chain hay, cans, gophers, and the tough piñata in one flight for a multi-hit multiplier."],
    ] as const;
    const page = pages[this.tutorialPage] ?? pages[0];
    const overlay = this.query("[data-cc='overlay']");
    if (!overlay) return;
    overlay.classList.add("is-visible");
    overlay.innerHTML = `
      <div class="cc-card">
        <span class="cc-kicker">CANNON SCHOOL · ${this.tutorialPage + 1}/3</span>
        <div class="cc-tutorial-icon">${page[0]}</div>
        <h2>${page[1]}</h2>
        <p>${page[2]}</p>
        <div class="cc-dots">${pages.map((_, index) => `<i class="${index === this.tutorialPage ? "active" : ""}"></i>`).join("")}</div>
        <div class="cc-card-actions">
          ${this.tutorialPage > 0 ? '<button class="cc-secondary" data-action="tutorial-back">Back</button>' : ""}
          <button class="cc-primary" data-action="tutorial-next">${this.tutorialPage === 2 ? "Choose range" : "Next"}</button>
        </div>
      </div>
    `;
  }

  private showDifficulty(): void {
    const overlay = this.query("[data-cc='overlay']");
    if (!overlay) return;
    overlay.classList.add("is-visible");
    overlay.innerHTML = `
      <div class="cc-card">
        <span class="cc-kicker">CHOOSE A RANGE</span>
        <h2>Ready, aim… carrot!</h2>
        <div class="cc-difficulty-list">
          ${(["picnic", "breezy", "blustery"] as const).map((difficulty, index) => `
            <button data-action="choose-${difficulty}">
              <span>${["☀️", "🍃", "🌬️"][index]}</span>
              <b>${DIFFICULTY_COPY[difficulty].label}</b>
              <small>${DIFFICULTY_COPY[difficulty].note}</small>
            </button>
          `).join("")}
        </div>
      </div>
    `;
  }

  private showPause(): void {
    const overlay = this.query("[data-cc='overlay']");
    if (!overlay) return;
    overlay.classList.add("is-visible");
    overlay.innerHTML = `
      <div class="cc-card">
        <span class="cc-kicker">RANGE PAUSED</span>
        <div class="cc-tutorial-icon">🧺</div>
        <h2>Picnic break</h2>
        <p>Your carrot is safely suspended mid-flight.</p>
        <button class="cc-primary cc-wide" data-action="resume">Back to the range</button>
      </div>
    `;
  }

  private completeRun(): void {
    if (!this.state || this.settlement?.closed) return;
    this.bestScore = Math.max(this.bestScore, this.state.score);
    const payout = this.payout();
    this.finished = true;
    this.settlement?.complete(payout);
  }

  private hideOverlay(): void {
    const overlay = this.query("[data-cc='overlay']");
    overlay?.classList.remove("is-visible");
    if (overlay) overlay.replaceChildren();
  }

  private burstAtProjectile(points: number): void {
    if (!this.state?.projectile || !this.context) return;
    const colors = ["#f8cf4d", "#f27c3d", "#fff6c8", "#73aa5b", "#e45d72"] as const;
    for (let index = 0; index < Math.min(18, 7 + Math.floor(points / 60)); index += 1) {
      const angle = this.context.rng.next() * Math.PI * 2;
      const speed = 4 + this.context.rng.next() * 9;
      this.particles.push({
        x: this.state.projectile.x,
        y: this.state.projectile.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 3,
        life: 0.7 + this.context.rng.next() * 0.45,
        color: this.context.rng.pick(colors),
      });
    }
  }

  private updateParticles(deltaSeconds: number): void {
    const step = Math.min(0.1, Math.max(0, deltaSeconds));
    this.hitFeedbackRemaining = Math.max(0, this.hitFeedbackRemaining - step);
    this.missFeedbackRemaining = Math.max(0, this.missFeedbackRemaining - step);
    for (const particle of this.particles) {
      particle.life -= step;
      particle.vy += 12 * step;
      particle.x += particle.vx * step;
      particle.y += particle.vy * step;
    }
    this.particles = this.particles.filter((particle) => particle.life > 0);
  }

  private render(): void {
    const canvas = this.canvas;
    if (!canvas) return;
    this.resizeCanvas(canvas);
    const drawing = canvas.getContext("2d");
    if (!drawing) return;
    const width = canvas.width;
    const height = canvas.height;
    drawing.clearRect(0, 0, width, height);
    const scaleX = width / WORLD_WIDTH;
    const scaleY = height / WORLD_HEIGHT;
    drawing.save();
    drawing.scale(scaleX, scaleY);
    this.drawRange(drawing);
    if (this.state) {
      this.drawTrajectory(drawing);
      for (const target of this.state.targets) this.drawTarget(drawing, target);
      this.drawProjectile(drawing);
    }
    this.drawCannon(drawing);
    this.drawParticles(drawing);
    drawing.restore();

    const state = this.state;
    this.setText("[data-cc='shots']", String(state?.shotsRemaining ?? 10));
    this.setText("[data-cc='score']", Math.floor(state?.score ?? 0).toLocaleString());
    this.setText("[data-cc='best']", `BEST ${Math.floor(this.bestScore).toLocaleString()}`);
    this.setText("[data-cc='message']", state?.message ?? "Drag to aim, or use the arrow controls!");
    this.setText("[data-cc='difficulty']", DIFFICULTY_COPY[this.difficulty].label.toUpperCase());
    const wind = this.query("[data-cc='wind']");
    if (wind) {
      const value = state?.wind ?? 0;
      wind.innerHTML = `<small>WIND</small><b>${value === 0 ? "CALM" : `${value > 0 ? "→" : "←"} ${Math.abs(value).toFixed(1)}`}</b>`;
      wind.classList.toggle("is-windy", value !== 0);
    }
    const power = this.query("[data-cc='power']");
    if (power) {
      const aim = this.currentAim();
      const strength = state?.phase === "aiming" || this.dragging
        ? Math.min(1, Math.hypot(aim.x, aim.y) / 18)
        : 0;
      power.style.width = `${strength * 100}%`;
    }
    this.host?.classList.toggle("is-hit", this.hitFeedbackRemaining > 0);
    this.host?.classList.toggle("is-miss", this.missFeedbackRemaining > 0);
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

  private drawRange(drawing: CanvasRenderingContext2D): void {
    const sky = drawing.createLinearGradient(0, 0, 0, WORLD_HEIGHT);
    sky.addColorStop(0, "#aee3ec");
    sky.addColorStop(0.68, "#e8f3cf");
    sky.addColorStop(0.69, "#8fbe63");
    sky.addColorStop(1, "#649649");
    drawing.fillStyle = sky;
    drawing.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    drawing.fillStyle = "rgba(255,255,255,.62)";
    for (const cloud of [[14, 11, 7], [55, 8, 5], [88, 14, 6]] as const) {
      drawing.beginPath();
      drawing.ellipse(cloud[0], cloud[1], cloud[2], cloud[2] * 0.42, 0, 0, Math.PI * 2);
      drawing.fill();
    }
    drawing.fillStyle = "#78a956";
    drawing.beginPath();
    drawing.moveTo(0, 47);
    drawing.quadraticCurveTo(20, 35, 42, 48);
    drawing.quadraticCurveTo(70, 32, 100, 46);
    drawing.lineTo(100, 70);
    drawing.lineTo(0, 70);
    drawing.fill();
    drawing.strokeStyle = "rgba(255,255,255,.22)";
    drawing.lineWidth = 0.35;
    for (let x = 4; x < 100; x += 7) {
      drawing.beginPath();
      drawing.moveTo(x, 64);
      drawing.lineTo(x + 1.1, 60);
      drawing.stroke();
    }
    drawing.fillStyle = "#7b5136";
    drawing.fillRect(0, CANNON_FLOOR_Y + 1.2, 100, 1.6);
  }

  private drawCannon(drawing: CanvasRenderingContext2D): void {
    const carrot = this.dragging ? this.dragPoint : CANNON_ORIGIN;
    drawing.save();
    drawing.strokeStyle = "#6c4935";
    drawing.lineWidth = 0.7;
    drawing.beginPath();
    drawing.moveTo(4, 63);
    drawing.lineTo(12, 53);
    drawing.lineTo(20, 63);
    drawing.stroke();
    drawing.fillStyle = "#df7940";
    drawing.beginPath();
    drawing.arc(12, 62, 5.2, 0, Math.PI * 2);
    drawing.fill();
    drawing.fillStyle = "#5c4538";
    drawing.beginPath();
    drawing.arc(12, 62, 2.2, 0, Math.PI * 2);
    drawing.fill();
    if (this.dragging) {
      drawing.strokeStyle = "#71503c";
      drawing.lineWidth = 0.65;
      drawing.beginPath();
      drawing.moveTo(9.7, 52.5);
      drawing.lineTo(carrot.x, carrot.y);
      drawing.lineTo(14.3, 52.5);
      drawing.stroke();
    }
    this.drawCarrot(drawing, carrot.x, carrot.y, this.dragging ? -0.35 : -0.65);
    drawing.restore();
  }

  private drawCarrot(drawing: CanvasRenderingContext2D, x: number, y: number, rotation: number): void {
    drawing.save();
    drawing.translate(x, y);
    drawing.rotate(rotation);
    drawing.fillStyle = "#ef7f35";
    drawing.beginPath();
    drawing.moveTo(-2.3, -1.5);
    drawing.quadraticCurveTo(2.8, -2.3, 5, 0);
    drawing.quadraticCurveTo(2.8, 2.3, -2.3, 1.5);
    drawing.closePath();
    drawing.fill();
    drawing.strokeStyle = "#d35f2c";
    drawing.lineWidth = 0.25;
    drawing.stroke();
    drawing.strokeStyle = "#5e9d4d";
    drawing.lineWidth = 0.65;
    for (const offset of [-0.8, 0, 0.8]) {
      drawing.beginPath();
      drawing.moveTo(-2, offset * 0.5);
      drawing.lineTo(-4.4, offset * 1.8);
      drawing.stroke();
    }
    drawing.restore();
  }

  private drawTrajectory(drawing: CanvasRenderingContext2D): void {
    if (
      !this.state
      || this.difficulty !== "picnic"
      || (!this.dragging && this.state.phase !== "aiming")
    ) return;
    const aim = this.currentAim();
    const points = predictTrajectory(aim.x, aim.y, this.state.wind);
    drawing.fillStyle = "rgba(255,255,238,.82)";
    points.forEach((point, index) => {
      drawing.globalAlpha = 1 - index / Math.max(points.length * 1.4, 1);
      drawing.beginPath();
      drawing.arc(point.x, point.y, Math.max(0.32, 0.65 - index * 0.014), 0, Math.PI * 2);
      drawing.fill();
    });
    drawing.globalAlpha = 1;
  }

  private drawTarget(drawing: CanvasRenderingContext2D, target: CannonTarget): void {
    if (!target.active) return;
    drawing.save();
    drawing.translate(target.x, target.y);
    if (target.wobble > 0) drawing.rotate(Math.sin(target.wobble * 70) * 0.12);
    switch (target.kind) {
      case "hay":
        drawing.fillStyle = "#e4b94e";
        drawing.fillRect(-4.2, -4, 8.4, 8);
        drawing.strokeStyle = "#ba8734";
        drawing.lineWidth = 0.5;
        drawing.strokeRect(-4.2, -4, 8.4, 8);
        drawing.beginPath();
        drawing.moveTo(-4, -1);
        drawing.lineTo(4, 1);
        drawing.moveTo(-3.5, 2.6);
        drawing.lineTo(3.5, -2.4);
        drawing.stroke();
        break;
      case "can":
        drawing.fillStyle = "#dfe9e3";
        drawing.fillRect(-1.7, -3.5, 3.4, 7);
        drawing.fillStyle = "#e05f53";
        drawing.fillRect(-1.7, -1.6, 3.4, 2.8);
        drawing.strokeStyle = "#84938f";
        drawing.lineWidth = 0.35;
        drawing.strokeRect(-1.7, -3.5, 3.4, 7);
        break;
      case "gopher":
        drawing.fillStyle = "#4b3427";
        drawing.beginPath();
        drawing.ellipse(0, 3.1, 3.5, 1.2, 0, 0, Math.PI * 2);
        drawing.fill();
        drawing.fillStyle = "#a87950";
        drawing.beginPath();
        drawing.ellipse(0, 0, 2.7, 3.8, 0, 0, Math.PI * 2);
        drawing.fill();
        drawing.fillStyle = "#32231e";
        drawing.beginPath();
        drawing.arc(-0.8, -0.7, 0.3, 0, Math.PI * 2);
        drawing.arc(0.8, -0.7, 0.3, 0, Math.PI * 2);
        drawing.fill();
        break;
      case "pinata":
        drawing.fillStyle = target.hp > 1 ? "#ef6d76" : "#f5a85c";
        drawing.beginPath();
        drawing.ellipse(0, 0, 5.4, 3.6, -0.15, 0, Math.PI * 2);
        drawing.fill();
        drawing.fillStyle = "#6fb2b8";
        drawing.fillRect(-4.5, -1, 9, 1.4);
        drawing.fillStyle = "#f7d750";
        drawing.fillRect(-3.7, 1.2, 7.5, 1.2);
        drawing.strokeStyle = "#80684b";
        drawing.lineWidth = 0.35;
        drawing.beginPath();
        drawing.moveTo(0, -3.5);
        drawing.lineTo(0, -12);
        drawing.stroke();
        break;
    }
    if (target.maxHp > 1) {
      const width = 12;
      const ratio = Math.max(0, target.hp / target.maxHp);
      drawing.fillStyle = "rgba(62,48,43,.62)";
      drawing.fillRect(-width / 2, -8.8, width, 2.2);
      drawing.fillStyle = ratio > 0.5 ? "#77bc67" : "#ffd457";
      drawing.fillRect(-width / 2 + 0.35, -8.45, (width - 0.7) * ratio, 1.5);
      drawing.fillStyle = "#fffbea";
      drawing.font = "bold 2.3px sans-serif";
      drawing.textAlign = "center";
      drawing.fillText(`${target.hp}/${target.maxHp} HP`, 0, -10);
    }
    drawing.restore();
  }

  private drawProjectile(drawing: CanvasRenderingContext2D): void {
    const projectile = this.state?.projectile;
    if (!projectile) return;
    projectile.trail.forEach((point, index) => {
      drawing.fillStyle = `rgba(255,236,146,${(index + 1) / projectile.trail.length * 0.35})`;
      drawing.beginPath();
      drawing.arc(point.x, point.y, 0.25 + index * 0.018, 0, Math.PI * 2);
      drawing.fill();
    });
    this.drawCarrot(drawing, projectile.x, projectile.y, projectile.rotation);
  }

  private drawParticles(drawing: CanvasRenderingContext2D): void {
    for (const particle of this.particles) {
      drawing.globalAlpha = Math.min(1, particle.life * 1.5);
      drawing.fillStyle = particle.color;
      drawing.fillRect(particle.x - 0.45, particle.y - 0.45, 0.9, 0.9);
    }
    drawing.globalAlpha = 1;
  }

  private toWorld(event: PointerEvent): CannonPoint {
    const rect = this.canvas?.getBoundingClientRect();
    if (!rect) return { ...CANNON_ORIGIN };
    return {
      x: (event.clientX - rect.left) / Math.max(1, rect.width) * WORLD_WIDTH,
      y: (event.clientY - rect.top) / Math.max(1, rect.height) * WORLD_HEIGHT,
    };
  }

  private currentAim(): CannonPoint {
    return this.dragging
      ? {
          x: CANNON_ORIGIN.x - this.dragPoint.x,
          y: CANNON_ORIGIN.y - this.dragPoint.y,
        }
      : this.aimPull;
  }

  private emitFeedback(
    action: "hit" | "miss" | "combo",
    pattern: "light" | "medium" | "success",
    value?: number,
  ): void {
    const shared: SharedFeedbackContext | null = this.context;
    shared?.audio?.emit(action, value);
    shared?.haptics?.impact(pattern);
  }

  private query(selector: string): HTMLElement | null {
    return this.host?.querySelector<HTMLElement>(selector) ?? null;
  }

  private setText(selector: string, value: string): void {
    const element = this.query(selector);
    if (element && element.textContent !== value) element.textContent = value;
  }
}

export const createMinigame: MinigameFactory = () => new CarrotCannonMinigame();

export const definition = {
  id: "carrot-cannon",
  title: TITLE,
  instructions: INSTRUCTIONS,
} as const satisfies MinigameStubDefinition;
