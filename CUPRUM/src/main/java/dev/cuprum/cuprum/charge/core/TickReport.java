package dev.cuprum.cuprum.charge.core;

/**
 * One allocator pass's outcome (charge.md §2a, frozen). {@code moved} is the total Cg delivered
 * to consumers, storages and surge absorbers; {@code vented} is the residual that had nowhere to
 * go (allocator residual offers plus surge excess since the previous tick, charge.md §3 P4) —
 * both saturating, never negative.
 */
public record TickReport(long moved, long vented, int networksTicked, long nanos) {
}
