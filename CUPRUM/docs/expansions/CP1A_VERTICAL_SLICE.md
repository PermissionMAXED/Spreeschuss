# CP1A — The Playable Vertical Slice (binding amendment)

Status: **BINDING**. This document is the authoritative sequencing and contract
amendment for Cuprum's first post-foundation implementation work, issued at/after
the W1E foundation commit `7b1d9fe`. It supersedes the two rejected implementation
plans reviewed before it; §14 records every finding of those reviews and how each
was reconciled against repository truth. Where this document is silent,
`docs/foundation/FOUNDATION_PLAN.md` (as amended by
`docs/expansions/CP0C_HOLOSPHERE.md`) and the sealed concept docs govern; where a
rejected plan disagrees with this document, this document wins.

**Hard scope rule:** CP1A touches **no** file under `catalog/**` and **no** file
under `docs/feature-concepts/**`. The catalog stays at exactly **300 entries**, and
the `verifyConceptParity` digest stays **byte-identical to CP0C**. Everything below
is expressed as implementation contracts on top of the sealed metadata — never as
metadata edits.

---

## 1. The honest sequence (review finding: no aspirational ordering)

The rejected plans presented an implementation order that silently reordered waves
while implying the catalog already said so. It does not, and CP1A does not pretend
it does. The **actual implementation order** is:

| Phase | Content | Cataloged wave of the content |
|---|---|---|
| **P1** | U04 Lightning-Capture Rods + U05 Leyden Jar base slice (server logic, T2/T3 visuals only) | W1 (cataloged, never shipped by the W1 foundation waves — plan D6 forbade catalog gameplay in W1A–W1E) |
| **P2** | U01 Storm Shield Core — multiblock, dome tick, upkeep, **T2 server/visual slice** | W2 |
| **P3** | U02 Shield Projectile Interception + impact ripple | W2 |
| **P4 = W4** | U23 consolidated: projector block/BE/persistence/guarded payloads **plus** the CP0C §6.1 prototype gate — both übershader pipelines (`cuprum:pipeline/holo_surface`, `cuprum:pipeline/holo_interior`), exactly ONE diagnostic surface variant and ONE diagnostic interior scene, the Iris runtime gate, the GameTime probe | W4 |
| **P5** | Resume the deferred W2 remainder (U03, U11, U13, U14, U19), then W3 (U08–U10, U12, U15, U18), then the W4 companions (U17, U21, U22), then W5+ exactly as cataloged | W2/W3/W4/W5+ |
| **P6 = W13** | VFX-01..08 and **VFX-11..14** (with the rest of the 20 core VFX rows) implemented as **full features against their exact `VFX.md` rows** — recipes, acquisition advancements, upkeep adders, named client gametests. **Never as diagnostics.** | W13 |

Honesty clauses (binding):

- P1 implements U04/U05 *late relative to their cataloged W1 label*. That label was
  always a planning statement; plan D6 explicitly shipped **zero** catalog gameplay
  in W1A–W1E. CP1A is the first wave allowed to claim catalog contracts.
- P2/P3 pull U01/U02 **forward within W2** ahead of the other five W2 rows. The
  five deferred rows are listed with reasons in §2 — the `planned_wave` metadata is
  **not** rewritten to match, because it is sealed and because rewriting planning
  metadata to match execution order would erase the record of the decision.
- The W4 U23 prototype gate (CP0C §6.1) **blocks** P6: bulk W13 scene work may not
  start until every gate item has committed evidence.
- VFX-11..14 (Astronaut Drift, Meteor Shower, Shooting Star, Taco Party) are
  **catalog features of W13**. The rejected plan's use of them as W4 "diagnostic
  scenes" was a scope error (review finding, confirmed against
  `docs/feature-concepts/VFX.md` rows 432–435 and CP0C §6): W4 gets exactly one
  *non-catalog* diagnostic surface variant and one *non-catalog* diagnostic
  interior scene (Charge-Probe precedent, no catalog entries, `cuprum-gametest`/
  diagnostics namespace conventions), and the four cartridges arrive only in W13
  as full features with their cataloged recipes and tests
  (`client_gametest:vfx11_astronaut_drift`, `vfx12_meteor_rate`,
  `vfx13_star_cadence`, `vfx14_taco_party`).

## 2. Deferral record (no `planned_wave` fiction)

Every entry below keeps its sealed `planned_wave` value. CP1A defers actual
implementation as follows and says so plainly:

