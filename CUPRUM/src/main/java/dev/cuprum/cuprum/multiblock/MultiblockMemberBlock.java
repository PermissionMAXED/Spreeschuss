package dev.cuprum.cuprum.multiblock;

import net.minecraft.core.BlockPos;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.state.BlockState;

/**
 * Base for Cuprum-owned multiblock member blocks (multiblock.md §5.3 fast path): place/removal
 * O(1)-marks the owning controller dirty through {@link MultiblockLevelIndex}, giving the
 * frozen ≤2-tick fault bound. Vanilla members (waxed/oxidized copper) are unhookable — the
 * 20-tick poll catches those within the frozen ≤40-tick bound. {@code Block.onRemove} is gone
 * in 1.21.9; {@code affectNeighborsAfterRemoval} is the replacement removal hook
 * ({@code neighborChanged} with {@code @Nullable Orientation} exists but stays unused in W1).
 */
public class MultiblockMemberBlock extends Block {
    public MultiblockMemberBlock(Properties properties) {
        super(properties);
    }

    @Override
    protected void onPlace(BlockState state, Level level, BlockPos pos, BlockState oldState, boolean movedByPiston) {
        super.onPlace(state, level, pos, oldState, movedByPiston);
        if (level instanceof ServerLevel serverLevel) {
            MultiblockLevelIndex.get(serverLevel).requestRevalidation(pos);
        }
    }

    @Override
    protected void affectNeighborsAfterRemoval(BlockState state, ServerLevel level, BlockPos pos,
            boolean movedByPiston) {
        super.affectNeighborsAfterRemoval(state, level, pos, movedByPiston);
        MultiblockLevelIndex.get(level).requestRevalidation(pos);
    }
}
