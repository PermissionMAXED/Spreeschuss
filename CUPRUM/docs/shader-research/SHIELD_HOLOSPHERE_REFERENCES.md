# Shield Sphere & Interior Projection — Shader Research References (CP0C-aligned)

Research/retrieval date: **2026-07-20** (applies to every URL and license claim).
Scope: the U01/U02 Storm Shield dome surface and the **U23 Holosphere Dreamscape
Projector** (lenses = dome-surface skins; cartridges = interior scenes), with the
user-named cartridges *floating astronauts*, *meteor shower*, *shooting stars*,
*taco party*. Companion docs: `docs/RENDERING_NOTES.md`,
`docs/foundation/client-fx.md`, `docs/feature-concepts/SHD.md`,
`docs/expansions/CP0C_HOLOSPHERE.md` (binding spec this document mirrors).

## Binding provenance rule (CP0C)

- **All external visual sources are study-only, regardless of apparent license.**
  No source code, tuned constants, implementation expressions, assets or
  screenshots are copied from any reference — including permissively licensed
  ones. Every shipped shader is an original mathematical implementation; every
  shipped asset is created in this repository. Reference techniques are
  described below **in words only**. This resolves downstream license
  compatibility (the repo is MIT; no third-party code enters the tree, so no
  third-party notice obligations attach).
- Marker vocabulary — **exactly three prefixes**, used on every reference and
  context row; regardless of prefix, every source is study-only:
  - `verified — ...` — used **only** when the license was directly read at the
    authoritative source (the original page/repo itself) on 2026-07-20.
  - `reported — study only; ...` — a license claimed by a mirror, blog or
    downstream attribution, **not** confirmed at the authoritative source;
    reverify there before restating.
  - `unverified — study only; ...` — no license information confirmed.
