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
  Fabric's SavedData object-builder mixin passes mod data through when
  `dataFixType == null`, so Cuprum uses no unrelated vanilla fixer. See PROBE-3.
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
    public static final int ALL = PRODUCER | STORAGE | CONSUMER | RELAY | SURGE_ABSORBER;
    public static boolean has(int mask, int role);
}
public enum ChargePriority {                               // PWR-18 tiers; ordinal = allocation order
    DEFENSE, LOGISTICS, MISC;
    public static ChargePriority fromOrdinal(int ordinal); // invalid ordinal -> MISC
}

public final class ChargeGraphCore {                       // topology + solver over dense int ids
    public ChargeGraphCore();
    public int  addNode(long posKey, int roleMask, int priority, long capacity, long maxInsert, long maxExtract);
    public void removeNode(int nodeId);                    // marks component dirty (lazy split)
    public void addEdge(int a, int b);
    public void setActive(int nodeId, boolean active);     // chunk freeze flag
    public long topologyVersion();
    public int  networkOf(int nodeId);                     // component id; -1 while dirty
    public RebuildStats runRebuild(int maxVisits);         // budgeted; returns carry-over depth
    public TickReport tick(NodeAccess access);             // deterministic allocator (section 3)
    public long depositSurge(int nodeId, long amountCg, NodeAccess access); // returns accepted
    public GraphDiagnosticsSnapshot diagnostics();         // deliberate read-only diagnostics
    public long ticksRun();                                // deliberate exact-pass counter
    // Deliberate internal read-only bridge: public only because ChargeGraphManager is in
    // the sibling charge package. Every node-id query rejects unknown/dead ids.
    public boolean isActive(int nodeId);                    // chunk/BE active flag; dirty is separate
    public int roleMaskOf(int nodeId);                      // exact registered Roles mask
    public int priorityOrdinalOf(int nodeId);               // registered ChargePriority ordinal
    public long capacityOf(int nodeId);                     // registered non-negative capacity
    public int[] aliveNodeIds();                            // canonical-order defensive copy
    public int[] loadedIslandMembers(int nodeId);           // canonical-order defensive copy;
                                                            // empty when frozen or rebuild-pending
}

public final class ChargeBuffer {                          // storage-implementor authority
    public ChargeBuffer(long capacity, long maxInsertPerTick, long maxExtractPerTick);
    public long stored();
    public long capacity();
    public long maxInsertPerTick();
    public long maxExtractPerTick();
    public void beginGameTick(long gameTick);              // lazy; same tick never resets usage
    public long insert(long amountCg, boolean simulate);   // normal shared budget; returns actual
    public long extract(long amountCg, boolean simulate);  // normal shared budget; returns actual
    public long depositSurge(long amountCg);               // capacity only; does not touch normal budget
    public long setStored(long value);                     // clamped load/setup path
}

public interface NodeAccess {                              // solver's phase-specific node bridge
    long offer(int nodeId);                                // producers: Cg offered this tick
    long demand(int nodeId);                               // consumers: Cg wanted this tick
    long stored(int nodeId);
    long drain(int nodeId, long amountCg);                 // each mutator returns ACTUAL applied Cg
    long accept(int nodeId, long amountCg);
    long insertStorage(int nodeId, long amountCg);         // normal shared insert budget
    long extractStorage(int nodeId, long amountCg);        // normal shared extract budget
    long insertSurgeStorage(int nodeId, long amountCg);    // explicit capacity-only surge path
    long absorb(int nodeId, long amountCg);
}

public record TickReport(long moved, long vented, int networksTicked, long nanos) {}
public record RebuildStats(int visited, int queueDepth) {}
public record GraphDiagnosticsSnapshot(int nodes, int edges, int networks, int frozenNodes,
        long topologyVersion, long tickNanosLast, long tickNanosEma, long ventedLastTick,
        long ventedTotal, long movedLastTick, int rebuildQueueDepth) {}
