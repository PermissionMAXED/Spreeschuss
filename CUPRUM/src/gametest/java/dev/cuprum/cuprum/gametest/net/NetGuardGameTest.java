package dev.cuprum.cuprum.gametest.net;

import dev.cuprum.cuprum.CuprumCatalog;
import dev.cuprum.cuprum.net.CuprumNet;
import dev.cuprum.cuprum.net.payload.DiagEchoPayload;
import dev.cuprum.cuprum.net.payload.DiagEchoReplyPayload;
import dev.cuprum.cuprum.net.server.C2SGuard;
import dev.cuprum.cuprum.net.server.GuardResult;
import dev.cuprum.cuprum.net.server.GuardSpec;
import dev.cuprum.cuprum.net.server.NetRateLimiter;
import dev.cuprum.cuprum.net.server.NetViolations;
import java.util.ArrayList;
import java.util.List;
import net.fabricmc.fabric.api.gametest.v1.GameTest;
import net.minecraft.core.BlockPos;
import net.minecraft.gametest.framework.GameTestHelper;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.inventory.InventoryMenu;
import net.minecraft.world.phys.Vec3;

/**
 * Real-server GameTests (plan §4-W1A) for the mandatory C2S guard pipeline, driven through
 * {@code CuprumNet.dispatch} — the same choke point the Fabric receiver uses, so nothing here
 * bypasses the guard. Each test connects its own mock player (deterministic name-derived UUID,
 * unique per test) and tears it down via the real disconnect path.
 */
public class NetGuardGameTest {
    /** A payload id for synthetic {@link C2SGuard} checks that never hits a real registration. */
    private static final ResourceLocation SYNTHETIC_ID =
            ResourceLocation.fromNamespaceAndPath("cuprum", "gametest/synthetic");

    /** Raw length 40 (passes the codec bound) but 80 after NFC — a semantic VALUE violation. */
    private static final String NFC_GROWING_NOTE = "\u0958".repeat(40);

    @GameTest
    public void diagEchoHappyPathRepliesWithCatalogSha(GameTestHelper helper) {
        try (MockServerPlayers.Mock mock = MockServerPlayers.connect(helper, "cuprum_echo")) {
            MockServerPlayers.op(mock);
            DiagEchoPayload forged = new DiagEchoPayload(42, "hell\u0301o wave one"); // decomposed é
            GuardResult result = CuprumNet.dispatch(DiagEchoPayload.TYPE, forged, mock.player());
            helper.assertValueEqual(GuardResult.PASS, result, Component.literal("guard result"));
            List<DiagEchoReplyPayload> replies = mock.sentPayloads(DiagEchoReplyPayload.class);
            helper.assertValueEqual(1, replies.size(), Component.literal("reply count"));
            DiagEchoReplyPayload reply = replies.get(0);
            helper.assertValueEqual(42, reply.nonce(), Component.literal("echoed nonce"));
            helper.assertValueEqual(CuprumCatalog.CATALOG_SHA256, reply.catalogSha(),
                    Component.literal("catalog sha"));
            helper.assertValueEqual(mock.player().level().getGameTime(), reply.gameTime(),
                    Component.literal("game time"));
        }
        helper.succeed();
    }

    @GameTest
    public void permissionRejectionMutatesNothing(GameTestHelper helper) {
        try (MockServerPlayers.Mock mock = MockServerPlayers.connect(helper, "cuprum_noperm")) {
            // Deliberately NOT opped: cuprum.diagnostics falls back to OP 2 and must fail.
            DiagEchoPayload forged = new DiagEchoPayload(7, "should be rejected");
            GuardResult result = CuprumNet.dispatch(DiagEchoPayload.TYPE, forged, mock.player());
            helper.assertValueEqual(GuardResult.DROP_LOG, result, Component.literal("guard result"));
            helper.assertValueEqual(0, mock.sentPayloads(DiagEchoReplyPayload.class).size(),
                    Component.literal("replies after permission rejection"));
            // An honest permission miss is a drop, not a protocol violation.
            helper.assertValueEqual(0, NetViolations.violationsInWindow(mock.player().getUUID()),
                    Component.literal("violations after permission rejection"));
        }
        helper.succeed();
    }

