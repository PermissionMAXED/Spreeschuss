import * as THREE from 'three';

// Procedural combat feedback: impact sparks, bullet-hole decals, body-hit
// puffs, tapered hot-core tracers, layered smoke shells and spike drama.
// Everything is pooled and capped; per-frame updates run from
// Game.renderExtras via update(dt); clear() empties every pool and disposes
// GPU resources (called from Game._clearEffects on round start / match load).
//
// This module never touches gameplay data. It only reads game.colliders /
// game.walls / game.smokes / game.spike to place visuals.

const MAX_DECALS = 60;
const MAX_BURSTS = 24;
const MAX_TRACERS = 40;
const BURST_N = 16; // particles per burst (fixed buffer size)

const _Y = new THREE.Vector3(0, 1, 0);
const _Z = new THREE.Vector3(0, 0, 1);

export class EffectsSystem {
  constructor(game) {
    this.game = game;
    this.r = game.r;
    this._t = 0; // effect-local clock (advances every rendered frame)

    this.tracers = [];
    this._tracerPool = [];
    this.bursts = [];
    this._burstPool = [];
    this.decals = [];
    this._decalPool = [];
    this.timed = []; // one-shot animated meshes (shockwaves, flashes, lights)

    this._shared = null; // lazily built shared geometries/textures/materials
  }

  // ------------------------------------------------------------ shared GPU resources
  _ensureShared() {
    if (this._shared) return this._shared;
    const decalTex = makeDecalTexture();
    const sparkTex = makeSparkTexture();
    this._shared = {
      // unit-height tapered beam, +Y (radiusTop) points at the target
      beamGeo: new THREE.CylinderGeometry(0.012, 0.03, 1, 6, 1, true),
      decalGeo: new THREE.PlaneGeometry(1, 1),
      decalTex,
      sparkTex,
      decalMat: new THREE.MeshBasicMaterial({
        map: decalTex, transparent: true, opacity: 0.95, depthWrite: false,
        polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      }),
    };
    return this._shared;
  }

  // ------------------------------------------------------------ per-frame update
  update(dt) {
    this._t += dt;
    this._updateTracers(dt);
    this._updateBursts(dt);
    this._updateTimed(dt);
    this._updateSmokes(dt);
    this._updateSpike();
  }

