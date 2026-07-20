package dev.cuprum.cuprum.charge;

/**
 * A node that stores Cg (charge.md §2b, frozen). Implementations delegate every mutation to a
 * {@code charge.core.ChargeBuffer} — the single clamp/insert/extract authority (plan D7). The
 * node's stored Cg lives in exactly one place: its BlockEntity NBT (the SavedData shadow is
 * diagnostic only and never writes back into a loaded BE).
 */
public interface ChargeStorage extends ChargeNode {
    long stored();

    long capacity();

    long maxInsertPerTick();

    long maxExtractPerTick();

    /** Returns the accepted amount; clamped by capacity and per-tick budget; never negative. */
    long insert(long amountCg, boolean simulate);

    /** Returns the extracted amount; clamped by stored and per-tick budget; never negative. */
    long extract(long amountCg, boolean simulate);

    /**
     * Surge-only fill path: returns the accepted amount, clamped by capacity but intentionally
     * independent of the normal per-tick insert budget.
     */
    long insertSurge(long amountCg);
}
