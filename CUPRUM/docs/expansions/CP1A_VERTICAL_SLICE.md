# CP1A — The Playable Vertical Slice (binding amendment, revision 3)

Status: **BINDING**. This document is the authoritative sequencing and contract
amendment for Cuprum's first post-foundation implementation work, issued at/after
the W1E foundation commit `7b1d9fe`. Revision 3 supersedes revision 2 after the
review round recorded in §14 (round 3) identified binding gaps; §14 records every
finding of all three review rounds and how each was reconciled against repository
truth. Where this document is silent, `docs/foundation/FOUNDATION_PLAN.md` (as
amended by `docs/expansions/CP0C_HOLOSPHERE.md`) and the sealed concept docs
govern; where a rejected plan or an earlier revision disagrees with this
document, this document wins.

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
| P3 | `cuprum:s2c/fx/shield_impact` | S2C | dome center `BlockPos` (8 B) + impact direction, 16-bit octahedral-encoded **outward** unit normal (`VAR_INT` ≤3 B) + dome `radiusQ8` (`VAR_INT` ≤3 B) + `colorArgb` (`VAR_INT` ≤5 B) + **event nonce**, 8-bit wrapping per-dome counter (`VAR_INT` ≤2 B, decode rejects values outside 0..255) + server `gameTime` (`VAR_LONG` ≤10 B) — ≤31 payload bytes, frozen constant `SHIELD_IMPACT_PAYLOAD_MAX_BYTES = 32` beside `RIPPLE_PAYLOAD_MAX_BYTES` in `FxBudgets`. Sent through the §8 per-client send window. The nonce gives two same-tick impacts on one dome distinct pool identities (§8). |

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
| `SURGE_DRAIN_INSPECTIONS_PER_TICK` | 8 | per-level drain-point **inspection** budget — every looked-at entry counts, including dormant/dirty skips (§6) |
| `JAR_EXTRACT_CG_PER_TICK` | 1,000 | jar `maxExtractPerTick()` (base-slice, non-catalog; W5 PWR transmission rows own player-facing rates) |
| `DOME_RADIUS` | 8 | SHD-01 baseline "no coil ⇒ radius 8" |
| `DOME_UPKEEP_CG_PER_TICK` | 32 | `ceil(0.5·R²)` at R = 8 (SHD header formula) |
| `INTERCEPT_BASE_CG` / `INTERCEPT_CG_PER_SPEED` / `INTERCEPT_SPEED_CAP_Q8` | 200 / 40 / 2,560 | §8 exact cost formula |
| `ESCROW_CAPACITY_CG` | 1,280 | dome escrow buffer: upkeep (32) + two worst-case intercepts (2 × 600) + headroom (§8) |
| `ESCROW_UPKEEP_RESERVE_CG` | 32 | escrow floor intercepts may not spend below (§8 order-independence rule) |

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
  while full is dropped-before-deposit (WARN + `droppedSurgeCg`). The queue only
  grows past 1 while a node is frozen/dirty across multiple strikes — a rare,
  bounded window.
- **Durability (`queueDirty`):** the manager keeps a `queueDirty` flag set on
  **every** queue mutation — append (`queueSurge`), drain removal, drop, and
  every cursor advance. `maybeSnapshot()`'s early-return condition gains
  `&& !queueDirty`, and the flag is cleared **only after** the snapshot is
  written. Without this, an enqueue onto an already-snapshotted, otherwise-idle
  state would never persist; `u04_queue_dirty_snapshot` (§13) pins exactly that
  scenario across a restart.
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
- MC-free core discipline (plan D9): the queue's ordering/bounding/cursor
  policy is a small pure class `PendingSurgeQueue` in `charge.core` — a
  sanctioned, lock-reviewed **new class in the frozen `charge.core` package**
  (§12(1)) — unit-tested without Minecraft.

**The drain point (server thread, per level, after graph maintenance):** at the
end of `endWorldTick()`, after `core.tick(access)` and before `maybeSnapshot()`
(so the snapshot persists post-drain queue state and post-deposit shadows), the
manager processes the queue. **The tick budget counts INSPECTED entries** —
every queued position the loop looks at, including dormant/frozen/dirty skips —
not merely completed deposits, so a wall of unprocessable entries cannot make
the loop scan unboundedly:

