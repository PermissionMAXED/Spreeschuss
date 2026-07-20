package dev.cuprum.cuprum.gametest.multiblock;

import dev.cuprum.cuprum.block.DiagnosticCoilCoreBlockEntity;
import dev.cuprum.cuprum.charge.blockentity.AbstractChargeStorageBlockEntity;
import dev.cuprum.cuprum.machine.ChargeMachineBlockEntity;
import dev.cuprum.cuprum.machine.MachineContent;
import dev.cuprum.cuprum.multiblock.FaultCode;
import dev.cuprum.cuprum.multiblock.FormationState;
import dev.cuprum.cuprum.multiblock.MultiblockFault;
import dev.cuprum.cuprum.multiblock.MultiblockLevelIndex;
import dev.cuprum.cuprum.multiblock.MultiblockOrientation;
import dev.cuprum.cuprum.multiblock.MultiblockPattern;
import dev.cuprum.cuprum.state.CuprumSchema;
import it.unimi.dsi.fastutil.longs.Long2ObjectMap;
import it.unimi.dsi.fastutil.longs.LongOpenHashSet;
import java.lang.reflect.Field;
import java.util.Arrays;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerBlockEntityEvents;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerChunkEvents;
import net.fabricmc.fabric.api.gametest.v1.GameTest;
import net.minecraft.core.BlockPos;
import net.minecraft.gametest.framework.GameTestHelper;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerChunkCache;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.level.ChunkPos;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.block.Mirror;
import net.minecraft.world.level.block.Rotation;
import net.minecraft.world.level.chunk.LevelChunk;

/**
 * Permanent lifecycle regressions for bounded invalidation, retained claim grades, load order,
 * same-state client data notifications, persistence hardening and overflow-safe sync timing.
 */
public class MultiblockLifecycleRegressionGameTest {
    private static final String ISOLATED = "cuprum-gametest:isolated";
    private static final String CHUNK_LIFECYCLE =
            "cuprum-gametest:multiblock_chunk_lifecycle";
    private static final String GLOBAL_LIFECYCLE =
            "cuprum-gametest:multiblock_global_lifecycle";
    private static final BlockPos CORE = new BlockPos(2, 1, 2);
    private static final MultiblockOrientation UNROTATED =
            new MultiblockOrientation(Rotation.NONE, Mirror.NONE);

    @GameTest(environment = ISOLATED, maxTicks = 100)
    public void unclaimedInvalidationIsSpatiallyBoundedAndChurnLeaksNothing(GameTestHelper helper) {
        BlockPos changed = new BlockPos(1, 1, 1);
        BlockPos boundary = changed.offset(0, MultiblockLevelIndex.MAX_PATTERN_REACH, 0);
        BlockPos far = boundary.above();
        helper.setBlock(boundary, MachineContent.DIAGNOSTIC_COIL_CORE);
        helper.setBlock(far, MachineContent.DIAGNOSTIC_COIL_CORE);

        MultiblockLevelIndex index = MultiblockLevelIndex.get(helper.getLevel());
        clearDirty(index);
        index.requestRevalidation(helper.absolutePos(changed));
        helper.assertTrue(isDirty(index, helper.absolutePos(boundary)),
                Component.literal("controller exactly at maximum reach is dirtied"));
        helper.assertFalse(isDirty(index, helper.absolutePos(far)),
                Component.literal("controller one block beyond maximum reach is untouched"));

        helper.setBlock(boundary, Blocks.AIR);
        helper.setBlock(far, Blocks.AIR);
        assertIndexLacks(helper, index, boundary);
        assertIndexLacks(helper, index, far);

        BlockPos churn = new BlockPos(6, 1, 6);
        for (int i = 0; i < 64; i++) {
            helper.setBlock(churn, MachineContent.DIAGNOSTIC_COIL_CORE);
            helper.setBlock(churn, Blocks.AIR);
        }
        assertIndexLacks(helper, index, churn);
        helper.succeed();
    }

