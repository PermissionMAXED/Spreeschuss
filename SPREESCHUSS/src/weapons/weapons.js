// Weapon registry. Stats are data-driven and shared by all players.
// damage is per-hit at body; headMult/legMult adjust; falloff over distance.
export const WEAPONS = {
  knife: { id: 'knife', name: 'Messer', cat: 'melee', price: 0, damage: 55, headMult: 2, fireRate: 2, mag: 0, reserve: 0, spread: 0, recoil: 0, range: 3, auto: false, moveSpeed: 1.0 },

  classic: { id: 'classic', name: 'Classic', cat: 'sidearm', price: 0, damage: 26, headMult: 3, legMult: 0.85, fireRate: 6.7, mag: 12, reserve: 36, spread: 0.4, recoil: 0.6, range: 50, falloff: 30, auto: false, moveSpeed: 1.0 },
  ghost: { id: 'ghost', name: 'Ghost', cat: 'sidearm', price: 500, damage: 30, headMult: 4, legMult: 0.85, fireRate: 6.7, mag: 15, reserve: 45, spread: 0.35, recoil: 0.6, range: 60, falloff: 30, auto: false, moveSpeed: 1.0 },
  sheriff: { id: 'sheriff', name: 'Sheriff', cat: 'sidearm', price: 800, damage: 55, headMult: 3.3, legMult: 0.85, fireRate: 4, mag: 6, reserve: 24, spread: 0.5, recoil: 1.2, range: 70, falloff: 40, auto: false, moveSpeed: 0.98 },

  stinger: { id: 'stinger', name: 'Stinger', cat: 'smg', price: 1100, damage: 27, headMult: 2, legMult: 0.85, fireRate: 16, mag: 20, reserve: 60, spread: 1.2, recoil: 1.3, range: 40, falloff: 20, auto: true, moveSpeed: 0.95 },
  spectre: { id: 'spectre', name: 'Spectre', cat: 'smg', price: 1600, damage: 26, headMult: 2, legMult: 0.85, fireRate: 13.3, mag: 30, reserve: 90, spread: 0.9, recoil: 1.0, range: 45, falloff: 22, auto: true, moveSpeed: 0.96 },

  bulldog: { id: 'bulldog', name: 'Bulldog', cat: 'rifle', price: 2050, damage: 35, headMult: 2.2, legMult: 0.85, fireRate: 9.15, mag: 24, reserve: 72, spread: 0.6, recoil: 1.4, range: 80, falloff: 50, auto: true, moveSpeed: 0.92 },
  phantom: { id: 'phantom', name: 'Phantom', cat: 'rifle', price: 2900, damage: 39, headMult: 3.5, legMult: 0.85, fireRate: 11, mag: 30, reserve: 90, spread: 0.5, recoil: 1.5, range: 90, falloff: 55, auto: true, moveSpeed: 0.92 },
  vandal: { id: 'vandal', name: 'Vandal', cat: 'rifle', price: 2900, damage: 40, headMult: 3.75, legMult: 0.85, fireRate: 9.75, mag: 25, reserve: 75, spread: 0.5, recoil: 1.7, range: 100, falloff: 60, auto: true, moveSpeed: 0.92 },

  judge: { id: 'judge', name: 'Judge', cat: 'shotgun', price: 1850, damage: 14, pellets: 8, headMult: 2, legMult: 0.85, fireRate: 3.5, mag: 5, reserve: 15, spread: 3.5, recoil: 2.0, range: 20, falloff: 10, auto: true, moveSpeed: 0.94 },

  marshal: { id: 'marshal', name: 'Marshal', cat: 'sniper', price: 950, damage: 101, headMult: 2, legMult: 0.85, fireRate: 1.5, mag: 5, reserve: 15, spread: 0.2, recoil: 2.5, range: 200, falloff: 200, auto: false, scoped: true, moveSpeed: 0.9 },
  operator: { id: 'operator', name: 'Operator', cat: 'sniper', price: 4700, damage: 150, headMult: 1.8, legMult: 0.85, fireRate: 0.9, mag: 5, reserve: 10, spread: 0.1, recoil: 3.0, range: 250, falloff: 250, auto: false, scoped: true, moveSpeed: 0.85 },

  ares: { id: 'ares', name: 'Ares', cat: 'heavy', price: 1600, damage: 30, headMult: 2, legMult: 0.85, fireRate: 13, mag: 50, reserve: 100, spread: 1.0, recoil: 1.2, range: 90, falloff: 55, auto: true, moveSpeed: 0.9 },
  odin: { id: 'odin', name: 'Odin', cat: 'heavy', price: 3200, damage: 38, headMult: 2, legMult: 0.85, fireRate: 15.6, mag: 100, reserve: 200, spread: 1.1, recoil: 1.6, range: 100, falloff: 60, auto: true, moveSpeed: 0.88 },
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
