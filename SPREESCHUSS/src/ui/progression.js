// Persistent player progression: XP, levels and German rank names.
//
// Pure module: no DOM, no event-bus subscriptions. MVP tracking design note —
// this module does NOT subscribe to 'round:end' itself. The HUD already
// consumes 'round:end' (for its MVP banner) and 'match:start'; it calls
// recordRoundMvp() whenever the round MVP is the player and
// resetMatchTracking() at match start. That keeps a single 'round:end'
// consumer, avoids duplicate bus wiring, and keeps this module trivially
// testable in isolation.

// ---------------------------------------------------------------- XP tuning
export const XP_PARTICIPATION = 100; // every finished match
export const XP_WIN = 200;           // match won
export const XP_PER_KILL = 12;
export const XP_PER_ASSIST = 6;
export const XP_MVP = 150;           // flat bonus: round-MVP at least once

// Level n -> n+1 costs LEVEL_BASE + LEVEL_STEP * (n - 1) XP,
// so the cumulative curve grows quadratically.
export const LEVEL_BASE = 400;
export const LEVEL_STEP = 120;
const LEVEL_HARD_CAP = 999; // safety bound for the level loop

// One rank per 3 levels (1-3 Rekrut, 4-6 Wachmann, ...); the last entry is a
// cap — level 25 and beyond stays Legende.
export const RANKS = ['Rekrut', 'Wachmann', 'Späher', 'Stürmer', 'Veteran', 'Elitesoldat', 'Hauptmann', 'Kommandant', 'Legende'];

const STORAGE_KEY = 'spreeschuss.progress.v1';

// non-negative integer or 0 — every external number passes through this
const toCount = (v, max = 1e12) => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > 0 ? Math.min(max, n) : 0;
};

// Any raw shape in (corrupt JSON result, old versions, garbage) -> a valid
// progress object out. This is the single choke point that guarantees
// corrupt storage can never break menu or HUD.
function sanitizeProgress(raw) {
  const out = { totalXp: 0, matches: 0, wins: 0 };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  out.totalXp = toCount(raw.totalXp);
  out.matches = toCount(raw.matches);
  out.wins = toCount(raw.wins);
  return out;
}

export function loadProgress() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return sanitizeProgress(null);
    return sanitizeProgress(JSON.parse(raw));
  } catch {
    // garbage JSON or storage unavailable -> clean level-1 fallback
    return sanitizeProgress(null);
  }
}

export function saveProgress(p) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitizeProgress(p)));
  } catch { /* Speicher nicht verfügbar — Progression ist optional */ }
}

// Itemized XP for one finished match. `deaths` is accepted for call-site
// convenience but does not affect the formula. Returns per-row values plus
// the total so the HUD can render the breakdown directly.
export function computeMatchXP({ won, kills, deaths, assists, mvpCount = 0 } = {}) {
  const participation = XP_PARTICIPATION;
  const win = won ? XP_WIN : 0;
  const killXp = toCount(kills, 9999) * XP_PER_KILL;
  const assistXp = toCount(assists, 9999) * XP_PER_ASSIST;
  const mvp = toCount(mvpCount, 999) > 0 ? XP_MVP : 0;
  return {
    participation,
    win,
    kills: killXp,
    assists: assistXp,
    mvp,
    total: participation + win + killXp + assistXp + mvp,
  };
}

// XP needed to advance FROM `level` to the next one.
export function xpToNext(level) {
  return LEVEL_BASE + LEVEL_STEP * (Math.max(1, toCount(level, LEVEL_HARD_CAP) || 1) - 1);
}

// Level/rank info for a lifetime XP total:
//   { level, rank, rankIndex, into (XP inside the level), need (XP for the
//     next level), frac (0..1 bar fill) }
export function levelFor(totalXp) {
  let rest = toCount(totalXp);
  let level = 1;
  while (level < LEVEL_HARD_CAP && rest >= xpToNext(level)) {
    rest -= xpToNext(level);
    level++;
  }
  const need = xpToNext(level);
  const rankIndex = Math.min(RANKS.length - 1, Math.floor((level - 1) / 3));
  return { level, rank: RANKS[rankIndex], rankIndex, into: rest, need, frac: Math.max(0, Math.min(1, rest / need)) };
}

// ------------------------------------------------------- per-match MVP count
// Tiny bit of module state (see design note at the top): the HUD records
// round-MVPs here during a match and computeMatchXP() receives the count at
// match end. Reset happens on 'match:start' via resetMatchTracking().
let _mvpCount = 0;
export function recordRoundMvp() { _mvpCount++; }
export function getMvpCount() { return _mvpCount; }
export function resetMatchTracking() { _mvpCount = 0; }
