package dev.cuprum.cuprum.charge;

import dev.cuprum.cuprum.Cuprum;
import dev.cuprum.cuprum.charge.core.ChargeGraphCore;
import dev.cuprum.cuprum.charge.core.ChargeMath;
import dev.cuprum.cuprum.charge.core.ChargePriority;
import dev.cuprum.cuprum.charge.core.GraphDiagnosticsSnapshot;
import dev.cuprum.cuprum.charge.core.NodeAccess;
import dev.cuprum.cuprum.charge.core.Roles;
import dev.cuprum.cuprum.charge.diag.ChargeCommand;
import dev.cuprum.cuprum.charge.persist.ChargeGraphSavedData;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerBlockEntityEvents;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerChunkEvents;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerLifecycleEvents;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerTickEvents;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerWorldEvents;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.level.ChunkPos;
import net.minecraft.world.level.block.entity.BlockEntity;
import net.minecraft.world.level.block.state.BlockState;

/**
 * The per-{@link ServerLevel} charge-graph authority (charge.md §2b/§4/§6 with the plan D7
 * overrides): owns the world wiring around a pure {@link ChargeGraphCore}. One instance per
 * loaded dimension; instances are dropped on world unload and on SERVER_STOPPED (no state
 * outlives its server).
 *
 * <p><b>Lifecycle wiring</b> (charge.md §4 [PROBE-2]):
 * <ul>
 *   <li>{@code BLOCK_ENTITY_LOAD} adds or reactivates a node, passing the state/BE the event
 *       already delivered into the 5-arg {@code BlockApiLookup.find} overload — never
 *       re-querying the world (the 3-arg overload re-reads via
 *       {@code Level.getBlockState/getBlockEntity}, which are chunk-REQUIRED paths). Fabric's
 *       public contract warns the BE's "data might not be loaded yet" without pinning
 *       callers or ordering (in the pinned disk path, {@code LevelChunk.promotePendingBlockEntity}
 *       → {@code BlockEntity.loadStatic} loads components BEFORE registration fires the event),
 *       so ONLY topology is registered here — stored Cg is read lazily by the allocator once
 *       the BE is live, conservative under the public contract.</li>
 *   <li>{@code BLOCK_ENTITY_UNLOAD} freezes (unload ≠ removal): the last-known stored value is
 *       shadowed for diagnostics, the live node reference is dropped, edges stay. The source
 *       BE identity token is retained until reactivation/removal so both event orderings and
 *       stale callbacks remain distinguishable. The event also
 *       follows explicit removal ({@code preRemoveSideEffects} → {@link #notifyNodeRemoved}) —
 *       in that case the entry is already gone and the handler is an idempotent no-op. A stale
 *       unload can never resurrect or re-freeze a removed (or replaced) node: the SOURCE
 *       {@link BlockEntity} identity is tracked per node independently of the lookup/API
 *       object, and an unload whose BE is not the exact registered instance — charge node or
 *       not — is a no-op.</li>
 *   <li>Chunk events ({@code CHUNK_LOAD}/{@code CHUNK_UNLOAD}/{@code CHUNK_LEVEL_TYPE_CHANGE})
 *       refresh active flags from {@code shouldTickBlocksAt} — the only places that query it
 *       (no per-tick polling).</li>
 *   <li>{@code END_WORLD_TICK}: budgeted rebuild (max {@value #REBUILD_BUDGET} visits) → the
 *       allocator pass → SavedData snapshot when something meaningful changed.</li>
 * </ul>
 *
 * <p><b>Threading</b> (charge.md §6): every mutating entrypoint asserts the server thread and
 * throws {@code IllegalStateException("Cg: off-thread access")}. The read paths
 * ({@link #diagnostics()}, {@link #nodeReport}) touch core caches and are asserted too.
 *
 * <p><b>Deliberate diagnostics surface</b>: {@link #allocatorTicks()} anchors exact-pass
 * diagnostics and tests; {@link #diagnostics()}, {@link #nodeReport} and
 * {@link #networkReports()} are read-only command/probe data. A node's {@code canConnect} side
 * gates are cached as a 6-bit mask at registration time (refreshed by
 * {@link #notifyNodeChanged}) so edges next to frozen neighbors stay decidable.
 */
