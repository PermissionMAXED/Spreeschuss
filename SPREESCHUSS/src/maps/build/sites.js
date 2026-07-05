import * as THREE from 'three';
import { glowTexture, letterTexture } from '../../engine/textures.js';

// =====================================================================
// FROZEN INTERFACE — plant-site presentation (NO colliders).
//
//   addSiteMarkers(group, map) -> sites
//     Adds every plant-site marker (crisp double ring + soft additive
//     glow disc + faint light shaft + floating glowing letter sprite)
//     and returns the sites object of the frozen buildMap contract:
//       { key: { center: THREE.Vector3(x, 0.02, z), radius, ring } }
//     `ring` is the main ring mesh (game code pulses it during plants).
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

// Returns the main ring mesh (kept as the `ring` key of the site).
function addSiteMarker(group, key, center, radius, pal) {
  const accent = new THREE.Color(pal.accent);

  const glowDisc = new THREE.Mesh(
    new THREE.CircleGeometry(radius * 0.96, 48),
    new THREE.MeshBasicMaterial({
      map: glowTexture(), color: accent, transparent: true, opacity: 0.4,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    }),
  );
  glowDisc.rotation.x = -Math.PI / 2;
  glowDisc.position.set(center.x, 0.015, center.z);
  group.add(glowDisc);

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(radius - 0.3, radius, 64),
    new THREE.MeshBasicMaterial({ color: accent, side: THREE.DoubleSide, transparent: true, opacity: 0.95 }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.copy(center);
  group.add(ring);

  const innerRing = new THREE.Mesh(
    new THREE.RingGeometry(radius - 1.0, radius - 0.84, 48),
    new THREE.MeshBasicMaterial({ color: accent, side: THREE.DoubleSide, transparent: true, opacity: 0.45 }),
  );
  innerRing.rotation.x = -Math.PI / 2;
  innerRing.position.set(center.x, 0.03, center.z);
  group.add(innerRing);

  // faint vertical light shaft up to the letter
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.32, 0.85, 3.0, 12, 1, true),
    new THREE.MeshBasicMaterial({
      color: accent, transparent: true, opacity: 0.14, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    }),
  );
  beam.position.set(center.x, 1.55, center.z);
  group.add(beam);

  const lbl = makeSiteLabel(key, pal.accent);
  lbl.position.set(center.x, 3.4, center.z);
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