    @GameTest
    public void rateLimitAcceptsExactlyBurst(GameTestHelper helper) {
        try (MockServerPlayers.Mock mock = MockServerPlayers.connect(helper, "cuprum_rate")) {
            MockServerPlayers.op(mock);
            // net.burstDefault = 8: within one tick exactly 8 echoes pass, the 9th drops silently.
            List<GuardResult> results = new ArrayList<>();
            for (int i = 0; i < 9; i++) {
                results.add(CuprumNet.dispatch(
                        DiagEchoPayload.TYPE, new DiagEchoPayload(i, "burst " + i), mock.player()));
            }
            for (int i = 0; i < 8; i++) {
                helper.assertValueEqual(GuardResult.PASS, results.get(i),
                        Component.literal("dispatch " + (i + 1) + " of burst 8"));
            }
            helper.assertValueEqual(GuardResult.DROP_SILENT, results.get(8),
                    Component.literal("burst+1 dispatch"));
            helper.assertValueEqual(8, mock.sentPayloads(DiagEchoReplyPayload.class).size(),
                    Component.literal("replies must match accepted dispatches"));
            helper.assertValueEqual(0, NetViolations.violationsInWindow(mock.player().getUUID()),
                    Component.literal("rate drops are not violations"));
        }
        helper.succeed();
    }

    @GameTest
    public void violationThresholdRequestsKick(GameTestHelper helper) {
        List<ServerPlayer> kicked = new ArrayList<>();
        NetViolations.KickSink previous =
                NetViolations.setKickSink((player, reason) -> kicked.add(player));
        try (MockServerPlayers.Mock mock = MockServerPlayers.connect(helper, "cuprum_hostile")) {
            MockServerPlayers.op(mock);
            // net.violationKickThreshold = 8 = net.burstDefault: 8 hostile payloads all pass the
            // rate step, all fail VALUE, and the 8th trips the kick.
            for (int i = 0; i < 8; i++) {
                GuardResult result = CuprumNet.dispatch(
                        DiagEchoPayload.TYPE, new DiagEchoPayload(i, NFC_GROWING_NOTE), mock.player());
                helper.assertValueEqual(GuardResult.VIOLATION, result,
                        Component.literal("hostile dispatch " + (i + 1)));
                boolean expectKick = i == 7;
                helper.assertValueEqual(expectKick,
                        NetViolations.kickRequested(mock.player().getUUID()),
                        Component.literal("kick requested after violation " + (i + 1)));
            }
            helper.assertValueEqual(8, NetViolations.violationsInWindow(mock.player().getUUID()),
                    Component.literal("violations in window"));
            helper.assertValueEqual(1, kicked.size(), Component.literal("kick sink invocations"));
            helper.assertValueEqual(0, mock.sentPayloads(DiagEchoReplyPayload.class).size(),
                    Component.literal("no reply may leak for rejected values"));
        } finally {
            NetViolations.setKickSink(previous);
        }
        helper.succeed();
    }

    @GameTest
    public void guardRangeRejectsFarTarget(GameTestHelper helper) {
        try (MockServerPlayers.Mock mock = MockServerPlayers.connect(helper, "cuprum_range")) {
            BlockPos target = helper.absolutePos(new BlockPos(1, 1, 1)); // inside the loaded test structure
            mock.player().setPos(Vec3.atCenterOf(target)); // in reach
            GuardResult near = C2SGuard.check(mock.player(), SYNTHETIC_ID,
                    GuardSpec.builder().range(target, 8.0).build());
            helper.assertValueEqual(GuardResult.PASS, near, Component.literal("in-range check"));

            mock.player().setPos(Vec3.atCenterOf(target).add(50.0, 0.0, 0.0)); // same dimension, too far
            GuardResult far = C2SGuard.check(mock.player(), SYNTHETIC_ID,
                    GuardSpec.builder().range(target, 8.0).build());
            helper.assertValueEqual(GuardResult.DROP_LOG, far, Component.literal("out-of-range check"));
        }
        helper.succeed();
    }

