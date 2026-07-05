import * as THREE from 'three';
import { surfaceTexture, glowTexture } from '../../engine/textures.js';
import { paletteKey, placedBox, mergeInto, mulberry32, hashStr } from './util.js';

// =====================================================================
// FROZEN INTERFACE — out-of-bounds skyline decoration (NO colliders).
//
//   addSkyline(group, w, d, palette, rand)
//     Everything OUTSIDE the perimeter walls, layered into THREE depth
//     rings for a dense panorama: a near ring (lit facades, setbacks,
//     rooftop clutter, dark parallax slabs), a mid ring at ~1.5x the
//     near distance (stepped towers, slabs with rooftop clutter, gas
//     holders, skybridges + per-palette signatures: Neon sign stacks,
//     Ruins half-towers, Ice glacial ridges, Sand mesas/minarets,
//     Toxic tank farms, Crimson spire clusters, Spree Altbau rows and
//     cranes), and a far ring at ~2.2x (near-silhouette flats tinted
//     toward the palette sky horizon). Plus a per-palette landmark
//     (dome / minaret / spire / glacier / broken tower / cooling tower
//     / chimney stacks), antenna masts, construction cranes, corner
//     obelisks, and — for Spree — a distant bridge.
//     Players can never reach these, so none of it has colliders and
//     rotation is allowed.
//
// PRNG DISCIPLINE (critical): the ORIGINAL content draws from `rand`
// (the shared map-seeded PRNG; buildStructures consumes it before this
// module and addProps after) — the number and order of those draws is
// FROZEN. All mid/far-ring content added later draws exclusively from
// a LOCAL PRNG (`rnd2`, seeded from the map size) so the shared stream
// is untouched and props output stays identical.
//
// Budget: everything merges into <= 9 meshes (facades / near dark /
// far slabs / accent caps / tip bulbs + mid facades / mid dark / mid
// signs / far flats) — well under the 14-draw-call cap — plus at most
// 10 + 6 glow sprites. The tip()/tip2() helpers enforce the sprite
// caps; landmark, masts and cranes are built FIRST so they win the
// near-ring aviation-light budget.
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

