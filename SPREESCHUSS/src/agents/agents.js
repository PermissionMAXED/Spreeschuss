import { AbilityBehaviors as B, makeAbility } from './abilities.js';

// Agent roster. Each agent has a color, role and four abilities:
//   C (basic), Q (basic), E (signature), X (ultimate).
// Abilities compose reusable behaviors from abilities.js.
//
// Kit design rules (balance pass):
//   - Costs 100-400 credits, scaled to round impact: pocket utility 100-150,
//     solid utility 200-250, round-swinging tools 300+.
//   - Charges 1-3: cheap spammable utility gets 2-3, high-impact tools get 1.
//   - E is the free signature: no cost, refreshes every round, gated by a
//     long cooldown (and 1-2 charges per round).
//   - X ult points 6-8: 6 = mostly selfish/sustain, 7 = strong swing,
//     8 = site-flipping signature moment.
//   - No two agents share an effectively identical kit: every behavior that
//     appears twice differs in shape (line vs ring, pillar vs low cover,
//     sensor vs zapper turret, projected vs self-centred pulse, ...).

function ability(behavior, key, name, opts) {
  return makeAbility(behavior, { key, name, ...opts });
}

export const ROLES = ['Duellant', 'Wächter', 'Initiator', 'Stratege'];

export const AGENTS = [
  {
    // Entry duelist: double-pop flashes + raw speed. Ult is a full breach:
    // deep flash (pops beyond its own radius, so Spree is not blinded at
    // cast), reveal on the breached area, monster dash.
    id: 'spree', name: 'Spree', role: 'Duellant', color: '#43b7c7',
    desc: 'Entry-Duellant: Doppelblenden, rohes Tempo und der Durchbruch, bevor jemand blinzelt.',
    abilities: {
      C: ability(B.flashVolley, 'C', 'Doppelblitz', { charges: 2, cost: 250, opts: { dists: [9, 15], delay: 0.3, duration: 1.2, radius: 18 } }),
      Q: ability(B.dash, 'Q', 'Uferschub', { charges: 1, cost: 150, cooldown: 6, opts: { force: 22, up: 1 } }), // flat slide, no height
      E: ability(B.blinkDash, 'E', 'Blinzeln', { charges: 1, signature: true, cooldown: 25, opts: { force: 24, up: 3, originSmoke: { radius: 3, duration: 6 } } }), // covers the departure point
      X: ability(B.breachDash, 'X', 'Durchbruch', { ult: true, points: 7, opts: { force: 30, up: 4, flashDist: 20, flashDuration: 1.6, flashRadius: 16, revealDist: 12, revealRadius: 14, revealDuration: 3 } }),
    },
  },
  {
    // Smoke controller: single one-ways, a toxic cloud you cannot sprint
    // through, a full three-smoke wall, and a giant blinding dome ult.
    id: 'nebel', name: 'Nebel', role: 'Stratege', color: '#8a7add',
    desc: 'Rauchmeister: legt ganze Sichtachsen in Dunst und macht jeden Push zäh wie Sirup.',
    abilities: {
      C: ability(B.smoke, 'C', 'Dunstglocke', { charges: 2, cost: 100, opts: { dist: 18, radius: 5.5, duration: 15 } }),
      Q: ability(B.gasCloud, 'Q', 'Giftnebel', { charges: 1, cost: 200, opts: { dist: 14, radius: 4.5, duration: 12, slow: 0.45, slowDuration: 8 } }), // smoke + slow underneath
      E: ability(B.smokeWall, 'E', 'Wolkenfront', { charges: 2, signature: true, cooldown: 30, opts: { dist: 18, count: 3, gap: 7, radius: 4.5, duration: 15 } }), // row of 3 smokes
      X: ability(B.gasCloud, 'X', 'Blindflug', { ult: true, points: 7, opts: { dist: 16, radius: 11, duration: 18, slowRadius: 10, slow: 0.35, slowDuration: 10 } }), // dome: huge smoke + heavy air
    },
  },
  {
    // Flash initiator: recon dart to find them, cascading flashes to take
    // their eyes. Ult is a three-pop sunstorm that also tags the area.
    id: 'funke', name: 'Funke', role: 'Initiator', color: '#ffd166',
    desc: 'Blend-Initiator: Licht als Waffe, Funken als Augen — wer hinsieht, verliert.',
    abilities: {
      C: ability(B.recon, 'C', 'Spähfunke', { charges: 2, cost: 200, opts: { dist: 22, radius: 14, duration: 3 } }),
      Q: ability(B.flashVolley, 'Q', 'Lichterkette', { charges: 1, cost: 300, opts: { dists: [12, 20], delay: 0.45, duration: 1.5, radius: 20 } }), // 2nd pop catches the turn-back
      E: ability(B.flashRecon, 'E', 'Ortungsblitz', { charges: 1, signature: true, cooldown: 30, opts: { dist: 16, duration: 1.3, radius: 18, revealRadius: 12, revealDuration: 2.5 } }), // flash + minimap tag
      X: ability(B.flashVolley, 'X', 'Sonnensturm', { ult: true, points: 7, opts: { dists: [10, 16, 22], delay: 0.4, duration: 2.0, radius: 24, reveal: { radius: 20, duration: 4 } } }),
    },
  },
  {
    // Site anchor / fort builder: slow wire, LOW cover you shoot over, a
    // long-range sensor turret (chip dps 6 = its tracers give pushes away),
    // and a projected garrisoned fortress as ult.
    id: 'bollwerk', name: 'Bollwerk', role: 'Wächter', color: '#e08a3a',
    desc: 'Festungsbauer: Draht, Brustwehr und ein Posten, der niemals wegsieht.',
    abilities: {
      C: ability(B.trap, 'C', 'Stolperdraht', { charges: 2, cost: 200, opts: { dist: 8, radius: 3.5, duration: 45, effect: 'slow' } }),
      Q: ability(B.wall, 'Q', 'Brustwehr', { charges: 1, cost: 200, opts: { dist: 6, length: 11, height: 2, duration: 25 } }), // hip-high: cover, not a door
      E: ability(B.turret, 'E', 'Wachposten', { charges: 1, signature: true, cooldown: 45, opts: { dist: 4, dps: 6, range: 42, duration: 45 } }), // sensor variant: long range, low dps
      X: ability(B.fortress, 'X', 'Zitadelle', { ult: true, points: 8, opts: { dist: 12, width: 12, depth: 9, height: 4.5, duration: 18, turret: { dps: 10, range: 30, duration: 18 } } }), // 3 walls + garrison
    },
  },
  {
    // Fire shaper: point molly, a 4-zone napalm LINE, a long-range fire dart
    // and a ring-of-fire ult that traps a whole site.
    id: 'brandt', name: 'Brandt', role: 'Initiator', color: '#ff5a4a',
    desc: 'Brandstifter: zeichnet Linien und Ringe aus Feuer — der Boden gehört ihm.',
    abilities: {
      C: ability(B.molly, 'C', 'Brandsatz', { charges: 1, cost: 200, opts: { dist: 16, radius: 4, duration: 5, dps: 40 } }),
      Q: ability(B.mollyLine, 'Q', 'Feuerschneise', { charges: 1, cost: 300, opts: { start: 6, gap: 4, count: 4, radius: 2.2, duration: 4, dps: 35 } }), // shaped molly line
      E: ability(B.molly, 'E', 'Brandpfeil', { charges: 1, signature: true, cooldown: 30, opts: { dist: 26, radius: 2.5, duration: 3, dps: 80 } }), // sniper molly: far, small, vicious
      X: ability(B.mollyRing, 'X', 'Feuersturm', { ult: true, points: 8, opts: { dist: 18, ringRadius: 7, count: 6, radius: 3, duration: 7, dps: 50, center: { radius: 4, dps: 50 } } }),
    },
  },
  {
    // Field medic: quick stims, self-cover rescue smoke, and an aid-station
    // ult (heal + smoke + ward that slows anyone storming it). 6 points:
    // powerful but selfish sustain, wins no round on its own.
    id: 'sani', name: 'Sani', role: 'Stratege', color: '#4ae08a',
    desc: 'Feldsanitäter: hält sich am Leben, den Feind auf Abstand und die Stellung sauber.',
    abilities: {
      C: ability(B.heal, 'C', 'Stimpack', { charges: 2, cost: 100, opts: { amount: 30, duration: 1.5 } }),
      Q: ability(B.rescueSmoke, 'Q', 'Rettungsrauch', { charges: 1, cost: 150, opts: { radius: 4, duration: 8, heal: 20, healDuration: 2 } }), // smoke on self + patch-up
      E: ability(B.heal, 'E', 'Zweiter Atem', { charges: 1, signature: true, cooldown: 35, opts: { amount: 70, duration: 4 } }),
      X: ability(B.medicField, 'X', 'Feldlazarett', { ult: true, points: 6, opts: { heal: 100, healDuration: 5, smokeRadius: 6, smokeDuration: 10, wardRadius: 7, wardDuration: 8, wardSlow: 0.4 } }),
    },
  },
  {
    // Phantom flanker: cheap pocket smokes, a DEEP flash for backstabs, a
    // double-smoke blink, and a vanishing dive ult that marks the arrival.
    id: 'schatten', name: 'Schatten', role: 'Duellant', color: '#9a4aff',
    desc: 'Phantom: verschwindet im Schleier, taucht hinter dir auf — und du hörst nur den Rauch.',
    abilities: {
      C: ability(B.smoke, 'C', 'Schleier', { charges: 2, cost: 100, opts: { dist: 10, radius: 3.5, duration: 7 } }), // small, short, instant one-way
      Q: ability(B.flash, 'Q', 'Paranoia', { charges: 1, cost: 250, opts: { dist: 24, duration: 1.3, radius: 16 } }), // deep flash behind lines
      E: ability(B.blinkDash, 'E', 'Schattenschritt', { charges: 1, signature: true, cooldown: 25, opts: { force: 22, up: 4, originSmoke: { radius: 3, duration: 5 }, aheadSmoke: { dist: 7, radius: 3, duration: 5 } } }), // smoke at start AND landing
      X: ability(B.shadowDive, 'X', 'Nachtmahr', { ult: true, points: 7, opts: { force: 30, up: 5, smokeRadius: 5, smokeDuration: 8, revealDist: 10, revealRadius: 16, revealDuration: 4 } }),
    },
  },
  {
    // Immovable anchor: personal shield walls, a self-centred slow field
    // ("stand your ground"), and a four-wall panic bunker ult.
    id: 'anker', name: 'Anker', role: 'Wächter', color: '#3a7ae0',
    desc: 'Der Fels im Sturm: wirft den Anker und weicht keinen Meter zurück.',
    abilities: {
      C: ability(B.wall, 'C', 'Schildwand', { charges: 2, cost: 150, opts: { dist: 3, length: 7, height: 3, duration: 12 } }), // personal cover, right in front
      Q: ability(B.selfBurst, 'Q', 'Ankerfeld', { charges: 1, cost: 200, opts: { radius: 6, duration: 6, slow: 0.5 } }), // slow field around HIMSELF
      E: ability(B.guardWall, 'E', 'Verschanzung', { charges: 1, signature: true, cooldown: 35, opts: { dist: 3, length: 8, height: 3, duration: 15, heal: 40, healDuration: 3 } }), // wall + patch-up
      X: ability(B.bunkerSelf, 'X', 'Letzte Bastion', { ult: true, points: 7, opts: { size: 7, height: 4, duration: 12, heal: 60, healDuration: 4 } }), // boxed in, on purpose
    },
  },
  {
    // Signals officer: self-centred sonar, a big listening trap, a sweeping
    // reveal beam, and the full-map wallhack ult (8 points: wins rounds).
    id: 'radar', name: 'Radar', role: 'Initiator', color: '#43e0d0',
    desc: 'Signalaufklärer: hört alles, sieht jeden zuerst — die Karte ist sein Zeuge.',
    abilities: {
      C: ability(B.reconPulse, 'C', 'Sonarping', { charges: 2, cost: 150, opts: { radius: 16, duration: 2.5 } }), // pulse around self
      Q: ability(B.trap, 'Q', 'Horchposten', { charges: 1, cost: 250, opts: { dist: 10, radius: 5, duration: 40, effect: 'reveal' } }), // widest trap in the game
      E: ability(B.reconSweep, 'E', 'Fächerblick', { charges: 1, signature: true, cooldown: 40, opts: { start: 8, gap: 9, count: 3, radius: 9, duration: 4 } }), // beam of 3 pulses down a lane
      X: ability(B.recon, 'X', 'Vollbild', { ult: true, points: 8, opts: { dist: 0, radius: 220, duration: 10 } }),
    },
  },
  {
    // Battering ram: charges that scorch the launch path, a grenade-style
    // burst zone, a stim-lunge, and an earthquake charge ult.
    id: 'titan', name: 'Titan', role: 'Duellant', color: '#e0433a',
    desc: 'Sturmbock: walzt durch jede Verteidigung und lässt Feuer im Rückspiegel.',
    abilities: {
      C: ability(B.dashTrail, 'C', 'Rammstoß', { charges: 1, cost: 200, opts: { force: 20, up: 1, zoneCount: 2, zoneGap: 3.5, zoneRadius: 2.2, zoneDuration: 2.5, dps: 35 } }), // burns pursuers behind him
      Q: ability(B.molly, 'Q', 'Sprenggranate', { charges: 1, cost: 300, opts: { dist: 16, radius: 4.5, duration: 1.5, dps: 120 } }), // burst, not burn: dodge or die
      E: ability(B.combatStim, 'E', 'Adrenalin', { charges: 1, signature: true, cooldown: 30, opts: { amount: 40, duration: 2.5, force: 8, up: 1 } }), // heal + re-engage lunge
      X: ability(B.dashTrail, 'X', 'Erdbeben', { ult: true, points: 7, opts: { force: 30, up: 3, zoneCount: 3, zoneGap: 4, zoneRadius: 3, zoneDuration: 3, dps: 50, endSlow: { dist: 13, radius: 5, duration: 3, slow: 0.4 } } }),
    },
  },
  {
    // Ghost strategist: pocket one-ways, a long-range time rift, a wall that
    // runs ALONG the aim (splits a lane into a 50/50) and a stasis ult that
    // slows and blinds an entire site (8 points).
    id: 'wispel', name: 'Wispel', role: 'Stratege', color: '#c0c0ff',
    desc: 'Flüstergeist: teilt Gassen der Länge nach und lässt die Zeit selbst gerinnen.',
    abilities: {
      C: ability(B.smoke, 'C', 'Flüsterschleier', { charges: 3, cost: 100, opts: { dist: 20, radius: 4, duration: 20 } }), // small but very long-lived
      Q: ability(B.slow, 'Q', 'Zeitriss', { charges: 2, cost: 150, opts: { dist: 22, radius: 4, duration: 4, slow: 0.7 } }), // far, small, brutal
      E: ability(B.corridorWall, 'E', 'Geisterwand', { charges: 1, signature: true, cooldown: 35, opts: { dist: 10, length: 16, height: 3.5, duration: 12 } }), // parallel to aim!
      X: ability(B.slowStorm, 'X', 'Stillstand', { ult: true, points: 8, opts: { dist: 18, radius: 11, duration: 9, slow: 0.7, smokes: 'ring', smokeCount: 3, smokeRadius: 4, smokeDuration: 9 } }),
    },
  },
  {
    // Blade dancer: vertical hops, a double slash-wave right in front, a
    // hunting dash that marks prey, and a lifesteal dive ult (6 points:
    // selfish, needs the frag to pay off).
    id: 'klinge', name: 'Klinge', role: 'Duellant', color: '#ff9f43',
    desc: 'Klingentänzerin: tödlich auf Armlänge und nie da, wo man hinschießt.',
    abilities: {
      C: ability(B.dash, 'C', 'Satz', { charges: 2, cost: 150, cooldown: 5, opts: { force: 14, up: 7 } }), // vertical: onto crates, over walls
      Q: ability(B.mollyLine, 'Q', 'Doppelschnitt', { charges: 1, cost: 250, opts: { start: 2.5, gap: 3.5, count: 2, radius: 1.8, duration: 1.2, dps: 80 } }), // melee slash wave, point blank
      E: ability(B.huntDash, 'E', 'Nachstellen', { charges: 1, signature: true, cooldown: 25, opts: { force: 22, up: 3, revealDist: 8, revealRadius: 10, revealDuration: 2 } }), // dash + mark prey ahead
      X: ability(B.bladeDance, 'X', 'Bluttanz', { ult: true, points: 6, opts: { force: 26, up: 4, zoneDist: 7, zoneRadius: 4, zoneDuration: 3, dps: 60, heal: 50, healDuration: 3 } }),
    },
  },
  {
    // Ice warden: bread-and-butter slow fields, a tall ice PILLAR that seals
    // a doorway, the biggest freeze mines, and a whiteout blizzard ult
    // (slow + frostbite dps + smoke in the core).
    id: 'frost', name: 'Frost', role: 'Wächter', color: '#7fe0ff',
    desc: 'Eiswächterin: friert Angriffe ein — Säule für Säule, Grad für Grad.',
    abilities: {
      C: ability(B.slow, 'C', 'Frostfeld', { charges: 2, cost: 150, opts: { dist: 14, radius: 5, duration: 6, slow: 0.55 } }),
      Q: ability(B.wall, 'Q', 'Eissäule', { charges: 1, cost: 250, opts: { dist: 6, length: 5, height: 5, duration: 15 } }), // narrow but unclimbable
      E: ability(B.trap, 'E', 'Frostmine', { charges: 2, signature: true, cooldown: 30, opts: { dist: 8, radius: 4.5, duration: 45, effect: 'slow' } }), // biggest slow trap
      X: ability(B.slowStorm, 'X', 'Kälteeinbruch', { ult: true, points: 7, opts: { dist: 16, radius: 10, duration: 8, slow: 0.6, dps: 12, smokes: 'center', smokeRadius: 5, smokeDuration: 8 } }),
    },
  },
  {
    // Electro initiator: shock fields that hurt AND slow, a short-fuse tesla
    // zapper (high dps, tiny range/window), lightning-bolt flashes, and a
    // thunderstorm ult with sky-tracer strikes.
    id: 'volt', name: 'Volt', role: 'Initiator', color: '#f0e04a',
    desc: 'Hochspannung: schockt, blendet und ruft am Ende das Gewitter selbst.',
    abilities: {
      C: ability(B.slowStorm, 'C', 'Spannungsfeld', { charges: 2, cost: 200, opts: { dist: 14, radius: 4, duration: 4, slow: 0.35, dps: 20, color: 0xf0e04a } }), // damage + slow combo zone
      Q: ability(B.turret, 'Q', 'Teslaspule', { charges: 1, cost: 300, opts: { dist: 5, dps: 40, range: 14, duration: 10 } }), // zapper: brutal but brief and short-armed
      E: ability(B.boltFlash, 'E', 'Blitzschlag', { charges: 2, signature: true, cooldown: 30, opts: { dist: 16, duration: 1.4, radius: 20 } }), // flash with a visible bolt
      X: ability(B.stormcall, 'X', 'Gewitterfront', { ult: true, points: 7, opts: { dist: 18, strikes: 3, spread: 5, radius: 3, duration: 2.5, dps: 90, flash: { duration: 1.2, radius: 16 } } }),
    },
  },
  {
    // The living wall: standard concrete walls on tap, a balanced watchtower
    // turret, long-lived alarm wires, and a wall-plus-twin-turrets ult that
    // locks a whole lane down (8 points).
    id: 'mauer', name: 'Mauer', role: 'Wächter', color: '#a0a0a0',
    desc: 'Die lebende Mauer: Beton, Draht und Blei — hier kommt niemand durch.',
    abilities: {
      C: ability(B.wall, 'C', 'Betonriegel', { charges: 2, cost: 150, opts: { dist: 8, length: 10, height: 3.5, duration: 20 } }),
      Q: ability(B.turret, 'Q', 'Wachturm', { charges: 1, cost: 300, opts: { dist: 6, dps: 14, range: 30, duration: 30 } }), // the all-rounder turret
      E: ability(B.trap, 'E', 'Alarmdraht', { charges: 2, signature: true, cooldown: 25, opts: { dist: 8, radius: 2.5, duration: 60, effect: 'reveal' } }), // tiny, but lives forever
      X: ability(B.turretLine, 'X', 'Panzersperre', { ult: true, points: 8, opts: { dist: 10, length: 18, height: 4, wallDuration: 20, dps: 18, range: 32, turretDuration: 18 } }),
    },
  },
  {
    // Sound architect: wide concussive pops, traps that scout as they land,
    // and a sonar whose echo exposes HER position too (risk/reward). Ult is
    // full sensory overload on one area: flash + slow + reveal.
    id: 'echo', name: 'Echo', role: 'Stratege', color: '#c743c7',
    desc: 'Klangarchitektin: jeder Ton verrät einen Standort — manchmal auch ihren eigenen.',
    abilities: {
      C: ability(B.flash, 'C', 'Schallknall', { charges: 2, cost: 200, opts: { dist: 14, duration: 0.9, radius: 26 } }), // concussion: short but very wide
      Q: ability(B.trapPlus, 'Q', 'Resonanzfalle', { charges: 1, cost: 250, opts: { dist: 8, radius: 3.5, duration: 40, effect: 'reveal', scoutRadius: 8, scoutDuration: 2 } }), // placing it checks the corner
      E: ability(B.reconPulse, 'E', 'Echolot', { charges: 1, signature: true, cooldown: 35, opts: { radius: 22, duration: 4, exposeSelf: true, exposeRadius: 6, exposeDuration: 4 } }), // the echo betrays her too
      X: ability(B.sonicBoom, 'X', 'Überschall', { ult: true, points: 7, opts: { dist: 16, flashDuration: 1.8, flashRadius: 24, slowRadius: 8, slowDuration: 6, slow: 0.5, revealRadius: 16, revealDuration: 5 } }),
    },
  },
];

export function agentById(id) {
  return AGENTS.find((a) => a.id === id) || AGENTS[0];
}
