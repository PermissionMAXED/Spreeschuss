package dev.cuprum.cuprum.multiblock;

import dev.cuprum.cuprum.Cuprum;
import it.unimi.dsi.fastutil.longs.Long2LongOpenHashMap;
import it.unimi.dsi.fastutil.longs.Long2ObjectOpenHashMap;
import it.unimi.dsi.fastutil.longs.LongOpenHashSet;
import java.util.HashMap;
import java.util.Map;
import net.minecraft.core.BlockPos;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.level.ChunkPos;
import net.minecraft.world.level.block.entity.BlockEntity;
import net.minecraft.world.level.chunk.LevelChunk;
import org.jetbrains.annotations.Nullable;

/**
 * Per-level transient member/controller index + claims (multiblock.md §5.1). Server-thread
 * only (Fabric lifecycle events and BE tickers), never persisted: during the real
 * {@code BLOCK_ENTITY_LOAD} callback a persisted controller re-registers retained claims
 * recomputed from its persisted orientation before any controller tick can run.
 *
 * <p>Storage: fastutil {@code Long2LongOpenHashMap} member→controller,
 * {@code Long2ObjectOpenHashMap<long[]>} controller→members, plus independent per-chunk
 * groupings for claimed members and loaded controller anchors.
 *
 * <p>Frozen rules: (1) a member position belongs to ≤1 controller; {@code claim} checks all
 * then inserts all. (2) Claims exist only in FORMED (retained in FAULT), released on host
 * removal/unload. (3) Claim origin and verification are orthogonal: PERSISTED beats FRESH;
 * persisted conflicts always use signed {@code BlockPos.asLong()} order; for two fresh claims a
 * verified owner beats a provisional challenger, otherwise position order decides. Stale owners
 * are evicted only after an already-loaded chunk and exact-BE-identity check, so no path
 * force-loads a chunk.
 */
public final class MultiblockLevelIndex {
    /** Sentinel for "no entry" ({@code BlockPos.asLong} never produces it for valid positions). */
    private static final long NO_KEY = Long.MIN_VALUE;
    /** Strict maximum coordinate reach of any valid pattern from its controller anchor. */
    public static final int MAX_PATTERN_REACH = MultiblockPattern.MAX_DIMENSION - 1;

    private static final Map<ServerLevel, MultiblockLevelIndex> INDICES = new HashMap<>();

    private final ServerLevel level;
    private final Long2LongOpenHashMap memberToController = new Long2LongOpenHashMap();
    private final Long2ObjectOpenHashMap<long[]> controllerToMembers = new Long2ObjectOpenHashMap<>();
    private final Long2ObjectOpenHashMap<LongOpenHashSet> memberChunkToControllers =
            new Long2ObjectOpenHashMap<>();
    private final Long2ObjectOpenHashMap<BlockEntity> loadedControllerHosts =
            new Long2ObjectOpenHashMap<>();
    private final Long2ObjectOpenHashMap<LongOpenHashSet> controllerChunkToControllers =
            new Long2ObjectOpenHashMap<>();
    private final LongOpenHashSet dirtyControllers = new LongOpenHashSet();
    private final Long2ObjectOpenHashMap<ClaimStatus> claimStatuses = new Long2ObjectOpenHashMap<>();

    private enum ClaimOrigin {
        PERSISTED,
        FRESH
    }

    private record ClaimStatus(ClaimOrigin origin, boolean verified) {
        private ClaimStatus markVerified() {
            return verified ? this : new ClaimStatus(origin, true);
        }
    }

    private MultiblockLevelIndex(ServerLevel level) {
        this.level = level;
        memberToController.defaultReturnValue(NO_KEY);
    }

    /** Lazy identity-keyed accessor (mirrors {@code ChargeGraphManager.of}). */
    public static MultiblockLevelIndex get(ServerLevel level) {
        return INDICES.computeIfAbsent(level, MultiblockLevelIndex::new);
    }

    @Nullable
    private static MultiblockLevelIndex existing(ServerLevel level) {
        return INDICES.get(level);
    }

