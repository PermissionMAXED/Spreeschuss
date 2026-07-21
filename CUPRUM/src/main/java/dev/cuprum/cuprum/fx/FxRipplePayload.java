package dev.cuprum.cuprum.fx;

import dev.cuprum.cuprum.Cuprum;
import dev.cuprum.cuprum.fx.core.FxBudgets;
import dev.cuprum.cuprum.fx.core.RippleMath;
import net.minecraft.core.BlockPos;
import net.minecraft.network.RegistryFriendlyByteBuf;
import net.minecraft.network.codec.ByteBufCodecs;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.ResourceLocation;

/**
 * S2C ripple event ({@code cuprum:s2c/fx/ripple}, plan §3.2 / D3 id convention): one expanding
 * diagnostic ripple anchored at {@code center}. Immutable and <b>frozen after W1D</b> — new
 * effects add NEW payload records (client-fx.md §14). Wire budget <=
 * {@value dev.cuprum.cuprum.fx.core.FxBudgets#RIPPLE_PAYLOAD_MAX_BYTES} bytes (BlockPos 8 +
 * radius VAR_INT <=3 + color VAR_INT <=5 + gameTime VAR_LONG <=10 = at most 26 payload bytes).
 *
 * <p>Contract (plan §3.2 codec rules): bounded primitives only, canonical constructor rejects
 * (never clamps) out-of-bounds values, S2C event is idempotent and loss-tolerant. The server
 * game time seeds the deterministic client animation phase
 * ({@code clientGameTime - gameTime}, tick-quantized — client-fx.md §4).
 *
 * @param center    the anchor block (the FX probe position)
 * @param radiusQ8  maximum ripple radius in Q8.8 fixed point (blocks x 256), bounds-checked
 * @param colorArgb packed ARGB ripple color (colorblind remap happens client-side at snapshot
 *                  creation, never on the wire)
 * @param gameTime  server game time of the emitting event (absolute-deadline rule, plan §3.1)
 */
public record FxRipplePayload(BlockPos center, int radiusQ8, int colorArgb, long gameTime)
        implements CustomPacketPayload {
    public static final CustomPacketPayload.Type<FxRipplePayload> TYPE =
            new CustomPacketPayload.Type<>(ResourceLocation.fromNamespaceAndPath(Cuprum.MOD_ID, "s2c/fx/ripple"));

    public static final StreamCodec<RegistryFriendlyByteBuf, FxRipplePayload> STREAM_CODEC = StreamCodec.composite(
            BlockPos.STREAM_CODEC, FxRipplePayload::center,
            ByteBufCodecs.VAR_INT, FxRipplePayload::radiusQ8,
            ByteBufCodecs.VAR_INT, FxRipplePayload::colorArgb,
            ByteBufCodecs.VAR_LONG, FxRipplePayload::gameTime,
            FxRipplePayload::new);

    public FxRipplePayload {
        if (!RippleMath.isValidRadiusQ8(radiusQ8)) {
            throw new IllegalArgumentException(
                    "radiusQ8 out of bounds (0, " + FxBudgets.MAX_RADIUS_Q8 + "]: " + radiusQ8);
        }
    }

    @Override
    public CustomPacketPayload.Type<? extends CustomPacketPayload> type() {
        return TYPE;
    }
}
