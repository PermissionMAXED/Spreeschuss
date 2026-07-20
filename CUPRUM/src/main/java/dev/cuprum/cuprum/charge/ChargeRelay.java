package dev.cuprum.cuprum.charge;

/**
 * A pure pass-through node (charge.md §2b; W1: gametest harness only — U19 wires / PWR-01 pylons
 * arrive in later waves). {@link #throughputPerTick()} is enforced as a per-node pass-through
 * budget decremented greedily (by ACTUAL transferred amounts) along deterministic BFS shortest
 * paths — exact for chain/tree topologies, a documented approximation on meshes (exact max-flow
 * is out of scope until a PWR-era acceptance requires it). The budget window spans one
 * allocator pass: it replenishes at the start of each pass and is shared cumulatively by the
 * pass's own transfers AND every surge deposit until the next pass (Eval-A repair F4), so surge
 * bypasses ONLY the storage insert rate — never relay throughput.
 */
public interface ChargeRelay extends ChargeNode {
    /** Pass-through budget in Cg per tick (non-negative). */
    long throughputPerTick();
}
