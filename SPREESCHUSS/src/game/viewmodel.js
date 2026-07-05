import * as THREE from 'three';
import { bus } from '../engine/eventbus.js';
import { WEAPONS } from '../weapons/weapons.js';

// First-person weapon viewmodel parented to the main camera and rendered in
// the single main pass. Procedurally builds a distinct gun per weapon ID
// (with a per-category fallback for unknown ids) and layers sway, bob,
// breathing, landing dips, sprint lowering, recoil kick, a three-phase reload
// choreography (mag out / mag in / charging-handle rack) and switch raise.

const RELOAD_DURATION = 2.0; // must match startReload() in weaponsystem.js
const RAISE_TIME = 0.3;      // weapon-switch raise animation length (s)
const FLASH_TIME = 0.04;     // muzzle flash duration (~40 ms)

// Reload phase boundaries as fractions of RELOAD_DURATION (0.6 s / 1.4 s / 2.0 s)
const PH_MAG_OUT = 0.3;      // 0.0 - 0.6 s : magazine drops out
const PH_MAG_IN = 0.7;       // 0.6 - 1.4 s : fresh magazine seats
                             // 1.4 - 2.0 s : charging handle rack

// ---------------------------------------------------------------- materials
function metal(color, rough = 0.4, met = 0.8, emissive = 0x000000, ei = 0) {
  return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: met, emissive, emissiveIntensity: ei });
}

// Shared palette: dark gunmetal receiver, near-black furniture, lighter steel
// for barrels/slides, matte polymer grips, warm wood + brass for classics,
// plus a per-weapon emissive accent (kept subtle — a bloom pass runs on top).
function palette(accent) {
  return {
    body: metal(0x4a525e, 0.38, 0.82, 0x141a21, 0.4),
    dark: metal(0x23272e, 0.58, 0.55, 0x0a0d10, 0.35),
    steel: metal(0x7b838e, 0.28, 0.95, 0x14171b, 0.25),
    grip: metal(0x2f3239, 0.78, 0.2),
    wood: metal(0x6e4a2f, 0.72, 0.12, 0x1a0f08, 0.25),
    brass: metal(0xc9a355, 0.32, 0.92, 0x2a1f0a, 0.3),
    accent: metal(accent, 0.35, 0.5, accent, 0.9),
  };
}

// Accent colors keyed by weapon id, with category fallbacks for unknown ids.
const ACCENTS = {
  // category fallbacks
  sidearm: 0x49c6d8, smg: 0xffb454, rifle: 0x43b7c7, sniper: 0xa385ff,
  shotgun: 0xff7a45, heavy: 0x7ee081, melee: 0x9fd8ff,
  // per-id
  knife: 0x9fd8ff,
  classic: 0x49c6d8, ghost: 0x7fe3c3, sheriff: 0xe0a24a,
  stinger: 0xffb454, spectre: 0xff8f6b,
  bulldog: 0x6bd06b, phantom: 0x5fc7e8, vandal: 0xff6b57,
  judge: 0xff7a45,
  marshal: 0xd9c26a, operator: 0xa385ff,
  ares: 0x7ee081, odin: 0xffd24a,
};

// Resting pose of the gun group (camera space, bottom-right). Category keys
// are the fallback; per-id overrides tune fit for unusually sized models.
const POSES = {
  sidearm: { pos: [0.24, -0.2, -0.48], rot: [0, -0.08, 0], scale: 1.1 },
  smg: { pos: [0.24, -0.21, -0.44], rot: [0, -0.09, 0], scale: 1.05 },
  rifle: { pos: [0.24, -0.22, -0.42], rot: [0, -0.08, 0], scale: 1.0 },
  sniper: { pos: [0.22, -0.22, -0.36], rot: [0, -0.07, 0], scale: 0.88 },
  shotgun: { pos: [0.24, -0.22, -0.44], rot: [0, -0.09, 0], scale: 0.95 },
  heavy: { pos: [0.26, -0.23, -0.46], rot: [0, -0.1, 0], scale: 0.92 },
  melee: { pos: [0.27, -0.31, -0.42], rot: [0.08, 0.4, -0.15], scale: 1.1 },
  // id overrides
  sheriff: { pos: [0.24, -0.2, -0.5], rot: [0, -0.08, 0], scale: 1.05 },
  bulldog: { pos: [0.24, -0.22, -0.4], rot: [0, -0.08, 0], scale: 1.0 },
  marshal: { pos: [0.23, -0.22, -0.38], rot: [0, -0.07, 0], scale: 0.92 },
  operator: { pos: [0.22, -0.22, -0.34], rot: [0, -0.06, 0], scale: 0.8 },
  odin: { pos: [0.26, -0.24, -0.46], rot: [0, -0.1, 0], scale: 0.85 },
};

// ---------------------------------------------------------------- geo helpers
function box(parent, mat, w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  parent.add(m);
  return m;
}

// cylinder with its length along Z (barrel orientation)
function tube(parent, mat, r1, r2, len, x, y, z, seg = 10) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, len, seg), mat);
  m.rotation.x = Math.PI / 2;
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}

// cylinder with its length along X (drums, bolt handles)
function tubeX(parent, mat, r1, r2, len, x, y, z, seg = 12) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, len, seg), mat);
  m.rotation.z = Math.PI / 2;
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}

// pivot group for animatable parts (magazines, slides, bolts, levers)
function pivot(parent, x = 0, y = 0, z = 0) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  parent.add(g);
  return g;
}

// ---------------------------------------------------------------- easing
function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
function smooth01(x) { x = clamp01(x); return x * x * (3 - 2 * x); }
// smooth bump centered on c with half-width w, 0 outside
function bell(x, c, w) {
  const t = 1 - Math.abs((x - c) / w);
  return t > 0 ? t * t * (3 - 2 * t) : 0;
}

// ---------------------------------------------------------------- gun builders
// Each returns { g, muzzle: [x,y,z]|null, flash, parts } with the muzzle in
// gun-local space. Forward is -Z; the grip sits near the origin. `flash`
// scales the muzzle sprite/light. `parts` holds animatable pivots:
//   mag  + magOut/magRot   — magazine drop offsets (position / rotation)
//   bolt + boltOut/boltRot — charging handle / slide / pump / lever rack
//   shell + shellFrom/shellTo — optional shell fed during the insert phase

// --- sidearms ---------------------------------------------------------------