| Entry | Sealed wave | Actual phase | Reason for deferral |
|---|---|---|---|
| U03 Shield Mob Repulsion | W2 | P5 | Depends on U01 only, but owns the canonical **Shock** effect registration (INDEX vocabulary) — a cross-family contract (OXI/TES/MOB reference it) that deserves its own reviewed slice. The U01 dome tick is built in P2 so SHD/U03 logic can ride it later without a second entity scan (SHD perf budget). |
| U19 Conductive Climbing Wire | W2 | P5 | The P1 rod→jar route works over direct graph adjacency; U19's binding line-loss model (2 pp / 0.5 pp per 16-block span) is a self-contained transmission contract not needed for the slice spine. |
| U11 Pneumatic Item Tubes | W2 | P5 | No dependency relationship to the U04→U05→U01→U02 spine (logistics family, deps: none). |
| U13 Copper Fans | W2 | P5 | Same — independent mobility row. |
| U14 Copper Grappling Hook | W2 | P5 | Same — independent mobility row. |
| U17 Backpack Personal Shield | W4 | P5 (after P4) | Needs a mature U01+U05; it is a miniaturization of systems the slice is still stabilizing. |
| U21 Weather Manipulator | W4 | P5 (after P4) | Needs U04/U05 plus storm-summoning gameplay; W4 capacity is consumed by the U23 consolidation and prototype gate (CP0C wave table). |
| U22 Dynamic Handbook | W4 | P5 (after P4) | The "generated from the catalog, never stale" contract only pays off once a meaningful share of features exists; until then the W1E ratchet (§12) keeps shipped pages honest. |

## 3. ID ledger — every P1–P3 runtime id (review finding: no invented ids)

All ids follow the frozen conventions: blocks/items registered by module-owned
`*Content` classes (plan D4), payload ids `cuprum:{c2s|s2c}/<domain>/<action>`
(plan D3), gametest content under the `cuprum-gametest` namespace (plan D6).

**Blocks / items / block entities**

| Phase | Registry | Id | Owner class |
|---|---|---|---|
| P1 | block + item | `cuprum:lightning_capture_rod` | `power/PowerContent` (new module class, D4 pattern of `MachineContent`) |
| P1 | block entity | `cuprum:lightning_capture_rod` | `power/PowerContent` |
| P1 | block + item | `cuprum:leyden_jar` | `power/PowerContent` |
| P1 | block entity | `cuprum:leyden_jar` | `power/PowerContent` |
| P2 | block + item | `cuprum:storm_shield_core` (controller) | `shield/ShieldContent` |
| P2 | block + item | `cuprum:storm_shield_pylon` (member) | `shield/ShieldContent` |
| P2 | block entity | `cuprum:storm_shield_core` | `shield/ShieldContent` |
| P2 | multiblock pattern | `cuprum:storm_shield_core` (`data/cuprum/cuprum_multiblock/storm_shield_core.json`) | shield module |

`CuprumBlocks`/`CuprumItems`/`CuprumCreativeTabs` stay frozen (D4): new content
never touches them.

**Payloads** (plan §3.2 codec rules: bounded primitives, reject-not-clamp,
idempotent, loss-tolerant)

| Phase | Id | Direction | Contents / budget |
|---|---|---|---|
| P3 | `cuprum:s2c/fx/shield_impact` | S2C | dome center `BlockPos` (8 B) + impact direction, 16-bit octahedral-encoded unit vector (`VAR_INT` ≤3 B) + dome `radiusQ8` (`VAR_INT` ≤3 B) + `colorArgb` (`VAR_INT` ≤5 B) + server `gameTime` (`VAR_LONG` ≤10 B) — ≤29 payload bytes, frozen constant `SHIELD_IMPACT_PAYLOAD_MAX_BYTES = 32` beside `RIPPLE_PAYLOAD_MAX_BYTES` in `FxBudgets` |

No new C2S payload exists in P1–P3: the slice ships **no GUI** and no client-to-
server interaction beyond vanilla block use. `FxRipplePayload` stays frozen
(client-fx.md §14: new effects add NEW payload records — exactly what
`shield_impact` is). W4 payloads are the CP0C §2.2 ledger, unchanged.

**Permissions:** P1–P3 add **no** permission node. `cuprum.diagnostics` and
`cuprum.admin.override` (W1A `perm/Nodes`) remain the only nodes until W4 adds
`cuprum.holo.configure` (CP0C) and W7 adds `cuprum.shield.configure` (SHD header
contract, with the dome-config GUI it gates).

**Config keys:** P1–P3 add **zero** keys to `cuprum-common.json5`. The
`configSchemaFreeze` GameTest key list stays byte-identical. Already-frozen keys
carry the slice: `charge.strikeDepositCg` (270,000), `charge.leydenJarCapacityCg`
(100,000), `charge.passiveBaselineCgPerTick` (5). All remaining P1–P3 balance
constants are **code-pinned** `public static final` constants (the `FxBudgets`
precedent) in a new MC-free `power/PowerBudgets` and `shield/ShieldBudgets`,
asserted by tests: rod discharge 1,000 Cg/t, jar insert/extract 1,000 Cg/t, dome
radius 8, dome upkeep 32 Cg/t, intercept cost 200 Cg + 40 Cg per block/tick of
projectile speed (SHD header formulas). Rationale: the freeze test says "additions
require a plan edit"; CP1A *could* sanction one but deliberately does not — jars
and rods must first prove their feel before their knobs are player-facing, and a
smaller frozen schema is a smaller sync/validation surface.

