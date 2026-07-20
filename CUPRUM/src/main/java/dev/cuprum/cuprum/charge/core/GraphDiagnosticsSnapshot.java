package dev.cuprum.cuprum.charge.core;

/**
 * Read-only diagnostics snapshot (charge.md §2a, frozen; surfaced by {@code /cuprum cg stats}).
 * Counters are truthful: they are computed from live graph state and the last completed
 * allocator pass, never estimated.
 */
public record GraphDiagnosticsSnapshot(int nodes, int edges, int networks, int frozenNodes,
        long topologyVersion, long tickNanosLast, long tickNanosEma, long ventedLastTick,
        long ventedTotal, long movedLastTick, int rebuildQueueDepth) {
}
