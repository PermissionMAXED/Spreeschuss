package dev.cuprum.cuprum.charge;

import dev.cuprum.cuprum.charge.core.ChargeMath;
import java.math.BigInteger;
import java.util.Random;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * MC-free unit tests (plan D9) for the saturating Cg arithmetic. The randomized cases run
 * against a BigInteger oracle with FIXED seeds — the results are reproducible bit for bit.
 */
class ChargeMathTest {
    private static final long[] EDGE_VALUES = {
            Long.MIN_VALUE, Long.MIN_VALUE + 1, Integer.MIN_VALUE, -1L, 0L, 1L,
            Integer.MAX_VALUE, Long.MAX_VALUE - 1, Long.MAX_VALUE
    };

    private static long saturate(BigInteger value) {
        if (value.compareTo(BigInteger.valueOf(Long.MAX_VALUE)) > 0) {
            return Long.MAX_VALUE;
        }
        if (value.compareTo(BigInteger.valueOf(Long.MIN_VALUE)) < 0) {
            return Long.MIN_VALUE;
        }
        return value.longValueExact();
    }

    @Test
    void satAddMatchesBigIntegerOracleOnSeededRandoms() {
        Random random = new Random(0xC0FFEE_01L);
        for (int i = 0; i < 20_000; i++) {
            long a = random.nextLong();
            long b = random.nextLong();
            long expected = saturate(BigInteger.valueOf(a).add(BigInteger.valueOf(b)));
            assertEquals(expected, ChargeMath.satAdd(a, b), () -> a + " + " + b);
        }
    }

    @Test
    void satAddSaturatesAtBothEdges() {
        assertEquals(Long.MAX_VALUE, ChargeMath.satAdd(Long.MAX_VALUE, 1L));
        assertEquals(Long.MAX_VALUE, ChargeMath.satAdd(Long.MAX_VALUE, Long.MAX_VALUE));
        assertEquals(Long.MIN_VALUE, ChargeMath.satAdd(Long.MIN_VALUE, -1L));
        assertEquals(Long.MIN_VALUE, ChargeMath.satAdd(Long.MIN_VALUE, Long.MIN_VALUE));
        for (long a : EDGE_VALUES) {
            for (long b : EDGE_VALUES) {
                long expected = saturate(BigInteger.valueOf(a).add(BigInteger.valueOf(b)));
                assertEquals(expected, ChargeMath.satAdd(a, b), a + " + " + b);
            }
        }
    }

    @Test
    void satSubFloorsAtZeroWithCgSemantics() {
        // Cg semantics: charge amounts are never negative, so the DIFFERENCE floors at 0.
        assertEquals(0L, ChargeMath.satSub(5L, 10L));
        assertEquals(5L, ChargeMath.satSub(10L, 5L));
        assertEquals(0L, ChargeMath.satSub(0L, Long.MAX_VALUE));
        assertEquals(Long.MAX_VALUE, ChargeMath.satSub(Long.MAX_VALUE, -1L));
        assertEquals(0L, ChargeMath.satSub(Long.MIN_VALUE, 1L));
    }

    @Test
    void satSubMatchesFlooredBigIntegerOracleOnSeededRandoms() {
        Random random = new Random(0xC0FFEE_02L);
        for (int i = 0; i < 20_000; i++) {
            long a = random.nextLong();
            long b = random.nextLong();
            BigInteger difference = BigInteger.valueOf(a).subtract(BigInteger.valueOf(b));
            long expected = Math.max(0L, saturate(difference));
            assertEquals(expected, ChargeMath.satSub(a, b), () -> a + " - " + b);
        }
    }

    @Test
    void clampIsInclusiveAndValidatesBounds() {
        assertEquals(5L, ChargeMath.clamp(5L, 0L, 10L));
        assertEquals(0L, ChargeMath.clamp(-3L, 0L, 10L));
        assertEquals(10L, ChargeMath.clamp(99L, 0L, 10L));
        assertEquals(10L, ChargeMath.clamp(10L, 0L, 10L));
        assertEquals(0L, ChargeMath.clamp(0L, 0L, 10L));
        assertThrows(IllegalArgumentException.class, () -> ChargeMath.clamp(0L, 10L, 0L));
    }