// Classic: stubby service pistol — short blocky slide, snub barrel, tall sights.
function buildClassic(p) {
  const g = new THREE.Group();
  box(g, p.body, 0.07, 0.06, 0.32, 0, 0.008, -0.16);             // frame
  box(g, p.dark, 0.072, 0.032, 0.09, 0, 0.02, -0.27);            // dust-cover block
  box(g, p.grip, 0.066, 0.19, 0.11, 0, -0.11, -0.02, 0.22);      // grip
  box(g, p.dark, 0.02, 0.012, 0.1, 0, -0.05, -0.1);              // trigger guard bottom
  box(g, p.dark, 0.02, 0.05, 0.012, 0, -0.028, -0.15);           // trigger guard front
  box(g, p.dark, 0.012, 0.032, 0.012, 0, -0.03, -0.1, 0.3);      // trigger
  const slide = pivot(g);                                        // racks on reload + shot
  box(slide, p.steel, 0.075, 0.075, 0.34, 0, 0.075, -0.16);      // slide
  box(slide, p.dark, 0.078, 0.05, 0.06, 0, 0.078, -0.015);       // rear serrations
  box(slide, p.dark, 0.078, 0.05, 0.05, 0, 0.078, -0.285);       // front serrations
  box(slide, p.dark, 0.013, 0.024, 0.02, 0, 0.122, -0.315);      // tall front sight
  box(slide, p.dark, 0.042, 0.02, 0.022, 0, 0.12, -0.01);        // rear sight
  box(slide, p.accent, 0.077, 0.012, 0.1, 0, 0.048, -0.25);      // accent strip
  tube(g, p.dark, 0.018, 0.018, 0.045, 0, 0.075, -0.35);         // barrel stub
  const mag = pivot(g, 0, -0.1, -0.015);                         // drops on reload
  box(mag, p.dark, 0.048, 0.15, 0.075, 0, -0.03, -0.005, 0.22);
  box(mag, p.accent, 0.052, 0.018, 0.082, 0, -0.108, 0.012, 0.22); // baseplate
  return {
    g, muzzle: [0, 0.075, -0.4], flash: 0.8,
    parts: { mag, magOut: [0.01, -0.3, -0.06], magRot: [0.45, 0, 0.12], bolt: slide, boltOut: [0, 0.004, 0.1] },
  };
}

// Ghost: sleek suppressed pistol — long low slide, tapered can, low-profile sights.
function buildGhost(p) {
  const g = new THREE.Group();
  box(g, p.body, 0.07, 0.062, 0.36, 0, 0.004, -0.19);            // long frame
  box(g, p.grip, 0.064, 0.2, 0.105, 0, -0.115, -0.02, 0.26);     // raked grip
  box(g, p.dark, 0.02, 0.012, 0.11, 0, -0.052, -0.12);           // trigger guard bottom
  box(g, p.dark, 0.02, 0.05, 0.012, 0, -0.03, -0.175);           // trigger guard front
  box(g, p.dark, 0.012, 0.032, 0.012, 0, -0.032, -0.12, 0.3);    // trigger
  const slide = pivot(g);
  box(slide, p.steel, 0.072, 0.068, 0.4, 0, 0.07, -0.19);        // long low slide
  box(slide, p.dark, 0.075, 0.044, 0.07, 0, 0.072, -0.025);      // rear serrations
  box(slide, p.dark, 0.075, 0.044, 0.07, 0, 0.072, -0.345);      // front serrations
  box(slide, p.accent, 0.074, 0.01, 0.3, 0, 0.098, -0.19);       // full-length top accent
  box(slide, p.dark, 0.011, 0.016, 0.016, 0, 0.108, -0.375);     // low front sight
  box(slide, p.dark, 0.04, 0.014, 0.02, 0, 0.107, -0.02);        // low rear sight
  tube(g, p.dark, 0.03, 0.027, 0.18, 0, 0.07, -0.48);            // suppressor
  tube(g, p.accent, 0.031, 0.031, 0.012, 0, 0.07, -0.42);        // can ring
  const mag = pivot(g, 0, -0.11, -0.02);
  box(mag, p.dark, 0.046, 0.17, 0.07, 0, -0.03, 0.0, 0.26);      // 15-rnd mag
  box(mag, p.accent, 0.05, 0.016, 0.078, 0, -0.12, 0.024, 0.26);
  return {
    g, muzzle: [0, 0.07, -0.58], flash: 0.5, // suppressed: small dim flash
    parts: { mag, magOut: [0.02, -0.32, -0.05], magRot: [0.5, 0, -0.12], bolt: slide, boltOut: [0, 0.004, 0.11] },
  };
}

// Sheriff: heavy revolver — swing-out cylinder, ribbed barrel, wood grip, hammer.
function buildSheriff(p) {
  const g = new THREE.Group();
  box(g, p.body, 0.06, 0.08, 0.26, 0, 0.05, -0.1);               // frame
  box(g, p.steel, 0.048, 0.026, 0.36, 0, 0.128, -0.34);          // top rib
  tube(g, p.steel, 0.023, 0.023, 0.36, 0, 0.09, -0.34);          // heavy barrel
  box(g, p.dark, 0.028, 0.034, 0.3, 0, 0.052, -0.33);            // under-lug
  box(g, p.dark, 0.014, 0.03, 0.018, 0, 0.155, -0.5);            // front blade sight
  box(g, p.dark, 0.04, 0.016, 0.03, 0, 0.148, -0.02);            // rear sight
  // cylinder on a crane pivot: swings out sideways around the barrel axis
  const mag = pivot(g, -0.035, 0.03, -0.12);
  tube(mag, p.dark, 0.047, 0.047, 0.12, 0.035, 0.025, 0, 8);     // 6-shot cylinder
  tube(mag, p.accent, 0.048, 0.048, 0.014, 0.035, 0.025, -0.048, 8); // accent ring
  tube(mag, p.steel, 0.012, 0.012, 0.15, 0.035, 0.025, 0.01, 8); // ejector rod
  const bolt = pivot(g, 0, 0.1, 0.03);                           // hammer: cocks back
  box(bolt, p.steel, 0.018, 0.05, 0.03, 0, 0.012, 0.012, -0.5);
  box(g, p.dark, 0.02, 0.012, 0.09, 0, -0.028, -0.06);           // trigger guard bottom
  box(g, p.dark, 0.02, 0.05, 0.012, 0, -0.006, -0.105);          // trigger guard front
  box(g, p.dark, 0.012, 0.034, 0.012, 0, -0.01, -0.06, 0.3);     // trigger
  box(g, p.wood, 0.056, 0.17, 0.09, 0, -0.09, 0.045, 0.32);      // wood grip
  box(g, p.brass, 0.06, 0.024, 0.094, 0, -0.012, 0.028, 0.32);   // brass grip cap
  return {
    g, muzzle: [0, 0.09, -0.55], flash: 1.25,
    parts: { mag, magOut: [-0.025, -0.02, 0.01], magRot: [0, 0, 1.15], bolt, boltOut: [0, -0.004, 0.018], boltRot: [-0.7, 0, 0] },
  };
}

// --- SMGs -------------------------------------------------------------------

