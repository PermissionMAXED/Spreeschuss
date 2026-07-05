import * as THREE from 'three';
import { paletteKey, hashStr, mulberry32, placedBox, mergeInto } from './util.js';

// =====================================================================
// FROZEN INTERFACE — perimeter wall decoration (NO colliders).
//
//   addWallTrim(group, w, d, H, t, palette)
//     Per-palette trim identity mounted on the collidered perimeter
//     walls. Face-mounted elements stay <= 0.05 m proud of the wall
//     colliders (hitscan still resolves against the collider); roof
//     dressing sits ABOVE the 6 m wall top (unreachable, so it may be
//     wider than the wall). All four corners get gate/pylon dressing.
//     `H`/`t` are the perimeter wall height/thickness from
//     structures.js.
//
// Identities (keyed by util.paletteKey):
//   Spree   — steady guide lights, concrete pilasters, cap lamps.
//   Sand    — striped market awnings, beam ends, adobe crenellations.
//   Neon    — segmented light strips with gaps on two levels + base line.
//   Ice     — frost-cap edging chunks, hanging icicles, faint glow line.
//   Ruins   — broken irregular cap stones, ember strip fragments, rubble.
//   Toxic   — hazard-striped band, conduit pipe run + valves, drips, vents.
//   Crimson — riveted seams, buttress plates, wide-dash red glow, ribs.
//
// Face-mounted layers use staggered proudness (0.03 … 0.05) so stacked
// elements never share a coplanar front face (no z-fighting). Everything
// merges into three meshes (glow / dark / deck). Deterministic per
// palette + map size via a locally seeded PRNG (no shared `rand` here —
// the call order contract in mapbuilder.js reserves that for skyline
// and props).
// =====================================================================

// Layer proudness: background -> foreground. L5 is the 0.05 maximum.
const L1 = 0.03;
const L2 = 0.035;
const L3 = 0.04;
const L4 = 0.045;
const L5 = 0.05;

// Third-material (deck) look per palette.
const DECK = {
  Spree: { color: '#8a97a6', rough: 0.55, metal: 0.35 },
  Sand: { color: '#d9c49a', rough: 0.95, metal: 0.0 },
  Neon: { color: '#cdd2ea', rough: 0.35, metal: 0.5, emissive: '#8f9dff', emissiveIntensity: 0.25 },
  Ice: { color: '#eef8ff', rough: 0.25, metal: 0.05, emissive: '#9fdcff', emissiveIntensity: 0.3 },
  Ruins: { color: '#7a6c58', rough: 0.95, metal: 0.0 },
  Toxic: { color: '#55684a', rough: 0.6, metal: 0.45 },
  Crimson: { color: '#4a3438', rough: 0.5, metal: 0.6 },
};

