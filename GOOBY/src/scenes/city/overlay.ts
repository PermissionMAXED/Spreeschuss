import type { CityDriveState, ShopId } from "../../core/contracts/scenes";
import type { DriveControls } from "../../core/contracts/input";
import { CITY_DESTINATIONS } from "../../data/city";
import { CityPointerControls, type DriveControlRegion } from "./controls";
import type { RecoveryMode } from "./simulation";
import { CITY_MARKER_VISUALS } from "./world";

export interface EdgePointerLayout {
  x: number;
  y: number;
  angleRadians: number;
}

export interface CityOverlayMetrics {
  readonly distance: number;
  readonly destinationLabel: string;
  readonly districtLabel: string;
  readonly coinsCollected: number;
  readonly boostSeconds: number;
  readonly recoveryMode: RecoveryMode;
}

export interface CityOverlayHandlers {
  select(shop: ShopId): void;
  depart(): void;
  enterShop(): void;
  driveHome(): void;
  quickReturn(): void;
  controlsChanged(controls: DriveControls): void;
}

const SHOP_ORDER: readonly ShopId[] = ["carrot-market", "fluff-salon", "cloud-boutique"];
const DESTINATION_REARM_DELAY_MS = 250;

export function computeEdgePointer(
  width: number,
  height: number,
  normalizedX: number,
  normalizedY: number,
  behindCamera = false,
  target?: EdgePointerLayout,
): EdgePointerLayout {
  const safeWidth = Math.max(1, width);
  const safeHeight = Math.max(1, height);
  let directionX = normalizedX;
  let directionY = -normalizedY;
  if (behindCamera) {
    directionX *= -1;
    directionY *= -1;
  }
  if (Math.abs(directionX) + Math.abs(directionY) < 0.001) directionY = -1;

  const centerX = safeWidth / 2;
  const centerY = safeHeight / 2;
  const insetX = Math.max(34, Math.min(64, safeWidth * 0.12));
  const insetTop = Math.max(112, safeHeight * 0.2);
  const insetBottom = Math.max(130, safeHeight * 0.18);
  const maxX = centerX - insetX;
  const maxY = Math.min(centerY - insetTop, centerY - insetBottom);
  const scale = Math.min(
    maxX / Math.max(0.001, Math.abs(directionX)),
    Math.max(45, maxY) / Math.max(0.001, Math.abs(directionY)),
  );
  const result = target ?? { x: 0, y: 0, angleRadians: 0 };
  result.x = Math.max(insetX, Math.min(safeWidth - insetX, centerX + directionX * scale));
  result.y = Math.max(insetTop, Math.min(safeHeight - insetBottom, centerY + directionY * scale));
  result.angleRadians = Math.atan2(directionY, directionX) + Math.PI / 2;
  return result;
}

function requiredElement<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`City overlay element is missing: ${selector}`);
  return element;
}

export class CityDriveOverlay {
  readonly root: HTMLElement;
  private readonly destinationBoard: HTMLElement;
  private readonly startButton: HTMLButtonElement;
  private readonly arrivedBoard: HTMLElement;
  private readonly returnBoard: HTMLElement;
  private readonly returnCopy: HTMLElement;
  private readonly quickReturnButton: HTMLButtonElement;
  private readonly controlsRoot: HTMLElement;
  private readonly distanceBanner: HTMLElement;
  private readonly distanceValue: HTMLElement;
  private readonly destinationValue: HTMLElement;
  private readonly districtValue: HTMLElement;
  private readonly coinValue: HTMLElement;
  private readonly boostValue: HTMLElement;
  private readonly recoveryValue: HTMLElement;
  private readonly edgePointer: HTMLElement;
  private readonly pointerControls: CityPointerControls;
  private readonly destinationPointerStarts = new Map<number, HTMLButtonElement>();
  private destinationSelectionEnabledAt = 0;
  private wasDriving = false;