    /** The controller owning {@code memberPos}, or null when unclaimed. O(1). */
    @Nullable
    public BlockPos controllerAt(BlockPos memberPos) {
        long owner = memberToController.get(memberPos.asLong());
        return owner == NO_KEY ? null : BlockPos.of(owner);
    }

    /**
     * All-or-nothing verified claim of {@code memberPositions} for {@code controllerPos};
     * re-claiming replaces the controller's previous claim atomically. Returns false when a
     * non-evictable conflict remains.
     */
    public boolean claim(BlockPos controllerPos, long[] memberPositions) {
        long key = controllerPos.asLong();
        ClaimStatus current = claimStatuses.get(key);
        ClaimStatus candidate = current != null
                ? current
                : new ClaimStatus(ClaimOrigin.FRESH, false);
        return claimInternal(controllerPos, memberPositions, candidate);
    }

    /** Retained persisted claim, registered by {@code BLOCK_ENTITY_LOAD} before ticking. */
    boolean claimRetained(BlockPos controllerPos, long[] memberPositions) {
        long key = controllerPos.asLong();
        ClaimStatus current = claimStatuses.get(key);
        ClaimStatus candidate = current != null && current.origin() == ClaimOrigin.PERSISTED
                ? current
                : new ClaimStatus(ClaimOrigin.PERSISTED, false);
        return claimInternal(controllerPos, memberPositions, candidate);
    }

    /** Marks a claimed controller verified only after its caller completed a full match. */
    void markVerified(BlockPos controllerPos) {
        long key = controllerPos.asLong();
        if (!controllerToMembers.containsKey(key)) {
            throw new IllegalStateException("cannot verify unclaimed multiblock controller " + controllerPos);
        }
        ClaimStatus current = claimStatuses.get(key);
        if (current == null) {
            throw new IllegalStateException("claimed multiblock controller has no claim status " + controllerPos);
        }
        claimStatuses.put(key, current.markVerified());
    }

    private boolean claimInternal(BlockPos controllerPos, long[] memberPositions, ClaimStatus candidateStatus) {
        long controllerKey = controllerPos.asLong();
        for (int attempt = 0; attempt < 2; attempt++) {
            long conflictMember = findConflict(controllerKey, memberPositions);
            if (conflictMember == NO_KEY) {
                releaseClaimsKey(controllerKey);
                insertAll(controllerKey, memberPositions);
                claimStatuses.put(controllerKey, candidateStatus);
                return true;
            }
            long ownerKey = memberToController.get(conflictMember);
            if (attempt == 0 && shouldEvict(controllerKey, candidateStatus, ownerKey)) {
                boolean ownerStillLive = isLiveRegisteredController(ownerKey);
                releaseClaimsKey(ownerKey);
                if (ownerStillLive) {
                    // A surviving loser keeps origin/verification and must notice the loss.
                    dirtyControllers.add(ownerKey);
                } else {
                    claimStatuses.remove(ownerKey);
                    unregisterControllerKey(ownerKey);
                }
                continue;
            }
            return false;
        }
        return false;
    }

    /** The first member (in the given order) claimed by a different controller, else null. */
    @Nullable
    public BlockPos firstConflict(BlockPos controllerPos, long[] memberPositions) {
        long conflict = findConflict(controllerPos.asLong(), memberPositions);
        return conflict == NO_KEY ? null : BlockPos.of(conflict);
    }

    private long findConflict(long controllerKey, long[] memberPositions) {
        for (long member : memberPositions) {
            long owner = memberToController.get(member);
            if (owner != NO_KEY && owner != controllerKey) {
                return member;
            }
        }
        return NO_KEY;
    }

