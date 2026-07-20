package dev.cuprum.cuprum.gametest.charge;

import dev.cuprum.cuprum.charge.ChargeGraphManager;
import dev.cuprum.cuprum.charge.NodeReport;
import dev.cuprum.cuprum.charge.persist.ChargeGraphSavedData;
import dev.cuprum.cuprum.gametest.harness.ChargeHarnessInit;
import dev.cuprum.cuprum.gametest.harness.HarnessCellBlockEntity;
import dev.cuprum.cuprum.gametest.harness.HarnessSinkBlockEntity;
import dev.cuprum.cuprum.gametest.harness.HarnessSourceBlockEntity;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerBlockEntityEvents;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerChunkEvents;
import net.fabricmc.fabric.api.gametest.v1.GameTest;
import net.minecraft.core.BlockPos;
import net.minecraft.gametest.framework.GameTestHelper;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.FullChunkStatus;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.chunk.LevelChunk;

/**
 * Production-listener lifecycle regressions: removal vents once, unload only freezes/shadows,
 * stale callbacks no-op, and chunk event order cannot create phantom transfer.
 */
public class ChargeLifecycleGameTest {
    private static final BlockPos LOW = new BlockPos(1, 1, 1);
    private static final BlockPos MIDDLE = new BlockPos(1, 2, 1);
    private static final BlockPos HIGH = new BlockPos(1, 3, 1);

    @GameTest(maxTicks = 100)
    public void cgRemovalThenUnloadVentsExactlyOnceAndIgnoresStaleCallbacks(GameTestHelper helper) {
        helper.setBlock(LOW, ChargeHarnessInit.CELL_BLOCK);
        HarnessCellBlockEntity original = helper.getBlockEntity(LOW, HarnessCellBlockEntity.class);
        helper.assertValueEqual(300L, original.insert(300L, false), Component.literal("seed original"));
        ChargeGraphManager manager = ChargeGraphManager.of(helper.getLevel());
        long ventedBefore = manager.diagnostics().ventedTotal();
        Block oldBlock = original.getBlockState().getBlock();

        helper.destroyBlock(LOW);
        helper.assertValueEqual(300L, manager.diagnostics().ventedTotal() - ventedBefore,
                Component.literal("removal vents stored charge once"));
        ServerBlockEntityEvents.BLOCK_ENTITY_UNLOAD.invoker().onUnload(original, helper.getLevel());
        helper.assertValueEqual(300L, manager.diagnostics().ventedTotal() - ventedBefore,
                Component.literal("post-removal unload cannot vent twice"));

        helper.setBlock(LOW, ChargeHarnessInit.CELL_BLOCK);
        HarnessCellBlockEntity replacement = helper.getBlockEntity(LOW, HarnessCellBlockEntity.class);
        helper.assertValueEqual(111L, replacement.insert(111L, false), Component.literal("seed replacement"));
        manager.notifyNodeRemoved(original);
        ServerBlockEntityEvents.BLOCK_ENTITY_UNLOAD.invoker().onUnload(original, helper.getLevel());
        NodeReport live = manager.nodeReport(helper.absolutePos(LOW)).orElseThrow();
        helper.assertTrue(live.stored() == 111L && !live.frozen(),
                Component.literal("stale old callbacks preserve the replacement"));
        helper.assertTrue(replacement.getBlockState().is(oldBlock),
                Component.literal("replacement remains the harness cell"));
        helper.succeed();
    }

    @GameTest(maxTicks = 100)
    public void cgUnloadThenRemovalVentsFrozenShadowOnceAndPersists(GameTestHelper helper) {
        helper.setBlock(LOW, ChargeHarnessInit.CELL_BLOCK);
        HarnessCellBlockEntity cell = helper.getBlockEntity(LOW, HarnessCellBlockEntity.class);
        helper.assertValueEqual(500L, cell.insert(500L, false), Component.literal("seed cell"));
        ChargeGraphManager manager = ChargeGraphManager.of(helper.getLevel());
        ChargeGraphSavedData saved = helper.getLevel().getDataStorage()
                .computeIfAbsent(ChargeGraphSavedData.TYPE);
        long ventedBefore = manager.diagnostics().ventedTotal();

        ServerBlockEntityEvents.BLOCK_ENTITY_UNLOAD.invoker().onUnload(cell, helper.getLevel());
        NodeReport frozen = manager.nodeReport(helper.absolutePos(LOW)).orElseThrow();
        helper.assertTrue(frozen.frozen(), Component.literal("BE unload freezes"));
        helper.assertValueEqual(500L, frozen.stored(), Component.literal("BE unload captures shadow"));
        helper.assertValueEqual(ventedBefore, manager.diagnostics().ventedTotal(),
                Component.literal("BE unload never vents"));

        helper.destroyBlock(LOW);
        ServerBlockEntityEvents.BLOCK_ENTITY_UNLOAD.invoker().onUnload(cell, helper.getLevel());
        long expectedTotal = ventedBefore + 500L;
        helper.assertValueEqual(expectedTotal, manager.diagnostics().ventedTotal(),
                Component.literal("later removal vents frozen shadow exactly once"));

        helper.succeedWhen(() -> {
            helper.assertValueEqual(manager.diagnostics().ventedTotal(), saved.ventedTotal(),
                    Component.literal("removal vent total persisted by END_WORLD_TICK"));
            helper.assertTrue(saved.nodes().stream()
                            .noneMatch(record -> record.posKey() == helper.absolutePos(LOW).asLong()),
                    Component.literal("removed node absent from persisted snapshot"));
            helper.assertTrue(saved.ventedTotal() >= expectedTotal,
                    Component.literal("persisted total includes the exact removal delta"));
        });
    }

