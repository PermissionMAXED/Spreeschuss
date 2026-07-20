package dev.cuprum.cuprum.charge;

import dev.cuprum.cuprum.charge.core.ChargeBuffer;
import java.util.Random;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * MC-free unit tests for the single clamp/insert/extract authority. Normal graph and external
 * calls use the budgeted insert/extract path; surge has its own capacity-only path.
 */
class ChargeBufferTest {
    @Test
    void insertClampsToCapacityAndPerTickBudget() {
        ChargeBuffer buffer = new ChargeBuffer(20_000L, 1_000L, 1_000L);
        buffer.beginGameTick(0L);
        assertEquals(600L, buffer.insert(600L, false));
        // Same tick: only 400 of the 1,000/t insert budget remains.
        assertEquals(400L, buffer.insert(600L, false));
        assertEquals(0L, buffer.insert(600L, false));
        assertEquals(1_000L, buffer.stored());
        buffer.beginGameTick(1L);
        assertEquals(1_000L, buffer.insert(5_000L, false));
        assertEquals(2_000L, buffer.stored());
    }

    @Test
    void extractClampsToStoredAndPerTickBudget() {
        ChargeBuffer buffer = new ChargeBuffer(20_000L, 1_000L, 300L);
        buffer.setStored(500L);
        buffer.beginGameTick(0L);
        assertEquals(300L, buffer.extract(1_000L, false));
        // Same tick: extract budget exhausted.
        assertEquals(0L, buffer.extract(1L, false));
        buffer.beginGameTick(1L);
        // Next tick: only the remaining 200 stored can come out.
        assertEquals(200L, buffer.extract(1_000L, false));
        assertEquals(0L, buffer.stored());
    }

    @Test
    void simulateNeverMutates() {
        ChargeBuffer buffer = new ChargeBuffer(1_000L, 100L, 100L);
        buffer.beginGameTick(0L);
        assertEquals(100L, buffer.insert(500L, true));
        assertEquals(0L, buffer.stored());
        // Simulate must not consume the per-tick budget either.
        assertEquals(100L, buffer.insert(100L, false));
        assertEquals(100L, buffer.stored());
        assertEquals(100L, buffer.extract(500L, true));
        assertEquals(100L, buffer.stored());
    }

    @Test
    void negativeAndZeroRequestsAreZeroNoOps() {
        ChargeBuffer buffer = new ChargeBuffer(1_000L, 100L, 100L);
        assertEquals(0L, buffer.insert(0L, false));
        assertEquals(0L, buffer.insert(-5L, false));
        assertEquals(0L, buffer.extract(0L, false));
        assertEquals(0L, buffer.extract(-5L, false));
        assertEquals(0L, buffer.stored());
        assertEquals(0L, buffer.depositSurge(-1L));
    }

    @Test
    void normalMutationsClampToCapacityAndStoredWithoutWrapping() {
        ChargeBuffer buffer = new ChargeBuffer(20_000L, Long.MAX_VALUE, Long.MAX_VALUE);
        buffer.beginGameTick(0L);
        assertEquals(15_000L, buffer.insert(15_000L, false));
        assertEquals(5_000L, buffer.insert(Long.MAX_VALUE, false));
        assertEquals(20_000L, buffer.stored());
        assertEquals(20_000L, buffer.extract(Long.MAX_VALUE, false));
        assertEquals(0L, buffer.stored());
        buffer.setStored(7L);
        assertEquals(0L, buffer.extract(Long.MIN_VALUE, false));
        assertEquals(7L, buffer.extract(Long.MAX_VALUE, false));
        assertEquals(0L, buffer.stored());
    }

    @Test
    void depositSurgeBypassesInsertBudgetButNeverCapacity() {
        ChargeBuffer buffer = new ChargeBuffer(20_000L, 1_000L, 1_000L);
        // 270,000 Cg strike into an empty 20,000 cap cell: 20,000 in, the rest is the graph's
        // problem (absorbers/venting) — the buffer never over-fills.
        assertEquals(20_000L, buffer.depositSurge(270_000L));
        assertEquals(20_000L, buffer.stored());
        assertEquals(0L, buffer.depositSurge(1L));
    }

    @Test
    void setStoredClampsHostileLoadValues() {
        ChargeBuffer buffer = new ChargeBuffer(20_000L, 1_000L, 1_000L);
        assertEquals(20_000L, buffer.setStored(999_999L));
        assertEquals(0L, buffer.setStored(-1L));
        assertEquals(12_345L, buffer.setStored(12_345L));
    }

    @Test
    void constructorRejectsNegativeLimits() {
        assertThrows(IllegalArgumentException.class, () -> new ChargeBuffer(-1L, 0L, 0L));
        assertThrows(IllegalArgumentException.class, () -> new ChargeBuffer(0L, -1L, 0L));
        assertThrows(IllegalArgumentException.class, () -> new ChargeBuffer(0L, 0L, -1L));
    }

    @Test
    void randomizedBudgetedFlowsNeverBreakInvariants() {
        Random random = new Random(0xBEEF_01L);
        ChargeBuffer buffer = new ChargeBuffer(10_000L, 700L, 400L);
        for (int tick = 0; tick < 2_000; tick++) {
            buffer.beginGameTick(tick);
            long insertedThisTick = 0;
            long extractedThisTick = 0;
            for (int op = 0; op < 4; op++) {
                long amount = random.nextInt(1_200);
                if (random.nextBoolean()) {
                    insertedThisTick += buffer.insert(amount, false);
                } else {
                    extractedThisTick += buffer.extract(amount, false);
                }
                assertTrue(buffer.stored() >= 0, "stored must never go negative");
                assertTrue(buffer.stored() <= buffer.capacity(), "stored must never exceed capacity");
            }
            assertTrue(insertedThisTick <= 700L, "per-tick insert budget respected");
            assertTrue(extractedThisTick <= 400L, "per-tick extract budget respected");
        }
    }
}