public final class ChargeGraphManager {
    /** Max lazy-split flood-fill node visits per tick (charge.md §4, INDEX #3 bounded scan). */
    private static final int REBUILD_BUDGET = 1024;

    private static final Map<ServerLevel, ChargeGraphManager> MANAGERS = new HashMap<>();
    private static final Direction[] DIRECTIONS = Direction.values();

    /** Registers world/chunk/BE/tick events and the {@code /cuprum cg} command. Called once. */
    public static void init() {
        ServerWorldEvents.LOAD.register((server, level) -> of(level));
        ServerWorldEvents.UNLOAD.register((server, level) -> MANAGERS.remove(level));
        ServerLifecycleEvents.SERVER_STOPPED.register(server -> MANAGERS.clear());
        ServerBlockEntityEvents.BLOCK_ENTITY_LOAD.register(
                (blockEntity, level) -> of(level).onBlockEntityLoad(blockEntity));
        ServerBlockEntityEvents.BLOCK_ENTITY_UNLOAD.register(
                (blockEntity, level) -> of(level).onBlockEntityUnload(blockEntity));
        ServerChunkEvents.CHUNK_LOAD.register(
                (level, chunk) -> of(level).refreshChunkActive(chunk.getPos().toLong()));
        ServerChunkEvents.CHUNK_UNLOAD.register(
                (level, chunk) -> of(level).freezeChunk(chunk.getPos().toLong()));
        ServerChunkEvents.CHUNK_LEVEL_TYPE_CHANGE.register(
                (level, chunk, oldType, newType) -> of(level).refreshChunkActive(chunk.getPos().toLong()));
        ServerTickEvents.END_WORLD_TICK.register(level -> of(level).endWorldTick());
        ChargeCommand.register();
    }

    /** The (lazily created) manager for {@code level}; server-thread-only like all entrypoints. */
    public static ChargeGraphManager of(ServerLevel level) {
        assertServerThread(level);
        return MANAGERS.computeIfAbsent(level, ChargeGraphManager::new);
    }

    // ------------------------------------------------------------------
    // Instance
    // ------------------------------------------------------------------

    /** One registered node: core id + cached registration shape + the live BE-backed node (or null while frozen). */
    private static final class Entry {
        final long posKey;
        final BlockPos pos;
        final int coreId;
        final int connectMask;
        final long maxInsert;
        final long maxExtract;
        ChargeNode node;
        /**
         * The exact {@link BlockEntity} instance this registration came from — tracked
         * INDEPENDENTLY of the lookup/API object (which providers may wrap), so a stale unload
         * event for any different BE at the same position (charge node or not) is provably not
         * ours and no-ops. Retained while frozen; null only for block-provider nodes (none ship
         * in W1B), whose unloads are handled purely by the chunk-freeze path.
         */
        BlockEntity sourceBlockEntity;
        long lastKnownStored;

        Entry(long posKey, BlockPos pos, int coreId, int connectMask, long maxInsert, long maxExtract,
                ChargeNode node, BlockEntity sourceBlockEntity) {
            this.posKey = posKey;
            this.pos = pos;
            this.coreId = coreId;
            this.connectMask = connectMask;
            this.maxInsert = maxInsert;
            this.maxExtract = maxExtract;
            this.node = node;
            this.sourceBlockEntity = sourceBlockEntity;
        }
    }

    private final ServerLevel level;
    private final ChargeGraphCore core = new ChargeGraphCore();
    private final ChargeGraphSavedData data;
    private final Map<Long, Entry> byPos = new HashMap<>();
    private final Map<Integer, Entry> byId = new HashMap<>();
    private final Map<Long, List<Entry>> byChunk = new HashMap<>();
    /**
     * Records read from disk whose position has not produced a live node this session (their
     * chunks were never loaded). Preserved verbatim across snapshots so unloaded-region
     * diagnostics survive restarts; consumed on load/removal at the position.
     */
    private final Map<Long, ChargeGraphSavedData.NodeRecord> dormantRecords = new LinkedHashMap<>();
    private final long ventedBaseline;
    private long ventedByRemoval;
    private long lastSnapshotTopologyVersion = -1;
    private long lastSnapshotVented = -1;
    private boolean storedShadowChanged;

