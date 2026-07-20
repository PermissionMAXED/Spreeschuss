package dev.cuprum.cuprum.machine;

/**
 * Lane-splits a long across 16-bit menu data slots (multiblock.md §6.1, frozen; JUnit-safe —
 * no Minecraft imports, plan D9). Rationale: {@code ClientboundContainerSetDataPacket} writes
 * each data-slot value as a <b>16-bit short</b> ({@code writeShort}), so any synced value ≥
 * 2^16 must be split. W1 uses lanes 0..2 — a 48-bit cap (2^48−1 Cg) covering every catalog
 * magnitude (PWR-07 max 2,700,000 Cg). {@code ShortSplit} stays in {@code machine} (menu-lane
 * concern) while {@code ChargeBuffer} lives in {@code charge.core} (plan D7).
 */
public final class ShortSplit {
    public static final int LANES_PER_LONG = 4;
    public static final int SYNC_LANES = 3;
    public static final long MAX_THREE_LANE_VALUE = (1L << 48) - 1L;
    private static final int BITS_PER_LANE = 16;
    private static final long LANE_MASK = 0xFFFFL;

    private ShortSplit() {
    }

    /** The 16-bit lane {@code lane} (0..3) of {@code value}, zero-extended into an int. */
    public static int lane(long value, int lane) {
        if (lane < 0 || lane >= LANES_PER_LONG) {
            throw new IllegalArgumentException("lane must be 0.." + (LANES_PER_LONG - 1) + ": " + lane);
        }
        return (int) ((value >>> (BITS_PER_LANE * lane)) & LANE_MASK);
    }

    /** One of the exact three menu-sync lanes; rejects values that cannot round-trip. */
    public static int syncLane(long value, int lane) {
        requireThreeLaneValue(value);
        if (lane < 0 || lane >= SYNC_LANES) {
            throw new IllegalArgumentException("sync lane must be 0.." + (SYNC_LANES - 1) + ": " + lane);
        }
        return lane(value, lane);
    }

    /** Recombines exactly three menu-sync lanes, zero-extending signed packet shorts. */
    public static long combineThree(int lane0, int lane1, int lane2) {
        return combine(lane0, lane1, lane2, 0);
    }

    /** Fails fast instead of silently truncating a value outside the three-lane wire domain. */
    public static long requireThreeLaneValue(long value) {
        if (value < 0L || value > MAX_THREE_LANE_VALUE) {
            throw new IllegalArgumentException(
                    "three-lane value must be 0.." + MAX_THREE_LANE_VALUE + ": " + value);
        }
        return value;
    }

    /** Recombines four 16-bit lanes; each lane is masked to its low 16 bits first. */
    public static long combine(int lane0, int lane1, int lane2, int lane3) {
        return (lane0 & LANE_MASK)
                | ((lane1 & LANE_MASK) << BITS_PER_LANE)
                | ((lane2 & LANE_MASK) << (2 * BITS_PER_LANE))
                | ((lane3 & LANE_MASK) << (3 * BITS_PER_LANE));
    }
}