```
inspected = 0
key = smallest pending posKey >= cursor (wrap to smallest overall if none)
while inspected < SURGE_DRAIN_INSPECTIONS_PER_TICK and pending entries remain unvisited this tick:
    inspected++                                              // dormant/dirty skips consume budget too
    entry = byPos(key)
    if entry == null:
        if dormantRecords contains key: (keep; retry on a later pass)
        else: drop amounts, droppedSurgeCg += Σ, WARN, queueDirty = true   // rod removed while pending
    else if !core.isActive(entry.coreId) or core.networkOf(entry.coreId) == -1:
        (keep; frozen or rebuild-pending: retry)             // dirty-node retry, budget still consumed
    else:
        for each amount (FIFO):
            accepted = core.depositSurge(entry.coreId, amount, access)  // final; remainder vented exactly
            remove amount; queueDirty = true; storedShadowChanged = true
    key = next pending posKey after key (ring order)
cursor = key; queueDirty = true                              // persisted rotation point
```

- **Dirty-node retry** is exactly fact 2: the manager checks stability *before*
  depositing, so the ambiguous "0 accepted" case (all vented vs. not attempted)
  never arises; a deposit, once made, is final and its vented remainder is the
  core's exact, already-counted vent.
- **Perf budget and fairness:** ≤ `SURGE_DRAIN_INSPECTIONS_PER_TICK` (8)
  inspections per level per tick; an empty queue costs one emptiness check.
  Starvation bound (pinned by tests): with `K` pending positions, every
  position is inspected at least once every `ceil(K / 8)` ticks regardless of
  where traffic concentrates — `u04_queue_no_starvation` (§13) proves it with
  >1024 dormant/dirty entries plus sustained low-position strike traffic. No
  `nodeReport`, no island scans, no per-rod per-tick work anywhere in the
  route. Budget-window semantics are the documented core rule: a post-`tick()`
  deposit draws on the current window's remaining absorber budgets,
  cumulatively.

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

- **`FxRippleRing` (`fx.core`, MC-free, amended):** the structure-of-arrays
  slots gain two `int` columns — the 16-bit octahedral **outward unit normal**
  code and the 8-bit **event nonce** — and the **wire identity widens from
  (posKey, startTick) to (posKey, startTick, nonce)** in `addIfAbsent`, with
  the `Visitor` interface extended to carry both new columns. The 16-slot
  capacity, oldest-evicted overflow, `expire` clock-skew rule, compaction and
  zero-steady-state-allocation properties are preserved unchanged in policy,
  but the class itself changes and its unit tests extend accordingly
  (`fx.core` is not in `FROZEN_PACKAGES`, so this is not a lock diff — §12(1)).
- **`FxRippleSnapshot` + `FxDispatcher` (`client.fx` top level — LOCK-FROZEN,
  reviewed lock diff):** the snapshot record gains the decoded unit normal
  (three floats) and the nonce; a **backwards-compatible secondary constructor
  without them defaults to `(0, 1, 0)` and nonce 0**, so the W1D
  `FxRipplePayload` path compiles unchanged and renders bit-identically (the
  +Y basis reproduces today's XZ ring exactly, and legacy identity
  (posKey, startTick, 0) coalesces exactly as (posKey, startTick) did).
  `FxDispatcher.enqueueRipple*`/`extractRipplesAt` thread the new columns
  through enqueue and extraction.
