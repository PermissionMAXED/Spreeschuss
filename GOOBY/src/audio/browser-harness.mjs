import { chromium } from "@playwright/test";

const baseUrl = process.env.GOOBY_URL ?? "http://127.0.0.1:4519";
const artifacts = process.env.GOOBY_ARTIFACTS ?? "/opt/cursor/artifacts";
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 540, height: 920 },
  recordVideo: { dir: "/tmp/gooby-audio-video", size: { width: 540, height: 920 } },
});
const page = await context.newPage();
const video = page.video();

await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
await page.evaluate(async () => {
  const [{ GoobyAudioSystem }, { EventBus }, { FakeClock }, { SeededRng }, { DomFx, FxDirector }, { HapticDirector }] =
    await Promise.all([
      import("/src/audio/index.ts"),
      import("/src/core/contracts/events.ts"),
      import("/src/core/contracts/clock.ts"),
      import("/src/core/contracts/rng.ts"),
      import("/src/fx/index.ts"),
      import("/src/haptics/index.ts"),
    ]);

  document.body.innerHTML = `
    <main id="polish-harness">
      <div class="sky"><i></i><i></i><i></i></div>
      <section class="card">
        <span class="eyebrow">GOOBY POLISH LAB</span>
        <div class="gooby"><b></b><b></b><span>♥</span></div>
        <h1>Procedural Audio + FX</h1>
        <p>Zero files. Event-driven sound, music, particles, and haptics.</p>
        <div class="diagnostics" role="status">Tap Home to unlock audio</div>
        <div class="zones">
          <button data-zone="home">Home</button>
          <button data-zone="carrot">Carrot Catch</button>
          <button data-zone="rhythm">Rhythm Hop</button>
        </div>
        <button class="mute" data-mute>Mute / unmute</button>
      </section>
      <div class="particles"></div>
    </main>
  `;
  const style = document.createElement("style");
  style.textContent = `
    *{box-sizing:border-box}body{margin:0;overflow:hidden;font-family:ui-rounded,system-ui;color:#59443e;background:#f7d9af}
    #polish-harness{position:relative;display:grid;place-items:center;width:100vw;height:100vh;background:linear-gradient(#9ed9e7 0 34%,#f5d59f 34% 100%)}
    .sky{position:absolute;inset:0 0 auto;height:42%;overflow:hidden}.sky i{position:absolute;width:120px;height:38px;border-radius:50%;background:#fff9;filter:blur(1px)}
    .sky i:nth-child(1){left:3%;top:18%}.sky i:nth-child(2){right:-3%;top:32%;width:180px}.sky i:nth-child(3){left:38%;top:7%;width:70px}
    .card{position:relative;z-index:2;width:min(88vw,460px);padding:34px 28px 28px;border:2px solid #fff9;border-radius:32px;text-align:center;background:#fff8efec;box-shadow:0 28px 70px #74492f35}
    .eyebrow{font-size:12px;font-weight:900;letter-spacing:.18em;color:#c56d51}.gooby{position:relative;width:132px;height:126px;margin:16px auto 8px;border-radius:48% 48% 42% 42%;background:#f4c78f;box-shadow:inset -14px -10px #edae77}
    .gooby b{position:absolute;top:-50px;width:36px;height:76px;border-radius:70% 70% 35% 35%;background:#f4c78f}.gooby b:first-child{left:22px;transform:rotate(-9deg)}.gooby b:nth-child(2){right:22px;transform:rotate(9deg)}
    .gooby span{display:grid;place-items:center;height:100%;font-size:34px;color:#e87d87}h1{margin:8px 0 6px;font-size:30px}p{margin:0 auto 18px;max-width:330px;line-height:1.45;color:#7c6259}
    .diagnostics{margin:14px 0;padding:12px;border-radius:14px;font-weight:800;color:#3f7c73;background:#d9f1e7}.zones{display:grid;grid-template-columns:1fr;gap:9px}
    button{min-height:48px;border:0;border-radius:15px;font:800 15px ui-rounded,system-ui;color:white;background:linear-gradient(135deg,#e78768,#c96958);box-shadow:0 7px 14px #a3544230;cursor:pointer}
    button.active{outline:4px solid #f6bd6c;background:linear-gradient(135deg,#70b9ac,#4d948d)}button.mute{width:100%;margin-top:10px;color:#805c51;background:#ead3c4;box-shadow:none}
    .particles{position:absolute;z-index:4;inset:0;overflow:hidden;pointer-events:none}
  `;
  document.head.append(style);

  const events = new EventBus();
  const system = new GoobyAudioSystem(new FakeClock(1_000), new SeededRng(88));
  const haptics = new HapticDirector();
  system.bind(events);
  haptics.bindAudioEvents(events);
  const particleLayer = document.querySelector(".particles");
  const fx = new DomFx(particleLayer, { capacity: 48, rng: new SeededRng(99) });
  const fxDirector = new FxDirector(fx, () => innerWidth / 2, () => innerHeight * 0.34);
  fxDirector.bindAudioEvents(events);
  const diagnostics = document.querySelector(".diagnostics");
  let started = false;
  let muted = false;

  const show = async (zone, label, event, cue) => {
    if (!started) {
      await system.start(zone);
      started = true;
    } else {
      events.emit("audio:zone", { zone });
    }
    events.emit(event, cue);
    document.querySelectorAll("[data-zone]").forEach((button) => {
      button.classList.toggle("active", button.dataset.zone === label);
    });
    diagnostics.textContent = `${system.engine.unlocked ? "Audio running" : "Audio locked"} · ${system.music.currentTheme} · ${fx.pool.activeCount}/48 particles`;
  };

  document.querySelector('[data-zone="home"]').addEventListener("click", () => {
    void show("home:living-room", "home", "audio:gooby", { action: "pet" });
  });
  document.querySelector('[data-zone="carrot"]').addEventListener("click", () => {
    void show("minigame:carrot-catch", "carrot", "audio:minigame", { action: "combo", combo: 8 });
  });
  document.querySelector('[data-zone="rhythm"]').addEventListener("click", () => {
    void show("minigame:rhythm-hop", "rhythm", "audio:minigame", { action: "win", score: 1_200 });
  });
  document.querySelector("[data-mute]").addEventListener("click", () => {
    muted = !muted;
    events.emit("audio:mute", { muted });
    diagnostics.textContent = `${muted ? "Muted" : "Audio running"} · ${system.music.currentTheme} · shared transition`;
  });

  window.__polishHarness = { system, fx, get muted() { return muted; } };
});

