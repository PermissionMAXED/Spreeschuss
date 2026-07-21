package dev.cuprum.cuprum.fx.core;

/**
 * MC-free ripple radius fixed-point + animation math (plan D9). The wire format carries the
 * maximum ripple radius in unsigned Q8.8 fixed point ({@code radius x 256}); the diagnostic
 * animation phase is <b>tick-quantized</b> (client-fx.md §4: no partialTick) so client
 * GameTest screenshots are frame-rate independent.
 */
public final class RippleMath {
    /** Q8.8 scale factor: one block = 256 radius units on the wire. */
    public static final int Q8_ONE = 256;

    private RippleMath() {
    }

    /** Quantizes a block radius to wire Q8.8, clamped to (0, {@link FxBudgets#MAX_RADIUS_Q8}]. */
    public static int toQ8(float radiusBlocks) {
        if (Float.isNaN(radiusBlocks)) {
            return 0;
        }
        long q8 = Math.round((double) radiusBlocks * Q8_ONE);
        if (q8 <= 0) {
            return 0;
        }
        return (int) Math.min(q8, FxBudgets.MAX_RADIUS_Q8);
    }

    /** Reverses {@link #toQ8}: wire Q8.8 back to a block radius. */
    public static float fromQ8(int radiusQ8) {
        return radiusQ8 / (float) Q8_ONE;
    }

    /** True when the wire value is inside the payload contract bounds (reject, never clamp). */
    public static boolean isValidRadiusQ8(int radiusQ8) {
        return radiusQ8 > 0 && radiusQ8 <= FxBudgets.MAX_RADIUS_Q8;
    }

    /**
     * Tick-quantized ripple radius: linear expansion from 0 to {@code maxRadiusQ8} over
     * {@code lifetimeTicks}, returned in Q8.8. Out-of-life ages return 0 (not drawn).
     */
    public static int radiusQ8AtAge(int maxRadiusQ8, long ageTicks, int lifetimeTicks) {
        if (ageTicks < 0 || ageTicks >= lifetimeTicks || lifetimeTicks <= 0) {
            return 0;
        }
        return (int) (maxRadiusQ8 * ageTicks / lifetimeTicks);
    }

    /**
     * Tick-quantized ripple opacity in [0, 255]: full at birth, linear fade-out over the
     * lifetime. Out-of-life ages return 0.
     */
    public static int alphaAtAge(long ageTicks, int lifetimeTicks) {
        if (ageTicks < 0 || ageTicks >= lifetimeTicks || lifetimeTicks <= 0) {
            return 0;
        }
        return (int) (255 - 255 * ageTicks / lifetimeTicks);
    }
}
