# Performance audit findings

Measured with the iPhone 13 Playwright profile in cloud Chromium. The renderer is SwiftShader, so absolute FPS is a repeatable software-rendering regression signal, not a substitute for Safari profiling on physical iPhones.

## Fail-closed audit method

- The runner reserves an OS-selected loopback port, starts Vite with `--strictPort`, and accepts the server only when a run-unique nonce, protocol, service name, and PID match. A pre-fix reproduction had Vite report that fixed port 4520 was occupied while the old runner audited the unrelated listener and returned success.
- Any server exit, readiness timeout, identity mismatch, browser failure, page error, or request outside the audit host fails the run. Chromium blocks service workers and aborts external requests.
- Main scenes require 120 post-warm frame samples each; forced quality tiers require 60 each. A deficit is a hard failure rather than a partial measurement.

## SwiftShader baselines and limits

SwiftShader timing is normalized to a fixed representative **Three.js** calibration instead of treating one cloud VM's absolute FPS as portable. The previous calibrator was a raw WebGL 1 runner (one trivial shader, no depth test, no antialiasing, CPU `Math.sin` busy loops); on a slower CI runner it calibrated at 46.45 FPS while the Home living room rendered 30.29 FPS with 42 draws and 13,406 triangles, producing a false 0.65 FPS ratio against Home's 0.75 gate before any City measurement occurred. A raw-shader workload is not comparable to Three.js scene scheduling, so it was replaced rather than the thresholds.

Before the app loads, the audit navigates to a dev-only calibration page (`src/perf/calibration.html`, served by the same audit Vite server, absent from the production bundle) that renders a frozen scene through the same `WebGLRenderer` profile as the audited Home scene at low quality: identical constructor options to `GameRenderer` (`alpha: false`, `antialias: true`, depth on, `powerPreference: "default"`), sRGB output, ACES filmic tone mapping at 1.05 exposure, shadow maps off, 390×844 at device pixel ratio 1, camera FOV 36 / far 76, and an ambient-plus-directional light rig. The workload is 42 meshes in interleaved family order — 14 smooth `MeshStandardMaterial` spheres, 12 flat-shaded `MeshStandardMaterial` boxes, 8 clearcoat `MeshPhysicalMaterial` tori, 8 `MeshBasicMaterial` cylinders — totaling exactly 42 draw calls, 13,408 triangles, and 4 shader program families per frame. Every mesh rotates deterministically and the root group bobs, so each frame performs a full scene-graph traversal and world-matrix update like the real game loop; all geometry is generated and no mesh ever leaves the frustum. `renderer.info` is asserted against the frozen constants (42 / 13,408 / 4) on **every** calibration frame, unit tests assert the same counts against real three.js geometry plus frustum containment, and the browser runner re-asserts them per cohort. Loading the calibration page also warms the Vite module graph and the pre-bundled `three` dependency before the app itself is measured. Each independent calibration cohort is a fresh page navigation (new WebGL context) running its own 120-sample warmup followed by three clean 120-sample trials.

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
| Cake Atelier scored orders | 0.800 (48/60) | 0.667 (16.667/25) | 30 | 1 / 1 |
| Cloud Bounce run | 0.500 (30/60) | 0.397 (16.667/42) | 20 | 1 / 1 |
| Honey Drizzle round | 0.800 (48/60) | 0.667 (16.667/25) | 30 | 1 / 1 |

Shopping Surf and Cloud Bounce render through the shared Stage3D lease, which the in-app probe (main renderer only) cannot see, so their draw-call budgets are asserted against the live modules in their own harnesses: ≥30 FPS, p95 ≤42 ms, ≤70 draw calls, ≥60 sampled real-rAF frames, and a leak-neutral lease release (zero geometry/texture/program delta after dispose). Cloud Bounce's in-app scene row above additionally gates its frame timing inside the real app loop.

