# Performance audit findings

Measured with the iPhone 13 Playwright profile in cloud Chromium. The renderer is SwiftShader, so absolute FPS is a repeatable software-rendering regression signal, not a substitute for Safari profiling on physical iPhones.

## Fail-closed audit method

- The runner reserves an OS-selected loopback port, starts Vite with `--strictPort`, and accepts the server only when a run-unique nonce, protocol, service name, and PID match. A pre-fix reproduction had Vite report that fixed port 4520 was occupied while the old runner audited the unrelated listener and returned success.
- Any server exit, readiness timeout, identity mismatch, browser failure, page error, or request outside the audit host fails the run. Chromium blocks service workers and aborts external requests.
- Main scenes require 120 post-warm frame samples each; forced quality tiers require 60 each. A deficit is a hard failure rather than a partial measurement.

## SwiftShader baselines and limits

SwiftShader timing is normalized to a deterministic raw-WebGL runner calibration instead of treating one cloud VM's absolute FPS as portable. Before the app loads, an exact 390×844 `OffscreenCanvas` runs a fixed WebGL 1 shader, 105 draw calls, 154 triangles per call (16,170 per frame), and 8,000 deterministic submission-side math iterations per draw. `gl.finish()` keeps queued software rendering inside the measured frame. The calibration runs one 120-sample warmup followed by three clean 120-sample trials.

The fixed FPS ratios are the former documented SwiftShader minimums divided by the 60 FPS reference runner. The fixed p95-throughput ratios are the 16.667 ms reference p95 divided by the former documented p95 caps. A SwiftShader scene must pass both ratios and its absolute FPS safety floor:

- `scene FPS / calibration FPS >= FPS ratio`
- `calibration p95 / scene p95 >= p95 ratio`
- `scene FPS >= absolute floor`

| Scene | FPS ratio | p95 throughput ratio | Absolute FPS floor | Draw / triangle max |
| --- | ---: | ---: | ---: | ---: |
| Home living room, low | 0.750 (45/60) | 0.595 (16.667/28) | 30 | 125 / 20,000 |
| City destination board, low | 0.467 (28/60) | 0.397 (16.667/42) | 20 | 48 / 16,000 |
| City driving, low | 0.400 (24/60) | 0.333 (16.667/50) | 18 | 64 / 22,000 |
| Fluff Salon with cosmetic try-on, low | 0.400 (24/60) | 0.256 (16.667/65) | 18 | 100 / 21,000 |
| Delivery Dash Express | 0.800 (48/60) | 0.667 (16.667/25) | 30 | 1 / 1 |
| Pond Fishing Legend | 0.800 (48/60) | 0.667 (16.667/25) | 30 | 1 / 1 |
| Rhythm Hop hard mode | 0.800 (48/60) | 0.667 (16.667/25) | 30 | 1 / 1 |

The calibration rejects any missing 120-sample trial. It also rejects unstable runners when the three-trial FPS range exceeds 20% of the median or the p95 range exceeds 35% of the median. The report records the warmup, all calibration trials, variance, every app trial, and partial state on failure before the error is propagated.

A normal local audit calibrated at 60.0 FPS / 16.7 ms p95; a 2× CDP CPU-throttled audit calibrated at 34.3 FPS / 33.4 ms and passed the same normalized scene gates. A synthetic sustained 30 FPS home scene still fails against a 60 FPS calibration. Hardware renderers retain every previous absolute min-FPS/max-p95 limit. Draw calls, triangles, sample counts, resource limits, and leak limits are unchanged and renderer-independent.

Forced city quality tiers still record 60 samples each and assert pixel ratio, shadows, camera distance, DOM FX density, renderer/DOM labels, and fog behavior for every tier. The sustained 35 FPS governor check still moves high to mid.

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
