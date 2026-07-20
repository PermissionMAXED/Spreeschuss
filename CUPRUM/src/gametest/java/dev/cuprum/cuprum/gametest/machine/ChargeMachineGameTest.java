package dev.cuprum.cuprum.gametest.machine;

import dev.cuprum.cuprum.CuprumBlocks;
import dev.cuprum.cuprum.block.DiagnosticCoilCoreBlockEntity;
import dev.cuprum.cuprum.charge.ChargeGraphManager;
import dev.cuprum.cuprum.charge.NodeReport;
import dev.cuprum.cuprum.charge.diag.ChargeProbeReport;
import dev.cuprum.cuprum.gametest.multiblock.MultiblockTestHelper;
import dev.cuprum.cuprum.gametest.net.MockServerPlayers;
import dev.cuprum.cuprum.machine.ChargeMachineBlockEntity;
import dev.cuprum.cuprum.machine.ChargeMachineMenu;
import dev.cuprum.cuprum.machine.ChargeMachineOpenData;
import dev.cuprum.cuprum.machine.MachineContent;
import dev.cuprum.cuprum.machine.ShortSplit;
import dev.cuprum.cuprum.multiblock.FormationState;
import dev.cuprum.cuprum.multiblock.MultiblockOrientation;
import dev.cuprum.cuprum.multiblock.MultiblockPattern;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
import net.fabricmc.fabric.api.gametest.v1.GameTest;
import net.minecraft.core.BlockPos;
import net.minecraft.gametest.framework.GameTestHelper;
import net.minecraft.network.chat.Component;
import net.minecraft.network.protocol.game.ClientboundContainerSetDataPacket;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.inventory.ContainerData;
import net.minecraft.world.level.GameType;
import net.minecraft.world.level.block.Mirror;
import net.minecraft.world.level.block.Rotation;
import net.minecraft.world.level.block.state.BlockState;
import org.jetbrains.annotations.Nullable;

/**
 * Real-server GameTests for the W1C charge-machine layer (plan §4-W1C): the exact
 * {@value DiagnosticCoilCoreBlockEntity#CHARGE_PER_TICK_CG} Cg/t self-charge line while
 * FORMED, the {@value DiagnosticCoilCoreBlockEntity#CAPACITY_CG} Cg capacity clamp, the
 * halt-on-fault freeze, the {@code ContainerData} lane encoding (state/dispatch vocabulary
 * only — no GUI assertions here) and the D7 cross-module proof that the coil core is a
 * probe-visible {@code ChargeApi.NODE} storage.
 */
public class ChargeMachineGameTest {
    private static final BlockPos CORE = new BlockPos(2, 1, 2);
    private static final MultiblockOrientation UNROTATED =
            new MultiblockOrientation(Rotation.NONE, Mirror.NONE);

    private static void buildCoil(GameTestHelper helper) {
        MultiblockPattern pattern = MultiblockTestHelper.requirePattern(helper,
                DiagnosticCoilCoreBlockEntity.PATTERN_ID);
        MultiblockTestHelper.buildPattern(helper, pattern, CORE, UNROTATED);
    }

    /** While FORMED the coil self-charges at EXACTLY 5 Cg/t between two game-time reads. */
    @GameTest(maxTicks = 100)
    public void chargeMachineChargesWhileFormed(GameTestHelper helper) {
        buildCoil(helper);
        MultiblockTestHelper.awaitFormation(helper, CORE, FormationState.FORMED, () -> {
            DiagnosticCoilCoreBlockEntity coil = MultiblockTestHelper.coilCore(helper, CORE);
            long anchorStored = coil.chargeBuffer().stored();
            long anchorTime = helper.getLevel().getGameTime();
            helper.startSequence().thenIdle(10).thenExecute(() -> {
                long ticks = helper.getLevel().getGameTime() - anchorTime;
                helper.assertTrue(ticks >= 10, Component.literal("charging window must span ≥10 ticks"));
                helper.assertValueEqual(
                        anchorStored + ticks * DiagnosticCoilCoreBlockEntity.CHARGE_PER_TICK_CG,
                        coil.chargeBuffer().stored(),
                        Component.literal("exactly 5 Cg/t over " + ticks + " ticks"));
                helper.succeed();
            });
        });
    }

