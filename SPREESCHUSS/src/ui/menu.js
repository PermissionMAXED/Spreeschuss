import { bus } from '../engine/eventbus.js';
import { AGENTS } from '../agents/agents.js';
import { MODES } from '../game/modes.js';
import { PLANT_MAPS, FFA_MAPS, ALL_MAPS } from '../maps/maps.js';
import { makeLogoCanvas } from './logo.js';
import { audio } from '../audio/audio.js';

export class Menu {
  constructor(game) {
    this.game = game;
    this.root = document.createElement('div');
    this.root.className = 'menu';
    document.getElementById('app').appendChild(this.root);
    this.state = {
      modeId: 'competitive',
      mapId: PLANT_MAPS[0].id,
      agentId: AGENTS[0].id,
      botDifficulty: 'normal',
      botCount: 9,
      settings: { infiniteMoney: false, noCooldown: false, infiniteAmmo: false, oneShot: false, godMode: false },
    };
    this.screen = 'main';
    this._bind();
    this.render();
  }

  _bind() {
    bus.on('ui:mainmenu', () => { this.screen = 'main'; this.show(); this.render(); });
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

  renderMain() {
    this.root.innerHTML = `
      <div class="menu-bg"></div>
      <div class="main-menu">
        <div class="logo-wrap" id="logoWrap"></div>
        <h1 class="game-title">SPREESCHUSS</h1>
        <p class="tagline">Taktischer 5v5 Shooter · 16 Agenten · 35 Karten · 6 Modi</p>
        <div class="main-buttons">
          <button class="btn primary" id="btnPlay">SPIELEN</button>
          <button class="btn" id="btnQuick">Schnellspiel gegen Bots</button>
          <button class="btn" id="btnFFA">Deathmatch (FFA)</button>
          <button class="btn ghost" id="btnHelp">Anleitung</button>
        </div>
        <div class="help-panel" id="helpPanel"></div>
        <div class="version">v0.1 · procedural build</div>
      </div>`;
    this.root.querySelector('#logoWrap').appendChild(makeLogoCanvas(150));
    this.root.querySelector('#btnPlay').onclick = () => { audio.init(); audio.buy(); this.screen = 'setup'; this.render(); };
    this.root.querySelector('#btnQuick').onclick = () => { audio.init(); this.state.modeId = 'unrated'; this.state.mapId = PLANT_MAPS[0].id; this.startGame(); };
    this.root.querySelector('#btnFFA').onclick = () => { audio.init(); this.state.modeId = 'deathmatch'; this.state.mapId = FFA_MAPS[0].id; this.startGame(); };
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

  renderSetup() {
    const maps = this.mapsForMode(this.state.modeId);
    if (!maps.find((m) => m.id === this.state.mapId)) this.state.mapId = maps[0].id;
    this.root.innerHTML = `
      <div class="menu-bg"></div>
      <div class="setup">
        <div class="setup-head">
          <button class="btn ghost small" id="back">← Zurück</button>
          <h2>Spiel einrichten</h2>
          <button class="btn primary" id="start">START</button>
        </div>
        <div class="setup-cols">
          <div class="setup-col">
            <h3>Modus</h3>
            <div class="mode-list" id="modeList"></div>
            <h3>Bots</h3>
            <div class="row">
              <label>Schwierigkeit</label>
              <select id="diff">
                <option value="easy">Leicht</option><option value="normal" selected>Normal</option><option value="hard">Schwer</option>
              </select>
            </div>
            <div class="row" id="botCountRow">
              <label>Bot-Anzahl (FFA)</label>
              <input type="range" id="botCount" min="1" max="11" value="${this.state.botCount}"><span id="botCountVal">${this.state.botCount}</span>
            </div>
            <h3>Custom-Regeln</h3>
            <div class="toggles" id="toggles"></div>
          </div>
          <div class="setup-col">
            <h3>Karte</h3>
            <div class="map-grid" id="mapGrid"></div>
          </div>
          <div class="setup-col">
            <h3>Agent</h3>
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
      div.innerHTML = `<b>${m.name}</b><span>${m.desc}</span>`;
      div.onclick = () => { this.state.modeId = m.id; this.renderSetup(); };
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
      b.textContent = label;
      b.onclick = () => { this.state.settings[k] = !this.state.settings[k]; b.classList.toggle('on'); };
      toggles.appendChild(b);
    }
    // maps
    const mapGrid = this.root.querySelector('#mapGrid');
    for (const m of maps) {
      const div = document.createElement('div');
      div.className = 'map-card' + (m.id === this.state.mapId ? ' active' : '');
      div.innerHTML = `<div class="map-thumb" style="background:linear-gradient(135deg, ${m.palette.skyTop}, ${m.palette.accent})"></div><span>${m.name}</span><small>${m.mode === 'ffa' ? 'FFA' : Object.keys(m.sites).join('/')}</small>`;
      div.onclick = () => { this.state.mapId = m.id; this.renderSetup(); };
      mapGrid.appendChild(div);
    }
    // agents
    const agentGrid = this.root.querySelector('#agentGrid');
    for (const a of AGENTS) {
      const div = document.createElement('div');
      div.className = 'agent-card' + (a.id === this.state.agentId ? ' active' : '');
      div.style.borderColor = a.color;
      div.innerHTML = `<div class="agent-avatar" style="background:${a.color}">${a.name[0]}</div><span>${a.name}</span><small>${a.role}</small>`;
      div.onclick = () => { this.state.agentId = a.id; this.renderSetup(); };
      agentGrid.appendChild(div);
    }
    this.renderAgentDetail();

    // events
    this.root.querySelector('#back').onclick = () => { this.screen = 'main'; this.render(); };
    this.root.querySelector('#start').onclick = () => this.startGame();
    this.root.querySelector('#diff').value = this.state.botDifficulty;
    this.root.querySelector('#diff').onchange = (e) => { this.state.botDifficulty = e.target.value; };
    const bc = this.root.querySelector('#botCount');
    bc.oninput = (e) => { this.state.botCount = +e.target.value; this.root.querySelector('#botCountVal').textContent = e.target.value; };
  }

  renderAgentDetail() {
    const a = AGENTS.find((x) => x.id === this.state.agentId);
    const d = this.root.querySelector('#agentDetail');
    const ab = (k) => { const x = a.abilities[k]; return `<div class="ad-ability"><b>${k}</b> ${x.name}${x.ult ? ' <em>(Ult)</em>' : ''}</div>`; };
    d.innerHTML = `<h4 style="color:${a.color}">${a.name} — ${a.role}</h4><p>${a.desc}</p>${ab('C')}${ab('Q')}${ab('E')}${ab('X')}`;
  }

  startGame() {
    this.hide();
    this.game.loadMatch({
      modeId: this.state.modeId,
      mapId: this.state.mapId,
      playerAgentId: this.state.agentId,
      settings: { ...this.state.settings, botDifficulty: this.state.botDifficulty, botCount: this.state.botCount },
    });
    bus.emit('game:started');
  }
}