**Gametest structure:** one new template, `cuprum-gametest:empty_24` (§11). No
other structure ids.

**RenderTypes:** **no fifth world-FX RenderType, and none earlier either.** The
census trajectory is: W1D ships 1 (`fx_ripple`); P3 adds **zero** (shield impact
reuses `fx_ripple`, §8); W4 adds `holo_surface` + `holo_interior` (+ the arc stub
when its owner wave lands) toward the CP0C-frozen total of exactly 4.
`FxBudgets.MAX_WORLD_FX_RENDER_TYPES = 4` and the census assertions stay binding.

## 4. U01 multiblock JSON (exact design, inside the frozen caps)

The frozen reloader caps are `MAX_DIMENSION = 16` per axis, `MAX_CELLS = 512`
member cells, ≤32 key entries (`MultiblockPatternJson`/`MultiblockPattern`). The
Storm Shield Core is a deliberately compact 3×3×3 (27 cells, 15 members, 3 key
entries) — the dome is projected, the machine is not the dome:

```json
{
  "format_version": 1,
  "orientation_mode": "any_horizontal",
  "allow_mirror": true,
  "layers": [
    ["WPW",
     "PWP",
     "WPW"],
    [".P.",
     "PCP",
     ".P."],
    ["...",
     ".P.",
     "..."]
  ],
  "key": {
    "W": { "block": "minecraft:waxed_copper_block" },
    "P": { "block": "cuprum:storm_shield_pylon" },
    "C": { "block": "cuprum:storm_shield_core" }
  },
  "controller": "C"
}
```

- Layer 0 (bottom): plinth — waxed copper corners/center with a pylon cross.
- Layer 1: the controller core ringed by four pylons; controller cell `(1,1,1)`.
- Layer 2: a single apex pylon (the visible "antenna" the dome hangs from).
- The pattern is 4-fold symmetric, so `any_horizontal` + mirror is safe (all
  orientations are equivalent; the W1C orientation machinery is exercised by the
  asymmetric diagnostic coil and needs no second asymmetric proof here).
- Formation, faults, claims, persistence envelope and reload delivery reuse the
  W1C machinery unchanged (`MultiblockPatterns`, `FormationState`, §3.1 envelope).
