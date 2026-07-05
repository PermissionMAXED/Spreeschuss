import * as THREE from 'three';
import { bus } from '../engine/eventbus.js';
import { SHOP_ORDER, WEAPONS, ARMOR } from '../weapons/weapons.js';
import { AGENTS } from '../agents/agents.js';
import { agentPortraitURL, ABILITY_ICONS } from './logo.js';
import { loadProgress, saveProgress, computeMatchXP, levelFor, recordRoundMvp, getMvpCount, resetMatchTracking } from './progression.js';

// Small inline-SVG icons (no external assets).
const svg = (body, vb = '0 0 22 10', w = 22, h = 10) => `<svg viewBox="${vb}" width="${w}" height="${h}" aria-hidden="true">${body}</svg>`;
const KILL_ICONS = {
  gun: svg('<path d="M0 3h13.5L15.5 0H19v3h3v3.4h-8.2L12.6 10H9l1.2-3.6H0z" fill="currentColor"/>'),
  knife: svg('<path d="M1 13C6 10.4 10.6 7 14.6 1.4L17 3.8C13.6 8.6 9 11.8 4.4 13.6L3 15z" fill="currentColor"/>', '0 0 18 16', 16, 14),
  zone: svg('<path d="M7 0c1 3 4.2 4.2 4.2 8.2a4.2 4.2 0 1 1-8.4 0c0-2.1 1-3.3 2-4.4.1 1 .5 2 1.3 2.3C6 4.2 5.5 2.1 7 0z" fill="currentColor"/>', '0 0 14 14', 13, 13),
  turret: svg('<path d="M5.5 0h3v4.4H13v3H9.8V13H4.2V7.4H1v-3h4.5z" fill="currentColor"/>', '0 0 14 13', 13, 12),
  head: svg('<circle cx="7" cy="7" r="5.4" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="7" cy="7" r="2" fill="currentColor"/>', '0 0 14 14', 12, 12),
};
const CHECK_ICON = svg('<path d="M2 7.5l3.4 3.4L12 3.6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>', '0 0 14 14', 11, 11);
const CAT_LABELS = {
  melee: 'Nahkampf', sidearm: 'Pistole', smg: 'Maschinenpistole', rifle: 'Sturmgewehr',
  shotgun: 'Schrotflinte', sniper: 'Scharfschütze', heavy: 'Schwere Waffe',
};
const AGENT_COLORS = Object.fromEntries(AGENTS.map((a) => [a.name, a.color]));
const AGENT_BY_NAME = Object.fromEntries(AGENTS.map((a) => [a.name, a]));

const MM_SIZE = 220;
const MM_PAD = 12;

// Builds and maintains the in-game HUD overlay. Subscribes to the event bus.
export class HUD {
  constructor(game) {
    this.game = game;
    this.root = document.createElement('div');
    this.root.className = 'hud';
    document.getElementById('app').appendChild(this.root);
    this._build();
    this._bind();
    this.scoreboardHeld = false;
    this._spread = 0; // crosshair bloom, decays each hud tick
    this._abSig = ''; // ability bar DOM signature (rebuild only on change)
    this._abEls = {};
    this._abReady = {};
    this._spikeSig = 'none';
    this._mmLayerId = null; // cached minimap wall layer (per map id)
    this._dmgPool = []; // free floating-damage-number nodes (DOM stays attached)
    this._dmgLive = []; // active damage numbers, oldest first
    this._mvpShowT = 0;
    this._mvpHideT = 0;
    this._xpAwarded = false; // one XP award per 'match:end' (reset on 'match:start')
    this._xpAward = null;    // cached award for defensive re-renders
    this._xpAnim = null;     // running XP-panel animation (raf + timers)
  }

  _build() {
    this.root.innerHTML = `
      <div class="crosshair" id="crosshair"><span></span><span></span><span></span><span></span><i class="ch-dot"></i></div>
      <div class="hitmarker" id="hitmarker"></div>
      <div class="flash-overlay" id="flash"></div>
      <div class="dmg-vignette" id="dmgv"></div>
      <div class="dmg-numbers" id="dmgNums"></div>
      <div class="dmg-dir" id="dmgDir"><i class="dd-arc"></i><i class="dd-arc"></i><i class="dd-arc"></i></div>
      <div class="scope-overlay" id="scope"><div class="scope-cross-v"></div><div class="scope-cross-h"></div></div>

      <div class="topbar">
        <div class="score att" id="scoreAtt">0</div>
        <div class="timer" id="timer">
          <div class="round-label" id="roundLabel"></div>
          <div class="round-timer" id="roundTimer">0:00</div>
          <div class="phase-label" id="phaseLabel"></div>
        </div>
        <div class="score def" id="scoreDef">0</div>
      </div>
      <div class="spike-status" id="spikeStatus"></div>

      <div class="minimap-wrap"><canvas class="minimap" id="minimap" width="220" height="220"></canvas></div>

      <div class="killfeed" id="killfeed"></div>
      <div class="center-banner" id="banner"></div>
      <div class="mvp-strip" id="mvpStrip"></div>
      <div class="toast" id="toast"></div>

      <div class="bottom-left">
        <div class="vitals">
          <div class="vital-row">
            <span class="vital-num hp-num" id="hp">100</span>
            <div class="vital-bar"><div class="vital-fill hp-fill" id="hpFill"></div></div>
          </div>
          <div class="vital-row armor-row" id="armorRow">
            <span class="vital-num armor-num" id="armor">0</span>
            <div class="vital-bar slim"><div class="vital-fill armor-fill" id="armorFill"></div></div>
          </div>
        </div>
        <div class="abilities" id="abilities"></div>
      </div>

      <div class="bottom-right">
        <div class="credits" id="credits">¤ 800</div>
        <div class="ammo"><span id="ammoMag">0</span><span class="ammo-sep">/</span><span id="ammoReserve">0</span></div>
        <div class="reload-hint" id="reloadHint"><b>R</b> NACHLADEN</div>
        <div class="weapon-line"><span class="weapon-name" id="weaponName">Classic</span><span class="weapon-cat" id="weaponCat"></span></div>
      </div>

      <div class="interact-bar" id="interactBar"><div class="interact-fill" id="interactFill"></div><div class="interact-label" id="interactLabel"></div></div>

      <div class="buy-menu" id="buyMenu"></div>
      <div class="scoreboard" id="scoreboard"></div>
      <div class="death-overlay" id="deathOverlay"><div class="death-inner"><h2>AUSGESCHALTET</h2><p>Beobachtungsmodus</p></div></div>
      <div class="matchend" id="matchend"></div>
    `;
    this.el = {};
    for (const id of ['crosshair', 'hitmarker', 'flash', 'dmgv', 'dmgNums', 'dmgDir', 'scope', 'scoreAtt', 'scoreDef', 'roundLabel', 'roundTimer', 'phaseLabel', 'spikeStatus', 'minimap', 'killfeed', 'banner', 'mvpStrip', 'toast', 'hp', 'hpFill', 'armor', 'armorFill', 'armorRow', 'abilities', 'credits', 'ammoMag', 'ammoReserve', 'reloadHint', 'weaponName', 'weaponCat', 'interactBar', 'interactFill', 'interactLabel', 'buyMenu', 'scoreboard', 'deathOverlay', 'matchend']) {
      this.el[id] = this.root.querySelector('#' + id);
    }
    this.mmCtx = this.el.minimap.getContext('2d');
    this._dirArcs = [...this.el.dmgDir.querySelectorAll('.dd-arc')].map((node) => ({ node, until: 0, timer: 0 }));
  }

