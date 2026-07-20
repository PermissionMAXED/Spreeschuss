package dev.cuprum.cuprum.multiblock;

import java.util.Optional;

/**
 * Outcome of one {@code MultiblockPattern.tryMatch} (multiblock.md §3.2, frozen): either a
 * {@link MultiblockMatch} or the best fault — the fault from the orientation that matched the
 * most cells (tie → earlier canonical order), so diagnostics always name a concrete world
 * coordinate (§3.3).
 */
public record MultiblockMatchResult(Optional<MultiblockMatch> match, Optional<MultiblockFault> bestFault) {
    public static MultiblockMatchResult success(MultiblockMatch match) {
        return new MultiblockMatchResult(Optional.of(match), Optional.empty());
    }

    public static MultiblockMatchResult failure(MultiblockFault bestFault) {
        return new MultiblockMatchResult(Optional.empty(), Optional.of(bestFault));
    }
}
