# Performance audit findings

Measured with the iPhone 13 Playwright profile in cloud Chromium. Its renderer is SwiftShader, so absolute FPS is a software-rendering stress signal, not a substitute for Safari profiling on physical iPhones.

## Actionable non-owned findings

1. **Shadow tiers multiply city render work.** On the city destination board, forced low quality measured 64 draw calls / 15,598 triangles p95; mid and high measured 141–142 draw calls / about 34,750 triangles p95. Review `src/scenes/city/world.ts` shadow casters and receivers, especially static decoration and instanced props. Keep only visually important casters on mid, tighten the directional-light shadow volume, and consider baked/blob shadows.
2. **Home scenes have high material and draw-call counts for their visual complexity.** Living-room low quality measured 83 draw calls, 12,078 triangles, 56 geometries, and 84 materials. Reuse material instances and geometry across procedural furniture/Gooby parts in `src/scenes/home/**`, `src/gooby/**`, and `src/render/proc/**`; instance repeated decorations where possible.

## Positive checks

- Delivery Dash Express sustained about 59.8 FPS in the same software-rendering harness because the Three scene is empty while its 2D canvas runs.
- Ten living-room/garden transitions produced no positive geometry, texture, program, material, or heap growth; the leak heuristic stayed clear.
- Runtime quality changes apply pixel ratio, shadows, camera distance, and DOM FX density; the sustained 35 FPS governor check moves high to mid.
- Production source maps are disabled and JavaScript is split into app, Three, Zod, and Capacitor chunks without build warnings.
- Runtime assets total 1.37 MiB against the 150 MiB budget, and JavaScript totals 330.0 KiB gzip against the 5 MiB budget.
- Repository lint and type-check gates pass with zero warnings/diagnostics.