- Dome geometry: radius **8** centered on the controller (SHD-01 baseline "no
  coil ⇒ radius 8"), upkeep **32 Cg/t** = `ceil(0.5·R²)` (SHD header constants).
  Radius tiers (SHD-01 coils) are W7 content — the slice pins R = 8 in
  `ShieldBudgets` and the dome tick reads it from there.

## 5. U04 — POI attraction, subclassing, and the full-callback contract

**One access widener, no mixin.** New file `src/main/resources/cuprum.accesswidener`
(wired via `"accessWidener"` in `fabric.mod.json` and `loom.accessWidenerPath` in
`build.gradle` — the repo's first and only AW), containing exactly one rule:

```
accessWidener v2 named
accessible method net/minecraft/world/entity/ai/village/poi/PoiTypes registerBlockStates (Lnet/minecraft/core/Holder;Ljava/util/Set;)V
```

Verified against the decompiled 1.21.9 sources (charge.md PROBE-4, confirmed in
this audit): natural-strike attraction is `ServerLevel.findLightningRod` querying
the POI manager for `PoiTypes.LIGHTNING_ROD`, whose state set is populated by the
private `PoiTypes.registerBlockStates(Holder<PoiType>, Set<BlockState>)` into the
`TYPE_BY_STATE` map that chunk-section POI recording consults. Fabric's
`PointOfInterestHelper` only helps register *new* POI types; joining an *existing*
vanilla type requires exactly this call. At `PowerContent.init()`:

```java
PoiTypes.registerBlockStates(
    BuiltInRegistries.POINT_OF_INTEREST_TYPE.getHolderOrThrow(PoiTypes.LIGHTNING_ROD),
    Set.copyOf(PowerContent.LIGHTNING_CAPTURE_ROD.getStateDefinition().getPossibleStates()));
```

**Subclass, preserve super.** `LightningCaptureRodBlock extends LightningRodBlock`
(inheriting `POWERED`/`FACING`/waterlogging state and behavior — which is also what
makes the POI state-set insertion above well-formed). The only override that
matters:

```java
@Override
public void onLightningStrike(BlockState state, Level level, BlockPos pos) {
    super.onLightningStrike(state, level, pos);   // vanilla power pulse, sound, oxidation-scrape behavior
    if (level instanceof ServerLevel serverLevel) {
        ChargeGraphManager.get(serverLevel)
                .depositSurge(pos, ChargeBalance.strikeDepositCg()); // full 270,000 Cg
    }
}
```

**Full 270,000 Cg for every vanilla callback — including channeling.** Confirmed
against `LightningBolt` sources: `powerLightningRod()` runs for every bolt that
lands on a rod regardless of cause (natural storm strike, channeling trident,
`/summon`, skeleton-trap), and the `visualOnly` flag suppresses only fire creation
and entity damage — **not** the rod-power callback. CP1A therefore deposits the
full configured `strikeDepositCg` on *every* callback invocation, channeling
included. The 10%-loss figures elsewhere in the concepts (SHD-04 "243,000 Cg =
270,000 minus 10% arc loss", PWR-24 "minus 10% string loss") are **redirection
losses of those specific later features**, not properties of a direct hit; a
direct hit on the rod is lossless. No contradiction exists once the loss is
attributed to the redirect mechanism (this resolves the reviews' apparent
270,000-vs-243,000 conflict — repository truth: `RepairedConceptSemanticsTest`
pins 243,000 only for SHD-04/PWR-24).

## 6. U04→U05 route (decided after auditing the real `ChargeGraphCore`)

**Audit facts that constrain the choice** (from `ChargeGraphCore` at `7b1d9fe`):

1. `depositSurge(nodeId, amount, access)` fills the deposit node's **own storage
   first** via the explicit `insertSurgeStorage` path — bypassing the normal
   per-tick insert budget but **never capacity** — then feeds SURGE_ABSORBERs in
   the island (canonical order, absorb budgets, relay path caps), and **vents the
   remainder exactly** (immediately counted into `ventedTotal`).
2. The allocator has **no storage→storage phase**. Phases are P0 producers-drain,
   P1 pools→consumers, P2 pools→storages, P3 storages→consumers, P4
   pools→absorbers, vent. A storage-only rod could **never** move charge to jars.
3. P0 drains a producer's **full offer up front**; whatever P1/P2/P4 cannot place
   is **vented by construction**. An unconditionally-offering rod would bleed a
   captured strike into the vent whenever jars are full or absent.
4. The deliberate read-only surface (`ChargeGraphManager.nodeReport(pos)` →
   `NodeReport.networkStored`/`networkCapacity`, computed over loaded island
   STORAGE members) is public, frozen, and cheap enough for probe-per-use; the
   solver budget is ≤0.15 ms/tick at 1,000 nodes.

**Chosen route — buffered rod, room-gated discharge** (rejecting both reviewed
alternatives: "storage-only rod" is impossible by fact 2; "unconditional producer"
loses charge by fact 3):

- The rod registers as one node with role mask `STORAGE | PRODUCER`, priority
  `MISC`, **capacity = `ChargeBalance.strikeDepositCg()`** (default 270,000 Cg —
  "one full strike always fits an empty rod" stays true under config changes),
  normal insert budget 0 (nothing inserts into a rod through the normal path),
  extract budget 0 (nothing pulls from it; it pushes).
- **Strike capture:** the callback (§5) calls `depositSurge`. Empty rod: the full
  270,000 Cg lands in the rod buffer in one call — the full-strike contract.
  Partially-full rod: the buffer tops up to capacity; the overflow goes to surge
  absorbers if any exist (none ship in P1 — PWR-13 Surge Protector and PWR-21
  Grounding Rod are W5) and the remainder **vents exactly**, logged, counted.
  That is the frozen surge rule verbatim, and it is the honest P1 behavior: a
  second strike on an undrained rod loses the overflow until W5 ships the
  absorber/vent-management blocks.
- **Discharge:** each server tick the rod (as PRODUCER) offers
  `min(buffered, ROD_DISCHARGE_CG_PER_TICK = 1,000, roomExcludingSelf)` where
  `roomExcludingSelf = (networkCapacity − networkStored) − (ownCapacity − ownStored)`
  from its own `nodeReport` — the deliberate diagnostics surface, no graph
  bypass, no core edit. `drain(n)` subtracts the actual from the buffer. Because
  the offer never exceeds jar room, **discharge never vents** (fact 3 defused);
  a full strike drains into 3 jars in exactly 270 ticks (13.5 s). When P2 adds
  the dome consumer, the P3 allocator phase (storages→consumers) feeds the dome
  from jars even during ticks where the rod offers 0; the freed room re-opens the
  rod's offer on the next tick — a documented, deterministic 1-tick lag.
- **Jar node:** role `STORAGE`, priority `MISC`, capacity =
  `ChargeBalance.leydenJarCapacityCg()` (100,000), **insert budget 1,000 Cg/t,
  extract budget 1,000 Cg/t** (`JAR_INSERT_CG_PER_TICK`/`JAR_EXTRACT_CG_PER_TICK`
  in `PowerBudgets`; the harness-cell precedent uses the same 1,000 figure with a
  deliberately non-catalog 20,000 capacity). BE extends
  `AbstractChargeStorageBlockEntity` (D7 seam) — envelope persistence, buffer
  clamping and surge acceptance are inherited, not reimplemented.
- **Deterministic order:** multiple jars fill in the solver's canonical order —
  ascending `(priority.ordinal(), posKey)` — which the route tests pin (§13).
  Multiple rods discharge in the same canonical order at P0.
- **Topology:** P1 connectivity is direct graph adjacency (`canConnect` on
  touching faces), exactly like the harness network. U19 wire spans and their
  loss model arrive in P5 without changing this route.

## 7. U05 — base jar slice, without eating PWR-06/PWR-07

U05's sealed summary says "tiered capacities". CP1A ships **only the base
100,000-Cg jar** and states exactly what remains:

- **Shipped now:** one `cuprum:leyden_jar` block; capacity
  `charge.leydenJarCapacityCg` = 100,000 Cg; caps per §6; visible fill stages;
  comparator output; envelope persistence (break/re-place keeps charge via the
  BE item-data path only if a later wave sanctions it — P1 jars drop empty, the
  PWR-06 "carried while charged" behavior is explicitly that row's contract,
  **not** U05's).
- **Deliberately not shipped (the pending "tiered capacities" completion):**
  the small tier is **PWR-06 Small Leyden Cell** (25,000 Cg, W5) and the large
  tier is **PWR-07 Grand Leyden Array** (3×3×3 rack multiblock, 100,000 ×
  inserted jars, W5). The U05 tier clause is *completed by* those W5 rows; CP1A
  duplicating them would violate the family contract. Until W5, U05's
  tier-related acceptance is the base jar only.
- **Fill stages (exact):** blockstate integer property `fill` ∈ {0,1,2,3}:
  `fill = stored == 0 ? 0 : 1 + min(2, (3 * stored) / capacity)` (integer math) —
  empty / (0, ⅓) / [⅓, ⅔) / [⅔, full]. Updated on the existing throttled
  `sendBlockUpdated` cadence (≥10-tick deltas except transitions, API_PROBES
  posture).
- **Comparator formula (exact, vanilla container convention):**
  `signal = stored == 0 ? 0 : 1 + (14 * stored) / capacity` (integer division) —
  0 only when empty, 15 only when full, monotone in between. Pinned by
  `u05_jar_fill_stages_comparator` (§13).

## 8. Dome-slot binding and the U02 ripple (no new render machinery)

- **Before W4 (P2/P3):** the U01 dome renders as a **T2 visual** — a tinted
  translucent icosphere shell submitted through **vanilla RenderTypes only**
  (the W1D T2 pattern: vanilla pipeline + budgeted particles), T3 = boundary
  particles only, OFF = nothing. **No custom pipeline, no new RenderType** — the
  W1D census assertion (`worldFxTypes().size() == 1`) stays true through P3.
- **At W4:** `cuprum:holo_surface` **variant 0 becomes the U01 dome shell** — the
  dome consumes the reserved *dome slot* exactly as the CP0C census planned
  (ripple, arc stub, holo_surface, holo_interior = 4). U01's renderer switches
  its T1 rung to holo_surface variant 0 while keeping the P2 T2/T3 rungs as
  fallbacks. The dome never registers its own RenderType at any point.
- **U02 impact ripple:** reuses the **existing** `cuprum:fx_ripple` RenderType
  and pipeline, re-oriented tangent to the dome surface at the impact point. New
  **payload only** (`cuprum:s2c/fx/shield_impact`, ledger §3) → new snapshot
  record → enqueued into the **same 16-slot ripple ring** (`FxDispatcher`,
  `FxBudgets.MAX_RIPPLES = 16`) — which is precisely the SHD family perf budget
  ("ripple/echo payloads reuse the U02 ring buffer, max 16 concurrent ripples").
  Tier ladder, eviction, particle budgets, colorblind remap-at-snapshot and
  disconnect-clear semantics are inherited unchanged. `FxRipplePayload` itself is
  not touched (frozen after W1D).

## 9. Shaders: clean-room rule, GameTime probe, exactly-one-of-each diagnostics

- **Clean-room rule (restated, binding for every CP1A-descendant shader):** the
  CP0C §4 license rule applies verbatim — no copying or translating licensed
  shader source (Shadertoy default license is CC BY-NC-SA — incompatible);
  techniques are reimplemented from first principles/public-domain references,
  and every shader file carries the provenance ledger entry
  (`docs/shader-research/` pattern established by W1D's
  `W1D_FX_RIPPLE_PROVENANCE.md`).
- **GameTime probe (W4, both results acceptable):** repository truth
  (`docs/API_PROBES.md`, "Built-in GameTime uncertainty") is that `GameTime`
  lives in the `Globals` UBO, `MATRICES_FOG_SNIPPET` does not include it, and no
  probe yet proves a custom pipeline may bind `Globals`. W4 runs the probe both
  ways: compile (`precompilePipeline(...).isValid()` on the CI llvmpipe driver
  with `GLOBALS_SNIPPET` included) and runtime (a rendered frame whose output
  provably depends on the uniform). **A positive result** lets holo übershaders
  read `GameTime` directly. **A negative result is not a gate failure**: the
  binding fallback is the **CPU-packed phase** — the effective phase
  (`phaseTicksAccumulated` semantics, CP0C §2) is computed CPU-side per frame and
  packed into the provisional vertex-attribute contract (the W1D `RippleMath`/
  CPU-geometry precedent, scaled to attribute packing instead of tessellation).
  Either outcome is appended to `docs/API_PROBES.md` as W4 evidence. The CP0C
  §6.1(1) wording "including the built-in GameTime uniform" is hereby clarified
  (amendment, not contradiction): the gate requires the *probe to be run and its
  result recorded and designed-for*, not the uniform to exist.
- **Exactly one + one at W4:** ONE diagnostic surface variant (a debug checker/
  gradient proving packed-attribute variant dispatch) and ONE diagnostic interior
  scene (a minimal far-scene starfield proving the interior mode switch). Both
  are CP0-style infrastructure: no catalog entries, no recipes,
  diagnostics-namespace handbook coverage per D6. **All twenty-seven VFX rows —
  emphatically including VFX-11..14 — ship only in their cataloged waves (W13
  core / W15 stretch) as full features.**

## 10. Iris seam, and CI honesty about it

- **Injectable reflection seam (W4, U23-scoped per the CP0C D10 amendment):**
  `FxCompat` gains a package-visible seam
  `interface IrisActivePackQuery { boolean isShaderPackInUse(); }` with the
  production implementation resolving `net.irisshaders.iris.api.v0.IrisApi` **via
  reflection only** (no compile-time dependency, `irisLoaded()` guard first) and
  a test-injection setter following the repo's established seam pattern
  (`NetViolations`' overridable kick sink). `FxTierPolicy` consults it as
  `compatCap = T2` when active. The refresh hook is already wired
  (`FxReloadListener` → `FxCompat.refresh()`, W1D).
- **CI = simulation, honestly labeled:** CI cannot run real Iris. The client
  gametest `u23_iris_simulated_cap_t2` **injects** a query returning `true` and
  asserts `compatCap == T2` and 0 custom-pipeline submits since the flip. Its
  name and javadoc say *simulated*. **Real-Iris verification is a manual
  checklist item** in the W4 evidence appendix to `docs/API_PROBES.md`
  (launch with Iris + any pack, observe the cap log line and T2 visuals);
  CP1A forbids representing the simulation as end-to-end Iris proof.

## 11. Test infrastructure: the large template and the two-launch screenshot

- **Large gametest template:** the Fabric `@GameTest` annotation's `structure`
  parameter points into `modid/gametest/structure/`; the default
  `fabric-gametest-api-v1:empty` is 8×8×8 — too small for a radius-8 dome
  (17-block diameter) plus projectile flight paths. P2 adds ONE committed empty
  SNBT structure `cuprum-gametest:empty_24` (24×24×24, within vanilla's 48³
  limit) at `src/gametest/resources/data/cuprum-gametest/gametest/structure/empty_24.snbt`,
  used via `@GameTest(structure = "cuprum-gametest:empty_24", maxTicks = ...)` by
  the dome/interception tests. Charge-route and jar tests stay on the default
  8×8×8 (they fit; parallel-structure isolation per the W1B convention of
  same-tick delta assertions).
- **Two-launch deterministic screenshot mechanism (W4, CP0C §6.1(5)):** a new
  `scripts/holo_two_launch.sh` runs the client gametest suite **twice** (the
  `client_smoke.sh` Xvfb/allowlist harness pattern). Both launches inject the
  same explicit test-only `fxSeed` and phase tick via JVM properties
  (`-Dcuprum.holo.testSeed`, `-Dcuprum.holo.testPhase` — read only by the
  gametest entrypoint, never by production code paths), freeze the projector
  PAUSED (pinning the effective phase by the CP0C pause contract), set the
  identical fixed camera pose, force the 854×480 capture size, and take the same
  named screenshot. Launch 1 moves its capture to `build/holo-two-launch/reference.png`;
  launch 2's capture is compared against it by the script using the established
  region-scoped fuzzy comparison (≤0.5% mean-squared difference, the W1D
  template-comparison tolerance) — proving cross-launch determinism of
  (fxSeed, phase) → pixels without committing a machine-specific template.
  The perf/counter side stays in-test; only the cross-launch pixel identity
  lives in the script, because one JVM cannot observe its own second launch.

## 12. Reviewed foundation-file changes (each a sanctioned, minimal diff)

CP1A sanctions exactly these edits to otherwise-frozen surfaces, each following
its established review mechanism:

1. **API lock** (`api/cuprum-api.lock` + `ApiFreezeTest`): the reviewed two-file
   diff per phase, covering exactly the new public content classes
   (`PowerContent`, `ShieldContent`, budgets classes, payload records). No
   existing entry changes.
2. **Config:** none. `configSchemaFreeze` list untouched (§3).
3. **Ownership:** the U01 controller records its placer via the existing
   `OwnershipService` (W1A surface, `cuprum.admin.override` bypass) — used in
   P2 only to attribute the dome (break protection and config gating are later
   waves' contracts). No ownership API change.
4. **Handbook ratchet** (`HandbookPlanCompletenessTest` + the completeness
   registry gametest): the W1E test pins "no shipped page claims a catalog
   slug" — correct while nothing was implemented, and **necessarily amended the
   moment P1 ships U04**. The sanctioned change: the test gains an explicit
   `IMPLEMENTED_CONTRACTS` allowlist (P1: `lightning_capture_rods`,
   `leyden_jar_batteries`; P2: `+storm_shield_core`; P3:
   `+storm_shield_projectile_interception`; W4: `+holosphere_dreamscape_projector`),
   asserting shipped pages claim exactly the allowlisted slugs (at their
   deterministic planned page ids, e.g. `cuprum:power/lightning_capture_rods`)
   and no others. The runtime completeness gate keeps enforcing that every
   shipped block/item is documented with EN/DE parity and `exempt.json` stays
   size 0.
5. **Access widener:** the single-rule `cuprum.accesswidener` (§5) plus its two
   wiring lines (`fabric.mod.json`, `build.gradle`). Any future AW rule requires
   its own amendment.
6. **`FxBudgets`:** P3 adds `SHIELD_IMPACT_PAYLOAD_MAX_BYTES = 32`; W4 applies
   the CP0C-sanctioned holo budget additions (holo vert/callback budgets, HOLO
   particle carve-out). No existing constant changes.
7. **CP0C §6.1(1) clarification** recorded in §9 (GameTime probe outcome
   neutrality) and **§6.1(8) clarification** recorded in §13 (W4 ms figures are
   logged evidence, not CI gates — the binding CI gates at W4 are counters; hard
   wall-clock gating happens only at W14 `w14_holo_frame_budget`, per CP0C's own
   "counter-now/milliseconds-later" rule).

## 13. Phase-by-phase named tests and exit gates

Naming follows the repo conventions: MC-free JUnit in `src/test`, server
GameTests and client GameTests in `src/gametest` (INDEX prefixes
`server_gametest:` / `client_gametest:` map to method/test names).

**P1 — U04/U05** (all on the default 8×8×8 template unless noted)

| Test | Proves |
|---|---|
| `RodBufferPolicyTest` (unit) | room-gated offer formula: min(buffer, 1,000, roomExcludingSelf); never negative; config-capacity binding |
| `JarFillStageTest` (unit) | exact `fill` and comparator integer formulas at boundary values (0, 1, ⅓·cap ± 1, ⅔·cap ± 1, cap) |
| `u04_scripted_strike_full_deposit` | scripted `LightningBolt` on the rod deposits exactly 270,000 Cg; buffer == strikeDepositCg |
| `u04_channeling_strike_deposit` | channeling-path bolt triggers the same full deposit |
| `u04_poi_natural_attraction_registered` | every rod blockstate resolves the `minecraft:lightning_rod` POI type; `ServerLevel.findLightningRod` returns a placed rod's column |
| `u04_second_strike_overflow_vents_exact` | strike onto a non-empty rod: buffer clamps at capacity, `ventedTotal` grows by exactly the overflow |
| `u04_rod_discharge_room_gated` | full jars ⇒ rod offers 0 and buffer holds; freeing room resumes discharge at exactly 1,000 Cg/t |
| `u05_jar_capacity_and_caps` | capacity 100,000; insert and extract actuals cap at 1,000 Cg/t |
| `u05_jar_fill_stages_comparator` | blockstate `fill` and comparator signal match §7 formulas in-world |
| `u05_jar_persistence_envelope` | §3.1 envelope round-trip; unload/reload keeps stored Cg (D7 inheritance proof) |
| `u04_u05_strike_to_jar_route_deterministic` | full strike drains into 3 jars in exactly 270 ticks, jars filling in canonical order; conservation: Σ == 270,000, vented == 0 |
| client: jar fill-stage screenshot appended to the smoke set | visual fill stages T2 |

**Exit gate P1:** all of the above green **plus** the standing suites:
`./gradlew check build` (catalog validation, parity digest byte-identical to
CP0C, all pre-existing tests untouched), `runGameTest`, datagen determinism,
server smoke + restart probe (rod/jar state across a real restart), client
smoke with the extended screenshot list, handbook completeness (new pages
`cuprum:power/lightning_capture_rods`, `cuprum:power/leyden_jar_batteries`,
EN/DE), API-lock reviewed diff, `configSchemaFreeze` unchanged.

**P2 — U01** (dome tests on `cuprum-gametest:empty_24`)

| Test | Proves |
|---|---|
| `u01_multiblock_pattern_loaded` | reloader delivers `cuprum:storm_shield_core` with §4's exact dims/members/controller cell |
| `u01_multiblock_forms_and_faults` | formation from the built structure; member-break fast path faults; repair re-forms |
| `u01_dome_activates_with_upkeep_32` | formed + charged ⇒ ACTIVE; drains exactly 32 Cg/t from jar storage via the consumer path |
| `u01_upkeep_starves_and_collapses` | storage exhausted ⇒ dome drops within the documented poll window; resumes when recharged |
| `u01_owner_recorded` | placer registered through `OwnershipService` |
| `u01_persistence_restart` | controller state (formation, charge link, owner) across the restart probe |
| client: `u01_dome_t2_shell_renders` + screenshot | T2 shell visible, **0 custom-pipeline submits**, world-FX RenderType census still 1 |

**Exit gate P2:** P1 gate repeated (all suites) + the P2 table + handbook page
`cuprum:shield/storm_shield_core` (EN/DE).

**P3 — U02**

| Test | Proves |
|---|---|
| `ShieldImpactPayloadTest` (unit) | codec bounds: octahedral direction round-trip, reject-not-clamp, ≤32 B |
| `u02_arrow_intercepted_at_surface` | incoming arrow removed at the boundary, never inside |
| `u02_intercept_cost_exact` | cost == 200 + 40·(blocks/tick speed) Cg per intercept, drawn from storage |
| `u02_no_charge_no_intercept` | empty network ⇒ projectile passes (honest failure mode) |
| `u02_impact_payload_bounded` | one S2C `shield_impact` per intercept; the ≤32 B wire budget holds; 0 C2S |
| client: `u02_impact_ripple_renders` + screenshot/recording | ripple on the **existing** `fx_ripple` RenderType at the impact point; ring-pool eviction shared with W1D ripples; census still 1 |

**Exit gate P3:** cumulative suites + P3 table + handbook page
`cuprum:shield/storm_shield_projectile_interception` (EN/DE).

**P4 = W4 — U23 + prototype gate:** the CP0C §6.1 items 1–8 verbatim, with the
two §12(7) clarifications: item 1's GameTime clause is satisfied by a **recorded
probe outcome** (either sign) + the CPU-packed fallback design; item 8's ms
figures are captured and logged as evidence while the **CI-binding** assertions
at W4 are the counter gates (callbacks ≤2/projector, ≤4,096/≤8,192 verts, HOLO
32/128 carve-out, flash governor ≤3 Hz, 0 custom submits under REDUCED/Iris-sim).
Plus `u23_iris_simulated_cap_t2` (§10) and the two-launch script (§11). Hard
wall-clock gating remains exclusively **W14** (`w14_holo_frame_budget`).

**P5/P6:** deferred rows resume against their own sealed acceptance rows and test
ids (e.g. `server_gametest:shd04_strike_capture`,
`client_gametest:vfx11_astronaut_drift`, `vfx12_meteor_rate`,
`vfx13_star_cadence`, `vfx14_taco_party`); CP1A intentionally does not re-specify
them — the concept docs already do.

## 14. Review reconciliation record

Findings of the two pre-CP1A reviews, reconciled against repository truth:

1. **"VFX-11..14 used as W4 diagnostics" (Scopefehler)** — upheld. Repository
   truth: `VFX.md` rows pin them to W13 with recipes/advancements; CP0C grants W4
   exactly one diagnostic surface variant + one interior scene, non-catalog.
   Resolution: §1/§9 — full features at W13, never diagnostics.
2. **"Sequencing rewrote waves"** — upheld. Resolution: §1/§2 — honest phase
   table, sealed `planned_wave` untouched, per-row deferral rationale.
3. **"270,000 vs 243,000 Cg contradiction"** — reconciled, not upheld as a
   blocker. Repository truth (`RepairedConceptSemanticsTest`, SHD-04, PWR-24):
   the 10% is a *redirect* loss of those features. Direct callbacks deposit the
   full 270,000 Cg (§5).
4. **"Route bypasses or edits the frozen graph"** — resolved by audit. The chosen
   route (§6) uses only `depositSurge`, the normal producer path, and the frozen
   read-only diagnostics surface; the storage-only and unconditional-producer
   alternatives are rejected with the code facts that kill them.
5. **"Invented config keys / fifth RenderType / unnamed ids"** — resolved by the
   ledger (§3): zero new config keys, zero new RenderTypes through P3 and a
   frozen census of 4 after W4, every id named.
6. **"W4 wall-clock gate vs counter rule ambiguity in CP0C"** — reconciled:
   CP0C's own perf section states counters-in-CI/ms-at-W14; §6.1(8) ms figures
   are evidence, the binding W4 CI gates are counters (§12(7), §13).
7. **"GameTime uniform assumed"** — upheld; repository truth is the recorded
   API_PROBES uncertainty. Resolution: probe with both outcomes acceptable and
   the CPU-packed phase fallback (§9).

## 15. CP1A exit (delta over the CP1 exit checklist)

The FOUNDATION_PLAN §6 CP1 exit checklist applies unchanged (including
"digest byte-identical to CP0C" and "`catalog/**` byte-identical to CP0C").
CP1A adds: every phase gate of §13 green in order, the §12 reviewed diffs each
landed as their own commit, the W4 evidence appendix present in
`docs/API_PROBES.md`, and zero edits to `catalog/**` or `docs/feature-concepts/**`
across the entire CP1A range.
