import * as THREE from 'three';

// Procedural combat feedback: impact sparks + hot glow dots + dust puffs,
// bullet-hole decals, layered blood puffs with kill shock-rings, tapered
// hot-core tracers with muzzle streaks and ricochets, layered smoke shells
// and spike drama (double-blink pulse, pillar-of-light detonation).
// Everything is pooled and capped; per-frame updates run from
// Game.renderExtras via update(dt); clear() empties every pool and disposes
// GPU resources (called from Game._clearEffects on round start / match load).
//
// This module never touches gameplay data. It only reads game.colliders /
// game.walls / game.smokes / game.spike to place visuals.

const MAX_DECALS = 64;
const MAX_BURSTS = 32;
const MAX_TRACERS = 56; // main beams + muzzle streaks + ricochets share one pool
const MAX_DOTS = 24;    // brief additive glow flashes (impacts, headshots)
const MAX_RINGS = 12;   // expanding shock rings (kills, detonation)
const BURST_N = 16;     // particles per burst (fixed buffer size)

const _Y = new THREE.Vector3(0, 1, 0);
const _Z = new THREE.Vector3(0, 0, 1);
// scratch vectors: spawn-time helpers only, never used across frames
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();

// slight per-shot spark tint variation so autofire doesn't strobe uniformly
const SPARK_COLORS = [0xffc46a, 0xffd685, 0xffab55];

export class EffectsSystem {
  constructor(game) {
    this.game = game;
    this.r = game.r;
    this._t = 0; // effect-local clock (advances every rendered frame)

    this.tracers = [];
    this._tracerPool = [];
    this.bursts = [];
    this._burstPool = { spark: [], puff: [] }; // keyed by texture so pooled materials never swap maps
    this.decals = [];
    this._decalPool = [];
    this.dots = [];
    this._dotPool = [];
    this.rings = [];
    this._ringPool = [];
    this.timed = [];    // one-shot animated meshes (flashes, pillars, lights)
    this._pending = []; // delayed spawn callbacks (e.g. staggered ember bursts)

    this._shared = null; // lazily built shared geometries/textures/materials
  }

