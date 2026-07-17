# Spreeschuss

Spreeschuss is a competitive 5v5 tactical first-person shooter (Valorant/CS:GO inspired) built with three.js. It runs entirely in the browser with **no external assets** — all geometry, textures, audio and the logo are generated procedurally in code.

The game lives in the [`SPREESCHUSS/`](SPREESCHUSS/) directory.

## Cursor Cloud specific instructions

### GOOBY
- Standard development and release commands are maintained in `GOOBY/README.md` and `GOOBY/package.json`; run them from `GOOBY/`.
- Playwright owns dedicated port `4519`. After a clean dependency reinstall, do not reuse an older Vite process on that port because its optimized-dependency cache can return `504 Outdated Optimize Dep`; let Playwright start a fresh server.
- iOS archive/IPA validation requires the macOS GitHub Actions workflow. Linux can sync Capacitor inputs and run the native/workflow checks, but cannot claim Xcode archive success.
- `npm run assets:fetch` is an intentional vendored-asset refresh, not routine setup; it may rewrite checked-in assets/manifests and must be followed by the asset audit. `npx cap sync ios` refreshes ignored copied web/plugin files under the checked-in native shell.

### Services & commands (all run from the `SPREESCHUSS/` directory)
- **Dev server (primary):** `npm run dev` — Vite dev server on `http://localhost:5173`. This is the only service needed to play/test the game. Run it from inside `SPREESCHUSS/` (e.g. `cd SPREESCHUSS && npm run dev`), not the repo root.
- **Production build check:** `npm run build` — fast way to catch syntax/import errors across all modules without a browser. Use this to validate changes.
- **Optional multiplayer lobby:** `npm run server` — a `ws` lobby/relay scaffold on port 8090 (`server/index.js`). It is **not required**: the game is fully playable single-player against AI bots without it. `src/net/net.js` is the (currently unwired) client for it.
- **Lint:** `npm run lint` is declared but **no ESLint config is committed**, so it currently errors — don't rely on it. There is no automated test suite; validate via `npm run build` + manual browser testing.

### How the game is structured (non-obvious)
- Pure client-side ES modules under `SPREESCHUSS/src`. Key pieces: `engine/` (renderer, loop, input, event bus), `game/` (Game orchestrator, player controller, bots, collision, entity, viewmodel), `agents/` (data-driven roster + reusable ability behaviors), `weapons/`, `maps/` (30 plant maps + 5 FFA maps generated from seeds via `mapbuilder`), `ui/` (HUD, menu, logo), `audio/` (procedural WebAudio).
- Everything communicates through a global event bus (`src/engine/eventbus.js`). The `Game` class emits a throttled `hud` event (~30/s) that drives the HUD.
- The first-person weapon **viewmodel is parented to the main camera** (not a separate overlay scene) and re-mounts itself defensively each frame, because `Renderer.clearScene()` (called on every `loadMatch`) wipes the scene graph including the camera's children.

### Testing gotchas (important for automated/computer-use testing)
- **Pointer lock is required to play:** after starting a match you must click the "KLICKEN ZUM SPIELEN" overlay to lock the mouse. Camera look and firing only work while pointer-locked.
- **Hold-based inputs:** the scoreboard (hold `Tab`) and sustained movement/fire rely on keys being physically *held*. Automated harnesses that only *tap* keys cannot demonstrate these; they work fine for real users.
- **Tracers are brief** (~0.14s beams) — they are easy to miss in a single screenshot; use a video or fire a sustained burst to observe them.
- Controls: `WASD` move, mouse look, `Shift` walk, `Ctrl`/`C` crouch, `Space` jump, LMB fire, RMB scope (snipers only), `R` reload, `1/2/3` weapon/pistol/knife, `B` buy shop (buy phase), `C/Q/E/X` abilities, hold `F` to plant/defuse the spike, `Tab` scoreboard.
