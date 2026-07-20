package dev.cuprum.cuprum.net;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerTickEvents;
import net.fabricmc.fabric.api.networking.v1.EntityTrackingEvents;
import net.fabricmc.fabric.api.networking.v1.PayloadTypeRegistry;
import net.fabricmc.fabric.api.networking.v1.PlayerLookup;
import net.fabricmc.fabric.api.networking.v1.ServerConfigurationNetworking;
import net.fabricmc.fabric.api.networking.v1.ServerPlayConnectionEvents;
import net.fabricmc.fabric.api.networking.v1.ServerPlayNetworking;
import net.minecraft.core.BlockPos;
import net.minecraft.core.UUIDUtil;
import net.minecraft.network.FriendlyByteBuf;
import net.minecraft.network.RegistryFriendlyByteBuf;
import net.minecraft.network.chat.Component;
import net.minecraft.network.codec.ByteBufCodecs;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.server.network.ServerCommonPacketListenerImpl;
import net.minecraft.server.network.ServerConfigurationPacketListenerImpl;
import net.minecraft.world.level.ChunkPos;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.inventory.AbstractContainerMenu;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.entity.BlockEntity;
import net.minecraft.world.scores.PlayerTeam;
import net.minecraft.world.scores.Scoreboard;

/**
 * Compile-time signature probe for the 1.21.9 networking stack (net-state.md §10, frozen
 * {@code RenderApiProbe} rules): every member below is a typed reference to the exact API the net
 * module uses, so an upstream signature change fails this module's compilation immediately.
 *
 * <p>Nothing here is ever invoked: all members are private, the class is never instantiated and
 * no static initializer performs work. See docs/API_PROBES.md ("Networking & state").
 */
public final class NetApiProbe {
    private NetApiProbe() {
    }

    /** Probe 1: a record payload + Type + TypeAndCodec, the shape of every Cuprum payload. */
    private record ProbePayload(int value) implements CustomPacketPayload {
        private static final CustomPacketPayload.Type<ProbePayload> TYPE =
                new CustomPacketPayload.Type<>(ResourceLocation.fromNamespaceAndPath("cuprum", "probe"));
        private static final StreamCodec<RegistryFriendlyByteBuf, ProbePayload> STREAM_CODEC =
                StreamCodec.composite(ByteBufCodecs.VAR_INT, ProbePayload::value, ProbePayload::new);

        @Override
        public CustomPacketPayload.Type<? extends CustomPacketPayload> type() {
            return TYPE;
        }
    }

    /** Probe 2: all four payload-type registries and their register signature. */
    private static <C extends CustomPacketPayload> void probePayloadTypeRegistries(
            CustomPacketPayload.Type<C> configType, StreamCodec<FriendlyByteBuf, C> configCodec) {
        CustomPacketPayload.TypeAndCodec<? super RegistryFriendlyByteBuf, ProbePayload> playC2s =
                PayloadTypeRegistry.playC2S().register(ProbePayload.TYPE, ProbePayload.STREAM_CODEC);
        CustomPacketPayload.TypeAndCodec<? super RegistryFriendlyByteBuf, ProbePayload> playS2c =
                PayloadTypeRegistry.playS2C().register(ProbePayload.TYPE, ProbePayload.STREAM_CODEC);
        PayloadTypeRegistry.configurationC2S().register(configType, configCodec);
        PayloadTypeRegistry.configurationS2C().register(configType, configCodec);
    }

    /** Probe 3: play receiver registration, handler context members, send + canSend. */
    private static void probeServerPlayNetworking(ServerPlayer player) {
        ServerPlayNetworking.registerGlobalReceiver(ProbePayload.TYPE, (payload, context) -> {
            MinecraftServer server = context.server();
            ServerPlayer sender = context.player();
            context.responseSender().sendPacket(new ProbePayload(payload.value()));
        });
        ServerPlayNetworking.send(player, new ProbePayload(0));
        boolean canSend = ServerPlayNetworking.canSend(player, ProbePayload.TYPE);
    }

    /** Probe 4: configuration-phase receiver registration and send. */
    private static <C extends CustomPacketPayload> void probeServerConfigurationNetworking(
            CustomPacketPayload.Type<C> type, ServerConfigurationPacketListenerImpl handler, C payload) {
        ServerConfigurationNetworking.registerGlobalReceiver(type, (received, context) -> {
        });
        ServerConfigurationNetworking.send(handler, payload);
    }

    /** Probe 5: player lookups used for targeted S2C sends. */
    private static void probePlayerLookup(ServerLevel level, ChunkPos chunkPos, BlockEntity blockEntity, Entity entity) {
        PlayerLookup.tracking(level, chunkPos);
        PlayerLookup.tracking(blockEntity);
        PlayerLookup.tracking(entity);
    }

    /** Probe 6: connection/tick/tracking lifecycle events driving buckets and counters. */
    private static void probeLifecycleEvents() {
        ServerPlayConnectionEvents.JOIN.register((handler, sender, server) -> {
        });
        ServerPlayConnectionEvents.DISCONNECT.register((handler, server) -> {
        });
        EntityTrackingEvents.START_TRACKING.register((trackedEntity, player) -> {
        });
        ServerTickEvents.END_SERVER_TICK.register(server -> {
        });
    }

    /** Probe 7: the bounded codec primitives every Cuprum codec is restricted to (plan §3.2). */
    private static void probeBoundedCodecPrimitives() {
        StreamCodec<io.netty.buffer.ByteBuf, String> boundedString = ByteBufCodecs.stringUtf8(64);
        StreamCodec<io.netty.buffer.ByteBuf, byte[]> boundedBytes = ByteBufCodecs.byteArray(256);
        StreamCodec<io.netty.buffer.ByteBuf, List<Integer>> boundedList =
                ByteBufCodecs.collection(ArrayList::new, ByteBufCodecs.VAR_INT, 16);
        StreamCodec<io.netty.buffer.ByteBuf, GuardProbeEnum> total =
                ByteBufCodecs.idMapper(i -> GuardProbeEnum.values()[i], GuardProbeEnum::ordinal);
        StreamCodec<io.netty.buffer.ByteBuf, UUID> uuid = UUIDUtil.STREAM_CODEC;
        StreamCodec<io.netty.buffer.ByteBuf, BlockPos> pos = BlockPos.STREAM_CODEC;
    }

    private enum GuardProbeEnum {
        A, B
    }

    /** Probe 8: menu identity/validity members used by the guard's MENU step. */
    private static boolean probeMenuMembers(AbstractContainerMenu menu, Player player, int containerId) {
        return menu.containerId == containerId && menu.stillValid(player);
    }

    /** Probe 9: kick + vanilla permission fallback used by violations and {@code Perms}. */
    private static void probeDisconnectAndPermissions(ServerCommonPacketListenerImpl listener, Player player) {
        listener.disconnect(Component.literal("probe"));
        boolean hasOp2 = player.hasPermissions(2);
    }

    /** Probe 10: resolved open points from net-state §10 — loaded-chunk check and team lookup. */
    private static void probeResolvedOpenPoints(Level level, BlockPos pos, Scoreboard scoreboard, Player player) {
        boolean loaded = level.isLoaded(pos);
        PlayerTeam byName = scoreboard.getPlayersTeam("owner");
        PlayerTeam own = player.getTeam();
    }
}