    /**
     * Phase-specific dispatch (Eval-A repair): every operation targets exactly one role
     * interface — never delta-sign guessing — so multi-role nodes (e.g. producer+storage) are
     * unambiguous, and every mutator returns the ACTUAL applied amount, sanitized into
     * {@code [0, requested]} with a warning on hostile values. Normal graph storage calls use
     * the same {@link ChargeStorage#insert}/{@link ChargeStorage#extract} API and game-tick
     * budget as external callers; surge storage has its own explicit path.
     */
    private final NodeAccess access = new NodeAccess() {
        @Override
        public long offer(int nodeId) {
            return byId.get(nodeId).node instanceof ChargeProducer producer ? producer.offerPerTick() : 0L;
        }

        @Override
        public long demand(int nodeId) {
            return byId.get(nodeId).node instanceof ChargeConsumer consumer ? consumer.demandPerTick() : 0L;
        }

        @Override
        public long stored(int nodeId) {
            Entry entry = byId.get(nodeId);
            return entry.node instanceof ChargeStorage storage ? storage.stored() : entry.lastKnownStored;
        }

        @Override
        public long drain(int nodeId, long amountCg) {
            Entry entry = byId.get(nodeId);
            if (!(entry.node instanceof ChargeProducer producer)) {
                return 0L;
            }
            return sanitizeActual(producer.drain(amountCg), amountCg, entry, "drain");
        }

        @Override
        public long accept(int nodeId, long amountCg) {
            Entry entry = byId.get(nodeId);
            if (!(entry.node instanceof ChargeConsumer consumer)) {
                return 0L;
            }
            return sanitizeActual(consumer.accept(amountCg), amountCg, entry, "accept");
        }

        @Override
        public long insertStorage(int nodeId, long amountCg) {
            Entry entry = byId.get(nodeId);
            if (!(entry.node instanceof ChargeStorage storage)) {
                return 0L;
            }
            long applied = storage.insert(amountCg, false);
            entry.lastKnownStored = storage.stored();
            storedShadowChanged = true;
            return sanitizeActual(applied, amountCg, entry, "insertStorage");
        }

        @Override
        public long extractStorage(int nodeId, long amountCg) {
            Entry entry = byId.get(nodeId);
            if (!(entry.node instanceof ChargeStorage storage)) {
                return 0L;
            }
            long applied = storage.extract(amountCg, false);
            entry.lastKnownStored = storage.stored();
            storedShadowChanged = true;
            return sanitizeActual(applied, amountCg, entry, "extractStorage");
        }

        @Override
        public long insertSurgeStorage(int nodeId, long amountCg) {
            Entry entry = byId.get(nodeId);
            if (!(entry.node instanceof ChargeStorage storage)) {
                return 0L;
            }
            long applied = storage.insertSurge(amountCg);
            entry.lastKnownStored = storage.stored();
            storedShadowChanged = true;
            return sanitizeActual(applied, amountCg, entry, "insertSurgeStorage");
        }

        @Override
        public long absorb(int nodeId, long amountCg) {
            Entry entry = byId.get(nodeId);
            if (!(entry.node instanceof SurgeAbsorber absorber)) {
                return 0L;
            }
            return sanitizeActual(absorber.absorbSurge(amountCg), amountCg, entry, "absorb");
        }
    };

    /** Clamps a node-returned actual into {@code [0, requested]}, warning on hostile values. */
    private static long sanitizeActual(long returned, long requested, Entry entry, String operation) {
        if (returned >= 0 && returned <= requested) {
            return returned;
        }
        Cuprum.LOGGER.warn("[charge] {} at {} returned {} for a {} Cg request; clamping",
                operation, entry.pos, returned, requested);
        return ChargeMath.clamp(returned, 0L, requested);
    }