- Per-shader licenses are never presented as verified unless read from the
  original shader/repo itself. Shadertoy's default license is
  **CC BY-NC-SA 3.0 Unported** when a header states nothing else
  (verified — read at <https://www.shadertoy.com/terms> on 2026-07-20,
  cross-checked against
  <https://creativecommons.org/licenses/by-nc-sa/3.0/legalcode.en>).
- Reference technique columns describe **general techniques and quality traits
  in words only** — no expressions, constants, or source-specific
  iteration/layer/sample/mix quantities. Implementation budgets and counts
  appear only in the original Cuprum design sections.

---

## Reference matrix

All URLs are direct HTTPS links; retrieval date 2026-07-20. Technique columns
describe concepts in words — no expressions or constants from any source.

### A. Effect references (study-only)

| # | Title — Creator | URL | Technique / quality lesson (words only) | License status | Clean-room reimplementation note |
|---|---|---|---|---|---|
| 1 | Star Nest — Kali (Pablo Roman Andrioli) | <https://www.shadertoy.com/view/XlfGRj> | Volumetric starfield from an iterated contractive fold accumulated along a ray, with per-step color weighted by march distance and a tiling fold for infinite repetition; iteration depth controls richness | reported — study only; MIT claim seen only in mirrors, verify authoritative source | Keep only the concept "iterated fold + per-step accumulation"; derive our own fold, jitter and color ramp; clamp steps per tier |
| 2 | Dusty Nebula 4 / Supernova Remnant / Type 2 Supernova — Duke | <https://www.shadertoy.com/view/lsyXDK> (technique survey: T. Sagrista, <https://tonisagrista.com/blog/2024/rendering-aurorae-nebulae/>) | Ray-sphere-bounded raymarch; density from noise-warped radial shell falloff; premultiplied front-to-back accumulation; step size grows with distance; dithered steps hide banding | reported — study only; CC BY-NC-SA 3.0 claim from a third-party blog, verify authoritative source | Re-derive: analytic sphere entry/exit, fixed-step march, our own fractal noise times a shell falloff, emissive ramp keyed to squared density, our own jitter |
| 3 | Plasma Globe — nimitz | <https://www.shadertoy.com/view/XsjXRm> | Volumetric electric tendrils: noise-perturbed paths from core to shell accumulated with a glow that falls off with distance | reported — study only; CC BY-NC-SA 3.0 claim via downstream attribution, verify authoritative source | Replace the volumetric march entirely: CPU-seeded arc splines rendered as ribbon quads with an exponential perpendicular-distance glow — cheaper, deterministic, structurally different |
| 4 | Auroras — nimitz | <https://www.shadertoy.com/view/XtGGRt> | Layered translucent band sampling; each layer displaced by octaves of folded-sawtooth (triangle-wave) noise; averaged and max-blended for silky curtains without volumetric cost | unverified — study only; nimitz shaders often carry bespoke terms | Independent triangle-wave fractal noise and our own layered band march; palette from our accessibility anchors |
| 5 | Hash without Sine — Dave Hoskins | <https://www.shadertoy.com/view/4djSRW> | The widely copied sine-based fractional hash construction degrades on some GPUs; multiply/fract/shuffle hashing without trigonometry is stable across hardware | reported — study only; MIT text seen only in preserved third-party copies, verify at the Shadertoy source | We ship a different construction anyway: integer permuted-congruential/xorshift-style hashing lowered to floats, our own constants; JUnit distribution tests vs the CPU mirror |
| 6 | Tileable Water Caustic — David Hoskins (after joltz0r, GLSL Sandbox) | <https://www.shadertoy.com/view/MdlXz8> | Caustic web from iterated position-fed sine/cosine cross-feedback, then power-curve sharpening; tileable via domain wrapping | unverified — study only; GLSL Sandbox lineage is murky | Alternative original construction with the same look: sharpened inverse of Voronoi-edge distance on a time-warped domain (our own cellular include) |
| 7 | Starfield Shader — Morgan McGuire (Casual Effects) | <https://casual-effects.blogspot.com/2013/08/starfield-shader.html> | Perf discipline: render the expensive procedural background at reduced resolution and upsample bilinearly; budget only a small fraction of frame time for backgrounds | unverified — study only; derivative of #1 | Adopt only the budgeting pattern; Gaussian-falloff star dots on lower tiers instead of the fractal |
| 8 | Creating an Interactive Sci-Fi Shield — Poimandres blog; flow-shield-effect — zihanoo | <https://pmnd.rs/blog/creating-flow-shield/> ; <https://github.com/zihanoo/flow-shield-effect> | Multi-layer shield decomposition: fresnel rim; object-space cube-projected hex grid (no UVs) with seam fade; flow noise; noise dissolve; hit ring buffer with expanding geodesic ripples | unverified — study only; repo advertised as open source but LICENSE not confirmed | We already own the U02 ripple ring buffer (slot budget in `docs/feature-concepts/SHD.md`). Reimplement hexing in spherical axial coordinates (ref #14), removing the seam-fade hack |
| 9 | Energy Shield Hologram — Daniel Ilett | <https://danielilett.com/2023-02-09-tut6-3-energy-shield/> | Hex mask as a brightness gate for all layers; normals derived from a height pattern fake beveled cells; scrolling glow bands | unverified — study only; tutorial code license not confirmed | Procedural hex mask (no texture); bevel derived analytically from hex edge distance |
| 10 | Voronoi edges — Inigo Quilez | <https://iquilezles.org/articles/voronoilines/> | The difference of the two nearest-feature distances is not a true border distance; exact edge distance needs a second pass projecting onto the bisector of the two closest feature points | unverified — study only; article copyrighted, companion shader licenses vary per header | Re-derive the two-pass closest/second-closest search; edge and cell-id helpers in our include, tested against a CPU reference |
| 11 | Smooth Voronoi / Voronoise — Inigo Quilez | <https://iquilezles.org/articles/smoothvoronoi/> ; <https://iquilezles.org/articles/voronoise/> | Replacing the minimum with an exponentially weighted average yields a continuously differentiable cellular field; a two-parameter family morphs between noise and Voronoi | unverified — study only; article copyrighted, companion shader licenses vary per header | Direct math re-derivation with our own hash; drives lens cell shading and party-scene washes |
| 12 | distfunctions / fbm-SDF — Inigo Quilez | <https://iquilezles.org/articles/distfunctions/> ; <https://iquilezles.org/articles/fbmsdf/> | Canonical signed-distance primitives plus smooth boolean operators with distance-correct blending; octave-scaled smooth operators add fractal detail to SDFs | unverified — study only; the formulas are re-derivable geometry | Re-derive each primitive from its geometric definition; unit-test GLSL vs CPU distances |
| 13 | Ray Marching and Signed Distance Functions — Jamie Wong | <https://jamie-wong.com/2016/07/15/ray-marching-signed-distance-functions/> | Sphere-tracing loop structure; normals from the SDF gradient; constructive solid geometry; transforming space by applying inverses to the sample point | unverified — study only; article code license not confirmed | Our own bounded march helper: fixed max steps, distance-scaled epsilon, returns distance and step count for tier clamping |
| 14 | Hexagonal Grids — Amit Patel (Red Blob Games) | <https://www.redblobgames.com/grids/hexagons/> | Axial/cube hex coordinates; matrix conversion between plane and hex space; cube rounding gives exact, stable cell IDs | unverified — study only; sample-code license not confirmed, the math is freely re-derivable | Implement plane-to-hex conversion and rounding by re-derivation; cell ID feeds our hash for flicker/ripple phase |
| 15 | KHR_materials_iridescence (Belcour/Barla model) — Khronos | <https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Khronos/KHR_materials_iridescence/README.md> | Thin-film interference as a modified Fresnel term: the optical path difference grows with film thickness, refractive index and the cosine of the refraction angle; thickness+IOR parametrization; spectral response reduced to RGB | unverified — study only; spec-repo licensing not confirmed for snippet reuse | Implement an RGB cosine-phase approximation ourselves from the physics; thickness modulated by our flow noise |
| 16 | Jump Bubble thin-film shader — EF-Map blog | <https://ef-map.com/blog/jump-bubble-thin-film-shader> | Practical trick: bias the physical interference output partway toward a configurable theme hue so team identity stays readable under iridescence | unverified — study only; blog code license not confirmed | Same idea applied to SHD-06 Hue Prism tints with our own mixing math and our own bias parameter |
| 17 | Curl-Noise for Procedural Fluid Flow — Bridson, Hourihan, Nordenstam (SIGGRAPH 2007) | <https://www.cs.ubc.ca/~rbridson/docs/bridson-siggraph2007-curlnoise.pdf> | Taking the curl of a noise-based potential yields an exactly divergence-free velocity field (no clustering or sinks); derivatives approximated by small finite differences; amplitude modulation respects boundaries | unverified — study only; no authoritative license read for the paper text — the described method is standard vector calculus implemented from the description | CPU finite-difference curl of a vector noise potential drives astronaut/confetti drift; GPU variant in the shared include for T1 wisps |
| 18 | Curl_Noise — kbladin | <https://github.com/kbladin/Curl_Noise> | Worked GPU particle curl pipeline; blends a rotational potential (orbit around an axis) with a noise potential | verified — MIT (GitHub repository license metadata, 2026-07-20); study-only regardless under the binding rule | Structural reference only: our potential = seeded slow orbit around the dome axis plus a noise term, re-implemented in Java for tick-side steering |
| 19 | Meteor/trailing-line rendering notes — minimax-ai shader-dev skill | <https://github.com/minimax-ai/skills/blob/main/skills/shader-dev/reference/particle-system.md> | Stateless streaks: sample points behind the head along the velocity direction; line brightness should fall off exponentially with perpendicular distance scaled by a width parameter (inverse-square falloff washes out line centers); width grows tail-ward; render the head as a separate bright glow | unverified — study only; repository license not confirmed | Our streak fragment: perpendicular distance to a camera-facing ribbon axis with exponential falloff, hue ramp head-to-tail, quadratic tail fade — written from the described math, not the file |
| 20 | Cheap Cloud Flythrough — Shane | <https://www.shadertoy.com/view/Xsc3R4> | Ultra-cheap volumetrics: aggressively reduced march step counts with minimal noise sampling per step, compensated by sharpening in compositing | unverified — study only; assume Shadertoy default CC BY-NC-SA until the header is checked, URL known only from a secondhand citation | Basis for the T1-low nebula approach only; our own step and sample budgets are set in the Cuprum sections; all math our own |

### B. Foundation, platform, accessibility (study-only)

| # | Title — Creator | URL | Lesson | License status |
|---|---|---|---|---|
| 21 | webgl-noise — Ashima Arts / Stefan Gustavson; psrdnoise — Stefan Gustavson | <https://github.com/stegu/webgl-noise> ; <https://github.com/stegu/psrdnoise> | Textureless simplex noise across the common dimensionalities; psrdnoise adds tiling periods, analytic derivatives (near-free curl) and flow rotation | verified — MIT (repository license + README, 2026-07-20); study-only regardless under the binding rule; we re-derive to keep single provenance |
| 22 | The Book of Shaders (random/noise/cellular/fractal chapters) — P. Gonzalez Vivo & J. Lowe; LYGIA — P. Gonzalez Vivo | <https://thebookofshaders.com/> ; <https://github.com/patriciogonzalezvivo/lygia> | Pedagogy for random/noise/cellular/fractal noise; LYGIA demonstrates a clean include taxonomy | unverified — study only; LYGIA additionally reported as non-permissive dual-license — never copy; we imitate only the file organization |
| 23 | Fabric docs (Basic Rendering Concepts; Rendering in the World); NeoForged 1.21.9 primer; yarn `RenderPipeline.Builder` javadoc | <https://docs.fabricmc.net/develop/rendering/world> ; <https://docs.neoforged.net/primer/docs/1.21.9/> ; <https://maven.fabricmc.net/docs/yarn-1.21.9+build.1/com/mojang/blaze3d/pipeline/RenderPipeline.Builder.html> | 1.21.9 extract→submit→draw model; `SubmitNodeCollector`; `RenderPipeline.Builder` surface; `RenderPipelines.register`; buffer-upload patterns | unverified — study only; doc-site licenses not confirmed; API facts re-checked against our own compile probes, not quoted |
| 24 | WCAG 2.3.1 Three Flashes or Below Threshold — W3C; Color Universal Design palette — Okabe & Ito | <https://www.w3.org/WAI/WCAG22/Understanding/three-flashes-or-below-threshold> ; <https://jfly.uni-koeln.de/color/> | At most three general flashes and three saturated-red flashes per second (red is stricter); a CVD-safe palette with distinct luminance steps | unverified — study only; the documents' text licenses not confirmed — the published numeric thresholds and palette values are used as facts/parameters |

Context refs (not counted): Shadertoy Terms <https://www.shadertoy.com/terms>
(verified — default-license terms read at the authoritative source,
2026-07-20); CC BY-NC-SA 3.0 legalcode
<https://creativecommons.org/licenses/by-nc-sa/3.0/legalcode.en> (verified —
license text read at the authoritative source, 2026-07-20); Gamedeveloper.com
"Inexpensive Underwater Caustics Using Cg"
<https://www.gamedeveloper.com/programming/inexpensive-underwater-caustics-using-cg>
(unverified — study only; article license not confirmed).

