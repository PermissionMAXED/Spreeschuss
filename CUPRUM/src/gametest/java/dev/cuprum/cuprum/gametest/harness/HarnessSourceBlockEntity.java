package dev.cuprum.cuprum.gametest.harness;

import dev.cuprum.cuprum.charge.ChargeGraphManager;
import dev.cuprum.cuprum.charge.ChargeProducer;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.level.block.entity.BlockEntity;
import net.minecraft.world.level.block.state.BlockState;
import org.jetbrains.annotations.Nullable;

/**
 * Gametest-only settable producer: offers {@code min(offerPerTick, remaining)} each allocator
 * pass; the allocator's drain callback decrements the remaining budget and tallies the total.
 * Settings are runtime-only (tests configure them right after placement) — deliberately not
 * persisted, the harness never ships.
 */
public final class HarnessSourceBlockEntity extends BlockEntity implements ChargeProducer {
    private long offerPerTick;
    private long remaining = Long.MAX_VALUE;
    private long totalDrained;

    public HarnessSourceBlockEntity(BlockPos pos, BlockState state) {
        super(ChargeHarnessInit.SOURCE_BLOCK_ENTITY, pos, state);
    }

    public void setOfferPerTick(long offerPerTick) {
        this.offerPerTick = Math.max(0L, offerPerTick);
    }

    /** Caps the total Cg this source will ever produce (default unlimited). */
    public void setRemaining(long remaining) {
        this.remaining = Math.max(0L, remaining);
    }

    public long totalDrained() {
        return totalDrained;
    }

    @Override
    public long offerPerTick() {
        return Math.min(offerPerTick, remaining);
    }

    @Override
    public long drain(long amountCg) {
        long drained = Math.max(0L, Math.min(amountCg, remaining));
        remaining -= drained;
        totalDrained += drained;
        return drained;
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
