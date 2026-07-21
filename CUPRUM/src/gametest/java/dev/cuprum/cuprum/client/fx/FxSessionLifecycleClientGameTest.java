package dev.cuprum.cuprum.client.fx;

import dev.cuprum.cuprum.client.config.CuprumClientConfigs;
import dev.cuprum.cuprum.client.fx.render.CuprumRenderTypes;
import dev.cuprum.cuprum.fx.FxRippleBroadcaster;
import dev.cuprum.cuprum.fx.FxRipplePayload;
import dev.cuprum.cuprum.fx.core.FxBudgets;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import net.fabricmc.fabric.api.client.gametest.v1.FabricClientGameTest;
import net.fabricmc.fabric.api.client.gametest.v1.context.ClientGameTestContext;
import net.fabricmc.fabric.api.client.gametest.v1.context.TestSingleplayerContext;
import net.fabricmc.fabric.api.client.networking.v1.ClientPlayConnectionEvents;
import net.fabricmc.fabric.api.networking.v1.PacketSender;
import net.minecraft.client.Minecraft;
import net.minecraft.client.multiplayer.ClientPacketListener;
import net.minecraft.core.BlockPos;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.level.Level;

/**
 * Permanent production-event regression for the client FX session-source race. It captures the
 * exact JOIN handler and response sender for distinct sessions A and B, then proves:
 *
 * <ol>
 *   <li>JOIN synchronously clears an exact non-empty 1/1/1 state before atomically reinstalling
 *       B's identities,</li>
 *   <li>a queued payload from A cannot mutate after B has joined,</li>
 *   <li>a valid real S2C payload from B is accepted,</li>
 *   <li>A's stale foreign-thread DISCONNECT cannot clear B's exact state,</li>
 *   <li>B's own disconnect clears it, and a queued B payload cannot resurrect it.</li>
 * </ol>
 */
public class FxSessionLifecycleClientGameTest implements FabricClientGameTest {
    private static final BlockPos RIPPLE_POS = new BlockPos(0, -60, 3);
    private static final int RADIUS_Q8 = 768;
    private static final int COPPER_ARGB = 0xFFE77C56;
    private static final long JOIN_TIMEOUT_MS = TimeUnit.SECONDS.toMillis(10);

