package dev.cuprum.cuprum.multiblock;

/**
 * Implemented by every BlockEntity that hosts a {@link MultiblockControllerBehavior}
 * (composition per multiblock.md §5.2 — there is no controller BE base class). The
 * {@link MultiblockLevelIndex} uses it during stale-claim eviction to verify that a recorded
 * claim owner still holds a live controller.
 */
public interface MultiblockControllerHost {
    MultiblockControllerBehavior multiblockBehavior();
}