    @GameTest(environment = ISOLATED, maxTicks = 160)
    public void retainedPersistedConflictWinnerIsLoadOrderIndependent(GameTestHelper helper) {
        MultiblockPattern pattern = MultiblockTestHelper.requirePattern(
                helper, DiagnosticCoilCoreBlockEntity.PATTERN_ID);
        BlockPos coreA = CORE;
        BlockPos coreB = new BlockPos(2, 1, 4);
        BlockPos shared = new BlockPos(1, 1, 3);
        buildOverlappingMembersWithoutCores(helper, pattern, coreA, coreB);
        CompoundTag savedA = persistedCoil(Rotation.NONE, Mirror.NONE, 111L);
        CompoundTag savedB = persistedCoil(Rotation.CLOCKWISE_180, Mirror.NONE, 222L);
        BlockPos absoluteA = helper.absolutePos(coreA);
        BlockPos absoluteB = helper.absolutePos(coreB);
        BlockPos low = Long.compare(absoluteA.asLong(), absoluteB.asLong()) < 0 ? coreA : coreB;
        BlockPos high = low.equals(coreA) ? coreB : coreA;

        // First order: HIGH gets a full BLOCK_ENTITY_LOAD + verification gap before LOW loads.
        MultiblockTestHelper.replaceWithLoadedCoil(
                helper, high, high.equals(coreA) ? savedA : savedB);
        helper.startSequence().thenExecuteAfter(4, () -> {
            helper.assertValueEqual(FormationState.FORMED,
                    MultiblockTestHelper.coilCore(helper, high).multiblockBehavior().state(),
                    Component.literal("high persisted owner verified before low loads"));
            MultiblockTestHelper.replaceWithLoadedCoil(
                    helper, low, low.equals(coreA) ? savedA : savedB);
        }).thenExecuteAfter(4, () -> {
            assertDeterministicPersistedWinner(helper, coreA, coreB, shared);
            helper.setBlock(coreA, Blocks.AIR);
            helper.setBlock(coreB, Blocks.AIR);
        }).thenExecuteAfter(4, () -> {
            // Reverse order: LOW gets the same load + verification gap before HIGH loads.
            MultiblockTestHelper.replaceWithLoadedCoil(
                    helper, low, low.equals(coreA) ? savedA : savedB);
        }).thenExecuteAfter(4, () -> {
            helper.assertValueEqual(FormationState.FORMED,
                    MultiblockTestHelper.coilCore(helper, low).multiblockBehavior().state(),
                    Component.literal("low persisted owner verified before high loads"));
            MultiblockTestHelper.replaceWithLoadedCoil(
                    helper, high, high.equals(coreA) ? savedA : savedB);
        }).thenExecuteAfter(4, () -> {
            assertDeterministicPersistedWinner(helper, coreA, coreB, shared);
            helper.succeed();
        });
    }

    @GameTest(environment = ISOLATED, maxTicks = 100)
    public void persistedOwnerEvictsEarlierFreshVerifiedOwner(GameTestHelper helper) {
        MultiblockPattern pattern = MultiblockTestHelper.requirePattern(
                helper, DiagnosticCoilCoreBlockEntity.PATTERN_ID);
        BlockPos persistedCore = CORE;
        BlockPos freshCore = new BlockPos(2, 1, 4);
        BlockPos shared = new BlockPos(1, 1, 3);
        buildOverlappingMembersWithoutCores(helper, pattern, persistedCore, freshCore);

        helper.setBlock(freshCore, MachineContent.DIAGNOSTIC_COIL_CORE);
        DiagnosticCoilCoreBlockEntity fresh = MultiblockTestHelper.coilCore(helper, freshCore);
        fresh.multiblockBehavior().serverTick(helper.getLevel());
        helper.assertValueEqual(FormationState.FORMED, fresh.multiblockBehavior().state(),
                Component.literal("fresh owner is fully verified before persisted load"));

        DiagnosticCoilCoreBlockEntity persisted = MultiblockTestHelper.replaceWithLoadedCoil(
                helper, persistedCore, persistedCoil(Rotation.NONE, Mirror.NONE, 100L));
        helper.assertValueEqual(helper.absolutePos(persistedCore),
                MultiblockLevelIndex.get(helper.getLevel()).controllerAt(helper.absolutePos(shared)),
                Component.literal("persisted origin wins synchronously during BLOCK_ENTITY_LOAD"));
        persisted.multiblockBehavior().serverTick(helper.getLevel());
        fresh.multiblockBehavior().serverTick(helper.getLevel());

        helper.assertValueEqual(FormationState.FORMED, persisted.multiblockBehavior().state(),
                Component.literal("persisted owner verifies without losing provenance"));
        helper.assertValueEqual(FormationState.FAULT, fresh.multiblockBehavior().state(),
                Component.literal("earlier fresh verified owner observes deterministic eviction"));
        helper.assertValueEqual(FaultCode.CONFLICT, fresh.multiblockBehavior().fault().orElseThrow().code(),
                Component.literal("fresh loser reports CONFLICT"));
        helper.assertValueEqual(helper.absolutePos(persistedCore),
                MultiblockLevelIndex.get(helper.getLevel()).controllerAt(helper.absolutePos(shared)),
                Component.literal("persisted owner retains the shared member"));
        helper.succeed();
    }

