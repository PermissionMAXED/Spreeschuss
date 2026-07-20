package dev.cuprum.cuprum.gametest.net;

import dev.cuprum.cuprum.net.CuprumNet;
import dev.cuprum.cuprum.net.payload.DiagEchoPayload;
import dev.cuprum.cuprum.net.payload.DiagEchoReplyPayload;
import dev.cuprum.cuprum.net.server.C2SGuard;
import dev.cuprum.cuprum.net.server.GuardResult;
import dev.cuprum.cuprum.net.server.GuardSpec;
import dev.cuprum.cuprum.net.server.NetRateLimiter;
import dev.cuprum.cuprum.net.server.NetViolations;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import net.fabricmc.fabric.api.gametest.v1.GameTest;
import net.minecraft.gametest.framework.GameTestHelper;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.server.network.ServerGamePacketListenerImpl;

/**
 * Deterministic cross-thread race test for the disconnect-vs-dispatch hazard: on a real server
 * the Fabric DISCONNECT event can fire on a <b>Netty event-loop thread</b> while the server
 * thread is mid-dispatch. If the cleanup removed state inline, a dispatch that already passed
 * liveness could observe half-removed state — and a {@code computeIfAbsent}-style lookup would
 * recreate the entry permanently (Fabric fires DISCONNECT only once). The production fix
 * serializes cleanup on the server executor and makes late lookups non-creating; this test
 * pins both properties with latch-ordered interleaving (no timing sleeps, no leaked threads):
 *
 * <ol>
 *   <li>a foreign "netty" thread delivers both production cleanup entry points
 *       ({@code NetRateLimiter/NetViolations.handleDisconnect} — exactly what the DISCONNECT
 *       event calls) <b>while the server thread is inside a guard evaluation</b>, plus a
 *       duplicate delivery (idempotency),</li>
 *   <li>the mid-dispatch guard step observes intact state (cleanup was queued, not inline),</li>
 *   <li>token accounting around the race stays exactly-once (burst 8 = exactly 8 charged
 *       dispatches in one tick, the 9th drops silently),</li>
 *   <li>after the server executor drains, all per-connection state is gone, and late
 *       dispatches/violations for the disconnected connection are refused without recreating
 *       any state, and the subsequent real disconnect path stays idempotent.</li>
 * </ol>
 */
public class NetDisconnectRaceGameTest {
    /** A payload id for synthetic {@link C2SGuard} checks that never hits a real registration. */
    private static final ResourceLocation SYNTHETIC_ID =
            ResourceLocation.fromNamespaceAndPath("cuprum", "gametest/synthetic_race");

    /** Raw length 40 (passes the codec bound) but 80 after NFC — a semantic VALUE violation. */
    private static final String NFC_GROWING_NOTE = "\u0958".repeat(40);

    /** Upper bound for latch/join coordination; never slept, only awaited. */
    private static final long SYNC_TIMEOUT_SECONDS = 10;