  _bind() {
    bus.on('hud', (d) => this.update(d));
    bus.on('hitmarker', (d) => this.showHit(d));
    bus.on('flash', (d) => this.showFlash(d));
    bus.on('kill', (d) => this.addKill(d));
    bus.on('toast', (m) => this.toast(m));
    bus.on('interact', (d) => this.showInteract(d));
    bus.on('scoreboard', (v) => {
      this.scoreboardHeld = v;
      if (v && this.last) this._renderScoreboard(this.last.scoreboard, this.last);
      this.el.scoreboard.classList.toggle('show', v);
    });
    bus.on('round:end', (d) => {
      this.banner(d.winner === this.game.playerSide ? 'RUNDE GEWONNEN' : 'RUNDE VERLOREN', d.winner === this.game.playerSide ? 'win' : 'lose');
      // progression: count rounds where the player is MVP (name 'Du')
      if (d.mvp && d.mvp.name === (this.game.player?.name || 'Du')) recordRoundMvp();
      this._queueMvp(d.mvp);
    });
    bus.on('round:start', () => this._hideMvp());
    bus.on('damage', (d) => this.onDamage(d));
    bus.on('spike:planted', (d) => this.toast(`Spike auf ${d.site} gepflanzt!`));
    bus.on('halftime', () => this.banner('SEITENWECHSEL', 'neutral'));
    bus.on('buy:toggle', (open) => this.renderBuyMenu(open));
    bus.on('match:end', (d) => this.showMatchEnd(d));
    bus.on('match:start', () => {
      this.el.matchend.classList.remove('show');
      this.el.deathOverlay.classList.remove('show');
      this.scoreboardHeld = false;
      this.el.scoreboard.classList.remove('show');
      this._abSig = '';
      this._abReady = {};
      this._spikeSig = 'none';
      this._mmLayerId = null;
      this._hideMvp();
      this._resetDamageNumbers();
      this._xpAwarded = false;
      this._xpAward = null;
      this._cancelXpAnim();
      resetMatchTracking();
      for (const a of this._dirArcs) { clearTimeout(a.timer); a.until = 0; a.node.classList.remove('on'); }
    });
    bus.on('muzzle', () => { this._spread = 1; }); // player shot fired → crosshair bloom
  }

  update(d) {
    this.last = d;
    // vitals: numbers + bars
    this.el.hp.textContent = d.hp;
    const hpPct = Math.max(0, Math.min(100, d.hp));
    this.el.hpFill.style.width = hpPct + '%';
    this.el.hpFill.className = 'vital-fill hp-fill' + (hpPct <= 25 ? ' crit' : (hpPct <= 55 ? ' low' : ''));
    this.el.hp.classList.toggle('crit', hpPct <= 25);
    this.el.armor.textContent = d.armor;
    this.el.armorFill.style.width = Math.max(0, Math.min(100, d.armor * 2)) + '%';
    this.el.armorRow.classList.toggle('empty', d.armor <= 0);
    // low-HP heartbeat vignette (only while alive, intensity by threshold)
    this.el.dmgv.className = 'dmg-vignette' + (!d.alive ? '' : (hpPct <= 25 ? ' crit' : (hpPct <= 45 ? ' low' : '')));

    this.el.credits.textContent = '¤ ' + d.credits;
    this.el.weaponName.textContent = d.weapon;
    this.el.weaponCat.textContent = CAT_LABELS[d.weaponCat] || '';
    this.el.ammoMag.textContent = d.mag > 0 ? d.ammo : '∞';
    this.el.ammoReserve.textContent = d.mag > 0 ? d.reserve : '';
    const lowAmmo = d.mag > 0 && d.ammo <= Math.max(1, Math.floor(d.mag * 0.25));
    this.el.ammoMag.classList.toggle('low', lowAmmo);
    this.el.reloadHint.classList.toggle('show', d.alive && d.mag > 0 && d.ammo === 0 && d.reserve > 0 && !d.buyOpen);
    this.el.scoreAtt.textContent = d.attScore;
    this.el.scoreDef.textContent = d.defScore;
    this.el.scoreAtt.classList.toggle('mine', d.side === 'att');
    this.el.scoreDef.classList.toggle('mine', d.side === 'def');

    const plant = d.mode && d.mode.kind === 'plant';
    const spikeLive = plant && d.spike && d.spike.planted && !d.spike.defused;
    if (plant) {
      const m = Math.floor(d.timeLeft / 60);
      const s = (d.timeLeft % 60).toString().padStart(2, '0');
      this.el.roundTimer.textContent = `${m}:${s}`;
      this.el.roundTimer.classList.toggle('urgent', d.timeLeft <= 10 || spikeLive);
      this.el.phaseLabel.textContent = spikeLive ? 'SPIKE TICKT' : ({ buy: 'KAUFPHASE · [B] SHOP', live: '' }[d.phase] || '');
      this.el.roundLabel.textContent = `RUNDE ${d.round}`;
    } else {
      // deathmatch / tdm / gungame: show goal instead of a countdown
      this.el.roundTimer.textContent = d.mode && d.mode.kind === 'gungame' ? '⚔' : 'DM';
      this.el.roundTimer.classList.remove('urgent');
      this.el.phaseLabel.textContent = d.goalText || '';
      this.el.roundLabel.textContent = '';
    }

    this._renderSpike(d);
    this._renderAbilities(d.abilities, d.ultPoints, d.ultMax);

    // Re-assert scoreboard visibility each HUD tick (~30/s). Hold-to-show is
    // driven by the one-shot 'scoreboard' events AND the live key state, so a
    // missed/blocked keydown self-heals while Tab is physically held, and a
    // lone keyup (or flaky events) can never leave the panel stuck open.
    const tabDown = !!this.game.input?.isDown('Tab');
    if (tabDown !== this.scoreboardHeld) this.scoreboardHeld = tabDown;
    this.el.scoreboard.classList.toggle('show', this.scoreboardHeld);
    if (this.scoreboardHeld) this._renderScoreboard(d.scoreboard, d);
    this._drawMinimap(d.minimap, d.side);

    // scope overlay (sniper right-click) — read live game state each tick
    const scoped = !!this.game.scopeActive;
    this.el.scope.classList.toggle('show', scoped);

    // crosshair: bloom decay after shots, hidden while scoped/dead/in shop
    this._spread *= 0.74;
    if (this._spread < 0.02) this._spread = 0;
    const gap = 5 + this._spread * 9;
    this.el.crosshair.style.setProperty('--ch-gap', gap.toFixed(1) + 'px');
    this.el.crosshair.classList.toggle('hidden', scoped || !d.alive || d.buyOpen);

    // death overlay
    this.el.deathOverlay.classList.toggle('show', !d.alive && this.game.state === 'playing');
  }