    @Override
    public void runTest(ClientGameTestContext context) {
        ClientPacketListener handlerA;
        PacketSender senderA;
        FxRipplePayload queuedPayloadA;

        try (TestSingleplayerContext worldA = context.worldBuilder().create()) {
            worldA.getClientWorld().waitForChunksRender();
            handlerA = context.computeOnClient(Minecraft::getConnection);
            senderA = context.computeOnClient(client -> FxClientModule.activeFxResponseSenderForTesting());
            require(handlerA != null, "session A must have a live connection");
            require(senderA != null, "session A must expose its exact JOIN response sender");
            queuedPayloadA = context.computeOnClient(client -> new FxRipplePayload(
                    RIPPLE_POS, RADIUS_Q8, COPPER_ARGB, client.level.getGameTime()));
        }

        PacketSender senderB;
        FxRipplePayload queuedPayloadB;
        try (TestSingleplayerContext worldB = context.worldBuilder().create()) {
            worldB.getClientWorld().waitForChunksRender();
            ClientPacketListener handlerB = context.computeOnClient(Minecraft::getConnection);
            senderB = context.computeOnClient(client -> FxClientModule.activeFxResponseSenderForTesting());
            require(handlerB != null, "session B must have a live connection");
            require(senderB != null, "session B must expose its exact JOIN response sender");
            require(handlerB != handlerA, "B must have a distinct connection identity from A");
            require(senderB != senderA, "B must have a distinct response-sender identity from A");
            require(context.computeOnClient(client -> CuprumClientConfigs.hasCommonOverlay()),
                    "B's JOIN must have installed the config overlay");
            requireFxState(context, 0, 0L, 0L, "B isolated JOIN state");

            // Non-vacuous atomic JOIN proof: seed all three stores and invoke the registered
            // production listeners synchronously in the very same client-thread turn.
            context.runOnClient(client -> {
                seedFxStateNow(client.level.getGameTime(), client.level.dimension());
                requireFxStateNow(1, 1L, 1L, "state immediately before synchronous B JOIN");
                ClientPlayConnectionEvents.JOIN.invoker().onPlayReady(handlerB, senderB, client);
                requireFxStateNow(0, 0L, 0L, "state immediately after synchronous B JOIN");
                require(FxClientModule.activeFxResponseSenderForTesting() == senderB,
                        "B JOIN must atomically reinstall the exact response sender");
            });

            // Deterministic queued-A delivery through the production receive seam. The current
            // world is B, so only sender identity can reject this otherwise valid payload.
            boolean acceptedA = context.computeOnClient(client -> FxClientModule.receiveRipple(
                    queuedPayloadA, senderA, client.level.dimension()));
            require(!acceptedA, "queued A payload must be rejected after B JOIN");
            requireFxState(context, 0, 0L, 0L, "B state after queued A payload");

            // Real S2C delivery proves the payload context's responseSender is the same exact
            // identity supplied to B's JOIN callback.
            int sent = worldB.getServer().computeOnServer(server -> {
                ServerPlayer player = server.getPlayerList().getPlayers().getFirst();
                return FxRippleBroadcaster.broadcast(
                        server.overworld(), player.blockPosition(), RADIUS_Q8, COPPER_ARGB);
            });
            require(sent == 1, "server must send exactly one valid B ripple payload");
            context.waitTicks(10);
            requireFxState(context, 1, 0L, 0L, "B state after valid real payload");

            queuedPayloadB = context.computeOnClient(client -> new FxRipplePayload(
                    RIPPLE_POS.offset(1, 0, 0), RADIUS_Q8, COPPER_ARGB,
                    client.level.getGameTime()));
            context.runOnClient(client -> seedCountersNow(client.level.getGameTime()));
            requireFxState(context, 1, 1L, 1L, "B state before stale A disconnect");

            Minecraft client = context.computeOnClient(instance -> instance);
            AtomicReference<Throwable> nettyFailure = new AtomicReference<>();
            Thread nettyThread = new Thread(() -> {
                try {
                    ClientPlayConnectionEvents.DISCONNECT.invoker()
                            .onPlayDisconnect(handlerA, client);
                } catch (Throwable throwable) {
                    nettyFailure.set(throwable);
                }
            }, "cuprum-gametest-fx-stale-disconnect");
            nettyThread.start();
            joinOrThrow(nettyThread);
            if (nettyFailure.get() != null) {
                throw new IllegalStateException("stale disconnect delivery failed", nettyFailure.get());
            }

            requireFxState(context, 1, 1L, 1L, "B state after stale A disconnect");
            require(context.computeOnClient(instance -> CuprumClientConfigs.hasCommonOverlay()),
                    "B's config overlay must survive stale A");
        }

        requireFxState(context, 0, 0L, 0L, "B state after own disconnect");
        require(!context.computeOnClient(client -> CuprumClientConfigs.hasCommonOverlay()),
                "B's own disconnect must drop the config overlay");

        // Supply a valid dimension explicitly so this cannot pass merely because the client
        // world is now null. The cleared response-sender identity must reject B itself.
        boolean acceptedBPostDisconnect = context.computeOnClient(client ->
                FxClientModule.receiveRipple(queuedPayloadB, senderB, Level.OVERWORLD));
        require(!acceptedBPostDisconnect, "queued B payload must be rejected after B disconnect");
        requireFxState(context, 0, 0L, 0L, "state after queued B post-disconnect payload");
    }

    private static void seedFxStateNow(long gameTime,
            net.minecraft.resources.ResourceKey<Level> dimension) {
        require(FxDispatcher.get().enqueueRippleFromDimension(
                new FxRippleSnapshot(RIPPLE_POS, 3.0f, COPPER_ARGB, gameTime),
                dimension, dimension), "ripple pool seed must be accepted");
        seedCountersNow(gameTime);
    }

    private static void seedCountersNow(long gameTime) {
        FxFrameStats.beginFrame(new Object());
        FxFrameStats.recordSubmit(CuprumRenderTypes.FX_RIPPLE, FxBudgets.RIPPLE_VERTICES);
        require(FxParticleBudget.trySpawnAt(gameTime, () -> { }),
                "particle budget seed must be accepted");
    }

    private static void requireFxState(ClientGameTestContext context, int expectedPool,
            long expectedSubmits, long expectedParticles, String label) {
        require(context.computeOnClient(client -> FxDispatcher.get().liveRippleCount()) == expectedPool,
                label + ": ripple pool");
        require(context.computeOnClient(client -> FxFrameStats.customPipelineSubmits()) == expectedSubmits,
                label + ": frame submit counter");
        require(context.computeOnClient(client -> FxParticleBudget.acceptedTotal()) == expectedParticles,
                label + ": particle accepted counter");
        require(context.computeOnClient(client -> FxParticleBudget.liveEstimate()) == expectedParticles,
                label + ": particle live estimate");
    }

    private static void requireFxStateNow(int expectedPool,
            long expectedSubmits, long expectedParticles, String label) {
        require(FxDispatcher.get().liveRippleCount() == expectedPool, label + ": ripple pool");
        require(FxFrameStats.customPipelineSubmits() == expectedSubmits,
                label + ": frame submit counter");
        require(FxParticleBudget.acceptedTotal() == expectedParticles,
                label + ": particle accepted counter");
        require(FxParticleBudget.liveEstimate() == expectedParticles,
                label + ": particle live estimate");
    }

    private static void require(boolean condition, String message) {
        if (!condition) {
            throw new AssertionError(message);
        }
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
