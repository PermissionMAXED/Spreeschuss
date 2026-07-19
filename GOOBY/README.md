# Gooby’s Cozy Burrow

Gooby’s Cozy Burrow is an original portrait-first virtual-pet game for iOS and the web. Its star is Gooby, a very chubby cream-and-apricot rabbit rendered in a cozy, procedural low-poly world. The web game is the product; Capacitor is deliberately a thin native shell.

The foundation is fully offline. Three.js geometry, furniture, icons, particles, and WebAudio effects all have procedural implementations, so runtime code never needs the network. The final curated runtime asset set is 3/3 locally available Kenney packs, 7 files, and 535,869 source bytes (509.1 KiB runtime payload), with truthful CC0 attribution in the in-game credits and manifest.

## Final integration status

The 2026-07-17 release candidate passed clean install, lint, type-check, 232 unit tests, 34 specialist tests, all four independent Playwright suites, asset/offline/bundle/production/performance audits, idempotent Capacitor sync, 11 native-checker regression tests, native validation, workflow validation, and direct `actionlint`.

The exact `390×844` normal-UI walkthrough also passed keyboard and pointer onboarding, every home zone and care interaction, real bathroom scrubbing, all City/shop return legs and reloads, inventory ownership, furniture editing/persistence, all 12 unpaid tutorial exits, 17 natural real-input Carrot Catch runs, and focused Bubble/Veggie/Delivery/Cannon/Rhythm behavior with zero external requests or runtime errors. See `INTEGRATION_REPORT.md` and `/opt/cursor/artifacts/gooby_final_integration_verification_20260717.log` for exact evidence.

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
| Full web CI | `npm run ci:web` |
| Asset audit | `npm run assets:audit` |
| Native input check | `npm run build && npx cap sync ios && npm run ci:native-check` |

Every Playwright suite owns a fresh, unique, strict dev-server port (root `4519`, UI `4520`, Surf `4522`, Carrot `4523`, Bubble `4524`, Cake `4525`, City `4547`); suites never reuse an existing server. Normal Vite development uses `5173`.

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

The checked-in Capacitor 8 shell targets portrait iPhone and iPad with display name `Gooby’s Cozy Burrow` and bundle identifier `com.gooby.pet`. The web fallback uses local storage, Web Notifications, vibration, and procedural audio; iOS uses Preferences, Local Notifications, Haptics, App lifecycle events, Splash Screen, and Status Bar adapters. Refresh copied web assets and plugin metadata with `npm run build && npx cap sync ios`.

`npm run ci:web` runs hygiene, lint, type-checking, all unit/specialist tests, skipped-test enforcement, all root/UI/City/Bubble Playwright projects, asset/license and size audits, static no-network scanning, production build and bundle/debug scans, the adaptive-quality/32-transition leak audit, native input checks, and workflow/actionlint checks. CocoaPods, Xcode archive, and IPA validation require macOS; see `ios/README.md`.

The iOS workflow always builds and uploads `Gooby-unsigned.ipa` with signing disabled. That artifact is not device-installable or distributable until it is re-signed with a matching Apple certificate and provisioning profile. Optional signed and TestFlight jobs run only when their complete documented secret sets and event gates are satisfied.

## Naming and legal review

The distinctive full product title `Gooby’s Cozy Burrow`, together with the rabbit character and `com.gooby.pet` bundle identifier, mitigates similarity with shorter names. This is a product-positioning observation, not a legal conclusion; formal trademark clearance remains a separate release-owner responsibility.
