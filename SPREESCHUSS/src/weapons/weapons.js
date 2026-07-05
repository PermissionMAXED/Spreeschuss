// Weapon registry. Stats are data-driven and shared by all players.
// damage is per-hit at body; headMult/legMult adjust; falloff over distance.
//
// --- Accuracy / recoil model (consumed by weaponsystem.js) ------------------
//  spread      base cone half-angle in DEGREES for a rested, standing shot.
//  firstShot   multiplier on `spread` for the first shot of a spray (i.e.
//              after `recovery` seconds without firing) — rewards tap fire.
//  bloom       per-consecutive-shot spread growth. Negative = the gun spins
//              UP and tightens mid-spray (heavy MG identity).
//  moveSpread  DEGREES added at full run speed; scales linearly with actual
//              horizontal speed, so shift-walking/crouching keeps you sharp.
//  jumpSpread  DEGREES added while airborne (jump-spam is punished).
//  scopedMult  spread multiplier while scoped (snipers): laser when standing.
//  recovery    seconds without firing before the spray pattern resets
//              (defaults to one shot interval + 0.25 s in weaponsystem.js).
//  recoil      visual camera-punch scale, fed into game.addRecoil.
//  pattern     deterministic per-shot aim offsets {p: pitch, y: yaw} in
//              RADIANS, indexed by consecutive-shot count. Generated once at
//              load from a PRNG seeded by the weapon id, so every spray of a
//              given weapon is identical and learnable.

const DEG = Math.PI / 180;

