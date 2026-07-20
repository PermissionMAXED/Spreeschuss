package dev.cuprum.cuprum.net.server;

import java.util.Random;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * MC-free unit tests (plan D9) for the {@link TokenBucket} rate-limiter core: burst cap, lazy
 * refill, starvation under sustained hammering, tick-counter wraparound, and a seeded
 * random-schedule equivalence check against an independent reference model.
 */
class RateLimiterTest {
    @Test
    void bucketStartsFullAndAcceptsExactlyBurstAtOneTick() {
        TokenBucket bucket = new TokenBucket(4, 8, 100);
        for (int i = 0; i < 8; i++) {
            assertTrue(bucket.tryAcquire(100), "acquire " + (i + 1) + " of burst 8");
        }
        assertFalse(bucket.tryAcquire(100), "burst+1 must be rejected");
        assertEquals(0, bucket.availableTokens(100));
    }

    @Test
    void refillGrantsOneTokenPerFullRatePeriod() {
        // rate 4/s = 4 units/tick; one whole token (20 units) needs 5 ticks.
        TokenBucket bucket = new TokenBucket(4, 8, 0);
        for (int i = 0; i < 8; i++) {
            assertTrue(bucket.tryAcquire(0));
        }
        assertFalse(bucket.tryAcquire(4), "4 ticks refill only 16/20 units");
        assertTrue(bucket.tryAcquire(5), "5 ticks refill exactly one token");
        assertFalse(bucket.tryAcquire(5), "that token is spent");
    }

    @Test
    void refillNeverExceedsBurstCapacity() {
        TokenBucket bucket = new TokenBucket(4, 8, 0);
        assertEquals(8, bucket.availableTokens(1_000_000), "long idle refills to burst, not beyond");
        for (int i = 0; i < 8; i++) {
            assertTrue(bucket.tryAcquire(1_000_000));
        }
        assertFalse(bucket.tryAcquire(1_000_000));
    }

    @Test
    void sustainedHammeringIsThrottledToTheConfiguredRate() {
        // Hammer every tick for 100 seconds: throughput = burst + rate × seconds.
        TokenBucket bucket = new TokenBucket(4, 8, 0);
        long accepted = 0;
        for (long tick = 0; tick < 2000; tick++) {
            if (bucket.tryAcquire(tick)) {
                accepted++;
            }
        }
        // 8 burst + 4/s × (1999 elapsed ticks / 20) = 8 + 399.8 → 407 whole tokens.
        assertEquals(407, accepted);
    }

    @Test
    void starvationRecoversAfterAQuietPeriod() {
        TokenBucket bucket = new TokenBucket(1, 1, 0);
        assertTrue(bucket.tryAcquire(0));
        for (long tick = 1; tick < 20; tick++) {
            assertFalse(bucket.tryAcquire(tick), "sub-second retry at tick " + tick);
        }
        assertTrue(bucket.tryAcquire(20), "full second elapsed");
    }

    @Test
    void backwardsOrEqualTicksNeverRefill() {
        TokenBucket bucket = new TokenBucket(4, 2, 100);
        assertTrue(bucket.tryAcquire(100));
        assertTrue(bucket.tryAcquire(100));
        assertFalse(bucket.tryAcquire(100), "same tick: empty");
        assertFalse(bucket.tryAcquire(50), "time going backwards must not refill");
        assertFalse(bucket.tryAcquire(100), "returning to the observed tick must not refill");
    }

    @Test
    void tickCounterWraparoundKeepsRefilling() {
        // Two's-complement delta: MAX_VALUE → MIN_VALUE+4 is a positive elapsed time of 5 ticks.
        TokenBucket bucket = new TokenBucket(4, 8, Long.MAX_VALUE);
        for (int i = 0; i < 8; i++) {
            assertTrue(bucket.tryAcquire(Long.MAX_VALUE));
        }
        assertFalse(bucket.tryAcquire(Long.MAX_VALUE));
        assertTrue(bucket.tryAcquire(Long.MIN_VALUE + 4), "5 ticks across the wrap refill one token");
        assertFalse(bucket.tryAcquire(Long.MIN_VALUE + 4));
    }

    @Test
    void constructorRejectsNonPositiveRateOrBurst() {
        assertThrows(IllegalArgumentException.class, () -> new TokenBucket(0, 8, 0));
        assertThrows(IllegalArgumentException.class, () -> new TokenBucket(-1, 8, 0));
        assertThrows(IllegalArgumentException.class, () -> new TokenBucket(4, 0, 0));
        assertThrows(IllegalArgumentException.class, () -> new TokenBucket(4, -2, 0));
    }

    @Test
    void consumeWithoutAvailableTokenThrows() {
        TokenBucket bucket = new TokenBucket(1, 1, 0);
        assertTrue(bucket.tryAcquire(0));
        assertThrows(IllegalStateException.class, bucket::consume);
    }

    @Test
    void seededRandomScheduleMatchesReferenceModel() {
        // Deterministic (fixed seed) random schedule, checked step-by-step against an
        // independent saturating-arithmetic reference model of the bucket contract.
        Random random = new Random(0xC0FFEE);
        int rate = 4;
        int burst = 8;
        TokenBucket bucket = new TokenBucket(rate, burst, 0);
        long capacityUnits = burst * TokenBucket.UNITS_PER_TOKEN;
        long refUnits = capacityUnits;
        long refLastTick = 0;
        long tick = 0;
        long acceptedTotal = 0;
        for (int step = 0; step < 10_000; step++) {
            tick += random.nextInt(8); // 0..7 tick gaps, including repeats of the same tick
            long delta = tick - refLastTick;
            refLastTick = tick;
            if (delta > 0) {
                refUnits = Math.min(capacityUnits, refUnits + delta * rate);
            }
            boolean expected = refUnits >= TokenBucket.UNITS_PER_TOKEN;
            if (expected) {
                refUnits -= TokenBucket.UNITS_PER_TOKEN;
                acceptedTotal++;
            }
            assertEquals(expected, bucket.tryAcquire(tick), "step " + step + " at tick " + tick);
            assertEquals(refUnits / TokenBucket.UNITS_PER_TOKEN, bucket.availableTokens(tick),
                    "available tokens diverged at step " + step);
        }
        assertTrue(acceptedTotal > 0, "seeded schedule must exercise accepted acquires");
        assertTrue(acceptedTotal < 10_000, "seeded schedule must exercise rejected acquires");
    }
}
