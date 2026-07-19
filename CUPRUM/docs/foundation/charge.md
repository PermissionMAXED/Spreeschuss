# Cg Charge Graph — W1 Foundation Spec

Status: CONCEPT (W1). Implementation-complete design for the charge/energy foundation
consumed by U04/U05 (W1), U01 dome upkeep (W2, `ceil(0.5·R²)` Cg/t per
`docs/feature-concepts/SHD.md`) and the PWR family (W5). Binding constants come from
`docs/feature-concepts/INDEX.md` (Vocabulary) and `PWR.md`: strike = 270,000 Cg,
U05 jar = 100,000 Cg, baseline B = 5 Cg/t, U19 wire 200 Cg/t, solver budget
≤0.15 ms/tick @1,000 nodes, "per-dimension charge graph is SavedData; unloaded
sub-islands freeze (no phantom transfer)".

W1 ships infrastructure only: graph core, sided lookup, persistence, diagnostics and a
gametest harness. No catalog gameplay blocks (U04/U05 teams build on this; the 250
additional entries stay blocked until CP3).

## 1. Verified API facts (1.21.9 Mojmap + Fabric API 0.134.1)

Checked against the decompiled sources in `.gradle/loom-cache/minecraftMaven/...-sources.jar`
and the remapped Fabric module sources in `.gradle/loom-cache/remapped_mods/`
(same method as `docs/API_PROBES.md`):

- `net.minecraft.world.level.storage.ValueInput` / `ValueOutput` are interfaces:
  `getIntOr(String,int)`, `getLongOr(String,long)`, `putInt`, `putLong`, `child(String)`,
  `read(String,Codec<T>)`, `store(String,Codec<T>,T)`, typed lists.
- `BlockEntity` hooks: `protected void saveAdditional(ValueOutput)`,
  `protected void loadAdditional(ValueInput)`; save/load helpers use
  `new ProblemReporter.ScopedCollector(path, LOGGER)` +
  `TagValueOutput.createWithContext(collector, registries)` /
  `TagValueInput.create(collector, registries, tag)`;
  `public void preRemoveSideEffects(BlockPos, BlockState)` (1.21.9 split of the old
  `onRemove`); block-side neighbor hook is
  `affectNeighborsAfterRemoval(BlockState, ServerLevel, BlockPos, boolean)`.
- `SavedDataType<T>` is a record `(String id, Function<SavedData.Context,T> constructor,
  Function<SavedData.Context,Codec<T>> codec, DataFixTypes dataFixType)` with a
  convenience ctor `(String, Supplier<T>, Codec<T>, DataFixTypes)`;
  `ServerLevel.getDataStorage().computeIfAbsent(SavedDataType)`.
  `DimensionDataStorage.readTagFromDisk` calls `type.dataFixType().update(...)`
  unconditionally when a file exists → a `null` DataFixTypes NPEs on the first
  post-restart read. See PROBE-3.
- `BlockApiLookup.get(ResourceLocation, Class<A>, Class<C>)`, `registerSelf`,
  `registerForBlockEntity(BiFunction<T,C,A>, BlockEntityType<T>)`, `registerForBlocks`,
  `registerFallback`; `BlockApiCache.create(lookup, ServerLevel, BlockPos)`.
- Lifecycle events: `ServerTickEvents.END_WORLD_TICK` (`onEndTick(ServerLevel)`),
  `ServerChunkEvents.CHUNK_LOAD/CHUNK_UNLOAD/CHUNK_LEVEL_TYPE_CHANGE`,
  `ServerBlockEntityEvents.BLOCK_ENTITY_LOAD/BLOCK_ENTITY_UNLOAD`.
- `BlockEntityType`'s constructor is private; use
  `FabricBlockEntityTypeBuilder.create(Factory, Block...)` (current, not deprecated) and
  `Registry.register(BuiltInRegistries.BLOCK_ENTITY_TYPE, key, ...)`.
