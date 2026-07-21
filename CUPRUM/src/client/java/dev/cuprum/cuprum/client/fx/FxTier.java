package dev.cuprum.cuprum.client.fx;

/**
 * The FX tier ladder (client-fx.md §1, INDEX vocabulary): <b>T1</b> = custom
 * {@code GpuDevice}/{@code RenderPipeline} shader path, <b>T2</b> = vanilla-pipeline fallback
 * (vanilla RenderTypes + particles), <b>T3</b> = minimal static fallback (particles only),
 * <b>OFF</b> = terminal failure rung (log only, draw nothing). Ordinal order IS the ladder
 * order: a larger ordinal is a lower capability, so cap resolution is a plain {@code max} on
 * ordinals ({@link FxTierPolicy}).
 *
 * <p>Tier selection is presentation-only; nothing in {@code client.fx} may change gameplay
 * outcomes (QOL-04 invariant).
 */
public enum FxTier {
    T1,
    T2,
    T3,
    OFF;

    /** The lower (more restrictive) of two rungs — cap composition primitive. */
    public static FxTier lowerOf(FxTier a, FxTier b) {
        return a.ordinal() >= b.ordinal() ? a : b;
    }
}
