import * as THREE from 'three';
import { bus } from '../engine/eventbus.js';
import { buildMap } from '../maps/mapbuilder.js';
import { getMapById } from '../maps/maps.js';
import { modeById, GUNGAME_LADDER } from './modes.js';
import { AGENTS, agentById } from '../agents/agents.js';
import { Entity, buildAvatar } from './entity.js';
import { PlayerController } from './player.js';
import { updateBot, initBot } from './bots.js';
import { audio } from '../audio/audio.js';
import { weaponById, ARMOR } from '../weapons/weapons.js';
import { startReload } from '../weapons/weaponsystem.js';
import { EffectsSystem } from './effects.js';

const BUY_TIME = 20;
const LIVE_TIME = 100;
const ROUND_END_TIME = 5;
const SPIKE_TIME = 45;
const PLANT_TIME = 4;
const DEFUSE_TIME = 7;

export class Game {
  constructor(renderer, input) {
    this.r = renderer;
    this.input = input;
    this.state = 'menu'; // menu | playing
    this.now = 0;
    this.entities = [];
    this.colliders = [];
    this.player = null;
    this.pc = new PlayerController(this, input, renderer.camera);
    this.settings = defaultSettings();
    this.buyOpen = false;
    this.scopeActive = false;

    // effect pools (tracers/decals live in EffectsSystem)
    this.flashes = [];
    this.smokes = [];
    this.zones = [];
    this.walls = [];
    this.turrets = [];
    this.traps = [];
    this.reveals = [];
    this.fx = new EffectsSystem(this);

    this._bindKeys();
  }

  defaultSettingsPublic() { return defaultSettings(); }

  // ---------------------------------------------------------------- match
  loadMatch(cfg) {
    this.r.clearScene();
    this._clearEffects();
    this._matchToken = (this._matchToken || 0) + 1;
    this.entities = [];
    this.colliders = [];
    this.settings = { ...defaultSettings(), ...cfg.settings };
    this.mode = modeById(cfg.modeId);
    this.map = getMapById(cfg.mapId);
    this.cfg = cfg;

    const built = buildMap(this.r.scene, this.map);
    this.colliders = built.colliders;
    this.mapMeta = built;

    // scores
    this.attackerScore = 0;
    this.defenderScore = 0;
    this.roundNum = 0;
    this.playerSide = this.mode.kind === 'plant' ? 'att' : (this.mode.teamBased ? 'att' : 'ffa');
    this.matchOver = false;

    this._createEntities(cfg);
    this.state = 'playing';
    this._startRound(true);
    bus.emit('match:start', { mode: this.mode, map: this.map });
  }

  _createEntities(cfg) {
    const playerAgent = agentById(cfg.playerAgentId);
    const teamSize = this.mode.kind === 'plant' || this.mode.kind === 'tdm' ? 5 : 1;
    const usedAgents = new Set([playerAgent.id]);

    if (this.mode.kind === 'ffa' || this.mode.kind === 'gungame') {
      // Player + N bots, all enemies
      this.player = new Entity({ isPlayer: true, team: 'ffa', agent: playerAgent, name: 'Du' });
      this.entities.push(this.player);
      const n = this.settings.botCount ?? 9;
      for (let i = 0; i < n; i++) {
        const e = new Entity({ team: 'ffa', agent: this._randomAgent(usedAgents, false), name: this._botName(i) });
        initBot(e);
        this.entities.push(e);
      }
    } else {
      // teams att/def
      this.player = new Entity({ isPlayer: true, team: 'att', agent: playerAgent, name: 'Du' });
      this.entities.push(this.player);
      for (let i = 1; i < teamSize; i++) {
        const e = new Entity({ team: 'att', agent: this._randomAgent(usedAgents), name: this._botName(i) });
        initBot(e);
        this.entities.push(e);
      }
      for (let i = 0; i < teamSize; i++) {
        const e = new Entity({ team: 'def', agent: this._randomAgent(usedAgents), name: this._botName(teamSize + i) });
        initBot(e);
        this.entities.push(e);
      }
    }
    this.pc.attach(this.player);

    // meshes for non-players
    for (const e of this.entities) {
      if (e.isPlayer) continue;
      e.mesh = buildAvatar(e.color, e.agent);
      this.r.scene.add(e.mesh);
    }
    // starting credits
    for (const e of this.entities) e.credits = this.mode.startCredits ?? 800;
    if (this.settings.godMode) this.player.invulnerable = true;
  }

  _randomAgent(used, unique = true) {
    let pool = AGENTS;
    if (unique) pool = AGENTS.filter((a) => !used.has(a.id));
    if (pool.length === 0) pool = AGENTS;
    const a = pool[Math.floor(Math.random() * pool.length)];
    if (unique) used.add(a.id);
    return a;
  }

  _botName(i) {
    const names = ['Kolle', 'Rudi', 'Heidi', 'Otto', 'Lena', 'Kurt', 'Mila', 'Falk', 'Sven', 'Nina', 'Uwe', 'Tessa', 'Bruno', 'Gerd', 'Ilse', 'Jonas', 'Karla', 'Timo'];
    return names[i % names.length];
  }

