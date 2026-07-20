package dev.cuprum.cuprum.charge.core;

/**
 * PWR-18 allocation tiers (charge.md §2a, frozen). The ordinal IS the allocation order: DEFENSE
 * consumers are served fully before LOGISTICS, which is served fully before MISC — at 50% total
 * supply a DEFENSE consumer receives 100% of its request and MISC receives exactly 0.
 */
public enum ChargePriority {
    DEFENSE,
    LOGISTICS,
    MISC;

    /** Bounds-checked ordinal lookup for persisted/serialized values (clamps to MISC). */
    public static ChargePriority fromOrdinal(int ordinal) {
        ChargePriority[] values = values();
        return ordinal >= 0 && ordinal < values.length ? values[ordinal] : MISC;
    }
}
