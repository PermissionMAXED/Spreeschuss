# CP1A — The Playable Vertical Slice (binding amendment, revision 6)

Status: **BINDING**. This document is the authoritative sequencing and contract
amendment for Cuprum's first post-foundation implementation work, issued at/after
the W1E foundation commit `7b1d9fe`. Revision 6 supersedes revision 5 after the
review round recorded in §14 (round 6) demanded exact runtime APIs;
§14 records every finding of all six review rounds and how each was reconciled
against repository truth. Where this document is silent,
`docs/foundation/FOUNDATION_PLAN.md` (as amended by
`docs/expansions/CP0C_HOLOSPHERE.md`) and the sealed concept docs govern; where a
rejected plan or an earlier revision disagrees with this document, this document
wins.

**Hard scope rule:** CP1A touches **no** file under `catalog/**` and **no** file
under `docs/feature-concepts/**`. The catalog stays at exactly **300 entries**, and
the `verifyConceptParity` digest stays **byte-identical to CP0C**. Everything below
is expressed as implementation contracts on top of the sealed metadata — never as
metadata edits.

---

## 1. The honest sequence

The actual implementation order, with no wave-metadata fiction:

| Phase | Content | Cataloged wave of the content |
|---|---|---|
| **P1** | U04 Lightning-Capture Rods + U05 Leyden Jar base slice (server logic, T2/T3 visuals only) | W1 (cataloged, never shipped by the W1 foundation waves — plan D6 forbade catalog gameplay in W1A–W1E) |
| **P2** | U01 Storm Shield Core — multiblock, dome tick, upkeep, **T2 server/visual slice** | W2 |
| **P3** | U02 Shield Projectile Interception + oriented impact ripple | W2 |
| **P4 = W4** | U23 consolidated: projector block/BE/persistence/guarded payloads **plus** the CP0C §6.1 prototype gate — both übershader pipelines (`cuprum:pipeline/holo_surface`, `cuprum:pipeline/holo_interior`), variant-dispatch proof per §9, the Iris runtime gate, the GameTime probe | W4 |
| **P5** | Every remaining pre-W13 catalog row, exactly bounded in §2 | W1/W2/W3/W4/W5+ |
| **P6 = W13** | The 20 core VFX rows — emphatically including **VFX-11..14** — implemented as **full features against their exact `VFX.md` §5.1 rows** (recipes, acquisition advancements, upkeep adders, named client gametests). **Never as diagnostics.** | W13 |

Honesty clauses (binding):

- P1 implements U04/U05 *late relative to their cataloged W1 label*. That label was
  always a planning statement; plan D6 explicitly shipped **zero** catalog gameplay
  in W1A–W1E. CP1A is the first wave allowed to claim catalog contracts.
- P2/P3 pull U01/U02 **forward within W2** ahead of the other W2 rows. All
  deferred rows are listed with reasons and owners in §2 — the `planned_wave`
  metadata is **not** rewritten to match, because it is sealed and because
  rewriting planning metadata to match execution order would erase the record of
  the decision.
- The W4 U23 prototype gate (CP0C §6.1) **blocks** P6: bulk W13 scene work may not
  start until every gate item has committed evidence.
- VFX-11..14 (Astronaut Drift, Meteor Shower, Shooting Star, Taco Party — the
  VFX-11, VFX-12, VFX-13 and VFX-14 rows of the `docs/feature-concepts/VFX.md`
  §5.1 table) are **catalog features of W13**. The rejected plan's use of them as
  W4 "diagnostic scenes" was a scope error: W4 gets exactly one *non-catalog*
  diagnostic surface variant and one *non-catalog* diagnostic interior scene
  (Charge-Probe precedent, no catalog entries), and the four cartridges arrive
  only in W13 as full features with their cataloged tests
  (`client_gametest:vfx11_astronaut_drift`, `vfx12_meteor_rate`,
  `vfx13_star_cadence`, `vfx14_taco_party`).

## 2. Deferral and assignment record (no `planned_wave` fiction, no orphans)

Every entry below keeps its sealed `planned_wave` value. CP1A defers or assigns
actual implementation as follows:

| Entry | Sealed wave | Actual phase | Reason / assignment |
|---|---|---|---|
| U06 Oxidation Weapons | W1 | P5 (first batch) | W1-cataloged combat row owned by the combat specialist (the W1E `HandbookPlanCompletenessTest` comment already records U04/U05/U06/U07/U16/U20 as "owned by other specialists"); independent (no deps), not on the U04→U05→U01→U02 spine. |
| U07 Oxidation Armor | W1 | P5 (first batch) | Same — combat specialist, no deps. |
| U16 Weighted Plates | W1 | P5 (first batch) | Same — utility row, no deps. |
| U20 Oxidation Copper Spikes | W1 | P5 (first batch) | Same — combat row, no deps. |
| U03 Shield Mob Repulsion | W2 | P5 | Depends on U01 only, but owns the canonical **Shock** effect registration (INDEX vocabulary) — a cross-family contract (OXI/TES/MOB reference it) that deserves its own reviewed slice. The U01 dome tick is built in P2 so SHD/U03 logic can ride it later without a second entity scan (SHD perf budget). |
| U19 Conductive Climbing Wire | W2 | P5 | The P1 rod→jar route works over direct graph adjacency; U19's binding line-loss model (2 pp / 0.5 pp per 16-block span) is a self-contained transmission contract not needed for the slice spine. |
| U11 Pneumatic Item Tubes | W2 | P5 | Independent logistics row, no dependency on the spine. |
| U13 Copper Fans | W2 | P5 | Independent mobility row. |
| U14 Copper Grappling Hook | W2 | P5 | Independent mobility row. |
| U17 Backpack Personal Shield | W4 | P5 (after P4) | Needs a mature U01+U05; a miniaturization of systems the slice is still stabilizing. |
| U21 Weather Manipulator | W4 | P5 (after P4) | Needs U04/U05 plus storm-summoning gameplay; W4 capacity is consumed by the U23 consolidation and prototype gate (CP0C wave table). |
| U22 Dynamic Handbook | W4 | P5 (after P4) | The "generated from the catalog, never stale" contract only pays off once a meaningful share of features exists; until then the W1E ratchet (§12) keeps shipped pages honest. |

**P5 boundary (binding, so W13/P6 ownership is unambiguous):** P5 is exactly the
set {U06, U07, U16, U20} ∪ {U03, U11, U13, U14, U19} ∪ W3 {U08–U10, U12, U15,
U18} ∪ {U17, U21, U22} ∪ the cataloged W5–W12 waves, **up to and excluding W13**.
P5 may not touch any VFX row; P6 (= W13, split-table W13a/W13b allowed per CP0C)
may not absorb any P5 row. The 7 VFX stretch rows stay W15.

## 3. ID ledger — every P1–P3 runtime id

All ids follow the frozen conventions: blocks/items registered by module-owned
`*Content` classes (plan D4), payload ids `cuprum:{c2s|s2c}/<domain>/<action>`
(plan D3), gametest content under the `cuprum-gametest` namespace (plan D6).

**Blocks / items / block entities**

| Phase | Registry | Id | Owner class |
|---|---|---|---|
| P1 | block + item | `cuprum:lightning_capture_rod` | `power/PowerContent` (new module class, D4 pattern of `MachineContent`) |
| P1 | block entity | `cuprum:lightning_capture_rod` (graph-lifecycle anchor only — node registration rides `BLOCK_ENTITY_LOAD`/`UNLOAD`; the BE stores no charge) | `power/PowerContent` |
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
| P3 | `cuprum:s2c/fx/shield_impact` | S2C | dome center `BlockPos` (8 B) + **`normalPacked24`** — the outward unit normal in the §8 24-bit signed-component packing; valid range [0, 0xFFFFFF] with the zero vector 0x000000 additionally rejected (`VAR_INT` ≤4 B, since 24 bits need four 7-bit groups) + **`surfaceOffsetQ8`** — the Q8.8 distance from dome center to the impact point along the normal, i.e. the dome radius; valid range (0, `SHIELD_IMPACT_MAX_OFFSET_Q8` = 16,383], decode rejects outside it (`VAR_INT` ≤2 B, since 16,383 = 2¹⁴−1 is the 2-byte VAR_INT ceiling) + `colorArgb` (`VAR_INT` ≤5 B) + **event nonce**, 8-bit wrapping per-dome counter (`VAR_INT` ≤2 B, decode rejects values outside 0..255) + server `gameTime` (`VAR_LONG` ≤10 B) — 8+4+2+5+2+10 = **≤31 payload bytes**, frozen constant `SHIELD_IMPACT_PAYLOAD_MAX_BYTES = 32` beside `RIPPLE_PAYLOAD_MAX_BYTES` in `FxBudgets`. This is the **one coherent representation** (§8): the payload carries center + packed normal + offset; the packed int travels **unchanged** through snapshot, pool and visitors, and every client derives the identical impact point by the §8 pinned formula `Vec3.atCenterOf(center) + decodedNormal × (surfaceOffsetQ8 / 256.0)`; no exact-impact-center coordinates and no visual radius are sent — the impact ring's visual max radius is the client-side constant `SHIELD_IMPACT_RING_RADIUS_Q8` (§12(7)). Sent through the §8 per-client send window. The nonce gives two same-tick impacts on one dome distinct pool identities (§8). |

No new C2S payload exists in P1–P3: the slice ships **no GUI** and no client-to-
server interaction beyond vanilla block use. `FxRipplePayload` stays frozen
(client-fx.md §14: new effects add NEW payload records — exactly what
`shield_impact` is). W4 payloads are the CP0C §2.2 ledger, unchanged.

**Permissions:** P1–P3 add **no** permission node. `cuprum.diagnostics` and
`cuprum.admin.override` (W1A `perm/Nodes`) remain the only nodes until W4 adds
`cuprum.holo.configure` (CP0C) and W7 adds `cuprum.shield.configure` (SHD header
contract, with the dome-config GUI it gates).

**Config keys:** P1–P3 add **zero** keys to `cuprum-common.json5`; the
`configSchemaFreeze` GameTest key list stays byte-identical. Already-frozen keys
carry the slice: `charge.strikeDepositCg` (270,000), `charge.leydenJarCapacityCg`
(100,000), `charge.passiveBaselineCgPerTick` (5). All remaining P1–P3 balance
constants are **code-pinned** `public static final` constants (the `FxBudgets`
precedent) in a new MC-free `power/PowerBudgets` and `shield/ShieldBudgets`,
asserted by tests:

| Constant | Value | Meaning |
|---|---|---|
| `MAX_PENDING_SURGES_PER_NODE` | 4 | pending-surge queue bound per rod position (§6) |
| `SURGE_DRAIN_INSPECTIONS_PER_TICK` | 8 | per-level drain-point **inspection** budget — every looked-at entry counts, including dormant/dirty skips; at most ONE queued amount deposits per inspected position, so ≤8 `depositSurge` calls/tick (§6) |
| `JAR_EXTRACT_CG_PER_TICK` | 1,000 | jar `maxExtractPerTick()` (base-slice, non-catalog; W5 PWR transmission rows own player-facing rates) |
| `DOME_RADIUS` | 8 | SHD-01 baseline "no coil ⇒ radius 8" |
| `DOME_UPKEEP_CG_PER_TICK` | 32 | `ceil(0.5·R²)` at R = 8 (SHD header formula) |
| `INTERCEPT_BASE_CG` / `INTERCEPT_CG_PER_SPEED` / `INTERCEPT_SPEED_CAP_Q8` | 200 / 40 / 2,560 | §8 exact cost formula |
| `ESCROW_CAPACITY_CG` | 1,280 | dome escrow buffer: upkeep (32) + two worst-case intercepts (2 × 600) + headroom (§8) |
| `ESCROW_UPKEEP_RESERVE_CG` | 32 | escrow floor intercepts may not spend below **while this game tick's upkeep is still unpaid** (§8 upkeep-preservation rule) |

The jar's `maxInsertPerTick()` is **not** a separate constant: it returns
`capacity()` by contract (§7 explains why, tied to the audited shared-column
registration fact).

**Persistence schema:** the P1 pending-surge queue (§6) lives in the existing
`cuprum_charge_graph` SavedData as two new body fields, both `optionalFieldOf`
with defaults: bounded `pending_surges` (default empty) and the drain cursor
`pending_surge_cursor` (a posKey `long`, default `Long.MIN_VALUE` = "start at
the lowest key"). Following the repo's own precedent (the recorded v0 → v1
identity step), `CuprumSchema.WORLD` bumps 1 → 2 with identity
`StateMigrations` steps registered for **both** WORLD-domain SavedData
(`cuprum_charge_graph` and `cuprum_state_probe` — the constant is shared, so
both domains get their 1 → 2 step). Hostile-decode posture for the new fields
is **field-local** (§6): malformed queue entries are trimmed/dropped with a
WARN, and a malformed cursor falls back to its default — a bad queue field can
**never** fail the whole record decode or default `nodes`/`vented_total`. This
is a sanctioned reviewed change to the W1A/W1B persistence envelope (§12).

**Gametest structure:** one new template, `cuprum-gametest:empty_24` (§11). No
other structure ids.

**RenderTypes (exact census trajectory, binding):**

| Point in time | Registered world-FX RenderTypes | Count |
|---|---|---|
| W1D (today) through P3 | `cuprum:fx_ripple` | **1** |
| W4 / P4 | + `cuprum:holo_surface`, `cuprum:holo_interior` | **3** |
| The wave that ships the arc effect's owner (a P5 wave; the CP0C "census after CP0C waves" line describes this end state, not W4) | + arc | **4** |

There is never a fifth: `FxBudgets.MAX_WORLD_FX_RENDER_TYPES = 4` and the census
assertions stay binding. U02 adds **zero** RenderTypes (§8); WEA-13 reuses
`holo_interior` per CP0C.

## 4. U01 multiblock JSON (exact design, inside the frozen caps)