// Stinger: stubby machine pistol — vented snout, side-folded stock, fore magwell.
function buildStinger(p) {
  const g = new THREE.Group();
  box(g, p.body, 0.08, 0.1, 0.32, 0, 0.02, -0.19);               // stubby receiver
  box(g, p.dark, 0.082, 0.06, 0.16, 0, 0.025, -0.41);            // front shroud
  box(g, p.accent, 0.084, 0.012, 0.12, 0, 0.052, -0.41);         // vent accent
  box(g, p.accent, 0.084, 0.012, 0.12, 0, -0.002, -0.41);        // vent accent (lower)
  tube(g, p.steel, 0.015, 0.015, 0.12, 0, 0.03, -0.53);          // barrel
  tube(g, p.dark, 0.026, 0.016, 0.05, 0, 0.03, -0.6);            // conical flash hider
  box(g, p.dark, 0.014, 0.03, 0.014, 0, 0.096, -0.44);           // front post
  box(g, p.dark, 0.04, 0.026, 0.03, 0, 0.088, -0.09);            // rear sight block
  box(g, p.steel, 0.014, 0.014, 0.26, 0.052, 0.03, 0.0);         // folded stock rail (right)
  box(g, p.dark, 0.02, 0.07, 0.05, 0.052, 0.0, 0.11);            // folded butt plate
  box(g, p.grip, 0.055, 0.15, 0.08, 0, -0.1, 0.03, 0.28);        // grip
  box(g, p.dark, 0.02, 0.012, 0.1, 0, -0.043, -0.08);            // trigger guard
  box(g, p.body, 0.06, 0.05, 0.09, 0, -0.045, -0.27);            // fore magwell
  const mag = pivot(g, 0, -0.07, -0.27);
  box(mag, p.dark, 0.05, 0.15, 0.07, 0, -0.075, -0.012, -0.12);  // 20-rnd stick
  box(mag, p.accent, 0.053, 0.016, 0.074, 0, -0.148, -0.03, -0.12);
  const bolt = pivot(g);
  box(bolt, p.steel, 0.026, 0.026, 0.05, 0.052, 0.055, -0.13);   // side charging handle
  return {
    g, muzzle: [0, 0.03, -0.64], flash: 0.9,
    parts: { mag, magOut: [0, -0.26, -0.1], magRot: [-0.5, 0, 0.15], bolt, boltOut: [0, 0, 0.09] },
  };
}

// Spectre: full SMG — suppressor collar, wire stock, ring sight, vertical foregrip.
function buildSpectre(p) {
  const g = new THREE.Group();
  box(g, p.body, 0.085, 0.105, 0.46, 0, 0.02, -0.28);            // receiver
  box(g, p.dark, 0.05, 0.028, 0.44, 0, 0.09, -0.28);             // top rail
  tube(g, p.dark, 0.032, 0.032, 0.026, 0, 0.135, -0.2);          // ring sight
  box(g, p.accent, 0.008, 0.008, 0.01, 0, 0.135, -0.2);          // glowing dot
  box(g, p.steel, 0.016, 0.016, 0.24, -0.026, 0.05, 0.06);       // wire stock rails
  box(g, p.steel, 0.016, 0.016, 0.24, 0.026, 0.05, 0.06);
  box(g, p.dark, 0.09, 0.11, 0.03, 0, 0.02, 0.185);              // butt pad
  tube(g, p.steel, 0.016, 0.016, 0.16, 0, 0.035, -0.56);         // barrel
  tube(g, p.dark, 0.032, 0.032, 0.16, 0, 0.035, -0.56);          // suppressor collar
  tube(g, p.accent, 0.033, 0.033, 0.012, 0, 0.035, -0.5);        // collar ring
  box(g, p.grip, 0.05, 0.13, 0.055, 0, -0.1, -0.42, -0.15);      // vertical foregrip
  box(g, p.grip, 0.06, 0.16, 0.09, 0, -0.11, -0.1, 0.25);        // pistol grip
  box(g, p.accent, 0.087, 0.012, 0.22, 0, 0.079, -0.3);          // accent strip
  const mag = pivot(g, 0, -0.075, -0.26);
  box(mag, p.dark, 0.05, 0.19, 0.075, 0, -0.095, 0.012, 0.12);   // long 30-rnd mag
  box(mag, p.accent, 0.053, 0.016, 0.08, 0, -0.19, 0.034, 0.12);
  const bolt = pivot(g);
  box(bolt, p.steel, 0.026, 0.026, 0.05, 0.055, 0.045, -0.16);   // charging handle
  return {
    g, muzzle: [0, 0.035, -0.68], flash: 0.7,
    parts: { mag, magOut: [0.01, -0.3, -0.08], magRot: [-0.45, 0, 0.12], bolt, boltOut: [0, 0, 0.1] },
  };
}

// --- rifles -----------------------------------------------------------------

// Bulldog: bullpup — mag behind the grip, carry-handle optic, short snout.
function buildBulldog(p) {
  const g = new THREE.Group();
  box(g, p.body, 0.085, 0.13, 0.55, 0, 0.01, -0.1);              // continuous bullpup body
  box(g, p.dark, 0.08, 0.14, 0.05, 0, 0.0, 0.19);                // butt pad
  box(g, p.dark, 0.07, 0.045, 0.2, 0, 0.095, 0.08);              // cheek riser
  box(g, p.dark, 0.025, 0.05, 0.03, 0, 0.11, -0.12);             // optic posts
  box(g, p.dark, 0.025, 0.05, 0.03, 0, 0.11, -0.3);
  box(g, p.dark, 0.05, 0.05, 0.26, 0, 0.155, -0.21);             // integrated optic body
  tube(g, p.accent, 0.017, 0.017, 0.012, 0, 0.155, -0.335);      // objective lens
  box(g, p.dark, 0.075, 0.09, 0.16, 0, 0.02, -0.44);             // short handguard
  box(g, p.accent, 0.078, 0.012, 0.12, 0, 0.05, -0.44);          // handguard accent
  tube(g, p.steel, 0.016, 0.016, 0.16, 0, 0.035, -0.58);         // barrel
  box(g, p.dark, 0.034, 0.034, 0.06, 0, 0.035, -0.65);           // muzzle device
  box(g, p.grip, 0.06, 0.15, 0.09, 0, -0.1, -0.26, 0.25);        // grip (forward of mag)
  box(g, p.dark, 0.02, 0.012, 0.1, 0, -0.045, -0.33);            // trigger guard
  const mag = pivot(g, 0, -0.055, 0.03);
  box(mag, p.dark, 0.055, 0.15, 0.09, 0, -0.075, 0.0, 0.15);     // mag behind grip
  box(mag, p.accent, 0.058, 0.018, 0.094, 0, -0.148, 0.012, 0.15);
  const bolt = pivot(g);
  box(bolt, p.steel, 0.022, 0.03, 0.06, -0.052, 0.08, -0.28);    // left charging handle
  return {
    g, muzzle: [0, 0.035, -0.7], flash: 1.0,
    parts: { mag, magOut: [0.015, -0.3, 0.06], magRot: [0.55, 0, -0.12], bolt, boltOut: [0, 0, 0.11] },
  };
}

// Phantom: suppressed rifle — round vented handguard, fat can, ring sight.
function buildPhantom(p) {
  const g = new THREE.Group();
  box(g, p.body, 0.09, 0.12, 0.4, 0, 0.02, -0.32);               // receiver
  box(g, p.dark, 0.075, 0.1, 0.26, 0, 0.005, 0.0);               // stock
  box(g, p.dark, 0.08, 0.13, 0.04, 0, -0.005, 0.14);             // butt pad
  tube(g, p.dark, 0.042, 0.042, 0.38, 0, 0.03, -0.68);           // round handguard
  box(g, p.accent, 0.01, 0.088, 0.3, 0, 0.03, -0.66);            // side vent slits
  box(g, p.accent, 0.088, 0.01, 0.3, 0, 0.03, -0.66);            // top/bottom vent slits
  tube(g, p.steel, 0.015, 0.015, 0.1, 0, 0.03, -0.9);            // barrel
  tube(g, p.dark, 0.035, 0.031, 0.26, 0, 0.03, -1.02);           // fat suppressor
  tube(g, p.accent, 0.036, 0.036, 0.012, 0, 0.03, -0.92);        // can ring
  box(g, p.dark, 0.05, 0.03, 0.16, 0, 0.1, -0.3);                // rear rail
  tube(g, p.dark, 0.03, 0.03, 0.026, 0, 0.135, -0.26);           // ring sight
  box(g, p.accent, 0.008, 0.008, 0.01, 0, 0.135, -0.26);         // glowing dot
  box(g, p.grip, 0.06, 0.17, 0.1, 0, -0.11, -0.2, 0.28);         // grip
  box(g, p.dark, 0.02, 0.012, 0.1, 0, -0.05, -0.27);             // trigger guard
  const mag = pivot(g, 0, -0.08, -0.4);
  box(mag, p.dark, 0.055, 0.1, 0.1, 0, -0.045, 0.01, 0.1);       // straight 30-rnd mag
  box(mag, p.dark, 0.055, 0.09, 0.095, 0, -0.135, 0.015, 0.2);
  box(mag, p.accent, 0.058, 0.016, 0.098, 0, -0.185, 0.02, 0.2);
  const bolt = pivot(g);
  box(bolt, p.steel, 0.024, 0.024, 0.06, 0.055, 0.06, -0.2);     // charging handle
  return {
    g, muzzle: [0, 0.03, -1.16], flash: 0.5, // suppressed
    parts: { mag, magOut: [0.01, -0.3, -0.08], magRot: [0.5, 0, 0.12], bolt, boltOut: [0, 0, 0.11] },
  };
}

