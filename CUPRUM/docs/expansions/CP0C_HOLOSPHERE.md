# CP0C — HOLOSPHERE EXPANSION SPECIFICATION (binding once reviewed)

Status: **BINDING SPEC, post-W1A**. This document is the single source for the
CP0C catalog expansion from 272 to exactly **300** features: the U23
*Holosphere Dreamscape Projector* user contract plus one new additional family
`VFX-01..27` (`holo_projection`).

## 0. Repository baseline and amendment authority

- **Concrete repository truth:** HEAD is
  `ebd2b2c feat(cuprum): W1A net, state and config foundation`. **W1A is
  implemented, committed, and MUST be preserved.** The working tree
  additionally carries the uncommitted **W1B charge implementation** in
  progress (the `charge` packages, charge gametests, and the W1B extension of
  `scripts/server_restart_probe.sh` — W1B work, not W1A). **CP0C must not
  reset, revert, stash-drop, or otherwise discard any W1A or W1B material**;
  W1B continues on its own track, untouched by this expansion.
- **CP0C is a user-authorized additive amendment landing now, after W1A.**
  The prior catalog freeze ("No catalog or concept-doc change happens in
  W1") is **superseded only for this exact 28-feature CP0C expansion**; it
  remains in force for everything else. The amendment goes through the
  documented reviewed-diff paths (INDEX digest recompute +
  `ConceptParityTest` pin update + `expected_counts.json` + `UserContracts`
  table change — per the `UserContracts` javadoc such a change "must never
  happen silently"; this document is the non-silent record).
- **Compatibility with W1A:** CP0C touches **only** `catalog/**`,
  `docs/feature-concepts/**`, `docs/expansions/**`, `docs/shader-research/**`,
  `src/catalogTool/**`, `src/test/**` (pins), count references in
  `README.md`/`AGENTS.md`, and two U23-scoped line amendments in
  `docs/foundation/FOUNDATION_PLAN.md` (§7.8: D10 Iris timing; CP1-exit
  digest baseline CP0B → CP0C). Zero gameplay/runtime code; no file created or
  modified by W1A (`net`, `state`, `ownership`, `perm`, `config` packages) or
  by the in-progress W1B (`charge` packages) is edited. **CP0C does not touch
  `docs/API_PROBES.md`** — probe evidence is appended by W4 after the probes
  actually run, never speculatively. Both spec documents — this file and the
  research ledger `docs/shader-research/SHIELD_HOLOSPHERE_REFERENCES.md` —
  are in CP0C commit scope. The gameplay-content firewall stands: **no
  VFX/U23 implementation before its assigned wave**.

## 1. Exact accounting (adopted without reinterpretation)

| | CP0B | Delta | CP0C |
|---|---|---|---|
| User contracts | 22 (U01–U22) | +1 (U23, seq 273) | **23** |
| Additional core | 202 | +20 (VFX core) | **222** |
| Additional stretch | 48 | +7 (VFX stretch) | **55** |
| Additional total | 250 | +27 (VFX-01..27, seq 274–300) | **277** |
| **Total** | **272** | **+28** | **300 = 23 + 277** |

Proof: 272 + 1 + 27 = 300; 23 + 222 + 55 = 300; prior 202/48 preserved
byte-identically (all 250 existing concept rows unchanged; the INDEX digest
changes only by appending 27 rows and updating the documented formula).

**Sequence decision (binding):** U23 = sequence 273, VFX-01..27 = 274–300.
Every VFX row references U23, and referenced ids must be *earlier in global
sequence*, so U23 precedes the family. `catalog.json` stays contiguous
1..300 in file order (U23 at file position 273), so `CatalogValidator`'s
sequence rule and its "user ids contiguous and ordered U01..Un" rule pass
unchanged; all 250 existing rows stay untouched. Renumbering U23 to
sequence 23 (shifting 250 entries) was evaluated and **rejected** as
high-churn/high-risk for zero semantic gain.

**Required tooling changes (current tooling does NOT yet accept this shape;
part of CP0C):**

- `ConceptParity`/`ConceptIndex` family, checklist, and row-quality sequence
  logic must **consume the explicit sequences parsed from the INDEX family
  row and checklist rows** instead of assuming a contiguous additional
  range: the additional checklist becomes 277 rows over sequences 23–272 and
  274–300 with a hole at 273.
- A checklist hole is legal **only when the missing sequence is occupied by
  a catalog user entry** (here U23); any other hole stays an error.
- The parity sequence and tier maps must be built from **all catalog entries
  including U23**, so acceptance references to U23 resolve, its sequence
  ordering is enforced, and tier checks (no core→stretch) see user entries.
- New mutation tests: (a) a checklist hole whose sequence is NOT occupied by
  a catalog user entry must fail validation; (b) a forward user dependency —
  an additional row whose acceptance/deps reference a user id with a *later*
  global sequence — must fail validation.

`catalog/expected_counts.json` becomes:
`{"user": 23, "additional_core": 222, "additional_stretch": 55}`.

## 2. U23 — Holosphere Dreamscape Projector (binding user contract)

`UserContracts.java` appends exactly:
`("U23", "holosphere_dreamscape_projector", "Holosphere Dreamscape Projector", "shield")`.

Catalog entry (catalog-ready):

```json
{
  "id": "U23", "sequence": 273, "origin": "user", "family": "shield",
  "name": "Holosphere Dreamscape Projector", "type": "block", "tier": "core",
  "progression_tier": 2, "deps": ["U01", "U05"],
  "vanilla_overlap": "none: vanilla 1.21.9 has no interior-world projection; nearest unrelated analogues are the End-sky panorama and DEC-13's floating signage (text glyphs, not worlds)",
  "summary": "Configurable projector block that mounts to an active U01 Storm Shield and projects purely cosmetic visual worlds inside the dome (dreamscape cartridges) and shader skins onto the dome surface (lenses); charge-fed, owner-configured, deterministic client-side illusions with zero gameplay effect.",
  "planned_wave": "W4", "contract_key": "holosphere_dreamscape_projector"
}
```

### 2.1 Contract clauses

- **Placement / active-shield requirement:** placeable only inside the dome
  radius, ≤16 blocks from the U01 controller; links on placement (SHD-06
  pylon-attachment precedent). **Deterministic link target with overlapping
  domes (SHD-10) — single normative comparator:** the server selects the
  eligible U01 controller with the **smallest squared Euclidean distance**
  to the projector; on an exact distance tie it selects the controller with
  the smaller **signed lexicographic coordinate triple, comparing x first,
  then y, then z** (each compared as a signed integer). This comparator is
  authoritative for both auto-link on placement and relink. The chosen
  controller pos is persisted in the BE envelope; the owner relinks only
  through the validated `cuprum:c2s/holo/relink` payload (§2.2). Exactly
  **1 projector per linked controller**; a second projector linking to the
  same controller enters FAULT `DUPLICATE` within 40 ticks — duplicate
  faults are evaluated per linked controller, so overlapping domes may each
  host their own projector. Projects only while dome state = ACTIVE; SHD-11
  heat FLICKER or controller FAULT suspends projection within 20 ticks;
  state PAUSED persists and resumes per the phase clause below. U17 /
  SHD-09 (personal/micro domes) are out of scope for v1.
- **Acquisition:** crafted in survival from 4 copper blocks + 2 amethyst
  shards + 1 glass + 1 Leyden jar (U05); recipe advancement + handbook page;
  first successful projection grants advancement `cuprum:dreams/first_light`.
- **Cg usage** (section `holo` in `cuprum-common.json5`): base upkeep
  `ceil(0.125 × dome base upkeep)` Cg/t = 4/9/16/36 at R8/12/16/24; +2 Cg/t
  per active lens; +4 Cg/t per active cartridge (R8 + both = 10 Cg/t, a
  storage-fed luxury). 0 Cg ⇒ PAUSED; resumes on power.
- **Settings UI:** menu with 1 lens socket + 1 cartridge socket. **At any
  tick, at most ONE lens and ONE cartridge are active per projector** —
  VFX-22's 8-slot playlist and VFX-27's shows only rotate *which single*
  cartridge is active; scenes never run concurrently (no simultaneous taco
  party + meteor shower) and switches happen at exact boundaries with no
  overlap or crossfade. Parameters are **quantized presets only** (density
  25/50/75/100%, speed ×0.5/×1/×2, palette id 0–15) carried as registered
  item **data components** — no free-form floats on the wire.
- **Security / ownership:** every C2S write runs the full guard order
  (liveness → rate → range → menu → ownership → state → value validation,
  reject-never-clamp) under permission node `cuprum.holo.configure`
  (owner/OP fallback). The complete typed payload ledger is §2.2. No C2S
  ever originates from render code.
- **Server sync:** durable state (active, lensId, cartridgeId, paramsPacked,
  `fxSeed`, controller pos, phase fields) rides the **BE update tag**
  (idempotent, join-safe); change broadcast `cuprum:s2c/holo/state`
  coalesced ≤4/s to tracking players. **`fxSeed` is 64 random bits generated
  by the server at placement with a cryptographically secure RNG
  (`SecureRandom`), independent of the world seed, block position, and
  time** — persisted and synced unchanged, never re-rolled client-side.
  Deterministic tests **inject a fixed test seed** rather than relying on
  any derivation. The server never knows client tiers (outcome neutrality).
- **Pause/resume phase (no phase jump):** animation **freezes while
  PAUSED**. The BE persists `phaseTicksAccumulated`,
  `phaseStartedAtGameTime`, and `phaseRunning`. Effective phase =
  `phaseTicksAccumulated + (phaseRunning ? gameTime −
  phaseStartedAtGameTime : 0)`. On pause: `phaseTicksAccumulated +=
  gameTime − phaseStartedAtGameTime; phaseRunning = false`. On resume:
  `phaseStartedAtGameTime = gameTime; phaseRunning = true`. Because
  `phaseTicksAccumulated` is absolute and persisted, unload/reload and
  server restart continue the animation exactly where it stopped — no phase
  jump, ever.
- **Client-only illusions:** astronauts, meteors, tacos, koi are **render
  state only — never `Entity` objects**: no hitboxes, no AI, no per-entity
  sync, zero server tick cost, 0 items/0 saturation from any interaction.
- **Two-client agreement (scoped precisely):** all **deterministic
  world-space simulation** — spawn schedules, entity-illusion positions,
  paths, act timings — is a **pure function of (BE pos, fxSeed, effective
  phase, presets)** and is identical on every client. **Camera-dependent
  shading** — view-angle iridescence, parallax displacement, camera-facing
  billboards — legitimately differs per viewer and is excluded from
  cross-client equality. Proof gates: (a) MC-free determinism tests —
  recomputing a scene's world-space state from one snapshot twice is
  byte-identical; (b) a dedicated-server test with two mock connections
  asserting both receive identical BE update tags; (c) the two-launch
  screenshot gate (§6.1): both launches **inject the same explicit test-only
  fxSeed and phase tick with the projector frozen in PAUSED state** (so the
  simulation phase is pinned), use the identical camera pose, and must
  produce matching fixed-pose screenshots.
- **Persistence:** socketed ItemStacks + program + `fxSeed` + controller pos
  + the three phase fields in the versioned `cuprum_state` BE envelope;
  survives unload/reload/restart, proven by a dedicated U23 process-restart
  probe (§8) extending the `scripts/server_restart_probe.sh` pattern.
- **Accessibility:** QOL-04 reduced effects forces T2/T3 (outcome-neutral);
  hard **≤3 Hz flash cap** on all holo content via the code-enforced
  flash-cap governor; colorblind remap via `fx/colorblind.json`; SHD-06
  status patterns always render at higher priority than lenses; client
  options `holoMotionScale 0..1` and `hideHoloProjections` (any viewer can
  locally disable projections — trivial because illusions are client-side).
- **Combination rules:** SHD-02/03 modulator tints compose under the lens;
  SHD-05 window gaps do not interrupt (illusions are not physical); with
  SHD-10 overlaps each projector fills only its own dome volume; interior
  content renders only for cameras inside the dome (cheap sphere test) —
  outside viewers see the surface lens only (perf + PvP fairness).
- **Failure / fallback / perf:** single gate `FxTierPolicy.effectiveTier()`
  (FX foundation contract): T1 custom pipelines → T2 vanilla RenderTypes +
  particles → T3 static badge/mote burst → OFF; capability-probe failure or
  Iris active-shaderpack cap ⇒ T2. **The Iris active-pack cap is verified as
  a W4 U23 runtime gate (§6.1)** — the W1D compile probe cannot and does not
  promise it. Budgets in §3.

### 2.2 Typed C2S payload ledger (complete; all custom-GUI Holosphere writes)

All payloads use **bounded structured fields** (`StreamCodec` enums,
range-checked ints, one exact `BlockPos`, length-capped byte arrays; no free
NBT, no ItemStacks C2S). **Payloads never carry lens/cartridge/item content
ids.** Socketing/loading lenses, cartridges, and deck/table/sequencer slots
uses **vanilla server-authoritative container handling plus
recipes/unlocks**; the server derives every active lens, cartridge, and slot
id from that authoritative inventory, rejecting empty, wrong-type, or
locked/unrecipe-gated slots. `holo/config` selects only bounded *settings*
(density, speed, palette, active-slot index) and can never inject a content
id. The **slate is the single bounded bitmap/text exception**, validated per
the rules below. Every payload runs the §2.1 guard order with the checks
listed; violation ⇒ reject (never clamp), disconnect on malformed codec,
`0` state changes.

**VFX-24 Chromatic Tuner uses NO custom payload and no open-menu
requirement:** palette cycling rides the server-authoritative **vanilla
item `useOn` path**; shared guard logic still validates ≤8-block range,
ownership, projector state, held tuner item, and a **5-tick per-player
cooldown**. Custom-GUI writes are exactly the seven payloads below (the six
tabulated plus `cuprum:c2s/holo/link`).

| Payload id | Sender UI | Max bytes | Rate | Checks (beyond liveness/rate) |
|---|---|---|---|---|
| `cuprum:c2s/holo/config` | U23 projector menu | 64 | 4/s | ≤8-block range, open U23 menu, owner/OP, dome linked; **bounded setting enums/values only (density/speed/palette/active-slot index) — never lens/cartridge ids** |
| `cuprum:c2s/holo/relink` | U23 projector menu | 32 | 1/s | exact target `BlockPos`; current-projector ≤8-block range/open menu/owner/state; **target is a loaded, active, eligible U01 controller of the same owner-or-team, projector inside its radius, ≤16 blocks, no duplicate on that controller; persist only after all pass** |
| `cuprum:c2s/holo/deck` | VFX-22 deck menu | 64 | 4/s | ≤8-block range, open deck menu, owner/OP, deck linked to projector, slot index 0–7, timer enum; active cartridge derived from deck inventory |
| `cuprum:c2s/holo/preset` | VFX-23 table menu | 64 | 4/s | ≤8-block range, open table menu, owner/OP, cartridge present in the authoritative table slot, density/speed/palette enum-valid |
| `cuprum:c2s/holo/slate` | VFX-26 slate editor (at VFX-23) | 256 | 1/s | ≤8-block range, open editor menu, owner/OP, bitmap exactly ≤128 bytes (16×16 4-bit), title constraints below |
| `cuprum:c2s/holo/show` | VFX-27 sequencer menu | 128 | 2/s | ≤8-block range, open sequencer menu, owner/OP, deck linked, act count = 3, act slot indices 0–7 resolved against deck inventory |

`cuprum:c2s/holo/link` (VFX-25 beacon) is folded into `relink` semantics for
cross-dome pairing: 96 B, 2/s, both endpoints owner/OP-or-team, target ≤64
blocks and a loaded active projector.

**Slate content rules (binding):** bitmap max **128 bytes**; title max **32
Unicode scalar values AND max 64 UTF-8 bytes**, NFC-normalized server-side.
Reject **every code point with the Unicode binary property
`Bidi_Control=Yes`** — explicitly U+061C (ALM), U+200E–U+200F (LRM/RLM),
U+202A–U+202E (LRE/RLE/PDF/LRO/RLO), and U+2066–U+2069 (LRI/RLI/FSI/PDI) —
plus all control characters (general categories `Cc`/`Cf`) and Unicode
noncharacters. The title/bitmap are **opaque display data only** — never
parsed as GLSL, URLs, resource ids, or asset references, and never
interpolated into shader source or identifiers.

## 3. Frozen shader inventory (exact; 1.21.9-honest)

The FX foundation budget allows **≤4 distinct Cuprum world-FX RenderTypes
ever**, with dome and aurora slots reserved alongside ripple and arc. CP0C
freezes the holosphere inventory to exactly those reserved slots — anything
beyond it requires a reviewed budget amendment:

1. **Surface pass** — `RenderPipeline` resource id
   **`cuprum:pipeline/holo_surface`**, exposed through RenderType
   **`cuprum:holo_surface`**, consuming the reserved **dome** slot. One
   übershader; fragment dispatch over a packed **variant id carried in
   vertex attributes** (COLOR/UV channels); **10 lens variants**
   (VFX-01..10).
2. **Interior pass** — `RenderPipeline` resource id
   **`cuprum:pipeline/holo_interior`**, exposed through RenderType
   **`cuprum:holo_interior`**, consuming the reserved **aurora** slot. One
   übershader that **mode-switches between far-scene content
   (starfields/nebulae/sky shells), streak content (meteors/shooting
   stars/trails), and 2.5D/low-poly holo content (billboards, alpha slabs,
   point sprites, ribbon trails)**; additive blending; **11 cartridge
   scenes** (VFX-11..21).
3. **Shared original include library** `assets/cuprum/shaders/include/
   cuprum_noise.glsl` (`#moj_import`): hash/fbm/Voronoi/curl/palette — 100%
   original implementations (see §4).
4. **6 support systems** (VFX-22..27) add **zero** pipelines: they only drive
   state consumed by the two passes.

RenderType census after CP0C waves: ripple, arc (stub), holo_surface (dome
slot), holo_interior (aurora slot) = **exactly 4 world-FX RenderTypes total**.
**No 27 pipelines.** **WEA-13 (stretch aurora projector) at T1 reuses the
`holo_interior` far-scene mode on the same reserved aurora slot — it never
registers a fifth RenderType.**

**Geometry callbacks (never to be called batches or draws):** each visible
projector submits **exactly ≤2 per-projector geometry callbacks** per frame
via `submitCustomGeometry` — **one surface callback and one interior
callback, total**. The single interior callback emits all far-scene, mid
(2.5D/low-poly), and streak components **into the one shared
`cuprum:holo_interior` RenderType/vertex buffer**; there is never a
per-component or per-scene callback. Because only one lens and one cartridge
are active per projector (§2.1), a callback never mixes scenes. The engine
groups submissions per RenderType downstream, so callback counts are a CPU-
side CI counter, while **actual draw batches are measured only by the W14
harness**. All Holosphere blending is **additive only**.

Hard honesty limits (verified against `docs/RENDERING_NOTES.md`,
`docs/API_PROBES.md`, pinned 1.21.9 sources):

- World rendering is extract → submit only (`BlockEntityRenderer` +
  `SubmitNodeCollector.submitCustomGeometry`); `WorldRenderEvents` does not
  exist; no mutable GL state.
- **No frame-grab / refraction / screen-space distortion claims.** A BER
  cannot sample the framebuffer; nothing here distorts the world seen
  through the dome; post-effect chains stay reserved for flash-scale
  screen flashes.
- **Parameter delivery is provisional until the W1D compile probe
  (`FxPipelineProbe` in the research ledger).** The binding baseline
  fallback is **packed vertex attributes written by the CPU geometry
  callback (the `fx_ripple` pattern) plus shared immutable extracted
  state**. The exact vertex format and attribute packing are a
  **provisional compile-probe contract**: no custom `VertexFormat` is
  assumed, and **every required field — including the built-in `GameTime`
  uniform — must be proven by the probe** before any row's T1 design relies
  on it. `RenderPipeline.Builder.withUniform` exists, but **no arbitrary UBO
  or per-draw-uniform claim is binding before proof**: any uniform-block
  usage requires the compile+runtime probe to pass, with the evidence
  appended to `docs/API_PROBES.md` by W4 (CP0C itself does not touch that
  file). All acceptance criteria in this spec are satisfiable on the
  baseline path alone. **The Iris active-pack cap is a W4 U23 runtime gate;
  the W1D compile probe makes no Iris promise.**
- Translucency sorting is per-RenderType ⇒ all T1 holo content uses
  **additive blending** (order-independent). Honest aesthetic consequence:
  dreamscapes are luminous holograms, never opaque objects.
- Iris shaderpack active ⇒ `compatCap = T2`; every feature fully degrades to
  vanilla RenderTypes/particles (T2) and static fallback (T3).
  **FOUNDATION_PLAN D10 amendment (U23-scoped only):** D10 defers the Iris
  reflection query in `FxCompat` to W12; CP0C supersedes that **for U23
  only** — the Iris active-pack soft-dependency/probe lands in W4 as a U23
  gate. Generic W1D `FxCompat` stays as planned (`isModLoaded` logging
  only). The exact D10 line update is in CP0C scope (§7.8).
- Budgets (CI-counter-assertable, **per visible R12 projector**, always with
  **one lens + one active cartridge only**): one no-cull additive surface
  callback ≤4,096 verts; one interior callback ≤8,192 verts; **≤2 geometry
  callbacks total**. **T1 interiors render only for the 4 nearest visible
  projectors** — farther projectors render the surface lens only. HOLO
  particle sub-pool ≤32 spawn/tick, ≤128 live, **carved out of the existing
  family-wide `FxParticleBudget` totals (≤64 spawn/tick, ≤256 live) — NOT
  additive to them**. **W14 reference scene** = one R12 projector + one lens
  + one cartridge **with the existing maximum shield ripple state active**;
  the **Holosphere contribution** must stay ≤1.5 ms/frame render thread,
  gated by `w14_holo_frame_budget`; flash rate ≤3 Hz everywhere, enforced by
  the flash-cap governor.

## 4. Clean-room license rule + reference research matrix

**Binding clean-room rule:** the repo is MIT. Shadertoy's default license is
**CC BY-NC-SA 3.0** (verified at <https://www.shadertoy.com/terms>);
**copying, porting, or translating such code (even "optimized"), or copying
tuned constants, assets, or screenshots, is a derivative work and is
forbidden.** All references are **technique/math study only**; every
shipped GLSL/Java line must be an original implementation — even from
permissive sources, for single provenance. Study citations live in the
research ledger and shipped source headers. **No external shader source is
reproduced in this document or in any concept doc.**

**The single reference matrix is the research ledger:
`docs/shader-research/SHIELD_HOLOSPHERE_REFERENCES.md` (binding pointer; not
duplicated here).** It records per reference a direct HTTPS URL, the
creator, a clean-room reimplementation note, and a license posture drawn
from the three marker labels **`verified`, `reported`, and `unverified`**,
whose exact strings and meanings are defined verbatim by that ledger (this
document does not restate or paraphrase the marker text). No reference —
including any carrying a `reported` posture — may be treated as
permissively licensed without direct live-header verification, and all
references remain study-only regardless. Re-verify every posture at
implementation time (authors can override Shadertoy's default). Primary API
truth remains the pinned local sources (`.gradle/loom-cache/**-sources.jar`,
`docs/API_PROBES.md`, `docs/RENDERING_NOTES.md`).

## 5. Family VFX — Holosphere Visuals & Dreamscape Cartridges (`holo_projection`)

Global sequence 274–300 · 27 features (**20 core / 7 stretch**) · core wave
W13, stretch W15 · catalog family string: `holo_projection` · split:
**10 lens items + 11 cartridge scene items + 6 support systems** (3 core
blocks/tools: VFX-22/23/24; 3 stretch: VFX-25/26/27).

Every entry is an **independently acquired, player-facing feature** — an item
or block with its own survival acquisition loop (recipe, mob drop, structure
loot, trade, milestone unlock, or fishing), its own **per-feature acquisition
advancement** `cuprum:dreams/vfx_NN` granted exactly once on first obtain
(craft, pickup, trade, or unlock — asserted in every row's acceptance), its
own handbook page (`handbook.cuprum.vfx_*`, EN/DE parity), and a distinct
runtime behavior. None is a mere preset of another.

**Balance constants:** lens +2 Cg/t, cartridge +4 Cg/t on U23 upkeep (base
4/9/16/36 at R8/12/16/24); blank cartridge = 4 copper ingots + 2 glass +
1 redstone + 1 amethyst shard; lens blank = cast at an OXI-15 lens mold from
2 copper ingots + 1 glass; presets quantized (4 density, 3 speed, 16 palettes)
stored as data components.
**Performance budget:** exactly 2 RenderTypes family-wide (dome + aurora
slots); per visible R12 projector (one lens + one active cartridge only,
never concurrent scenes): one no-cull additive surface callback ≤4,096
verts + one interior callback ≤8,192 verts, ≤2 geometry callbacks total; T1
interiors only for the 4 nearest visible projectors; HOLO particles ≤32
spawn/tick, ≤128 live, carved from the existing 64/256 family totals; W14
reference (one R12 projector + one lens + one cartridge + existing max
shield ripple state) with Holosphere contribution ≤1.5 ms/frame; flash rate
≤3 Hz via the governor; W14 gate `w14_holo_frame_budget` measures actual
batch/draw counts.
**Security/ownership contract:** every custom-GUI write uses a §2.2 typed
payload (per-payload byte/rate caps, range/menu/ownership/state checks,
bounded fields) carrying only bounded settings/indices and an exact relink
`BlockPos` — **never lens/cartridge/item content ids; the server derives all
active content from authoritative container inventory, rejecting
empty/wrong/locked slots.** VFX-24 cycles palettes through the guarded
vanilla `useOn` path (no payload); VFX-26 bitmap ≤128 bytes + title ≤32
scalar values and ≤64 UTF-8 bytes (NFC; every `Bidi_Control=Yes` code
point, control, and noncharacter rejected; opaque display data only),
owner-only; no C2S from render code.
**Persistence contract:** sockets/programs/presets/`fxSeed`/controller
pos/phase fields (`phaseTicksAccumulated`, `phaseStartedAtGameTime`,
`phaseRunning`) in the versioned BE envelope and item data components;
identical after serialization round-trip and after the U23-level
process-restart probe (§8); animation freezes while PAUSED and resumes with
no phase jump.
**Accessibility:** QOL-04 forces T2/T3 outcome-neutrally; SHD-06 patterns
outrank lenses; colorblind remap + shape-coded UI; per-viewer local hide.
**Cross-family interfaces:** acquisition consumes OXI-01/02/15/16, WEA-06,
TOOL-16, GEN-04 loot, MOB-01/04/06/08/09 drops/trades, ADV-02 unlocks,
GOL-01/03/09, PWR-15, DEC-11, SHD-10 — all core, all earlier-sequence; no
forward deps; no core→stretch deps.

### 5.1 Catalog-ready 27-row table (strict concept format, 12 fields)

| ID | Name | Type | Tier | Prog | Wave | Deps | Vanilla overlap | Player behavior | Visual signature | Acceptance | Test |
|---|---|---|---|---|---|---|---|---|---|---|---|
| VFX-01 | Prismatic Interference Lens | item | core | 2 | W13 | U23, OXI-15 | adjacent: SHD-06 is a live shape-coded shield-status display; this is a decorative view-dependent skin with no status meaning | Cast a lens blank at an OXI-15 lens mold, then finish it with 2 amethyst shards; socketed into U23 the dome shell becomes an iridescent soap-film whose hue shifts with the viewer's angle (camera-dependent shading by design). | T1: Fresnel-weighted cosine-palette thin-film interference in `holo_surface` (T2: 8-frame animated tint texture; T3: static pearl tint) | Casting 1 blank + 2 amethyst shards yields exactly 1 lens and the acquisition advancement fires exactly once; socketed, U23 upkeep rises by exactly 2 Cg/t; screenshots from 2 camera yaws 90 degrees apart differ by ≥3% of sampled pixels while same-pose consecutive frames differ by ≤0.5%. | client_gametest:vfx01_interference_angle |
| VFX-02 | Plasma Veil Lens | item | core | 2 | W13 | U23, OXI-15, WEA-06 | adjacent: DEC-05 arc lamps glow statically; this animates the whole shell | Fuse an OXI-15-cast lens blank with a WEA-06 fulgurite shard — lightning-born glass carries the plasma; slow-breathing demoscene plasma rolls across the shell. | T1: 4-octave sine-sum plasma with domain warp (T2: 2-layer scrolling plasma texture; T3: static gradient tint) | Crafting 1 blank + 1 WEA-06 fulgurite shard yields exactly 1 lens and the acquisition advancement fires exactly once; plasma phase loops with period exactly 400 ticks (on the fixed north camera axis, frames at t and t+400 differ by ≤0.5% of sampled pixels); switching the cap to REDUCED yields 0 custom-pipeline submits; upkeep +2 Cg/t. | client_gametest:vfx02_plasma_loop |
| VFX-03 | Stained-Glass Cell Lens | item | core | 2 | W13 | U23, OXI-15, TOOL-16 | adjacent: vanilla stained glass tints flat blocks; this leads glowing panes across a curved dome | Chisel-cut with TOOL-16: an OXI-15-cast blank plus 4 stained-glass panes becomes a cathedral lens; the dome shows glowing Voronoi panes with dark leading between cells. | T1: Voronoi cell shading with distance-to-border leading (T2: static cell-pattern texture band; T3: plain tint with border sparks) | Chiseling 1 blank with TOOL-16 plus 4 stained-glass panes yields exactly 1 lens and the acquisition advancement fires exactly once; at 100% density the visible hemisphere shows 48 ±8 cells at fixed pose; leading width steps across all 4 density settings; upkeep +2 Cg/t. | client_gametest:vfx03_voronoi_cells |
| VFX-04 | Caustic Tide Lens | item | core | 2 | W13 | U23, OXI-15 | adjacent: the vanilla conduit aura is a small static swirl; this plays moving caustic webs over the shell | Craft an OXI-15-cast blank with 4 prismarine crystals (ocean-monument diving loop); rippling underwater caustic light plays over the shell as if the base sat under a sunlit sea. | T1: two counter-scrolling gradient-noise layers multiplied into caustic webs (T2: 8-frame caustic scroll texture; T3: static blue tint) | Crafting 1 blank + 4 prismarine crystals yields exactly 1 lens and the acquisition advancement fires exactly once; the caustic loop period is exactly 200 ticks; the two layers scroll in opposite directions (cross-correlation sign check over 40 ticks); upkeep +2 Cg/t. | client_gametest:vfx04_caustic_scroll |
| VFX-05 | Ember Storm Lens | item | core | 2 | W13 | U23, OXI-15 | adjacent: campfire/fire visuals are block-local and real; this crowns the dome in silent cosmetic flame | Craft an OXI-15-cast blank with 1 blaze powder + 1 magma cream (Nether loop); ridged-noise fire licks upward from the dome equator. | T1: ridged fbm advected vertically with palette ramp (T2: rising ember particles at 25% + tint; T3: warm static tint) | Crafting 1 blank + 1 blaze powder + 1 magma cream yields exactly 1 lens and the acquisition advancement fires exactly once; flame features advect upward with a 10 ±2 tick lag per block of height; emissive flicker stays ≤3 Hz; upkeep +2 Cg/t. | client_gametest:vfx05_ember_advect |
| VFX-06 | Aurora Curtain Lens | item | core | 2 | W13 | U23, GEN-04 | adjacent: WEA-13 (stretch) projects sky auroras over an area; this shades only the dome shell and ships independently of it | Found: GEN-04 Stormwatch Spire chests hold this lens — a summit-expedition reward; green-violet curtains drape the upper shell. | T1: 3 layered curtain bands via flow-noise phase offsets (T2: 3 scrolling band textures; T3: static gradient crown) | With the pinned test loot seed, 20 GEN-04 spire chest rolls yield exactly 6 lenses (30% weight) and first pickup fires the acquisition advancement exactly once; exactly 3 curtain bands render at 100% density and 2 at 50%; sway period 600 ticks; only the top 60% of the shell is modified; upkeep +2 Cg/t. | client_gametest:vfx06_aurora_bands |
| VFX-07 | Circuit Trace Lens | item | core | 2 | W13 | U23, OXI-15, OXI-16 | adjacent: PWR-01 bus-bar glow is informational load readout; this is decorative circuitry with no data meaning | Craft an OXI-15-cast blank with 1 OXI-16 conductive paste + 2 redstone; the dome becomes a living copper motherboard with light pulses running etched traces to the apex. | T1: hash-grid maze traces with distance-field glow pulses (T2: static trace texture with 4-frame pulse; T3: grid tint) | Crafting 1 blank + 1 OXI-16 paste + 2 redstone yields exactly 1 lens and the acquisition advancement fires exactly once; pulses travel exactly 1 block per 2 ticks along traces; the trace layout is deterministic per projector fxSeed (a serialization round-trip yields an identical layout); upkeep +2 Cg/t. | client_gametest:vfx07_trace_pulse |
| VFX-08 | Kaleido Mandala Lens | item | core | 2 | W13 | U23, OXI-15, MOB-06 | none: no vanilla or Cuprum feature folds patterns kaleidoscopically | Craft an OXI-15-cast blank with 1 iridescent plume dropped by MOB-06 copper peacocks (husbandry loop); polar-folded mandalas bloom from the apex and rotate meditatively. | T1: 8-fold angular domain fold of warped fbm around the apex axis (T2: rotating 8-fold mandala texture; T3: static mandala decal at the apex) | Crafting 1 blank + 1 MOB-06 plume yields exactly 1 lens and the acquisition advancement fires exactly once; the pattern has exact 8-fold rotational symmetry (a 45-degree-rotated screenshot differs by ≤1% of sampled pixels on the fixed north camera axis); full rotation period 1,200 ticks; upkeep +2 Cg/t. | client_gametest:vfx08_kaleido_fold |
| VFX-09 | Glitch Static Lens | item | stretch | 2 | W15 | U23, MOB-09 | adjacent: the enderman screen-static jumpscare is uncapped and hostile; this is owned decor hard-capped at 3 Hz | Dropped by MOB-09 rogue units — salvage their corrupted optics; the dome flickers like a failing hologram with block dropouts, scanlines and chroma tears. | T1: time-quantized hash block displacement + scanline + RGB channel offset (T2: 4-frame static-noise texture; T3: plain tint, no motion) | With the pinned test loot seed, 64 MOB-09 kill rolls yield exactly 8 lenses (12.5% weight) and first pickup fires the acquisition advancement exactly once; glitch steps are quantized to ≥7 ticks at 20 TPS (≤2.9 Hz) and the flash-cap governor keeps measured flash rate ≤3 Hz over a 200-tick sample; channel offset never exceeds 0.2 blocks; upkeep +2 Cg/t. | client_gametest:vfx09_glitch_cap |
| VFX-10 | Moiré Resonance Lens | item | stretch | 3 | W15 | U23, OXI-15, SHD-10 | adjacent: SHD-10 produces an emergent moiré seam where two domes overlap; this deliberately synthesizes the look on one dome | Craft 2 OXI-15-cast lens blanks together on top of an SHD-10 anchor plate (endgame anchor loop); two rotating line lattices interfere into hypnotic moiré blooms. | T1: two line gratings at slowly diverging angles multiplied into interference (T2: precomputed 8-frame moiré sequence; T3: static line grid) | Crafting 2 blanks at an SHD-10 anchor yields exactly 1 lens and the acquisition advancement fires exactly once; the grating angular divergence cycles in exactly 400 ticks; bloom count at peak divergence is 6 ±1 in the sampled band; upkeep +2 Cg/t. | client_gametest:vfx10_moire_cycle |
| VFX-11 | Astronaut Drift Cartridge | item | core | 2 | W13 | U23 | none: armor stands are static real objects; these are weightless deterministic illusions | Craft the first blank cartridge (4 copper + 2 glass + 1 redstone + 1 amethyst), then blank + 1 ender pearl + 1 feather = this cartridge; weightless astronauts tumble through the dome on looping drift paths. | T1: 6–12 billboard astronauts on deterministic Lissajous drift with slow tumble plus star-dust backwash in `holo_interior` (T2: astronaut billboards only, no backwash; T3: single static astronaut badge over the projector) | Crafting 1 blank + 1 ender pearl + 1 feather yields exactly 1 cartridge and the acquisition advancement fires exactly once; at 50% density exactly 6 figures exist (12 at 100%) looping with period 1,200 ticks; recomputing the world-space scene twice from one (fxSeed, effective phase) snapshot yields byte-identical positions; max path radius = dome radius −1 block; upkeep +4 Cg/t. | client_gametest:vfx11_astronaut_drift |
| VFX-12 | Meteor Shower Cartridge | item | core | 2 | W13 | U23, MOB-04 | adjacent: GEN-14 (stretch) is a real bounded bolide event that edits terrain; this is a pure illusion with zero world effect | Boss-material loop: MOB-04 storm elementals drop storm residue; blank + 1 residue = this cartridge; a continuous, harmless meteor storm streaks the interior sky. | T1: hash-spawned streak SDF capsules with exponential-falloff trails (T2: streaks as elongated particle bursts; T3: occasional single mote burst) | A MOB-04 kill drops exactly 1 storm residue, 1 blank + 1 residue crafts exactly 1 cartridge, and the acquisition advancement fires exactly once; with the pinned test fxSeed at 100% density the hash-scheduled 1,200-tick sample window spawns exactly 96 streaks with 6-block trails; live HOLO particles stay ≤128 count over 1,200 sustained ticks; 0 C2S payloads are sent; upkeep +4 Cg/t. | client_gametest:vfx12_meteor_rate |
| VFX-13 | Shooting Star Cartridge | item | core | 2 | W13 | U23, ADV-02 | adjacent: a firework rocket is a real projectile with real particles; this is a sparse silent illusion with a wish-chime | Milestone loop: the recipe unlocks at the ADV-02 "first night under an active dome" milestone; blank + 1 amethyst shard + 1 glow ink sac; rare single stars arc over the interior sky. | T1: one capsule-SDF streak with smoothstep twinkle head (T2: spectral particle streak; T3: brief glint flash only) | The recipe is locked before and unlocked after the ADV-02 milestone (unlock-state assertion), crafts exactly 1 cartridge, and the acquisition advancement fires exactly once; with the pinned test fxSeed the 1,200-tick sample spawns exactly 6 streaks at the hash-scheduled window starts; head twinkle modulates at 2 Hz; every chime pairs with a visible streak; upkeep +4 Cg/t. | client_gametest:vfx13_star_cadence |
| VFX-14 | Taco Party Cartridge | item | core | 2 | W13 | U23 | adjacent: FX-13 (stretch) is a real placeable celebration cake with real buffs; these tacos are pure illusions granting 0 nutrition | Cook-and-craft loop: blank + 1 bread + 1 cooked chicken + 1 dried kelp; the dome fills with bouncing holographic tacos, confetti bursts and a party horn — the definitive base-warming flex. | T1: procedural taco billboards (script-generated texture) on parabolic bounce arcs plus cosine-palette confetti (T2: confetti as tinted particles, tacos static billboards; T3: single taco badge with horn) | Crafting 1 blank + 1 bread + 1 cooked chicken + 1 dried kelp yields exactly 1 cartridge and the acquisition advancement fires exactly once; 12 taco billboards bounce at gravity ×0.5 at 100% density; each burst emits exactly 24 confetti count; the horn fires every 400 ticks with a synchronized burst; interacting with illusions yields 0 items and 0 saturation; upkeep +4 Cg/t. | client_gametest:vfx14_taco_party |
| VFX-15 | Parallax Starfield Cartridge | item | core | 2 | W13 | U23, MOB-08 | adjacent: the End sky is one static texture; this is a 3-layer parallax deep field | Trade loop: a master-tier MOB-08 electrician villager sells it for 16 emeralds + 1 blank; a deep starfield wraps the interior and slides with parallax as you walk. | T1: 3 hash-star layers with per-layer camera-parallax factors (T2: 2 static star billboard shells; T3: sparse static glints) | The master-tier MOB-08 trade lists exactly 16 emeralds + 1 blank for 1 cartridge (trade-table assertion) and the acquisition advancement fires exactly once on first trade; exactly 3 layers render with camera-dependent parallax factors ×0.25/×0.5/×1.0 by design (the near layer displaces 4× the far layer for a 4-block camera move); ≤512 stars per layer; upkeep +4 Cg/t. | client_gametest:vfx15_parallax_layers |
| VFX-16 | Abyssal Reef Cartridge | item | core | 2 | W13 | U23 | adjacent: vanilla underwater fog/conduit ambience requires being underwater; this projects a dry grotto | Craft a blank with 1 prismarine shard + 1 kelp (shore-diving loop); the interior becomes a sunken grotto with god-ray shafts, bubble columns and caustic floor light. | T1: 4 additive light-shaft slabs plus a caustic floor disc from the shared noise library (T2: bubble particles + static shaft billboards; T3: blue floor disc only) | Crafting 1 blank + 1 prismarine shard + 1 kelp yields exactly 1 cartridge and the acquisition advancement fires exactly once; exactly 4 shafts and 3 bubble columns render at 100% density; the floor caustic loops in 160 ticks; bubbles rise 0.5 blocks/s and despawn at the shell; upkeep +4 Cg/t. | client_gametest:vfx16_reef_shafts |
| VFX-17 | Nebula Drift Cartridge | item | core | 2 | W13 | U23 | adjacent: the End gateway beam is a thin static column; this fills the dome with drifting recolored clouds | End loop: blank + 1 chorus fruit + 1 glow ink sac; slow rainbow nebulae billow through the dome. | T1: 5 alpha-slab planes of 4-octave fbm with hue drift (T2: 2 scrolling cloud billboards; T3: faint static haze tint) | Crafting 1 blank + 1 chorus fruit + 1 glow ink sac yields exactly 1 cartridge and the acquisition advancement fires exactly once; exactly 5 nebula slabs render; a full palette cycle takes 2,400 ticks; interior submission stays ≤8,192 count of vertices per frame (counter-asserted); upkeep +4 Cg/t. | client_gametest:vfx17_nebula_slabs |
| VFX-18 | Firefly Meadow Cartridge | item | core | 1 | W13 | U23, MOB-01 | adjacent: mangrove firefly particles are ambient and uncontrollable; this is an owned, bounded, steerable swarm | Wisp-hunting loop: MOB-01 spark wisps drop 1–2 wisp motes; blank + 2 motes + 1 glow berries; up to 64 gentle fireflies wander the interior — the calm low-stimulus dreamscape. | T1: curl-noise-guided point sprites with soft pulse (T2: firefly-style particles from the HOLO pool; T3: 8 static glints) | With the pinned test loot seed, 64 MOB-01 kill rolls yield exactly 96 motes (1–2 each), 1 blank + 2 motes + 1 glow berries craft exactly 1 cartridge, and the acquisition advancement fires exactly once; live fireflies never exceed 64 count; brightness pulses at 0.5 Hz; every path stays ≥1 block inside the shell; upkeep +4 Cg/t. | client_gametest:vfx18_firefly_bounds |
| VFX-19 | Snowglobe Cartridge | item | core | 1 | W13 | U23 | adjacent: WEA-10 (stretch) fires real snow that accumulates; these flakes are illusions placing 0 snow layers | Craft a blank with 1 snow block + 1 glass pane (winter loop); the dome becomes a snowglobe with drifting flakes, periodic gusts and a settle-shimmer ring. | T1: 3 depth-fogged flake sprite layers plus a ground shimmer ring (T2: white particles at 25% density; T3: shimmer ring only) | Crafting 1 blank + 1 snow block + 1 glass pane yields exactly 1 cartridge and the acquisition advancement fires exactly once; flakes fall at 0.5 blocks/s baseline; a gust every 300 ticks doubles lateral drift for exactly 60 ticks; 0 snow layers are placed in the world; upkeep +4 Cg/t. | client_gametest:vfx19_snow_gust |
| VFX-20 | Koi Sky Cartridge | item | stretch | 2 | W15 | U23, GOL-09 | adjacent: tropical fish are real water-bound entities; these koi are airborne deterministic flock illusions | Fishing loop: reeled as rare treasure while fishing inside an active dome, and GOL-09 fisher golems can reel it too; luminous koi school through the air on fully seed-deterministic flock paths. | T1: CPU boid flock (deterministic fxSeed) driving ribbon-trail billboards (T2: koi as chained particles; T3: 2 static koi decals) | With the pinned test loot seed, 200 in-dome treasure rolls yield exactly 4 cartridges (2% weight), a GOL-09 fisher can reel it, and the acquisition advancement fires exactly once; exactly 12 koi at 100% density; every koi stays ≤4 blocks from the flock centroid with pairwise separation ≥1 block over 600 ticks; equal fxSeeds give identical trajectories; upkeep +4 Cg/t. | client_gametest:vfx20_koi_flock |
| VFX-21 | Clockwork Orrery Cartridge | item | stretch | 3 | W15 | U23, GOL-01 | adjacent: DEC-10 gear walls are flat decor kinetics; this is a readable working orbital clock filling the dome | Automation-age loop: blank + 1 clock + 1 GOL-01 brass cortex; a copper solar system fills the dome — planets on nested rings with epicycle moons. | T1: parametric orbits with emissive ring paths (T2: planet billboards on undrawn orbits; T3: static orrery emblem) | Crafting 1 blank + 1 clock + 1 GOL-01 cortex yields exactly 1 cartridge and the acquisition advancement fires exactly once; exactly 6 planets orbit with period ratios 1:2:3:5:8:13; the innermost completes an orbit in exactly 600 ticks; positions are a pure function of (fxSeed, effective phase) and survive a serialization round-trip unchanged; upkeep +4 Cg/t. | client_gametest:vfx21_orrery_ratios |
| VFX-22 | Cartridge Deck | block | core | 2 | W13 | U23, VFX-11, OXI-02 | adjacent: a jukebox plays one disc with no sequencing; this rotates an 8-slot dreamscape playlist | Craft 4 OXI-02 cuprite alloy + 1 chest + 1 comparator; link the deck to the projector, load cartridges, and rotate the active dreamscape on a timer or redstone pulse. | Copper rack with a lit active-slot dial (T2: same model, static dial; T3: slot-count label only) | Crafting 4 OXI-02 alloy + 1 chest + 1 comparator yields exactly 1 deck and the acquisition advancement fires exactly once; it holds up to 8 slots; a redstone pulse advances the active slot by exactly 1 (wrapping); timer presets rotate at 600/1,200/2,400 ticks; the active slot survives a serialization round-trip (saved NBT reloaded into a fresh block entity equals the pre-save value). | server_gametest:vfx22_deck_rotation |
| VFX-23 | Dreamsmith Table | block | core | 2 | W13 | U23, VFX-11, OXI-15 | adjacent: the smithing table modifies real gear stats; this writes only visual presets onto cartridges | Craft 1 smithing table + 2 OXI-15 cast plates; socket a cartridge and dial its quantized presets (density, speed, palette) before projection. | Drafting table with hologram swatch preview (T2: flat swatch icons; T3: text-only preset list) | Crafting 1 smithing table + 2 OXI-15 cast plates yields exactly 1 table and the acquisition advancement fires exactly once; it writes exactly 3 preset fields (4 density settings, 3 speed settings, 16 palette hues) as item data components that survive a serialization round-trip byte-identical; invalid preset combinations are rejected with state unchanged. | server_gametest:vfx23_preset_roundtrip |
| VFX-24 | Chromatic Tuner | item | core | 1 | W13 | U23, OXI-01 | adjacent: TOOL-05 tuning forks tune blocks by pitch; this cycles projector palettes including colorblind-safe mappings | Craft 2 OXI-01 verdigris ingots + 1 amethyst shard + 1 stick; a handheld wand that cycles a projecting dome through the 16 palettes plus 3 colorblind-safe preset mappings without opening the GUI. | Tuning wand with hue arc flourish (T2: hue arc as particles; T3: chat-line feedback only) | Crafting 2 OXI-01 ingots + 1 amethyst shard + 1 stick yields exactly 1 tuner and the acquisition advancement fires exactly once; each use advances the projector palette id by exactly 1 (mod 16); for each of the 16 hues the rendered deuteranopia remap equals the pinned `fx/colorblind.json` entry (16 of 16) and re-applying it is idempotent (byte-identical). | client_gametest:vfx24_tuner_palette |
| VFX-25 | Dream Sync Beacon | block | stretch | 3 | W15 | U23, VFX-22, PWR-15, OXI-02 | adjacent: RAIL-12 (stretch) beacons transit hubs; this phase-locks the dreamscapes of two friendly domes | Craft 1 PWR-15 charge coupler + 2 OXI-02 alloy + 1 amethyst shard; link two domes so paired bases run the same show in step. | Antenna with synced double-pulse glow (T2: alternating lamp texture; T3: static antenna) | Crafting 1 PWR-15 coupler + 2 OXI-02 alloy + 1 amethyst shard yields exactly 1 beacon and the acquisition advancement fires exactly once; two linked projectors ≤64 blocks apart report identical effective phase (all 3 phase fields) and active cartridge id within 20 ticks of a change on either side; unlinking restores independent state within 20 ticks; non-owner link attempts are rejected (0 state changes). | server_gametest:vfx25_sync_phase |
| VFX-26 | Gallery Slate | item | stretch | 2 | W15 | U23, VFX-23, DEC-11 | adjacent: DEC-11 frescoes and map art are static player pixel art; this replays a drawn glyph as animated interior constellations | Craft 1 DEC-11 fresco canvas + 1 deepslate + 1 amethyst shard, then draw a 16×16 glyph at the Dreamsmith Table; the dome replays it as drifting mote constellations — the player-authored dreamscape. | Slate with etched glowing glyph (T2: glyph billboard; T3: static glyph frame) | Crafting 1 DEC-11 canvas + 1 deepslate + 1 amethyst shard yields exactly 1 slate and the acquisition advancement fires exactly once; the stored bitmap caps at exactly 128 bytes (16×16 4-bit) and the title at 32 Unicode scalar values and 64 UTF-8 bytes, NFC-normalized; every code point with `Bidi_Control=Yes` (ALM U+061C, LRM/RLM, LRE/RLE/PDF/LRO/RLO, LRI/RLI/FSI/PDI) plus all controls and noncharacters is rejected with 0 writes; oversized or non-owner uploads are rejected with 0 writes; the stored slate survives a serialization round-trip byte-identical. | server_gametest:vfx26_slate_caps |
| VFX-27 | Grand Finale Sequencer | block | stretch | 3 | W15 | U23, VFX-22, GOL-03, OXI-02 | adjacent: GOL-18 (stretch) parades golems; this choreographs timed three-act dreamscape shows from punch-card timelines | Craft 4 OXI-02 cuprite alloy + 3 GOL-03 punch cards; program card timelines to run a three-act show (act, transition, crescendo) from the deck's cartridges — fireworks-night energy without one real explosion. | Conductor console with act-progress dial (T2: dial texture steps; T3: numeric act readout) | Crafting the console from 4 OXI-02 alloy + 3 GOL-03 punch cards yields exactly 1 sequencer and the acquisition advancement fires exactly once; a show runs exactly 3 acts of 400 ticks each (1,200 ticks total), switching the active cartridge at exactly the 400-tick boundaries with no overlap or crossfade — exactly 1 cartridge active at any tick (only asserts dispatch/state); it then returns state = IDLE; a mid-show redstone pulse aborts to IDLE within 20 ticks. | server_gametest:vfx27_finale_acts |

Dependency audit for the table (re-audited after the OXI-15/OXI-02
additions): all deps are U-entries or earlier-sequence additional entries
(max earlier seq used: DEC-11 = 255; all VFX cross-deps point backward:
VFX-22/23 → VFX-11; VFX-25/27 → VFX-22; VFX-26 → VFX-23). **No forward deps;
no core→stretch deps** — every dep of a core row (OXI-01/02/15/16, WEA-06,
TOOL-16, GEN-04, MOB-01/04/06/08, ADV-02, VFX-11) is core; stretch rows dep
only core or earlier-VFX entries. Every lens row that consumes an OXI-15-cast
blank (VFX-01/02/03/04/05/07/08/10) declares OXI-15; the two non-blank
lenses (VFX-06 loot, VFX-09 drop) do not. Every feature id named in a
behavior or acceptance cell is a declared dep with an earlier sequence;
stretch analogues (WEA-13, GEN-14, FX-13, WEA-10, RAIL-12, GOL-18) appear
only in overlap cells, never in acceptance.

## 6. Waves, prototype gate, and integration

| Stage | Deliverable |
|---|---|
| **CP0C (now, post-W1A)** | This spec + catalog/concept/tooling materialization (§7). No runtime code; the committed W1A foundation (`ebd2b2c`) and the in-progress uncommitted W1B charge work are preserved untouched. |
| W1B–W1E (W1A committed; W1B in progress) | Remaining foundation waves proceed exactly per `FOUNDATION_PLAN.md`, unmodified except the two U23-scoped line amendments in §7 (D10 Iris timing; CP1-exit digest baseline). The W1D compile probe settles the provisional parameter-delivery question (§3); generic W1D `FxCompat` remains log-only per D10. The FX foundation (tier ladder, pools, budgets, dispatcher) is the extension surface; holosphere later adds **new files** under `fx/holo/**` (append-only extension rule) and never edits dispatcher/pool internals. |
| W2 (U01–U03, U11, U13, U14, U19) / W3 (U08–U10, U12, U15, U18) | Unchanged, exactly as cataloged. |
| **W4 — U23 phase + prototype gate** | U23 joins W4 alongside the cataloged U17, U21, U22. U23 implementation (block/BE/menu/guarded payloads/persistence/`fxSeed`/data components) **plus the representative prototype**: both übershader pipelines registered, the shared include library, ONE diagnostic surface variant and ONE diagnostic interior scene (CP0-style infrastructure, **no catalog entries**, Charge-Probe precedent), the Iris active-pack runtime gate, appending probe evidence to `docs/API_PROBES.md`, and the sanctioned `FxBudgets` review (+holo vert/callback budgets, HOLO carve-out from the 64/256 particle totals). |
| **W13 — VFX core (20)** | 8 core lenses, 9 core cartridges, deck/table/tuner, recipes/advancements/handbook pages. W13 becomes the largest wave; the eval loop may split it W13a (lenses) / W13b (cartridges + systems) without catalog changes. |
| W14 (reserved role unchanged) | `w14_holo_frame_budget` — reference scene = one R12 projector + one lens + one cartridge + existing max shield ripple state; Holosphere contribution ≤1.5 ms/frame; measures actual draw batches — plus cross-feature interaction gametests (SHD-06 priority, SHD-11 flicker suspend, QOL-04 force, window/modulator composition). |
| W15 | The 7 VFX stretch rows alongside the other 48 stretch features. |

### 6.1 Prototype gate (blocks bulk scenes — objective, all required)

Bulk W13 scene implementation may not start until the W4 prototype proves,
with committed evidence:

1. `cuprum:pipeline/holo_surface` and `cuprum:pipeline/holo_interior` compile
   and pass `precompilePipeline(...).isValid()` on the CI llvmpipe driver,
   **including every required field of the provisional vertex format/packing
   contract and the built-in `GameTime` uniform**.
2. Variant dispatch via packed vertex attributes works: two diagnostic
   variants render distinguishably from ONE pipeline (region screenshots).
3. Tier ladder: REDUCED cap ⇒ 0 custom-pipeline submits, T2 visuals present;
   T3 static fallback renders; OFF renders nothing (counter-asserted).
   **Iris runtime gate:** with an active shaderpack, `compatCap = T2` engages
   and 0 custom-pipeline submits occur.
4. Budgets per visible projector (one lens + one active cartridge): one
   no-cull additive surface callback ≤4,096 verts, one interior callback
   ≤8,192 verts, ≤2 geometry callbacks total (counter-asserted); the HOLO
   carve-out (≤32 spawn/tick, ≤128 live inside the 64/256 family totals)
   holds under a stress scene; flash-cap governor demonstrably clamps a
   10 Hz test input to ≤3 Hz (measured over 200 ticks).
5. Two-client agreement: byte-identical world-space scene recomputation from
   one (fxSeed, effective phase) snapshot (unit); identical BE update tags
   to two mock connections (server gametest); **two-launch screenshot test:
   both launches inject the same explicit test-only fxSeed and phase tick,
   freeze the projector in PAUSED state (pinning the simulation phase), set
   the identical camera pose, and the fixed-pose screenshots match**
   (client gametest evidence).
6. Guard conformance: forged/oversized/non-owner payloads from the §2.2
   ledger rejected with 0 state changes; per-payload rate limits enforced;
   **no payload injects a lens/cartridge id (server derives content from
   authoritative inventory; empty/wrong/locked slots rejected)**; the
   `holo/relink` guard chain and the VFX-24 `useOn` path (range/ownership/
   state/held-item + 5-tick cooldown) both enforce their checks.
7. Persistence: the U23 process-restart probe (extending the
   `scripts/server_restart_probe.sh` pattern once W1B lands it) proves
   fxSeed/sockets/program/controller pos/phase fields identical across a
   real process restart, with the animation resuming at the exact frozen
   phase (no phase jump).
8. Perf: prototype scene (one projector, one lens, one cartridge)
   Holosphere contribution ≤1.5 ms/frame render-thread on the reference
   client; dedicated-server tick cost of the projector BE ≤0.05 ms.

## 7. Materialization change list (tooling + docs, all reviewed diffs)

1. `UserContracts.java`: +1 contract row (§2).
2. `catalog/catalog.json`: +28 entries (U23 @273, VFX-01..27 @274–300);
   `catalog/expected_counts.json` → 23/222/55; `catalog/schema.json`
   description strings and any count/family pins updated for the VFX family.
3. New `docs/feature-concepts/VFX.md`: header contracts + the §5.1 table in
   the strict repo row format (12 nonblank cells, structured `T2:`/`T3:`
   clauses, allowlisted-unit numeric acceptance, unique test targets, no HTML
   entities/tags/blockquotes).
4. `docs/feature-concepts/INDEX.md`: +VFX family row using the exact link
   syntax `| VFX | [VFX.md](VFX.md) | \`holo_projection\` | 274–300 | 27 |
   20 | 7 | W13 |`; checklist +27 rows; totals text 250→277, 202→222,
   48→55; note "U23 holds sequence 273 and is excluded from the additional
   checklist"; digest formula → "277 arrays in global sequence order 23→272
   then 274→300"; recompute and publish the new full-row digest.
5. `ConceptParity`/`ConceptIndex`: `FAMILY_PREFIXES` += `VFX` (word-boundary
   analysis: `VFX-01` cannot false-match the `FX` alternative); the §1
   tooling changes — explicit-sequence consumption, user-entry-occupied hole
   allowance, sequence/tier maps over all catalog entries including U23.
6. Test/tool updates (every file): `ConceptParityTest` digest literal (the
   sanctioned reviewed two-file diff) + new hole/forward-user-dependency
   mutation tests; `Cp0bCatalogTest` (or successor) 272/202/48/22 →
   300/222/55/23 + VFX family row; `CatalogValidatorTest` count/fixture
   updates; `ContractMutationTest` — its invented unknown-contract id
   `U23` becomes real, so the mutation must invent `U24` instead;
   `CatalogCodegenTest` and `CuprumCatalogGeneratedTest` 272→300;
   `AdditionalMutationTest` fixtures for the new family;
   `FamilyIdScalingTest` +VFX numbering; `RepairedConceptSemanticsTest` +
   pins for the VFX numeric budget (2 RenderTypes, per-projector 4,096/8,192
   verts + ≤2 callbacks, HOLO 32/128 carve-out of 64/256, 3 Hz cap, +2/+4
   Cg/t upkeep adders).
7. `README.md`/`AGENTS.md`: count references refreshed (272/250/202/48 →
   300/277/222/55) and the CP0B-state paragraph amended to name CP0C.
8. `docs/foundation/FOUNDATION_PLAN.md` — exactly two U23-scoped line
   amendments: (a) the D10 line "Iris reflection query in `FxCompat` →
   W12." gains "**CP0C amendment: for U23 only, the Iris active-pack
   soft-dependency/probe lands in W4 as a U23 gate; generic W1D `FxCompat`
   unchanged.**"; (b) the CP1 exit items reading "digest byte-identical to
   CP0B" and "`verifyConceptParity` digest and `catalog/**` byte-identical
   to CP0B" **rebaseline CP0B → CP0C** (CP0C lands before CP1, so CP1 exit
   compares against the CP0C catalog/concept state).
9. Commit scope also includes this spec and the research ledger
   `docs/shader-research/SHIELD_HOLOSPHERE_REFERENCES.md`.
   **`docs/API_PROBES.md` is NOT touched by CP0C.**

## 8. Test / perf / security plan (summary)

- **Tests:** 27 unique targets in the accepted prefix vocabulary: 22
  `client_gametest:` for visual rows (VFX-24 included — its
  palette/colorblind remap is client/data) and 5 `server_gametest:` for
  state rows (VFX-22/23/25/26/27; explicit dispatch/state-only escape on
  VFX-27). All cadence/probability assertions use **pinned fxSeed/loot-seed
  values with fixed sample windows** — no statistical flakes. Row-level
  persistence assertions are **in-process serialization round-trips**; the
  single **process-restart probe lives at U23 level** (extends
  `scripts/server_restart_probe.sh`) covering fxSeed/sockets/program/
  controller pos/phase fields with no phase jump. Plus U23 server gametests:
  placement; **comparator selection including explicit
  equal-squared-distance tie-breaks with controllers at positive AND
  negative x/y/z coordinates, asserting signed lexicographic x→y→z order**;
  duplicate-FAULT per linked controller; exact upkeep; pause/resume phase
  equations; §2.2 guard rejection per payload; **`holo/relink` guard tests
  (target eligibility / same owner-or-team / projector inside radius / ≤16
  blocks / no duplicate; persist only after all pass)**;
  **progression-bypass tests — a `holo/config`/deck/table/sequencer write
  resolving an empty, wrong-type, or locked/unrecipe-gated slot is rejected
  with 0 state changes, and no payload can inject a lens/cartridge id**;
  `useOn` guard + 5-tick cooldown; two-connection tag equality; **slate
  rejection tests for ALM (U+061C), LRM/RLM marks, LRE/RLE/LRO/RLO
  embeddings/overrides and PDF, LRI/RLI/FSI isolates + PDI, plus controls
  and noncharacters (each ⇒ 0 writes)**. A U23 client gametest covers T1
  screenshot + custom-submit counters (REDUCED ⇒ 0). Screenshot policy D12
  (region-scoped, downgradeable to counters on CI driver flake).
- **Perf:** CI asserts counters (per-projector callbacks/verts, HOLO
  carve-out); ms budgets and actual batch/draw counts belong to the W14
  harness (`w14_holo_frame_budget`), per the established
  counter-now/milliseconds-later rule.
- **Security:** guard order unchanged; new node `cuprum.holo.configure`; the
  complete typed payload ledger is §2.2 (bounded structured fields, no
  NBT/ItemStack C2S; slate = the single bounded bitmap/text exception;
  VFX-24 uses the guarded vanilla `useOn` path, no custom payload);
  VFX-26 is the only UGC surface (≤128-byte bitmap; title ≤32 Unicode scalar
  values and ≤64 UTF-8 bytes, NFC, controls/bidi/noncharacters rejected,
  opaque display data only; owner-only; per-viewer local hide as the
  moderation floor); illusions are S2C-only and outcome-neutral.

## 9. Standalone prompts

### 9.1 CP0C materialization prompt (hand to the implementer verbatim)

> You are implementing **CP0C** of the Cuprum catalog: expansion from 272 to
> exactly 300 features per the binding spec
> `CUPRUM/docs/expansions/CP0C_HOLOSPHERE.md`. Repository truth: HEAD is
> `ebd2b2c feat(cuprum): W1A net, state and config foundation` — W1A is
> committed and MUST be preserved; the working tree carries uncommitted W1B
> charge work that MUST also be preserved. Never run reset/revert/stash-drop
> or `git add -A`/`git add .`; stage only CP0C-scoped files explicitly. Work
> only inside `/workspace/CUPRUM`.
> **Deliverables:** exactly the §7 change list — UserContracts +U23;
> catalog.json +28 entries (U23 @273 per §2, VFX-01..27 @274–300 transcribed
> exactly from §5.1); expected_counts 23/222/55; schema description/pins;
> new VFX.md (header contracts §5 + table §5.1 in strict row format);
> INDEX.md family row with exact link syntax `[VFX.md](VFX.md)`, +27
> checklist rows, totals, digest formula and recomputed digest; the §1
> ConceptParity/ConceptIndex tooling changes (explicit sequences,
> user-entry-occupied hole, full-catalog sequence/tier maps) + the new
> hole/forward-user-dependency mutation tests; every §7.6 test file
> (including `ContractMutationTest` inventing `U24` instead of `U23`);
> README/AGENTS count refresh; the two §7.8 FOUNDATION_PLAN line amendments
> (D10 Iris → W4 for U23 only; CP1-exit digest baseline CP0B → CP0C);
> commit this spec + the research ledger.
> **No runtime gameplay code, no edits to any W1A/W1B file, no touch of
> `docs/API_PROBES.md`, no new dependencies, no shader code anywhere in
> docs.**
> **Hard constraints:** all 250 existing concept rows byte-identical (digest
> change comes only from the 27 appended rows + formula text); user tier
> core; no forward deps; no core→stretch deps or core-acceptance references
> to stretch ids; every behavior/acceptance id reference is a declared
> earlier-sequence dep; no banned acceptance tokens (documented / per spec /
> measurably / tolerance / rated / per curve / standalone N); clean-room
> rule §4 (no external shader source, ever).
> **Done =** `./gradlew toolchainVerify` and `./gradlew check build` green
> (schema, validateCatalog, verifyConceptParity, all unit/mutation tests
> with updated pins); `validateCatalog` prints `Catalog validation OK: 300
> entries (23 user + 222 additional core + 55 additional stretch)`. Commit
> exactly `docs(cuprum): CP0C expand catalog to 300 features (U23 + VFX
> family)` and push. Report files changed, old→new digest, and the count
> proof line.

### 9.2 Sol Eval-A (independent audit)

> You are **Sol Eval-A**, auditing CP0C against
> `CUPRUM/docs/expansions/CP0C_HOLOSPHERE.md`. Do not trust the implementer.
> 1. **Arithmetic:** recount catalog.json yourself — 300 entries, sequence
>    1..300 contiguous, U23 @273 with the exact contract triple, VFX @274–300
>    ascending, tiers 23/222/55, and `git diff` shows zero changed lines in
>    the 272 pre-existing entries and 250 pre-existing concept rows.
> 2. **Parity:** run `./gradlew check build`; independently recompute the
>    published digest with the documented 277-array formula and compare.
> 3. **Row quality:** per row — unique name vs all 299 others; a real,
>    distinct survival acquisition loop (reject any row that is a preset or
>    recolor of another); a per-feature acquisition-advancement assertion;
>    nearest-analogue distinction present in the overlap cell; structured
>    T2:/T3: clauses; numeric acceptance per the allowlist with zero banned
>    tokens (documented / per spec / measurably / tolerance / rated / per
>    curve / standalone N); pinned seeds + fixed sample windows for every
>    cadence/probability claim; test-scope vocabulary legal (server rows
>    carry no render/visual/HUD words without the dispatch/state escape; no
>    process-restart claims in row-level gametests); behavior/acceptance id
>    references ⊆ declared earlier-sequence deps, core-only for core rows.
> 4. **License:** grep all new docs for GLSL fragments, tuned constants, or
>    near-translations of CC BY-NC-SA sources — any hit is REJECT; every
>    license claim must trace to the research ledger's `verified`/`reported`/
>    `unverified` markers (defined verbatim by the ledger) with direct HTTPS
>    URLs; **any doc treating a `reported`-posture reference as permissively
>    licensed without direct live-header verification is REJECT.**
> 5. **Honesty:** the spec's frozen inventory (2 pipeline resource ids +
>    2 RenderTypes on the dome/aurora slots, include library, 10/11/6
>    split, WEA-13 far-scene reuse) must appear verbatim in VFX.md's budget
>    contract, and no row may promise frame-grabs, refraction, unproven
>    per-draw uniforms/UBOs, or >4 RenderTypes.
> Verdict `PASS`/`REJECT` + numbered findings (severity, file, line,
> evidence). Any arithmetic, license, or parity finding = REJECT.

### 9.3 Fable Eval-B (adversarial second pass)

> You are **Fable Eval-B** for CP0C. Input: changeset, the spec, Eval-A's
> findings. Verify each finding fixed or rebutted with evidence; re-run one
> full `./gradlew check build`. Then hunt what conformance misses: smuggled
> edits to existing rows (Unicode lookalikes — run the normalization
> yourself); digest updated without matching formula text; acceptance cells
> that satisfy the regex but assert nothing real; transitive core→stretch
> leaks; wave labels inconsistent between INDEX, VFX.md and catalog; the four
> user-named cartridges (astronauts, meteor shower, shooting stars, taco
> party) present, core-tier, and faithful to the user's intent rather than
> renamed substitutes; U23 fields that would let a later wave silently
> repurpose the contract; leftover 272/250/202/48 claims anywhere in
> README/AGENTS/docs; the two §7.8 FOUNDATION_PLAN amendments present
> (D10 Iris → W4 for U23; CP1-exit baseline CP0B → CP0C) and nothing else
> in that file changed. Verdict `PASS` (commit with the exact CP0C message)
> or `REJECT` with numbered findings.
