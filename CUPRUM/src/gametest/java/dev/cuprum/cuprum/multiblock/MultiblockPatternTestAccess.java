package dev.cuprum.cuprum.multiblock;

import java.util.LinkedHashMap;
import java.util.Map;
import net.minecraft.core.BlockPos;
import net.minecraft.server.level.ServerLevel;

/** Package bridge exposing guarded member-read counts to permanent GameTests. */
public final class MultiblockPatternTestAccess {
    private MultiblockPatternTestAccess() {
    }

    public static MatchTrace tryMatch(
            MultiblockPattern pattern, ServerLevel level, BlockPos controllerPos) {
        Map<MultiblockOrientation, Integer> reads = new LinkedHashMap<>();
        MultiblockMatchResult result = pattern.tryMatch(level, controllerPos,
                (orientation, position) -> reads.merge(orientation, 1, Integer::sum));
        return new MatchTrace(result, Map.copyOf(reads));
    }

    /** One match result plus exact guarded block-state reads per attempted orientation. */
    public record MatchTrace(
            MultiblockMatchResult result, Map<MultiblockOrientation, Integer> readsByOrientation) {
        public int reads(MultiblockOrientation orientation) {
            return readsByOrientation.getOrDefault(orientation, 0);
        }
    }
}
