package dev.cuprum.cuprum.gametest.harness;

import dev.cuprum.cuprum.charge.ChargeConsumer;
import dev.cuprum.cuprum.charge.ChargeGraphManager;
import dev.cuprum.cuprum.charge.core.ChargePriority;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.level.block.entity.BlockEntity;
import net.minecraft.world.level.block.state.BlockState;
import org.jetbrains.annotations.Nullable;

/**
 * Gametest-only settable consumer. The priority is fixed per BLOCK variant (defense/misc — see
 * {@link ChargeHarnessInit}) because the graph captures priority at node registration, which
 * happens on {@code BLOCK_ENTITY_LOAD}, before any test code could call a setter. Demand is
 * settable at runtime; every accepted delivery is tallied for exact assertions.
 */
public final class HarnessSinkBlockEntity extends BlockEntity implements ChargeConsumer {
    private final ChargePriority priority;
    private long demandPerTick;
    private long totalReceived;

    public HarnessSinkBlockEntity(BlockPos pos, BlockState state, ChargePriority priority) {
        super(ChargeHarnessInit.SINK_BLOCK_ENTITY, pos, state);
        this.priority = priority;
    }

    public void setDemandPerTick(long demandPerTick) {
        this.demandPerTick = Math.max(0L, demandPerTick);
    }

    public long totalReceived() {
        return totalReceived;
    }

    @Override
    public ChargePriority priority() {
        return priority;
    }

    @Override
    public long demandPerTick() {
        return demandPerTick;
    }

    @Override
    public long accept(long amountCg) {
        long accepted = Math.max(0L, amountCg);
        totalReceived += accepted;
        return accepted;
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
