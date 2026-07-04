import { AbilityBehaviors as B, makeAbility } from './abilities.js';

// Agent roster. Each agent has a color, role and four abilities:
//   C (basic), Q (basic), E (signature), X (ultimate).
// Abilities compose reusable behaviors from abilities.js.

function ability(behavior, key, name, opts) {
  return makeAbility(behavior, { key, name, ...opts });
}

export const ROLES = ['Duellant', 'Wächter', 'Initiator', 'Stratege'];

export const AGENTS = [
  {
    id: 'spree', name: 'Spree', role: 'Duellant', color: '#43b7c7',
    desc: 'Aggressiver Entryfragger mit Dash und Blitz.',
    abilities: {
      C: ability(B.flash, 'C', 'Blitzstoß', { charges: 2, cost: 250, opts: { dist: 12, duration: 1.4, radius: 20 } }),
      Q: ability(B.dash, 'Q', 'Sprint', { charges: 1, cost: 150, cooldown: 8, opts: { force: 20, up: 2 } }),
      E: ability(B.dash, 'E', 'Blinzeln', { charges: 1, cooldown: 20, signature: true, opts: { force: 24, up: 4 } }),
      X: ability(B.molly, 'X', 'Flutwelle', { ult: true, points: 7, opts: { dist: 18, radius: 7, duration: 4, dps: 70 } }),
    },
  },
  {
    id: 'nebel', name: 'Nebel', role: 'Stratege', color: '#8a7add',
    desc: 'Kontrolliert Sichtlinien mit Rauch und Wänden.',
    abilities: {
      C: ability(B.smoke, 'C', 'Dunst', { charges: 2, cost: 100, opts: { dist: 16, radius: 5, duration: 15 } }),
      Q: ability(B.slow, 'Q', 'Zähschleim', { charges: 1, cost: 200, opts: { dist: 14, radius: 5, duration: 7 } }),
      E: ability(B.smoke, 'E', 'Wolkenbank', { charges: 3, signature: true, cooldown: 0, opts: { dist: 20, radius: 6, duration: 18 } }),
      X: ability(B.wall, 'X', 'Nebelmauer', { ult: true, points: 7, opts: { length: 22, height: 4, duration: 12 } }),
    },
  },
  {
    id: 'funke', name: 'Funke', role: 'Initiator', color: '#ffd166',
    desc: 'Deckt Gegner auf und blendet.',
    abilities: {
      C: ability(B.recon, 'C', 'Spähdrohne', { charges: 1, cost: 300, opts: { dist: 22, radius: 20, duration: 4 } }),
      Q: ability(B.flash, 'Q', 'Grelllicht', { charges: 2, cost: 250, opts: { dist: 14, duration: 1.6, radius: 22 } }),
      E: ability(B.recon, 'E', 'Ortungspuls', { charges: 2, signature: true, cooldown: 40, opts: { dist: 18, radius: 22, duration: 3 } }),
      X: ability(B.recon, 'X', 'Jagd', { ult: true, points: 6, opts: { dist: 0, radius: 200, duration: 8 } }),
    },
  },
  {
    id: 'bollwerk', name: 'Bollwerk', role: 'Wächter', color: '#e08a3a',
    desc: 'Verteidigt Spots mit Wänden und Fallen.',
    abilities: {
      C: ability(B.trap, 'C', 'Stolperdraht', { charges: 2, cost: 200, opts: { dist: 8, radius: 3, duration: 40, effect: 'slow' } }),
      Q: ability(B.wall, 'Q', 'Barriere', { charges: 1, cost: 300, opts: { length: 10, height: 3.5, duration: 25 } }),
      E: ability(B.turret, 'E', 'Späher', { charges: 1, signature: true, cooldown: 45, opts: { dist: 4, dps: 14, range: 28, duration: 40 } }),
      X: ability(B.wall, 'X', 'Festung', { ult: true, points: 7, opts: { length: 26, height: 5, duration: 15 } }),
    },
  },
  {
    id: 'brandt', name: 'Brandt', role: 'Initiator', color: '#ff5a4a',
    desc: 'Feuer und Molotows zur Flächenkontrolle.',
    abilities: {
      C: ability(B.molly, 'C', 'Brandsatz', { charges: 1, cost: 200, opts: { dist: 16, radius: 4, duration: 5, dps: 45 } }),
      Q: ability(B.molly, 'Q', 'Napalm', { charges: 1, cost: 250, opts: { dist: 18, radius: 4.5, duration: 6, dps: 40 } }),
      E: ability(B.molly, 'E', 'Feuerlinie', { charges: 2, signature: true, cooldown: 35, opts: { dist: 16, radius: 4, duration: 5, dps: 42 } }),
      X: ability(B.molly, 'X', 'Inferno', { ult: true, points: 6, opts: { dist: 20, radius: 9, duration: 6, dps: 60 } }),
    },
  },
  {
    id: 'sani', name: 'Sani', role: 'Stratege', color: '#4ae08a',
    desc: 'Heilt sich und hält Stellung.',
    abilities: {
      C: ability(B.heal, 'C', 'Stim', { charges: 1, cost: 100, opts: { amount: 40, duration: 3 } }),
      Q: ability(B.slow, 'Q', 'Gelfalle', { charges: 1, cost: 200, opts: { dist: 14, radius: 4.5, duration: 6 } }),
      E: ability(B.heal, 'E', 'Regeneration', { charges: 1, signature: true, cooldown: 30, opts: { amount: 70, duration: 5 } }),
      X: ability(B.heal, 'X', 'Übermensch', { ult: true, points: 6, opts: { amount: 150, duration: 5 } }),
    },
  },
  {
    id: 'schatten', name: 'Schatten', role: 'Duellant', color: '#9a4aff',
    desc: 'Teleportiert und flankiert.',
    abilities: {
      C: ability(B.smoke, 'C', 'Schleier', { charges: 2, cost: 100, opts: { dist: 12, radius: 4, duration: 8 } }),
      Q: ability(B.flash, 'Q', 'Paranoia', { charges: 1, cost: 250, opts: { dist: 20, duration: 1.2, radius: 18 } }),
      E: ability(B.dash, 'E', 'Sprungschatten', { charges: 2, signature: true, cooldown: 25, opts: { force: 22, up: 5 } }),
      X: ability(B.dash, 'X', 'Phantomlauf', { ult: true, points: 7, opts: { force: 30, up: 6 } }),
    },
  },
  {
    id: 'anker', name: 'Anker', role: 'Wächter', color: '#3a7ae0',
    desc: 'Robuster Verteidiger mit Schild.',
    abilities: {
      C: ability(B.wall, 'C', 'Schildwand', { charges: 1, cost: 150, opts: { length: 8, height: 3, duration: 15 } }),
      Q: ability(B.slow, 'Q', 'Ankerfeld', { charges: 1, cost: 200, opts: { dist: 12, radius: 5, duration: 7 } }),
      E: ability(B.heal, 'E', 'Bunker', { charges: 1, signature: true, cooldown: 35, opts: { amount: 50, duration: 4 } }),
      X: ability(B.wall, 'X', 'Bastion', { ult: true, points: 7, opts: { length: 24, height: 5, duration: 14 } }),
    },
  },
  {
    id: 'radar', name: 'Radar', role: 'Initiator', color: '#43e0d0',
    desc: 'Aufklärung und Kontrolle.',
    abilities: {
      C: ability(B.recon, 'C', 'Sonar', { charges: 2, cost: 150, opts: { dist: 20, radius: 16, duration: 3 } }),
      Q: ability(B.turret, 'Q', 'Sensor', { charges: 1, cost: 200, opts: { dist: 6, dps: 0, range: 25, duration: 50 } }),
      E: ability(B.recon, 'E', 'Weitblick', { charges: 1, signature: true, cooldown: 40, opts: { dist: 24, radius: 24, duration: 4 } }),
      X: ability(B.recon, 'X', 'Vollradar', { ult: true, points: 6, opts: { dist: 0, radius: 220, duration: 10 } }),
    },
  },
  {
    id: 'titan', name: 'Titan', role: 'Duellant', color: '#e0433a',
    desc: 'Sturmangriff mit Feuerkraft.',
    abilities: {
      C: ability(B.dash, 'C', 'Ansturm', { charges: 1, cost: 200, cooldown: 10, opts: { force: 18, up: 2 } }),
      Q: ability(B.molly, 'Q', 'Sprengsatz', { charges: 1, cost: 200, opts: { dist: 16, radius: 4, duration: 3, dps: 60 } }),
      E: ability(B.heal, 'E', 'Adrenalin', { charges: 1, signature: true, cooldown: 30, opts: { amount: 50, duration: 3 } }),
      X: ability(B.molly, 'X', 'Overkill', { ult: true, points: 7, opts: { dist: 18, radius: 8, duration: 5, dps: 75 } }),
    },
  },
  {
    id: 'wispel', name: 'Wispel', role: 'Stratege', color: '#c0c0ff',
    desc: 'Manipuliert Sicht mit Rauch und Wänden.',
    abilities: {
      C: ability(B.smoke, 'C', 'Schwaden', { charges: 3, cost: 100, opts: { dist: 18, radius: 5, duration: 16 } }),
      Q: ability(B.wall, 'Q', 'Trennwand', { charges: 1, cost: 250, opts: { length: 12, height: 3.5, duration: 18 } }),
      E: ability(B.smoke, 'E', 'Dauerrauch', { charges: 4, signature: true, opts: { dist: 20, radius: 5, duration: 20 } }),
      X: ability(B.slow, 'X', 'Zeitfalle', { ult: true, points: 7, opts: { dist: 20, radius: 10, duration: 10, slow: 0.6 } }),
    },
  },
  {
    id: 'klinge', name: 'Klinge', role: 'Duellant', color: '#ff9f43',
    desc: 'Nahkampfspezialist mit Dash und Heilung.',
    abilities: {
      C: ability(B.dash, 'C', 'Satz', { charges: 2, cost: 150, cooldown: 6, opts: { force: 20, up: 4 } }),
      Q: ability(B.heal, 'Q', 'Kampfrausch', { charges: 1, cost: 100, opts: { amount: 30, duration: 2 } }),
      E: ability(B.dash, 'E', 'Wirbel', { charges: 1, signature: true, cooldown: 22, opts: { force: 16, up: 8 } }),
      X: ability(B.dash, 'X', 'Bluttanz', { ult: true, points: 6, opts: { force: 26, up: 5 } }),
    },
  },
  {
    id: 'frost', name: 'Frost', role: 'Wächter', color: '#7fe0ff',
    desc: 'Verlangsamt und friert Gegner ein.',
    abilities: {
      C: ability(B.slow, 'C', 'Eisfeld', { charges: 2, cost: 200, opts: { dist: 14, radius: 5, duration: 7, slow: 0.55 } }),
      Q: ability(B.wall, 'Q', 'Eiswall', { charges: 1, cost: 300, opts: { length: 12, height: 3.5, duration: 20 } }),
      E: ability(B.trap, 'E', 'Frostmine', { charges: 2, signature: true, cooldown: 35, opts: { dist: 8, radius: 3.5, duration: 40, effect: 'slow' } }),
      X: ability(B.slow, 'X', 'Blizzard', { ult: true, points: 7, opts: { dist: 20, radius: 12, duration: 8, slow: 0.7 } }),
    },
  },
  {
    id: 'volt', name: 'Volt', role: 'Initiator', color: '#f0e04a',
    desc: 'Elektrische Kontrolle und Aufklärung.',
    abilities: {
      C: ability(B.recon, 'C', 'Impuls', { charges: 2, cost: 150, opts: { dist: 18, radius: 16, duration: 3 } }),
      Q: ability(B.slow, 'Q', 'Störfeld', { charges: 1, cost: 200, opts: { dist: 16, radius: 5, duration: 6, slow: 0.5 } }),
      E: ability(B.flash, 'E', 'Blitzschlag', { charges: 2, signature: true, cooldown: 35, opts: { dist: 16, duration: 1.5, radius: 20 } }),
      X: ability(B.molly, 'X', 'Gewitter', { ult: true, points: 7, opts: { dist: 20, radius: 10, duration: 6, dps: 55 } }),
    },
  },
  {
    id: 'mauer', name: 'Mauer', role: 'Wächter', color: '#a0a0a0',
    desc: 'Defensiver Spezialist für Standhalten.',
    abilities: {
      C: ability(B.wall, 'C', 'Sperre', { charges: 2, cost: 150, opts: { length: 9, height: 3, duration: 18 } }),
      Q: ability(B.turret, 'Q', 'Geschütz', { charges: 1, cost: 300, opts: { dist: 4, dps: 16, range: 30, duration: 45 } }),
      E: ability(B.trap, 'E', 'Alarm', { charges: 2, signature: true, cooldown: 30, opts: { dist: 8, radius: 3, duration: 45, effect: 'reveal' } }),
      X: ability(B.turret, 'X', 'Flakwall', { ult: true, points: 8, opts: { dist: 6, dps: 30, range: 40, duration: 30 } }),
    },
  },
  {
    id: 'echo', name: 'Echo', role: 'Stratege', color: '#c743c7',
    desc: 'Flexibler Controller mit Rauch und Falle.',
    abilities: {
      C: ability(B.smoke, 'C', 'Echoschall', { charges: 2, cost: 100, opts: { dist: 16, radius: 5, duration: 14 } }),
      Q: ability(B.trap, 'Q', 'Resonanz', { charges: 1, cost: 200, opts: { dist: 8, radius: 3, duration: 40, effect: 'slow' } }),
      E: ability(B.smoke, 'E', 'Nebelfeld', { charges: 3, signature: true, opts: { dist: 20, radius: 5.5, duration: 18 } }),
      X: ability(B.recon, 'X', 'Widerhall', { ult: true, points: 7, opts: { dist: 0, radius: 200, duration: 8 } }),
    },
  },
];

export function agentById(id) {
  return AGENTS.find((a) => a.id === id) || AGENTS[0];
}