    /** The self-charge clamps at the 1,000 Cg capacity and never exceeds it. */
    @GameTest(maxTicks = 100)
    public void chargeMachineStopsAtCapacity(GameTestHelper helper) {
        buildCoil(helper);
        MultiblockTestHelper.awaitFormation(helper, CORE, FormationState.FORMED, () -> {
            DiagnosticCoilCoreBlockEntity coil = MultiblockTestHelper.coilCore(helper, CORE);
            coil.chargeBuffer().depositSurge(DiagnosticCoilCoreBlockEntity.CAPACITY_CG);
            helper.assertValueEqual(DiagnosticCoilCoreBlockEntity.CAPACITY_CG,
                    coil.chargeBuffer().stored(), Component.literal("surge fill clamps at capacity"));
            helper.onEachTick(() -> helper.assertValueEqual(DiagnosticCoilCoreBlockEntity.CAPACITY_CG,
                    coil.chargeBuffer().stored(),
                    Component.literal("stored must stay pinned at capacity while FORMED")));
            helper.startSequence().thenIdle(10).thenExecute(helper::succeed);
        });
    }

    /** A member break freezes the self-charge: stored does not move while in FAULT. */
    @GameTest(maxTicks = 100)
    public void chargeMachineHaltsOnFault(GameTestHelper helper) {
        MultiblockPattern pattern = MultiblockTestHelper.requirePattern(helper,
                DiagnosticCoilCoreBlockEntity.PATTERN_ID);
        MultiblockTestHelper.buildPattern(helper, pattern, CORE, UNROTATED);
        BlockPos frameRel = MultiblockTestHelper.memberRel(pattern, CORE, UNROTATED, 2, 0, 2);
        MultiblockTestHelper.awaitFormation(helper, CORE, FormationState.FORMED, () -> {
            helper.destroyBlock(frameRel);
            MultiblockTestHelper.awaitFormation(helper, CORE, FormationState.FAULT, () -> {
                DiagnosticCoilCoreBlockEntity coil = MultiblockTestHelper.coilCore(helper, CORE);
                long frozenStored = coil.chargeBuffer().stored();
                helper.startSequence().thenIdle(10).thenExecute(() -> {
                    helper.assertValueEqual(frozenStored, coil.chargeBuffer().stored(),
                            Component.literal("stored Cg frozen while FAULT"));
                    helper.assertValueEqual(FormationState.FAULT, coil.multiblockBehavior().state(),
                            Component.literal("coil still FAULT at the second read"));
                    helper.succeed();
                });
            });
        });
    }

    /** The server menu lanes recombine to the live buffer value and the status slot carries
     * the formation ordinal (state/dispatch vocabulary only, per parity rules). */
    @GameTest(maxTicks = 100)
    public void chargeMachineMenuLanesEncodeCharge(GameTestHelper helper) {
        helper.setBlock(CORE, MachineContent.DIAGNOSTIC_COIL_CORE);
        DiagnosticCoilCoreBlockEntity coil = MultiblockTestHelper.coilCore(helper, CORE);
        ContainerData data = coil.createMenuData();
        helper.assertValueEqual(ChargeMachineBlockEntity.DATA_SLOT_COUNT, data.getCount(),
                Component.literal("menu data slot count"));
        helper.assertValueEqual(FormationState.UNFORMED.ordinal(),
                data.get(ChargeMachineBlockEntity.SLOT_STATUS),
                Component.literal("bare core status slot is UNFORMED"));
        helper.assertValueEqual(777L, coil.chargeBuffer().depositSurge(777L),
                Component.literal("seed the buffer"));
        helper.assertValueEqual(777L, ShortSplit.combine(
                        data.get(ChargeMachineBlockEntity.SLOT_CHARGE_LANE0),
                        data.get(ChargeMachineBlockEntity.SLOT_CHARGE_LANE1),
                        data.get(ChargeMachineBlockEntity.SLOT_CHARGE_LANE2), 0),
                Component.literal("lanes recombine to the live buffer value"));

        // Complete the ring: the status slot must follow the controller into FORMED.
        buildCoil(helper);
        MultiblockTestHelper.awaitFormation(helper, CORE, FormationState.FORMED, () -> {
            helper.assertValueEqual(FormationState.FORMED.ordinal(),
                    data.get(ChargeMachineBlockEntity.SLOT_STATUS),
                    Component.literal("status slot follows the controller into FORMED"));
            helper.assertValueEqual(coil.chargeBuffer().stored(), ShortSplit.combine(
                            data.get(ChargeMachineBlockEntity.SLOT_CHARGE_LANE0),
                            data.get(ChargeMachineBlockEntity.SLOT_CHARGE_LANE1),
                            data.get(ChargeMachineBlockEntity.SLOT_CHARGE_LANE2), 0),
                    Component.literal("lanes track the buffer while charging"));
            helper.succeed();
        });
    }

