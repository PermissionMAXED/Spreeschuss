package dev.cuprum.cuprum.fx.core;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * MC-free unit tests (plan D9) for the colorblind ARGB remap arithmetic: exact identity
 * no-op, row-major matrix application, channel clamping, alpha passthrough and matrix
 * validation.
 */
class ColorblindCoreTest {
    /** The diagnostic copper (client-fx.md §12). */
    private static final int COPPER = 0xFFE77C56;

    @Test
    void identityIsExactBitForBitNoOp() {
        assertTrue(ColorblindCore.isIdentity(ColorblindCore.IDENTITY));
        assertEquals(COPPER, ColorblindCore.remap(COPPER, ColorblindCore.IDENTITY));
        assertEquals(0x00000000, ColorblindCore.remap(0x00000000, ColorblindCore.IDENTITY));
        assertEquals(0x80FF00FF, ColorblindCore.remap(0x80FF00FF, ColorblindCore.IDENTITY));
    }

    @Test
    void rowMajorMatrixAppliesPerChannel() {
        // Pure channel swap R<->B: rows select (b, g, r).
        float[] swap = {
                0.0f, 0.0f, 1.0f,
                0.0f, 1.0f, 0.0f,
                1.0f, 0.0f, 0.0f,
        };
        assertFalse(ColorblindCore.isIdentity(swap));
        assertEquals(0xFF567CE7, ColorblindCore.remap(COPPER, swap));
    }

    @Test
    void alphaAlwaysPassesThroughUntouched() {
        float[] zero = new float[9]; // all channels -> 0
        assertEquals(0x7B000000, ColorblindCore.remap(0x7B123456, zero));
        assertEquals(0x00000000, ColorblindCore.remap(0x00FFFFFF, zero));
    }

    @Test
    void channelsClampAtBothEnds() {
        float[] amplify = {
                2.0f, 2.0f, 2.0f,
                -1.0f, 0.0f, 0.0f,
                0.0f, 0.0f, 3.0f,
        };
        int remapped = ColorblindCore.remap(0xFF808080, amplify);
        assertEquals(0xFF, (remapped >>> 16) & 0xFF, "over-driven red clamps to 255");
        assertEquals(0x00, (remapped >>> 8) & 0xFF, "negative green clamps to 0");
        assertEquals(0xFF, remapped & 0xFF, "over-driven blue clamps to 255");
    }

    @Test
    void remapRoundsToNearestChannelValue() {
        float[] half = {
                0.5f, 0.0f, 0.0f,
                0.0f, 0.5f, 0.0f,
                0.0f, 0.0f, 0.5f,
        };
        // 0x51 = 81 -> 40.5 rounds to 41 = 0x29 (Math.round half-up).
        assertEquals(0xFF292929, ColorblindCore.remap(0xFF515151, half));
    }

    @Test
    void invalidMatricesAreRejected() {
        assertThrows(IllegalArgumentException.class, () -> ColorblindCore.remap(COPPER, null));
        assertThrows(IllegalArgumentException.class, () -> ColorblindCore.remap(COPPER, new float[8]));
        assertThrows(IllegalArgumentException.class, () -> ColorblindCore.isIdentity(new float[10]));
    }
}
