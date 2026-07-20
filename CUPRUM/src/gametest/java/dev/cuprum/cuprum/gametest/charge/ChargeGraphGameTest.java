package dev.cuprum.cuprum.gametest.charge;

import dev.cuprum.cuprum.Cuprum;
import dev.cuprum.cuprum.CuprumBlocks;
import dev.cuprum.cuprum.charge.ChargeBalance;
import dev.cuprum.cuprum.charge.ChargeGraphManager;
import dev.cuprum.cuprum.charge.NodeReport;
import dev.cuprum.cuprum.charge.blockentity.AbstractChargeStorageBlockEntity;
import dev.cuprum.cuprum.charge.diag.ChargeProbeReport;
import dev.cuprum.cuprum.gametest.harness.ChargeHarnessInit;
import dev.cuprum.cuprum.gametest.harness.HarnessCellBlockEntity;
import dev.cuprum.cuprum.gametest.harness.HarnessSinkBlockEntity;
import dev.cuprum.cuprum.gametest.harness.HarnessSourceBlockEntity;
import dev.cuprum.cuprum.state.CuprumSchema;
import java.util.Optional;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerBlockEntityEvents;
import net.fabricmc.fabric.api.gametest.v1.GameTest;
import net.minecraft.core.BlockPos;
import net.minecraft.gametest.framework.GameTestHelper;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.network.chat.Component;
import net.minecraft.util.ProblemReporter;
import net.minecraft.world.level.GameType;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.block.entity.ChestBlockEntity;
import net.minecraft.world.level.storage.TagValueInput;
import net.minecraft.world.level.storage.TagValueOutput;

/**
 * Real-server GameTests for the W1B charge graph (plan §4-W1B). Exact-tick assertions are
 * anchored to {@link ChargeGraphManager#allocatorTicks()} — the graph allocator tick counter —
 * never to fragile GameTest tick offsets: the allocator pass and the counter mutate together,
 * so any observation point sees a consistent (passes, stored) pair. Cross-graph counters
 * (vented) are asserted as synchronous same-tick deltas so parallel test structures cannot
 * interfere; all per-test flows live in networks private to the test's own structure.
 */
public class ChargeGraphGameTest {
    private static final BlockPos LEFT = new BlockPos(1, 1, 1);
    private static final BlockPos MIDDLE = new BlockPos(2, 1, 1);
    private static final BlockPos RIGHT = new BlockPos(3, 1, 1);

    /** Source (50 Cg/t, 1,000 Cg total) fills an adjacent cell: exactly 1,000 Cg after exactly
     * 20 allocator ticks, never above (and exactly on the 50/t line) during the window. */
    @GameTest(maxTicks = 200)
    public void cgSourceFillsCell(GameTestHelper helper) {
        helper.setBlock(LEFT, ChargeHarnessInit.CELL_BLOCK);
        helper.setBlock(MIDDLE, ChargeHarnessInit.SOURCE_BLOCK);
        HarnessCellBlockEntity cell = helper.getBlockEntity(LEFT, HarnessCellBlockEntity.class);
        HarnessSourceBlockEntity source = helper.getBlockEntity(MIDDLE, HarnessSourceBlockEntity.class);
        source.setOfferPerTick(50L);
        source.setRemaining(1_000L);
        ChargeGraphManager manager = ChargeGraphManager.of(helper.getLevel());
        long anchor = manager.allocatorTicks();
        helper.assertValueEqual(0L, cell.stored(), Component.literal("cell must start empty"));
        helper.onEachTick(() -> {
            long passes = manager.allocatorTicks() - anchor;
            long expected = Math.min(passes, 20L) * 50L;
            helper.assertValueEqual(expected, cell.stored(),
                    Component.literal("stored after " + passes + " allocator ticks"));
        });
        helper.succeedWhen(() -> {
            long passes = manager.allocatorTicks() - anchor;
            helper.assertTrue(passes >= 25L, Component.literal("watch several post-fill ticks"));
            helper.assertValueEqual(1_000L, cell.stored(), Component.literal("final stored"));
            helper.assertValueEqual(1_000L, source.totalDrained(), Component.literal("total drained"));
        });
    }