// Vandal: AK-style — slanted brake, gas tube, wood furniture, curved mag, skeleton stock.
function buildVandal(p) {
  const g = new THREE.Group();
  box(g, p.body, 0.09, 0.115, 0.4, 0, 0.02, -0.32);              // receiver
  box(g, p.accent, 0.092, 0.014, 0.3, 0, 0.062, -0.3);           // dust-cover accent line
  box(g, p.steel, 0.02, 0.02, 0.34, 0, 0.075, -0.68);            // gas tube above barrel
  box(g, p.wood, 0.078, 0.08, 0.3, 0, 0.028, -0.66);             // wood handguard
  box(g, p.dark, 0.082, 0.016, 0.3, 0, -0.015, -0.66);           // handguard spacer
  tube(g, p.steel, 0.015, 0.015, 0.26, 0, 0.04, -0.94);          // barrel
  box(g, p.dark, 0.034, 0.034, 0.08, 0, 0.04, -1.04, 0, 0.5, 0); // slanted muzzle brake
  box(g, p.dark, 0.013, 0.055, 0.013, 0, 0.1, -0.88);            // tall front sight post
  box(g, p.dark, 0.04, 0.014, 0.03, 0, 0.075, -0.88);            // front sight base
  box(g, p.dark, 0.036, 0.024, 0.06, 0, 0.086, -0.36);           // tangent rear sight
  box(g, p.steel, 0.02, 0.02, 0.3, 0, 0.045, 0.02, -0.12, 0, 0); // skeleton stock top bar
  box(g, p.steel, 0.02, 0.02, 0.3, 0, -0.045, 0.02, 0.14, 0, 0); // skeleton stock lower bar
  box(g, p.dark, 0.075, 0.13, 0.04, 0, 0.0, 0.17);               // butt pad
  box(g, p.wood, 0.06, 0.16, 0.09, 0, -0.11, -0.2, 0.28);        // wood grip
  box(g, p.dark, 0.02, 0.012, 0.1, 0, -0.05, -0.27);             // trigger guard
  const mag = pivot(g, 0, -0.08, -0.4);                          // curved 3-segment mag
  box(mag, p.dark, 0.055, 0.09, 0.1, 0, -0.035, 0.01, 0.12);
  box(mag, p.dark, 0.055, 0.09, 0.1, 0, -0.11, -0.015, 0.34);
  box(mag, p.dark, 0.055, 0.08, 0.095, 0, -0.175, -0.06, 0.55);
  box(mag, p.accent, 0.058, 0.016, 0.098, 0, -0.215, -0.075, 0.55);
  const bolt = pivot(g);
  box(bolt, p.steel, 0.024, 0.028, 0.06, 0.055, 0.045, -0.24);   // right charging handle
  return {
    g, muzzle: [0, 0.04, -1.09], flash: 1.15,
    parts: { mag, magOut: [0.01, -0.28, -0.12], magRot: [0.65, 0, 0.15], bolt, boltOut: [0, 0, 0.12] },
  };
}

// --- shotgun ----------------------------------------------------------------

// Judge: pump shotgun — tube mag, sliding pump, brass shells fed during reload.
function buildJudge(p) {
  const g = new THREE.Group();
  box(g, p.body, 0.095, 0.13, 0.36, 0, 0, -0.3);                 // receiver
  box(g, p.dark, 0.075, 0.115, 0.3, 0, -0.015, 0.02);            // stock
  box(g, p.dark, 0.08, 0.14, 0.04, 0, -0.03, 0.185);             // butt pad
  tube(g, p.steel, 0.024, 0.024, 0.62, 0, 0.05, -0.76);          // barrel
  tube(g, p.dark, 0.021, 0.021, 0.56, 0, -0.015, -0.72);         // under-barrel tube mag
  const bolt = pivot(g);                                         // the pump — racks on reload
  box(bolt, p.grip, 0.078, 0.075, 0.17, 0, -0.015, -0.56);       // pump sleeve
  box(bolt, p.dark, 0.084, 0.014, 0.17, 0, -0.015, -0.56);       // pump rib
  box(bolt, p.dark, 0.084, 0.075, 0.02, 0, -0.015, -0.63);       // pump front lip
  box(g, p.dark, 0.022, 0.03, 0.05, 0, 0.09, -1.02);             // front sight base
  box(g, p.accent, 0.012, 0.016, 0.012, 0, 0.113, -1.02);        // bead sight
  box(g, p.accent, 0.098, 0.045, 0.014, 0, 0.01, -0.3);          // receiver side accent
  box(g, p.dark, 0.02, 0.05, 0.012, 0, -0.06, -0.16);            // trigger guard
  box(g, p.brass, 0.05, 0.02, 0.2, 0, -0.075, -0.34);            // shell holder w/ brass
  const shell = tube(g, p.brass, 0.013, 0.013, 0.06, 0.07, -0.02, -0.3, 8);
  shell.visible = false;                                         // shown during insert phase
  return {
    g, muzzle: [0, 0.05, -1.09], flash: 1.4,
    parts: { bolt, boltOut: [0, 0, 0.13], shell, shellFrom: [0.09, -0.06, -0.26], shellTo: [0.015, -0.03, -0.33] },
  };
}

// --- snipers ----------------------------------------------------------------