```

`ChargeGraphCore` deliberately exposes no public position-to-id lookup: callers retain the dense
id returned by `addNode`. The six query methods above are frozen, read-only manager/diagnostic
bridges, not general extension points; scalar results are snapshots and array results are defensive
copies, so none can mutate topology or node state.

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
public interface ChargeProducer extends ChargeNode {
    long offerPerTick();
    long drain(long requestedCg);                          // returns actual drained
}
public interface ChargeStorage  extends ChargeNode {
    long stored(); long capacity(); long maxInsertPerTick(); long maxExtractPerTick();
    long insert(long amountCg, boolean simulate);          // normal budget; returns actual accepted
    long extract(long amountCg, boolean simulate);         // normal budget; returns actual extracted
    long insertSurge(long amountCg);                       // capacity-only; returns actual accepted
}
public interface ChargeConsumer extends ChargeNode {
    long demandPerTick();
    long accept(long requestedCg);                         // returns actual accepted
}
public interface ChargeRelay    extends ChargeNode { long throughputPerTick(); }  // W1: harness only; U19/PWR-01 later
public interface SurgeAbsorber  extends ChargeNode {
    long absorbSurge(long requestedCg);                    // returns actual absorbed
}

public final class ChargeGraphManager {                    // one instance per ServerLevel
    public static void init();      // once from Cuprum.onInitialize(): registers END_WORLD_TICK,
                                    // chunk + BE events, /cuprum cg command
    public static ChargeGraphManager of(ServerLevel level);
    public void notifyNodeAdded(BlockPos pos);             // BE load / onPlace
    public void notifyNodeRemoved(BlockPos pos);           // non-BE provider removal
    public void notifyNodeRemoved(BlockEntity source);     // identity-safe BE removal
    public void notifyNodeChanged(BlockPos pos);           // non-venting shape refresh
    public long depositSurge(BlockPos origin, long amountCg); // U04 entry point; returns accepted
    public GraphDiagnosticsSnapshot diagnostics();
    public Optional<NodeReport> nodeReport(BlockPos pos);  // diagnostics read (charge_probe, /cuprum cg node)
    public Map<Integer, List<NodeReport>> networkReports();// diagnostics command read
    public long allocatorTicks();                          // exact-pass diagnostic counter
}
public record NodeReport(BlockPos pos, int roleMask, ChargePriority priority, long stored, long capacity,
        int networkId, boolean frozen, long networkStored, long networkCapacity, long topologyVersion) {}
// networkStored/networkCapacity are computed over LOADED members only.

// dev.cuprum.cuprum.charge.blockentity
public abstract class AbstractChargeStorageBlockEntity extends BlockEntity implements ChargeStorage {
    public static final String STATE_KEY, CHARGE_KEY;
    protected final ChargeBuffer buffer;
    protected AbstractChargeStorageBlockEntity(BlockEntityType<?> type, BlockPos pos, BlockState state,
            long capacityCg, long maxInsertPerTickCg, long maxExtractPerTickCg);
    @Override public long stored();
    @Override public long capacity();
    @Override public long maxInsertPerTick();
    @Override public long maxExtractPerTick();
    @Override public long insert(long amountCg, boolean simulate);
    @Override public long extract(long amountCg, boolean simulate);
    @Override public long insertSurge(long amountCg);
    @Override protected void saveAdditional(ValueOutput output);   // section 5
    @Override protected void loadAdditional(ValueInput input);
    @Override public void preRemoveSideEffects(BlockPos pos, BlockState state); // identity-safe removal
}

// Config-owned values exposed to charge consumers.
public final class ChargeBalance {
    public static long passiveBaselineCgPerTick();
    public static long leydenJarCapacityCg();
    public static long strikeDepositCg();
    public static int wireLossPpTenthsPerSpanBare();
    public static int wireLossPpTenthsPerSpanHv();
}
public final class ChargeModule { public static void init(); }

// dev.cuprum.cuprum.charge.persist — normalized snapshot/shadow state (section 5)
public final class ChargeGraphSavedData extends CuprumSavedData {
    public static final String ID;
    public static final Codec<ChargeGraphSavedData> CODEC;
    public static final SavedDataType<ChargeGraphSavedData> TYPE;
    public record NodeRecord(long posKey, int roleMask, int priority, long lastKnownStored) {}
    public ChargeGraphSavedData();
    public List<NodeRecord> nodes();                       // immutable, signed-pos sorted snapshot
    public long ventedTotal();                             // non-negative persisted total
    public void replaceSnapshot(List<NodeRecord> nodes, long ventedTotal); // normalizes + setDirty
}

// dev.cuprum.cuprum.charge.diag — read-only command/report surface (sections 6, 7)
public final class ChargeCommand { public static void register(); }
public final class ChargeProbeReport {
    public static String format(NodeReport report);
    public static String format(int x, int y, int z, long stored, long capacity, int networkId,
            boolean frozen, int roleMask, ChargePriority priority, long topologyVersion);
    public static String summarizeNetwork(int networkId, List<NodeReport> reports);
    public static String summarizeNetwork(int networkId, long[] storedByNode, long[] capacityByNode,
            boolean[] frozenByNode);
}
```

