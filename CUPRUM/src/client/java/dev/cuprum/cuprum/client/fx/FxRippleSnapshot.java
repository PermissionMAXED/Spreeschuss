package dev.cuprum.cuprum.client.fx;

import dev.cuprum.cuprum.fx.FxRipplePayload;
import dev.cuprum.cuprum.fx.core.RippleMath;
import net.minecraft.core.BlockPos;

/**
 * Immutable client-side ripple snapshot (client-fx.md §5): the payload after presentation
 * resolution. Colorblind remap is applied exactly <b>here</b>, once at snapshot creation —
 * never per frame and never on the wire. {@code startGameTime} is the server's event time;
 * the animation phase is {@code clientGameTime - startGameTime}, tick-quantized (§4), so every
 * client renders the identical deterministic ripple for the identical event.
 */
public record FxRippleSnapshot(BlockPos center, float maxRadius, int colorArgb, long startGameTime) {
    /** Pure payload → snapshot conversion; the only place the colorblind remap runs. */
    public static FxRippleSnapshot of(FxRipplePayload payload) {
        return new FxRippleSnapshot(
                payload.center(),
                RippleMath.fromQ8(payload.radiusQ8()),
                FxSettings.remapColor(payload.colorArgb()),
                payload.gameTime());
    }
}
