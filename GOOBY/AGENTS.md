# Gooby

## Cursor Cloud specific instructions

- This project is an offline, portrait-first Three.js/Vite game. Standard setup, test, build, and ownership commands are documented in `README.md`; run them from `GOOBY/`, never from the repository root.
- The Vite dev server is the only required service. Playwright starts an isolated server on port `4519`; normal development uses port `5173`.
- No database, backend, or network asset service is needed. Procedural fallbacks cover every `AssetKey`.
- Browser testing must complete the three-step onboarding before interacting with Gooby. The development-only `window.__gooby.test` surface provides deterministic clock advancement for the real 30-minute sleep flow; production exposes diagnostics but not mutation hooks.
- Keep `Date.now()` confined to `src/core/contracts/clock.ts`; simulation, persistence, and specialist modules must inject `Clock`.
- `src/core/contracts/**` and frozen ID registries are parallel-work contracts. Preserve IDs and the city routing invariants described in `README.md`.