- `MinecraftServer.isSameThread()` (via `BlockableEventLoop`); `Level.shouldTickBlocksAt(long)`
  and `(BlockPos)`; `Level.isLoaded(BlockPos)`; `LevelChunk.getBlockEntities()` returns
  `Map<BlockPos, BlockEntity>`; `Level.getGameTime()`.
- Commands: `CommandRegistrationCallback` (fabric-command-api-v2)
  `register(CommandDispatcher<CommandSourceStack>, CommandBuildContext, Commands.CommandSelection)`;
  `Commands.literal(...)`, `Commands.hasPermission(int)` returns a `PermissionCheck`
  usable in `.requires(...)`; `CommandSourceStack.sendSuccess(Supplier<Component>, boolean)`.
- GameTests: Fabric `@GameTest(maxTicks, setupTicks, skyAccess, ...)` on public non-static
  methods taking `GameTestHelper`; helper provides `assertValueEqual(N,N,Component)`,
  `getBlockEntity(BlockPos, Class<T>)`, `runAfterDelay`, `succeedWhen`, `destroyBlock`,
  `spawn(EntityType, BlockPos)`, `getTick()`.
- Lightning: `LightningBolt.tick` calls `powerLightningRod()` which fires
  `LightningRodBlock.onLightningStrike(BlockState, Level, BlockPos)` on any
  `instanceof LightningRodBlock`; natural-strike attraction targets the POI type
  `minecraft:lightning_rod` via `ServerLevel.findLightningRod`, and
  `PoiTypes.registerBlockStates` is private (U04 concern, PROBE-4).
- fastutil (`it.unimi.dsi.fastutil`) ships with Minecraft; `org.jetbrains.annotations`
  is on the dev compile classpath.
- `src/test` compiles against main-source-set classes today
  (`CuprumCatalogGeneratedTest` uses the generated `CuprumCatalog`), so pure-Java main
  classes are JUnit-testable without build changes.

## 2. Frozen public API

All new code under `src/main/java/dev/cuprum/cuprum/charge/`. Two strict layers.

### 2a. `dev.cuprum.cuprum.charge.core` — pure Java, ZERO Minecraft imports

JUnit-testable in `src/test`. All Cg amounts are `long`; no `int` Cg anywhere.

```java
public final class ChargeMath {
    public static long satAdd(long a, long b);            // saturating, never wraps
    public static long satSub(long a, long b);            // floors at 0 (Cg semantics)
    public static long clamp(long v, long min, long max);
    public static long mulDiv(long amount, long num, long den); // floor; overflow-guarded (Math.multiplyHigh)
    // Line loss in TENTHS of a percentage point per full 16-block span:
    // bare U19 wire = 20 (2.0 pp), HV = 5 (0.5 pp). delivered = mulDiv(amount, max(0, 1000 - spans*ppTenths), 1000).
    // Pins PWR-14: 8 spans -> 84% bare, 96% HV; clamps at 0% delivered.
    public static long lineLossDelivered(long amount, int spans, int ppTenthsPerSpan);
}

public final class Roles {                                 // bitmask
    public static final int PRODUCER = 1, STORAGE = 2, CONSUMER = 4, RELAY = 8, SURGE_ABSORBER = 16;
}
public enum ChargePriority { DEFENSE, LOGISTICS, MISC }    // PWR-18 tiers; ordinal = allocation order

public final class ChargeGraphCore {                       // topology + solver over dense int ids
    public int  addNode(long posKey, int roleMask, int priority, long capacity, long maxInsert, long maxExtract);
    public void removeNode(int nodeId);                    // marks component dirty (lazy split)
    public void addEdge(int a, int b);
    public void setActive(int nodeId, boolean active);     // chunk freeze flag
    public long topologyVersion();
    public int  networkOf(int nodeId);                     // component id; -1 while dirty
    public RebuildStats runRebuild(int maxVisits);         // budgeted; returns carry-over depth
    public TickReport tick(NodeAccess access);             // deterministic allocator (section 3)
    public long depositSurge(int nodeId, long amountCg, NodeAccess access); // returns accepted
}

public interface NodeAccess {                              // solver pulls state, pushes deltas — the ONLY mutation path
    long offer(int nodeId);                                // producers: Cg offered this tick
    long demand(int nodeId);                               // consumers: Cg wanted this tick
    long stored(int nodeId);
    void applyDelta(int nodeId, long deltaCg);             // storage +/-, consumer feed (+), producer drain (-)
}

public record TickReport(long moved, long vented, int networksTicked, long nanos) {}
public record RebuildStats(int visited, int queueDepth) {}
public record GraphDiagnosticsSnapshot(int nodes, int edges, int networks, int frozenNodes,
        long topologyVersion, long tickNanosLast, long tickNanosEma, long ventedLastTick,
        long ventedTotal, long movedLastTick, int rebuildQueueDepth) {}
```