  // ---------------------------------------------------------------- rounds
  _startRound(first) {
    this.roundNum++;
    this.phase = this.mode.buy ? 'buy' : 'live';
    this.phaseEnd = this.now + (this.mode.buy ? BUY_TIME : LIVE_TIME);
    this.roundWinner = null;
    if (this.spike && this.spike.mesh) this._removeMesh(this.spike.mesh);
    this.spike = null;
    this.buyOpen = false;
    this._clearEffects();

    // side handling / spawns
    const teams = { att: [], def: [], ffa: [] };
    for (const e of this.entities) teams[e.team].push(e);

    // give economy at round start
    for (const e of this.entities) {
      // In plant modes players who died last round lose their loadout; other
      // modes always keep a fresh full loadout.
      const keep = this.mode.kind === 'plant' ? e.alive : true;
      e._deadCounted = false;
      e.resetForRound(keep);
      e.mesh?.userData?.revive?.(); // stand corpses back up (pose + materials)
      if (this.mode.freeAbilities) this._refillAbilities(e);
      if (this.mode.kind === 'gungame') {
        e._ggLevel = e._ggLevel ?? 0;
        e.inventory.primary = null;
        e.giveWeapon(GUNGAME_LADDER[Math.min(e._ggLevel, GUNGAME_LADDER.length - 1)]);
      } else if (this.mode.kind === 'ffa' || this.mode.kind === 'tdm') {
        e.inventory.armor = 50; e.armor = 50;
        e.giveWeapon('vandal');
        e.giveWeapon('ghost');
      } else if (this.mode.randomWeapons) {
        const rw = ['spectre', 'bulldog', 'phantom', 'sheriff', 'stinger', 'ares', 'judge'];
        e.giveWeapon(rw[Math.floor(Math.random() * rw.length)]);
      } else if (first || !e._hasLoadout) {
        // pistol round default
        e.giveWeapon('classic');
      }
      e._hasLoadout = true;
    }

    // spawns
    this._placeSpawns();

    // spike carrier
    if (this.mode.spike) {
      const attackers = this.entities.filter((e) => e.team === 'att' && e.alive);
      const carrier = attackers.find((e) => e.isPlayer) || attackers[0];
      this.spike = { carrier, planted: false, plantPos: null, site: null, plantProgress: 0, defuseProgress: 0, plantedAt: 0, exploded: false };
    }

    // buy for bots
    if (this.mode.buy) {
      for (const e of this.entities) if (e.isBot) this._botBuy(e);
    }
    bus.emit('round:start', { round: this.roundNum, phase: this.phase });
    audio.beep(700);
    this._emitHud();
  }

  _refillAbilities(e) {
    for (const key of ['C', 'Q', 'E', 'X']) {
      const ab = e.agent.abilities[key];
      e.abilityState[key] = { charges: ab.charges ?? 5, cdUntil: 0 };
    }
    e.ultPoints = 99;
  }

  _placeSpawns() {
    const sp = this.mapMeta.spawns;
    const assign = (list, spawns) => {
      list.forEach((e, i) => {
        const s = spawns[i % spawns.length] || spawns[0];
        if (s) { e.pos.set(s.pos.x, 0, s.pos.z); e.yaw = s.rot; e.spawnPos.copy(e.pos); }
        else { e.pos.set((i - 2) * 3, 0, 0); }
        e.pitch = 0; e.vel.set(0, 0, 0);
      });
    };
    if (this.mode.kind === 'ffa' || this.mode.kind === 'gungame') {
      const all = this.entities;
      assign(all, sp.ffa.length ? sp.ffa : sp.attackers);
    } else if (this.mode.kind === 'tdm') {
      assign(this.entities.filter((e) => e.team === 'att'), sp.attackers);
      assign(this.entities.filter((e) => e.team === 'def'), sp.defenders);
    } else {
      // plant: player side may be swapped after halftime
      const attList = this.entities.filter((e) => e.team === 'att');
      const defList = this.entities.filter((e) => e.team === 'def');
      assign(attList, sp.attackers);
      assign(defList, sp.defenders);
    }
  }

  // ---------------------------------------------------------------- update
  update(dt) {
    if (this.state !== 'playing') return;
    this.now += dt;

    // phase timing
    if (this.phase === 'buy' && this.now >= this.phaseEnd) {
      this.phase = 'live';
      this.phaseEnd = this.now + LIVE_TIME;
      if (this.buyOpen) { this.buyOpen = false; bus.emit('buy:toggle', false); this.input.requestLock(); }
      bus.emit('phase:live');
    }

    // player
    this.pc.update(dt, this.now);

    // bots
    for (const e of this.entities) {
      if (e.isBot && e.alive) updateBot(this, e, dt, this.now);
      if (e.mesh) {
        if (e.alive) {
          e.mesh.visible = true;
          e.mesh.position.set(e.pos.x, e.pos.y, e.pos.z);
          e.mesh.rotation.y = e.yaw + Math.PI;
        } else {
          // dead: freeze in place while the avatar's self-driven collapse
          // plays (userData.die set dyingUntil in performance-clock seconds),
          // then hide until revive() at respawn / round start
          e.mesh.visible = (e.mesh.userData.dyingUntil || 0) > performance.now() / 1000;
        }
      }
    }

    this._updateEffects(dt);
    this._updateSpikeAndInteract(dt);
    this._checkRoundEnd();

    // throttle HUD DOM updates to ~30/s
    this._hudAcc = (this._hudAcc || 0) + dt;
    if (this._hudAcc >= 1 / 30) { this._hudAcc = 0; this._emitHud(); }
  }

  // per-frame render extras (tracers, sparks, decals, smoke, spike fx)
  renderExtras(dt) {
    this.fx.update(dt);
  }