The calibration rejects any missing 120-sample trial. A cohort is unstable when its three-trial FPS range exceeds 20% of the median or its p95 range exceeds 35% of the median. A stable first cohort gates the scenes without a retry. An unstable first cohort is retained in the report but discarded for gating, then exactly one fresh cohort (new page navigation, WebGL context, warmup, and three trials) runs. A stable second cohort gates the scenes using only its three trials; trials are never merged or selected across cohorts. Two unstable cohorts fail before the app is loaded. The report records every cohort, warmup, trial, variance, classification and reason, plus every app trial and partial state on failure before the error is propagated.

Measured with the Three.js calibrator on one cloud VM: three cold audits (Vite dependency cache cleared first) calibrated at 60.0 FPS / 16.7–16.8 ms p95 and passed all seven scenes with Home FPS ratios of 0.972–0.997. Three 2× CDP CPU-throttled audits passed the same normalized gates (Home ratios 0.922–0.957). A 6× throttled audit dropped the calibration itself to 52.2 FPS / 33.4 ms and Home still passed normalized (ratio 0.847, p95 ratio 1.000) — like workloads now degrade together — before the run legitimately failed City destination board's unchanged 0.467 ratio at 0.457; no threshold was loosened to absorb that. An injected seven-frame 40 ms scheduler-jitter burst (40 ms spans two 60 Hz vsync intervals; a 20 ms burst can be absorbed by the compositor without moving `requestAnimationFrame` timestamps) made the first cohort's p95 range 197.6%; the runner discarded it, selected a fresh stable 60.0 FPS / 16.7 ms second cohort, and completed all seven scene measurements. Injecting the burst into both cohorts produced 197.0% and 198.8% p95 ranges, failed before app load, and reported zero scene measurements. A synthetic sustained 30 FPS home scene still fails against a 60 FPS calibration. Hardware renderers retain every previous absolute min-FPS/max-p95 limit. Draw calls, triangles, sample counts, resource limits, and leak limits are unchanged and renderer-independent.

Forced city quality tiers still record 60 samples each and assert pixel ratio, shadows, camera distance, DOM FX density, renderer/DOM labels, and fog behavior for every tier. The sustained 35 FPS governor check still moves high to mid.

## Lifecycle and leak limits

The leak pass first warms all exercised scenes, games, and the purchased cosmetic, then takes a same-scene living-room baseline. Eight cycles run 32 post-baseline transitions across four home zones and eight minigames (mixed DOM-canvas and Stage3D-lease games, each mounted and disposed exactly once per pass), with a cosmetic equip/remove and minigame mount/dispose in every cycle. CDP forces GC before all nine checkpoints.

| Metric | Baseline → final | Slope per cycle | Allowed slope / final / peak growth |
| --- | ---: | ---: | ---: |
| Geometries | 19 → 19 | 0 | 0.25 / 2 / 4 |
| Textures | 3 → 3 | 0 | 0.15 / 1 / 2 |
| Materials | 25 → 25 | 0 | 0.25 / 2 / 4 |
| Programs | 4 → 4 | 0 | 0.15 / 1 / 2 |
| Event listeners | 51 → 52 | 0.067 | 0.5 / 4 / 8 |
| DOM nodes | 1,222 → 715 | -33.5 | 2 / 12 / 30 |
| CDP heap | 21,260,660 → 21,635,952 bytes | 44,381 bytes | 524,288 / 6 MiB / 12 MiB |

The in-app leak heuristic also remains clear after all 32 transitions. Trend tests cover stable noise, persistent slope, final/peak bounds, and minimum-checkpoint rejection.

## Actionable non-owned finding

The home living room now renders 42 draw calls and 13,406 triangles at low quality (19 geometries, 25 materials), so the earlier 105-draw material/geometry sharing finding in `src/scenes/home/**`, `src/gooby/**`, and `src/render/proc/**` has been addressed. The heaviest SwiftShader scenes are now City (destination board ~32 FPS, driving ~37 FPS at low quality with up to 18,750 triangles p95); batching the City building/props draw list is the next highest-value scene-work reduction.
