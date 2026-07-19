/**
 * Shopping Surf chrome — localized copy plus the DOM widgets layered over
 * the Stage3D canvas: the shopping list, shield pips, multiplier badge,
 * event toast, practice prompt card, countdown badge, and the live status
 * line for assistive tech. All elements are created once at mount, kept as
 * direct references (no selector queries on the frame path), and fully
 * removed on dispose.
 */
import { pickLocalized } from "../../i18n";
import type { SurfPracticeStep } from "./model";

interface LocalizedCopy {
  readonly en: string;
  readonly de: string;
}

export const SURF_COPY = {
  surfStart: { en: "Surf!", de: "Lossurfen!" },
  practiceKicker: { en: "Warm-up", de: "Aufwärmen" },
  practiceSkip: { en: "Skip warm-up", de: "Aufwärmen überspringen" },
  practiceDone: { en: "Warmed up — here comes the market!", de: "Aufgewärmt — auf zum Markt!" },
  practiceLeft: { en: "Swipe or press A/← to move left", de: "Wische oder drücke A/←, um nach links zu wechseln" },
  practiceRight: { en: "Swipe or press D/→ to move right", de: "Wische oder drücke D/→, um nach rechts zu wechseln" },
  practiceJump: { en: "Tap or press Space to jump", de: "Tippe oder drücke die Leertaste zum Springen" },
  practiceDuck: { en: "Swipe down or hold S/↓ to duck", de: "Wische nach unten oder halte S/↓ zum Ducken" },
  listTitle: { en: "Gooby's list", de: "Goobys Zettel" },
  listDone: { en: "List complete! +600", de: "Zettel komplett! +600" },
  shieldsLabel: { en: "Bumpers", de: "Stoßschützer" },
  toastTrick: { en: "Trick!", de: "Trick!" },
  toastNearMiss: { en: "Close call!", de: "Knapp vorbei!" },
  toastBump: { en: "Bump! Shield lost", de: "Rums! Schutz verloren" },
  toastLastShield: { en: "Careful — last shield!", de: "Vorsicht — letzter Schutz!" },
  toastCombo: { en: "Combo", de: "Combo" },
  finishTitle: { en: "Checkout reached!", de: "Kasse erreicht!" },
  bumpedTitle: { en: "The cart tipped over!", de: "Der Wagen ist umgekippt!" },
  groceriesDetail: { en: "groceries", de: "Waren" },
  tricksDetail: { en: "tricks", de: "Tricks" },
  shieldsDetail: { en: "shields left", de: "Schutz übrig" },
  leftUnpaid: { en: "Left unpaid — no rewards collected", de: "Ohne Belohnung verlassen — nichts gesammelt" },
  stageFallback: {
    en: "3D stage unavailable — surfing with the simplified view",
    de: "3D-Bühne nicht verfügbar — Surfen in der vereinfachten Ansicht",
  },
  keysHint: {
    en: "A/D or ←/→ lanes · Space jump · S/↓ duck · P pause",
    de: "A/D oder ←/→ Spuren · Leertaste Sprung · S/↓ ducken · P Pause",
  },
} as const satisfies Readonly<Record<string, LocalizedCopy>>;

export type SurfCopyKey = keyof typeof SURF_COPY;

export function surfCopy(key: SurfCopyKey): string {
  return pickLocalized(SURF_COPY[key]);
}

export interface SurfGroceryInfo {
  readonly glyph: string;
  readonly label: LocalizedCopy;
}

/** The six list items, index-aligned with the model's grocery indices. */
export const SURF_GROCERIES: readonly SurfGroceryInfo[] = [
  { glyph: "🥕", label: { en: "Carrots", de: "Karotten" } },
  { glyph: "🥛", label: { en: "Milk", de: "Milch" } },
  { glyph: "🥖", label: { en: "Bread", de: "Brot" } },
  { glyph: "🧀", label: { en: "Cheese", de: "Käse" } },
  { glyph: "🍎", label: { en: "Apples", de: "Äpfel" } },
  { glyph: "🍯", label: { en: "Honey", de: "Honig" } },
];

export const SURF_PRACTICE_PROMPTS: Readonly<Record<SurfPracticeStep, {
  readonly icon: string;
  readonly copy: SurfCopyKey;
}>> = {
  left: { icon: "⬅", copy: "practiceLeft" },
  right: { icon: "➡", copy: "practiceRight" },
  jump: { icon: "⤴", copy: "practiceJump" },
  duck: { icon: "⤵", copy: "practiceDuck" },
};

