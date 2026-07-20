package dev.cuprum.cuprum.charge.core;

/**
 * The single clamp/insert/extract authority for stored Cg (FOUNDATION_PLAN D7: moved from the
 * machine brief into {@code charge.core}). Every storage-like holder (harness cell in W1B, the
 * Diagnostic Coil core in W1C, the Leyden jar in later waves) delegates to one of these instead
 * of re-implementing clamping.
 *
 * <p>Two mutation families with distinct budgets:
 *
 * <ul>
 *   <li>{@link #insert}/{@link #extract} — the one normal-flow path used by both graph and
 *       external callers. Capacity/stored and one shared game-tick budget are enforced; the
 *       owner lazily opens the window through {@link #beginGameTick(long)}.</li>
 *   <li>{@link #depositSurge} — the explicit surge path: bypasses the normal insert budget but
 *       still clamps to capacity.</li>
 * </ul>
 */
public final class ChargeBuffer {
    private final long capacity;
    private final long maxInsertPerTick;
    private final long maxExtractPerTick;
    private long stored;
    private long insertedThisTick;
    private long extractedThisTick;
    private long budgetGameTick;
    private boolean budgetGameTickInitialized;

    public ChargeBuffer(long capacity, long maxInsertPerTick, long maxExtractPerTick) {
        if (capacity < 0 || maxInsertPerTick < 0 || maxExtractPerTick < 0) {
            throw new IllegalArgumentException("ChargeBuffer limits must be non-negative: capacity=" + capacity
                    + " maxInsert=" + maxInsertPerTick + " maxExtract=" + maxExtractPerTick);
        }
        this.capacity = capacity;
        this.maxInsertPerTick = maxInsertPerTick;
        this.maxExtractPerTick = maxExtractPerTick;
    }

    public long stored() {
        return stored;
    }

    public long capacity() {
        return capacity;
    }

    public long maxInsertPerTick() {
        return maxInsertPerTick;
    }

    public long maxExtractPerTick() {
        return maxExtractPerTick;
    }

    /**
     * Lazily opens the normal-flow budget window for {@code gameTick}. Repeated calls with the
     * same tick preserve usage; the first call for any different tick replenishes both budgets.
     */
    public void beginGameTick(long gameTick) {
        if (!budgetGameTickInitialized || budgetGameTick != gameTick) {
            budgetGameTick = gameTick;
            budgetGameTickInitialized = true;
            insertedThisTick = 0L;
            extractedThisTick = 0L;
        }
    }

    /**
     * API-level insert: accepts up to {@code min(amount, remaining capacity, remaining per-tick
     * insert budget)}; returns the accepted amount (never negative). Negative requests accept 0.
     */
    public long insert(long amountCg, boolean simulate) {
        if (amountCg <= 0) {
            return 0L;
        }
        long room = ChargeMath.satSub(capacity, stored);
        long budget = ChargeMath.satSub(maxInsertPerTick, insertedThisTick);
        long accepted = Math.min(amountCg, Math.min(room, budget));
        if (!simulate && accepted > 0) {
            stored = ChargeMath.satAdd(stored, accepted);
            insertedThisTick = ChargeMath.satAdd(insertedThisTick, accepted);
        }
        return accepted;
    }

    /**
     * API-level extract: yields up to {@code min(amount, stored, remaining per-tick extract
     * budget)}; returns the extracted amount (never negative). Negative requests yield 0.
     */
    public long extract(long amountCg, boolean simulate) {
        if (amountCg <= 0) {
            return 0L;
        }
        long budget = ChargeMath.satSub(maxExtractPerTick, extractedThisTick);
        long extracted = Math.min(amountCg, Math.min(stored, budget));
        if (!simulate && extracted > 0) {
            stored = ChargeMath.satSub(stored, extracted);
            extractedThisTick = ChargeMath.satAdd(extractedThisTick, extracted);
        }
        return extracted;
    }

    /**
     * Surge path (charge.md §3 surge rule): bypasses the per-tick insert budget but always
     * respects capacity. Returns the accepted amount.
     */
    public long depositSurge(long amountCg) {
        if (amountCg <= 0) {
            return 0L;
        }
        long accepted = Math.min(amountCg, ChargeMath.satSub(capacity, stored));
        stored = ChargeMath.satAdd(stored, accepted);
        return accepted;
    }

    /** Load path: sets stored directly, clamped to {@code [0, capacity]}; returns the clamped value. */
    public long setStored(long value) {
        stored = ChargeMath.clamp(value, 0L, capacity);
        return stored;
    }
}