// Mid-ring identity per palette: `sig` picks the signature block builder,
// `city` toggles lit-facade probability, skybridges and tall far flats.
const MIDRINGS = {
  Spree: { sig: 'altbau', city: true },
  Sand: { sig: 'mesa', city: false },
  Neon: { sig: 'signs', city: true },
  Ice: { sig: 'glacial', city: false },
  Ruins: { sig: 'broken', city: false },
  Toxic: { sig: 'tanks', city: true },
  Crimson: { sig: 'spires', city: true },
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

  // ===================================================================
  // Mid + far panorama rings. EVERYTHING below draws exclusively from
  // the LOCAL PRNG `rnd2` — the shared `rand` stream above is frozen
  // (addProps consumes it next; its output must not change).
  // ===================================================================
  const rnd2 = mulberry32(hashStr(String(w) + 'x' + String(d) + ':skyline2'));
  const mid = MIDRINGS[paletteKey(pal)];
  const skyHorizon = new THREE.Color(pal.skyBottom ?? pal.fog ?? '#5a6b7a');

  // mid ring: slightly hazier than the near dark mass; scene fog adds the rest
  const midDarkMat = new THREE.MeshLambertMaterial({ color: fogCol.clone().multiplyScalar(0.48) });
  const midFacadeSurf = surfaceTexture('facade', pal.wall, pal.accent, { density: Math.min(0.85, theme.winDensity + 0.08) });
  const midFacadeMat = new THREE.MeshLambertMaterial({
    map: midFacadeSurf.map,
    emissiveMap: midFacadeSurf.map,
    emissive: new THREE.Color('#ffffff'),
    emissiveIntensity: 0.34, // dimmer than the near ring -> reads as distance haze
  });
  // signature emissive (sign stacks, lit rings) — deliberately above the
  // 0.9 bloom threshold, everything else in the new rings stays below it
  const signMat = new THREE.MeshLambertMaterial({
    color: new THREE.Color(pal.accent).multiplyScalar(0.35),
    emissive: new THREE.Color(pal.accent),
    emissiveIntensity: 1.45,
  });
  // far ring: unlit flats tinted toward the sky horizon color, fog disabled
  // so the tint holds — a stable atmospheric backdrop, not fog-double-dipped
  const farFlatMat = new THREE.MeshBasicMaterial({
    color: fogCol.clone().lerp(skyHorizon, 0.45),
    fog: false,
  });

  const midDarkGeos = [];
  const midFacadeGeos = [];
  const signGeos = [];
  const farFlatGeos = [];
  const glowSpots2 = [];
  // aviation bulb + glow sprite for the new rings (own 6-sprite budget)
  const tip2 = (x, y, z, r = 0.26) => {
    if (glowSpots2.length >= 6) return;
    const g = new THREE.SphereGeometry(r, 6, 6);
    g.translate(x, y, z);
    tipGeos.push(g);
    glowSpots2.push([x, y, z]);
  };
  const midLit = () => (mid.city ? rnd2() > 0.35 : rnd2() > 0.8);

  // ---------------------------------------------- mid-ring shape kit
  const steppedTower = (x, z, yaw) => {
    const bucket = midLit() ? midFacadeGeos : midDarkGeos;
    let tw = 5.5 + rnd2() * 4.5;
    let td = 5 + rnd2() * 4;
    const tiers = 2 + (rnd2() > 0.45 ? 1 : 0);
    let y0 = -0.6;
    for (let t = 0; t < tiers; t++) {
      const th = t === 0 ? 10 + rnd2() * 12 : 5 + rnd2() * 7;
      bucket.push(placedBox(tw, th, td, x, y0 + th / 2, z, yaw));
      midDarkGeos.push(placedBox(tw + 0.3, 0.24, td + 0.3, x, y0 + th, z, yaw));
      y0 += th;
      tw *= 0.62 + rnd2() * 0.16;
      td *= 0.62 + rnd2() * 0.16;
    }
    if (rnd2() > 0.6) {
      const mh = 2.5 + rnd2() * 3.5;
      midDarkGeos.push(placedBox(0.16, mh, 0.16, x, y0 + mh / 2, z, yaw));
      y0 += mh;
    }
    if (mid.city && rnd2() > 0.75) {
      capGeos.push(placedBox(3.6 + rnd2() * 2.5, 0.12, 0.12, x, y0 * 0.55, z, yaw));
    }
    if (y0 > 26 && rnd2() > 0.5) tip2(x, y0 + 0.4, z);
  };
  const clutterSlab = (x, z, yaw) => {
    const bw = 10 + rnd2() * 8;
    const bd = 6 + rnd2() * 4;
    const bh = 9 + rnd2() * 8;
    const bucket = midLit() ? midFacadeGeos : midDarkGeos;
    bucket.push(placedBox(bw, bh, bd, x, bh / 2 - 0.6, z, yaw));
    midDarkGeos.push(placedBox(bw + 0.3, 0.24, bd + 0.3, x, bh - 0.1, z, yaw));
    const n = 2 + Math.floor(rnd2() * 3); // rooftop clutter: tanks / AC / vents
    for (let k = 0; k < n; k++) {
      const [ox, oz] = rot((rnd2() - 0.5) * bw * 0.55, (rnd2() - 0.5) * bd * 0.5, yaw);
      if (rnd2() > 0.5) {
        const tr = 0.6 + rnd2() * 0.5;
        midDarkGeos.push(cyl(tr, tr, 1.2 + rnd2() * 1.1, x + ox, bh + 0.6, z + oz, 7));
      } else {
        midDarkGeos.push(placedBox(1 + rnd2() * 1.2, 0.6 + rnd2() * 0.8, 0.9 + rnd2() * 0.9, x + ox, bh + 0.3, z + oz, yaw));
      }
    }
  };
  const gasHolder = (x, z) => {
    const r = 4.5 + rnd2() * 2.5;
    const h = 7 + rnd2() * 5;
    midDarkGeos.push(cyl(r, r, h, x, h / 2 - 0.6, z, 12));
    midDarkGeos.push(cyl(r * 0.9, r * 0.9, h * 0.3, x, h + h * 0.13, z, 12));
    midDarkGeos.push(cyl(r + 0.25, r + 0.25, 0.35, x, h, z, 12));
  };
  // twin towers joined by a skybridge, spread along the side axis (ax, az)
  const twinBridge = (x, z, ax, az) => {
    const gap = 8 + rnd2() * 4;
    const h1 = 13 + rnd2() * 12;
    const h2 = 13 + rnd2() * 12;
    const w1 = 4 + rnd2() * 2.5;
    const w2 = 4 + rnd2() * 2.5;
    const x1 = x - ax * gap / 2;
    const z1 = z - az * gap / 2;
    const x2 = x + ax * gap / 2;
    const z2 = z + az * gap / 2;
    (midLit() ? midFacadeGeos : midDarkGeos).push(placedBox(w1, h1, w1, x1, h1 / 2 - 0.6, z1));
    (midLit() ? midFacadeGeos : midDarkGeos).push(placedBox(w2, h2, w2, x2, h2 / 2 - 0.6, z2));
    const by = Math.min(h1, h2) * (0.55 + rnd2() * 0.25);
    midDarkGeos.push(placedBox(gap, 1.3, 2.1, x, by, z, az ? Math.PI / 2 : 0));
    if (rnd2() > 0.6) capGeos.push(placedBox(gap * 0.7, 0.1, 0.1, x, by + 0.75, z, az ? Math.PI / 2 : 0));
  };

  // ------------------------------------- per-palette mid-ring signatures
  const sigAltbau = (x, z, yaw) => { // Berlin tenement row with pitched roof
    const L = 11 + rnd2() * 7;
    const H = 6.5 + rnd2() * 2;
    const D = 6 + rnd2() * 2;
    (rnd2() > 0.4 ? midFacadeGeos : midDarkGeos).push(placedBox(L, H, D, x, H / 2 - 0.5, z, yaw));
    const r = D * 0.62;
    const roof = new THREE.CylinderGeometry(r, r, L, 3, 1); // triangular prism
    roof.rotateZ(Math.PI / 2);
    roof.rotateY(yaw);
    roof.translate(x, H - 0.5 + r * 0.5, z);
    midDarkGeos.push(roof);
    const nCh = 1 + Math.floor(rnd2() * 2); // ridge chimneys
    for (let k = 0; k < nCh; k++) {
      const [ox, oz] = rot((rnd2() - 0.5) * L * 0.7, 0, yaw);
      midDarkGeos.push(placedBox(0.7, 1.6, 0.7, x + ox, H + r * 1.5 - 0.9, z + oz, yaw));
    }
  };
  const sigMesa = (x, z, yaw) => { // stacked dune mesa
    let tw = 13 + rnd2() * 8;
    let td = 9 + rnd2() * 5;
    let y0 = -0.6;
    const tiers = 2 + Math.floor(rnd2() * 2);
    for (let t = 0; t < tiers; t++) {
      const th = 4 + rnd2() * 4;
      midDarkGeos.push(placedBox(tw, th, td, x, y0 + th / 2, z, yaw));
      y0 += th;
      tw *= 0.66 + rnd2() * 0.12;
      td *= 0.7 + rnd2() * 0.12;
    }
  };
  const sigMinaret = (x, z) => {
    const h = 15 + rnd2() * 8;
    midDarkGeos.push(cyl(0.7, 1.05, h, x, h / 2 - 0.5, z, 8));
    midDarkGeos.push(cyl(1.5, 1.5, 0.7, x, h * 0.78, z, 8));
    capGeos.push(cyl(0.9, 0.9, 0.28, x, h * 0.78 + 0.5, z, 8)); // lit balcony ring
    const cone = new THREE.ConeGeometry(1.1, 2.6, 8);
    cone.translate(x, h + 1.3, z);
    midDarkGeos.push(cone);
    if (rnd2() > 0.5) { // low dome house at the foot
      const [hx, hz] = [x + (rnd2() - 0.5) * 8, z + (rnd2() - 0.5) * 6];
      midDarkGeos.push(placedBox(6 + rnd2() * 3, 3.2, 6, hx, 1.1, hz));
      const dome = new THREE.SphereGeometry(2.6, 9, 7);
      dome.translate(hx, 3.2, hz);
      midDarkGeos.push(dome);
    }
  };
  // stacked billboard signs climbing the inward face of a tower
  const sigSignTower = (x, z, side) => {
    const bw = 6 + rnd2() * 3.5;
    const bd = 5.5 + rnd2() * 3;
    const bh = 14 + rnd2() * 14;
    (rnd2() > 0.3 ? midFacadeGeos : midDarkGeos).push(placedBox(bw, bh, bd, x, bh / 2 - 0.5, z));
    midDarkGeos.push(placedBox(bw + 0.3, 0.24, bd + 0.3, x, bh, z));
    const inX = side.axis === 'x' ? -side.sign : 0;
    const inZ = side.axis === 'z' ? -side.sign : 0;
    const n = 2 + Math.floor(rnd2() * 3);
    let sy = 3 + rnd2() * 2.5;
    for (let k = 0; k < n && sy < bh - 2; k++) {
      const sw = 2 + rnd2() * 2.2;
      const sh = 1 + rnd2() * 1.2;
      signGeos.push(inZ
        ? placedBox(sw, sh, 0.28, x + (rnd2() - 0.5) * (bw - sw) * 0.5, sy, z + inZ * (bd / 2 + 0.35))
        : placedBox(0.28, sh, sw, x + inX * (bw / 2 + 0.35), sy, z + (rnd2() - 0.5) * (bd - sw) * 0.5));
      sy += sh + 0.7 + rnd2() * 1.6;
    }
    if (rnd2() > 0.45) { // vertical neon column on a corner
      const vh = 3.5 + rnd2() * 3;
      signGeos.push(placedBox(0.3, vh, 0.3,
        x + (bw / 2) * (rnd2() > 0.5 ? 1 : -1), bh - vh / 2 - 0.4, z + (bd / 2) * (rnd2() > 0.5 ? 1 : -1)));
    }
    if (bh > 22) tip2(x, bh + 0.4, z);
  };
  const sigBroken = (x, z, yaw) => { // war-torn half-tower
    const bw = 4.5 + rnd2() * 3;
    const h = 12 + rnd2() * 10;
    midDarkGeos.push(placedBox(bw, h * 0.55, bw, x, h * 0.275 - 0.5, z, yaw));
    const [ox, oz] = rot(bw * 0.22, 0, yaw);
    midDarkGeos.push(placedBox(bw * 0.45, h * 0.45, bw * 0.85, x + ox, h * 0.775 - 0.5, z + oz, yaw));
    const chunk = placedBox(bw * 0.9, h * 0.2, bw * 0.5, 0, 0, 0, yaw);
    chunk.rotateZ(0.4 + rnd2() * 0.25);
    chunk.translate(x - ox * 2, h * 0.5, z - oz * 2);
    midDarkGeos.push(chunk);
    const rubble = new THREE.ConeGeometry(bw * 0.8, 2.5, 6);
    rubble.translate(x + (rnd2() - 0.5) * 4, 0.6, z + (rnd2() - 0.5) * 4);
    midDarkGeos.push(rubble);
  };
  const sigGlacial = (x, z) => { // glacial ridge segment
    const gh = 16 + rnd2() * 20;
    const cone = new THREE.ConeGeometry(6 + rnd2() * 5, gh, 5);
    cone.rotateZ((rnd2() - 0.5) * 0.22);
    cone.rotateY(rnd2() * Math.PI);
    cone.translate(x, gh / 2 - 1, z);
    midDarkGeos.push(cone);
    if (rnd2() > 0.45) {
      const h2 = 8 + rnd2() * 12;
      const c2 = new THREE.ConeGeometry(3 + rnd2() * 3, h2, 5);
      c2.rotateY(rnd2() * Math.PI);
      c2.translate(x + (rnd2() - 0.5) * 12, h2 / 2 - 0.8, z + (rnd2() - 0.5) * 12);
      midDarkGeos.push(c2);
    }
    if (rnd2() > 0.7) { // vertical ice shard
      const sh = 10 + rnd2() * 9;
      const s = new THREE.ConeGeometry(1.2 + rnd2(), sh, 5);
      s.translate(x + (rnd2() - 0.5) * 10, sh / 2 - 0.5, z + (rnd2() - 0.5) * 10);
      midDarkGeos.push(s);
    }
  };
  const sigTanks = (x, z, ax, az) => { // storage tank farm
    const n = 2 + Math.floor(rnd2() * 2);
    const r = 2.4 + rnd2() * 1.2;
    const sp = r * 2 + 1.4;
    const th = 4.5 + rnd2() * 3;
    for (let k = 0; k < n; k++) {
      const tx = x + ax * (k - (n - 1) / 2) * sp;
      const tz = z + az * (k - (n - 1) / 2) * sp;
      midDarkGeos.push(cyl(r, r, th, tx, th / 2 - 0.5, tz, 10));
      midDarkGeos.push(cyl(r * 0.55, r * 0.9, 0.9, tx, th + 0.4, tz, 10));
    }
    midDarkGeos.push(placedBox(n * sp, 0.3, 0.3, x, th * 0.6, z, az ? Math.PI / 2 : 0)); // pipe run
    if (rnd2() > 0.5) { // sphere tank
      const sr = 2.4 + rnd2();
      const sph = new THREE.SphereGeometry(sr, 10, 8);
      sph.translate(x + az * (sp + sr), sr + 0.4, z + ax * (sp + sr));
      midDarkGeos.push(sph);
    }
    if (rnd2() > 0.55) { // flare stack
      const fh = 11 + rnd2() * 7;
      midDarkGeos.push(cyl(0.35, 0.6, fh, x - az * sp, fh / 2 - 0.5, z - ax * sp, 6));
      tip2(x - az * sp, fh + 0.3, z - ax * sp, 0.3);
    }
  };
  const sigSpires = (x, z, yaw) => { // gothic spire cluster
    const n = 2 + Math.floor(rnd2() * 3);
    let best = { h: 0, x, z };
    for (let k = 0; k < n; k++) {
      const [ox, oz] = rot((rnd2() - 0.5) * 9, (rnd2() - 0.5) * 7, yaw);
      const sh = 14 + rnd2() * 14;
      const sw = 1.8 + rnd2() * 1.4;
      midDarkGeos.push(placedBox(sw, sh, sw, x + ox, sh / 2 - 0.5, z + oz, yaw));
      const ch = 3 + rnd2() * 3;
      const cone = new THREE.ConeGeometry(sw * 0.75, ch, 4);
      cone.rotateY(yaw + Math.PI / 4);
      cone.translate(x + ox, sh + ch / 2 - 0.5, z + oz);
      midDarkGeos.push(cone);
      if (sh > best.h) best = { h: sh + ch, x: x + ox, z: z + oz };
    }
    if (best.h > 24 && rnd2() > 0.5) tip2(best.x, best.h + 0.3, best.z);
  };

  // ------------------------------------------------------- mid ring loop
  for (const side of sides) {
    const len = side.axis === 'z' ? w : d;
    const half = (side.axis === 'z' ? d : w) / 2; // outward half-extent
    const span = len + 56; // overshoot to fill the corners
    const baseAway = half * 0.5 + 16; // ~1.5x the near-ring distance
    const count = Math.max(7, Math.round(span / 8));
    const ax = side.axis === 'z' ? 1 : 0;
    const az = ax ? 0 : 1;
    for (let i = 0; i < count; i++) {
      const along = -span / 2 + (i + 0.15 + rnd2() * 0.7) * (span / count);
      const away = baseAway + rnd2() * 14;
      const [x, z] = post(side, along, away);
      const yaw = (rnd2() - 0.5) * 0.5;
      if (mid.sig === 'glacial') { // Ice: the whole mid ring is glacial ridge
        sigGlacial(x, z);
        continue;
      }
      const roll = rnd2();
      if (roll < 0.42) {
        if (mid.sig === 'altbau') sigAltbau(x, z, yaw);
        else if (mid.sig === 'mesa') (rnd2() > 0.3 ? sigMesa(x, z, yaw) : sigMinaret(x, z));
        else if (mid.sig === 'signs') sigSignTower(x, z, side);
        else if (mid.sig === 'broken') sigBroken(x, z, yaw);
        else if (mid.sig === 'tanks') sigTanks(x, z, ax, az);
        else sigSpires(x, z, yaw);
      } else if (roll < 0.64) {
        steppedTower(x, z, yaw);
      } else if (roll < 0.82) {
        clutterSlab(x, z, yaw);
      } else if (roll < 0.92 && mid.city) {
        twinBridge(x, z, ax, az);
      } else {
        gasHolder(x, z);
      }
    }
  }
  if (mid.sig === 'altbau') { // Spree: extra mid-distance construction cranes
    for (let i = 0; i < 2; i++) {
      const sx = rnd2() > 0.5 ? 1 : -1;
      const sz = rnd2() > 0.5 ? 1 : -1;
      const cx = sx * (w * 0.75 + 18 + rnd2() * 10);
      const cz = sz * (d * 0.75 + 18 + rnd2() * 10);
      const ch = 20 + rnd2() * 8;
      const jib = 12 + rnd2() * 6;
      const cyaw = rnd2() * Math.PI * 2;
      const parts = [
        placedBox(0.8, ch, 0.8, 0, ch / 2, 0),
        placedBox(jib, 0.55, 0.6, jib / 2 - 2, ch + 1, 0),
        placedBox(3.6, 0.5, 0.6, -3.4, ch + 1, 0),
        placedBox(1.4, 1.2, 1.2, -4.6, ch + 0.4, 0),
      ];
      for (const g of parts) {
        g.rotateY(cyaw);
        g.translate(cx, -0.5, cz);
        midDarkGeos.push(g);
      }
      tip2(cx + Math.cos(cyaw) * (jib - 2), ch + 1, cz - Math.sin(cyaw) * (jib - 2));
    }
  }

  // ------------------------------------------------------- far ring loop
  // Near-silhouette flats hugging the horizon; taller than the mid ring so
  // their rooflines peek over it through the gaps.
  for (const side of sides) {
    const len = side.axis === 'z' ? w : d;
    const half = (side.axis === 'z' ? d : w) / 2;
    const span = len + 120;
    const baseAway = half * 1.2 + 26; // ~2.2x the near-ring distance
    const count = Math.max(9, Math.round(span / 11));
    for (let i = 0; i < count; i++) {
      const along = -span / 2 + (i + 0.1 + rnd2() * 0.8) * (span / count);
      const away = baseAway + rnd2() * 18;
      const [x, z] = post(side, along, away);
      if (mid.sig === 'glacial') { // Ice: mountain silhouettes
        const gh = 24 + rnd2() * 34;
        const cone = new THREE.ConeGeometry(9 + rnd2() * 9, gh, 5);
        cone.rotateY(rnd2() * Math.PI);
        cone.translate(x, gh / 2 - 1.5, z);
        farFlatGeos.push(cone);
        continue;
      }
      const bw = 12 + rnd2() * 18;
      const bh = mid.city ? 20 + rnd2() * rnd2() * 34 : 13 + rnd2() * rnd2() * 26;
      const yaw = (rnd2() - 0.5) * 0.6;
      farFlatGeos.push(placedBox(bw, bh, 7 + rnd2() * 7, x, bh / 2 - 1, z, yaw));
      if (rnd2() > 0.55) { // stepped notch on the roofline
        farFlatGeos.push(placedBox(bw * (0.3 + rnd2() * 0.3), 4 + rnd2() * 8, 6, x + (rnd2() - 0.5) * bw * 0.4, bh + 1.5, z, yaw));
      }
      if (mid.sig === 'spires' && rnd2() > 0.72) { // Crimson: far chimneys
        const fh = bh + 8 + rnd2() * 10;
        farFlatGeos.push(cyl(1, 1.6, fh, x + (rnd2() - 0.5) * bw * 0.5, fh / 2 - 1, z, 7));
      }
      if (mid.sig === 'mesa' && rnd2() > 0.75) { // Sand: far minaret needles
        const fh = bh + 6 + rnd2() * 9;
        farFlatGeos.push(cyl(0.5, 0.9, fh, x + (rnd2() - 0.5) * bw * 0.6, fh / 2 - 1, z, 6));
      }
    }
  }

  mergeInto(deco, facadeGeos, facadeMat);
  mergeInto(deco, darkGeos, darkMat);
  mergeInto(deco, farGeos, farMat);
  mergeInto(deco, midFacadeGeos, midFacadeMat);
  mergeInto(deco, midDarkGeos, midDarkMat);
  mergeInto(deco, signGeos, signMat);
  mergeInto(deco, farFlatGeos, farFlatMat);
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

  // mid-ring glow sprites (own material: accent for Neon signs, red else)
  if (glowSpots2.length) {
    const gm2 = new THREE.SpriteMaterial({
      map: glowTexture(),
      color: new THREE.Color(mid.sig === 'signs' ? pal.accent : '#ff5544'),
      transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    });
    for (const [x, y, z] of glowSpots2) {
      const sp = new THREE.Sprite(gm2);
      sp.scale.set(1.5, 1.5, 1.5);
      sp.position.set(x, y, z);
      deco.add(sp);
    }
  }
}