// Marshal: lever-action scout — wood furniture, swinging lever loop, slim scope.
function buildMarshal(p) {
  const g = new THREE.Group();
  box(g, p.body, 0.07, 0.1, 0.42, 0, 0.01, -0.32);               // slim receiver
  box(g, p.wood, 0.068, 0.1, 0.3, 0, -0.005, 0.02);              // wood stock
  box(g, p.dark, 0.072, 0.12, 0.035, 0, -0.015, 0.18);           // butt pad
  box(g, p.wood, 0.062, 0.07, 0.26, 0, 0.02, -0.62);             // wood forend
  tube(g, p.steel, 0.015, 0.015, 0.42, 0, 0.035, -0.95);         // barrel
  tube(g, p.dark, 0.02, 0.02, 0.4, 0, -0.005, -0.72);            // under-barrel tube mag
  box(g, p.dark, 0.012, 0.04, 0.014, 0, 0.085, -1.1);            // front sight
  tube(g, p.dark, 0.026, 0.026, 0.22, 0, 0.115, -0.34);          // slim scope tube
  tube(g, p.dark, 0.036, 0.032, 0.06, 0, 0.115, -0.46);          // objective
  tube(g, p.dark, 0.032, 0.032, 0.05, 0, 0.115, -0.24);          // ocular
  tube(g, p.accent, 0.028, 0.028, 0.008, 0, 0.115, -0.487);      // lens glint
  box(g, p.steel, 0.02, 0.04, 0.026, 0, 0.08, -0.28);            // scope mounts
  box(g, p.steel, 0.02, 0.04, 0.026, 0, 0.08, -0.42);
  box(g, p.brass, 0.072, 0.02, 0.1, 0, 0.062, -0.3);             // brass receiver top plate
  const bolt = pivot(g, 0, -0.045, -0.1);                        // lever loop: swings down
  box(bolt, p.steel, 0.016, 0.05, 0.014, 0, -0.03, 0.012);       // loop rear post
  box(bolt, p.steel, 0.016, 0.014, 0.11, 0, -0.052, -0.04);      // loop bottom
  box(bolt, p.steel, 0.016, 0.05, 0.014, 0, -0.03, -0.09);       // loop front post
  const mag = pivot(g, 0, -0.055, -0.32);
  box(mag, p.dark, 0.048, 0.07, 0.11, 0, -0.03, 0.01, 0.1);      // 5-rnd box mag
  box(mag, p.accent, 0.051, 0.014, 0.114, 0, -0.068, 0.02, 0.1);
  return {
    g, muzzle: [0, 0.035, -1.17], flash: 1.45,
    parts: { mag, magOut: [0.01, -0.24, -0.06], magRot: [0.5, 0, 0.1], bolt, boltOut: [0, -0.01, -0.02], boltRot: [0.85, 0, 0] },
  };
}

// Operator: massive bolt-action — huge scope, vented brake, bipod, big bolt knob.
function buildOperator(p) {
  const g = new THREE.Group();
  box(g, p.body, 0.09, 0.13, 0.55, 0, 0, -0.4);                  // thick receiver
  box(g, p.dark, 0.075, 0.12, 0.32, 0, -0.01, 0.03);             // stock
  box(g, p.dark, 0.062, 0.05, 0.18, 0, 0.075, 0.06);             // tall cheek riser
  box(g, p.dark, 0.08, 0.15, 0.045, 0, -0.02, 0.2);              // butt pad
  tube(g, p.steel, 0.021, 0.026, 0.75, 0, 0.02, -1.02);          // heavy barrel
  box(g, p.dark, 0.05, 0.05, 0.12, 0, 0.02, -1.42);              // big muzzle brake
  box(g, p.accent, 0.056, 0.014, 0.1, 0, 0.02, -1.42);           // brake vent accent
  tube(g, p.dark, 0.04, 0.04, 0.34, 0, 0.15, -0.4);              // huge scope main tube
  tube(g, p.dark, 0.062, 0.052, 0.1, 0, 0.15, -0.6);             // objective bell
  tube(g, p.dark, 0.05, 0.05, 0.08, 0, 0.15, -0.22);             // ocular
  tube(g, p.accent, 0.046, 0.046, 0.01, 0, 0.15, -0.652);        // lens glint
  box(g, p.steel, 0.026, 0.06, 0.032, 0, 0.095, -0.3);           // scope mounts
  box(g, p.steel, 0.026, 0.06, 0.032, 0, 0.095, -0.5);
  box(g, p.steel, 0.014, 0.28, 0.014, -0.04, -0.12, -0.9, -0.35, 0, 0.3);  // folded bipod
  box(g, p.steel, 0.014, 0.28, 0.014, 0.04, -0.12, -0.9, -0.35, 0, -0.3);
  box(g, p.grip, 0.06, 0.17, 0.09, 0, -0.12, -0.16, 0.3);        // grip
  const mag = pivot(g, 0, -0.06, -0.38);
  box(mag, p.dark, 0.055, 0.1, 0.16, 0, -0.045, 0.01, 0.08);     // big box mag
  box(mag, p.accent, 0.058, 0.018, 0.164, 0, -0.098, 0.02, 0.08);
  const bolt = pivot(g, 0, 0.045, -0.2);                         // bolt: lifts + pulls back
  tubeX(bolt, p.steel, 0.012, 0.012, 0.09, 0.05, 0, 0, 8);
  box(bolt, p.dark, 0.034, 0.034, 0.034, 0.1, 0, 0);             // big bolt knob
  return {
    g, muzzle: [0, 0.02, -1.48], flash: 1.7,
    parts: { mag, magOut: [0.01, -0.26, -0.06], magRot: [0.5, 0, 0.1], bolt, boltOut: [0, 0.01, 0.1], boltRot: [0, 0, 0.9] },
  };
}

// --- heavies ----------------------------------------------------------------

// Ares: belt-fed LMG — side belt box with brass links, vented shroud, carry handle.
function buildAres(p) {
  const g = new THREE.Group();
  box(g, p.body, 0.11, 0.15, 0.5, 0, 0, -0.32);                  // receiver
  box(g, p.dark, 0.03, 0.05, 0.03, 0, 0.1, -0.2);                // carry handle posts
  box(g, p.dark, 0.03, 0.05, 0.03, 0, 0.1, -0.44);
  box(g, p.dark, 0.035, 0.03, 0.3, 0, 0.14, -0.32);              // carry handle bar
  tube(g, p.steel, 0.022, 0.022, 0.44, 0, 0.02, -0.8);           // barrel
  tube(g, p.dark, 0.04, 0.04, 0.045, 0, 0.02, -0.64);            // shroud rings
  tube(g, p.dark, 0.04, 0.04, 0.045, 0, 0.02, -0.76);
  tube(g, p.dark, 0.04, 0.04, 0.045, 0, 0.02, -0.88);
  tube(g, p.dark, 0.045, 0.028, 0.07, 0, 0.02, -1.03);           // conical flash hider
  box(g, p.grip, 0.065, 0.16, 0.1, 0, -0.12, -0.06, 0.3);        // rear grip
  box(g, p.grip, 0.055, 0.12, 0.06, 0, -0.115, -0.52, -0.1);     // front grip
  box(g, p.dark, 0.09, 0.13, 0.18, 0, -0.01, 0.05);              // stock block
  box(g, p.accent, 0.014, 0.014, 0.24, 0.056, 0.05, -0.32);      // receiver side stripe
  const mag = pivot(g, -0.07, -0.05, -0.3);                      // belt box hangs left
  box(mag, p.dark, 0.07, 0.15, 0.17, -0.02, -0.09, 0);           // belt box
  box(mag, p.accent, 0.074, 0.012, 0.1, -0.02, -0.015, 0);       // ammo window slit
  box(mag, p.brass, 0.05, 0.016, 0.05, -0.01, 0.015, -0.03, 0, 0, 0.3);  // belt links
  box(mag, p.brass, 0.05, 0.016, 0.05, 0.005, 0.035, 0.01, 0, 0, 0.55);
  const bolt = pivot(g);
  box(bolt, p.steel, 0.026, 0.03, 0.07, 0.065, 0.03, -0.2);      // right charging handle
  return {
    g, muzzle: [0, 0.02, -1.08], flash: 1.5,
    parts: { mag, magOut: [-0.06, -0.26, 0.02], magRot: [0.2, 0, -0.5], bolt, boltOut: [0, 0, 0.13] },
  };
}