    @Test
    void mulDivMatchesBigIntegerFloorOracleOnSeededRandoms() {
        Random random = new Random(0xC0FFEE_03L);
        for (int i = 0; i < 20_000; i++) {
            long amount = random.nextLong() & Long.MAX_VALUE;
            long num = random.nextLong() & Long.MAX_VALUE;
            long den = (random.nextLong() & Long.MAX_VALUE) + 1L;
            long expected = saturate(BigInteger.valueOf(amount)
                    .multiply(BigInteger.valueOf(num))
                    .divide(BigInteger.valueOf(den)));
            assertEquals(expected, ChargeMath.mulDiv(amount, num, den),
                    () -> amount + " * " + num + " / " + den);
        }
    }

    @Test
    void mulDivExactRegressionsForSignedOverflowBand() {
        // Eval-A P1 repros: products in [2^63, 2^64) have multiplyHigh == 0 but a NEGATIVE low
        // word as a signed long; the old fast path divided that signed garbage.
        // (2^63 - 1) * 2 / 2 == 2^63 - 1 exactly (was -1).
        assertEquals(Long.MAX_VALUE, ChargeMath.mulDiv(Long.MAX_VALUE, 2L, 2L));
        // 2^62 * 2 / 1 == 2^63 -> saturates to Long.MAX_VALUE (was Long.MIN_VALUE).
        assertEquals(Long.MAX_VALUE, ChargeMath.mulDiv(1L << 62, 2L, 1L));
        // More points inside the band, exact against hand-computed floors:
        // (2^64 - 2) / 4 = 2^62 - 1 (floor).
        assertEquals((1L << 62) - 1L, ChargeMath.mulDiv(Long.MAX_VALUE, 2L, 4L));
        // (2^64 - 2) / 3 = 6148914691236517204 (floor).
        assertEquals(6148914691236517204L, ChargeMath.mulDiv(Long.MAX_VALUE, 2L, 3L));
        // 2^63 / 2^63-boundary den: floor((2^62)*2 / (2^63 - 1)) = 1.
        assertEquals(1L, ChargeMath.mulDiv(1L << 62, 2L, Long.MAX_VALUE));
        // Exact fast-path boundary: amount == Long.MAX_VALUE / num stays on the signed path.
        assertEquals(Long.MAX_VALUE / 3L, ChargeMath.mulDiv(Long.MAX_VALUE / 3L, 3L, 3L));
        // One above the boundary: (MAX/3 + 1) * 3 = 2^63 + 2 -> unsigned band, floor /3 exact.
        assertEquals((Long.MAX_VALUE / 3L + 1L), ChargeMath.mulDiv(Long.MAX_VALUE / 3L + 1L, 3L, 3L));
    }

    @Test
    void mulDivMatchesOracleOnSignedOverflowBoundaryTriples() {
        // Deterministic sweep of the exact region the old multiplyHigh==0 fast path corrupted:
        // products straddling 2^63 (hi == 0, signed-negative low word) and just above 2^64
        // (hi == 1). Every result must match the saturated BigInteger floor AND be >= 0.
        Random random = new Random(0xC0FFEE_05L);
        long[] nums = {2L, 3L, 5L, 7L, 1000L, Integer.MAX_VALUE, (1L << 40) + 9L};
        for (long num : nums) {
            long boundary = Long.MAX_VALUE / num;
            for (long offset = -2; offset <= 2; offset++) {
                long amount = boundary + offset;
                if (amount < 0) {
                    continue;
                }
                for (long den : new long[]{1L, 2L, 3L, num, Long.MAX_VALUE}) {
                    long expected = saturate(BigInteger.valueOf(amount)
                            .multiply(BigInteger.valueOf(num)).divide(BigInteger.valueOf(den)));
                    long actual = ChargeMath.mulDiv(amount, num, den);
                    assertEquals(expected, actual, amount + " * " + num + " / " + den);
                    assertTrue(actual >= 0, "mulDiv must never return negative");
                }
            }
        }
        // Randomized inside the [2^63, 2^64) product band: amount in [2^62, 2^63), num = 2.
        for (int i = 0; i < 20_000; i++) {
            long amount = (1L << 62) + (random.nextLong() & ((1L << 62) - 1));
            long den = (random.nextLong() & Long.MAX_VALUE) + 1L;
            long expected = saturate(BigInteger.valueOf(amount)
                    .multiply(BigInteger.TWO).divide(BigInteger.valueOf(den)));
            long actual = ChargeMath.mulDiv(amount, 2L, den);
            assertEquals(expected, actual, () -> amount + " * 2 / " + den);
            assertTrue(actual >= 0, "mulDiv must never return negative");
        }
    }

