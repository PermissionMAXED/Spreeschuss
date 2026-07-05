import * as THREE from 'three';
import { surfaceTexture, glowTexture } from '../../engine/textures.js';
import { paletteKey, placedBox, mergeInto } from './util.js';

// =====================================================================
// FROZEN INTERFACE — out-of-bounds skyline decoration (NO colliders).
//
//   addSkyline(group, w, d, palette, rand)
//     Silhouette architecture OUTSIDE the perimeter walls: facade towers
//     with lit windows, corner pillars, antenna masts and simple cranes.
//     Players can never reach these, so none of it has colliders and
//     rotation is allowed. Deterministic from `rand` (the shared
//     map-seeded PRNG) — this module is the first `rand` consumer in the
//     build pipeline, so earlier stages must not draw from it.
//
// This module owns the skyline half of the theme table: silhouette
// style ('city' | 'slabs' | 'shards') and crane count per palette.
// =====================================================================

// Skyline identity per palette (keyed by util.paletteKey).
const SKYLINES = {
  Spree: { skyline: 'city', cranes: 2 },
  Sand: { skyline: 'slabs', cranes: 0 },
  Neon: { skyline: 'city', cranes: 1 },
  Ice: { skyline: 'shards', cranes: 0 },
  Ruins: { skyline: 'slabs', cranes: 1 },
  Toxic: { skyline: 'city', cranes: 1 },
  Crimson: { skyline: 'city', cranes: 1 },
};