    @GameTest(environment = ISOLATED, maxTicks = 100)
    public void brokenRetainedOwnerCannotBeStolenWhileFaulted(GameTestHelper helper) {
        MultiblockPattern pattern = MultiblockTestHelper.requirePattern(
                helper, DiagnosticCoilCoreBlockEntity.PATTERN_ID);
        BlockPos retainedCore = new BlockPos(2, 1, 4);
        BlockPos freshCore = new BlockPos(2, 1, 2);
        MultiblockTestHelper.buildPattern(helper, pattern, retainedCore, UNROTATED);
        helper.setBlock(new BlockPos(2, 1, 5), Blocks.AIR); // exclusive retained member is broken

        // Fresh coil is geometrically valid and overlaps the retained owner's north row.
        helper.setBlock(new BlockPos(1, 1, 2), MachineContent.DIAGNOSTIC_COIL_FRAME);
        helper.setBlock(new BlockPos(3, 1, 2), MachineContent.DIAGNOSTIC_COIL_FRAME);
        helper.setBlock(new BlockPos(1, 1, 1), MachineContent.DIAGNOSTIC_COIL_FRAME);
        helper.setBlock(new BlockPos(2, 1, 1), MachineContent.DIAGNOSTIC_COIL_FRAME);
        helper.setBlock(new BlockPos(3, 1, 1), MachineContent.DIAGNOSTIC_COIL_FRAME);
        helper.setBlock(freshCore, MachineContent.DIAGNOSTIC_COIL_CORE);

        DiagnosticCoilCoreBlockEntity retained = MultiblockTestHelper.replaceWithLoadedCoil(
                helper, retainedCore, persistedCoil(Rotation.NONE, Mirror.NONE, 0L));
        BlockPos shared = new BlockPos(1, 1, 3);
        helper.assertValueEqual(helper.absolutePos(retainedCore),
                MultiblockLevelIndex.get(helper.getLevel()).controllerAt(helper.absolutePos(shared)),
                Component.literal("retained claim is registered synchronously in BLOCK_ENTITY_LOAD"));

        helper.startSequence().thenExecuteAfter(5, () -> {
            helper.assertValueEqual(FormationState.FAULT, retained.multiblockBehavior().state(),
                    Component.literal("broken retained owner faults after full verification"));
            helper.assertValueEqual(FaultCode.MISMATCH,
                    retained.multiblockBehavior().fault().orElseThrow().code(),
                    Component.literal("retained owner reports its physical mismatch"));
            helper.assertValueEqual(FormationState.FAULT,
                    MultiblockTestHelper.coilCore(helper, freshCore).multiblockBehavior().state(),
                    Component.literal("fresh full match cannot beat retained persisted claims"));
            helper.assertValueEqual(FaultCode.CONFLICT,
                    MultiblockTestHelper.coilCore(helper, freshCore)
                            .multiblockBehavior().fault().orElseThrow().code(),
                    Component.literal("fresh challenger reports conflict"));
            helper.assertValueEqual(helper.absolutePos(retainedCore),
                    MultiblockLevelIndex.get(helper.getLevel()).controllerAt(helper.absolutePos(shared)),
                    Component.literal("FAULTed retained owner still owns the shared member"));
            helper.succeed();
        });
    }

    @GameTest(environment = ISOLATED, maxTicks = 100)
    public void controllerRemovalAndStaleUnloadCannotLeakOrDeleteReplacementClaims(GameTestHelper helper) {
        MultiblockPattern pattern = MultiblockTestHelper.requirePattern(
                helper, DiagnosticCoilCoreBlockEntity.PATTERN_ID);
        MultiblockTestHelper.buildPattern(helper, pattern, CORE, UNROTATED);
        DiagnosticCoilCoreBlockEntity stale = MultiblockTestHelper.coilCore(helper, CORE);
        DiagnosticCoilCoreBlockEntity replacement = MultiblockTestHelper.replaceWithLoadedCoil(
                helper, CORE, persistedCoil(Rotation.NONE, Mirror.NONE, 77L));
        BlockPos member = MultiblockTestHelper.memberRel(pattern, CORE, UNROTATED, 2, 0, 2);
        MultiblockLevelIndex index = MultiblockLevelIndex.get(helper.getLevel());
        helper.assertValueEqual(helper.absolutePos(CORE), index.controllerAt(helper.absolutePos(member)),
                Component.literal("replacement retained claim registered"));

        ServerBlockEntityEvents.BLOCK_ENTITY_UNLOAD.invoker().onUnload(stale, helper.getLevel());
        helper.assertValueEqual(helper.absolutePos(CORE), index.controllerAt(helper.absolutePos(member)),
                Component.literal("stale unload identity cannot release replacement claims"));
        helper.assertValueEqual(replacement,
                helper.getLevel().getBlockEntity(helper.absolutePos(CORE)),
                Component.literal("replacement remains the live world BE"));

        helper.setBlock(CORE, Blocks.AIR);
        helper.assertTrue(index.controllerAt(helper.absolutePos(member)) == null,
                Component.literal("real controller removal releases every member claim"));
        assertIndexLacks(helper, index, CORE);
        helper.succeed();
    }

    @GameTest(environment = ISOLATED, maxTicks = 100)
    public void persistedFormedReloadFirstPeriodicSyncAndExactThrottle(GameTestHelper helper) {
        MultiblockPattern pattern = MultiblockTestHelper.requirePattern(
                helper, DiagnosticCoilCoreBlockEntity.PATTERN_ID);
        MultiblockTestHelper.buildPattern(helper, pattern, CORE, UNROTATED);
        MultiblockTestHelper.awaitFormation(helper, CORE, FormationState.FORMED, () -> {
            CompoundTag saved = MultiblockTestHelper.saveCoil(
                    helper, MultiblockTestHelper.coilCore(helper, CORE));
            DiagnosticCoilCoreBlockEntity loaded =
                    MultiblockTestHelper.replaceWithLoadedCoil(helper, CORE, saved);
            helper.assertValueEqual(Long.MIN_VALUE, lastSyncGameTime(loaded),
                    Component.literal("reload starts with the explicit never-synced sentinel"));

            AtomicLong firstSync = new AtomicLong();
            helper.startSequence().thenExecuteAfter(1, () -> {
                long first = lastSyncGameTime(loaded);
                helper.assertTrue(first != Long.MIN_VALUE,
                        Component.literal("first periodic formed update syncs immediately"));
                firstSync.set(first);
            }).thenExecuteAfter(ChargeMachineBlockEntity.SYNC_MIN_INTERVAL_TICKS - 1, () ->
                    helper.assertValueEqual(firstSync.get(), lastSyncGameTime(loaded),
                            Component.literal("throttle suppresses every update before exactly 10 ticks")))
                    .thenExecuteAfter(1, () -> {
                        helper.assertValueEqual(firstSync.get() + ChargeMachineBlockEntity.SYNC_MIN_INTERVAL_TICKS,
                                lastSyncGameTime(loaded),
                                Component.literal("throttle reopens at exactly the 10-tick boundary"));
                        helper.succeed();
                    });
        });
    }

