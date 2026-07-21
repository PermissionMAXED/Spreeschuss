package dev.cuprum.cuprum.fx.core;

/**
 * MC-free particle budget accounting (plan D9; client-fx.md §5/§11): enforces the per-tick
 * spawn cap and the live-particle ceiling for every Cuprum FX spawn. The client-side
 * {@code FxParticleBudget} wraps one instance, feeding it the client tick counter and an
 * estimated live count (age-based expiry, since vanilla never reports particle death).
 *
 * <p>All arithmetic is {@code long}-based and monotonic-wraparound safe: a tick value moving
 * backwards (world change, debug time set) simply opens a fresh window.
 */
public final class FxBudgetCounter {
    private final int spawnPerTickCap;
    private final int liveCap;

    private long windowTick = Long.MIN_VALUE;
    private int spawnedThisTick;
    private long acceptedTotal;
    private long rejectedTotal;

    public FxBudgetCounter(int spawnPerTickCap, int liveCap) {
        if (spawnPerTickCap <= 0 || liveCap <= 0) {
            throw new IllegalArgumentException("budget caps must be positive");
        }
        this.spawnPerTickCap = spawnPerTickCap;
        this.liveCap = liveCap;
    }

    /**
     * Tries to reserve one spawn slot on {@code nowTick} given {@code liveEstimate} particles
     * currently alive. Returns true when the spawn stays inside both caps.
     */
    public boolean tryReserve(long nowTick, int liveEstimate) {
        if (nowTick != windowTick) {
            windowTick = nowTick;
            spawnedThisTick = 0;
        }
        if (spawnedThisTick >= spawnPerTickCap || liveEstimate >= liveCap) {
            rejectedTotal++;
            return false;
        }
        spawnedThisTick++;
        acceptedTotal++;
        return true;
    }

    /**
     * Rolls back the immediately preceding successful reservation when the delegated spawn
     * throws. Client-thread confinement makes this exact; failed particle creation must not be
     * reported as accepted or consume the per-tick budget.
     */
    public void rollbackReservation(long nowTick) {
        if (windowTick != nowTick || spawnedThisTick <= 0 || acceptedTotal <= 0) {
            throw new IllegalStateException("no reservation to roll back at tick " + nowTick);
        }
        spawnedThisTick--;
        acceptedTotal--;
    }

    public int spawnedThisTick(long nowTick) {
        return nowTick == windowTick ? spawnedThisTick : 0;
    }

    public long acceptedTotal() {
        return acceptedTotal;
    }

    public long rejectedTotal() {
        return rejectedTotal;
    }

    public void reset() {
        windowTick = Long.MIN_VALUE;
        spawnedThisTick = 0;
        acceptedTotal = 0;
        rejectedTotal = 0;
    }
}
