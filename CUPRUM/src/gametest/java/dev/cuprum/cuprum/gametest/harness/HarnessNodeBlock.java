package dev.cuprum.cuprum.gametest.harness;

import net.minecraft.core.BlockPos;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.EntityBlock;
import net.minecraft.world.level.block.entity.BlockEntity;
import net.minecraft.world.level.block.state.BlockState;

/**
 * Gametest-only charge-node block shell: delegates BE creation to a per-block factory so the
 * two sink variants can pin different priorities on one BE type.
 */
final class HarnessNodeBlock extends Block implements EntityBlock {
    @FunctionalInterface
    interface Factory {
        BlockEntity create(BlockPos pos, BlockState state);
    }

    private final Factory factory;

    HarnessNodeBlock(Properties properties, Factory factory) {
        super(properties);
        this.factory = factory;
    }

    @Override
    public BlockEntity newBlockEntity(BlockPos pos, BlockState state) {
        return factory.create(pos, state);
    }
}