    private ChargeGraphManager(ServerLevel level) {
        this.level = level;
        ChargeGraphSavedData existing = level.getDataStorage().get(ChargeGraphSavedData.TYPE);
        if (existing == null) {
            this.data = level.getDataStorage().computeIfAbsent(ChargeGraphSavedData.TYPE);
            Cuprum.LOGGER.info("[charge] cuprum_charge_graph created dim={} nodes={} vented_total={}",
                    level.dimension().location(), 0, 0L);
        } else {
            this.data = existing;
            Cuprum.LOGGER.info("[charge] cuprum_charge_graph re-read dim={} nodes={} vented_total={}",
                    level.dimension().location(), existing.nodes().size(), existing.ventedTotal());
        }
        this.ventedBaseline = data.ventedTotal();
        for (ChargeGraphSavedData.NodeRecord record : data.nodes()) {
            dormantRecords.put(record.posKey(), record);
        }
    }

    // ------------------------------------------------------------------
    // Public surface (charge.md §2b, frozen)
    // ------------------------------------------------------------------

    /**
     * BE load / onPlace: registers a new node or reactivates a frozen one. No-op if no node —
     * and a guaranteed no-op on UNLOADED positions: {@code Level.isLoaded} only asks the chunk
     * source ({@code hasChunk}), whereas the state/BE reads behind an unguarded lookup are
     * chunk-REQUIRED paths that would load (or generate) the chunk ([PROBE-1] correction).
     */
    public void notifyNodeAdded(BlockPos pos) {
        assertServerThread(level);
        if (!level.isLoaded(pos)) {
            return;
        }
        registerNode(pos, level.getBlockState(pos), level.getBlockEntity(pos));
    }

    /**
     * Registration core: uses the 5-arg {@code BlockApiLookup.find} overload with the
     * state/BE already in hand — the pinned implementation then performs NO world re-query
     * ([PROBE-1]). {@code sourceBlockEntity} is remembered for unload identity checks.
     */
    private void registerNode(BlockPos pos, BlockState state, BlockEntity sourceBlockEntity) {
        ChargeNode node = ChargeApi.NODE.find(level, pos, state, sourceBlockEntity, null);
        if (node == null) {
            return;
        }
        long posKey = pos.asLong();
        long chunkKey = ChunkPos.asLong(pos);
        int roleMask = roleMaskOf(node);
        long capacity = 0L;
        long maxInsert = 0L;
        long maxExtract = 0L;
        if (node instanceof ChargeStorage storage) {
            capacity = storage.capacity();
            maxInsert = storage.maxInsertPerTick();
            maxExtract = storage.maxExtractPerTick();
        }
        if (node instanceof ChargeRelay relay) {
            // Relay pass-through budget rides in the maxInsert column (documented adaptation).
            maxInsert = Math.max(0L, relay.throughputPerTick());
        }
        if (node instanceof SurgeAbsorber && maxInsert == 0L) {
            // SurgeAbsorber carries no cap accessor in W1 (no shipped implementation); register
            // an unbounded per-tick absorb cap until PWR-13/21 add one.
            maxInsert = Long.MAX_VALUE;
        }
        int connectMask = connectMaskOf(node);
        Entry entry = byPos.get(posKey);
        if (entry != null) {
            boolean sameShape = core.roleMaskOf(entry.coreId) == roleMask
                    && core.priorityOrdinalOf(entry.coreId) == node.priority().ordinal()
                    && core.capacityOf(entry.coreId) == capacity
                    && entry.maxInsert == maxInsert
                    && entry.maxExtract == maxExtract
                    && entry.connectMask == connectMask;
            if (sameShape) {
                // Reactivation of a frozen node (chunk reload): BE NBT is authoritative, the
                // shadow is refreshed lazily from the BE — never the other way around
                // (charge.md §5). The source BE identity is refreshed too (unload checks).
                entry.node = node;
                entry.sourceBlockEntity = sourceBlockEntity;
                core.setActive(entry.coreId, level.shouldTickBlocksAt(chunkKey));
                return;
            }
            // The position now hosts a differently-shaped node (e.g. block replaced while its
            // removal side effects were skipped): deterministic re-registration.
            notifyNodeRemoved(pos);
        }
        dormantRecords.remove(posKey);
        int coreId = core.addNode(posKey, roleMask, node.priority().ordinal(), capacity, maxInsert, maxExtract);
        entry = new Entry(posKey, pos.immutable(), coreId, connectMask, maxInsert, maxExtract, node,
                sourceBlockEntity);
        byPos.put(posKey, entry);
        byId.put(coreId, entry);
        byChunk.computeIfAbsent(chunkKey, key -> new ArrayList<>()).add(entry);
        core.setActive(coreId, level.shouldTickBlocksAt(chunkKey));
        for (Direction direction : DIRECTIONS) {
            if (!connects(connectMask, direction)) {
                continue;
            }
            Entry neighbor = byPos.get(pos.relative(direction).asLong());
            if (neighbor != null && connects(neighbor.connectMask, direction.getOpposite())) {
                core.addEdge(coreId, neighbor.coreId);
            }
        }
    }

