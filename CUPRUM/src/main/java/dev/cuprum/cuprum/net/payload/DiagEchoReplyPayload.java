package dev.cuprum.cuprum.net.payload;

import dev.cuprum.cuprum.Cuprum;
import dev.cuprum.cuprum.net.NetBounds;
import net.minecraft.network.RegistryFriendlyByteBuf;
import net.minecraft.network.codec.ByteBufCodecs;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.ResourceLocation;

/**
 * S2C diagnostics echo reply ({@code cuprum:s2c/diag/echo_reply}): mirrors the request nonce and
 * reports the server game time plus the canonical catalog SHA-256. Idempotent and loss-tolerant
 * like every Cuprum S2C event (plan §3.2); size is well below the 8 KiB S2C default cap.
 */
public record DiagEchoReplyPayload(int nonce, long gameTime, String catalogSha) implements CustomPacketPayload {
    /** SHA-256 hex digests are exactly 64 characters; the codec cap matches. */
    public static final int MAX_SHA_LENGTH = 64;

    public static final CustomPacketPayload.Type<DiagEchoReplyPayload> TYPE =
            new CustomPacketPayload.Type<>(ResourceLocation.fromNamespaceAndPath(Cuprum.MOD_ID, "s2c/diag/echo_reply"));

    public static final StreamCodec<RegistryFriendlyByteBuf, DiagEchoReplyPayload> STREAM_CODEC = StreamCodec.composite(
            ByteBufCodecs.VAR_INT, DiagEchoReplyPayload::nonce,
            ByteBufCodecs.VAR_LONG, DiagEchoReplyPayload::gameTime,
            ByteBufCodecs.stringUtf8(MAX_SHA_LENGTH), DiagEchoReplyPayload::catalogSha,
            DiagEchoReplyPayload::new);

    public DiagEchoReplyPayload {
        catalogSha = NetBounds.requireBounded(catalogSha, MAX_SHA_LENGTH, "catalogSha");
    }

    @Override
    public CustomPacketPayload.Type<? extends CustomPacketPayload> type() {
        return TYPE;
    }
}