export interface SurfChrome {
  readonly root: HTMLElement;
  setList(collected: ReadonlyArray<boolean>): void;
  setShields(shields: number, total: number): void;
  setMultiplier(multiplier: number): void;
  showToast(text: string): void;
  /** Advances the toast timer; hides it after its lifetime. */
  update(dtSeconds: number): void;
  setPractice(step: SurfPracticeStep | null, index: number, total: number): void;
  setCountdown(text: string | null): void;
  announce(text: string): void;
  dispose(): void;
}

const TOAST_SECONDS = 1.4;

export function createSurfChrome(host: HTMLElement): SurfChrome {
  const document = host.ownerDocument;

  const root = document.createElement("div");
  root.className = "ss-chrome";

  const list = document.createElement("div");
  list.className = "ss-list";
  const listTitle = document.createElement("small");
  listTitle.textContent = surfCopy("listTitle");
  list.append(listTitle);
  const listChips: HTMLElement[] = [];
  for (const grocery of SURF_GROCERIES) {
    const chip = document.createElement("span");
    chip.className = "ss-list-chip";
    chip.textContent = grocery.glyph;
    chip.setAttribute("aria-label", pickLocalized(grocery.label));
    chip.dataset.collected = "false";
    list.append(chip);
    listChips.push(chip);
  }
  root.append(list);

  const shields = document.createElement("div");
  shields.className = "ss-shields";
  shields.setAttribute("aria-label", surfCopy("shieldsLabel"));
  const shieldPips: HTMLElement[] = [];
  root.append(shields);

  const multiplier = document.createElement("div");
  multiplier.className = "ss-multiplier";
  multiplier.hidden = true;
  root.append(multiplier);

  const toast = document.createElement("div");
  toast.className = "ss-toast";
  toast.hidden = true;
  root.append(toast);

  const practice = document.createElement("div");
  practice.className = "ss-practice";
  practice.hidden = true;
  const practiceKicker = document.createElement("span");
  practiceKicker.className = "ss-practice-kicker";
  const practiceIcon = document.createElement("div");
  practiceIcon.className = "ss-practice-icon";
  practiceIcon.setAttribute("aria-hidden", "true");
  const practiceText = document.createElement("p");
  const practiceProgress = document.createElement("span");
  practiceProgress.className = "ss-practice-progress";
  practice.append(practiceKicker, practiceIcon, practiceText, practiceProgress);
  root.append(practice);

  const countdown = document.createElement("div");
  countdown.className = "ss-countdown";
  countdown.hidden = true;
  countdown.setAttribute("aria-hidden", "true");
  root.append(countdown);

  const status = document.createElement("div");
  status.className = "ss-status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  root.append(status);

  host.append(root);

  let toastRemaining = 0;
  let disposed = false;

  return {
    root,
    setList(collected) {
      for (const [index, chip] of listChips.entries()) {
        const done = collected[index] === true;
        if (chip.dataset.collected !== String(done)) {
          chip.dataset.collected = String(done);
        }
      }
    },
    setShields(count, total) {
      while (shieldPips.length < total) {
        const pip = document.createElement("span");
        pip.className = "ss-shield-pip";
        pip.textContent = "🛡";
        shields.append(pip);
        shieldPips.push(pip);
      }
      for (const [index, pip] of shieldPips.entries()) {
        const active = index < count;
        if (pip.dataset.active !== String(active)) pip.dataset.active = String(active);
      }
    },
    setMultiplier(value) {
      const show = value >= 2;
      if (multiplier.hidden === show) multiplier.hidden = !show;
      const text = `×${value}`;
      if (show && multiplier.textContent !== text) multiplier.textContent = text;
    },
    showToast(text) {
      toast.textContent = text;
      toast.hidden = false;
      toastRemaining = TOAST_SECONDS;
    },
    update(dtSeconds) {
      if (toastRemaining > 0) {
        toastRemaining = Math.max(0, toastRemaining - dtSeconds);
        if (toastRemaining === 0 && !toast.hidden) toast.hidden = true;
      }
    },
    setPractice(step, index, total) {
      if (!step) {
        practice.hidden = true;
        return;
      }
      practice.hidden = false;
      const prompt = SURF_PRACTICE_PROMPTS[step];
      practiceKicker.textContent = surfCopy("practiceKicker");
      practiceIcon.textContent = prompt.icon;
      practiceText.textContent = surfCopy(prompt.copy);
      practiceProgress.textContent = `${index + 1} / ${total}`;
    },
    setCountdown(text) {
      if (text === null) {
        countdown.hidden = true;
        return;
      }
      countdown.hidden = false;
      if (countdown.textContent !== text) countdown.textContent = text;
    },
    announce(text) {
      if (status.textContent !== text) status.textContent = text;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      root.remove();
    },
  };
}

