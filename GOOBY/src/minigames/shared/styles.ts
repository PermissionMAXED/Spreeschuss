/**
 * Shared Arcade Kit stylesheet with DOM-resident reference counting.
 *
 * Every kit surface (HUD, tutorial, results, input) mounts the same style
 * element once per document. The reference count lives on the element itself,
 * so there is no module-level state and disposing the last consumer restores
 * the document head to its original baseline.
 *
 * Accessibility invariants baked into the sheet:
 * - every interactive control is at least 44×44 px;
 * - state changes always pair color with text/shape (never color alone);
 * - motion is disabled both for `prefers-reduced-motion` and for the explicit
 *   `[data-ak-reduced="true"]` opt-out driven by the app setting.
 */

export const ARCADE_KIT_STYLE_ID = "arcade-kit-shared-style";

const KIT_CSS = `
.ak-hud{position:absolute;z-index:20;top:max(10px,env(safe-area-inset-top));left:max(10px,env(safe-area-inset-left));right:max(10px,env(safe-area-inset-right));display:flex;align-items:stretch;gap:8px;pointer-events:none;font-family:inherit;color:#4a3428}
.ak-hud-stat{display:flex;flex-direction:column;justify-content:center;min-width:64px;min-height:44px;padding:4px 10px;border-radius:12px;background:rgba(255,252,240,.82);box-shadow:0 3px 10px rgba(74,52,40,.14)}
.ak-hud-stat small{font-size:10px;letter-spacing:.08em;opacity:.72;text-transform:uppercase}
.ak-hud-stat strong{font-size:18px;line-height:1.2;font-variant-numeric:tabular-nums}
.ak-hud-stat[data-ak-emphasis="true"] strong{font-size:20px;text-decoration:underline}
.ak-hud-spacer{flex:1}
.ak-hud-pause{pointer-events:auto;min-width:44px;min-height:44px;border:2px solid rgba(74,52,40,.35);border-radius:14px;background:rgba(255,252,240,.92);color:#4a3428;font-size:18px;font-weight:800;cursor:pointer}
.ak-hud-pause:focus-visible{outline:3px solid #4a3428;outline-offset:2px}
.ak-overlay{position:absolute;z-index:40;inset:0;display:flex;align-items:center;justify-content:center;padding:max(20px,env(safe-area-inset-top)) max(20px,env(safe-area-inset-right)) max(20px,env(safe-area-inset-bottom)) max(20px,env(safe-area-inset-left));background:rgba(60,40,30,.5)}
.ak-overlay[hidden]{display:none}
.ak-card{display:flex;flex-direction:column;gap:10px;width:100%;max-width:340px;padding:22px 20px;border-radius:20px;background:#fff7ec;color:#4a3428;text-align:center;box-shadow:0 18px 50px rgba(37,24,16,.35)}
.ak-kicker{font-size:11px;letter-spacing:.12em;text-transform:uppercase;opacity:.66}
.ak-card-icon{font-size:40px;line-height:1}
.ak-card h2{margin:0;font-size:21px}
.ak-card p{margin:0;font-size:14px;line-height:1.5}
.ak-progress-text{font-size:12px;font-weight:700;letter-spacing:.06em}
.ak-dots{display:flex;gap:6px;justify-content:center}
.ak-dots i{width:8px;height:8px;border-radius:50%;background:rgba(74,52,40,.2)}
.ak-dots i[data-ak-active="true"]{background:#4a3428;transform:scale(1.2)}
.ak-button{min-height:44px;padding:10px 16px;border:0;border-radius:14px;font:inherit;font-size:15px;font-weight:700;cursor:pointer}
.ak-button:focus-visible{outline:3px solid #4a3428;outline-offset:2px}
.ak-button-primary{background:#f0a558;color:#3d2417}
.ak-button-secondary{background:rgba(74,52,40,.12);color:#4a3428}
.ak-button-quiet{background:none;color:#6b5240;text-decoration:underline;font-weight:600}
.ak-result-score{font-size:36px;font-weight:900;font-variant-numeric:tabular-nums}
.ak-result-newbest{font-size:12px;font-weight:900;letter-spacing:.1em}
.ak-result-newbest::before{content:"★ "}
.ak-input-surface{position:absolute;inset:0;touch-action:none;user-select:none;-webkit-user-select:none}
.ak-hud-stat,.ak-dots i,.ak-button{transition:transform .14s ease,background .14s ease}
@media (prefers-reduced-motion: reduce){.ak-hud-stat,.ak-dots i,.ak-button{transition:none}}
[data-ak-reduced="true"] .ak-hud-stat,[data-ak-reduced="true"] .ak-dots i,[data-ak-reduced="true"] .ak-button{transition:none}
`;

/**
 * Mounts the shared stylesheet into the document (once) and increments its
 * reference count. Returns a release callback; the style element is removed
 * when the final consumer releases it.
 */
export function acquireArcadeKitStyles(document: Document): () => void {
  let style = document.getElementById(ARCADE_KIT_STYLE_ID) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement("style");
    style.id = ARCADE_KIT_STYLE_ID;
    style.textContent = KIT_CSS;
    style.setAttribute("data-ak-refs", "0");
    document.head.append(style);
  }
  style.setAttribute("data-ak-refs", String(Number(style.getAttribute("data-ak-refs") ?? "0") + 1));
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const current = document.getElementById(ARCADE_KIT_STYLE_ID);
    if (!current) return;
    const remaining = Number(current.getAttribute("data-ak-refs") ?? "1") - 1;
    if (remaining <= 0) current.remove();
    else current.setAttribute("data-ak-refs", String(remaining));
  };
}