    /** At 50% total supply the DEFENSE consumer receives 100% of its request, MISC exactly 0. */
    @GameTest(maxTicks = 200)
    public void cgPriorityBrownout(GameTestHelper helper) {
        helper.setBlock(LEFT, ChargeHarnessInit.SINK_DEFENSE_BLOCK);
        helper.setBlock(MIDDLE, ChargeHarnessInit.SOURCE_BLOCK);
        helper.setBlock(RIGHT, ChargeHarnessInit.SINK_MISC_BLOCK);
        HarnessSinkBlockEntity defense = helper.getBlockEntity(LEFT, HarnessSinkBlockEntity.class);
        HarnessSourceBlockEntity source = helper.getBlockEntity(MIDDLE, HarnessSourceBlockEntity.class);
        HarnessSinkBlockEntity misc = helper.getBlockEntity(RIGHT, HarnessSinkBlockEntity.class);
        source.setOfferPerTick(100L);
        defense.setDemandPerTick(100L);
        misc.setDemandPerTick(100L);
        ChargeGraphManager manager = ChargeGraphManager.of(helper.getLevel());
        long anchor = manager.allocatorTicks();
        helper.onEachTick(() -> {
            long passes = manager.allocatorTicks() - anchor;
            helper.assertValueEqual(passes * 100L, defense.totalReceived(),
                    Component.literal("DEFENSE received after " + passes + " allocator ticks"));
            helper.assertValueEqual(0L, misc.totalReceived(),
                    Component.literal("MISC received after " + passes + " allocator ticks"));
        });
        helper.succeedWhen(() -> {
            long passes = manager.allocatorTicks() - anchor;
            helper.assertTrue(passes >= 10L, Component.literal("watch at least 10 brownout ticks"));
            helper.assertValueEqual(passes * 100L, defense.totalReceived(),
                    Component.literal("DEFENSE fully served"));
            helper.assertValueEqual(0L, misc.totalReceived(), Component.literal("MISC starved"));
        });
    }

    /** Breaking the middle of source–cell–cell vents its Cg exactly once, splits the network
     * into two ids, bumps topology and conserves the surviving cell. */
    @GameTest(maxTicks = 200)
    public void cgSplitOnBreak(GameTestHelper helper) {
        helper.setBlock(LEFT, ChargeHarnessInit.SOURCE_BLOCK);
        helper.setBlock(MIDDLE, ChargeHarnessInit.CELL_BLOCK);
        helper.setBlock(RIGHT, ChargeHarnessInit.CELL_BLOCK);
        HarnessSourceBlockEntity source = helper.getBlockEntity(LEFT, HarnessSourceBlockEntity.class);
        HarnessCellBlockEntity middle = helper.getBlockEntity(MIDDLE, HarnessCellBlockEntity.class);
        HarnessCellBlockEntity right = helper.getBlockEntity(RIGHT, HarnessCellBlockEntity.class);
        // Deterministic seed through the API path (owner-side insert; within per-tick budgets).
        helper.assertValueEqual(300L, middle.insert(300L, false), Component.literal("seed middle"));
        helper.assertValueEqual(500L, right.insert(500L, false), Component.literal("seed right"));
        ChargeGraphManager manager = ChargeGraphManager.of(helper.getLevel());
        NodeReport before = manager.nodeReport(helper.absolutePos(RIGHT)).orElseThrow();
        helper.assertValueEqual(before.networkId(),
                manager.nodeReport(helper.absolutePos(LEFT)).orElseThrow().networkId(),
                Component.literal("chain starts as one network"));
        long topologyBefore = before.topologyVersion();
        long ventedBefore = manager.diagnostics().ventedTotal();

        helper.destroyBlock(MIDDLE);
        helper.assertValueEqual(300L, manager.diagnostics().ventedTotal() - ventedBefore,
                Component.literal("removed cell stored charge vents exactly once"));

        helper.succeedWhen(() -> {
            helper.assertTrue(manager.nodeReport(helper.absolutePos(MIDDLE)).isEmpty(),
                    Component.literal("destroyed middle node is gone (its Cg with it)"));
            NodeReport left = manager.nodeReport(helper.absolutePos(LEFT)).orElseThrow();
            NodeReport survivor = manager.nodeReport(helper.absolutePos(RIGHT)).orElseThrow();
            helper.assertTrue(left.networkId() != -1 && survivor.networkId() != -1,
                    Component.literal("rebuild must have relabeled both survivors"));
            helper.assertTrue(left.networkId() != survivor.networkId(),
                    Component.literal("split must yield two distinct network ids"));
            helper.assertTrue(survivor.topologyVersion() > topologyBefore,
                    Component.literal("topology version must bump"));
            helper.assertValueEqual(500L, survivor.stored(),
                    Component.literal("surviving cell conserves its Cg"));
            helper.assertValueEqual(0L, source.totalDrained(),
                    Component.literal("idle source must not have produced"));
        });
    }

