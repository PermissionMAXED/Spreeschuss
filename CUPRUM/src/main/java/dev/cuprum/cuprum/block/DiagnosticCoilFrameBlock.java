package dev.cuprum.cuprum.block;

import dev.cuprum.cuprum.multiblock.MultiblockMemberBlock;

/**
 * The Diagnostic Coil frame (multiblock.md §7; NOT a catalog entry — diagnostic/creative
 * acquisition only, plan §5.8). All fast-path invalidation behavior is inherited from
 * {@link MultiblockMemberBlock}; the frame carries no BE and no state.
 */
public class DiagnosticCoilFrameBlock extends MultiblockMemberBlock {
    public DiagnosticCoilFrameBlock(Properties properties) {
        super(properties);
    }
}