    @GameTest
    public void rangeCheckRejectsInvalidBounds(GameTestHelper helper) {
        BlockPos pos = helper.absolutePos(new BlockPos(1, 1, 1));
        // Hostile/buggy range bounds must fail at construction (and the runtime check fails
        // closed on the same NetBounds predicate, which the MC-free unit tests cover).
        for (double invalid : new double[] {Double.NaN, Double.POSITIVE_INFINITY,
                Double.NEGATIVE_INFINITY, 0.0, -1.0, 8.0001}) {
            try {
                new GuardSpec.RangeCheck(pos, invalid);
                helper.fail(Component.literal("RangeCheck accepted invalid maxDistance " + invalid));
            } catch (IllegalArgumentException expected) {
                // rejected as required
            }
        }
        // The exact cap and a small positive value are valid.
        helper.assertValueEqual(8.0, new GuardSpec.RangeCheck(pos, 8.0).maxDistance(),
                Component.literal("exact 8.0 accepted"));
        helper.assertValueEqual(0.5, new GuardSpec.RangeCheck(pos, 0.5).maxDistance(),
                Component.literal("0.5 accepted"));
        helper.succeed();
    }

    @GameTest
    public void controlCharacterNoteIsAViolation(GameTestHelper helper) {
        try (MockServerPlayers.Mock mock = MockServerPlayers.connect(helper, "cuprum_ctrl")) {
            MockServerPlayers.op(mock);
            // Fits every length bound but carries a newline — log-injection surface, so the
            // VALUE step must reject it as a violation (never strip/clamp it).
            DiagEchoPayload forged = new DiagEchoPayload(3, "line1\nline2");
            GuardResult result = CuprumNet.dispatch(DiagEchoPayload.TYPE, forged, mock.player());
            helper.assertValueEqual(GuardResult.VIOLATION, result, Component.literal("guard result"));
            helper.assertValueEqual(1, NetViolations.violationsInWindow(mock.player().getUUID()),
                    Component.literal("violations after control-char note"));
            helper.assertValueEqual(0, mock.sentPayloads(DiagEchoReplyPayload.class).size(),
                    Component.literal("no reply for a rejected note"));
        }
        helper.succeed();
    }

    @GameTest
    public void disconnectDropsPerConnectionState(GameTestHelper helper) {
        MockServerPlayers.Mock mock = MockServerPlayers.connect(helper, "cuprum_dc");
        MockServerPlayers.op(mock);
        java.util.UUID uuid = mock.player().getUUID();

        // Create both kinds of per-connection state: rate buckets (valid echo) and violation
        // bookkeeping (hostile echo).
        CuprumNet.dispatch(DiagEchoPayload.TYPE, new DiagEchoPayload(1, "ok"), mock.player());
        CuprumNet.dispatch(DiagEchoPayload.TYPE, new DiagEchoPayload(2, NFC_GROWING_NOTE), mock.player());
        helper.assertTrue(NetRateLimiter.hasBucketsForTesting(uuid),
                Component.literal("rate buckets exist while connected"));
        helper.assertTrue(NetViolations.hasStateForTesting(uuid),
                Component.literal("violation state exists while connected"));

        // close() drives the REAL disconnect path (channel close → Fabric DISCONNECT event →
        // PlayerList removal); both state owners must have dropped this connection's state.
        // The event fires on the server thread here (embedded channel), so the serialized
        // cleanup (MinecraftServer.execute) runs inline and is visible immediately; the
        // Netty-thread ordering is pinned separately by NetDisconnectRaceGameTest.
        mock.close();
        helper.assertFalse(NetRateLimiter.hasBucketsForTesting(uuid),
                Component.literal("rate buckets dropped by the real DISCONNECT event"));
        helper.assertFalse(NetViolations.hasStateForTesting(uuid),
                Component.literal("violation state dropped by the real DISCONNECT event"));
        helper.succeed();
    }

    @GameTest
    public void guardMenuRejectsMismatchedContainer(GameTestHelper helper) {
        try (MockServerPlayers.Mock mock = MockServerPlayers.connect(helper, "cuprum_menu")) {
            int openId = mock.player().containerMenu.containerId;
            GuardResult matching = C2SGuard.check(mock.player(), SYNTHETIC_ID,
                    GuardSpec.builder().menu(openId, InventoryMenu.class).build());
            helper.assertValueEqual(GuardResult.PASS, matching, Component.literal("matching menu check"));

            GuardResult wrongId = C2SGuard.check(mock.player(), SYNTHETIC_ID,
                    GuardSpec.builder().menu(openId + 99, InventoryMenu.class).build());
            helper.assertValueEqual(GuardResult.DROP_LOG, wrongId, Component.literal("stale container id"));
        }
        helper.succeed();
    }
}
