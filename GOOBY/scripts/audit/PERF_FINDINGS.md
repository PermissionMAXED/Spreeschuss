# Performance audit findings

Measured with the iPhone 13 Playwright profile in cloud Chromium. The renderer is SwiftShader, so absolute FPS is a repeatable software-rendering regression signal, not a substitute for Safari profiling on physical iPhones.

## Fail-closed audit method

- The runner reserves an OS-selected loopback port, starts Vite with `--strictPort`, and accepts the server only when a run-unique nonce, protocol, service name, and PID match. A pre-fix reproduction had Vite report that fixed port 4520 was occupied while the old runner audited the unrelated listener and returned success.
- Any server exit, readiness timeout, identity mismatch, browser failure, page error, or request outside the audit host fails the run. Chromium blocks service workers and aborts external requests.
- Main scenes require 120 post-warm frame samples each; forced quality tiers require 60 each. A deficit is a hard failure rather than a partial measurement.

## SwiftShader baselines and limits

The limits use the measured July 17, 2026 baselines plus bounded headroom for cloud scheduling noise. Draw/triangle budgets are renderer-independent regression caps. Non-SwiftShader timing limits are stricter and live beside these values in `perf-browser.mjs`.

| Scene | Measured FPS / p95 | FPS min / p95 max | Measured draws / triangles p95 | Draw / triangle max |
| --- | ---: | ---: | ---: | ---: |
| Home living room, low | 58.8 / 17.9 ms | 45 / 28 ms | 105 / 16,226 | 125 / 20,000 |
| City destination board, low | 38.6 / 33.4 ms | 28 / 42 ms | 34 / 11,404 | 48 / 16,000 |
| City driving, low | 33.4 / 33.4 ms | 24 / 50 ms | 52 / 17,336 | 64 / 22,000 |
| Fluff Salon with cosmetic try-on, low | 38.6 / 33.4 ms | 24 / 65 ms | 83 / 17,018 | 100 / 21,000 |
| Delivery Dash Express | 59.8 / 16.8 ms | 48 / 25 ms | 0 / 0 | 1 / 1 |
| Pond Fishing Legend | 59.8 / 16.9 ms | 48 / 25 ms | 0 / 0 | 1 / 1 |
| Rhythm Hop hard mode | 59.8 / 16.9 ms | 48 / 25 ms | 0 / 0 | 1 / 1 |

Fluff Salon uses a conservative 65 ms p95 cap because a separate valid 120-sample SwiftShader run observed a 54.9 ms p95 scheduling outlier; its work budgets remain tight enough to catch scene complexity regressions.

Forced city quality tiers recorded 60 samples each: low 38.6 FPS / 33.4 ms p95 / 34 draws / 11,404 triangles; mid 21.2 FPS / 50.1 ms / 37 / 12,680; high 14.2 FPS / 83.3 ms / 37 / 12,680. Pixel ratio, shadows, camera distance, DOM FX density, renderer/DOM labels, and fog behavior are asserted for every tier. The sustained 35 FPS governor check still moves high to mid.

## Lifecycle and leak limits

The leak pass first warms all exercised scenes, games, and the purchased cosmetic, then takes a same-scene living-room baseline. Eight cycles run 32 post-baseline transitions across four home zones and four minigames, with a cosmetic equip/remove and minigame mount/dispose in every cycle. CDP forces GC before all nine checkpoints.

| Metric | Baseline → final | Slope per cycle | Allowed slope / final / peak growth |
| --- | ---: | ---: | ---: |
| Geometries | 78 → 78 | 0 | 0.25 / 2 / 4 |
| Textures | 3 → 3 | 0 | 0.15 / 1 / 2 |
| Materials | 86 → 86 | 0 | 0.25 / 2 / 4 |
| Programs | 3 → 3 | 0 | 0.15 / 1 / 2 |
| Event listeners | 47 → 48 | 0.067 | 0.5 / 4 / 8 |
| DOM nodes | 797 → 706 | -5.9 | 2 / 12 / 30 |
| CDP heap | 19,524,116 → 19,823,800 bytes | 32,847 bytes | 524,288 / 6 MiB / 12 MiB |

The in-app leak heuristic also remains clear after all 32 transitions. Trend tests cover stable noise, persistent slope, final/peak bounds, and minimum-checkpoint rejection.

## Actionable non-owned finding

The home living room still carries 105 draw calls, 16,226 triangles, 78 geometries, and 86 materials at low quality. Reusing procedural material and geometry instances in `src/scenes/home/**`, `src/gooby/**`, and `src/render/proc/**` remains the highest-value scene-work reduction.
