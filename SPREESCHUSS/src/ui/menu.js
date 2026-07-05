import { bus } from '../engine/eventbus.js';
import { AGENTS } from '../agents/agents.js';
import { MODES } from '../game/modes.js';
import { PLANT_MAPS, FFA_MAPS, ALL_MAPS } from '../maps/maps.js';
import { makeLogoCanvas, makeAgentPortrait, ABILITY_ICONS } from './logo.js';
import { audio } from '../audio/audio.js';

// ---------------------------------------------------------------- visual data
const ROLE_COLORS = {
  Duellant: '#ff6b5e',
  Initiator: '#ffd166',
  'Wächter': '#5eb8ff',
  Stratege: '#b48aff',
};

// Small inline-SVG icon set (no external assets / icon fonts).
const svg = (body, vb = '0 0 14 14') => `<svg viewBox="${vb}" width="14" height="14" aria-hidden="true">${body}</svg>`;

const MODE_ICONS = {
  competitive: svg('<path d="M7 0l2 4.5L14 5l-3.5 3.4.9 5.1L7 11l-4.4 2.5.9-5.1L0 5l5-.5z" fill="currentColor"/>'),
  unrated: svg('<path d="M7 1l5 5-5 7-5-7z" fill="none" stroke="currentColor" stroke-width="1.6"/>'),
  spikerush: svg('<path d="M8 0L2 8h4l-1 6 6-8H7z" fill="currentColor"/>'),
  deathmatch: svg('<path d="M7 0a5.5 5.5 0 0 0-5.5 5.5c0 2.4 1.4 4 3 4.8V13h5v-2.7c1.6-.8 3-2.4 3-4.8A5.5 5.5 0 0 0 7 0zM4.8 6.8a1.3 1.3 0 1 1 0-2.6 1.3 1.3 0 0 1 0 2.6zm4.4 0a1.3 1.3 0 1 1 0-2.6 1.3 1.3 0 0 1 0 2.6z" fill="currentColor"/>'),
  tdm: svg('<path d="M1 3h5v3H1zM1 8h5v3H1z" fill="currentColor" opacity="0.95"/><path d="M8 3h5v3H8zM8 8h5v3H8z" fill="currentColor" opacity="0.45"/>'),
  gungame: svg('<path d="M1 10h3v3H1zM5.5 6h3v7h-3zM10 1h3v12h-3z" fill="currentColor"/>'),
};

const ABILITY_TYPE_NAMES = {
  flash: 'Blendung', smoke: 'Rauch', molly: 'Flächenschaden', slow: 'Verlangsamung',
  wall: 'Barriere', dash: 'Bewegung', heal: 'Heilung', recon: 'Aufklärung',
  turret: 'Geschütz', trap: 'Falle',
};

// ---------------------------------------------------------------- persistence
// Menu.state survives reloads via localStorage. Every value is re-validated on
// load, so corrupt / stale / missing data can never break the menu.
const STORAGE_KEY = 'spreeschuss.menu.v1';
const DIFFICULTIES = ['easy', 'normal', 'hard'];
const TOGGLE_KEYS = ['infiniteMoney', 'noCooldown', 'infiniteAmmo', 'oneShot', 'godMode'];
// custom match rules: allowed values (0 = mode standard); anything else in
// stored state falls back to the defaults on load
const TEAM_SIZES = [2, 3, 4, 5];
const ROUNDS_OVERRIDES = [0, 5, 9, 13];
const SPIKE_TIMES = [30, 45, 60];
const KILL_TARGET_OVERRIDES = [0, 15, 30, 40, 60];

