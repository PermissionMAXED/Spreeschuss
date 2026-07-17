import type {
  MinigameContext,
  MinigameModule,
  MinigamePayout,
} from "../../core/contracts/minigame";
import type { MinigameStubDefinition } from "../stub";
import {
  INITIAL_SORT_STATE,
  activateReverseFrenzy,
  applySort,
  type SortDirection,
  type SortItem,
  type SortState,
} from "./logic";

export const definition = {
  id: "veggie-sort",
  title: "Veggie Sort",
  instructions: "Swipe vegetables left, fruit right, and non-food up before three mistakes.",
  create: (): MinigameModule => new VeggieSortGame(),
} as const satisfies MinigameStubDefinition & { readonly create: () => MinigameModule };

type Phase = "unmounted" | "tutorial" | "running" | "paused" | "ended" | "disposed";

const HIGH_SCORE_KEY = "gooby:minigame:veggie-sort:best";
const ITEMS: readonly SortItem[] = [
  { id: "carrot", label: "Carrot", emoji: "🥕", category: "vegetable" },
  { id: "broccoli", label: "Broccoli", emoji: "🥦", category: "vegetable" },
  { id: "pepper", label: "Pepper", emoji: "🫑", category: "vegetable" },
  { id: "corn", label: "Corn", emoji: "🌽", category: "vegetable" },
  { id: "eggplant", label: "Eggplant", emoji: "🍆", category: "vegetable" },
  { id: "tomato", label: "Tomato", emoji: "🍅", category: "vegetable" },
  { id: "apple", label: "Apple", emoji: "🍎", category: "fruit" },
  { id: "banana", label: "Banana", emoji: "🍌", category: "fruit" },
  { id: "grapes", label: "Grapes", emoji: "🍇", category: "fruit" },
  { id: "orange", label: "Orange", emoji: "🍊", category: "fruit" },
  { id: "watermelon", label: "Watermelon", emoji: "🍉", category: "fruit" },
  { id: "pear", label: "Pear", emoji: "🍐", category: "fruit" },
  { id: "sock", label: "Sock", emoji: "🧦", category: "nonfood" },
  { id: "ball", label: "Ball", emoji: "⚽", category: "nonfood" },
  { id: "key", label: "Key", emoji: "🔑", category: "nonfood" },
  { id: "soap", label: "Soap", emoji: "🧼", category: "nonfood" },
  { id: "book", label: "Book", emoji: "📕", category: "nonfood" },
  { id: "boot", label: "Boot", emoji: "🥾", category: "nonfood" },
] as const;

class SortAudio {
  private context: AudioContext | null = null;

  play(kind: "correct" | "wrong" | "frenzy" | "finish" | "tick"): void {
    try {
      this.context ??= new AudioContext();
      const context = this.context;
      if (context.state === "suspended") void context.resume();
      const notes = {
        correct: [620, 830],
        wrong: [190, 130],
        frenzy: [440, 554, 659, 880],
        finish: [523, 659, 784],
        tick: [330],
      }[kind];
      notes.forEach((frequency, index) => {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        const at = context.currentTime + index * 0.055;
        oscillator.type = kind === "wrong" ? "square" : "triangle";
        oscillator.frequency.setValueAtTime(frequency, at);
        gain.gain.setValueAtTime(0.0001, at);
        gain.gain.exponentialRampToValueAtTime(0.065, at + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.12);
        oscillator.connect(gain).connect(context.destination);
        oscillator.start(at);
        oscillator.stop(at + 0.13);
      });
    } catch (error: unknown) {
      void error;
    }
  }

  dispose(): void {
    if (this.context) void this.context.close();
    this.context = null;
  }
}

function readBest(): number {
  try {
    return Number.parseInt(localStorage.getItem(HIGH_SCORE_KEY) ?? "0", 10) || 0;
  } catch (error: unknown) {
    void error;
    return 0;
  }
}

function writeBest(value: number): void {
  try {
    localStorage.setItem(HIGH_SCORE_KEY, String(value));
  } catch (error: unknown) {
    void error;
  }
}

function vibrate(pattern: readonly number[]): void {
  if (typeof navigator.vibrate === "function") navigator.vibrate(pattern);
}

export class VeggieSortGame implements MinigameModule {
  readonly id = definition.id;
  readonly title = definition.title;
  readonly instructions = definition.instructions;

