package dev.cuprum.cuprum.gametest.net;

import net.minecraft.core.BlockPos;
import net.minecraft.network.RegistryFriendlyByteBuf;
import net.minecraft.network.codec.ByteBufCodecs;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.ResourceLocation;

/**
 * GameTest-only guarded C2S payload ({@code cuprum-gametest:c2s/guard_probe}): carries a target
 * position (range check input) and a marker (VALUE check input, {@code >= 0} is valid). Its
 * registration in {@link dev.cuprum.cuprum.gametest.CuprumGametestInit} wires counting
 * spec-factory / claim-resolver / state hooks so tests can prove the dispatch pipeline's
 * laziness ordering (no spec construction after liveness/rate rejection, no claim/state
 * resolution after range rejection). Bounded primitives only, like every Cuprum payload.
 */
public record GuardProbePayload(BlockPos pos, int marker) implements CustomPacketPayload {
    public static final CustomPacketPayload.Type<GuardProbePayload> TYPE = new CustomPacketPayload.Type<>(
            ResourceLocation.fromNamespaceAndPath("cuprum-gametest", "c2s/guard_probe"));

    public static final StreamCodec<RegistryFriendlyByteBuf, GuardProbePayload> STREAM_CODEC =
            StreamCodec.composite(
                    BlockPos.STREAM_CODEC, GuardProbePayload::pos,
                    ByteBufCodecs.VAR_INT, GuardProbePayload::marker,
                    GuardProbePayload::new);

    @Override
    public CustomPacketPayload.Type<? extends CustomPacketPayload> type() {
        return TYPE;
    }
}