- **`FxProbeRenderState` + `FxRippleGeometry` (`client.fx.render` — internals,
  NOT lock-frozen):** the extracted per-frame state carries per-ripple normal
  components and the **exact impact center** — computed deterministically at
  extraction as `domeCenter + normal × radiusQ8` in Q8 fixed point (so every
  client derives the identical point); `emitRing` builds the ring on an
  orthonormal basis perpendicular to the normal (basis derived
  deterministically from the normal; winding defined so the front face looks
  along the normal, matching today's from-above convention for +Y).
- **`FxRippleBroadcaster` + `FxPayloads` (main `fx` — NOT lock-frozen):** gain
  the shield-impact broadcast entry point and payload registration; no lock
  impact (§12(1)).
- **Event identity (nonce, rigorously):** the server keeps an 8-bit wrapping
  per-dome impact counter (a transient controller-BE field — not persisted;
  the dedupe window is one ripple lifetime, far shorter than a session). Two
  same-tick impacts on one dome carry distinct nonces and therefore occupy two
  pool slots; an exact network duplicate of one payload still coalesces to a
  no-op via `addIfAbsent`. Visual radius rides the existing `radiusQ8` field.
- Eviction policy, 16-slot cap, tier ladder, particle budgets, colorblind
  remap-at-snapshot and disconnect-clear semantics are inherited — shield
  impacts share the **same** ring pool and eviction, which is exactly the SHD
  family perf budget ("ripple/echo payloads reuse the U02 ring buffer, max 16
  concurrent ripples").
- **No new RenderType, no new pipeline:** the impact ring renders through the
  existing `cuprum:fx_ripple` RenderType at T1 and the existing vanilla-pipeline
  T2 fallback; census stays 1 through P3 (§3 table).
- Tests: `FxRippleRingIdentityTest` (unit — widened identity, legacy-tuple
  coalescing, eviction unchanged), `OrientedRippleBasisTest` (unit — §13), and
  the client gametests in §13 including the W1D-screenshot backward-compat
  proof.

**Per-client send window (mirrors the hardened ripple pattern).** The existing
`FxRippleBroadcaster` already keeps one connection-owned `FxSendWindow` session
per client (16/s, JOIN/DISCONNECT/STOP hardened). The sanctioned extension adds a
**second window to the same session** — `SHIELD_IMPACT_SENDS_PER_SECOND = 8` per
client over the same `SEND_WINDOW_TICKS` — and a
`broadcastShieldImpact(level, center, impactDir, radiusQ8, colorArgb)` entry
point that sends the §3 payload to tracking players through that window.
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
- **Atomic spend (`extractExact`):** all dome spending goes through one
  private controller helper — `extractExact(cost)`: `if (escrow.stored() >=
  cost + reserve) { escrow.extract(cost, false); return true; } return false;`
  — all-or-nothing by construction (the escrow's extract budget equals its
  capacity, so a permitted extract always yields exactly `cost`), and atomic
  under the same server-thread confinement every charge entrypoint already
  asserts. This is new `shield`-package content built solely on the existing
  `ChargeBuffer` API — no new graph API, no new `ChargeBuffer` method.
- **Same-tick upkeep-vs-intercept order (order-independent by rule):** rather
  than depending on the engine's entity-vs-block-entity tick ordering, the
  reserve makes the outcome order-free: **intercepts** use
  `reserve = ESCROW_UPKEEP_RESERVE_CG` (32) — they may never spend the escrow
  below one tick of upkeep; the **upkeep** payment itself uses `reserve = 0`
  and may consume the floor. A tick's upkeep therefore can never be starved by
  that tick's intercepts, whichever runs first.
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
  fills observed), `u02_upkeep_reserve_holds` (intercept denied at
  `stored < cost + 32` while upkeep still paid same tick),
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
     `droppedSurgeCgTotal()` (§6, exact signatures pinned there); `charge.core`
     — the new `PendingSurgeQueue` class; `client.fx` (top level) — the
     `FxRippleSnapshot` normal/nonce extension and the `FxDispatcher`
     threading of the new columns. The `charge.persist` schema change rides
     the `charge`-adjacent review in the same diff.
   - **No lock impact (not in `FROZEN_PACKAGES`):** main `fx` package
     (`FxRippleBroadcaster` shield-impact window/entry point, `FxPayloads`
     registration) and `fx.core` (`FxRippleRing` columns/identity,
     `FxBudgets` constant additions), plus `client.fx.render` internals
     (`FxProbeRenderState`, `FxRippleGeometry`) — the W1 freeze deliberately
     froze only the top-level `client.fx` entry points. The §11
     package-private rebuild-budget seam is invisible to the `javap
     -protected` listing and has no lock impact either.
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
   record or defaults `nodes`/`vented_total`), the `queueDirty` participation
   in `maybeSnapshot`, and the §6 hard-crash save-window statement — covered
   by `PendingSurgeCodecTest` plus extending the existing saved-data gametests
   and the restart probe.
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
7. **`FxBudgets`:** P3 adds `SHIELD_IMPACT_PAYLOAD_MAX_BYTES = 32` and
   `SHIELD_IMPACT_SENDS_PER_SECOND = 8`; W4 applies the CP0C-sanctioned holo
   budget additions. No existing constant changes.
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
| `PendingSurgeQueueTest` (unit, MC-free) | ascending-posKey ring order with cursor start/wrap, per-pos FIFO, 4-entry bound with exact drop accounting, inspection-counted budget |
| `PendingSurgeCodecTest` (unit) | field-local hostile decode: >4-per-key trimmed, out-of-range amounts dropped, malformed entries dropped (each WARN), malformed cursor defaults — while `nodes`/`vented_total` in the same record decode untouched |
| `JarFillStageTest` (unit) | exact `fill` and comparator integer formulas at boundary values (0, 1, ⅓·cap ± 1, ⅔·cap ± 1, cap) |
| `u04_scripted_strike_full_deposit` | scripted `LightningBolt` on the rod queues and (same `endWorldTick`) deposits exactly 270,000 Cg into an empty 3-jar bank; conservation Σ == 270,000, vented == 0 |
| `u04_channeling_strike_deposit` | channeling-path bolt triggers the same full queue+deposit |
| `u04_poi_natural_attraction_registered` | black-box §5 proof via public `PoiTypes.forState` + `PoiManager.findClosest` only |
| `u04_jarless_strike_vents_exact` | no jar in the island ⇒ deposit vents exactly 270,000 Cg (counted in `ventedTotal`), rod holds nothing |
| `u04_partial_capacity_vents_exact` | one jar at 30,000/100,000 ⇒ exactly 70,000 absorbed, 200,000 vented |
| `u04_multiple_rods_single_jar_deterministic` | two rods struck in one tick, one empty jar, fresh drain cursor (`Long.MIN_VALUE`) ⇒ the lower-posKey rod's strike fills the jar (100,000), its remainder and the second strike vent exactly; ring order + cursor determinism asserted |
| `u04_dirty_node_retry` (in `dev.cuprum.cuprum.charge`, §11 seam) | rebuild budget lowered via the package-private seam ⇒ strike queued while the rod's component is rebuild-pending ⇒ 0 deposited, nothing vented, deposit completes after `runRebuild` relabels; queue survives the wait; seam reset in cleanup |
| `u04_queue_persistence_restart` (restart probe extension, §11 pinned setup) | strike queued at a deliberately frozen origin ⇒ pending state provably exists at save; written at schema 2, survives a real process restart, deposits after the chunk reloads |
| `u04_queue_dirty_snapshot` | enqueue onto an already-snapshotted, otherwise-idle graph (no shadow/topology/vent change) ⇒ `queueDirty` alone forces the next snapshot; the strike survives a restart |
| `u04_drain_budget_inspections_bounded` | >8 pending positions (mix of drainable and frozen/dirty) ⇒ exactly 8 **inspections** per tick — skips consume budget — remainder resumes from the persisted cursor next tick |
| `u04_queue_no_starvation` | >1024 dormant/dirty pending entries plus sustained low-position strike traffic ⇒ every position is inspected at least once every `ceil(K/8)` ticks; the highest-posKey entry still drains |
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
| `ShieldImpactPayloadTest` (unit) | codec bounds: octahedral normal round-trip, nonce range 0..255 reject-not-clamp, ≤32 B |
| `InterceptCostTest` (unit) | §8 boundary table: 0 / 1.0 / pinned arrow speed / 10.0 / 10.0+ε / NaN / Q8 rounding edges |
| `OrientedRippleBasisTest` (unit) | normal → orthonormal basis is deterministic; +Y basis reproduces the W1D XZ ring exactly; Q8 impact-center derivation |
| `FxRippleRingIdentityTest` (unit) | widened (posKey, startTick, nonce) identity; legacy tuples (nonce 0) coalesce exactly as W1D; eviction/expiry unchanged |
| `u02_arrow_intercepted_at_surface` | incoming arrow removed at the boundary, never inside |
| `u02_intercept_cost_exact` | scripted projectile at pinned velocity costs exactly the §8 formula, spent atomically from the controller escrow |
| `u02_no_charge_no_intercept` | empty escrow/network ⇒ projectile passes; no partial payment ever |
| `u02_escrow_replenishes_partial` | multiple partial `accept` deliveries fill the escrow through the existing allocator; deficit-driven `demandPerTick` observed |
| `u02_upkeep_reserve_holds` | intercept denied when `stored < cost + 32` while the same tick's upkeep still gets paid (order-independence rule) |
| `u02_two_impacts_one_budget_deterministic` | two projectiles, escrow for one ⇒ first-ticked (controlled spawn order) intercepts, second passes |
| `u02_brownout_defense_priority` | 50%-supply brownout ⇒ the DEFENSE dome request is filled before MISC targets |
| `u02_escrow_persistence_restart` | escrow stored value round-trips the controller envelope across the restart probe |
| `u02_same_tick_impacts_distinct` | two same-tick impacts on one dome carry distinct nonces and occupy two pool slots (server payload count + client pool count) |
| `u02_impact_payload_rate_capped` | one S2C `shield_impact` per intercept; ≥9 intercepts in one second reach one client as ≤8 payloads (send window) |
| client: `u02_impact_ripple_renders` + screenshot/recording | oriented ripple on the **existing** `fx_ripple` RenderType at the derived impact center, ring tangent to the dome; shared pool eviction; census still 1; pre-existing W1D ripple screenshots unchanged (backward-compat proof) |

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
12. **Per-rod scans / no queue budget** — upheld; §6: no `nodeReport`/island
    scans anywhere in the route; drain budget 8 per level-tick (round 3
    sharpened it to inspection-counting and renamed the constant
    `SURGE_DRAIN_INSPECTIONS_PER_TICK`); empty queue costs one check;
    `u04_drain_budget_inspections_bounded` pins it.
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
   constructor, and no longer claims the pool is untouched.
