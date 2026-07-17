import type { Economy } from "../core/contracts/economy";
import { NEED_KEYS, type Needs } from "../core/contracts/simulation";

export interface UiActions {
  feed(): void;
  sleep(): void;
  wake(): void;
  navigate(label: string): void;
  onboardingComplete(): void;
}

const NEED_PRESENTATION = {
  hunger: { icon: "🥕", label: "Full" },
  energy: { icon: "☀", label: "Rest" },
  hygiene: { icon: "✦", label: "Clean" },
  fun: { icon: "♥", label: "Fun" },
} as const;

export class GameUI {
  readonly canvas: HTMLCanvasElement;
  readonly fxLayer: HTMLElement;
  private readonly toastElement: HTMLElement;
  private readonly sleepOverlay: HTMLElement;
  private readonly sleepCountdown: HTMLElement;
  private readonly inventoryCount: HTMLElement;
  private onboardingStep = 0;

  constructor(
    private readonly root: HTMLElement,
    private readonly actions: UiActions,
  ) {
    root.innerHTML = `
      <main class="game-shell">
        <canvas id="game-canvas" aria-label="Gooby's cozy living room"></canvas>
        <div class="sun-glow" aria-hidden="true"></div>
        <div class="hud" aria-label="Gooby's status">
          <section class="brand-card glass">
            <div class="brand-copy"><span class="eyebrow">COZY HOME</span><strong>Gooby</strong></div>
            <div class="currency"><span aria-label="Coins">● <b data-coins>0</b></span><span aria-label="Level">Lv <b data-level>1</b></span></div>
          </section>
          <section class="needs-card glass">
            ${NEED_KEYS.map((key) => `
              <div class="need" data-need="${key}">
                <span class="need-icon">${NEED_PRESENTATION[key].icon}</span>
                <div><span>${NEED_PRESENTATION[key].label}</span><div class="meter"><i></i></div></div>
              </div>`).join("")}
          </section>
        </div>
        <div class="interaction-hint glass">Tap, stroke, or tickle Gooby</div>
        <section class="sleep-overlay" hidden aria-live="polite">
          <div class="zzz">Z<span>z</span><small>z</small></div>
          <div class="sleep-copy"><strong>Dreaming of carrots…</strong><span data-sleep-countdown>30:00</span></div>
          <button class="soft-button" data-action="wake">Wake gently</button>
        </section>
        <div class="fx-layer" aria-hidden="true"></div>
        <div class="toast" role="status" aria-live="polite"></div>
        <section class="bottom-ui">
          <div class="quick-actions">
            <button class="action-button feed-button" data-action="feed" data-testid="feed">
              <span class="action-icon">🥕</span><span><b>Feed</b><small><i data-carrots>3</i> carrots</small></span>
            </button>
            <button class="action-button sleep-button" data-action="sleep" data-testid="sleep">
              <span class="action-icon">☾</span><span><b>Sleep</b><small>Cozy rest</small></span>
            </button>
          </div>
          <nav class="tab-bar glass" aria-label="Main">
            ${[
              ["Places", "⌂"],
              ["Play", "◆"],
              ["Wardrobe", "♧"],
              ["Items", "▣"],
              ["Settings", "⚙"],
            ].map(([label, icon], index) => `<button data-nav="${label}" class="${index === 0 ? "active" : ""}"><span>${icon}</span><small>${label}</small></button>`).join("")}
          </nav>
        </section>
        <section class="onboarding" data-testid="onboarding" hidden>
          <div class="onboarding-art"><span class="mini-ear one"></span><span class="mini-ear two"></span><div class="mini-gooby">♥</div></div>
          <div class="onboarding-copy">
            <span class="eyebrow">WELCOME HOME</span>
            <h1>Meet Gooby</h1>
            <p>He’s soft, round, curious, and very ready to be your new best friend.</p>
          </div>
          <div class="onboarding-dots"><i class="active"></i><i></i><i></i></div>
          <button class="primary-button" data-action="onboarding-next">Let’s meet!</button>
        </section>
      </main>
    `;
    this.canvas = root.querySelector<HTMLCanvasElement>("#game-canvas") as HTMLCanvasElement;
    this.fxLayer = root.querySelector<HTMLElement>(".fx-layer") as HTMLElement;
    this.toastElement = root.querySelector<HTMLElement>(".toast") as HTMLElement;
    this.sleepOverlay = root.querySelector<HTMLElement>(".sleep-overlay") as HTMLElement;
    this.sleepCountdown = root.querySelector<HTMLElement>("[data-sleep-countdown]") as HTMLElement;
    this.inventoryCount = root.querySelector<HTMLElement>("[data-carrots]") as HTMLElement;
    root.querySelector('[data-action="feed"]')?.addEventListener("click", () => actions.feed());
    root.querySelector('[data-action="sleep"]')?.addEventListener("click", () => actions.sleep());
    root.querySelector('[data-action="wake"]')?.addEventListener("click", () => actions.wake());
    root.querySelector('[data-action="onboarding-next"]')?.addEventListener("click", this.nextOnboarding);
    for (const button of root.querySelectorAll<HTMLElement>("[data-nav]")) {
      button.addEventListener("click", () => actions.navigate(button.dataset.nav ?? ""));
    }
  }

