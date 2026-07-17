# Gooby

Gooby is an original portrait-first virtual-pet game for iOS and the web. Its star is a very chubby cream-and-apricot rabbit rendered in a cozy, procedural low-poly world. The web game is the product; Capacitor is deliberately a thin native shell.

The foundation is fully offline. Three.js geometry, furniture, icons, particles, and WebAudio effects all have procedural implementations, so runtime code never needs the network.

## Quick start

Requires Node 22 (see `.nvmrc`).

| Task | Command |
| --- | --- |
| Install | `npm ci` |
| Develop | `npm run dev` |
| Build | `npm run build` |
| Lint | `npm run lint` |
| Type-check | `npm run typecheck` |
| Unit tests | `npm run test` |
| Browser tests | `npx playwright install chromium && npm run test:e2e` |
| Full web CI | `npm run ci:workflow-check` |
| Asset audit | `npm run assets:audit` |
| Native input check | `npm run build && npm run ci:native-check` |

Playwright owns port `4519`; normal Vite development uses `5173`.

## Architecture

- `src/app/` — application orchestration, lifecycle catch-up, persistence, and the safe `window.__gooby` diagnostics surface.
- `src/core/contracts/` — frozen boundaries for clocks, RNG, simulation, saves, economy, events, gestures, platform ports, routes, actors, assets, and minigames.
- `src/core/` — real scene, pointer-input, platform, and audio infrastructure.
- `src/render/` — capped-quality Three renderer, resource tracking, and complete procedural asset fallbacks.
- `src/gooby/` — the animated foundation actor: pear-shaped body, asymmetric spring ears, buck tooth, blinking, breathing, and belly jiggle.
- `src/scenes/home/` — the playable living room plus typed ownership slots for all five home zones.
- `src/scenes/city/` — route-state contract and invariant-enforcing drive state machine.
- `src/scenes/shops/` — the three frozen shop entries. Shops use `city-arrival-only`; normal UI cannot teleport to them.
- `src/minigames/` — twelve individually owned, compile-green module slots and one exhaustive registry.
- `src/ui/`, `src/fx/`, `src/perf/` — responsive safe-area UI, lightweight effects, and frame probe.

## Frozen parallel-ownership contract

Foundation owns `src/core/contracts/**`, `src/app/**`, the registry files, and shared rendering/platform code. Specialists may implement only their named area:

- Home specialist: individual zones under `src/scenes/home/`, preserving `HOME_ZONE_IDS`.
- City specialist: `src/scenes/city/`, preserving `CityDriveState` and `CityRouteController`.
- Shop specialist: scenes behind the entries in `SHOP_REGISTRY`; no direct home-to-shop navigation.
- Minigame specialists: their one named directory under `src/minigames/`, implementing `MinigameModule`.
- Character specialist: `src/gooby/`, implementing `GoobyActor`.
- FX/performance/procedural/UI specialists: their matching top-level source directories.

Do not rename route, asset, shop, home-zone, or minigame IDs. Extend contracts through additive changes and keep registry-completeness tests green.

## Simulation and persistence

All simulation is pure and clock-injected. `Date.now()` is lint-banned outside `RealClock`. Sleep lasts exactly 30 minutes, can be gently interrupted, and completes through the same deterministic advance function used by offline catch-up. Offline needs cannot fall below 15.

`SaveStateSchema` is versioned with Zod. Save adapters expose compare-and-commit revisions so callers do not silently overwrite a newer record. Invalid payloads recover to a valid new state; version-one saves migrate without losing needs or progression.

## Native shell

Capacitor plugins are represented by compile-checked iOS adapters. Once native project generation is desired, run `npm run build`, then `npx cap add ios` and `npx cap sync ios`. Generated iOS project files are intentionally not part of this foundation.