    @GameTest(maxTicks = 100)
    public void cgChunkListenersFreezeReactivateAndPreventPhantomTransfer(GameTestHelper helper) {
        helper.setBlock(LOW, ChargeHarnessInit.SOURCE_BLOCK);
        helper.setBlock(MIDDLE, ChargeHarnessInit.CELL_BLOCK);
        helper.setBlock(HIGH, ChargeHarnessInit.SINK_MISC_BLOCK);
        HarnessSourceBlockEntity source = helper.getBlockEntity(LOW, HarnessSourceBlockEntity.class);
        HarnessCellBlockEntity cell = helper.getBlockEntity(MIDDLE, HarnessCellBlockEntity.class);
        HarnessSinkBlockEntity sink = helper.getBlockEntity(HIGH, HarnessSinkBlockEntity.class);
        source.setOfferPerTick(100L);
        source.setRemaining(1_000L);
        sink.setDemandPerTick(100L);
        helper.assertValueEqual(750L, cell.insert(750L, false), Component.literal("seed shadow"));

        ChargeGraphManager manager = ChargeGraphManager.of(helper.getLevel());
        long ventedBefore = manager.diagnostics().ventedTotal();
        LevelChunk chunk = helper.getLevel().getChunkAt(helper.absolutePos(MIDDLE));
        ServerChunkEvents.CHUNK_UNLOAD.invoker().onChunkUnload(helper.getLevel(), chunk);
        ServerBlockEntityEvents.BLOCK_ENTITY_UNLOAD.invoker().onUnload(cell, helper.getLevel());
        ServerBlockEntityEvents.BLOCK_ENTITY_UNLOAD.invoker().onUnload(source, helper.getLevel());
        ServerBlockEntityEvents.BLOCK_ENTITY_UNLOAD.invoker().onUnload(sink, helper.getLevel());

        NodeReport frozen = manager.nodeReport(helper.absolutePos(MIDDLE)).orElseThrow();
        helper.assertTrue(frozen.frozen(), Component.literal("chunk unload freezes cell"));
        helper.assertValueEqual(750L, frozen.stored(), Component.literal("chunk unload captures shadow"));
        helper.assertValueEqual(ventedBefore, manager.diagnostics().ventedTotal(),
                Component.literal("chunk/BE unload ordering never vents"));

        helper.runAfterDelay(2, () -> {
            helper.assertValueEqual(0L, source.totalDrained(),
                    Component.literal("frozen source cannot transfer"));
            helper.assertValueEqual(0L, sink.totalReceived(),
                    Component.literal("frozen sink receives no phantom charge"));
            helper.assertValueEqual(750L, cell.stored(),
                    Component.literal("frozen storage object is unchanged"));

            ServerChunkEvents.CHUNK_LEVEL_TYPE_CHANGE.invoker().onChunkLevelTypeChange(
                    helper.getLevel(), chunk, FullChunkStatus.FULL, FullChunkStatus.ENTITY_TICKING);
            ServerChunkEvents.CHUNK_LOAD.invoker().onChunkLoad(helper.getLevel(), chunk);
            helper.assertTrue(manager.nodeReport(helper.absolutePos(MIDDLE)).orElseThrow().frozen(),
                    Component.literal("chunk events alone cannot reactivate an absent BE"));

            ServerBlockEntityEvents.BLOCK_ENTITY_LOAD.invoker().onLoad(source, helper.getLevel());
            ServerBlockEntityEvents.BLOCK_ENTITY_LOAD.invoker().onLoad(cell, helper.getLevel());
            ServerBlockEntityEvents.BLOCK_ENTITY_LOAD.invoker().onLoad(sink, helper.getLevel());
            ServerChunkEvents.CHUNK_LEVEL_TYPE_CHANGE.invoker().onChunkLevelTypeChange(
                    helper.getLevel(), chunk, FullChunkStatus.FULL, FullChunkStatus.ENTITY_TICKING);
            helper.assertTrue(!manager.nodeReport(helper.absolutePos(MIDDLE)).orElseThrow().frozen(),
                    Component.literal("BE load plus level-type refresh reactivates"));

            helper.runAfterDelay(2, () -> {
                helper.assertTrue(source.totalDrained() > 0L,
                        Component.literal("reactivated source resumes transfer"));
                helper.assertTrue(sink.totalReceived() > 0L,
                        Component.literal("reactivated sink receives real transfer"));
                helper.assertValueEqual(source.totalDrained(), sink.totalReceived(),
                        Component.literal("reactivated island conserves every drained Cg"));
                helper.assertValueEqual(750L, cell.stored(),
                        Component.literal("direct source-to-sink transfer does not alter shadowed cell"));
                helper.succeed();
            });
        });
    }
}