  update(needs: Needs, economy: Economy, carrots: number): void {
    for (const key of NEED_KEYS) {
      const meter = this.root.querySelector<HTMLElement>(`[data-need="${key}"] .meter i`);
      if (meter) meter.style.width = `${needs[key]}%`;
    }
    const coins = this.root.querySelector<HTMLElement>("[data-coins]");
    const level = this.root.querySelector<HTMLElement>("[data-level]");
    if (coins) coins.textContent = economy.coins.toString();
    if (level) level.textContent = economy.level.toString();
    this.inventoryCount.textContent = carrots.toString();
  }

  showOnboarding(): void {
    const onboarding = this.root.querySelector<HTMLElement>(".onboarding");
    if (onboarding) onboarding.hidden = false;
  }

  private readonly nextOnboarding = (): void => {
    const onboarding = this.root.querySelector<HTMLElement>(".onboarding");
    if (!onboarding) return;
    const title = onboarding.querySelector("h1");
    const body = onboarding.querySelector("p");
    const button = onboarding.querySelector<HTMLButtonElement>(".primary-button");
    const dots = [...onboarding.querySelectorAll("i")];
    this.onboardingStep += 1;
    dots.forEach((dot, index) => dot.classList.toggle("active", index === this.onboardingStep));
    if (this.onboardingStep === 1) {
      if (title) title.textContent = "A little care";
      if (body) body.textContent = "Feed, play, wash, and rest together. Gooby’s needs keep changing while you’re away.";
      if (button) button.textContent = "Show me how";
      return;
    }
    if (this.onboardingStep === 2) {
      if (title) title.textContent = "You’re all set";
      if (body) body.textContent = "Start with a gentle pat—then share one of Gooby’s favorite carrots.";
      if (button) button.textContent = "Welcome home";
      return;
    }
    onboarding.hidden = true;
    this.actions.onboardingComplete();
  };

  setSleeping(sleeping: boolean, remainingMs = 0): void {
    this.sleepOverlay.hidden = !sleeping;
    const seconds = Math.max(0, Math.ceil(remainingMs / 1_000));
    const minutesPart = Math.floor(seconds / 60).toString().padStart(2, "0");
    const secondsPart = (seconds % 60).toString().padStart(2, "0");
    this.sleepCountdown.textContent = `${minutesPart}:${secondsPart}`;
    this.root.classList.toggle("is-sleeping", sleeping);
  }

  toast(message: string): void {
    this.toastElement.textContent = message;
    this.toastElement.classList.remove("show");
    requestAnimationFrame(() => this.toastElement.classList.add("show"));
    setTimeout(() => this.toastElement.classList.remove("show"), 2_200);
  }

  dispose(): void {
    this.root.replaceChildren();
  }
}