### License audit summary (2026-07-20)

- `verified —`: Shadertoy default terms; CC BY-NC-SA 3.0 legalcode; #18
  kbladin (MIT); #21 webgl-noise/psrdnoise (MIT). All still study-only under
  the binding rule.
- `reported — study only;` (reverify at the authoritative source before
  restating): #1 Star Nest (MIT claim seen only in mirrors); #2 Duke
  (CC BY-NC-SA 3.0 claim from a blog); #3 Plasma Globe (CC BY-NC-SA 3.0 claim
  via downstream attribution); #5 Hash without Sine (MIT text in preserved
  copies only). #22 LYGIA carries a reported non-permissive dual-license note
  inside its `unverified` row.
- everything else, including #17 (Bridson paper): `unverified — study only;`.
- Irrespective of marker, the binding rule makes every entry study-only; no
  license status changes what may be copied (nothing may).

---

## Cuprum shader library ("Cuprum FX Core") — original design, CP0C-mirrored

### 1. Shared GLSL includes

`assets/cuprum/shaders/include/` (`#moj_import`; build-time inlining is the
contingency, decided by the W1D compile probe): hash (integer
permuted-congruential/xorshift-style, lowered to floats — never sine-based),
noise (re-derived value+simplex, fractal sums, folded-sawtooth octaves), curl
(finite-difference curl of three offset noises), cell (Voronoi
nearest/second-nearest with exact edge distance, smooth Voronoi, axial hex
id/edge), sdf (primitives + smooth operators), ray (analytic ray-sphere
entry/exit + bounded march), film (three-wavelength thin-film approximation
with theme-hue bias), color (Okabe-Ito anchors, tonemap), safety (flash
limiter + red-flash guard), dither (ordered dither + step jitter). Pure
functions, zero uniforms, `cuprum_` prefix. Java mirror `CuprumProceduralMath`
uses bit-identical integer hashing; JUnit vectors compare CPU vs GLSL.

