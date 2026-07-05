import * as THREE from 'three';
import { surfaceTexture, glowTexture } from '../../engine/textures.js';
import { paletteKey, placedBox, mergeInto } from './util.js';

// =====================================================================
// FROZEN INTERFACE — out-of-bounds skyline decoration (NO colliders).
//
//   addSkyline(group, w, d, palette, rand)
//     Everything OUTSIDE the perimeter walls: two depth rings of
//     buildings (near ring with lit facades, setbacks and rooftop
//     clutter; far ring of dark slabs for parallax), a per-palette
//     landmark (dome / minaret / spire / glacier / broken tower /
//     cooling tower / chimney stacks), antenna masts, construction
//     cranes, corner obelisks, and — for Spree — a distant bridge.
//     Players can never reach these, so none of it has colliders and
//     rotation is allowed. Deterministic from `rand` (the shared
//     map-seeded PRNG) — this module is the first `rand` consumer in
//     the build pipeline, so earlier stages must not draw from it.
//
// Budget: everything merges into 5 meshes (facades / near dark / far
// slabs / accent caps / tip bulbs) and at most 10 glow sprites. The
// tip() helper enforces the sprite cap; landmark, masts and cranes are
// built FIRST so they win the aviation-light budget.
// =====================================================================

// Skyline identity per palette (keyed by util.paletteKey).
const SKYLINES = {
  Spree: { style: 'city', cranes: 3, winDensity: 0.45, landmark: 'dome', bridge: true },
  Sand: { style: 'slabs', cranes: 0, winDensity: 0.1, landmark: 'minaret', bridge: false },
  Neon: { style: 'city', cranes: 2, winDensity: 0.62, landmark: 'spire', bridge: false },
  Ice: { style: 'shards', cranes: 0, winDensity: 0.16, landmark: 'glacier', bridge: false },
  Ruins: { style: 'slabs', cranes: 2, winDensity: 0.12, landmark: 'broken', bridge: false },
  Toxic: { style: 'city', cranes: 2, winDensity: 0.26, landmark: 'cooling', bridge: false },
  Crimson: { style: 'city', cranes: 2, winDensity: 0.34, landmark: 'stacks', bridge: false },
};

