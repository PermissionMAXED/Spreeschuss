package dev.cuprum.cuprum.charge.core;

/**
 * Node role bitmask (charge.md §2a, frozen): a node may carry several roles (PWR-16 combines
 * them in later waves); the solver honors exactly the roles present in the mask.
 */
public final class Roles {
    public static final int PRODUCER = 1;
    public static final int STORAGE = 2;
    public static final int CONSUMER = 4;
    public static final int RELAY = 8;
    public static final int SURGE_ABSORBER = 16;

    /** Union of every defined role bit (validation helper). */
    public static final int ALL = PRODUCER | STORAGE | CONSUMER | RELAY | SURGE_ABSORBER;

    private Roles() {
    }

    public static boolean has(int mask, int role) {
        return (mask & role) != 0;
    }
}