  // ------------------------------------------------------------ tracers
  // Same signature/behavior contract as before: additive, fog-less, pooled,
  // faded per frame. Thin tapered beam with a hot near-white core.
  spawnTracer(a, b) {
    const dist = a.distanceTo(b);
    if (dist < 0.1) return;
    if (this.tracers.length >= MAX_TRACERS) this._releaseTracer(this.tracers.shift());
    const s = this._ensureShared();
    let t = this._tracerPool.pop();
    if (!t) {
      const glowMat = new THREE.MeshBasicMaterial({ color: 0xffb36b, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
      const coreMat = new THREE.MeshBasicMaterial({ color: 0xfff8e0, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
      const glow = new THREE.Mesh(s.beamGeo, glowMat);
      const core = new THREE.Mesh(s.beamGeo, coreMat);
      core.scale.set(0.38, 1, 0.38);
      const group = new THREE.Group();
      group.add(glow); group.add(core);
      t = { group, glowMat, coreMat, life: 0, max: 0.11 };
    }
    t.life = t.max = 0.11;
    t.group.position.copy(a).add(b).multiplyScalar(0.5);
    t.group.quaternion.setFromUnitVectors(_Y, b.clone().sub(a).normalize());
    t.group.scale.set(1, dist, 1);
    t.glowMat.opacity = 0.85;
    t.coreMat.opacity = 0.95;
    this.r.scene.add(t.group);
    this.tracers.push(t);
  }

  _releaseTracer(t) {
    this.r.scene.remove(t.group);
    this._tracerPool.push(t);
  }

  _updateTracers(dt) {
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.life -= dt;
      if (t.life <= 0) { this._releaseTracer(t); this.tracers.splice(i, 1); continue; }
      const k = t.life / t.max;
      t.glowMat.opacity = 0.85 * k * k; // glow dies fast
      t.coreMat.opacity = 0.95 * k;
      const r = 0.55 + 0.45 * k;        // beam thins as it fades
      t.group.scale.x = r; t.group.scale.z = r;
    }
  }

  // ------------------------------------------------------------ particle bursts
  _getBurst() {
    let b = this._burstPool.pop();
    if (!b) {
      const s = this._ensureShared();
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(BURST_N * 3), 3));
      const mat = new THREE.PointsMaterial({
        size: 0.06, map: s.sparkTex, transparent: true, opacity: 1,
        depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true, fog: false,
      });
      const points = new THREE.Points(geo, mat);
      points.frustumCulled = false;
      b = { points, geo, mat, vel: new Float32Array(BURST_N * 3), n: 0, life: 0, max: 1, gravity: 0, size: 0.06 };
    }
    return b;
  }

  _releaseBurst(b) {
    this.r.scene.remove(b.points);
    this._burstPool.push(b);
  }

  // opts: { color, count, speed, size, life, gravity, normal?, additive? }
  spawnBurst(point, opts) {
    if (this.bursts.length >= MAX_BURSTS) this._releaseBurst(this.bursts.shift());
    const b = this._getBurst();
    b.n = Math.min(BURST_N, opts.count || 8);
    b.geo.setDrawRange(0, b.n);
    const pos = b.geo.attributes.position.array;
    const nrm = opts.normal;
    for (let j = 0; j < b.n; j++) {
      const i3 = j * 3;
      pos[i3] = point.x; pos[i3 + 1] = point.y; pos[i3 + 2] = point.z;
      // random direction, biased into the hemisphere around the normal
      let vx = Math.random() * 2 - 1, vy = Math.random() * 2 - 1, vz = Math.random() * 2 - 1;
      const l = Math.hypot(vx, vy, vz) || 1;
      vx /= l; vy /= l; vz /= l;
      if (nrm) {
        const d = vx * nrm.x + vy * nrm.y + vz * nrm.z;
        if (d < 0) { vx -= 2 * d * nrm.x; vy -= 2 * d * nrm.y; vz -= 2 * d * nrm.z; }
        vx += nrm.x * 0.6; vy += nrm.y * 0.6; vz += nrm.z * 0.6;
      }
      const sp = (opts.speed || 2) * (0.35 + Math.random() * 0.85);
      b.vel[i3] = vx * sp; b.vel[i3 + 1] = vy * sp; b.vel[i3 + 2] = vz * sp;
    }
    b.geo.attributes.position.needsUpdate = true;
    b.mat.color.setHex(opts.color ?? 0xffc06a);
    b.mat.blending = opts.additive === false ? THREE.NormalBlending : THREE.AdditiveBlending;
    b.mat.size = b.size = opts.size ?? 0.06;
    b.mat.opacity = 1;
    b.life = b.max = opts.life ?? 0.2;
    b.gravity = opts.gravity ?? 4;
    this.r.scene.add(b.points);
    this.bursts.push(b);
  }

  _updateBursts(dt) {
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i];
      b.life -= dt;
      if (b.life <= 0) { this._releaseBurst(b); this.bursts.splice(i, 1); continue; }
      const k = b.life / b.max;
      const pos = b.geo.attributes.position.array;
      for (let j = 0; j < b.n; j++) {
        const i3 = j * 3;
        b.vel[i3 + 1] -= b.gravity * dt;
        pos[i3] += b.vel[i3] * dt;
        pos[i3 + 1] += b.vel[i3 + 1] * dt;
        pos[i3 + 2] += b.vel[i3 + 2] * dt;
      }
      b.geo.attributes.position.needsUpdate = true;
      b.mat.opacity = k;
      b.mat.size = b.size * (0.4 + 0.6 * k);
    }
  }

  // ------------------------------------------------------------ wall impacts
  // Re-test the ray against the colliders with a local slab test to recover
  // the hit face normal (collision.js is not modified; this is our own copy).
  wallImpact(origin, dir, dist) {
    let bestT = dist + 0.6;
    let normal = null;
    let hitBox = null;
    for (const b of this.game.colliders) {
      const h = rayBoxFace(origin, dir, b);
      if (h && h.t < bestT) { bestT = h.t; normal = h.normal; hitBox = b; }
    }
    if (!normal) { normal = dir.clone().negate(); bestT = dist; }
    const point = origin.clone().addScaledVector(dir, bestT);
    this.spawnBurst(point.clone().addScaledVector(normal, 0.02), {
      color: 0xffc46a, count: 8 + ((Math.random() * 5) | 0), speed: 2.6,
      size: 0.05, life: 0.2, gravity: 5, normal,
    });
    // no decals on temporary ability walls (they expire; decal would float)
    const isTempWall = hitBox && this.game.walls.some((w) => w.collider === hitBox);
    if (!isTempWall) this.spawnDecal(point, normal);
  }

  spawnDecal(point, normal) {
    const s = this._ensureShared();
    let m = this._decalPool.pop();
    if (!m) m = new THREE.Mesh(s.decalGeo, s.decalMat);
    m.position.copy(point).addScaledVector(normal, 0.01);
    m.quaternion.setFromUnitVectors(_Z, normal);
    m.rotateZ(Math.random() * Math.PI * 2);
    m.scale.setScalar(0.07 + Math.random() * 0.05);
    this.r.scene.add(m);
    this.decals.push(m);
    if (this.decals.length > MAX_DECALS) {
      const old = this.decals.shift();
      this.r.scene.remove(old);
      this._decalPool.push(old);
    }
  }

  // ------------------------------------------------------------ body hits
  bodyHit(point, part, kill) {
    const head = part === 'head';
    this.spawnBurst(point, {
      color: kill ? 0xd8353f : 0xb3202a,
      count: kill ? 14 : head ? 10 : 7,
      speed: kill ? 3.2 : head ? 2.6 : 2,
      size: kill ? 0.09 : head ? 0.075 : 0.06,
      life: kill ? 0.32 : 0.26,
      gravity: 3,
      additive: false,
    });
    if (head || kill) {
      // extra bright flick so heavy hits read at a glance
      this.spawnBurst(point, { color: 0xffd0a0, count: 5, speed: 1.6, size: 0.05, life: 0.15, gravity: 1 });
    }
  }

  // ------------------------------------------------------------ smoke visuals
  // Group of 3 nested soft shells; gameplay data ({pos, radius, until}) is
  // owned by game.smokes untouched — this is purely the mesh.
  makeSmokeMesh(radius) {
    const g = new THREE.Group();
    const shells = [
      { r: radius * 0.82, op: 0.92, color: 0xd8dde2, dw: true },
      { r: radius * 0.95, op: 0.50, color: 0xc9ced5, dw: false },
      { r: radius * 1.06, op: 0.22, color: 0xbfc6cf, dw: false },
    ];
    for (const sh of shells) {
      const mat = new THREE.MeshLambertMaterial({ color: sh.color, transparent: true, opacity: sh.op, depthWrite: sh.dw });
      const m = new THREE.Mesh(new THREE.SphereGeometry(sh.r, 18, 14), mat);
      m.userData.wob = {
        baseOp: sh.op,
        px: Math.random() * Math.PI * 2, py: Math.random() * Math.PI * 2, pz: Math.random() * Math.PI * 2,
        sx: 0.6 + Math.random() * 0.6, sy: 0.6 + Math.random() * 0.6, sz: 0.6 + Math.random() * 0.6,
        spin: (Math.random() - 0.5) * 0.24,
      };
      g.add(m);
    }
    g.userData.smoke = { age: 0 };
    return g;
  }

  _updateSmokes(dt) {
    for (const s of this.game.smokes) {
      const g = s.mesh;
      if (!g || !g.userData.smoke) continue;
      const u = g.userData.smoke;
      u.age += dt;
      const grow = Math.min(1, u.age / 0.3);
      const ease = 0.25 + 0.75 * (1 - (1 - grow) * (1 - grow)); // quick bloom-in
      const tl = s.until - this.game.now;
      const fade = tl < 0.6 ? Math.max(0, tl / 0.6) : 1;
      for (const c of g.children) {
        const w = c.userData.wob;
        if (!w) continue;
        c.scale.set(
          ease * (1 + Math.sin(this._t * w.sx + w.px) * 0.035),
          ease * (1 + Math.sin(this._t * w.sy + w.py) * 0.035),
          ease * (1 + Math.sin(this._t * w.sz + w.pz) * 0.035),
        );
        c.rotation.y += w.spin * dt;
        c.material.opacity = w.baseOp * fade * (0.94 + 0.06 * Math.sin(this._t * 1.4 + w.px));
      }
    }
  }

  // ------------------------------------------------------------ spike drama
  // Pulsing emissive spike + blinking red light. Root is a plain Mesh so the
  // existing _defuseSpike `sp.mesh.material.color.set(...)` keeps working.
  makeSpikeMesh() {
    const mat = new THREE.MeshStandardMaterial({ color: 0xff3040, emissive: 0xff2020, emissiveIntensity: 0.9 });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.5, 0.4), mat);
    const nub = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 8), new THREE.MeshBasicMaterial({ color: 0xff5050 }));
    nub.position.y = 0.3;
    mesh.add(nub);
    const light = new THREE.PointLight(0xff3030, 1.5, 9, 2);
    light.position.y = 0.6;
    mesh.add(light);
    mesh.userData.fx = { light, mat, nubMat: nub.material };
    return mesh;
  }

  _updateSpike() {
    const sp = this.game.spike;
    if (!sp || !sp.planted || !sp.mesh || !sp.mesh.userData.fx) return;
    const { light, mat, nubMat } = sp.mesh.userData.fx;
    if (sp.defused) {
      light.color.setHex(0x40ff60);
      light.intensity = 0.8;
      mat.emissive.setHex(0x1a6a2a);
      mat.emissiveIntensity = 0.8;
      nubMat.color.setHex(0x60ff80);
      return;
    }
    if (sp.exploded) { light.intensity = 0; return; }
    // blink faster as detonation approaches (phaseEnd was set at plant time)
    const timeLeft = Math.max(0, this.game.phaseEnd - this.game.now);
    const rate = timeLeft > 20 ? 1.6 : timeLeft > 10 ? 3 : timeLeft > 5 ? 6 : 12;
    const pulse = 0.5 + 0.5 * Math.sin(this._t * rate * Math.PI * 2);
    mat.emissiveIntensity = 0.5 + pulse * 1.8;
    light.intensity = 0.4 + pulse * 2.2;
    nubMat.color.setHex(pulse > 0.5 ? 0xff6060 : 0x551515);
  }

  // Detonation: expanding ground shockwave ring + hot flash + light pulse.
  // Purely visual — round outcome is decided by the caller.
  spikeDetonation(pos) {
    if (this.game.spike && this.game.spike.mesh) this.game.spike.mesh.visible = false;

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.85, 1, 48),
      new THREE.MeshBasicMaterial({ color: 0xff7a3a, transparent: true, opacity: 0.9, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(pos.x, 0.12, pos.z);
    this._addTimed(ring, 0.8, (e, k) => {
      const s = 1 + (1 - k) * 15;
      e.obj.scale.set(s, s, s);
      e.obj.material.opacity = 0.9 * k;
    });

    const flash = new THREE.Mesh(
      new THREE.SphereGeometry(1, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xfff0c8, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }),
    );
    flash.position.set(pos.x, 1, pos.z);
    this._addTimed(flash, 0.45, (e, k) => {
      const s = 0.8 + (1 - k) * 7;
      e.obj.scale.set(s, s, s);
      e.obj.material.opacity = 0.95 * k * k;
    });

    const light = new THREE.PointLight(0xff8a4a, 12, 45, 1.8);
    light.position.set(pos.x, 1.5, pos.z);
    this._addTimed(light, 0.5, (e, k) => { e.obj.intensity = 12 * k; });

    const up = pos.clone().setY(0.6);
    this.spawnBurst(up, { color: 0xffb050, count: 16, speed: 9, size: 0.14, life: 0.55, gravity: 8, normal: _Y });
    this.spawnBurst(up, { color: 0xff5030, count: 12, speed: 5, size: 0.18, life: 0.45, gravity: 4, normal: _Y });
  }

  // ------------------------------------------------------------ timed one-shots
  _addTimed(obj, max, tick) {
    this.r.scene.add(obj);
    this.timed.push({ obj, life: max, max, tick });
  }

  _disposeTimed(e) {
    this.r.scene.remove(e.obj);
    if (e.obj.geometry) e.obj.geometry.dispose();
    if (e.obj.material) e.obj.material.dispose();
    if (typeof e.obj.dispose === 'function') e.obj.dispose(); // lights
  }

  _updateTimed(dt) {
    for (let i = this.timed.length - 1; i >= 0; i--) {
      const e = this.timed[i];
      e.life -= dt;
      if (e.life <= 0) { this._disposeTimed(e); this.timed.splice(i, 1); continue; }
      e.tick(e, e.life / e.max);
    }
  }

  // ------------------------------------------------------------ reset
  clear() {
    const scene = this.r.scene;
    for (const t of this.tracers) scene.remove(t.group);
    for (const t of this.tracers.concat(this._tracerPool)) { t.glowMat.dispose(); t.coreMat.dispose(); }
    this.tracers = []; this._tracerPool = [];

    for (const b of this.bursts) scene.remove(b.points);
    for (const b of this.bursts.concat(this._burstPool)) { b.geo.dispose(); b.mat.dispose(); }
    this.bursts = []; this._burstPool = [];

    for (const d of this.decals) scene.remove(d);
    this.decals = []; this._decalPool = [];

    for (const e of this.timed) this._disposeTimed(e);
    this.timed = [];

    if (this._shared) {
      this._shared.beamGeo.dispose();
      this._shared.decalGeo.dispose();
      this._shared.decalMat.dispose();
      this._shared.decalTex.dispose();
      this._shared.sparkTex.dispose();
      this._shared = null;
    }
    // smoke/spike meshes are owned by game.smokes / game.spike and removed
    // by Game itself (_clearEffects / _startRound) via _removeMesh.
  }
}