// Odin: drum-fed monster — huge drum, boxy vented shroud, massive brake.
function buildOdin(p) {
  const g = new THREE.Group();
  box(g, p.body, 0.13, 0.17, 0.55, 0, 0, -0.33);                 // massive receiver
  box(g, p.dark, 0.05, 0.04, 0.36, 0, 0.13, -0.3);               // top handle/rail
  box(g, p.dark, 0.03, 0.06, 0.03, 0, 0.095, -0.14);
  box(g, p.dark, 0.03, 0.06, 0.03, 0, 0.095, -0.46);
  box(g, p.dark, 0.1, 0.11, 0.42, 0, 0.02, -0.78);               // boxy barrel shroud
  box(g, p.accent, 0.104, 0.016, 0.36, 0, 0.06, -0.78);          // shroud vent slits
  box(g, p.accent, 0.104, 0.016, 0.36, 0, -0.02, -0.78);
  tube(g, p.steel, 0.026, 0.026, 0.3, 0, 0.02, -1.1);            // thick barrel
  box(g, p.dark, 0.07, 0.07, 0.1, 0, 0.02, -1.28);               // massive brake
  box(g, p.accent, 0.076, 0.02, 0.08, 0, 0.02, -1.28);           // brake glow slit
  box(g, p.grip, 0.065, 0.17, 0.1, 0, -0.13, -0.06, 0.3);        // rear grip
  box(g, p.grip, 0.055, 0.13, 0.06, 0, -0.13, -0.56, -0.1);      // front grip
  box(g, p.dark, 0.09, 0.13, 0.18, 0, -0.01, 0.05);              // stock block
  const mag = pivot(g, 0, -0.09, -0.32);                         // big under-drum
  tubeX(mag, p.dark, 0.085, 0.085, 0.11, 0, -0.05, 0);           // 100-rnd drum
  tubeX(mag, p.accent, 0.087, 0.087, 0.016, 0.045, -0.05, 0);    // ammo window ring
  tubeX(mag, p.steel, 0.02, 0.02, 0.13, 0, -0.05, 0);            // drum axle
  const bolt = pivot(g);
  box(bolt, p.steel, 0.03, 0.03, 0.08, 0.075, 0.05, -0.22);      // big charging handle
  return {
    g, muzzle: [0, 0.02, -1.34], flash: 1.7,
    parts: { mag, magOut: [0.02, -0.3, -0.04], magRot: [0.35, 0, 0.15], bolt, boltOut: [0, 0, 0.14] },
  };
}

// --- melee ------------------------------------------------------------------

// Knife: drop-point blade, glowing edge, ring pommel. Animated by the
// two-stage stab/slash swing in update(), no reload parts.
function buildKnife(p) {
  const g = new THREE.Group();
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.lineTo(0.2, 0);
  s.quadraticCurveTo(0.28, 0.006, 0.31, 0.038);
  s.lineTo(0.05, 0.052);
  s.lineTo(0, 0.046);
  s.closePath();
  const bladeGeo = new THREE.ExtrudeGeometry(s, {
    depth: 0.008, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.003, bevelSegments: 1,
  });
  const blade = new THREE.Mesh(bladeGeo, p.steel);
  blade.rotation.y = Math.PI / 2; // shape +X -> -Z (tip forward)
  blade.position.set(-0.004, -0.02, -0.015);
  g.add(blade);
  box(g, p.accent, 0.014, 0.005, 0.18, 0, -0.019, -0.13);        // edge glow accent
  box(g, p.dark, 0.055, 0.05, 0.022, 0, 0, 0);                   // guard
  tube(g, p.grip, 0.016, 0.019, 0.12, 0, -0.005, 0.07, 8);       // grip
  box(g, p.accent, 0.036, 0.006, 0.036, 0, -0.005, 0.035);       // grip wrap accent
  box(g, p.dark, 0.026, 0.03, 0.024, 0, -0.005, 0.14);           // pommel
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.02, 0.005, 6, 12), p.steel);
  ring.rotation.y = Math.PI / 2;
  ring.position.set(0, -0.005, 0.17);
  g.add(ring);
  return { g, muzzle: null, flash: 0, parts: null };
}

// Builders keyed by weapon id; category fallbacks keep unknown ids safe.
const BUILDERS = {
  knife: buildKnife,
  classic: buildClassic, ghost: buildGhost, sheriff: buildSheriff,
  stinger: buildStinger, spectre: buildSpectre,
  bulldog: buildBulldog, phantom: buildPhantom, vandal: buildVandal,
  judge: buildJudge,
  marshal: buildMarshal, operator: buildOperator,
  ares: buildAres, odin: buildOdin,
};
const CAT_BUILDERS = {
  sidearm: buildClassic, smg: buildSpectre, rifle: buildVandal,
  sniper: buildMarshal, shotgun: buildJudge, heavy: buildAres, melee: buildKnife,
};

// ---------------------------------------------------------------- viewmodel
export class Viewmodel {
  constructor(renderer, game) {
    this.r = renderer;
    this.game = game;
    this.group = new THREE.Group();
    this.currentId = null;
    this.currentCat = null;
    this.recoil = 0;
    this.muzzle = null;
    this.muzzleLight = null;
    this.muzzleTimer = 0;
    this.raiseT = 0;
    this.basePos = [0, 0, 0];
    this.baseRot = [0, 0, 0];
    this._parts = null;
    this._flashScale = 1;
    this._kick = 1;         // recoil-stat-driven kick multiplier
    this._kickSide = 0;     // per-shot lateral kick sign
    this._swingAlt = false; // melee: alternate stab / slash
    this._cycleDur = 0;     // per-shot bolt/slide cycle length (0 = none)
    this._cycleT = 0;
    this._airT = 0;         // movement layering state
    this._fallV = 0;
    this._landT = 0;
    this._landAmp = 0;
    this._vyS = 0;
    this._runB = 0;
    this._bobBlend = 0;
    this._mount();
    // clearScene() (called on every loadMatch) wipes the scene, so force a
    // full rebuild whenever a match starts. Mounting itself is re-checked
    // defensively every frame in update() and does not rely on this event.
    bus.on('match:start', () => { this._mount(); this.currentId = null; this.currentCat = null; });
    bus.on('muzzle', () => {
      this.recoil = 1;
      this._swingAlt = !this._swingAlt;             // melee stab/slash alternation
      this._kickSide = Math.random() - 0.5;         // per-shot lateral recoil
      if (this._cycleDur > 0) this._cycleT = this._cycleDur; // slide/bolt cycle
      if (this.muzzle) this.muzzleTimer = FLASH_TIME;
    });
  }

  _mount() {
    // Parent the viewmodel to the main camera and make sure the camera is part
    // of the scene graph so its children are rendered. clearScene() (run on
    // every loadMatch) wipes the scene; this is re-checked every frame in
    // update(). Returns true when the camera had to be re-added — that means
    // the scene was just wiped and the gun's GPU resources were disposed, so
    // the caller must force a rebuild.
    const cam = this.r.camera;
    const remounted = cam.parent !== this.r.scene;
    if (remounted) this.r.scene.add(cam);
    if (this.group.parent !== cam) cam.add(this.group);
    // dedicated light so the gun is well lit regardless of the map palette
    if (!this._light) {
      this._light = new THREE.PointLight(0xffffff, 2.2, 6);
      this._light.position.set(0.3, 0.1, -0.4);
    }
    if (this._light.parent !== cam) cam.add(this._light);
    return remounted;
  }

