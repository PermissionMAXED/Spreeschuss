package dev.cuprum.cuprum.machine;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** Pure timing-edge regressions for the machine update throttle. */
class ChargeMachineThrottleTest {
    @Test
    void sentinelFirstCallAlwaysSynchronizesWithoutOverflow() {
        assertTrue(ChargeMachineSyncPolicy.elapsed(0L, ChargeMachineSyncPolicy.NEVER_SYNCED));
        assertTrue(ChargeMachineSyncPolicy.elapsed(1_577L, ChargeMachineSyncPolicy.NEVER_SYNCED));
        assertTrue(ChargeMachineSyncPolicy.elapsed(Long.MAX_VALUE, ChargeMachineSyncPolicy.NEVER_SYNCED));
    }

    @Test
    void exactIntervalBoundaryIsTenTicks() {
        long previous = 123_456L;
        assertFalse(ChargeMachineSyncPolicy.elapsed(previous, previous));
        assertFalse(ChargeMachineSyncPolicy.elapsed(previous + 9L, previous));
        assertTrue(ChargeMachineSyncPolicy.elapsed(previous + 10L, previous));
    }

    @Test
    void resetOrWrappedGameClockStartsFreshWindow() {
        assertTrue(ChargeMachineSyncPolicy.elapsed(0L, 50_000L));
        assertTrue(ChargeMachineSyncPolicy.elapsed(Long.MIN_VALUE, Long.MAX_VALUE));
        assertFalse(ChargeMachineSyncPolicy.elapsed(Long.MAX_VALUE, Long.MAX_VALUE - 9L));
        assertTrue(ChargeMachineSyncPolicy.elapsed(Long.MAX_VALUE, Long.MAX_VALUE - 10L));
    }
}