  constructor(
    mount: HTMLElement,
    handlers: CityOverlayHandlers,
  ) {
    this.root = document.createElement("section");
    this.root.className = "city-drive-overlay";
    this.root.setAttribute("aria-label", "Gooby City drive");
    this.root.innerHTML = `
      <style>
        .city-drive-overlay, .city-drive-overlay * { box-sizing: border-box; }
        .city-drive-overlay {
          position: absolute; inset: 0; z-index: 18; pointer-events: none;
          color: #432f35; font-family: ui-rounded, "Arial Rounded MT Bold", system-ui, sans-serif;
          --gold: ${CITY_MARKER_VISUALS.goldCss}; --cream: #fff7df;
        }
        .city-drive-overlay button { font: inherit; }
        .city-distance-banner {
          position: absolute; top: max(20%, 142px); left: 50%; translate: -50% 0;
          width: min(84%, 380px); display: grid; grid-template-columns: 1fr auto; gap: .25rem 1rem;
          padding: .72rem .9rem; border: 2px solid rgba(255,255,255,.72); border-radius: 18px;
          background: rgba(255,248,226,.92); box-shadow: 0 8px 22px rgba(64,44,38,.18);
          backdrop-filter: blur(8px); pointer-events: none;
        }
        .city-distance-banner[hidden] { display: none; }
        .city-distance-banner strong { font-size: .94rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .city-distance-banner b { color: #9b5a16; font-size: 1rem; }
        .city-distance-banner small { color: #755e61; font-size: .7rem; }
        .city-distance-banner .city-district { text-align: right; }
        .city-board {
          position: absolute; top: 31%; left: 50%; translate: -50% 0;
          width: min(88%, 410px); max-height: 49%; overflow: auto; pointer-events: auto;
          padding: 1rem; border: 2px solid rgba(255,255,255,.8); border-radius: 24px;
          background: linear-gradient(155deg, rgba(255,249,230,.97), rgba(244,218,180,.96));
          box-shadow: 0 18px 44px rgba(70,42,35,.25); text-align: center;
        }
        .city-board[hidden] { display: none; }
        .city-board h1, .city-board h2 { margin: .1rem 0 .3rem; font-size: 1.23rem; }
        .city-board p { margin: .2rem auto .75rem; color: #755e61; font-size: .79rem; line-height: 1.35; }
        .city-shop-list { display: grid; gap: .48rem; }
        .city-shop-card {
          width: 100%; display: grid; grid-template-columns: 2.3rem 1fr auto; align-items: center;
          gap: .6rem; min-height: 3.45rem; padding: .55rem .7rem; border: 2px solid transparent;
          border-radius: 16px; color: #493238; background: rgba(255,255,255,.72); text-align: left;
          box-shadow: 0 3px 0 rgba(126,77,48,.12); touch-action: manipulation;
        }
        .city-shop-card.is-selected { border-color: var(--gold); background: #fff9df; }
        .city-shop-card .city-shop-icon { display: grid; place-items: center; width: 2.25rem; height: 2.25rem;
          border-radius: 12px; background: #f3c97e; font-size: 1.15rem; }
        .city-shop-card strong, .city-shop-card small { display: block; }
        .city-shop-card small { color: #826b68; font-size: .67rem; margin-top: .13rem; }
        .city-shop-card em { font-style: normal; color: #9b5a16; font-size: .69rem; font-weight: 800; }
        .city-primary {
          width: 100%; min-height: 3.35rem; margin-top: .7rem; border: 0; border-radius: 17px;
          color: #4b321d; background: linear-gradient(180deg, #ffd969, #f6b83f);
          box-shadow: 0 5px 0 #bd792d, 0 10px 18px rgba(132,80,31,.22); font-weight: 900;
          touch-action: manipulation;
        }
        .city-primary:active { translate: 0 3px; box-shadow: 0 2px 0 #bd792d; }
        .city-primary[hidden] { display: none; }
        .city-secondary { width: 100%; min-height: 2.75rem; margin-top: .65rem; border: 2px solid #b98957;
          border-radius: 15px; color: #654735; background: rgba(255,255,255,.7); font-weight: 800; }
        .city-controls {
          position: absolute; left: 5%; right: 5%; top: 65%; height: 17%;
          display: grid; grid-template-columns: 1fr .95fr 1fr; gap: 8%; pointer-events: none;
        }
        .city-controls[hidden] { display: none; }
        .city-control {
          pointer-events: auto; min-width: 0; border: 3px solid rgba(255,255,255,.82); border-radius: 23px;
          background: rgba(58,58,65,.76); color: white; font-size: 1.7rem; font-weight: 900;
          box-shadow: 0 7px 0 rgba(33,31,36,.72), 0 13px 22px rgba(32,31,37,.28);
          backdrop-filter: blur(7px); touch-action: none; user-select: none; -webkit-user-select: none;
        }
        .city-control span { display: block; font-size: .58rem; letter-spacing: .08em; margin-top: .1rem; }
        .city-control[data-control="brake"] { background: rgba(189,55,49,.88); font-size: 1.15rem; }
        .city-control.is-held { translate: 0 6px; box-shadow: 0 1px 0 rgba(33,31,36,.72);
          filter: brightness(1.24); border-color: var(--gold); }
        .city-drive-status {
          position: absolute; top: 83%; left: 50%; translate: -50% 0; display: flex; gap: .5rem;
          color: white; font-weight: 850; font-size: .68rem; text-shadow: 0 2px 5px #3b292b;
        }
        .city-drive-status span { padding: .3rem .55rem; border-radius: 999px; background: rgba(55,48,55,.72); }
        .city-drive-status [data-boost]:empty, .city-drive-status [data-recovery]:empty { display: none; }
        .city-edge-pointer {
          position: absolute; width: 3rem; height: 3rem; margin: -1.5rem; display: grid; place-items: center;
          color: #563413; background: var(--gold); border: 4px solid #fff7c7; border-radius: 50% 50% 50% 12%;
          box-shadow: 0 0 0 3px #8a5517, 0 0 24px 8px rgba(255,198,47,.72);
          font-size: 1.45rem; font-weight: 1000; pointer-events: none;
        }
        .city-edge-pointer[hidden] { display: none; }
        .city-arrival-badge { width: 4.2rem; height: 4.2rem; margin: 0 auto .6rem; display: grid;
          place-items: center; border-radius: 50%; background: var(--gold); font-size: 2rem;
          box-shadow: 0 0 0 7px rgba(255,198,47,.25); }
        @media (max-height: 690px) {
          .city-distance-banner { top: 17%; }
          .city-board { top: 26%; max-height: 55%; }
          .city-controls { top: 63%; }
        }
      </style>
      <aside class="city-distance-banner" data-testid="city-distance" hidden>
        <strong data-destination>Destination</strong><b data-distance>0 m</b>
        <small>Follow the gold arrows</small><small class="city-district" data-district>Maple Suburb</small>
      </aside>
      <section class="city-board" data-board="destinations">
        <small>GOOBY GARAGE</small>
        <h1>Where should we drive?</h1>
        <p>The car stays parked until you choose a card and press start.</p>
        <div class="city-shop-list">
          ${SHOP_ORDER.map((shop) => {
            const destination = CITY_DESTINATIONS[shop];
            const icon = shop === "carrot-market" ? "🥕" : shop === "fluff-salon" ? "✂" : "☁";
            return `<button class="city-shop-card" data-shop="${shop}" data-testid="destination-${shop}">
              <span class="city-shop-icon">${icon}</span>
              <span><strong>${destination.label}</strong><small>${destination.districtLabel}</small></span>
              <em>CHOOSE</em>
            </button>`;
          }).join("")}
        </div>
        <button class="city-primary" data-action="depart" data-testid="start-drive" hidden>Start cozy drive →</button>
      </section>
      <section class="city-board" data-board="arrived" hidden>
        <div class="city-arrival-badge">P</div>
        <h2>Perfect parking!</h2>
        <p>You reached the selected shop. The car is parked and ready when you return.</p>
        <button class="city-primary" data-action="enter-shop" data-testid="enter-shop">Enter shop</button>
      </section>
      <section class="city-board" data-board="return" hidden>
        <small>SHOP PARKING</small>
        <h2>Ready to head home?</h2>
        <p data-return-copy></p>
        <button class="city-primary" data-action="drive-home" data-testid="drive-home">Drive back to Gooby Garage</button>
        <button class="city-secondary" data-action="quick-return" data-testid="quick-return" hidden>Quick trip home</button>
      </section>
      <div class="city-controls" aria-label="Driving controls" hidden>
        <button class="city-control" data-control="steer-left" aria-label="Hold to steer left">◀<span>HOLD · A / ←</span></button>
        <button class="city-control" data-control="brake" aria-label="Hold brake">BRAKE<span>SPACE · S / ↓</span></button>
        <button class="city-control" data-control="steer-right" aria-label="Hold to steer right">▶<span>HOLD · D / →</span></button>
      </div>
      <div class="city-drive-status" aria-live="polite">
        <span>● <b data-coins>0</b></span><span data-boost></span><span data-recovery></span>
      </div>
      <div class="city-edge-pointer" aria-hidden="true" hidden>▲</div>
    `;
    mount.append(this.root);

    this.destinationBoard = requiredElement(this.root, '[data-board="destinations"]');
    this.startButton = requiredElement(this.root, '[data-action="depart"]');
    this.arrivedBoard = requiredElement(this.root, '[data-board="arrived"]');
    this.returnBoard = requiredElement(this.root, '[data-board="return"]');
    this.returnCopy = requiredElement(this.root, "[data-return-copy]");
    this.quickReturnButton = requiredElement(this.root, '[data-action="quick-return"]');
    this.controlsRoot = requiredElement(this.root, ".city-controls");
    this.distanceBanner = requiredElement(this.root, ".city-distance-banner");
    this.distanceValue = requiredElement(this.root, "[data-distance]");
    this.destinationValue = requiredElement(this.root, "[data-destination]");
    this.districtValue = requiredElement(this.root, "[data-district]");
    this.coinValue = requiredElement(this.root, "[data-coins]");
    this.boostValue = requiredElement(this.root, "[data-boost]");
    this.recoveryValue = requiredElement(this.root, "[data-recovery]");
    this.edgePointer = requiredElement(this.root, ".city-edge-pointer");

    for (const button of this.root.querySelectorAll<HTMLButtonElement>("[data-shop]")) {
      button.addEventListener("pointerdown", (event) => {
        if (
          !this.destinationBoard.hidden
          && performance.now() >= this.destinationSelectionEnabledAt
        ) {
          this.destinationPointerStarts.set(event.pointerId, button);
        }
      });
      button.addEventListener("pointercancel", (event) => {
        this.destinationPointerStarts.delete(event.pointerId);
      });
      button.addEventListener("click", (event) => {
        const pointerId = event.pointerId;
        const startedOnButton = this.destinationPointerStarts.get(pointerId) === button;
        this.destinationPointerStarts.delete(pointerId);
        if (event.detail !== 0 && !startedOnButton) return;
        const shop = button.dataset.shop as ShopId;
        handlers.select(shop);
      });
    }
    this.startButton.addEventListener("click", () => handlers.depart());
    requiredElement<HTMLButtonElement>(this.root, '[data-action="enter-shop"]')
      .addEventListener("click", () => handlers.enterShop());
    requiredElement<HTMLButtonElement>(this.root, '[data-action="drive-home"]')
      .addEventListener("click", () => handlers.driveHome());
    this.quickReturnButton.addEventListener("click", () => handlers.quickReturn());

    const buttons = Object.fromEntries(
      (["steer-left", "brake", "steer-right"] as const).map((region) => [
        region,
        requiredElement<HTMLButtonElement>(this.root, `[data-control="${region}"]`),
      ]),
    ) as Record<DriveControlRegion, HTMLButtonElement>;
    this.pointerControls = new CityPointerControls(buttons, (controls) => handlers.controlsChanged(controls));
  }