  // ---------------------------------------------------------------- spike arc
  // After the plant the payload keeps counting `timeLeft` down; the first tick
  // after planting is remembered as the full duration so the arc needs no
  // knowledge of internal game constants.
  _renderSpike(d) {
    const el = this.el.spikeStatus;
    const sp = d.spike;
    const planted = !!(sp && sp.planted && !sp.defused);
    const sig = planted ? 'planted:' + sp.site : (sp && sp.carrier ? 'carry' : 'none');
    if (sig !== this._spikeSig) {
      this._spikeSig = sig;
      if (planted) {
        this._spikeMax = Math.max(1, d.timeLeft);
        el.className = 'spike-status active';
        el.innerHTML = `
          <span class="spike-arc"><svg viewBox="0 0 40 40" width="38" height="38" aria-hidden="true">
            <circle class="sa-bg" cx="20" cy="20" r="16"></circle>
            <circle class="sa-fg" cx="20" cy="20" r="16"></circle>
          </svg><b class="sa-secs">${d.timeLeft}</b></span>
          <span class="spike-text"><i class="spike-dot"></i> SPIKE AKTIV · SPOT ${sp.site}</span>`;
        this._spikeArc = el.querySelector('.sa-fg');
        this._spikeSecs = el.querySelector('.sa-secs');
      } else if (sp && sp.carrier) {
        el.className = 'spike-status carry';
        el.innerHTML = '◆ Du trägst den Spike — halte <b>F</b> auf einem Spot';
      } else {
        el.className = 'spike-status';
        el.textContent = '';
      }
    }
    if (planted && this._spikeArc) {
      const frac = Math.max(0, Math.min(1, d.timeLeft / this._spikeMax));
      const C = 2 * Math.PI * 16;
      this._spikeArc.style.strokeDasharray = C.toFixed(2);
      this._spikeArc.style.strokeDashoffset = (C * (1 - frac)).toFixed(2);
      this._spikeSecs.textContent = d.timeLeft;
      el.classList.toggle('hot', d.timeLeft <= 10);
    }
  }

  // ---------------------------------------------------------------- abilities
  // The ability bar DOM is built once per loadout and then only mutated, so
  // CSS transitions (pips, ready glow) actually animate. A ready-flip triggers
  // a one-shot light sweep over the slot.
  _renderAbilities(ab, ultPoints, ultMax) {
    if (!ab) return;
    const agent = this.game.player?.agent;
    const sig = (agent?.id || '?') + '‖' + ['C', 'Q', 'E', 'X'].map((k) => ab[k] ? `${k}:${ab[k].name}/${ab[k].max}` : '').join('|') + '‖' + (ultMax || 0);
    if (sig !== this._abSig) {
      this._abSig = sig;
      this._abEls = {};
      this._abReady = {};
      this.el.abilities.innerHTML = '';
      for (const key of ['C', 'Q', 'E', 'X']) {
        const a = ab[key];
        if (!a) continue;
        const isUlt = key === 'X';
        const type = agent?.abilities?.[key]?.type;
        const icon = ABILITY_ICONS[type] || '';
        const max = Math.max(1, isUlt ? (ultMax || a.max) : a.max);
        const div = document.createElement('div');
        div.className = 'ability' + (isUlt ? ' ult' : '');
        div.innerHTML = `
          <i class="ab-sweep"></i>
          <div class="ab-head"><span class="ab-key">${key}</span><span class="ab-icon" style="color:${agent?.color || 'currentColor'}">${icon}</span></div>
          <div class="ab-name">${a.name}</div>
          <div class="ab-pips${isUlt ? ' ult-pips' : ''}">${'<i></i>'.repeat(max)}</div>
          ${isUlt ? '<div class="ab-charges">0/' + max + '</div>' : ''}`;
        this.el.abilities.appendChild(div);
        this._abEls[key] = { root: div, pips: [...div.querySelectorAll('.ab-pips i')], charges: div.querySelector('.ab-charges'), max };
      }
    }
    for (const key of ['C', 'Q', 'E', 'X']) {
      const a = ab[key];
      const els = this._abEls[key];
      if (!a || !els) continue;
      const isUlt = key === 'X';
      const count = isUlt ? Math.min(els.max, ultPoints ?? a.charges) : a.charges;
      els.pips.forEach((pip, i) => pip.classList.toggle('on', i < count));
      if (els.charges) els.charges.textContent = `${count}/${els.max}`;
      els.root.classList.toggle('ready', a.ready);
      els.root.classList.toggle('notready', !a.ready);
      if (a.ready && this._abReady[key] === false) {
        // cooldown finished → play the sweep once
        els.root.classList.remove('just-ready');
        void els.root.offsetWidth;
        els.root.classList.add('just-ready');
        clearTimeout(els._sweepT);
        els._sweepT = setTimeout(() => els.root.classList.remove('just-ready'), 750);
      }
      this._abReady[key] = a.ready;
    }
  }

  // ---------------------------------------------------------------- scoreboard
  _renderScoreboard(sb, d) {
    if (!sb) return;
    const pipStrip = (score, total, cls) => {
      if (!total || total > 15) return '';
      let pips = '';
      for (let i = 0; i < total; i++) pips += `<i class="${i < score ? 'on' : ''}"></i>`;
      return `<span class="sb-pips ${cls}">${pips}</span>`;
    };
    const rows = (team) => {
      const list = sb.filter((r) => team === 'all' || r.team === team);
      const maxK = Math.max(0, ...list.map((r) => r.kills));
      return list.map((r) => {
        const agent = AGENT_BY_NAME[r.agent];
        const portrait = agent
          ? `<img class="sb-portrait" src="${agentPortraitURL(agent, 26)}" alt="" style="--agent-color:${agent.color}">`
          : `<i class="agent-dot" style="background:${AGENT_COLORS[r.agent] || '#8298aa'}"></i>`;
        const top = maxK > 0 && r.kills === maxK;
        const kd = r.deaths > 0 ? (r.kills / r.deaths).toFixed(1) : r.kills.toFixed(1);
        return `
        <tr class="${r.isPlayer ? 'me' : ''} ${r.alive ? '' : 'dead'} ${top ? 'topfrag' : ''}">
          <td class="c-agent">${portrait}${r.agent || ''}</td>
          <td class="c-name">${r.name}${r.alive ? '' : ' <small class="sb-dead-tag">✕</small>'}</td>
          <td class="c-num${top ? ' c-top' : ''}">${r.kills}${top ? '<em class="sb-star">★</em>' : ''}</td>
          <td class="c-num">${r.deaths}</td>
          <td class="c-num c-ass">${r.assists ?? 0}</td>
          <td class="c-num c-kd ${r.kills >= r.deaths ? 'pos' : 'neg'}">${kd}</td>
          <td class="c-num c-cred">¤${r.credits}</td>
        </tr>`;
      }).join('');
    };
    const head = `<tr><th>Agent</th><th>Name</th><th>K</th><th>T</th><th>A</th><th>K/T</th><th>¤</th></tr>`;
    let body;
    if (d.mode && (d.mode.kind === 'ffa' || d.mode.kind === 'gungame')) {
      body = `<table>${head}${rows('all')}</table>`;
    } else {
      const rtw = d.mode?.roundsToWin;
      body = `<div class="sb-team att"><h3>Angriff <b>${d.attScore}</b>${pipStrip(d.attScore, rtw, 'att')}</h3><table>${head}${rows('att')}</table></div>
              <div class="sb-team def"><h3>Verteidigung <b>${d.defScore}</b>${pipStrip(d.defScore, rtw, 'def')}</h3><table>${head}${rows('def')}</table></div>`;
    }
    const sub = d.mode?.kind === 'plant' ? ` · Runde ${d.round}` : (d.goalText ? ` · ${d.goalText}` : '');
    this.el.scoreboard.innerHTML = `<div class="sb-inner"><h2>${d.mode?.name || ''} <span class="sb-map">— ${this.game.map?.name || ''}${sub}</span></h2>${body}<div class="sb-hint">Tab halten</div></div>`;
  }