    /** D7 cross-module proof: the coil core is a {@code ChargeApi.NODE} storage — the graph
     * reports it and the W1B Charge Probe use path sees it without throwing. */
    @GameTest(maxTicks = 100)
    public void coilCoreReportsAsChargeNode(GameTestHelper helper) {
        helper.setBlock(CORE, MachineContent.DIAGNOSTIC_COIL_CORE);
        DiagnosticCoilCoreBlockEntity coil = MultiblockTestHelper.coilCore(helper, CORE);
        helper.assertValueEqual(250L, coil.insertSurge(250L), Component.literal("seed the coil"));

        BlockPos probeRel = CORE.offset(1, 0, 0);
        helper.setBlock(probeRel, CuprumBlocks.CHARGE_PROBE);
        helper.useBlock(probeRel, helper.makeMockPlayer(GameType.SURVIVAL));

        Optional<NodeReport> report = ChargeGraphManager.of(helper.getLevel())
                .nodeReport(helper.absolutePos(CORE));
        helper.assertTrue(report.isPresent(),
                Component.literal("coil core must register as a charge node (D7)"));
        helper.assertValueEqual(250L, report.get().stored(), Component.literal("reported stored Cg"));
        String line = ChargeProbeReport.format(report.get());
        helper.assertTrue(line.contains("stored=250/1000 Cg"),
                Component.literal("probe report carries the coil storage: " + line));
        helper.succeed();
    }

    /** A player joining after formation receives exact initial data; server validity enforces
     * the vanilla block-distance rule. */
    @GameTest(maxTicks = 100)
    public void realServerMenuLateJoinCarriesChargeCapacityAndFormedState(GameTestHelper helper) {
        buildCoil(helper);
        MultiblockTestHelper.awaitFormation(helper, CORE, FormationState.FORMED, () -> {
            DiagnosticCoilCoreBlockEntity coil = MultiblockTestHelper.coilCore(helper, CORE);
            coil.chargeBuffer().depositSurge(321L);
            try (MockServerPlayers.Mock mock = MockServerPlayers.connect(helper, "cuprum_machine")) {
                ServerPlayer player = mock.player();
                player.setPos(net.minecraft.world.phys.Vec3.atCenterOf(helper.absolutePos(CORE)));
                helper.assertTrue(player.openMenu(coil).isPresent(),
                        Component.literal("real ExtendedScreenHandlerFactory menu opened"));
                helper.assertTrue(player.containerMenu instanceof ChargeMachineMenu,
                        Component.literal("server installed ChargeMachineMenu"));
                ChargeMachineMenu menu = (ChargeMachineMenu) player.containerMenu;
                menu.broadcastChanges();
                mock.connection().flushChannel();

                Map<Integer, Integer> initialData = new HashMap<>();
                for (Object outbound : mock.channel().outboundMessages()) {
                    if (outbound instanceof ClientboundContainerSetDataPacket packet
                            && packet.getContainerId() == menu.containerId) {
                        initialData.put(packet.getId(), packet.getValue());
                    }
                }
                helper.assertValueEqual(ChargeMachineBlockEntity.DATA_SLOT_COUNT, initialData.size(),
                        Component.literal("late-open sent every initial menu data slot"));
                helper.assertValueEqual(coil.chargeBuffer().stored(), ShortSplit.combineThree(
                                initialData.get(ChargeMachineBlockEntity.SLOT_CHARGE_LANE0),
                                initialData.get(ChargeMachineBlockEntity.SLOT_CHARGE_LANE1),
                                initialData.get(ChargeMachineBlockEntity.SLOT_CHARGE_LANE2)),
                        Component.literal("late-open packet lanes carry exact current charge"));
                helper.assertValueEqual(FormationState.FORMED.ordinal(),
                        initialData.get(ChargeMachineBlockEntity.SLOT_STATUS),
                        Component.literal("late-open packet status is FORMED"));
                helper.assertValueEqual(DiagnosticCoilCoreBlockEntity.CAPACITY_CG, menu.capacityCg(),
                        Component.literal("real server menu carries exact capacity"));
                helper.assertTrue(menu.stillValid(player), Component.literal("nearby real player keeps menu valid"));
                player.setPos(player.position().add(50.0, 0.0, 0.0));
                helper.assertFalse(menu.stillValid(player),
                        Component.literal("same-dimension player outside vanilla range invalidates menu"));
            }
            helper.succeed();
        });
    }

