package dev.cuprum.cuprum.charge.core;

/**
 * Saturating long arithmetic for Cg amounts (charge.md §2a; FOUNDATION_PLAN D7/D9). All charge
 * amounts across the mod are {@code long} Cg — never {@code int} — and none of these operations
 * may ever wrap. MC-free by design: unit-tested in {@code src/test} against a BigInteger oracle
 * (the implementation itself is long-only, so the oracle is independent).
 */
public final class ChargeMath {
    private ChargeMath() {
    }

    /** Saturating add: never wraps; clamps at {@link Long#MAX_VALUE} / {@link Long#MIN_VALUE}. */
    public static long satAdd(long a, long b) {
        long sum = a + b;
        // Overflow iff both operands share a sign and the sum's sign differs (HD 2-13).
        if (((a ^ sum) & (b ^ sum)) < 0) {
            return a >= 0 ? Long.MAX_VALUE : Long.MIN_VALUE;
        }
        return sum;
    }

    /**
     * Saturating subtract with Cg semantics: the result floors at 0 (charge amounts are never
     * negative), and the intermediate difference never wraps.
     */
    public static long satSub(long a, long b) {
        long diff = a - b;
        if (((a ^ b) & (a ^ diff)) < 0) {
            // Overflowed: the true difference is out of long range; its sign is a's sign.
            diff = a >= 0 ? Long.MAX_VALUE : Long.MIN_VALUE;
        }
        return Math.max(0L, diff);
    }

    /** Inclusive clamp; {@code min} must not exceed {@code max}. */
    public static long clamp(long v, long min, long max) {
        if (min > max) {
            throw new IllegalArgumentException("clamp min " + min + " > max " + max);
        }
        return Math.max(min, Math.min(max, v));
    }

    /**
     * Overflow-safe floor of {@code amount * num / den} for non-negative operands; the result is
     * always a valid non-negative long, saturating at {@link Long#MAX_VALUE} when the true
     * quotient exceeds it (Cg semantics). The fast path uses plain signed long arithmetic ONLY
     * when the product provably fits a signed long ({@code amount <= Long.MAX_VALUE / num} —
     * NOT the previous {@code multiplyHigh == 0} check, which admits products in
     * {@code [2^63, 2^64)} whose low word is negative as a signed long and produced negative
     * results, e.g. {@code mulDiv(Long.MAX_VALUE, 2, 2) == -1}). Larger products are divided as
     * an exact unsigned 128-bit value ({@link Math#multiplyHigh} high word + unsigned low word)
     * by long-only arithmetic.
     *
     * @throws IllegalArgumentException on negative operands or {@code den <= 0}
     */
    public static long mulDiv(long amount, long num, long den) {
        if (amount < 0 || num < 0 || den <= 0) {
            throw new IllegalArgumentException(
                    "mulDiv requires amount >= 0, num >= 0, den > 0: " + amount + " * " + num + " / " + den);
        }
        if (amount == 0 || num == 0) {
            return 0L;
        }
        if (amount <= Long.MAX_VALUE / num) {
            // Product provably fits a signed long: plain floor division.
            return (amount * num) / den;
        }
        long hi = Math.multiplyHigh(amount, num);
        long lo = amount * num; // Low 64 bits of the exact product (interpret UNSIGNED).
        if (hi == 0) {
            // Product fits UNSIGNED 64 bits (2^63 <= product < 2^64).
            long quotient = Long.divideUnsigned(lo, den);
            return quotient < 0 ? Long.MAX_VALUE : quotient;
        }
        if (Long.compareUnsigned(hi, den) >= 0) {
            // Quotient >= 2^64: far beyond any representable Cg amount.
            return Long.MAX_VALUE;
        }
        long quotient = divideUnsigned128By64(hi, lo, den);
        return quotient < 0 ? Long.MAX_VALUE : quotient;
    }

    /**
     * Floor of the unsigned 128-bit value {@code (hi, lo)} divided by {@code den}, by binary
     * long division. Preconditions (enforced by the caller): {@code den > 0} and
     * {@code Long.compareUnsigned(hi, den) < 0}, so the quotient fits unsigned 64 bits and the
     * running remainder always stays below {@code den <= Long.MAX_VALUE}.
     */
    private static long divideUnsigned128By64(long hi, long lo, long den) {
        long quotient = 0L;
        long remainder = 0L;
        for (int bit = 127; bit >= 0; bit--) {
            long bitValue = bit >= 64 ? (hi >>> (bit - 64)) & 1L : (lo >>> bit) & 1L;
            // remainder < den <= Long.MAX_VALUE, so the shift-in never loses the top bit
            // (it may set the sign bit; comparisons below are unsigned).
            remainder = (remainder << 1) | bitValue;
            if (Long.compareUnsigned(remainder, den) >= 0) {
                remainder -= den;
                if (bit >= 64) {
                    // Cannot happen under the preconditions; defensive saturation.
                    return Long.MAX_VALUE;
                }
                quotient |= 1L << bit;
            }
        }
        return quotient;
    }

    /**
     * Line loss in TENTHS of a percentage point per full 16-block span (PWR-14 pins: bare U19
     * wire = 20 → 8 spans deliver 84%, HV = 5 → 8 spans deliver 96%; long spans clamp at 0%
     * delivered): {@code delivered = mulDiv(amount, max(0, 1000 - spans * ppTenths), 1000)}.
     */
    public static long lineLossDelivered(long amount, int spans, int ppTenthsPerSpan) {
        if (amount < 0 || spans < 0 || ppTenthsPerSpan < 0) {
            throw new IllegalArgumentException(
                    "lineLossDelivered requires non-negative inputs: " + amount + ", " + spans + ", " + ppTenthsPerSpan);
        }
        long keptTenths = Math.max(0L, 1000L - (long) spans * ppTenthsPerSpan);
        return mulDiv(amount, keptTenths, 1000L);
    }
}
