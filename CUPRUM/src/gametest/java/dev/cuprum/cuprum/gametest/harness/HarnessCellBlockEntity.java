package dev.cuprum.cuprum.gametest.harness;

import dev.cuprum.cuprum.charge.blockentity.AbstractChargeStorageBlockEntity;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.world.level.block.state.BlockState;
import org.jetbrains.annotations.Nullable;

/**
 * Gametest-only storage cell (plan §4-W1B harness): 20,000 Cg capacity, 1,000 Cg/t insert and
 * extract. Everything (envelope persistence, buffer clamping, graph storage path, removal
 * notification) is inherited from {@link AbstractChargeStorageBlockEntity} — this class only
 * pins the harness constants and connects on all sides.
 */
public final class HarnessCellBlockEntity extends AbstractChargeStorageBlockEntity {
    public static final long CAPACITY_CG = 20_000L;
    public static final long MAX_INSERT_PER_TICK_CG = 1_000L;
    public static final long MAX_EXTRACT_PER_TICK_CG = 1_000L;

    public HarnessCellBlockEntity(BlockPos pos, BlockState state) {
        super(ChargeHarnessInit.CELL_BLOCK_ENTITY, pos, state,
                CAPACITY_CG, MAX_INSERT_PER_TICK_CG, MAX_EXTRACT_PER_TICK_CG);
    }

    @Override
    public boolean canConnect(@Nullable Direction side) {
        return true;
    }
}