  get controls(): DriveControls {
    return this.pointerControls.controls;
  }

  render(state: CityDriveState, metrics: CityOverlayMetrics): void {
    const driving = state.phase === "driving-outbound" || state.phase === "driving-home";
    if (this.wasDriving && state.phase === "destination-board") {
      this.destinationSelectionEnabledAt = performance.now() + DESTINATION_REARM_DELAY_MS;
      this.destinationPointerStarts.clear();
    }
    this.wasDriving = driving;
    if (driving) this.destinationPointerStarts.clear();
    this.pointerControls.setEnabled(driving);
    this.destinationBoard.hidden = state.phase !== "destination-board" && state.phase !== "depart-ready";
    this.arrivedBoard.hidden = state.phase !== "arrived";
    this.returnBoard.hidden = state.phase !== "return-board";
    this.controlsRoot.hidden = !driving;
    this.distanceBanner.hidden = !driving;
    this.edgePointer.hidden = !driving;

    const selected = state.phase === "depart-ready" || state.phase === "driving-outbound" || state.phase === "arrived"
      ? state.selected
      : null;
    for (const card of this.root.querySelectorAll<HTMLElement>("[data-shop]")) {
      const isSelected = card.dataset.shop === selected;
      card.classList.toggle("is-selected", isSelected);
      const action = card.querySelector("em");
      if (action) action.textContent = isSelected ? "READY" : "CHOOSE";
    }
    this.startButton.hidden = state.phase !== "depart-ready";

    if (state.phase === "return-board") {
      this.returnCopy.textContent = state.returnRequired
        ? "Your first visit makes the return journey part of the adventure."
        : "Drive the scenic route again, or use the unlocked quick trip.";
      this.quickReturnButton.hidden = state.returnRequired;
    }

    this.distanceValue.textContent = `${Math.max(0, Math.ceil(metrics.distance))} m`;
    this.destinationValue.textContent = metrics.destinationLabel;
    this.districtValue.textContent = metrics.districtLabel;
    this.coinValue.textContent = metrics.coinsCollected.toString();
    this.boostValue.textContent = metrics.boostSeconds > 0 ? `BOOST ${metrics.boostSeconds.toFixed(1)}s` : "";
    this.recoveryValue.textContent = metrics.recoveryMode === "none"
      ? ""
      : metrics.recoveryMode === "reverse"
        ? "RECOVERY · reversing"
        : metrics.recoveryMode === "re-aim"
          ? "RECOVERY · re-aiming"
          : "RECOVERY · safely relocated";
  }

  placeEdgePointer(layout: EdgePointerLayout): void {
    this.edgePointer.style.left = `${layout.x}px`;
    this.edgePointer.style.top = `${layout.y}px`;
    this.edgePointer.style.rotate = `${layout.angleRadians}rad`;
  }

  releaseControls(): void {
    this.pointerControls.releaseAll();
  }

  dispose(): void {
    this.pointerControls.dispose();
    this.root.remove();
  }
}