    /**
     * Already-loaded-chunk and exact registered-BE checks happen before status comparison. A
     * stale owner is evictable. PERSISTED beats FRESH; two PERSISTED claims always use signed
     * packed-position order; for two FRESH claims only a verified owner versus a provisional
     * challenger bypasses that deterministic position tie-break.
     */
    private boolean shouldEvict(long challengerKey, ClaimStatus challengerStatus, long ownerKey) {
        ClaimStatus ownerStatus = claimStatuses.get(ownerKey);
        if (!isLiveRegisteredController(ownerKey)) {
            return true;
        }
        if (ownerStatus == null) {
            return true;
        }
        if (challengerStatus.origin() != ownerStatus.origin()) {
            return challengerStatus.origin() == ClaimOrigin.PERSISTED;
        }
        if (ownerStatus.origin() == ClaimOrigin.PERSISTED) {
            return Long.compare(challengerKey, ownerKey) < 0;
        }
        if (ownerStatus.verified() && !challengerStatus.verified()) {
            return false;
        }
        return Long.compare(challengerKey, ownerKey) < 0;
    }

    private boolean isLiveRegisteredController(long controllerKey) {
        BlockEntity registered = loadedControllerHosts.get(controllerKey);
        if (!(registered instanceof MultiblockControllerHost)
                || registered.isRemoved()
                || registered.getLevel() != level) {
            return false;
        }
        BlockPos pos = BlockPos.of(controllerKey);
        LevelChunk chunk = level.getChunkSource().getChunkNow(pos.getX() >> 4, pos.getZ() >> 4);
        return chunk != null && chunk.getBlockEntity(pos) == registered;
    }

    /** Releases every claim held by {@code controllerPos}; idempotent. */
    public void release(BlockPos controllerPos) {
        releaseControllerKey(controllerPos.asLong());
    }

    /** Identity-guarded release used by real removal/unload callbacks. */
    void release(BlockEntity controller) {
        long key = controller.getBlockPos().asLong();
        boolean identityMatches = loadedControllerHosts.get(key) == controller;
        if (identityMatches) {
            releaseControllerKey(key);
        }
    }

    private void releaseControllerKey(long controllerKey) {
        releaseClaimsKey(controllerKey);
        claimStatuses.remove(controllerKey);
        dirtyControllers.remove(controllerKey);
        unregisterControllerKey(controllerKey);
    }

    private void releaseClaimsKey(long controllerKey) {
        long[] members = controllerToMembers.remove(controllerKey);
        if (members == null) {
            return;
        }
        for (long member : members) {
            if (memberToController.get(member) == controllerKey) {
                memberToController.remove(member);
            }
            long chunkKey = ChunkPos.asLong(BlockPos.of(member));
            LongOpenHashSet controllers = memberChunkToControllers.get(chunkKey);
            if (controllers != null) {
                controllers.remove(controllerKey);
                if (controllers.isEmpty()) {
                    memberChunkToControllers.remove(chunkKey);
                }
            }
        }
    }

    private void insertAll(long controllerKey, long[] memberPositions) {
        controllerToMembers.put(controllerKey, memberPositions.clone());
        for (long member : memberPositions) {
            memberToController.put(member, controllerKey);
            memberChunkToControllers.computeIfAbsent(ChunkPos.asLong(BlockPos.of(member)),
                    ignored -> new LongOpenHashSet()).add(controllerKey);
        }
    }

    private void registerController(BlockEntity blockEntity) {
        long key = blockEntity.getBlockPos().asLong();
        BlockEntity previous = loadedControllerHosts.get(key);
        if (previous == blockEntity) {
            return;
        }
        if (previous != null) {
            releaseControllerKey(key);
        }
        loadedControllerHosts.put(key, blockEntity);
        controllerChunkToControllers.computeIfAbsent(ChunkPos.asLong(blockEntity.getBlockPos()),
                ignored -> new LongOpenHashSet()).add(key);
    }

    private void unregisterControllerKey(long controllerKey) {
        BlockEntity removed = loadedControllerHosts.remove(controllerKey);
        BlockPos pos = removed == null ? BlockPos.of(controllerKey) : removed.getBlockPos();
        long chunkKey = ChunkPos.asLong(pos);
        LongOpenHashSet controllers = controllerChunkToControllers.get(chunkKey);
        if (controllers != null) {
            controllers.remove(controllerKey);
            if (controllers.isEmpty()) {
                controllerChunkToControllers.remove(chunkKey);
            }
        }
    }

