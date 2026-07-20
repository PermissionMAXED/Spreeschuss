package dev.cuprum.cuprum.gametest.net;

import com.mojang.authlib.GameProfile;
import io.netty.channel.embedded.EmbeddedChannel;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import net.minecraft.gametest.framework.GameTestHelper;
import net.minecraft.network.Connection;
import net.minecraft.network.DisconnectionDetails;
import net.minecraft.network.chat.Component;
import net.minecraft.network.protocol.PacketFlow;
import net.minecraft.network.protocol.common.ClientboundCustomPayloadPacket;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.server.network.CommonListenerCookie;

/**
 * Creates a fully connected mock {@link ServerPlayer} for server GameTests: a real
 * {@code ServerPlayer} joined through {@code PlayerList.placeNewPlayer} over an
 * {@link EmbeddedChannel}, so the Fabric JOIN event fires (rate buckets, config sync) and every
 * packet the server sends can be inspected from the channel's outbound queue. This replicates the
 * only vanilla helper for the job ({@code GameTestHelper.makeMockServerPlayerInLevel}) which is
 * {@code @Deprecated(forRemoval)} and would fail the {@code -Werror} lint gate.
 *
 * <p>UUIDs are <b>deterministic</b> (name-derived via {@link UUID#nameUUIDFromBytes}) so runs
 * are reproducible; test player names are unique per test, which keeps the UUIDs unique too.
 *
 * <p>Threading: everything here runs on the server thread. The {@link EmbeddedChannel} executes
 * its pipeline inline on the calling thread — there is no separate Netty event loop for mocks —
 * so {@link Mock#close()} fires {@code Connection.channelInactive} (and with it Fabric's real
 * {@code ServerPlayConnectionEvents.DISCONNECT}, via Fabric's {@code ClientConnectionMixin})
 * synchronously on the server thread. On a real server that event may instead fire on a Netty
 * event-loop thread; the per-connection state owners document that.
 *
 * <p>Always used try-with-resources: {@link Mock#close()} runs the real disconnect path
 * (channel close → Fabric DISCONNECT event → {@code Connection.handleDisconnection()} →
 * {@code ServerGamePacketListenerImpl.onDisconnect} → PlayerList removal), so no per-connection
 * state leaks between tests — asserted by {@code NetGuardGameTest.disconnectDropsPerConnectionState}.
 */
public final class MockServerPlayers {
    private MockServerPlayers() {
    }

    /** A connected mock player plus its embedded channel (server → client packet capture). */
    public record Mock(ServerPlayer player, Connection connection, EmbeddedChannel channel)
            implements AutoCloseable {
        /**
         * All payloads of {@code type} the server sent to this connection so far, in order.
         *
         * <p>Flushes the channel first: {@code MinecraftServer.tickChildren} calls
         * {@code suspendFlushing()} on every listed connection at the head of each tick and
         * {@code resumeFlushing()} only at its "send chunks" phase — which runs <b>after</b> the
         * gameTests phase. A packet sent from a GameTest tick (e.g. a {@code thenExecute} step)
         * is therefore written but not yet flushed into the embedded channel's outbound queue
         * when the same step reads it back. {@code flushChannel()} runs inline here (the
         * embedded event loop is the calling thread) and makes reads exact; it does not clear
         * the suspend flag, so production flush semantics are untouched.
         */
        public <T extends CustomPacketPayload> List<T> sentPayloads(Class<T> type) {
            connection.flushChannel();
            List<T> result = new ArrayList<>();
            for (Object message : channel.outboundMessages()) {
                if (message instanceof ClientboundCustomPayloadPacket packet && type.isInstance(packet.payload())) {
                    result.add(type.cast(packet.payload()));
                }
            }
            return result;
        }

        @Override
        public void close() {
            // Real disconnect, in vanilla order: disconnect() closes the embedded channel, which
            // fires Connection.channelInactive inline — Fabric's ClientConnectionMixin turns
            // that into the real ServerPlayConnectionEvents.DISCONNECT (once, CAS-guarded).
            // handleDisconnection() then dispatches ServerGamePacketListenerImpl.onDisconnect
            // with the stored details, removing the player from the PlayerList.
            connection.disconnect(new DisconnectionDetails(Component.literal("gametest teardown")));
            connection.handleDisconnection();
        }
    }

    /** Connects a fresh mock player ({@code name} ≤16 chars, unique per test) to the server. */
    public static Mock connect(GameTestHelper helper, String name) {
        MinecraftServer server = helper.getLevel().getServer();
        UUID uuid = UUID.nameUUIDFromBytes(("cuprum-gametest:" + name).getBytes(StandardCharsets.UTF_8));
        CommonListenerCookie cookie =
                CommonListenerCookie.createInitial(new GameProfile(uuid, name), false);
        ServerPlayer player = new ServerPlayer(
                server, helper.getLevel(), cookie.gameProfile(), cookie.clientInformation());
        Connection connection = new Connection(PacketFlow.SERVERBOUND);
        EmbeddedChannel channel = new EmbeddedChannel(connection);
        server.getPlayerList().placeNewPlayer(connection, player, cookie);
        return new Mock(player, connection, channel);
    }

    /**
     * Grants the mock player vanilla OP level 2 (the W1 fallback for {@code cuprum.*}
     * permissions). The level must be explicit: {@code GameTestServer.operatorUserPermissionLevel()}
     * returns 0, so the plain {@code op(NameAndId)} overload would grant a useless level-0 entry.
     */
    public static void op(Mock mock) {
        mock.player().level().getServer().getPlayerList()
                .op(mock.player().nameAndId(), Optional.of(2), Optional.of(false));
    }
}