### 2. 1.21.9 extract/submit limitations (accepted)

- No `WorldRenderEvents`; all world drawing via `BlockEntityRenderer`
  extract/submit and `SubmitNodeCollector.submitCustomGeometry` (compile-pinned
  by `RenderApiProbe`); immutable extracted state; no live BE access in draw.
- No frame-grab / refraction / screen-space distortion claims: a BER cannot
  sample the framebuffer; nothing distorts the world seen through the dome.
- Translucency sorting is per-RenderType only ⇒ **all T1 holo content uses
  additive blending exclusively** (order-independent). Honest aesthetic
  consequence: dreamscapes are luminous holograms, never opaque objects.

### 3. Pipelines, RenderTypes, callbacks, batches (frozen inventory)

- **Pipeline resources (exactly 2):** `cuprum:pipeline/holo_surface`
  (übershader for the dome shell; 10 lens variants dispatched by a packed
  variant id in vertex attributes; no-cull, additive, depth test on, depth
  write off) and `cuprum:pipeline/holo_interior` (übershader that
  mode-switches between far-scene content, streak content, and 2.5D/low-poly
  holo content — billboards, alpha slabs, point sprites, ribbon trails;
  additive, depth test on, depth write off; 11 cartridge scenes).
- **RenderTypes (exactly 2 new):** `cuprum:holo_surface` (reserved dome slot)
  and `cuprum:holo_interior` (reserved aurora slot). Census after CP0C:
  ripple, arc, holo_surface, holo_interior = exactly 4 world-FX RenderTypes.
  **WEA-13 (stretch aurora projector) at T1 reuses the `holo_interior`
  far-scene mode on the same reserved aurora slot — never a fifth RenderType.**