The frozen reloader caps are `MAX_DIMENSION = 16` per axis, `MAX_CELLS = 512`
member cells, **`MAX_KEY_ENTRIES = 64` key entries** (`PatternShape`; the
separate `MAX_STATE_ENTRIES = 32` cap bounds the per-matcher `state` property
map, not the key). The Storm Shield Core is a deliberately compact 3×3×3
(27 cells, 15 members, 3 key entries) — the dome is projected, the machine is
not the dome:

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
- Dome geometry: radius `ShieldBudgets.DOME_RADIUS` = 8 centered on the
  controller, upkeep 32 Cg/t (§3 constants).
- **Ownership:** on formation the controller BE stores a claim created with the
  existing `Claim.ofPlacer(ServerPlayer)` factory (owner + `OWNER_ONLY` policy)
  in its state envelope; later interactions evaluate it through the existing
  `OwnershipService.allows(player, claim, access)`. There is no "recorder"
  service call — W1A ships the model and the evaluator only, and the slice uses
  exactly those.

## 5. U04 — POI attraction, subclassing, and the full-callback contract

**One access widener, no mixin.** New file `src/main/resources/cuprum.accesswidener`
(wired via `"accessWidener"` in `fabric.mod.json` and `loom.accessWidenerPath` in
`build.gradle` — the repo's first and only AW), containing exactly one rule:

```
accessWidener v2 named
accessible method net/minecraft/world/entity/ai/village/poi/PoiTypes registerBlockStates (Lnet/minecraft/core/Holder;Ljava/util/Set;)V
```

At `PowerContent.init()` (verified 1.21.9 signatures — `Registry` inherits
`getOrThrow(ResourceKey<T>) → Holder.Reference<T>` from `HolderGetter`; there is
no `getHolderOrThrow` in 1.21.9):

```java
PoiTypes.registerBlockStates(
    BuiltInRegistries.POINT_OF_INTEREST_TYPE.getOrThrow(PoiTypes.LIGHTNING_ROD),
    Set.copyOf(LIGHTNING_CAPTURE_ROD.getStateDefinition().getPossibleStates()));
```

**Exactly which vanilla path this relies on (audited):**

- `PoiTypes.registerBlockStates` mutates only the static
  `PoiTypes.TYPE_BY_STATE` map. The `PoiType` **record's `matchingStates` set is
  immutable** (`Set.copyOf` in its canonical constructor) and is **not** touched
  by the injection.
- The complete natural-attraction path consults `TYPE_BY_STATE` exclusively:
  (a) `ServerLevel`'s block-state-change hook calls `PoiTypes.forState(old/new)`
  to add/remove POI records when a rod is placed or removed; (b) `PoiManager`'s
  chunk-section scan uses `PoiTypes::hasPoi` / `PoiTypes.forState`; (c) the
  private `ServerLevel.findLightningRod` matches **stored records** via
  `holder.is(PoiTypes.LIGHTNING_ROD)` — a holder-key comparison, not a
  block-state comparison. All three legs therefore see the injected states.
- Consequence of the immutable `matchingStates`: `poiType.is(BlockState)`
  returns `false` for our rod states. Audit result: no caller on the lightning
  attraction path uses it, and no other vanilla system queries the
  `lightning_rod` POI by state; this asymmetry is accepted and documented
  rather than papered over.
- Vanilla targeting also requires the rod to be **surface-exposed**:
  `findLightningRod` filters candidates to `WORLD_SURFACE − 1` heightmap
  positions. The handbook page documents "rods must see the sky to attract
  natural strikes"; the deposit path itself (below) has no such condition.
- One non-POI leg completes the parity audit: `ServerLevel.tickThunder`
  suppresses the skeleton-trap horse spawn when the strike target sits on a
  block in **`BlockTags.LIGHTNING_RODS`** — a block tag, independent of the POI
  map. P1 datagen therefore adds `cuprum:lightning_capture_rod` to
  `minecraft:lightning_rods` so the capture rod matches vanilla rod behavior
  there too.

**Black-box POI test (no private-method reliance):** `findLightningRod` is
`private`. The gametest `u04_poi_natural_attraction_registered` therefore proves
the injection through **public** API only: it places a rod, then asserts
`PoiTypes.forState(rodState)` is present for every rod blockstate and that
`serverLevel.getPoiManager().findClosest(holder -> holder.is(PoiTypes.LIGHTNING_ROD),
pos, radius, PoiManager.Occupancy.ANY)` — the exact public query the private
vanilla method delegates to — returns the placed rod's position.

**Exact block definition (verified against the 1.21.9 sources and the repo's
own custom-block pattern).** Vanilla `LightningRodBlock` is **not** an
`EntityBlock` (it extends `RodBlock implements SimpleWaterloggedBlock` and
declares `public static final MapCodec<LightningRodBlock> CODEC =
simpleCodec(LightningRodBlock::new)` with a `public MapCodec<? extends
LightningRodBlock> codec()` override). The capture rod cannot use the repo's
usual `BaseEntityBlock` base (`DiagnosticCoilCoreBlock` precedent) because it
must inherit the rod hierarchy, so it implements the interface directly:

```java
public class LightningCaptureRodBlock extends LightningRodBlock implements EntityBlock {
    public static final MapCodec<LightningCaptureRodBlock> CODEC =
            simpleCodec(LightningCaptureRodBlock::new);

    public LightningCaptureRodBlock(BlockBehaviour.Properties properties) {
        super(properties);
    }

    @Override
    public MapCodec<? extends LightningRodBlock> codec() {
        return CODEC;      // 1.21.9 pattern: own simpleCodec, override matches vanilla's signature
    }

    @Override
    @Nullable
    public BlockEntity newBlockEntity(BlockPos pos, BlockState state) {
        return new LightningCaptureRodBlockEntity(pos, state);   // EntityBlock's one required method
    }
    // getTicker: NOT overridden — EntityBlock's default returns null. The rod has no BE
    // ticker; all server work is manager-driven (§6 drain point).

    @Override
    public void onLightningStrike(BlockState state, Level level, BlockPos pos) {
        super.onLightningStrike(state, level, pos);   // vanilla power pulse + behavior preserved
        if (level instanceof ServerLevel serverLevel) {
            ChargeGraphManager.of(serverLevel)
                    .queueSurge(pos, ChargeBalance.strikeDepositCg()); // full 270,000 Cg, §6
        }
    }
}
```

(`ChargeGraphManager.of(ServerLevel)` is the actual accessor; there is no `get`.)
Inheriting `LightningRodBlock` keeps `POWERED`/`FACING`/waterlogging state and
behavior — which is also what makes the POI state-set injection well-formed.
`LightningCaptureRodBlockEntity` is a minimal BE (the graph-lifecycle anchor and
`ChargeApi.NODE` provider; no charge, no tick). Its `BlockEntityType` is
registered in `PowerContent` with `FabricBlockEntityTypeBuilder.create(...)`
into `BuiltInRegistries.BLOCK_ENTITY_TYPE` — the exact `MachineContent`
precedent — and node registration/freezing rides the manager's already-wired
`ServerBlockEntityEvents.BLOCK_ENTITY_LOAD`/`BLOCK_ENTITY_UNLOAD` hooks plus
`onPlace`/`preRemoveSideEffects`, like every other node.

**Full 270,000 Cg for every vanilla callback — including channeling.** Confirmed
against `LightningBolt` sources: `powerLightningRod()` runs for every bolt that
lands on a rod regardless of cause (natural storm strike, channeling trident,
`/summon`, skeleton-trap), and the `visualOnly` flag suppresses only fire creation
and entity damage — **not** the rod-power callback. Every callback invocation
queues the full configured `strikeDepositCg`. The 10%-loss figures elsewhere in
the concepts (SHD-04 "243,000 Cg = 270,000 minus 10% arc loss", PWR-24 "minus 10%
string loss") are **redirection losses of those specific later features**, not
properties of a direct hit (repository truth: `RepairedConceptSemanticsTest` pins
243,000 only for SHD-04/PWR-24).

## 6. U04→U05 route: queued strikes into surge-absorbing jars

Revision 1's route (rod = STORAGE+PRODUCER with a per-tick room-gated offer read
from `nodeReport`) is **withdrawn**: it scanned island members per rod per tick,
its "no vent" claim was false under races, and it fought the allocator instead of
using the surge path the core was built around. The replacement uses the frozen
machinery as designed.

**Audited facts the route is built on** (all verified in `ChargeGraphCore` /
`ChargeGraphManager` at `7b1d9fe`):

1. `ChargeGraphManager.depositSurge(BlockPos, long)` → `core.depositSurge`: fills
   the origin node's own storage first (only if it has the STORAGE role), then
   feeds **`SurgeAbsorber`s in the origin's loaded sub-island in canonical
   order** — each feed bounded by the absorber's remaining per-tick-window
   absorb budget and the relay path cap — and **vents the remainder exactly**
   (immediately counted into `ventedTotal`). Only actual acceptance drives
   accounting.
2. For an **inactive or rebuild-pending (dirty) origin node the core returns 0
   and neither mutates nor vents anything** — the exact property that makes
   queue-and-retry lossless.
3. The absorb budget **rides the `maxInsert` column**: registration sets
   `maxInsert = storage.maxInsertPerTick()` for `ChargeStorage` nodes, and the
   `Long.MAX_VALUE` absorber fallback applies only when that column is still 0.
   A dual `ChargeStorage`+`SurgeAbsorber` node therefore has **one shared
   column** for both its normal-insert request bound and its absorb budget —
   a fact the jar design must (and does) embrace, not work around.
4. The allocator has no storage→storage phase, and producer offers drained at
   P0 vent if unplaced — which is why the rod is **neither** a producer nor a
   storage in this route.
5. `SurgeAbsorber.absorbSurge(long)` returns the actual absorbed amount;
   `ChargeStorage.insertSurge(long)` is the capacity-only fill path; both are
   frozen W1B interfaces with no shipped implementation yet — U05 is the first.
6. The manager's per-level `endWorldTick()` runs `core.runRebuild(budget)` then
   `core.tick(access)` then `maybeSnapshot()` — giving a natural "after graph
   maintenance" insertion point.

**The rod (U04): a connector/capture node.**

- The rod BE implements plain `ChargeNode` only (role mask 0 — validated legal
  by `addNode`; mask-0 nodes join islands via adjacency and are skipped by every
  allocator phase). It stores no charge, produces nothing, and exists in the
  graph solely as the strike's deposit origin and topological connector.
  `canConnect` allows all faces. BE registration/unregistration rides the
  standard `BLOCK_ENTITY_LOAD`/`UNLOAD` + `onPlace`/`preRemoveSideEffects`
  lifecycle every other node uses.
- `onLightningStrike` (§5) calls the **new manager method
  `public long queueSurge(BlockPos origin, long amountCg)`** — a sanctioned,
  explicitly lock-reviewed **amendment to the frozen `charge` package public
  surface** (§12(1)); the exact signature is pinned here so no other name or
  shape may be implemented. It returns the amount actually queued (0 when
  dropped). It validates a node or dormant record exists at the origin (else
  the amount is dropped with a WARN log and a saturating `droppedSurgeCg`
  diagnostic counter, exposed by a new lock-reviewed accessor
  `public long droppedSurgeCgTotal()` — never silently), then appends the
  amount to the per-level **pending-surge queue** and marks `queueDirty`.

**The pending-surge queue (per level, inside `ChargeGraphManager`):**

- Structure: ordered map `posKey → FIFO list of pending amounts`, plus a
  persisted **drain cursor** (a posKey). The global order is **ascending signed
  `posKey` treated as a ring**; each tick's iteration starts at the smallest
  key ≥ cursor and wraps. Reconciliation with "canonical position order"
  (binding): the *order* is always the canonical ascending-posKey order — the
  cursor only chooses the *starting point* on that ring, so given identical
  (queue contents, cursor) state the iteration is fully deterministic, while
  across ticks the rotating start prevents low-position entries from starving
  high-position ones.
- Bound: `MAX_PENDING_SURGES_PER_NODE = 4` amounts per position. A fifth strike
  while full is dropped-before-deposit (WARN + `droppedSurgeCg`). The queue
  grows past 1 whenever strikes arrive faster than the one-head-per-position
  drain rate: **same-tick multi-strikes on one rod** (several bolts or
  channeling tridents in one tick queue together and drain one per subsequent
  tick), or any strikes while the node is frozen/dirty — always bounded by the
  4-cap.
- **Durability (two-tier dirtiness):** the manager keeps two flags.
  **`queueDirty`** is set by every queue **content/accounting** mutation —
  append (`queueSurge`), drain removal, drop — joins `maybeSnapshot()`'s
  early-return condition (`&& !queueDirty`) and is cleared **only after** the
  snapshot is written; without it, an enqueue onto an already-snapshotted,
  otherwise-idle state would never persist (`u04_queue_dirty_snapshot`, §13,
  pins exactly that scenario across a restart). **`cursorDirty`** is a
  runtime-only flag set by cursor advances; it does **not** enter the
  early-return condition — a cursor-only rotation over dirty/dormant entries
  (which can recur every tick while a frozen rod pends) must never force
  full-graph snapshots. The cursor is persisted **opportunistically**: whenever
  a snapshot is written for any qualifying reason (queue content, shadows,
  topology, vent total), the current cursor value rides along and `cursorDirty`
  clears. **Accepted, documented rewind on ANY restart:** because cursor-only
  motion never marks the SavedData dirty, Minecraft's save pass skips
  rewriting the file — so a clean shutdown or autosave after pure rotation
  persists the *older* cursor exactly as a hard crash would. Every restart may
  therefore rewind the cursor to its last snapshotted value; this rewinds only
  the fairness rotation start, never correctness (drains are idempotent
  removals; a rewound cursor merely re-inspects positions sooner). Fairness
  reconciliation: the `ceil(K/8)` inspection bound (below) holds within any
  single run; content mutations — the only thing that creates work — trigger
  snapshots that carry the cursor, so steady-state traffic keeps the persisted
  cursor fresh.
- Persistence: the queue and cursor are the §3 `pending_surges` /
  `pending_surge_cursor` fields of `cuprum_charge_graph` (schema
  `CuprumSchema.WORLD` 1 → 2 with migration). **Hostile decode is field-local:**
  each queue entry is decoded leniently — a key with >4 amounts is trimmed to
  its first 4, an amount outside `(0, STRIKE_DEPOSIT_CG upper bound]` is
  dropped, a structurally malformed entry is dropped, each with one WARN — and
  a malformed cursor falls back to its default. A hostile queue field can
  therefore **never** fail the whole-record decode or default `nodes` /
  `vented_total` to empty/0. Queued strikes survive unload and full restarts
  without a BE dependency.
- MC-free core discipline (plan D9) **without lock surface**: the queue's
  ordering/bounding/cursor policy is a small pure **package-private** class
  `PendingSurgeQueue` in `dev.cuprum.cuprum.charge` (beside its only consumer,
  `ChargeGraphManager`) — package-private members are invisible to the `javap
  -protected` API-lock listing, so **no public `charge.core` API is added and
  no lock diff is needed for this class** (§12(1)). It stays MC-free
  (primitives only) and is unit-tested by `PendingSurgeQueueTest` in the same
  package under `src/test` (the repo's established package-access test
  pattern). **Pinned package-private surface — complete, no nullable returns,
  no magic sentinels** (all posKeys are the canonical signed `long` keys; the
  backing structure is an ordered long-keyed map, so every keyed operation
  below is O(log K), K = position count):
  - `PendingSurgeQueue()` — empty queue, cursor `Long.MIN_VALUE`.
  - `long append(long posKey, long amountCg)` — returns the queued amount,
    0 on the 4-cap drop.
  - `boolean hasPending()`; `int positionCount()`.
  - `long firstKeyAtOrAfter(long key)` — smallest pending posKey ≥ `key`,
    wrapping to the smallest pending posKey overall when none is ≥ `key`.
    **Precondition `hasPending()`; throws `IllegalStateException` on an empty
    queue** — the ring functions are total for non-empty queues and callers
    gate on `hasPending()` first, so no sentinel long is ever returned.
  - `long nextKeyAfter(long key)` — smallest pending posKey **strictly
    greater than** `key`, wrapping to the smallest overall; same non-empty
    precondition/throw. **`key` itself need not be present** — it is a
    ceiling lookup on `key + 1`, so the drain may call it with a key whose
    last amount it just removed.
  - `long headAmount(long posKey)`; `void removeHead(long posKey)`;
    `long dropAll(long posKey)` (returns the dropped sum) — all three
    **require the key to be pending and throw `IllegalStateException`
    otherwise** (the drain only calls them for a key it just looked up on
    the server thread, so the throw is a corruption guard, not a code path).
  - `long cursor()`; `void setCursor(long posKey)`.
  - Codec-facing surface (allocation acceptable — snapshots/loads are rare):
    `long[] snapshotKeys()` — every pending posKey, ascending, a copy;
    `long[] amountsAt(long posKey)` — that key's FIFO amounts oldest-first, a
    copy (requires the key pending, throws otherwise);
    `void replaceAll(long[] posKeys, long[][] amounts, long cursor)` —
    wholesale replacement used by SavedData decode; requires strictly
    ascending keys, per-key 1..4 amounts, every amount > 0 — throws
    `IllegalArgumentException` on violation (the §6 field-local
    hostile-decode trim/drop runs **before** this call, so a throw here means
    a codec bug, not hostile data).
  Any rename requires a doc amendment, not a lock review.

**The drain point (server thread, per level, after graph maintenance):** at the
end of `endWorldTick()`, after `core.tick(access)` and before `maybeSnapshot()`
(so the snapshot persists post-drain queue state and post-deposit shadows), the
manager processes the queue. **The tick budget counts INSPECTED entries** —
every queued position the loop looks at, including dormant/frozen/dirty skips —
not merely completed deposits, so a wall of unprocessable entries cannot make
the loop scan unboundedly:

```
if (!queue.hasPending()): return                       // empty queue: exactly one O(1) check
steps = min(SURGE_DRAIN_INSPECTIONS_PER_TICK, queue.positionCount())
    // appends cannot interleave: queueSurge runs in the entity phase, this loop in endWorldTick
key = queue.firstKeyAtOrAfter(cursor)                  // ring wrap; non-empty guaranteed here
for i in 1..steps:                                     // every iteration inspects exactly one position
    entry = byPos(key)                                 // dormant/dirty skips consume budget too
    if entry == null:
        if dormantRecords contains key: (keep; retry on a later pass)
        else: queue.dropAll(key), droppedSurgeCg += Σ, WARN, queueDirty = true  // rod removed while pending
    else if !core.isActive(entry.coreId) or core.networkOf(entry.coreId) == -1:
        (keep; frozen or rebuild-pending: retry)       // dirty-node retry, budget still consumed
    else:
        amount = queue.headAmount(key)                 // exactly ONE amount per position per tick
        accepted = core.depositSurge(entry.coreId, amount, access)  // final; remainder vented exactly
        queue.removeHead(key); queueDirty = true; storedShadowChanged = true
    if (!queue.hasPending()):                          // this iteration removed the last entry
        cursor = key; cursorDirty = true               // any value is fair on an empty queue; pinned
        break                                          //   to the last inspected key for determinism
    key = queue.nextKeyAfter(key)                      // total for non-empty queues, works after removal
    cursor = key; cursorDirty = true                   // runtime flag; persisted opportunistically
```

- **Dirty-node retry** is exactly fact 2: the manager checks stability *before*
  depositing, so the ambiguous "0 accepted" case (all vented vs. not attempted)
  never arises; a deposit, once made, is final and its vented remainder is the
  core's exact, already-counted vent.
- **One amount per inspected position per tick** ⇒ at most
  `SURGE_DRAIN_INSPECTIONS_PER_TICK` = **8 `depositSurge` calls per level per
  tick**. A rod hit by multiple queued strikes drains them across consecutive
  ticks, one per tick — same-tick multi-strike drain at a single rod is
  explicitly **not** a property of this design.
- **Perf budget and fairness (source-accurate costs).** Symbols, defined once
  and used below: **N** = node count of the loaded sub-island containing the
  deposit origin; **E** = adjacency-edge count of that island; **A** =
  surge-absorber count in that island; **L** = live (alive) node count of the
  level's **whole** graph; **Eg** = adjacency-edge count of the whole graph
  (both edge counts ≤ 3× their node counts in Minecraft — at most 6 faces per
  node, undirected); **G** = total registered node count of the level's graph
  (all islands plus dormant records — everything a snapshot serializes);
  **K** = pending-queue position count. Costs, read off the actual
  `ChargeGraphCore`/`ChargeGraphManager` source:
  - **Warm drain path (the normal case).** The drain runs inside
    `endWorldTick()` strictly after `core.tick(access)`, which itself begins
    with `refreshCanonicalCache(); refreshIslandCache()`; deposits mutate no
    topology and no freeze state, so **by the time the drain runs, both
    global caches are always warm** and each `depositSurge` call pays only
    O(1) version/epoch checks for them. Per deposit the warm cost is: one
    traversal of the island's member list (relay scan + absorber loop, O(N))
    plus, **per absorber it feeds, one `pathCap` BFS over the island** —
    O(N + E) each when the island contains a relay (relay-free islands
    short-circuit to O(1) per absorber, and the slice's typical rod-plus-jars
    island has no relay). Warm worst case per deposit: **O(N + A·(N + E))**;
    per level-tick, at most 8 deposits: **O(8 · (N + A·(N + E)))**. Queue
    bookkeeping adds ordered-map operations — `firstKeyAtOrAfter` /
    `nextKeyAfter` / `headAmount` / `removeHead` / `dropAll` are **O(log K)**
    each, ≤ a small constant number per inspection, so ≤ **O(8 log K)** per
    tick (and `queueSurge` appends are O(log K) each in the entity phase).
  - **Cold global cache rebuild (not a drain cost, stated for honesty).**
    When topology or freeze state changed since the last access, the first
    accessor pays the global rebuild — in this design always `core.tick()`,
    never the drain (call order above). That rebuild is **global, not
    per-island**: `refreshCanonicalCache` collects and sorts every live node
    with a boxed comparator (**O(L log L)** comparisons plus O(L)
    boxing/copy), and `refreshIslandCache` BFS-labels the entire live graph
    (**O(L + Eg)**). **`REBUILD_BUDGET` (1,024 visits) does NOT cap these
    rebuilds** — it bounds only `runRebuild`'s network-relabel queue; the
    cache rebuilds are uncapped and proportional to the whole level graph.
  - **Snapshot on content mutation.** Any tick whose drain mutates queue
    content triggers `maybeSnapshot`, and a snapshot serializes the whole
    graph plus queue: **O(G + K)** — not avoidable without changing the
    frozen snapshot granularity.
  - **Enforceable gates.** CP1A pins **no wall-clock CI gate** for the drain
    (the "counter now, milliseconds later" rule); the only CI-checkable
    counters are the ≤8 inspections/≤8 deposits per tick bound
    (`u04_drain_budget_inspections_bounded`) — asymptotic statements above
    are documentation, not enforced claims. What rev 2 wrongly claimed
    ("no island scans anywhere") stays withdrawn; what IS true and enforced:
    no `nodeReport` calls, no scans for *skipped* (dormant/frozen/dirty)
    entries, and an empty queue costs one O(1) check.
  - **Fairness.** With `K` pending positions, every position is inspected at
    least once every `ceil(K / 8)` ticks regardless of where traffic
    concentrates — proven MC-free at scale (>1024 entries) in
    `PendingSurgeQueueTest` and integration-checked at small K in
    `u04_queue_no_starvation` (§13). Budget-window semantics are the
    documented core rule: a post-`tick()` deposit draws on the current
    window's remaining absorber budgets, cumulatively.

**The jar (U05): storage and surge absorber on one `ChargeBuffer`.**

- `LeydenJarBlockEntity extends AbstractChargeStorageBlockEntity implements
  SurgeAbsorber`. Both roles are backed by the **same inherited `ChargeBuffer`**
  (plan D7 single authority): `absorbSurge(amount)` simply delegates to the
  frozen `insertSurge(amount)` capacity-only path, so **surge absorption
  capacity is exactly the buffer's actual remaining capacity** — never a stale
  registered figure.
- Registration (fact 3): the jar's `maxInsertPerTick()` **returns `capacity()`**
  (config default 100,000). Consequences, stated honestly:
  - absorb budget per tick window = full capacity ⇒ one strike is absorbed in a
    **single `depositSurge` call**, jars filling in canonical order (priority
    ordinal, then ascending posKey);
  - the graph's normal-insert request bound is likewise `capacity()`. No sealed
    contract caps the jar's own fill rate (INDEX's "jar fill = 100,000 ÷ 5 =
    20,000 ticks" is generator-limited; player-facing transfer rates are U19/
    PWR *transmission* contracts, deferred with their rows). The buffer still
    clamps to remaining capacity and never goes negative.
  - `maxExtractPerTick()` = `JAR_EXTRACT_CG_PER_TICK` (1,000): consumers are
    storage-fed burst loads (PWR economy note); the dome's 32 Cg/t and worst-
    case intercept costs (≤600 Cg, §8) fit comfortably.