    @GameTest(environment = ISOLATED, maxTicks = 100)
    public void faultPositionChangeNotifiesListenerAndChangesUpdateTag(GameTestHelper helper) {
        MultiblockPattern pattern = MultiblockTestHelper.requirePattern(
                helper, DiagnosticCoilCoreBlockEntity.PATTERN_ID);
        MultiblockTestHelper.buildPattern(helper, pattern, CORE, UNROTATED);
        BlockPos first = MultiblockTestHelper.memberRel(pattern, CORE, UNROTATED, 2, 0, 2);
        BlockPos second = MultiblockTestHelper.memberRel(pattern, CORE, UNROTATED, 0, 0, 1);
        MultiblockTestHelper.awaitFormation(helper, CORE, FormationState.FORMED, () -> {
            helper.setBlock(first, Blocks.AIR);
            MultiblockTestHelper.awaitFormation(helper, CORE, FormationState.FAULT, () -> {
                DiagnosticCoilCoreBlockEntity coil = MultiblockTestHelper.coilCore(helper, CORE);
                CompoundTag before = coil.getUpdateTag(helper.getLevel().registryAccess());
                AtomicInteger notifications = new AtomicInteger();
                coil.multiblockBehavior().setListener((previous, current) -> {
                    helper.assertValueEqual(FormationState.FAULT, previous,
                            Component.literal("same-state fault callback previous"));
                    helper.assertValueEqual(FormationState.FAULT, current,
                            Component.literal("same-state fault callback current"));
                    notifications.incrementAndGet();
                });

                helper.setBlock(first, MachineContent.DIAGNOSTIC_COIL_FRAME);
                helper.setBlock(second, Blocks.AIR);
                helper.startSequence().thenExecuteAfter(3, () -> {
                    CompoundTag after = coil.getUpdateTag(helper.getLevel().registryAccess());
                    helper.assertValueEqual(1, notifications.get(),
                            Component.literal("fault code/position change emits one listener callback"));
                    helper.assertFalse(Arrays.equals(
                                    before.getIntArray("fault_pos").orElseThrow(),
                                    after.getIntArray("fault_pos").orElseThrow()),
                            Component.literal("fault position changed in the client update tag"));
                    helper.assertFalse(before.equals(after),
                            Component.literal("same-enum fault detail produces a distinct update tag"));
                    helper.succeed();
                });
            });
        });
    }

    @GameTest(environment = ISOLATED, maxTicks = 100)
    public void formedOrientationChangeNotifiesListenerAndChangesUpdateTag(GameTestHelper helper) {
        MultiblockPattern pattern = MultiblockTestHelper.requirePattern(
                helper, DiagnosticCoilCoreBlockEntity.PATTERN_ID);
        MultiblockTestHelper.buildPattern(helper, pattern, CORE, UNROTATED);
        MultiblockTestHelper.awaitFormation(helper, CORE, FormationState.FORMED, () -> {
            DiagnosticCoilCoreBlockEntity coil = MultiblockTestHelper.coilCore(helper, CORE);
            CompoundTag before = coil.getUpdateTag(helper.getLevel().registryAccess());
            AtomicInteger notifications = new AtomicInteger();
            coil.multiblockBehavior().setListener((previous, current) -> {
                helper.assertValueEqual(FormationState.FORMED, previous,
                        Component.literal("same-state orientation callback previous"));
                helper.assertValueEqual(FormationState.FORMED, current,
                        Component.literal("same-state orientation callback current"));
                notifications.incrementAndGet();
            });

            helper.setBlock(new BlockPos(1, 1, 1), MachineContent.DIAGNOSTIC_COIL_FRAME);
            helper.setBlock(new BlockPos(3, 1, 1), Blocks.WAXED_COPPER_BLOCK);
            helper.startSequence().thenExecuteAfter(3, () -> {
                helper.assertValueEqual(new MultiblockOrientation(Rotation.CLOCKWISE_180, Mirror.LEFT_RIGHT),
                        coil.multiblockBehavior().orientation().orElseThrow(),
                        Component.literal("coil remains FORMED in the new exact orientation"));
                helper.assertValueEqual(1, notifications.get(),
                        Component.literal("FORMED orientation change emits one listener callback"));
                helper.assertFalse(before.equals(coil.getUpdateTag(helper.getLevel().registryAccess())),
                        Component.literal("orientation change produces a distinct client update tag"));
                helper.succeed();
            });
        });
    }

