package dev.cuprum.cuprum.gametest.fx;

import dev.cuprum.cuprum.fx.FxRippleBroadcaster;
import dev.cuprum.cuprum.fx.FxRipplePayload;
import dev.cuprum.cuprum.fx.core.FxBudgets;
import dev.cuprum.cuprum.gametest.net.MockServerPlayers;
import dev.cuprum.cuprum.gametest.net.MockServerPlayers.Mock;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;
import net.fabricmc.fabric.api.gametest.v1.GameTest;
import net.fabricmc.fabric.api.networking.v1.PlayerLookup;
import net.minecraft.core.BlockPos;
import net.minecraft.gametest.framework.GameTestHelper;
import net.minecraft.network.chat.Component;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.server.network.ServerGamePacketListenerImpl;

/**
 * Deterministic stale-disconnect/reconnect race for the server FX send window. A's cleanup is
 * queued from a foreign-thread analog, B with the same UUID joins and exhausts a fresh window,
 * then the queue drains. The stale owner must neither erase B nor reset B's consumed budget.
 */
public class FxReconnectRaceGameTest {
    private static final String ENVIRONMENT = "cuprum-gametest:fx_reconnect";
    private static final BlockPos ANCHOR = new BlockPos(2, 2, 2);
    private static final int RADIUS_Q8 = 768;
    private static final int COPPER_ARGB = 0xFFE77C56;
    private static final long JOIN_TIMEOUT_MS = TimeUnit.SECONDS.toMillis(10);

    @GameTest(environment = ENVIRONMENT, maxTicks = 100)
    public void staleDisconnectCannotResetNewerSameUuidSendWindow(GameTestHelper helper) {
        ServerLevel level = helper.getLevel();
        MinecraftServer server = level.getServer();
        BlockPos anchor = helper.absolutePos(ANCHOR);

        Mock mockA = MockServerPlayers.connect(helper, "cuprum_fxreuse");
        ServerPlayer playerA = mockA.player();
        UUID uuid = playerA.getUUID();
        ServerGamePacketListenerImpl handlerA = playerA.connection;
        moveIntoTracking(level, playerA, anchor);

        AtomicBoolean staleCleanupDrained = new AtomicBoolean();
        AtomicReference<Throwable> nettyFailure = new AtomicReference<>();
        AtomicReference<Mock> mockBRef = new AtomicReference<>();
        AtomicReference<Long> bWindowStartRef = new AtomicReference<>();

        helper.startSequence()
                .thenWaitUntil(() -> helper.assertTrue(
                        PlayerLookup.tracking(level, anchor).contains(playerA),
                        Component.literal("A tracks the ripple anchor")))
                .thenExecute(() -> {
                    assertFullWindow(helper, level, anchor, mockA, "A");

                    Thread nettyThread = new Thread(() -> {
                        try {
                            FxRippleBroadcaster.handleDisconnect(handlerA, server);
                            server.execute(() -> staleCleanupDrained.set(true));
                        } catch (Throwable throwable) {
                            nettyFailure.set(throwable);
                        }
                    }, "cuprum-gametest-fx-stale-disconnect");
                    nettyThread.start();
                    joinOrThrow(nettyThread);
                    if (nettyFailure.get() != null) {
                        throw new IllegalStateException(
                                "stale FX cleanup delivery failed", nettyFailure.get());
                    }

                    helper.assertFalse(staleCleanupDrained.get(),
                            Component.literal("off-thread cleanup stays queued during this server turn"));
                    mockA.close();
                    helper.assertValueEqual(0, FxRippleBroadcaster.trackedWindowCount(),
                            Component.literal("A's own disconnect removes A's session"));

                    Mock mockB = MockServerPlayers.connect(helper, "cuprum_fxreuse");
                    mockBRef.set(mockB);
                    helper.assertValueEqual(uuid, mockB.player().getUUID(),
                            Component.literal("B reuses A's UUID"));
                    helper.assertTrue(mockB.player().connection != handlerA,
                            Component.literal("B has a distinct connection identity"));
                    moveIntoTracking(level, mockB.player(), anchor);
                })
                .thenWaitUntil(() -> {
                    Mock mockB = requireMock(helper, mockBRef);
                    helper.assertTrue(PlayerLookup.tracking(level, anchor).contains(mockB.player()),
                            Component.literal("B tracks the ripple anchor"));
                })
                .thenExecute(() -> {
                    Mock mockB = requireMock(helper, mockBRef);
                    bWindowStartRef.set(level.getGameTime());
                    assertFullWindow(helper, level, anchor, mockB, "B before stale drain");
                    helper.assertTrue(FxRippleBroadcaster.isOwnedByForTesting(
                                    uuid, mockB.player().connection),
                            Component.literal("B owns the live session before stale drain"));
                })
                .thenWaitUntil(() -> helper.assertTrue(staleCleanupDrained.get(),
                        Component.literal("stale cleanup queue has not drained")))
                .thenExecute(() -> {
                    Mock mockB = requireMock(helper, mockBRef);
                    helper.assertTrue(
                            level.getGameTime() - bWindowStartRef.get() < FxBudgets.SEND_WINDOW_TICKS,
                            Component.literal("B remains in its original send window"));
                    helper.assertTrue(FxRippleBroadcaster.isOwnedByForTesting(
                                    uuid, mockB.player().connection),
                            Component.literal("B survives A's stale cleanup"));
                    helper.assertValueEqual(1, FxRippleBroadcaster.trackedWindowCount(),
                            Component.literal("exactly B's window remains"));
                    helper.assertValueEqual(0, FxRippleBroadcaster.broadcast(
                                    level, anchor, RADIUS_Q8, COPPER_ARGB),
                            Component.literal("stale cleanup cannot re-grant B's exhausted budget"));
                    helper.assertValueEqual(FxBudgets.RIPPLE_SENDS_PER_SECOND,
                            mockB.sentPayloads(FxRipplePayload.class).size(),
                            Component.literal("B remains capped in the live window"));

                    mockB.close();
                    helper.assertValueEqual(0, FxRippleBroadcaster.trackedWindowCount(),
                            Component.literal("B's own disconnect removes B's session"));
                })
                .thenSucceed();
    }

