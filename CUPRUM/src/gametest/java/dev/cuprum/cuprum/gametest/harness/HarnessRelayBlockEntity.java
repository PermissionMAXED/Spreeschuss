package dev.cuprum.cuprum.gametest.harness;

import dev.cuprum.cuprum.charge.ChargeGraphManager;
import dev.cuprum.cuprum.charge.ChargeRelay;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.level.block.entity.BlockEntity;
import net.minecraft.world.level.block.state.BlockState;
import org.jetbrains.annotations.Nullable;

/**
 * Gametest-only pass-through relay with a fixed throughput budget. The budget is captured at
 * node registration ({@code BLOCK_ENTITY_LOAD}); use {@code notifyNodeChanged} after changing
 * it at runtime.
 */
public final class HarnessRelayBlockEntity extends BlockEntity implements ChargeRelay {
    public static final long THROUGHPUT_PER_TICK_CG = 500L;

    public HarnessRelayBlockEntity(BlockPos pos, BlockState state) {
        super(ChargeHarnessInit.RELAY_BLOCK_ENTITY, pos, state);
    }

    @Override
    public long throughputPerTick() {
        return THROUGHPUT_PER_TICK_CG;
    }

    @Override
    public boolean canConnect(@Nullable Direction side) {
        return true;
    }

    @Override
    public void preRemoveSideEffects(BlockPos pos, BlockState state) {
        super.preRemoveSideEffects(pos, state);
        if (level instanceof ServerLevel serverLevel) {
            ChargeGraphManager.of(serverLevel).notifyNodeRemoved(this);
        }
    }
}