  private context: MinigameContext | null = null;
  private root: HTMLElement | null = null;
  private abortController: AbortController | null = null;
  private readonly audio = new SortAudio();
  private readonly scheduled = new Set<number>();
  private phase: Phase = "unmounted";
  private state: SortState = { ...INITIAL_SORT_STATE };
  private currentItem: SortItem | null = null;
  private previousItemId = "";
  private itemRemaining = 4.6;
  private itemDuration = 4.6;
  private inputLocked = 0;
  private best = 0;
  private finished = false;
  private pointerStart: { x: number; y: number; at: number } | null = null;

  mount(context: MinigameContext): void {
    if (this.phase !== "unmounted" && this.phase !== "disposed") this.dispose();
    this.context = context;
    this.best = readBest();
    this.abortController = new AbortController();
    const root = document.createElement("section");
    root.className = "veggie-sort";
    root.dataset.minigame = this.id;
    root.innerHTML = this.markup();
    root.addEventListener("click", this.onClick, { signal: this.abortController.signal });
    root.addEventListener("pointerdown", this.onPointerDown, { signal: this.abortController.signal });
    root.addEventListener("pointerup", this.onPointerUp, { signal: this.abortController.signal });
    root.addEventListener("pointercancel", this.onPointerCancel, { signal: this.abortController.signal });
    context.mount.replaceChildren(root);
    this.root = root;
    this.phase = "tutorial";
    this.render();
  }

  start(): void {
    if (this.phase === "unmounted" || this.phase === "disposed") return;
    this.phase = "tutorial";
    this.showPanel("tutorial");
  }

  pause(): void {
    if (this.phase !== "running") return;
    this.phase = "paused";
    this.showPanel("pause");
  }

  resume(): void {
    if (this.phase !== "paused") return;
    this.phase = "running";
    this.showPanel(null);
    this.audio.play("tick");
  }

  update(deltaSeconds: number): void {
    if (this.phase !== "running" || !this.root || !this.context) return;
    const delta = Math.min(0.1, Math.max(0, Number.isFinite(deltaSeconds) ? deltaSeconds : 0));
    this.root.dataset.clock = String(this.context.clock.now());
    if (this.inputLocked > 0) {
      this.inputLocked = Math.max(0, this.inputLocked - delta);
      return;
    }
    this.itemRemaining = Math.max(0, this.itemRemaining - delta);
    this.renderTimer();
    if (this.itemRemaining <= 0 && this.currentItem) this.sortCurrent(null, true);
  }

  payout(): MinigamePayout {
    const score = Math.floor(this.state.score);
    return {
      score,
      coins: Math.max(1, Math.floor(score / 350)),
      xp: Math.max(2, Math.floor(score / 140) + this.state.totalCorrect),
    };
  }

  dispose(): void {
    this.abortController?.abort();
    this.abortController = null;
    for (const timeout of this.scheduled) window.clearTimeout(timeout);
    this.scheduled.clear();
    this.audio.dispose();
    this.root?.remove();
    this.root = null;
    this.context = null;
    this.currentItem = null;
    this.pointerStart = null;
    this.phase = "disposed";
  }

  private beginRound(): void {
    if (!this.context || !this.root) return;
    this.state = { ...INITIAL_SORT_STATE };
    this.currentItem = null;
    this.previousItemId = "";
    this.itemRemaining = 4.6;
    this.inputLocked = 0;
    this.finished = false;
    this.phase = "running";
    this.root.dataset.startedAt = String(this.context.clock.now());
    this.showPanel(null);
    this.spawnItem();
    this.audio.play("frenzy");
    vibrate([18, 25, 18]);
  }

  private spawnItem(): void {
    if (!this.context || !this.root || this.phase !== "running") return;
    let selected = this.context.rng.pick(ITEMS);
    for (let attempt = 0; attempt < 3 && selected.id === this.previousItemId; attempt += 1) {
      selected = this.context.rng.pick(ITEMS);
    }
    this.currentItem = selected;
    this.previousItemId = selected.id;
    this.itemDuration = Math.max(2.05, 4.6 - this.state.totalCorrect * 0.065);
    this.itemRemaining = this.itemDuration;
    const card = this.root.querySelector<HTMLElement>("[data-card]");
    if (card) {
      card.className = "sort-card entering";
      card.dataset.item = selected.id;
      const emoji = card.querySelector<HTMLElement>("[data-item-emoji]");
      const label = card.querySelector<HTMLElement>("[data-item-label]");
      if (emoji) emoji.textContent = selected.emoji;
      if (label) label.textContent = selected.label;
      this.schedule(() => card.classList.remove("entering"), 230);
    }
    this.render();
  }