    private static void assertFullWindow(GameTestHelper helper, ServerLevel level,
            BlockPos anchor, Mock mock, String label) {
        int sent = 0;
        for (int i = 0; i < FxBudgets.RIPPLE_SENDS_PER_SECOND; i++) {
            sent += FxRippleBroadcaster.broadcast(level, anchor, RADIUS_Q8, COPPER_ARGB);
        }
        helper.assertValueEqual(FxBudgets.RIPPLE_SENDS_PER_SECOND, sent,
                Component.literal(label + ": full window accepted"));
        helper.assertValueEqual(0,
                FxRippleBroadcaster.broadcast(level, anchor, RADIUS_Q8, COPPER_ARGB),
                Component.literal(label + ": overflow send coalesced"));
        helper.assertValueEqual(FxBudgets.RIPPLE_SENDS_PER_SECOND,
                mock.sentPayloads(FxRipplePayload.class).size(),
                Component.literal(label + ": exact payload count"));
    }

    private static Mock requireMock(GameTestHelper helper, AtomicReference<Mock> mockRef) {
        Mock mock = mockRef.get();
        helper.assertTrue(mock != null, Component.literal("B was created before this step"));
        return mock;
    }

    private static void moveIntoTracking(ServerLevel level, ServerPlayer player, BlockPos anchor) {
        player.teleportTo(level, anchor.getX() + 0.5, anchor.getY() + 1.0,
                anchor.getZ() + 0.5, Set.of(), 0.0f, 0.0f, false);
        level.getChunkSource().move(player);
    }

    private static void joinOrThrow(Thread thread) {
        try {
            thread.join(JOIN_TIMEOUT_MS);
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("interrupted joining " + thread.getName(), exception);
        }
        if (thread.isAlive()) {
            throw new IllegalStateException(thread.getName() + " did not terminate");
        }
    }
}
