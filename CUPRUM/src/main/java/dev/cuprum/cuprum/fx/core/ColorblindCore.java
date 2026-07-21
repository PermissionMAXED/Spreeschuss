package dev.cuprum.cuprum.fx.core;

/**
 * MC-free colorblind ARGB remap math (plan D9; QOL-05 groundwork). A remap is a row-major
 * 3x3 linear matrix applied to the RGB channels (alpha always passes through unchanged);
 * results are clamped to [0, 255]. The identity matrix is a guaranteed no-op bit-for-bit.
 *
 * <p>The matrices themselves ship in {@code assets/cuprum/fx/colorblind.json} and are parsed
 * client-side ({@code ColorblindPalettes}); this class owns only the arithmetic so it is unit
 * testable without Minecraft classes.
 */
public final class ColorblindCore {
    /** Row-major identity; remapping with it returns the input ARGB exactly. */
    public static final float[] IDENTITY = {
            1.0f, 0.0f, 0.0f,
            0.0f, 1.0f, 0.0f,
            0.0f, 0.0f, 1.0f,
    };

    private ColorblindCore() {
    }

    /** True when the 9-element row-major matrix is exactly the identity. */
    public static boolean isIdentity(float[] matrix) {
        checkMatrix(matrix);
        for (int i = 0; i < 9; i++) {
            if (matrix[i] != IDENTITY[i]) {
                return false;
            }
        }
        return true;
    }

    /**
     * Applies the row-major 3x3 {@code matrix} to the RGB channels of {@code argb}, keeping
     * alpha untouched and clamping each output channel to [0, 255].
     */
    public static int remap(int argb, float[] matrix) {
        checkMatrix(matrix);
        if (isIdentity(matrix)) {
            return argb; // exact no-op: never introduce rounding on the OFF path
        }
        int a = argb >>> 24;
        int r = (argb >>> 16) & 0xFF;
        int g = (argb >>> 8) & 0xFF;
        int b = argb & 0xFF;
        int outR = clampChannel(matrix[0] * r + matrix[1] * g + matrix[2] * b);
        int outG = clampChannel(matrix[3] * r + matrix[4] * g + matrix[5] * b);
        int outB = clampChannel(matrix[6] * r + matrix[7] * g + matrix[8] * b);
        return (a << 24) | (outR << 16) | (outG << 8) | outB;
    }

    private static int clampChannel(float value) {
        int rounded = Math.round(value);
        if (rounded < 0) {
            return 0;
        }
        return Math.min(rounded, 255);
    }

    private static void checkMatrix(float[] matrix) {
        if (matrix == null || matrix.length != 9) {
            throw new IllegalArgumentException("colorblind matrix must have exactly 9 elements");
        }
    }
}