  private sortCurrent(direction: SortDirection | null, expired = false): void {
    if (
      this.phase !== "running"
      || !this.currentItem
      || this.inputLocked > 0
      || !this.root
    ) return;

    const item = this.currentItem;
    const wasReverse = this.state.reverseFrenzy;
    const result = applySort(this.state, item, direction);
    this.state = result;
    this.currentItem = null;
    const card = this.root.querySelector<HTMLElement>("[data-card]");

    if (result.correct) {
      const exitDirection = direction ?? "up";
      card?.classList.add(`exit-${exitDirection}`, "correct");
      this.flash(`+${100 * result.multiplier}  ×${result.multiplier}`, "good");
      this.particles(item.emoji, 10);
      this.audio.play("correct");
      vibrate([16, 20, 16]);
    } else {
      card?.classList.add("wrong");
      this.flash(expired ? "TOO SLOW!" : `OOPS — ${result.expected.toUpperCase()}!`, "bad");
      this.audio.play("wrong");
      vibrate([80, 35, 80]);
    }
    this.render();

    if (result.ended) {
      this.schedule(() => this.finishGame(), 500);
      return;
    }

    let announcement: "reverse" | "normal" | null = null;
    if (!result.reverseFrenzy && result.correct && result.totalCorrect > 0 && result.totalCorrect % 10 === 0) {
      this.state = activateReverseFrenzy(this.state);
      announcement = "reverse";
    } else if (wasReverse && !result.reverseFrenzy) {
      announcement = "normal";
    }

    this.schedule(() => {
      if (this.phase !== "running") return;
      if (announcement) this.announceRules(announcement);
      this.spawnItem();
    }, 330);
  }

  private announceRules(mode: "reverse" | "normal"): void {
    if (!this.root) return;
    const banner = this.root.querySelector<HTMLElement>("[data-frenzy]");
    if (!banner) return;
    banner.classList.toggle("normal", mode === "normal");
    const heading = banner.querySelector("strong");
    const copy = banner.querySelector("span");
    if (heading) heading.textContent = mode === "reverse" ? "REVERSE-RULES FRENZY!" : "NORMAL RULES!";
    if (copy) {
      copy.textContent = mode === "reverse"
        ? "FRUIT ←   ·   VEGGIES →   ·   NON-FOOD ↑"
        : "VEGGIES ←   ·   FRUIT →   ·   NON-FOOD ↑";
    }
    banner.classList.add("active");
    this.inputLocked = mode === "reverse" ? 1.45 : 0.95;
    this.audio.play("frenzy");
    vibrate([25, 20, 25, 20, 60]);
    this.schedule(() => banner.classList.remove("active"), this.inputLocked * 1_000);
  }

