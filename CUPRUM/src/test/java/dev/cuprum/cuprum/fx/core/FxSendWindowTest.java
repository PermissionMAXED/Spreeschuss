package dev.cuprum.cuprum.fx.core;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * MC-free unit tests (plan D9) for the per-client S2C coalescing window (★ ≤16 ripple
 * payloads per second per client): in-window cap, rollover, backwards game time and the
 * coalesced-drop diagnostic.
 */
class FxSendWindowTest {
    @Test
    void acceptsExactlyMaxPerWindowThenCoalesces() {
        FxSendWindow window = new FxSendWindow(FxBudgets.RIPPLE_SENDS_PER_SECOND, FxBudgets.SEND_WINDOW_TICKS);
        for (int i = 0; i < FxBudgets.RIPPLE_SENDS_PER_SECOND; i++) {
            assertTrue(window.tryAcquire(100L + i), "send " + (i + 1) + " inside the window");
        }
        assertFalse(window.tryAcquire(119L), "17th send in the same 20-tick window");
        assertEquals(1L, window.coalescedTotal());
        assertEquals(FxBudgets.RIPPLE_SENDS_PER_SECOND, window.sentInCurrentWindow(119L));
    }

    @Test
    void windowRollsOverAfterWindowTicks() {
        FxSendWindow window = new FxSendWindow(2, 20);
        assertTrue(window.tryAcquire(100L));
        assertTrue(window.tryAcquire(101L));
        assertFalse(window.tryAcquire(119L), "still inside [100, 120)");
        assertTrue(window.tryAcquire(120L), "tick 120 opens a fresh window");
        assertEquals(1, window.sentInCurrentWindow(120L));
        assertEquals(0, window.sentInCurrentWindow(140L), "future window reads zero");
    }

    @Test
    void backwardsGameTimeOpensAFreshWindow() {
        FxSendWindow window = new FxSendWindow(1, 20);
        assertTrue(window.tryAcquire(1000L));
        assertFalse(window.tryAcquire(1001L));
        assertTrue(window.tryAcquire(3L), "world reload / time-set rewind must not starve sends");
    }

    @Test
    void coalescedTotalAccumulatesAcrossWindows() {
        FxSendWindow window = new FxSendWindow(1, 10);
        assertTrue(window.tryAcquire(0L));
        assertFalse(window.tryAcquire(1L));
        assertFalse(window.tryAcquire(2L));
        assertTrue(window.tryAcquire(10L));
        assertFalse(window.tryAcquire(11L));
        assertEquals(3L, window.coalescedTotal());
    }

    @Test
    void parametersMustBePositive() {
        assertThrows(IllegalArgumentException.class, () -> new FxSendWindow(0, 20));
        assertThrows(IllegalArgumentException.class, () -> new FxSendWindow(16, 0));
    }
}
