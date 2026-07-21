package dev.cuprum.cuprum.client.fx.render;

import dev.cuprum.cuprum.client.fx.FxTier;
import dev.cuprum.cuprum.fx.core.FxBudgets;
import net.minecraft.client.renderer.blockentity.state.BlockEntityRenderState;

/**
 * The FX probe's extracted render state (client-fx.md §4): preallocated primitives only — no
 * live game objects retained past extraction. Radii and normalized lifetimes are tick-quantized
 * floats (the diagnostic ripple ignores partialTick so client GameTest screenshots are
 * frame-rate independent). The T1 emitter packs signed band coordinate + lifetime into UV0;
 * the shader owns the authored quartic profile and life tint/fade.
 */
public final class FxProbeRenderState extends BlockEntityRenderState {
    public final long[] rippleStartTick = new long[FxBudgets.MAX_RIPPLES];
    public final int[] rippleColorArgb = new int[FxBudgets.MAX_RIPPLES];
    /** Current (tick-quantized) ring radius in blocks. */
    public final float[] rippleRadius = new float[FxBudgets.MAX_RIPPLES];
    /** Normalized age in [0,1), encoded as UV0.y by the T1 emitter. */
    public final float[] rippleLife = new float[FxBudgets.MAX_RIPPLES];
    public int rippleCount;
    public FxTier tier = FxTier.OFF;
}