export function addWallTrim(group, w, d, H, t, palette) {
  const key = paletteKey(palette);
  const rand = mulberry32(hashStr(`trim:${key}:${w}x${d}`));

  const glowMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(palette.accent).multiplyScalar(0.5),
    emissive: new THREE.Color(palette.accent),
    emissiveIntensity: 1.15,
    roughness: 0.4,
    metalness: 0.2,
  });
  const darkMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(palette.wall).multiplyScalar(0.35),
    roughness: 0.75,
    metalness: 0.3,
  });
  const deckCfg = DECK[key];
  const deckMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(deckCfg.color),
    roughness: deckCfg.rough,
    metalness: deckCfg.metal,
    ...(deckCfg.emissive ? { emissive: new THREE.Color(deckCfg.emissive), emissiveIntensity: deckCfg.emissiveIntensity } : {}),
  });

  const glowGeos = [];
  const darkGeos = [];
  const deckGeos = [];

  // Face-mounted box: protrudes `th` (<= 0.05) into the arena from the
  // inner collider face of the wall on `axis`/`side`.
  const mount = (axis, side, along, y, len, h, th, bucket) => {
    const off = (axis === 'z' ? d / 2 : w / 2) - t / 2 - th / 2;
    if (axis === 'z') bucket.push(placedBox(len, h, th, along, y, side * off));
    else bucket.push(placedBox(th, h, len, side * off, y, along));
  };
  // Top-of-wall box: bottom sits at yBase (>= H, unreachable).
  const capBox = (axis, side, along, yBase, len, h, wd, bucket, ry = 0) => {
    const c = axis === 'z' ? d / 2 : w / 2;
    if (axis === 'z') bucket.push(placedBox(len, h, wd, along, yBase + h / 2, side * c, ry));
    else bucket.push(placedBox(wd, h, len, side * c, yBase + h / 2, along, ry));
  };
  // Dashed run of face-mounted segments.
  const dashes = (axis, side, span, y, h, th, seg, gap, bucket, phase = 0) => {
    let a = -span / 2 + phase;
    while (a < span / 2 - 0.3) {
      const len = Math.min(seg, span / 2 - a);
      mount(axis, side, a + len / 2, y, len, h, th, bucket);
      a += seg + gap;
    }
  };

  const walls = [];
  for (const axis of ['z', 'x']) {
    for (const side of [-1, 1]) {
      walls.push({ axis, side, span: (axis === 'z' ? w : d) - 2 * t - 1.6 });
    }
  }

  for (const wall of walls) {
    const { axis, side, span } = wall;
    // caps on the two axes get slightly different heights so overlapping
    // corner volumes never share a coplanar top face
    const capH = axis === 'z' ? 0.14 : 0.12;

    if (key === 'Spree') {
      mount(axis, side, 0, 2.7, span, 0.14, L5, glowGeos); // guide light
      mount(axis, side, 0, 4.35, span, 0.06, L5, glowGeos); // thin upper line
      mount(axis, side, 0, 0.55, span, 1.0, L1, darkGeos); // concrete skirt
      const nPil = Math.max(4, Math.floor(span / 5.5));
      for (let i = 0; i < nPil; i++) {
        mount(axis, side, -span / 2 + (i + 0.5) * (span / nPil), 2.85, 0.5, 5.5, L3, darkGeos);
      }
      capBox(axis, side, 0, H, span + 1.4, capH, t + 0.15, darkGeos);
      capBox(axis, side, 0, H + capH, span + 1.0, 0.07, 0.12, glowGeos);
      const nLamp = Math.max(3, Math.floor(span / 8));
      for (let i = 0; i < nLamp; i++) {
        capBox(axis, side, -span / 2 + (i + 0.5) * (span / nLamp), H + capH + 0.07, 0.35, 0.3, 0.35, glowGeos);
      }
    } else if (key === 'Sand') {
      // striped market awnings with beam ends and adobe crenellations
      let a = -span / 2 + rand() * 0.8;
      while (a < span / 2 - 1.2) {
        const len = 2.2 + rand() * 1.4;
        const end = Math.min(a + len, span / 2 - 0.2);
        mount(axis, side, (a + end) / 2, 2.62, end - a, 0.55, L5, deckGeos);
        mount(axis, side, (a + end) / 2, 2.98, end - a + 0.15, 0.1, L4, darkGeos); // awning rail
        if (rand() > 0.62) mount(axis, side, (a + end) / 2, 3.35, Math.min(1.6, end - a), 0.22, L5, glowGeos); // souk sign
        a = end + 0.9 + rand() * 1.1;
      }
      const nBeam = Math.max(5, Math.floor(span / 3.2));
      for (let i = 0; i < nBeam; i++) {
        mount(axis, side, -span / 2 + (i + 0.5) * (span / nBeam), 4.6, 0.28, 0.28, L5, darkGeos); // beam ends
      }
      mount(axis, side, 0, 0.45, span, 0.8, L1, darkGeos);
      capBox(axis, side, 0, H, span + 1.4, 0.1, t + 0.1, darkGeos);
      let cx = -span / 2;
      while (cx < span / 2) {
        capBox(axis, side, cx, H + 0.1, 0.9, 0.5 + rand() * 0.15, t + 0.05, deckGeos); // crenellations
        cx += 2.1 + rand() * 0.5;
      }
    } else if (key === 'Neon') {
      dashes(axis, side, span, 2.7, 0.15, L5, 2.4, 0.9, glowGeos);
      dashes(axis, side, span, 4.5, 0.1, L5, 2.4, 0.9, glowGeos, 1.65);
      dashes(axis, side, span, 0.14, 0.07, L5, 3.4, 1.4, glowGeos, 0.8); // base runner line
      const nTick = Math.max(3, Math.floor(span / 9.9));
      for (let i = 0; i < nTick; i++) {
        mount(axis, side, -span / 2 + (i + 0.5) * (span / nTick), 3.6, 0.09, 1.9, L4, glowGeos); // vertical connectors
      }
      mount(axis, side, 0, 0.55, span, 0.6, L1, darkGeos);
      capBox(axis, side, 0, H, span + 1.4, capH, t + 0.15, darkGeos);
      capBox(axis, side, 0, H + capH, span + 1.2, 0.09, 0.14, glowGeos);
    } else if (key === 'Ice') {
      mount(axis, side, 0, 2.7, span, 0.08, L5, glowGeos); // faint guide line
      mount(axis, side, 0, 0.4, span, 0.7, L1, darkGeos);
      // hanging icicles just below the top edge
      let ix = -span / 2 + rand();
      while (ix < span / 2 - 0.3) {
        const hang = 0.3 + rand() * 0.6;
        mount(axis, side, ix, H - 0.12 - hang / 2, 0.1 + rand() * 0.08, hang, L4, deckGeos);
        ix += 0.8 + rand() * 1.7;
      }
      // frost-cap edging: irregular white chunks along the top
      capBox(axis, side, 0, H, span + 1.4, 0.1, t + 0.1, darkGeos);
      let fx = -span / 2;
      while (fx < span / 2) {
        const len = 1.0 + rand() * 1.8;
        capBox(axis, side, fx + len / 2, H + 0.1, len, 0.16 + rand() * 0.4, t + 0.12, deckGeos);
        fx += len + rand() * 1.2;
      }
    } else if (key === 'Ruins') {
      // broken ember strip fragments (dead conduit)
      dashes(axis, side, span, 2.6, 0.13, L5, 0.9 + rand() * 0.7, 2.6 + rand() * 2.2, glowGeos, rand() * 2);
      mount(axis, side, 0, 0.5, span, 0.9, L1, darkGeos);
      // patch plates + rubble line at the base
      const nPatch = Math.max(3, Math.floor(span / 8));
      for (let i = 0; i < nPatch; i++) {
        mount(axis, side, -span / 2 + rand() * span, 1.2 + rand() * 3.2, 0.9 + rand() * 0.8, 1.0 + rand() * 0.9, L3, deckGeos);
      }
      let rx = -span / 2 + rand();
      while (rx < span / 2 - 0.4) {
        mount(axis, side, rx, 0.16 + rand() * 0.18, 0.35 + rand() * 0.4, 0.3 + rand() * 0.3, L5, deckGeos);
        rx += 1.4 + rand() * 2.4;
      }
      // broken/irregular cap stones with gaps
      let cx = -span / 2;
      while (cx < span / 2) {
        const len = 1.2 + rand() * 1.5;
        if (rand() > 0.22) {
          capBox(axis, side, cx + len / 2, H, len, 0.2 + rand() * 0.45, t + 0.1 + rand() * 0.15, darkGeos, (rand() - 0.5) * 0.1);
        }
        cx += len + rand() * 1.3;
      }
    } else if (key === 'Toxic') {
      // hazard band: alternating glow / dark segments
      let hx = -span / 2;
      let on = true;
      while (hx < span / 2 - 0.2) {
        const len = Math.min(1.25, span / 2 - hx);
        mount(axis, side, hx + len / 2, 2.7, len, 0.3, L5, on ? glowGeos : darkGeos);
        hx += len;
        on = !on;
      }
      // conduit pipe run with valve boxes
      mount(axis, side, 0, 3.9, span, 0.16, L4, deckGeos);
      const nValve = Math.max(3, Math.floor(span / 7));
      for (let i = 0; i < nValve; i++) {
        mount(axis, side, -span / 2 + (i + 0.5) * (span / nValve), 3.9, 0.32, 0.34, L5, deckGeos);
      }
      // drip streaks below the pipe
      const nDrip = Math.max(4, Math.floor(span / 6));
      for (let i = 0; i < nDrip; i++) {
        mount(axis, side, -span / 2 + rand() * span, 1.6 + rand() * 0.8, 0.18 + rand() * 0.14, 1.4 + rand() * 1.2, L3, darkGeos);
      }
      mount(axis, side, 0, 0.6, span, 1.2, L1, darkGeos); // tall mossy skirt
      capBox(axis, side, 0, H, span + 1.4, capH, t + 0.15, darkGeos);
      const nVent = Math.max(2, Math.floor(span / 9));
      for (let i = 0; i < nVent; i++) {
        capBox(axis, side, -span / 2 + (i + 0.5) * (span / nVent), H + capH, 0.9, 0.5, t + 0.3, darkGeos);
      }
    } else if (key === 'Crimson') {
      dashes(axis, side, span, 2.8, 0.16, L5, 3.4, 0.6, glowGeos);
      // riveted horizontal seams
      for (const sy of [2.0, 4.1]) {
        mount(axis, side, 0, sy, span, 0.08, L4, darkGeos);
        const nRiv = Math.max(6, Math.floor(span / 2.4));
        for (let i = 0; i < nRiv; i++) {
          mount(axis, side, -span / 2 + (i + 0.5) * (span / nRiv), sy, 0.12, 0.12, L5, deckGeos);
        }
      }
      // buttress plates
      const nBut = Math.max(3, Math.floor(span / 6.5));
      for (let i = 0; i < nBut; i++) {
        mount(axis, side, -span / 2 + (i + 0.5) * (span / nBut), 2.85, 0.6, 5.5, L3, darkGeos);
      }
      mount(axis, side, 0, 0.5, span, 0.9, L1, darkGeos);
      // heavy industrial cap with ribs + thin glow rail
      capBox(axis, side, 0, H, span + 1.4, capH + 0.12, t + 0.2, darkGeos);
      const nRib = Math.max(4, Math.floor(span / 4));
      for (let i = 0; i < nRib; i++) {
        capBox(axis, side, -span / 2 + (i + 0.5) * (span / nRib), H + capH + 0.12, 0.5, 0.22, t + 0.3, darkGeos);
      }
      capBox(axis, side, 0, H + capH + 0.12, span + 1.0, 0.07, 0.1, glowGeos);
    }
  }

  // ------------------------- corner gate/pylon dressing (all palettes)
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const cx = sx * (w / 2);
      const cz = sz * (d / 2);
      // pylon stack above the wall top (unreachable)
      darkGeos.push(placedBox(1.7, 1.1, 1.7, cx, H + 0.55, cz));
      darkGeos.push(placedBox(1.2, 0.9, 1.2, cx, H + 1.55, cz));
      glowGeos.push(placedBox(1.8, 0.16, 1.8, cx, H + 1.13, cz)); // band between tiers
      glowGeos.push(placedBox(0.45, 0.2, 0.45, cx, H + 2.1, cz)); // beacon block
      // gate frame on both faces flanking the corner (<= 0.05 proud)
      mount('z', sz, sx * (w / 2 - 2.5), 2.8, 0.9, 5.4, L2, darkGeos);
      mount('z', sz, sx * (w / 2 - 2.1), 2.8, 0.22, 5.0, L4, glowGeos);
      mount('x', sx, sz * (d / 2 - 2.5), 2.8, 0.9, 5.4, L2, darkGeos);
      mount('x', sx, sz * (d / 2 - 2.1), 2.8, 0.22, 5.0, L4, glowGeos);
    }
  }

  mergeInto(group, glowGeos, glowMat);
  mergeInto(group, darkGeos, darkMat);
  mergeInto(group, deckGeos, deckMat);
}