    @GameTest(environment = ISOLATED, maxTicks = 100)
    public void machinePersistenceClampsHostileAndToleratesFutureEnvelope(GameTestHelper helper) {
        DiagnosticCoilCoreBlockEntity high = new DiagnosticCoilCoreBlockEntity(
                helper.absolutePos(CORE), MachineContent.DIAGNOSTIC_COIL_CORE.defaultBlockState());
        MultiblockTestHelper.loadCoil(helper, high,
                persistedCoil(Rotation.NONE, Mirror.FRONT_BACK, Long.MAX_VALUE,
                        CuprumSchema.BLOCK_ENTITY + 99));
        helper.assertValueEqual(DiagnosticCoilCoreBlockEntity.CAPACITY_CG, high.chargeBuffer().stored(),
                Component.literal("future envelope hostile high charge clamps to capacity"));
        helper.assertValueEqual(UNROTATED, high.multiblockBehavior().orientation().orElseThrow(),
                Component.literal("unsupported persisted FRONT_BACK mirror clamps to NONE"));

        DiagnosticCoilCoreBlockEntity negative = new DiagnosticCoilCoreBlockEntity(
                helper.absolutePos(CORE.above()), MachineContent.DIAGNOSTIC_COIL_CORE.defaultBlockState());
        MultiblockTestHelper.loadCoil(helper, negative,
                persistedCoil(Rotation.CLOCKWISE_90, Mirror.NONE, Long.MIN_VALUE));
        helper.assertValueEqual(0L, negative.chargeBuffer().stored(),
                Component.literal("hostile negative persisted charge clamps to zero"));
        helper.assertValueEqual(FormationState.FORMED, negative.multiblockBehavior().state(),
                Component.literal("best-effort load retains a valid formation payload"));
        helper.succeed();
    }

    @GameTest(environment = CHUNK_LIFECYCLE, maxTicks = 600)
    public void actualChunkUnloadAndBlockEntityReloadReleaseThenRestoreRetainedClaims(GameTestHelper helper) {
        MultiblockPattern pattern = MultiblockTestHelper.requirePattern(
                helper, DiagnosticCoilCoreBlockEntity.PATTERN_ID);
        BlockPos relativeCore = CORE.offset(64 * 16, 0, 64 * 16);
        BlockPos absoluteCore = helper.absolutePos(relativeCore);
        ChunkPos targetChunk = new ChunkPos(absoluteCore);
        BlockPos relativeMember =
                MultiblockTestHelper.memberRel(pattern, relativeCore, UNROTATED, 2, 0, 2);
        BlockPos absoluteMember = helper.absolutePos(relativeMember);
        ServerChunkCache chunks = helper.getLevel().getChunkSource();

        helper.assertTrue(helper.getLevel().setChunkForced(targetChunk.x, targetChunk.z, true),
                Component.literal("remote chunk received a real ENTITY_TICKING forced ticket"));
        MultiblockTestHelper.buildPattern(helper, pattern, relativeCore, UNROTATED);
        DiagnosticCoilCoreBlockEntity original =
                MultiblockTestHelper.coilCore(helper, relativeCore);
        original.multiblockBehavior().serverTick(helper.getLevel());
        helper.assertValueEqual(FormationState.FORMED, original.multiblockBehavior().state(),
                Component.literal("control: remote controller verifies before lifecycle probe"));
        original.chargeBuffer().depositSurge(DiagnosticCoilCoreBlockEntity.CAPACITY_CG);
        MultiblockLevelIndex index = MultiblockLevelIndex.get(helper.getLevel());
        helper.assertValueEqual(absoluteCore, index.controllerAt(absoluteMember),
                Component.literal("control: remote forced chunk owns its pattern members"));

        helper.assertTrue(helper.getLevel().setChunkForced(targetChunk.x, targetChunk.z, false),
                Component.literal("remote chunk's forced ticket was removed"));
        helper.startSequence().thenWaitUntil(() -> {
            if (chunks.getChunkNow(targetChunk.x, targetChunk.z) != null
                    || !original.isRemoved()
                    || index.controllerAt(absoluteMember) != null
                    || indexContainsLoadedHost(index, absoluteCore.asLong())) {
                throw helper.assertionException(
                        Component.literal("awaiting complete ticket-driven chunk and block-entity unload"));
            }
        }).thenExecute(() -> {
            helper.assertTrue(original.isRemoved(),
                    Component.literal("real chunk manager unload removes the old BE"));
            helper.assertTrue(index.controllerAt(absoluteMember) == null,
                    Component.literal("real chunk unload releases member claims"));
            assertIndexLacksAbsolute(helper, index, absoluteCore);
        }).thenIdle(5).thenExecute(() ->
                helper.assertTrue(helper.getLevel().setChunkForced(targetChunk.x, targetChunk.z, true),
                        Component.literal("remote chunk was forced back through the production load path")))
                .thenWaitUntil(() -> {
            LevelChunk loadedChunk = chunks.getChunkNow(targetChunk.x, targetChunk.z);
            if (loadedChunk == null
                    || !(loadedChunk.getBlockEntity(absoluteCore)
                            instanceof DiagnosticCoilCoreBlockEntity)) {
                throw helper.assertionException(Component.literal("awaiting real chunk reload"));
            }
        }).thenExecute(() -> {
            DiagnosticCoilCoreBlockEntity loaded =
                    (DiagnosticCoilCoreBlockEntity) helper.getLevel().getBlockEntity(absoluteCore);
            helper.assertTrue(loaded != null && loaded != original && !loaded.isRemoved(),
                    Component.literal("disk-reloaded block entity is a new live instance"));
            helper.assertValueEqual(DiagnosticCoilCoreBlockEntity.CAPACITY_CG,
                    loaded.chargeBuffer().stored(),
                    Component.literal("real chunk unload/load persisted machine charge"));
            helper.assertValueEqual(absoluteCore,
                    MultiblockLevelIndex.get(helper.getLevel()).controllerAt(absoluteMember),
                    Component.literal("BLOCK_ENTITY_LOAD restored retained claims before ticking"));
            helper.getLevel().setChunkForced(targetChunk.x, targetChunk.z, false);
            helper.succeed();
        });
    }