- Jar node roles: `STORAGE | SURGE_ABSORBER`, priority `MISC`.
- Normal delivery to consumers is untouched: the existing allocator's P3 phase
  (storages → consumers) powers the P2 dome from jars.

**Exact accounting (no phantom, no false no-vent claim):**

- A queued amount is either (a) deposited exactly once — split into
  jar-absorbed Cg (via `absorbSurge` actuals) and an exactly-counted core vent —
  or (b) dropped-before-deposit into the `droppedSurgeCg` diagnostic counter
  (queue overflow, rod removed, non-node origin), always logged. The two
  counters are never conflated: `ventedTotal` is graph energy the network could
  not place; `droppedSurgeCg` is strike energy that never entered the graph.
- **Venting is real and documented, not designed away:** with three empty jars a
  full strike is captured whole (100,000 + 100,000 + 70,000). With one empty
  jar, 100,000 Cg is stored and **170,000 Cg vents exactly**. With full jars or
  **no jar at all, the entire 270,000 Cg vents exactly** on deposit. Useful
  capture therefore requires **at least one connected jar with room** — the
  handbook page says so explicitly, and PWR-13 (Surge Protector) / PWR-21
  (Grounding Rod), both W5, are the cataloged management tools for exactly this
  overflow. There is no no-vent guarantee anywhere in this route.
- Conservation: the core's `Σafter = Σbefore + produced − consumed − vented`
  invariant holds unchanged — the route adds no new mutation path to the graph;
  it only schedules calls to the frozen `depositSurge`.
- **Hard-crash non-atomic save window (stated honestly):** the queue lives in
  level SavedData while jar charge lives in chunk BE NBT, and Minecraft writes
  the two through separate save paths with no cross-file atomicity. Normal
  shutdowns and autosaves flush both coherently, but a **hard crash** between
  the two writes can land on disk as either (a) a jar chunk that already holds
  a deposited strike alongside a SavedData file that still queues it — a
  double deposit of ≤4 × 270,000 Cg per rod on reload — or (b) a SavedData
  file that consumed the queue alongside a stale jar chunk — a lost strike.
  This is the same dual-store window vanilla itself has (chest contents vs.
  level data) and the same acceptance the W1B design already made for the
  stored-value shadow; CP1A documents it and bounds it (queue depth ≤4) rather
  than pretending SavedData/chunk saves can be made atomic. No mitigation is
  shipped in P1; if a later wave wants one, it needs its own reviewed design.

## 7. U05 — base jar slice, explicitly PARTIAL

U05's sealed summary says "tiered capacities". CP1A ships **only the base
100,000-Cg jar** and states exactly what remains:

- **Shipped now:** one `cuprum:leyden_jar` block; capacity
  `charge.leydenJarCapacityCg`; the §6 dual storage/absorber node; visible fill
  stages; comparator output; envelope persistence. Jars drop empty when broken —
  the "carried while charged" behavior is **PWR-06's contract**, not U05's.
- **Deliberately not shipped (the pending "tiered capacities" completion):**
  the small tier is **PWR-06 Small Leyden Cell** (25,000 Cg, W5) and the large
  tier is **PWR-07 Grand Leyden Array** (3×3×3 rack multiblock, 100,000 ×
  inserted jars, W5). The U05 tier clause is *completed by* those W5 rows; CP1A
  duplicating them would violate the family contract.
