# Gooby integration checkpoint

Date: 2026-07-17

## Integrated production paths

- `GoobyApp` now owns one exhaustive `SceneManager` registry for five home zones, city driving, three city-arrival-only shops, and all 12 minigames.
- The production `ProceduralGooby` actor is present in every home zone, in the player car, and in shop try-on scenes.
- Places exposes all five home zones and only the parked-car city board. Shop selection, explicit departure, selected-marker arrival, first-visit return driving, and later quick return remain inside the city state machine.
- City driving uses real hold steering/brake controls, route-bound recovery, one selected destination marker, scene-aware chrome, and blocks home/minigame navigation while a required trip is active.
- The shared game/audio/FX event buses drive procedural audio, zone music, fixed-pool particles, and platform haptics. Independent audio and haptic preferences remain respected.
- Runtime assets resolve the checked-in Kenney GLBs and their tracked local texture dependencies, with total procedural fallback coverage for every frozen `AssetKey`.
- Shop purchases commit to the versioned save/economy state. Purchased cosmetics equip on Gooby; purchased furniture places in compatible home zones and restores after reload.
- Every specialist minigame factory is in the exhaustive registry. The normal Play hub launches every game with its specialist tutorial and lifecycle; payout/high-score persistence returns cleanly to the home UI.
- Development acceleration and disposal hooks remain behind Vite development/test guards. Production output contains neither specialist harness globals nor mutation-hook names.

## Contract reconciliation

No frozen contract or ID change was required. `HOME_ZONE_IDS`, `SHOP_IDS`, `MINIGAME_IDS`, `ASSET_KEYS`, `SceneId`, `CityDriveState`, `CityRouteController`, `GoobyActor`, and `MinigameModule` retain their strict existing shapes. Integration is additive through registries, scene adapters, event buses, and dependency injection.

## Issues fixed

- Replaced the single living-room app path with exhaustive home/city/shop/minigame scene orchestration.
- Consumed the real specialist factories and enforced one mounted minigame root marker at the adapter boundary.
- Removed direct shop destinations from Places and enforced parked selection, departure, selected arrival, required return, and home blocking.
- Connected UI care, navigation, settings, wardrobe, inventory, decor, result, and persistence actions to production services.
- Connected audio, FX, and haptic directors without duplicate mapped effects.
- Added checked-in vendored asset provenance, local GLB texture dependencies, audit enforcement, and procedural fallback loading.
- Updated onboarding browser interaction to use real pet and feed steps.
- Expanded root unit discovery and added Node specialist suites without running duplicate framework copies.
- Removed the bubble-bath trailing whitespace and verified all development harnesses stay outside the production bundle.
- Updated the wardrobe preview to render every current cosmetic slot and catalog ID.
- Wired Capacitor App lifecycle save/catch-up, Preferences, notifications, haptics, splash, and status-bar adapters through the production app while retaining web fallbacks.
- Wired adaptive renderer quality, particle density, resource sampling, and ten-transition leak detection into the live renderer/scenes.
- Added a normal-UI catalog strip so every shop item remains selectable in a narrow portrait camera without removing 3D raycast browsing.

## Verification

| Gate | Result |
| --- | --- |
| `git diff --check` | Pass; no output |
| `npm run lint` | Pass; 0 warnings |
| `npm run typecheck` | Pass; 0 diagnostics |
| `npm run test` | Pass; 27 Vitest files / 152 tests plus 16 Node specialist tests = 168 tests, 0 skipped |
| `npm run assets:audit` | Pass; 33 keys, 15/15 packs, 40 curated files, 1,493,043 bytes, offline runtime enforced |
| `npm run audit:asset-size` | Pass; 1.37 MiB runtime assets against 150 MiB |
| `npm run audit:no-network` | Pass; 120 runtime files, 39 test/dev exclusions, no production network references |
| `npm run build` | Pass; 206 modules transformed, no warnings |
| `npm run audit:bundle` | Pass; 330.0 KiB gzip / 1.18 MiB raw against 5 MiB gzip |
| `npm run audit:production` | Pass; 4 bundles, no harness/debug/perf-control markers |
| `npm run test:e2e` | Pass; 24/24 across phone 390×844 and iPad 820×1180, 0 skipped |
| `npm run audit:perf` | Pass; all quality settings applied, governor high → mid, 10 transitions with no likely leak, 0 external requests/page errors |
| `npx cap sync ios` | Pass on Linux for copy/plugin sync; expected CocoaPods/Xcode warnings |
| `npm run ci:native-check` | Pass; Capacitor 8, portrait devices, privacy, assets, bundle ID, plugins, and generated-artifact exclusions |
| `npm run ci:workflow-check` | Pass; workflow structure and actionlint |
| Full portrait walkthrough | Pass; 390×844 normal UI onboarding → pet/feed → bathe → game payout → sleep completion → held-steering/brake city routes → shop purchases → required returns → equip/place/reload; 0 console errors, 0 page errors, 0 external requests |

Release evidence is `/opt/cursor/artifacts/gooby_release_candidate_walkthrough_390x844.webm`, `/opt/cursor/artifacts/gooby_release_candidate_equipped_390x844.png`, and `/opt/cursor/artifacts/gooby_perf_report_release_candidate_final.json`.

## Honest limitations

- Linux validates every committed iOS input but cannot run CocoaPods/Xcode or claim archive/IPA success; the always-running unsigned macOS Actions job is the archive authority.
- The unsigned `Gooby-unsigned.ipa` is a build artifact only and must be re-signed with a valid matching Apple certificate/profile before installation or distribution. Signed and TestFlight jobs require the exact secret sets documented in `ios/README.md`.
- E2E mounts all 12 games on both target viewports and completes one persisted payout; it does not play all 12 games to their natural ending. Their deterministic gameplay/lifecycle behavior remains covered by specialist unit and focused browser suites.