    @GameTest(environment = CHUNK_LIFECYCLE, maxTicks = 600)
    public void memberChunkUnloadImmediatelyFaultsLoadedNonTickingController(GameTestHelper helper) {
        ServerLevel level = helper.getLevel();
        ServerChunkCache chunks = level.getChunkSource();
        MultiblockPattern pattern = MultiblockTestHelper.requirePattern(
                helper, DiagnosticCoilCoreBlockEntity.PATTERN_ID);
        BlockPos origin = helper.absolutePos(BlockPos.ZERO);
        BlockPos base = helper.absolutePos(new BlockPos(64 * 16, 1, -64 * 16));
        ChunkPos controllerChunk = new ChunkPos(base);
        BlockPos core = new BlockPos(controllerChunk.getMaxBlockX(), base.getY(),
                controllerChunk.getMinBlockZ() + 8);
        BlockPos coreRel = core.subtract(origin);
        ChunkPos memberChunk = new ChunkPos(controllerChunk.x + 1, controllerChunk.z);
        ChunkPos anchorTicket = new ChunkPos(controllerChunk.x - 2, controllerChunk.z);
        BlockPos memberAcrossBoundary = core.east();

        helper.assertTrue(level.setChunkForced(controllerChunk.x, controllerChunk.z, true),
                Component.literal("controller chunk force-loaded for setup"));
        helper.assertTrue(level.setChunkForced(memberChunk.x, memberChunk.z, true),
                Component.literal("member chunk force-loaded for setup"));
        MultiblockTestHelper.buildPattern(helper, pattern, coreRel, UNROTATED);
        LevelChunk loadedMemberChunk = chunks.getChunkNow(memberChunk.x, memberChunk.z);
        helper.assertTrue(loadedMemberChunk != null,
                Component.literal("captured the loaded member chunk delivered to CHUNK_UNLOAD"));
        DiagnosticCoilCoreBlockEntity coil = MultiblockTestHelper.coilCore(helper, coreRel);
        coil.multiblockBehavior().serverTick(level);
        helper.assertValueEqual(FormationState.FORMED, coil.multiblockBehavior().state(),
                Component.literal("boundary controller verifies with both chunks loaded"));
        MultiblockLevelIndex index = MultiblockLevelIndex.get(level);
        helper.assertValueEqual(core, index.controllerAt(memberAcrossBoundary),
                Component.literal("cross-chunk member starts claimed"));

        helper.assertTrue(level.setChunkForced(anchorTicket.x, anchorTicket.z, true),
                Component.literal("border ticket keeps controller loaded but non-ticking"));
        helper.startSequence().thenExecuteAfter(5, () -> {
            helper.assertTrue(level.setChunkForced(controllerChunk.x, controllerChunk.z, false),
                    Component.literal("controller setup ticket removed"));
            helper.assertTrue(level.setChunkForced(memberChunk.x, memberChunk.z, false),
                    Component.literal("member setup ticket removed"));
        }).thenWaitUntil(() -> {
            if (chunks.getChunkNow(memberChunk.x, memberChunk.z) != null) {
                throw helper.assertionException(Component.literal("awaiting member chunk unload"));
            }
            if (chunks.getChunkNow(controllerChunk.x, controllerChunk.z) == null) {
                throw helper.assertionException(Component.literal("controller chunk must stay loaded"));
            }
        }).thenExecute(() -> {
            // The border ticket retains the adjacent holder below FULL even after getChunkNow
            // stops exposing it, so drive the real registered Fabric callback deterministically.
            ServerChunkEvents.CHUNK_UNLOAD.invoker().onChunkUnload(level, loadedMemberChunk);
            LevelChunk loadedControllerChunk =
                    chunks.getChunkNow(controllerChunk.x, controllerChunk.z);
            helper.assertTrue(loadedControllerChunk != null
                            && loadedControllerChunk.getBlockEntity(core) == coil,
                    Component.literal("exact controller BE identity remains loaded"));
            helper.assertFalse(level.shouldTickBlocksAt(core),
                    Component.literal("controller chunk is loaded at non-ticking border level"));
            helper.assertValueEqual(FormationState.FAULT, coil.multiblockBehavior().state(),
                    Component.literal("CHUNK_UNLOAD faults without waiting for a BE ticker"));
            MultiblockFault fault = coil.multiblockBehavior().fault().orElseThrow();
            helper.assertValueEqual(FaultCode.UNLOADED, fault.code(),
                    Component.literal("immediate fault code is UNLOADED"));
            helper.assertValueEqual(memberChunk, new ChunkPos(fault.pos().orElseThrow()),
                    Component.literal("immediate fault names the unloaded member chunk"));
            helper.assertTrue(chunks.getChunkNow(memberChunk.x, memberChunk.z) == null,
                    Component.literal("unload callback did not force the member chunk back"));
            helper.assertValueEqual(core, index.controllerAt(memberAcrossBoundary),
                    Component.literal("FAULT(UNLOADED) retains cross-chunk claims"));
            helper.assertTrue(level.setChunkForced(memberChunk.x, memberChunk.z, true),
                    Component.literal("member chunk reloaded through its normal ticket path"));
        }).thenWaitUntil(() -> {
            if (chunks.getChunkNow(memberChunk.x, memberChunk.z) == null) {
                throw helper.assertionException(Component.literal("awaiting member chunk reload"));
            }
        }).thenExecute(() -> {
            helper.assertValueEqual(FormationState.FAULT, coil.multiblockBehavior().state(),
                    Component.literal("non-ticking controller waits safely after CHUNK_LOAD"));
            helper.assertTrue(level.setChunkForced(controllerChunk.x, controllerChunk.z, true),
                    Component.literal("controller ticker re-enabled after member reload"));
        }).thenWaitUntil(() -> {
            if (!level.shouldTickBlocksAt(core)
                    || coil.multiblockBehavior().state() != FormationState.FORMED) {
                throw helper.assertionException(Component.literal(
                        "awaiting production ticker reformation after safe reload"));
            }
        }).thenExecute(() -> {
            helper.assertValueEqual(UNROTATED, coil.multiblockBehavior().orientation().orElseThrow(),
                    Component.literal("reformed boundary orientation is unchanged"));
            helper.assertValueEqual(core, index.controllerAt(memberAcrossBoundary),
                    Component.literal("cross-chunk member claim survives reformation"));
            level.setChunkForced(controllerChunk.x, controllerChunk.z, false);
            level.setChunkForced(memberChunk.x, memberChunk.z, false);
            level.setChunkForced(anchorTicket.x, anchorTicket.z, false);
            helper.succeed();
        });
    }

