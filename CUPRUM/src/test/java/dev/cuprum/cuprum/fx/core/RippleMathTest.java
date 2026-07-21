package dev.cuprum.cuprum.fx.core;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * MC-free unit tests (plan D9) for the snapshot radius Q8.8 quantization and the
 * tick-quantized diagnostic animation math (client-fx.md §4: no partialTick anywhere).
 */
class RippleMathTest {
    @Test
    void quantizationRoundTripsTheDiagnosticRadius() {
        // The FX probe's wire value: 768 Q8.8 == 3.0 blocks exactly (client-fx.md §12).
        assertEquals(768, RippleMath.toQ8(3.0f));
        assertEquals(3.0f, RippleMath.fromQ8(768));
        assertEquals(256, RippleMath.toQ8(1.0f));
        assertEquals(1, RippleMath.toQ8(1.0f / 256.0f), "one Q8 step");
    }

    @Test
    void toQ8RoundsAndClampsIntoContractBounds() {
        assertEquals(Math.round(2.7f * 256.0f), RippleMath.toQ8(2.7f));
        assertEquals(0, RippleMath.toQ8(0.0f));
        assertEquals(0, RippleMath.toQ8(-5.0f));
        assertEquals(0, RippleMath.toQ8(Float.NaN));
        assertEquals(FxBudgets.MAX_RADIUS_Q8, RippleMath.toQ8(1.0e9f), "clamped to the 64-block cap");
        assertEquals(FxBudgets.MAX_RADIUS_Q8, RippleMath.toQ8(Float.POSITIVE_INFINITY));
    }

    @Test
    void isValidRadiusQ8MatchesThePayloadContract() {
        assertFalse(RippleMath.isValidRadiusQ8(0));
        assertFalse(RippleMath.isValidRadiusQ8(-1));
        assertTrue(RippleMath.isValidRadiusQ8(1));
        assertTrue(RippleMath.isValidRadiusQ8(768));
        assertTrue(RippleMath.isValidRadiusQ8(FxBudgets.MAX_RADIUS_Q8));
        assertFalse(RippleMath.isValidRadiusQ8(FxBudgets.MAX_RADIUS_Q8 + 1));
    }

    @Test
    void radiusExpandsLinearlyAndTickQuantized() {
        int max = 768; // 3.0 blocks over the 40-tick diagnostic lifetime
        assertEquals(0, RippleMath.radiusQ8AtAge(max, 0, 40), "birth tick radius 0");
        assertEquals(max / 4, RippleMath.radiusQ8AtAge(max, 10, 40));
        assertEquals(max / 2, RippleMath.radiusQ8AtAge(max, 20, 40));
        assertEquals(307, RippleMath.radiusQ8AtAge(max, 16, 40), "the gametest template age");
        // Tick quantization: equal ages give identical radii; no fractional interpolation.
        assertEquals(RippleMath.radiusQ8AtAge(max, 16, 40), RippleMath.radiusQ8AtAge(max, 16, 40));
    }

    @Test
    void outOfLifeAgesDrawNothing() {
        assertEquals(0, RippleMath.radiusQ8AtAge(768, -1, 40), "future start tick (rewind)");
        assertEquals(0, RippleMath.radiusQ8AtAge(768, 40, 40), "lifetime end is exclusive");
        assertEquals(0, RippleMath.radiusQ8AtAge(768, 41, 40));
        assertEquals(0, RippleMath.radiusQ8AtAge(768, 5, 0), "degenerate lifetime");
        assertEquals(0, RippleMath.alphaAtAge(-1, 40));
        assertEquals(0, RippleMath.alphaAtAge(40, 40));
    }

    @Test
    void alphaFadesLinearlyFromFullToZero() {
        assertEquals(255, RippleMath.alphaAtAge(0, 40));
        assertEquals(255 - 255 * 16 / 40, RippleMath.alphaAtAge(16, 40), "template age alpha");
        assertEquals(255 - 255 * 39 / 40, RippleMath.alphaAtAge(39, 40));
        for (int age = 1; age < 40; age++) {
            assertTrue(RippleMath.alphaAtAge(age, 40) < RippleMath.alphaAtAge(age - 1, 40)
                            || RippleMath.alphaAtAge(age, 40) == RippleMath.alphaAtAge(age - 1, 40),
                    "monotonically non-increasing at age " + age);
        }
    }
}