- **Submit callbacks: exactly ≤2 per visible projector per frame — one surface
  + one interior.** The interior callback emits **all** far/mid/streak/2.5D
  content of the active cartridge into the one shared `holo_interior`
  buffer/RenderType. (One projector per dome; a duplicate enters FAULT.)
- **Batches/draws are a separate, measured quantity:** the engine batches all
  callbacks sharing a RenderType, so callback count ≠ draw/batch count. CI
  asserts per-projector callback and vertex counters; **W14 measures actual
  batch/draw counts**. No batch-count promises are made here.
- **One active cartridge at a time** (1 lens socket + 1 cartridge socket);
  scenes never run concurrently — no simultaneous taco + meteor. Cartridge
  swaps and the VFX-27 finale acts are **hard transitions on tick boundaries;
  no crossfade** (a crossfade would require two live scenes).

### 4. Parameter delivery — provisional compile-probe contract

Binding baseline: **packed vertex attributes written by the CPU geometry
callback** (the `fx_ripple` pattern) **plus shared immutable extracted
state**. The exact vertex format and attribute packing are a provisional
contract of the W1D compile probe (`FxPipelineProbe`): no custom
`VertexFormat` is assumed, and **every required field — including the built-in
`GameTime` uniform — must be proven by the probe** before any T1 design relies
on it. `RenderPipeline.Builder.withUniform` exists, but **no arbitrary UBO or
per-draw-uniform claim is binding before compile+runtime proof** (evidence
appended to `docs/API_PROBES.md` by W4). All acceptance criteria are
satisfiable on the baseline path alone. The W1D probe makes **no Iris
promise** (see §8).