await page.getByRole("button", { name: "Home", exact: true }).click();
await page.waitForTimeout(450);
await page.screenshot({ path: `${artifacts}/gooby_audio_fx_home_event_driven.png` });
await page.getByRole("button", { name: "Carrot Catch" }).click();
await page.waitForTimeout(600);
await page.screenshot({ path: `${artifacts}/gooby_audio_fx_carrot_catch_event_driven.png` });
await page.getByRole("button", { name: "Rhythm Hop" }).click();
await page.waitForTimeout(600);
await page.screenshot({ path: `${artifacts}/gooby_audio_fx_rhythm_hop_event_driven.png` });
await page.getByRole("button", { name: "Mute / unmute" }).click();
await page.waitForTimeout(250);
await page.getByRole("button", { name: "Mute / unmute" }).click();
await page.waitForTimeout(250);

const result = await page.evaluate(() => ({
  audioState: window.__polishHarness.system.engine.audioContext?.state,
  theme: window.__polishHarness.system.music.currentTheme,
  muted: window.__polishHarness.muted,
  particleCapacity: window.__polishHarness.fx.pool.capacity,
  particleElements: document.querySelectorAll(".gooby-particle").length,
}));

if (result.audioState !== "running") throw new Error(`Expected running audio, received ${result.audioState}`);
if (result.theme !== "minigame-rhythm") throw new Error(`Expected rhythm theme, received ${result.theme}`);
if (result.muted) throw new Error("Mute did not transition back to audible");
if (result.particleElements !== result.particleCapacity) throw new Error("Particle DOM pool was not fixed-capacity");

await context.close();
if (video) await video.saveAs(`${artifacts}/gooby_audio_fx_home_two_games_event_driven.webm`);
await browser.close();
console.log(JSON.stringify(result));
