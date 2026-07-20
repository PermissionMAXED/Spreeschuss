package dev.cuprum.cuprum.net.payload;

import dev.cuprum.cuprum.Cuprum;
import dev.cuprum.cuprum.net.NetBounds;
import net.minecraft.network.RegistryFriendlyByteBuf;
import net.minecraft.network.codec.ByteBufCodecs;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.ResourceLocation;

/**
 * C2S diagnostics echo request ({@code cuprum:c2s/diag/echo}): the W1A pipeline exerciser.
 * Permission-gated ({@code cuprum.diagnostics}, fallback OP 2) and rate-limited
 * ({@link dev.cuprum.cuprum.net.server.RateKey#DEFAULT}) through the mandatory C2S guard.
 *
 * <p>Codec contract (plan §3.2): immutable record, bounded primitives only
 * ({@code VAR_INT} + {@code stringUtf8(64)}), canonical constructor bounds-checks and throws
 * (decode-time throw disconnects the peer). Wire size is far below the 512 B C2S default cap.
 */
public record DiagEchoPayload(int nonce, String note) implements CustomPacketPayload {
    /** Maximum {@code note} length in UTF-16 code units (also the codec's decode cap). */
    public static final int MAX_NOTE_LENGTH = 64;

    public static final CustomPacketPayload.Type<DiagEchoPayload> TYPE =
            new CustomPacketPayload.Type<>(ResourceLocation.fromNamespaceAndPath(Cuprum.MOD_ID, "c2s/diag/echo"));

    public static final StreamCodec<RegistryFriendlyByteBuf, DiagEchoPayload> STREAM_CODEC = StreamCodec.composite(
            ByteBufCodecs.VAR_INT, DiagEchoPayload::nonce,
            ByteBufCodecs.stringUtf8(MAX_NOTE_LENGTH), DiagEchoPayload::note,
            DiagEchoPayload::new);

    public DiagEchoPayload {
        note = NetBounds.requireBounded(note, MAX_NOTE_LENGTH, "note");
    }

    /**
     * Semantic value validation for the guard's VALUE step: the note must still fit the bound
     * after NFC normalization (the form the server uses) and must be free of C0/C1 control
     * characters and line/paragraph separators (log-injection surface). Invalid values are
     * rejected as violations, never clamped or stripped (plan §3.2).
     */
    public static boolean isValidNote(String note) {
        if (!NetBounds.fitsLengthNfc(note, MAX_NOTE_LENGTH)) {
            return false;
        }
        return NetBounds.isLogSafe(NetBounds.toNfc(note));
    }

    @Override
    public CustomPacketPayload.Type<? extends CustomPacketPayload> type() {
        return TYPE;
    }
}
