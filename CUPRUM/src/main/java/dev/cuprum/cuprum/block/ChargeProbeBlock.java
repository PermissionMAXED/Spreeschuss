package dev.cuprum.cuprum.block;

import dev.cuprum.cuprum.Cuprum;
import dev.cuprum.cuprum.CuprumCatalog;
import dev.cuprum.cuprum.charge.ChargeGraphManager;
import dev.cuprum.cuprum.charge.diag.ChargeProbeReport;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerLevel;
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
 * Since W1B it additionally reports every adjacent charge-graph node across the six
 * directions via the stable {@code ChargeProbeReport.format} line (charge.md §7).
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
            // W1B append (charge.md §7): report each adjacent charge node, six directions.
            if (level instanceof ServerLevel serverLevel) {
                ChargeGraphManager manager = ChargeGraphManager.of(serverLevel);
                for (Direction direction : Direction.values()) {
                    manager.nodeReport(pos.relative(direction)).ifPresent(report -> {
                        String line = ChargeProbeReport.format(report);
                        Cuprum.LOGGER.info("[charge_probe] {}", line);
                        player.displayClientMessage(Component.literal(line), false);
                    });
                }
            }
            return InteractionResult.SUCCESS_SERVER;
        }
        return InteractionResult.SUCCESS;
    }
}