  // ---------------------------------------------------------------- effects
  _updateEffects(dt) {
    const now = this.now;
    // flashes
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      if (now >= this.flashes[i].until) this.flashes.splice(i, 1);
    }
    // zones (damage / slow)
    for (let i = this.zones.length - 1; i >= 0; i--) {
      const z = this.zones[i];
      if (z.mesh) z.mesh.material.opacity = 0.35 + Math.sin(now * 8) * 0.08;
      for (const e of this.entities) {
        if (!e.alive) continue;
        if (z.team && e.team === z.team && e.team !== 'ffa') continue;
        const d = Math.hypot(e.pos.x - z.pos.x, e.pos.z - z.pos.z);
        if (d <= z.radius) {
          if (z.dps) { const applied = e.takeDamage(z.dps * dt, 'body'); if (!e.alive && applied >= 0) this._registerKill(z.owner, e, 'zone'); }
          if (z.slow) { e.effects.slowUntil = now + 0.2; e.effects.slowAmt = z.slow; }
        }
      }
      if (now >= z.until) { this._removeMesh(z.mesh); this.zones.splice(i, 1); }
    }
    // smokes
    for (let i = this.smokes.length - 1; i >= 0; i--) {
      const s = this.smokes[i];
      if (now >= s.until) { this._removeMesh(s.mesh); this.smokes.splice(i, 1); }
    }
    // walls (temp colliders)
    for (let i = this.walls.length - 1; i >= 0; i--) {
      const wl = this.walls[i];
      if (now >= wl.until) {
        this._removeMesh(wl.mesh);
        const idx = this.colliders.indexOf(wl.collider);
        if (idx >= 0) this.colliders.splice(idx, 1);
        this.walls.splice(i, 1);
      }
    }
    // turrets
    for (let i = this.turrets.length - 1; i >= 0; i--) {
      const tu = this.turrets[i];
      if (now >= tu.nextScan) {
        tu.nextScan = now + 0.2;
        let target = null; let bd = tu.range * tu.range;
        for (const e of this.entities) {
          if (!e.alive || (e.team === tu.team && e.team !== 'ffa')) continue;
          const d = e.pos.distanceToSquared(tu.pos);
          if (d < bd && this.visionBlocked(tu.pos.clone().setY(1), e.eyePosition()) === false) { bd = d; target = e; }
        }
        tu.target = target;
      }
      if (tu.target && tu.target.alive && tu.dps > 0) {
        const applied = tu.target.takeDamage(tu.dps * dt, 'body');
        if (!tu.target.alive) this._registerKill(tu.owner, tu.target, 'turret');
        if (Math.random() < 0.1) this.spawnTracer(tu.pos.clone().setY(1), tu.target.eyePosition());
      }
      if (tu.mesh) tu.mesh.rotation.y += dt * 2;
      if (now >= tu.until) { this._removeMesh(tu.mesh); this.turrets.splice(i, 1); }
    }
    // traps
    for (let i = this.traps.length - 1; i >= 0; i--) {
      const tr = this.traps[i];
      let triggered = false;
      for (const e of this.entities) {
        if (!e.alive || (e.team === tr.team && e.team !== 'ffa')) continue;
        if (Math.hypot(e.pos.x - tr.pos.x, e.pos.z - tr.pos.z) <= tr.radius) {
          if (tr.effect === 'slow') { e.effects.slowUntil = now + 4; e.effects.slowAmt = 0.6; }
          if (tr.effect === 'reveal') { e.effects.revealedUntil = now + 5; }
          triggered = true;
        }
      }
      if ((triggered || now >= tr.until)) { this._removeMesh(tr.mesh); this.traps.splice(i, 1); if (triggered) audio.beep(400); }
    }
    // reveals
    for (let i = this.reveals.length - 1; i >= 0; i--) {
      const rv = this.reveals[i];
      for (const e of this.entities) {
        if (e.team === rv.team && e.team !== 'ffa') continue;
        if (!e.alive) continue;
        const inR = rv.radius >= 199 || Math.hypot(e.pos.x - rv.pos.x, e.pos.z - rv.pos.z) <= rv.radius;
        if (inR) e.effects.revealedUntil = now + 0.3;
      }
      if (now >= rv.until) this.reveals.splice(i, 1);
    }
  }

  visionBlocked(from, to) {
    // returns true if a wall or smoke blocks the segment
    const dir = to.clone().sub(from);
    const dist = dir.length();
    if (dist < 0.001) return false;
    dir.normalize();
    // walls
    for (const b of this.colliders) {
      const t = rayBoxLocal(from, dir, b);
      if (t !== null && t < dist - 0.4) return true;
    }
    // smokes
    for (const s of this.smokes) {
      if (segSphere(from, to, s.pos, s.radius)) return true;
    }
    return false;
  }

  // Remove all transient effects (meshes, wall colliders) and empty the pools.
  _clearEffects() {
    for (const arr of [this.zones, this.smokes, this.walls, this.turrets, this.traps]) {
      for (const it of arr) {
        if (it.mesh) this._removeMesh(it.mesh);
        if (it.collider) { const i = this.colliders.indexOf(it.collider); if (i >= 0) this.colliders.splice(i, 1); }
      }
    }
    this.flashes = []; this.smokes = []; this.zones = [];
    this.walls = []; this.turrets = []; this.traps = []; this.reveals = [];
    this.fx.clear();
  }

  _removeMesh(mesh) {
    if (!mesh) return;
    this.r.scene.remove(mesh);
    mesh.traverse?.((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) { const m = Array.isArray(o.material) ? o.material : [o.material]; m.forEach((x) => x.dispose()); } });
    if (mesh.geometry) mesh.geometry.dispose();
    if (mesh.material) mesh.material.dispose();
  }

  // ---------------------------------------------------------------- ability helper API
  spawnTracer(a, b) {
    // Tapered hot-core beam, pooled + faded per frame by the effects system.
    this.fx.spawnTracer(a, b);
  }

  muzzleFlash() { bus.emit('muzzle'); }
  addRecoil(x, y) { this.pc.addRecoil(x, y); }

  spawnFlash(pos, caster, duration, radius) {
    audio.ability();
    // flash sphere visual
    const geo = new THREE.SphereGeometry(0.4, 8, 8);
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xffffff }));
    mesh.position.copy(pos);
    this.r.scene.add(mesh);
    setTimeout(() => this._removeMesh(mesh), 200);
    for (const e of this.entities) {
      if (!e.alive) continue;
      const eye = e.eyePosition();
      const d = eye.distanceTo(pos);
      if (d > radius) continue;
      if (this.visionBlocked(eye, pos)) continue;
      const toFlash = pos.clone().sub(eye).normalize();
      const facing = toFlash.dot(e.aimDir());
      const intensity = THREE.MathUtils.clamp((facing + 0.3) / 1.3, 0, 1);
      if (intensity <= 0.05) continue;
      const dur = duration * intensity;
      e.effects.flashUntil = Math.max(e.effects.flashUntil, this.now + dur);
      if (e.isPlayer) bus.emit('flash', { duration: dur, intensity });
    }
  }

  spawnSmoke(pos, radius, duration) {
    audio.ability();
    // Nicer layered volume; the {pos, radius, until} entry below is what
    // gameplay (visionBlocked) reads and is unchanged.
    const mesh = this.fx.makeSmokeMesh(radius);
    mesh.position.copy(pos.clone().setY(radius * 0.7));
    this.r.scene.add(mesh);
    this.smokes.push({ pos: mesh.position.clone(), radius, until: this.now + duration, mesh });
  }

  spawnZone(pos, radius, duration, opts) {
    audio.ability();
    const geo = new THREE.CylinderGeometry(radius, radius, 0.2, 24);
    const mat = new THREE.MeshBasicMaterial({ color: opts.color ?? 0xff6a2a, transparent: true, opacity: 0.4, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(pos.clone().setY(0.1));
    this.r.scene.add(mesh);
    this.zones.push({ pos: pos.clone(), radius, until: this.now + duration, dps: opts.dps || 0, slow: opts.slow || 0, team: opts.team, owner: opts.owner, mesh });
  }

  spawnWall(pos, yaw, length, height, duration) {
    audio.ability();
    const geo = new THREE.BoxGeometry(length, height, 0.4);
    const mat = new THREE.MeshStandardMaterial({ color: 0x7fd0ff, transparent: true, opacity: 0.55, emissive: 0x2a6a8a });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(pos.clone().setY(height / 2));
    mesh.rotation.y = yaw;
    this.r.scene.add(mesh);
    // AABB collider (axis-aligned approximation of rotated wall)
    const cos = Math.abs(Math.cos(yaw)); const sin = Math.abs(Math.sin(yaw));
    const hx = (length * cos + 0.4 * sin) / 2;
    const hz = (length * sin + 0.4 * cos) / 2;
    const collider = {
      min: new THREE.Vector3(pos.x - hx, 0, pos.z - hz),
      max: new THREE.Vector3(pos.x + hx, height, pos.z + hz),
    };
    this.colliders.push(collider);
    this.walls.push({ mesh, collider, until: this.now + duration });
  }

  spawnTurret(pos, team, opts) {
    audio.ability();
    const g = new THREE.Group();
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.4, 0.6, 8), new THREE.MeshStandardMaterial({ color: 0x333844 }));
    base.position.y = 0.3; g.add(base);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.3, 0.6), new THREE.MeshStandardMaterial({ color: team === 'def' ? 0x3a7ae0 : 0xe0433a }));
    head.position.y = 0.7; g.add(head);
    g.position.copy(pos);
    this.r.scene.add(g);
    this.turrets.push({ pos: pos.clone().setY(0.7), team, dps: opts.dps, range: opts.range, until: this.now + opts.duration, nextScan: 0, mesh: g, owner: opts.owner });
  }

  spawnTrap(pos, team, opts) {
    audio.ability();
    const mesh = new THREE.Mesh(new THREE.TorusGeometry(opts.radius, 0.08, 6, 24), new THREE.MeshBasicMaterial({ color: team === 'def' ? 0x3a7ae0 : 0xe0433a }));
    mesh.rotation.x = Math.PI / 2;
    mesh.position.copy(pos.clone().setY(0.1));
    this.r.scene.add(mesh);
    this.traps.push({ pos: pos.clone(), team, radius: opts.radius, effect: opts.effect, until: this.now + opts.duration, mesh });
  }

  healOverTime(e, amount, duration) {
    audio.ability();
    e.effects.healUntil = this.now + duration;
    e.effects.healRate = amount / duration;
  }

  reveal(team, pos, radius, duration) {
    audio.ability();
    this.reveals.push({ team, pos: pos.clone(), radius, until: this.now + duration });
  }

  // ---------------------------------------------------------------- abilities cast
  castAbility(e, key) {
    if (!e.alive) return false;
    const ab = e.agent.abilities[key];
    if (!ab) return false;
    const st = e.abilityState[key];
    const free = this.settings.noCooldown || this.mode.freeAbilities;
    // Recast delay is ALWAYS enforced (even in free mode) so held keys can't
    // spawn an ability every frame.
    if (this.now < (st.cdUntil || 0)) return false;
    if (!free) {
      if (ab.ult) {
        if (e.ultPoints < (ab.points || 7)) return false;
      } else {
        if ((st.charges ?? 0) <= 0) return false;
      }
    }
    const aim = { dir: e.aimDir(), point: e.eyePosition().add(e.aimDir().multiplyScalar(20)) };
    try { ab.cast(this, e, aim); } catch (err) { console.error('ability error', err); return false; }
    st.cdUntil = this.now + (ab.cooldown || (free ? 0.6 : 0.4));
    if (!free) {
      if (ab.ult) e.ultPoints = 0;
      else st.charges -= 1;
    }
    bus.emit('ability:cast', {
      caster: e.name,
      isPlayer: !!e.isPlayer,
      team: e.team,
      agentId: e.agent.id,
      key,
      type: ab.type,
      ult: !!ab.ult,
      pos: { x: e.pos.x, y: e.pos.y, z: e.pos.z },
    });
    // optional hook — the effects team implements castSignature in parallel
    this.fx.castSignature?.(e, { agentId: e.agent.id, key, type: ab.type, ult: !!ab.ult });
    if (e.isPlayer) this._emitHud();
    return true;
  }

  // buy ability charges during buy phase
  buyAbility(e, key) {
    if (this.phase !== 'buy' && !this.settings.infiniteMoney) return false;
    const ab = e.agent.abilities[key];
    if (!ab || ab.ult || !ab.cost) return false;
    if (e.credits < ab.cost) return false;
    const st = e.abilityState[key];
    if ((st.charges ?? 0) >= (ab.charges ?? 1)) return false;
    e.credits -= ab.cost;
    st.charges += 1;
    audio.buy();
    this._emitHud();
    return true;
  }

  // ---------------------------------------------------------------- combat callbacks
  onDamage(attacker, victim, applied, part, point) {
    if (point) this.fx.bodyHit(point, part, !victim.alive);
    if (part === 'head') audio.headshot(); else audio.hit();
    if (attacker.isPlayer) bus.emit('hitmarker', { head: part === 'head', kill: !victim.alive });

    // assist ledger on the victim: accumulate per-attacker damage, refresh
    // the 5 s window, prune expired entries (read by _registerKill)
    const list = victim._recentDamagers || (victim._recentDamagers = []);
    for (let i = list.length - 1; i >= 0; i--) if (this.now >= list[i].until) list.splice(i, 1);
    let entry = null;
    for (const d of list) if (d.id === attacker.id) { entry = d; break; }
    if (!entry) { entry = { id: attacker.id, name: attacker.name, isPlayer: !!attacker.isPlayer, amount: 0, until: 0 }; list.push(entry); }
    entry.amount += applied;
    entry.until = this.now + 5;

    // per-round MVP tracking
    attacker._roundDamage = (attacker._roundDamage || 0) + applied;

    // flinch on non-lethal hits (avatars self-animate; event call only)
    if (victim.alive) victim.mesh?.userData?.hitReact?.(part);

    // 'damage' fires for weapon hits only (zones/turrets bypass onDamage)
    const pt = point || victim.eyePosition();
    bus.emit('damage', {
      attacker: attacker.name,
      attackerIsPlayer: !!attacker.isPlayer,
      victim: victim.name,
      victimIsPlayer: !!victim.isPlayer,
      amount: Math.round(applied),
      part,
      kill: !victim.alive,
      point: { x: pt.x, y: pt.y, z: pt.z },
      attackerPos: { x: attacker.pos.x, y: attacker.pos.y, z: attacker.pos.z },
    });

    if (!victim.alive) this._registerKill(attacker, victim, attacker.weapon().cat === 'melee' ? 'knife' : 'gun', part);
  }

  _registerKill(attacker, victim, method, part) {
    if (victim._deadCounted) return;
    victim._deadCounted = true;
    victim.deaths++;
    victim.mesh?.userData?.die?.(); // self-driven collapse; update() hides it when done
    audio.death();
    if (attacker && attacker !== victim) {
      attacker.kills++;
      attacker._roundKills = (attacker._roundKills || 0) + 1;
      const reward = this.mode.kind === 'plant' ? 200 : 0;
      attacker.credits = Math.min(9000, attacker.credits + reward);
      attacker.ultPoints = Math.min(20, attacker.ultPoints + 1);
      if (this.mode.kind === 'gungame') {
        attacker._ggLevel = (attacker._ggLevel ?? 0) + 1;
        const nextW = GUNGAME_LADDER[Math.min(attacker._ggLevel, GUNGAME_LADDER.length - 1)];
        attacker.inventory.primary = nextW === 'knife' ? null : nextW;
        if (nextW === 'knife') attacker.currentSlot = 'knife'; else attacker.giveWeapon(nextW);
      }
    }
    // assist: largest non-killer contributor with >= 25 damage in the window
    let assist = null;
    let best = null;
    for (const d of victim._recentDamagers || []) {
      if (attacker && d.id === attacker.id) continue;
      if (d.amount < 25 || this.now >= d.until) continue;
      if (!best || d.amount > best.amount) best = d;
    }
    if (best) {
      assist = best.name;
      const helper = this.entities.find((x) => x.id === best.id);
      if (helper) helper.assists++;
    }

    bus.emit('kill', {
      attacker: attacker ? attacker.name : 'Welt',
      attackerTeam: attacker ? attacker.team : null,
      victim: victim.name,
      victimTeam: victim.team,
      method,
      // true only for headshot gun kills (zone/turret/knife pass no part)
      head: method === 'gun' && part === 'head',
      assist,
      player: (attacker && attacker.isPlayer) || victim.isPlayer,
    });

    if (attacker && attacker.isPlayer && this.mode.kind !== 'plant') {
      // free respawn handled in deathmatch loop
    }
    // deathmatch respawn / kill targets handled in _checkRoundEnd
    this._maybeRespawn(victim);
  }

  _maybeRespawn(victim) {
    if (this.mode.kind === 'ffa' || this.mode.kind === 'tdm' || this.mode.kind === 'gungame') {
      const delay = 2.0;
      const token = this._matchToken;
      setTimeout(() => {
        if (this.state !== 'playing' || this._matchToken !== token) return;
        victim._deadCounted = false;
        victim.resetForRound(true);
        victim.mesh?.userData?.revive?.(); // restore pose/materials before re-show
        if (this.mode.freeAbilities) this._refillAbilities(victim);
        // respawn location
        const sp = this.mapMeta.spawns;
        const pool = sp.ffa.length ? sp.ffa : (victim.team === 'def' ? sp.defenders : sp.attackers);
        const s = pool[Math.floor(Math.random() * pool.length)];
        if (s) { victim.pos.set(s.pos.x, 0, s.pos.z); victim.yaw = s.rot; }
        if (this.mode.kind === 'gungame') victim.giveWeapon(GUNGAME_LADDER[Math.min(victim._ggLevel ?? 0, GUNGAME_LADDER.length - 1)]);
        else { victim.giveWeapon('vandal'); victim.giveWeapon('ghost'); victim.armor = 50; }
      }, delay * 1000);
    }
  }

  // ---------------------------------------------------------------- spike + interaction
  _updateSpikeAndInteract(dt) {
    if (!this.mode.spike || !this.spike) return;
    const sp = this.spike;
    const now = this.now;
    if (sp.exploded || this.roundWinner) return;

    // player interact (hold F)
    const holdingF = this.input.isDown('KeyF') && this.input.locked && !this.buyOpen;
    const p = this.player;
    if (p.alive && p.team === 'att' && !sp.planted && sp.carrier === p) {
      const site = this._siteAt(p.pos);
      if (site && holdingF && this.phase === 'live') {
        sp.plantProgress += dt / PLANT_TIME;
        bus.emit('interact', { type: 'plant', progress: sp.plantProgress });
        if (sp.plantProgress >= 1) this._plantSpike(p, site);
      } else if (sp.plantProgress > 0 && sp.plantProgress < 1) {
        sp.plantProgress = 0;
      }
    }
    if (p.alive && p.team === 'def' && sp.planted && !sp.defused) {
      const d = Math.hypot(p.pos.x - sp.plantPos.x, p.pos.z - sp.plantPos.z);
      if (d < 2 && holdingF) {
        this._advanceDefuse(sp, dt);
        bus.emit('interact', { type: 'defuse', progress: sp.defuseProgress });
        if (sp.defuseProgress >= 1) this._defuseSpike(p);
      } else if (sp.defuseProgress > 0 && sp.defuseProgress < 1 && d >= 2) {
        // keep progress? standard: half defuse checkpoint; simplify reset if leave
        sp.defuseProgress = Math.max(0, sp.defuseProgress - dt / DEFUSE_TIME);
      }
    }

    // spike detonation
    if (sp.planted && !sp.defused && now >= sp.plantedAt + SPIKE_TIME) {
      sp.exploded = true;
      this._explodeSpike();
    }
  }

  botObjective(e, dt, now) {
    if (!this.mode.spike || !this.spike || this.roundWinner) return;
    const sp = this.spike;
    if (e.team === 'att' && !sp.planted && sp.carrier === e && this.phase === 'live') {
      const site = this._siteAt(e.pos);
      if (site && !this._enemyNear(e, 8)) {
        sp.plantProgress += dt / PLANT_TIME;
        if (sp.plantProgress >= 1) this._plantSpike(e, site);
      }
    }
    if (e.team === 'def' && sp.planted && !sp.defused) {
      const d = Math.hypot(e.pos.x - sp.plantPos.x, e.pos.z - sp.plantPos.z);
      if (d < 2 && !this._enemyNear(e, 8)) {
        this._advanceDefuse(sp, dt);
        if (sp.defuseProgress >= 1) this._defuseSpike(e);
      }
    }
  }

  // Advance defuse at most once per simulation tick so multiple defenders
  // near the spike don't multiply the rate.
  _advanceDefuse(sp, dt) {
    if (sp._defuseTick === this.now) return;
    sp._defuseTick = this.now;
    sp.defuseProgress += dt / DEFUSE_TIME;
  }

  _enemyNear(e, range) {
    for (const o of this.entities) {
      if (!o.alive || o.team === e.team) continue;
      if (o.pos.distanceTo(e.pos) < range && !this.visionBlocked(e.eyePosition(), o.eyePosition())) return true;
    }
    return false;
  }

  _siteAt(pos) {
    for (const key of Object.keys(this.mapMeta.sites)) {
      const s = this.mapMeta.sites[key];
      if (Math.hypot(pos.x - s.center.x, pos.z - s.center.z) <= s.radius) return key;
    }
    return null;
  }

  _plantSpike(planter, site) {
    const sp = this.spike;
    sp.planted = true;
    sp.plantedAt = this.now;
    sp.site = site;
    sp.plantPos = planter.pos.clone();
    planter._roundPlant = true; // MVP bonus
    const mesh = this.fx.makeSpikeMesh();
    mesh.position.copy(sp.plantPos).setY(0.25);
    this.r.scene.add(mesh);
    sp.mesh = mesh;
    if (planter.isPlayer) planter.ultPoints = Math.min(20, planter.ultPoints + 1);
    audio.plant();
    bus.emit('spike:planted', { site });
    this.phaseEnd = this.now + SPIKE_TIME;
  }

  _defuseSpike(defuser) {
    this.spike.defused = true;
    defuser._roundDefuse = true; // MVP bonus
    if (this.spike.mesh) this.spike.mesh.material.color.set(0x40ff60);
    audio.win();
    this._endRound('def');
  }

  _explodeSpike() {
    audio.death();
    // boom effect (visual only — round outcome decided below)
    this.fx.spikeDetonation(this.spike.plantPos.clone());
    this._endRound('att');
  }

  // ---------------------------------------------------------------- round/match end
  _checkRoundEnd() {
    if (this.state !== 'playing') return;
    if (this.mode.kind === 'ffa' || this.mode.kind === 'gungame') {
      // win by kill target or gungame ladder
      for (const e of this.entities) {
        if (this.mode.kind === 'gungame' && (e._ggLevel ?? 0) >= GUNGAME_LADDER.length) return this._endMatchFFA(e);
        if (this.mode.killTarget && e.kills >= this.mode.killTarget) return this._endMatchFFA(e);
      }
      return;
    }
    if (this.mode.kind === 'tdm') {
      const attK = this.entities.filter((e) => e.team === 'att').reduce((s, e) => s + e.kills, 0);
      const defK = this.entities.filter((e) => e.team === 'def').reduce((s, e) => s + e.kills, 0);
      if (attK >= this.mode.killTarget) return this._endMatchTeam('att');
      if (defK >= this.mode.killTarget) return this._endMatchTeam('def');
      return;
    }
    // plant mode
    if (this.roundWinner) return;
    if (this.phase !== 'live') return;
    const sp = this.spike;
    const attAlive = this.entities.filter((e) => e.team === 'att' && e.alive).length;
    const defAlive = this.entities.filter((e) => e.team === 'def' && e.alive).length;
    if (!sp || !sp.planted) {
      // pre-plant: team wipes / time expiry
      if (attAlive === 0) return this._endRound('def');
      if (defAlive === 0) return this._endRound('att');
      if (this.now >= this.phaseEnd) return this._endRound('def');
    } else if (!sp.defused && !sp.exploded) {
      // post-plant: no defenders left to defuse -> attackers win immediately.
      // (attacker deaths do NOT end the round; the spike still detonates.)
      if (defAlive === 0) return this._endRound('att');
    }
  }

  _endRound(winnerTeam) {
    if (this.roundWinner) return;
    this.roundWinner = winnerTeam;
    if (winnerTeam === 'att') this.attackerScore++; else this.defenderScore++;
    // economy rewards
    for (const e of this.entities) {
      const won = e.team === winnerTeam;
      let reward = won ? 3000 : 1900;
      if (!won) reward += Math.min(2, (e._lossStreak || 0)) * 500;
      e._lossStreak = won ? 0 : (e._lossStreak || 0) + 1;
      e.credits = Math.min(9000, e.credits + reward);
    }
    if (this.playerSide === winnerTeam) audio.win(); else audio.lose();
    bus.emit('round:end', { winner: winnerTeam, att: this.attackerScore, def: this.defenderScore, mvp: this._roundMvp(winnerTeam) });

    const rtw = this.mode.roundsToWin;
    if (this.attackerScore >= rtw || this.defenderScore >= rtw) {
      return this._endMatchTeam(this.attackerScore > this.defenderScore ? 'att' : 'def');
    }
    // schedule next round
    this.state = 'roundend';
    const token = this._matchToken;
    setTimeout(() => {
      if (this.matchOver || this._matchToken !== token) return;
      // halftime side swap
      const total = this.attackerScore + this.defenderScore;
      if (this.mode.halftime && total === this.mode.halftime) this._swapSides();
      this.state = 'playing';
      this._startRound(false);
    }, ROUND_END_TIME * 1000);
  }

  // Winning team's best performer this round, damage-weighted:
  // 100*kills + damage + 150 if they planted or defused. Null if the winning
  // team has no entities (defensive; should not happen).
  _roundMvp(winnerTeam) {
    let best = null;
    let bestScore = -1;
    for (const e of this.entities) {
      if (e.team !== winnerTeam) continue;
      const score = 100 * (e._roundKills || 0) + (e._roundDamage || 0)
        + ((e._roundPlant || e._roundDefuse) ? 150 : 0);
      if (score > bestScore) { bestScore = score; best = e; }
    }
    if (!best) return null;
    return {
      name: best.name,
      agent: best.agent?.name,
      team: best.team,
      kills: best._roundKills || 0,
      damage: Math.round(best._roundDamage || 0),
    };
  }

  _swapSides() {
    for (const e of this.entities) {
      e.team = e.team === 'att' ? 'def' : 'att';
      e.color = new THREE.Color(e.agent?.color || (e.team === 'att' ? '#e0433a' : '#3a7ae0'));
    }
    const tmp = this.attackerScore; this.attackerScore = this.defenderScore; this.defenderScore = tmp;
    this.playerSide = this.player.team;
    bus.emit('halftime');
  }

  _endMatchTeam(winner) {
    this.matchOver = true;
    this.state = 'matchend';
    const playerWon = this.player.team === winner;
    bus.emit('match:end', { winner, playerWon, att: this.attackerScore, def: this.defenderScore });
  }

  _endMatchFFA(winner) {
    this.matchOver = true;
    this.state = 'matchend';
    bus.emit('match:end', { winner: winner.name, playerWon: winner.isPlayer, ffa: true, scoreboard: this._scoreboard() });
  }

  // ---------------------------------------------------------------- economy / buy
  buyWeapon(e, id) {
    if (!this.mode.buy && !this.settings.infiniteMoney) return false;
    if (this.phase !== 'buy' && !this.settings.infiniteMoney) return false;
    const w = weaponById(id);
    const cost = this.settings.infiniteMoney ? 0 : w.price;
    if (e.credits < cost) return false;
    e.credits -= cost;
    e.giveWeapon(id);
    audio.buy();
    this._emitHud();
    return true;
  }

  buyArmor(e, id) {
    const a = ARMOR[id];
    if (!a) return false;
    const cost = this.settings.infiniteMoney ? 0 : a.price;
    if (this.phase !== 'buy' && !this.settings.infiniteMoney) return false;
    if (e.credits < cost) return false;
    e.credits -= cost;
    e.inventory.armor = a.hp;
    e.armor = a.hp;
    audio.buy();
    this._emitHud();
    return true;
  }

  _botBuy(e) {
    if (this.settings.infiniteMoney) e.credits = 9000;
    const c = e.credits;
    // buy armor
    if (c >= 1000) { e.inventory.armor = 50; e.armor = 50; e.credits -= 1000; }
    // buy a weapon by budget
    let choice = null;
    if (e.credits >= 2900) choice = Math.random() < 0.5 ? 'vandal' : 'phantom';
    else if (e.credits >= 1600) choice = 'spectre';
    else if (e.credits >= 800) choice = 'sheriff';
    if (choice) { e.giveWeapon(choice); e.credits -= weaponById(choice).price; }
    // buy an ability charge sometimes
    if (Math.random() < 0.6) {
      const keys = ['C', 'Q'];
      for (const k of keys) this.buyAbilityBot(e, k);
    }
  }

  buyAbilityBot(e, key) {
    const ab = e.agent.abilities[key];
    if (!ab || ab.ult || !ab.cost) return;
    const st = e.abilityState[key];
    if ((st.charges ?? 0) >= (ab.charges ?? 1)) return;
    if (e.credits < ab.cost) return;
    e.credits -= ab.cost; st.charges += 1;
  }

  // ---------------------------------------------------------------- bot navigation targets
  botMoveTarget(e) {
    const sp = this.spike;
    if (this.mode.kind === 'ffa' || this.mode.kind === 'gungame' || this.mode.kind === 'tdm') {
      // move toward nearest enemy or random point
      let best = null; let bd = Infinity;
      for (const o of this.entities) {
        if (!o.alive || (o.team === e.team && e.team !== 'ffa')) continue;
        const d = o.pos.distanceToSquared(e.pos);
        if (d < bd) { bd = d; best = o; }
      }
      if (best) return best.pos.clone();
      return new THREE.Vector3((Math.random() - 0.5) * 30, 0, (Math.random() - 0.5) * 30);
    }
    // plant mode
    const sites = this.mapMeta.sites;
    const keys = Object.keys(sites);
    if (keys.length === 0) return e.spawnPos.clone();
    if (e.team === 'att') {
      if (sp && sp.planted) return sp.plantPos.clone();
      if (sp && sp.carrier === e) {
        if (!e._siteTarget) e._siteTarget = keys[Math.floor(Math.random() * keys.length)];
        return sites[e._siteTarget].center.clone();
      }
      if (!e._siteTarget) e._siteTarget = keys[Math.floor(Math.random() * keys.length)];
      return sites[e._siteTarget].center.clone();
    }
    // defender
    if (sp && sp.planted) return sp.plantPos.clone();
    if (!e._holdSite) e._holdSite = keys[Math.floor(Math.random() * keys.length)];
    const c = sites[e._holdSite].center;
    return new THREE.Vector3(c.x + (Math.random() - 0.5) * 6, 0, c.z - 4 + (Math.random() - 0.5) * 4);
  }

  // ---------------------------------------------------------------- HUD data
  _emitHud() {
    const p = this.player;
    const w = p.weapon();
    // Compute a meaningful top-bar score/goal per mode.
    let attScore = this.attackerScore;
    let defScore = this.defenderScore;
    let goalText = '';
    const sumK = (t) => this.entities.filter((e) => e.team === t).reduce((s, e) => s + e.kills, 0);
    if (this.mode.kind === 'tdm') {
      attScore = sumK('att'); defScore = sumK('def'); goalText = `Ziel ${this.mode.killTarget} Kills`;
    } else if (this.mode.kind === 'ffa') {
      attScore = p.kills; defScore = Math.max(0, ...this.entities.map((e) => e.kills)); goalText = `Ziel ${this.mode.killTarget} Kills`;
    } else if (this.mode.kind === 'gungame') {
      attScore = (p._ggLevel ?? 0); defScore = Math.max(0, ...this.entities.map((e) => e._ggLevel ?? 0)); goalText = `Level ${(p._ggLevel ?? 0) + 1}/${GUNGAME_LADDER.length}`;
    }
    bus.emit('hud', {
      goalText,
      killTarget: this.mode.killTarget,
      hp: Math.ceil(p.hp),
      armor: Math.ceil(p.armor),
      credits: p.credits,
      alive: p.alive,
      assists: p.assists,
      weapon: w.name,
      weaponCat: w.cat,
      ammo: p.ammo[w.id] ?? 0,
      mag: w.mag,
      reserve: p.reserve[w.id] ?? 0,
      abilities: this._abilityHud(p),
      ultPoints: p.ultPoints,
      ultMax: p.agent.abilities.X.points || 7,
      phase: this.phase,
      timeLeft: Math.max(0, Math.ceil(this.phaseEnd - this.now)),
      round: this.roundNum,
      attScore,
      defScore,
      side: this.playerSide,
      mode: this.mode,
      spike: this.spike ? { planted: this.spike.planted, defused: this.spike.defused, site: this.spike.site, carrier: this.spike.carrier === p } : null,
      scoreboard: this._scoreboard(),
      minimap: this._minimapData(),
      buyOpen: this.buyOpen,
    });
  }

  _abilityHud(p) {
    const out = {};
    for (const key of ['C', 'Q', 'E', 'X']) {
      const ab = p.agent.abilities[key];
      const st = p.abilityState[key];
      out[key] = {
        name: ab.name, ult: !!ab.ult,
        charges: ab.ult ? Math.floor(p.ultPoints) : (st.charges ?? 0),
        max: ab.ult ? (ab.points || 7) : (ab.charges ?? 1),
        ready: ab.ult ? p.ultPoints >= (ab.points || 7) : (st.charges > 0 && this.now >= (st.cdUntil || 0)),
        cost: ab.cost || 0,
      };
    }
    return out;
  }

  _scoreboard() {
    return this.entities.map((e) => ({
      name: e.name, team: e.team, agent: e.agent?.name, kills: e.kills, deaths: e.deaths,
      assists: e.assists, credits: e.credits, alive: e.alive, isPlayer: e.isPlayer,
    })).sort((a, b) => b.kills - a.kills);
  }

  _minimapData() {
    const p = this.player;
    const bounds = this.mapMeta.bounds;
    const items = [];
    for (const e of this.entities) {
      if (!e.alive) continue;
      const friendly = (e.team === p.team && p.team !== 'ffa') || e.isPlayer;
      const revealed = this.now < e.effects.revealedUntil;
      if (!friendly && !revealed) continue;
      items.push({ x: e.pos.x, z: e.pos.z, yaw: e.yaw, friendly, isPlayer: e.isPlayer });
    }
    const sites = [];
    for (const key of Object.keys(this.mapMeta.sites)) {
      const s = this.mapMeta.sites[key];
      sites.push({ x: s.center.x, z: s.center.z, key });
    }
    let spike = null;
    if (this.spike && this.spike.planted && !this.spike.defused) spike = { x: this.spike.plantPos.x, z: this.spike.plantPos.z };
    return { bounds: { minX: bounds.min.x, maxX: bounds.max.x, minZ: bounds.min.z, maxZ: bounds.max.z }, items, sites, spike };
  }

  // ---------------------------------------------------------------- input
  _bindKeys() {
    bus.on('key:down', (code) => {
      if (this.state !== 'playing' && this.state !== 'roundend') return;
      const p = this.player;
      if (!p) return;
      if (code === 'Digit1') p.currentSlot = p.inventory.primary ? 'primary' : p.currentSlot;
      if (code === 'Digit2') p.currentSlot = 'sidearm';
      if (code === 'Digit3') p.currentSlot = 'knife';
      if (code === 'KeyR') startReload(p, this.now);
      if (code === 'KeyB' && this.mode.buy) this._toggleBuy();
      if (['KeyC', 'KeyQ', 'KeyE', 'KeyX'].includes(code) && this.input.locked && !this.buyOpen) {
        const key = code.replace('Key', '');
        this.castAbility(p, key);
      }
      if (code === 'Tab') bus.emit('scoreboard', true);
    });
    bus.on('key:up', (code) => { if (code === 'Tab') bus.emit('scoreboard', false); });
    // scope with right mouse for snipers
    bus.on('key:down', () => {});
  }

  _toggleBuy() {
    if (this.phase !== 'buy' && !this.settings.infiniteMoney) { bus.emit('toast', 'Kaufphase vorbei'); return; }
    this.buyOpen = !this.buyOpen;
    bus.emit('buy:toggle', this.buyOpen);
    if (this.buyOpen) this.input.exitLock(); else this.input.requestLock();
  }
}

function defaultSettings() {
  return {
    infiniteMoney: false,
    noCooldown: false,
    infiniteAmmo: false,
    oneShot: false,
    godMode: false,
    botCount: 9,
    botDifficulty: 'normal',
  };
}

// helpers
function rayBoxLocal(origin, dir, b) {
  let tmin = -Infinity; let tmax = Infinity;
  for (const ax of ['x', 'y', 'z']) {
    const o = origin[ax]; const d = dir[ax]; const mn = b.min[ax]; const mx = b.max[ax];
    if (Math.abs(d) < 1e-8) { if (o < mn || o > mx) return null; }
    else { let t1 = (mn - o) / d; let t2 = (mx - o) / d; if (t1 > t2) { const t = t1; t1 = t2; t2 = t; } tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2); if (tmin > tmax) return null; }
  }
  if (tmax < 0) return null;
  return tmin > 0 ? tmin : tmax;
}
function segSphere(a, b, center, r) {
  const ab = b.clone().sub(a);
  const t = THREE.MathUtils.clamp(center.clone().sub(a).dot(ab) / ab.lengthSq(), 0, 1);
  const closest = a.clone().add(ab.multiplyScalar(t));
  return closest.distanceTo(center) <= r;
}
