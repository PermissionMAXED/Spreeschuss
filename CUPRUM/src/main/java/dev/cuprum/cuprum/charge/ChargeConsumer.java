package dev.cuprum.cuprum.charge;

/**
 * A node that consumes Cg (charge.md §2b, frozen). Under brownout the allocator serves consumers
 * strictly by {@link ChargeNode#priority()} tier in canonical order: at 50% total supply a
 * DEFENSE consumer receives 100% of its request and MISC receives exactly 0.
 */
public interface ChargeConsumer extends ChargeNode {
    /** Cg wanted this tick (non-negative; negative values are treated as 0). */
    long demandPerTick();

    /**
     * Called by the allocator to deliver up to {@code amountCg} (possibly several calls per
     * tick, one per sourcing transfer). Returns the Cg ACTUALLY accepted, in
     * {@code [0, amountCg]} — a rejected remainder stays with the network and continues to the
     * next eligible target or vents exactly (Eval-A repair). Out-of-range returns are clamped
     * with a warning.
     */
    long accept(long amountCg);
}
