package dev.cuprum.cuprum.gametest.net;

import dev.cuprum.cuprum.net.CuprumNet;
import dev.cuprum.cuprum.net.payload.DiagEchoPayload;
import dev.cuprum.cuprum.net.payload.DiagEchoReplyPayload;
import dev.cuprum.cuprum.net.server.GuardResult;
import dev.cuprum.cuprum.net.server.NetRateLimiter;
import dev.cuprum.cuprum.net.server.NetViolations;
import java.util.UUID;
import net.fabricmc.fabric.api.gametest.v1.GameTest;
import net.minecraft.gametest.framework.GameTestHelper;
import net.minecraft.network.chat.Component;

/**
 * Deterministic probe of the production server-stop sweep
 * ({@code NetRateLimiter/NetViolations.handleServerStopped} — the exact methods the single
 * {@code ServerLifecycleEvents.SERVER_STOPPED} callback registered in {@code CuprumNet.init()}
 * invokes). The hazard (verified in {@code MinecraftServer.runServer}): a per-connection cleanup
 * queued off-thread after the game loop's final drain is never executed, and static maps outlive
 * the server instance inside one JVM — so shutdown must sweep synchronously, not rely on queued
 * connection cleanup. The event wiring itself is proven at a real dedicated-server shutdown by
 * {@code scripts/server_smoke.sh} (anchored sweep log line); this test pins the operation:
 * sweeping live state, idempotency across repeated lifecycles, fresh JOINs working after a
 * sweep, and no state resurrection by post-sweep traffic.
 *
 * <p>Runs in the dedicated {@code cuprum-gametest:net_shutdown} environment (its own sequential
 * batch): the sweep clears <b>all</b> per-connection state, which must never interleave with
 * default-batch tests that hold live sessions across ticks.
 */
public class NetShutdownClearGameTest {
    /** Raw length 40 (passes the codec bound) but 80 after NFC — a semantic VALUE violation. */
    private static final String NFC_GROWING_NOTE = "\u0958".repeat(40);

    @GameTest(environment = "cuprum-gametest:net_shutdown")
    public void serverStoppedSweepClearsAllPerConnectionState(GameTestHelper helper) {
        // Lifecycle 1: two live connections with both kinds of per-connection state.
        MockServerPlayers.Mock mock1 = MockServerPlayers.connect(helper, "cuprum_stop_a");
        MockServerPlayers.op(mock1);
        MockServerPlayers.Mock mock2 = MockServerPlayers.connect(helper, "cuprum_stop_b");
        MockServerPlayers.op(mock2);
        UUID uuid1 = mock1.player().getUUID();
        UUID uuid2 = mock2.player().getUUID();
        helper.assertValueEqual(GuardResult.PASS,
                CuprumNet.dispatch(DiagEchoPayload.TYPE, new DiagEchoPayload(1, "pre-stop"), mock1.player()),
                Component.literal("lifecycle-1 clean dispatch"));
        helper.assertValueEqual(GuardResult.VIOLATION,
                CuprumNet.dispatch(DiagEchoPayload.TYPE, new DiagEchoPayload(2, NFC_GROWING_NOTE), mock2.player()),
                Component.literal("lifecycle-1 hostile dispatch"));
        helper.assertTrue(NetRateLimiter.hasBucketsForTesting(uuid1)
                        && NetRateLimiter.hasBucketsForTesting(uuid2),
                Component.literal("rate state exists for both live connections"));
        helper.assertValueEqual(1, NetViolations.violationsInWindow(uuid2),
                Component.literal("violation recorded before the sweep"));

        // The production sweep: synchronous and unconditional — live connections included, no
        // dependence on any queued per-connection cleanup having drained.
        NetRateLimiter.handleServerStopped();
        NetViolations.handleServerStopped();
        helper.assertFalse(NetRateLimiter.hasBucketsForTesting(uuid1)
                        || NetRateLimiter.hasBucketsForTesting(uuid2),
                Component.literal("sweep cleared all rate state"));
        helper.assertFalse(NetViolations.hasStateForTesting(uuid1)
                        || NetViolations.hasStateForTesting(uuid2),
                Component.literal("sweep cleared all violation state"));

        // Repeated lifecycles are idempotent: a second sweep on the empty maps is harmless.
        NetRateLimiter.handleServerStopped();
        NetViolations.handleServerStopped();
        helper.assertFalse(NetRateLimiter.hasBucketsForTesting(uuid1)
                        || NetViolations.hasStateForTesting(uuid2),
                Component.literal("second sweep is a no-op"));

        // Post-sweep traffic for a swept-but-still-connected sender: refused (get-only lookups)
        // and no state resurrected — mirrors traffic racing a shutdown.
        helper.assertValueEqual(GuardResult.DROP_SILENT,
                CuprumNet.dispatch(DiagEchoPayload.TYPE, new DiagEchoPayload(3, "post-sweep"), mock1.player()),
                Component.literal("post-sweep dispatch refused"));
        helper.assertFalse(NetRateLimiter.hasBucketsForTesting(uuid1),
                Component.literal("post-sweep dispatch resurrects no rate state"));

        // "Next lifecycle": a fresh JOIN after the sweep gets fresh, fully working state.
        MockServerPlayers.Mock mock3 = MockServerPlayers.connect(helper, "cuprum_stop_c");
        MockServerPlayers.op(mock3);
        UUID uuid3 = mock3.player().getUUID();
        helper.assertTrue(NetRateLimiter.hasBucketsForTesting(uuid3),
                Component.literal("fresh JOIN after the sweep creates rate state"));
        helper.assertValueEqual(GuardResult.PASS,
                CuprumNet.dispatch(DiagEchoPayload.TYPE, new DiagEchoPayload(4, "next lifecycle"), mock3.player()),
                Component.literal("guarded dispatch works in the next lifecycle"));
        helper.assertValueEqual(1, mock3.sentPayloads(DiagEchoReplyPayload.class).size(),
                Component.literal("next-lifecycle reply"));
        helper.assertValueEqual(0, NetViolations.violationsInWindow(uuid3),
                Component.literal("next lifecycle starts violation-free"));

        // Lifecycle 2 sweep, then teardown: the real disconnects' conditional cleanup no-ops
        // on the swept maps (idempotent with the sweep in either order).
        NetRateLimiter.handleServerStopped();
        NetViolations.handleServerStopped();
        mock1.close();
        mock2.close();
        mock3.close();
        helper.assertFalse(NetRateLimiter.hasBucketsForTesting(uuid1)
                        || NetRateLimiter.hasBucketsForTesting(uuid2)
                        || NetRateLimiter.hasBucketsForTesting(uuid3),
                Component.literal("no rate state after sweep + real disconnects"));
        helper.assertFalse(NetViolations.hasStateForTesting(uuid1)
                        || NetViolations.hasStateForTesting(uuid2)
                        || NetViolations.hasStateForTesting(uuid3),
                Component.literal("no violation state after sweep + real disconnects"));
        helper.succeed();
    }
}
