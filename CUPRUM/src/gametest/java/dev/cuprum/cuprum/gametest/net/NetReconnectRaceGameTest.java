package dev.cuprum.cuprum.gametest.net;

import dev.cuprum.cuprum.net.CuprumNet;
import dev.cuprum.cuprum.net.payload.DiagEchoPayload;
import dev.cuprum.cuprum.net.payload.DiagEchoReplyPayload;
import dev.cuprum.cuprum.net.server.GuardResult;
import dev.cuprum.cuprum.net.server.NetRateLimiter;
import dev.cuprum.cuprum.net.server.NetViolations;
import dev.cuprum.cuprum.net.server.RateKey;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;
import net.fabricmc.fabric.api.gametest.v1.GameTest;
import net.minecraft.gametest.framework.GameTestHelper;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.server.network.ServerGamePacketListenerImpl;

/**
 * Deterministic reconnect interleaving for the stale-disconnect-vs-rejoin hazard: connection A's
 * cleanup is delivered from a foreign "Netty" thread (queued on the server executor, exactly
 * what the Fabric DISCONNECT handler does off-thread), connection B with the <b>same UUID</b>
 * joins before that queue drains, then the queue drains. With UUID-keyed unconditional removal,
 * A's stale cleanup would delete B's fresh limiter/violation state — and because Fabric fires
 * DISCONNECT once per connection, B would silently lose every guarded payload for its whole
 * session. The production fix binds state to the connection handler and removes conditionally;
 * this test pins the whole lifecycle with a queue-order marker (FIFO on the server executor)
 * instead of sleeps, and leaks no threads:
 *
 * <ol>
 *   <li>A builds distinguishable state (one charged token + one recorded violation), then A's
 *       cleanup is queued from the foreign thread and provably not yet drained,</li>
 *   <li>A's real channel close (server-thread event delivery) removes A's state inline —
 *       immediate semantics — and B joins with the same deterministic UUID, gets fresh state
 *       (no inherited violations), and exchanges guarded traffic,</li>
 *   <li>after the marker proves the stale queue drained: B's state is intact, B's guarded
 *       payloads still pass, and the stale connection A can neither acquire tokens from nor
 *       record violations against B's session (connection identity, not UUID identity),</li>
 *   <li>B's own disconnect still cleans up (the conditional removal matches the live owner).</li>
 * </ol>
 */
public class NetReconnectRaceGameTest {
    /** A payload id for synthetic violation records that never hits a real registration. */
    private static final ResourceLocation SYNTHETIC_ID =
            ResourceLocation.fromNamespaceAndPath("cuprum", "gametest/synthetic_reconnect");

    /** Raw length 40 (passes the codec bound) but 80 after NFC — a semantic VALUE violation. */
    private static final String NFC_GROWING_NOTE = "\u0958".repeat(40);

    /** Upper bound for thread-join coordination; never slept, only awaited. */
    private static final long SYNC_TIMEOUT_SECONDS = 10;