  _clear() {
    while (this.group.children.length) {
      const c = this.group.children[0];
      this.group.remove(c);
      c.traverse?.((o) => {
        // Sprites share one global geometry in three.js — disposing it would
        // break every other sprite in the scene (e.g. plant-site labels).
        if (o.geometry && !o.isSprite) o.geometry.dispose();
        if (o.material) o.material.dispose();
      });
    }
    this.gun = null;
    this.muzzle = null;
    this.muzzleLight = null;
    this._parts = null;
    this.currentId = null;
    this.currentCat = null;
  }

  build(id, cat) {
    this._clear();
    const p = palette(ACCENTS[id] ?? ACCENTS[cat] ?? 0x43b7c7);
    const builder = BUILDERS[id] || CAT_BUILDERS[cat] || buildVandal;
    const { g, muzzle, flash = 1, parts = null } = builder(p);

    this._flashScale = flash || 1;
    if (muzzle) {
      // muzzle flash sprite (kept from the original implementation), scaled
      // per weapon: bigger/brighter for snipers and heavies, dim for suppressed
      const mflash = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0xffd070, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
      const ms = 0.35 * this._flashScale;
      mflash.scale.set(ms, ms, ms);
      mflash.position.set(muzzle[0], muzzle[1], muzzle[2]);
      g.add(mflash);
      this.muzzle = mflash;
      // brief point light at the muzzle (~40 ms, small radius), driven by
      // the same 'muzzle' event / muzzleTimer as the sprite
      this.muzzleLight = new THREE.PointLight(0xffc36b, 0, 2 + this._flashScale, 2);
      this.muzzleLight.position.set(muzzle[0], muzzle[1], muzzle[2] + 0.05);
      g.add(this.muzzleLight);
    }

    // snapshot rest transforms of animatable parts (plain numbers — the
    // per-frame reload code only ever calls .set(), no allocations)
    this._parts = parts;
    if (parts) {
      if (parts.mag) {
        parts.magRest = [parts.mag.position.x, parts.mag.position.y, parts.mag.position.z,
          parts.mag.rotation.x, parts.mag.rotation.y, parts.mag.rotation.z];
        parts.magOut = parts.magOut || [0, 0, 0];
        parts.magRot = parts.magRot || [0, 0, 0];
      }
      if (parts.bolt) {
        parts.boltRest = [parts.bolt.position.x, parts.bolt.position.y, parts.bolt.position.z,
          parts.bolt.rotation.x, parts.bolt.rotation.y, parts.bolt.rotation.z];
        parts.boltOut = parts.boltOut || [0, 0, 0];
        parts.boltRot = parts.boltRot || [0, 0, 0];
      }
    }

    // per-shot mechanical cycle: pistol slides blow back, revolver hammers
    // recock, sniper bolts / lever loops are worked between shots
    const w = WEAPONS[id];
    this._kick = w ? 0.7 + (w.recoil || 1) * 0.22 : 1;
    this._cycleDur = 0;
    if (parts && parts.bolt && w) {
      if (cat === 'sidearm') this._cycleDur = 0.14;
      else if (!w.auto && (cat === 'sniper' || cat === 'shotgun')) this._cycleDur = 0.5;
    }
    this._cycleT = 0;

    const pose = POSES[id] || POSES[cat] || POSES.rifle;
    g.position.set(pose.pos[0], pose.pos[1], pose.pos[2]);
    g.rotation.set(pose.rot[0], pose.rot[1], pose.rot[2]);
    g.scale.setScalar(pose.scale);
    this.group.add(g);
    this.gun = g;
    this.currentId = id;
    this.currentCat = cat;
    this.basePos = pose.pos;
    this.baseRot = pose.rot;
    this.raiseT = RAISE_TIME; // play the raise animation on every build/switch
  }

