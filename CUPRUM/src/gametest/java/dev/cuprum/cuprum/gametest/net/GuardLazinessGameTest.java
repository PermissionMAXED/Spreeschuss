package dev.cuprum.cuprum.gametest.net;

import dev.cuprum.cuprum.net.CuprumNet;
import dev.cuprum.cuprum.net.server.GuardResult;
import net.fabricmc.fabric.api.gametest.v1.GameTest;
import net.minecraft.core.BlockPos;
import net.minecraft.gametest.framework.GameTestHelper;
import net.minecraft.network.chat.Component;
import net.minecraft.world.level.GameType;
import net.minecraft.world.phys.Vec3;

/**
 * Real-server GameTests proving the redesigned dispatch pipeline's laziness ordering, using the
 * {@link GuardProbePayload} registration whose spec factory / claim resolver / state predicate
 * increment {@link GuardProbeCounters}:
 *
 * <ul>
 *   <li>a liveness-rejected arrival never constructs a spec and never charges a rate token,</li>
 *   <li>a rate-rejected arrival never constructs a spec (and tokens are charged exactly once
 *       per accepted dispatch),</li>
 *   <li>a range-rejected payload constructs its spec but never resolves the (world-derived)
 *       claim or feature state.</li>
 * </ul>
 */
public class GuardLazinessGameTest {
    @GameTest
    public void livenessRejectionSkipsSpecAndChargesNoToken(GameTestHelper helper) {
        try (MockServerPlayers.Mock mock = MockServerPlayers.connect(helper, "cuprum_lazy1")) {
            BlockPos near = helper.absolutePos(new BlockPos(1, 1, 1));
            mock.player().setPos(Vec3.atCenterOf(near));
            GuardProbeCounters.reset();

            // Spectators fail LIVENESS — the very first step, before any spec construction.
            mock.player().setGameMode(GameType.SPECTATOR);
            GuardResult rejected = CuprumNet.dispatch(
                    GuardProbePayload.TYPE, new GuardProbePayload(near, 1), mock.player());
            helper.assertValueEqual(GuardResult.DROP_LOG, rejected, Component.literal("spectator dispatch"));
            helper.assertValueEqual(0, GuardProbeCounters.SPEC_FACTORY_CALLS.get(),
                    Component.literal("spec factory calls after liveness rejection"));
            helper.assertValueEqual(0, GuardProbeCounters.HANDLER_RUNS.get(),
                    Component.literal("handler runs after liveness rejection"));

            // The rejected arrival must not have charged a token: the full burst
            // (net.burstDefault = 8) is still available within this tick.
            mock.player().setGameMode(GameType.SURVIVAL);
            for (int i = 0; i < 8; i++) {
                GuardResult result = CuprumNet.dispatch(
                        GuardProbePayload.TYPE, new GuardProbePayload(near, i), mock.player());
                helper.assertValueEqual(GuardResult.PASS, result,
                        Component.literal("post-liveness dispatch " + (i + 1) + " of burst 8"));
            }
            helper.assertValueEqual(8, GuardProbeCounters.SPEC_FACTORY_CALLS.get(),
                    Component.literal("spec factory calls for accepted dispatches"));
            helper.assertValueEqual(8, GuardProbeCounters.HANDLER_RUNS.get(),
                    Component.literal("handler runs for accepted dispatches"));
        }
        helper.succeed();
    }

    @GameTest
    public void rateRejectionSkipsSpecConstruction(GameTestHelper helper) {
        try (MockServerPlayers.Mock mock = MockServerPlayers.connect(helper, "cuprum_lazy2")) {
            BlockPos near = helper.absolutePos(new BlockPos(1, 1, 1));
            mock.player().setPos(Vec3.atCenterOf(near));
            GuardProbeCounters.reset();

            // net.burstDefault = 8: dispatches 1-8 pass (one token each, exactly once), the 9th
            // is rate-rejected at the arrival gate — before its spec is ever constructed.
            for (int i = 0; i < 9; i++) {
                GuardResult result = CuprumNet.dispatch(
                        GuardProbePayload.TYPE, new GuardProbePayload(near, i), mock.player());
                helper.assertValueEqual(i < 8 ? GuardResult.PASS : GuardResult.DROP_SILENT, result,
                        Component.literal("dispatch " + (i + 1)));
            }
            helper.assertValueEqual(8, GuardProbeCounters.SPEC_FACTORY_CALLS.get(),
                    Component.literal("spec factory calls (the rate-rejected 9th must not build a spec)"));
            helper.assertValueEqual(8, GuardProbeCounters.CLAIM_RESOLUTIONS.get(),
                    Component.literal("claim resolutions (accepted dispatches only)"));
            helper.assertValueEqual(8, GuardProbeCounters.HANDLER_RUNS.get(),
                    Component.literal("handler runs"));
        }
        helper.succeed();
    }

    @GameTest
    public void rangeRejectionSkipsClaimAndStateResolution(GameTestHelper helper) {
        try (MockServerPlayers.Mock mock = MockServerPlayers.connect(helper, "cuprum_lazy3")) {
            BlockPos near = helper.absolutePos(new BlockPos(1, 1, 1));
            mock.player().setPos(Vec3.atCenterOf(near));
            GuardProbeCounters.reset();

            // Same dimension but far beyond MAX_RANGE_DISTANCE: RANGE fails after the spec was
            // built — the lazy claim resolver and state predicate must never run.
            BlockPos far = near.offset(50, 0, 0);
            GuardResult rejected = CuprumNet.dispatch(
                    GuardProbePayload.TYPE, new GuardProbePayload(far, 1), mock.player());
            helper.assertValueEqual(GuardResult.DROP_LOG, rejected, Component.literal("far dispatch"));
            helper.assertValueEqual(1, GuardProbeCounters.SPEC_FACTORY_CALLS.get(),
                    Component.literal("spec factory calls (spec is built before RANGE)"));
            helper.assertValueEqual(0, GuardProbeCounters.CLAIM_RESOLUTIONS.get(),
                    Component.literal("claim resolutions after range rejection"));
            helper.assertValueEqual(0, GuardProbeCounters.STATE_CHECKS.get(),
                    Component.literal("state checks after range rejection"));
            helper.assertValueEqual(0, GuardProbeCounters.HANDLER_RUNS.get(),
                    Component.literal("handler runs after range rejection"));

            // Control: a near dispatch resolves claim + state exactly once and reaches the handler.
            GuardResult accepted = CuprumNet.dispatch(
                    GuardProbePayload.TYPE, new GuardProbePayload(near, 1), mock.player());
            helper.assertValueEqual(GuardResult.PASS, accepted, Component.literal("near dispatch"));
            helper.assertValueEqual(1, GuardProbeCounters.CLAIM_RESOLUTIONS.get(),
                    Component.literal("claim resolutions for the accepted dispatch"));
            helper.assertValueEqual(1, GuardProbeCounters.STATE_CHECKS.get(),
                    Component.literal("state checks for the accepted dispatch"));
            helper.assertValueEqual(1, GuardProbeCounters.HANDLER_RUNS.get(),
                    Component.literal("handler runs for the accepted dispatch"));
        }
        helper.succeed();
    }
}