    /**
     * Explicit removal ({@code preRemoveSideEffects}), never unload: vents the live stored value
     * or frozen shadow exactly once and removes the persisted record. Idempotent.
     */
    public void notifyNodeRemoved(BlockPos pos) {
        assertServerThread(level);
        long posKey = pos.asLong();
        ChargeGraphSavedData.NodeRecord dormant = dormantRecords.remove(posKey);
        Entry entry = byPos.remove(posKey);
        if (entry == null) {
            if (dormant != null) {
                ventRemovedCharge(dormant.lastKnownStored());
            }
            return;
        }
        long storedAtRemoval = entry.node instanceof ChargeStorage storage
                ? storage.stored()
                : entry.lastKnownStored;
        ventRemovedCharge(storedAtRemoval);
        core.removeNode(entry.coreId);
        byId.remove(entry.coreId);
        List<Entry> chunkEntries = byChunk.get(ChunkPos.asLong(pos));
        if (chunkEntries != null) {
            chunkEntries.remove(entry);
            if (chunkEntries.isEmpty()) {
                byChunk.remove(ChunkPos.asLong(pos));
            }
        }
        storedShadowChanged = true;
    }

    /**
     * Source-aware block-entity removal callback. A callback from a stale replaced instance is
     * ignored instead of removing the live replacement at the same position.
     */
    public void notifyNodeRemoved(BlockEntity sourceBlockEntity) {
        assertServerThread(level);
        Entry entry = byPos.get(sourceBlockEntity.getBlockPos().asLong());
        if (entry == null || entry.sourceBlockEntity != sourceBlockEntity) {
            return;
        }
        notifyNodeRemoved(sourceBlockEntity.getBlockPos());
    }

    /** Priority / side-shape change: deterministic, non-venting re-registration. */
    public void notifyNodeChanged(BlockPos pos) {
        assertServerThread(level);
        Entry entry = byPos.get(pos.asLong());
        if (entry != null) {
            unregisterWithoutVenting(entry);
            notifyNodeAdded(pos);
        }
    }

    /**
     * U04 entry point (charge.md §3 surge rule): deposits {@code amountCg} at {@code origin} —
     * the node's own storage first (bypassing per-tick insert caps, never capacity), then surge
     * absorbers in its loaded sub-island (respecting relay throughput along the path and the
     * absorbers' per-tick caps, cumulatively with the allocator across the current tick
     * window — see {@link ChargeGraphCore#depositSurge} for the tick-boundary semantics),
     * remainder vented exactly. Only ACTUAL acceptance drives the accounting. Returns the
     * accepted amount. A non-node origin returns 0 and mutates/vents nothing (W1B contract).
     */
    public long depositSurge(BlockPos origin, long amountCg) {
        assertServerThread(level);
        Entry entry = byPos.get(origin.asLong());
        if (entry == null) {
            return 0L;
        }
        long accepted = core.depositSurge(entry.coreId, amountCg, access);
        storedShadowChanged = true;
        return accepted;
    }