The role mutators' **actual-return signatures are the frozen contract**: conservation,
relay/absorber budgets and diagnostics use only the amount the receiver reports as applied.
The deliberate additive public surface is limited to the explicit `insertSurge` path, the
identity-safe BE-removal overload, the read-only diagnostics and the six internal core query
bridges listed above. Test-only reset, raw graph-delta, position-to-id and warning-latch entrypoints
are not public API.

The declarations above are exhaustive for W1B-authored public/protected members (record-generated
canonical constructors, accessors and `equals`/`hashCode`/`toString`, enum-generated
`values`/`valueOf`, and inherited vanilla members are implicit). The primitive diagnostic overloads
exist to keep their formatting/accumulation cores MC-free and directly unit-testable.

Node registration pattern per BE type:
`ChargeApi.NODE.registerForBlockEntity((be, side) -> be.canConnect(side) ? be : null, TYPE);`
with `TYPE = FabricBlockEntityTypeBuilder.create(Ctor::new, BLOCK).build()`.

## 3. Deterministic per-tick allocation (binding semantics)

Runs in `ServerTickEvents.END_WORLD_TICK`, after all BE tickers. Per-tick order:
(1) budgeted rebuild queue, (2) active-set refresh (only if chunk state changed),
(3) allocator. BE tickers may only mutate their OWN node's internal state; every
cross-node transfer happens exclusively in the allocator.

Each storage owns one lazy game-tick normal-flow window keyed by
`Level.getGameTime()`. External `insert`/`extract` and allocator P2/P3 call the same
methods, so they consume the same insert/extract budgets in either call order. A
different game tick replenishes the window on first normal access; simulation does
not consume it. `insertSurge` is a separate capacity-only mutation and never consumes
or resets the normal counter.

Canonical node order (the only iteration order the solver ever uses):
ascending `(priority.ordinal(), Long.compare(posKey))` where `posKey = BlockPos.asLong()`.
Cached as a sorted array keyed by `topologyVersion`; hash maps are never iterated directly.

Allocator phases, per network, active (loaded) nodes only:

1. **P1 direct:** producer offers → consumer demands. Consumers served fully-greedy in
   canonical order (DEFENSE first). PWR-18 brownout semantics: at 50% supply the
   defense-tier consumer receives 100% of its request, misc receives 0.
2. **P2 charge:** residual offers → storage `insert`; the storage enforces the one shared
   graph+external `maxInsertPerTick` window.
3. **P3 discharge:** unmet demand → storage `extract`; the storage enforces the one shared
   graph+external `maxExtractPerTick` window.
4. **P4 overflow/surge:** residual offers and `depositSurge` excess → `SurgeAbsorber`s in
   canonical order; the remainder is **vented**: added to `ventedLastTick`/`ventedTotal`,
   debug-logged, never negative, never wraps.

Surge rule (binding W1 choice, revisited by PWR-13 fuse / PWR-21 ground vent):
`depositSurge` (e.g. a 270,000 Cg strike) calls the explicit storage-surge path,
bypassing normal insert caps while respecting storage capacity, relay throughput and
absorber caps.

