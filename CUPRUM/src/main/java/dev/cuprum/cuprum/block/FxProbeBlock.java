package dev.cuprum.cuprum.block;

import com.mojang.serialization.MapCodec;
import dev.cuprum.cuprum.Cuprum;
import dev.cuprum.cuprum.blockentity.FxProbeBlockEntity;
import dev.cuprum.cuprum.fx.FxRippleBroadcaster;
import net.minecraft.core.BlockPos;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.InteractionResult;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.BaseEntityBlock;
import net.minecraft.world.level.block.entity.BlockEntity;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.phys.BlockHitResult;
import org.jetbrains.annotations.Nullable;

/**
 * The FX probe (CP0 diagnostic infrastructure; intentionally NOT a catalog entry — Charge
 * Probe precedent). Server-side use records one pulse on the BE and dispatches one diagnostic
 * copper ripple to every tracking client: radius {@value #RIPPLE_RADIUS_Q8} Q8.8
 * (= 3.0 blocks), copper {@code 0xFFE77C56}, current game time (client-fx.md §12). The visual
 * is presentation-only — the interaction result and pulse counter are identical whatever tier
 * (or OFF) each client renders at (QOL-04 outcome neutrality).
 */
public class FxProbeBlock extends BaseEntityBlock {
    public static final MapCodec<FxProbeBlock> CODEC = simpleCodec(FxProbeBlock::new);

    /** Diagnostic ripple radius on the wire: 768 Q8.8 = 3.0 blocks (client-fx.md §12). */
    public static final int RIPPLE_RADIUS_Q8 = 768;
    /** Diagnostic ripple color: opaque copper (client-fx.md §12). */
    public static final int RIPPLE_COLOR_ARGB = 0xFFE77C56;

    public FxProbeBlock(Properties properties) {
        super(properties);
    }

    @Override
    protected MapCodec<? extends BaseEntityBlock> codec() {
        return CODEC;
    }

    @Override
    @Nullable
    public BlockEntity newBlockEntity(BlockPos pos, BlockState state) {
        return new FxProbeBlockEntity(pos, state);
    }

    @Override
    protected InteractionResult useWithoutItem(BlockState state, Level level, BlockPos pos, Player player,
            BlockHitResult hitResult) {
        if (level.isClientSide()) {
            return InteractionResult.SUCCESS;
        }
        if (level instanceof ServerLevel serverLevel
                && level.getBlockEntity(pos) instanceof FxProbeBlockEntity probe) {
            long pulse = probe.recordPulse();
            int sent = FxRippleBroadcaster.broadcast(serverLevel, pos, RIPPLE_RADIUS_Q8, RIPPLE_COLOR_ARGB);
            Cuprum.LOGGER.info("[fx_probe] pulse {} at {} by {} (ripple sent to {} tracking player(s))",
                    pulse, pos, player.getName().getString(), sent);
        }
        return InteractionResult.SUCCESS_SERVER;
    }
}