### 2b. `dev.cuprum.cuprum.charge` — Minecraft-facing, server-side only

```java
public final class ChargeApi {
    // Sided lookup; context null = "any side / internal query". Mirrors the proven
    // Fabric energy-API pattern. [PROBE-1]
    public static final BlockApiLookup<ChargeNode, @Nullable Direction> NODE =
        BlockApiLookup.get(ResourceLocation.fromNamespaceAndPath("cuprum", "charge_node"),
                           ChargeNode.class, Direction.class);
}

public interface ChargeNode {
    ChargePriority priority();                             // default MISC
    boolean canConnect(Direction side);                    // adjacency edge gate
}
// Role interfaces; a node may implement several (e.g. PWR-16 later). The solver honors
// exactly the interfaces implemented (instanceof), phase by phase.
public interface ChargeProducer extends ChargeNode { long offerPerTick(); void drain(long acceptedCg); }
public interface ChargeStorage  extends ChargeNode {
    long stored(); long capacity(); long maxInsertPerTick(); long maxExtractPerTick();
    long insert(long amountCg, boolean simulate);          // returns accepted; clamped; never negative
    long extract(long amountCg, boolean simulate);         // returns extracted
}
public interface ChargeConsumer extends ChargeNode { long demandPerTick(); void accept(long amountCg); }
public interface ChargeRelay    extends ChargeNode { long throughputPerTick(); }  // W1: harness only; U19/PWR-01 later
public interface SurgeAbsorber  extends ChargeNode { long absorbSurge(long amountCg); } // reserved: PWR-13/21

public final class ChargeGraphManager {                    // one instance per ServerLevel
    public static void init();      // once from Cuprum.onInitialize(): registers END_WORLD_TICK,
                                    // chunk + BE events, /cuprum cg command
    public static ChargeGraphManager of(ServerLevel level);
    public void notifyNodeAdded(BlockPos pos);             // BE load / onPlace
    public void notifyNodeRemoved(BlockPos pos);           // preRemoveSideEffects (removal, not unload)
    public void notifyNodeChanged(BlockPos pos);           // priority / side shape changed
    public long depositSurge(BlockPos origin, long amountCg); // U04 entry point; returns accepted
    public GraphDiagnosticsSnapshot diagnostics();
    public Optional<NodeReport> nodeReport(BlockPos pos);  // diagnostics read (charge_probe, /cuprum cg node)
}
public record NodeReport(BlockPos pos, int roleMask, ChargePriority priority, long stored, long capacity,
        int networkId, boolean frozen, long networkStored, long networkCapacity, long topologyVersion) {}
// networkStored/networkCapacity are computed over LOADED members only.

// dev.cuprum.cuprum.charge.blockentity
public abstract class AbstractChargeStorageBlockEntity extends BlockEntity implements ChargeStorage {
    protected long stored;
    @Override protected void saveAdditional(ValueOutput output);   // section 5
    @Override protected void loadAdditional(ValueInput input);
    @Override public void preRemoveSideEffects(BlockPos pos, BlockState state); // -> notifyNodeRemoved
}

// dev.cuprum.cuprum.charge.persist  — ChargeGraphSavedData (section 5)
// dev.cuprum.cuprum.charge.diag    — ChargeCommand, ChargeProbeReport (sections 6, 7)
```

