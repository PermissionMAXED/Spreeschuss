package dev.cuprum.cuprum.charge.core;

/**
 * One budgeted rebuild pass's outcome (charge.md §2a, frozen): {@code visited} nodes were
 * relabeled this pass; {@code queueDepth} is the carry-over depth still pending (0 when the
 * partition has fully converged).
 */
public record RebuildStats(int visited, int queueDepth) {
}
