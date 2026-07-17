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

## Verification

| Gate | Result |
| --- | --- |
| `git diff --check` | Pass; no output |
| `npm run lint` | Pass; 0 warnings |
| `npm run typecheck` | Pass; 0 diagnostics |
| `npm run test` | Pass; 23 Vitest files / 120 tests plus 16 Node specialist tests = 136 tests, 0 skipped |
| `npm run assets:audit` | Pass; 33 keys, 15/15 packs, 40 curated files, 1,493,043 bytes, offline runtime enforced |
| `npm run build` | Pass; 202 modules transformed |
| `npm run test:e2e` | Pass; 10/10 across phone 390×844 and iPad 820×1180, 0 skipped |
| Bubble/Sort/Says focused browser suite | Pass; 1/1 full payout/disposal flow |
| City focused browser suite | Pass; 2/2 including real pointer-held outbound and required return driving |
| Responsive UI focused browser suite | Pass; 4/4 across 375×667, 390×844, and 820×1180 |
| Full portrait walkthrough | Pass; onboarding → pet/feed → bathe → game payout → sleep completion → city → shop → buy → required return → equip; 0 console errors, 0 page errors, 0 external requests |

The full portrait evidence is `gooby_full_integration_walkthrough_390x844_v3.webm` with final equipped state in `gooby_full_integration_equipped_390x844_v3.png`.

## Honest limitations

- The production build passes but reports one large main chunk: 1,219.04 kB minified / 334.84 kB gzip. Code splitting is a future performance improvement, not an integration blocker.
- Long timers and route distance are accelerated only after the corresponding normal UI path is asserted. Real hold steering/braking and a complete outbound/return route are separately exercised by the focused city browser suite.
- E2E mounts all 12 games on both target viewports and completes one persisted payout; it does not play all 12 games to their natural ending. Their deterministic gameplay/lifecycle behavior remains covered by specialist unit and focused browser suites.