    /** Live diagnostics; {@code ventedTotal} includes the persisted total from prior sessions. */
    public GraphDiagnosticsSnapshot diagnostics() {
        assertServerThread(level);
        GraphDiagnosticsSnapshot snapshot = core.diagnostics();
        return new GraphDiagnosticsSnapshot(snapshot.nodes(), snapshot.edges(), snapshot.networks(),
                snapshot.frozenNodes(), snapshot.topologyVersion(), snapshot.tickNanosLast(),
                snapshot.tickNanosEma(), snapshot.ventedLastTick(),
                ChargeMath.satAdd(ChargeMath.satAdd(ventedBaseline, ventedByRemoval),
                        snapshot.ventedTotal()), snapshot.movedLastTick(),
                snapshot.rebuildQueueDepth());
    }

    /**
     * Diagnostics read of the node at {@code pos} (Charge Probe, {@code /cuprum cg node}).
     * In-memory only — never loads chunks; unknown positions yield empty. Frozen nodes report
     * their last-known stored shadow; network sums cover LOADED sub-island members only.
     */
    public Optional<NodeReport> nodeReport(BlockPos pos) {
        assertServerThread(level);
        Entry entry = byPos.get(pos.asLong());
        if (entry == null) {
            return Optional.empty();
        }
        int coreId = entry.coreId;
        boolean frozen = !core.isActive(coreId);
        long stored = !frozen && entry.node instanceof ChargeStorage storage
                ? storage.stored()
                : entry.lastKnownStored;
        long networkStored = 0L;
        long networkCapacity = 0L;
        for (int member : core.loadedIslandMembers(coreId)) {
            if (Roles.has(core.roleMaskOf(member), Roles.STORAGE)) {
                networkStored = ChargeMath.satAdd(networkStored, access.stored(member));
                networkCapacity = ChargeMath.satAdd(networkCapacity, core.capacityOf(member));
            }
        }
        return Optional.of(new NodeReport(entry.pos, core.roleMaskOf(coreId),
                ChargePriority.fromOrdinal(core.priorityOrdinalOf(coreId)), stored,
                core.capacityOf(coreId), core.networkOf(coreId), frozen, networkStored,
                networkCapacity, core.topologyVersion()));
    }

    /** Total allocator passes run on this level; deliberate read-only diagnostic counter. */
    public long allocatorTicks() {
        assertServerThread(level);
        return core.ticksRun();
    }

    /** Alive node ids grouped by network label — read-only, for {@code /cuprum cg networks}. */
    public Map<Integer, List<NodeReport>> networkReports() {
        assertServerThread(level);
        Map<Integer, List<NodeReport>> networks = new LinkedHashMap<>();
        for (int coreId : core.aliveNodeIds()) {
            Entry entry = byId.get(coreId);
            nodeReport(entry.pos).ifPresent(report ->
                    networks.computeIfAbsent(report.networkId(), key -> new ArrayList<>()).add(report));
        }
        return networks;
    }

    // ------------------------------------------------------------------
    // Event plumbing
    // ------------------------------------------------------------------

    private void onBlockEntityLoad(BlockEntity blockEntity) {
        // Safe registration seam ([PROBE-1]): the event already delivered the BE, so its
        // state/BE are handed straight to the 5-arg lookup — no world re-query, no chunk-load
        // risk. Data may not be loaded yet under Fabric's public contract — topology only.
        registerNode(blockEntity.getBlockPos(), blockEntity.getBlockState(), blockEntity);
    }

    private void onBlockEntityUnload(BlockEntity blockEntity) {
        Entry entry = byPos.get(blockEntity.getBlockPos().asLong());
        if (entry == null || entry.node == null) {
            // Already removed (unload follows preRemoveSideEffects) or already frozen: no-op.
            return;
        }
        if (entry.sourceBlockEntity != blockEntity) {
            // Stale unload of a different BE instance at this position — replaced charge node
            // OR unrelated non-charge BE alike (source identity is tracked independently of
            // the lookup object): must not freeze the live node.
            return;
        }
        if (entry.node instanceof ChargeStorage storage) {
            entry.lastKnownStored = storage.stored();
            storedShadowChanged = true;
        }
        entry.node = null;
        core.setActive(entry.coreId, false);
    }

    private void refreshChunkActive(long chunkKey) {
        List<Entry> entries = byChunk.get(chunkKey);
        if (entries == null) {
            return;
        }
        boolean ticking = level.shouldTickBlocksAt(chunkKey);
        for (Entry entry : entries) {
            // A node with no live BE stays frozen regardless of chunk tick state.
            core.setActive(entry.coreId, ticking && entry.node != null);
        }
    }

