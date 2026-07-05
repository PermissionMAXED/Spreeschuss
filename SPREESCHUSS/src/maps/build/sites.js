import * as THREE from 'three';
import { glowTexture, letterTexture } from '../../engine/textures.js';
import { mergeInto } from './util.js';

// =====================================================================
// FROZEN INTERFACE — plant-site presentation (NO colliders).
//
//   addSiteMarkers(group, map) -> sites
//     Adds every plant-site marker and returns the sites object of the
//     frozen buildMap contract:
//       { key: { center: THREE.Vector3(x, 0.02, z), radius, ring } }
//     `ring` is the main ring mesh (game code pulses it during plants).
//
// Marker composition (everything flat/no-collider, ground pieces at
// y <= 0.04; static geometry only — no per-frame hooks):
//   - soft additive glow disc under the whole site;
//   - layered double ring (outer hairline + main ring + inner hairline)
//     with a bezel of tick marks — A and B get different tick
//     patterning (long singles vs paired dashes) for instant reads;
//   - radial chevron decals on the diagonals pointing into the site;
//   - "threshold" dash pairs where the ring meets the lane approaches
//     (attacker -z / defender +z);
//   - a tall subtle light shaft, a halo sprite and the floating letter.
// Ticks/chevrons/thresholds merge into ONE mesh per site (one draw
// call); sprites share three.js' global Sprite geometry — never
// disposed here (clearScene() handles materials/textures).
// =====================================================================

export function addSiteMarkers(group, map) {
  const sites = {};
  for (const key of Object.keys(map.sites || {})) {
    const s = map.sites[key];
    const center = new THREE.Vector3(s.center[0], 0.02, s.center[1]);
    const ring = addSiteMarker(group, key, center, s.radius, map.palette);
    sites[key] = { center, radius: s.radius, ring };
  }
  return sites;
}

// Flat decal bar lying on the floor: length along local X, width along Z,
// rotated by rotY around Y, then placed at (x, y, z). Pushed into `geos`
// for merging into a single mesh per site.
function flatBar(geos, len, wid, x, y, z, rotY) {
  const g = new THREE.PlaneGeometry(len, wid);
  g.rotateX(-Math.PI / 2);
  if (rotY) g.rotateY(rotY);
  g.translate(x, y, z);
  geos.push(g);
}

// Returns the main ring mesh (kept as the `ring` key of the site).
function addSiteMarker(group, key, center, radius, pal) {
  const accent = new THREE.Color(pal.accent);
  const accentHot = accent.clone().lerp(new THREE.Color('#ffffff'), 0.22);

  // --- soft glow pool under the site ---------------------------------------
  const glowDisc = new THREE.Mesh(
    new THREE.CircleGeometry(radius * 0.94, 48),
    new THREE.MeshBasicMaterial({
      map: glowTexture(), color: accent, transparent: true, opacity: 0.34,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    }),
  );
  glowDisc.rotation.x = -Math.PI / 2;
  glowDisc.position.set(center.x, 0.012, center.z);
  group.add(glowDisc);

  // --- layered double ring ---------------------------------------------------
  const outerRing = new THREE.Mesh(
    new THREE.RingGeometry(radius + 0.26, radius + 0.4, 96),
    new THREE.MeshBasicMaterial({ color: accent, side: THREE.DoubleSide, transparent: true, opacity: 0.5, depthWrite: false }),
  );
  outerRing.rotation.x = -Math.PI / 2;
  outerRing.position.set(center.x, 0.016, center.z);
  group.add(outerRing);

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(radius - 0.3, radius, 96),
    new THREE.MeshBasicMaterial({ color: accent, side: THREE.DoubleSide, transparent: true, opacity: 0.95 }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.copy(center); // y = 0.02, frozen contract
  group.add(ring);

  const innerRing = new THREE.Mesh(
    new THREE.RingGeometry(radius - 1.0, radius - 0.86, 64),
    new THREE.MeshBasicMaterial({ color: accent, side: THREE.DoubleSide, transparent: true, opacity: 0.4, depthWrite: false }),
  );
  innerRing.rotation.x = -Math.PI / 2;
  innerRing.position.set(center.x, 0.024, center.z);
  group.add(innerRing);

  // --- ticks + chevrons + thresholds (one merged mesh) ----------------------
  const deco = [];

  // Tick bezel between the inner hairline and the main ring. A/B read
  // differently at a glance: pattern 1 = 12 long single ticks (30° steps),
  // pattern 0 = 8 paired short dashes (45° steps).
  const pattern = key.charCodeAt(0) % 2;
  const tickR = radius - 0.58;
  if (pattern === 1) {
    for (let i = 0; i < 12; i++) {
      const t = (i / 12) * Math.PI * 2;
      flatBar(deco, 0.5, 0.14, center.x + Math.cos(t) * tickR, 0.028, center.z + Math.sin(t) * tickR, -t);
    }
  } else {
    for (let i = 0; i < 8; i++) {
      const t = (i / 8) * Math.PI * 2;
      for (const dt of [-0.096, 0.096]) {
        flatBar(deco, 0.38, 0.12, center.x + Math.cos(t + dt) * tickR, 0.028, center.z + Math.sin(t + dt) * tickR, -(t + dt));
      }
    }
  }

  // Radial chevrons on the diagonals, apex pointing into the site.
  const spread = 0.66; // rad between each arm and the outward radial
  const armLen = 1.0;
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i / 4) * Math.PI * 2;
    const ax = center.x + Math.cos(a) * (radius + 0.95);
    const az = center.z + Math.sin(a) * (radius + 0.95);
    for (const k of [-1, 1]) {
      const psi = a + k * spread;
      flatBar(deco, armLen, 0.2,
        ax + Math.cos(psi) * (armLen / 2), 0.03, az + Math.sin(psi) * (armLen / 2), -psi);
    }
  }

  // Threshold dash pairs where the ring meets the lane approaches (plant
  // maps run attackers -z -> defenders +z), a "gate" on each side.
  for (const s of [-1, 1]) {
    const tz = center.z + s * (radius + 1.7);
    for (const sx of [-1, 1]) {
      flatBar(deco, 1.9, 0.16, center.x + sx * 1.25, 0.026, tz, 0);
    }
  }

  mergeInto(group, deco, new THREE.MeshBasicMaterial({
    color: accentHot, side: THREE.DoubleSide, transparent: true, opacity: 0.8, depthWrite: false,
  }));

  // --- tall subtle light shaft up past the letter ----------------------------
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.26, 0.95, 4.6, 16, 1, true),
    new THREE.MeshBasicMaterial({
      color: accent, transparent: true, opacity: 0.11, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    }),
  );
  beam.position.set(center.x, 2.3, center.z);
  group.add(beam);

  // --- halo + floating letter -------------------------------------------------
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexture(), color: accent, transparent: true, opacity: 0.42,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  }));
  halo.scale.set(4.8, 4.8, 4.8);
  halo.position.set(center.x, 3.4, center.z);
  halo.renderOrder = 1; // behind the letter (same position)
  group.add(halo);

  const lbl = makeSiteLabel(key, pal.accent);
  lbl.position.set(center.x, 3.4, center.z);
  lbl.renderOrder = 2;
  group.add(lbl);

  return ring;
}

function makeSiteLabel(letter, accentHex) {
  const mat = new THREE.SpriteMaterial({
    map: letterTexture(letter, accentHex),
    transparent: true,
    depthWrite: false,
  });
  const sp = new THREE.Sprite(mat);
  sp.scale.set(2.7, 2.7, 2.7);
  return sp;
}