    @GameTest
    public void staleDisconnectCleanupCannotDeleteNewerSameUuidSession(GameTestHelper helper) {
        MinecraftServer server = helper.getLevel().getServer();

        // Connection A: distinguishable per-connection state — one charged token (PASS) and
        // one recorded violation (VALUE failure).
        MockServerPlayers.Mock mockA = MockServerPlayers.connect(helper, "cuprum_reuuid");
        MockServerPlayers.op(mockA);
        ServerPlayer playerA = mockA.player();
        UUID uuid = playerA.getUUID();
        ServerGamePacketListenerImpl handlerA = playerA.connection;
        helper.assertValueEqual(GuardResult.PASS,
                CuprumNet.dispatch(DiagEchoPayload.TYPE, new DiagEchoPayload(1, "A pre-race"), playerA),
                Component.literal("A baseline dispatch"));
        helper.assertValueEqual(GuardResult.VIOLATION,
                CuprumNet.dispatch(DiagEchoPayload.TYPE, new DiagEchoPayload(2, NFC_GROWING_NOTE), playerA),
                Component.literal("A baseline hostile dispatch"));
        helper.assertValueEqual(1, NetViolations.violationsInWindow(uuid),
                Component.literal("A violation count before the race"));

        // The foreign thread stands in for the Netty event loop: it delivers A's production
        // cleanup calls (queued on the server executor) plus a FIFO marker task. join() makes
        // the queueing itself synchronous; the marker later proves when the queue drained —
        // while this server-thread turn runs, nothing can drain.
        AtomicBoolean staleCleanupDrained = new AtomicBoolean();
        AtomicReference<Throwable> nettyFailure = new AtomicReference<>();
        Thread nettyThread = new Thread(() -> {
            try {
                NetRateLimiter.handleDisconnect(handlerA, server);
                NetViolations.handleDisconnect(handlerA, server);
                server.execute(() -> staleCleanupDrained.set(true));
            } catch (Throwable t) {
                nettyFailure.set(t);
            }
        }, "cuprum-gametest-netty-stale-disconnect");
        nettyThread.start();
        joinOrThrow(nettyThread);
        if (nettyFailure.get() != null) {
            throw new IllegalStateException("netty-thread cleanup delivery failed", nettyFailure.get());
        }
        helper.assertFalse(staleCleanupDrained.get(),
                Component.literal("queued cleanup must not drain mid-turn"));
        helper.assertTrue(NetRateLimiter.hasBucketsForTesting(uuid),
                Component.literal("A's rate buckets still present while cleanup is queued"));
        helper.assertTrue(NetViolations.hasStateForTesting(uuid),
                Component.literal("A's violation state still present while cleanup is queued"));

        // A's real teardown: the channel close fires the Fabric DISCONNECT event inline on the
        // server thread here (embedded channel), so the conditional removal runs immediately —
        // the immediate-semantics half of the disconnect contract.
        mockA.close();
        helper.assertFalse(NetRateLimiter.hasBucketsForTesting(uuid),
                Component.literal("A's own disconnect removed A's rate buckets inline"));
        helper.assertFalse(NetViolations.hasStateForTesting(uuid),
                Component.literal("A's own disconnect removed A's violation state inline"));

        // Connection B: SAME name → same deterministic UUID, joined strictly before the stale
        // queued cleanup drains. Fresh state, no inherited violations, live guarded traffic.
        MockServerPlayers.Mock mockB = MockServerPlayers.connect(helper, "cuprum_reuuid");
        MockServerPlayers.op(mockB);
        ServerPlayer playerB = mockB.player();
        helper.assertValueEqual(uuid, playerB.getUUID(),
                Component.literal("B reuses A's UUID (deterministic name-derived)"));
        helper.assertTrue(playerB.connection != handlerA,
                Component.literal("B is a distinct connection identity"));
        helper.assertTrue(NetRateLimiter.hasBucketsForTesting(uuid),
                Component.literal("B has fresh rate buckets"));
        helper.assertTrue(NetViolations.hasStateForTesting(uuid),
                Component.literal("B has fresh violation state"));
        helper.assertValueEqual(0, NetViolations.violationsInWindow(uuid),
                Component.literal("B does not inherit A's violation"));
        for (int i = 0; i < 2; i++) {
            helper.assertValueEqual(GuardResult.PASS,
                    CuprumNet.dispatch(DiagEchoPayload.TYPE, new DiagEchoPayload(10 + i, "B pre-drain " + i), playerB),
                    Component.literal("B pre-drain dispatch " + (i + 1)));
        }
        helper.assertValueEqual(2, mockB.sentPayloads(DiagEchoReplyPayload.class).size(),
                Component.literal("B replies before the stale cleanup drains"));

        helper.startSequence()
                .thenWaitUntil(() -> helper.assertTrue(staleCleanupDrained.get(),
                        Component.literal("stale cleanup queue not yet drained")))
                .thenExecute(() -> {
                    // A's stale cleanup has provably drained (FIFO marker ran after it) — and
                    // must not have touched B's session.
                    helper.assertTrue(NetRateLimiter.hasBucketsForTesting(uuid),
                            Component.literal("B's rate buckets survive A's stale cleanup"));
                    helper.assertTrue(NetViolations.hasStateForTesting(uuid),
                            Component.literal("B's violation state survives A's stale cleanup"));
                    helper.assertValueEqual(0, NetViolations.violationsInWindow(uuid),
                            Component.literal("B's violation window untouched by the drain"));

                    // A cannot mutate B: even with matching UUID and live state, the stale
                    // connection is refused by connection identity — no token consumed, no
                    // violation recorded, no kick.
                    helper.assertFalse(NetRateLimiter.tryAcquire(playerA, RateKey.DEFAULT),
                            Component.literal("stale connection A cannot acquire from B's buckets"));
                    NetViolations.record(playerA, SYNTHETIC_ID, "stale-connection violation");
                    helper.assertValueEqual(0, NetViolations.violationsInWindow(uuid),
                            Component.literal("stale connection A cannot record violations against B"));
                    helper.assertFalse(NetViolations.kickRequested(uuid),
                            Component.literal("no kick request against B from stale traffic"));

                    // B remains fully active: guarded payloads keep working after the drain.
                    helper.assertValueEqual(GuardResult.PASS,
                            CuprumNet.dispatch(DiagEchoPayload.TYPE, new DiagEchoPayload(20, "B post-drain"), playerB),
                            Component.literal("B guarded dispatch after the stale drain"));
                    helper.assertValueEqual(3, mockB.sentPayloads(DiagEchoReplyPayload.class).size(),
                            Component.literal("B reply count after the stale drain"));

                    // B's own real disconnect still cleans up: the conditional removal matches
                    // the live owner (and runs inline on the server thread here).
                    mockB.close();
                    helper.assertFalse(NetRateLimiter.hasBucketsForTesting(uuid),
                            Component.literal("B's disconnect drops B's rate buckets"));
                    helper.assertFalse(NetViolations.hasStateForTesting(uuid),
                            Component.literal("B's disconnect drops B's violation state"));
                })
                .thenSucceed();
    }

    private static void joinOrThrow(Thread thread) {
        try {
            thread.join(TimeUnit.SECONDS.toMillis(SYNC_TIMEOUT_SECONDS));
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("interrupted while joining " + thread.getName(), e);
        }
        if (thread.isAlive()) {
            throw new IllegalStateException(thread.getName() + " did not terminate (leaked thread)");
        }
    }
}