    /** 270,000 Cg surge into an empty 20,000-cap cell: 20,000 accepted/stored (per-tick insert
     * caps bypassed, capacity not), exactly 250,000 vented; a non-node deposit is a 0 no-op.
     * The strike amount is read through {@code ChargeBalance} and pinned to the INDEX literal. */
    @GameTest(maxTicks = 200)
    public void cgSurgeOverflow(GameTestHelper helper) {
        helper.setBlock(LEFT, ChargeHarnessInit.CELL_BLOCK);
        HarnessCellBlockEntity cell = helper.getBlockEntity(LEFT, HarnessCellBlockEntity.class);
        ChargeGraphManager manager = ChargeGraphManager.of(helper.getLevel());

        long strike = ChargeBalance.strikeDepositCg();
        helper.assertValueEqual(270_000L, strike,
                Component.literal("charge.strikeDepositCg config default is the INDEX literal"));
        long ventedBefore = manager.diagnostics().ventedTotal();
        long accepted = manager.depositSurge(helper.absolutePos(LEFT), strike);
        long ventedAfter = manager.diagnostics().ventedTotal();

        helper.assertValueEqual(20_000L, accepted, Component.literal("accepted surge"));
        helper.assertValueEqual(20_000L, cell.stored(), Component.literal("stored after surge"));
        helper.assertValueEqual(250_000L, ventedAfter - ventedBefore, Component.literal("vented surge"));

        // W1B contract: a surge at a non-node position returns 0 and mutates/vents nothing.
        long ventedBeforeMiss = manager.diagnostics().ventedTotal();
        helper.assertValueEqual(0L, manager.depositSurge(helper.absolutePos(RIGHT), 270_000L),
                Component.literal("non-node deposit accepts nothing"));
        helper.assertValueEqual(ventedBeforeMiss, manager.diagnostics().ventedTotal(),
                Component.literal("non-node deposit vents nothing"));
        helper.assertValueEqual(20_000L, cell.stored(), Component.literal("cell untouched by miss"));
        helper.succeed();
    }