// All geometry merges into 4 meshes (facades / dark / accent caps / tip
// lights) + a handful of glow sprites, keeping draw calls low.
export function addSkyline(group, w, d, palette, rand) {
  const pal = palette;
  const theme = SKYLINES[paletteKey(pal)];
  const deco = new THREE.Group();
  deco.name = 'skyline';
  group.add(deco);

  // Lambert materials: skyline is distant silhouette fill, PBR would only
  // cost fragment work (esp. with scene.environment set) with no visible gain
  const facadeSurf = surfaceTexture('facade', pal.wall, pal.accent, { density: theme.skyline === 'city' ? 0.42 : 0.14 });
  const facadeMat = new THREE.MeshLambertMaterial({
    map: facadeSurf.map,
    emissiveMap: facadeSurf.map,
    emissive: new THREE.Color('#ffffff'),
    emissiveIntensity: 0.5,
  });
  const darkMat = new THREE.MeshLambertMaterial({
    color: new THREE.Color(pal.fog ?? pal.skyBottom).multiplyScalar(0.5),
  });
  const capMat = new THREE.MeshLambertMaterial({
    color: new THREE.Color(pal.accent).multiplyScalar(0.6),
    emissive: new THREE.Color(pal.accent),
    emissiveIntensity: 1.2,
  });
  const tipMat = new THREE.MeshBasicMaterial({ color: 0xff4444 });

  const facadeGeos = [];
  const darkGeos = [];
  const capGeos = [];
  const tipGeos = [];
  const glowSpots = [];
  const tip = (x, y, z, r = 0.32) => {
    const g = new THREE.SphereGeometry(r, 6, 6);
    g.translate(x, y, z);
    tipGeos.push(g);
    glowSpots.push([x, y, z]);
  };

  // ring of towers/slabs/shards around all 4 sides
  const sides = [
    { axis: 'z', sign: -1 }, { axis: 'z', sign: 1 },
    { axis: 'x', sign: -1 }, { axis: 'x', sign: 1 },
  ];
  for (const side of sides) {
    const len = side.axis === 'z' ? w : d;
    const count = Math.max(4, Math.round(len / 14));
    for (let i = 0; i < count; i++) {
      const along = -len / 2 + (i + 0.35 + rand() * 0.3) * (len / count);
      const away = (side.axis === 'z' ? d / 2 : w / 2) + 7 + rand() * 20;
      const bw = 5 + rand() * 8;
      const bh = theme.skyline === 'shards' ? 10 + rand() * 16 : 7 + rand() * rand() * 24;
      const x = side.axis === 'z' ? along : side.sign * away;
      const z = side.axis === 'z' ? side.sign * away : along;
      if (theme.skyline === 'shards') {
        const g = new THREE.ConeGeometry(0.5, 1, 5);
        g.scale(bw, bh, bw);
        g.rotateZ((rand() - 0.5) * 0.22);
        g.rotateY((rand() - 0.5) * 0.5);
        g.translate(x, bh / 2 - 0.6, z);
        darkGeos.push(g);
      } else {
        const g = placedBox(bw, bh, 4 + rand() * 6, 0, 0, 0, (rand() - 0.5) * 0.5);
        g.translate(x, bh / 2 - 0.6, z);
        (theme.skyline === 'slabs' && rand() > 0.4 ? darkGeos : facadeGeos).push(g);
      }
      // red aviation tip light on the tallest towers
      if (bh > 22 && theme.skyline !== 'shards') tip(x, bh - 0.4, z, 0.35);
    }
  }

  // glowing corner pillars just outside the arena corners
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const px = sx * (w / 2 + 1.6);
      const pz = sz * (d / 2 + 1.6);
      darkGeos.push(placedBox(1.4, 9, 1.4, px, 4.0, pz));
      capGeos.push(placedBox(1.5, 0.5, 1.5, px, 8.8, pz));
    }
  }

  // antenna masts
  for (let i = 0; i < 2; i++) {
    const sx = rand() > 0.5 ? 1 : -1;
    const sz = rand() > 0.5 ? 1 : -1;
    const px = sx * (w / 2 + 12 + rand() * 14);
    const pz = sz * (d / 2 + 12 + rand() * 14);
    const h2 = 24 + rand() * 12;
    const mast = new THREE.CylinderGeometry(0.22, 0.55, h2, 6);
    mast.translate(px, h2 / 2 - 0.5, pz);
    darkGeos.push(mast);
    for (const fy of [0.55, 0.8]) {
      darkGeos.push(placedBox(3.2, 0.18, 0.18, px, h2 * fy, pz, rand() * Math.PI));
    }
    tip(px, h2 - 0.2, pz, 0.3);
  }

  // construction cranes (Berlin!) for the urban themes
  for (let i = 0; i < (theme.cranes || 0); i++) {
    const ch = 18 + rand() * 8;
    const jib = 12 + rand() * 6;
    const yaw = rand() * Math.PI * 2;
    const sx = rand() > 0.5 ? 1 : -1;
    const sz = rand() > 0.5 ? 1 : -1;
    const cx = sx * (w / 2 + 10 + rand() * 16);
    const cz = sz * (d / 2 + 10 + rand() * 16);
    const parts = [
      placedBox(0.9, ch, 0.9, 0, ch / 2, 0),                       // mast
      placedBox(jib, 0.6, 0.7, jib / 2 - 2.5, ch + 0.3, 0),        // jib arm
      placedBox(1.6, 1.2, 1.2, -3.4, ch + 0.3, 0),                 // counterweight
    ];
    const cableLen = 6 + rand() * 6;
    parts.push(placedBox(0.08, cableLen, 0.08, jib - 4, ch - cableLen / 2 + 0.3, 0));
    for (const g of parts) {
      g.rotateY(yaw);
      g.translate(cx, -0.5, cz);
      darkGeos.push(g);
    }
    const tx = jib - 2.5;
    tip(cx + Math.cos(yaw) * tx, ch - 0.2, cz - Math.sin(yaw) * tx, 0.28);
  }

  mergeInto(deco, facadeGeos, facadeMat);
  mergeInto(deco, darkGeos, darkMat);
  mergeInto(deco, capGeos, capMat);
  mergeInto(deco, tipGeos, tipMat);

  // one shared additive glow sprite material for all tip lights
  if (glowSpots.length) {
    const gm = new THREE.SpriteMaterial({
      map: glowTexture(), color: new THREE.Color('#ff5544'),
      transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    });
    for (const [x, y, z] of glowSpots.slice(0, 10)) {
      const sp = new THREE.Sprite(gm);
      sp.scale.set(2.3, 2.3, 2.3);
      sp.position.set(x, y, z);
      deco.add(sp);
    }
  }
}
