import { bus } from '../engine/eventbus.js';
import { SHOP_ORDER, WEAPONS, ARMOR } from '../weapons/weapons.js';
import { AGENTS } from '../agents/agents.js';

// Small inline-SVG icons (no external assets).
const svg = (body, vb = '0 0 22 10', w = 22, h = 10) => `<svg viewBox="${vb}" width="${w}" height="${h}" aria-hidden="true">${body}</svg>`;
const KILL_ICONS = {
  gun: svg('<path d="M0 3h13.5L15.5 0H19v3h3v3.4h-8.2L12.6 10H9l1.2-3.6H0z" fill="currentColor"/>'),
  knife: svg('<path d="M1 13C6 10.4 10.6 7 14.6 1.4L17 3.8C13.6 8.6 9 11.8 4.4 13.6L3 15z" fill="currentColor"/>', '0 0 18 16', 16, 14),
  zone: svg('<path d="M7 0c1 3 4.2 4.2 4.2 8.2a4.2 4.2 0 1 1-8.4 0c0-2.1 1-3.3 2-4.4.1 1 .5 2 1.3 2.3C6 4.2 5.5 2.1 7 0z" fill="currentColor"/>', '0 0 14 14', 13, 13),
  turret: svg('<path d="M5.5 0h3v4.4H13v3H9.8V13H4.2V7.4H1v-3h4.5z" fill="currentColor"/>', '0 0 14 13', 13, 12),
  head: svg('<circle cx="7" cy="7" r="5.4" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="7" cy="7" r="2" fill="currentColor"/>', '0 0 14 14', 12, 12),
};
const CAT_LABELS = {
  melee: 'Nahkampf', sidearm: 'Pistole', smg: 'Maschinenpistole', rifle: 'Sturmgewehr',
  shotgun: 'Schrotflinte', sniper: 'Scharfschütze', heavy: 'Schwere Waffe',
};
const AGENT_COLORS = Object.fromEntries(AGENTS.map((a) => [a.name, a.color]));

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
  }

  _build() {
    this.root.innerHTML = `
      <div class="crosshair" id="crosshair"><span></span><span></span><span></span><span></span><i class="ch-dot"></i></div>
      <div class="hitmarker" id="hitmarker"></div>
      <div class="flash-overlay" id="flash"></div>
      <div class="dmg-vignette" id="dmgv"></div>
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
        <div class="weapon-line"><span class="weapon-name" id="weaponName">Classic</span><span class="weapon-cat" id="weaponCat"></span></div>
      </div>

      <div class="interact-bar" id="interactBar"><div class="interact-fill" id="interactFill"></div><div class="interact-label" id="interactLabel"></div></div>

      <div class="buy-menu" id="buyMenu"></div>
      <div class="scoreboard" id="scoreboard"></div>
      <div class="death-overlay" id="deathOverlay"><div class="death-inner"><h2>AUSGESCHALTET</h2><p>Beobachtungsmodus</p></div></div>
      <div class="matchend" id="matchend"></div>
    `;
    this.el = {};
    for (const id of ['crosshair', 'hitmarker', 'flash', 'dmgv', 'scope', 'scoreAtt', 'scoreDef', 'roundLabel', 'roundTimer', 'phaseLabel', 'spikeStatus', 'minimap', 'killfeed', 'banner', 'toast', 'hp', 'hpFill', 'armor', 'armorFill', 'armorRow', 'abilities', 'credits', 'ammoMag', 'ammoReserve', 'weaponName', 'weaponCat', 'interactBar', 'interactFill', 'interactLabel', 'buyMenu', 'scoreboard', 'deathOverlay', 'matchend']) {
      this.el[id] = this.root.querySelector('#' + id);
    }
    this.mmCtx = this.el.minimap.getContext('2d');
  }

  _bind() {
    bus.on('hud', (d) => this.update(d));
    bus.on('hitmarker', (d) => this.showHit(d));
    bus.on('flash', (d) => this.showFlash(d));
    bus.on('kill', (d) => this.addKill(d));
    bus.on('toast', (m) => this.toast(m));
    bus.on('interact', (d) => this.showInteract(d));
    bus.on('scoreboard', (v) => { this.scoreboardHeld = v; this.el.scoreboard.classList.toggle('show', v); });
    bus.on('round:end', (d) => this.banner(d.winner === this.game.playerSide ? 'RUNDE GEWONNEN' : 'RUNDE VERLOREN', d.winner === this.game.playerSide ? 'win' : 'lose'));
    bus.on('spike:planted', (d) => this.toast(`Spike auf ${d.site} gepflanzt!`));
    bus.on('halftime', () => this.banner('SEITENWECHSEL', 'neutral'));
    bus.on('buy:toggle', (open) => this.renderBuyMenu(open));
    bus.on('match:end', (d) => this.showMatchEnd(d));
    bus.on('match:start', () => { this.el.matchend.classList.remove('show'); this.el.deathOverlay.classList.remove('show'); this.scoreboardHeld = false; this.el.scoreboard.classList.remove('show'); });
    bus.on('muzzle', () => { this._spread = 1; }); // player shot fired → crosshair bloom
  }

  update(d) {
    this.last = d;
    // vitals: numbers + bars
    this.el.hp.textContent = d.hp;
    const hpPct = Math.max(0, Math.min(100, d.hp));
    this.el.hpFill.style.width = hpPct + '%';
    this.el.hpFill.className = 'vital-fill hp-fill' + (hpPct <= 25 ? ' crit' : (hpPct <= 55 ? ' low' : ''));
    this.el.armor.textContent = d.armor;
    this.el.armorFill.style.width = Math.max(0, Math.min(100, d.armor * 2)) + '%';
    this.el.armorRow.classList.toggle('empty', d.armor <= 0);

    this.el.credits.textContent = '¤ ' + d.credits;
    this.el.weaponName.textContent = d.weapon;
    this.el.weaponCat.textContent = CAT_LABELS[d.weaponCat] || '';
    this.el.ammoMag.textContent = d.mag > 0 ? d.ammo : '∞';
    this.el.ammoReserve.textContent = d.mag > 0 ? d.reserve : '';
    this.el.ammoMag.classList.toggle('low', d.mag > 0 && d.ammo <= Math.max(1, Math.floor(d.mag * 0.25)));
    this.el.scoreAtt.textContent = d.attScore;
    this.el.scoreDef.textContent = d.defScore;
    this.el.scoreAtt.classList.toggle('mine', d.side === 'att');
    this.el.scoreDef.classList.toggle('mine', d.side === 'def');

    const plant = d.mode && d.mode.kind === 'plant';
    if (plant) {
      const m = Math.floor(d.timeLeft / 60);
      const s = (d.timeLeft % 60).toString().padStart(2, '0');
      this.el.roundTimer.textContent = `${m}:${s}`;
      this.el.roundTimer.classList.toggle('urgent', d.timeLeft <= 10);
      this.el.phaseLabel.textContent = { buy: 'KAUFPHASE · [B] SHOP', live: '' }[d.phase] || '';
      this.el.roundLabel.textContent = `RUNDE ${d.round}`;
    } else {
      // deathmatch / tdm / gungame: show goal instead of a countdown
      this.el.roundTimer.textContent = d.mode && d.mode.kind === 'gungame' ? '⚔' : 'DM';
      this.el.roundTimer.classList.remove('urgent');
      this.el.phaseLabel.textContent = d.goalText || '';
      this.el.roundLabel.textContent = '';
    }

    // spike status
    if (d.spike && d.spike.planted && !d.spike.defused) {
      this.el.spikeStatus.innerHTML = `<i class="spike-dot"></i> SPIKE AKTIV · SPOT ${d.spike.site}`;
      this.el.spikeStatus.className = 'spike-status active';
    } else if (d.spike && d.spike.carrier) {
      this.el.spikeStatus.innerHTML = '◆ Du trägst den Spike — halte <b>F</b> auf einem Spot';
      this.el.spikeStatus.className = 'spike-status carry';
    } else {
      this.el.spikeStatus.textContent = '';
      this.el.spikeStatus.className = 'spike-status';
    }

    this._renderAbilities(d.abilities, d.ultPoints, d.ultMax);
    this._renderScoreboard(d.scoreboard, d);
    // Re-assert scoreboard visibility each HUD tick (~30/s). Hold-to-show is
    // driven by the one-shot 'scoreboard' events AND the live key state, so a
    // missed/blocked keydown self-heals while Tab is physically held, and a
    // lone keyup (or flaky events) can never leave the panel stuck open.
    const tabDown = !!this.game.input?.isDown('Tab');
    if (tabDown !== this.scoreboardHeld) this.scoreboardHeld = tabDown;
    this.el.scoreboard.classList.toggle('show', this.scoreboardHeld);
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

  _renderAbilities(ab, ultPoints, ultMax) {
    if (!ab) return;
    let html = '';
    for (const key of ['C', 'Q', 'E']) {
      const a = ab[key];
      if (!a) continue;
      const cls = a.ready ? 'ready' : 'notready';
      const max = Math.max(1, a.max);
      let pips = '';
      for (let i = 0; i < max; i++) pips += `<i class="${i < a.charges ? 'on' : ''}"></i>`;
      html += `<div class="ability ${cls}"><div class="ab-key">${key}</div><div class="ab-name">${a.name}</div><div class="ab-pips">${pips}</div></div>`;
    }
    const x = ab.X;
    if (x) {
      const cls = x.ready ? 'ready' : 'notready';
      const max = Math.max(1, ultMax || x.max);
      const pts = Math.min(max, ultPoints ?? x.charges);
      let pips = '';
      for (let i = 0; i < max; i++) pips += `<i class="${i < pts ? 'on' : ''}"></i>`;
      html += `<div class="ability ult ${cls}"><div class="ab-key">X</div><div class="ab-name">${x.name}</div><div class="ab-pips ult-pips">${pips}</div><div class="ab-charges">${pts}/${max}</div></div>`;
    }
    this.el.abilities.innerHTML = html;
  }

  _renderScoreboard(sb, d) {
    if (!sb) return;
    const rows = (team) => sb.filter((r) => team === 'all' || r.team === team).map((r) => `
      <tr class="${r.isPlayer ? 'me' : ''} ${r.alive ? '' : 'dead'}">
        <td class="c-agent"><i class="agent-dot" style="background:${AGENT_COLORS[r.agent] || '#8298aa'}"></i>${r.agent || ''}</td>
        <td class="c-name">${r.name}${r.alive ? '' : ' <small class="sb-dead-tag">✕</small>'}</td>
        <td class="c-num">${r.kills}</td><td class="c-num">${r.deaths}</td><td class="c-num c-cred">¤${r.credits}</td>
      </tr>`).join('');
    const head = `<tr><th>Agent</th><th>Name</th><th>K</th><th>D</th><th>¤</th></tr>`;
    let body;
    if (d.mode && (d.mode.kind === 'ffa' || d.mode.kind === 'gungame')) {
      body = `<table>${head}${rows('all')}</table>`;
    } else {
      body = `<div class="sb-team att"><h3>Angriff <b>${d.attScore}</b></h3><table>${head}${rows('att')}</table></div>
              <div class="sb-team def"><h3>Verteidigung <b>${d.defScore}</b></h3><table>${head}${rows('def')}</table></div>`;
    }
    const sub = d.mode?.kind === 'plant' ? ` · Runde ${d.round}` : '';
    this.el.scoreboard.innerHTML = `<div class="sb-inner"><h2>${d.mode?.name || ''} <span class="sb-map">— ${this.game.map?.name || ''}${sub}</span></h2>${body}<div class="sb-hint">Tab halten</div></div>`;
  }

  _drawMinimap(mm, side) {
    if (!mm) return;
    const ctx = this.mmCtx;
    const S = 220;
    ctx.clearRect(0, 0, S, S);
    ctx.fillStyle = 'rgba(7,13,20,0.78)';
    ctx.fillRect(0, 0, S, S);
    const { minX, maxX, minZ, maxZ } = mm.bounds;
    const w = maxX - minX; const h = maxZ - minZ;
    const pad = 12;
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
    ctx.strokeStyle = 'rgba(120,160,190,0.22)';
    ctx.strokeRect(pad, pad, S - 2 * pad, S - 2 * pad);
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

  addKill(d) {
    const div = document.createElement('div');
    const aCls = d.attackerTeam === 'att' ? 'k-att' : (d.attackerTeam === 'def' ? 'k-def' : 'k-ffa');
    const vCls = d.victimTeam === 'att' ? 'k-att' : (d.victimTeam === 'def' ? 'k-def' : 'k-ffa');
    div.className = 'kill-entry' + (d.player ? ' me' : '');
    const icon = KILL_ICONS[d.method] || KILL_ICONS.gun;
    const headIcon = d.head ? `<span class="k-head">${KILL_ICONS.head}</span>` : '';
    div.innerHTML = `<span class="${aCls}">${d.attacker}</span><span class="k-weapon">${icon}</span>${headIcon}<span class="${vCls}">${d.victim}</span>`;
    this.el.killfeed.prepend(div);
    while (this.el.killfeed.children.length > 6) this.el.killfeed.lastChild.remove();
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
    const ownedWeapon = (id) => p.inventory.primary === id || (p.inventory.sidearm === id && WEAPONS[id].cat === 'sidearm');
    const weaponBtn = (id) => {
      const w = WEAPONS[id];
      const afford = canAfford(w.price);
      const owned = ownedWeapon(id);
      const cls = 'buy-item' + (afford ? '' : ' unaffordable') + (owned ? ' owned' : '');
      return `<button class="${cls}" data-w="${id}">
        <span class="bi-top"><span class="bi-name">${w.name}</span><span class="bi-price">${owned ? 'IM BESITZ' : '¤' + w.price}</span></span>
        ${statBars(w)}
      </button>`;
    };
    const cat = (title, ids) => ids.length ? `
      <div class="buy-cat"><h4>${title}</h4><div class="buy-items">
      ${ids.map(weaponBtn).join('')}
      </div></div>` : '';

    const armorBtn = (id) => {
      const a = ARMOR[id];
      const afford = canAfford(a.price);
      const owned = (p.inventory.armor || 0) >= a.hp;
      const cls = 'buy-item armor-item' + (afford ? '' : ' unaffordable') + (owned ? ' owned' : '');
      return `<button class="${cls}" data-a="${id}">
        <span class="bi-top"><span class="bi-name">${a.name}</span><span class="bi-price">${owned ? 'AKTIV' : '¤' + a.price}</span></span>
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
      const b = document.createElement('button');
      b.className = 'buy-item ability-item' + (afford && !full ? '' : ' unaffordable') + (full ? ' owned' : '');
      b.innerHTML = `<span class="bi-top"><span class="bi-name"><b class="bi-key">${key}</b> ${ab.name}</span><span class="bi-price">${full ? 'VOLL' : '¤' + ab.cost}</span></span>
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

  showMatchEnd(d) {
    const el = this.el.matchend;
    el.classList.add('show');
    const title = d.playerWon ? 'SIEG' : 'NIEDERLAGE';
    const cls = d.playerWon ? 'win' : 'lose';
    let sub = '';
    let podium = '';
    if (d.ffa) {
      sub = `${d.winner} gewinnt`;
      if (Array.isArray(d.scoreboard)) {
        const top = d.scoreboard.slice(0, 3);
        podium = `<div class="me-podium">${top.map((r, i) => `
          <div class="me-podium-row${r.isPlayer ? ' me' : ''}">
            <b class="me-rank">${i + 1}.</b>
            <i class="agent-dot" style="background:${AGENT_COLORS[r.agent] || '#8298aa'}"></i>
            <span>${r.name}</span><em>${r.kills} Kills</em>
          </div>`).join('')}</div>`;
      }
    } else {
      sub = `<span class="me-att">${d.att}</span><span class="me-colon">:</span><span class="me-def">${d.def}</span>`;
    }
    el.innerHTML = `<div class="me-inner ${cls}">
      <div class="me-kicker">MATCHENDE</div>
      <h1>${title}</h1>
      <div class="me-score">${sub}</div>
      ${podium}
      <button id="meMenu" class="btn primary">Zurück zum Menü</button></div>`;
    el.querySelector('#meMenu').onclick = () => bus.emit('ui:mainmenu');
  }

  hide() { this.root.style.display = 'none'; }
  show() { this.root.style.display = 'block'; }
}
