package dev.cuprum.cuprum.fx.core;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * MC-free unit tests (plan D9) for the particle budget counter: per-tick spawn cap, live
 * ceiling, window rollover (including backwards time) and the accepted/rejected diagnostics
 * the ★ budget asserts read.
 */
class FxBudgetCounterTest {
    @Test
    void perTickCapAcceptsExactlyCapThenRejects() {
        FxBudgetCounter counter = new FxBudgetCounter(4, 100);
        for (int i = 0; i < 4; i++) {
            assertTrue(counter.tryReserve(50L, 0), "spawn " + (i + 1) + " of 4");
        }
        assertFalse(counter.tryReserve(50L, 0), "5th spawn on the same tick");
        assertEquals(4, counter.spawnedThisTick(50L));
        assertEquals(4L, counter.acceptedTotal());
        assertEquals(1L, counter.rejectedTotal());
    }

    @Test
    void nextTickOpensAFreshSpawnWindow() {
        FxBudgetCounter counter = new FxBudgetCounter(2, 100);
        assertTrue(counter.tryReserve(10L, 0));
        assertTrue(counter.tryReserve(10L, 0));
        assertFalse(counter.tryReserve(10L, 0));
        assertTrue(counter.tryReserve(11L, 0), "new tick resets the per-tick count");
        assertEquals(1, counter.spawnedThisTick(11L));
        assertEquals(0, counter.spawnedThisTick(12L), "future tick reads zero");
    }

    @Test
    void backwardsTimeOpensAFreshWindowInsteadOfStarving() {
        FxBudgetCounter counter = new FxBudgetCounter(2, 100);
        assertTrue(counter.tryReserve(1000L, 0));
        assertTrue(counter.tryReserve(1000L, 0));
        assertTrue(counter.tryReserve(5L, 0), "time rewind (world swap) must not starve");
    }

    @Test
    void liveCeilingRejectsIndependentlyOfTickCap() {
        FxBudgetCounter counter = new FxBudgetCounter(64, 10);
        assertFalse(counter.tryReserve(1L, 10), "liveEstimate == cap rejects");
        assertFalse(counter.tryReserve(1L, 11), "liveEstimate > cap rejects");
        assertTrue(counter.tryReserve(1L, 9), "below the ceiling accepts");
        assertEquals(2L, counter.rejectedTotal());
    }

    @Test
    void resetClearsAllCountersAndWindow() {
        FxBudgetCounter counter = new FxBudgetCounter(2, 100);
        counter.tryReserve(7L, 0);
        counter.tryReserve(7L, 0);
        counter.tryReserve(7L, 0);
        counter.reset();
        assertEquals(0L, counter.acceptedTotal());
        assertEquals(0L, counter.rejectedTotal());
        assertEquals(0, counter.spawnedThisTick(7L));
        assertTrue(counter.tryReserve(7L, 0), "same tick accepts again after reset");
    }

    @Test
    void failedSpawnRollbackRemovesOnlyTheImmediateReservation() {
        FxBudgetCounter counter = new FxBudgetCounter(2, 100);
        assertTrue(counter.tryReserve(20L, 0));
        counter.rollbackReservation(20L);
        assertEquals(0, counter.spawnedThisTick(20L));
        assertEquals(0L, counter.acceptedTotal());
        assertTrue(counter.tryReserve(20L, 0), "rolled-back slot is available again");
        assertTrue(counter.tryReserve(20L, 0));
        assertFalse(counter.tryReserve(20L, 0), "successful reservations still enforce the cap");
    }

    @Test
    void rollbackRejectsWrongTickOrMissingReservation() {
        FxBudgetCounter counter = new FxBudgetCounter(2, 100);
        assertThrows(IllegalStateException.class, () -> counter.rollbackReservation(1L));
        assertTrue(counter.tryReserve(1L, 0));
        assertThrows(IllegalStateException.class, () -> counter.rollbackReservation(2L));
        counter.rollbackReservation(1L);
        assertThrows(IllegalStateException.class, () -> counter.rollbackReservation(1L));
    }

    @Test
    void capsMustBePositive() {
        assertThrows(IllegalArgumentException.class, () -> new FxBudgetCounter(0, 1));
        assertThrows(IllegalArgumentException.class, () -> new FxBudgetCounter(1, 0));
        assertThrows(IllegalArgumentException.class, () -> new FxBudgetCounter(-1, -1));
    }
}