    @GameTest(environment = GLOBAL_LIFECYCLE, maxTicks = 100)
    public void worldUnloadAndServerStoppedClearEveryTransientIndex(GameTestHelper helper) {
        helper.setBlock(CORE, MachineContent.DIAGNOSTIC_COIL_CORE);
        MultiblockLevelIndex first = MultiblockLevelIndex.get(helper.getLevel());
        helper.assertTrue(indexContainsLoadedHost(first, helper.absolutePos(CORE).asLong()),
                Component.literal("control: first index contains the loaded controller"));

        MultiblockLevelIndex.onWorldUnload(helper.getLevel().getServer(), helper.getLevel());
        helper.assertFalse(indexContainsLoadedHost(first, helper.absolutePos(CORE).asLong()),
                Component.literal("level unload clears the removed index object"));
        MultiblockLevelIndex second = MultiblockLevelIndex.get(helper.getLevel());
        helper.assertTrue(first != second, Component.literal("level transition creates a fresh index"));
        MultiblockLevelIndex.onBlockEntityLoad(
                helper.getLevel().getBlockEntity(helper.absolutePos(CORE)), helper.getLevel());
        helper.assertTrue(indexContainsLoadedHost(second, helper.absolutePos(CORE).asLong()),
                Component.literal("real BLOCK_ENTITY_LOAD repopulates the transitioned level"));

        MultiblockLevelIndex.onServerStopped(helper.getLevel().getServer());
        helper.assertFalse(indexContainsLoadedHost(second, helper.absolutePos(CORE).asLong()),
                Component.literal("SERVER_STOPPED clears the live index object"));
        helper.assertTrue(second != MultiblockLevelIndex.get(helper.getLevel()),
                Component.literal("next server lifecycle receives a fresh index"));
        helper.setBlock(CORE, Blocks.AIR);
        helper.succeed();
    }

    private static void buildOverlappingMembersWithoutCores(GameTestHelper helper, MultiblockPattern pattern,
            BlockPos coreA, BlockPos coreB) {
        MultiblockTestHelper.buildPattern(helper, pattern, coreA, UNROTATED);
        helper.setBlock(coreA, Blocks.AIR);
        helper.setBlock(coreB.offset(-1, 0, 0), MachineContent.DIAGNOSTIC_COIL_FRAME);
        helper.setBlock(coreB.offset(1, 0, 0), MachineContent.DIAGNOSTIC_COIL_FRAME);
        helper.setBlock(coreB.offset(-1, 0, 1), MachineContent.DIAGNOSTIC_COIL_FRAME);
        helper.setBlock(coreB.offset(0, 0, 1), Blocks.OXIDIZED_COPPER);
        helper.setBlock(coreB.offset(1, 0, 1), Blocks.WAXED_COPPER_BLOCK);
    }

