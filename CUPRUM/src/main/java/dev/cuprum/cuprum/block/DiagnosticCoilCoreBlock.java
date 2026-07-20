package dev.cuprum.cuprum.block;

import com.mojang.serialization.MapCodec;
import dev.cuprum.cuprum.machine.MachineContent;
import dev.cuprum.cuprum.multiblock.FormationState;
import dev.cuprum.cuprum.multiblock.MultiblockFault;
import java.util.Optional;
import net.minecraft.core.BlockPos;
import net.minecraft.network.chat.Component;
import net.minecraft.world.InteractionResult;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.BaseEntityBlock;
import net.minecraft.world.level.block.entity.BlockEntity;
import net.minecraft.world.level.block.entity.BlockEntityTicker;
import net.minecraft.world.level.block.entity.BlockEntityType;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.phys.BlockHitResult;
import org.jetbrains.annotations.Nullable;

/**
 * The Diagnostic Coil controller block (multiblock.md §7; NOT a catalog entry). Server-only BE
 * ticker via {@code createTickerHelper}; use opens the read-only charge-machine menu when
 * FORMED, otherwise reports the formation state (with fault detail) to the action bar.
 */
public class DiagnosticCoilCoreBlock extends BaseEntityBlock {
    public static final MapCodec<DiagnosticCoilCoreBlock> CODEC = simpleCodec(DiagnosticCoilCoreBlock::new);

    public DiagnosticCoilCoreBlock(Properties properties) {
        super(properties);
    }

    @Override
    protected MapCodec<? extends BaseEntityBlock> codec() {
        return CODEC;
    }

    @Override
    @Nullable
    public BlockEntity newBlockEntity(BlockPos pos, BlockState state) {
        return new DiagnosticCoilCoreBlockEntity(pos, state);
    }

    @Override
    @Nullable
    public <T extends BlockEntity> BlockEntityTicker<T> getTicker(Level level, BlockState state,
            BlockEntityType<T> blockEntityType) {
        return level.isClientSide() ? null : createTickerHelper(blockEntityType,
                MachineContent.DIAGNOSTIC_COIL_CORE_BLOCK_ENTITY, DiagnosticCoilCoreBlockEntity::serverTick);
    }

    @Override
    protected InteractionResult useWithoutItem(BlockState state, Level level, BlockPos pos, Player player,
            BlockHitResult hitResult) {
        if (level.isClientSide()) {
            return InteractionResult.SUCCESS;
        }
        if (level.getBlockEntity(pos) instanceof DiagnosticCoilCoreBlockEntity coil) {
            if (coil.multiblockBehavior().state() == FormationState.FORMED) {
                player.openMenu(coil);
            } else {
                player.displayClientMessage(formationText(coil), true);
            }
        }
        return InteractionResult.SUCCESS_SERVER;
    }

    private static Component formationText(DiagnosticCoilCoreBlockEntity coil) {
        Optional<MultiblockFault> fault = coil.multiblockBehavior().fault();
        if (fault.isEmpty()) {
            return Component.translatable("cuprum.formation.unformed");
        }
        MultiblockFault value = fault.get();
        String where = value.pos().map(pos -> " @ " + pos.toShortString()).orElse("");
        return Component.translatable("cuprum.formation.fault")
                .append(Component.literal(" [" + value.code().getSerializedName() + where + "]"));
    }
}