// ---------------------------------------------------------------- helpers
// Local slab test that also reports the entry face normal. Deliberately a
// standalone copy so collision.js stays untouched.
function rayBoxFace(origin, dir, b) {
  let tmin = -Infinity;
  let tmax = Infinity;
  let axis = null;
  for (const ax of ['x', 'y', 'z']) {
    const o = origin[ax];
    const d = dir[ax];
    const mn = b.min[ax];
    const mx = b.max[ax];
    if (Math.abs(d) < 1e-8) {
      if (o < mn || o > mx) return null;
    } else {
      let t1 = (mn - o) / d;
      let t2 = (mx - o) / d;
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      if (t1 > tmin) { tmin = t1; axis = ax; }
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return null;
    }
  }
  if (tmax < 0 || axis === null || tmin <= 0) return null; // behind or inside
  const normal = new THREE.Vector3();
  normal[axis] = dir[axis] > 0 ? -1 : 1;
  return { t: tmin, normal };
}

// soft round bullet hole: dark center fading to transparent edge
function makeDecalTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 32);
  g.addColorStop(0, 'rgba(12,10,9,0.95)');
  g.addColorStop(0.45, 'rgba(22,19,17,0.85)');
  g.addColorStop(0.75, 'rgba(30,27,24,0.35)');
  g.addColorStop(1, 'rgba(30,27,24,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// soft round bright dot for particle sprites
function makeSparkTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(16, 16, 1, 16, 16, 16);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.7)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(c);
}