  // ------------------------------------------------------------ shared GPU resources
  _ensureShared() {
    if (this._shared) return this._shared;
    const decalTex = makeDecalTexture();
    const sparkTex = makeSparkTexture();
    const puffTex = makePuffTexture();
    this._shared = {
      // unit-height tapered beam, +Y (radiusTop) points at the target
      beamGeo: new THREE.CylinderGeometry(0.012, 0.03, 1, 6, 1, true),
      decalGeo: new THREE.PlaneGeometry(1, 1), // also reused by glow dots
      ringGeo: new THREE.RingGeometry(0.82, 1, 48),
      pillarGeo: new THREE.CylinderGeometry(1, 1.25, 1, 20, 1, true),
      sphereGeo: new THREE.SphereGeometry(1, 16, 12),
      decalTex,
      sparkTex,
      puffTex,
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
    this._updatePending(dt);
    this._updateTracers(dt);
    this._updateBursts(dt);
    this._updateDots(dt);
    this._updateRings(dt);
    this._updateTimed(dt);
    this._updateSmokes(dt);
    this._updateSpike();
  }

  // ------------------------------------------------------------ delayed one-shot spawns
  _schedule(delay, fn) {
    this._pending.push({ t: delay, fn });
  }

  _updatePending(dt) {
    for (let i = this._pending.length - 1; i >= 0; i--) {
      const p = this._pending[i];
      p.t -= dt;
      if (p.t <= 0) {
        this._pending[i] = this._pending[this._pending.length - 1];
        this._pending.pop();
        p.fn();
      }
    }
  }

  // ------------------------------------------------------------ tracers
  // Same signature/behavior contract as before: additive, fog-less, pooled,
  // faded per frame. Thin tapered beam with a hot near-white core, subtle
  // length-based brightness, plus a 1-frame hot streak hugging the muzzle.
  spawnTracer(a, b) {
    const dist = a.distanceTo(b);
    if (dist < 0.1) return;
    // long shots read hotter; point-blank ones stay subdued
    const lenK = Math.min(1, dist / 26);
    this._spawnBeam(a, b, {
      life: 0.11, width: 1,
      glowColor: 0xffb36b, coreColor: 0xfff8e0,
      glowOp: 0.6 + 0.3 * lenK, coreOp: 0.78 + 0.22 * lenK,
    });
    // near-instant bright streak at the origin sells the muzzle snap
    const streakLen = Math.min(1.3, dist * 0.35);
    _v1.copy(b).sub(a).normalize();
    _v2.copy(a).addScaledVector(_v1, streakLen);
    this._spawnBeam(a, _v2, {
      life: 0.045, width: 1.6,
      glowColor: 0xffd9a0, coreColor: 0xffffff,
      glowOp: 0.9, coreOp: 1,
    });
  }

  // internal beam variant used by tracers, muzzle streaks and ricochets
  _spawnBeam(a, b, o) {
    const dist = a.distanceTo(b);
    if (dist < 0.05) return;
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
      t = { group, glowMat, coreMat, life: 0, max: 0.11, baseGlow: 0.85, baseCore: 0.95, width: 1 };
    }
    t.life = t.max = o.life;
    t.baseGlow = o.glowOp;
    t.baseCore = o.coreOp;
    t.width = o.width;
    t.glowMat.color.setHex(o.glowColor);
    t.coreMat.color.setHex(o.coreColor);
    t.group.position.copy(a).add(b).multiplyScalar(0.5);
    t.group.quaternion.setFromUnitVectors(_Y, _v3.copy(b).sub(a).normalize());
    t.group.scale.set(o.width, dist, o.width);
    t.glowMat.opacity = o.glowOp;
    t.coreMat.opacity = o.coreOp;
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
      if (t.life <= 0) {
        this._releaseTracer(t);
        this.tracers[i] = this.tracers[this.tracers.length - 1];
        this.tracers.pop();
        continue;
      }
      const k = t.life / t.max;
      t.glowMat.opacity = t.baseGlow * k * k; // glow dies fast
      t.coreMat.opacity = t.baseCore * k;
      const r = t.width * (0.55 + 0.45 * k); // beam thins as it fades
      t.group.scale.x = r; t.group.scale.z = r;
    }
  }

  // ------------------------------------------------------------ particle bursts
  _getBurst(texKey) {
    let b = this._burstPool[texKey].pop();
    if (!b) {
      const s = this._ensureShared();
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(BURST_N * 3), 3));
      const mat = new THREE.PointsMaterial({
        size: 0.06, map: texKey === 'puff' ? s.puffTex : s.sparkTex, transparent: true, opacity: 1,
        depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true, fog: false,
      });
      const points = new THREE.Points(geo, mat);
      points.frustumCulled = false;
      b = {
        points, geo, mat, texKey, vel: new Float32Array(BURST_N * 3),
        n: 0, life: 0, max: 1, gravity: 0, drag: 0, size: 0.06, baseOp: 1, grow: false,
      };
    }
    return b;
  }

  _releaseBurst(b) {
    this.r.scene.remove(b.points);
    this._burstPool[b.texKey].push(b);
  }

  // opts: { color, count, speed, size, life, gravity, normal?, additive?,
  //         tex? ('spark'|'puff'), drag?, opacity?, grow? }
  // New keys are optional and default to the original behavior.
  spawnBurst(point, opts) {
    if (this.bursts.length >= MAX_BURSTS) this._releaseBurst(this.bursts.shift());
    const b = this._getBurst(opts.tex === 'puff' ? 'puff' : 'spark');
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
    b.baseOp = opts.opacity ?? 1;
    b.mat.opacity = b.baseOp;
    b.life = b.max = opts.life ?? 0.2;
    b.gravity = opts.gravity ?? 4;
    b.drag = opts.drag ?? 0;
    b.grow = opts.grow === true; // puffs expand; sparks shrink
    this.r.scene.add(b.points);
    this.bursts.push(b);
  }

  _updateBursts(dt) {
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i];
      b.life -= dt;
      if (b.life <= 0) {
        this._releaseBurst(b);
        this.bursts[i] = this.bursts[this.bursts.length - 1];
        this.bursts.pop();
        continue;
      }
      const k = b.life / b.max;
      const damp = b.drag > 0 ? Math.max(0, 1 - b.drag * dt) : 1;
      const pos = b.geo.attributes.position.array;
      for (let j = 0; j < b.n; j++) {
        const i3 = j * 3;
        b.vel[i3] *= damp;
        b.vel[i3 + 1] = b.vel[i3 + 1] * damp - b.gravity * dt;
        b.vel[i3 + 2] *= damp;
        pos[i3] += b.vel[i3] * dt;
        pos[i3 + 1] += b.vel[i3 + 1] * dt;
        pos[i3 + 2] += b.vel[i3 + 2] * dt;
      }
      b.geo.attributes.position.needsUpdate = true;
      b.mat.opacity = b.baseOp * k;
      b.mat.size = b.size * (b.grow ? 1 + (1 - k) * 0.9 : 0.4 + 0.6 * k);
    }
  }

  // ------------------------------------------------------------ glow dots
  // Tiny camera-facing additive flashes: the hot spot where a bullet lands,
  // the headshot flick. Pooled planes on the shared unit quad.
  _spawnDot(point, o) { // { color, size, life, op }
    if (this.dots.length >= MAX_DOTS) this._releaseDot(this.dots.shift());
    const s = this._ensureShared();
    let d = this._dotPool.pop();
    if (!d) {
      const mat = new THREE.MeshBasicMaterial({
        map: s.sparkTex, color: 0xffffff, transparent: true, opacity: 1,
        blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
      });
      d = { mesh: new THREE.Mesh(s.decalGeo, mat), mat, life: 0, max: 1, size: 0.1, baseOp: 1 };
    }
    d.life = d.max = o.life;
    d.size = o.size;
    d.baseOp = o.op;
    d.mat.color.setHex(o.color);
    d.mat.opacity = o.op;
    d.mesh.position.copy(point);
    d.mesh.quaternion.copy(this.r.camera.quaternion);
    d.mesh.scale.setScalar(o.size);
    this.r.scene.add(d.mesh);
    this.dots.push(d);
  }

  _releaseDot(d) {
    this.r.scene.remove(d.mesh);
    this._dotPool.push(d);
  }

  _updateDots(dt) {
    const cam = this.r.camera;
    for (let i = this.dots.length - 1; i >= 0; i--) {
      const d = this.dots[i];
      d.life -= dt;
      if (d.life <= 0) {
        this._releaseDot(d);
        this.dots[i] = this.dots[this.dots.length - 1];
        this.dots.pop();
        continue;
      }
      const k = d.life / d.max;
      d.mesh.quaternion.copy(cam.quaternion);
      d.mat.opacity = d.baseOp * k * k; // hot flash: fast falloff
      d.mesh.scale.setScalar(d.size * (0.6 + 0.4 * k));
    }
  }

  // ------------------------------------------------------------ shock rings
  // Pooled expanding rings: camera-billboarded for kill confirms, flat on the
  // ground for the spike detonation (supports a spawn delay for echo waves).
  _spawnRing(pos, o) { // { from, to, life, color, op, billboard?, delay? }
    if (this.rings.length >= MAX_RINGS) this._releaseRing(this.rings.shift());
    const s = this._ensureShared();
    let r = this._ringPool.pop();
    if (!r) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 1, side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
      });
      r = { mesh: new THREE.Mesh(s.ringGeo, mat), mat, life: 0, max: 1, from: 1, to: 2, baseOp: 1, billboard: false, delay: 0 };
    }
    r.life = r.max = o.life;
    r.delay = o.delay ?? 0;
    r.from = o.from;
    r.to = o.to;
    r.baseOp = o.op;
    r.billboard = o.billboard === true;
    r.mesh.position.copy(pos);
    if (r.billboard) {
      r.mesh.quaternion.copy(this.r.camera.quaternion);
    } else {
      r.mesh.rotation.set(-Math.PI / 2, 0, 0); // flat ground wave
    }
    r.mat.color.setHex(o.color);
    r.mat.opacity = r.delay > 0 ? 0 : o.op;
    r.mesh.visible = r.delay <= 0;
    r.mesh.scale.setScalar(o.from);
    this.r.scene.add(r.mesh);
    this.rings.push(r);
  }

  _releaseRing(r) {
    this.r.scene.remove(r.mesh);
    this._ringPool.push(r);
  }

  _updateRings(dt) {
    const cam = this.r.camera;
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      if (r.delay > 0) {
        r.delay -= dt;
        if (r.delay <= 0) { r.mesh.visible = true; r.mat.opacity = r.baseOp; }
        else continue;
      }
      r.life -= dt;
      if (r.life <= 0) {
        this._releaseRing(r);
        this.rings[i] = this.rings[this.rings.length - 1];
        this.rings.pop();
        continue;
      }
      const k = r.life / r.max;
      if (r.billboard) r.mesh.quaternion.copy(cam.quaternion);
      r.mesh.scale.setScalar(r.from + (r.to - r.from) * (1 - k * k)); // ease-out expansion
      r.mat.opacity = r.baseOp * k;
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
    // hot metal sparks kicked off the surface
    this.spawnBurst(_v1.copy(point).addScaledVector(normal, 0.02), {
      color: SPARK_COLORS[(Math.random() * SPARK_COLORS.length) | 0],
      count: 9 + ((Math.random() * 5) | 0), speed: 3,
      size: 0.05, life: 0.22, gravity: 7, normal,
    });
    // neutral dark dust puff drifting off the wall
    this.spawnBurst(_v1.copy(point).addScaledVector(normal, 0.05), {
      tex: 'puff', additive: false, color: 0x39352f, count: 5, speed: 0.85,
      size: 0.17, life: 0.5, gravity: -0.35, drag: 2.2, opacity: 0.55, grow: true, normal,
    });
    // brief hot glow dot right at the impact point
    this._spawnDot(_v1.copy(point).addScaledVector(normal, 0.03), {
      color: 0xffb050, size: 0.1 + Math.random() * 0.05, life: 0.12, op: 0.9,
    });
    // occasional ricochet: short bright streak at a jittered reflected angle
    if (Math.random() < 0.3) {
      const d = dir.x * normal.x + dir.y * normal.y + dir.z * normal.z;
      _v2.copy(dir).addScaledVector(normal, -2 * d);
      _v2.x += (Math.random() - 0.5) * 0.4;
      _v2.y += (Math.random() - 0.5) * 0.4;
      _v2.z += (Math.random() - 0.5) * 0.4;
      _v2.normalize();
      _v3.copy(point).addScaledVector(_v2, 1.2 + Math.random() * 2.2);
      this._spawnBeam(point, _v3, {
        life: 0.09, width: 0.45,
        glowColor: 0xffc070, coreColor: 0xfff0d8, glowOp: 0.7, coreOp: 0.8,
      });
    }
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
    // varied size and slightly irregular aspect so holes don't look stamped
    const base = 0.06 + Math.random() * 0.08;
    m.scale.set(base * (0.85 + Math.random() * 0.3), base * (0.85 + Math.random() * 0.3), 1);
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
    // dark heavy core droplets
    this.spawnBurst(point, {
      additive: false,
      color: kill ? 0x8c1620 : 0x771219,
      count: kill ? 12 : head ? 9 : 7,
      speed: kill ? 2.6 : head ? 2.1 : 1.9,
      size: kill ? 0.075 : head ? 0.065 : 0.06,
      life: kill ? 0.3 : 0.26,
      gravity: 5, drag: 1.2,
    });
    // lighter lingering mist around the wound
    this.spawnBurst(point, {
      tex: 'puff', additive: false,
      color: kill ? 0xa03038 : 0x942b33,
      count: kill ? 8 : 5, speed: 1.1,
      size: kill ? 0.16 : 0.12, life: 0.34,
      gravity: 1.2, drag: 2.5, opacity: 0.5, grow: true,
    });
    if (kill) {
      // camera-facing shock ring makes kill confirms read instantly
      this._spawnRing(point, { from: 0.12, to: 0.95, life: 0.28, color: 0xff5648, op: 0.85, billboard: true });
      this.spawnBurst(point, { color: 0xffd0a0, count: 6, speed: 2.2, size: 0.06, life: 0.18, gravity: 2 });
    }
    if (head) {
      // tiny bright flick so headshots read at a glance
      this._spawnDot(point, { color: 0xffe6c0, size: 0.16, life: 0.1, op: 1 });
      this.spawnBurst(point, { color: 0xffd0a0, count: 4, speed: 1.6, size: 0.045, life: 0.14, gravity: 1 });
    }
  }

  // ------------------------------------------------------------ smoke visuals
  // Group of nested soft shells plus a flattened base skirt and a bright top
  // highlight cap; gameplay data ({pos, radius, until}) is owned by
  // game.smokes untouched — this is purely the mesh.
  makeSmokeMesh(radius) {
    const g = new THREE.Group();
    const shells = [
      { r: radius * 0.82, op: 0.92, color: 0xd8dde2, dw: true, fy: 1, y: 0 },
      { r: radius * 0.95, op: 0.50, color: 0xc9ced5, dw: false, fy: 1, y: 0 },
      { r: radius * 1.06, op: 0.22, color: 0xbfc6cf, dw: false, fy: 1, y: 0 },
      // soft skirt hugging the ground where the smoke pools
      { r: radius * 0.98, op: 0.34, color: 0xaab0b8, dw: false, fy: 0.3, y: -radius * 0.52 },
      // bright cap where ambient light catches the top of the plume
      { r: radius * 0.46, op: 0.34, color: 0xf2f5f8, dw: false, fy: 0.85, y: radius * 0.55 },
    ];
    for (const sh of shells) {
      const mat = new THREE.MeshLambertMaterial({ color: sh.color, transparent: true, opacity: sh.op, depthWrite: sh.dw });
      const m = new THREE.Mesh(new THREE.SphereGeometry(sh.r, 18, 14), mat);
      m.position.y = sh.y;
      m.userData.wob = {
        baseOp: sh.op, fy: sh.fy,
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
    const smokes = this.game.smokes;
    for (let si = 0; si < smokes.length; si++) {
      const s = smokes[si];
      const g = s.mesh;
      if (!g || !g.userData.smoke) continue;
      const u = g.userData.smoke;
      u.age += dt;
      const grow = Math.min(1, u.age / 0.3);
      const ease = 0.25 + 0.75 * (1 - (1 - grow) * (1 - grow)); // quick bloom-in
      const tl = s.until - this.game.now;
      const fade = tl < 0.6 ? Math.max(0, tl / 0.6) : 1; // edge fade on expiry
      for (let ci = 0; ci < g.children.length; ci++) {
        const c = g.children[ci];
        const w = c.userData.wob;
        if (!w) continue;
        c.scale.set(
          ease * (1 + Math.sin(this._t * w.sx + w.px) * 0.035),
          ease * w.fy * (1 + Math.sin(this._t * w.sy + w.py) * 0.035),
          ease * (1 + Math.sin(this._t * w.sz + w.pz) * 0.035),
        );
        c.rotation.y += w.spin * dt;
        c.material.opacity = w.baseOp * fade * (0.94 + 0.06 * Math.sin(this._t * 1.4 + w.px));
      }
    }
  }

  // ------------------------------------------------------------ spike drama
  // Pulsing emissive spike + blinking red light + additive energy halo and a
  // planted-telegraph ground ring. Root is a plain Mesh so the existing
  // _defuseSpike `sp.mesh.material.color.set(...)` keeps working. Child
  // materials carry no textures — game._removeMesh disposes geometry and
  // materials only, so textures here would leak.
  makeSpikeMesh() {
    const mat = new THREE.MeshStandardMaterial({ color: 0xff3040, emissive: 0xff2020, emissiveIntensity: 0.9 });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.5, 0.4), mat);
    const nub = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 8), new THREE.MeshBasicMaterial({ color: 0xff5050 }));
    nub.position.y = 0.3;
    mesh.add(nub);
    // additive halo around the nub — bloom picks this up on every pulse
    const haloMat = new THREE.MeshBasicMaterial({ color: 0xff4030, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    const halo = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), haloMat);
    halo.position.y = 0.3;
    mesh.add(halo);
    // flat telegraph ring on the ground under the spike
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xff3828, transparent: true, opacity: 0.25, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.62, 32), ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = -0.22;
    mesh.add(ring);
    const light = new THREE.PointLight(0xff3030, 1.5, 9, 2);
    light.position.y = 0.6;
    mesh.add(light);
    mesh.userData.fx = { light, mat, nubMat: nub.material, haloMat, halo, ringMat };
    return mesh;
  }

  _updateSpike() {
    const sp = this.game.spike;
    if (!sp || !sp.planted || !sp.mesh || !sp.mesh.userData.fx) return;
    const { light, mat, nubMat, haloMat, halo, ringMat } = sp.mesh.userData.fx;
    if (sp.defused) {
      light.color.setHex(0x40ff60);
      light.intensity = 0.8;
      mat.emissive.setHex(0x1a6a2a);
      mat.emissiveIntensity = 0.8;
      nubMat.color.setHex(0x60ff80);
      haloMat.color.setHex(0x40ff60);
      haloMat.opacity = 0.2;
      halo.scale.setScalar(1);
      ringMat.color.setHex(0x40ff60);
      ringMat.opacity = 0.2;
      return;
    }
    if (sp.exploded) {
      light.intensity = 0;
      haloMat.opacity = 0;
      ringMat.opacity = 0;
      return;
    }
    // pulse quickens as detonation approaches (phaseEnd was set at plant time);
    // under 10s the single sine hardens into an urgent double-blink pattern
    const timeLeft = Math.max(0, this.game.phaseEnd - this.game.now);
    const rate = timeLeft > 20 ? 1.4 : timeLeft > 10 ? 2.4 : timeLeft > 5 ? 4 : 7;
    const ph = (this._t * rate) % 1;
    const pulse = timeLeft > 10
      ? 0.5 + 0.5 * Math.sin(ph * Math.PI * 2)
      : Math.max(
        Math.exp(-((ph - 0.1) * (ph - 0.1)) / 0.006),
        Math.exp(-((ph - 0.34) * (ph - 0.34)) / 0.006),
      );
    mat.emissiveIntensity = 0.5 + pulse * 1.9;
    light.intensity = 0.4 + pulse * 2.4;
    nubMat.color.setHex(pulse > 0.5 ? 0xff6060 : 0x551515);
    haloMat.opacity = 0.12 + pulse * 0.5;
    halo.scale.setScalar(0.85 + pulse * 0.5);
    ringMat.opacity = 0.1 + pulse * 0.4;
  }

  // Detonation: expanding ground shockwave (plus a delayed echo ring), hot
  // flash, vertical pillar of light and staggered ember bursts. One light
  // pulse total — no extra PointLights. Purely visual — round outcome is
  // decided by the caller.
  spikeDetonation(pos) {
    if (this.game.spike && this.game.spike.mesh) this.game.spike.mesh.visible = false;
    const s = this._ensureShared();

    // primary shockwave + delayed echo ring (pooled ground rings)
    _v1.set(pos.x, 0.12, pos.z);
    this._spawnRing(_v1, { from: 1, to: 16, life: 0.8, color: 0xff7a3a, op: 0.9 });
    this._spawnRing(_v1, { from: 0.6, to: 11, life: 0.7, color: 0xffd080, op: 0.7, delay: 0.14 });

    // hot core flash
    const flash = new THREE.Mesh(
      s.sphereGeo,
      new THREE.MeshBasicMaterial({ color: 0xfff0c8, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }),
    );
    flash.position.set(pos.x, 1, pos.z);
    this._addTimed(flash, 0.45, (e, k) => {
      const sc = 0.8 + (1 - k) * 7;
      e.obj.scale.set(sc, sc, sc);
      e.obj.material.opacity = 0.95 * k * k;
    }, { sharedGeo: true });

    // vertical pillar of light rising from the site
    const pillar = new THREE.Mesh(
      s.pillarGeo,
      new THREE.MeshBasicMaterial({ color: 0xffb673, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }),
    );
    pillar.scale.set(1.1, 16, 1.1);
    pillar.position.set(pos.x, 8, pos.z);
    this._addTimed(pillar, 0.6, (e, k) => {
      const w = 1.1 + (1 - k) * 1.6;
      e.obj.scale.x = w; e.obj.scale.z = w;
      e.obj.material.opacity = 0.7 * k * k;
    }, { sharedGeo: true });

    // single light pulse (kept from before — the only PointLight here)
    const light = new THREE.PointLight(0xff8a4a, 12, 45, 1.8);
    light.position.set(pos.x, 1.5, pos.z);
    this._addTimed(light, 0.5, (e, k) => { e.obj.intensity = 12 * k; });

    // blast debris + dark smoke column, then staggered rising ember waves
    const up = pos.clone().setY(0.6);
    this.spawnBurst(up, { color: 0xffb050, count: 16, speed: 9, size: 0.14, life: 0.55, gravity: 8, normal: _Y });
    this.spawnBurst(up, { color: 0xff5030, count: 12, speed: 5, size: 0.18, life: 0.45, gravity: 4, normal: _Y });
    this.spawnBurst(up, { tex: 'puff', additive: false, color: 0x2c2824, count: 10, speed: 2.4, size: 0.5, life: 0.9, gravity: -0.6, drag: 1.6, opacity: 0.5, grow: true, normal: _Y });
    this._schedule(0.12, () => {
      this.spawnBurst(up, { color: 0xff7030, count: 14, speed: 3.4, size: 0.1, life: 1, gravity: -1.4, drag: 1.4, normal: _Y });
    });
    this._schedule(0.26, () => {
      this.spawnBurst(up, { color: 0xffc060, count: 10, speed: 2.2, size: 0.08, life: 1.1, gravity: -1.1, drag: 1.2, normal: _Y });
    });
  }

  // ------------------------------------------------------------ timed one-shots
  _addTimed(obj, max, tick, opts) {
    this.r.scene.add(obj);
    this.timed.push({ obj, life: max, max, tick, sharedGeo: !!(opts && opts.sharedGeo) });
  }

  _disposeTimed(e) {
    this.r.scene.remove(e.obj);
    if (e.obj.geometry && !e.sharedGeo) e.obj.geometry.dispose();
    if (e.obj.material) e.obj.material.dispose();
    if (typeof e.obj.dispose === 'function') e.obj.dispose(); // lights
  }

  _updateTimed(dt) {
    for (let i = this.timed.length - 1; i >= 0; i--) {
      const e = this.timed[i];
      e.life -= dt;
      if (e.life <= 0) {
        this._disposeTimed(e);
        this.timed[i] = this.timed[this.timed.length - 1];
        this.timed.pop();
        continue;
      }
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
    for (const b of this.bursts.concat(this._burstPool.spark, this._burstPool.puff)) { b.geo.dispose(); b.mat.dispose(); }
    this.bursts = []; this._burstPool = { spark: [], puff: [] };

    for (const d of this.decals) scene.remove(d);
    this.decals = []; this._decalPool = [];

    for (const d of this.dots) scene.remove(d.mesh);
    for (const d of this.dots.concat(this._dotPool)) d.mat.dispose();
    this.dots = []; this._dotPool = [];

    for (const r of this.rings) scene.remove(r.mesh);
    for (const r of this.rings.concat(this._ringPool)) r.mat.dispose();
    this.rings = []; this._ringPool = [];

    for (const e of this.timed) this._disposeTimed(e);
    this.timed = [];
    this._pending = [];

    if (this._shared) {
      this._shared.beamGeo.dispose();
      this._shared.decalGeo.dispose();
      this._shared.ringGeo.dispose();
      this._shared.pillarGeo.dispose();
      this._shared.sphereGeo.dispose();
      this._shared.decalMat.dispose();
      this._shared.decalTex.dispose();
      this._shared.sparkTex.dispose();
      this._shared.puffTex.dispose();
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

// soft round bright dot for particle sprites and glow flashes
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

// irregular soft blob (overlapping offset gradients) for dust/mist puffs;
// tinted per-burst via material color
function makePuffTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  for (let i = 0; i < 5; i++) {
    const x = 32 + (Math.random() - 0.5) * 18;
    const y = 32 + (Math.random() - 0.5) * 18;
    const r = 12 + Math.random() * 10;
    const g = ctx.createRadialGradient(x, y, 1, x, y, r);
    g.addColorStop(0, 'rgba(255,255,255,0.55)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
  }
  return new THREE.CanvasTexture(c);
}