/** Scoped stylesheet injected by the module root (kept out of shared kit). */
export const SURF_CSS = `
.shopping-surf{position:absolute;inset:0;display:flex;flex-direction:column;overflow:hidden;border-radius:18px;background:linear-gradient(180deg,#bfe4f8,#dff1fb 55%,#e8ecd8);color:#274156;font-family:inherit;touch-action:none;user-select:none;-webkit-user-select:none}
.shopping-surf:focus-visible{outline:3px solid #274156;outline-offset:-3px}
.shopping-surf *{box-sizing:border-box}
.shopping-surf button{font:inherit;cursor:pointer}
.ss-stage{position:absolute;inset:0}
.ss-stage canvas{display:block;width:100%;height:100%}
.ss-stage-fallback{display:flex;align-items:flex-end;justify-content:center;padding-bottom:26vh;font-size:12px;font-weight:700;letter-spacing:.04em;text-align:center;color:#41607a;background:linear-gradient(180deg,#a5d9f4 0%,#d8ecfb 46%,#6f7a58 46.2%,#585c63 60%,#585c63 100%)}
.ss-chrome{position:absolute;inset:0;display:flex;flex-direction:column;pointer-events:none;padding:calc(64px + env(safe-area-inset-top)) 10px calc(12px + env(safe-area-inset-bottom))}
.shopping-surf [hidden]{display:none!important}
.ss-list{display:flex;align-items:center;gap:5px;align-self:flex-start;padding:6px 9px;border-radius:12px;background:rgba(255,252,240,.82);box-shadow:0 3px 10px rgba(39,65,86,.14)}
.ss-list small{font-size:9px;font-weight:800;letter-spacing:.07em;text-transform:uppercase;opacity:.65;margin-right:2px}
.ss-list-chip{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:8px;background:rgba(39,65,86,.08);font-size:15px;filter:grayscale(1);opacity:.55}
.ss-list-chip[data-collected="true"]{filter:none;opacity:1;background:#c9ecd3;box-shadow:0 0 0 2px rgba(39,65,86,.35) inset}
.ss-shields{display:flex;gap:4px;align-self:flex-start;margin-top:6px;padding:4px 8px;border-radius:10px;background:rgba(255,252,240,.82)}
.ss-shield-pip{font-size:14px;filter:grayscale(1);opacity:.35}
.ss-shield-pip[data-active="true"]{filter:none;opacity:1}
.ss-multiplier{align-self:flex-end;margin-top:-46px;padding:5px 12px;border-radius:99px;background:#ffd97b;font-size:16px;font-weight:900;box-shadow:0 3px 8px rgba(39,65,86,.25)}
.ss-toast{align-self:center;margin-top:10vh;padding:7px 16px;border-radius:99px;background:rgba(39,65,86,.85);color:#fffcf0;font-size:14px;font-weight:800;letter-spacing:.02em}
.ss-practice{align-self:center;margin-top:auto;margin-bottom:16vh;display:flex;flex-direction:column;align-items:center;gap:4px;max-width:270px;padding:14px 18px;border-radius:16px;background:rgba(255,252,240,.94);box-shadow:0 6px 18px rgba(39,65,86,.22);text-align:center}
.ss-practice-kicker{font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;opacity:.6}
.ss-practice-icon{font-size:34px;line-height:1}
.ss-practice p{margin:0;font-size:14px;font-weight:700}
.ss-practice-progress{font-size:11px;font-weight:800;opacity:.65;font-variant-numeric:tabular-nums}
.ss-countdown{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:72px;font-weight:900;color:#fffcf0;text-shadow:0 4px 0 rgba(39,65,86,.5);pointer-events:none}
.ss-status{position:absolute;left:10px;right:10px;bottom:calc(6px + env(safe-area-inset-bottom));min-height:16px;font-size:12px;font-weight:700;text-align:center;text-shadow:0 1px 0 rgba(255,252,240,.7)}
.ss-keys{position:absolute;left:0;right:0;bottom:calc(24px + env(safe-area-inset-bottom));margin:0;font-size:10px;letter-spacing:.04em;opacity:.62;text-align:center;pointer-events:none}
.shopping-surf .ak-overlay{pointer-events:auto}
.shopping-surf[data-ss-phase="running"] .ss-keys{opacity:.4}
@media (max-height:700px){.ss-chrome{padding-top:calc(56px + env(safe-area-inset-top))}}
`;