  private readonly onClick = (event: MouseEvent): void => {
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-action],[data-direction]") : null;
    if (!target) return;
    const action = target.dataset.action;
    if (action === "begin" || action === "again") {
      this.beginRound();
      return;
    }
    if (action === "pause") {
      this.pause();
      return;
    }
    if (action === "resume") {
      this.resume();
      return;
    }
    if (action === "quit") {
      this.finishGame(true);
      return;
    }
    const direction = target.dataset.direction;
    if (direction === "left" || direction === "right" || direction === "up") {
      this.sortCurrent(direction);
    }
  };

  private readonly onPointerDown = (event: PointerEvent): void => {
    const card = event.target instanceof Element ? event.target.closest("[data-card]") : null;
    if (!card || !this.context || this.phase !== "running") return;
    this.pointerStart = { x: event.clientX, y: event.clientY, at: this.context.clock.now() };
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (!this.pointerStart || !this.context || this.phase !== "running") return;
    const start = this.pointerStart;
    this.pointerStart = null;
    if (this.context.clock.now() - start.at > 1_500) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.hypot(dx, dy) < 34) return;
    if (Math.abs(dx) > Math.abs(dy)) {
      this.sortCurrent(dx < 0 ? "left" : "right");
    } else if (dy < 0) {
      this.sortCurrent("up");
    }
  };

  private readonly onPointerCancel = (): void => {
    this.pointerStart = null;
  };

  private finishGame(quit = false): void {
    if (this.finished || !this.context || !this.root) return;
    this.finished = true;
    this.phase = "ended";
    const payout = this.payout();
    if (payout.score > this.best) {
      this.best = payout.score;
      writeBest(this.best);
    }
    const panel = this.root.querySelector<HTMLElement>('[data-panel="result"]');
    const title = panel?.querySelector("h2");
    const score = panel?.querySelector<HTMLElement>("[data-result-score]");
    const reward = panel?.querySelector<HTMLElement>("[data-result-reward]");
    const best = panel?.querySelector<HTMLElement>("[data-result-best]");
    if (title) title.textContent = quit ? "Sorting wrapped!" : "Crates packed!";
    if (score) score.textContent = payout.score.toLocaleString();
    if (reward) reward.textContent = `+${payout.coins} coins  ·  +${payout.xp} XP`;
    if (best) best.textContent = `Best ${this.best.toLocaleString()} · ${this.state.totalCorrect} perfect sorts`;
    this.showPanel("result");
    this.audio.play("finish");
    vibrate([30, 25, 80]);
    this.context.finish(payout);
  }

  private render(): void {
    if (!this.root) return;
    const score = this.root.querySelector<HTMLElement>("[data-score]");
    const streak = this.root.querySelector<HTMLElement>("[data-streak]");
    const mistakes = this.root.querySelector<HTMLElement>("[data-mistakes]");
    const rules = this.root.querySelector<HTMLElement>("[data-rules]");
    const frenzyCount = this.root.querySelector<HTMLElement>("[data-frenzy-count]");
    if (score) score.textContent = Math.floor(this.state.score).toLocaleString();
    if (streak) {
      streak.textContent = this.state.streak > 1 ? `${this.state.streak} STREAK · ×${this.state.multiplier}` : "BUILD A STREAK";
      streak.classList.toggle("hot", this.state.multiplier >= 3);
    }
    if (mistakes) {
      mistakes.innerHTML = [0, 1, 2].map((index) => `<i class="${index < this.state.mistakes ? "lost" : ""}">♥</i>`).join("");
    }
    if (rules) {
      rules.innerHTML = this.state.reverseFrenzy
        ? "<b>FRENZY</b> Fruit ← · Veg → · Junk ↑"
        : "<b>NORMAL</b> Veg ← · Fruit → · Junk ↑";
      rules.classList.toggle("reverse", this.state.reverseFrenzy);
    }
    if (frenzyCount) frenzyCount.textContent = this.state.reverseFrenzy ? `${this.state.frenzyRemaining} left` : "";
    this.renderTimer();
  }

  private renderTimer(): void {
    if (!this.root) return;
    const timer = this.root.querySelector<HTMLElement>("[data-item-timer]");
    if (timer) {
      timer.style.transform = `scaleX(${Math.max(0, this.itemRemaining / this.itemDuration)})`;
      timer.classList.toggle("urgent", this.itemRemaining < 1);
    }
  }

  private showPanel(name: "tutorial" | "pause" | "result" | null): void {
    if (!this.root) return;
    for (const panel of this.root.querySelectorAll<HTMLElement>("[data-panel]")) {
      panel.hidden = panel.dataset.panel !== name;
    }
  }

  private flash(text: string, kind: "good" | "bad"): void {
    if (!this.root) return;
    const flash = this.root.querySelector<HTMLElement>("[data-flash]");
    if (!flash) return;
    flash.textContent = text;
    flash.className = `sort-flash ${kind} active`;
    this.schedule(() => flash.classList.remove("active"), 650);
  }

  private particles(symbol: string, count: number): void {
    if (!this.root) return;
    const layer = this.root.querySelector<HTMLElement>("[data-particles]");
    if (!layer) return;
    for (let index = 0; index < count; index += 1) {
      const particle = document.createElement("i");
      const angle = (Math.PI * 2 * index) / count;
      particle.textContent = index % 3 === 0 ? symbol : "✦";
      particle.style.setProperty("--x", `${Math.cos(angle) * (70 + index * 3)}px`);
      particle.style.setProperty("--y", `${Math.sin(angle) * (70 + index * 3)}px`);
      layer.append(particle);
      this.schedule(() => particle.remove(), 750);
    }
  }

  private schedule(callback: () => void, delayMs: number): void {
    const timeout = window.setTimeout(() => {
      this.scheduled.delete(timeout);
      callback();
    }, delayMs);
    this.scheduled.add(timeout);
  }

  private markup(): string {
    return `
      <style>${veggieStyles}</style>
      <div class="market-bg" aria-hidden="true"><i></i><i></i><i></i></div>
      <header class="sort-hud">
        <div><small>SCORE</small><strong data-score>0</strong></div>
        <div class="streak-pill" data-streak>BUILD A STREAK</div>
        <div class="mistakes" data-mistakes aria-label="Mistakes">♥♥♥</div>
        <button class="pause-button" data-action="pause" aria-label="Pause">Ⅱ</button>
      </header>
      <div class="rules-ribbon" data-rules><b>NORMAL</b> Veg ← · Fruit → · Junk ↑</div>
      <span class="frenzy-count" data-frenzy-count></span>
      <main class="sort-stage">
        <div class="gooby-clerk" aria-hidden="true"><i></i><i></i><div><b>•</b><b>•</b><em>ᴗ</em></div><small>GOOBY<br>MARKET</small></div>
        <button class="bin nonfood-bin" data-direction="up" aria-label="Sort non-food up"><span>📦</span><b>NOT FOOD</b><small>SWIPE UP ↑</small></button>
        <button class="bin veggie-bin" data-direction="left" aria-label="Sort vegetables left"><span>🥕</span><b>VEGGIES</b><small>← SWIPE LEFT</small></button>
        <button class="bin fruit-bin" data-direction="right" aria-label="Sort fruit right"><span>🍎</span><b>FRUIT</b><small>SWIPE RIGHT →</small></button>
        <div class="conveyor"><i></i><i></i><i></i><i></i><i></i></div>
        <article class="sort-card" data-card aria-live="polite">
          <div class="timer-track"><i data-item-timer></i></div>
          <span data-item-emoji>🥕</span><strong data-item-label>Carrot</strong><small>SWIPE ME!</small>
        </article>
      </main>
      <div class="sort-flash" data-flash role="status"></div>
      <div class="sort-particles" data-particles aria-hidden="true"></div>
      <div class="frenzy-banner" data-frenzy role="alert"><small>⚡ GOOBY SHUFFLE ⚡</small><strong>REVERSE-RULES FRENZY!</strong><span>FRUIT ← · VEGGIES → · NON-FOOD ↑</span></div>
      <section class="sort-panel" data-panel="tutorial">
        <div class="panel-card">
          <span class="eyebrow">GOOBY MARKET SHIFT</span><h1>Veggie<br><em>Sort!</em></h1>
          <p>Swipe each item into the right crate. Three mistakes end your shift!</p>
          <div class="tutorial-rules">
            <div><span>🥦</span><b>VEGGIES</b><small>← LEFT</small></div>
            <div><span>🍓</span><b>FRUIT</b><small>RIGHT →</small></div>
            <div><span>🧦</span><b>NOT FOOD</b><small>↑ UP</small></div>
          </div>
          <div class="frenzy-tip"><b>⚡ REVERSE FRENZY</b><span>When announced, fruit and veggie sides swap!</span></div>
          <button class="primary" data-action="begin">CLOCK IN</button>
        </div>
      </section>
      <section class="sort-panel" data-panel="pause" hidden>
        <div class="panel-card compact"><span class="eyebrow">SNACK BREAK</span><h2>Paused</h2><p>The conveyor is holding.</p><button class="primary" data-action="resume">KEEP SORTING</button><button class="secondary" data-action="quit">END SHIFT</button></div>
      </section>
      <section class="sort-panel" data-panel="result" hidden>
        <div class="panel-card compact result">
          <span class="crate-medal">✓</span><h2>Crates packed!</h2>
          <strong class="big-score" data-result-score>0</strong><small>FINAL SCORE</small>
          <p data-result-reward>+0 coins · +0 XP</p><div class="best-line" data-result-best>Best 0</div>
          <button class="primary" data-action="again">WORK ANOTHER SHIFT</button>
        </div>
      </section>
    `;
  }
}