    private void freezeChunk(long chunkKey) {
        List<Entry> entries = byChunk.get(chunkKey);
        if (entries == null) {
            return;
        }
        for (Entry entry : entries) {
            if (entry.node instanceof ChargeStorage storage) {
                entry.lastKnownStored = storage.stored();
                storedShadowChanged = true;
            }
            entry.node = null;
            core.setActive(entry.coreId, false);
        }
    }

    private void endWorldTick() {
        core.runRebuild(REBUILD_BUDGET);
        core.tick(access);
        maybeSnapshot();
    }

    /** Persists topology + shadows + vented total when something meaningful changed. */
    private void maybeSnapshot() {
        long ventedNow = ChargeMath.satAdd(
                ChargeMath.satAdd(ventedBaseline, ventedByRemoval),
                core.diagnostics().ventedTotal());
        if (!storedShadowChanged
                && core.topologyVersion() == lastSnapshotTopologyVersion
                && ventedNow == lastSnapshotVented) {
            return;
        }
        for (Entry entry : byId.values()) {
            if (entry.node instanceof ChargeStorage storage) {
                entry.lastKnownStored = storage.stored();
            }
        }
        List<ChargeGraphSavedData.NodeRecord> records = new ArrayList<>();
        for (int coreId : core.aliveNodeIds()) {
            Entry entry = byId.get(coreId);
            records.add(new ChargeGraphSavedData.NodeRecord(entry.posKey, core.roleMaskOf(coreId),
                    core.priorityOrdinalOf(coreId), entry.lastKnownStored));
        }
        records.addAll(dormantRecords.values());
        data.replaceSnapshot(records, ventedNow);
        lastSnapshotTopologyVersion = core.topologyVersion();
        lastSnapshotVented = ventedNow;
        storedShadowChanged = false;
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    private static void assertServerThread(ServerLevel level) {
        if (!level.getServer().isSameThread()) {
            throw new IllegalStateException("Cg: off-thread access");
        }
    }

    private static int roleMaskOf(ChargeNode node) {
        int mask = 0;
        if (node instanceof ChargeProducer) {
            mask |= Roles.PRODUCER;
        }
        if (node instanceof ChargeStorage) {
            mask |= Roles.STORAGE;
        }
        if (node instanceof ChargeConsumer) {
            mask |= Roles.CONSUMER;
        }
        if (node instanceof ChargeRelay) {
            mask |= Roles.RELAY;
        }
        if (node instanceof SurgeAbsorber) {
            mask |= Roles.SURGE_ABSORBER;
        }
        return mask;
    }

    /** 6-bit side-gate cache, indexed by {@link Direction#get3DDataValue()}. */
    private static int connectMaskOf(ChargeNode node) {
        int mask = 0;
        for (Direction direction : DIRECTIONS) {
            if (node.canConnect(direction)) {
                mask |= 1 << direction.get3DDataValue();
            }
        }
        return mask;
    }

    private static boolean connects(int connectMask, Direction direction) {
        return (connectMask & (1 << direction.get3DDataValue())) != 0;
    }

    private void ventRemovedCharge(long storedCg) {
        long nonNegative = Math.max(0L, storedCg);
        if (nonNegative > 0L) {
            ventedByRemoval = ChargeMath.satAdd(ventedByRemoval, nonNegative);
        }
        storedShadowChanged = true;
    }

    /** Re-registers a changed live node without treating the topology refresh as destruction. */
    private void unregisterWithoutVenting(Entry entry) {
        byPos.remove(entry.posKey);
        dormantRecords.remove(entry.posKey);
        core.removeNode(entry.coreId);
        byId.remove(entry.coreId);
        long chunkKey = ChunkPos.asLong(entry.pos);
        List<Entry> chunkEntries = byChunk.get(chunkKey);
        if (chunkEntries != null) {
            chunkEntries.remove(entry);
            if (chunkEntries.isEmpty()) {
                byChunk.remove(chunkKey);
            }
        }
        storedShadowChanged = true;
    }
}
