package dev.cuprum.cuprum.multiblock;

import java.util.Arrays;
import net.minecraft.resources.ResourceLocation;

/**
 * A successful pattern match (multiblock.md §3.2, frozen): the pattern id, the matched
 * orientation and every member position (controller included) as sorted
 * {@code BlockPos.asLong()} keys — the exact array handed to
 * {@code MultiblockLevelIndex.claim}.
 */
public record MultiblockMatch(ResourceLocation patternId, MultiblockOrientation orientation,
                              long[] memberPositions) {
    public MultiblockMatch {
        memberPositions = memberPositions.clone();
        Arrays.sort(memberPositions);
    }

    @Override
    public long[] memberPositions() {
        return memberPositions.clone();
    }
}
