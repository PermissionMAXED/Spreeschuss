import { Renderer } from './engine/renderer.js';
import { Input } from './engine/input.js';
import { Loop } from './engine/loop.js';
import { bus } from './engine/eventbus.js';
import { Game } from './game/game.js';
import { HUD } from './ui/hud.js';
import { Menu } from './ui/menu.js';
import { Viewmodel } from './game/viewmodel.js';
import { audio } from './audio/audio.js';

const app = document.getElementById('app');
const renderer = new Renderer(app);
const input = new Input(renderer.renderer.domElement);
const game = new Game(renderer, input);
const hud = new HUD(game);
const menu = new Menu(game);
const viewmodel = new Viewmodel(renderer, game);

hud.hide();

// --- Overlays: click-to-lock + pause ---
const overlay = document.createElement('div');
overlay.className = 'lock-overlay';
overlay.innerHTML = `<div class="lock-inner"><h2 id="lockTitle">KLICKEN ZUM SPIELEN</h2><p id="lockHint">Maus wird gefangen · ESC zum Pausieren</p><div class="pause-btns" id="pauseBtns"></div></div>`;
app.appendChild(overlay);
overlay.style.display = 'none';

function showLock(title, hint, paused) {
  overlay.querySelector('#lockTitle').textContent = title;
  overlay.querySelector('#lockHint').textContent = hint;
  const btns = overlay.querySelector('#pauseBtns');
  btns.innerHTML = '';
  if (paused) {
    const resume = document.createElement('button'); resume.className = 'btn primary'; resume.textContent = 'Weiter'; resume.onclick = (e) => { e.stopPropagation(); input.requestLock(); };
    const mm = document.createElement('button'); mm.className = 'btn'; mm.textContent = 'Hauptmenü'; mm.onclick = (e) => { e.stopPropagation(); toMenu(); };
    btns.appendChild(resume); btns.appendChild(mm);
  }
  overlay.style.display = 'flex';
}
function hideLock() { overlay.style.display = 'none'; }

overlay.addEventListener('click', () => {
  if (game.state === 'playing' || game.state === 'roundend') { audio.init(); audio.resume(); input.requestLock(); }
});

bus.on('game:started', () => {
  hud.show();
  showLock('KLICKEN ZUM SPIELEN', 'Maus wird gefangen · ESC zum Pausieren', false);
});

bus.on('pointerlock', (locked) => {
  if (locked) { hideLock(); }
  else if (game.state === 'playing' || game.state === 'roundend') {
    if (!game.buyOpen && !game.matchOver) showLock('PAUSE', 'Klicken oder „Weiter" um fortzufahren', true);
  }
});

function toMenu() {
  game.state = 'menu';
  game.matchOver = true;
  hideLock();
  hud.hide();
  menu.screen = 'main';
  menu.show();
  menu.render();
}
bus.on('ui:mainmenu', toMenu);
bus.on('match:end', () => { hideLock(); input.exitLock(); });

// scope (right mouse) for snipers
bus.on('key:down', () => {});
window.addEventListener('mousedown', (e) => {
  if (e.button === 2 && input.locked && game.player) {
    const w = game.player.weapon();
    if (w.scoped) { game.scopeActive = true; renderer.setFov(45); }
    else { renderer.setFov(90); game.scopeActive = false; }
  }
});
window.addEventListener('mouseup', (e) => {
  if (e.button === 2) { game.scopeActive = false; renderer.setFov(90); }
});

// muzzle flash light
let muzzleT = 0;
bus.on('muzzle', () => { muzzleT = 0.05; });

const loop = new Loop(
  (dt) => game.update(dt),
  (dt) => {
    game.renderExtras(dt);
    viewmodel.update(dt);
    // Exposure kick still works with postprocessing: OutputPass reads
    // toneMappingExposure every frame. Pair it with a brief bloom bump so the
    // flash also glows.
    if (muzzleT > 0) { muzzleT -= dt; renderer.renderer.toneMappingExposure = 1.45; renderer.setBloomBoost(0.25); }
    else { renderer.renderer.toneMappingExposure = 1.2; renderer.setBloomBoost(0); }
    renderer.render();
  },
  1 / 120,
);
loop.start();

// expose for debugging
window.__game = game;
window.__vm = viewmodel;
window.__renderer = renderer;
console.log('[Spreeschuss] bereit — Menü geladen.');