### 5. Depth & occlusion

- All holo draws: depth test on, depth write off, additive blend — terrain and
  entities occlude shell and interior from both sides; additive commutes, so
  no sort-order dependence.
- Interior far layer = the dome mesh with inverted winding: real geometry with
  depth test on, so blocks/mobs inside the dome naturally occlude the
  projected sky. No stencil/portal tricks. Interior content renders only for
  cameras inside the dome (cheap sphere test); outside viewers see the lens.
- Camera proximity: shell brightness fades via ordered dither near the camera.
- Intersection glow would need a scene-depth read — not claimed; excluded.
- `getViewDistance() = radius + 16`; `shouldRenderOffScreen() = true`.

### 6. Deterministic fxSeed + frozen pause phase model

- **`fxSeed` is a cryptographically random server-generated 64-bit value**
  (secure RNG at placement), **independent of world seed, position and
  time**; persisted in the versioned BE envelope, synced via the BE update
  tag, never re-rolled client-side; survives unload/reload/restart (U23
  process-restart probe). **Tests inject a fixed pinned fxSeed.**
- All deterministic world-space simulation — spawn schedules, illusion
  positions, paths, act timings — is a pure function of
  (BE pos, fxSeed, phase, presets), identical on every client.
  **Camera-dependent shading** (view-angle iridescence, parallax,
  camera-facing billboards) legitimately differs per viewer and is **excluded
  from cross-client equality**.
- **Frozen pause phase model (server-authoritative, persisted, synced):**
  `phaseTicksAccumulated` (long), `phaseStartedAtGameTime` (long),
  `phaseRunning` (bool). Effective phase = `phaseTicksAccumulated` plus, only
  while `phaseRunning`, `(gameTime − phaseStartedAtGameTime)` (+ partialTick).
  Pausing (0 Cg, SHD-11 FLICKER, FAULT) folds the elapsed span into
  `phaseTicksAccumulated` and clears `phaseRunning`; resuming stamps
  `phaseStartedAtGameTime = gameTime` and sets `phaseRunning`. PAUSED scenes
  freeze exactly and resume without skips; joins mid-scene reconstruct state.
- Streak scheduling stays stateless over the phase: fixed-length windows,
  window w spawns iff `hash(fxSeed, w) < density` (our original pseudocode),
  parameters hashed from (fxSeed, w).

### 7. Tiers, nearest-four rule, scenes, budgets

T1→T2→T3→OFF ladder unchanged (single gate `FxTierPolicy.effectiveTier()`;
probe failure or QOL-04 reduced effects ⇒ T2/T3; never crashes). **T1
interiors render only for the 4 nearest visible projectors** — farther
projectors render the surface lens only (counter-asserted per projector; no
batch-count assertion).

| Cartridge (CP0C row) | T1 (inside the interior callback) | T2 | T3 |
|---|---|---|---|
| Astronaut Drift (VFX-11) | 6–12 billboard astronauts on deterministic Lissajous drift with slow tumble + star-dust backwash | astronaut billboards only | single static astronaut badge |
| Meteor Shower (VFX-12) | hash-scheduled streak capsules with exponential-falloff trails (pinned seed: exactly 96 streaks per 1,200-tick window at 100% density, 6-block trails) | streaks as elongated particle bursts | occasional single mote burst |
| Shooting Star (VFX-13) | sparse capsule streaks with twinkle head at 2 Hz (pinned seed: exactly 6 per 1,200 ticks); every chime pairs with a visible streak | spectral particle streak | brief glint flash |
| Taco Party (VFX-14) | 12 procedural taco billboards on parabolic half-gravity bounce arcs + cosine-palette confetti (24 per burst, horn every 400 ticks, synchronized) | confetti as tinted particles, static taco billboards | single taco badge with horn |