// FNV-1a hash: stable numeric seed from the weapon id string.
function seedFrom(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// mulberry32: tiny deterministic PRNG — same seed, same spray, every session.
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Builds a Valorant-style spray: an eased vertical climb over the first
// `climbShots` rounds, then a smooth lateral S-drift (right → left → right…),
// with small per-shot jitter baked in. Inputs in degrees, output in radians.
function buildPattern(id, { shots, climb, climbShots, drift, driftPeriod, jitter }) {
  const rnd = mulberry32(seedFrom(id));
  const side = rnd() < 0.5 ? 1 : -1; // seeded: which side the drift starts on
  const pts = [];
  for (let i = 0; i < shots; i++) {
    const t = Math.min(1, i / Math.max(1, climbShots));
    const p = climb * (1 - (1 - t) * (1 - t)); // ease-out climb
    let y = side * drift * 0.15 * t; // slight lean while still climbing
    if (i > climbShots) {
      y = side * drift * Math.sin(((i - climbShots) / driftPeriod) * Math.PI);
    }
    pts.push({
      p: (p + (rnd() - 0.5) * jitter) * DEG,
      y: (y + (rnd() - 0.5) * jitter) * DEG,
    });
  }
  return pts;
}

export const WEAPONS = {
  // Melee — last resort / humiliation tool. 2 body hits or 1 headshot kills.
  knife: { id: 'knife', name: 'Messer', cat: 'melee', price: 0, damage: 55, headMult: 2, fireRate: 2, mag: 0, reserve: 0, spread: 0, recoil: 0, range: 3, auto: false, moveSpeed: 1.0 },

  // --- Sidearms -------------------------------------------------------------
  // Classic: free eco starter. 4 body @6.7/s (0.45 s) or 2 heads (78 ea);
  // never embarrassing, never a rifle replacement.
  classic: {
    id: 'classic', name: 'Classic', cat: 'sidearm', price: 0, damage: 26, headMult: 3.0, legMult: 0.85,
    fireRate: 6.7, mag: 12, reserve: 36, spread: 0.35, recoil: 0.7, range: 50, falloff: 20, auto: false, moveSpeed: 1.0,
    firstShot: 0.35, bloom: 0.08, moveSpread: 0.6, jumpSpread: 1.3,
    pattern: buildPattern('classic', { shots: 12, climb: 1.4, climbShots: 4, drift: 0.5, driftPeriod: 5, jitter: 0.25 }),
  },
  // Ghost: precise eco upgrade — 105 head one-taps an unarmored target,
  // low kick, quiet feel. The "aim reward" pistol.
  ghost: {
    id: 'ghost', name: 'Ghost', cat: 'sidearm', price: 500, damage: 30, headMult: 3.5, legMult: 0.85,
    fireRate: 6.7, mag: 15, reserve: 45, spread: 0.3, recoil: 0.6, range: 60, falloff: 25, auto: false, moveSpeed: 1.0,
    firstShot: 0.3, bloom: 0.06, moveSpread: 0.55, jumpSpread: 1.2,
    pattern: buildPattern('ghost', { shots: 15, climb: 1.1, climbShots: 4, drift: 0.4, driftPeriod: 5, jitter: 0.18 }),
  },
  // Sheriff: hand cannon. 165 head one-taps even through heavy shields; 2 body
  // kill. Heavy single kicks + steep bloom make spamming a coin flip.
  sheriff: {
    id: 'sheriff', name: 'Sheriff', cat: 'sidearm', price: 800, damage: 55, headMult: 3.0, legMult: 0.85,
    fireRate: 4, mag: 6, reserve: 24, spread: 0.45, recoil: 2.6, range: 75, falloff: 30, auto: false, moveSpeed: 0.98,
    firstShot: 0.25, bloom: 0.18, moveSpread: 1.0, jumpSpread: 2.2,
    pattern: buildPattern('sheriff', { shots: 6, climb: 3.2, climbShots: 3, drift: 0.8, driftPeriod: 3, jitter: 0.3 }),
  },

  // --- SMGs -------------------------------------------------------------------
  // Stinger: force-buy melter. 4 body @16/s = 0.19 s TTK inside 12 m, but
  // brutal falloff + jittery spray = dead past mid range.
  stinger: {
    id: 'stinger', name: 'Stinger', cat: 'smg', price: 1100, damage: 27, headMult: 2.1, legMult: 0.85,
    fireRate: 16, mag: 20, reserve: 60, spread: 0.85, recoil: 1.1, range: 40, falloff: 12, auto: true, moveSpeed: 0.97,
    firstShot: 0.65, bloom: 0.05, moveSpread: 0.3, jumpSpread: 0.8,
    pattern: buildPattern('stinger', { shots: 20, climb: 2.6, climbShots: 6, drift: 2.0, driftPeriod: 5, jitter: 0.55 }),
  },
  // Spectre: the do-everything second-round buy. 0.23 s body TTK, tiny
  // movement penalty — the run-and-gun option that still loses to rifles.
  spectre: {
    id: 'spectre', name: 'Spectre', cat: 'smg', price: 1600, damage: 26, headMult: 2.6, legMult: 0.85,
    fireRate: 13.3, mag: 30, reserve: 90, spread: 0.65, recoil: 0.9, range: 50, falloff: 18, auto: true, moveSpeed: 0.96,
    firstShot: 0.55, bloom: 0.045, moveSpread: 0.35, jumpSpread: 0.9,
    pattern: buildPattern('spectre', { shots: 30, climb: 2.4, climbShots: 7, drift: 1.5, driftPeriod: 6, jitter: 0.4 }),
  },

  // --- Rifles -----------------------------------------------------------------
  // Bulldog: budget rifle. 115 head one-taps unarmored; sloppier spray and
  // slower cycle keep it below the 2900-credit pair.
  bulldog: {
    id: 'bulldog', name: 'Bulldog', cat: 'rifle', price: 2050, damage: 35, headMult: 3.3, legMult: 0.85,
    fireRate: 9.15, mag: 24, reserve: 72, spread: 0.5, recoil: 1.5, range: 80, falloff: 40, auto: true, moveSpeed: 0.92,
    firstShot: 0.3, bloom: 0.06, moveSpread: 1.1, jumpSpread: 2.2,
    pattern: buildPattern('bulldog', { shots: 24, climb: 3.4, climbShots: 8, drift: 2.4, driftPeriod: 6, jitter: 0.35 }),
  },
  // Phantom: the spray rifle. Fastest rifle body TTK (3 @11/s = 0.18 s), the
  // tightest pattern in class — but 140 head can't one-tap heavy shields and
  // damage falls off, so long-range duels belong to the Vandal.
  phantom: {
    id: 'phantom', name: 'Phantom', cat: 'rifle', price: 2900, damage: 39, headMult: 3.6, legMult: 0.85,
    fireRate: 11, mag: 30, reserve: 90, spread: 0.35, recoil: 1.3, range: 90, falloff: 28, auto: true, moveSpeed: 0.92,
    firstShot: 0.28, bloom: 0.05, moveSpread: 1.1, jumpSpread: 2.4,
    pattern: buildPattern('phantom', { shots: 30, climb: 3.0, climbShots: 9, drift: 1.3, driftPeriod: 7, jitter: 0.16 }),
  },
  // Vandal: the duelist rifle. 160 head = one-tap at ANY range through ANY
  // shield (falloff == range → no decay). Pays for it with a taller climb and
  // wider drift than the Phantom — control it or lose the spray war.
  vandal: {
    id: 'vandal', name: 'Vandal', cat: 'rifle', price: 2900, damage: 40, headMult: 4.0, legMult: 0.85,
    fireRate: 9.75, mag: 25, reserve: 75, spread: 0.42, recoil: 1.6, range: 100, falloff: 100, auto: true, moveSpeed: 0.92,
    firstShot: 0.25, bloom: 0.06, moveSpread: 1.2, jumpSpread: 2.6,
    pattern: buildPattern('vandal', { shots: 25, climb: 3.8, climbShots: 8, drift: 2.2, driftPeriod: 7, jitter: 0.24 }),
  },

  // --- Shotgun ----------------------------------------------------------------
  // Judge: CQB room-holder. 8 pellets in a shaped center+ring cloud, 120 at
  // the muzzle, worthless past ~15 m. Low move penalty rewards aggression.
  judge: {
    id: 'judge', name: 'Judge', cat: 'shotgun', price: 1850, damage: 15, pellets: 8, headMult: 2.0, legMult: 0.85,
    fireRate: 3.3, mag: 7, reserve: 21, spread: 3.2, recoil: 3.0, range: 22, falloff: 8, auto: true, moveSpeed: 0.94,
    firstShot: 0.9, bloom: 0.03, moveSpread: 0.35, jumpSpread: 0.7,
    pattern: buildPattern('judge', { shots: 7, climb: 2.0, climbShots: 4, drift: 0.8, driftPeriod: 3, jitter: 0.3 }),
  },

  // --- Snipers ----------------------------------------------------------------
  // Marshal: eco sniper. 101 body punishes anyone who skipped shields (armor
  // saves you); 252 head deletes anything. Laser while scoped + standing.
  marshal: {
    id: 'marshal', name: 'Marshal', cat: 'sniper', price: 950, damage: 101, headMult: 2.5, legMult: 0.85,
    fireRate: 1.5, mag: 5, reserve: 15, spread: 0.7, recoil: 3.6, range: 200, falloff: 200, auto: false, scoped: true, moveSpeed: 0.9,
    firstShot: 0.5, bloom: 0.2, moveSpread: 2.4, jumpSpread: 5.0, scopedMult: 0.04, recovery: 0.9,
    pattern: buildPattern('marshal', { shots: 5, climb: 3.0, climbShots: 2, drift: 0.6, driftPeriod: 3, jitter: 0.2 }),
  },
  // Operator: the angle-holding ultimatum. 150 body one-shots through heavy
  // shields, no falloff. Costs 4700, walks like a tank, and hipfire/moving
  // shots are noodles — commit to the scope or don't buy it.
  operator: {
    id: 'operator', name: 'Operator', cat: 'sniper', price: 4700, damage: 150, headMult: 1.8, legMult: 0.85,
    fireRate: 0.9, mag: 5, reserve: 10, spread: 0.9, recoil: 5.0, range: 250, falloff: 250, auto: false, scoped: true, moveSpeed: 0.85,
    firstShot: 0.5, bloom: 0.2, moveSpread: 3.0, jumpSpread: 6.0, scopedMult: 0.03, recovery: 1.1,
    pattern: buildPattern('operator', { shots: 5, climb: 4.5, climbShots: 2, drift: 0.8, driftPeriod: 3, jitter: 0.2 }),
  },

  // --- Heavies ----------------------------------------------------------------
  // Ares: suppressive spray-holder. Mediocre first shots, but negative bloom
  // tightens the stream the longer you hold — mag-dump identity.
  ares: {
    id: 'ares', name: 'Ares', cat: 'heavy', price: 1600, damage: 30, headMult: 2.0, legMult: 0.85,
    fireRate: 13, mag: 50, reserve: 100, spread: 0.85, recoil: 1.0, range: 90, falloff: 45, auto: true, moveSpeed: 0.9,
    firstShot: 1.1, bloom: -0.028, moveSpread: 1.2, jumpSpread: 2.4,
    pattern: buildPattern('ares', { shots: 50, climb: 2.8, climbShots: 12, drift: 1.7, driftPeriod: 8, jitter: 0.3 }),
  },
  // Odin: wall of lead. 3 body @12.6/s = 0.16 s sustained TTK — better than
  // any rifle IF you pre-spin: wild first rounds, slowest walk, huge climb.
  odin: {
    id: 'odin', name: 'Odin', cat: 'heavy', price: 3200, damage: 38, headMult: 2.0, legMult: 0.85,
    fireRate: 12.6, mag: 100, reserve: 200, spread: 1.0, recoil: 1.2, range: 100, falloff: 50, auto: true, moveSpeed: 0.88,
    firstShot: 1.15, bloom: -0.03, moveSpread: 1.4, jumpSpread: 2.6,
    pattern: buildPattern('odin', { shots: 100, climb: 3.2, climbShots: 10, drift: 2.0, driftPeriod: 9, jitter: 0.35 }),
  },
};

export const SHOP_ORDER = {
  sidearm: ['classic', 'ghost', 'sheriff'],
  smg: ['stinger', 'spectre'],
  rifle: ['bulldog', 'phantom', 'vandal'],
  shotgun: ['judge'],
  sniper: ['marshal', 'operator'],
  heavy: ['ares', 'odin'],
};

export const ARMOR = {
  light: { id: 'light', name: 'Leichte Schilde', price: 400, hp: 25 },
  heavy: { id: 'heavy', name: 'Schwere Schilde', price: 1000, hp: 50 },
};

export function weaponById(id) {
  return WEAPONS[id] || WEAPONS.classic;
}