Every `drain`, `accept`, normal storage, surge-storage and absorber mutation returns
the actual applied amount in `[0, requested]`; only that amount leaves pools or charges
budgets. Rejected remainder continues to another eligible target or vents exactly.

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
  `BLOCK_ENTITY_UNLOAD` freezes and snapshots the storage shadow without venting;
  chunk unload does the same. `preRemoveSideEffects` is intentional removal: it vents
  the live stored value (or frozen shadow) exactly once, removes the persisted record,
  and the later unload callback no-ops. Source-BE identity is retained while frozen so
  unload→remove, remove→unload and stale replacement callbacks are all idempotent.
  `CHUNK_LEVEL_TYPE_CHANGE` refreshes activity from `shouldTickBlocksAt`; a node cannot
  reactivate until its BE load callback restores the live node reference. [PROBE-2]

## 5. Persistence and the no-duplication rule

**Authority rule (binding, resolves "graph is SavedData" vs "no phantom duplication"):**
a node's stored Cg lives in exactly one place — its BlockEntity NBT (and item components
on pickup, later waves). The per-dimension `ChargeGraphSavedData` is authoritative only
for topology-level state (and later breaker/fuse settings) plus a read-only
`lastKnownStored` shadow used for diagnostics of frozen regions. SavedData NEVER writes
charge back into a loaded BE: on BE load the BE value wins unconditionally and the shadow
is refreshed from it. Charge mutates only on the server thread, only on active nodes,
through own-node normal API calls, the allocator, `depositSurge`, or intentional-removal
venting. Unload/freeze never vents. Conservation
(`Σafter = Σbefore + produced − consumed − vented`) is property-tested, so duplication is
structurally impossible. The player-visible PWR contract ("node charge survives unload/
reload/restart") is satisfied via BE NBT; topology/settings survive via SavedData.

BE layer (versioned, actual 1.21.9 interfaces):

```java
@Override protected void saveAdditional(ValueOutput output) {
    super.saveAdditional(output);
    ValueOutput state = output.child("cuprum_state");
    state.putInt("cuprum_schema", 1);
    state.putLong("charge", buffer.stored());
}
@Override protected void loadAdditional(ValueInput input) {
    super.loadAdditional(input);
    ValueInput state = input.childOrEmpty("cuprum_state");
    int v = state.getIntOr("cuprum_schema", 0);
    if (v > 1) Cuprum.LOGGER.warn("cuprum_schema {} from newer Cuprum; best-effort read", v);
    buffer.setStored(ChargeMath.clamp(state.getLongOr("charge", 0L), 0L, capacity()));
}
```

Forward-compat rule: unknown keys written by newer versions are lost on next save
(ValueOutput writes only what we write); log once per BE type.

SavedData layer:

```java
public final class ChargeGraphSavedData extends CuprumSavedData {
    public record NodeRecord(long posKey, int roleMask, int priority, long lastKnownStored) {
        public NodeRecord {
            roleMask &= Roles.ALL;
            priority = ChargePriority.fromOrdinal(priority).ordinal();
            lastKnownStored = Math.max(0L, lastKnownStored);
        }
    }
    private static final Codec<ChargeGraphSavedData> BODY_CODEC = RecordCodecBuilder.create(i -> i.group(
            NodeRecord.CODEC.listOf().fieldOf("nodes").forGetter(d -> d.nodes),
            Codec.LONG.optionalFieldOf("vented_total", 0L).forGetter(d -> d.ventedTotal)
        ).apply(i, ChargeGraphSavedData::new));
    public static final Codec<ChargeGraphSavedData> CODEC =
        versionedCodec("cuprum_charge_graph", 1, BODY_CODEC);
    public static final SavedDataType<ChargeGraphSavedData> TYPE =
        new SavedDataType<>("cuprum_charge_graph", ChargeGraphSavedData::new, CODEC,
            null);                                      // Fabric passthrough; [PROBE-3]
}
// access: level.getDataStorage().computeIfAbsent(ChargeGraphSavedData.TYPE)
```

Schema migration happens inside the codec, not via DFU. Explicit schema 0 is the
field-compatible pre-validation format and migrates to 1 before canonical repair.
Decoded and manager-produced records are normalized identically: unknown role bits
are masked off, invalid priority defaults to `MISC`, stored shadows and
`vented_total` floor at 0, records sort by signed `posKey`, and the last occurrence
of a duplicate position wins. Future versions warn once and decode best-effort
through the same normalization; syntactically invalid payloads return a codec error.

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
- `SharedStorageBudgetTest`: API→graph and graph→API for normal insert/extract,
  game-tick boundary reset (including long wrap) and surge isolation.
- `RelayEpochRolloverTest`: relay routing at `Integer.MAX_VALUE` and after wrapped
  negative epoch recovery.

### Fabric server GameTests — `src/gametest/.../gametest/charge/{ChargeGraphGameTest,ChargeLifecycleGameTest,ChargeSavedDataGameTest}.java`

`@GameTest(maxTicks = 200)` where needed; state-only assertions (no HUD/GUI vocabulary):

- `cgSourceFillsCell`: source 50 Cg/t + cell; after exactly 20 ticks the cell holds
  exactly 1,000 Cg (`assertValueEqual`).
- `cgPriorityBrownout`: source + DEFENSE sink + MISC sink at 50% supply → 100% / 0.
- `cgSplitOnBreak`: source–cell–cell chain; `destroyBlock` the middle → its stored Cg
  vents once, two network ids, topology version bumped, survivor conserved.
- `cgSurgeOverflow`: `depositSurge(270_000)` into a 20,000-cap cell → stored == 20,000,
  vented == 250,000 recorded, never negative.
- `cgPersistenceRoundtrip`: set cell to 12,345 Cg; round-trip via
  `new ProblemReporter.ScopedCollector(...)` + `TagValueOutput.createWithContext(collector,
  helper.getLevel().registryAccess())` → fresh BE
  `loadCustomOnly(TagValueInput.create(...))` → 12,345 survives and
  `cuprum_state.cuprum_schema == 1`.
- `cgProbeReportsNode`: probe adjacent to a cell; `ChargeProbeReport.format(...)` contains
  the stored value and network id; `useBlock` must not throw.
- `ChargeLifecycleGameTest`: invokes the registered BE/chunk listener invokers for
  remove→unload and unload→remove, stale callbacks, level-type change,
  freeze/reactivate, stored shadow, persisted removal vent and no phantom transfer.
- `ChargeSavedDataGameTest`: non-empty codec round-trip, malformed values/types,
  future schema, schema 0 and duplicate-position policy.
- `SolverBudgetTest` (JUnit, D8): 1,000 synthetic nodes, 100 ticks; assert avg ≤1.0 ms
  and log actual vs the 0.15 ms target.

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
| `ChargeProbeBlock.java` (append report), `Cuprum.java` (one `ChargeModule.init()` line), `src/gametest/resources/fabric.mod.json` (add `"main"` entrypoint) | owns, minimal diffs |
| `build.gradle` (hermetic `runGameTest` world cleanup plus explicit preserve opt-in only, as authorized by `FOUNDATION_PLAN.md` §4-W1B) | owns, minimal reviewed diff |
| `catalog/**`, `docs/feature-concepts/**` (digest-sealed), `CuprumBlocks/Items/CreativeTabs`, `UserContracts`, datagen outputs | must NOT touch |

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
- **Config:** `ChargeBalance` is the thin typed accessor over the W1A-owned
  `CuprumCommonConfig.charge` section; its field initializers hold the INDEX defaults and
  GameTests read that same config object (PROBE-5).

## 10. Compile/runtime probes (must be verified during implementation)

1. **PROBE-1** `BlockApiLookup<ChargeNode, @Nullable Direction>` typing — trivial compile
   check (pattern proven by the Fabric energy API).
2. **PROBE-2** `ServerBlockEntityEvents.BLOCK_ENTITY_LOAD/UNLOAD` ordering relative to
   `ServerChunkEvents` — production-listener GameTests cover both removal/unload
   orderings, chunk unload/load and level-type changes.
3. **PROBE-3** `DataFixTypes` for the modded `SavedDataType`: pass `null`; Fabric's
   object-builder mixin bypasses vanilla DFU for mod data and versioning lives in our
   codec. `scripts/server_restart_probe.sh` proves a fresh-JVM disk re-read.
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
./gradlew runGameTest                                     # hermetic: deletes build/run/gameTest/world first
./gradlew runGameTest -Pcuprum.preserveGameTestWorld=true # explicit restart/preservation mode
./scripts/server_restart_probe.sh                         # PROBE-3: fresh-JVM non-empty disk re-read
./scripts/client_smoke.sh                                 # client GameTest + screenshots + log error scan
```