    /** The server menu path round-trips the exact 48-bit ceiling and rejects every overflow
     * source (machine capacity and open data) before any packet lane can truncate it. */
    @GameTest(maxTicks = 100)
    public void realServerMenuExactFortyEightBitBoundaryAndOverflowFailFast(GameTestHelper helper) {
        helper.setBlock(CORE, MachineContent.DIAGNOSTIC_COIL_CORE);
        MaxCapacityMachine machine = new MaxCapacityMachine(
                helper.absolutePos(CORE),
                helper.getLevel().getBlockState(helper.absolutePos(CORE)),
                ChargeMachineBlockEntity.MAX_SYNCABLE_CG);
        machine.setLevel(helper.getLevel());
        helper.assertValueEqual(ChargeMachineBlockEntity.MAX_SYNCABLE_CG,
                machine.chargeBuffer().depositSurge(ChargeMachineBlockEntity.MAX_SYNCABLE_CG),
                Component.literal("seed exact wire ceiling"));

        try (MockServerPlayers.Mock mock = MockServerPlayers.connect(helper, "cuprum_48bit")) {
            mock.player().setPos(net.minecraft.world.phys.Vec3.atCenterOf(helper.absolutePos(CORE)));
            ChargeMachineMenu menu = new ChargeMachineMenu(91, mock.player().getInventory(), machine);
            helper.assertValueEqual(ChargeMachineBlockEntity.MAX_SYNCABLE_CG, menu.chargeCg(),
                    Component.literal("actual server ContainerData round-trips all 48 bits"));
            helper.assertValueEqual(ChargeMachineBlockEntity.MAX_SYNCABLE_CG, menu.capacityCg(),
                    Component.literal("actual server menu retains max capacity"));
        }

        assertIllegalArgument(helper,
                () -> new MaxCapacityMachine(helper.absolutePos(CORE),
                        helper.getLevel().getBlockState(helper.absolutePos(CORE)),
                        ChargeMachineBlockEntity.MAX_SYNCABLE_CG + 1L),
                "machine capacity overflow");
        assertIllegalArgument(helper,
                () -> new ChargeMachineOpenData(
                        helper.absolutePos(CORE), ChargeMachineBlockEntity.MAX_SYNCABLE_CG + 1L),
                "open-data capacity overflow");
        helper.succeed();
    }

    private static void assertIllegalArgument(GameTestHelper helper, Runnable operation, String label) {
        try {
            operation.run();
            throw helper.assertionException(Component.literal(label + " unexpectedly succeeded"));
        } catch (IllegalArgumentException expected) {
            helper.assertTrue(expected.getMessage().contains(Long.toString(
                            ChargeMachineBlockEntity.MAX_SYNCABLE_CG)),
                    Component.literal(label + " reports the exact ceiling"));
        }
    }

    private static final class MaxCapacityMachine extends ChargeMachineBlockEntity {
        private MaxCapacityMachine(BlockPos pos, BlockState state, long capacity) {
            super(MachineContent.DIAGNOSTIC_COIL_CORE_BLOCK_ENTITY, pos, state, capacity, 0L, 0L);
        }

        @Override
        public boolean canConnect(@Nullable net.minecraft.core.Direction side) {
            return false;
        }
    }
}