export const createVeggieSort = (): MinigameModule => new VeggieSortGame();

const veggieStyles = `
  .veggie-sort{position:relative;isolation:isolate;width:100%;height:100%;min-height:620px;overflow:hidden;color:#3c392f;background:#f6df9b;font-family:Nunito,ui-rounded,"Arial Rounded MT Bold",system-ui,sans-serif;touch-action:none;user-select:none}.veggie-sort *{box-sizing:border-box}.veggie-sort button{font:inherit}
  .market-bg{position:absolute;inset:0;background:linear-gradient(#fff2c9 0 52%,#ddaa64 52%);overflow:hidden}.market-bg:before{content:"";position:absolute;inset:0 0 48%;background:linear-gradient(#d78c5d33 3px,transparent 3px),linear-gradient(90deg,#d78c5d33 3px,transparent 3px);background-size:68px 55px}.market-bg>i{position:absolute;bottom:44%;width:80px;height:90px;border-radius:12px 12px 0 0;background:#88b46b;box-shadow:inset 0 10px #b8da85}.market-bg>i:nth-child(1){left:3%}.market-bg>i:nth-child(2){right:2%;background:#e08569}.market-bg>i:nth-child(3){left:28%;bottom:49%;width:44%;height:18px;border-radius:20px;background:#fff2b1}
  .sort-hud{position:absolute;z-index:15;top:max(12px,env(safe-area-inset-top));left:12px;right:12px;display:grid;grid-template-columns:78px 1fr 75px 42px;gap:7px;align-items:center}.sort-hud>div{height:44px;display:grid;place-content:center;text-align:center;border:2px solid #fff9;border-radius:14px;background:#fff8e9e8;box-shadow:0 4px 0 #9a653c33}.sort-hud small{display:block;font-size:8px;letter-spacing:.13em;font-weight:1000;color:#9d7457}.sort-hud strong{font-size:18px}.streak-pill{padding:0 4px;color:#897159;font-size:10px;font-weight:1000;letter-spacing:.05em}.streak-pill.hot{color:#c03f47;background:#ffdd76!important;animation:streakPulse .55s infinite alternate}.mistakes{display:flex!important;gap:2px;align-items:center;color:#e34f5e;font-size:19px}.mistakes i{font-style:normal;transition:.25s}.mistakes i.lost{color:#c9bca9;transform:scale(.8)}.pause-button{width:42px;height:42px;border:2px solid #fff;border-radius:50%;color:#69472f;background:#fff8e9;box-shadow:0 4px 0 #a66d45;font-weight:1000;cursor:pointer}
  .rules-ribbon{position:absolute;z-index:13;top:69px;left:50%;transform:translateX(-50%);padding:7px 12px;border-radius:99px;background:#fff9;color:#75634e;font-size:10px;font-weight:900;white-space:nowrap;transition:.25s}.rules-ribbon b{color:#4c913f}.rules-ribbon.reverse{color:#fff;background:#e14b67;box-shadow:0 0 22px #ff546c}.rules-ribbon.reverse b{color:#ffe468}.frenzy-count{position:absolute;z-index:14;top:78px;right:18px;color:#a82e4e;font-size:9px;font-weight:1000}
  .sort-stage{position:absolute;inset:96px 0 0}.gooby-clerk{position:absolute;z-index:2;right:5%;top:5%;width:96px;height:115px}.gooby-clerk>i{position:absolute;top:0;width:29px;height:62px;border:4px solid #d59e6e;border-radius:50%;background:#ffe6bd}.gooby-clerk>i:first-child{left:15px;transform:rotate(-10deg)}.gooby-clerk>i:nth-child(2){right:15px;transform:rotate(12deg)}.gooby-clerk>div{position:absolute;inset:34px 5px 0;border:4px solid #d59e6e;border-radius:50% 50% 43%;background:#ffe9c5;box-shadow:inset -8px -7px #efc990}.gooby-clerk>div b{position:absolute;top:33%;font-size:22px}.gooby-clerk>div b:first-child{left:26%}.gooby-clerk>div b:nth-child(2){right:26%}.gooby-clerk>div em{position:absolute;left:50%;top:54%;transform:translateX(-50%);font-style:normal}.gooby-clerk>small{position:absolute;right:72%;top:58%;padding:5px 7px;border-radius:7px;color:#fff;background:#d85f61;font-size:7px;font-weight:1000;white-space:nowrap;transform:rotate(-8deg)}
  .bin{position:absolute;z-index:7;border:4px solid #fff;border-radius:20px;color:#fff;box-shadow:0 8px 0 #734f37;cursor:pointer;transition:.16s}.bin:active{transform:scale(.94)}.bin span,.bin b,.bin small{display:block}.bin span{font-size:31px}.bin b{font-size:12px}.bin small{font-size:8px;letter-spacing:.06em}.veggie-bin{left:2%;bottom:7%;width:31%;height:105px;background:linear-gradient(#7dc765,#4d9e52)}.fruit-bin{right:2%;bottom:7%;width:31%;height:105px;background:linear-gradient(#f28575,#d7505c)}.nonfood-bin{left:5%;top:4%;width:115px;height:88px;background:linear-gradient(#84a3b5,#5c778b)}
  .conveyor{position:absolute;z-index:3;left:-3%;right:-3%;bottom:17%;height:86px;border:7px solid #724e38;border-radius:24px;background:#96705a;box-shadow:0 16px #81583e}.conveyor i{display:inline-block;width:16%;height:100%;border-right:4px solid #6f5141}
  .sort-card{position:absolute;z-index:9;left:50%;top:45%;width:172px;height:202px;padding:22px 10px 12px;transform:translate(-50%,-50%);border:5px solid #fff;border-radius:27px;text-align:center;background:linear-gradient(145deg,#fff,#fff3d1);box-shadow:0 10px 0 #bd8257,0 22px 35px #59351f3b;transition:transform .25s ease,opacity .25s ease;cursor:grab}.sort-card.entering{transform:translate(-50%,-50%) scale(.2) rotate(-16deg)}.sort-card>span{display:block;margin:11px 0 3px;font-size:78px;filter:drop-shadow(0 6px 2px #82552b25)}.sort-card>strong{display:block;font-size:20px}.sort-card>small{font-size:8px;font-weight:1000;letter-spacing:.16em;color:#a3866d}.sort-card.exit-left{transform:translate(-190%,-25%) rotate(-24deg)}.sort-card.exit-right{transform:translate(90%,-25%) rotate(24deg)}.sort-card.exit-up{transform:translate(-50%,-160%) rotate(8deg)}.sort-card.correct{opacity:0}.sort-card.wrong{animation:wrongShake .36s}.timer-track{position:absolute;left:15px;right:15px;top:13px;height:8px;border-radius:99px;background:#eadbc5;overflow:hidden}.timer-track i{display:block;width:100%;height:100%;transform-origin:left;border-radius:inherit;background:#6bc26d}.timer-track i.urgent{background:#ec5765}
  .sort-flash{position:absolute;z-index:25;left:50%;top:34%;transform:translate(-50%,-50%) scale(.5);opacity:0;padding:8px 14px;border:3px solid #fff;border-radius:14px;font-size:21px;font-weight:1000;pointer-events:none}.sort-flash.good{color:#fff;background:#57ac57}.sort-flash.bad{color:#fff;background:#e84e61}.sort-flash.active{animation:flash .65s ease-out}.sort-particles{position:absolute;z-index:22;left:50%;top:42%;pointer-events:none}.sort-particles i{position:absolute;font-size:17px;font-style:normal;animation:particle .72s ease-out forwards}
  .frenzy-banner{position:absolute;z-index:35;left:0;right:0;top:30%;padding:19px 10px;text-align:center;color:#fff;background:linear-gradient(90deg,#b52654,#ff5470,#b52654);border-block:5px solid #ffe674;box-shadow:0 12px 30px #6e173a66;transform:translateX(-105%) skewY(-2deg);transition:.35s cubic-bezier(.2,1.3,.4,1)}.frenzy-banner.active{transform:translateX(0) skewY(-2deg)}.frenzy-banner.normal{background:linear-gradient(90deg,#3e8e56,#72c66e,#3e8e56)}.frenzy-banner small,.frenzy-banner strong,.frenzy-banner span{display:block}.frenzy-banner small{color:#ffe77d;font-weight:1000}.frenzy-banner strong{font-size:23px}.frenzy-banner span{font-size:11px;font-weight:1000;letter-spacing:.05em}
  .sort-panel{position:absolute;z-index:50;inset:0;display:grid;place-items:center;padding:22px;background:#68452db8;backdrop-filter:blur(5px)}.sort-panel[hidden]{display:none}.panel-card{width:min(100%,410px);padding:25px 20px 21px;border:4px solid #fff;border-radius:30px;text-align:center;background:linear-gradient(#fffdf5,#fff0c8);box-shadow:0 14px 0 #764c31,0 25px 50px #3f261e66;animation:panelIn .35s cubic-bezier(.2,1.4,.4,1)}.panel-card.compact{padding-top:32px}.eyebrow{display:inline-block;padding:5px 10px;border-radius:99px;color:#7e4e31;background:#ffe39b;font-size:9px;font-weight:1000;letter-spacing:.13em}.panel-card h1{margin:8px 0;font-size:44px;line-height:.82;letter-spacing:-.06em;color:#4c6d41}.panel-card h1 em{color:#e35b68;font-style:normal}.panel-card h2{margin:7px;font-size:34px;color:#544635}.panel-card p{margin:9px auto 15px;max-width:320px;color:#756657;line-height:1.35}.tutorial-rules{display:grid;grid-template-columns:repeat(3,1fr);gap:7px}.tutorial-rules>div{padding:8px 3px;border-radius:15px;background:#fff}.tutorial-rules span,.tutorial-rules b,.tutorial-rules small{display:block}.tutorial-rules span{font-size:31px}.tutorial-rules b{font-size:9px}.tutorial-rules small{font-size:9px;font-weight:1000;color:#d2595f}.frenzy-tip{display:flex;align-items:center;gap:8px;margin:12px 0;padding:9px;border-radius:12px;text-align:left;background:#ffe38a}.frenzy-tip b{font-size:9px;color:#ad3551}.frenzy-tip span{font-size:9px;color:#735b38}.primary,.secondary{width:100%;min-height:50px;border-radius:16px;font-weight:1000;letter-spacing:.04em;cursor:pointer}.primary{border:0;color:#fff;background:linear-gradient(#6bc56b,#469d53);box-shadow:0 6px 0 #31723c}.primary:active{transform:translateY(4px);box-shadow:0 2px 0 #31723c}.secondary{margin-top:11px;border:2px solid #d7bf98;color:#775e47;background:#fff}.crate-medal{display:grid;place-items:center;width:70px;height:70px;margin:-63px auto 8px;border:5px solid #fff;border-radius:18px;color:#fff;background:#66b95f;box-shadow:0 7px #3e8643;font-size:41px;transform:rotate(-5deg)}.big-score{display:block;color:#e45b68;font-size:48px;line-height:1}.result>small{font-size:9px;font-weight:1000;letter-spacing:.15em;color:#9e846a}.best-line{margin:0 0 17px;padding:10px;border-radius:12px;background:#fff6d8;font-size:11px;font-weight:900;color:#79644e}
  @keyframes streakPulse{to{transform:scale(1.05)}}@keyframes wrongShake{25%{transform:translate(-58%,-50%) rotate(-4deg)}50%{transform:translate(-42%,-50%) rotate(4deg)}75%{transform:translate(-55%,-50%)}}@keyframes flash{0%{opacity:0;transform:translate(-50%,-50%) scale(.5)}25%{opacity:1;transform:translate(-50%,-50%) scale(1.1)}75%{opacity:1}100%{opacity:0;transform:translate(-50%,-90%)}}@keyframes particle{to{opacity:0;transform:translate(var(--x),var(--y)) rotate(180deg) scale(.4)}}@keyframes panelIn{from{opacity:0;transform:scale(.82) translateY(20px)}}
  @media(max-height:700px){.veggie-sort{min-height:500px}.sort-hud{top:7px}.rules-ribbon{top:57px}.sort-stage{inset:77px 0 0}.sort-card{top:43%;width:150px;height:174px}.sort-card>span{font-size:61px}.bin{height:86px}.panel-card{padding:17px}.panel-card h1{font-size:35px}.tutorial-rules span{font-size:25px}}
`;
