package dev.cuprum.cuprum.machine;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

/**
 * MC-free tests for the frozen menu-lane splitter (multiblock.md §6.1). Data slots sync as
 * 16-bit shorts; W1 machines use lanes 0..2, so the 48-bit boundary (2^48−1 Cg) is the pinned
 * maximum a menu can represent.
 */
class ShortSplitTest {
    private static long roundTrip(long value) {
        return ShortSplit.combine(
                ShortSplit.lane(value, 0),
                ShortSplit.lane(value, 1),
                ShortSplit.lane(value, 2),
                ShortSplit.lane(value, 3));
    }

    private static long threeLaneRoundTrip(long value) {
        return ShortSplit.combineThree(
                ShortSplit.syncLane(value, 0),
                ShortSplit.syncLane(value, 1),
                ShortSplit.syncLane(value, 2));
    }

    @Test
    void roundTripPinnedValues() {
        assertEquals(0L, roundTrip(0L));
        assertEquals(1L, roundTrip(1L));
        assertEquals(0xFFFFL, roundTrip(0xFFFFL));
        assertEquals((1L << 48) - 1, roundTrip((1L << 48) - 1));
    }

    @Test
    void roundTripCatalogMagnitudes() {
        assertEquals(1_000L, roundTrip(1_000L));          // diagnostic coil capacity
        assertEquals(2_700_000L, roundTrip(2_700_000L));  // PWR-07 max
        assertEquals(Long.MAX_VALUE, roundTrip(Long.MAX_VALUE));
        assertEquals(-1L, roundTrip(-1L)); // all 64 bits survive the 4 lanes
    }

    @Test
    void laneExtractionPinnedByLiterals() {
        long value = 0x0123_4567_89AB_CDEFL;
        assertEquals(0xCDEF, ShortSplit.lane(value, 0));
        assertEquals(0x89AB, ShortSplit.lane(value, 1));
        assertEquals(0x4567, ShortSplit.lane(value, 2));
        assertEquals(0x0123, ShortSplit.lane(value, 3));
    }

    @Test
    void lanesAreZeroExtendedInts() {
        // lane values ≥ 0x8000 must not sign-extend (they travel as vanilla shorts).
        assertEquals(0xFFFF, ShortSplit.lane(-1L, 0));
        assertEquals(0xFFFF, ShortSplit.lane(-1L, 3));
    }

    @Test
    void combineMasksEachLaneToSixteenBits() {
        // Vanilla's short lane may arrive sign-extended (e.g. -1 == 0xFFFF); combine masks it.
        assertEquals(0xFFFFL, ShortSplit.combine(-1, 0, 0, 0));
        assertEquals(0xFFFF_0000L, ShortSplit.combine(0, -1, 0, 0));
        assertEquals(0x1_0000_0000L * 0xFFFF, ShortSplit.combine(0, 0, -1, 0));
    }

    @Test
    void laneIndexOutOfBoundsThrows() {
        assertThrows(IllegalArgumentException.class, () -> ShortSplit.lane(0L, -1));
        assertThrows(IllegalArgumentException.class, () -> ShortSplit.lane(0L, ShortSplit.LANES_PER_LONG));
    }

    @Test
    void exactThreeLaneBoundariesRoundTrip() {
        assertEquals((1L << 48) - 1L, ShortSplit.MAX_THREE_LANE_VALUE);
        assertEquals(0L, threeLaneRoundTrip(0L));
        assertEquals(0xFFFFL, threeLaneRoundTrip(0xFFFFL));
        assertEquals(0x1_0000L, threeLaneRoundTrip(0x1_0000L));
        assertEquals(0x1_0000_0000L, threeLaneRoundTrip(0x1_0000_0000L));
        assertEquals(ShortSplit.MAX_THREE_LANE_VALUE,
                threeLaneRoundTrip(ShortSplit.MAX_THREE_LANE_VALUE));
        assertEquals(ShortSplit.MAX_THREE_LANE_VALUE,
                ShortSplit.combineThree(-1, -1, -1),
                "three sign-extended packet shorts decode as unsigned lanes");
    }

    @Test
    void exactThreeLaneOverflowFailsInsteadOfTruncating() {
        assertEquals((1L << 48) - 1L, ChargeMachineSyncPolicy.MAX_SYNCABLE_CG);
        assertEquals(ChargeMachineSyncPolicy.MAX_SYNCABLE_CG,
                ChargeMachineSyncPolicy.requireSyncableCg(
                        "test", ChargeMachineSyncPolicy.MAX_SYNCABLE_CG));
        assertThrows(IllegalArgumentException.class, () -> ShortSplit.syncLane(-1L, 0));
        assertThrows(IllegalArgumentException.class,
                () -> ShortSplit.syncLane(ShortSplit.MAX_THREE_LANE_VALUE + 1L, 0));
        assertThrows(IllegalArgumentException.class, () -> ShortSplit.syncLane(Long.MAX_VALUE, 2));
        assertThrows(IllegalArgumentException.class, () -> ShortSplit.syncLane(0L, -1));
        assertThrows(IllegalArgumentException.class, () -> ShortSplit.syncLane(0L, 3));
        assertThrows(IllegalArgumentException.class,
                () -> ChargeMachineSyncPolicy.requireSyncableCg(
                        "test", ChargeMachineSyncPolicy.MAX_SYNCABLE_CG + 1L));
    }
}