Node registration pattern per BE type:
`ChargeApi.NODE.registerForBlockEntity((be, side) -> be.canConnect(side) ? be : null, TYPE);`
with `TYPE = FabricBlockEntityTypeBuilder.create(Ctor::new, BLOCK).build()`.

## 3. Deterministic per-tick allocation (binding semantics)

Runs in `ServerTickEvents.END_WORLD_TICK`, after all BE tickers. Per-tick order:
(1) budgeted rebuild queue, (2) active-set refresh (only if chunk state changed),
(3) allocator. BE tickers may only mutate their OWN node's internal state; every
cross-node transfer happens exclusively in the allocator.

Canonical node order (the only iteration order the solver ever uses):
ascending `(priority.ordinal(), Long.compare(posKey))` where `posKey = BlockPos.asLong()`.
Cached as a sorted array keyed by `topologyVersion`; hash maps are never iterated directly.

Allocator phases, per network, active (loaded) nodes only:

1. **P1 direct:** producer offers → consumer demands. Consumers served fully-greedy in
   canonical order (DEFENSE first). PWR-18 brownout semantics: at 50% supply the
   defense-tier consumer receives 100% of its request, misc receives 0.
2. **P2 charge:** residual offers → storages in canonical order, respecting `maxInsertPerTick`.
3. **P3 discharge:** unmet demand → storage `extract` in canonical order, respecting
   `maxExtractPerTick` (consumers are storage-fed burst loads by design).
4. **P4 overflow/surge:** residual offers and `depositSurge` excess → `SurgeAbsorber`s in
   canonical order; the remainder is **vented**: added to `ventedLastTick`/`ventedTotal`,
   debug-logged, never negative, never wraps.

Surge rule (binding W1 choice, revisited by PWR-13 fuse / PWR-21 ground vent):
`depositSurge` (e.g. a 270,000 Cg strike) bypasses per-tick insert caps but always
respects `capacity`.

No proportional splitting in W1: greedy-in-canonical-order is exact for chain/tree
topologies (all W1–W5 catalog acceptance layouts are chains) and fully deterministic on
meshes. `ChargeRelay.throughputPerTick` is enforced as a per-node pass-through budget
decremented greedily — a documented approximation; exact max-flow is out of scope until
a PWR-era acceptance requires it.

## 4. Incremental rebuild and chunk rules

- **Add node:** union-find merge (path compression + union by size), O(α) union plus at
  most 6 adjacency probes through per-node `BlockApiCache`s.