3. **Queue durability gap in `maybeSnapshot`** — upheld; §6: `queueDirty` set
   on every append/drain/drop/cursor mutation, added to the early-return
   condition, cleared only after the snapshot; `u04_queue_dirty_snapshot`
   restarts after an enqueue onto already-snapshotted state.
4. **Queue budget/fairness under-specified** — upheld; §6: the 8-entry budget
   counts every inspected entry including dormant/dirty skips; a persisted
   deterministic round-robin cursor over the canonical ascending-posKey ring
   prevents starvation (order = canonical, cursor = starting point only);
   `u04_queue_no_starvation` runs >1024 dormant/dirty entries under sustained
   low-position traffic; `u04_drain_budget_inspections_bounded` pins the
   inspection semantics.
5. **U02 payment unimplementable as written** — upheld; §8 replaces it with a
   persisted controller-local escrow `ChargeBuffer`: the DEFENSE-priority
   graph consumer accepts partial deliveries only into escrow; upkeep and
   intercepts spend through one atomic all-or-nothing `extractExact` helper
   under server-thread ordering; the 32-Cg upkeep reserve makes same-tick
   ordering irrelevant; capacity (1,280), replenishment, simultaneous impacts,
   brownout, relays, serialization and tests are pinned; **no graph
   reservation API** and no new `ChargeBuffer` method.
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
    §12(1) now lists the exact freeze status per file: `charge`/`charge.core`/
    `client.fx`-top-level changes are lock diffs; main `fx`, `fx.core` and
    `client.fx.render` are not in `FROZEN_PACKAGES` and carry no lock impact.
11. **Hard-crash save window unstated** — upheld; §6 states the non-atomic
    SavedData-vs-chunk-BE window honestly: normal shutdown/autosave coherent;
    a hard crash can double-deposit or lose ≤4 queued strikes per rod; no
    mitigation shipped in P1.
12. **Queue changes insufficiently sanctioned** — upheld; §6/§12(1)/§12(3):
    `queueSurge(BlockPos, long)` and `droppedSurgeCgTotal()` are explicitly
    sanctioned frozen-`charge` amendments with pinned signatures,
    `PendingSurgeQueue` a sanctioned `charge.core` addition, the SavedData
    schema v2 amendment carries migration steps for both WORLD domains, and
    no invented API names remain anywhere in the route.

## 15. CP1A exit (delta over the CP1 exit checklist)

The FOUNDATION_PLAN §6 CP1 exit checklist applies unchanged (including
"digest byte-identical to CP0C" and "`catalog/**` byte-identical to CP0C").
CP1A adds: every phase gate of §13 green in order, the §12 reviewed diffs each
landed as their own commit, the W4 evidence appendix present in
`docs/API_PROBES.md`, and zero edits to `catalog/**` or `docs/feature-concepts/**`
across the entire CP1A range.
