// Game mode registry.
export const MODES = {
  competitive: {
    id: 'competitive', name: 'Kompetitiv', kind: 'plant', teamBased: true,
    friendlyFire: false, roundsToWin: 13, buy: true, spike: true, halftime: 12,
    startCredits: 800, desc: '5v5 Spike-Modus. Erste Seite mit 13 Runden gewinnt.',
  },
  unrated: {
    id: 'unrated', name: 'Unranked', kind: 'plant', teamBased: true,
    friendlyFire: false, roundsToWin: 5, buy: true, spike: true, halftime: 5,
    startCredits: 800, desc: 'Lockerer Spike-Modus, erste Seite mit 5 Runden gewinnt.',
  },
  spikerush: {
    id: 'spikerush', name: 'Spike-Ansturm', kind: 'plant', teamBased: true,
    friendlyFire: false, roundsToWin: 4, buy: false, spike: true, halftime: 3,
    startCredits: 0, randomWeapons: true, desc: 'Schnelle Runden mit Zufallswaffen.',
  },
  deathmatch: {
    id: 'deathmatch', name: 'Deathmatch (FFA)', kind: 'ffa', teamBased: false,
    friendlyFire: true, killTarget: 30, buy: false, spike: false,
    startCredits: 9000, freeAbilities: true, desc: 'Jeder gegen jeden. 30 Kills gewinnen.',
  },
  tdm: {
    id: 'tdm', name: 'Team-Deathmatch', kind: 'tdm', teamBased: true,
    friendlyFire: false, killTarget: 40, buy: false, spike: false,
    startCredits: 9000, freeAbilities: true, desc: 'Team gegen Team. 40 Kills gewinnen.',
  },
  gungame: {
    id: 'gungame', name: 'Waffenrennen', kind: 'gungame', teamBased: false,
    friendlyFire: true, buy: false, spike: false, startCredits: 0,
    freeAbilities: true, desc: 'Jeder Kill wechselt die Waffe. Messer-Kill gewinnt.',
  },
};

export function modeById(id) {
  return MODES[id] || MODES.competitive;
}

export const GUNGAME_LADDER = ['odin', 'ares', 'vandal', 'phantom', 'bulldog', 'spectre', 'stinger', 'sheriff', 'ghost', 'classic', 'knife'];
