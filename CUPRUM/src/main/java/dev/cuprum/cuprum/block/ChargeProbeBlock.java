package dev.cuprum.cuprum.block;

import dev.cuprum.cuprum.Cuprum;
import dev.cuprum.cuprum.CuprumCatalog;
import net.minecraft.core.BlockPos;
import net.minecraft.network.chat.Component;
import net.minecraft.world.InteractionResult;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.phys.BlockHitResult;

/**
 * Diagnostic block (CP0 infrastructure; intentionally NOT a catalog entry). On
 * server-side use it reports the running mod
 * version and the canonical catalog SHA-256 to the interacting player and the log.
 */
public class ChargeProbeBlock extends Block {
    public ChargeProbeBlock(Properties properties) {
        super(properties);
    }

    @Override
    protected InteractionResult useWithoutItem(BlockState state, Level level, BlockPos pos, Player player, BlockHitResult hitResult) {
        if (!level.isClientSide()) {
            String message = "Cuprum " + Cuprum.version() + " | catalog sha256 " + CuprumCatalog.CATALOG_SHA256;
            Cuprum.LOGGER.info("[charge_probe] used at {} by {}: {}", pos, player.getName().getString(), message);
            player.displayClientMessage(Component.literal(message), false);
            return InteractionResult.SUCCESS_SERVER;
        }
        return InteractionResult.SUCCESS;
    }
}
