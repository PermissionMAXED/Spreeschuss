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
 * Deterministic server-stop race for FX windows. A foreign-thread disconnect remains queued
 * while the synchronous stop sweep runs; traffic cannot resurrect swept state, and the old
 * queued owner cannot erase or reset a fresh same-UUID session created for the next lifecycle.
 */
public class FxShutdownRaceGameTest {
    private static final String ENVIRONMENT = "cuprum-gametest:fx_shutdown";
    private static final BlockPos ANCHOR = new BlockPos(2, 2, 2);
    private static final int RADIUS_Q8 = 768;
    private static final int COPPER_ARGB = 0xFFE77C56;
    private static final long JOIN_TIMEOUT_MS = TimeUnit.SECONDS.toMillis(10);

    @GameTest(environment = ENVIRONMENT, maxTicks = 100)
    public void shutdownSweepWinsRacesWithoutLeakingIntoNextSession(GameTestHelper helper) {
        ServerLevel level = helper.getLevel();
        MinecraftServer server = level.getServer();
        BlockPos anchor = helper.absolutePos(ANCHOR);

        Mock mockA = MockServerPlayers.connect(helper, "cuprum_fxstop");
        ServerPlayer playerA = mockA.player();
        UUID uuid = playerA.getUUID();
        ServerGamePacketListenerImpl handlerA = playerA.connection;
        moveIntoTracking(level, playerA, anchor);

        AtomicBoolean staleCleanupDrained = new AtomicBoolean();
        AtomicReference<Throwable> nettyFailure = new AtomicReference<>();
        AtomicReference<Mock> mockBRef = new AtomicReference<>();

        helper.startSequence()
                .thenWaitUntil(() -> helper.assertTrue(
                        PlayerLookup.tracking(level, anchor).contains(playerA),
                        Component.literal("A tracks the ripple anchor")))
                .thenExecute(() -> {
                    helper.assertValueEqual(1, FxRippleBroadcaster.broadcast(
                                    level, anchor, RADIUS_Q8, COPPER_ARGB),
                            Component.literal("A creates live rate state"));

                    Thread nettyThread = new Thread(() -> {
                        try {
                            FxRippleBroadcaster.handleDisconnect(handlerA, server);
                            server.execute(() -> staleCleanupDrained.set(true));
                        } catch (Throwable throwable) {
                            nettyFailure.set(throwable);
                        }
                    }, "cuprum-gametest-fx-shutdown-disconnect");
                    nettyThread.start();
                    joinOrThrow(nettyThread);
                    if (nettyFailure.get() != null) {
                        throw new IllegalStateException(
                                "shutdown FX cleanup delivery failed", nettyFailure.get());
                    }
                    helper.assertFalse(staleCleanupDrained.get(),
                            Component.literal("old cleanup remains queued before sweep"));

                    FxRippleBroadcaster.handleServerStopped();
                    helper.assertValueEqual(0, FxRippleBroadcaster.trackedWindowCount(),
                            Component.literal("server-stop sweep clears live sessions"));
                    helper.assertValueEqual(0, FxRippleBroadcaster.broadcast(
                                    level, anchor, RADIUS_Q8, COPPER_ARGB),
                            Component.literal("post-sweep traffic cannot resurrect state"));
                    helper.assertValueEqual(0, FxRippleBroadcaster.trackedWindowCount(),
                            Component.literal("post-sweep registry remains empty"));

                    FxRippleBroadcaster.handleServerStopped();
                    mockA.close();
                    helper.assertValueEqual(0, FxRippleBroadcaster.trackedWindowCount(),
                            Component.literal("repeat sweep and disconnect are idempotent"));

                    Mock mockB = MockServerPlayers.connect(helper, "cuprum_fxstop");
                    mockBRef.set(mockB);
                    helper.assertValueEqual(uuid, mockB.player().getUUID(),
                            Component.literal("next lifecycle reuses A's UUID"));
                    helper.assertTrue(mockB.player().connection != handlerA,
                            Component.literal("next lifecycle has a distinct connection"));
                    moveIntoTracking(level, mockB.player(), anchor);
                    helper.assertTrue(FxRippleBroadcaster.isOwnedByForTesting(
                                    uuid, mockB.player().connection),
                            Component.literal("fresh JOIN installs B's session"));
                })
                .thenWaitUntil(() -> {
                    Mock mockB = requireMock(helper, mockBRef);
                    helper.assertTrue(PlayerLookup.tracking(level, anchor).contains(mockB.player()),
                            Component.literal("B tracks the ripple anchor"));
                })
                .thenExecute(() -> {
                    Mock mockB = requireMock(helper, mockBRef);
                    int sent = 0;
                    for (int i = 0; i < FxBudgets.RIPPLE_SENDS_PER_SECOND; i++) {
                        sent += FxRippleBroadcaster.broadcast(
                                level, anchor, RADIUS_Q8, COPPER_ARGB);
                    }
                    helper.assertValueEqual(FxBudgets.RIPPLE_SENDS_PER_SECOND, sent,
                            Component.literal("fresh B receives its full send budget"));
                    helper.assertValueEqual(0, FxRippleBroadcaster.broadcast(
                                    level, anchor, RADIUS_Q8, COPPER_ARGB),
                            Component.literal("B's overflow send is coalesced"));
                })
                .thenWaitUntil(() -> helper.assertTrue(staleCleanupDrained.get(),
                        Component.literal("old pre-sweep cleanup has not drained")))
                .thenExecute(() -> {
                    Mock mockB = requireMock(helper, mockBRef);
                    helper.assertTrue(FxRippleBroadcaster.isOwnedByForTesting(
                                    uuid, mockB.player().connection),
                            Component.literal("old cleanup cannot erase next-lifecycle B"));
                    helper.assertValueEqual(0, FxRippleBroadcaster.broadcast(
                                    level, anchor, RADIUS_Q8, COPPER_ARGB),
                            Component.literal("old cleanup cannot reset B's active window"));
                    helper.assertValueEqual(FxBudgets.RIPPLE_SENDS_PER_SECOND,
                            mockB.sentPayloads(FxRipplePayload.class).size(),
                            Component.literal("B remains capped after the race"));

                    FxRippleBroadcaster.handleServerStopped();
                    mockB.close();
                    helper.assertValueEqual(0, FxRippleBroadcaster.trackedWindowCount(),
                            Component.literal("second lifecycle leaves no session state"));
                })
                .thenSucceed();
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