export function addSkyline(group, w, d, palette, rand) {
  const pal = palette;
  const theme = SKYLINES[paletteKey(pal)];
  const deco = new THREE.Group();
  deco.name = 'skyline';
  group.add(deco);

  // Lambert materials: skyline is distant silhouette fill, PBR would only
  // cost fragment work (esp. with scene.environment set) with no visible gain
  const facadeSurf = surfaceTexture('facade', pal.wall, pal.accent, { density: theme.winDensity });
  const facadeMat = new THREE.MeshLambertMaterial({
    map: facadeSurf.map,
    emissiveMap: facadeSurf.map,
    emissive: new THREE.Color('#ffffff'),
    emissiveIntensity: 0.55,
  });
  const fogCol = new THREE.Color(pal.fog ?? pal.skyBottom);
  const darkMat = new THREE.MeshLambertMaterial({ color: fogCol.clone().multiplyScalar(0.42) });
  // far ring sits deep in the scene fog, so it fades toward pal.fog on its own
  const farMat = new THREE.MeshLambertMaterial({ color: fogCol.clone().multiplyScalar(0.55) });
  const capMat = new THREE.MeshLambertMaterial({
    color: new THREE.Color(pal.accent).multiplyScalar(0.6),
    emissive: new THREE.Color(pal.accent),
    emissiveIntensity: 1.25,
  });
  const tipMat = new THREE.MeshBasicMaterial({ color: 0xff4444 });

  const facadeGeos = [];
  const darkGeos = [];
  const farGeos = [];
  const capGeos = [];
  const tipGeos = [];
  const glowSpots = [];
  // red aviation bulb + glow sprite; the 10-sprite budget caps both
  const tip = (x, y, z, r = 0.3) => {
    if (glowSpots.length >= 10) return;
    const g = new THREE.SphereGeometry(r, 6, 6);
    g.translate(x, y, z);
    tipGeos.push(g);
    glowSpots.push([x, y, z]);
  };

  const sides = [
    { axis: 'z', sign: -1 }, { axis: 'z', sign: 1 },
    { axis: 'x', sign: -1 }, { axis: 'x', sign: 1 },
  ];
  const post = (side, along, away) => (side.axis === 'z'
    ? [along, side.sign * (d / 2 + away)]
    : [side.sign * (w / 2 + away), along]);
  // rotate a local (ox, oz) offset by yaw (matches BoxGeometry.rotateY)
  const rot = (ox, oz, yaw) => [ox * Math.cos(yaw) + oz * Math.sin(yaw), -ox * Math.sin(yaw) + oz * Math.cos(yaw)];
  const cyl = (rt, rb, h, x, y, z, seg = 8) => {
    const g = new THREE.CylinderGeometry(rt, rb, h, seg);
    g.translate(x, y, z);
    return g;
  };
  const pickSpot = (minAway, maxAway) => {
    const side = sides[Math.floor(rand() * 4)];
    const len = side.axis === 'z' ? w : d;
    return post(side, (rand() - 0.5) * len * 0.7, minAway + rand() * (maxAway - minAway));
  };

  // ---------------------------------------------------------- landmark
  // Built first (with masts/cranes) so they win the sprite budget.
  const [lx, lz] = pickSpot(13, 25);
  const lyaw = rand() * Math.PI * 2;
  if (theme.landmark === 'dome') {
    // cathedral: lit nave, cornice, glowing drum ring, dome + lantern,
    // four corner towers with small domes (Berliner Dom silhouette)
    facadeGeos.push(placedBox(11, 9, 9, lx, 4.1, lz, lyaw));
    darkGeos.push(placedBox(11.8, 0.6, 9.8, lx, 8.9, lz, lyaw));
    capGeos.push(cyl(3.75, 3.75, 0.3, lx, 9.35, lz, 10));
    darkGeos.push(cyl(3.4, 3.7, 2.6, lx, 10.8, lz, 10));
    const domeG = new THREE.SphereGeometry(3.6, 10, 8);
    domeG.translate(lx, 12.2, lz);
    darkGeos.push(domeG);
    darkGeos.push(cyl(0.55, 0.8, 1.6, lx, 16.2, lz, 6));
    for (const [ox, oz] of [[-4.6, -3.6], [4.6, -3.6], [-4.6, 3.6], [4.6, 3.6]]) {
      const [rx, rz] = rot(ox, oz, lyaw);
      darkGeos.push(placedBox(1.9, 12.5, 1.9, lx + rx, 5.7, lz + rz, lyaw));
      const s = new THREE.SphereGeometry(1.1, 8, 6);
      s.translate(lx + rx, 12.5, lz + rz);
      darkGeos.push(s);
    }
  } else if (theme.landmark === 'minaret') {
    darkGeos.push(cyl(0.9, 1.3, 23, lx, 11, lz, 8));
    darkGeos.push(cyl(2.0, 2.0, 0.9, lx, 17.5, lz, 8));
    capGeos.push(cyl(1.15, 1.15, 0.4, lx, 18.3, lz, 8));
    const cone = new THREE.ConeGeometry(1.35, 3.2, 8);
    cone.translate(lx, 24.1, lz);
    darkGeos.push(cone);
    const [hx, hz] = rot(7.5, 0, lyaw);
    facadeGeos.push(placedBox(9, 4.5, 9, lx + hx, 2, lz + hz, lyaw));
    const dome2 = new THREE.SphereGeometry(3.4, 10, 8);
    dome2.translate(lx + hx, 4.6, lz + hz);
    darkGeos.push(dome2);
  } else if (theme.landmark === 'spire') {
    facadeGeos.push(placedBox(10, 16, 10, lx, 7.6, lz, lyaw));
    facadeGeos.push(placedBox(7, 12, 7, lx, 21.4, lz, lyaw));
    darkGeos.push(placedBox(4.4, 9, 4.4, lx, 31.7, lz, lyaw));
    darkGeos.push(cyl(0.16, 0.4, 9, lx, 40.5, lz, 6));
    for (const [ry, rs] of [[15.8, 10.5], [27.6, 7.5], [36.4, 4.9]]) {
      capGeos.push(placedBox(rs, 0.28, rs, lx, ry, lz, lyaw));
    }
    tip(lx, 45.2, lz, 0.34);
  } else if (theme.landmark === 'glacier') {
    for (let i = 0; i < 4; i++) {
      const gh = 15 + rand() * 16;
      const cone = new THREE.ConeGeometry(4.5 + rand() * 3.5, gh, 5);
      cone.rotateZ((rand() - 0.5) * 0.2);
      cone.rotateY(rand() * Math.PI);
      cone.translate(lx + (rand() - 0.5) * 14, gh / 2 - 1, lz + (rand() - 0.5) * 14);
      darkGeos.push(cone);
    }
  } else if (theme.landmark === 'broken') {
    darkGeos.push(placedBox(5.5, 16, 5.5, lx, 7.5, lz, lyaw));
    const chunk = placedBox(5, 5.5, 5, 0, 0, 0, lyaw);
    chunk.rotateZ(0.35);
    chunk.translate(lx + 1.6, 18.2, lz);
    darkGeos.push(chunk);
    const rubble = new THREE.ConeGeometry(5.5, 3, 7);
    rubble.translate(lx + 4, 1, lz + 3);
    darkGeos.push(rubble);
    const [bx2, bz2] = rot(9, 2, lyaw);
    darkGeos.push(placedBox(4, 7, 4, lx + bx2, 3, lz + bz2, lyaw + 0.4));
  } else if (theme.landmark === 'cooling') {
    darkGeos.push(cyl(4.2, 5.8, 11, lx, 5, lz, 12));
    darkGeos.push(cyl(4.9, 4.2, 5.5, lx, 13.2, lz, 12));
    capGeos.push(cyl(4.35, 4.35, 0.25, lx, 15.7, lz, 12));
    const [cx2, cz2] = rot(9, -2, lyaw);
    darkGeos.push(cyl(1.0, 1.5, 19, lx + cx2, 9, lz + cz2, 8));
    capGeos.push(cyl(1.35, 1.35, 0.5, lx + cx2, 15, lz + cz2, 8));
    tip(lx + cx2, 18.8, lz + cz2, 0.3);
  } else if (theme.landmark === 'stacks') {
    let tallest = { h: 0, x: lx, z: lz };
    for (let i = 0; i < 3; i++) {
      const [ox2, oz2] = rot((i - 1) * 4.5, 0, lyaw);
      const sh = 17 + rand() * 8;
      darkGeos.push(cyl(1.0 + rand() * 0.3, 1.5 + rand() * 0.3, sh, lx + ox2, sh / 2 - 0.5, lz + oz2, 8));
      capGeos.push(cyl(1.4, 1.4, 0.5, lx + ox2, sh * 0.78, lz + oz2, 8));
      if (sh > tallest.h) tallest = { h: sh, x: lx + ox2, z: lz + oz2 };
    }
    darkGeos.push(placedBox(10, 1.4, 1.6, lx, 7.5, lz, lyaw));
    tip(tallest.x, tallest.h - 0.2, tallest.z, 0.3);
  }

  // ------------------------------------------------------ antenna masts
  for (let i = 0; i < 2; i++) {
    const sx = rand() > 0.5 ? 1 : -1;
    const sz = rand() > 0.5 ? 1 : -1;
    const px = sx * (w / 2 + 12 + rand() * 16);
    const pz = sz * (d / 2 + 12 + rand() * 16);
    const h2 = 24 + rand() * 14;
    darkGeos.push(cyl(0.2, 0.6, h2, px, h2 / 2 - 0.5, pz, 6));
    for (const fy of [0.45, 0.66, 0.86]) {
      darkGeos.push(placedBox(3.4 * (1.15 - fy) + 1, 0.16, 0.16, px, h2 * fy, pz, rand() * Math.PI));
    }
    darkGeos.push(placedBox(0.9, 0.7, 0.22, px, h2 * 0.58, pz, rand() * Math.PI));
    tip(px, h2 - 0.2, pz, 0.3);
  }

  // ------------------------------------------- construction cranes (Berlin!)
  for (let i = 0; i < (theme.cranes || 0); i++) {
    const ch = 18 + rand() * 9;
    const jib = 13 + rand() * 7;
    const yaw = rand() * Math.PI * 2;
    const sx = rand() > 0.5 ? 1 : -1;
    const sz = rand() > 0.5 ? 1 : -1;
    const cx = sx * (w / 2 + 9 + rand() * 18);
    const cz = sz * (d / 2 + 9 + rand() * 18);
    const cableLen = 6 + rand() * 7;
    const parts = [
      placedBox(0.9, ch, 0.9, 0, ch / 2, 0), // mast
      placedBox(1.5, 1.4, 1.5, 0.2, ch + 0.4, 0), // operator cab
      placedBox(jib, 0.6, 0.7, jib / 2 - 2.5, ch + 1.2, 0), // jib arm
      placedBox(4.5, 0.55, 0.7, -4.3, ch + 1.2, 0), // counter-jib
      placedBox(1.7, 1.5, 1.3, -5.6, ch + 0.6, 0), // counterweight
      placedBox(0.08, cableLen, 0.08, jib - 4, ch + 1 - cableLen / 2, 0), // hoist cable
      placedBox(0.55, 0.55, 0.55, jib - 4, ch + 0.75 - cableLen, 0), // hook block
      placedBox(0.1, 3.2, 0.1, 1.2, ch + 2.6, 0), // apex tie
    ];
    for (const g of parts) {
      g.rotateY(yaw);
      g.translate(cx, -0.5, cz);
      darkGeos.push(g);
    }
    const txv = jib - 2.5;
    tip(cx + Math.cos(yaw) * txv, ch + 1.2, cz - Math.sin(yaw) * txv, 0.28);
  }

  // ------------------------------------------------ distant bridge (Spree)
  if (theme.bridge) {
    const side = sides[Math.floor(rand() * 4)];
    const len = (side.axis === 'z' ? w : d) * 0.62;
    const away = 21 + rand() * 6;
    const orient = side.axis === 'z' ? 0 : Math.PI / 2;
    const [bx, bz] = post(side, (rand() - 0.5) * 8, away);
    const deckY = 6.8;
    const parts = [
      placedBox(len, 1.3, 3.4, 0, deckY, 0),
      placedBox(len, 0.5, 0.18, 0, deckY + 0.85, 1.55),
      placedBox(len, 0.5, 0.18, 0, deckY + 0.85, -1.55),
    ];
    const nPiers = Math.max(3, Math.round(len / 8));
    for (let k = 0; k < nPiers; k++) {
      parts.push(placedBox(1.3, deckY, 2.6, -len / 2 + (k + 0.5) * (len / nPiers), deckY / 2 - 0.5, 0));
    }
    // twin brick towers (Oberbaumbruecke silhouette)
    for (const s of [-1, 1]) {
      parts.push(placedBox(3.2, 12.5, 3.6, s * len * 0.33, 5.8, 0));
      const roof = new THREE.ConeGeometry(2.4, 3.2, 4);
      roof.rotateY(Math.PI / 4);
      roof.translate(s * len * 0.33, 13.6, 0);
      parts.push(roof);
    }
    for (const g of parts) {
      g.rotateY(orient);
      g.translate(bx, 0, bz);
      darkGeos.push(g);
    }
    // lit window band along the deck (a passing U-Bahn)
    const strip = placedBox(len * 0.8, 0.16, 0.16, 0, deckY + 1.15, 0.9);
    strip.rotateY(orient);
    strip.translate(bx, 0, bz);
    capGeos.push(strip);
    const tw = len * 0.33;
    const [tqx, tqz] = orient ? [0, -tw] : [tw, 0];
    tip(bx + tqx, 15.4, bz + tqz, 0.28);
  }

  // ------------------------- near ring: detailed towers with roof clutter
  for (const side of sides) {
    const len = side.axis === 'z' ? w : d;
    const count = Math.max(5, Math.round(len / 9));
    for (let i = 0; i < count; i++) {
      const along = -len / 2 + (i + 0.2 + rand() * 0.6) * (len / count);
      const away = 6 + rand() * 13;
      const [x, z] = post(side, along, away);
      const yaw = (rand() - 0.5) * 0.3;
      if (theme.style === 'shards') {
        const hb = 9 + rand() * 15;
        const cone = new THREE.ConeGeometry(2.5 + rand() * 3.5, hb, 5);
        cone.rotateZ((rand() - 0.5) * 0.24);
        cone.rotateY(rand() * Math.PI);
        cone.translate(x, hb / 2 - 0.6, z);
        darkGeos.push(cone);
        if (rand() > 0.55) {
          const hs = 4 + rand() * 6;
          const c2 = new THREE.ConeGeometry(1.4 + rand() * 1.6, hs, 5);
          c2.rotateZ((rand() - 0.5) * 0.3);
          c2.translate(x + (rand() - 0.5) * 7, hs / 2 - 0.5, z + (rand() - 0.5) * 7);
          darkGeos.push(c2);
        }
        continue;
      }
      const isCity = theme.style === 'city';
      const bw = 4.5 + rand() * 5.5;
      const bd = 4.5 + rand() * 4.5;
      const bh = isCity ? 8 + rand() * rand() * 20 : 4.5 + rand() * rand() * 13;
      const lit = isCity ? rand() > 0.2 : rand() > 0.72;
      const bucket = lit ? facadeGeos : darkGeos;
      bucket.push(placedBox(bw, bh, bd, x, bh / 2 - 0.4, z, yaw));
      darkGeos.push(placedBox(bw + 0.3, 0.22, bd + 0.3, x, bh - 0.1, z, yaw)); // parapet lip
      let roofY = bh;
      let rx = x;
      let rz = z;
      if (bh > 11 && rand() > 0.5) {
        // setback upper volume
        const uw = bw * (0.5 + rand() * 0.25);
        const ud = bd * (0.55 + rand() * 0.25);
        const uh = 3.5 + rand() * 6.5;
        const [ox, oz] = rot((rand() - 0.5) * (bw - uw) * 0.7, 0, yaw);
        rx = x + ox;
        rz = z + oz;
        bucket.push(placedBox(uw, uh, ud, rx, bh + uh / 2 - 0.4, rz, yaw));
        darkGeos.push(placedBox(uw + 0.25, 0.2, ud + 0.25, rx, bh + uh - 0.45, rz, yaw));
        roofY = bh + uh - 0.4;
      }
      // rooftop clutter: water tank / AC boxes / antenna
      if (rand() > 0.55) {
        const [ox, oz] = rot((rand() - 0.5) * bw * 0.35, (rand() - 0.5) * bd * 0.35, yaw);
        const tr = 0.55 + rand() * 0.45;
        darkGeos.push(cyl(tr, tr, 1.1 + rand() * 0.7, rx + ox, roofY + 0.75, rz + oz, 7));
      }
      if (rand() > 0.45) {
        const [ox, oz] = rot((rand() - 0.5) * bw * 0.4, (rand() - 0.5) * bd * 0.4, yaw);
        darkGeos.push(placedBox(0.8 + rand() * 0.6, 0.5 + rand() * 0.4, 0.7 + rand() * 0.5, rx + ox, roofY + 0.35, rz + oz, yaw));
      }
      if (rand() > 0.7) {
        const ah = 2 + rand() * 2.5;
        darkGeos.push(placedBox(0.12, ah, 0.12, rx, roofY + ah / 2, rz, yaw));
      }
      // glowing roof-edge strip on some city towers
      if (isCity && rand() > 0.7) {
        const [ex, ez] = rot(0, bd / 2 + 0.05, yaw);
        capGeos.push(placedBox(bw * 0.75, 0.12, 0.12, x + ex, bh - 0.06, z + ez, yaw));
      }
      if (roofY > 20) tip(rx, roofY + 0.5, rz, 0.3);
    }
  }

  // ------------------- far ring: tall dark slabs (parallax depth layer)
  for (const side of sides) {
    const len = (side.axis === 'z' ? w : d) + 44;
    const count = Math.max(5, Math.round(len / 12));
    for (let i = 0; i < count; i++) {
      const along = -len / 2 + (i + 0.15 + rand() * 0.7) * (len / count);
      const away = 27 + rand() * 27;
      const [x, z] = post(side, along, away);
      if (theme.style === 'shards') {
        const hb = 16 + rand() * 22;
        const cone = new THREE.ConeGeometry(5 + rand() * 6, hb, 5);
        cone.rotateY(rand() * Math.PI);
        cone.translate(x, hb / 2 - 1, z);
        farGeos.push(cone);
        continue;
      }
      const bw = 9 + rand() * 15;
      const bh = theme.style === 'city' ? 14 + rand() * rand() * 30 : 8 + rand() * 15;
      const yaw2 = (rand() - 0.5) * 0.6;
      farGeos.push(placedBox(bw, bh, 6 + rand() * 8, x, bh / 2 - 0.8, z, yaw2));
      if (rand() > 0.6) {
        farGeos.push(placedBox(bw * 0.55, 4 + rand() * 6, 5, x, bh + 2, z, yaw2));
      }
    }
  }

  // ------------------ glowing corner obelisks just outside the corners
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const px = sx * (w / 2 + 1.7);
      const pz = sz * (d / 2 + 1.7);
      darkGeos.push(placedBox(2.3, 0.8, 2.3, px, 0.4, pz));
      darkGeos.push(placedBox(1.5, 9.6, 1.5, px, 5.2, pz));
      capGeos.push(placedBox(1.65, 0.4, 1.65, px, 10.2, pz));
      darkGeos.push(placedBox(0.9, 1.5, 0.9, px, 11.1, pz));
    }
  }

  mergeInto(deco, facadeGeos, facadeMat);
  mergeInto(deco, darkGeos, darkMat);
  mergeInto(deco, farGeos, farMat);
  mergeInto(deco, capGeos, capMat);
  mergeInto(deco, tipGeos, tipMat);

  // one shared additive glow sprite material for all tip lights
  if (glowSpots.length) {
    const gm = new THREE.SpriteMaterial({
      map: glowTexture(), color: new THREE.Color('#ff5544'),
      transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    });
    for (const [x, y, z] of glowSpots) {
      const sp = new THREE.Sprite(gm);
      sp.scale.set(1.7, 1.7, 1.7);
      sp.position.set(x, y, z);
      deco.add(sp);
    }
  }
}