function sanitizeState(raw, base) {
  const out = { ...base, settings: { ...base.settings } };
  if (!raw || typeof raw !== 'object') return out;
  if (typeof raw.modeId === 'string' && MODES[raw.modeId]) out.modeId = raw.modeId;
  if (typeof raw.mapId === 'string' && ALL_MAPS.some((m) => m.id === raw.mapId)) out.mapId = raw.mapId;
  if (typeof raw.agentId === 'string' && AGENTS.some((a) => a.id === raw.agentId)) out.agentId = raw.agentId;
  if (DIFFICULTIES.includes(raw.botDifficulty)) out.botDifficulty = raw.botDifficulty;
  const n = Number(raw.botCount);
  if (Number.isFinite(n)) out.botCount = Math.min(11, Math.max(1, Math.round(n)));
  if (TEAM_SIZES.includes(Number(raw.teamSize))) out.teamSize = Number(raw.teamSize);
  if (ROUNDS_OVERRIDES.includes(Number(raw.roundsOverride))) out.roundsOverride = Number(raw.roundsOverride);
  if (SPIKE_TIMES.includes(Number(raw.spikeTime))) out.spikeTime = Number(raw.spikeTime);
  if (KILL_TARGET_OVERRIDES.includes(Number(raw.killTargetOverride))) out.killTargetOverride = Number(raw.killTargetOverride);
  if (raw.settings && typeof raw.settings === 'object') {
    for (const k of TOGGLE_KEYS) out.settings[k] = raw.settings[k] === true;
  }
  return out;
}

function loadStoredState(base) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return sanitizeState(null, base);
    return sanitizeState(JSON.parse(raw), base);
  } catch {
    return sanitizeState(null, base);
  }
}

// ---------------------------------------------------------------- map thumbs
// Real top-down thumbnails drawn from the map data itself: floor, boxes,
// plant sites and spawn zones. Cached per map id (canvases are reused).
const THUMB_CACHE = new Map();

function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v) => Math.max(0, Math.min(255, Math.round(v * f)));
  const r = ch((n >> 16) & 255); const g = ch((n >> 8) & 255); const b = ch(n & 255);
  return `rgb(${r},${g},${b})`;
}

