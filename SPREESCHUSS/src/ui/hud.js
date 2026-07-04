import { bus } from '../engine/eventbus.js';
import { SHOP_ORDER, WEAPONS, ARMOR } from '../weapons/weapons.js';

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
  }

  _build() {
    this.root.innerHTML = `
      <div class="crosshair" id="crosshair"><span></span><span></span><span></span><span></span></div>
      <div class="hitmarker" id="hitmarker"></div>
      <div class="flash-overlay" id="flash"></div>
      <div class="dmg-vignette" id="dmgv"></div>

      <div class="topbar">
        <div class="score att" id="scoreAtt">0</div>
        <div class="timer" id="timer">
          <div class="round-timer" id="roundTimer">0:00</div>
          <div class="phase-label" id="phaseLabel"></div>
        </div>
        <div class="score def" id="scoreDef">0</div>
      </div>
      <div class="spike-status" id="spikeStatus"></div>

      <canvas class="minimap" id="minimap" width="220" height="220"></canvas>

      <div class="killfeed" id="killfeed"></div>
      <div class="center-banner" id="banner"></div>
      <div class="toast" id="toast"></div>

      <div class="bottom-left">
        <div class="health-row">
          <div class="hp" id="hp">100</div>
          <div class="armor" id="armor">0</div>
        </div>
        <div class="abilities" id="abilities"></div>
      </div>

      <div class="bottom-right">
        <div class="credits" id="credits">800</div>
        <div class="ammo"><span id="ammoMag">0</span><span class="ammo-sep">/</span><span id="ammoReserve">0</span></div>
        <div class="weapon-name" id="weaponName">Classic</div>
      </div>

      <div class="interact-bar" id="interactBar"><div class="interact-fill" id="interactFill"></div><div class="interact-label" id="interactLabel"></div></div>

      <div class="buy-menu" id="buyMenu"></div>
      <div class="scoreboard" id="scoreboard"></div>
      <div class="death-overlay" id="deathOverlay"></div>
      <div class="matchend" id="matchend"></div>
    `;
    this.el = {};
    for (const id of ['crosshair', 'hitmarker', 'flash', 'dmgv', 'scoreAtt', 'scoreDef', 'roundTimer', 'phaseLabel', 'spikeStatus', 'minimap', 'killfeed', 'banner', 'toast', 'hp', 'armor', 'abilities', 'credits', 'ammoMag', 'ammoReserve', 'weaponName', 'interactBar', 'interactFill', 'interactLabel', 'buyMenu', 'scoreboard', 'deathOverlay', 'matchend']) {
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
  }

  update(d) {
    this.last = d;
    this.el.hp.textContent = d.hp;
    this.el.armor.textContent = d.armor;
    this.el.armor.style.opacity = d.armor > 0 ? 1 : 0.35;
    this.el.credits.textContent = '¤ ' + d.credits;
    this.el.weaponName.textContent = d.weapon;
    this.el.ammoMag.textContent = d.mag > 0 ? d.ammo : '∞';
    this.el.ammoReserve.textContent = d.mag > 0 ? d.reserve : '';
    this.el.scoreAtt.textContent = d.attScore;
    this.el.scoreDef.textContent = d.defScore;

    const plant = d.mode && d.mode.kind === 'plant';
    if (plant) {
      const m = Math.floor(d.timeLeft / 60);
      const s = (d.timeLeft % 60).toString().padStart(2, '0');
      this.el.roundTimer.textContent = `${m}:${s}`;
      this.el.phaseLabel.textContent = { buy: 'KAUFPHASE (B)', live: '' }[d.phase] || '';
    } else {
      // deathmatch / tdm / gungame: show goal instead of a countdown
      this.el.roundTimer.textContent = d.mode && d.mode.kind === 'gungame' ? '⚔' : 'DM';
      this.el.phaseLabel.textContent = d.goalText || '';
    }

    // spike status
    if (d.spike && d.spike.planted && !d.spike.defused) {
      this.el.spikeStatus.textContent = `● SPIKE AKTIV (${d.spike.site})`;
      this.el.spikeStatus.className = 'spike-status active';
    } else if (d.spike && d.spike.carrier) {
      this.el.spikeStatus.textContent = '◆ Du trägst den Spike — halte F auf einem Spot';
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

    // death overlay
    this.el.deathOverlay.classList.toggle('show', !d.alive && this.game.state === 'playing');
  }

  _renderAbilities(ab, ultPoints, ultMax) {
    if (!ab) return;
    let html = '';
    for (const key of ['C', 'Q', 'E', 'X']) {
      const a = ab[key];
      if (!a) continue;
      const cls = a.ready ? 'ready' : 'notready';
      const val = a.ult ? `${a.charges}/${a.max}` : `${a.charges}`;
      html += `<div class="ability ${cls} ${a.ult ? 'ult' : ''}"><div class="ab-key">${key}</div><div class="ab-name">${a.name}</div><div class="ab-charges">${val}</div></div>`;
    }
    this.el.abilities.innerHTML = html;
  }

  _renderScoreboard(sb, d) {
    if (!sb) return;
    const rows = (team) => sb.filter((r) => team === 'all' || r.team === team).map((r) => `
      <tr class="${r.isPlayer ? 'me' : ''} ${r.alive ? '' : 'dead'}">
        <td class="c-agent">${r.agent || ''}</td><td class="c-name">${r.name}</td>
        <td>${r.kills}</td><td>${r.deaths}</td><td>¤${r.credits}</td>
      </tr>`).join('');
    const head = `<tr><th>Agent</th><th>Name</th><th>K</th><th>D</th><th>¤</th></tr>`;
    let body;
    if (d.mode && (d.mode.kind === 'ffa' || d.mode.kind === 'gungame')) {
      body = `<table>${head}${rows('all')}</table>`;
    } else {
      body = `<div class="sb-team att"><h3>Angriff · ${d.attScore}</h3><table>${head}${rows('att')}</table></div>
              <div class="sb-team def"><h3>Verteidigung · ${d.defScore}</h3><table>${head}${rows('def')}</table></div>`;
    }
    this.el.scoreboard.innerHTML = `<div class="sb-inner"><h2>${d.mode?.name || ''} — ${this.game.map?.name || ''}</h2>${body}</div>`;
  }

  _drawMinimap(mm, side) {
    if (!mm) return;
    const ctx = this.mmCtx;
    const S = 220;
    ctx.clearRect(0, 0, S, S);
    ctx.fillStyle = 'rgba(10,18,26,0.72)';
    ctx.fillRect(0, 0, S, S);
    const { minX, maxX, minZ, maxZ } = mm.bounds;
    const w = maxX - minX; const h = maxZ - minZ;
    const pad = 12;
    const toX = (x) => pad + ((x - minX) / w) * (S - 2 * pad);
    const toY = (z) => pad + ((z - minZ) / h) * (S - 2 * pad);
    // sites
    ctx.fillStyle = 'rgba(255,209,102,0.25)';
    ctx.strokeStyle = '#ffd166';
    for (const s of mm.sites) {
      const x = toX(s.x); const y = toY(s.z);
      ctx.beginPath(); ctx.arc(x, y, 14, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#ffd166'; ctx.font = 'bold 12px Arial'; ctx.textAlign = 'center';
      ctx.fillText(s.key, x, y + 4); ctx.fillStyle = 'rgba(255,209,102,0.25)';
    }
    // spike
    if (mm.spike) {
      ctx.fillStyle = '#ff3040';
      ctx.beginPath(); ctx.arc(toX(mm.spike.x), toY(mm.spike.z), 5, 0, Math.PI * 2); ctx.fill();
    }
    // entities
    for (const it of mm.items) {
      const x = toX(it.x); const y = toY(it.z);
      ctx.fillStyle = it.isPlayer ? '#ffffff' : (it.friendly ? '#43d17a' : '#ff4a4a');
      ctx.beginPath();
      ctx.moveTo(x + Math.sin(it.yaw) * 6, y + Math.cos(it.yaw) * 6);
      ctx.lineTo(x - Math.sin(it.yaw + 2.4) * 5, y - Math.cos(it.yaw + 2.4) * 5);
      ctx.lineTo(x - Math.sin(it.yaw - 2.4) * 5, y - Math.cos(it.yaw - 2.4) * 5);
      ctx.closePath();
      ctx.fill();
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
    div.innerHTML = `<span class="${aCls}">${d.attacker}</span> <span class="k-weapon">▸</span> <span class="${vCls}">${d.victim}</span>`;
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
    this.el.banner.textContent = text;
    this.el.banner.className = 'center-banner show ' + kind;
    clearTimeout(this._bannerT);
    this._bannerT = setTimeout(() => { this.el.banner.className = 'center-banner'; }, 3000);
  }

  showInteract(d) {
    const bar = this.el.interactBar;
    bar.classList.add('show');
    this.el.interactFill.style.width = Math.min(100, d.progress * 100) + '%';
    this.el.interactLabel.textContent = d.type === 'plant' ? 'PFLANZEN...' : 'ENTSCHÄRFEN...';
    clearTimeout(this._intT);
    this._intT = setTimeout(() => bar.classList.remove('show'), 200);
  }

  renderBuyMenu(open) {
    const menu = this.el.buyMenu;
    menu.classList.toggle('show', open);
    if (!open) return;
    const p = this.game.player;
    const cat = (title, ids) => `
      <div class="buy-cat"><h4>${title}</h4><div class="buy-items">
      ${ids.map((id) => { const w = WEAPONS[id]; return `<button class="buy-item" data-w="${id}"><span class="bi-name">${w.name}</span><span class="bi-price">¤${w.price}</span></button>`; }).join('')}
      </div></div>`;
    menu.innerHTML = `
      <div class="buy-inner">
        <div class="buy-head"><h2>WAFFENSHOP</h2><div class="buy-credits">¤ ${p.credits}</div><div class="buy-hint">B zum Schließen</div></div>
        <div class="buy-grid">
          ${cat('Schilde', [])}
          <div class="buy-cat"><h4>Schilde</h4><div class="buy-items">
            <button class="buy-item" data-a="light"><span class="bi-name">${ARMOR.light.name}</span><span class="bi-price">¤${ARMOR.light.price}</span></button>
            <button class="buy-item" data-a="heavy"><span class="bi-name">${ARMOR.heavy.name}</span><span class="bi-price">¤${ARMOR.heavy.price}</span></button>
          </div></div>
          ${cat('Pistolen', SHOP_ORDER.sidearm)}
          ${cat('SMGs', SHOP_ORDER.smg)}
          ${cat('Gewehre', SHOP_ORDER.rifle)}
          ${cat('Scharfschützen', SHOP_ORDER.sniper)}
          ${cat('Schrot', SHOP_ORDER.shotgun)}
          ${cat('Schwer', SHOP_ORDER.heavy)}
          <div class="buy-cat"><h4>Fähigkeiten</h4><div class="buy-items" id="buyAbilities"></div></div>
        </div>
      </div>`;
    // remove the empty first cat placeholder
    const first = menu.querySelector('.buy-cat');
    if (first && first.querySelector('.buy-items').children.length === 0) first.remove();

    // abilities
    const abDiv = menu.querySelector('#buyAbilities');
    for (const key of ['C', 'Q', 'E']) {
      const ab = p.agent.abilities[key];
      if (!ab || !ab.cost) continue;
      const b = document.createElement('button');
      b.className = 'buy-item';
      b.innerHTML = `<span class="bi-name">${key}: ${ab.name}</span><span class="bi-price">¤${ab.cost}</span>`;
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
    if (d.ffa) sub = `${d.winner} gewinnt`;
    else sub = `${d.att} : ${d.def}`;
    el.innerHTML = `<div class="me-inner ${cls}"><h1>${title}</h1><div class="me-score">${sub}</div>
      <button id="meMenu">Zurück zum Menü</button></div>`;
    el.querySelector('#meMenu').onclick = () => bus.emit('ui:mainmenu');
  }

  hide() { this.root.style.display = 'none'; }
  show() { this.root.style.display = 'block'; }
}