  update(dt) {
    const p = this.game.player;
    if (!p) return;
    // Defensive re-mount every frame: clearScene() (loadMatch) removes the
    // camera from the scene and disposes the gun's geometry/materials. Do not
    // rely on 'match:start' event ordering — if the camera had to be
    // re-added, the old gun resources are stale, so force a rebuild too.
    if (this._mount()) this.currentId = null;
    const w = p.alive ? p.weapon() : null;
    if (w && (w.id !== this.currentId || !this.gun)) this.build(w.id, w.cat);
    this.group.visible = !!(p.alive && this.game.state === 'playing' && !this.game.buyOpen && !this.game.scopeActive);
    // replay the raise animation on respawn even if the weapon is unchanged
    if (!p.alive) this._wasDead = true;
    else if (this._wasDead) { this._wasDead = false; this.raiseT = RAISE_TIME; }
    if (!this.gun) return;

    const t = performance.now() / 1000;
    const gun = this.gun;
    const cat = w ? w.cat : this.currentCat;
    const isMelee = cat === 'melee';

    // timers
    this.recoil = Math.max(0, this.recoil - dt * (isMelee ? 5 : 8));
    this.raiseT = Math.max(0, this.raiseT - dt);
    this._cycleT = Math.max(0, this._cycleT - dt);
    const raise = this.raiseT / RAISE_TIME;      // 1 -> 0
    const raiseEase = raise * raise;             // ease-out (fast finish)

    // look sway: the gun lags slightly behind camera yaw/pitch
    if (this._swayRef !== p) { this._swayRef = p; this._swayYaw = p.yaw; this._swayPitch = p.pitch; }
    const sk = 1 - Math.exp(-dt * 12);
    this._swayYaw += (p.yaw - this._swayYaw) * sk;
    this._swayPitch += (p.pitch - this._swayPitch) * sk;
    const swayYaw = THREE.MathUtils.clamp(p.yaw - this._swayYaw, -0.4, 0.4);
    const swayPitch = THREE.MathUtils.clamp(p.pitch - this._swayPitch, -0.4, 0.4);

    // ------------------------------------------------------ movement layering
    const sp2 = p.vel.x * p.vel.x + p.vel.z * p.vel.z;
    const grounded = !!p._onGround;
    // landing dip: fires on the airborne -> grounded transition, scaled by
    // how fast the player was falling
    if (!grounded) {
      this._airT += dt;
      if (-p.vel.y > this._fallV) this._fallV = -p.vel.y;
    } else {
      if (this._airT > 0.12) {
        this._landT = 1;
        this._landAmp = 0.35 + Math.min(1, this._fallV / 9) * 0.65;
      }
      this._airT = 0;
      this._fallV = 0;
    }
    this._landT = Math.max(0, this._landT - dt / 0.32);
    const land = this._landT > 0 ? Math.sin((1 - this._landT) * Math.PI) * this._landAmp : 0;
    // vertical inertia: the gun lags on jumps and floats while falling
    this._vyS += (p.vel.y - this._vyS) * Math.min(1, dt * 8);
    const vy = THREE.MathUtils.clamp(this._vyS, -7, 7);
    // sprint lower: gently drop/cant the gun at full run speed
    const runT = sp2 > 14 ? Math.min(1, (Math.sqrt(sp2) - 3.5) * 0.4) : 0;
    this._runB += (runT - this._runB) * Math.min(1, dt * 5);

    // movement bob (smoothly blended in/out, slightly stronger at a run)
    const moving = sp2 > 1 && grounded;
    this._bobBlend += ((moving ? 1 : 0) - this._bobBlend) * Math.min(1, dt * 8);
    const bobAmp = 0.008 * this._bobBlend * (1 + this._runB * 0.5);
    const bobX = Math.sin(t * 10) * bobAmp;
    const bobY = Math.abs(Math.cos(t * 10)) * bobAmp;
    // idle breathing
    const idleY = Math.sin(t * 1.6) * 0.0025;

    // -------------------------------------------------- reload choreography
    // Three phases inside the exact 2.0 s window (driven from reloadUntil, no
    // timers): mag-out tilt (0-0.6 s), insert + seat slap (0.6-1.4 s),
    // charging-handle rack with the visible bolt part (1.4-2.0 s).
    let magF = 0;      // 0 = seated, 1 = fully dropped
    let rackF = 0;     // 0 = forward, 1 = fully pulled
    let dip = 0;       // whole-gun tilt toward the magwell
    let seat = 0;      // palm-slap bump when the mag seats
    let rackPose = 0;  // roll the gun toward the charging handle
    let insertU = -1;  // insert-phase progress (for shell feeding)
    const remain = p.reloadUntil - this.game.now;
    if (!isMelee && remain > 0 && remain <= RELOAD_DURATION) {
      const prog = 1 - remain / RELOAD_DURATION; // 0 -> 1 over exactly 2.0 s
      if (prog < PH_MAG_OUT) {
        magF = smooth01(prog / PH_MAG_OUT);
      } else if (prog < PH_MAG_IN) {
        insertU = (prog - PH_MAG_OUT) / (PH_MAG_IN - PH_MAG_OUT);
        magF = 1 - smooth01(insertU); // eases back in, seats at 1.4 s
      } else {
        const u = (prog - PH_MAG_IN) / (1 - PH_MAG_IN);
        // pull back, then slam forward — both complete before prog hits 1
        rackF = u < 0.55 ? smooth01(u / 0.55) : 1 - smooth01((u - 0.55) / 0.35);
      }
      seat = bell(prog, 0.71, 0.06);
      dip = smooth01(prog / 0.12) * (1 - smooth01((prog - 0.68) / 0.25));
      rackPose = bell(prog, 0.85, 0.18);
    }

    // per-shot mechanical cycle (pistol slide blowback, bolt/pump work)
    if (this._cycleT > 0) {
      const cyc = Math.sin((1 - this._cycleT / this._cycleDur) * Math.PI);
      if (cyc > rackF) rackF = cyc;
    }

    // drive the animatable parts (rest snapshot + offset x factor; .set only)
    const parts = this._parts;
    if (parts) {
      if (parts.mag) {
        const r = parts.magRest, o = parts.magOut, q = parts.magRot;
        parts.mag.position.set(r[0] + o[0] * magF, r[1] + o[1] * magF, r[2] + o[2] * magF);
        parts.mag.rotation.set(r[3] + q[0] * magF, r[4] + q[1] * magF, r[5] + q[2] * magF);
      }
      if (parts.bolt) {
        const r = parts.boltRest, o = parts.boltOut, q = parts.boltRot;
        parts.bolt.position.set(r[0] + o[0] * rackF, r[1] + o[1] * rackF, r[2] + o[2] * rackF);
        parts.bolt.rotation.set(r[3] + q[0] * rackF, r[4] + q[1] * rackF, r[5] + q[2] * rackF);
      }
      if (parts.shell) {
        const vis = insertU >= 0 && insertU <= 1;
        parts.shell.visible = vis;
        if (vis) {
          // feed two shells during the insert window
          let su = insertU * 2;
          su = smooth01(su - Math.floor(su));
          const a = parts.shellFrom, b = parts.shellTo;
          parts.shell.position.set(a[0] + (b[0] - a[0]) * su, a[1] + (b[1] - a[1]) * su, a[2] + (b[2] - a[2]) * su);
        }
      }
    }

    // ------------------------------------------------------------ compose
    // pose = base + sway + bob + breathing + landing + sprint + reload + raise
    const [bx, by, bz] = this.basePos;
    const [brx, bry, brz] = this.baseRot;
    let px = bx + bobX - swayYaw * 0.05 + dip * 0.015 - rackPose * 0.02 + this._runB * 0.01;
    let py = by + bobY + idleY - swayPitch * 0.02
      - dip * 0.11 + seat * 0.02 - raiseEase * 0.24
      - land * 0.05 - vy * 0.004 - this._runB * 0.03;
    let pz = bz;
    let rx = brx + swayPitch * 0.3 - dip * 0.45 + seat * 0.1 + rackPose * 0.12
      - raiseEase * 0.7 - land * 0.1 - this._runB * 0.06;
    let ry = bry + swayYaw * 0.35 - rackPose * 0.28 + this._runB * 0.08;
    let rz = brz + dip * 0.35 + land * 0.04 + this._runB * 0.06;

    if (isMelee) {
      // two-stage swing alternation driven by the recoil impulse:
      // stab (forward thrust) then slash (diagonal sweep across the screen)
      const k = this.recoil;                 // 1 -> 0 over ~0.2 s
      const env = Math.sin(k * Math.PI);     // wind-up -> extend -> recover
      if (this._swingAlt) {
        // stab: lunge straight out with a slight twist
        pz -= env * 0.3;
        py += env * 0.045;
        rx -= env * 0.35;
        ry += env * 0.3;
        rz += env * 0.25;
      } else {
        // slash: blade sweeps right-to-left through the view (biased so the
        // arc reads as a diagonal cut, not a symmetric wobble)
        const c = k * 2 - 1;                 // +1 -> -1 across the swing
        px += c * env * 0.12;
        py += env * 0.05;
        pz -= env * 0.2;
        rx -= env * 0.3;
        ry += (c * 0.9 - 0.3) * env;
        rz -= (c * 1.1 - 0.25) * env;
      }
    } else {
      // gun recoil: kick back toward the camera and pitch the muzzle up,
      // scaled by the weapon's recoil stat, with per-shot lateral variance
      const kk = this.recoil * this._kick;
      pz += kk * 0.085;
      py -= kk * 0.018;
      rx += kk * 0.14;
      ry += kk * this._kickSide * 0.06;
      rz += kk * this._kickSide * 0.12;
    }

    gun.position.set(px, py, pz);
    gun.rotation.set(rx, ry, rz);

    // muzzle flash sprite + brief point light (per-weapon size/intensity)
    this.muzzleTimer = Math.max(0, this.muzzleTimer - dt);
    const flash = this.muzzleTimer > 0 ? this.muzzleTimer / FLASH_TIME : 0;
    if (this.muzzle) {
      this.muzzle.material.opacity = flash > 0 ? 0.9 : 0;
      this.muzzle.material.rotation = Math.random() * Math.PI;
      const fs = (0.3 + Math.random() * 0.15) * this._flashScale;
      this.muzzle.scale.set(fs, fs, fs);
    }
    if (this.muzzleLight) this.muzzleLight.intensity = flash * 14 * this._flashScale;
  }
}