  // ---------------------------------------------------------------- minimap
  // Static layout (backdrop, grid, walls from map.boxes) is rendered ONCE per
  // map into an offscreen canvas and composited every frame; only the dynamic
  // markers (sites, spike, entities) are drawn per tick.
  _wallLayer(mm) {
    const id = this.game.map?.id || 'none';
    if (this._mmLayerId === id && this._mmLayer) return this._mmLayer;
    const S = MM_SIZE; const pad = MM_PAD;
    const c = document.createElement('canvas');
    c.width = S; c.height = S;
    const ctx = c.getContext('2d');
    ctx.fillStyle = 'rgba(7,13,20,0.80)';
    ctx.fillRect(0, 0, S, S);
    const { minX, maxX, minZ, maxZ } = mm.bounds;
    const w = maxX - minX; const h = maxZ - minZ;
    const toX = (x) => pad + ((x - minX) / w) * (S - 2 * pad);
    const toY = (z) => pad + ((z - minZ) / h) * (S - 2 * pad);
    // subtle grid
    ctx.strokeStyle = 'rgba(120,160,190,0.09)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      const t = pad + (i / 4) * (S - 2 * pad);
      ctx.beginPath(); ctx.moveTo(t, pad); ctx.lineTo(t, S - pad); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(pad, t); ctx.lineTo(S - pad, t); ctx.stroke();
    }
    // wall layout from map data: solid walls bright, chest-high cover mid,
    // jumpable low cover faint; overhead lintels/trim are skipped.
    for (const b of (this.game.map?.boxes || [])) {
      const bottom = b.pos[1] - b.size[1] / 2;
      const top = b.pos[1] + b.size[1] / 2;
      if (bottom > 1.9) continue;
      const bw = Math.max(1.5, (b.size[0] / w) * (S - 2 * pad));
      const bh = Math.max(1.5, (b.size[2] / h) * (S - 2 * pad));
      const x = toX(b.pos[0]) - bw / 2;
      const y = toY(b.pos[2]) - bh / 2;
      if (top >= 1.5) {
        ctx.fillStyle = 'rgba(132,170,198,0.50)';
        ctx.fillRect(x, y, bw, bh);
        ctx.strokeStyle = 'rgba(178,210,232,0.30)';
        ctx.strokeRect(x + 0.5, y + 0.5, Math.max(1, bw - 1), Math.max(1, bh - 1));
      } else if (top >= 0.8) {
        ctx.fillStyle = 'rgba(132,170,198,0.30)';
        ctx.fillRect(x, y, bw, bh);
      } else {
        ctx.fillStyle = 'rgba(132,170,198,0.14)';
        ctx.fillRect(x, y, bw, bh);
      }
    }
    ctx.strokeStyle = 'rgba(120,160,190,0.24)';
    ctx.strokeRect(pad, pad, S - 2 * pad, S - 2 * pad);
    this._mmLayer = c;
    this._mmLayerId = id;
    return c;
  }

  _drawMinimap(mm) {
    if (!mm) return;
    const ctx = this.mmCtx;
    const S = MM_SIZE; const pad = MM_PAD;
    ctx.clearRect(0, 0, S, S);
    ctx.drawImage(this._wallLayer(mm), 0, 0);
    const { minX, maxX, minZ, maxZ } = mm.bounds;
    const w = maxX - minX; const h = maxZ - minZ;
    const toX = (x) => pad + ((x - minX) / w) * (S - 2 * pad);
    const toY = (z) => pad + ((z - minZ) / h) * (S - 2 * pad);
    // sites
    for (const s of mm.sites) {
      const x = toX(s.x); const y = toY(s.z);
      ctx.beginPath(); ctx.arc(x, y, 14, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,209,102,0.16)'; ctx.fill();
      ctx.strokeStyle = 'rgba(255,209,102,0.85)'; ctx.lineWidth = 1.2; ctx.stroke();
      ctx.fillStyle = '#ffd166'; ctx.font = 'bold 11px system-ui, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(s.key, x, y + 4);
    }
    // spike (pulsing)
    if (mm.spike) {
      const t = (performance.now() % 1000) / 1000;
      const x = toX(mm.spike.x); const y = toY(mm.spike.z);
      ctx.beginPath(); ctx.arc(x, y, 5 + t * 8, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255,48,64,${0.8 * (1 - t)})`; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = '#ff3040';
      ctx.beginPath(); ctx.arc(x, y, 4.5, 0, Math.PI * 2); ctx.fill();
    }
    // entities
    for (const it of mm.items) {
      const x = toX(it.x); const y = toY(it.z);
      if (it.isPlayer) {
        // view cone in facing direction (same forward mapping as the marker)
        const ang = Math.atan2(Math.cos(it.yaw), Math.sin(it.yaw));
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.arc(x, y, 26, ang - 0.55, ang + 0.55);
        ctx.closePath();
        ctx.fillStyle = 'rgba(255,255,255,0.10)';
        ctx.fill();
      }
      ctx.fillStyle = it.isPlayer ? '#ffffff' : (it.friendly ? '#43d17a' : '#ff4a4a');
      ctx.beginPath();
      ctx.moveTo(x + Math.sin(it.yaw) * 6, y + Math.cos(it.yaw) * 6);
      ctx.lineTo(x - Math.sin(it.yaw + 2.4) * 5, y - Math.cos(it.yaw + 2.4) * 5);
      ctx.lineTo(x - Math.sin(it.yaw - 2.4) * 5, y - Math.cos(it.yaw - 2.4) * 5);
      ctx.closePath();
      ctx.fill();
      if (it.isPlayer) { ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 1; ctx.stroke(); }
    }
  }

  showHit(d) {
    const hm = this.el.hitmarker;
    hm.className = 'hitmarker show' + (d.head ? ' head' : '') + (d.kill ? ' kill' : '');
    clearTimeout(this._hmT);
    this._hmT = setTimeout(() => { hm.className = 'hitmarker'; }, 180);
  }

  showFlash(d) {
    const f = this.el.flash;
    f.style.transition = 'none';
    f.style.opacity = Math.min(1, d.intensity + 0.2);
    requestAnimationFrame(() => {
      f.style.transition = `opacity ${d.duration}s ease-out`;
      f.style.opacity = 0;
    });
  }

  // ---------------------------------------------------------------- damage feedback
  onDamage(d) {
    if (d.attackerIsPlayer) this._spawnDamageNumber(d);
    if (d.victimIsPlayer && !d.attackerIsPlayer) this._flashDamageDir(d);
  }

  // World point -> screen px, or null when behind the camera / far off-screen.
  _projectPoint(p) {
    const cam = this.game.r?.camera;
    if (!cam) return null;
    cam.updateMatrixWorld();
    const v = this._projV || (this._projV = new THREE.Vector3());
    v.set(p.x, p.y, p.z).applyMatrix4(cam.matrixWorldInverse);
    if (v.z > -0.05) return null; // camera space looks down -z
    v.applyMatrix4(cam.projectionMatrix);
    if (v.x < -1.15 || v.x > 1.15 || v.y < -1.15 || v.y > 1.15) return null;
    return { x: (v.x * 0.5 + 0.5) * window.innerWidth, y: (-v.y * 0.5 + 0.5) * window.innerHeight };
  }

  // Floating damage numbers: pooled DOM nodes, rapid hits (<300 ms) accumulate
  // into the newest number so sprays stay readable. Max 8 alive at once.
  _dmgAcquire() {
    let node = this._dmgPool.pop();
    if (!node) {
      node = document.createElement('div');
      node.className = 'dmg-num';
      this.el.dmgNums.appendChild(node);
    }
    return node;
  }

  _dmgRelease(entry) {
    clearTimeout(entry.timer);
    entry.node.className = 'dmg-num';
    const i = this._dmgLive.indexOf(entry);
    if (i >= 0) this._dmgLive.splice(i, 1);
    this._dmgPool.push(entry.node);
  }

  _resetDamageNumbers() {
    while (this._dmgLive.length) this._dmgRelease(this._dmgLive[this._dmgLive.length - 1]);
  }

  _spawnDamageNumber(d) {
    const pos = this._projectPoint(d.point);
    if (!pos) return;
    const now = performance.now();
    const last = this._dmgLive[this._dmgLive.length - 1];
    let entry;
    if (last && last.victim === d.victim && now - last.lastHit < 300) {
      entry = last;
      entry.amount += d.amount;
    } else {
      if (this._dmgLive.length >= 8) this._dmgRelease(this._dmgLive[0]);
      entry = { node: this._dmgAcquire(), victim: d.victim, amount: d.amount, head: false, kill: false, timer: 0, lastHit: 0 };
      this._dmgLive.push(entry);
    }
    entry.lastHit = now;
    entry.head = entry.head || d.part === 'head';
    entry.kill = entry.kill || !!d.kill;
    const n = entry.node;
    n.textContent = entry.amount;
    n.style.left = pos.x.toFixed(1) + 'px';
    n.style.top = pos.y.toFixed(1) + 'px';
    // rebuild the class list and restart the rise/fade even when accumulating
    n.className = 'dmg-num' + (entry.head ? ' head' : '') + (entry.kill ? ' kill' : '');
    void n.offsetWidth;
    n.classList.add('on');
    clearTimeout(entry.timer);
    entry.timer = setTimeout(() => this._dmgRelease(entry), 720);
  }

  // Directional damage indicator: rotate one of 3 fixed arc segments around
  // the screen center toward the attacker (relative to the player's facing).
  _flashDamageDir(d) {
    const p = this.game.player;
    if (!p) return;
    const dx = d.attackerPos.x - p.pos.x;
    const dz = d.attackerPos.z - p.pos.z;
    if (dx * dx + dz * dz < 1e-6) return;
    // player forward is (-sin yaw, -cos yaw), right is (cos yaw, -sin yaw)
    const fwd = -Math.sin(p.yaw) * dx - Math.cos(p.yaw) * dz;
    const right = Math.cos(p.yaw) * dx - Math.sin(p.yaw) * dz;
    const angle = Math.atan2(right, fwd) * 180 / Math.PI; // 0 = ahead, ±180 = behind
    const now = performance.now();
    let slot = this._dirArcs.find((a) => now >= a.until);
    if (!slot) slot = this._dirArcs.reduce((m, a) => (a.until < m.until ? a : m));
    slot.until = now + 500;
    const n = slot.node;
    n.style.transform = `rotate(${angle.toFixed(1)}deg)`;
    n.classList.remove('on');
    void n.offsetWidth;
    n.classList.add('on');
    clearTimeout(slot.timer);
    slot.timer = setTimeout(() => { n.classList.remove('on'); }, 520);
  }

  // ---------------------------------------------------------------- round MVP
  _queueMvp(mvp) {
    this._hideMvp();
    if (!mvp) return;
    // let the win/lose banner land first; round-end pause is 5 s, we occupy
    // roughly 1.2 s -> 3.8 s of it
    this._mvpShowT = setTimeout(() => this._showMvp(mvp), 1200);
  }

  _showMvp(mvp) {
    const el = this.el.mvpStrip;
    const agent = AGENT_BY_NAME[mvp.agent];
    const color = agent?.color || '#8298aa';
    const portrait = agent
      ? `<img class="mvp-portrait" src="${agentPortraitURL(agent, 44)}" alt="">`
      : `<i class="agent-dot" style="background:${color}"></i>`;
    const side = mvp.team === 'att' ? 'att' : (mvp.team === 'def' ? 'def' : '');
    el.style.setProperty('--mvp-accent', color);
    el.innerHTML = `${portrait}
      <div class="mvp-text">
        <b class="mvp-name ${side}">${mvp.name}</b>
        <span class="mvp-stats"><em class="mvp-badge">MVP</em> · ${mvp.kills} Kills · ${mvp.damage} Schaden</span>
      </div>`;
    el.classList.add('show');
    this._mvpHideT = setTimeout(() => this._hideMvp(), 2600);
  }

  _hideMvp() {
    clearTimeout(this._mvpShowT);
    clearTimeout(this._mvpHideT);
    this.el.mvpStrip.classList.remove('show');
  }

  // ---------------------------------------------------------------- killfeed
  addKill(d) {
    const agentColor = (name) => {
      const row = this.last?.scoreboard?.find((r) => r.name === name);
      return (row && AGENT_COLORS[row.agent]) || '#8298aa';
    };
    const div = document.createElement('div');
    const aCls = d.attackerTeam === 'att' ? 'k-att' : (d.attackerTeam === 'def' ? 'k-def' : 'k-ffa');
    const vCls = d.victimTeam === 'att' ? 'k-att' : (d.victimTeam === 'def' ? 'k-def' : 'k-ffa');
    const aCol = agentColor(d.attacker);
    const vCol = agentColor(d.victim);
    div.className = 'kill-entry' + (d.player ? ' me' : '');
    div.style.setProperty('--kf-accent', aCol);
    const icon = KILL_ICONS[d.method] || KILL_ICONS.gun;
    const headIcon = d.head ? `<span class="k-head">${KILL_ICONS.head}</span>` : '';
    const assist = d.assist
      ? `<span class="k-plus">+</span><span class="k-assist" style="color:${agentColor(d.assist)}">${d.assist}</span>`
      : '';
    div.innerHTML = `<i class="k-agent" style="background:${aCol}"></i><span class="${aCls}">${d.attacker}</span>${assist}<span class="k-weapon">${icon}</span>${headIcon}<span class="${vCls}">${d.victim}</span><i class="k-agent" style="background:${vCol}"></i>`;
    this.el.killfeed.prepend(div);
    while (this.el.killfeed.children.length > 6) this.el.killfeed.lastChild.remove();
    setTimeout(() => div.classList.add('out'), 4500);
    setTimeout(() => div.remove(), 5000);
  }

  toast(msg) {
    this.el.toast.textContent = msg;
    this.el.toast.classList.add('show');
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => this.el.toast.classList.remove('show'), 2200);
  }

  banner(text, kind) {
    const b = this.el.banner;
    b.innerHTML = `<div class="banner-text">${text}</div><div class="banner-rule"></div>`;
    b.className = 'center-banner ' + kind;
    // restart the CSS animation even if the class list did not change
    void b.offsetWidth;
    b.classList.add('show');
    clearTimeout(this._bannerT);
    this._bannerT = setTimeout(() => { b.className = 'center-banner'; }, 3000);
  }

  showInteract(d) {
    const bar = this.el.interactBar;
    bar.classList.add('show');
    const pct = Math.min(100, d.progress * 100);
    this.el.interactFill.style.width = pct + '%';
    this.el.interactLabel.textContent = (d.type === 'plant' ? 'SPIKE PFLANZEN' : 'ENTSCHÄRFEN') + ` · ${Math.floor(pct)}%`;
    bar.classList.toggle('defuse', d.type === 'defuse');
    clearTimeout(this._intT);
    this._intT = setTimeout(() => bar.classList.remove('show'), 200);
  }

  // ---------------------------------------------------------------- buy menu
  renderBuyMenu(open) {
    const menu = this.el.buyMenu;
    menu.classList.toggle('show', open);
    if (!open) return;
    const p = this.game.player;
    const freeMoney = !!this.game.settings?.infiniteMoney;
    const canAfford = (price) => freeMoney || p.credits >= price;

    // normalized stat bars from WEAPONS data
    const statBars = (w) => {
      if (w.cat === 'melee') return '';
      const dmg = Math.min(1, (w.damage * (w.pellets || 1)) / 160);
      const rate = Math.min(1, w.fireRate / 16);
      const mag = Math.min(1, w.mag / 50);
      const bar = (label, v) => `<div class="stat"><em>${label}</em><i><b style="width:${Math.round(v * 100)}%"></b></i></div>`;
      return `<div class="bi-stats">${bar('Schaden', dmg)}${bar('Rate', rate)}${bar('Magazin', mag)}</div>`;
    };
    // best value per category: damage output per credit (badge on one item)
    const bestValueId = (ids) => {
      let best = null; let bestV = -1;
      for (const id of ids) {
        const w = WEAPONS[id];
        if (!w.price) continue;
        const v = (w.damage * (w.pellets || 1) * w.fireRate) / w.price;
        if (v > bestV) { bestV = v; best = id; }
      }
      return best;
    };
    const ownedWeapon = (id) => p.inventory.primary === id || (p.inventory.sidearm === id && WEAPONS[id].cat === 'sidearm');
    const priceTag = (owned, ownedLabel, price) => {
      if (owned) return `<span class="bi-price owned-tag">${CHECK_ICON} ${ownedLabel}</span>`;
      if (!price) return `<span class="bi-price free">GRATIS</span>`;
      if (canAfford(price)) return `<span class="bi-price">¤${price}</span>`;
      return `<span class="bi-price locked">¤${price}<em class="bi-missing">fehlt ¤${price - p.credits}</em></span>`;
    };
    const weaponBtn = (id, best) => {
      const w = WEAPONS[id];
      const afford = canAfford(w.price);
      const owned = ownedWeapon(id);
      const cls = 'buy-item' + (afford ? '' : ' unaffordable') + (owned ? ' owned' : '');
      const badge = best === id && !owned ? '<span class="bi-badge">TOP-WERT</span>' : '';
      return `<button class="${cls}" data-w="${id}">
        ${badge}
        <span class="bi-top"><span class="bi-name">${w.name}</span>${priceTag(owned, 'IM BESITZ', w.price)}</span>
        ${statBars(w)}
      </button>`;
    };
    const cat = (title, ids) => {
      if (!ids.length) return '';
      const best = ids.length > 1 ? bestValueId(ids) : null;
      return `
      <div class="buy-cat"><h4>${title}</h4><div class="buy-items">
      ${ids.map((id) => weaponBtn(id, best)).join('')}
      </div></div>`;
    };

    const armorBtn = (id) => {
      const a = ARMOR[id];
      const afford = canAfford(a.price);
      const owned = (p.inventory.armor || 0) >= a.hp;
      const cls = 'buy-item armor-item' + (afford ? '' : ' unaffordable') + (owned ? ' owned' : '');
      return `<button class="${cls}" data-a="${id}">
        <span class="bi-top"><span class="bi-name">${a.name}</span>${priceTag(owned, 'AKTIV', a.price)}</span>
        <div class="bi-stats"><div class="stat"><em>Schild</em><i><b style="width:${a.hp * 2}%"></b></i></div><span class="stat-plus">+${a.hp}</span></div>
      </button>`;
    };

    menu.innerHTML = `
      <div class="buy-inner">
        <div class="buy-head">
          <h2>WAFFENSHOP</h2>
          <div class="buy-credits">¤ ${p.credits}${freeMoney ? ' <small>∞</small>' : ''}</div>
          <div class="buy-hint"><b>B</b> zum Schließen</div>
        </div>
        <div class="buy-grid">
          <div class="buy-cat"><h4>Schilde</h4><div class="buy-items">${armorBtn('light')}${armorBtn('heavy')}</div></div>
          ${cat('Pistolen', SHOP_ORDER.sidearm)}
          ${cat('Maschinenpistolen', SHOP_ORDER.smg)}
          ${cat('Sturmgewehre', SHOP_ORDER.rifle)}
          ${cat('Scharfschützen', SHOP_ORDER.sniper)}
          ${cat('Schrotflinten', SHOP_ORDER.shotgun)}
          ${cat('Schwere Waffen', SHOP_ORDER.heavy)}
          <div class="buy-cat"><h4>Fähigkeiten</h4><div class="buy-items" id="buyAbilities"></div></div>
        </div>
      </div>`;

    // abilities
    const abDiv = menu.querySelector('#buyAbilities');
    for (const key of ['C', 'Q', 'E']) {
      const ab = p.agent.abilities[key];
      if (!ab || !ab.cost) continue;
      const st = p.abilityState?.[key];
      const have = st?.charges ?? 0;
      const max = ab.charges ?? 1;
      const full = have >= max;
      const afford = canAfford(ab.cost);
      const icon = ABILITY_ICONS[ab.type] || '';
      const b = document.createElement('button');
      b.className = 'buy-item ability-item' + (afford && !full ? '' : ' unaffordable') + (full ? ' owned' : '');
      b.innerHTML = `<span class="bi-top"><span class="bi-name"><b class="bi-key">${key}</b><span class="bi-abicon" style="color:${p.agent.color}">${icon}</span> ${ab.name}</span>${full ? `<span class="bi-price owned-tag">${CHECK_ICON} VOLL</span>` : priceTag(false, '', ab.cost)}</span>
        <div class="bi-stats"><div class="stat"><em>Ladungen</em><i><b style="width:${(have / max) * 100}%"></b></i></div><span class="stat-plus">${have}/${max}</span></div>`;
      b.onclick = () => { this.game.buyAbility(p, key); this.renderBuyMenu(true); };
      abDiv.appendChild(b);
    }
    menu.querySelectorAll('.buy-item[data-w]').forEach((btn) => {
      btn.onclick = () => { this.game.buyWeapon(p, btn.dataset.w); this.renderBuyMenu(true); };
    });
    menu.querySelectorAll('.buy-item[data-a]').forEach((btn) => {
      btn.onclick = () => { this.game.buyArmor(p, btn.dataset.a); this.renderBuyMenu(true); };
    });
  }

  // ---------------------------------------------------------------- match end
  showMatchEnd(d) {
    this._hideMvp(); // final round also emits round:end + mvp; matchend takes over
    const el = this.el.matchend;
    el.classList.add('show');
    const title = d.playerWon ? 'SIEG' : 'NIEDERLAGE';
    const cls = d.playerWon ? 'win' : 'lose';
    const portrait = (agentName, size, ring) => {
      const agent = AGENT_BY_NAME[agentName];
      if (!agent) return `<i class="agent-dot" style="background:#8298aa"></i>`;
      return `<img class="me-portrait${ring ? ' ' + ring : ''}" src="${agentPortraitURL(agent, size)}" alt="" style="--agent-color:${agent.color};width:${size}px;height:${size}px">`;
    };
    let sub = '';
    let detail = '';
    if (d.ffa) {
      sub = `<span class="me-winner">${d.winner}</span> gewinnt`;
      if (Array.isArray(d.scoreboard)) {
        const top = d.scoreboard.slice(0, 3);
        // podium: 2nd | 1st | 3rd
        const order = [top[1], top[0], top[2]].filter(Boolean);
        const rankOf = (r) => top.indexOf(r) + 1;
        detail = `<div class="me-podium3">${order.map((r) => {
          const rank = rankOf(r);
          const rcls = ['gold', 'silver', 'bronze'][rank - 1];
          return `
          <div class="me-pod p${rank}${r.isPlayer ? ' me' : ''}">
            <div class="me-pod-portrait">${portrait(r.agent, rank === 1 ? 68 : 52, rcls)}</div>
            <b class="me-pod-name">${r.name}</b>
            <small>${r.agent || ''}</small>
            <em>${r.kills} Kills · ${r.deaths} Tode</em>
            <div class="me-pod-base ${rcls}">${rank}</div>
          </div>`;
        }).join('')}</div>`;
        const rest = d.scoreboard.slice(3, 8);
        if (rest.length) {
          detail += `<div class="me-rest">${rest.map((r, i) => `
            <div class="me-rest-row${r.isPlayer ? ' me' : ''}"><b>${i + 4}.</b>${portrait(r.agent, 20)}<span>${r.name}</span><em>${r.kills} / ${r.deaths}</em></div>`).join('')}</div>`;
        }
      }
    } else {
      sub = `<span class="me-att">${d.att}</span><span class="me-colon">:</span><span class="me-def">${d.def}</span>`;
      // per-team breakdown from the last HUD snapshot
      const sb = this.last?.scoreboard || [];
      const rtw = this.game.mode?.roundsToWin;
      if (rtw && rtw <= 15) {
        const pips = (score, tcls) => {
          let s = '';
          for (let i = 0; i < rtw; i++) s += `<i class="${i < score ? 'on' : ''}"></i>`;
          return `<span class="me-pips ${tcls}">${s}</span>`;
        };
        sub += `<div class="me-pip-row">${pips(d.att, 'att')}<span class="me-pip-sep"></span>${pips(d.def, 'def')}</div>`;
      }
      const teamPanel = (team, label, score) => {
        const list = sb.filter((r) => r.team === team);
        if (!list.length) return '';
        const maxK = Math.max(0, ...list.map((r) => r.kills));
        const winner = (team === 'att' ? d.att : d.def) >= (team === 'att' ? d.def : d.att);
        return `<div class="me-team ${team}${winner ? ' winner' : ''}">
          <h3>${label}<b>${score}</b></h3>
          ${list.map((r) => `
            <div class="me-team-row${r.isPlayer ? ' me' : ''}${maxK > 0 && r.kills === maxK ? ' topfrag' : ''}">
              ${portrait(r.agent, 24)}
              <span class="me-tr-name">${r.name}</span>
              <small>${r.agent || ''}</small>
              <em>${r.kills} / ${r.deaths}</em>
            </div>`).join('')}
        </div>`;
      };
      detail = `<div class="me-teams">${teamPanel('att', 'Angriff', d.att)}${teamPanel('def', 'Verteidigung', d.def)}</div>`;
    }
    // progression: award XP once per match, persisted immediately (before the
    // user can navigate away). Fully guarded — a progression failure must
    // never break the matchend screen.
    let xpAward = null;
    try {
      xpAward = this._awardMatchXp(d);
    } catch (err) {
      console.error('[HUD] XP award failed:', err);
    }
    el.innerHTML = `<div class="me-inner ${cls}">
      <div class="me-kicker">MATCHENDE</div>
      <h1>${title}</h1>
      <div class="me-score">${sub}</div>
      ${detail}
      ${xpAward ? this._xpPanelHTML(xpAward) : ''}
      <button id="meMenu" class="btn primary">Zurück zum Menü</button></div>`;
    el.querySelector('#meMenu').onclick = () => bus.emit('ui:mainmenu');
    if (xpAward) this._animateXpPanel(el, xpAward);
  }

  // ---------------------------------------------------------------- progression / XP
  // One award per 'match:end': the flag resets on 'match:start'. Player stats
  // come from the freshest scoreboard available — the FFA payload carries its
  // own snapshot; team modes use the last HUD snapshot (isPlayer row).
  _awardMatchXp(d) {
    if (this._xpAwarded) return this._xpAward; // re-render: reuse, never double-award
    this._xpAwarded = true;
    const sb = (d.ffa && Array.isArray(d.scoreboard)) ? d.scoreboard : (this.last?.scoreboard || []);
    const row = sb.find((r) => r.isPlayer) || {};
    const stats = {
      won: !!d.playerWon,
      kills: row.kills || 0,
      deaths: row.deaths || 0,
      assists: row.assists || 0,
      mvpCount: getMvpCount(),
    };
    const gain = computeMatchXP(stats);
    const before = loadProgress();
    const after = {
      totalXp: before.totalXp + gain.total,
      matches: before.matches + 1,
      wins: before.wins + (stats.won ? 1 : 0),
    };
    saveProgress(after); // persist right now, before any animation/navigation
    this._xpAward = { stats, gain, oldXp: before.totalXp, newXp: after.totalXp };
    return this._xpAward;
  }

  _xpPanelHTML({ stats, gain, oldXp, newXp }) {
    const oldInfo = levelFor(oldXp);
    const newInfo = levelFor(newXp);
    const rows = [
      ['Teilnahme', gain.participation, true],
      ['Sieg', gain.win, gain.win > 0],
      [`Kills ×${stats.kills}`, gain.kills, gain.kills > 0],
      [`Assists ×${stats.assists}`, gain.assists, gain.assists > 0],
      ['Runden-MVP', gain.mvp, gain.mvp > 0],
    ].filter(([, , show]) => show)
      .map(([label, xp]) => `<div class="me-xp-row"><span>${label}</span><b data-xp="${xp}">+0 XP</b></div>`)
      .join('');
    const totalRow = `<div class="me-xp-row total"><span>Gesamt</span><b data-xp="${gain.total}">+0 XP</b></div>`;
    const levelUp = newInfo.level > oldInfo.level
      ? `<div class="me-xp-levelup" id="xpLevelUp"><b>LEVEL ${newInfo.level}</b><em> — ${newInfo.rank.toUpperCase()}</em></div>`
      : '';
    return `<div class="me-xp" id="meXp">
      <div class="me-xp-head">
        <span class="me-xp-title">FORTSCHRITT</span>
        <span class="me-xp-rank" id="xpRank">Level ${oldInfo.level} · ${oldInfo.rank}</span>
      </div>
      <div class="me-xp-rows">${rows}${totalRow}</div>
      <div class="me-xp-bar" id="xpBar"><div class="me-xp-fill" id="xpFill" style="width:${(oldInfo.frac * 100).toFixed(2)}%"></div></div>
      <div class="me-xp-nums">
        <span id="xpLvNow">LV ${oldInfo.level}</span>
        <span id="xpInto">${oldInfo.into} / ${oldInfo.need} XP</span>
        <span id="xpLvNext">LV ${oldInfo.level + 1}</span>
      </div>
      ${levelUp}
    </div>`;
  }

  _cancelXpAnim() {
    if (!this._xpAnim) return;
    cancelAnimationFrame(this._xpAnim.raf);
    for (const t of this._xpAnim.timers) clearTimeout(t);
    this._xpAnim = null;
  }

  // Timeline: itemized rows fade in and count up (staggered), then the XP bar
  // sweeps old→new fill. Level crossings pulse the bar and pop the
  // "LEVEL n — RANG" flourish; multiple level-ups in one sweep all fire.
  _animateXpPanel(root, { oldXp, newXp }) {
    this._cancelXpAnim();
    const q = (id) => root.querySelector('#' + id);
    const els = { fill: q('xpFill'), bar: q('xpBar'), into: q('xpInto'), lvNow: q('xpLvNow'), lvNext: q('xpLvNext'), rank: q('xpRank'), levelUp: q('xpLevelUp') };
    const rowEls = [...root.querySelectorAll('.me-xp-row')];
    if (!els.fill) return;
    const ROW_DELAY = 350; const ROW_STAGGER = 170; const ROW_DUR = 450;
    const rows = rowEls.map((el, i) => ({ el, b: el.querySelector('b[data-xp]'), start: ROW_DELAY + i * ROW_STAGGER, done: false }));
    const barStart = ROW_DELAY + rows.length * ROW_STAGGER + 200;
    const barDur = Math.max(700, Math.min(1900, 700 + (newXp - oldXp) * 1.1));
    const easeOut = (f) => 1 - Math.pow(1 - f, 3);
    let shownLevel = levelFor(oldXp).level;
    const anim = { raf: 0, timers: [], t0: performance.now() };
    this._xpAnim = anim;
    const step = (now) => {
      const t = now - anim.t0;
      let busy = false;
      for (const r of rows) {
        if (r.done || !r.b) continue;
        const f = (t - r.start) / ROW_DUR;
        if (f < 0) { busy = true; continue; }
        r.el.classList.add('on');
        const ff = Math.min(1, f);
        r.b.textContent = '+' + Math.round((+r.b.dataset.xp || 0) * easeOut(ff)) + ' XP';
        if (ff >= 1) r.done = true; else busy = true;
      }
      const bf = (t - barStart) / barDur;
      if (bf < 1) busy = true;
      const cur = oldXp + (newXp - oldXp) * easeOut(Math.max(0, Math.min(1, bf)));
      const info = levelFor(cur);
      els.fill.style.width = (info.frac * 100).toFixed(2) + '%';
      els.into.textContent = `${Math.floor(info.into)} / ${info.need} XP`;
      els.lvNow.textContent = 'LV ' + info.level;
      els.lvNext.textContent = 'LV ' + (info.level + 1);
      els.rank.textContent = `Level ${info.level} · ${info.rank}`;
      if (info.level > shownLevel) {
        shownLevel = info.level;
        this._xpLevelUpFlourish(els, info);
      }
      if (busy && this._xpAnim === anim) anim.raf = requestAnimationFrame(step);
    };
    anim.raf = requestAnimationFrame(step);
  }

  _xpLevelUpFlourish(els, info) {
    if (els.bar) {
      els.bar.classList.remove('pulse');
      void els.bar.offsetWidth;
      els.bar.classList.add('pulse');
    }
    if (els.levelUp) {
      els.levelUp.innerHTML = `<b>LEVEL ${info.level}</b><em> — ${info.rank.toUpperCase()}</em>`;
      els.levelUp.classList.remove('on');
      void els.levelUp.offsetWidth;
      els.levelUp.classList.add('on');
    }
  }

  hide() { this.root.style.display = 'none'; }
  show() { this.root.style.display = 'block'; }
}