    private static void assertDeterministicPersistedWinner(
            GameTestHelper helper, BlockPos coreA, BlockPos coreB, BlockPos shared) {
        BlockPos absoluteA = helper.absolutePos(coreA);
        BlockPos absoluteB = helper.absolutePos(coreB);
        BlockPos winner = Long.compare(absoluteA.asLong(), absoluteB.asLong()) < 0 ? absoluteA : absoluteB;
        BlockPos loser = winner.equals(absoluteA) ? coreB : coreA;
        helper.assertValueEqual(winner,
                MultiblockLevelIndex.get(helper.getLevel()).controllerAt(helper.absolutePos(shared)),
                Component.literal("same-grade persisted conflict uses signed BlockPos tie-break"));
        helper.assertValueEqual(FormationState.FORMED,
                MultiblockTestHelper.coilCore(helper, winner.equals(absoluteA) ? coreA : coreB)
                        .multiblockBehavior().state(),
                Component.literal("deterministic persisted winner is FORMED"));
        helper.assertValueEqual(FormationState.FAULT,
                MultiblockTestHelper.coilCore(helper, loser).multiblockBehavior().state(),
                Component.literal("deterministic persisted loser faults"));
        helper.assertValueEqual(FaultCode.CONFLICT,
                MultiblockTestHelper.coilCore(helper, loser)
                        .multiblockBehavior().fault().orElseThrow().code(),
                Component.literal("persisted loser reports conflict"));
    }

    private static CompoundTag persistedCoil(Rotation rotation, Mirror mirror, long charge) {
        return persistedCoil(rotation, mirror, charge, CuprumSchema.BLOCK_ENTITY);
    }

    private static CompoundTag persistedCoil(
            Rotation rotation, Mirror mirror, long charge, int schemaVersion) {
        CompoundTag multiblock = new CompoundTag();
        multiblock.putBoolean("formed", true);
        multiblock.putString("rotation", rotation.getSerializedName());
        multiblock.putString("mirror", mirror.getSerializedName());
        CompoundTag state = new CompoundTag();
        state.putInt(CuprumSchema.KEY, schemaVersion);
        state.putLong(AbstractChargeStorageBlockEntity.CHARGE_KEY, charge);
        state.put("multiblock", multiblock);
        CompoundTag root = new CompoundTag();
        root.put(AbstractChargeStorageBlockEntity.STATE_KEY, state);
        return root;
    }

    private static long lastSyncGameTime(DiagnosticCoilCoreBlockEntity coil) {
        try {
            Field field = ChargeMachineBlockEntity.class.getDeclaredField("lastSyncGameTime");
            field.setAccessible(true);
            return field.getLong(coil);
        } catch (ReflectiveOperationException e) {
            throw new IllegalStateException(e);
        }
    }

    private static void clearDirty(MultiblockLevelIndex index) {
        dirtyControllers(index).clear();
    }

    private static boolean isDirty(MultiblockLevelIndex index, BlockPos controller) {
        return dirtyControllers(index).contains(controller.asLong());
    }

    private static LongOpenHashSet dirtyControllers(MultiblockLevelIndex index) {
        try {
            Field field = MultiblockLevelIndex.class.getDeclaredField("dirtyControllers");
            field.setAccessible(true);
            return (LongOpenHashSet) field.get(index);
        } catch (ReflectiveOperationException e) {
            throw new IllegalStateException(e);
        }
    }

    private static boolean indexContainsLoadedHost(MultiblockLevelIndex index, long key) {
        return longObjectMap(index, "loadedControllerHosts").containsKey(key);
    }

    private static void assertIndexLacks(
            GameTestHelper helper, MultiblockLevelIndex index, BlockPos controllerRel) {
        assertIndexLacksAbsolute(helper, index, helper.absolutePos(controllerRel));
    }

    private static void assertIndexLacksAbsolute(
            GameTestHelper helper, MultiblockLevelIndex index, BlockPos controller) {
        long key = controller.asLong();
        helper.assertFalse(longObjectMap(index, "loadedControllerHosts").containsKey(key),
                Component.literal("loaded-controller host entry released"));
        helper.assertFalse(longObjectMap(index, "controllerToMembers").containsKey(key),
                Component.literal("controller member entry released"));
        helper.assertFalse(longObjectMap(index, "claimStatuses").containsKey(key),
                Component.literal("claim-status entry released"));
        helper.assertFalse(dirtyControllers(index).contains(key),
                Component.literal("dirty-controller entry released"));
        for (Object value : longObjectMap(index, "controllerChunkToControllers").values()) {
            helper.assertFalse(((LongOpenHashSet) value).contains(key),
                    Component.literal("controller-chunk reverse entry released"));
        }
    }

    @SuppressWarnings("unchecked")
    private static Long2ObjectMap<Object> longObjectMap(MultiblockLevelIndex index, String name) {
        try {
            Field field = MultiblockLevelIndex.class.getDeclaredField(name);
            field.setAccessible(true);
            return (Long2ObjectMap<Object>) field.get(index);
        } catch (ReflectiveOperationException e) {
            throw new IllegalStateException(e);
        }
    }
}