    /** 12,345 Cg round-trips through the real BE Value I/O with the exact §3.1 envelope; hostile
     * over-cap values clamp; schema 0 (pre-versioned) defaults; forward versions read best-effort. */
    @GameTest(maxTicks = 200)
    public void cgPersistenceRoundtrip(GameTestHelper helper) {
        helper.setBlock(LEFT, ChargeHarnessInit.CELL_BLOCK);
        HarnessCellBlockEntity cell = helper.getBlockEntity(LEFT, HarnessCellBlockEntity.class);
        cell.insertSurge(12_345L);
        helper.assertValueEqual(12_345L, cell.stored(), Component.literal("seeded stored"));

        try (ProblemReporter.ScopedCollector reporter = new ProblemReporter.ScopedCollector(Cuprum.LOGGER)) {
            // Save through the real ValueOutput path and pin the exact §3.1 envelope.
            TagValueOutput output = TagValueOutput.createWithContext(reporter, helper.getLevel().registryAccess());
            cell.saveCustomOnly(output);
            CompoundTag saved = output.buildResult();
            CompoundTag envelope = saved.getCompoundOrEmpty(AbstractChargeStorageBlockEntity.STATE_KEY);
            helper.assertValueEqual(CuprumSchema.BLOCK_ENTITY,
                    envelope.getIntOr(CuprumSchema.KEY, -1),
                    Component.literal("cuprum_state.cuprum_schema in the saved envelope"));
            helper.assertValueEqual(12_345L,
                    envelope.getLongOr(AbstractChargeStorageBlockEntity.CHARGE_KEY, -1L),
                    Component.literal("cuprum_state.charge in the saved envelope"));

            // Load into a fresh BE through the real ValueInput path.
            HarnessCellBlockEntity reloaded = new HarnessCellBlockEntity(
                    helper.absolutePos(LEFT), cell.getBlockState());
            reloaded.loadCustomOnly(TagValueInput.create(reporter, helper.getLevel().registryAccess(), saved));
            helper.assertValueEqual(12_345L, reloaded.stored(), Component.literal("round-tripped stored"));

            // Hostile over-cap value: clamped to capacity on read.
            CompoundTag hostile = new CompoundTag();
            CompoundTag hostileState = new CompoundTag();
            hostileState.putInt(CuprumSchema.KEY, CuprumSchema.BLOCK_ENTITY);
            hostileState.putLong(AbstractChargeStorageBlockEntity.CHARGE_KEY, 999_999L);
            hostile.put(AbstractChargeStorageBlockEntity.STATE_KEY, hostileState);
            HarnessCellBlockEntity clamped = new HarnessCellBlockEntity(
                    helper.absolutePos(LEFT), cell.getBlockState());
            clamped.loadCustomOnly(TagValueInput.create(reporter, helper.getLevel().registryAccess(), hostile));
            helper.assertValueEqual(HarnessCellBlockEntity.CAPACITY_CG, clamped.stored(),
                    Component.literal("hostile over-cap value clamps to capacity"));

            // Schema 0 (no cuprum_state child at all): pre-versioned defaults, stored 0.
            HarnessCellBlockEntity preVersioned = new HarnessCellBlockEntity(
                    helper.absolutePos(LEFT), cell.getBlockState());
            preVersioned.loadCustomOnly(
                    TagValueInput.create(reporter, helper.getLevel().registryAccess(), new CompoundTag()));
            helper.assertValueEqual(0L, preVersioned.stored(),
                    Component.literal("schema 0 reads pre-versioned defaults"));

            // Forward version: WARN once per BE type + best-effort clamped read.
            CompoundTag future = new CompoundTag();
            CompoundTag futureState = new CompoundTag();
            futureState.putInt(CuprumSchema.KEY, CuprumSchema.BLOCK_ENTITY + 99);
            futureState.putLong(AbstractChargeStorageBlockEntity.CHARGE_KEY, 777L);
            future.put(AbstractChargeStorageBlockEntity.STATE_KEY, futureState);
            HarnessCellBlockEntity forward = new HarnessCellBlockEntity(
                    helper.absolutePos(LEFT), cell.getBlockState());
            forward.loadCustomOnly(
                    TagValueInput.create(reporter, helper.getLevel().registryAccess(), future));
            helper.assertValueEqual(777L, forward.stored(),
                    Component.literal("forward version reads best-effort"));
            // A second forward-version load remains a safe best-effort read; production's
            // warn-once latch intentionally has no public test reset.
            HarnessCellBlockEntity forwardAgain = new HarnessCellBlockEntity(
                    helper.absolutePos(LEFT), cell.getBlockState());
            forwardAgain.loadCustomOnly(
                    TagValueInput.create(reporter, helper.getLevel().registryAccess(), future));
            helper.assertValueEqual(777L, forwardAgain.stored(),
                    Component.literal("second forward read stays best-effort"));
        }
        helper.succeed();
    }

    /** The Charge Probe reports an adjacent charged cell (storage + network id) and using it
     * does not throw; the report line comes from the pinned {@code ChargeProbeReport.format}. */
    @GameTest(maxTicks = 200)
    public void cgProbeReportsNode(GameTestHelper helper) {
        helper.setBlock(LEFT, ChargeHarnessInit.CELL_BLOCK);
        HarnessCellBlockEntity cell = helper.getBlockEntity(LEFT, HarnessCellBlockEntity.class);
        helper.assertValueEqual(750L, cell.insert(750L, false), Component.literal("seed cell"));
        helper.setBlock(MIDDLE, CuprumBlocks.CHARGE_PROBE);

        // The actual probe use path (six-neighbor report append) must not throw.
        helper.useBlock(MIDDLE, helper.makeMockPlayer(GameType.SURVIVAL));

        ChargeGraphManager manager = ChargeGraphManager.of(helper.getLevel());
        Optional<NodeReport> report = manager.nodeReport(helper.absolutePos(LEFT));
        helper.assertTrue(report.isPresent(), Component.literal("adjacent node must report"));
        String line = ChargeProbeReport.format(report.get());
        helper.assertTrue(line.contains("stored=750/20000 Cg"),
                Component.literal("report line carries storage: " + line));
        helper.assertTrue(line.contains(" net=" + report.get().networkId())
                        && report.get().networkId() != -1,
                Component.literal("report line carries a live network id: " + line));
        helper.assertTrue(line.contains("frozen=false"),
                Component.literal("loaded node reports frozen=false: " + line));
        helper.succeed();
    }

