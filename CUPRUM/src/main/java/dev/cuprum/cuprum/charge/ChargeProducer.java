package dev.cuprum.cuprum.charge;

/**
 * A node that generates Cg (charge.md §2b, frozen). The allocator reads {@link #offerPerTick()}
 * once per tick and always drains the full offer: whatever consumers, storages and surge
 * absorbers cannot place is vented by the graph (charge.md §3 P4).
 */
public interface ChargeProducer extends ChargeNode {
    /** Cg offered this tick (non-negative; negative values are treated as 0). */
    long offerPerTick();

    /**
     * Called by the allocator to drain up to {@code amountCg} from this producer (once per pass
     * with the full offer). Returns the Cg ACTUALLY drained, in {@code [0, amountCg]} — the
     * graph's conservation accounting is driven only by this return value (Eval-A repair:
     * actual applied amounts drive every transfer/report). Out-of-range returns are clamped
     * with a warning.
     */
    long drain(long amountCg);
}
