package dev.cuprum.cuprum.machine;

/**
 * Minecraft-free charge-machine wire and timing policy.
 *
 * <p>Kept separate from {@link ChargeMachineBlockEntity} so boundary arithmetic can be covered
 * by plain JUnit without bootstrapping Minecraft registries.
 */
final class ChargeMachineSyncPolicy {
    static final int MIN_INTERVAL_TICKS = 10;
    static final long MAX_SYNCABLE_CG = (1L << 48) - 1L;
    static final long NEVER_SYNCED = Long.MIN_VALUE;

    private ChargeMachineSyncPolicy() {
    }

    static long requireSyncableCg(String label, long value) {
        if (value < 0L || value > MAX_SYNCABLE_CG) {
            throw new IllegalArgumentException(label + " must be 0.." + MAX_SYNCABLE_CG + ": " + value);
        }
        return value;
    }

    /**
     * The first call and a reset/backwards clock always open a fresh sync window. Subtraction is
     * evaluated only after the ordering check, so neither the sentinel nor wrap can overflow.
     */
    static boolean elapsed(long gameTime, long previousSyncGameTime) {
        return previousSyncGameTime == NEVER_SYNCED
                || gameTime < previousSyncGameTime
                || gameTime - previousSyncGameTime >= MIN_INTERVAL_TICKS;
    }
}
