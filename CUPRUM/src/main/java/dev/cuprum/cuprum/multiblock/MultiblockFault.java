package dev.cuprum.cuprum.multiblock;

import java.util.Optional;
import net.minecraft.core.BlockPos;

/**
 * A concrete formation fault (multiblock.md §3.2, frozen): the {@link FaultCode}, the world
 * position it names when one exists (first failing/unloaded/conflicting member) and a
 * human-readable detail line for diagnostics. Never persisted (plan §3.1).
 */
public record MultiblockFault(FaultCode code, Optional<BlockPos> pos, String detail) {
    public MultiblockFault {
        pos = pos.map(BlockPos::immutable);
    }
}