    /** Removal followed by (stale) unload events can neither resurrect nor freeze the removed
     * node — and a replacement node at the same position is immune to the old BE's unload. */
    @GameTest(maxTicks = 200)
    public void cgRemovalVsUnloadOrdering(GameTestHelper helper) {
        helper.setBlock(LEFT, ChargeHarnessInit.CELL_BLOCK);
        HarnessCellBlockEntity original = helper.getBlockEntity(LEFT, HarnessCellBlockEntity.class);
        ChargeGraphManager manager = ChargeGraphManager.of(helper.getLevel());
        helper.assertTrue(manager.nodeReport(helper.absolutePos(LEFT)).isPresent(),
                Component.literal("node registered on placement"));

        // Real removal: preRemoveSideEffects -> notifyNodeRemoved, then the natural unload
        // event for the removed BE fires inside removeBlockEntity — already a no-op.
        helper.destroyBlock(LEFT);
        helper.assertTrue(manager.nodeReport(helper.absolutePos(LEFT)).isEmpty(),
                Component.literal("node gone after removal"));

        // An extra stale unload of the removed BE must stay a no-op (no resurrect, no freeze).
        ServerBlockEntityEvents.BLOCK_ENTITY_UNLOAD.invoker().onUnload(original, helper.getLevel());
        helper.assertTrue(manager.nodeReport(helper.absolutePos(LEFT)).isEmpty(),
                Component.literal("stale unload cannot resurrect a removed node"));

        // A replacement node at the same position must not be frozen by the OLD BE's unload.
        helper.setBlock(LEFT, ChargeHarnessInit.CELL_BLOCK);
        HarnessCellBlockEntity replacement = helper.getBlockEntity(LEFT, HarnessCellBlockEntity.class);
        helper.assertTrue(replacement != original, Component.literal("fresh BE instance"));
        helper.assertValueEqual(111L, replacement.insert(111L, false), Component.literal("seed replacement"));
        ServerBlockEntityEvents.BLOCK_ENTITY_UNLOAD.invoker().onUnload(original, helper.getLevel());
        NodeReport report = manager.nodeReport(helper.absolutePos(LEFT)).orElseThrow();
        helper.assertTrue(!report.frozen(),
                Component.literal("stale unload of the old BE must not freeze the replacement"));
        helper.assertValueEqual(111L, report.stored(), Component.literal("replacement keeps its Cg"));

        // Eval-A F8: a stale unload of a NON-charge BE at the same position (e.g. a leftover
        // chest BE from a previous occupant) must also be a no-op — the manager tracks the
        // source BlockEntity identity per node, not just charge-node object equality. The
        // event goes through the REAL registered listener via the invoker (production path).
        ChestBlockEntity staleForeign = new ChestBlockEntity(
                helper.absolutePos(LEFT), Blocks.CHEST.defaultBlockState());
        ServerBlockEntityEvents.BLOCK_ENTITY_UNLOAD.invoker().onUnload(staleForeign, helper.getLevel());
        NodeReport afterForeign = manager.nodeReport(helper.absolutePos(LEFT)).orElseThrow();
        helper.assertTrue(!afterForeign.frozen(),
                Component.literal("stale NON-charge BE unload must not freeze the live node"));
        helper.assertValueEqual(111L, afterForeign.stored(),
                Component.literal("live node still active and reported after foreign unload"));
        helper.assertTrue(afterForeign.networkId() != -1,
                Component.literal("live node still holds a network id after foreign unload"));
        helper.succeed();
    }

    /** Eval-A F5 proof: the manager's lookup path never loads chunks. {@code notifyNodeAdded}
     * on a far-away unloaded position is a guaranteed no-op — the chunk stays unloaded (the
     * unguarded 3-arg {@code BlockApiLookup.find} would have loaded/generated it via
     * {@code Level.getBlockState/getBlockEntity}) and no node registers. */
    @GameTest(maxTicks = 200)
    public void cgLookupNeverLoadsChunks(GameTestHelper helper) {
        ChargeGraphManager manager = ChargeGraphManager.of(helper.getLevel());
        BlockPos far = helper.absolutePos(LEFT).offset(100_000, 0, 100_000);
        helper.assertTrue(!helper.getLevel().isLoaded(far),
                Component.literal("probe position must start unloaded"));
        manager.notifyNodeAdded(far);
        helper.assertTrue(!helper.getLevel().isLoaded(far),
                Component.literal("notifyNodeAdded must not load (or generate) the chunk"));
        helper.assertTrue(manager.nodeReport(far).isEmpty(),
                Component.literal("no node may register at an unloaded position"));
        // The read-side diagnostics contract stays chunk-load-free too.
        helper.assertTrue(!helper.getLevel().isLoaded(far),
                Component.literal("nodeReport must not load the chunk either"));
        helper.succeed();
    }
}