    /** Defensive idempotent registration; the production path is {@code BLOCK_ENTITY_LOAD}. */
    void ensureControllerRegistered(BlockEntity blockEntity) {
        if (loadedControllerHosts.get(blockEntity.getBlockPos().asLong()) != blockEntity) {
            registerController(blockEntity);
        }
    }

    /**
     * Bounded dirty-mark: a claimed position dirties only its owner; an unclaimed position
     * consults the loaded-controller chunk index and dirties only anchors inside the strict
     * maximum pattern reach. No global generation/fanout exists.
     */
    public void requestRevalidation(BlockPos memberOrControllerPos) {
        long key = memberOrControllerPos.asLong();
        if (loadedControllerHosts.containsKey(key) || controllerToMembers.containsKey(key)) {
            dirtyControllers.add(key);
            return;
        }
        long owner = memberToController.get(key);
        if (owner != NO_KEY) {
            dirtyControllers.add(owner);
        } else {
            markNearbyControllersDirty(memberOrControllerPos);
        }
    }

    private void markNearbyControllersDirty(BlockPos changedPos) {
        int minChunkX = (changedPos.getX() - MAX_PATTERN_REACH) >> 4;
        int maxChunkX = (changedPos.getX() + MAX_PATTERN_REACH) >> 4;
        int minChunkZ = (changedPos.getZ() - MAX_PATTERN_REACH) >> 4;
        int maxChunkZ = (changedPos.getZ() + MAX_PATTERN_REACH) >> 4;
        for (int chunkX = minChunkX; chunkX <= maxChunkX; chunkX++) {
            for (int chunkZ = minChunkZ; chunkZ <= maxChunkZ; chunkZ++) {
                LongOpenHashSet candidates = controllerChunkToControllers.get(ChunkPos.asLong(chunkX, chunkZ));
                if (candidates == null) {
                    continue;
                }
                for (long controllerKey : candidates) {
                    BlockPos controller = BlockPos.of(controllerKey);
                    if (withinPatternReach(changedPos, controller)) {
                        dirtyControllers.add(controllerKey);
                    }
                }
            }
        }
    }

    private static boolean withinPatternReach(BlockPos first, BlockPos second) {
        return Math.abs((long) first.getX() - second.getX()) <= MAX_PATTERN_REACH
                && Math.abs((long) first.getY() - second.getY()) <= MAX_PATTERN_REACH
                && Math.abs((long) first.getZ() - second.getZ()) <= MAX_PATTERN_REACH;
    }

    /** Consumes the dirty flag for a controller; called from its behavior's server tick. */
    boolean consumeDirty(BlockPos controllerPos) {
        return dirtyControllers.remove(controllerPos.asLong());
    }

    /** {@code ServerChunkEvents.CHUNK_LOAD}: dirty every controller with members in the chunk. */
    public static void onChunkLoad(ServerLevel level, LevelChunk chunk) {
        markChunkControllersDirty(level, chunk);
    }

    /**
     * {@code ServerChunkEvents.CHUNK_UNLOAD}: synchronously fault loaded controllers anchored
     * elsewhere whose claims cross this chunk, then release every controller anchor being
     * unloaded. Fabric's event precedes vanilla's bulk {@code LevelChunk.clearAllBlockEntities};
     * the latter does not emit per-BE unload callbacks, so anchor release belongs here as well.
     */
    public static void onChunkUnload(ServerLevel level, LevelChunk chunk) {
        MultiblockLevelIndex index = existing(level);
        if (index == null) {
            return;
        }
        index.faultControllersForUnloadingMemberChunk(chunk.getPos());
        LongOpenHashSet hosted = index.controllerChunkToControllers.get(chunk.getPos().toLong());
        if (hosted == null) {
            return;
        }
        for (long controllerKey : hosted.toLongArray()) {
            index.releaseControllerKey(controllerKey);
        }
    }