- **Ratchet status (binding):** U05 enters the §12 handbook/implementation
  ratchet as **`PARTIAL` — never in the fully-implemented set** — until the W5
  tier rows land. Its handbook page carries an explicit EN/DE "base slice;
  tiered capacities arrive with the power wave (PWR-06/PWR-07)" notice.
- **Fill stages (exact):** blockstate integer property `fill` ∈ {0,1,2,3}:
  `fill = stored == 0 ? 0 : 1 + min(2, (3 * stored) / capacity)` (integer math) —
  empty / (0, ⅓) / [⅓, ⅔) / [⅔, full]. Updated on the existing throttled
  `sendBlockUpdated` cadence (≥10-tick deltas except transitions, API_PROBES
  posture).
- **Comparator formula (exact, vanilla container convention):**
  `signal = stored == 0 ? 0 : 1 + (14 * stored) / capacity` (integer division) —
  0 only when empty, 15 only when full, monotone in between.

## 8. U02 — oriented ripple on the existing RenderType, exact intercept cost

**Sanctioned W1D extension (smallest backward-compatible oriented ripple).** The
W1D ripple ring is tessellated in the fixed horizontal plane
(`FxRippleGeometry`, cached XZ unit circle, fixed `cy`). A dome impact needs a
ring tangent to the dome surface. The sanctioned extension names **every**
touched class and its freeze status explicitly — and it does **not** claim the
pool is untouched, because it is not:

- **The normal representation — ONE exact 24-bit signed-component packing,
  end to end.** One `int` (`normalPacked24`) carries the outward unit normal
  identically through payload → `FxRippleSnapshot` → `FxRippleRing` →
  `OrientedVisitor` → render state; it is decoded to floats **exactly once
  per consumer, at the consumption point** (render-state extraction and
  T2/T3 burst placement), never re-encoded. It is deliberately **not**
  octahedral (an octahedral fold would fit 16 bits but needs a fold/unfold
  algorithm with subtle sign edge cases; the component packing below is
  exactly specifiable in four lines and the payload budget still holds —
  §3). Pinned algorithm, new MC-free helpers in `fx.core` `RippleMath`:
  - **Pack** — `int packNormal24(double nx, double ny, double nz)`: if any
    component is non-finite **or** `nx² + ny² + nz² < 1e-12`, return
    `NORMAL_PACKED_UP`. Otherwise normalize to unit length, then per
    component `b = clamp(round(c × 127), −127, 127)` (−128 is never
    produced), and pack
    `((bx & 0xFF) << 16) | ((by & 0xFF) << 8) | (bz & 0xFF)` — result always
    in [0, 0xFFFFFF], never 0x000000 for a unit input.
  - **Decode** — `float unpackNormalX(int p)` / `unpackNormalY` /
    `unpackNormalZ`: sign-extend the byte (`(byte) (p >>> 16)` etc.) and
    divide by 127; consumers then renormalize the decoded vector (its length
    deviates from 1 only by quantization; per-component error before
    renormalization ≤ 1/254). The zero vector cannot reach decode — §3
    validation rejects 0x000000.
  - **Numeric +Y constant** — `NORMAL_PACKED_UP = 0x007F00` (= 32,512:
    bx = 0, by = 127, bz = 0), which decodes exactly to (0, 1, 0).
  - **Validation split** — the server encodes only via `packNormal24`
    (range-correct by construction); the client payload codec **rejects**
    values outside [0, 0xFFFFFF] and rejects 0x000000 (reject-not-clamp,
    plan §3.2); pool/snapshot/visitors treat the int as opaque.
- **`FxRippleRing` (`fx.core`, MC-free, amended source-compatibly):** the
  structure-of-arrays slots gain three `int` columns — **`normalPacked24`**,
  the 8-bit **event nonce**, and **`surfaceOffsetQ8`**, the Q8.8 offset from
  the pool position to the impact point along the normal (**the
  discriminator: 0 = legacy world ripple, > 0 = shield impact**) — and the
  pool identity becomes the triple (posKey, startTick, nonce) internally.
  **Existing signatures are retained, not replaced:** the current
  `addIfAbsent(long, long, int, int)` overload stays and delegates with
  `normalPacked24 = NORMAL_PACKED_UP, nonce = 0, surfaceOffsetQ8 = 0`; the
  existing `Visitor` interface and `visitAt`/`visitAll` stay byte-for-byte
  compatible (they simply do not surface the new columns). The oriented path
  is **additive**: a new `addIfAbsent(long posKey, long startTick,
  int colorArgb, int radiusQ8, int normalPacked24, int nonce,
  int surfaceOffsetQ8)` overload, a new `OrientedVisitor` (seven columns:
  `accept(long posKey, long startTick, int colorArgb, int radiusQ8,
  int normalPacked24, int nonce, int surfaceOffsetQ8)`), and **both** new
  extraction walks `visitAtOriented(long anchorPosKey, OrientedVisitor)` and
  `visitAllOriented(OrientedVisitor)` (the latter is what the T2 mote cadence
  migrates to — see the tier rule below). Legacy identity
  (posKey, startTick, 0) therefore coalesces exactly as (posKey, startTick)
  did. The 16-slot capacity, oldest-evicted overflow, `expire` clock-skew
  rule, compaction and zero-steady-state-allocation properties are unchanged.
  **The existing `FxRippleRing` unit tests must pass unmodified** — that is
  the pinned compatibility gate — with `FxRippleRingIdentityTest` added for
  the oriented path (`fx.core` is not in `FROZEN_PACKAGES`, so this is not a
  lock diff — §12(1)).
- **Impact point — exact pinned math, one rule for every tier (T1/T2/T3):**
  - **World point (T2/T3 and any world-space consumer):**
    `impactWorld = Vec3.atCenterOf(center).add(decodedNormal.scale(
    surfaceOffsetQ8 / 256.0))` — double precision, deterministic on every
    client (`decodedNormal` = the renormalized unpack above). T2 spawns its
    mote cadence bursts at exactly `impactWorld` (via `visitAllOriented` and
    a new coordinate-taking `spawnMoteBurstAt(level, x, y, z, count, speed)`;
    the existing `BlockPos` method delegates to it with its historical
    `(+0.5, +1.1, +0.5)` offsets); T3 spawns its one arrival burst at exactly
    `impactWorld`.
  - **Render-local point (T1 geometry):** ripple geometry positions are
    block-local — the render pose is already translated to the anchor block
    origin (verified: `FxRippleGeometry` emits around
    `cx = 0.5, cy = 1.0 + HEIGHT_ABOVE_TOP, cz = 0.5`). The oriented ring
    therefore tessellates around the local point
    `(0.5 + nx·d, 0.5 + ny·d, 0.5 + nz·d)` with `d = surfaceOffsetQ8 /
    256.0` — numerically identical to `impactWorld` minus the anchor block
    origin — on the orthonormal basis perpendicular to the normal.
  - **Explicit `surfaceOffsetQ8 == 0` legacy branch:** the code takes the
    **pre-change code path verbatim** — T1 keeps the existing local
    constants `(0.5, 1.0 + HEIGHT_ABOVE_TOP, 0.5)` (the legacy ring floats
    above the block top, NOT at the block center — the formula above is
    never applied to legacy ripples), T2/T3 keep calling the existing
    `spawnMoteBurst(level, BlockPos.of(posKey), …)` with its `(+0.5, +1.1,
    +0.5)` offsets — so every legacy position is preserved bit-exactly at
    all three tiers.