Budgets (CI-counter-assertable, per visible R12 projector): one no-cull
additive surface callback ≤4,096 verts; interior total ≤8,192 verts (far dome
+ the single active cartridge's streaks/billboards/ribbons all in the one
interior buffer); **≤2 geometry callbacks**. HOLO particle sub-pool ≤32
spawn/tick and ≤128 live, **carved out of the family-wide `FxParticleBudget`
totals (≤64 spawn/tick, ≤256 live) — not additive to them**. Flash rate
≤3 Hz everywhere (governor clamps faster inputs).

**W14 reference test (`w14_holo_frame_budget`):** R12 dome, 1 lens + 1
cartridge (one scene only — scenes never stack), **maximum shield ripple
state (16 concurrent U02 ripples)**; the Holosphere contribution must be
**≤1.5 ms/frame render thread**. Dedicated-server tick cost of the projector
BE ≤0.05 ms. W14 also records actual batch/draw counts.

### 8. Iris / Sodium posture (W4 U23 supersession)

- Sodium: safe by design — vanilla pipelines/collector, vanilla vertex
  formats, no FRAPI dependence, no raw GL, no chunk-render touch.
- Iris shaderpack active ⇒ `compatCap = T2`; every feature fully degrades to
  vanilla RenderTypes/particles (T2) and static fallback (T3). **The Iris
  active-pack cap is verified as the W4 U23-specific runtime gate** (CP0C
  §6.1): with an active shaderpack, `compatCap = T2` engages and 0
  custom-pipeline submits occur. **This supersedes any earlier generic "prove
  by W4" phrasing; the W1D compile probe cannot and does not promise Iris
  behavior.** The W4 gate runs against the **deterministic dome target**: a
  fixed R12 diagnostic dome with ONE diagnostic surface variant and ONE
  diagnostic interior scene, pinned injected fxSeed, frozen phase — and its
  fixed-pose screenshot must be reproducible across two separate client
  launches on the same world.

### 9. Tests

- **W1D `FxPipelineProbe` compile gate:** both pipeline resources compile and
  pass `precompilePipeline(...).isValid()` on the CI llvmpipe driver,
  including every required packed-attribute field and the built-in `GameTime`
  uniform; two diagnostic variants render distinguishably from one pipeline.
- **Determinism:** recomputing a scene's world-space state twice from one
  (fxSeed, phase fields) snapshot is byte-identical (MC-free unit test);
  a dedicated-server test with two mock connections receives identical BE
  update tags; camera-dependent shading excluded per §6.
- **Screenshot goldens — exact phase setup:** inject the pinned test fxSeed;
  set `phaseRunning = false` at a chosen `phaseTicksAccumulated`; pin the
  camera pose; capture and compare (existing harness, Xvfb, screenshots in
  `build/run/clientGameTest/screenshots/`). Frame-rate and tick-timing
  independent by construction. Scene coverage: `vfx11_astronaut_drift`,
  `vfx12_meteor_rate`, `vfx13_star_cadence`, `vfx14_taco_party`, plus
  lens/surface goldens and grayscale SHD-06 pattern masks (shape-only
  readability; SHD-06 always renders above lenses).
- **Tier ladder:** REDUCED cap ⇒ 0 custom-pipeline submits with T2 visuals
  present; T3 static fallback renders; OFF renders nothing (counter-asserted).
- **Nearest-four:** >4 projectors placed; per-projector counters show interior
  callbacks only from the 4 nearest visible; no batch-count assertion.
- **Particle carve-out:** stress scene holds HOLO ≤32 spawn/tick and ≤128
  live while family totals stay ≤64/256.
- **Flash governor:** a 10 Hz test input is demonstrably clamped to ≤3 Hz.
- **Finale (`vfx27_finale_acts`):** exactly 3 acts of 400 ticks; the active
  cartridge switches at exactly the 400-tick boundaries (hard transitions, no
  crossfade; dispatch/state assertions only); mid-show abort to IDLE ≤20 ticks.
- **Persistence:** U23 process-restart probe proves fxSeed/sockets/program/
  phase fields identical across a real process restart.
- **Perf:** the §7 W14 reference (R12, one lens, one cartridge, 16-ripple max
  shield state) holds ≤1.5 ms/frame; Iris W4 gate per §8.

---

*Read-only research deliverable; no repository code modified. All shipped
shader code will be original; all external sources above are study-only.*