    @Test
    void mulDivSurvives128BitIntermediatesAndSaturates() {
        // Intermediate product needs 126 bits; exact result fits in a long.
        assertEquals(Long.MAX_VALUE / 2,
                ChargeMath.mulDiv(Long.MAX_VALUE, Long.MAX_VALUE / 2, Long.MAX_VALUE));
        // Result larger than Long.MAX_VALUE saturates (Cg semantics).
        assertEquals(Long.MAX_VALUE, ChargeMath.mulDiv(Long.MAX_VALUE, Long.MAX_VALUE, 2L));
        assertEquals(0L, ChargeMath.mulDiv(0L, Long.MAX_VALUE, 1L));
        assertEquals(0L, ChargeMath.mulDiv(Long.MAX_VALUE, 0L, 1L));
    }

    @Test
    void mulDivRejectsNegativeOperandsAndZeroDenominator() {
        assertThrows(IllegalArgumentException.class, () -> ChargeMath.mulDiv(-1L, 1L, 1L));
        assertThrows(IllegalArgumentException.class, () -> ChargeMath.mulDiv(1L, -1L, 1L));
        assertThrows(IllegalArgumentException.class, () -> ChargeMath.mulDiv(1L, 1L, 0L));
        assertThrows(IllegalArgumentException.class, () -> ChargeMath.mulDiv(1L, 1L, -1L));
    }

    @Test
    void lineLossPinsPwr14EightSpanPercentages() {
        // PWR-14 pins: 8 spans of bare U19 wire (20 tenths/span) deliver 84%; HV (5) delivers 96%.
        assertEquals(84_000L, ChargeMath.lineLossDelivered(100_000L, 8, 20));
        assertEquals(96_000L, ChargeMath.lineLossDelivered(100_000L, 8, 5));
        assertEquals(840L, ChargeMath.lineLossDelivered(1_000L, 8, 20));
        assertEquals(960L, ChargeMath.lineLossDelivered(1_000L, 8, 5));
    }

    @Test
    void lineLossClampsAtZeroDeliveredAndFloorsFractions() {
        // 50 spans * 20 tenths = 1000 tenths = 100% loss; longer spans stay clamped at 0.
        assertEquals(0L, ChargeMath.lineLossDelivered(100_000L, 50, 20));
        assertEquals(0L, ChargeMath.lineLossDelivered(100_000L, 51, 20));
        assertEquals(0L, ChargeMath.lineLossDelivered(100_000L, Integer.MAX_VALUE, 20));
        // Floor semantics: 7 * 998 / 1000 = 6.986 -> 6.
        assertEquals(6L, ChargeMath.lineLossDelivered(7L, 1, 2));
        // Zero spans and zero loss-rate deliver everything.
        assertEquals(123L, ChargeMath.lineLossDelivered(123L, 0, 20));
        assertEquals(123L, ChargeMath.lineLossDelivered(123L, 8, 0));
        assertThrows(IllegalArgumentException.class, () -> ChargeMath.lineLossDelivered(-1L, 0, 0));
        assertThrows(IllegalArgumentException.class, () -> ChargeMath.lineLossDelivered(1L, -1, 0));
        assertThrows(IllegalArgumentException.class, () -> ChargeMath.lineLossDelivered(1L, 0, -1));
    }

    @Test
    void satCountersNeverGoNegativeUnderRandomizedCgFlows() {
        // Property: any sequence of satAdd/satSub over non-negative Cg amounts stays >= 0.
        Random random = new Random(0xC0FFEE_04L);
        long counter = 0;
        for (int i = 0; i < 10_000; i++) {
            long amount = random.nextLong() & Long.MAX_VALUE;
            counter = random.nextBoolean()
                    ? ChargeMath.satAdd(counter, amount)
                    : ChargeMath.satSub(counter, amount);
            assertTrue(counter >= 0, "counter must never go negative");
        }
    }
}
