package dev.cuprum.cuprum.net.server;

/**
 * Minecraft-free token bucket (plan D9): long arithmetic, lazy refill against a mod-owned tick
 * counter, wraparound-safe deltas (two's-complement subtraction stays correct across a counter
 * wrap). Tokens are stored in twentieths ("units") so whole-token-per-second rates refill evenly
 * across 20 ticks without floating point. Not thread-safe: guard checks run on the server thread.
 */
public final class TokenBucket {
    /** 20 units per token == 20 ticks per second: a rate of N/s refills N units per tick. */
    public static final long UNITS_PER_TOKEN = 20;

    private final long capacityUnits;
    private final long refillUnitsPerTick;
    private long units;
    private long lastRefillTick;

    /**
     * @param ratePerSecond sustained tokens per second (equals units refilled per tick)
     * @param burst         bucket capacity in tokens (starts full)
     * @param nowTick       current value of the mod-owned tick counter
     */
    public TokenBucket(int ratePerSecond, int burst, long nowTick) {
        if (ratePerSecond <= 0 || burst <= 0) {
            throw new IllegalArgumentException("ratePerSecond and burst must be positive: " + ratePerSecond + "/" + burst);
        }
        this.capacityUnits = burst * UNITS_PER_TOKEN;
        this.refillUnitsPerTick = ratePerSecond;
        this.units = this.capacityUnits;
        this.lastRefillTick = nowTick;
    }

    /** Refills to {@code nowTick} and reports whether one whole token is available. */
    public boolean canAcquire(long nowTick) {
        refill(nowTick);
        return units >= UNITS_PER_TOKEN;
    }

    /** Consumes one token; only legal directly after a passing {@link #canAcquire}. */
    public void consume() {
        if (units < UNITS_PER_TOKEN) {
            throw new IllegalStateException("consume() without a passing canAcquire()");
        }
        units -= UNITS_PER_TOKEN;
    }

    /** Refill-then-take in one step: the common single-bucket path. */
    public boolean tryAcquire(long nowTick) {
        if (!canAcquire(nowTick)) {
            return false;
        }
        consume();
        return true;
    }

    /** Whole tokens available after refilling to {@code nowTick} (diagnostics/tests). */
    public long availableTokens(long nowTick) {
        refill(nowTick);
        return units / UNITS_PER_TOKEN;
    }

    private void refill(long nowTick) {
        // Two's-complement subtraction: correct even when the counter wraps around Long.MAX_VALUE.
        long delta = nowTick - lastRefillTick;
        if (delta <= 0) {
            // Never move lastRefillTick backwards: an out-of-order query must not let a later
            // query at the previously observed tick refill as if time had advanced.
            return;
        }
        lastRefillTick = nowTick;
        long missing = capacityUnits - units;
        long ticksToFull = (missing + refillUnitsPerTick - 1) / refillUnitsPerTick;
        if (delta >= ticksToFull) {
            units = capacityUnits;
        } else {
            // delta < ticksToFull <= capacityUnits + 1, so this multiplication cannot overflow.
            units = Math.min(capacityUnits, units + delta * refillUnitsPerTick);
        }
    }
}