    /**
     * Transitions affected hosts through their already-registered identity only. Controller
     * lookup is restricted to {@code getChunkNow} plus the loaded chunk's BE map; it never
     * recurses through {@code ServerLevel#getBlockEntity} or requests the unloading chunk.
     */
    private void faultControllersForUnloadingMemberChunk(ChunkPos unloadingChunk) {
        long chunkKey = unloadingChunk.toLong();
        LongOpenHashSet controllers = memberChunkToControllers.get(chunkKey);
        if (controllers == null) {
            return;
        }
        for (long controllerKey : controllers.toLongArray()) {
            if (ChunkPos.asLong(BlockPos.of(controllerKey)) == chunkKey) {
                continue;
            }
            BlockEntity registered = loadedControllerHosts.get(controllerKey);
            if (!(registered instanceof MultiblockControllerHost host)
                    || !isLiveRegisteredController(controllerKey)) {
                continue;
            }
            BlockPos firstMember = firstClaimedMemberInChunk(controllerKey, chunkKey);
            if (firstMember != null) {
                dirtyControllers.add(controllerKey);
                host.multiblockBehavior().onMemberChunkUnloaded(firstMember);
            }
        }
    }

    @Nullable
    private BlockPos firstClaimedMemberInChunk(long controllerKey, long chunkKey) {
        long[] members = controllerToMembers.get(controllerKey);
        if (members == null) {
            return null;
        }
        for (long member : members) {
            BlockPos pos = BlockPos.of(member);
            if (ChunkPos.asLong(pos) == chunkKey) {
                return pos;
            }
        }
        return null;
    }

    private static void markChunkControllersDirty(ServerLevel level, LevelChunk chunk) {
        MultiblockLevelIndex index = existing(level);
        if (index == null) {
            return;
        }
        LongOpenHashSet controllers = index.memberChunkToControllers.get(chunk.getPos().toLong());
        if (controllers != null) {
            index.dirtyControllers.addAll(controllers);
        }
    }

    /** {@code ServerWorldEvents.UNLOAD}: drop the whole per-level index. */
    public static void onWorldUnload(MinecraftServer server, ServerLevel level) {
        MultiblockLevelIndex removed = INDICES.remove(level);
        if (removed != null) {
            removed.clear();
        }
    }

    /** {@code SERVER_STOPPED}: no level identity or transient claim survives a server. */
    public static void onServerStopped(MinecraftServer server) {
        int cleared = INDICES.size();
        INDICES.values().forEach(MultiblockLevelIndex::clear);
        INDICES.clear();
        Cuprum.LOGGER.info("[multiblock] cleared {} transient level index(es) (server stopped)", cleared);
    }

    /**
     * {@code BLOCK_ENTITY_LOAD}: index the exact live host and register any retained persisted
     * claims before its first ticker invocation.
     */
    public static void onBlockEntityLoad(BlockEntity blockEntity, ServerLevel level) {
        if (!(blockEntity instanceof MultiblockControllerHost host)) {
            return;
        }
        if (blockEntity.isRemoved() || blockEntity.getLevel() != level) {
            return; // stale/out-of-order callback; never query the chunk while it is post-loading
        }
        MultiblockLevelIndex index = get(level);
        index.registerController(blockEntity);
        host.multiblockBehavior().onHostLoaded(index);
    }

    /**
     * {@code ServerBlockEntityEvents.BLOCK_ENTITY_UNLOAD}: release the claims held by an
     * unloading controller host (fires for both chunk unload and explicit removal; idempotent
     * with {@code MultiblockControllerBehavior.onHostRemoved}).
     */
    public static void onBlockEntityUnload(BlockEntity blockEntity, ServerLevel level) {
        if (!(blockEntity instanceof MultiblockControllerHost)) {
            return;
        }
        MultiblockLevelIndex index = existing(level);
        if (index != null) {
            index.release(blockEntity);
        }
    }

    private void clear() {
        memberToController.clear();
        controllerToMembers.clear();
        memberChunkToControllers.clear();
        loadedControllerHosts.clear();
        controllerChunkToControllers.clear();
        dirtyControllers.clear();
        claimStatuses.clear();
    }
}