- **`FxRippleSnapshot` + `FxDispatcher` (`client.fx` top level — LOCK-FROZEN,
  reviewed lock diff, exact post-change surface pinned):** the record is
  today `FxRippleSnapshot(BlockPos center, float maxRadius, int colorArgb,
  long startGameTime)` with the single static factory
  `of(FxRipplePayload)` (verified against source). Post-change it is pinned
  as — components in this exact order and these exact types —
  `FxRippleSnapshot(BlockPos center, float maxRadius, int colorArgb,
  long startGameTime, int normalPacked24, int nonce, int surfaceOffsetQ8)` —
  the packed normal rides the snapshot as the **same opaque `int`** the wire
  carries (no float triple in the record: one representation end to end,
  decoded only at consumption points) — plus a **backwards-compatible
  secondary constructor** with the original four components delegating with
  `(NORMAL_PACKED_UP, 0, 0)`, the existing `of(FxRipplePayload)` factory
  unchanged (it calls the four-component constructor — the W1D path compiles
  and renders bit-identically), and a new `of(ShieldImpactPayload)` factory
  (copies `normalPacked24` verbatim, applies the colorblind remap exactly
  once as today, fills `maxRadius` from `SHIELD_IMPACT_RING_RADIUS_Q8`).
  `FxDispatcher` keeps its current pinned signatures untouched — `public
  synchronized void enqueueRipple(FxRippleSnapshot)`, package-private
  `synchronized boolean enqueueRippleFromDimension(FxRippleSnapshot,
  ResourceKey<Level>, ResourceKey<Level>)`, `public synchronized void
  extractRipplesAt(FxProbeRenderState, BlockPos, long)` — and adds exactly
  one public method: `public synchronized void
  extractOrientedRipplesAt(FxProbeRenderState out, BlockPos anchor,
  long nowTick)` over `visitAtOriented`, for the render path that needs
  normals/offsets. Internally the enqueue path now always calls the
  seven-argument ring overload with the snapshot's fields (legacy snapshots
  carry the `NORMAL_PACKED_UP`/0/0 defaults, producing the identical legacy
  identity), and the T2 cadence in `tick` migrates from `visitAll` to
  `visitAllOriented` to place bursts by the pinned tier rule (the offset-0
  branch takes today's `BlockPos.of(posKey)` path exactly).
- **`FxProbeRenderState` + `FxRippleGeometry` (`client.fx.render` — internals,
  NOT lock-frozen):** the extracted per-frame state carries the per-ripple
  **decoded** normal floats and the **render-local impact point** — both
  computed deterministically at extraction (the single place the packed int
  is unpacked for T1) by the pinned tier rule, with the offset-0 legacy
  branch; `emitRing` builds the ring on an orthonormal basis perpendicular
  to the normal (basis derived deterministically from the normal; winding
  defined so the front face looks along the normal, matching today's
  from-above convention for +Y).
- **`FxRippleBroadcaster` + `FxPayloads` (main `fx` — NOT lock-frozen):** gain
  the shield-impact broadcast entry point and payload registration; no lock
  impact (§12(1)).
- **Event identity (nonce, executable flow):** the **controller BE owns** an
  8-bit wrapping impact counter (transient `int` field — not persisted; the
  dedupe window is one ripple lifetime, far shorter than a session). Its
  lifecycle is synchronized with the payload: the controller increments it
  exactly once per accepted intercept, at payload-build time —
  `nonce = (nonce + 1) & 0xFF` — and passes that value **explicitly** to the
  broadcaster through the `int nonce` parameter of `broadcastShieldImpact`
  (below); the broadcaster never generates or mutates nonces, it only encodes
  the given value into the payload's nonce byte. Two same-tick impacts on one
  dome carry distinct nonces and therefore occupy two pool slots; an exact
  network duplicate of one payload still coalesces to a no-op via
  `addIfAbsent`. The impact ring's visual max radius is **not** sent on the
  wire: the pool's existing `radiusQ8` column is filled from the client-side
  constant `SHIELD_IMPACT_RING_RADIUS_Q8` at snapshot time (§3 payload row
  explains the coherent center + normal + offset representation).
- Eviction policy, 16-slot cap, tier ladder, particle budgets, colorblind
  remap-at-snapshot and disconnect-clear semantics are inherited — shield
  impacts share the **same** ring pool and eviction, which is exactly the SHD
  family perf budget ("ripple/echo payloads reuse the U02 ring buffer, max 16
  concurrent ripples").
- **No new RenderType, no new pipeline:** the impact ring renders through the
  existing `cuprum:fx_ripple` RenderType at T1 and the existing vanilla-pipeline
  T2 fallback; census stays 1 through P3 (§3 table).
- Tests: `NormalPack24Test` (unit — the pinned pack/decode algorithm),
  `FxRippleRingIdentityTest` (unit — widened identity, legacy-tuple
  coalescing, eviction unchanged), `OrientedRippleBasisTest` (unit — §13), and
  the client gametests in §13 including the W1D-screenshot backward-compat
  proof.

**Per-client send window (mirrors the hardened ripple pattern).** The existing
`FxRippleBroadcaster` already keeps one connection-owned `FxSendWindow` session
per client (16/s, JOIN/DISCONNECT/STOP hardened). The sanctioned extension adds a
**second window to the same session** — `SHIELD_IMPACT_SENDS_PER_SECOND = 8` per
client over the same `SEND_WINDOW_TICKS` — and a
`broadcastShieldImpact(ServerLevel level, BlockPos center, Vec3 outwardNormal,
int surfaceOffsetQ8, int colorArgb, int nonce)` entry point that sends the §3
payload to tracking players through that window; the broadcaster encodes
`outwardNormal` via `RippleMath.packNormal24` (§8 — non-finite/degenerate
inputs become `NORMAL_PACKED_UP`), `surfaceOffsetQ8` is the dome radius in Q8
(the controller passes `DOME_RADIUS × 256` = 2,048), and `nonce` is the
controller-supplied event identity (already wrapped to 0..255 by the owner;
the broadcaster masks `& 0xFF` defensively on encode).
Overflow is dropped silently (idempotent, loss-tolerant cosmetic events; the
client pool would evict anyway). Reusing the session object avoids duplicating
the JOIN/DISCONNECT race hardening.

**Exact intercept cost (integral, bounded, tested).** SHD's binding formula is
"200 Cg + 40 Cg per block/tick of projectile speed". CP1A pins the integral
definition:

- **Sampling:** server-side, on the tick the dome-boundary crossing is detected;
  `speed = projectile.getDeltaMovement().length()` in blocks/tick.
- **Fixed point:** `speedQ8 = round(speed × 256)` clamped into
  `[0, INTERCEPT_SPEED_CAP_Q8 = 2,560]` (= 10.0 blocks/tick, comfortably above
  every vanilla projectile); a non-finite `speed` (NaN/±∞ from hostile physics)
  clamps to the cap, never propagates.
- **Cost:** `costCg = 200 + (40 * speedQ8) / 256` (integer division = floor).
  Range is exactly [200, 600] Cg; `int` math cannot overflow.
- **Boundary tests** (`InterceptCostTest`, MC-free): speeds 0 (→200), 1.0
  (→240), a pinned arrow-speed sample, exactly 10.0 (→600), 10.0+ε (→600, cap),
  NaN (→600, cap), and the Q8 rounding edge just below/above a 1/256 step.

**Atomic full payment via a controller-local escrow buffer.** Revision 2's
"full cost extractable from island storage that tick" was unimplementable as
written: the allocator *delivers* to consumers in its own phase (possibly in
several partial `accept` calls); nothing lets a consumer atomically pull an
exact amount from the island on demand, and CP1A adds **no graph reservation
API**. The binding design keeps the frozen graph exactly as-is and makes
payment a local matter. **Timing:** the escrow, the DEFENSE consumer and the
upkeep spend land in **P2 with U01** (the dome's 32 Cg/t already needs them);
P3 adds only the intercept spend path on top.

- **Escrow:** the U01 controller BE owns a second persisted `ChargeBuffer`
  ("escrow") with capacity `ESCROW_CAPACITY_CG = 1,280` (one tick's upkeep 32 +
  two worst-case intercepts 2 × 600 + headroom) and both per-tick buffer
  budgets set to the capacity — internal plumbing, deliberately not a
  player-facing rate.
- **Replenishment (existing consumer path only):** the controller registers as
  the graph's dome consumer with priority **`DEFENSE`** (PWR-18: served first
  under brownout — the U02 `u02_brownout_defense_priority` test pins that a
  50%-supply brownout still fills the dome's request before MISC targets).
  `demandPerTick()` = the escrow deficit (`capacity − stored`);
  `accept(amountCg)` inserts into the escrow and returns the actual — partial
  deliveries are simply partial escrow fills, per the frozen `ChargeConsumer`
  contract. Deliveries traverse relays under the existing path-cap rules;
  nothing changes in the allocator. With one adjacent jar (extract cap
  1,000 Cg/t) a worst-case two-intercept tick refills within two ticks; with
  two or more jars, within one.
- **Tick-window discipline (every path):** every controller escrow path —
  the consumer `accept` insert **and** every `extractExact` spend — calls
  `ChargeBuffer.beginGameTick(level.getGameTime())` **before observing any
  stored/budget state**, so no path ever reads a stale budget window from a
  previous tick. (`beginGameTick` is idempotent within a tick: repeated calls
  with the same game time leave the open window untouched.)
- **Atomic spend (`extractExact`):** all dome spending goes through one
  helper — a package-private static
  `extractExact(ChargeBuffer escrow, long cost, long reserve, long gameTime)`
  in the `shield` package (package-private ⇒ invisible to the `javap
  -protected` lock listing; static over `ChargeBuffer` ⇒ MC-free
  unit-testable by `EscrowExtractExactTest`). Pinned body, **simulate-first
  so a guard failure mutates nothing**:
  1. `escrow.beginGameTick(gameTime)`;
  2. `if (escrow.stored() < cost + reserve) return false;`
  3. `if (escrow.extract(cost, true) != cost) throw new
     IllegalStateException(...)` — the **simulate** call performs no mutation
     (verified: `extract(amount, true)` computes the extractable amount and
     skips the state update), so the loud failure path leaves `stored()` and
     both budget windows untouched;
  4. `long got = escrow.extract(cost, false); if (got != cost) throw new
     IllegalStateException(...)` — this second guard is unreachable: nothing
     executes between the simulate and the commit on the single server
     thread, so the commit result equals the simulate result by construction;
  5. `return true`.
  **Why step 3 is also unreachable as designed:** `extract` returns
  `min(request, stored, remaining extract budget)`; step 2 guarantees
  `stored ≥ cost`; and the extract budget cannot bind before `stored` does,
  because within one game tick **all escrow extracts precede all escrow
  inserts** (spends run in the entity/BE tick phase; the only insert path is
  the allocator's `accept`, which runs at `END_WORLD_TICK`, after them), so
  the sum of extracts inside one window is ≤ the window-start `stored` ≤
  `ESCROW_CAPACITY_CG` = the extract budget. The throws exist so that a
  future refactor breaking the phase-ordering precondition crashes the tick
  instead of corrupting accounting — and because the reachable throw fires on
  a **simulation**, no partial spend ever occurs, let alone gets acted on
  (`EscrowExtractExactTest`, §13, pins both the throw and the no-mutation
  property). This is new `shield`-package content built solely on the
  existing `ChargeBuffer` API — no new graph API, no new `ChargeBuffer`
  method.
- **Upkeep-payment marker (`upkeepPaidGameTime`):** a transient `long` field
  on the controller BE, initialized `Long.MIN_VALUE`, set to the current game
  time when (and only when) that tick's 32 Cg upkeep extraction succeeds.
  **Deliberately not persisted, justified:** the marker pairs intercepts with
  the *same game tick's* upkeep; comparison against `level.getGameTime()`
  self-expires it, so no reset code exists. After chunk reload/restart it
  reverts to "not paid", which errs strictly conservative (at worst one
  intercept that tick reserves 32 unnecessarily); persisting it would risk the
  opposite error — a stale-equal marker after a reload granting reserve 0
  while the resumed tick's upkeep is still unpaid.
- **Same-tick upkeep-vs-intercept order (guarantee = upkeep preservation
  ONLY):** intercepts use
  `reserve = (upkeepPaidGameTime == gameTime) ? 0 : ESCROW_UPKEEP_RESERVE_CG` —
  32 while this tick's upkeep is still owed, 0 once it has been paid; the
  upkeep payment itself always uses `reserve = 0`. The **only** guarantee this
  rule makes is that a tick's upkeep can never be starved by that tick's
  intercepts, whichever runs first. No broader order-independence is claimed:
  intercept-vs-intercept outcomes still follow entity tick order (next
  bullet). **Pinned boundaries** (`u02_upkeep_reserve_boundaries`, §13; one
  max-cost 600 Cg intercept + one 32 Cg upkeep in the same tick, both engine
  orders driven explicitly):

  | escrow at tick start | intercept first, then upkeep | upkeep first, then intercept |
  |---|---|---|
  | 631 | intercept **denied** (631 < 600+32); upkeep pays 32 → **599** | upkeep pays 32 → 599, marker set; intercept **denied** (599 < 600+0) → **599** |
  | 632 | intercept **pays** (632 ≥ 632) → 32; upkeep pays → **0** | upkeep pays → 600, marker set; intercept **pays** (600 ≥ 600) → **0** |
  | 633 | intercept **pays** → 33; upkeep pays → **1** | upkeep pays → 601, marker set; intercept **pays** → **1** |

  At these boundaries the observable outcomes coincide across both orders —
  the test asserts the table cells, not a general order-independence theorem.
- **Simultaneous impacts:** each projectile pays (or passes) at its own
  boundary-crossing moment, in the server's entity tick order; with escrow for
  only one intercept, the first-ticked projectile intercepts and the second
  **passes** — deterministic in tests via controlled spawn order
  (`u02_two_impacts_one_budget_deterministic`).
- **No charge ⇒ pass:** an empty escrow (empty network) means `extractExact`
  returns false and the projectile passes — the honest failure mode; there is
  never a partial payment.
- **Serialization:** the escrow's stored value rides the controller's §3.1
  state envelope (clamped through `setStored` on load) beside the formation
  and claim state; `u02_escrow_persistence_restart` pins the round-trip.
- **Tests:** `u02_escrow_replenishes_partial` (multi-call partial `accept`
  fills observed), `u02_upkeep_reserve_boundaries` (the 631/632/633 table in
  both engine orders), `EscrowExtractExactTest` (loud-failure guard),
  `u02_two_impacts_one_budget_deterministic`, `u02_brownout_defense_priority`,
  `u02_escrow_persistence_restart`, plus the §13 P3 table.

## 9. Shaders: clean-room rule, GameTime probe, variant-dispatch proof

- **Clean-room rule (restated, binding for every CP1A-descendant shader):** the
  CP0C §4 license rule applies verbatim — no copying or translating licensed
  shader source; techniques are reimplemented from first principles/public-
  domain references, with provenance ledger entries per shader file
  (`docs/shader-research/` pattern established by W1D).
- **GameTime probe (W4, both results acceptable):** repository truth
  (`docs/API_PROBES.md`, "Built-in GameTime uncertainty") is that `GameTime`
  lives in the `Globals` UBO, `MATRICES_FOG_SNIPPET` does not include it, and no
  probe yet proves a custom pipeline may bind `Globals`. W4 runs the probe both
  ways: compile (`precompilePipeline(...).isValid()` on the CI llvmpipe driver
  with `GLOBALS_SNIPPET` included) and runtime (a rendered frame whose output
  provably depends on the uniform). **A positive result** lets holo übershaders
  read `GameTime` directly. **A negative result is not a gate failure**: the
  binding fallback is the **CPU-packed phase** — the effective phase
  (`phaseTicksAccumulated` semantics, CP0C §2) computed CPU-side per frame and
  packed into the provisional vertex-attribute contract (the W1D CPU-geometry
  precedent, scaled to attribute packing). Either outcome is appended to
  `docs/API_PROBES.md` as W4 evidence. The CP0C §6.1(1) wording "including the
  built-in GameTime uniform" is hereby clarified (amendment, not contradiction):
  the gate requires the *probe to be run and its result recorded and
  designed-for*, not the uniform to exist.
- **Variant-dispatch proof and the exactly-one-of-each rule (W4):**
  - `holo_surface` **variant 0 is the U01 Storm Shield dome shell** — production
    content upgrading U01's T1 rung at W4 (U01 keeps its P2 T2/T3 rungs as
    fallbacks; the dome consumes the reserved *dome slot* and never registers
    its own RenderType).
  - Exactly **one** additional *non-catalog diagnostic* surface variant (a debug
    checker/gradient) ships beside it, **pinned as variant id = 1**. The CP0C
    §6.1(2) requirement that "two diagnostic variants render distinguishably
    from ONE pipeline" is satisfied — and clarified by this amendment — as
    **two variant ids through one pipeline: production variant 0 + diagnostic
    variant 1**, proving packed-attribute dispatch with committed region
    screenshots.
  - **Packed variant range at W4 is exactly `0..1`.** Out-of-range ids are
    handled at two layers: (a) server-side, the guarded W4 payload/BE codecs
    **reject** ids outside `0..1` (plan §3.2 reject-not-clamp — an invalid id
    never reaches a client from our code); (b) client-side defense-in-depth,
    an out-of-range packed id observed in extracted render state **falls back
    to variant 0** with a rate-limited WARN and increments a diagnostics
    counter — render never crashes and never displays undefined variant data.
    Widening the range beyond 1 is a per-wave amendment tied to each new
    cartridge's row.
  - Exactly **one** *non-catalog diagnostic* interior scene (a minimal
    far-scene starfield proving the interior mode switch). Nothing else renders
    through `holo_interior` before W13.
  - All twenty-seven VFX rows — emphatically including VFX-11..14 — ship only in
    their cataloged waves (W13 core / W15 stretch) as full features.

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
  checklist item** in the W4 evidence appendix to `docs/API_PROBES.md`; CP1A
  forbids representing the simulation as end-to-end Iris proof.

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
- **Making `u04_dirty_node_retry` executable (pinned choice):** a dirty window
  only outlives a tick when a component rebuild exceeds
  `ChargeGraphManager.REBUILD_BUDGET` = 1,024 visits. The two candidate
  mechanisms were (a) building a >1,024-node connected component inside
  `empty_24` (fits — 24³ = 13,824 cells — but places over a thousand BEs per
  run: slow, allocation-heavy, and fragile under parallel structures) and
  (b) a **package-private rebuild-budget seam** on `ChargeGraphManager`
  (`rebuildBudgetForTesting`, read by `endWorldTick` when set, reset by the
  test). CP1A pins **(b)** as the least invasive testable option: the gametest
  class lives in the `dev.cuprum.cuprum.charge` package inside the gametest
  source set — the repo's established seam-access pattern (the client fx
  gametests already sit in `dev.cuprum.cuprum.client.fx` for exactly this
  reason) — and package-private members are invisible to the `javap
  -protected` API-lock listing, so the seam has **zero lock impact**. Option
  (a) is recorded as rejected, not forbidden: a later perf wave may still
  build the large-component stress world.
- **Pinned setup for `u04_queue_persistence_restart`:** pending state must
  provably exist at save time, so the test enqueues at a **deliberately
  frozen origin**: the rod's chunk is unloaded/frozen first (the manager's
  `CHUNK_UNLOAD` freeze path), `queueSurge` is then called for that position
  (valid: the frozen node entry is still registered), the drain skips it every
  tick (frozen ⇒
  retry), the level saves with the strike still queued at schema 2, the
  server restarts, the chunk reloads, and the deposit completes. Without the
  frozen origin the same-tick drain would consume the queue before any save.
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
  Counter/budget assertions stay in-test; only the cross-launch pixel identity
  lives in the script, because one JVM cannot observe its own second launch.

## 12. Reviewed foundation-file changes (each a sanctioned, minimal diff)

CP1A sanctions exactly these edits to otherwise-frozen surfaces, each following
its established review mechanism:

1. **API freeze — packages and lock, honestly.** `ApiFreezeTest`'s
   `FROZEN_PACKAGES` map is a hard-coded package set; new packages are invisible
   to it until listed. Each phase therefore lands a **three-file reviewed
   diff**: (a) the new/changed content, (b) `ApiFreezeTest.FROZEN_PACKAGES`
   gaining the new package directories — P1: `dev/cuprum/cuprum/power`; P2:
   `dev/cuprum/cuprum/shield`; W4: the new holo packages (main and client)
   per CP0C's append-only rule — and (c) the regenerated `api/cuprum-api.lock`.
   The per-file freeze status of every P1–P3 change, stated exactly against
   the committed `FROZEN_PACKAGES` list:
   - **Lock-reviewed two-file diffs (frozen packages):** `charge` —
     `ChargeGraphManager.queueSurge(BlockPos, long)` and
     `droppedSurgeCgTotal()` (§6, exact signatures pinned there); `client.fx`
     (top level) — the `FxRippleSnapshot` record extension with the exact
     pinned post-change component list (§8: four original components +
     `normalPacked24` + `nonce` + `surfaceOffsetQ8`, additive secondary
     constructor, new `of(ShieldImpactPayload)` factory) and the
     `FxDispatcher` **additive** oriented extraction entry point
     (`extractOrientedRipplesAt(FxProbeRenderState, BlockPos, long)`;
     existing `enqueueRipple*` / `extractRipplesAt` signatures unchanged).
     The `charge.persist` schema change rides the `charge`-adjacent review
     in the same diff. **`charge.core` is NOT touched** — revision 5 removed
     the only planned `charge.core` addition by relocating
     `PendingSurgeQueue` as a package-private class in
     `dev.cuprum.cuprum.charge` (§6), so no public `charge.core` API is
     needed at all.
   - **No lock impact (not in `FROZEN_PACKAGES` or not `javap`-visible):**
     main `fx` package (`FxRippleBroadcaster` shield-impact window/entry
     point, `FxPayloads` registration) and `fx.core` (`FxRippleRing`
     columns/identity, `FxBudgets` constant additions), plus
     `client.fx.render` internals (`FxProbeRenderState`,
     `FxRippleGeometry`) — the W1 freeze deliberately froze only the
     top-level `client.fx` entry points. Package-private members are
     invisible to the `javap -protected` listing, so the §11 rebuild-budget
     seam, the §6 `PendingSurgeQueue` class and the §8 `extractExact` helper
     all carry zero lock impact.
   Every named method/class above either already exists (verified in this
   audit) or is explicitly declared here as a sanctioned NEW addition with its
   exact name and signature — no other API names may be introduced on frozen
   surfaces without a further amendment.
2. **Config:** none. `configSchemaFreeze` list untouched (§3).
3. **Persistence schema:** the bounded `pending_surges` and
   `pending_surge_cursor` fields on `ChargeGraphSavedData` (§3/§6), with
   `CuprumSchema.WORLD` 1 → 2 and the two per-domain identity
   `StateMigrations` steps, **field-local** hostile-decode handling
   (trim/drop + WARN per entry, cursor falls back to default; never fails the
   record or defaults `nodes`/`vented_total`), the two-tier dirtiness rule
   (`queueDirty` joins `maybeSnapshot`'s early return; runtime `cursorDirty`
   does not — the cursor persists opportunistically with any written
   snapshot, and may rewind on ANY restart, clean or crashed, §6), and the §6
   hard-crash save-window statement — covered by `PendingSurgeCodecTest` plus
   extending the existing saved-data gametests and the restart probe.
4. **Ownership:** no ownership API change. The U01 controller stores
   `Claim.ofPlacer(placer)` in its envelope and evaluates via
   `OwnershipService.allows(...)` (§4) — model and evaluator exactly as W1A
   shipped them.
5. **Handbook ratchet** (`HandbookPlanCompletenessTest` + the completeness
   registry gametest): the W1E test pins "no shipped page claims a catalog
   slug" — correct while nothing was implemented, and **necessarily amended the
   moment P1 ships U04**. The sanctioned change: the test gains an explicit
   **two-tier allowlist** — `IMPLEMENTED_CONTRACTS` (full cataloged scope
   shipped) and `PARTIAL_CONTRACTS` (base slice shipped, completion pending a
   named wave). P1: U04 → IMPLEMENTED, **U05 → PARTIAL (pending W5
   PWR-06/PWR-07; it may not move to IMPLEMENTED before then)**; P2: +U01
   IMPLEMENTED; P3: +U02 IMPLEMENTED; W4: +U23 IMPLEMENTED. Shipped pages must
   claim exactly the allowlisted slugs at their deterministic planned page ids
   (e.g. `cuprum:power/lightning_capture_rods`), PARTIAL pages must carry the
   pending-scope notice (EN/DE), and the runtime completeness gate keeps
   enforcing that every shipped block/item is documented with EN/DE parity and
   `exempt.json` stays size 0.
6. **Access widener:** the single-rule `cuprum.accesswidener` (§5) plus its two
   wiring lines (`fabric.mod.json`, `build.gradle`). Any future AW rule requires
   its own amendment.
7. **`FxBudgets`:** P3 adds `SHIELD_IMPACT_PAYLOAD_MAX_BYTES = 32`,
   `SHIELD_IMPACT_SENDS_PER_SECOND = 8`,
   `SHIELD_IMPACT_MAX_OFFSET_Q8 = 16_383` (the §3 decode-reject ceiling — the
   2-byte VAR_INT bound, ≈64 blocks, comfortably above any dome radius) and
   `SHIELD_IMPACT_RING_RADIUS_Q8 = 512` (2.0 blocks — the impact ring's
   client-side visual max radius, within the existing `MAX_RADIUS_Q8` =
   16,384 validity bound); the `NORMAL_PACKED_UP = 0x007F00` constant and the
   `packNormal24`/`unpackNormalX/Y/Z` helpers (§8) land in `fx.core`
   `RippleMath`, also lock-free; W4 applies the CP0C-sanctioned holo budget
   additions. No existing constant changes.
8. **CP0C clarifications** recorded in §9 (GameTime probe outcome neutrality;
   variant-dispatch proof = production variant 0 + one diagnostic variant) and
   §13 (W4 ms figures are logged evidence, not CI gates — the binding CI gates
   at W4 are counters; hard wall-clock gating happens only at W14
   `w14_holo_frame_budget`, per CP0C's own "counter-now/milliseconds-later"
   rule).

## 13. Phase-by-phase named tests and exit gates

Naming follows the repo conventions: MC-free JUnit in `src/test`, server
GameTests and client GameTests in `src/gametest` (INDEX prefixes
`server_gametest:` / `client_gametest:` map to method/test names).

**P1 — U04/U05** (all on the default 8×8×8 template unless noted)

| Test | Proves |
|---|---|
| `PendingSurgeQueueTest` (unit, MC-free, in `dev.cuprum.cuprum.charge` under `src/test` for package-private access, §6) | ascending-posKey ring order with cursor start/wrap, per-pos FIFO with one-head-drain-per-inspection, 4-entry bound with exact drop accounting, inspection-counted budget, **and the starvation proof at scale**: >1024 dormant/dirty entries plus sustained low-position appends ⇒ every position inspected at least once every `ceil(K/8)` simulated ticks, highest posKey included (cheap here; prohibitively heavy as a GameTest) |
| `PendingSurgeCodecTest` (unit) | field-local hostile decode: >4-per-key trimmed, out-of-range amounts dropped, malformed entries dropped (each WARN), malformed cursor defaults — while `nodes`/`vented_total` in the same record decode untouched |
| `JarFillStageTest` (unit) | exact `fill` and comparator integer formulas at boundary values (0, 1, ⅓·cap ± 1, ⅔·cap ± 1, cap) |
| `u04_scripted_strike_full_deposit` | scripted `LightningBolt` on the rod queues and (same `endWorldTick`) deposits exactly 270,000 Cg into an empty 3-jar bank; conservation Σ == 270,000, vented == 0 |
| `u04_channeling_strike_deposit` | channeling-path bolt triggers the same full queue+deposit |
| `u04_poi_natural_attraction_registered` | black-box §5 proof via public `PoiTypes.forState` + `PoiManager.findClosest` only |
| `u04_jarless_strike_vents_exact` | no jar in the island ⇒ deposit vents exactly 270,000 Cg (counted in `ventedTotal`), rod holds nothing |
| `u04_partial_capacity_vents_exact` | one jar at 30,000/100,000 ⇒ exactly 70,000 absorbed, 200,000 vented |
| `u04_multiple_rods_single_jar_deterministic` | two rods (two positions) each struck once in one tick, one empty jar, fresh drain cursor (`Long.MIN_VALUE`) ⇒ both positions are inspected the same tick (one head amount each, 2 ≤ 8 deposits); the lower-posKey rod's strike fills the jar (100,000), its remainder and the second rod's strike vent exactly; ring order + cursor determinism asserted |
| `u04_dirty_node_retry` (in `dev.cuprum.cuprum.charge`, §11 seam) | rebuild budget lowered via the package-private seam ⇒ strike queued while the rod's component is rebuild-pending ⇒ 0 deposited, nothing vented, deposit completes after `runRebuild` relabels; queue survives the wait; seam reset in cleanup |
| `u04_queue_persistence_restart` (restart probe extension, §11 pinned setup) | strike queued at a deliberately frozen origin ⇒ pending state provably exists at save; written at schema 2, survives a real process restart, deposits after the chunk reloads |
| `u04_queue_dirty_snapshot` | enqueue onto an already-snapshotted, otherwise-idle graph (no shadow/topology/vent change) ⇒ `queueDirty` alone forces the next snapshot; the strike survives a restart |
| `u04_drain_budget_inspections_bounded` | >8 pending positions (mix of drainable and frozen/dirty) ⇒ exactly 8 **inspections** and ≤8 `depositSurge` calls per tick — skips consume budget, at most one head amount deposits per inspected position — remainder resumes from the runtime cursor next tick; a tick of pure skips (cursor-only motion) does **not** set `queueDirty` or force a snapshot |
| `u04_queue_no_starvation` | **small-K manager integration on the default 8×8×8 template**: K = 12 pending positions (mix of frozen/dirty skips and drainable, some low-posKey positions restruck each tick) ⇒ within `ceil(12/8)` = 2 ticks every position is inspected and the highest-posKey entry drains — integration-checks the same rotation `PendingSurgeQueueTest` proves at >1024 scale |
| `u05_jar_capacity_and_caps` | capacity 100,000; `maxInsertPerTick() == capacity()`; extract actuals cap at 1,000 Cg/t |
| `u05_jar_absorb_is_remaining_capacity` | `absorbSurge` actuals equal remaining capacity via the shared `ChargeBuffer` (both roles observe one stored value) |
| `u05_jar_fill_stages_comparator` | blockstate `fill` and comparator signal match §7 formulas in-world |
| `u05_jar_persistence_envelope` | §3.1 envelope round-trip; unload/reload keeps stored Cg (D7 inheritance proof) |
| client: jar fill-stage screenshot appended to the smoke set | visual fill stages T2 |

**Exit gate P1:** all of the above green **plus** the standing suites:
`./gradlew check build` (catalog validation, parity digest byte-identical to
CP0C, all pre-existing tests untouched), `runGameTest`, datagen determinism,
server smoke + restart probe, client smoke with the extended screenshot list,
handbook completeness (pages `cuprum:power/lightning_capture_rods`,
`cuprum:power/leyden_jar_batteries` with the U05 PARTIAL notice, EN/DE), the §12
three-file API-freeze diff for `power`, `configSchemaFreeze` unchanged.

**P2 — U01** (dome tests on `cuprum-gametest:empty_24`)

| Test | Proves |
|---|---|
| `u01_multiblock_pattern_loaded` | reloader delivers `cuprum:storm_shield_core` with §4's exact dims/members/controller cell |
| `u01_multiblock_forms_and_faults` | formation from the built structure; member-break fast path faults; repair re-forms |
| `u01_dome_activates_with_upkeep_32` | formed + charged ⇒ ACTIVE; the DEFENSE consumer fills the §8 escrow through the allocator and upkeep spends exactly 32 Cg/t from it via `extractExact` |
| `u01_upkeep_starves_and_collapses` | storage and escrow exhausted ⇒ dome drops within the documented poll window; resumes when recharged |
| `u01_claim_of_placer_stored` | the controller envelope round-trips the `Claim.ofPlacer` claim; `OwnershipService.allows` honors owner and `cuprum.admin.override` |
| `u01_persistence_restart` | controller state (formation, charge link, escrow stored value, claim) across the restart probe |
| client: `u01_dome_t2_shell_renders` + screenshot | T2 shell visible, **0 custom-pipeline submits**, world-FX RenderType census still 1 |

**Exit gate P2:** P1 gate repeated (all suites) + the P2 table + handbook page
`cuprum:shield/storm_shield_core` (EN/DE) + the §12 three-file diff for `shield`.

**P3 — U02**

| Test | Proves |
|---|---|
| `NormalPack24Test` (unit, MC-free) | §8 pinned algorithm: axis vectors round-trip exactly; `NORMAL_PACKED_UP` decodes to (0, 1, 0); non-finite and near-zero inputs pack to `NORMAL_PACKED_UP`; −128 bytes never produced; per-component decode error ≤ 1/254 over a sampled unit sphere |
| `ShieldImpactPayloadTest` (unit) | codec bounds: `normalPacked24` range [0, 0xFFFFFF] reject-not-clamp with 0x000000 also rejected, `surfaceOffsetQ8` range (0, 16,383] reject-not-clamp, nonce range 0..255 reject-not-clamp, encoded size ≤31 B ≤ `SHIELD_IMPACT_PAYLOAD_MAX_BYTES` |
| `InterceptCostTest` (unit) | §8 boundary table: 0 / 1.0 / pinned arrow speed / 10.0 / 10.0+ε / NaN / Q8 rounding edges |
| `OrientedRippleBasisTest` (unit) | normal → orthonormal basis is deterministic; +Y basis reproduces the W1D XZ ring exactly; the §8 pinned impact-point math — world `Vec3.atCenterOf(center) + decodedNormal × (surfaceOffsetQ8 / 256.0)` and its block-local equivalent — including the **offset-0 legacy branch taking the pre-change path** (old constants, old positions) |
| `FxRippleRingIdentityTest` (unit) | widened (posKey, startTick, nonce) identity; legacy tuples (nonce 0) coalesce exactly as W1D; the three new columns (normalPacked24/nonce/surfaceOffsetQ8) round-trip through `visitAtOriented` **and** `visitAllOriented`; legacy 4-arg `addIfAbsent` yields `NORMAL_PACKED_UP`/0/0; eviction/expiry unchanged |
| `u02_arrow_intercepted_at_surface` | incoming arrow removed at the boundary, never inside |
| `u02_intercept_cost_exact` | scripted projectile at pinned velocity costs exactly the §8 formula, spent atomically from the controller escrow |
| `u02_no_charge_no_intercept` | empty escrow/network ⇒ projectile passes; no partial payment ever |
| `u02_escrow_replenishes_partial` | multiple partial `accept` deliveries fill the escrow through the existing allocator; deficit-driven `demandPerTick` observed |
| `EscrowExtractExactTest` (unit, MC-free) | `extractExact` returns false below `cost + reserve` without mutating; a deliberately mis-budgeted buffer (extract budget < cost, violating the escrow's budget-equals-capacity precondition) makes the **simulate** guard throw `IllegalStateException` — and the test then asserts `stored()` (and a subsequent full-budget extract) are completely unchanged, proving the guard failure mutates nothing |
| `u02_upkeep_reserve_boundaries` | the §8 boundary table: escrow 631/632/633 with one 600 Cg intercept + 32 Cg upkeep, **both engine orders driven explicitly** — 631 denies the intercept (final 599), 632 pays both (final 0), 633 pays both (final 1); upkeep is paid in every cell (upkeep-preservation guarantee); reserve drops to 0 once `upkeepPaidGameTime == gameTime` |
| `u02_two_impacts_one_budget_deterministic` | two projectiles, escrow for one ⇒ first-ticked (controlled spawn order) intercepts, second passes |
| `u02_brownout_defense_priority` | 50%-supply brownout ⇒ the DEFENSE dome request is filled before MISC targets |
| `u02_escrow_persistence_restart` | escrow stored value round-trips the controller envelope across the restart probe |
| `u02_same_tick_impacts_distinct` | two same-tick impacts on one dome carry distinct nonces and occupy two pool slots (server payload count + client pool count) |
| `u02_impact_payload_rate_capped` | one S2C `shield_impact` per intercept; ≥9 intercepts in one second reach one client as ≤8 payloads (send window) |
| client: `u02_impact_ripple_renders` + screenshot/recording | **T1**: oriented ripple on the **existing** `fx_ripple` RenderType at the derived impact point, ring tangent to the dome; shared pool eviction; census still 1 |
| client: `u02_impact_t2_motes_at_point` | forced T2 rung ⇒ the mote cadence bursts (via `visitAllOriented` and `spawnMoteBurstAt`) spawn at the §8 world impact point `Vec3.atCenterOf(center) + decodedNormal × (surfaceOffsetQ8 / 256.0)`, not at the dome center |
| client: `u02_impact_t3_burst_at_point` | forced T3 rung ⇒ the single arrival burst spawns at the impact point |
| client: `u02_legacy_ripple_tiers_unchanged` | a W1D `FxRipplePayload` ripple under T1/T2/T3 in turn: ring geometry, T2 cadence positions and T3 burst position all match pre-change behavior exactly (offset-0 short-circuit), and the pre-existing W1D ripple screenshots pass unchanged (backward-compat proof) |

**Exit gate P3:** cumulative suites + P3 table + handbook page
`cuprum:shield/storm_shield_projectile_interception` (EN/DE) + the §12(1)
lock diff covering exactly the `client.fx` snapshot/dispatcher extension (the
main-`fx`/`fx.core`/`client.fx.render` changes carry no lock impact).

**P4 = W4 — U23 + prototype gate:** the CP0C §6.1 items 1–8 verbatim, with the
§12(8) clarifications: item 1's GameTime clause is satisfied by a **recorded
probe outcome** (either sign) + the CPU-packed fallback design; item 2's
dispatch proof uses production variant 0 + the one diagnostic variant (§9);
item 8's ms figures are captured and logged as evidence while the **CI-binding**
assertions at W4 are the counter gates (callbacks ≤2/projector, ≤4,096/≤8,192
verts, HOLO 32/128 carve-out, flash governor ≤3 Hz, 0 custom submits under
REDUCED/Iris-sim). Census after P4: exactly **3** world-FX RenderTypes (§3).
Plus `u23_iris_simulated_cap_t2` (§10) and the two-launch script (§11). Hard
wall-clock gating remains exclusively **W14** (`w14_holo_frame_budget`).

**P5/P6:** deferred rows resume against their own sealed acceptance rows and test
ids (e.g. `server_gametest:shd04_strike_capture`,
`client_gametest:vfx11_astronaut_drift`, `vfx12_meteor_rate`,
`vfx13_star_cadence`, `vfx14_taco_party`); CP1A intentionally does not
re-specify them — the concept docs already do. The §2 P5 boundary is binding.

## 14. Review reconciliation record

### Round 1 (pre-CP1A rejected plans)

1. **"VFX-11..14 used as W4 diagnostics" (scope error)** — upheld; resolved in
   §1/§9: full features at W13, never diagnostics.
2. **"Sequencing rewrote waves"** — upheld; resolved in §1/§2.
3. **"270,000 vs 243,000 Cg contradiction"** — reconciled: the 10% is a
   *redirect* loss of SHD-04/PWR-24; direct callbacks deposit the full 270,000
   Cg (§5; `RepairedConceptSemanticsTest` is the pin).
4. **"Route bypasses or edits the frozen graph"** — resolved by audit (§6).
5. **"Invented config keys / fifth RenderType / unnamed ids"** — resolved by the
   ledger (§3).
6. **"W4 wall-clock gate vs counter rule ambiguity in CP0C"** — reconciled:
   counters are the CI gates at W4, milliseconds at W14 (§12(8), §13).
7. **"GameTime uniform assumed"** — upheld; probe with both outcomes acceptable
   and the CPU-packed fallback (§9).

### Round 2 (both evaluators rejected revision 1)

1. **Producer room-gating route flawed** — upheld and withdrawn. Revision 1's
   rod (STORAGE+PRODUCER with per-tick `nodeReport` room checks) fought the
   allocator, made a false "discharge never vents" claim, and scanned islands
   per rod per tick. Replaced by §6: connector rod + queued `depositSurge` +
   jars as `ChargeStorage`+`SurgeAbsorber` on one `ChargeBuffer` — the surge
   path used exactly as the frozen core documents it, with exact
   accepted/vented/dropped accounting and no no-vent claim.
2. **Ripple orientation unaddressed / send cap missing** — upheld; §8 sanctions
   the smallest backward-compatible oriented extension (normal in
   snapshot/extracted state, +Y default bit-identical, shared pool, lock
   review) and the per-client `FxSendWindow` cap (8/s) on the same hardened
   session object.
3. **U05 falsely implied complete** — upheld; §7/§12: U05 is `PARTIAL` in the
   ratchet with an EN/DE pending-scope notice and may not enter the
   fully-implemented set before W5.
4. **U06/U07/U16/U20 orphaned; P5 unbounded** — upheld; §2 assigns all four
   W1-cataloged rows to the first P5 batch and pins the exact P5/P6 boundary.
5. **RenderType census wrong at W4** — upheld; §3: 1 before W4, **3 at W4**,
   4 only when the arc owner lands.
6. **Variant-dispatch proof under-specified** — upheld; §9: variant 0 = U01
   shell (production) + exactly one non-catalog diagnostic variant proves
   dispatch between two ids; still exactly one diagnostic surface variant and
   one diagnostic interior scene.
7. **Nonexistent/wrong APIs** — upheld; corrected everywhere:
   `Registry.getOrThrow(ResourceKey)` (no `getHolderOrThrow` in 1.21.9),
   `ChargeGraphManager.of(ServerLevel)` (no `get`), ownership via
   `Claim.ofPlacer` + `OwnershipService.allows` (no "recorder"), POI tested
   through public `PoiManager.findClosest`/`PoiTypes.forState` (private
   `findLightningRod` never referenced by tests).
8. **U02 cost formula non-integral/undefined** — upheld; §8 pins sampling,
   Q8 fixed point, floor rounding, the 10 blocks/tick cap, non-finite handling,
   full-payment semantics and the boundary test table.
9. **Multiblock key cap misquoted; VFX citations were grep line numbers** —
   upheld; §4 corrects to `MAX_KEY_ENTRIES = 64` (32 is the per-matcher state
   cap) and §1 cites VFX-11..14 by row id in the `VFX.md` §5.1 table.
10. **POI injection mechanics vague** — upheld; §5 now states exactly which map
    is mutated (`TYPE_BY_STATE`), that the `PoiType` record's `matchingStates`
    is immutable and unaffected, which three code paths the attraction relies
    on, and the accepted `poiType.is(state)` asymmetry.
11. **Jarless behavior undocumented** — upheld; §6: at least one connected jar
    with room is required for useful capture; jarless deposit vents exactly
    270,000 Cg; handbook says so.
12. **Per-rod scans / no queue budget** — upheld; §6: no `nodeReport` calls;
    drain budget 8 per level-tick (round 3 sharpened it to inspection-counting
    and renamed the constant `SURGE_DRAIN_INSPECTIONS_PER_TICK`); empty queue
    costs one check; `u04_drain_budget_inspections_bounded` pins it. *(Round 4
    withdrew this round's over-claim that no island scans occur anywhere —
    `depositSurge` itself scans the loaded island; see round 4 item 4.)*
13. **New packages invisible to the API freeze** — upheld; §12(1): each phase's
    new package lands as a three-file reviewed diff (content +
    `ApiFreezeTest.FROZEN_PACKAGES` + regenerated lock); in-package changes stay
    two-file.

### Round 3 (Sol reject findings + Fable required edits on revision 2)

1. **U04 block under-specified** — upheld; §5 now pins the exact 1.21.9 shape:
   `LightningCaptureRodBlock extends LightningRodBlock implements EntityBlock`
   (vanilla `LightningRodBlock` is not an `EntityBlock`), the required
   `newBlockEntity` override, its own `simpleCodec` `CODEC` with the
   `codec()` override matching vanilla's `MapCodec<? extends
   LightningRodBlock>` signature, no `getTicker` (default null — no BE
   ticker), `FabricBlockEntityTypeBuilder` registration in `PowerContent`, and
   node lifecycle via the manager's existing `BLOCK_ENTITY_LOAD`/`UNLOAD`
   hooks.
2. **Oriented ripple hid the pool change** — upheld; §8 now names every
   touched class with its freeze status (`FxRippleRing` columns + widened
   identity, `FxDispatcher`/`FxRippleSnapshot` lock diff,
   `FxProbeRenderState`/`FxRippleGeometry` internals, broadcaster), carries
   exact impact center (Q8-derived), outward unit normal, visual radius and an
   8-bit event nonce with rigorously defined coalescing (exact duplicates
   no-op; distinct nonces occupy distinct slots), keeps the shared 16-slot
   eviction and existing RenderType, defines the backwards-compatible +Y/0
   constructor, and no longer claims the pool is untouched. *(Round 5 item 2
   replaced the wire representation: the payload now carries
   center + normal + `surfaceOffsetQ8` — the impact point is derived, never
   sent — and the visual radius became a client constant.)*
3. **Queue durability gap in `maybeSnapshot`** — upheld; §6: `queueDirty` set
   on every append/drain/drop mutation, added to the early-return condition,
   cleared only after the snapshot; `u04_queue_dirty_snapshot` restarts after
   an enqueue onto already-snapshotted state. *(Round 4 split cursor motion
   out of `queueDirty` — this round's "every cursor mutation" rule would have
   forced full-graph snapshots on cursor-only advances; see round 4 item 4.)*
4. **Queue budget/fairness under-specified** — upheld; §6: the 8-entry budget
   counts every inspected entry including dormant/dirty skips; a persisted
   deterministic round-robin cursor over the canonical ascending-posKey ring
   prevents starvation (order = canonical, cursor = starting point only);
   `u04_drain_budget_inspections_bounded` pins the inspection semantics.
   *(Round 4 moved the >1024-entry starvation proof from the gametest into the
   MC-free `PendingSurgeQueueTest` and rescoped `u04_queue_no_starvation` to a
   small-K integration; see round 4 item 5.)*
5. **U02 payment unimplementable as written** — upheld; §8 replaces it with a
   persisted controller-local escrow `ChargeBuffer`: the DEFENSE-priority
   graph consumer accepts partial deliveries only into escrow; upkeep and
   intercepts spend through one atomic all-or-nothing `extractExact` helper
   under server-thread ordering; capacity (1,280), replenishment, simultaneous
   impacts, brownout, relays, serialization and tests are pinned; **no graph
   reservation API** and no new `ChargeBuffer` method. *(Round 4 corrected
   this round's unconditional 32-Cg reserve — it was itself order-dependent
   after upkeep had been paid — with the `upkeepPaidGameTime` marker, and
   narrowed the guarantee to upkeep preservation only; see round 4 item 1.)*
6. **Variant ids unpinned** — upheld; §9: diagnostic surface variant id = 1,
   packed valid range exactly 0..1 at W4, server codecs reject out-of-range
   (reject-not-clamp), client render falls back to variant 0 with a
   rate-limited WARN.
7. **`u04_dirty_node_retry` not executable** — upheld; §11 pins the
   package-private rebuild-budget seam (gametest class in
   `dev.cuprum.cuprum.charge`, the repo's established seam-access pattern,
   zero lock impact) and records the >1024-node `empty_24` component as the
   rejected-but-not-forbidden alternative.
8. **Queue restart test setup unpinned** — upheld; §11: the strike is queued
   at a deliberately frozen origin so pending state provably exists at save.
9. **Hostile decode could nuke the record** — upheld; §3/§6/§12(3):
   field-local trim/drop + WARN per queue entry, cursor falls back to its
   default; `nodes`/`vented_total` can never be defaulted by a bad queue
   field; `PendingSurgeCodecTest` pins it.
10. **API-freeze wording conflated main `fx` with `client.fx`** — upheld;
    §12(1) now lists the exact freeze status per file: `charge`/
    `client.fx`-top-level changes are lock diffs; main `fx`, `fx.core` and
    `client.fx.render` are not in `FROZEN_PACKAGES` and carry no lock impact.
    *(Round 5 removed `charge.core` from the lock-diff list entirely by
    relocating `PendingSurgeQueue`; see round 5 item 3.)*
11. **Hard-crash save window unstated** — upheld; §6 states the non-atomic
    SavedData-vs-chunk-BE window honestly: normal shutdown/autosave coherent;
    a hard crash can double-deposit or lose ≤4 queued strikes per rod; no
    mitigation shipped in P1.
12. **Queue changes insufficiently sanctioned** — upheld; §6/§12(1)/§12(3):
    `queueSurge(BlockPos, long)` and `droppedSurgeCgTotal()` are explicitly
    sanctioned frozen-`charge` amendments with pinned signatures, the
    SavedData schema v2 amendment carries migration steps for both WORLD
    domains, and no invented API names remain anywhere in the route.
    *(This round sanctioned `PendingSurgeQueue` as a public `charge.core`
    addition; round 5 item 3 relocated it as a package-private
    `dev.cuprum.cuprum.charge` class needing no lock review at all.)*

### Round 4 (Sol reject findings + Fable test-scoping edit on revision 3)

1. **Unconditional intercept reserve was itself order-dependent** — upheld;
   §8: revision 3's "intercepts always reserve 32" denied a payable intercept
   whenever upkeep had already run first (at escrow 632: order intercept-first
   paid both, order upkeep-first denied the intercept). Rev 4 adds the
   transient `upkeepPaidGameTime` marker — reserve 32 only while this game
   tick's upkeep is unpaid, 0 after — pins the 631/632/633 boundary table for
   **both** engine orders with matching outcomes
   (`u02_upkeep_reserve_boundaries`), and defines the marker's lifecycle:
   set on successful upkeep extraction, self-expiring by game-time
   comparison, deliberately not persisted (reload reverts to the
   conservative "unpaid" state; persistence could grant a stale reserve-0).
2. **Tick-window and partial-extraction discipline unproven** — upheld; §8:
   every escrow path (`accept` insert and `extractExact` spend) calls
   `ChargeBuffer.beginGameTick(gameTime)` before observing budgets;
   `extractExact` verifies the returned extraction equals `cost` and throws
   `IllegalStateException` on mismatch. The equality is proven invariant:
   within one tick all escrow extracts (entity/BE phase) precede all inserts
   (allocator `accept` at `END_WORLD_TICK`), so Σ extracts ≤ window-start
   `stored` ≤ capacity = extract budget — the budget can never bind before
   the `stored ≥ cost + reserve` precheck does. `EscrowExtractExactTest`
   drives the loud-failure guard against a mis-budgeted buffer. *(Round 5
   item 5 tightened the body to simulate-first: rev 4's version performed the
   real extract before its guard, so the loud failure could strand a partial
   extraction.)*
3. **Nonce flow not executable** — upheld; §8: `broadcastShieldImpact` now
   takes an explicit `int nonce` parameter; the controller BE owns the
   counter, increments/wraps (`& 0xFF`) exactly once per accepted intercept
   at payload-build time, and the broadcaster only encodes the given value —
   ownership, increment, wrap and payload lifecycle are all pinned in one
   place.
4. **Queue perf over-claim and snapshot amplification** — upheld; §6: the
   "no island scans anywhere" claim is withdrawn — each `depositSurge` call
   scans the origin's loaded sub-island (frozen core behavior). Rev 4 drains
   at most ONE queued amount per inspected position per tick (≤8
   `depositSurge` calls/level/tick), states an honest complexity bound and
   pins the counter (deposits ≤ 8), not an unenforceable wall-clock claim.
   Cursor motion is runtime-only `cursorDirty`, excluded from
   `maybeSnapshot`'s early return, persisted opportunistically with any
   content/accounting snapshot; content append/drain/drop still set
   `queueDirty` and snapshot. Fairness reconciled: `ceil(K/8)` holds within a
   single run and steady-state traffic keeps the persisted cursor fresh.
   *(Round 5 corrected two residuals: rev 4's "O(8 × island size)" ignored
   the per-absorber `pathCap` BFS — see round 5 item 1 for the
   source-accurate bound — and the rewind is possible on ANY restart, not
   only a hard crash, because cursor-only motion never marks the SavedData
   dirty; see round 5 item 4.)*
5. **Starvation proof mis-scoped (Fable edit)** — upheld; §13: the
   >1024-entry starvation proof moves to the MC-free `PendingSurgeQueueTest`;
   `u04_queue_no_starvation` becomes a small-K (12 positions) manager
   integration on the default 8×8×8 template; the §11 dirty-node-retry seam
   remains a separate, unchanged concern.
6. **Ripple extension replaced signatures** — upheld; §8: the existing
   `addIfAbsent(long, long, int, int)` overload, `Visitor`,
   `visitAt`/`visitAll`, `enqueueRipple*` and `extractRipplesAt` are retained
   unchanged; the oriented path is additive (`addIfAbsent(..., normalOct,
   nonce)` overload, `OrientedVisitor`, `visitAtOriented`,
   `extractOrientedRipplesAt`); legacy identity (posKey, startTick, 0)
   behaves exactly as W1D and **the existing `FxRippleRing` unit tests must
   pass unmodified** as the pinned compatibility gate. *(Round 5 items 2–3
   completed this: a third `surfaceOffsetQ8` column and `visitAllOriented`
   were added, and the full post-change `FxRippleSnapshot` record and
   dispatcher signatures were pinned against source. Round 6 item 2 then
   renamed the column `normalOct` → `normalPacked24`: the representation was
   never actually pinned as octahedral, and rev 6 pins the exact 24-bit
   signed-component packing instead.)*
7. **Multi-strike and order-independence wording** — upheld; §6/§8: a rod
   with multiple queued strikes drains one per tick (same-tick multi-strike
   drain at a single position is explicitly not a property of the design;
   `u04_multiple_rods_single_jar_deterministic` is two positions, not one),
   and the escrow guarantee is narrowed to **upkeep preservation only** — no
   general order-independence theorem is claimed; intercept-vs-intercept
   outcomes still follow entity tick order.

### Round 5 (Sol residual findings + Fable residual wording on revision 4)

1. **Complexity bound was still false** — upheld; §6: "O(8 × island size)"
   ignored that `depositSurge`, per absorber it feeds, runs a `pathCap` BFS
   over the island when a relay is present (verified in `ChargeGraphCore`).
   Rev 5 defines the symbols N (island nodes), E (island edges, ≤ 3N),
   A (island absorbers), G (all registered nodes a snapshot serializes) and
   K (queue positions), and pins the source-accurate bounds: per deposit
   O(N + A·(N + E)) (relay-free islands collapse toward O(N)), per tick ≤ 8
   deposits ⇒ O(8·(N + A·(N + E))), and any content-mutating drain tick
   additionally triggers an O(G + K) snapshot. Counters remain the only CI
   gates; no wall-clock claim. *(Round 6 item 1 corrected this round's "a
   cold island cache adds one O(N + E) refresh": the cache rebuilds are
   GLOBAL — O(L log L) sort plus O(L + Eg) labeling — and are paid by
   `core.tick()`, never by the drain, which always runs warm.)*
2. **Oriented fallback incomplete / representation incoherent** — upheld;
   §3/§8: `visitAllOriented(OrientedVisitor)` added (the T2 cadence migrates
   to it); a third ring column `surfaceOffsetQ8` (0 = legacy, > 0 = shield)
   carries the discriminator through ring → snapshot → render state; all
   three tiers compute the impact point by the single rule
   `center + normal × surfaceOffsetQ8` with a pinned offset-0 short-circuit
   keeping legacy output byte/position identical at T1/T2/T3. The payload
   now carries exactly one coherent representation — center + normal +
   `surfaceOffsetQ8`, no duplicate exact-center coordinates, no wire visual
   radius (client constant `SHIELD_IMPACT_RING_RADIUS_Q8`) — recalculated at
   8+3+2+5+2+10 = ≤30 B ≤ 32. Tier tests pinned
   (`u02_impact_t2_motes_at_point`, `u02_impact_t3_burst_at_point`,
   `u02_legacy_ripple_tiers_unchanged`). *(Round 6 item 2 replaced the still
   unpinned 16-bit normal encoding with the exact 24-bit signed-component
   packing, moving the budget to 8+4+2+5+2+10 = ≤31 B ≤ 32.)*
3. **Lock-visible guessing** — upheld; §8/§12(1): the current
   `FxRippleSnapshot(BlockPos center, float maxRadius, int colorArgb, long
   startGameTime)` record was inspected and the full post-change component
   order/types plus the exact dispatcher overload/extraction signatures are
   pinned verbatim; `PendingSurgeQueue` moved from a public `charge.core`
   class to a **package-private `dev.cuprum.cuprum.charge` class** with its
   package-private constructor/method surface pinned for tests — no public
   `charge.core` API is added and the §12(1) lock discussion drops
   `charge.core` from the diff list. *(Round 6 items 2–4 completed both
   pins: the snapshot's normal became the packed int and the queue API
   gained its codec methods and exact ring-function preconditions.)*
4. **Rewind understated as crash-only** — upheld; §6/§12(3): because
   cursor-only motion never marks the SavedData dirty, the save pass skips
   the file — so ANY restart (clean shutdown, autosave, or crash) may rewind
   the cursor to its last snapshotted value; correctness unaffected, only
   the fairness rotation start.
5. **`extractExact` guard could strand a partial** — upheld; §8: the body is
   now simulate-first — `extract(cost, true)` must return exactly `cost` or
   the helper throws with **zero mutation** (simulate skips the state
   update, verified against `ChargeBuffer` source); only then does the real
   extract run, with an unreachable equality assert (nothing executes
   between simulate and commit on the server thread).
   `EscrowExtractExactTest` now also asserts `stored()` is unchanged after
   the simulated-failure throw.
6. **Queue-growth sentence excluded same-tick multi-strikes** — upheld; §6:
   the queue grows past 1 whenever strikes outpace the one-head-per-tick
   drain — same-tick multi-strikes on one rod queue together and drain on
   subsequent ticks — or while the node is frozen/dirty; always bounded by
   the 4-cap.

### Round 6 (Sol exactness findings on revision 5)

1. **Warm and cold costs conflated** — upheld; §6: revision 5 charged the
   drain a per-deposit "cold island cache refresh O(N + E)", which is wrong
   twice over — the cache rebuilds are **global** (`refreshCanonicalCache`
   boxes and sorts every live node, O(L log L) comparisons plus O(L) copy;
   `refreshIslandCache` BFS-labels the entire live graph, O(L + Eg) — both
   verified in `ChargeGraphCore`), and the drain never pays them because it
   runs after `core.tick()` in the same `endWorldTick()` with no topology or
   freeze mutation in between, so its refresh calls are always O(1) version
   checks. Rev 6 defines L/Eg beside N/E/A/G/K, separates the warm drain
   bound O(8·(N + A·(N + E))) from the cold global rebuild paid by
   `core.tick()`, adds the ordered-map queue costs (O(log K) per keyed
   operation, ≤ O(8 log K) per drain tick, O(log K) per append) and keeps the
   O(G + K) content-mutation snapshot. It explicitly states
   **`REBUILD_BUDGET` does not cap the cache rebuilds** (it bounds only
   `runRebuild`'s relabel queue). Only the ≤8 inspections/deposits counters
   remain enforceable gates; every asymptotic statement is documentation.
2. **Normal representation incoherent/underspecified** — upheld; §3/§8: one
   exact **24-bit signed-component packed int** (`normalPacked24`) now
   travels unchanged through payload, `FxRippleSnapshot` (the record carries
   the int, not float triples), `FxRippleRing`, `OrientedVisitor` and into
   render state, decoded exactly once per consumer. The pack/decode
   algorithm is pinned (normalize → per-component `clamp(round(c × 127),
   −127, 127)` → byte-pack; sign-extend and divide by 127, then renormalize;
   error ≤ 1/254 per component), non-finite/near-zero inputs pack to the
   pinned numeric +Y constant `NORMAL_PACKED_UP = 0x007F00`, the payload
   codec rejects out-of-range and zero-vector values, and the column is
   renamed away from `normalOct` because the encoding is deliberately not
   octahedral (justified in §8). Payload recalculated: 8+4+2+5+2+10 =
   ≤31 B ≤ 32 (`NormalPack24Test`, updated `ShieldImpactPayloadTest`).
3. **Impact-point math unpinned** — upheld; §8: world point
   `Vec3.atCenterOf(center).add(decodedNormal.scale(surfaceOffsetQ8 /
   256.0))`; T1 render-local equivalent `(0.5 + nx·d, 0.5 + ny·d,
   0.5 + nz·d)` in the anchor-block-local frame (the pose is already
   translated to the block origin — verified in `FxRippleGeometry`); T2/T3
   spawn at the world point via the new `spawnMoteBurstAt` overload (the
   `BlockPos` method delegates with its historical `(+0.5, +1.1, +0.5)`
   offsets). The `surfaceOffsetQ8 == 0` branch takes the pre-change code
   path verbatim — including the legacy ring's `(0.5, 1.0 +
   HEIGHT_ABOVE_TOP, 0.5)` above-block-top position, which the oriented
   formula would NOT reproduce — preserving all old positions bit-exactly.
4. **Queue API incompletely pinned** — upheld; §6: the package-private
   surface now includes the codec methods (`snapshotKeys`, `amountsAt`,
   `replaceAll` with pinned validation and exception behavior) and exact
   ring-function semantics — `firstKeyAtOrAfter`/`nextKeyAfter` are total
   wrapping functions for non-empty queues that **throw
   `IllegalStateException` when empty** (no nullable returns, no sentinel
   longs), `nextKeyAfter` is a ceiling lookup that works after its argument
   key was removed, and `headAmount`/`removeHead`/`dropAll`/`amountsAt`
   require key presence. The §6 drain pseudocode was rewritten against this
   exact API: one emptiness check, `steps = min(8, positionCount)`, and a
   pinned deterministic cursor value when the loop empties the queue.

## 15. CP1A exit (delta over the CP1 exit checklist)

The FOUNDATION_PLAN §6 CP1 exit checklist applies unchanged (including
"digest byte-identical to CP0C" and "`catalog/**` byte-identical to CP0C").
CP1A adds: every phase gate of §13 green in order, the §12 reviewed diffs each
landed as their own commit, the W4 evidence appendix present in
`docs/API_PROBES.md`, and zero edits to `catalog/**` or `docs/feature-concepts/**`
across the entire CP1A range.