    @GameTest
    public void nettyThreadDisconnectDuringDispatchCannotResurrectState(GameTestHelper helper) {
        MinecraftServer server = helper.getLevel().getServer();
        MockServerPlayers.Mock mock = MockServerPlayers.connect(helper, "cuprum_race");
        MockServerPlayers.op(mock);
        ServerPlayer player = mock.player();
        UUID uuid = player.getUUID();
        ServerGamePacketListenerImpl handler = player.connection;

        // Baseline: one accepted echo (exactly one token, one reply) and one hostile echo
        // (exactly one violation) put both kinds of per-connection state into play.
        helper.assertValueEqual(GuardResult.PASS,
                CuprumNet.dispatch(DiagEchoPayload.TYPE, new DiagEchoPayload(1, "pre-race"), player),
                Component.literal("baseline dispatch"));
        helper.assertValueEqual(GuardResult.VIOLATION,
                CuprumNet.dispatch(DiagEchoPayload.TYPE, new DiagEchoPayload(2, NFC_GROWING_NOTE), player),
                Component.literal("baseline hostile dispatch"));
        helper.assertTrue(NetRateLimiter.hasBucketsForTesting(uuid),
                Component.literal("rate buckets exist before the race"));
        helper.assertValueEqual(1, NetViolations.violationsInWindow(uuid),
                Component.literal("violations before the race"));

        // The foreign thread stands in for the Netty event loop: it delivers the exact
        // production cleanup calls the Fabric DISCONNECT handlers make, strictly while the
        // server thread is parked inside the guard's STATE step below.
        CountDownLatch serverInsideGuard = new CountDownLatch(1);
        CountDownLatch cleanupDelivered = new CountDownLatch(1);
        AtomicReference<Throwable> nettyFailure = new AtomicReference<>();
        Thread nettyThread = new Thread(() -> {
            try {
                awaitOrThrow(serverInsideGuard, "server thread never entered the guard");
                NetRateLimiter.handleDisconnect(handler, server);
                NetViolations.handleDisconnect(handler, server);
                // Duplicate delivery must be harmless (idempotent cleanup).
                NetRateLimiter.handleDisconnect(handler, server);
                NetViolations.handleDisconnect(handler, server);
            } catch (Throwable t) {
                nettyFailure.set(t);
            } finally {
                cleanupDelivered.countDown();
            }
        }, "cuprum-gametest-netty-disconnect");
        nettyThread.start();

        GuardResult midRace = C2SGuard.check(player, SYNTHETIC_ID, GuardSpec.builder()
                .state(() -> {
                    serverInsideGuard.countDown();
                    awaitOrThrow(cleanupDelivered, "netty-thread cleanup delivery never finished");
                    // The off-thread delivery has fully returned, yet this dispatch is still
                    // in flight: serialized cleanup must not have touched the state inline.
                    return NetRateLimiter.hasBucketsForTesting(uuid)
                            && NetViolations.hasStateForTesting(uuid);
                })
                .build());
        helper.assertValueEqual(GuardResult.PASS, midRace,
                Component.literal("state must be intact mid-dispatch despite off-thread disconnect delivery"));
        joinOrThrow(nettyThread);
        if (nettyFailure.get() != null) {
            throw new IllegalStateException("netty-thread cleanup delivery failed", nettyFailure.get());
        }

        // Same server-thread turn (queued cleanup not yet drained): token accounting stays
        // exactly-once. Two tokens are already charged (baseline PASS + VIOLATION), so with
        // net.burstDefault = 8 and NetTicks frozen within this tick, exactly six more
        // dispatches pass and a ninth token is never granted.
        for (int i = 0; i < 6; i++) {
            helper.assertValueEqual(GuardResult.PASS,
                    CuprumNet.dispatch(DiagEchoPayload.TYPE, new DiagEchoPayload(10 + i, "post-delivery " + i), player),
                    Component.literal("post-delivery dispatch " + (i + 1) + " of remaining burst 6"));
        }
        helper.assertValueEqual(GuardResult.DROP_SILENT,
                CuprumNet.dispatch(DiagEchoPayload.TYPE, new DiagEchoPayload(99, "burst+1"), player),
                Component.literal("burst+1 must drop silently (tokens charged exactly once each)"));
        helper.assertValueEqual(7, mock.sentPayloads(DiagEchoReplyPayload.class).size(),
                Component.literal("replies match accepted dispatches around the race"));
        helper.assertValueEqual(1, NetViolations.violationsInWindow(uuid),
                Component.literal("violation count untouched by the race window"));

        helper.startSequence()
                .thenWaitUntil(() -> {
                    // Retried per tick until the server executor drains the queued cleanup —
                    // deterministic serialization, no sleeps.
                    helper.assertFalse(NetRateLimiter.hasBucketsForTesting(uuid),
                            Component.literal("rate buckets dropped by the serialized cleanup"));
                    helper.assertFalse(NetViolations.hasStateForTesting(uuid),
                            Component.literal("violation state dropped by the serialized cleanup"));
                })
                .thenExecute(() -> {
                    // Late traffic for the cleaned-up connection: refused, and no state may be
                    // recreated (the player object is still alive in-world, so liveness passes
                    // and the rate step is what must refuse).
                    helper.assertValueEqual(GuardResult.DROP_SILENT,
                            CuprumNet.dispatch(DiagEchoPayload.TYPE, new DiagEchoPayload(100, "late"), player),
                            Component.literal("late dispatch after cleanup"));
                    helper.assertFalse(NetRateLimiter.hasBucketsForTesting(uuid),
                            Component.literal("late dispatch must not recreate rate buckets"));
                    NetViolations.record(player, SYNTHETIC_ID, "late violation after cleanup");
                    helper.assertFalse(NetViolations.hasStateForTesting(uuid),
                            Component.literal("late violation must not recreate violation state"));
                    helper.assertValueEqual(0, NetViolations.violationsInWindow(uuid),
                            Component.literal("no violations tracked after cleanup"));
                    helper.assertFalse(NetViolations.kickRequested(uuid),
                            Component.literal("no kick for a disconnected connection"));
                    helper.assertValueEqual(7, mock.sentPayloads(DiagEchoReplyPayload.class).size(),
                            Component.literal("no reply for late traffic"));

                    // The real teardown (channel close → Fabric DISCONNECT, first CAS-guarded
                    // delivery for this connection) must stay idempotent on top of the seam
                    // deliveries above.
                    mock.close();
                    helper.assertFalse(NetRateLimiter.hasBucketsForTesting(uuid),
                            Component.literal("no rate-bucket state after real disconnect"));
                    helper.assertFalse(NetViolations.hasStateForTesting(uuid),
                            Component.literal("no violation state after real disconnect"));
                })
                .thenSucceed();
    }

    private static void awaitOrThrow(CountDownLatch latch, String message) {
        try {
            if (!latch.await(SYNC_TIMEOUT_SECONDS, TimeUnit.SECONDS)) {
                throw new IllegalStateException(message);
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException(message, e);
        }
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