- **Remove node:** the component is marked dirty; connectivity is recomputed by a lazy,
  budgeted flood fill — `runRebuild(1024)` node visits per tick with a carry-over queue
  (consistent with the binding bounded-main-thread-scan contract, INDEX.md #3).
  `topologyVersion` increments on every structural change.
- **Chunk tracking:** per-chunk node lists (`Long2ObjectOpenHashMap<int[]>`). A node's
  active flag mirrors `level.shouldTickBlocksAt(chunkPosLong)` and is refreshed only on
  `CHUNK_LOAD` / `CHUNK_UNLOAD` / `CHUNK_LEVEL_TYPE_CHANGE` events (no per-tick polling).
- **Freeze semantics:** frozen (unloaded) nodes keep their edges but are excluded from
  every allocator phase; their stored Cg cannot change. A partially loaded network ticks
  only its loaded sub-island; the sub-island partition of a component is recomputed only
  when a member chunk's tick state flips, and cached otherwise. This is the "unloaded
  sub-islands freeze, no phantom transfer" contract by construction.
- **BE discovery:** `ServerBlockEntityEvents.BLOCK_ENTITY_LOAD` adds/reactivates nodes;
  `BLOCK_ENTITY_UNLOAD` freezes (unload ≠ removal); `preRemoveSideEffects` removes. [PROBE-2]

## 5. Persistence and the no-duplication rule

**Authority rule (binding, resolves "graph is SavedData" vs "no phantom duplication"):**
a node's stored Cg lives in exactly one place — its BlockEntity NBT (and item components
on pickup, later waves). The per-dimension `ChargeGraphSavedData` is authoritative only
for topology-level state (and later breaker/fuse settings) plus a read-only
`lastKnownStored` shadow used for diagnostics of frozen regions. SavedData NEVER writes
charge back into a loaded BE: on BE load the BE value wins unconditionally and the shadow
is refreshed from it. Charge mutates only on the server thread, only on active nodes,
only inside the allocator / `depositSurge`. Conservation
(`Σafter = Σbefore + produced − consumed − vented`) is property-tested, so duplication is
structurally impossible. The player-visible PWR contract ("node charge survives unload/
reload/restart") is satisfied via BE NBT; topology/settings survive via SavedData.

BE layer (versioned, actual 1.21.9 interfaces):

```java
@Override protected void saveAdditional(ValueOutput output) {
    super.saveAdditional(output);
    output.putInt("cg_version", 1);
    output.putLong("cg_stored", stored);
}
@Override protected void loadAdditional(ValueInput input) {
    super.loadAdditional(input);
    int v = input.getIntOr("cg_version", 0);          // 0 = pre-Cg data -> stored 0
    if (v > 1) Cuprum.LOGGER.warn("cg_version {} from newer Cuprum; best-effort read", v);
    stored = ChargeMath.clamp(input.getLongOr("cg_stored", 0L), 0L, capacity());
}
```

Forward-compat rule: unknown keys written by newer versions are lost on next save
(ValueOutput writes only what we write); log once per BE type.

SavedData layer:

```java
public final class ChargeGraphSavedData extends SavedData {
    public static final int SCHEMA_VERSION = 1;
    record NodeRecord(long posKey, int roleMask, int priority, long lastKnownStored) {
        static final Codec<NodeRecord> CODEC = RecordCodecBuilder.create(...);
    }
    public static final Codec<ChargeGraphSavedData> CODEC = RecordCodecBuilder.create(i -> i.group(
            Codec.INT.optionalFieldOf("schema_version", 1).forGetter(d -> d.schemaVersion),
            NodeRecord.CODEC.listOf().fieldOf("nodes").forGetter(d -> d.nodes),
            Codec.LONG.optionalFieldOf("vented_total", 0L).forGetter(d -> d.ventedTotal)
        ).apply(i, ChargeGraphSavedData::new));
    public static final SavedDataType<ChargeGraphSavedData> TYPE =
        new SavedDataType<>("cuprum_charge_graph", ChargeGraphSavedData::new, CODEC,
            DataFixTypes.SAVED_DATA_RANDOM_SEQUENCES);   // [PROBE-3]
}
// access: level.getDataStorage().computeIfAbsent(ChargeGraphSavedData.TYPE)
```

Schema migration happens inside the codec (dispatch on `schema_version`), not via DFU.

## 6. Threading, diagnostics, budgets

- Every mutating entrypoint (`notify*`, `depositSurge`, allocator) begins with
  `if (!level.getServer().isSameThread()) throw new IllegalStateException("Cg: off-thread access");`
  `ChargeApi.NODE` is documented server-thread-only. No `Level` access off-thread.
- Profiling: `System.nanoTime()` around the solver feeds `tickNanosLast`/EMA/max in
  `GraphDiagnosticsSnapshot`. The 0.15 ms/tick @1,000 nodes budget is asserted CI-soft in
  W1 (≤1.0 ms hard, actual logged) and becomes the hard gate in W5.
- `/cuprum cg stats|networks|node <pos>` registered via `CommandRegistrationCallback.EVENT`,
  gated `.requires(Commands.hasPermission(2))`; reserves the `cuprum.diagnostics`
  permission name (INDEX.md binding contract #2). Output via
  `sendSuccess(() -> Component.literal(...), false)`. `<pos>` uses `BlockPosArgument`.
- Data structures: parallel arrays (`long[] capacity/maxIn/maxOut`,
  `int[] roleMask/priority/flags`), `Long2IntOpenHashMap posToId`, adjacency as int
  arrays. ≈48–64 B/node → ~64 KiB @1,000 nodes. Zero steady-state allocation in the tick
  path (scratch arrays reused).
- Complexity: add O(α)+O(6); remove O(component), budgeted; tick O(V_active + E_active);
  canonical sort only on topology change.

## 7. Diagnostic vertical slice (reuses charge_probe; no catalog gameplay)

1. Extend `ChargeProbeBlock.useWithoutItem` (server branch only): query
   `ChargeGraphManager.of(level).nodeReport(pos.relative(d))` over the six neighbors; if
   a node is found, print the `NodeReport` (stored/capacity Cg, network id, frozen flag,
   topology version) after the existing version+SHA line; otherwise behavior unchanged.
   Report text is built by a pure helper `ChargeProbeReport.format(NodeReport)` so server
   gametests assert the string without asserting chat/HUD.
2. Harness nodes live in the **gametest mod only** (never in the shipped jar): add a
   `"main"` entrypoint to `src/gametest/resources/fabric.mod.json` registering, under
   namespace `cuprum-gametest`: `harness_cell` (ChargeStorage, capacity 20,000 Cg,
   1,000 Cg/t insert/extract — deliberately non-catalog numbers), `harness_source`
   (ChargeProducer, configurable offer), `harness_sink` (ChargeConsumer, configurable
   demand + priority tier), `harness_relay`. Server tests need no assets.
3. Hello-world demo: place `harness_source` + `harness_cell` + `charge_probe`,
   right-click the probe → live Cg readout.

## 8. Test plan

### JUnit property tests — `src/test/java/dev/cuprum/cuprum/charge/`

Imports `charge.core` only. Seeded `@ParameterizedTest` over `new Random(seed)`
(junit-jupiter-params is in the existing junit-jupiter aggregate; no new dependencies).

- `ChargeMathTest`: saturation at `Long.MAX_VALUE`; `mulDiv` vs `BigInteger` oracle;
  `lineLossDelivered(x, 8, 20)` = 84% and `lineLossDelivered(x, 8, 5)` = 96% (PWR-14);
  clamp at 0% delivered for long spans.
- `AllocationConservationTest`: random graphs/offers/demands → Σ invariant; no negative
  stored; no stored > capacity.
- `AllocationDeterminismTest`: identical results across repeated ticks and across node
  insertion-order permutations.
- `PriorityBrownoutTest`: at 50% supply, DEFENSE fully served before LOGISTICS/MISC
  receive anything, on random topologies.
- `FreezeIsolationTest`: random frozen subsets → zero flow across frozen nodes, frozen
  stored unchanged.
- `IncrementalRebuildEquivalenceTest`: random add/remove sequences — incremental
  component partition equals from-scratch flood fill; budgeted rebuild converges.

### Fabric server GameTests — `src/gametest/.../gametest/charge/CgFoundationGameTest.java`

`@GameTest(maxTicks = 200)` where needed; state-only assertions (no HUD/GUI vocabulary):

- `cgSourceFillsCell`: source 50 Cg/t + cell; after exactly 20 ticks the cell holds
  exactly 1,000 Cg (`assertValueEqual`).
- `cgPriorityBrownout`: source + DEFENSE sink + MISC sink at 50% supply → 100% / 0.
- `cgSplitOnBreak`: source–cell–cell chain; `destroyBlock` the middle → two network ids,
  topology version bumped, ΣCg conserved.
- `cgSurgeOverflow`: `depositSurge(270_000)` into a 20,000-cap cell → stored == 20,000,
  vented == 250,000 recorded, never negative.
- `cgPersistenceRoundtrip`: set cell to 12,345 Cg; round-trip via
  `new ProblemReporter.ScopedCollector(...)` + `TagValueOutput.createWithContext(collector,
  helper.getLevel().registryAccess())` → fresh BE
  `loadWithComponents(TagValueInput.create(...))` → 12,345 survives and `cg_version == 1`.
- `cgProbeReportsNode`: probe adjacent to a cell; `ChargeProbeReport.format(...)` contains
  the stored value and network id; `useBlock` must not throw.
- `cgSolverBudget1000Nodes`: 1,000-node grid, 100 ticks; assert avg ≤1.0 ms (CI-soft) and
  log actual vs the 0.15 ms target.
- Chunk-freeze realism is covered by restart persistence in `./scripts/server_smoke.sh`
  (gametest structures cannot unload chunks); the freeze path itself is covered by
  `FreezeIsolationTest` via `setActive`.

### Client GameTest (optional, keeps client_smoke green)

One screenshot test placing cell + probe via
`TestSingleplayerContext.getServer().runCommand(...)`, screenshot after
`getClientWorld().waitForChunksRender()`.

## 9. Ownership and team dependencies

| Path | Cg team |
|---|---|
| `src/main/java/dev/cuprum/cuprum/charge/**` (new) | owns |
| `src/gametest/.../gametest/charge/**` + harness entrypoint (new) | owns |
| `src/test/java/dev/cuprum/cuprum/charge/**` (new) | owns |
| `ChargeProbeBlock.java` (append report), `Cuprum.java` (one `ChargeGraphManager.init()` line), `src/gametest/resources/fabric.mod.json` (add `"main"` entrypoint) | owns, minimal diffs |
| `catalog/**`, `docs/feature-concepts/**` (digest-sealed), `CuprumBlocks/Items/CreativeTabs`, `UserContracts`, `build.gradle`, datagen outputs | must NOT touch |

Team dependencies:

- **Networking: none in W1** (no GUIs, no custom payloads; `/cuprum cg` uses the command
  API). W5 balancer/breaker GUIs need validated C2S payloads — Cg exposes server-side
  setters with validation hooks; the networking team owns payload codecs, the ≤8-block
  distance check and the 4/s rate limit (INDEX.md contract #1).
- **Multiblock (U01, PWR-07):** consumes `ChargeApi.NODE` + `ChargeConsumer`; Cg reserves
  the composite pattern (a controller registers one node across member positions via
  `registerForBlocks` delegation).
- **U04:** consumes `depositSurge`; extends `LightningRodBlock` for scripted strikes;
  natural-strike attraction needs POI insertion (PROBE-4, U04-owned).
- **Config:** constants ship as `ChargeBalance` static defaults in W1; `cuprum-common.json5`
  wiring via Cloth Config is a separate task (PROBE-5). Gametests read the same constants.

## 10. Compile/runtime probes (must be verified during implementation)

1. **PROBE-1** `BlockApiLookup<ChargeNode, @Nullable Direction>` typing — trivial compile
   check (pattern proven by the Fabric energy API).
2. **PROBE-2** `ServerBlockEntityEvents.BLOCK_ENTITY_LOAD/UNLOAD` ordering relative to
   `ServerChunkEvents` — runtime gametest assertion.
3. **PROBE-3** `DataFixTypes` for the modded `SavedDataType`: `null` NPEs on the first
   post-restart read (verified in `DimensionDataStorage.readTagFromDisk`). Recommended:
   `DataFixTypes.SAVED_DATA_RANDOM_SEQUENCES` (vanilla fixers pass foreign keys through);
   versioning lives in our codec. Verify by running `./scripts/server_smoke.sh` twice
   against the same world dir — the second boot must re-read `cuprum_charge_graph`.
4. **PROBE-4** (U04-owned) POI attraction for natural strikes: `PoiTypes.registerBlockStates`
   is private → access widener or mixin required for capture rods to attract like vanilla
   rods; scripted-strike gametests do not need it.
5. **PROBE-5** Cloth Config 20.0.149 JSON5 serializer availability for `cuprum-common.json5`.

## 11. Acceptance commands (run from `CUPRUM/`)

```
./gradlew toolchainVerify
./gradlew lint                                            # -Xlint -Werror across all six source sets
./gradlew test --tests "dev.cuprum.cuprum.charge.*"       # JUnit property suite
./gradlew check build                                     # catalog validation + parity + unit tests + server GameTests + jar
./gradlew runGameTest                                     # headless server GameTests alone
./scripts/server_smoke.sh && ./scripts/server_smoke.sh    # PROBE-3: second boot re-reads cuprum_charge_graph SavedData
./scripts/client_smoke.sh                                 # client GameTest + screenshots + log error scan
```