export function makeMapThumb(map, cw = 240, ch = 126) {
  const key = `${map.id}@${cw}x${ch}`;
  if (THUMB_CACHE.has(key)) return THUMB_CACHE.get(key);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const c = document.createElement('canvas');
  c.className = 'map-thumb-canvas';
  c.width = Math.round(cw * dpr);
  c.height = Math.round(ch * dpr);
  const ctx = c.getContext('2d');
  ctx.scale(dpr, dpr);

  const [mw, md] = map.size;
  const pad = 7;
  const s = Math.min((cw - 2 * pad) / mw, (ch - 2 * pad) / md);
  const ox = cw / 2; const oy = ch / 2;
  const X = (x) => ox + x * s;
  const Y = (z) => oy + z * s;

  // backdrop
  ctx.fillStyle = '#070d14';
  ctx.fillRect(0, 0, cw, ch);

  // floor plate
  const fx = X(-mw / 2); const fy = Y(-md / 2); const fw = mw * s; const fh = md * s;
  ctx.fillStyle = shade(map.palette.floor, 0.72);
  ctx.fillRect(fx, fy, fw, fh);
  ctx.strokeStyle = 'rgba(255,255,255,0.14)';
  ctx.lineWidth = 1;
  ctx.strokeRect(fx + 0.5, fy + 0.5, fw - 1, fh - 1);

  // spawn zones (attacker = red tint, defender = blue tint) or FFA points
  const sp = map.spawns || {};
  if (sp.attackers && sp.attackers.length) {
    const zoneH = Math.max(8, fh * 0.12);
    let g = ctx.createLinearGradient(0, fy, 0, fy + zoneH);
    g.addColorStop(0, 'rgba(224,67,58,0.40)'); g.addColorStop(1, 'rgba(224,67,58,0)');
    ctx.fillStyle = g;
    ctx.fillRect(fx, fy, fw, zoneH);
    g = ctx.createLinearGradient(0, fy + fh, 0, fy + fh - zoneH);
    g.addColorStop(0, 'rgba(58,122,224,0.40)'); g.addColorStop(1, 'rgba(58,122,224,0)');
    ctx.fillStyle = g;
    ctx.fillRect(fx, fy + fh - zoneH, fw, zoneH);
    for (const [x, z] of sp.attackers) {
      ctx.fillStyle = '#ff8a80';
      ctx.fillRect(X(x) - 1, Y(z) - 1, 2, 2);
    }
    for (const [x, z] of sp.defenders) {
      ctx.fillStyle = '#8ab8ff';
      ctx.fillRect(X(x) - 1, Y(z) - 1, 2, 2);
    }
  } else if (sp.ffa) {
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    for (const [x, z] of sp.ffa) {
      ctx.beginPath(); ctx.arc(X(x), Y(z), 1.6, 0, Math.PI * 2); ctx.fill();
    }
  }

  // boxes / cover, brighter with height so the layout reads at a glance
  for (const b of map.boxes) {
    const bw = b.size[0] * s; const bh = b.size[2] * s;
    const bx = X(b.pos[0]) - bw / 2; const by = Y(b.pos[2]) - bh / 2;
    const lift = Math.min(1.55, 0.95 + b.size[1] * 0.14);
    ctx.fillStyle = shade(b.color, lift);
    ctx.fillRect(bx, by, bw, bh);
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.strokeRect(bx + 0.5, by + 0.5, Math.max(1, bw - 1), Math.max(1, bh - 1));
  }

  // plant sites: gold circles with letters
  for (const [letter, site] of Object.entries(map.sites || {})) {
    const x = X(site.center[0]); const y = Y(site.center[1]);
    const r = Math.max(7, site.radius * s);
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,209,102,0.22)'; ctx.fill();
    ctx.lineWidth = 1.4; ctx.strokeStyle = '#ffd166'; ctx.stroke();
    ctx.fillStyle = '#ffd166';
    ctx.font = `700 ${Math.max(9, Math.min(12, r))}px system-ui, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(letter, x, y + 0.5);
  }

  THUMB_CACHE.set(key, c);
  return c;
}

// ---------------------------------------------------------------- menu
export class Menu {
  constructor(game) {
    this.game = game;
    this.root = document.createElement('div');
    this.root.className = 'menu';
    document.getElementById('app').appendChild(this.root);
    const defaults = {
      modeId: 'competitive',
      mapId: PLANT_MAPS[0].id,
      agentId: AGENTS[0].id,
      botDifficulty: 'normal',
      botCount: 9,
      teamSize: 5,
      roundsOverride: 0,
      spikeTime: 45,
      killTargetOverride: 0,
      settings: { infiniteMoney: false, noCooldown: false, infiniteAmmo: false, oneShot: false, godMode: false },
    };
    this.state = loadStoredState(defaults);
    this.screen = 'main';
    this._bind();
    this.render();
  }

  _bind() {
    bus.on('ui:mainmenu', () => { this.screen = 'main'; this.show(); this.render(); });
  }

  _persist() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state)); } catch { /* Speicher nicht verfügbar — Menü funktioniert trotzdem */ }
  }

  show() { this.root.style.display = 'flex'; }
  hide() { this.root.style.display = 'none'; }

  mapsForMode(modeId) {
    const kind = MODES[modeId].kind;
    if (kind === 'ffa') return FFA_MAPS;
    if (kind === 'gungame') return [...FFA_MAPS, ...PLANT_MAPS];
    return PLANT_MAPS;
  }

  render() {
    if (this.screen === 'main') return this.renderMain();
    if (this.screen === 'setup') return this.renderSetup();
  }

  // Shared animated backdrop (pure CSS animation, markup only here).
  _bgHTML() {
    return `
      <div class="menu-bg"></div>
      <div class="menu-grid-lines"></div>
      <div class="menu-accents" aria-hidden="true"><i class="streak s1"></i><i class="streak s2"></i><i class="orb o1"></i><i class="orb o2"></i></div>`;
  }

  renderMain() {
    const tagline = `Taktischer 5v5 Shooter · ${AGENTS.length} Agenten · ${ALL_MAPS.length} Karten · ${Object.keys(MODES).length} Modi`;
    this.root.innerHTML = `
      ${this._bgHTML()}
      <div class="main-menu">
        <div class="hero-brand">
          <div class="logo-wrap" id="logoWrap"></div>
          <div class="hero-text">
            <h1 class="game-title">SPREE<span>SCHUSS</span></h1>
            <div class="title-rule"><i></i><em>BERLIN PROTOKOLL</em><i></i></div>
            <p class="tagline">${tagline}</p>
          </div>
        </div>
        <div class="main-buttons">
          <button class="btn primary big" id="btnPlay"><span class="btn-icon">${MODE_ICONS.competitive}</span>SPIELEN</button>
          <button class="btn" id="btnQuick"><span class="btn-icon">${MODE_ICONS.tdm}</span>Schnellspiel gegen Bots</button>
          <button class="btn" id="btnFFA"><span class="btn-icon">${MODE_ICONS.deathmatch}</span>Deathmatch (FFA)</button>
          <button class="btn ghost" id="btnHelp"><span class="btn-icon">${svg('<circle cx="7" cy="7" r="6" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M7 6.4v3.2M7 4.2v.2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>')}</span>Anleitung</button>
        </div>
        <div class="help-panel" id="helpPanel"></div>
        <div class="version">SPREESCHUSS v1.0 · prozedural generiert · keine externen Assets</div>
      </div>`;
    this.root.querySelector('#logoWrap').appendChild(makeLogoCanvas(150));
    this.root.querySelector('#btnPlay').onclick = () => { audio.init(); audio.buy(); this.screen = 'setup'; this.render(); };
    this.root.querySelector('#btnQuick').onclick = () => { audio.init(); this.state.modeId = 'unrated'; this.state.mapId = PLANT_MAPS[0].id; this._persist(); this.startGame(); };
    this.root.querySelector('#btnFFA').onclick = () => { audio.init(); this.state.modeId = 'deathmatch'; this.state.mapId = FFA_MAPS[0].id; this._persist(); this.startGame(); };
    this.root.querySelector('#btnHelp').onclick = () => this.toggleHelp();
  }

  toggleHelp() {
    const p = this.root.querySelector('#helpPanel');
    if (p.classList.contains('show')) { p.classList.remove('show'); return; }
    p.classList.add('show');
    p.innerHTML = `
      <h3>Steuerung</h3>
      <ul>
        <li><b>WASD</b> Bewegen · <b>Maus</b> Zielen · <b>Shift</b> Schleichen · <b>Strg/C</b> Ducken · <b>Space</b> Springen</li>
        <li><b>Linksklick</b> Schießen · <b>Rechtsklick</b> Zoom (Sniper) · <b>R</b> Nachladen</li>
        <li><b>1/2/3</b> Waffe/Pistole/Messer · <b>B</b> Waffenshop (Kaufphase)</li>
        <li><b>C · Q · E · X</b> Fähigkeiten (X = Ultimate)</li>
        <li><b>F</b> gedrückt halten: Spike pflanzen / entschärfen · <b>Tab</b> Punktetafel</li>
      </ul>
      <p>Ziel im Spike-Modus: Als Angreifer den Spike auf Spot A/B/C pflanzen und beschützen, als Verteidiger entschärfen oder alle Gegner ausschalten.</p>`;
  }

  // German summary chips for the selected mode, derived from MODES data.
  _modeDetailHTML(m) {
    const chips = [];
    if (m.kind === 'plant') {
      chips.push(`${m.roundsToWin} Runden zum Sieg`);
      if (m.spike) chips.push('Spike pflanzen & entschärfen');
      chips.push(m.buy ? `Kaufphase · Start ¤${m.startCredits}` : 'Zufallswaffen');
      if (m.halftime) chips.push(`Seitenwechsel nach Runde ${m.halftime}`);
      chips.push('5 gegen 5');
    } else if (m.kind === 'tdm') {
      chips.push(`Ziel ${m.killTarget} Team-Kills`, '5 gegen 5', 'Sofortiger Respawn', 'Freie Fähigkeiten');
    } else if (m.kind === 'ffa') {
      chips.push(`Ziel ${m.killTarget} Kills`, 'Jeder gegen jeden', 'Sofortiger Respawn', 'Freie Fähigkeiten');
    } else if (m.kind === 'gungame') {
      chips.push('Jeder Kill = nächste Waffe', 'Messer-Kill gewinnt', 'Jeder gegen jeden', 'Sofortiger Respawn');
    }
    return `
      <div class="mode-detail">
        <div class="md-head">${MODE_ICONS[m.id] || MODE_ICONS.competitive}<b>${m.name}</b></div>
        <div class="md-chips">${chips.map((c) => `<span class="md-chip">${c}</span>`).join('')}</div>
      </div>`;
  }

  renderSetup() {
    const maps = this.mapsForMode(this.state.modeId);
    if (!maps.find((m) => m.id === this.state.mapId)) this.state.mapId = maps[0].id;
    const curMode = MODES[this.state.modeId];
    const kind = curMode.kind;
    const showBotCount = kind === 'ffa' || kind === 'gungame';
    // custom rules are only shown where they apply: team size for team modes,
    // rounds + spike timer for plant modes, kill target for DM/TDM
    const showTeamSize = kind === 'plant' || kind === 'tdm';
    const showRounds = kind === 'plant';
    const showSpike = kind === 'plant';
    const showKillTarget = kind === 'ffa' || kind === 'tdm';
    this.root.innerHTML = `
      ${this._bgHTML()}
      <div class="setup">
        <div class="setup-head">
          <button class="btn ghost small" id="back">← Zurück</button>
          <h2>SPIEL EINRICHTEN</h2>
          <button class="btn primary" id="start">START ▸</button>
        </div>
        <div class="setup-cols">
          <div class="setup-col">
            <h3><span class="col-num">01</span> Modus</h3>
            <div class="mode-list" id="modeList"></div>
            <div id="modeDetail">${this._modeDetailHTML(MODES[this.state.modeId])}</div>
            <h3><span class="col-num">02</span> Bots</h3>
            <div class="row">
              <label>Schwierigkeit</label>
              <select id="diff">
                <option value="easy">Leicht</option><option value="normal" selected>Normal</option><option value="hard">Schwer</option>
              </select>
            </div>
            <div class="row" id="botCountRow" ${showBotCount ? '' : 'style="display:none"'}>
              <label>Bot-Anzahl (FFA)</label>
              <input type="range" id="botCount" min="1" max="11" value="${this.state.botCount}"><span class="range-val" id="botCountVal">${this.state.botCount}</span>
            </div>
            <h3><span class="col-num">03</span> Custom-Regeln</h3>
            <div class="toggles" id="toggles"></div>
            <div class="row" id="teamSizeRow" ${showTeamSize ? '' : 'style="display:none"'}>
              <label>Teamgröße</label>
              <select id="teamSize">
                <option value="2">2 gegen 2</option>
                <option value="3">3 gegen 3</option>
                <option value="4">4 gegen 4</option>
                <option value="5">5 gegen 5 (Standard)</option>
              </select>
            </div>
            <div class="row" id="roundsRow" ${showRounds ? '' : 'style="display:none"'}>
              <label>Runden zum Sieg</label>
              <select id="roundsOverride">
                <option value="0">Standard (${curMode.roundsToWin ?? '–'})</option>
                <option value="5">5 Runden</option>
                <option value="9">9 Runden</option>
                <option value="13">13 Runden</option>
              </select>
            </div>
            <div class="row" id="spikeRow" ${showSpike ? '' : 'style="display:none"'}>
              <label>Spike-Timer</label>
              <select id="spikeTime">
                <option value="30">30 Sekunden</option>
                <option value="45">45 Sekunden (Standard)</option>
                <option value="60">60 Sekunden</option>
              </select>
            </div>
            <div class="row" id="killTargetRow" ${showKillTarget ? '' : 'style="display:none"'}>
              <label>Kill-Ziel</label>
              <select id="killTargetOverride">
                <option value="0">Standard (${curMode.killTarget ?? '–'} Kills)</option>
                <option value="15">15 Kills</option>
                <option value="30">30 Kills</option>
                <option value="40">40 Kills</option>
                <option value="60">60 Kills</option>
              </select>
            </div>
          </div>
          <div class="setup-col">
            <h3><span class="col-num">04</span> Karte <small class="col-count">${maps.length} verfügbar</small></h3>
            <div class="map-grid" id="mapGrid"></div>
          </div>
          <div class="setup-col">
            <h3><span class="col-num">05</span> Agent <small class="col-count">${AGENTS.length} im Kader</small></h3>
            <div class="agent-grid" id="agentGrid"></div>
            <div class="agent-detail" id="agentDetail"></div>
          </div>
        </div>
      </div>`;

    // modes
    const modeList = this.root.querySelector('#modeList');
    for (const m of Object.values(MODES)) {
      const div = document.createElement('div');
      div.className = 'mode-card' + (m.id === this.state.modeId ? ' active' : '');
      div.innerHTML = `
        <div class="mode-icon">${MODE_ICONS[m.id] || MODE_ICONS.competitive}</div>
        <div class="mode-text"><b>${m.name}</b><span>${m.desc}</span></div>`;
      div.onclick = () => { this.state.modeId = m.id; this._persist(); this.renderSetup(); };
      modeList.appendChild(div);
    }
    // toggles
    const toggles = this.root.querySelector('#toggles');
    const tdefs = [
      ['infiniteMoney', 'Unendlich Geld'], ['noCooldown', 'Kein Ability-Cooldown'],
      ['infiniteAmmo', 'Unendlich Munition'], ['oneShot', 'One-Shot-Kills'], ['godMode', 'Gott-Modus'],
    ];
    for (const [k, label] of tdefs) {
      const b = document.createElement('button');
      b.className = 'toggle' + (this.state.settings[k] ? ' on' : '');
      b.innerHTML = `<i class="toggle-dot"></i>${label}`;
      b.onclick = () => { this.state.settings[k] = !this.state.settings[k]; b.classList.toggle('on'); this._persist(); };
      toggles.appendChild(b);
    }
    // maps — cards with real top-down thumbnails + palette swatch strip
    const mapGrid = this.root.querySelector('#mapGrid');
    for (const m of maps) {
      const div = document.createElement('div');
      div.className = 'map-card' + (m.id === this.state.mapId ? ' active' : '');
      const siteKeys = Object.keys(m.sites);
      const tag = m.mode === 'ffa' ? 'FFA' : `Spots ${siteKeys.join(' · ')}`;
      const thumbWrap = document.createElement('div');
      thumbWrap.className = 'map-thumb';
      thumbWrap.appendChild(makeMapThumb(m));
      div.appendChild(thumbWrap);
      const meta = document.createElement('div');
      meta.className = 'map-meta';
      const pal = m.palette;
      const swatches = [pal.floor, pal.wall, pal.accent, pal.skyBottom]
        .map((c) => `<i class="pal-swatch" style="background:${c}"></i>`).join('');
      meta.innerHTML = `
        <span>${m.name}</span>
        <small>${tag} · ${m.size[0]}×${m.size[1]} m</small>
        <div class="pal-strip">${swatches}<em>${pal.name}</em></div>`;
      div.appendChild(meta);
      div.onclick = () => { this.state.mapId = m.id; this._persist(); this.renderSetup(); };
      mapGrid.appendChild(div);
    }
    // agents — cards with procedural portraits (canvas, cached per agent)
    const agentGrid = this.root.querySelector('#agentGrid');
    for (const a of AGENTS) {
      const div = document.createElement('div');
      div.className = 'agent-card' + (a.id === this.state.agentId ? ' active' : '');
      div.style.setProperty('--agent-color', a.color);
      const roleColor = ROLE_COLORS[a.role] || '#9fb3c4';
      const wrap = document.createElement('div');
      wrap.className = 'agent-portrait';
      wrap.appendChild(makeAgentPortrait(a, 72));
      div.appendChild(wrap);
      const label = document.createElement('div');
      label.innerHTML = `
        <span>${a.name}</span>
        <small class="role-badge" style="color:${roleColor};border-color:${roleColor}">${a.role}</small>`;
      div.appendChild(label);
      div.onclick = () => { this.state.agentId = a.id; this._persist(); this.renderSetup(); };
      agentGrid.appendChild(div);
    }
    this.renderAgentDetail();

    // events
    this.root.querySelector('#back').onclick = () => { this.screen = 'main'; this.render(); };
    this.root.querySelector('#start').onclick = () => this.startGame();
    this.root.querySelector('#diff').value = this.state.botDifficulty;
    this.root.querySelector('#diff').onchange = (e) => { this.state.botDifficulty = e.target.value; this._persist(); };
    const bc = this.root.querySelector('#botCount');
    bc.oninput = (e) => { this.state.botCount = +e.target.value; this.root.querySelector('#botCountVal').textContent = e.target.value; this._persist(); };
    // custom-rule selects (numeric state keys, persisted like everything else)
    for (const key of ['teamSize', 'roundsOverride', 'spikeTime', 'killTargetOverride']) {
      const el = this.root.querySelector('#' + key);
      el.value = String(this.state[key]);
      el.onchange = (e) => { this.state[key] = +e.target.value; this._persist(); };
    }
  }

  renderAgentDetail() {
    const a = AGENTS.find((x) => x.id === this.state.agentId);
    const d = this.root.querySelector('#agentDetail');
    const roleColor = ROLE_COLORS[a.role] || '#9fb3c4';
    const ab = (k) => {
      const x = a.abilities[k];
      const icon = ABILITY_ICONS[x.type] || '';
      const kindLabel = ABILITY_TYPE_NAMES[x.type] || '';
      const costLabel = x.ult
        ? `<em class="ad-ult">ULT · ${x.points || 7} Punkte</em>`
        : (x.cost ? `<em>¤${x.cost}</em>` : '<em>Signature</em>');
      return `<div class="ad-ability${x.ult ? ' is-ult' : ''}">
        <b class="ad-key">${k}</b>
        <span class="ad-icon" style="color:${a.color}">${icon}</span>
        <span class="ad-name">${x.name}<small>${kindLabel}</small></span>
        ${costLabel}
      </div>`;
    };
    d.innerHTML = `
      <div class="ad-head">
        <div class="ad-portrait" id="adPortrait"></div>
        <div class="ad-title">
          <h4 style="color:${a.color}">${a.name}</h4>
          <small class="role-badge" style="color:${roleColor};border-color:${roleColor}">${a.role}</small>
        </div>
      </div>
      <p>${a.desc}</p>
      ${ab('C')}${ab('Q')}${ab('E')}${ab('X')}`;
    d.querySelector('#adPortrait').appendChild(makeAgentPortrait(a, 56));
  }

  startGame() {
    this._persist();
    this.hide();
    this.game.loadMatch({
      modeId: this.state.modeId,
      mapId: this.state.mapId,
      playerAgentId: this.state.agentId,
      settings: {
        ...this.state.settings,
        botDifficulty: this.state.botDifficulty,
        botCount: this.state.botCount,
        teamSize: this.state.teamSize,
        roundsOverride: this.state.roundsOverride,
        spikeTime: this.state.spikeTime,
        killTargetOverride: this.state.killTargetOverride,
      },
    });
    bus.emit('game:started');
  }
}
