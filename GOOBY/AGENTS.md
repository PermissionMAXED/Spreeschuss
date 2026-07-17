# Gooby

## Cursor Cloud specific instructions

- This project is an offline, portrait-first Three.js/Vite game. Standard setup, test, build, and ownership commands are documented in `README.md`; run them from `GOOBY/`, never from the repository root.
- The Vite dev server is the only required service. Playwright starts an isolated server on port `4519`; normal development uses port `5173`.
- No database, backend, or network asset service is needed. Procedural fallbacks cover every `AssetKey`.
- `npm run assets:fetch` atomically replaces `public/assets/vendor`; restart an already-running Vite server afterward so its startup-time public-file inventory includes nested GLB texture dependencies.
- Browser testing must complete the three-step onboarding before interacting with Gooby. For normal-UI acceptance evidence, drive gameplay, City, progression, and purchases through real pointer/keyboard controls; the only permitted mutation hook is `window.__gooby.test.advanceTime(...)` for the real 30-minute sleep clock. Production exposes diagnostics but not mutation hooks.
- Run the root, UI, City, and Bubble Playwright projects independently when validating integration; `package.json` lists the four commands. At `390×844`, use the app scene-chrome Pause control for specialist pause/leave flows because it owns the safe top inset and pauses the active module.
- Quiet hours are normal Settings controls: the checkbox and `HH:00` start/end selectors persist to canonical `notificationPolicy.quietHours`. Verify them through the visible UI and reload, not by writing storage directly.
- `npx cap sync ios` is expected to be idempotent. Linux can validate generated inputs with `ci:native-check`, but CocoaPods/Xcode archive, signing, re-signing, and IPA distribution remain macOS release boundaries documented in `ios/README.md`.
- Keep `Date.now()` confined to `src/core/contracts/clock.ts`; simulation, persistence, and specialist modules must inject `Clock`.
- `src/core/contracts/**` and frozen ID registries are parallel-work contracts. Preserve IDs and the city routing invariants described in `README.md`.
