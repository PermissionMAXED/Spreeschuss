package dev.cuprum.cuprum.charge;

/**
 * A node that soaks surge/overflow Cg (charge.md §2b; reserved for PWR-13 fuse / PWR-21 ground
 * vent — no shipped implementation in W1). The allocator feeds absorbers in canonical order with
 * residual offers and surge excess before venting; per-call feeds never exceed the per-tick
 * absorb cap the node registered with the graph.
 */
public interface SurgeAbsorber extends ChargeNode {
    /**
     * Absorbs up to {@code amountCg}; returns the Cg ACTUALLY absorbed, in
     * {@code [0, amountCg]}. The graph's accounting is driven only by this return value
     * (Eval-A repair): a partially/fully rejected feed stays with the network and continues to
     * the next eligible absorber or vents exactly. Out-of-range returns are clamped with a
     * warning. Feeds never exceed the per-tick absorb cap the node registered with the graph
     * (cumulative across allocator and surge feeds within one tick window).
     */
    long absorbSurge(long amountCg);
}
